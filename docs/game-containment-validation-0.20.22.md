# NXGS Play 0.20.22 game containment validation

## Behavior

- Exiting fullscreen, minimizing NXGS, or opening management first hides every verified tracked game window and retains its session.
- Resuming a hidden session restores locked fullscreen and only reveals the selected game. Other parked sessions stay hidden.
- Closing NXGS or starting an update requests normal game closure and verifies tracked processes have exited. Refused closure or failed process verification keeps NXGS open with a recovery message.
- Games remain separate native processes. This implements managed visibility and lifecycle; it does not embed third-party rendering engines in Electron.

## Reported admin failure and correction

The initial local build hid Chicken Invaders but reported that it had no controllable window. The native worker returned a `handles` array which the TypeScript response dispatcher discarded. Passing that field through fixes the false missing-window result. A transport regression test now feeds a split JSON response through the actual dispatcher and checks that the HWND reaches its caller.

## Automated validation

Passed on the corrected source:

- `npm run typecheck`
- `npm run test:game-containment`
- `npm run test:home-overlay`
- `npm run test:launch-flow`
- `npm run test:fullscreen-presentation`
- `npm run test:taskbar-lifecycle`
- `npm run test:close-flow`
- `npm run build`
- `npm run build:win` (clean artifacts, installer and portable)
- `git diff --check`

Containment cases cover two tracked games, selective resume, asynchronous hide/resume ordering, unfinished launch, missing window identity, live process without a window, already exited process, graceful closure, refused closure, and failed process probing. Native worker C# also compiled successfully.

## Computer Use evidence

Corrected packaged executable: `release/win-unpacked/NXGS Play.exe`.

- Launched Chicken Invaders 4 HD from the library.
- Fullscreen validation confirmed monitor coverage, foreground/visible state, no chrome, and hidden taskbar at 2026-09-22T07:52:56Z.
- Ctrl+Shift+H opened the switcher; the app logged a 197 ms transition using the prewarmed renderer at 07:53:15Z.
- Returned to launcher Home with Chicken Invaders retained.
- Admin containment retest awaits the user's manual PIN unlock. Computer Use does not automate authentication.

## Scope of assurance

Automated tests simulate lifecycle failures; they do not establish compatibility with every game. Windows process termination outside NXGS and independently launched applications are outside this containment mechanism.
