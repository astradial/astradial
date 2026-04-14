#!/bin/bash
set -e

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║       Astradial — Quick Setup            ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Check prerequisites
command -v docker >/dev/null 2>&1 || { echo "Docker is required. Install: https://docker.com"; exit 1; }

# ── Platform detection ──
echo "Are you running on a Linux server or VPS? (y/n)"
echo ""
echo "  y = Linux/VPS — full self-hosted setup"
echo "  n = Mac/Windows — connect to Astradial Cloud"
echo ""
read -p "  Linux/VPS? [n]: " IS_LINUX
IS_LINUX=${IS_LINUX:-n}

if [ "$IS_LINUX" = "y" ] || [ "$IS_LINUX" = "Y" ]; then
  MODE="full"

  # ── Admin credentials ──
  echo ""
  echo "Set up your admin account:"
  read -p "  Email [admin@example.com]: " ADMIN_EMAIL
  ADMIN_EMAIL=${ADMIN_EMAIL:-admin@example.com}
  read -p "  Password [admin]: " ADMIN_PASSWORD
  ADMIN_PASSWORD=${ADMIN_PASSWORD:-admin}
  read -p "  Name [Admin]: " ADMIN_NAME
  ADMIN_NAME=${ADMIN_NAME:-Admin}

  SIP_HOST=$(hostname -I 2>/dev/null | awk '{print $1}' || ip route get 1 2>/dev/null | awk '{print $7;exit}' || echo "localhost")
  SIP_PORT="5060"

  # ── Write .env ──
  cat > .env << EOF
ASTRADIAL_MODE=selfhosted
DB_NAME=astradial
DB_USER=astradial
DB_PASSWORD=changeme
DB_ROOT_PASSWORD=changeme
JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || echo "change-this-secret")
INTERNAL_API_KEY=$(openssl rand -hex 16 2>/dev/null || echo "change-this-key")
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
ADMIN_NAME=${ADMIN_NAME}
ADMIN_USERNAME=admin
ADMIN_API_PASSWORD=${ADMIN_PASSWORD}
AMI_HOST=asterisk
ASTERISK_AMI_SECRET=astradial
SIP_HOST=${SIP_HOST}
SIP_PORT=${SIP_PORT}
NEXT_PUBLIC_PBX_URL=http://api:3000
NEXT_PUBLIC_WORKFLOW_URL=http://workflow-engine:3002
EOF

  echo ""
  echo "[1/5] Building Docker images... (first run takes 3-5 minutes)"
  docker compose build 2>&1 | while IFS= read -r line; do
    echo "$line" | grep -q " Built" && echo "  ✓ $(echo "$line" | sed 's/ Built//' | xargs) built"
  done
  echo "  ✓ All images built"

  echo "[2/5] Starting database..."
  docker compose up -d mariadb redis 2>&1 >/dev/null
  for i in $(seq 1 30); do
    docker compose exec mariadb mariadb -u astradial -pchangeme -e "SELECT 1" >/dev/null 2>&1 && break
    printf "\r  ⏳ Waiting... (%s/30)" "$i"; sleep 2
  done
  echo ""; echo "  ✓ Database ready"

  echo "[3/5] Starting Asterisk PBX..."
  docker compose up -d asterisk 2>&1 >/dev/null; sleep 3
  echo "  ✓ Asterisk started"

  echo "[4/5] Starting API and Dashboard..."
  docker compose up -d api editor workflow-engine 2>&1 >/dev/null
  for i in $(seq 1 30); do
    curl -s http://localhost:8000/health >/dev/null 2>&1 && break
    printf "\r  ⏳ Starting... (%s/30)" "$i"; sleep 2
  done
  echo ""; echo "  ✓ API ready"

  echo "[5/5] Finishing..."
  for i in $(seq 1 15); do
    curl -s http://localhost:3001 >/dev/null 2>&1 && break; sleep 2
  done
  echo "  ✓ Dashboard ready"

  # Deploy config
  TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/user-login \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" 2>/dev/null \
    | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
  if [ -n "$TOKEN" ] && [ "$TOKEN" != "" ]; then
    curl -s -X POST http://localhost:8000/api/v1/config/deploy -H "Authorization: Bearer $TOKEN" >/dev/null 2>&1
    echo "  ✓ Config deployed"
  fi

  echo ""
  echo "╔══════════════════════════════════════════════════════════╗"
  echo "║  Astradial is ready!                                     ║"
  echo "║                                                          ║"
  echo "║  Dashboard:  http://localhost:3001                        ║"
  echo "║  Login:      ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}"
  echo "║  SIP:        ${SIP_HOST}:${SIP_PORT}"
  echo "║                                                          ║"
  echo "║  Admin tab → create org → Users → create extension      ║"
  echo "║  → register Zoiper → make calls                          ║"
  echo "╚══════════════════════════════════════════════════════════╝"

else
  MODE="cloud"

  echo ""
  echo "Enter your Astradial Cloud server:"
  echo "(Email cats@astradial.com if you don't have credentials yet)"
  echo ""
  read -p "  API URL [https://stagepbx.astradial.com]: " PBX_URL
  PBX_URL=${PBX_URL:-https://stagepbx.astradial.com}
  read -p "  SIP host [stagesip.astradial.com]: " SIP_HOST
  SIP_HOST=${SIP_HOST:-stagesip.astradial.com}
  read -p "  SIP port [5080]: " SIP_PORT
  SIP_PORT=${SIP_PORT:-5080}

  # ── Write .env ──
  cat > .env << EOF
ASTRADIAL_MODE=cloud
NEXT_PUBLIC_PBX_URL=${PBX_URL}
SIP_HOST=${SIP_HOST}
SIP_PORT=${SIP_PORT}
ADMIN_EMAIL=admin@astradial.com
ADMIN_PASSWORD=admin
ADMIN_USERNAME=admin
INTERNAL_API_KEY=not-needed-in-cloud-mode
EOF

  echo ""
  echo "[1/2] Building editor... (first run takes 3-5 minutes)"
  docker compose build editor 2>&1 | while IFS= read -r line; do
    echo "$line" | grep -q " Built" && echo "  ✓ $(echo "$line" | sed 's/ Built//' | xargs) built"
  done
  echo "  ✓ Editor built"

  echo "[2/2] Starting dashboard..."
  docker compose up -d editor 2>&1 >/dev/null
  for i in $(seq 1 15); do
    curl -s http://localhost:3001 >/dev/null 2>&1 && break; sleep 2
  done
  echo "  ✓ Dashboard ready"

  echo ""
  echo "╔══════════════════════════════════════════════════════════╗"
  echo "║  Astradial is ready!                                     ║"
  echo "║                                                          ║"
  echo "║  Dashboard:  http://localhost:3001                        ║"
  echo "║  API:        ${PBX_URL}"
  echo "║  SIP:        ${SIP_HOST}:${SIP_PORT}"
  echo "║                                                          ║"
  echo "║  Login with your Astradial Cloud credentials.            ║"
  echo "║  Create extensions → register Zoiper → make calls.      ║"
  echo "║                                                          ║"
  echo "║  Don't have credentials? Email cats@astradial.com        ║"
  echo "╚══════════════════════════════════════════════════════════╝"
fi

echo ""
