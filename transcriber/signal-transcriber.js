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
let finished = [];

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


	setTimeout(() => {
		if(spawns[spawnId] != null){
			res.writeHead(522, { 'Content-Type': 'text/html' });
			res.write("<div style='color:red;'>Signal Client took to long (>10s) to respond. Please try again.<br>If the issue persists, please restart the service or contact the administrator.</div>");
			return;
		}
	}, 10000);
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

	client.on('data', rpcHandler);
}


const sendToWhisperService = (account, sender, attachmentId) => {
	// copy audio file from /root/.local/share/signal-cli/attachments/ to /shared/
	// connect to whispers websocket and send the filepath
	// on success, delete the file from /shared/ and /root/.local/share/signal-cli/attachments/

	console.log('Sending to Whisper Service:', attachmentId, sender, account);

	// Send message over JSON-RPC
	send(JSON.stringify({
		jsonrpc: '2.0',
		method: 'send',
		params: {
			noteToSelf: true,
			account: account,
			message: `Received Voicenote by ${sender}. Starting transcription`
		},
		id: messageId++
	}));

	let whisperClient = new WebSocket(WHISPER_SERVICE_URL);

	whisperClient.on('open', () => {
		whisperClient.send("transcribe " + SHAREDIR + attachmentId);
	});

	whisperClient.on('message', (data) => {

		let message = data.toString();

		console.log('Transcription:', message);
		fs.unlinkSync(SHAREDIR + attachmentId);

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
	console.log(dataToString);
	if(isStringParseable(data)){
		let parsedData = JSON.parse(dataToString);

		if(parsedData.id != null && handledIds.includes(parsedData.id)) return;
		handledIds.push(parsedData.id);

		if(spawns[parsedData.id] != null){
			let res = spawns[parsedData.id];
			let link = parsedData.result.deviceLinkUri;

			let finishedId = messageId++;

			finished.push(finishedId);

			send(JSON.stringify({
				jsonrpc: '2.0',
				method: 'finishLink',
				params: {
					deviceLinkUri: link,
					deviceName: APPLICATION_NAME
				},
				id: finishedId
			}))

			index = index.toString().replace('%QRCODE_PLACEHOLDER%', link);

			res.writeHead(200, { 'Content-Type': 'text/html' });
			res.write(index);
			res.end();
			delete spawns[parsedData.id];
			return;
		}

		if(finished[parsedData.id] != null) {

			// subscribeReceive
			// {"jsonrpc":"2.0","result":{"number":"+0123456789"},"id":2}

			send(JSON.stringify({
				jsonrpc: '2.0',
				method: 'subscribeReceive',
				params: {
					account: parsedData.result.number
				},
				id: messageId++
			}))

			delete finished[parsedData.id];
			return;
		}

		if(parsedData.params == null || parsedData.params.envelope == null) return;
		let envelope = parsedData.params.envelope;
		if(envelope.typingMessage || envelope.receiptMessage) return;
		if(DEBUG){
			fs.writeFileSync("./json_dump/" + envelope.sourceName + " - " + envelope.timestamp + '.json', JSON.stringify(parsedData, null, 4));
		}
		try{

			// {"jsonrpc":"2.0","method":"receive","params":{"envelope":{"source":"+0123456789","sourceNumber":"+0123456789","sourceUuid":"48503b18-249c-4ed6-8ea3-44400bd526f4","sourceName":"Me","sourceDevice":1,"timestamp":1712657587316,"syncMessage":{"sentMessage":{"destination":"+0123456789","destinationNumber":"+0123456789","destinationUuid":"48503b18-249c-4ed6-8ea3-44400bd526f4","timestamp":1712657587316,"message":null,"expiresInSeconds":0,"viewOnce":false,"attachments":[{"contentType":"audio/aac","filename":null,"id":"p2aZ-rLtF5kFC2c1zuzo.aac","size":11956,"width":null,"height":null,"caption":null,"uploadTimestamp":1712657587723}]}}},"account":"+0123456789"}}

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