# Contributing to Astradial

Thanks for your interest in contributing. Here's how to get started.

## Development setup

```bash
# Clone the repo
git clone https://github.com/astradial/astradial
cd astradial

# Start backend services
cp .env.example .env
docker compose up mariadb redis asterisk api workflow-engine

# Run editor in dev mode (hot reload)
cd editor
npm install
npm run dev
```

Editor runs at http://localhost:3001 with hot reload. Backend services run in Docker.

## Git workflow

```
feature/your-feature  →  PR to staging  →  test  →  PR to main  →  release
```

1. Create a branch from `staging`: `git checkout -b feature/your-feature staging`
2. Make your changes
3. Run type check: `cd editor && npx tsc --noEmit`
4. Commit with conventional format (see below)
5. Push and create a PR to `staging`
6. After review and testing, PR from `staging` to `main`

Never push directly to `staging` or `main`.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org):

```
feat: add WhatsApp template management
fix: call recording not starting on queue calls
docs: update API authentication guide
refactor: extract queue service from server.js
```

## Code style

- **TypeScript** for all frontend code
- **shadcn/ui components only** — no custom UI components
- **No custom colors** — use shadcn/ui default theme (default, secondary, outline, destructive)
- **No emojis** in code or UI unless explicitly requested
- Keep files focused — one component per file

## What to work on

Check [GitHub Issues](https://github.com/astradial/astradial/issues) for open tasks. Look for labels:

- `good first issue` — small, well-defined tasks for new contributors
- `help wanted` — bigger features that need contributors
- `bug` — confirmed bugs

## Project structure

```
astradial/
├── editor/          # Next.js frontend (dashboard, CRM, etc.)
├── api/             # Node.js API server (AstraPBX)
├── asterisk/        # Asterisk PBX Docker config
├── workflow-engine/ # Bull job scheduler
├── docker-compose.yml
└── .env.example
```

## Questions?

Open a [Discussion](https://github.com/astradial/astradial/discussions) on GitHub.
