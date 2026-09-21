# Switcher transition validation — 0.20.20

Validated on Windows with the Computer Use plugin and the installed Microsoft Store games on 2026-09-21.

## Changes

- Native Home staging restores the game only when minimized. Fast resume attaches input threads and returns measured window geometry, styles, foreground state and taskbar visibility.
- Already verified resumes no longer schedule repeated launch-style resizing. Releasing the launcher shield avoids redundant fullscreen and blur operations.
- Store handoff retries reconcile the visible game instead of repeatedly focusing its splash frame. Stale asynchronous probes cannot overwrite a newer focus operation. Package process identity is preserved separately from the frame host.
- The switcher tries verified direct composition first; exact-window capture remains the fallback when native staging fails.
- Each opening selects the active game. A 120 ms control entrance respects reduced motion and does not move the game surface.

## Evidence

Before the fix, ten Chicken Invaders resume cycles took 1.984–3.721 seconds (mean 2.56 seconds). Hill Climb repeatedly focused its old window and exhausted eight handoff attempts.

With the new focus path, two captured-overlay resume requests reached running state in 169 ms and 165 ms. On the direct-overlay candidate, openings completed in 246 ms and 168 ms; Escape resume reached running state in 115 ms. These are application-log timings, not measured display-frame latency. Computer Use screenshots confirmed visible controls, active-game selection, the same game behind the overlay, and fullscreen gameplay after resume. Launcher Home was also exercised.

Hill Climb reconciled HWND 67244 to its visual frame and passed fullscreen handoff on attempt two. Computer Use still could not activate its native input window, so repeated Hill Climb Home cycles and subjective animation smoothness remain unverified. No physical PlayStation controller was connected.

The final metadata correction retains the package process name alongside its PID so returning from Home does not disable exit monitoring. It does not change overlay rendering.

## Checks

Passed: typecheck, production build, Windows packaging, fullscreen presentation, Home overlay and exact-game identity, launch flow, close flow, controller navigation, back navigation, and native worker compilation.

Added regression coverage for one-pixel monitor gaps, missing monitor geometry, native taskbar state, real fast-resume snapshots, Store candidate priority, stale-probe cancellation, conditional restore, and active-game selection.

This is targeted switcher stabilization; it is not certification of every flow in the original broader stabilization brief.
