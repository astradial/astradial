# PBX API - Installation Guide

Complete installation and deployment guide for the Multi-Tenant PBX API system.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [System Requirements](#system-requirements)
3. [Installation Steps](#installation-steps)
4. [Configuration](#configuration)
5. [Database Setup](#database-setup)
6. [Asterisk Configuration](#asterisk-configuration)
7. [Production Deployment](#production-deployment)
8. [Verification](#verification)
9. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Software

- **Node.js**: v18.x or higher
- **npm**: v9.x or higher
- **MariaDB/MySQL**: v10.5+ or MySQL 8.0+
- **Asterisk**: v18+ or v20+ (with PJSIP)
- **Git**: For repository management

### Optional (Recommended)

- **PM2**: Process manager for production
- **Nginx**: Reverse proxy and SSL termination
- **Redis**: For session management and caching

---

## System Requirements

### Minimum Requirements

- **CPU**: 2 cores
- **RAM**: 2GB
- **Disk**: 20GB
- **OS**: Ubuntu 20.04 LTS or later, Debian 11+, CentOS 8+

### Recommended for Production

- **CPU**: 4+ cores
- **RAM**: 4GB+
- **Disk**: 50GB+ SSD
- **Network**: Dedicated IP, firewall configured

---

## Installation Steps

### 1. Install System Dependencies

#### Ubuntu/Debian

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install MariaDB
sudo apt install -y mariadb-server mariadb-client

# Install Asterisk (if not already installed)
sudo apt install -y asterisk

# Install build tools
sudo apt install -y build-essential git
```

#### CentOS/RHEL

```bash
# Update system
sudo yum update -y

# Install Node.js 20.x
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs

# Install MariaDB
sudo yum install -y mariadb-server mariadb

# Start MariaDB
sudo systemctl start mariadb
sudo systemctl enable mariadb
```

### 2. Clone Repository

```bash
# Clone from GitHub
cd /opt
sudo git clone https://github.com/saynth-ai/asterisk-api.git pbx-api
cd pbx-api

# Set permissions
sudo chown -R $USER:$USER /opt/pbx-api
```

### 3. Install Node Dependencies

```bash
cd /opt/pbx-api
npm install --production
```

**Packages installed:**
- express (v5.1.0) - Web framework
- mariadb (v3.4.5) - Database driver
- sequelize (v6.37.7) - ORM
- jsonwebtoken (v9.0.2) - JWT authentication
- bcrypt (v6.0.0) - Password hashing
- swagger-ui-express (v5.0.1) - API documentation
- And more... (see package.json)

---

## Configuration

### 1. Create Environment File

```bash
cd /opt/pbx-api
cp .env.example .env
nano .env
```

### 2. Configure Environment Variables

```bash
# ========================================
# DATABASE CONFIGURATION
# ========================================
DB_HOST=localhost
DB_PORT=3306
DB_NAME=pbx_api_db
DB_USER=pbx_api_user
DB_PASSWORD=<STRONG_PASSWORD_HERE>

# ========================================
# JWT & AUTHENTICATION
# ========================================
JWT_SECRET=<RANDOM_64_CHAR_STRING>
JWT_EXPIRY=24h

# ========================================
# ADMIN CREDENTIALS
# ========================================
ADMIN_USERNAME=pbx_admin
ADMIN_PASSWORD=<STRONG_ADMIN_PASSWORD>

# ========================================
# ASTERISK AMI CONFIGURATION
# ========================================
AMI_HOST=localhost
AMI_PORT=5038
AMI_USERNAME=pbx_ami_user
AMI_SECRET=YOUR_AMI_SECRET

# ========================================
# SERVER CONFIGURATION
# ========================================
PORT=3003
NODE_ENV=production
SERVER_IP=0.0.0.0

# ========================================
# ASTERISK PATHS
# ========================================
ASTERISK_CONFIG_PATH=/etc/asterisk
ASTERISK_SPOOL_PATH=/var/spool/asterisk
```

**Generate strong secrets:**

```bash
# Generate JWT secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Generate admin password
openssl rand -base64 32
```

---

## Database Setup

### 1. Secure MariaDB Installation

```bash
sudo mysql_secure_installation
```

Follow prompts:
- Set root password
- Remove anonymous users
- Disallow root login remotely
- Remove test database
- Reload privilege tables

### 2. Create Database and User

```bash
sudo mysql -u root -p
```

```sql
-- Create database
CREATE DATABASE pbx_api_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Create user
CREATE USER 'pbx_api_user'@'localhost' IDENTIFIED BY 'YOUR_STRONG_PASSWORD';

-- Grant privileges
GRANT ALL PRIVILEGES ON pbx_api_db.* TO 'pbx_api_user'@'localhost';
FLUSH PRIVILEGES;

-- Verify
SHOW DATABASES;
SELECT User, Host FROM mysql.user WHERE User = 'pbx_api_user';

EXIT;
```

### 3. Run Database Migrations

```bash
cd /opt/pbx-api

# Run migrations (creates all tables)
npx sequelize-cli db:migrate

# Verify tables
mysql -u pbx_api_user -p pbx_api_db -e "SHOW TABLES;"
```

**Tables created:**
- organizations
- users
- sip_trunks
- did_numbers
- routing_rules
- queues
- queue_members
- webhooks
- call_records
- ivrs
- ivr_menus
- outbound_routes
- global_settings

---

## Asterisk Configuration

### 1. Configure AMI Access

```bash
sudo nano /etc/asterisk/manager.conf
```

Add AMI user:

```ini
[general]
enabled = yes
bindaddr = 127.0.0.1
port = 5038
webenabled = yes
timestampevents = yes

[pbx_ami_user]
secret = YOUR_AMI_SECRET
deny = 0.0.0.0/0.0.0.0
permit = 127.0.0.0/255.255.255.0
read = all
write = all
```

### 2. Set File Permissions

```bash
# Allow API to write Asterisk configs
sudo chown -R asterisk:asterisk /etc/asterisk
sudo chmod 755 /etc/asterisk
sudo chmod 644 /etc/asterisk/*.conf

# Add your user to asterisk group (optional)
sudo usermod -a -G asterisk $USER
```

### 3. Restart Asterisk

```bash
sudo systemctl restart asterisk
sudo systemctl status asterisk
```

### 4. Verify AMI Connection

```bash
# Test AMI connection
telnet localhost 5038
```

You should see:
```
Asterisk Call Manager/X.X
```

Type `quit` to exit.

---

## Production Deployment

### Option 1: PM2 (Recommended)

#### Install PM2

```bash
sudo npm install -g pm2
```

#### Start Application

```bash
cd /opt/pbx-api

# Start with PM2
pm2 start src/server.js --name pbx-api

# Save PM2 config
pm2 save

# Setup PM2 startup script
pm2 startup systemd
# Run the command shown by PM2

# Monitor
pm2 status
pm2 logs pbx-api
pm2 monit
```

#### PM2 Commands

```bash
# Restart
pm2 restart pbx-api

# Stop
pm2 stop pbx-api

# View logs
pm2 logs pbx-api --lines 100

# Flush logs
pm2 flush

# Delete
pm2 delete pbx-api
```

### Option 2: Systemd Service

#### Create Service File

```bash
sudo nano /etc/systemd/system/pbx-api.service
```

```ini
[Unit]
Description=PBX API Server
Documentation=https://github.com/saynth-ai/asterisk-api
After=network.target mariadb.service asterisk.service
Wants=mariadb.service asterisk.service

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=/opt/pbx-api
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=pbx-api

Environment=NODE_ENV=production
EnvironmentFile=/opt/pbx-api/.env

# Security
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

#### Enable and Start Service

```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable service
sudo systemctl enable pbx-api

# Start service
sudo systemctl start pbx-api

# Check status
sudo systemctl status pbx-api

# View logs
sudo journalctl -u pbx-api -f
```

### Option 3: Docker (Optional)

#### Create Dockerfile

```bash
cat > /opt/pbx-api/Dockerfile <<'EOF'
FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --production

# Copy application
COPY . .

# Expose port
EXPOSE 3003

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD curl -f http://localhost:3003/health || exit 1

# Start application
CMD ["node", "src/server.js"]
EOF
```

#### Build and Run

```bash
# Build image
docker build -t pbx-api:latest /opt/pbx-api

# Run container
docker run -d \
  --name pbx-api \
  --restart unless-stopped \
  -p 3003:3003 \
  -v /opt/pbx-api/.env:/app/.env:ro \
  -v /etc/asterisk:/etc/asterisk \
  pbx-api:latest

# View logs
docker logs -f pbx-api
```

---

## Verification

### 1. Health Check

```bash
curl http://localhost:3003/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2025-10-03T...",
  "uptime": 123.45
}
```

### 2. API Documentation

```bash
# Open in browser
http://YOUR_SERVER_IP:3003/api
```

### 3. Admin Login Test

```bash
curl -X POST http://localhost:3003/api/v1/admin/auth \
  -H "Content-Type: application/json" \
  -d '{
    "admin_username": "pbx_admin",
    "admin_password": "YOUR_ADMIN_PASSWORD"
  }'
```

Expected response:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "24h"
}
```

### 4. Database Connection

```bash
# Check database tables
mysql -u pbx_api_user -p pbx_api_db -e "SHOW TABLES;"
```

### 5. Asterisk AMI Connection

Check server logs:
```bash
# PM2
pm2 logs pbx-api | grep AMI

# Systemd
journalctl -u pbx-api | grep AMI
```

Should see: `✅ AMI Connected successfully`

---

## Security Hardening

### 1. Firewall Configuration

```bash
# Allow SSH
sudo ufw allow 22/tcp

# Allow API port
sudo ufw allow 3003/tcp

# Allow SIP (if needed)
sudo ufw allow 5060/udp
sudo ufw allow 10000:20000/udp

# Enable firewall
sudo ufw enable
sudo ufw status
```

### 2. SSL/TLS with Nginx

#### Install Nginx

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

#### Configure Nginx

```bash
sudo nano /etc/nginx/sites-available/pbx-api
```

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3003;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

#### Enable Site

```bash
sudo ln -s /etc/nginx/sites-available/pbx-api /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

#### Install SSL Certificate

```bash
sudo certbot --nginx -d your-domain.com
```

### 3. Environment File Security

```bash
sudo chmod 600 /opt/pbx-api/.env
sudo chown root:root /opt/pbx-api/.env
```

---

## Troubleshooting

### Common Issues

#### 1. Database Connection Failed

```bash
# Check MariaDB is running
sudo systemctl status mariadb

# Test connection
mysql -u pbx_api_user -p pbx_api_db

# Check credentials in .env file
cat /opt/pbx-api/.env | grep DB_
```

#### 2. AMI Connection Failed

```bash
# Check Asterisk is running
sudo systemctl status asterisk

# Test AMI port
telnet localhost 5038

# Check AMI configuration
sudo asterisk -rx "manager show users"

# Check credentials in .env
cat /opt/pbx-api/.env | grep AMI_
```

#### 3. Port Already in Use

```bash
# Check what's using port 3003
sudo lsof -i :3003

# Kill process if needed
sudo kill -9 <PID>

# Or change port in .env
nano /opt/pbx-api/.env
# Change: PORT=3004
```

#### 4. Permission Denied Errors

```bash
# Fix Asterisk config permissions
sudo chown -R asterisk:asterisk /etc/asterisk
sudo chmod 755 /etc/asterisk

# Add user to asterisk group
sudo usermod -a -G asterisk $USER
```

### Logs

```bash
# PM2 logs
pm2 logs pbx-api --lines 100

# Systemd logs
sudo journalctl -u pbx-api -f --lines=100

# Asterisk logs
sudo tail -f /var/log/asterisk/full

# MariaDB logs
sudo tail -f /var/log/mysql/error.log
```

---

## Maintenance

### Backup

```bash
# Backup database
mysqldump -u pbx_api_user -p pbx_api_db > backup_$(date +%Y%m%d).sql

# Backup .env file
cp /opt/pbx-api/.env /opt/pbx-api/.env.backup

# Backup Asterisk configs
tar -czf asterisk_backup_$(date +%Y%m%d).tar.gz /etc/asterisk/
```

### Updates

```bash
cd /opt/pbx-api

# Pull latest changes
git pull origin master

# Install new dependencies
npm install --production

# Run migrations
npx sequelize-cli db:migrate

# Restart service
pm2 restart pbx-api
# OR
sudo systemctl restart pbx-api
```

---

## Support

- **Documentation**: https://github.com/saynth-ai/asterisk-api
- **Issues**: https://github.com/saynth-ai/asterisk-api/issues
- **API Docs**: http://YOUR_SERVER:3003/api

---

## License

MIT License - See LICENSE file for details
