#!/bin/bash
set -e

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║       Astradial — Quick Setup            ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Check prerequisites
command -v docker >/dev/null 2>&1 || { echo "Docker is required. Install: https://docker.com"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "python3 is required (used to parse API responses)."; exit 1; }

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

  # ── Operator account (for admin API + this script's bootstrap call) ──
  echo ""
  echo "Set up your operator account:"
  echo "  (Used for admin-protected API endpoints + Asterisk AMI access.)"
  read -p "  Email [admin@example.com]: " ADMIN_EMAIL
  ADMIN_EMAIL=${ADMIN_EMAIL:-admin@example.com}
  read -p "  Password [admin]: " ADMIN_PASSWORD
  ADMIN_PASSWORD=${ADMIN_PASSWORD:-admin}
  read -p "  Name [Admin]: " ADMIN_NAME
  ADMIN_NAME=${ADMIN_NAME:-Admin}

  # ── Organisation to bootstrap on first boot ──
  echo ""
  echo "Pick a name for your first organisation (3-50 chars, letters/digits/hyphens only):"
  read -p "  Org name [MyAstradial]: " ORG_NAME
  ORG_NAME=${ORG_NAME:-MyAstradial}

  SIP_HOST=$(hostname -I 2>/dev/null | awk '{print $1}' || ip route get 1 2>/dev/null | awk '{print $7;exit}' || echo "localhost")
  SIP_PORT="5060"

  # ── Write .env ──
  cat > .env << EOF
ASTRADIAL_MODE=selfhosted

# Auth mode — false: local (api_key + api_secret), true: Firebase project required
USE_FIREBASE=false
NEXT_PUBLIC_USE_FIREBASE=false

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
NEXT_PUBLIC_GATEWAY_URL=http://pipecat-flow:7860
EOF

  echo ""
  echo "[1/6] Building Docker images... (first run takes 3-5 minutes)"
  docker compose build 2>&1 | while IFS= read -r line; do
    echo "$line" | grep -q " Built" && echo "  ✓ $(echo "$line" | sed 's/ Built//' | xargs) built"
  done
  echo "  ✓ All images built"

  echo "[2/6] Starting database..."
  docker compose up -d mariadb redis 2>&1 >/dev/null
  for i in $(seq 1 30); do
    docker compose exec -T mariadb mariadb -u astradial -pchangeme -e "SELECT 1" >/dev/null 2>&1 && break
    printf "\r  ⏳ Waiting... (%s/30)" "$i"; sleep 2
  done
  echo ""; echo "  ✓ Database ready"

  echo "[3/6] Starting Asterisk PBX..."
  docker compose up -d asterisk 2>&1 >/dev/null; sleep 3
  echo "  ✓ Asterisk started"

  echo "[4/6] Starting API, Dashboard, and AI Gateway..."
  docker compose up -d api editor workflow-engine pipecat-flow 2>&1 >/dev/null
  for i in $(seq 1 60); do
    curl -s http://localhost:8000/health >/dev/null 2>&1 && break
    printf "\r  ⏳ Starting... (%s/60)" "$i"; sleep 2
  done
  echo ""; echo "  ✓ API ready"

  echo "[5/6] Bootstrapping your first organisation..."
  # Calls the admin-protected POST /api/v1/organizations. The endpoint
  # generates a fresh api_key + api_secret pair for this org; the api_secret
  # is returned PLAINTEXT in the response (the DB stores only the bcrypt
  # hash). This is the only window where we can print the secret — save it.
  ORG_RESPONSE=$(curl -s -X POST http://localhost:8000/api/v1/organizations \
    -H 'Content-Type: application/json' \
    -d "{\"admin_username\":\"admin\",\"admin_password\":\"${ADMIN_PASSWORD}\",\"name\":\"${ORG_NAME}\",\"contact_info\":{\"email\":\"${ADMIN_EMAIL}\"}}" 2>/dev/null)
  ORG_API_KEY=$(echo "$ORG_RESPONSE" | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("api_key",""))
