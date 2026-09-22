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
  const forced = [];
  let clock = 0;
  let sweep;
  const mocks = {
    electron: {}, './logger': { logLine: async () => {} }, './gameLifecycle': {},
    './windowsProcess': {
      isProcessRunning: async () => false,
      isProcessRunningByPid: async (pid, strict) => {
        if (options.probeFails) {
          assert.equal(strict, true, 'shutdown must treat an unavailable probe as still running');
        }
        if (options.probeFails) throw new Error('tasklist failed');
        return running.has(pid);
      },
      closeProcessByPid: async (pid, force) => {
        assert.equal(force, true, 'shutdown must force the complete PID tree');
        forced.push(pid);
        running.delete(pid);
      },
      closeProcessByName: async () => {}
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
  return { launcher, hidden, running, closed, forced, sweep: () => sweep?.() };
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
  assert.deepEqual(h.forced, [], 'cooperative games do not require force termination');
  assert.equal(h.launcher.hasTrackedGames, false);
}
{
  const h = harness({ refusesClose: true });
  const result = await h.launcher.closeGamesForExit();
  assert.equal(result.ok, true);
  assert.deepEqual(h.forced, [101, 102]);
  assert.equal(h.running.size, 0, 'refusing games must be force terminated');
  assert.equal(h.launcher.hasTrackedGames, false);
  assert.equal(h.hidden.size, 0, 'shutdown must not depend on hiding game windows');
}
{
  const h = harness({ probeFails: true });
  assert.equal((await h.launcher.closeGamesForExit()).ok, true);
  assert.deepEqual(h.forced, [101, 102, 101, 102], 'failed process inspection must force exact tracked PIDs on both passes');
  assert.equal(h.launcher.hasTrackedGames, false);
}
{
  const h = harness({ refusesClose: true });
  const launch = defer();
  h.launcher.launchCompletion = launch.promise;
  const closing = h.launcher.closeGamesForExit();
  await Promise.resolve();
  assert.deepEqual(h.forced, [], 'shutdown must wait for pending launch identity discovery');
  launch.resolve();
  assert.equal((await closing).ok, true);
  assert.deepEqual(h.forced, [101, 102]);
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
  h.launcher.sessions.get('game-101').window = null;
  h.launcher.sessions.get('game-102').window = null;
  h.launcher.activeWindow = null;
  assert.equal((await h.launcher.closeGamesForExit()).ok, true, 'windowless games must never block app shutdown');
  assert.deepEqual(h.forced, [101, 102]);
  assert.equal(h.closed.length, 0, 'windowless shutdown goes directly through tracked process trees');
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
assert.doesNotMatch(compiled, /closeGamesForExit[\s\S]*?await this\.parkAllGames\(\)/, 'shutdown must not depend on desktop containment');
assert.match(main, /await launcher\.parkAllGames\(\)[\s\S]*if \(!parked.ok\) return parked;[\s\S]*setKioskMode\('admin'\)/);
assert.match(main, /app\.on\('before-quit'[\s\S]*event\.preventDefault\(\)[\s\S]*closeGamesBeforeQuit/);
assert.match(main, /updates:install[\s\S]*await closeGamesBeforeQuit\(\)[\s\S]*startUpdateInstaller/);
console.log('Game containment: multiple games, selective resume, native hide race, slow launch, failed hide, graceful shutdown, forced shutdown, windowless shutdown, and failed exit probe passed.');
