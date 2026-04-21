const net = require('net');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');

const { isStringParseable, log } = require('./helpers.js');

// Environment Variables
const RPC_PORT = process.env.RPC_PORT || 7583;
const HTTP_PORT = process.env.HTTP_PORT || 8080;
const WHISPER_SERVICE_URL = process.env.WHISPER_SERVICE_URL || 'ws://whisper:8765/';
const RPC_HOST = process.env.RPC_HOST || 'signal';
const APPLICATION_NAME = process.env.APPLICATION_NAME || 'Signal Transcriber';
const NOTIFY_SELF = process.env.NOTIFY_SELF  === "true" || false;
const TRANSRCIBE_OWN_MESSAGES = process.env.TRANSRCIBE_OWN_MESSAGES === "true" || false;
const TRANSCRIPTION_MODE = process.env.TRANSCRIPTION_MODE || 'private'; // 'private' = Note to Self, 'inline' = reply in thread

// Constants
const SHAREDIR = "/signalshare/";

// Create a new Socket
const client = new net.Socket();
// Whetver the client is connected or not
let isConnected = false


// Message ID for JSON-RPC requests
let messageId = 1;

// Array to store the spawned RPC Requests for adding new devices
let spawns = [];
let finished = [];
// Array to store the handled IDs to prevent double handling
let handledIds = [];

// Load the index.html
let index = fs.readFileSync('./index.html');

// Start HTTP Server to listen for incoming connections
const httpServer = http.createServer((req, res) => {
	// if request url starts with /static/ serve the static file with the corresponding name and content type
	if (req.url.startsWith('/static/')) {
		let file = req.url.replace('/static/', '');
		let contentType = 'text/html';
		if (file.endsWith('.css')) contentType = 'text/css';
		if (file.endsWith('.js')) contentType = 'text/javascript';
		if (file.endsWith('.png')) contentType = 'image/png';
		if (file.endsWith('.svg')) contentType = 'image/svg+xml';
		if (file.endsWith('.ico')) contentType = 'image/x-icon';
		fs.readFile('./static/' + file, (err, data) => {
			if (err) {
				res.writeHead(404, { 'Content-Type': 'text/html' });
				return res.end("404 Not Found");
			}
			res.writeHead(200, { 'Content-Type': contentType });
			res.write(data);
			return res.end();
		});
		return;
	}

	// Check if the Signal Client is ready, if not returns 412
	if(client == null) {
		log("Signal Client not yet connected. Please try again later.", "ERROR")
		res.writeHead(412, { 'Content-Type': 'text/html' });
		res.write("<div style='color:red;'>Signal Client not yet connected. Please try again later.</div>");
		return;
	}

	// Set the message ID for the startLink command and increment messageId
	let spawnId = messageId++;

	// Send startLink to start provisioning a new device
	sendRPC('startLink', { name: APPLICATION_NAME }, spawnId);
	// Store the message ID and the response object in the spawns array
	spawns[spawnId] = res;
	log("Starting signal-cli link command", "DEBUG");

	// Set a timeout of 10 seconds to prevent hanging requests
	setTimeout(() => {
		// If the spawnId is still in the spawns array, the Signal Client took to long to respond
		if(spawns[spawnId] != null){
			// Send a 522 status code and a message to the client
			log("Signal Client took to long to respond", "ERROR");
			res.writeHead(522, { 'Content-Type': 'text/html' });
			res.write("<div style='color:red;'>Signal Client took to long (>10s) to respond. Please try again.<br>If the issue persists, please restart the service or contact the administrator.</div>");
			// Delete the spawnId from the spawns array
			delete spawns[spawnId];
			return;
		}
	}, 10000);
});

// Start the HTTP Server
httpServer.listen(HTTP_PORT, () => {
	log(`Server running at http://127.0.0.1:${HTTP_PORT}/`, "INFO");
});

