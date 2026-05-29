FROM andrius/asterisk:latest

USER root

# Create directories
RUN mkdir -p /var/spool/asterisk/monitor \
    && mkdir -p /var/lib/asterisk/sounds/en

# Copy base configs
COPY configs/ /etc/asterisk/
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 5060/udp 5060/tcp 5038/tcp 10000-10100/udp

ENTRYPOINT ["/entrypoint.sh"]
