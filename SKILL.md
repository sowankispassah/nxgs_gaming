---
name: nxgs-play-project-workflow
description: Use when working in the NXGS Play project, especially on game launch, resume, switching, quick overlays, kiosk mode, window management, fullscreen presentation, or taskbar visibility, to preserve its console-shell invariants, validate builds, and publish packaged updates through GitHub Releases and the live update manifest.
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
- Keep Windows release artifact filenames stable: `NXGS-Play-Setup.exe`, `NXGS-Play-Setup.exe.blockmap`, `NXGS-Play.exe`, and `latest.yml`.
- Always clean generated release artifacts before a Windows package build by running `npm run clean:release` directly or through `npm run build:win`; never leave old space-named or version-named installer files in `release`.
- For release builds, generate or verify `updates/windows-update.json` with the installer download URL and SHA-256 checksum.
- Treat every completed packaged user-facing update as a publishable release unless the user explicitly requests a local-only or test build.
- Publish the matching GitHub Release and all stable artifacts after `npm run build:win` succeeds: `NXGS-Play-Setup.exe`, `NXGS-Play-Setup.exe.blockmap`, `NXGS-Play.exe`, and `latest.yml`.
- Never update `windows-update.json` to a version whose GitHub Release installer is not already publicly downloadable. Publish assets first, then update and push the manifest.
- Attach the finalized `updates/windows-update.json` to the same GitHub Release as `windows-update.json`; the installed app reads `releases/latest/download/windows-update.json`, not the repository copy alone. Upload or replace this release asset after the installer is public and the manifest checksum is final.
- After publishing, verify the GitHub Release tag matches `package.json`, the four expected assets exist, the installer URL returns successfully, and the live raw `windows-update.json` reports the new version, URL, and checksum.
- A release task is not complete until the GitHub Release, pushed manifest, and live update endpoint are all verified, unless the user explicitly opted out of publication.
- Keep update-check functionality working after every release-related change.
- Run `npm run typecheck` after code changes.
- Run `npm run build` after code changes.
- For Windows release changes, also run `npm run build:win`.
- When a new packaged build is produced, confirm the installer/output path.
- Summarize files changed after implementation.
- Commit changes after successful checks.
- Push to GitHub after a successful commit when credentials are available.
- Never force push without explicit approval.

## Gameplay presentation invariant

Treat fullscreen gameplay as a hard success condition after every change involving game launch, resume, switching, launcher-to-game return, quick overlays, kiosk mode, window management, fullscreen behavior, or taskbar visibility:

- Every launched or resumed game must cover its entire monitor in fullscreen or borderless fullscreen.
- No title bar, resizable border, Windows taskbar, desktop, device background, or NXGS bottom navbar may remain visible over gameplay.
- Windows notification toasts and shell flyouts must remain hidden behind the NXGS/game presentation throughout locked customer fullscreen; never allow them to overlay launcher or gameplay content.
- Never mark a game `running` merely because its window is visible or foreground. Verify monitor-edge coverage, non-minimized foreground state, borderless window styles, and hidden taskbar first.
- Keep the fullscreen NXGS shell shield behind every handoff so failed or delayed activation cannot expose the desktop.
- If validation fails, keep retrying native fullscreen enforcement with bounded, logged attempts. Keep or restore the NXGS shield and leave the session visibly unresolved instead of accepting small-window gameplay.
- Log the game rect, monitor rect, foreground/minimized/visible state, window chrome state, taskbar state, and specific validation failures.
- Add or run regression coverage for exact monitor coverage, overscan, small-window rejection, chrome rejection, taskbar rejection, and lost-foreground rejection.
