#!/bin/sh
set -e

echo "=== Astradial Asterisk Starting ==="
echo "Mode: ${ASTRADIAL_MODE:-selfhosted}"

# Detect host IP for NAT (Docker container → host network)
# SIP_HOST env var is preferred; fallback to Docker host gateway
HOST_IP=${SIP_HOST:-$(getent ahostsv4 host.docker.internal 2>/dev/null | head -1 | awk '{print $1}' || ip route | grep default | awk '{print $3}')}
echo "Host IP for NAT: ${HOST_IP}"

# Configure PJSIP transport with NAT settings
cat > /etc/asterisk/pjsip.conf <<PJSIP
[global]
type=global
max_forwards=70
user_agent=Astradial PBX

[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0:5060
external_media_address=${HOST_IP}
external_signaling_address=${HOST_IP}
local_net=172.16.0.0/12

[transport-tcp]
type=transport
protocol=tcp
bind=0.0.0.0:5060
external_media_address=${HOST_IP}
external_signaling_address=${HOST_IP}
local_net=172.16.0.0/12
PJSIP

# Developer mode: auto-configure trunk to Astradial Cloud
if [ "$ASTRADIAL_MODE" = "developer" ] && [ -n "$ASTRADIAL_TRUNK_HOST" ]; then
  echo "Developer mode: configuring trunk to ${ASTRADIAL_TRUNK_HOST}..."
  cat > /etc/asterisk/pjsip_astradial_cloud.conf <<EOF
; Auto-generated: Astradial Cloud trunk (developer mode)

[astradial-cloud]
type=registration
server_uri=sip:${ASTRADIAL_TRUNK_HOST}:5060
client_uri=sip:${ASTRADIAL_TRUNK_USER}@${ASTRADIAL_TRUNK_HOST}
outbound_auth=astradial-cloud-auth
retry_interval=60
expiration=3600

[astradial-cloud-auth]
type=auth
auth_type=userpass
username=${ASTRADIAL_TRUNK_USER}
password=${ASTRADIAL_TRUNK_PASS}

[astradial-cloud-endpoint]
type=endpoint
context=from-astradial-cloud
transport=transport-udp
auth=astradial-cloud-auth
aors=astradial-cloud-aor
disallow=all
allow=ulaw,alaw,g722
force_rport=yes
rewrite_contact=yes
rtp_symmetric=yes
direct_media=no

[astradial-cloud-aor]
type=aor
contact=sip:${ASTRADIAL_TRUNK_HOST}:5060
qualify_frequency=30
EOF

  if ! grep -q "pjsip_astradial_cloud.conf" /etc/asterisk/pjsip.conf 2>/dev/null; then
    echo "#include pjsip_astradial_cloud.conf" >> /etc/asterisk/pjsip.conf
  fi

  echo "Developer trunk configured."
fi

# Configure AMI for API connection
cat > /etc/asterisk/manager.conf <<EOF
[general]
enabled=yes
port=5038
bindaddr=0.0.0.0

[astradial]
secret=${ASTERISK_AMI_SECRET:-astradial}
deny=0.0.0.0/0.0.0.0
permit=0.0.0.0/0.0.0.0
read=system,call,log,verbose,command,agent,user,config,dtmf,reporting,cdr,dialplan,originate
write=system,call,log,verbose,command,agent,user,config,dtmf,reporting,cdr,dialplan,originate
EOF

echo "Starting Asterisk..."
exec asterisk -f -vvv
