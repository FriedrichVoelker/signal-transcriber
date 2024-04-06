FROM debian:bookworm-slim

ARG SIGNAL_CLI_VERSION=0.13.2

USER root

WORKDIR /app

# Install dependencies
RUN apt-get update && apt-get install -y \
	node \
	openjdk-21-jre-headless \
	openjdk-21-jdk-headless \
	libc6 \
	wget \
	&& rm -rf /var/lib/apt/lists/*

# Install signal-cli

RUN export VERSION=${SIGNAL_CLI_VERSION} \	
	&& wget https://github.com/AsamK/signal-cli/releases/download/v"${VERSION}"/signal-cli-"${VERSION}".tar.gz \
	&& tar xf signal-cli-"${VERSION}".tar.gz -C /opt \
	&& ln -sf /opt/signal-cli-"${VERSION}"/bin/signal-cli /usr/local/bin/ 

COPY . /app

RUN npm install 

CMD ["node", "signal-transcriber.js"]