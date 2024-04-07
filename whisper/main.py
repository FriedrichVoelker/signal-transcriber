import sys
import os
import asyncio
from websockets import serve
import whisper

WHISPER_MODEL = os.getenv("WHISPER_MODEL", "medium")
print(f"Using model: {WHISPER_MODEL}")
# set the model to use
model = whisper.load_model(WHISPER_MODEL)


async def serveSocket(websocket, path):
	try:
		async for message in websocket:
			# if messages starts with transcribe
			if message.startswith("transcribe"):
				# get the audio file url
				audio_url = message.split(" ")[1]

				# ignore the warning message and keep the process running
				#sys.stderr = open(os.devnull, "w")
				result = model.transcribe(audio_url)
				print(result["text"])
				await websocket.send(result["text"])
	except Exception as e:
		print(f"Connection lost: {e}")
	except Exception as e:
		print(f"An error occurred: {e}")



async def main():

	SOCKET_PORT = os.getenv("SOCKET_PORT") if os.getenv("SOCKET_PORT") else 8765

	async with serve(serveSocket, "0.0.0.0", SOCKET_PORT):
		print(f"Server started at ws://0.0.0.0:{SOCKET_PORT}")
		await asyncio.Future()  # run forever

asyncio.run(main())