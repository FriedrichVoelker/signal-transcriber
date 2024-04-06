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
spawn('signal-cli', ['daemon', '--tcp', RPC_PORT]).then(() => {
	console.log('Signal Daemon started');
	startClient();
});


// Start HTTP Server to listen for incoming connections
const httpServer = http.createServer((req, res) => {
	console.log('Request:', req.url);
	if (req.url === '/favicon.ico') return;
	let index = fs.readFileSync('./index.html');

	const signalCli = spawn('signal-cli', ['link', '-n', '"Signal Transcriber"']);

	signalCli.stdout.on('data', (data) => {
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
	const client = net.createConnection({ port: RPC_PORT }, () => {
	  console.log('connected to server!');
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
							sendToWhisperService(parsedData.params.account, envelope.sourceName + ' - ' + envelope.timestamp, attachment.id)
						}
					});
				}

				if(envelope.dataMessage && envelope.dataMessage.attachments && envelope.dataMessage.attachments.length > 0){
					envelope.dataMessage.attachments.forEach((attachment) => {
						if(attachment.contentType === 'audio/aac'){
							console.log('Audio Attachment:', attachment.id);
							sendToWhisperService(parsedData.params.account, envelope.sourceName + ' - ' + envelope.timestamp, attachment.id)
						}
					});
				}

			}catch(e){
				console.log('Error', e);
			}
		}
	});
}


const sendToWhisperService = (account, filename, attachmentId) => {
	// copy audio file from ~/.local/share/signal-cli/attachments/ to /shared/
	// connect to whispers websocket and send the filepath
	// on success, delete the file from /shared/ and .local/share/signal-cli/attachments/

	spawnSync('cp', [`~/.local/share/signal-cli/attachments/${attachmentId}`, '/shared/' + attachmentId]);
	let whisperClient = new WebSocket(WHISPER_SERVICE_URL);

	whisperClient.on('open', () => {
		whisperClient.send("transcribe /shared/" + attachmentId);
	});

	whisperClient.on('message', (data) => {

		//const message =

		console.log('Transcription:', data);
		fs.unlinkSync('/shared/' + attachmentId);
		fs.unlinkSync('~/.local/share/signal-cli/attachments/' + attachmentId);
		spawn('signal-cli', ['send', '--note-to-self', '-m', `"${data}"`, account]);
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