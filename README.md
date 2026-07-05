# NXGS Play

NXGS Play is a Windows-only Electron + React + TypeScript gaming launcher and kiosk MVP. It is designed to make a PC feel like a dedicated console: customers browse games, start timed sessions, play, and return to NXGS Play when the game closes or time expires.

## Development

```powershell
npm install
npm run dev
```

Default admin shortcut: `Ctrl+Shift+A`

Default admin PIN: `1234`

## Build Windows App

```powershell
npm run typecheck
npm run build
npm run build:win
```

Build artifacts are written to `release/`:

- `release/win-unpacked/NXGS Play.exe`
- `release/NXGS Play Setup.exe`
- `release/NXGS Play.exe`

This MVP build is unsigned. The Windows package config disables certificate auto-discovery and executable signing/editing so local builds work without Windows symlink privileges.

Release filenames are intentionally stable and do not include the app version. The internal app version remains in `package.json` and is shown in **Admin Settings > Updates**.

## Check for Updates

Admin users can open `Ctrl+Shift+A`, unlock with the admin PIN, and use **Settings > Updates > Check for Updates**.

Current behavior:

- Shows the current app version from Electron/package metadata.
- Shows `Checking for updates...` while the request is pending.
- Queries the latest GitHub Release at `sowankispassah/nxgs_gaming`.
- Shows `You are on the latest version` when no newer release is found.
- Shows `New update available` when the latest release tag is greater than the local `package.json` version.
- Shows `Update check failed` with the error message if GitHub cannot be reached or returns an unexpected response.

Automatic update download/install is not enabled yet. The update-check code is isolated in `src/main/updateService.ts` so `electron-updater` or a GitHub Releases download flow can be connected later without changing the admin UI contract.

## GitHub Releases Plan

The Electron Builder config includes GitHub publish metadata for:

```text
owner: sowankispassah
repo: nxgs_gaming
```

Local builds still use `--publish=never`, so packaging does not require release credentials. A future release workflow should:

- Bump `version` in `package.json`.
- Run `npm run typecheck`, `npm run build`, and `npm run build:win`.
- Publish the generated Windows installer/portable artifact to a GitHub Release tagged with the same version, for example `v0.1.2`.
- Add signing credentials and re-enable production signing when ready.
- Optionally integrate `electron-updater` once releases and signing are stable.

## Local Data

Settings and game data are stored in the Electron user data folder:

```text
%APPDATA%\nxgs-play\nxgs-play-data.json
```

Logs are stored in:

```text
%APPDATA%\nxgs-play\logs\nxgs-play.log
```

The data layer is a simple local JSON database for MVP reliability and easy inspection. It can be replaced with SQLite later behind the same main-process IPC boundary.

## Completed MVP

- Borderless full-screen Electron launcher.
- Console-style React home screen with keyboard and controller-style navigation.
- Local game database and admin-managed game library.
- Manual game add/edit/delete.
- Steam URI launch support.
- Epic URI support when detected from manifests.
- Local executable launch support with path validation.
- Custom command launch support.
- Optional process-name monitoring with automatic return to launcher.
- Local session timer with five-minute warning and expiry handling.
- Graceful game close attempt when time expires.
- Admin-only forced close.
- PIN-protected admin settings and exit.
- Configurable session durations.
- Kiosk settings for always-on-top, close prevention, cursor hiding, and refocus.
- Installed game scan suggestions for Steam, Epic, common folders, and Start Menu shortcuts.
- Launch failure logging and scanner error isolation.
- Windows-specific process logic isolated in the Electron main process.

## Next Phase

- Replace the JSON data store with SQLite if stronger querying/migration support is needed.
- Add cover-art import/picker and image cache management.
- Add signed installer configuration and custom app icon.
- Improve Steam/Epic process matching by resolving executable names from install metadata.
- Add controller focus polish, sound effects, and animated transitions.
- Add payment/session entitlement integration behind the existing timer boundary.
- Add stronger Windows lockdown through Assigned Access, Shell Launcher, Group Policy, AppLocker or WDAC, and restricted Windows user accounts.
- Add automated Electron smoke tests and a mock process launcher for session-flow tests.
