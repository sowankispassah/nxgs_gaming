import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SecretAdminSequence } from '../src/main/secretAdminSequence.ts';

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

const [hook, kioskInput, main, renderer] = await Promise.all([
  readFile(new URL('../build/native-kiosk-hook.ps1', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/kioskInputService.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/main.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8')
]);

assert.match(hook, /WM_KEYUP[\s\S]*pressedKeys\.Remove\(key\)/, 'held keys must not count as repeated presses');
assert.match(hook, /SECRET_KEY\|/, 'the global hook must observe the secret letters');
assert.match(kioskInput, /onSecretAdminAction[\s\S]*SecretAdminSequence/, 'the kiosk input service must route completed sequences');
assert.match(main, /requestSecretAdminAction[\s\S]*kiosk:adminUnlockRequested/, 'a completed sequence must request PIN verification');
assert.match(renderer, /action: request\?\.action/, 'the PIN request must preserve its requested action');
assert.match(renderer, /adminUnlockRequest\?\.action[\s\S]*executeAdminAction/, 'verified PIN entry must immediately run the requested action');

console.log('Secret admin shortcuts: five presses, reset rules, hold protection, PIN request, and direct action routing passed.');