// Start the RPC Client and connect to the Signal Client
const startClient = () => {

	if(isConnected) return;

	client.connect(RPC_PORT, RPC_HOST, () => {
		log('Connected to Signal Client', "INFO");
		isConnected = true
		// Load contacts and groups on startup
		sendRPC('listAccounts', {});
	});

	// Error Handling
	// If the Signal Client refuses the connection, retry every 5 seconds
	client.on('error', (err) => {
		isConnected = false
		if(err.code === 'ECONNREFUSED'){
			log('JSON-RPC Server refused Connection. Retrying in 5 seconds...', "DEBUG")
			setTimeout(() => {
				startClient();
			}, 5000);
		}else{
			log(err, "ERROR");
		}
	});

	// If the Signal Client ends the connection, reconnect every 5 seconds
	client.on("end", () => {
		isConnected = false
		log('Connection ended. Retrying in 5 seconds...', "ERROR")
		setTimeout(() => {
			startClient();
		}, 5000);
	});

	// If the Signal Client closes the connection, reconnect every 5 seconds
	client.on("close", () => {
		isConnected = false
		log('Connection closed. Retrying in 5 seconds...', "ERROR")
		setTimeout(() => {
			startClient();
		}, 5000);
	});
	
	// Handle incoming data from the Signal Client with line buffering
	let rpcBuffer = '';
	client.on('data', (data) => {
		rpcBuffer += data.toString();
		let lines = rpcBuffer.split('\n');
		// Keep the last incomplete line in the buffer
		rpcBuffer = lines.pop();
		lines.forEach((line) => {
			if (line.trim()) rpcHandler(Buffer.from(line));
		});
	});
}

// Contact and group name lookup cache
let contactMap = {}; // uuid/number -> name
let groupMap = {};   // groupId -> name

const loadContactsAndGroups = (account) => {
	// Load contacts (stagger requests to avoid TCP chunk merging)
	sendRPC('listContacts', { account: account });
	setTimeout(() => sendRPC('listGroups', { account: account }), 1000);
};

const resolveContactName = (identifier) => {
	if (!identifier) return null;
	return contactMap[identifier] || null;
};

const resolveGroupName = (groupId) => {
	if (!groupId) return null;
	return groupMap[groupId] || null;
};

const sendToWhisperService = (account, sender, attachmentId, recipient, direction, groupInfo) => {
	// connect to whispers websocket and send the filepath
	// on success, delete the file from /shared/ to free up space
	// direction: 'sent' = I sent this, 'received' = someone sent it to me

	log(`Received Voicenote ${attachmentId} by ${sender}. Starting transcription for ${account}`, "DEBUG");

	// Build the send params based on TRANSCRIPTION_MODE
	const buildSendParams = (message) => {
		if (TRANSCRIPTION_MODE === 'inline' && recipient && recipient !== account) {
			// Inline mode: send transcription in the same thread (other person sees it)
			return { recipient: recipient, account: account, message: message, notifySelf: NOTIFY_SELF };
		}
		// Private mode: always send to Note to Self
		return { noteToSelf: true, account: account, message: message, notifySelf: NOTIFY_SELF };
	};

	// Format message with context
	const formatMessage = (text) => {
		if (TRANSCRIPTION_MODE === 'private' && recipient && recipient !== account) {
			let recipientName = resolveContactName(recipient) || recipient;
			let groupName = groupInfo ? (resolveGroupName(groupInfo) || 'group') : null;
			if (direction === 'sent') {
				let dest = groupName ? groupName : recipientName;
				return `[Voice to ${dest}]: ${text}`;
			}
			let prefix = `[Voice from ${sender}]`;
			if (groupName) prefix = `[Voice from ${sender} in ${groupName}]`;
			return `${prefix}: ${text}`;
		}
		return text;
	};

	// Send notification
	sendRPC("send", buildSendParams(formatMessage(`Transcribing...`)))

	let whisperClient = new WebSocket(WHISPER_SERVICE_URL);

	whisperClient.on('open', () => {
		// Send the attachmentId to the whisper service
		whisperClient.send("transcribe " + SHAREDIR + attachmentId);
	});

	whisperClient.on('message', (data) => {

		// Get the message from the whisper service and send it to the Signal Client
		let message = data.toString();
		log(`Transcription for ${attachmentId} by ${sender} finished. Message: ${message}`, "DEBUG");
		fs.unlinkSync(SHAREDIR + attachmentId);

		// Send transcription
		sendRPC("send", buildSendParams(formatMessage(message)))

		// Close the connection to the whisper service
		whisperClient.close();
	});

}



