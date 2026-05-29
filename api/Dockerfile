FROM node:20-alpine

RUN apk add --no-cache bash openssh-client ffmpeg
RUN mkdir -p /app/data/campaign-bot-audio

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN chmod +x entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["./entrypoint.sh"]
