#!/bin/sh
set -e

echo "=== Astradial Asterisk Starting ==="
echo "Mode: ${ASTRADIAL_MODE:-selfhosted}"

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
