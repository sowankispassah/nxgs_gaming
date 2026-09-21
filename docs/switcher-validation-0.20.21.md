# NXGS Play 0.20.21: Home during startup

## Cause and correction

Home previously waited for game discovery and fullscreen handoff before showing
the switcher. A hidden renderer also delayed its first animation-frame paint
acknowledgment. Home now shows an opaque surface immediately, preserves discovery,
and prevents late startup focus operations from taking over the menu. Dismissing
during discovery clears only the Home request. First resume from the loading
cover uses full fullscreen enforcement before accepting the game as running.

Home also uses the immediate cover when the live backdrop is not prepared yet.
Background preparation restarts after leaving a loading cover. Failed Return Home
actions retain the visible switcher instead of hiding it prematurely.

## Validation on 2026-09-21

- Typecheck, production build, and clean Windows installer/portable build passed.
- Home-overlay, exact game-window identity, launch-flow, fullscreen presentation,
  taskbar lifecycle, and close-flow checks passed.
- New behavioral regression cases exercise deferred discovery, dismiss during
  discovery, Home during a pending native handoff, repeated toggles, discovery
  timeout, and full first resume. These mock native boundaries; they do not claim
  physical keyboard or controller validation.
- Computer Use launched the packaged 0.20.21 application and pressed Ctrl+Shift+H
  while Chicken Invaders was still launching. The first iteration exposed a
  1,111 ms hidden-renderer delay. Showing an opaque surface before awaiting paint
  reduced the measured path to 178 ms, before discovery completed 1.2 seconds later.
- The switcher remained visible through discovery. Ctrl+Shift+H resumed the game;
  the full native handoff confirmed foreground, visible, non-minimized, no chrome,
  no taskbar, and monitor coverage on its first attempt. The screenshot confirmed
  fullscreen gameplay. Subsequent Home and normal Close Game were exercised.
- A subsequent test exposed a missing prewarm after loading-cover resume. The
  final package restores that prewarm and uses immediate Home while preparation
  is pending. Typecheck and Home/launch regressions passed after that correction.
- The final package launched Hill Climb Racing. Native logs confirmed fullscreen
  on the second attempt after its splash HWND was replaced. Computer Use could
  not activate the launcher or discover a usable Hill Climb input target, even
  after refreshing the binding. No Home event was received in that test, so it
  does not establish whether the physical shortcut succeeds or fails there.
- No PlayStation controller was connected; physical controller Home was not tested.

Timings are individual observations on this machine, not performance guarantees.
