FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Default: Docker-internal API URL (overridden by setup.sh for cloud mode)
ARG PBX_URL=http://api:3000
ARG WORKFLOW_URL=http://workflow-engine:3002
ARG ASTRADIAL_MODE=selfhosted
ENV NEXT_PUBLIC_PBX_URL=$PBX_URL
ENV NEXT_PUBLIC_WORKFLOW_URL=$WORKFLOW_URL
ENV NEXT_PUBLIC_GATEWAY_URL=$PBX_URL
ENV NEXT_PUBLIC_ASTRADIAL_MODE=$ASTRADIAL_MODE

RUN npm run build

EXPOSE 3001

ENV PORT=3001
CMD ["npm", "start"]
