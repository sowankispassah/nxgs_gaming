import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [nativeHook, hookService, mainProcess] = await Promise.all([
  readFile(new URL('../build/native-kiosk-hook.ps1', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/nativeKioskHook.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/main.ts', import.meta.url), 'utf8')
]);

assert.match(nativeHook, /SetWinEventHook\(/, 'customer guard must react to native shell popup events');
assert.match(nativeHook, /EVENT_OBJECT_SHOW/, 'new notification windows must be intercepted as they appear');
assert.match(nativeHook, /EVENT_OBJECT_LOCATIONCHANGE/, 'notification windows must be rechecked after Windows positions them');
assert.match(nativeHook, /ShellHost/, 'the current shell notification host must be recognized');
assert.match(nativeHook, /ShellExperienceHost/, 'Windows shell notification host must be recognized');
assert.match(nativeHook, /SecurityHealthHost/, 'Windows Security notification host must be recognized');
assert.match(nativeHook, /GameBarFTServer/, 'Xbox Game Bar controller surfaces must be recognized');
assert.match(nativeHook, /XboxGameBarWidgets/, 'Xbox Game Bar widget surfaces must be recognized');
assert.match(nativeHook, /if \(xboxGameBar\)/, 'Xbox Game Bar surfaces must bypass compact-notification geometry checks');
assert.match(nativeHook, /Windows\.UI\.Composition\.DesktopWindowContentBridge/, 'Windows 11 popup class must be recognized');
assert.match(nativeHook, /ShowWindowAsync\(hwnd, SW_HIDE\)/, 'matched notification popups must be hidden');
assert.match(nativeHook, /SetWindowPos\(hwnd, HWND_BOTTOM/, 'matched notification popups must be moved behind content');
assert.match(
  hookService,
  /line\.startsWith\('NOTIFICATION_SUPPRESSED\|'\)/,
  'notification guard reports must not be treated as blocked customer input'
);
assert.match(
  mainProcess,
  /window\.setAlwaysOnTop\(true, 'screen-saver'\)/,
  'locked customer fullscreen must stay in the highest supported launcher layer'
);
assert.match(
  mainProcess,
  /window\.setAlwaysOnTop\(false\)/,
  'windowed Admin mode must still release the topmost lock'
);

console.log('Fullscreen Windows notification guard checks passed.');
