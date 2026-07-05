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
- Update the `version` field in `package.json` for every completed user-facing change, release change, update-check change, or packaged build. Use semver: patch for fixes/small changes, minor for new features, major for breaking changes.
- Keep GitHub Release tags aligned with `package.json` versions, using tags like `v0.1.1`.
- Do not treat a pushed commit as an app update; the Admin update button can only detect/install a published GitHub Release with `windows-update.json` and a newer manifest version.
- For updater changes, confirm the release asset name expected by the app still matches the packaged installer name, currently `NXGS-Play-Setup.exe`.
- For release builds, generate or verify `updates/windows-update.json` with the installer download URL and SHA-256 checksum.
- Keep update-check functionality working after every release-related change.
- Run `npm run typecheck` after code changes.
- Run `npm run build` after code changes.
- For Windows release changes, also run `npm run build:win`.
- When a new packaged build is produced, confirm the installer/output path.
- Summarize files changed after implementation.
- Commit changes after successful checks.
- Push to GitHub after a successful commit when credentials are available.
- Never force push without explicit approval.
