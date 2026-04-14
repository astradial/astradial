#!/bin/bash
set -e

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║       Astradial — Quick Setup            ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Check prerequisites
command -v docker >/dev/null 2>&1 || { echo "Docker is required. Install: https://docker.com"; exit 1; }
command -v docker compose >/dev/null 2>&1 || { echo "Docker Compose is required."; exit 1; }

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

if [ "$OS" = "Darwin" ]; then
  echo ""
  echo "macOS detected — installing Asterisk natively for SIP audio..."
  echo ""

  # Install Asterisk via Homebrew
  if ! command -v asterisk >/dev/null 2>&1; then
    if ! command -v brew >/dev/null 2>&1; then
      echo "Homebrew is required. Install: https://brew.sh"
      exit 1
    fi
    echo "Installing Asterisk..."
    brew install asterisk
  else
    echo "Asterisk already installed: $(asterisk -V)"
  fi

  # Get LAN IP
  LAN_IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | grep -v "169.254" | head -1 | awk '{print $2}')
  echo "Your LAN IP: ${LAN_IP}"

  # Write SIP_HOST
  sed -i.bak "s|.*SIP_HOST=.*|SIP_HOST=${LAN_IP}|" .env
  rm -f .env.bak

  # Configure Asterisk
  ASTERISK_CONF=$(brew --prefix)/etc/asterisk
  echo "Configuring Asterisk at ${ASTERISK_CONF}..."

  # Copy base configs
  cp asterisk/configs/modules.conf ${ASTERISK_CONF}/modules.conf
  cp asterisk/configs/ari.conf ${ASTERISK_CONF}/ari.conf
  cp asterisk/configs/http.conf ${ASTERISK_CONF}/http.conf

  # PJSIP transport with LAN IP
  cat > ${ASTERISK_CONF}/pjsip.conf <<EOF
[global]
type=global
max_forwards=70
user_agent=Astradial PBX

[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0:5060

[transport-tcp]
type=transport
protocol=tcp
bind=0.0.0.0:5060
EOF

  # AMI config
  cat > ${ASTERISK_CONF}/manager.conf <<EOF
[general]
enabled=yes
port=5038
bindaddr=0.0.0.0

[astradial]
secret=astradial
deny=0.0.0.0/0.0.0.0
permit=0.0.0.0/0.0.0.0
read=system,call,log,verbose,command,agent,user,config,dtmf,reporting,cdr,dialplan,originate
write=system,call,log,verbose,command,agent,user,config,dtmf,reporting,cdr,dialplan,originate
EOF

  # Extensions base
  cat > ${ASTERISK_CONF}/extensions.conf <<EOF
[general]
static=yes
writeprotect=no
clearglobalvars=no

[default]
exten => _X.,1,NoOp(Unrouted call to \${EXTEN})
same => n,Answer()
same => n,Playback(number-not-in-service)
same => n,Hangup()
EOF

  # Queues base
  cat > ${ASTERISK_CONF}/queues.conf <<EOF
[general]
persistentmembers=yes
autofill=yes
EOF

  # Point API to localhost Asterisk (not Docker)
  sed -i.bak "s|AMI_HOST=.*|AMI_HOST=host.docker.internal|" .env 2>/dev/null
  grep -q "AMI_HOST" .env || echo "AMI_HOST=host.docker.internal" >> .env
  grep -q "ASTERISK_HOST" .env || echo "ASTERISK_HOST=host.docker.internal" >> .env
  grep -q "ASTERISK_PORT" .env || echo "ASTERISK_PORT=8088" >> .env
  grep -q "ASTERISK_PJSIP_CONFIG_PATH" .env || echo "ASTERISK_PJSIP_CONFIG_PATH=${ASTERISK_CONF}" >> .env
  rm -f .env.bak

  # Start Asterisk in background
  echo "Starting Asterisk..."
  asterisk -f &
  ASTERISK_PID=$!
  sleep 2

  # Start Docker services (without Asterisk container)
  echo "Starting Docker services..."
  docker compose up -d mariadb redis
  echo "Waiting for database..."
  sleep 10
  docker compose up -d api editor workflow-engine

  echo ""
  echo "Waiting for services to start..."
  sleep 15

  # Deploy config
  echo "Deploying Asterisk config..."
  TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/user-login -H 'Content-Type: application/json' -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
  if [ -n "$TOKEN" ] && [ "$TOKEN" != "" ]; then
    curl -s -X POST http://localhost:8000/api/v1/config/deploy -H "Authorization: Bearer $TOKEN" >/dev/null 2>&1
    echo "Config deployed!"
  fi

  echo ""
  echo "╔══════════════════════════════════════════════════════╗"
  echo "║  Astradial is ready!                                 ║"
  echo "║                                                      ║"
  echo "║  Dashboard:  http://localhost:3001                    ║"
  echo "║  Email:      ${ADMIN_EMAIL}"
  echo "║  Password:   ${ADMIN_PASSWORD}"
  echo "║                                                      ║"
  echo "║  SIP Server: ${LAN_IP}:5060                          ║"
  echo "║                                                      ║"
  echo "║  Next steps:                                         ║"
  echo "║  1. Open http://localhost:3001                        ║"
  echo "║  2. Sign in with your credentials                    ║"
  echo "║  3. Go to Users → click extension → get SIP creds   ║"
  echo "║  4. Register Zoiper with the SIP credentials         ║"
  echo "║  5. Make a call!                                     ║"
  echo "╚══════════════════════════════════════════════════════╝"
  echo ""

else
  # Linux — use Docker for everything (SIP works natively)
  echo "Linux detected — using Docker for all services including Asterisk..."

  LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || ip route get 1 | awk '{print $7;exit}')
  sed -i "s|.*SIP_HOST=.*|SIP_HOST=${LAN_IP}|" .env 2>/dev/null
  grep -q "SIP_HOST" .env || echo "SIP_HOST=${LAN_IP}" >> .env

  docker compose up -d

  echo ""
  echo "Waiting for services to start..."
  sleep 20

  # Deploy config
  TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/user-login -H 'Content-Type: application/json' -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
  if [ -n "$TOKEN" ] && [ "$TOKEN" != "" ]; then
    curl -s -X POST http://localhost:8000/api/v1/config/deploy -H "Authorization: Bearer $TOKEN" >/dev/null 2>&1
  fi

  echo ""
  echo "╔══════════════════════════════════════════════════════╗"
  echo "║  Astradial is ready!                                 ║"
  echo "║                                                      ║"
  echo "║  Dashboard:  http://localhost:3001                    ║"
  echo "║  Email:      ${ADMIN_EMAIL}"
  echo "║  Password:   ${ADMIN_PASSWORD}"
  echo "║                                                      ║"
  echo "║  SIP Server: ${LAN_IP}:5060                          ║"
  echo "╚══════════════════════════════════════════════════════╝"
  echo ""
fi
