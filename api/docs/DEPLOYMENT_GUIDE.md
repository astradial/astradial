# Deployment Guide - PBX API

## Table of Contents
1. [Deployment Overview](#deployment-overview)
2. [Prerequisites](#prerequisites)
3. [Production Environment Setup](#production-environment-setup)
4. [Deployment Methods](#deployment-methods)
5. [Docker Deployment](#docker-deployment)
6. [PM2 Deployment](#pm2-deployment)
7. [Systemd Service](#systemd-service)
8. [Nginx Configuration](#nginx-configuration)
9. [SSL/TLS Setup](#ssltls-setup)
10. [Database Management](#database-management)
11. [Monitoring & Logging](#monitoring--logging)
12. [Backup & Recovery](#backup--recovery)
13. [Security Hardening](#security-hardening)
14. [Troubleshooting](#troubleshooting)

## Deployment Overview

This guide covers deploying the PBX API to production environments, including server setup, security configuration, and ongoing maintenance procedures.

### Deployment Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Internet / Users                          │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS (443)
              ┌────────▼────────┐
              │   Cloudflare    │ (Optional CDN/DDoS Protection)
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │   Firewall      │ (iptables/ufw)
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │  Nginx Reverse  │ (SSL Termination)
              │     Proxy       │
              └────────┬────────┘
                       │ HTTP (3000)
              ┌────────▼────────┐
              │   Node.js App   │ (PM2 Process Manager)
              │   (PBX API)     │
              └───┬────────┬────┘
                  │        │
        ┌─────────▼──┐  ┌──▼─────────┐
        │   MySQL    │  │  Asterisk  │
        │  Database  │  │    PBX     │
        └────────────┘  └────────────┘
```

## Prerequisites

### System Requirements

#### Minimum Hardware
- **CPU**: 2 cores
- **RAM**: 4 GB
- **Storage**: 20 GB SSD
- **Network**: 100 Mbps

#### Recommended Hardware
- **CPU**: 4+ cores
- **RAM**: 8+ GB
- **Storage**: 50+ GB SSD
- **Network**: 1 Gbps

### Software Requirements
- **OS**: Ubuntu 20.04/22.04 LTS or CentOS 8/RHEL 8
- **Node.js**: v14+ (v16+ recommended)
- **MySQL/MariaDB**: 10.3+
- **Asterisk**: 16+ with AMI enabled
- **Nginx**: 1.18+
- **Git**: 2.x

## Production Environment Setup

### 1. Server Preparation

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install essential packages
sudo apt install -y curl wget git build-essential software-properties-common

# Set timezone
sudo timedatectl set-timezone America/New_York

# Configure hostname
sudo hostnamectl set-hostname pbx-api-prod
```

### 2. Create Application User

```bash
# Create dedicated user
sudo useradd -m -s /bin/bash pbxapi
sudo passwd pbxapi

# Add to sudo group (if needed)
sudo usermod -aG sudo pbxapi

# Create application directory
sudo mkdir -p /opt/pbx-api
sudo chown pbxapi:pbxapi /opt/pbx-api
```

### 3. Install Node.js

```bash
# Using NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version
npm --version
```

### 4. Install MySQL

```bash
# Install MySQL server
sudo apt install -y mysql-server

# Secure installation
sudo mysql_secure_installation

# Create database and user
sudo mysql -u root -p << EOF
CREATE DATABASE pbx_api_prod;
CREATE USER 'pbx_user'@'localhost' IDENTIFIED BY 'SecurePassword123!';
GRANT ALL PRIVILEGES ON pbx_api_prod.* TO 'pbx_user'@'localhost';
FLUSH PRIVILEGES;
EOF
```

### 5. Install and Configure Asterisk

```bash
# Install Asterisk
sudo apt install -y asterisk

# Configure AMI (edit /etc/asterisk/manager.conf)
sudo tee /etc/asterisk/manager.conf > /dev/null << EOF
[general]
enabled = yes
port = 5038
bindaddr = 127.0.0.1

[pbx_ami_user]
secret = pbx_ami_secret_prod_2024
deny = 0.0.0.0/0.0.0.0
permit = 127.0.0.0/255.255.255.0
read = all
write = all
EOF

# Restart Asterisk
sudo systemctl restart asterisk
```

## Deployment Methods

### Clone and Setup Application

```bash
# Switch to app user
su - pbxapi

# Clone repository
cd /opt/pbx-api
git clone git@github.com:abusayed200four/asterisk-api.git .

# Install dependencies
npm ci --production

# Create environment file
cp .env.example .env.production
```

### Configure Environment Variables

```bash
# Edit production environment
nano .env.production
```

```env
# Production Configuration
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Database
DB_HOST=localhost
DB_PORT=3306
DB_NAME=pbx_api_prod
DB_USER=pbx_user
DB_PASSWORD=SecurePassword123!
DB_DIALECT=mysql

# Asterisk AMI
AMI_HOST=localhost
AMI_PORT=5038
AMI_USERNAME=pbx_ami_user
AMI_PASSWORD=pbx_ami_secret_prod_2024

# Security
JWT_SECRET=production_jwt_secret_change_this_to_random_string
ADMIN_USERNAME=admin
ADMIN_PASSWORD=SuperSecureAdminPassword2024!

# Optional Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=redis_password_if_set

# Logging
LOG_LEVEL=info
LOG_FILE=/var/log/pbx-api/app.log
```

### Run Database Migrations

```bash
# Run migrations
NODE_ENV=production npx sequelize-cli db:migrate

# Verify migrations
NODE_ENV=production npx sequelize-cli db:migrate:status
```

## Docker Deployment

### Create Dockerfile

```dockerfile
# Dockerfile
FROM node:16-alpine

# Install dependencies for native modules
RUN apk add --no-cache python3 make g++

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership
RUN chown -R nodejs:nodejs /usr/src/app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Start application
CMD ["node", "src/server.js"]
```

### Create docker-compose.yml

```yaml
version: '3.8'

services:
  pbx-api:
    build: .
    container_name: pbx-api
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
    env_file:
      - .env.production
    depends_on:
      - mysql
    networks:
      - pbx-network
    volumes:
      - ./logs:/var/log/pbx-api
      - ./uploads:/usr/src/app/uploads

  mysql:
    image: mysql:8.0
    container_name: pbx-mysql
    restart: unless-stopped
    ports:
      - "3306:3306"
    environment:
      MYSQL_ROOT_PASSWORD: root_password
      MYSQL_DATABASE: pbx_api_prod
      MYSQL_USER: pbx_user
      MYSQL_PASSWORD: SecurePassword123!
    volumes:
      - mysql-data:/var/lib/mysql
    networks:
      - pbx-network

  redis:
    image: redis:6-alpine
    container_name: pbx-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    command: redis-server --appendonly yes --requirepass redis_password
    volumes:
      - redis-data:/data
    networks:
      - pbx-network

networks:
  pbx-network:
    driver: bridge

volumes:
  mysql-data:
  redis-data:
```

### Deploy with Docker

```bash
# Build and start containers
docker-compose up -d --build

# View logs
docker-compose logs -f pbx-api

# Stop containers
docker-compose down
```

## PM2 Deployment

### Install PM2

```bash
# Install PM2 globally
sudo npm install -g pm2

# Install PM2 log rotate
pm2 install pm2-logrotate
```

### Create PM2 Configuration

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'pbx-api',
    script: 'src/server.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: '/var/log/pbx-api/pm2-error.log',
    out_file: '/var/log/pbx-api/pm2-out.log',
    log_file: '/var/log/pbx-api/pm2-combined.log',
    time: true,
    max_memory_restart: '1G',
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    watch: false,
    ignore_watch: ['node_modules', 'logs', 'uploads']
  }]
};
```

### Start with PM2

```bash
# Start application
pm2 start ecosystem.config.js --env production

# Save PM2 configuration
pm2 save

# Setup PM2 startup script
pm2 startup systemd
# Follow the command output instructions

# Monitor application
pm2 monit

# View logs
pm2 logs pbx-api

# Restart application
pm2 restart pbx-api

# Reload application (zero-downtime)
pm2 reload pbx-api
```

## Systemd Service

### Create Service File

```bash
sudo nano /etc/systemd/system/pbx-api.service
```

```ini
[Unit]
Description=PBX API Server
Documentation=https://github.com/abusayed200four/asterisk-api
After=network.target mysql.service

[Service]
Type=simple
User=pbxapi
Group=pbxapi
WorkingDirectory=/opt/pbx-api
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=10
StandardOutput=append:/var/log/pbx-api/app.log
StandardError=append:/var/log/pbx-api/error.log
Environment=NODE_ENV=production
EnvironmentFile=/opt/pbx-api/.env.production

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/pbx-api /var/log/pbx-api

[Install]
WantedBy=multi-user.target
```

### Manage Service

```bash
# Reload systemd
sudo systemctl daemon-reload

# Start service
sudo systemctl start pbx-api

# Enable auto-start
sudo systemctl enable pbx-api

# Check status
sudo systemctl status pbx-api

# View logs
sudo journalctl -u pbx-api -f

# Restart service
sudo systemctl restart pbx-api
```

## Nginx Configuration

### Install Nginx

```bash
sudo apt install -y nginx
```

### Create Nginx Configuration

```nginx
# /etc/nginx/sites-available/pbx-api
upstream pbx_api {
    least_conn;
    server 127.0.0.1:3000 max_fails=3 fail_timeout=30s;
    # Add more servers for load balancing
    # server 127.0.0.1:3001 max_fails=3 fail_timeout=30s;
}

server {
    listen 80;
    server_name api.yourdomain.com;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Logging
    access_log /var/log/nginx/pbx-api-access.log combined;
    error_log /var/log/nginx/pbx-api-error.log warn;

    # Request limits
    client_max_body_size 10M;
    client_body_timeout 12;
    client_header_timeout 12;
    keepalive_timeout 15;
    send_timeout 10;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req zone=api burst=20 nodelay;

    # API endpoints
    location /api {
        proxy_pass http://pbx_api;
        proxy_http_version 1.1;

        # Headers
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;

        # Buffering
        proxy_buffering off;
        proxy_cache_bypass $http_upgrade;
    }

    # Health check endpoint
    location /health {
        proxy_pass http://pbx_api/health;
        access_log off;
    }

    # Swagger documentation (served at /docs, old /api-docs redirects)
    location /docs {
        proxy_pass http://pbx_api/docs;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # Prevent Cloudflare from caching swagger-ui-init.js
        add_header Cache-Control "no-store, no-cache, must-revalidate";
    }

    # Static files (if any)
    location /static {
        alias /opt/pbx-api/public;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # Security: Deny access to hidden files
    location ~ /\. {
        deny all;
        access_log off;
        log_not_found off;
    }
}
```

### Enable Configuration

```bash
# Create symbolic link
sudo ln -s /etc/nginx/sites-available/pbx-api /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

## SSL/TLS Setup

### Using Let's Encrypt (Certbot)

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d api.yourdomain.com

# Auto-renewal test
sudo certbot renew --dry-run

# Setup auto-renewal cron
sudo crontab -e
# Add: 0 0,12 * * * /usr/bin/certbot renew --quiet
```

### Using Commercial SSL Certificate

```bash
# Generate CSR
openssl req -new -newkey rsa:2048 -nodes \
  -keyout api.yourdomain.com.key \
  -out api.yourdomain.com.csr

# After receiving certificate, combine files
cat api.yourdomain.com.crt intermediate.crt > fullchain.pem

# Copy to appropriate location
sudo mkdir -p /etc/ssl/private
sudo cp api.yourdomain.com.key /etc/ssl/private/
sudo cp fullchain.pem /etc/ssl/certs/
sudo chmod 600 /etc/ssl/private/api.yourdomain.com.key
```

## Database Management

### Backup Strategy

```bash
# Create backup script
sudo nano /opt/scripts/backup-pbx-db.sh
```

```bash
#!/bin/bash
# Database backup script

# Configuration
DB_NAME="pbx_api_prod"
DB_USER="pbx_user"
DB_PASS="SecurePassword123!"
BACKUP_DIR="/opt/backups/mysql"
RETENTION_DAYS=30

# Create backup directory
mkdir -p $BACKUP_DIR

# Generate filename
FILENAME="$BACKUP_DIR/pbx_api_$(date +%Y%m%d_%H%M%S).sql.gz"

# Create backup
mysqldump -u$DB_USER -p$DB_PASS --single-transaction --routines --triggers $DB_NAME | gzip > $FILENAME

# Upload to S3 (optional)
# aws s3 cp $FILENAME s3://your-backup-bucket/mysql/

# Remove old backups
find $BACKUP_DIR -type f -name "*.sql.gz" -mtime +$RETENTION_DAYS -delete

echo "Backup completed: $FILENAME"
```

### Setup Backup Cron

```bash
# Make script executable
sudo chmod +x /opt/scripts/backup-pbx-db.sh

# Add to crontab
sudo crontab -e
# Add: 0 2 * * * /opt/scripts/backup-pbx-db.sh >> /var/log/backup.log 2>&1
```

### Restore Database

```bash
# Restore from backup
gunzip < backup_file.sql.gz | mysql -u pbx_user -p pbx_api_prod
```

## Monitoring & Logging

### Application Monitoring

#### Using PM2

```bash
# PM2 monitoring
pm2 monit

# Web dashboard
pm2 install pm2-web
pm2 web
```

#### Health Check Endpoint

```javascript
// Health check implementation
app.get('/health', async (req, res) => {
  const health = {
    uptime: process.uptime(),
    message: 'OK',
    timestamp: Date.now(),
    checks: {
      database: 'unknown',
      asterisk: 'unknown'
    }
  };

  try {
    // Check database
    await sequelize.authenticate();
    health.checks.database = 'healthy';

    // Check Asterisk AMI
    const ami = new AsteriskManager();
    await ami.connect();
    health.checks.asterisk = 'healthy';
    await ami.disconnect();

    res.status(200).json(health);
  } catch (error) {
    health.message = 'ERROR';
    health.error = error.message;
    res.status(503).json(health);
  }
});
```

### Log Management

#### Configure Log Rotation

```bash
# Install logrotate (usually pre-installed)
sudo apt install -y logrotate

# Create logrotate config
sudo nano /etc/logrotate.d/pbx-api
```

```
/var/log/pbx-api/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 640 pbxapi pbxapi
    sharedscripts
    postrotate
        pm2 reloadLogs
    endscript
}
```

#### Centralized Logging (Optional)

```bash
# Install Elasticsearch, Logstash, Kibana (ELK Stack)
# Or use cloud services like AWS CloudWatch, DataDog, etc.
```

### System Monitoring

```bash
# Install monitoring tools
sudo apt install -y htop iotop nethogs

# Install Netdata (real-time monitoring)
bash <(curl -Ss https://my-netdata.io/kickstart.sh)

# Access at http://server-ip:19999
```

## Backup & Recovery

### Full System Backup

```bash
# Create full backup script
sudo nano /opt/scripts/full-backup.sh
```

```bash
#!/bin/bash

# Configuration
BACKUP_DIR="/opt/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Application backup
tar -czf $BACKUP_DIR/app_$TIMESTAMP.tar.gz \
  /opt/pbx-api \
  --exclude=/opt/pbx-api/node_modules \
  --exclude=/opt/pbx-api/logs

# Configuration backup
tar -czf $BACKUP_DIR/config_$TIMESTAMP.tar.gz \
  /etc/nginx/sites-available/pbx-api \
  /etc/systemd/system/pbx-api.service \
  /opt/pbx-api/.env.production

# Asterisk configuration backup
tar -czf $BACKUP_DIR/asterisk_$TIMESTAMP.tar.gz \
  /etc/asterisk

# Upload to remote storage
# rsync -avz $BACKUP_DIR/ user@backup-server:/backups/
```

### Disaster Recovery Plan

1. **Regular Backups**: Daily database, weekly full system
2. **Off-site Storage**: Copy backups to S3/remote server
3. **Documentation**: Keep deployment guide updated
4. **Testing**: Regular recovery drills
5. **Monitoring**: Alert on backup failures

## Security Hardening

### Firewall Configuration

```bash
# Using UFW
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow from 127.0.0.1 to any port 3000
sudo ufw allow from 127.0.0.1 to any port 3306
sudo ufw allow from 127.0.0.1 to any port 5038
sudo ufw enable
```

### Fail2ban Configuration

```bash
# Install fail2ban
sudo apt install -y fail2ban

# Create jail configuration
sudo nano /etc/fail2ban/jail.local
```

```ini
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true

[nginx-limit-req]
enabled = true
filter = nginx-limit-req
logpath = /var/log/nginx/*error.log

[pbx-api]
enabled = true
port = http,https
filter = pbx-api
logpath = /var/log/pbx-api/app.log
maxretry = 10
```

### Security Best Practices

1. **Keep Systems Updated**
```bash
# Setup automatic security updates
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure unattended-upgrades
```

2. **Secure Environment Variables**
```bash
# Restrict .env file permissions
chmod 600 /opt/pbx-api/.env.production
chown pbxapi:pbxapi /opt/pbx-api/.env.production
```

3. **Database Security**
```sql
-- Remove default users
DELETE FROM mysql.user WHERE User='';
DELETE FROM mysql.user WHERE User='root' AND Host NOT IN ('localhost', '127.0.0.1', '::1');

-- Restrict user privileges
REVOKE ALL PRIVILEGES ON *.* FROM 'pbx_user'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON pbx_api_prod.* TO 'pbx_user'@'localhost';
FLUSH PRIVILEGES;
```

4. **API Rate Limiting**
```javascript
// In Express app
const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP'
});

app.use('/api/', apiLimiter);
```

## Troubleshooting

### Common Issues

#### Application Won't Start

```bash
# Check logs
pm2 logs pbx-api
journalctl -u pbx-api -n 50

# Check port availability
netstat -tulpn | grep 3000

# Verify environment variables
node -e "console.log(require('dotenv').config({ path: '.env.production' }))"
```

#### Database Connection Issues

```bash
# Test MySQL connection
mysql -u pbx_user -p -h localhost pbx_api_prod

# Check MySQL service
systemctl status mysql

# Review MySQL logs
sudo tail -f /var/log/mysql/error.log
```

#### High Memory Usage

```bash
# Check memory usage
free -h
pm2 monit

# Restart with memory limit
pm2 delete pbx-api
pm2 start ecosystem.config.js --max-memory-restart 1G
```

#### Nginx 502 Bad Gateway

```bash
# Check if app is running
pm2 status

# Check Nginx error logs
sudo tail -f /var/log/nginx/pbx-api-error.log

# Test upstream directly
curl http://127.0.0.1:3000/health
```

### Performance Optimization

1. **Enable Node.js Clustering**
```javascript
// In PM2 config
instances: 'max',
exec_mode: 'cluster'
```

2. **Database Query Optimization**
```sql
-- Add indexes
CREATE INDEX idx_org_id ON users(org_id);
CREATE INDEX idx_created_at ON call_records(created_at);
```

3. **Enable Redis Caching**
```javascript
const redis = require('redis');
const client = redis.createClient({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT
});
```

4. **CDN for Static Assets**
- Use Cloudflare or AWS CloudFront
- Cache static resources
- Enable Brotli/Gzip compression

## Maintenance

### Regular Tasks

#### Daily
- Monitor application logs
- Check backup completion
- Review error rates

#### Weekly
- Review system performance
- Check disk usage
- Update dependencies (dev environment first)

#### Monthly
- Security updates
- Performance analysis
- Backup restoration test

### Update Procedure

```bash
# 1. Backup current version
tar -czf /opt/backups/app_before_update.tar.gz /opt/pbx-api

# 2. Pull latest code
cd /opt/pbx-api
git fetch origin
git checkout tags/v1.2.0  # or specific version

# 3. Install dependencies
npm ci --production

# 4. Run migrations
NODE_ENV=production npx sequelize-cli db:migrate

# 5. Reload application
pm2 reload pbx-api

# 6. Verify
curl https://api.yourdomain.com/health
```

## Conclusion

This deployment guide provides comprehensive instructions for deploying and maintaining the PBX API in production. Always test changes in a staging environment before applying to production, and maintain regular backups for disaster recovery.