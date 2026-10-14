import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const transpile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const load = (path, mocks) => {
  const exported = {};
  vm.runInNewContext(transpile(path), {
    exports: exported,
    require: (name) => mocks[name] ?? require(name),
    setTimeout, clearTimeout, setInterval, clearInterval,
    process: { ...process, platform: 'win32' }
  });
  return exported;
};
const settle = () => new Promise((resolve) => setImmediate(resolve));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Launcher: only the presented game is audible, whichever game is selected.
{
  const { GameLauncher } = load('../src/main/gameLauncher.ts', {
    electron: {}, './logger': { logLine: async () => {} }, './gameLifecycle': {}, './windowsProcess': {},
    './windowsControlWorker': {}, './gameWindowIdentity': {}, './gamePresentation': {}, './windowManagerService': {}
  });
  const launcher = new GameLauncher(() => null, {
    onGameExited() {}, onError() {}, onGameWindowDetected() {}, onActiveGameChanged() {}
  });
  const first = { id: 'first', title: 'First game', processName: 'First.exe' };
  const second = { id: 'second', title: 'Second game', processName: 'Second.exe' };
  const audible = () => Object.fromEntries(launcher.audioTargets.map((target) => [target.gameId, target.audible]));
  const enter = (game, status, processId) => {
    launcher.activeGame = game;
    launcher.activeProcessId = processId;
    launcher.activeWindow = { processId };
    launcher.setActiveState({ status, game });
  };

  enter(first, 'launching', 11);
  enter(first, 'running', 11);
  assert.deepEqual(audible(), { first: true });
  enter(first, 'quickOverlayOpen', 11);
  assert.deepEqual(audible(), { first: true }, 'the game stays audible under Home');
  enter(first, 'minimizedToHome', 11);
  assert.deepEqual(audible(), { first: false }, 'a game behind Launcher Home is silent');

  enter(second, 'launching', 21);
  assert.deepEqual(audible(), { first: false, second: true }, 'launching another game must not unmute the first');
  enter(second, 'running', 21);
  enter(second, 'quickOverlayOpen', 21);

  // Selecting the background game to close it leaves the game on screen audible.
  enter(first, 'closing', 11);
  assert.deepEqual(audible(), { first: false, second: true });
  // A minimized game promoted after the presented game leaves stays silent.
  launcher.sessions.delete(second.id);
  enter(first, 'quickOverlayOpen', 11);
  assert.deepEqual(audible(), { first: false });
  enter(first, 'resuming', 11);
  enter(first, 'running', 11);
  assert.deepEqual(audible(), { first: true }, 'a resumed game is heard once it is on screen');

  launcher.parkedGameIds.add(first.id);
  assert.deepEqual(audible(), { first: false }, 'games parked for Admin mode are silent');
  launcher.parkedGameIds.clear();

  launcher.child = { pid: 12, exitCode: 0, signalCode: null };
  const [target] = launcher.audioTargets;
  assert.deepEqual([...target.processIds], [11], 'an exited launch stub pid is never targeted');
  assert.deepEqual([...target.processNames], ['First.exe']);
}

