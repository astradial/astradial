FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Default: Docker-internal API URL (overridden by setup.sh for cloud mode)
ARG PBX_URL=http://api:3000
ARG WORKFLOW_URL=http://workflow-engine:3002
ARG GATEWAY_URL=http://pipecat-flow:7860
ARG ASTRADIAL_MODE=selfhosted
# Auth provider — bake into the static bundle at build time.
# 'false' (default) → OssLoginForm renders, login is api_key + api_secret.
# 'true' → Firebase login UI, requires NEXT_PUBLIC_FIREBASE_* env vars.
ARG NEXT_PUBLIC_USE_FIREBASE=false
ENV NEXT_PUBLIC_PBX_URL=$PBX_URL
ENV NEXT_PUBLIC_WORKFLOW_URL=$WORKFLOW_URL
ENV NEXT_PUBLIC_GATEWAY_URL=$GATEWAY_URL
ENV NEXT_PUBLIC_ASTRADIAL_MODE=$ASTRADIAL_MODE
ENV NEXT_PUBLIC_USE_FIREBASE=$NEXT_PUBLIC_USE_FIREBASE

RUN NODE_OPTIONS="--max-old-space-size=4096" npm run build

EXPOSE 3001

ENV PORT=3001
CMD ["npm", "start"]
