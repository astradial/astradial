# Contributing to Astradial Editor

## Development Workflow

All changes follow the **feature → staging → production** pipeline. No direct commits to `main` or `staging`.

```
1. Create feature branch from main
2. Develop and test locally
3. PR → staging (auto-deploys to staging VPS)
4. Test on staging (stageeditor.astradial.com)
5. PR → main (auto-deploys to production VPS)
6. Live on editor.astradial.com
```

## Step-by-step example

### 1. Start a new feature

```bash
git checkout main
git pull origin main
git checkout -b feature/add-whatsapp-templates
```

### 2. Make your changes

Edit code, test locally:
```bash
npm run dev        # local dev server at localhost:3000
npm run build      # verify build passes
npx tsc --noEmit   # verify TypeScript
```

### 3. Commit and push

```bash
git add -A
git commit -m "feat: WhatsApp template selector in ticket notifications"
git push origin feature/add-whatsapp-templates
```

### 4. Create PR to staging

Go to GitHub → **Pull Requests** → **New Pull Request**
- Base: `staging`
- Compare: `feature/add-whatsapp-templates`
- Title: `feat: WhatsApp template selector`
- Description: what changed + how to test

**On merge → auto-deploys to staging VPS** (self-hosted runner at 94.136.188.221).

### 5. Test on staging

Open `https://stageeditor.astradial.com` and verify:
- Feature works as expected
- No regressions on other pages
- Check browser console for errors

### 6. Create PR to main (production)

Go to GitHub → **Pull Requests** → **New Pull Request**
- Base: `main`
- Compare: `staging`
- Title: `merge: staging → main — WhatsApp templates`

**On merge → auto-deploys to production VPS** (self-hosted runner at 89.116.31.109).

### 7. Verify production

Open `https://editor.astradial.com` and confirm the feature is live.

## Branch rules

| Branch | Purpose | Auto-deploy target | Who can merge |
|--------|---------|-------------------|---------------|
| `main` | Production | editor.astradial.com (89.116.31.109) | Owner / Admin after staging test |
| `staging` | Testing | stageeditor.astradial.com (94.136.188.221) | Developer after code review |
| `feature/*` | Development | None (local only) | — |

## Environment files

These are NOT in git (gitignored). Each VPS has its own:

| File | Prod | Staging |
|------|------|---------|
| `.env.local` | `/opt/pipecat-flow-editor/.env.local` | Same path on staging VPS |

**Never commit `.env.local`, `.env`, or any file containing secrets.**

## UI guidelines

- Use only standard **shadcn/ui** components
- No custom colors (no purple gradients, no colored badges)
- Use `variant="default"` (primary) and `variant="secondary"` (grey) for badges
- Follow existing page patterns for consistency

## Useful commands

```bash
# Local dev
npm run dev

# Type check
npx tsc --noEmit

# Build (same as what the runner does)
npm run build

# Check what's deployed on staging
gh run list --repo astradial/astradial-editor --limit 5

# Check what's deployed on prod
gh run list --repo astradial/astradial-editor --branch main --limit 5
```
