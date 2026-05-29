#!/bin/bash

################################################################################
# PBX API Bootstrap Script
#
# This script automates the complete installation and configuration of:
# - Node.js 20.x
# - MariaDB 10.5+
# - Asterisk 20.x with PJSIP
# - Nginx with SSL support
# - PBX API application
#
# Usage: sudo bash bootstrap.sh
################################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   log_error "This script must be run as root (use sudo)"
   exit 1
fi

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
    OS_VERSION=$VERSION_ID
else
    log_error "Cannot detect OS. /etc/os-release not found."
    exit 1
fi

log_info "Detected OS: $OS $OS_VERSION"

################################################################################
# System Update
################################################################################
log_info "Updating system packages..."
if [[ "$OS" == "ubuntu" ]] || [[ "$OS" == "debian" ]]; then
    apt update && apt upgrade -y
elif [[ "$OS" == "centos" ]] || [[ "$OS" == "rhel" ]] || [[ "$OS" == "rocky" ]]; then
    yum update -y
else
    log_error "Unsupported OS: $OS"
    exit 1
fi
log_success "System updated"

################################################################################
# Install Node.js 20.x
################################################################################
log_info "Installing Node.js 20.x..."
if [[ "$OS" == "ubuntu" ]] || [[ "$OS" == "debian" ]]; then
    # Install dependencies
    apt install -y curl gnupg2 ca-certificates

    # Add NodeSource repository
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -

    # Install Node.js
    apt install -y nodejs

elif [[ "$OS" == "centos" ]] || [[ "$OS" == "rhel" ]] || [[ "$OS" == "rocky" ]]; then
    # Add NodeSource repository
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -

    # Install Node.js
    yum install -y nodejs
fi

# Verify installation
NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)
log_success "Node.js installed: $NODE_VERSION"
log_success "npm installed: $NPM_VERSION"

################################################################################
# Install MariaDB
################################################################################
log_info "Installing MariaDB..."
if [[ "$OS" == "ubuntu" ]] || [[ "$OS" == "debian" ]]; then
    apt install -y mariadb-server mariadb-client
elif [[ "$OS" == "centos" ]] || [[ "$OS" == "rhel" ]] || [[ "$OS" == "rocky" ]]; then
    yum install -y mariadb-server mariadb
fi

# Start and enable MariaDB
systemctl start mariadb
systemctl enable mariadb
log_success "MariaDB installed and started"

################################################################################
# Install Asterisk 20
################################################################################
log_info "Installing Asterisk 20..."
if [[ "$OS" == "ubuntu" ]] || [[ "$OS" == "debian" ]]; then
    # Install dependencies
    apt install -y build-essential wget libssl-dev libncurses5-dev \
        libnewt-dev libxml2-dev linux-headers-$(uname -r) libsqlite3-dev \
        uuid-dev libjansson-dev libedit-dev pkg-config

    # Download Asterisk
    cd /usr/src
    if [ ! -f asterisk-20-current.tar.gz ]; then
        wget https://downloads.asterisk.org/pub/telephony/asterisk/asterisk-20-current.tar.gz
    fi

    # Extract
    tar xvf asterisk-20-current.tar.gz
    cd asterisk-20*/

    # Install prerequisites
    contrib/scripts/install_prereq install

    # Configure
    ./configure --with-jansson-bundled

    # Select modules (minimal install)
    make menuselect.makeopts
    menuselect/menuselect --enable BETTER_BACKTRACES menuselect.makeopts

    # Compile and install
    make -j$(nproc)
    make install
    make samples
    make config

    # Create asterisk user
    groupadd -f asterisk
    useradd -r -d /var/lib/asterisk -g asterisk asterisk 2>/dev/null || true

    # Set permissions
    chown -R asterisk:asterisk /etc/asterisk
    chown -R asterisk:asterisk /var/{lib,log,spool}/asterisk
    chown -R asterisk:asterisk /usr/lib/asterisk

    # Configure Asterisk to run as asterisk user
    sed -i 's/#AST_USER="asterisk"/AST_USER="asterisk"/' /etc/default/asterisk
    sed -i 's/#AST_GROUP="asterisk"/AST_GROUP="asterisk"/' /etc/default/asterisk

elif [[ "$OS" == "centos" ]] || [[ "$OS" == "rhel" ]] || [[ "$OS" == "rocky" ]]; then
    # Install dependencies
    yum groupinstall -y "Development Tools"
    yum install -y wget openssl-devel ncurses-devel newt-devel libxml2-devel \
        kernel-devel sqlite-devel libuuid-devel jansson-devel libedit-devel

    # Download and install (same as above)
    cd /usr/src
    if [ ! -f asterisk-20-current.tar.gz ]; then
        wget https://downloads.asterisk.org/pub/telephony/asterisk/asterisk-20-current.tar.gz
    fi
    tar xvf asterisk-20-current.tar.gz
    cd asterisk-20*/
    contrib/scripts/install_prereq install
    ./configure --with-jansson-bundled
    make menuselect.makeopts
    make -j$(nproc)
    make install
    make samples
    make config

    groupadd -f asterisk
    useradd -r -d /var/lib/asterisk -g asterisk asterisk 2>/dev/null || true
    chown -R asterisk:asterisk /etc/asterisk
    chown -R asterisk:asterisk /var/{lib,log,spool}/asterisk
