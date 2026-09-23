# NXGS Play 0.20.25 Store game recovery

## Problem and change

Angry Birds 2 exposes an immersive ApplicationFrameHost window that can be absent
from EnumWindows, even while its game scene is visible. The previous fallback
instead bound an unrelated, blank, DWM-cloaked Explorer frame to the game PID.
It could report a successful Resume while leaving the player in NXGS.

- Discover immersive frames through exact-title and foreground lookup as well as
  enumeration; verify the frame's Windows AppUserModelID before binding it to
  the package process. Keep the shared visual host PID separate from the game PID.
- Reject blank Explorer frames and reject DWM-cloaked windows as successful
  fullscreen presentation. An exactly identified hidden Store frame remains a
  recovery target so Resume can restore it before checking presentation.
- Activate the exact Store package with IApplicationActivationManager, retain
  its returned PID, and rediscover after a failed cached resume.
- Finish pending Home backdrop staging before Resume restores the game, and
  reject obsolete staging operations. Library resume uses the same transition.
- Reuse a verified, visible game window for Home and inspect it through the
  persistent native worker, avoiding repeated PowerShell discovery.
- Hide the verified immersive frame directly when minimizing or leaving
  fullscreen; enumeration alone cannot find all Store surfaces. Match its
  AppUserModelID and shared-host identity before acting on a childless frame.
- When a tracked Store frame is in the Windows immersive z-order band, send
  Alt+Enter once to leave that mode while retaining NXGS's borderless,
  monitor-sized game presentation. Stage Home over the still-visible game;
  skip repeated toggle attempts for frames that do not support the shortcut.
- Keep the existing process-tree shutdown from 0.20.24; closing NXGS does not
  depend on being able to hide a game window first.

## Validation

Passed typecheck, Windows packaging, launch/Home races, Store resume recovery,
Home identity, fullscreen presentation, containment, close flow, admin shortcuts,
taskbar lifecycle, and native windowless process-tree shutdown checks.

`scripts/verify-store-resume.mjs` exercises the production launcher and compiles
the real native worker. Its optional `--live <pid> <title> <aumid>` check uses
read-only production discovery and rejects a mismatched package identity.
`scripts/inspect-store-windows.ps1` provides read-only HWND/owner/AUMID/cloak
diagnostics, including frames omitted by enumeration.

Live Computer Use evidence:

- Chicken Invaders: Home showed the moving game scene; Resume returned to
  fullscreen without the NXGS navigation or Windows taskbar.
- Angry Birds: reproduced false discovery, then verified its exact real frame
  and package PID with the corrected discovery code.
- Angry Birds: fresh launch reached the actual tutorial, with fullscreen native
  checks passing at 1920x1080, foreground, visible, borderless, taskbar hidden.
- Angry Birds: Home displayed the actual tutorial scene instead of cover art.
  The initial run took 25.7 seconds and motivated the cached-window inspection
  optimization. That duration is not a claim about the final optimized build.
- Angry Birds: the final Home run staged directly above the unminimized game
  in 453 ms on the first press and 172 ms on the second. Native inspection
  showed the game move from immersive band 8 to desktop band 1, with NXGS
  above it and the game still visible. Two Computer Use screenshots showed
  different hand and pig poses, confirming a moving game scene behind Home.
  Direct Computer Use clicks on **Resume Game** succeeded twice and the native
  log recorded fast returns to the `running` state with the game foreground.
- In the packaged build, Computer Use sent Ctrl+Shift+H to the Angry Birds
  window. NXGS logged `global-home` and staged the live overlay in 181 ms;
  a direct Resume click then returned to gameplay.
- Angry Birds: the Close Game confirmation removed its process without the
  former controllable-window error.
- The final packaged `release/win-unpacked` build repeated the live Home,
  direct Resume, and Close Game checks. Home staged in 238 ms and 219 ms on
  successive opens; native logs reported `gameVisible=true` with no captured
  frame fallback. The Close Game confirmation terminated the Angry Birds
  process and returned NXGS to its launcher without an error.
- Earlier user-assisted PIN shutdown while Angry Birds was running logged forced
  process-tree termination and NXGS exit. PIN entry remains manual; it is not
  automated by the Computer Use tests.

## Windows references

- [EnumWindows desktop-app limitation](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-enumwindows)
- [DWM window attributes](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwmwindowattribute)
- [Store activation contract](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-iapplicationactivationmanager-activateapplication)

The packaged build was published as
[v0.20.25](https://github.com/sowankispassah/nxgs_gaming/releases/tag/v0.20.25).
The live update manifest reports 0.20.25, and its installer SHA-256 matches the
locally tested installer (`2f6f351931e869ba697dac81ad787fa216d2db1e507ce3a1904337089f2b8c80`).

## Immersive-layer investigation, September 23

The installed copy was 0.20.24, while the working build was 0.20.25. Early
builds reproduced a separate issue: direct staging of the Angry Birds immersive
frame failed, and captured-frame fallback minimized the game. Two Computer Use
observations showed the same tutorial frame. This did **not** pass the moving
live-background requirement, even though the image came from the actual game.

Read-only diagnostics found the Angry Birds frame in Windows band 8 and NXGS
in band 1. Computer Use could not activate the overlay for a direct click in
that state. The final Store-specific Alt+Enter transition demoted the game to
band 1. Native z-order staging then succeeded without minimizing the game, and
Computer Use clicked the actual Resume button twice.

Experiments with resizing, disabling game input, shell activation, DWM cloak,
and `SW_RESTORE` did not establish the requested behavior and were removed.
DWM cloak returned `0x80070005` (access denied).
