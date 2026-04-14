#!/bin/bash
set -e

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║       Astradial — Quick Setup            ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Check prerequisites
command -v docker >/dev/null 2>&1 || { echo "Docker is required. Install: https://docker.com"; exit 1; }
command -v docker compose >/dev/null 2>&1 || command -v docker-compose >/dev/null 2>&1 || { echo "Docker Compose is required."; exit 1; }

# Detect OS
OS=$(uname -s)

# Create .env if not exists
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

# Prompt for admin credentials
echo "Set up your admin account:"
read -p "  Email [admin@example.com]: " ADMIN_EMAIL
ADMIN_EMAIL=${ADMIN_EMAIL:-admin@example.com}
read -p "  Password [admin]: " ADMIN_PASSWORD
ADMIN_PASSWORD=${ADMIN_PASSWORD:-admin}
read -p "  Name [Admin]: " ADMIN_NAME
ADMIN_NAME=${ADMIN_NAME:-Admin}

# Write to .env
sed -i.bak "s|ADMIN_EMAIL=.*|ADMIN_EMAIL=${ADMIN_EMAIL}|" .env
sed -i.bak "s|ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${ADMIN_PASSWORD}|" .env
sed -i.bak "s|ADMIN_NAME=.*|ADMIN_NAME=${ADMIN_NAME}|" .env
rm -f .env.bak

# Detect LAN IP
if [ "$OS" = "Darwin" ]; then
  LAN_IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | grep -v "169.254" | head -1 | awk '{print $2}')
else
  LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || ip route get 1 2>/dev/null | awk '{print $7;exit}')
fi
echo "Your LAN IP: ${LAN_IP}"

# Set SIP_HOST
grep -q "SIP_HOST" .env && sed -i.bak "s|.*SIP_HOST=.*|SIP_HOST=${LAN_IP}|" .env || echo "SIP_HOST=${LAN_IP}" >> .env
rm -f .env.bak

echo ""
echo "Starting services..."

# Build and start
docker compose up -d --build 2>&1 | grep -E "Built|Started|Created|Healthy" | tail -10

echo ""
echo "Waiting for database..."
sleep 15

echo "Waiting for API..."
for i in $(seq 1 30); do
  if curl -s http://localhost:8000/health >/dev/null 2>&1; then
    echo "API is ready!"
    break
  fi
  sleep 2
done

# Deploy Asterisk config
echo "Deploying Asterisk config..."
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/user-login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" 2>/dev/null \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))' 2>/dev/null)

if [ -n "$TOKEN" ] && [ "$TOKEN" != "" ]; then
  curl -s -X POST http://localhost:8000/api/v1/config/deploy \
    -H "Authorization: Bearer $TOKEN" >/dev/null 2>&1
  echo "Config deployed!"
else
  echo "Note: Could not auto-deploy config. Deploy manually from Settings page."
fi

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Astradial is ready!                                     ║"
echo "║                                                          ║"
echo "║  Dashboard:  http://localhost:3001                        ║"
echo "║  Email:      ${ADMIN_EMAIL}"
echo "║  Password:   ${ADMIN_PASSWORD}"
echo "║                                                          ║"
echo "║  SIP Server: ${LAN_IP}:5060                              ║"
echo "║                                                          ║"
echo "║  Next steps:                                             ║"
echo "║  1. Open http://localhost:3001                            ║"
echo "║  2. Sign in → Organisation tab                           ║"
echo "║  3. Go to Users → click extension → get SIP creds       ║"
echo "║  4. Open Zoiper on your phone → enter SIP credentials   ║"
echo "║  5. Make a call!                                         ║"
echo "║                                                          ║"
if [ "$OS" = "Darwin" ]; then
echo "║  Note: On macOS, SIP audio requires OrbStack instead    ║"
echo "║  of Docker Desktop. Get it: https://orbstack.dev        ║"
echo "║  Or test SIP on a Linux server/VM.                      ║"
fi
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
