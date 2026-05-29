# Astradial

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/astradial/astradial?style=social)](https://github.com/astradial/astradial/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/astradial/astradial)](https://github.com/astradial/astradial/issues)
[![GitHub PRs](https://img.shields.io/github/issues-pr/astradial/astradial)](https://github.com/astradial/astradial/pulls)
[![Contributors](https://img.shields.io/github/contributors/astradial/astradial)](https://github.com/astradial/astradial/graphs/contributors)
[![Last commit](https://img.shields.io/github/last-commit/astradial/astradial)](https://github.com/astradial/astradial/commits/main)

Everything your business needs to talk to customers — phone numbers, call queues, CRM, AI bots. One app, open source.

Astradial is an open-source phone system for businesses. It handles call routing, CRM, AI voice bots, and automation — all in one app you can self-host with Docker.

## Features

- **Phone number management** — buy numbers from marketplace or bring your own SIP trunk
- **Call routing** — route calls to extensions, queues, IVR menus, AI bots, or external numbers
- **Call queues** — ring groups with agent management and music on hold
- **Mini CRM** — clients, leads pipeline, deals pipeline, custom fields
- **AI voice bots** — connect calls to AI agents via WebSocket (OpenAI, Deepgram, etc.)
- **Tickets** — auto-created from missed calls, bot interactions, queue timeouts
- **Workflow automation** — visual builder for automated actions
- **API & webhooks** — click-to-call, originate-to-AI, call management APIs
- **Role-based access** — owner, admin, manager, agent with granular permissions
- **Call recording** — with consent modes (announcement, opt-in, opt-out)
- **Mobile responsive** — works on desktop, tablet, and phone

## Quick start

```bash
git clone https://github.com/astradial/astradial
cd astradial
./setup.sh
```

The setup script asks:
- Your admin email and password
- Whether you're on **Linux/VPS** or **Mac/Windows**

**Linux/VPS:** Full setup — Asterisk runs in Docker. Create extensions, make calls, everything works.

**Mac/Windows:** Uses Astradial Cloud for SIP. Email [cats@astradial.com](mailto:cats@astradial.com) for free SIP credentials (1 phone number, 1 extension, 30 days). Everything else runs locally — CRM, dashboard, API, workflows.

Then:
1. Open **http://localhost:3001** → Admin tab → login
2. Create an organisation → enter it
3. Explore: Users, CRM, Calls, Phone Numbers, Queues

## Auth modes

Two ways to authenticate the editor + API, controlled by `USE_FIREBASE` in `.env`:

- **Local mode (default, `USE_FIREBASE=false`)** — log in with your organisation's `api_key` + `api_secret`. The API verifies them server-side via bcrypt against the `organizations` table, returns a JWT. No external dependencies.
- **Firebase mode (`USE_FIREBASE=true`)** — bring your own Firebase project and set `NEXT_PUBLIC_FIREBASE_*` env vars. Use email/password login. Required for some features (real-time ticket badge, phonebook persistence) that haven't yet migrated off Firestore.

The OSS default is local mode — Firebase is opt-in for users who want it. See `.env.example` for the env vars each mode needs.

### Optional integrations

All env-gated. Features hide in the UI when the corresponding env var is unset:

| Integration | Env var | What it powers |
|---|---|---|
| MSG91 WhatsApp | `MSG91_ADMIN_AUTH_KEY` | Daily WhatsApp ticket alerts, admin WhatsApp config |
| Google Cloud TTS | `GOOGLE_APPLICATION_CREDENTIALS` | IVR greeting audio synthesis |
| Google Cloud Storage | `GCS_BUCKET` | Cloud recording storage (falls back to local disk if unset) |

## 3 ways to connect calls

### 1. Self-hosted (bring your own SIP trunk)

Connect any SIP provider — Twilio, Telnyx, VoIP.ms, or your local telco.

Go to **Trunks** → Add your provider credentials → Add your DIDs → Configure routing → Deploy.

### 2. Astradial Cloud (managed service)

Sign up at [astradial.com](https://astradial.com). Buy Indian phone numbers from the marketplace. No infrastructure to manage.

### 3. Developer trial (free)

Get a free Indian DID with 1 channel for 30 days. Sign up at [astradial.com/developers](https://astradial.com/developers).

```bash
# Add your developer credentials to .env
ASTRADIAL_MODE=developer
ASTRADIAL_TRUNK_HOST=pbx.astradial.com
ASTRADIAL_TRUNK_USER=dev_your_username
ASTRADIAL_TRUNK_PASS=your_password

docker compose up
```

Call your assigned number from any phone — it rings in your local setup.

## Architecture

```
┌────────────┐     ┌────────────┐     ┌────────────┐
│   Editor   │────►│    API     │────►│  Asterisk  │
│  (Next.js) │     │ (Node.js)  │     │   (PBX)    │
│  port 3001 │     │  port 8000 │     │ port 5060  │
└────────────┘     └─────┬──────┘     └────────────┘
                         │
                   ┌─────┴──────┐
                   │            │
              ┌────▼───┐  ┌────▼────┐
              │MariaDB │  │  Redis  │
              │  3306  │  │  6379   │
              └────────┘  └─────────┘
```

## Tech stack

- **Frontend**: Next.js 16, React 19, TypeScript, shadcn/ui, Tailwind CSS
- **Backend**: Node.js, Express, Sequelize ORM
- **PBX**: Asterisk 20 (PJSIP)
- **Database**: MariaDB 11
- **Cache**: Redis 7
- **Drag-drop**: dnd-kit

## Documentation

[docs.astradial.com](https://docs.astradial.com)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[AGPL-3.0](LICENSE)

## Community

- 💬 [WhatsApp Group](https://chat.whatsapp.com/EvFHEFLEwOPGNzyhG5QH2s?mode=gi_t) — chat with contributors and maintainers
- [GitHub Discussions](https://github.com/astradial/astradial/discussions)
- [Documentation](https://docs.astradial.com)
- Email: [cats@astradial.com](mailto:cats@astradial.com)