// Audio focus worker protocol.
{
  const requests = [];
  let spawned = 0;
  let worker;
  const spawn = () => {
    spawned += 1;
    worker = Object.assign(new EventEmitter(), {
      killed: false,
      exitCode: null,
      stdout: Object.assign(new EventEmitter(), { setEncoding() {} }),
      stderr: Object.assign(new EventEmitter(), { setEncoding() {} }),
      stdin: Object.assign(new EventEmitter(), { write: (line) => requests.push(JSON.parse(line)), end() {} }),
      kill() { this.killed = true; }
    });
    return worker;
  };
  const reply = (sessions, ok = true) => {
    const { id } = requests.at(-1);
    worker.stdout.emit('data', `${JSON.stringify({ id, ok, sessions, message: ok ? undefined : 'device lost' })}\n`);
  };
  const { GameAudioFocus } = load('../src/main/gameAudioFocus.ts', {
    'node:child_process': { spawn },
    './logger': { logLine: async () => {} }
  });
  let targets = [
    { gameId: 'a', title: 'A', processIds: [11], processNames: ['A.exe'], audible: false },
    { gameId: 'b', title: 'B', processIds: [21], processNames: ['B.exe'], audible: true }
  ];
  const focus = new GameAudioFocus(() => targets);
  focus.warm();
  assert.equal(spawned, 1, 'the helper is started before any game launches');
  focus.refresh();
  assert.equal(spawned, 1);
  assert.deepEqual(requests[0].mute, [11], 'the background game is muted');
  assert.deepEqual(requests[0].unmute, [21], 'the game on screen is unmuted');
  focus.refresh();
  assert.equal(requests.length, 1, 'an unchanged state sends nothing while a pass is in flight');
  reply({ 11: 1, 21: 1 });
  await settle();

  // Switching games swaps which one is heard.
  targets = [
    { gameId: 'a', title: 'A', processIds: [11], processNames: [], audible: true },
    { gameId: 'b', title: 'B', processIds: [21], processNames: [], audible: false }
  ];
  focus.refresh();
  assert.deepEqual(requests.at(-1).mute, [21]);
  assert.deepEqual(requests.at(-1).unmute, [11], 'the game NXGS muted is released when it comes forward');
  reply({ 21: 1 });
  await settle();

  // No session for A yet: the next timed pass unmutes it again.
  const sentBeforeRetry = requests.length;
  await wait(2100);
  assert.equal(requests.length, sentBeforeRetry + 1, 'one retry is sent and the next waits for its reply');
  assert.deepEqual(requests.at(-1).unmute, [11], 'an audible game without a session yet is retried');
  assert.deepEqual(requests.at(-1).mute, [21], 'background games stay muted on every pass');
  reply({ 11: 1, 21: 1 });
  await settle();

  // A game without a known pid is matched by its image name.
  targets = [
    { gameId: 'a', title: 'A', processIds: [11], processNames: [], audible: true },
    { gameId: 'c', title: 'C', processIds: [], processNames: ['Slow Start.exe'], audible: false }
  ];
  focus.refresh();
  assert.deepEqual(requests.at(-1).muteNames, ['slow start'], 'a slow-starting game is muted by image name');
  assert.deepEqual(requests.at(-1).unmute, [11, 21], 'B left NXGS while muted, so it is released');

  // A failed pass keeps the release pending and retries after a delay.
  reply({}, false);
  await settle();
  targets = [{ gameId: 'a', title: 'A', processIds: [11], processNames: [], audible: true }];
  focus.refresh();
  const sentBeforeBackoff = requests.length;
  await wait(2100);
  assert.ok(requests.length > sentBeforeBackoff, 'a failed pass is retried');
  assert.ok(requests.at(-1).unmute.includes(21), 'a release whose pass failed is sent again');
  assert.deepEqual(requests.at(-1).unmuteNames, ['slow start']);
  reply({ 11: 1 });
  await settle();

  // A helper that stops is replaced and the pass is repeated.
  const beforeExit = requests.length;
  worker.emit('exit', 1);
  await wait(2100);
  assert.equal(spawned, 2, 'a stopped helper is restarted');
  assert.ok(requests.length > beforeExit);
  assert.deepEqual(requests.at(-1).unmute, [11], 'the game on screen is re-asserted after a restart');
  reply({ 11: 1 });
  await settle();

  focus.stop();
}

const workerSource = readFileSync(new URL('../src/main/gameAudioFocus.ts', import.meta.url), 'utf8');
assert.match(workerSource, /IAudioSessionManager2[\s\S]*GetProcessId[\s\S]*SetMute/, 'muting must use per-process audio sessions');
assert.doesNotMatch(workerSource, /IAudioEndpointVolume/, 'game audio focus must never change the system volume');
assert.match(workerSource, /applied = volume\.SetMute\(shouldMute, ref context\) == 0/, 'a failed SetMute must not count as applied');
const mainSource = readFileSync(new URL('../src/main/main.ts', import.meta.url), 'utf8');
assert.match(mainSource, /onActiveGameChanged: \(\) => \{[\s\S]*gameAudioFocus\.refresh\(\)/);
assert.match(mainSource, /app\.getAppMetrics\(\)[\s\S]*launcher\.audioTargets/, 'NXGS must never mute its own processes');
assert.match(mainSource, /function prepareForQuit\(\)[\s\S]*gameAudioFocus\.stop\(\)/);

console.log('Game audio focus: presented game audible, background games muted, retries, name matching, and worker recovery passed.');
