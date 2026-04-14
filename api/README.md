# Multi-Tenant PBX API

A comprehensive REST API for managing multi-tenant Asterisk PBX systems with advanced call routing, IVR, queues, and real-time call control.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Asterisk](https://img.shields.io/badge/asterisk-%3E%3D18.0-orange.svg)](https://www.asterisk.org/)

---

## 🚀 Features

### Core Functionality
- **Multi-Tenant Architecture** - Complete isolation between organizations
- **RESTful API** - Clean, documented API endpoints  
- **Authentication & Authorization** - JWT-based with admin and organization-level access
- **Real-Time Call Control** - Manage active calls via Asterisk AMI
- **Global Settings Management** - Configure Asterisk system-wide settings via API

### Telephony Features
- **SIP Trunk Management** - Configure inbound/outbound SIP trunks
- **DID Number Routing** - Flexible routing to extensions, queues, IVRs, or AI agents
- **User Provisioning** - Automatic SIP endpoint configuration
- **Queue Management** - Call queues with member management
- **IVR (Interactive Voice Response)** - Multi-level menu systems
- **Outbound Routing** - Pattern-based call routing
- **Call Recording** - Enable/disable per call or organization
- **Webhook Notifications** - Real-time event notifications

### Advanced Features
- **AI Agent Integration** - Route calls to AI voice agents
- **Click-to-Call** - Initiate calls between any two numbers
- **Live Call Statistics** - Real-time call monitoring
- **Configuration Deployment** - One-click deployment to Asterisk
- **AMI-Based Reloads** - Zero-downtime configuration updates

---

## ⚡ Quick Start

### Prerequisites

- Node.js 18+
- MariaDB/MySQL 10.5+
- Asterisk 18+ with PJSIP
- Git

### Installation

```bash
# Clone repository
git clone https://github.com/saynth-ai/asterisk-api.git
cd asterisk-api

# Install dependencies
npm install

# Configure environment
cp .env.example .env
nano .env

# Setup database
npx sequelize-cli db:migrate

# Start server
npm start
```

### Access

- **API Server**: http://localhost:3003
- **API Documentation**: http://localhost:3003/api
- **Health Check**: http://localhost:3003/health

---

## 📚 Documentation

- **[Installation Guide](INSTALLATION.md)** - Complete installation and setup instructions
- **[API Documentation](http://localhost:3003/api)** - Interactive Swagger UI
- **[Architecture](docs/ARCHITECTURE.md)** - System architecture and design

---

## 📋 API Quick Reference

### Authentication

**Admin Login**
```bash
curl -X POST http://localhost:3003/api/v1/admin/auth \
  -H "Content-Type: application/json" \
  -d '{"admin_username":"pbx_admin","admin_password":"your_password"}'
```

**Organization Auth**
```bash
curl -X POST http://localhost:3003/api/v1/auth \
  -H "X-API-Key: your_key" \
  -H "X-API-Secret: your_secret"
```

### Key Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/organizations` | POST | Create organization (Admin) |
| `/api/v1/trunks` | POST | Create SIP trunk |
| `/api/v1/dids` | POST | Configure DID routing |
| `/api/v1/users` | POST | Create user/extension |
| `/api/v1/queues` | POST | Create call queue |
| `/api/v1/deploy/{orgId}` | POST | Deploy configuration |
| `/api/v1/calls/live` | GET | Get live calls |
| `/api/v1/admin/settings` | PUT | Update global settings |
| `/api/v1/admin/settings/deploy` | POST | Deploy global config |

---

## 🏗️ Architecture

```
┌─────────────┐
│   REST API  │
│  (Express)  │
└──────┬──────┘
       │
       ├──────────────────────────────┐
       │                              │
┌──────▼──────┐              ┌────────▼────────┐
│   MariaDB   │              │    Asterisk     │
│  (Storage)  │              │   (PJSIP/AMI)   │
└─────────────┘              └─────────────────┘
```

**Multi-Tenant Isolation:**
- Database level (org_id)
- Asterisk context level (context_prefix)
- Authentication level (API keys)

---

## 🚀 Production Deployment

### With PM2

```bash
# Install PM2
npm install -g pm2

# Start application
pm2 start src/server.js --name pbx-api

# Setup auto-start
pm2 startup
pm2 save
```

### With Systemd

```bash
# Create service file
sudo nano /etc/systemd/system/pbx-api.service

# Enable and start
sudo systemctl enable pbx-api
sudo systemctl start pbx-api
```

See [INSTALLATION.md](INSTALLATION.md) for detailed deployment instructions.

---

## 💻 Development

### Project Structure

```
asterisk-api/
├── src/
│   ├── server.js              # Main application
│   ├── models/                # Sequelize models
│   └── services/              # Business logic
│       ├── asterisk/          # Asterisk integration
│       └── deployment/        # Config deployment
├── docs/
│   ├── API_SPECIFICATION.yaml # OpenAPI spec
│   └── ARCHITECTURE.md        # Architecture docs
├── .env                       # Environment config
├── package.json
├── INSTALLATION.md
└── README.md
```

### Running Locally

```bash
npm install
npm start
```

Visit http://localhost:3003/api for API documentation.

---

## 🐛 Troubleshooting

**Database Connection Failed**
```bash
systemctl status mariadb
mysql -u pbx_api_user -p pbx_api_db
```

**AMI Connection Failed**
```bash
systemctl status asterisk
telnet localhost 5038
```

**Port Already in Use**
```bash
lsof -i :3003
kill -9 <PID>
```

See [INSTALLATION.md](INSTALLATION.md) for more troubleshooting tips.

---

## 🤝 Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

## 📞 Support

- **Installation Help**: [INSTALLATION.md](INSTALLATION.md)
- **API Docs**: http://localhost:3003/api
- **Issues**: [GitHub Issues](https://github.com/saynth-ai/asterisk-api/issues)

---

## 🎯 Roadmap

**v1.0 (Current)**
- ✅ Multi-tenant management
- ✅ SIP trunk & DID routing
- ✅ User provisioning
- ✅ Queue & IVR management
- ✅ Live call monitoring
- ✅ Global settings API

**v2.0 (Planned)**
- ⬜ WebRTC support
- ⬜ Advanced analytics
- ⬜ Recording management UI
- ⬜ CDR API
- ⬜ Billing integration

---

<p align="center">Made with ❤️ by Astra AI</p>
<p align="center">
  <a href="https://github.com/saynth-ai/asterisk-api">GitHub</a> •
  <a href="https://github.com/saynth-ai/asterisk-api/issues">Issues</a> •
  <a href="LICENSE">License</a>
</p>
