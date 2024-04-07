FROM python:3.9.9

WORKDIR /app
USER root

# Install dependencies
RUN apt-get update && apt-get install -y \
	ffmpeg \
	git \
	curl \
	cmake \
	make \
	&& rm -rf /var/lib/apt/lists/*

# Install rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
RUN export PATH="$HOME/.cargo/bin:$PATH"

COPY . .

RUN pip3 install torch==1.10.1 torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu

RUN pip3 install -r requirements.txt
RUN pip3 install tiktoken
RUN pip3 install git+https://github.com/openai/whisper.git 

RUN mkdir /signalshare

CMD ["python3", "main.py"]

