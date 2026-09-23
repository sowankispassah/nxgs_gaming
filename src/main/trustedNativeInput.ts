import { randomBytes } from 'node:crypto';

// The kiosk hook accepts a Windows key only from NXGS's own fullscreen
// transition. Physical Windows-key presses remain blocked in customer mode.
export const trustedNativeInputToken = randomBytes(8).toString('hex');
