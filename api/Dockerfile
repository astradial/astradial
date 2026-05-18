################################################################################
# Single-container OSS — api + asterisk in one image.
#
# WHY: every src/services/asterisk/*.js call site uses `asterisk -rx "..."`
# shell exec. That works on platform's bare-metal VPS (api on PM2 +
# system asterisk on the same host) but breaks in containerised OSS if
# api and asterisk live in separate containers. Bundling both into a
# single image matches platform's topology exactly so the existing
# code keeps working with zero refactor.
#
# Debian base because platform's INSTALLATION.md uses `apt install
# asterisk` on Debian — matching gives us the same modules and config
# layout as production.
################################################################################

FROM ubuntu:22.04

ARG DEBIAN_FRONTEND=noninteractive

# Ubuntu 22.04 ships asterisk in `universe`, which is already enabled by
# default on the official ubuntu:22.04 base. Debian's slim images don't
# carry asterisk in main, so Ubuntu is the path of least friction.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg bash openssh-client iproute2 \
      asterisk asterisk-modules asterisk-config \
      supervisor \
      libcap2-bin \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /var/spool/asterisk/monitor /var/run/asterisk /var/log/asterisk

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN chmod +x entrypoint.sh

# Baseline asterisk configs. Asterisk reads /etc/asterisk at boot; we
# overwrite pjsip.conf + manager.conf at entrypoint time with values
# from env (NAT IP, AMI secret) so this is just the static skeleton.
COPY docker/asterisk-base-configs/ /etc/asterisk/

# Supervisord lives at the default Debian path and auto-includes
# /etc/supervisor/conf.d/*.conf — dropping our program file in there
# is enough.
COPY docker/supervisord.conf /etc/supervisor/conf.d/astradial.conf

# 3000  HTTP api
# 5038  AMI (only inside the container — not published outside)
# 8088  ARI HTTP (only inside the container)
# 5060  SIP signalling
# 10000-10100 RTP media
EXPOSE 3000 5038 8088 5060/udp 5060/tcp 10000-10100/udp

ENTRYPOINT ["./entrypoint.sh"]