// Handle incoming data from the Signal Client
/**
 * 
 * @param {Buffer} data - Incoming data from the Signal Client
 * */
const rpcHandler = (data) => {
	// Convert the data to a string
	let dataToString = data.toString();
	// If the data is parseable to JSON
	if(isStringParseable(data)){
		log('RECEIVED: ' + dataToString, "DEBUG");
		// Parse the data
		let parsedData = JSON.parse(dataToString);
		// Check if the parsed data has already been handled
		if(parsedData.id != null && handledIds.includes(parsedData.id)) return;
		// If the parsed data has an ID, add it to the handledIds array
		handledIds.push(parsedData.id);

		// If the parsed data is in response to a startLink command
		if(spawns[parsedData.id] != null){
			// Get the HTTPResponse and the deviceLinkUri
			let res = spawns[parsedData.id];
			if(parsedData.error || !parsedData.result){
				log('ERROR', `Link request failed: ${parsedData.error ? parsedData.error.message : 'no result'}`);
				res.writeHead(500, { 'Content-Type': 'text/plain' });
				res.write('Link request failed. Please try again.');
				res.end();
				delete spawns[parsedData.id];
				return;
			}
			let link = parsedData.result.deviceLinkUri;

			let finishedId = messageId++;

			finished.push(finishedId);

			// Send finishLink to finish the provisioning of the new device
			sendRPC('finishLink', { deviceLinkUri: link, deviceName: APPLICATION_NAME}, finishedId);

			// Replace the %QRCODE_PLACEHOLDER% in the index.html with the deviceLinkUri
			index = index.toString().replace('%QRCODE_PLACEHOLDER%', link);
			// Write the index.html to the response
			res.writeHead(200, { 'Content-Type': 'text/html' });
			res.write(index);
			res.end();
			// Delete the spawnId from the spawns array
			delete spawns[parsedData.id];
			return;
		}

		// If the parsed data is a response to a finishLink command
		if(finished[parsedData.id] != null) {

			// parsedData should look like this:
			// {"jsonrpc":"2.0","result":{"number":"+0123456789"},"id":2}

			// Send subscribeReceive to subscribe to incoming messages
			sendRPC('subscribeReceive', { account: parsedData.result.number });
			// Load contacts and groups for name resolution
			loadContactsAndGroups(parsedData.result.number);

			// Delete the finishedId from the finished array
			delete finished[parsedData.id];
			return;
		}

		// Handle listAccounts response - load contacts/groups for each account
		if(parsedData.result && Array.isArray(parsedData.result) && parsedData.result[0] && parsedData.result[0].number !== undefined && !parsedData.result[0].profileSharing && !parsedData.result[0].members) {
			// Distinguish from contacts: accounts only have 'number', not 'profileSharing' or 'members'
			if (Object.keys(parsedData.result[0]).length <= 2) {
				parsedData.result.forEach((acct) => {
					if (acct.number) loadContactsAndGroups(acct.number);
				});
				return;
			}
		}

		// Handle listContacts response - populate contact name cache
		if(parsedData.result && Array.isArray(parsedData.result) && parsedData.result[0] && parsedData.result[0].number !== undefined && parsedData.result[0].profileSharing !== undefined) {
			parsedData.result.forEach((contact) => {
				let name = contact.name || (contact.profile && (contact.profile.givenName || '') + ' ' + (contact.profile.familyName || '')).trim() || null;
				if (name && contact.uuid) contactMap[contact.uuid] = name;
				if (name && contact.number) contactMap[contact.number] = name;
			});
			log(`Loaded ${Object.keys(contactMap).length} contacts into cache`, "DEBUG");
			return;
		}

		// Handle listGroups response - populate group name cache
		if(parsedData.result && Array.isArray(parsedData.result) && parsedData.result[0] && parsedData.result[0].id !== undefined && parsedData.result[0].members !== undefined) {
			parsedData.result.forEach((group) => {
				if (group.name && group.id) groupMap[group.id] = group.name;
			});
			log(`Loaded ${Object.keys(groupMap).length} groups into cache`, "DEBUG");
			return;
		}

		// Check if the parsed data has the params and envelope object
		if(parsedData.params == null || parsedData.params.envelope == null) return;
		let envelope = parsedData.params.envelope;
		if(envelope.typingMessage || envelope.receiptMessage) return;
		try{

			// {"jsonrpc":"2.0","method":"receive","params":{"envelope":{"source":"+0123456789","sourceNumber":"+0123456789","sourceUuid":"48503b18-249c-4ed6-8ea3-44400bd526f4","sourceName":"Me","sourceDevice":1,"timestamp":1712657587316,"syncMessage":{"sentMessage":{"destination":"+0123456789","destinationNumber":"+0123456789","destinationUuid":"48503b18-249c-4ed6-8ea3-44400bd526f4","timestamp":1712657587316,"message":null,"expiresInSeconds":0,"viewOnce":false,"attachments":[{"contentType":"audio/aac","filename":null,"id":"p2aZ-rLtF5kFC2c1zuzo.aac","size":11956,"width":null,"height":null,"caption":null,"uploadTimestamp":1712657587723}]}}},"account":"+0123456789"}}

			// If the envelope is sent by the own account and TRANSRCIBE_OWN_MESSAGES is enabled, check if the message has an audio attachment
			if(TRANSRCIBE_OWN_MESSAGES && envelope.syncMessage &&
				envelope.syncMessage.sentMessage &&
				envelope.syncMessage.sentMessage.attachments &&
				envelope.syncMessage.sentMessage.attachments.length > 0){
				let sentMsg = envelope.syncMessage.sentMessage;
				let destination = sentMsg.destinationUuid || sentMsg.destination;
				let groupId = sentMsg.groupInfo && sentMsg.groupInfo.groupId || null;
				envelope.syncMessage.sentMessage.attachments.forEach((attachment) => {
					if(attachment.contentType.startsWith('audio/')){
						log(`Found Audio Attachment ${attachment.id} by ${envelope.sourceName}. Starting transcription for ${parsedData.params.account}`, "DEBUG")
						sendToWhisperService(parsedData.params.account, envelope.sourceName, attachment.id, destination, 'sent', groupId)
					}
				});
			}

			// If the envelope is sent by another account, check if the message has an audio attachment
			if(envelope.dataMessage &&
				envelope.dataMessage.attachments &&
				envelope.dataMessage.attachments.length > 0){
				let groupId = envelope.dataMessage.groupInfo && envelope.dataMessage.groupInfo.groupId || null;
				envelope.dataMessage.attachments.forEach((attachment) => {
					if(attachment.contentType.startsWith('audio/')){
						log(`Found Audio Attachment ${attachment.id} by ${envelope.sourceName}. Starting transcription for ${parsedData.params.account}`, "DEBUG")
						sendToWhisperService(parsedData.params.account, envelope.sourceName, attachment.id, envelope.sourceNumber || envelope.sourceUuid, 'received', groupId)
					}
				});
			}

		}catch(e){
			// If an error occurs, log the error
			log(e, "ERROR")
		}
	}
}

// Send a JSON-RPC Request to the Signal Client
/**
 * 
 * @param {String} method - JSON-RPC Method
 * @param {Object} params - JSON-RPC Params
 * @param {String|Number} id - JSON-RPC Message ID
 */
const sendRPC = (method, params = null, id = messageId++) => {
	// The Signal Client expects a Stringified JSON Object with a newline at the end

	let rpc_message = JSON.stringify({
		jsonrpc: '2.0',
		method: method,
		params: params,
		id: id
	})
	log('SENT: ' + rpc_message, "DEBUG");
	client.write(rpc_message + '\n');
}

// Start the RPC Client
startClient();