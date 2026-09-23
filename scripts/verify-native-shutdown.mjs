import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

assert.equal(process.platform, 'win32', 'This integration test requires Windows');
const require = createRequire(import.meta.url);
function loadSource(file, mocks = {}) {
  const exported = {};
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  vm.runInNewContext(source, {
    exports: exported, require: name => mocks[name] ?? require(name), process,
    setTimeout, clearTimeout, setInterval, clearInterval
  });
  return exported;
}
const native = loadSource('../src/main/windowsProcess.ts');
const { GameLauncher } = loadSource('../src/main/gameLauncher.ts', {
  electron: {}, './logger': { logLine: async () => {} }, './gameLifecycle': {},
  './windowsProcess': native, './gameWindowIdentity': {}, './gamePresentation': {},
  './windowManagerService': {}, './windowsControlWorker': {}
});

// Both processes belong to this fixture; neither publishes a window or exits
// voluntarily. The production shutdown path must terminate the entire tree.
const fixture = spawn(process.execPath, ['-e', `
  const child = require('node:child_process').spawn(process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' });
  console.log(child.pid);
  setInterval(() => {}, 1000);
`], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let descendant;
try {
  descendant = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Fixture did not start')), 10000);
    fixture.once('error', error => { clearTimeout(timeout); reject(error); });
    fixture.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes('\n')) { clearTimeout(timeout); resolve(Number(output.trim())); }
    });
  });
  assert.ok(descendant > 0);
  assert.equal(await native.isProcessRunningByPid(descendant, true), true);
  const launcher = new GameLauncher(() => null, {
    onActiveGameChanged() {}, onGameExited() {}, onError() {}, onGameWindowDetected() {}
  });
  const game = { id: 'native-shutdown-fixture', title: 'Windowless shutdown fixture', launchType: 'localExe' };
  Object.assign(launcher, {
    activeGame: game, activeProcessId: fixture.pid, child: fixture,
    state: { status: 'running', game, updatedAt: new Date().toISOString() }
  });
  const result = await launcher.closeGamesForExit();
  assert.equal(result.ok, true);
  assert.equal(await native.isProcessRunningByPid(fixture.pid, true), false, 'root must exit');
  assert.equal(await native.isProcessRunningByPid(descendant, true), false, 'child must exit');
  assert.equal(launcher.hasTrackedGames, false);
  console.log('Native Windows shutdown passed: windowless root and descendant processes both terminated.');
} finally {
  for (const pid of [fixture.pid, descendant].filter(Boolean)) {
    if (await native.isProcessRunningByPid(pid, true)) await native.closeProcessByPid(pid, true);
  }
}