except: print("")' 2>/dev/null)
  ORG_API_SECRET=$(echo "$ORG_RESPONSE" | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("api_secret",""))
except: print("")' 2>/dev/null)
  ORG_ID=$(echo "$ORG_RESPONSE" | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("id",""))
except: print("")' 2>/dev/null)

  if [ -z "$ORG_API_KEY" ] || [ -z "$ORG_API_SECRET" ]; then
    echo ""
    echo "  ⚠️  Organisation bootstrap failed. API response was:"
    echo "$ORG_RESPONSE" | head -c 500
    echo ""
    echo "  You can still log in by creating an org manually:"
    echo "    curl -X POST http://localhost:8000/api/v1/organizations \\"
    echo "      -H 'Content-Type: application/json' \\"
    echo "      -d '{\"admin_username\":\"admin\",\"admin_password\":\"${ADMIN_PASSWORD}\",\"name\":\"YourOrg\"}'"
    ORG_API_KEY="(see manual command above)"
    ORG_API_SECRET="(see manual command above)"
  else
    echo "  ✓ Organisation '${ORG_NAME}' created"
  fi

  echo "[6/6] Waiting for dashboard..."
  for i in $(seq 1 30); do
    curl -s http://localhost:3001 >/dev/null 2>&1 && break; sleep 2
  done
  echo "  ✓ Dashboard ready"

  echo ""
  echo "════════════════════════════════════════════════════════════════"
  echo "  Astradial is ready!"
  echo "════════════════════════════════════════════════════════════════"
  echo ""
  echo "  Dashboard:        http://localhost:3001"
  echo "  SIP server:       ${SIP_HOST}:${SIP_PORT}"
  echo ""
  echo "  YOUR LOGIN CREDENTIALS — save these somewhere safe NOW:"
  echo ""
  echo "    API key:        ${ORG_API_KEY}"
  echo "    API secret:     ${ORG_API_SECRET}"
  echo ""
  echo "    Org name:       ${ORG_NAME}"
  echo "    Org id:         ${ORG_ID}"
  echo ""
  echo "  These won't be shown again. The API secret is only printed"
  echo "  once at org creation — the database stores only its bcrypt hash."
  echo ""
  echo "  Open the dashboard → paste the API key + secret into the login"
  echo "  form → then go to Users to add extensions, queues, etc."
  echo ""
  echo "  Want Firebase / Google sign-in instead? Set"
  echo "  USE_FIREBASE=true + NEXT_PUBLIC_USE_FIREBASE=true in .env"
  echo "  and add your NEXT_PUBLIC_FIREBASE_* env vars."
  echo "════════════════════════════════════════════════════════════════"

else
  MODE="cloud"

  echo ""
  echo "Enter your Astradial Cloud server:"
  echo "(Email cats@astradial.com if you don't have credentials yet)"
  echo ""
  read -p "  API URL [https://open.astradial.com]: " PBX_URL
  PBX_URL=${PBX_URL:-https://open.astradial.com}
  read -p "  SIP host [opensip.astradial.com]: " SIP_HOST
  SIP_HOST=${SIP_HOST:-opensip.astradial.com}
  read -p "  SIP port [5060]: " SIP_PORT
  SIP_PORT=${SIP_PORT:-5060}

  # ── Write .env ──
  cat > .env << EOF
ASTRADIAL_MODE=cloud

# Auth mode — false: local (api_key + api_secret), true: Firebase project required
USE_FIREBASE=false
NEXT_PUBLIC_USE_FIREBASE=false

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
  echo "════════════════════════════════════════════════════════════════"
  echo "  Astradial is ready!"
  echo "════════════════════════════════════════════════════════════════"
  echo ""
  echo "  Dashboard:    http://localhost:3001"
  echo "  API:          ${PBX_URL}"
  echo "  SIP:          ${SIP_HOST}:${SIP_PORT}"
  echo ""
  echo "  Log in with the api_key + api_secret you received when your"
  echo "  Astradial Cloud org was provisioned."
  echo "  Don't have credentials? Email cats@astradial.com"
  echo "════════════════════════════════════════════════════════════════"
fi

echo ""
