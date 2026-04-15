# Astradial

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

- [GitHub Discussions](https://github.com/astradial/astradial/discussions)
- [Documentation](https://docs.astradial.com)
- Email: [cats@astradial.com](mailto:cats@astradial.com)
