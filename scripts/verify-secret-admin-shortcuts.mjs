import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SecretAdminSequence } from '../src/main/secretAdminSequence.ts';
import { readAppShellSource } from './lib/rendererSources.mjs';

const sequence = new SecretAdminSequence(5, 1400);
for (let press = 0; press < 4; press += 1) {
  assert.equal(sequence.observe('c', press * 100), null);
}
assert.equal(sequence.observe('c', 400), 'closeApp');

for (let press = 0; press < 4; press += 1) {
  assert.equal(sequence.observe('E', 1000 + press * 100), null);
}
assert.equal(sequence.observe('e', 1400), 'exitFullscreen');

for (let press = 0; press < 4; press += 1) {
  assert.equal(sequence.observe('m', 2000 + press * 100), null);
}
assert.equal(sequence.observe('M', 2400), 'minimize');

sequence.observe('c', 3000);
sequence.observe('c', 3100);
assert.equal(sequence.observe('x', 3200), null);
for (let press = 0; press < 4; press += 1) {
  assert.equal(sequence.observe('c', 3300 + press * 100), null, 'another key must reset progress');
}
assert.equal(sequence.observe('c', 3700), 'closeApp');

sequence.observe('e', 5000);
sequence.observe('e', 5100);
sequence.observe('e', 5200);
sequence.observe('e', 5300);
assert.equal(sequence.observe('e', 7000), null, 'a long pause must start a new sequence');

const [hook, kioskInput, main, launcher, renderer] = await Promise.all([
  readFile(new URL('../build/native-kiosk-hook.ps1', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/kioskInputService.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/main.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/gameLauncher.ts', import.meta.url), 'utf8'),
  readAppShellSource()
]);

assert.match(hook, /WM_KEYUP[\s\S]*pressedKeys\.Remove\(key\)/, 'held keys must not count as repeated presses');
assert.match(hook, /SECRET_KEY\|/, 'the global hook must observe the secret letters');
assert.match(kioskInput, /onSecretAdminAction[\s\S]*SecretAdminSequence/, 'the kiosk input service must route completed sequences');
assert.match(main, /requestSecretAdminAction[\s\S]*kiosk:adminUnlockRequested/, 'a completed sequence must request PIN verification');
assert.match(renderer, /action: request\?\.action/, 'the PIN request must preserve its requested action');
assert.match(renderer, /adminUnlockRequest\?\.action[\s\S]*executeAdminAction/, 'verified PIN entry must immediately run the requested action');

assert.match(
  hook,
  /bool firstKeyDown = pressedKeys\.Add\(key\);\s*if \(windowsKey\) \{[^}]*if \(firstKeyDown\) windowsKeyTapPending = true;\s*return new IntPtr\(1\);\s*\}/,
  'every physical Windows-key press must stay blocked from the shell'
);
assert.match(
  hook,
  /if \(message == WM_KEYUP \|\| message == WM_SYSKEYUP\) \{\s*pressedKeys\.Remove\(key\);\s*if \(windowsKey && windowsKeyTapPending &&[\s\S]*?Console\.WriteLine\("HOME_KEY\|Windows key"\);[\s\S]*?\}\s*return CallNextHookEx/,
  'a lone Windows-key tap must be reported as Home on release'
);
assert.match(hook, /pressedKeys\.Contains\(VK_LWIN\) \|\| pressedKeys\.Contains\(VK_RWIN\)\) windowsKeyTapPending = false/, 'Win+key chords must not open Home');
assert.doesNotMatch(hook, /blocked = "Windows key"/, 'the Windows key must not take the restricted-input path that raised the launcher');
assert.match(kioskInput, /startsWith\('HOME_KEY\|'\)[\s\S]*this\.requestHome\('windows-key'\)/, 'the Windows key must take the same Home path as Ctrl+Shift+H');

// A PIN prompt hidden behind a game must never disable the sequence.
const secretGate = kioskInput.slice(kioskInput.indexOf("input.startsWith('SECRET_KEY|')"), kioskInput.indexOf('this.secretAdminSequence.observe'));
assert.doesNotMatch(secretGate, /adminPinActive/, 'an open PIN prompt must not swallow the secret sequence');
const secretRequest = main.slice(main.indexOf('async function requestSecretAdminAction'), main.indexOf('function handleRestrictedCustomerInput'));
assert.doesNotMatch(secretRequest.slice(0, secretRequest.indexOf('const window')), /isAdminPinActive/, 'repeating the sequence must re-show the PIN prompt');
assert.match(secretRequest, /await launcher\.minimizeActiveGame\(\)[\s\S]*launcher\.focusLauncher\(\);[\s\S]*activateLauncherWindow\(browserWindowNativeHandle\(window\)\)/, 'the PIN prompt must come in front of a running game');

// Control Room keeps the console full screen; only Exit Full Screen windows it.
const kioskSettings = main.slice(main.indexOf('function applyKioskSettings('), main.indexOf('let closingGamesForQuit'));
assert.match(kioskSettings, /if \(adminWindowedPresentation\) \{[\s\S]*setFullScreen\(false\)[\s\S]*\} else \{[\s\S]*setBounds\([\s\S]*setFullScreen\(true\)/);
assert.match(main, /adminWindowedPresentation = action === 'exitFullscreen';\s*setKioskMode\('admin'\)/);
assert.match(main, /if \(mode === 'customer'\) \{[\s\S]*adminWindowedPresentation = false/);
const launcherFocus = launcher.slice(launcher.indexOf('  focusLauncher(): void {'), launcher.indexOf('  private async focusLauncherAfterGameRelease('));
const adminFocusStart = launcherFocus.indexOf('if (!this.shouldUseFullscreenPresentation()) {');
assert.ok(adminFocusStart > 0);
const adminFocus = launcherFocus.slice(adminFocusStart, launcherFocus.indexOf('return;', adminFocusStart));
assert.match(adminFocus, /if \(!this\.shouldKeepAdminFullscreen\(\)\) window\.setFullScreen\(false\);/);
assert.equal(
  adminFocus.match(/setFullScreen\(false\)/g)?.length, 1,
  'refocusing the launcher in Admin mode must leave fullscreen only for windowed Admin'
);
assert.match(main, /\(\) => kioskInput\.currentMode === 'customer',\s*\(\) => !adminWindowedPresentation\s*\);/);
// Full-screen Admin hides the taskbar only while NXGS itself has focus.
assert.match(main, /kioskInput\.currentMode === 'customer' \|\| \(!adminWindowedPresentation && window\?\.isFocused\(\)\)/);
assert.match(main, /mainWindow\.on\('focus', \(\) => \{\s*if \(kioskInput\.currentMode === 'admin'\) syncTaskbarForWindowPresentation/);
assert.match(main, /mainWindow\.on\('blur'[\s\S]*?if \(kioskInput\.currentMode === 'admin'\) syncTaskbarForWindowPresentation\('admin window lost focus'\)/);

console.log('Secret admin shortcuts: five presses, reset rules, hold protection, PIN request, direct action routing, Windows-key Home, and full-screen Control Room passed.');
