# NXGS Play Kiosk Notes

NXGS Play implements best-effort kiosk behavior inside the app: borderless full-screen mode, optional always-on-top, PIN-protected exit, cursor hiding, refocus behavior, game process monitoring, return-to-launcher flow, customer/admin mode switching, restricted-input PIN prompts, and controller-first Home overlay controls.

Customer mode hides the Windows taskbar, keeps NXGS in full-screen when it is visible, hides NXGS behind the foreground game after Resume, and brings NXGS forward for Home/Admin PIN requests. Admin mode restores the taskbar, disables NXGS always-on-top, and allows normal keyboard/mouse controls.

Electron cannot fully block every OS-reserved shortcut. `Ctrl+Alt+Del` cannot be blocked by a normal app, and Windows/controller drivers may hide the controller Guide/Home button. NXGS registers best-effort global shortcuts and uses renderer/controller polling where available.

For deeper Windows lockdown, configure the operating system separately with Windows Assigned Access, Shell Launcher, Group Policy, AppLocker or WDAC, and a restricted Windows user account. App-level kiosk behavior should be treated as the UX layer, not the security boundary.
