import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL('../src/main/gameLauncher.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

// Exercise the real worker transport: containment must receive native HWNDs,
// including when a response arrives in multiple stdout chunks.
{
  const exported = {};
  const worker = new EventEmitter();
  worker.exitCode = null;
  worker.killed = false;
  worker.stdout = new EventEmitter();
  worker.stdout.setEncoding = () => {};
  worker.stderr = { resume() {} };
  worker.stdin = { write(line) {
    const { id } = JSON.parse(line);
    const response = JSON.stringify({ id, ok: true, handles: [2362720], message: 'hidden' }) + '\n';
    queueMicrotask(() => {
      worker.stdout.emit('data', response.slice(0, 25));
      worker.stdout.emit('data', response.slice(25));
    });
  } };
  const source = ts.transpileModule(readFileSync(new URL('../src/main/windowsControlWorker.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  vm.runInNewContext(source, {
    exports: exported, require: name => name === 'node:child_process' ? { spawn: () => worker } : require(name),
    process: { platform: 'win32', env: {} }, setTimeout, clearTimeout
  });
  const result = await exported.runWindowsControl('hide-game', { handle: 2362720, processId: 21880, processName: 'project_top' });
  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(result.handles ?? []), [2362720], 'native hidden-window handles must survive the worker response');
}

function harness(options = {}) {
  const exported = {};
  const hidden = new Set();
  const running = new Set([101, 102]);
  const closed = [];
  let clock = 0;
  let sweep;
  const mocks = {
    electron: {}, './logger': { logLine: async () => {} }, './gameLifecycle': {},
    './windowsProcess': {
      isProcessRunningByPid: async (pid, strict) => {
        assert.equal(strict, true, 'shutdown requires a verified process result');
        if (options.probeFails) throw new Error('tasklist failed');
        return running.has(pid);
      }
    },
    './gameWindowIdentity': { gameWindowMatchesGame: (_game, win, pid) => win.processId === pid },
    './gamePresentation': { isFullscreenGamePresentation: () => true, describeGamePresentation: () => 'verified' },
    './windowManagerService': {
      hideGameWindows: async win => {
        if (options.noWindows) return [];
        if (options.hideGate) await options.hideGate.promise;
        hidden.add(win.processId);
        return [win.handle];
      },
      closeGameWindow: async win => {
        closed.push(win.processId);
        if (!options.refusesClose) running.delete(win.processId);
      },
      keepGameWindowOnTop: async win => { hidden.delete(win.processId); return {}; }
    }
  };
  vm.runInNewContext(compiled, {
    exports: exported, require: name => mocks[name] ?? require(name), process,
    Date: class extends Date { static now() { return clock; } },
    setTimeout: (fn, ms) => { clock += ms; queueMicrotask(fn); return 1; }, clearTimeout() {},
    setInterval: fn => { sweep = fn; return 1; }, clearInterval: () => { sweep = null; }
  });
  const launcher = new exported.GameLauncher(() => null, {
    onGameExited() {}, onError() {}, onGameWindowDetected() {}, onActiveGameChanged() {}
  });
  Object.assign(launcher, {
    monitorByProcessName() {}, scheduleGamePresentationReinforcement() {},
    suppressWindowsTaskbar: async () => {}, launchMode: () => 'fullscreen'
  });
  for (const pid of running) {
    const game = { id: `game-${pid}`, title: `Game ${pid}`, launchType: 'localExe' };
    Object.assign(launcher, {
      activeGame: game, activeProcessId: pid,
      activeWindow: { handle: pid + 1000, processId: pid, processName: `game${pid}` },
      state: { status: 'running', game, windowState: 'foreground', updatedAt: new Date().toISOString() }
    });
    launcher.storeCurrentSession();
  }
  return { launcher, hidden, running, closed, sweep: () => sweep?.() };
}

{
  const h = harness();
  assert.equal((await h.launcher.parkAllGames()).ok, true);
  assert.deepEqual([...h.hidden], [101, 102]);
  assert.equal(h.launcher.activeState.sessions.length, 2);
  assert.equal(h.launcher.activeState.status, 'minimizedToHome');
  assert.equal((await h.launcher.resumeActiveGame('game-101')).ok, true);
  assert.deepEqual([...h.hidden], [102], 'resume reveals only the selected game');
  await h.launcher.hideParkedGames();
  assert.deepEqual([...h.hidden], [102], 'guard must not re-hide the resumed game');
  assert.equal(await h.launcher.stageQuickOverlayBackdropWindow({ processId: 999 }), false);
}
{
  const h = harness();
  assert.equal((await h.launcher.closeGamesForExit()).ok, true);
  assert.deepEqual(h.closed, [101, 102]);
  assert.equal(h.running.size, 0);
  assert.equal(h.launcher.hasTrackedGames, false);
}
{
  const h = harness({ refusesClose: true });
  const result = await h.launcher.closeGamesForExit();
  assert.equal(result.ok, false);
  assert.match(result.error, /did not close/);
  assert.equal(h.launcher.activeState.sessions.length, 2, 'refusal must retain game ownership');
  assert.equal(h.hidden.size, 2);
}
{
  const h = harness({ probeFails: true });
  assert.equal((await h.launcher.closeGamesForExit()).ok, false);
  assert.equal(h.launcher.hasTrackedGames, true, 'probe failure cannot be treated as exit');
}
{
  const h = harness();
  const launch = defer();
  h.launcher.launchCompletion = launch.promise;
  const parking = h.launcher.parkAllGames();
  assert.equal(h.hidden.size, 0, 'late game discovery must settle before desktop exposure');
  assert.equal((await h.launcher.resumeActiveGame()).ok, false);
  launch.resolve();
  assert.equal((await parking).ok, true);
  assert.equal(h.hidden.size, 2);
}
{
  const h = harness();
  h.launcher.sessions.get('game-101').window = null;
  assert.equal((await h.launcher.parkAllGames()).ok, false, 'unverified windows must block desktop transition');
}
{
  const h = harness({ noWindows: true });
  assert.equal((await h.launcher.parkAllGames()).ok, false, 'live process without an owned HWND must not be mistaken for a hidden game');
  assert.equal(h.closed.length, 0);
}
{
  const h = harness({ noWindows: true });
  h.running.clear();
  assert.equal((await h.launcher.closeGamesForExit()).ok, true, 'already exited sessions should be retired safely');
  assert.equal(h.closed.length, 0, 'never close a stale HWND after its process exited');
}
{
  const gate = defer();
  const h = harness({ hideGate: gate });
  h.launcher.parkedGameIds.add('game-101');
  const hide = h.launcher.hideParkedGames();
  const resume = h.launcher.resumeActiveGame('game-101');
  gate.resolve();
  await hide;
  assert.equal((await resume).ok, true);
  assert.equal(h.hidden.has(101), false, 'an in-flight hide must finish before resume shows the game');
}

const main = readFileSync(new URL('../src/main/main.ts', import.meta.url), 'utf8');
assert.match(main, /await launcher\.parkAllGames\(\)[\s\S]*if \(!parked.ok\) return parked;[\s\S]*setKioskMode\('admin'\)/);
assert.match(main, /app\.on\('before-quit'[\s\S]*event\.preventDefault\(\)[\s\S]*closeGamesBeforeQuit/);
assert.match(main, /updates:install[\s\S]*await closeGamesBeforeQuit\(\)[\s\S]*startUpdateInstaller/);
console.log('Game containment: multiple games, selective resume, native hide race, slow launch, failed hide, graceful exit, refused close, and failed exit probe passed.');
