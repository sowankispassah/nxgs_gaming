# NXGS Play Kiosk Notes

NXGS Play implements best-effort kiosk behavior inside the app: borderless full-screen mode, optional always-on-top, PIN-protected exit, cursor hiding, refocus behavior, game process monitoring, and return-to-launcher flow.

For deeper Windows lockdown, configure the operating system separately with Windows Assigned Access, Shell Launcher, Group Policy, AppLocker or WDAC, and a restricted Windows user account. App-level kiosk behavior should be treated as the UX layer, not the security boundary.
