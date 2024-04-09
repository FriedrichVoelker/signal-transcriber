FROM node:20

USER root
WORKDIR /app

RUN mkdir /signalshare

COPY package*.json ./

RUN npm install 

COPY . .

CMD ["node", "index.js"]
