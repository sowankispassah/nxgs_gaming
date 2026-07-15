import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  isBackKeyboardEvent,
  popNavigationEntry,
  pushNavigationEntry
} from '../src/renderer/navigation.ts';

let history = ['home'];
history = pushNavigationEntry(history, 'settings');
history = pushNavigationEntry(history, 'network');
assert.deepEqual(history, ['home', 'settings', 'network']);

history = popNavigationEntry(history, 'home');
assert.deepEqual(history, ['home', 'settings']);
history = popNavigationEntry(history, 'home');
assert.deepEqual(history, ['home']);
history = popNavigationEntry(history, 'home');
assert.deepEqual(history, ['home']);

const unchanged = pushNavigationEntry(history, 'home');
assert.equal(unchanged, history, 'Pushing the current page should not add a duplicate history entry.');

for (const key of ['Escape', 'Backspace', 'b', 'B']) {
  assert.equal(isBackKeyboardEvent({ key }), true, `${key} should be recognized as Back.`);
}
assert.equal(isBackKeyboardEvent({ key: 'Enter' }), false);

const [kioskInput, nativeHook] = await Promise.all([
  readFile(new URL('../src/main/kioskInputService.ts', import.meta.url), 'utf8'),
  readFile(new URL('../build/native-kiosk-hook.ps1', import.meta.url), 'utf8')
]);
assert.doesNotMatch(kioskInput, /\n\s*'Escape',/, 'Plain Escape must not be registered as a blocked customer shortcut.');
assert.doesNotMatch(kioskInput, /if \(key === 'escape'\)/, 'Plain Escape must reach the renderer back stack.');
assert.match(nativeHook, /key == VK_ESCAPE && control/, 'The native guard should block Ctrl+Esc while allowing plain Escape.');

console.log('Back navigation history and key mappings verified.');