fi

# Start and enable Asterisk
systemctl start asterisk
systemctl enable asterisk
log_success "Asterisk installed and started"

# Verify Asterisk
sleep 5
if systemctl is-active --quiet asterisk; then
    ASTERISK_VERSION=$(asterisk -V)
    log_success "$ASTERISK_VERSION running"
else
    log_warning "Asterisk service may not be running properly"
fi

################################################################################
# Install Nginx
################################################################################
log_info "Installing Nginx..."
if [[ "$OS" == "ubuntu" ]] || [[ "$OS" == "debian" ]]; then
    apt install -y nginx certbot python3-certbot-nginx
elif [[ "$OS" == "centos" ]] || [[ "$OS" == "rhel" ]] || [[ "$OS" == "rocky" ]]; then
    yum install -y nginx certbot python3-certbot-nginx
fi

# Start and enable Nginx
systemctl start nginx
systemctl enable nginx
log_success "Nginx installed and started"

################################################################################
# Install PM2 (Process Manager)
################################################################################
log_info "Installing PM2..."
npm install -g pm2
pm2 startup systemd -u root --hp /root
log_success "PM2 installed"

################################################################################
# Configure Firewall
################################################################################
log_info "Configuring firewall..."
if command -v ufw &> /dev/null; then
    # Ubuntu/Debian UFW
    ufw allow 22/tcp    # SSH
    ufw allow 80/tcp    # HTTP
    ufw allow 443/tcp   # HTTPS
    ufw allow 5060/udp  # SIP
    ufw allow 5061/tcp  # SIP TLS
    ufw allow 10000:20000/udp  # RTP
    ufw --force enable
    log_success "UFW firewall configured"
elif command -v firewall-cmd &> /dev/null; then
    # CentOS/RHEL firewalld
    firewall-cmd --permanent --add-service=ssh
    firewall-cmd --permanent --add-service=http
    firewall-cmd --permanent --add-service=https
    firewall-cmd --permanent --add-port=5060/udp
    firewall-cmd --permanent --add-port=5061/tcp
    firewall-cmd --permanent --add-port=10000-20000/udp
    firewall-cmd --reload
    log_success "Firewalld configured"
else
    log_warning "No firewall detected. Please configure manually."
fi

################################################################################
# Setup PBX API Application
################################################################################
log_info "Setting up PBX API application..."

# Clone or update repository
if [ -d "/opt/pbx-api" ]; then
    log_info "Updating existing installation..."
    cd /opt/pbx-api
    git pull origin master
else
    log_info "Cloning repository..."
    cd /opt
    git clone https://github.com/saynth-ai/asterisk-api.git pbx-api
    cd pbx-api
fi

# Install Node dependencies
log_info "Installing Node.js dependencies..."
npm install --production

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    log_info "Creating .env configuration file..."

    # Generate random secrets
    DB_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
    JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
    ADMIN_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
    AMI_SECRET=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-20)

    cat > .env <<EOF
# Database Configuration
DB_HOST=localhost
DB_PORT=3306
DB_NAME=pbx_api_db
DB_USER=pbx_api_user
DB_PASSWORD=${DB_PASSWORD}
DB_DIALECT=mariadb

# Server Configuration
PORT=3000
HOST=127.0.0.1
NODE_ENV=production
API_PREFIX=/api/v1

# Swagger Domain Configuration (update with your domain)
SWAGGER_DOMAIN=

# Asterisk Configuration
ASTERISK_HOST=localhost
ASTERISK_PORT=8088
ASTERISK_USERNAME=pbx_api
ASTERISK_SECRET=pbx_api_secret
ASTERISK_APP_NAME=pbx_api

# Asterisk Manager Interface (AMI) Configuration
AMI_HOST=localhost
AMI_PORT=5038
AMI_USERNAME=pbx_ami_user
AMI_SECRET=${AMI_SECRET}

# Redis Configuration (optional)
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT Configuration
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRY=24h

# Webhook Configuration
WEBHOOK_SECRET=webhook_default_secret_key

# File Storage
RECORDINGS_PATH=/var/spool/asterisk/monitor
UPLOADS_PATH=/tmp/pbx_uploads

# Security
BCRYPT_ROUNDS=12
API_RATE_LIMIT=100

# Admin Credentials
ADMIN_USERNAME=pbx_admin
ADMIN_PASSWORD=${ADMIN_PASSWORD}

