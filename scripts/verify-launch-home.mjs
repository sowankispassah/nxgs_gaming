import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/main/gameLauncher.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const require = createRequire(import.meta.url);
const game = { id: 'test-game', title: 'Slow game', launchType: 'executable', processName: 'slow.exe' };
const window = { handle: 123, processId: 42, processName: 'slow.exe' };
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function harness() {
  const discovery = deferred();
  const native = deferred();
  let nativeCalls = 0;
  let fastCalls = 0;
  const exported = {};
  const mocks = {
    electron: {},
    './logger': { logLine: async () => {} },
    './gameLifecycle': {},
    './windowsProcess': { isProcessRunning: async () => true },
    './gameWindowIdentity': { gameWindowMatchesGame: () => true },
    './gamePresentation': { isFullscreenGamePresentation: () => true, describeGamePresentation: () => 'verified' },
    './windowManagerService': {
      waitForGameWindow: () => discovery.promise,
      resumeGameWindowFast: async () => { fastCalls++; return {}; },
      keepGameWindowOnTop: () => { nativeCalls++; return native.promise; }
    }
  };
  vm.runInNewContext(compiled, {
    exports: exported, require: (name) => mocks[name] ?? require(name),
    setTimeout, clearTimeout, setInterval, clearInterval, process
  });
  const launcher = new exported.GameLauncher(() => null, {
    onGameExited() {}, onError() {}, onGameWindowDetected() {}, onActiveGameChanged() {}
  });
  Object.assign(launcher, {
    activeGame: game, activeProcessId: 42, operationInFlight: 'launch', focusGeneration: 1,
    state: { status: 'launching', game, updatedAt: new Date().toISOString() },
    monitorByProcessName() {}, scheduleGamePresentationReinforcement() {},
    suppressWindowsTaskbar: async () => {}, launchMode: () => 'fullscreen'
  });
  return { launcher, discovery, native, nativeCalls: () => nativeCalls, fastCalls: () => fastCalls };
}

// Home resolves while the real discovery promise remains pending.
{
  const h = harness();
  const activation = h.launcher.activateLaunchedGame(game, 1);
  assert.equal((await h.launcher.openQuickOverlay({ focusLauncher: false })).ok, true);
  assert.equal(h.launcher.focusGeneration, 1, 'Home must not cancel discovery');
  assert.equal(h.nativeCalls(), 0);
  h.discovery.resolve(window);
  await activation;
  assert.equal(h.launcher.activeState.status, 'quickOverlayOpen');
  assert.equal(h.nativeCalls(), 0, 'late window arrival must not steal focus');
}

// Dismissing while discovery is pending lets the normal fullscreen handoff finish.
{
  const h = harness();
  const activation = h.launcher.activateLaunchedGame(game, 1);
  await h.launcher.openQuickOverlay({ focusLauncher: false });
  assert.equal((await h.launcher.resumeActiveGame(game.id)).ok, true);
  h.native.resolve({});
  h.discovery.resolve(window);
  await activation;
  assert.equal(h.launcher.activeState.status, 'running');
  assert.equal(h.nativeCalls(), 1);
}

// An already-running native attempt may settle, but must not trigger retries.
{
  const h = harness();
  const activation = h.launcher.activateLaunchedGame(game, 1);
  h.discovery.resolve(window);
  for (let i = 0; i < 20 && !h.nativeCalls(); i++) await Promise.resolve();
  assert.equal(h.nativeCalls(), 1);
  await h.launcher.openQuickOverlay({ focusLauncher: false });
  h.native.resolve({});
  await activation;
  assert.equal(h.launcher.activeState.status, 'quickOverlayOpen');
  assert.equal(h.nativeCalls(), 1);
}

// Repeated toggles keep only the latest intent while retaining discovery.
{
  const h = harness();
  const activation = h.launcher.activateLaunchedGame(game, 1);
  await h.launcher.openQuickOverlay({ focusLauncher: false });
  await h.launcher.resumeActiveGame(game.id);
  await h.launcher.openQuickOverlay({ focusLauncher: false });
  h.discovery.resolve(window);
  await activation;
  assert.equal(h.launcher.activeState.status, 'quickOverlayOpen');
  assert.equal(h.nativeCalls(), 0);
}

