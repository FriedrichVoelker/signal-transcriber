#!/usr/bin/env node

const net = require('net');
const fs = require('fs');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const WebSocket = require('ws');


const RPC_PORT = process.env.RPC_PORT || 7583;
const HTTP_PORT = process.env.HTTP_PORT || 8080;
const DEBUG = process.env.DEBUG || false;
const WHISPER_SERVICE_URL = process.env.WHISPER_SERVICE_URL || 'ws://whisper:8765/';
const RPC_HOST = process.env.RPC_HOST || 'signal';
const APPLICATION_NAME = process.env.APPLICATION_NAME || 'Signal Transcriber';

const ATTACHMENTDIR = "/root/.local/share/signal-cli/attachments/";
const SHAREDIR = "/signalshare/";

const client = new net.Socket();

// Message ID for JSON-RPC requests
let messageId = 1;

let spawns = [];

let handledIds = [];

let index = fs.readFileSync('./index.html');

// Start HTTP Server to listen for incoming connections
const httpServer = http.createServer((req, res) => {
	console.log('Request:', req.url);
	if (req.url === '/favicon.ico') return;
	if(client == null) {
		res.writeHead(412, { 'Content-Type': 'text/html' });
		res.write("<div style='color:red;'>Signal Client not connected yet. Please try again later.</div>");
		return;
	}


	let spawnId = messageId++;
	let spawnReplied = false;

	// Start signal-cli link command
	let x = send(JSON.stringify({
		jsonrpc: '2.0',
		method: 'startLink',
		params: {
			name: APPLICATION_NAME
		},
		id: spawnId
	}));
	console.log('Spawn:', x);

	spawns[spawnId] = res;

	console.log("Starting signal-cli link command");

	// client.on('data', (data) => {
	// 	if(isStringParseable(data)){
	// 		let parsedData = JSON.parse(data.toString());
	// 		if(parsedData.id === spawnId){
	// 			spawnReplied = true;
	// 			let link = parsedData.result;
	// 			index = index.toString().replace('%QRCODE_PLACEHOLDER%', link);

	// 			res.writeHead(200, { 'Content-Type': 'text/html' });
	// 			res.write(index);
	// 			res.end();
	// 			return;
	// 		}
	// 	}
	// });

	setTimeout(() => {
		if(spawns[spawnId] != null){
			res.writeHead(522, { 'Content-Type': 'text/html' });
			res.write("<div style='color:red;'>Signal Client took to long (>10s) to respond. Please try again.<br>If the issue persists, please restart the service or contact the administrator.</div>");
			return;
		}
	}, 10000);


	// const signalCli = spawn('signal-cli', ['link', '-n', '"Signal Transcriber"']);

	// signalCli.stdout.on('data', (data) => {
	// 	console.log('Signal CLI Incoming Data:', data.toString());
	// 	let link = data.toString().split('\n')[0];
	// 	index = index.toString().replace('%QRCODE_PLACEHOLDER%', link);

	// 	res.writeHead(200, { 'Content-Type': 'text/html' });
	// 	res.write(index);
	// 	res.end();
	// 	return;
	// });
});

httpServer.listen(HTTP_PORT, () => {
	console.log(`Server running at http://127.0.0.1:${HTTP_PORT}/`);
});


const startClient = () => {
	client.connect(RPC_PORT, RPC_HOST, () => {
	  	console.log('connected to server!');
	});

	client.on('error', (err) => {
		if(err.code === 'ECONNREFUSED'){
			console.log('JSON-RPC Server refused Connection. Retrying in 5 seconds...');
			setTimeout(() => {
				startClient();
			}, 5000);
		}else{
			console.log('Error:', err);
		}
	});

	client.on("end", () => {
		console.log('Connection ended. Reconnecting in 5 seconds...');
	});

	client.on("close", () => {
		console.log('Connection closed. Reconnecting in 5 seconds...');
	});

	client.on('data', (data) => {rpcHandler(data)});

	// client.on('data', (data) => {
	// 	console.log('Data:', data.toString());
	// 	if(isStringParseable(data)){
	// 		let parsedData = JSON.parse(data.toString());
	// 		let envelope = parsedData.params.envelope;
	// 		if(envelope.typingMessage || envelope.receiptMessage) return;
	// 		if(DEBUG){
	// 			fs.writeFileSync("./json_dump/" + envelope.sourceName + " - " + envelope.timestamp + '.json', JSON.stringify(parsedData, null, 4));
	// 		}
	// 		try{
	// 			if(envelope.syncMessage && envelope.syncMessage.sentMessage && envelope.syncMessage.sentMessage.attachments.length > 0){
	// 				envelope.syncMessage.sentMessage.attachments.forEach((attachment) => {
	// 					if(attachment.contentType === 'audio/aac'){
	// 						console.log('Audio Attachment:', attachment.id);
	// 						sendToWhisperService(parsedData.params.account, envelope.sourceName, attachment.id)
	// 					}
	// 				});
	// 			}

	// 			if(envelope.dataMessage && envelope.dataMessage.attachments && envelope.dataMessage.attachments.length > 0){
	// 				envelope.dataMessage.attachments.forEach((attachment) => {
	// 					if(attachment.contentType === 'audio/aac'){
	// 						console.log('Audio Attachment:', attachment.id);
	// 						sendToWhisperService(parsedData.params.account, envelope.sourceName, attachment.id)
	// 					}
	// 				});
	// 			}

	// 		}catch(e){
	// 			console.log('Error', e);
	// 		}
	// 	}
	// });
}


