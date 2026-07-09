# NXGS Play

NXGS Play is a Windows-only Electron + React + TypeScript gaming launcher and kiosk MVP. It is designed to make a PC feel like a dedicated console: customers browse games, start timed sessions, play, and return to NXGS Play when the game closes or time expires.

## Development

```powershell
npm install
npm run dev
```

Default admin shortcut: `Ctrl+Shift+A`

Default admin PIN: `1234`

## Home Overlay Controls

NXGS Play uses a layered kiosk input path from the Electron main process:

- `Ctrl+Shift+H`: return to the NXGS home overlay.
- `F10`: return to the NXGS home overlay.
- `Ctrl+Shift+X`: emergency close flow. NXGS comes forward and asks for confirmation before closing the active game.
- `Ctrl+Shift+A`: request the admin PIN screen.

When a game is active, the home overlay shows an active game tile with Resume, Minimize, and Close controls. Home is idempotent, so repeated Home presses bring NXGS forward without minimizing the game or duplicating overlays. Resume hides the NXGS BrowserWindow after the game is foreground again so the bottom dock does not remain over the game.

Customer mode is controller-first. Controller Home/Guide support is best effort because Windows, Steam Input, DS4Windows, and controller drivers may hide the PS button from normal apps. NXGS also watches for `Options + Share` and `L1 + R1 + Options` when the controller is visible through the browser Gamepad API. `Ctrl+Shift+H` and `F10` remain test fallbacks.

Keyboard navigation remains active in customer mode, so arrow keys, Enter, Escape/B, `Ctrl+Shift+H`, and `F10` do not open the admin PIN. The admin PIN appears for the explicit admin shortcut (`Ctrl+Shift+A`) and Windows/System key escape attempts. Other blocked system shortcuts are intercepted without forcing the PIN screen. Normal mouse clicks still select games, buttons, and active-game controls. Correct PIN switches to admin mode, restores the taskbar, disables always-on-top, and allows normal PC controls. Returning from admin mode switches back to full-screen customer kiosk mode and hides the taskbar again.

Admin diagnostics in **Settings > Kiosk** show customer/admin mode, active game state, game process/window identifiers, shortcut registration, controller state, taskbar hidden state, always-on-top state, last Home trigger, and last restricted input.

## Build Windows App

```powershell
npm run typecheck
npm run build
npm run build:win
```

Build artifacts are written to `release/`:

- `release/win-unpacked/NXGS Play.exe`
- `release/NXGS-Play-Setup.exe`
- `release/NXGS-Play.exe`
- `release/latest.yml`

This MVP build is unsigned. The Windows package config disables certificate auto-discovery and executable signing/editing so local builds work without Windows symlink privileges.

Release filenames are intentionally stable and do not include the app version. The internal app version remains in `package.json` and is shown in **Admin Settings > Updates**.

## Check for Updates

Admin users can open `Ctrl+Shift+A`, unlock with the admin PIN, and use **Settings > Updates > Check for Updates**.

Current behavior:

- Shows the current app version from Electron/package metadata.
- Shows `Checking for updates...` while the request is pending.
- Queries the latest release manifest at `https://github.com/sowankispassah/nxgs_gaming/releases/latest/download/windows-update.json`.
- Falls back to GitHub Releases metadata if the manifest is not published yet.
- Shows `You are on the latest version` when no newer release is found.
- Shows `New update available` when the manifest version is greater than the local `package.json` version.
- Shows `Download Update` when the manifest includes a secure Windows installer URL and SHA-256 checksum.
- Downloads the installer to the Windows temp updates folder and shows progress.
- Verifies the downloaded installer checksum.
- Shows a restart prompt after the installer is verified.
- Keeps NXGS Play open until the admin clicks `Restart Now`.
- Runs the installer and reopens NXGS Play during the restart/install step.
- Shows `Update check failed` with the error message if GitHub cannot be reached, no GitHub Release is published yet, no installer asset is attached, or GitHub returns an unexpected response.

Important: pushing commits to `main` does not create an installable update. Installed copies can only update from a published GitHub Release whose manifest version is newer than the local app version and whose assets include `windows-update.json` plus `NXGS-Play-Setup.exe`.

The update code is isolated in `src/main/updateService.ts`. It uses a controlled manifest download flow similar to the older NXGS Gaming updater; `electron-updater` can replace or extend this later once signing and release publishing are stable.

## GitHub Releases Plan

The Electron Builder config includes GitHub publish metadata for:

```text
owner: sowankispassah
repo: nxgs_gaming
```

Local builds still use `--publish=never`, so packaging does not require release credentials. The GitHub Actions workflow at `.github/workflows/release.yml` publishes release assets when a version tag is pushed.

Release flow:

- Bump `version` in `package.json`.
- Run `npm run typecheck`, `npm run build`, and `npm run build:win`.
- Generate `updates/windows-update.json` with `scripts/generate-update-manifest.ps1`.
- Commit and push the version/build changes.
- Push a Git tag matching the app version, for example `v0.4.2`.
- GitHub Actions builds the Windows package and attaches `NXGS-Play-Setup.exe`, `NXGS-Play.exe`, `latest.yml`, `windows-update.json`, and the blockmap to the Release.
- Installed copies see the update only after the Release exists.
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

