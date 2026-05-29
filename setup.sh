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

  # ── Operator account ──
  echo ""
  echo "Set up your operator account:"
  echo "  (Used for admin-protected API endpoints + Asterisk AMI access.)"
  read -p "  Email [admin@example.com]: " ADMIN_EMAIL
  ADMIN_EMAIL=${ADMIN_EMAIL:-admin@example.com}
  read -p "  Password [admin]: " ADMIN_PASSWORD
  ADMIN_PASSWORD=${ADMIN_PASSWORD:-admin}
  read -p "  Name [Admin]: " ADMIN_NAME
  ADMIN_NAME=${ADMIN_NAME:-Admin}

  # ── Organisation to bootstrap ──
  echo ""
  echo "Pick a name for your first organisation (3-50 chars, letters/digits/hyphens only):"
  read -p "  Org name [MyAstradial]: " ORG_NAME
  ORG_NAME=${ORG_NAME:-MyAstradial}

  # ── Domain mode? ──
  echo ""
  echo "Do you have a domain pointed at this server? (y/n)"
  echo ""
  echo "  y = serve over HTTPS at custom subdomains (auto Let's Encrypt via Caddy)"
  echo "      Requires: DNS A records for editor + api subdomains → this server's IP"
  echo "      Result:   https://<editor>.<your-domain> and https://<api>.<your-domain>"
  echo ""
  echo "  n = use raw IP + ports (http://<server-ip>:3001 for editor)"
  echo "      No HTTPS, simplest setup for testing"
  echo ""
  read -p "  Have a domain? [n]: " HAS_DOMAIN
  HAS_DOMAIN=${HAS_DOMAIN:-n}

  USE_DOMAIN=0
  if [ "$HAS_DOMAIN" = "y" ] || [ "$HAS_DOMAIN" = "Y" ]; then
    USE_DOMAIN=1
    echo ""
    echo "Domain configuration:"
    read -p "  Base domain (e.g. example.com): " DOMAIN_BASE
    if [ -z "$DOMAIN_BASE" ]; then
      echo "  ⚠️ No domain provided, falling back to IP mode"
      USE_DOMAIN=0
    fi
  fi

  if [ "$USE_DOMAIN" = "1" ]; then
    read -p "  Editor subdomain prefix [pbx]: " EDITOR_SUB
    EDITOR_SUB=${EDITOR_SUB:-pbx}
    read -p "  API subdomain prefix [api]: " API_SUB
    API_SUB=${API_SUB:-api}
    read -p "  SIP subdomain prefix (DNS only — direct A record) [sip]: " SIP_SUB
    SIP_SUB=${SIP_SUB:-sip}

    EDITOR_FQDN="${EDITOR_SUB}.${DOMAIN_BASE}"
    API_FQDN="${API_SUB}.${DOMAIN_BASE}"
    SIP_FQDN="${SIP_SUB}.${DOMAIN_BASE}"

    PBX_URL="https://${API_FQDN}"
    SIP_HOST="${SIP_FQDN}"

    echo ""
    echo "  → Editor will be at https://${EDITOR_FQDN}"
    echo "  → API will be at    https://${API_FQDN}"
    echo "  → SIP host (DNS):   ${SIP_FQDN}:5060"
    echo ""
    echo "  Verify your DNS A records point ${EDITOR_FQDN}, ${API_FQDN}, and ${SIP_FQDN}"
    echo "  at this server BEFORE continuing — Caddy will fail to provision certificates"
    echo "  if the DNS doesn't resolve to this machine."
    read -p "  DNS ready? [y/n]: " DNS_OK
    DNS_OK=${DNS_OK:-n}
    if [ "$DNS_OK" != "y" ] && [ "$DNS_OK" != "Y" ]; then
      echo "  Aborting — set up DNS first, then re-run ./setup.sh"
      exit 1
    fi
  else
    SIP_HOST=$(hostname -I 2>/dev/null | awk '{print $1}' || ip route get 1 2>/dev/null | awk '{print $7;exit}' || echo "localhost")
    PBX_URL="http://${SIP_HOST}:8000"
    EDITOR_FQDN="${SIP_HOST}:3001"
    API_FQDN="${SIP_HOST}:8000"
  fi
  SIP_PORT="5060"

  # ── Write .env ──
  cat > .env << EOF
ASTRADIAL_MODE=selfhosted

# Auth mode — false: local (api_key + api_secret), true: Firebase project required
USE_FIREBASE=false
NEXT_PUBLIC_USE_FIREBASE=false

# Domain mode (1 = serve via Caddy HTTPS at FQDN, 0 = direct IP:port)
USE_DOMAIN=${USE_DOMAIN}
DOMAIN_BASE=${DOMAIN_BASE:-}
EDITOR_FQDN=${EDITOR_FQDN}
API_FQDN=${API_FQDN}