// Discovery timeout must not close Home or mark an unverified game foreground.
{
  const h = harness();
  h.launcher.isGameStillRunning = async () => true;
  const activation = h.launcher.activateLaunchedGame(game, 1);
  await h.launcher.openQuickOverlay({ focusLauncher: false });
  h.discovery.resolve(null);
  await activation;
  assert.equal(h.launcher.activeState.status, 'quickOverlayOpen');
  assert.equal(h.launcher.activeState.windowDetected, false);
  assert.equal(h.launcher.gameInForeground, false);
}

// First resume after discovery behind Home must size the game before focusing.
{
  const h = harness();
  h.launcher.operationInFlight = null;
  h.launcher.activeWindow = window;
  h.launcher.state.status = 'quickOverlayOpen';
  h.native.resolve({});
  assert.equal((await h.launcher.resumeActiveGame(undefined, true)).ok, true);
  assert.equal(h.fastCalls(), 0);
  assert.equal(h.nativeCalls(), 1);
  assert.equal(h.launcher.activeState.status, 'running');
}

// Execute the production loading-to-live transition with delayed preparation.
// Cover removal must be gated by painted game content, native stacking, and the
// same Home request still being open after asynchronous work settles.
{
  const main = readFileSync(new URL('../src/main/main.ts', import.meta.url), 'utf8');
  const promotion = main.slice(main.indexOf('async function promoteLoadingHome('), main.indexOf('function protectLoadingHome('));
  function promotionHarness({ kind = 'direct', staged = true, launching = false } = {}) {
    const ready = deferred();
    const colors = [];
    let stages = 0;
    let prepares = 0;
    const context = vm.createContext({
      gameplayQuickOverlayTransitionGeneration: 4,
      gameplayQuickOverlayDesiredOpen: true,
      gameplayLaunchCoverGameId: 'test-game',
      gameplayQuickOverlayRendererReady: true,
      gameplayQuickOverlayPreparedBackdropKind: kind,
      gameplayQuickOverlayPreparedWindowHandle: 123,
      gameplayLaunchCoverFocusTimer: 1,
      launcher: { activeState: { game }, isLaunchInProgress: launching, isManagingGames: false },
      prepareGameplayQuickOverlayRenderer: async () => { prepares++; await ready.promise; },
      stageGameplayQuickOverlay: async () => { stages++; return staged; },
      clearInterval() {}, logLine: async () => {}
    });
    vm.runInContext(ts.transpileModule(promotion, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    const run = () => context.promoteLoadingHome({ isDestroyed: () => false, setBackgroundColor: color => colors.push(color) }, game.id);
    return { context, ready, colors, run, stages: () => stages, prepares: () => prepares };
  }
  for (const kind of ['direct', 'live']) {
    const h = promotionHarness({ kind });
    const pending = h.run();
    assert.equal(h.colors.length, 0, 'keep opaque while waiting for real gameplay');
    h.ready.resolve();
    await pending;
    assert.deepEqual(h.colors, ['#00000000']);
    assert.equal(h.context.gameplayLaunchCoverGameId, null);
  }
  for (const options of [{ kind: 'cover' }, { staged: false }]) {
    const h = promotionHarness(options);
    h.ready.resolve();
    await h.run();
    assert.equal(h.colors.length, 0, 'unverified content must retain the opaque cover');
    assert.equal(h.context.gameplayLaunchCoverGameId, game.id);
  }
  {
    const h = promotionHarness();
    const pending = h.run();
    h.context.gameplayQuickOverlayTransitionGeneration++;
    h.ready.resolve();
    await pending;
    assert.equal(h.stages(), 0, 'dismissed/reopened Home must reject a stale promotion');
    assert.equal(h.colors.length, 0);
  }
  {
    const h = promotionHarness({ launching: true });
    await h.run();
    assert.equal(h.prepares(), 0, 'promotion must not compete with launch window discovery');
  }
}
console.log('Launch Home: discovery, handoff races, resume, live promotion, failed staging, and stale promotion cancellation passed.');
