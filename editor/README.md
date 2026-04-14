# AstraDial

Enterprise cloud PBX management dashboard with AI voice bots, workflow automation, and real-time call monitoring.

## Features

- **Dashboard** -- Call stats, weekly charts, ticket tracking
- **Users** -- SIP extension management with QR code provisioning
- **SuperHuman (AI Bots)** -- Gemini Live voice agents with visual flow editor
- **Queues** -- Call queue management with MOH upload and TTS greetings
- **Calls** -- Live call monitoring, call history with recordings, click-to-call
- **Workflows** -- Visual automation builder with webhook triggers and scheduling
- **DIDs** -- Inbound number routing (extension, queue, AI agent, external)
- **Trunks** -- SIP trunk configuration (admin only)
- **API Keys** -- Workflow trigger authentication

## Auth

- **Organisation login** -- Firebase email/password + PBX JWT token
- **Admin login** -- Firebase + gateway admin key, impersonate any org

## Stack

- Next.js 16 + TypeScript
- shadcn/ui + Tailwind CSS
- React Flow (workflow editor)
- Firebase (auth + Firestore for call logs/tickets)
- Recharts (dashboard charts)

## Deploy

```bash
# Copy changed files to VPS
scp file.tsx root@89.116.31.109:/opt/pipecat-flow-editor/path/

# Build and restart
ssh root@89.116.31.109 "cd /opt/pipecat-flow-editor && npm run build && pm2 restart editor"
```

See [Deploy Guide](https://wiki.astradial.com/guides/deploy-apps/) for full instructions.

## Related Repos

- [astrapbx](https://github.com/astradial/astrapbx) -- PBX API server
- [internal-docs](https://github.com/astradial/internal-docs) -- Wiki at wiki.astradial.com
- [sip-gateway](https://github.com/astradial/sip-gateway) -- NUC gateway config
