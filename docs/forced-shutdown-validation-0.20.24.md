# NXGS Play 0.20.24 forced shutdown validation

## Behavior

- Closing NXGS no longer calls the game-hiding path used by Exit Full Screen or Minimize.
- After a valid Admin PIN, NXGS asks every verified game window to close, then force terminates every recorded game PID tree.
- Games that are still loading, have no controllable window, or ignore their normal close request cannot block NXGS shutdown.
- A launch already in progress finishes process identity discovery before termination, preventing a Microsoft Store game from appearing after NXGS exits.
- Process termination is retried once and any diagnostic failure is written to the application log instead of being shown as a blocking PIN-dialog error.
- Home opened before a Store game publishes its window now upgrades automatically from the loading placeholder to the verified game view. Dismissed requests cannot complete an obsolete upgrade.

## Automated validation

The containment regression covers:

- cooperative multi-game shutdown;
- forced termination when a game refuses to close;
- forced termination when process inspection fails;
- shutdown while launch identity discovery is still pending;
- windowless game shutdown;
- the independent desktop-containment guard used by Exit Full Screen;
- multi-game selective resume and hidden-window race handling.

Commands:

- `npm run typecheck`
- `npm run test:game-containment`
- `npm run test:secret-admin-shortcuts`
- `npm run test:close-flow`
- `npm run test:launch-flow`
- `npm run test:home-overlay`
- `npm run test:fullscreen-presentation`
- `npm run test:taskbar-lifecycle`
- `npm run build`
- `npm run build:win`
- `git diff --check`

## Packaged Computer Use validation

- Confirmed the installed app was still 0.20.23; 0.20.24 was tested from `release/win-unpacked/NXGS Play.exe`.
- Launched Angry Birds 2 through Computer Use in 0.20.24 and opened Home via the existing second-instance Home handler. Computer Use cannot activate the untitled Store game host to inject keys directly.
- Observed the real Angry Birds scene behind the Home menu. Logs confirm loading Home appeared in 50 ms and subsequently upgraded to live gameplay after exact-window capture and native stacking verification.
- On this machine the live upgrade took about 19 seconds while Windows exposed the Store frame and capture initialized; the menu remained available during that discovery.
- The installed 0.20.23 Hill Climb test confirmed that its established game view can be captured, and identified the missing loading-to-live upgrade addressed here.
- The final PIN-authenticated Angry Birds app-shutdown check requires manual PIN entry. It is not marked passed until process exit is observed.