const sendToWhisperService = (account, sender, attachmentId) => {
	// copy audio file from /root/.local/share/signal-cli/attachments/ to /shared/
	// connect to whispers websocket and send the filepath
	// on success, delete the file from /shared/ and /root/.local/share/signal-cli/attachments/

	console.log('Sending to Whisper Service:', attachmentId, sender, account);

	// Change this to json-rpc instead of spawn
	// const msg = spawn('signal-cli', ['send', '--note-to-self', '-m', `"${sender} Received Voicenote ${attachmentId} starting transcription"`, `"${account}"`]);

	// Send message over JSON-RPC
	send(JSON.stringify({
		jsonrpc: '2.0',
		method: 'send',
		params: {
			noteToSelf: true,
			account: account,
			message: `Received Voicenote ${attachmentId} by ${sender} starting transcription`
		},
		id: messageId++
	}));
	
	// fs.copyFileSync(ATTACHMENTDIR + attachmentId, SHAREDIR + attachmentId);

	let whisperClient = new WebSocket(WHISPER_SERVICE_URL);

	whisperClient.on('open', () => {
		whisperClient.send("transcribe " + SHAREDIR + attachmentId);
	});

	whisperClient.on('message', (data) => {

		let message = data.toString();

		console.log('Transcription:', message);
		fs.unlinkSync(SHAREDIR + attachmentId);
		// fs.unlinkSync(ATTACHMENTDIR + attachmentId);
		// spawn('signal-cli', ['send', '--note-to-self', '-m', `"${message}"`, account]);

		send(JSON.stringify({
			jsonrpc: '2.0',
			method: 'send',
			params: {
				noteToSelf: true,
				account: account,
				message: `Transcribed Message: ${message}`
			},
			id: messageId++
		}));

		whisperClient.close();
	});

}

const isStringParseable = (str) => {
	try {
		JSON.parse(str);
	} catch (e) {
		return false;
	}
	return true;
}



const rpcHandler = (data) => {
	let dataToString = data.toString();
	console.log('Data:', dataToString);
	if(isStringParseable(data)){
		let parsedData = JSON.parse(dataToString);

		if(handledIds.includes(parsedData.id)) return;
		handledIds.push(parsedData.id);

		if(spawns[parsedData.id] != null){
			let res = spawns[parsedData.id];
			let link = parsedData.result.deviceLinkUri;

			send(JSON.stringify({
				jsonrpc: '2.0',
				method: 'finishLink',
				params: {
					deviceLinkUri: link,
				},
				id: messageId++
			}))

			index = index.toString().replace('%QRCODE_PLACEHOLDER%', link);

			res.writeHead(200, { 'Content-Type': 'text/html' });
			res.write(index);
			res.end();
			delete spawns[parsedData.id];
			return;
		}

		if(parsedData.params == null || parsedData.params.envelope == null) return;
		let envelope = parsedData.params.envelope;
		if(envelope.typingMessage || envelope.receiptMessage) return;
		if(DEBUG){
			fs.writeFileSync("./json_dump/" + envelope.sourceName + " - " + envelope.timestamp + '.json', JSON.stringify(parsedData, null, 4));
		}
		try{
			if(envelope.syncMessage && 
				envelope.syncMessage.sentMessage && 
				envelope.syncMessage.sentMessage.attachments &&
				envelope.syncMessage.sentMessage.attachments.length > 0){
				envelope.syncMessage.sentMessage.attachments.forEach((attachment) => {
					if(attachment.contentType === 'audio/aac'){
						console.log('Audio Attachment:', attachment.id);
						sendToWhisperService(parsedData.params.account, envelope.sourceName, attachment.id)
					}
				});
			}

			if(envelope.dataMessage && 
				envelope.dataMessage.attachments && 
				envelope.dataMessage.attachments.length > 0){
				envelope.dataMessage.attachments.forEach((attachment) => {
					if(attachment.contentType === 'audio/aac'){
						console.log('Audio Attachment:', attachment.id);
						sendToWhisperService(parsedData.params.account, envelope.sourceName, attachment.id)
					}
				});
			}

		}catch(e){
			console.log('Error', e);
		}
	}
}


const send = (data) => {
	client.write(data + '\n');
}



startClient();