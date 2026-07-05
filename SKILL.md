---
name: nxgs-play-project-workflow
description: Use when working in the NXGS Play project to preserve its standalone Electron/React/TypeScript launcher architecture, validate builds, manage updates, commit successful changes, and push to GitHub when credentials are available.
---

# NXGS Play Project Workflow

Follow these rules for every future coding change in this project:

- Inspect the current project structure before making changes.
- Preserve the standalone NXGS Play architecture.
- Keep Electron main-process system actions separate from React renderer UI.
- Keep game launching, detection, session timing, local storage, and update-check logic modular.
- Do not remove existing features while adding new ones.
- Keep app versioning clear in `package.json`.
- Keep update-check functionality working after every release-related change.
- Run `npm run typecheck` after code changes.
- Run `npm run build` after code changes.
- For Windows release changes, also run `npm run build:win`.
- When a new packaged build is produced, confirm the installer/output path.
- Summarize files changed after implementation.
- Commit changes after successful checks.
- Push to GitHub after a successful commit when credentials are available.
- Never force push without explicit approval.
