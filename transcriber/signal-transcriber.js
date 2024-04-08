#!/usr/bin/env node

const net = require('net');
const fs = require('fs');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const WebSocket = require('ws');


const RPC_PORT = process.env.RPC_PORT || 7583;
const HTTP_PORT = process.env.HTTP_PORT || 8080;
const DEBUG = process.env.DEBUG || false;
const WHISPER_SERVICE_URL = process.env.WHISPER_SERVICE_URL || 'http://whisper:8765/';

// Start Signal CLI deamon in multi-device mode with open tcp socket on port RPC_PORT
// wait for signal-cli to start before starting the HTTP server. when started it will return a line like INFO  SocketHandler - Started JSON-RPC server on /127.0.0.1
//const signalCli = spawn('signal-cli', [ 'daemon', '--tcp'], {
//	env: process.env,
//	cwd: process.cwd(),
//	uid: process.getuid(),
//	gid: process.getgid()
//});

//signalCli.stderr.on('data', (data) => {
//	console.error('Signal CLI Error:', data.toString());
//});

//signalCli.stdout.on('data', (data) => {
//	console.log('Signal CLI Incoming Data:', data.toString());
//	if (data.toString().includes('Started JSON-RPC server')) {
//		console.log('Signal CLI started');
		
//	}
//});





// Start HTTP Server to listen for incoming connections
const httpServer = http.createServer((req, res) => {
	console.log('Request:', req.url);
	if (req.url === '/favicon.ico') return;
	let index = fs.readFileSync('./index.html');
	if(index != null) console.log('Index file loaded');
	const signalCli = spawn('signal-cli', ['link', '-n', '"Signal Transcriber"']);
	console.log("Starting signal-cli link command");

	signalCli.stdout.on('data', (data) => {
		console.log('Signal CLI Incoming Data:', data.toString());
		let link = data.toString().split('\n')[0];
		index = index.toString().replace('%QRCODE_PLACEHOLDER%', link);

		res.writeHead(200, { 'Content-Type': 'text/html' });
		res.write(index);
		res.end();
		return;
	});
});

httpServer.listen(HTTP_PORT, () => {
	console.log(`Server running at http://127.0.0.1:${HTTP_PORT}/`);
});


const startClient = () => {
	const client = net.createConnection({ host: "127.0.0.1", port: RPC_PORT }, () => {
	  console.log('connected to server!');
	});

	client.on('error', (err) => {
		console.log('Error:', err);
		setTimeout(() => {
			startClient();
		}, 5000);
	});

	client.on('data', (data) => {
		if(isStringParseable(data)){
			let parsedData = JSON.parse(data.toString());
			let envelope = parsedData.params.envelope;
			if(envelope.typingMessage || envelope.receiptMessage) return;
			if(DEBUG){
				fs.writeFileSync("./json_dump/" + envelope.sourceName + " - " + envelope.timestamp + '.json', JSON.stringify(parsedData, null, 4));
			}
			try{
				if(envelope.syncMessage && envelope.syncMessage.sentMessage && envelope.syncMessage.sentMessage.attachments.length > 0){
					envelope.syncMessage.sentMessage.attachments.forEach((attachment) => {
						if(attachment.contentType === 'audio/aac'){
							console.log('Audio Attachment:', attachment.id);
							sendToWhisperService(parsedData.params.account, envelope.sourceName, attachment.id)
						}
					});
				}

				if(envelope.dataMessage && envelope.dataMessage.attachments && envelope.dataMessage.attachments.length > 0){
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
	});
}

startClient();


const sendToWhisperService = (account, filename, attachmentId) => {
	// copy audio file from ~/.local/share/signal-cli/attachments/ to /shared/
	// connect to whispers websocket and send the filepath
	// on success, delete the file from /shared/ and .local/share/signal-cli/attachments/

	//spawnSync('cp', [`/root/.local/share/signal-cli/attachments/${attachmentId}`, '/signalshare/' + attachmentId]);
	console.log('Sending to Whisper Service:', attachmentId, filename, account);

	// Change this to json-rpc instead of spawn
	const msg = spawn('signal-cli', ['send', '--note-to-self', '-m', `"${filename} Received Voicenote ${attachmentId} starting transcription"`, `"${account}"`]);
	msg.stderr.on('data', (data) => {
		console.log('Error:', data.toString());
	});
	msg.stdout.on('data', (data) => {
		console.log('Message Sent:', data.toString());
	});
	
	fs.copyFileSync(`/root/.local/share/signal-cli/attachments/${attachmentId}`, '/signalshare/' + attachmentId);

	let whisperClient = new WebSocket(WHISPER_SERVICE_URL);

	whisperClient.on('open', () => {
		whisperClient.send("transcribe /signalshare/" + attachmentId);
	});

	whisperClient.on('message', (data) => {

		const message = data.toString();

		console.log('Transcription:', message);
		fs.unlinkSync('/signalshare/' + attachmentId);
		fs.unlinkSync('/root/.local/share/signal-cli/attachments/' + attachmentId);
		spawn('signal-cli', ['send', '--note-to-self', '-m', `"${message}"`, account]);
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