DB_NAME=astradial
DB_USER=astradial
DB_PASSWORD=changeme
DB_ROOT_PASSWORD=changeme

# Postgres (used only by workflow-engine; separate from the astrapbx mariadb)
PG_DATABASE=workflow_db
PG_USER=workflow
PG_PASSWORD=$(openssl rand -hex 16 2>/dev/null || echo "workflow_secure")

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

NEXT_PUBLIC_PBX_URL=${PBX_URL}
NEXT_PUBLIC_WORKFLOW_URL=http://workflow-engine:3002
NEXT_PUBLIC_GATEWAY_URL=http://pipecat-flow:7860
EOF

  # ── If domain mode, generate Caddyfile from template ──
  if [ "$USE_DOMAIN" = "1" ]; then
    if [ ! -f Caddyfile.template ]; then
      echo "  ⚠️ Caddyfile.template missing — domain mode requires it. Aborting."
      exit 1
    fi
    sed \
      -e "s|__EDITOR_FQDN__|${EDITOR_FQDN}|g" \
      -e "s|__API_FQDN__|${API_FQDN}|g" \
      -e "s|__ADMIN_EMAIL__|${ADMIN_EMAIL}|g" \
      Caddyfile.template > Caddyfile
    echo "  ✓ Caddyfile generated"
  fi

  # Compose profile + command
  if [ "$USE_DOMAIN" = "1" ]; then
    COMPOSE_PROFILE_ARG="--profile domain"
  else
    COMPOSE_PROFILE_ARG=""
  fi

  echo ""
  echo "[1/6] Building Docker images... (first run takes 3-5 minutes)"
  docker compose ${COMPOSE_PROFILE_ARG} build 2>&1 | while IFS= read -r line; do
    echo "$line" | grep -q " Built" && echo "  ✓ $(echo "$line" | sed 's/ Built//' | xargs) built"
  done
  echo "  ✓ All images built"

  echo "[2/6] Starting database..."
  docker compose up -d mariadb redis postgres 2>&1 >/dev/null
  for i in $(seq 1 30); do
    docker compose exec -T mariadb mariadb -u astradial -pchangeme -e "SELECT 1" >/dev/null 2>&1 && break
    printf "\r  ⏳ Waiting... (%s/30)" "$i"; sleep 2
  done
  echo ""; echo "  ✓ Database ready"

  echo "[3/6] Starting Asterisk PBX..."
  docker compose up -d asterisk 2>&1 >/dev/null; sleep 3
  echo "  ✓ Asterisk started"

  echo "[4/6] Starting API, Dashboard, and AI Gateway..."
  docker compose ${COMPOSE_PROFILE_ARG} up -d 2>&1 >/dev/null
  for i in $(seq 1 60); do
    curl -s http://localhost:8000/health >/dev/null 2>&1 && break
    printf "\r  ⏳ Starting... (%s/60)" "$i"; sleep 2
  done
  echo ""; echo "  ✓ API ready"

  echo "[5/6] Bootstrapping your first organisation..."
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
    ORG_API_KEY="(create one via the API — see docs)"
    ORG_API_SECRET="(create one via the API — see docs)"
  else
    echo "  ✓ Organisation '${ORG_NAME}' created"
  fi

  echo "[6/6] Waiting for dashboard..."
  if [ "$USE_DOMAIN" = "1" ]; then
    for i in $(seq 1 60); do
      curl -sk -o /dev/null --max-time 3 "https://${EDITOR_FQDN}" 2>/dev/null && break || true
      sleep 2
    done
  else
    for i in $(seq 1 30); do
      curl -s http://localhost:3001 >/dev/null 2>&1 && break; sleep 2
    done
  fi
  echo "  ✓ Dashboard ready"

  echo ""
  echo "════════════════════════════════════════════════════════════════"
  echo "  Astradial is ready!"
  echo "════════════════════════════════════════════════════════════════"
  echo ""
  if [ "$USE_DOMAIN" = "1" ]; then
    echo "  Dashboard:        https://${EDITOR_FQDN}"
    echo "  API:              https://${API_FQDN}"
    echo "  SIP server:       ${SIP_FQDN}:${SIP_PORT}"
    echo ""
    echo "  TLS:              auto-provisioned by Caddy (Let's Encrypt)."
    echo "                    First request may take 30-60s while certs issue."
  else
    echo "  Dashboard:        http://${EDITOR_FQDN}"
    echo "  API:              ${PBX_URL}"
    echo "  SIP server:       ${SIP_HOST}:${SIP_PORT}"
  fi
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

  cat > .env << EOF
ASTRADIAL_MODE=cloud
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
  echo "[1/2] Building editor..."
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
  echo "  Log in with the api_key + api_secret from your Astradial Cloud org."
  echo "  No credentials yet? Email cats@astradial.com"
  echo "════════════════════════════════════════════════════════════════"
fi

echo ""
