# Astradial

Open-source cloud PBX platform. Phone numbers, call routing, CRM, AI bots, and automation in one system.

Self-host or use [Astradial Cloud](https://astradial.com).

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
cp .env.example .env
docker compose up
```

Open [http://localhost:3001](http://localhost:3001). Login with `admin` / `admin`.

Two test extensions (1001, 1002) are pre-configured. Register a softphone (Zoiper, Opal) to make calls between them.

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
- Email: [support@astradial.com](mailto:support@astradial.com)
