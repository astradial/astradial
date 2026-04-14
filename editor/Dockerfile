FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Build with the Docker-internal API URL
ENV NEXT_PUBLIC_PBX_URL=http://api:3000
ENV NEXT_PUBLIC_WORKFLOW_URL=http://workflow-engine:3002
ENV NEXT_PUBLIC_GATEWAY_URL=http://api:3000

RUN npm run build

EXPOSE 3001

ENV PORT=3001
CMD ["npm", "start"]
