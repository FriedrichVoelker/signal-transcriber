FROM debian:bookworm-slim

USER root
WORKDIR /app

# Install dependencies
RUN apt-get update && apt-get install -y \
	ffmpeg \
	python3-full \
	python3-pip \
	python3-setuptools-rust \
	python3-websockets \
	git \
	&& rm -rf /var/lib/apt/lists/*

# Create a virtual environment and activate it
RUN python3 -m venv /opt/venv

# Install whisper
COPY . /app

RUN /opt/venv/bin/pip install git+https://github.com/openai/whisper.git 

CMD ["/opt/venv/bin/python", "whisper.py"]