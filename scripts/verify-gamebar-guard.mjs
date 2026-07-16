import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [guard, mainProcess, nativeHook] = await Promise.all([
  readFile(new URL('../src/main/gameBarGuard.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/main.ts', import.meta.url), 'utf8'),
  readFile(new URL('../build/native-kiosk-hook.ps1', import.meta.url), 'utf8')
]);

assert.match(guard, /UseNexusForGameBarEnabled/, 'Game Bar controller shortcut registry value must be managed');
assert.match(guard, /'0'/, 'controller-to-Game-Bar shortcut must be disabled');
assert.match(guard, /GameBar\.exe/, 'active Game Bar process must be closed');
assert.match(guard, /GameBarFTServer\.exe/, 'active Game Bar server must be closed');
assert.match(guard, /XboxGameBarWidgets\.exe/, 'active Game Bar widgets must be closed');
assert.match(
  mainProcess,
  /await disableXboxGameBarControllerShortcut\(\)/,
  'Game Bar controller shortcut must be disabled before the launcher becomes interactive'
);
assert.match(
  mainProcess,
  /reason === 'controller-home'.*suppressXboxGameBarSurfaces\(\)/s,
  'controller Home handling must close any Game Bar surface that races NXGS'
);
assert.match(nativeHook, /IsXboxGameBarHost/, 'customer-mode native guard must recognize Xbox Game Bar windows');
assert.match(nativeHook, /ShowWindowAsync\(hwnd, SW_HIDE\)/, 'customer-mode native guard must hide matched Game Bar windows');

console.log('PASS: Controller Home is reserved for NXGS and Xbox Game Bar surfaces are suppressed.');
