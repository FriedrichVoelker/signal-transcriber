#!/usr/bin/env python

import sys
import os
import asyncio
from websockets import serve
import whisper

WHISPER_MODEL = os.getenv("WHISPER_MODEL", "medium")
SOCKET_PORT = os.getenv("SOCKET_PORT", 8765)


async def serveSocket(websocket, path):
	while True:
		message = await websocket.recv()
		# if messages starts with transcribe
		if message.startswith("transcribe"):
			# get the audio file url
			audio_url = message.split(" ")[1]

			# download the audio file
			model = whisper.load_model(WHISPER_MODEL)
			result = model.transcribe(audio_url)

			await websocket.send(result["text"])


async def main():
	async with serve(serveSocket, "localhost", SOCKET_PORT):
		print(f"Server started at ws://localhost:{SOCKET_PORT}")
		await asyncio.Future()  # run forever

if __name__ == "__main__":
	asyncio.run(main())