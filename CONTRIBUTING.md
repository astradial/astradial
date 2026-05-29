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
fork  →  feature branch from main  →  PR to main  →  review + test  →  merge
```

1. **Fork** the repo on GitHub
2. **Clone your fork** and create a branch from `main`:
   ```bash
   git checkout -b feat/your-feature main
   ```
3. **Make your changes**
4. **Run type check** (if touching the editor): `cd editor && npx tsc --noEmit`
5. **Commit** with conventional format (see below)
6. **Push** to your fork and **open a PR** targeting the `main` branch
7. Maintainer reviews, tests, and merges

**PRs go directly to `main`.** Main is protected — only approved PRs can merge. Maintainers test the PR (locally or on open.astradial.com) before approving.

> ℹ️ We previously used a `staging → main` flow. As of April 2026, we simplified to single-branch. Open PRs to `main` directly.

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
├── editor/          # Next.js frontend (dashboard, CRM, AI bot editor)
├── api/             # Node.js API server (AstraPBX)
├── asterisk/        # Asterisk PBX Docker config
├── pipecat-flow/    # AI voice bot gateway (FastAPI + Gemini Live)
├── workflow-engine/ # Bull job scheduler
├── docker-compose.yml
└── .env.example
```

## Pull requests

Before opening a PR:

- [ ] Code builds: `docker compose build <service>`
- [ ] Types pass: `cd editor && npx tsc --noEmit` (for editor changes)
- [ ] The PR targets `staging`, not `main`
- [ ] The PR description links the issue with `Closes #<number>`
- [ ] No `.env`, `firebase-sa-key.json`, or any secret committed

## Reporting bugs

Open an [issue](https://github.com/astradial/astradial/issues/new) with:

- What you expected to happen
- What actually happened
- Steps to reproduce
- Your environment (OS, Docker version, which services were running)
- Relevant logs from `docker compose logs <service>`

## Security

If you find a security vulnerability, **do not open a public issue**. Email **cats@astradial.com** with the details. We'll respond within 48 hours.

## Questions?

- Join the [WhatsApp community group](https://chat.whatsapp.com/EvFHEFLEwOPGNzyhG5QH2s?mode=gi_t) for quick help and real-time chat
- Open a [Discussion](https://github.com/astradial/astradial/discussions) on GitHub for longer conversations
