FROM python:3.9.9

WORKDIR /app
USER root

# Install dependencies
RUN apt-get update && apt-get install -y \
	ffmpeg \
	&& rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements.txt
RUN pip3 install -r requirements.txt

COPY . .
RUN mkdir /signalshare

CMD ["python3", "main.py"]

