FROM debian:bookworm

ARG SIGNAL_CLI_VERSION=0.13.2
USER root
WORKDIR /app

# Install dependencies
RUN apt-get update && apt-get install -y \
	nodejs \
	npm \
	libc6 \
	wget \
	curl \
	&& rm -rf /var/lib/apt/lists/*

# Install openjdk-21
# Check architecture and download corresponding Java
RUN if [ "$(uname -m)" = "x86_64" ]; then \
        wget -O jdk-21_linux_bin.tar.gz https://download.oracle.com/java/21/latest/jdk-21_linux-x64_bin.tar.gz; \
    elif [ "$(uname -m)" = "aarch64" ]; then \
        wget -O jdk-21_linux_bin.tar.gz https://download.oracle.com/java/21/latest/jdk-21_linux-aarch64_bin.tar.gz; \
    fi
    
# Extract and set up Java
RUN tar -xvf jdk-21_linux_bin.tar.gz -C /opt \
    && ln -sf /opt/jdk-21.0.2/bin/java /usr/local/bin/ \
    && ln -sf /opt/jdk-21.0.2/bin/javac /usr/local/bin/

ENV JAVA_HOME=/opt/jdk-21.0.2

# Install rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
RUN export PATH="$HOME/.cargo/bin:$PATH"

# Install libsignal-client


# Install signal-cli
RUN export VERSION=${SIGNAL_CLI_VERSION} \	
	&& wget https://github.com/AsamK/signal-cli/releases/download/v"${VERSION}"/signal-cli-"${VERSION}".tar.gz \
	&& tar xf signal-cli-"${VERSION}".tar.gz -C /opt \
	&& ln -sf /opt/signal-cli-"${VERSION}"/bin/signal-cli /usr/local/bin/ 
#RUN wget https://media.projektzentrisch.de/temp/signal-cli/signal-cli0132_ubuntu2004_arm64.gz \
#	&& gunzip signal-cli0132_ubuntu2004_arm64.gz \
#	&& mv signal-cli0132_ubuntu2004_arm64 /usr/local/bin/signal-cli \
#	&& chmod +x /usr/local/bin/signal-cli


RUN mkdir /signalshare

COPY . /app

RUN npm install 

# Start the signal-cli daemon and keep it running in the background
#RUN signal-cli daemon --tcp 0.0.0.0:${RPC_PORT} &
RUN chmod +x run.sh
CMD ["bash", "./run.sh"]
