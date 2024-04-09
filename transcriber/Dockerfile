FROM node:20

USER root
WORKDIR /app
#RUN wget https://media.projektzentrisch.de/temp/signal-cli/signal-cli0132_ubuntu2004_arm64.gz \
#	&& gunzip signal-cli0132_ubuntu2004_arm64.gz \
#	&& mv signal-cli0132_ubuntu2004_arm64 /usr/local/bin/signal-cli \
#	&& chmod +x /usr/local/bin/signal-cli


RUN mkdir /signalshare

COPY . .

RUN npm install 

# Start the signal-cli daemon and keep it running in the background
#RUN signal-cli daemon --tcp 0.0.0.0:${RPC_PORT} &
CMD ["node", "signal-transcriber.js"]
