import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { exports, require: key => mocks[key] ?? require(key), process, setTimeout, clearTimeout, setInterval, clearInterval });
  return exports;
}
const identity = load('../src/main/gameWindowIdentity.ts');
const presentation = load('../src/main/gamePresentation.ts');
const game = { id: 'angry', title: 'Angry Birds 2', launchType: 'microsoftStore', launchCommand: 'package!App', processName: '' };
const frame = { handle: 100, processId: 42, processName: 'Angry Birds 2', title: 'Angry Birds 2' };
const snapshot = { foregroundHandle: 100, isForeground: true, isVisible: true, isMinimized: false,
  isCloaked: false, hasWindowChrome: false, x: 0, y: 0, width: 1920, height: 1080,
  monitorX: 0, monitorY: 0, monitorWidth: 1920, monitorHeight: 1080, taskbarVisible: false };

function harness({ cloaked = false, phantom = false, discovered = frame } = {}) {
  const calls = [];
  const { GameLauncher } = load('../src/main/gameLauncher.ts', {
    electron: {}, './logger': { logLine: async () => {} }, './gameLifecycle': {},
    './gameWindowIdentity': identity, './gamePresentation': presentation,
    './windowsProcess': {},
    './windowsControlWorker': { runWindowsControl: async (command, value) => {
      calls.push({ command, value }); return { ok: true, value: 42 };
    } },
    './windowManagerService': {
      isProvisionalShellHostedStoreWindow: window => window.hostProcessName === 'explorer',
      isGameWindowVisible: async () => true,
      resumeGameWindowFast: async () => { calls.push('fast'); return { ...snapshot, isCloaked: cloaked }; },
      waitForGameWindow: async search => { assert.equal(search.pid, 42); assert.equal(search.appUserModelId, game.launchCommand); calls.push('discover'); return discovered; }
    }
  });
  const launcher = new GameLauncher(() => null, { onActiveGameChanged() {}, onGameExited() {}, onError() {}, onGameWindowDetected() {} });
  Object.assign(launcher, {
    activeGame: game, activeProcessId: 42,
    activeWindow: phantom ? { ...frame, title: '', hostProcessName: 'explorer' } : frame,
    state: { status: 'quickOverlayOpen', game },
    monitorByProcessName() {}, scheduleGamePresentationReinforcement() {}, suppressWindowsTaskbar: async () => {},
    getActiveWindow: async () => null, isGameStillRunning: async () => true,
    handOffToGameWindow: async (_game, win) => { calls.push('handoff'); return win; }
  });
  return { launcher, calls };
}
for (const options of [{ cloaked: true }, { phantom: true }]) {
  const h = harness(options);
  assert.equal((await h.launcher.resumeActiveGame()).ok, true);
  assert.ok(h.calls.some(c => c.command === 'activate-store-app' && c.value === game.launchCommand));
  assert.ok(h.calls.indexOf('discover') < h.calls.indexOf('handoff'));
  if (options.phantom) assert.ok(!h.calls.includes('fast'), 'never focus an unauthenticated Explorer frame');
  assert.equal(h.launcher.activeState.status, 'running');
}
{
  const h = harness({ cloaked: true, discovered: null });
  assert.equal((await h.launcher.resumeActiveGame()).ok, false);
  assert.equal(h.launcher.activeState.status, 'quickOverlayOpen');
  assert.ok(!h.calls.includes('handoff'));
}
{
  const h = harness();
  assert.equal((await h.launcher.getQuickOverlayBackdropWindow()).handle, frame.handle,
    'a verified visible cached game must avoid repeating expensive Store discovery on Home');
  assert.equal((await h.launcher.resumeActiveGame()).ok, true);
  assert.deepEqual(h.calls, ['fast'], 'a valid cached window should keep the instant resume path');
}

// Compile and exercise the production native worker without altering any window.
if (process.platform === 'win32') {
  const worker = load('../src/main/windowsControlWorker.ts');
  try {
    const result = await worker.runWindowsControl('inspect-window', 0);
    assert.equal(result.ok, false, 'invalid HWND must not produce presentation success');
    const windows = load('../src/main/windowManagerService.ts', {
      './gamePresentation': presentation,
      './windowsProcess': { normalizeProcessName: value => value.replace(/\.exe$/i, '').toLowerCase() + '.exe' },
      './windowsControlWorker': worker
    });
    assert.equal(await windows.findGameWindow({titleHint: 'NXGS nonexistent regression fixture', appUserModelId: 'nonexistent!App'}), null);
    if (process.argv[2] === '--live') {
      const pid = Number(process.argv[3]);
      const found = await windows.findGameWindow({pid, titleHint: process.argv[4], appUserModelId: process.argv[5]});
      assert.ok(found, 'live game must have a verified window');
      assert.equal(found.processId, pid, 'keep the package PID separate from its shared visual host');
      assert.equal(await windows.findGameWindow({pid: 0, titleHint: process.argv[4], appUserModelId: 'wrong-package!App'}), null);
      console.log('Live Store identity:', JSON.stringify(found));
    }
  } finally { worker.stopWindowsControlWorker(); }
}
console.log('Store resume: phantom rejection, cloaked recovery, exact reactivation, missing-window failure, fast path, and native worker passed.');
