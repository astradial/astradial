<!--
Thanks for contributing! Please fill out this template to help us review your PR quickly.
-->

## Summary
<!-- What does this PR do? 1-3 sentences. -->

## Linked issue
Closes #<!-- issue number -->

## Type of change
<!-- Check one -->
- [ ] Bug fix
- [ ] New feature
- [ ] Refactor (no functional change)
- [ ] Documentation
- [ ] CI / tooling
- [ ] Breaking change

## How to test
<!-- Steps a reviewer can follow to verify your changes work. -->

1.
2.
3.

## Screenshots (UI changes only)
<!-- Before / After screenshots for any editor UI changes. Delete this section if not applicable. -->

## Checklist
- [ ] This PR targets the `main` branch
- [ ] Code builds: `docker compose build <service>`
- [ ] Types pass: `cd editor && npx tsc --noEmit` (if touching editor)
- [ ] No secrets committed (`.env`, `firebase-sa-key.json`, API keys, etc.)
- [ ] Only shadcn/ui components used (if touching editor UI)
- [ ] Commit messages follow [Conventional Commits](https://www.conventionalcommits.org)

## Notes for the reviewer
<!-- Anything non-obvious? Tradeoffs you made? Leftover TODOs? -->