# Logging
LOG_LEVEL=info
LOG_FILE=logs/pbx_api.log
EOF

    chmod 600 .env
    log_success ".env file created with random secrets"
    log_warning "⚠️  IMPORTANT: Save these credentials!"
    log_warning "Admin Username: pbx_admin"
    log_warning "Admin Password: ${ADMIN_PASSWORD}"
    log_warning "Database Password: ${DB_PASSWORD}"
else
    log_info ".env file already exists, skipping creation"
fi

################################################################################
# Configure Database
################################################################################
log_info "Configuring database..."

# Load DB credentials from .env
export $(grep -v '^#' .env | xargs)

# Create database and user
mysql -u root <<EOF
CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
EOF

log_success "Database created: ${DB_NAME}"

# Run migrations (if you have sequelize-cli configured)
if [ -f "package.json" ] && grep -q "sequelize-cli" package.json; then
    log_info "Running database migrations..."
    npx sequelize-cli db:migrate
    log_success "Database migrations completed"
fi

################################################################################
# Configure Asterisk AMI
################################################################################
log_info "Configuring Asterisk AMI..."

AMI_USERNAME=$(grep AMI_USERNAME .env | cut -d'=' -f2)
AMI_SECRET=$(grep AMI_SECRET .env | cut -d'=' -f2)

cat > /etc/asterisk/manager.conf <<EOF
[general]
enabled = yes
bindaddr = 127.0.0.1
port = 5038
webenabled = yes
timestampevents = yes

[${AMI_USERNAME}]
secret = ${AMI_SECRET}
deny = 0.0.0.0/0.0.0.0
permit = 127.0.0.0/255.255.255.0
read = all
write = all
EOF

chown asterisk:asterisk /etc/asterisk/manager.conf
chmod 640 /etc/asterisk/manager.conf

systemctl restart asterisk
log_success "Asterisk AMI configured"

################################################################################
# Start PBX API with PM2
################################################################################
log_info "Starting PBX API with PM2..."
cd /opt/pbx-api
pm2 delete pbx-api 2>/dev/null || true
pm2 start src/server.js --name pbx-api
pm2 save
log_success "PBX API started"

################################################################################
# Install Nginx Configuration (if exists)
################################################################################
if [ -f nginx-pbx.talknetics.com.conf ]; then
    log_info "Installing Nginx configuration..."
    cp nginx-pbx.talknetics.com.conf /etc/nginx/sites-available/pbx-api
    ln -sf /etc/nginx/sites-available/pbx-api /etc/nginx/sites-enabled/
    nginx -t && systemctl reload nginx
    log_success "Nginx configuration installed"
fi

################################################################################
# Summary
################################################################################
echo ""
log_success "╔═══════════════════════════════════════════════════════════════╗"
log_success "║          PBX API Installation Complete! 🎉                   ║"
log_success "╚═══════════════════════════════════════════════════════════════╝"
echo ""
log_info "Installed Components:"
echo "  ✓ Node.js $(node --version)"
echo "  ✓ npm $(npm --version)"
echo "  ✓ MariaDB $(mysql --version | awk '{print $5}' | cut -d',' -f1)"
echo "  ✓ Asterisk $(asterisk -V | awk '{print $2}')"
echo "  ✓ Nginx $(nginx -v 2>&1 | awk '{print $3}')"
echo "  ✓ PM2 $(pm2 --version)"
echo ""
log_info "Service Status:"
systemctl is-active --quiet mariadb && echo "  ✓ MariaDB: Running" || echo "  ✗ MariaDB: Stopped"
systemctl is-active --quiet asterisk && echo "  ✓ Asterisk: Running" || echo "  ✗ Asterisk: Stopped"
systemctl is-active --quiet nginx && echo "  ✓ Nginx: Running" || echo "  ✗ Nginx: Stopped"
pm2 list | grep -q pbx-api && echo "  ✓ PBX API: Running" || echo "  ✗ PBX API: Stopped"
echo ""
log_info "Next Steps:"
echo "  1. Update SWAGGER_DOMAIN in /opt/pbx-api/.env with your domain"
echo "  2. Configure SSL: sudo certbot --nginx -d yourdomain.com"
echo "  3. Access API: http://$(hostname -I | awk '{print $1}'):3000/api"
echo "  4. Access Nginx: http://$(hostname -I | awk '{print $1}')"
echo ""
log_info "Important Credentials (saved in /opt/pbx-api/.env):"
if [ -n "$ADMIN_PASSWORD" ]; then
    echo "  Admin Username: pbx_admin"
    echo "  Admin Password: ${ADMIN_PASSWORD}"
    echo "  Database User: ${DB_USER}"
    echo "  Database Password: ${DB_PASSWORD}"
fi
echo ""
log_warning "⚠️  Save these credentials in a secure location!"
echo ""
log_info "Useful Commands:"
echo "  • View API logs: pm2 logs pbx-api"
echo "  • Restart API: pm2 restart pbx-api"
echo "  • Check Asterisk: asterisk -rvvv"
echo "  • View Nginx logs: tail -f /var/log/nginx/access.log"
echo ""
log_success "Installation script completed successfully!"
