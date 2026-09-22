# NXGS Play 0.20.23 secret admin shortcut validation

## Behavior

- Press `C` five times in succession to request **Close NXGS**.
- Press `E` five times in succession to request **Exit Full Screen**.
- Press `M` five times in succession to request **Minimize NXGS**.
- Each sequence opens the Admin PIN dialog. The requested action runs directly only after the stored PIN is verified.
- Another key or a pause longer than 1.4 seconds resets the sequence.
- Holding a key counts as one press because the native hook waits for key-up before accepting another press.
- The first four presses are observed without being blocked, so normal game input is preserved.

## Validation

Passed:

- `npm run typecheck`
- `npm run test:secret-admin-shortcuts`
- `npm run test:game-containment`
- `npm run test:home-overlay`
- `npm run test:launch-flow`
- `npm run test:fullscreen-presentation`
- `npm run test:taskbar-lifecycle`
- `npm run test:close-flow`
- `npm run build`
- clean `npm run build:win`
- `git diff --check`

The shortcut regression test covers all three mappings, mixed-key reset, timeout reset, held-key protection, PIN request routing, requested-action preservation, and immediate action routing after verification.

## Packaged Computer Use check

Tested `release/win-unpacked/NXGS Play.exe` version 0.20.23:

- Five separate `C` presses opened a PIN dialog labeled **Close NXGS**.
- Five separate `E` presses opened a PIN dialog labeled **Exit Full Screen**.
- Five separate `M` presses opened a PIN dialog labeled **Minimize NXGS**.
- No PIN was entered or read by automation.

`npm run test:pin-enter` reached its pre-existing visual focus-style assertion and reported that the tab group's computed box shadow was `none`. The secret-shortcut flow occurs after that independent check and is covered by its dedicated test plus the packaged Computer Use checks above.
