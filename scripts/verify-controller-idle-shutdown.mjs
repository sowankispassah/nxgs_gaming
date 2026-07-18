import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import {
  ControllerIdlePolicy,
  CONTROLLER_SHUTDOWN_WARNING_MS,
  SESSION_END_IDLE_MS,
  SHUTDOWN_RETRY_COOLDOWN_MS
} from '../src/main/controllerIdlePolicy.ts';

const settings = { autoTurnOffMinutes: 5, shutdownWarning: true };
const policy = new ControllerIdlePolicy(settings);
const start = 1_000_000;

policy.connect('001122AABBCC', 'DualSense one', start);
policy.connect('AABBCCDDEEFF', 'DualSense two', start + 10_000);
assert.equal(policy.connectedControllers.length, 2, 'controllers must have independent state');

let actions = policy.tick(start + 5 * 60_000 - CONTROLLER_SHUTDOWN_WARNING_MS);
assert.deepEqual(actions.map((action) => action.type), ['warning']);
assert.equal(actions[0].controller.id, '001122AABBCC');

actions = policy.activity('001122AABBCC', start + 5 * 60_000 - 10_000);
assert.deepEqual(actions.map((action) => action.type), ['warning-cancelled']);
assert.equal(policy.tick(start + 5 * 60_000).filter((action) => action.controller.id === '001122AABBCC').length, 0);

actions = policy.tick(start + 10_000 + 5 * 60_000);
assert.equal(actions.find((action) => action.controller.id === 'AABBCCDDEEFF')?.type, 'shutdown');

const never = new ControllerIdlePolicy({ autoTurnOffMinutes: 0, shutdownWarning: true });
never.connect('001122AABBCC', 'DualSense', start);
never.paidSessionEnded(start);
assert.deepEqual(never.tick(start + 24 * 60 * 60_000), [], 'Never must disable every automatic shutdown path');

for (const minutes of [5, 10, 15, 30]) {
  const timeoutPolicy = new ControllerIdlePolicy({ autoTurnOffMinutes: minutes, shutdownWarning: false });
  timeoutPolicy.connect('001122AABBCC', 'DualSense', start);
  assert.equal(timeoutPolicy.tick(start + minutes * 60_000 - 1).some((action) => action.type === 'shutdown'), false);
  assert.equal(timeoutPolicy.tick(start + minutes * 60_000)[0]?.type, 'shutdown', `${minutes}-minute timeout must fire exactly once`);
}

const sessionPolicy = new ControllerIdlePolicy({ autoTurnOffMinutes: 30, shutdownWarning: true });
sessionPolicy.connect('001122AABBCC', 'DualSense', start);
sessionPolicy.paidSessionEnded(start + 5_000);
actions = sessionPolicy.tick(start + 5_000 + SESSION_END_IDLE_MS - CONTROLLER_SHUTDOWN_WARNING_MS);
assert.equal(actions[0]?.type, 'warning', 'session end must use the 60-second idle grace period');
sessionPolicy.activity('001122AABBCC', start + 50_000);
assert.equal(
  sessionPolicy.tick(start + 50_000 + SESSION_END_IDLE_MS - 1).some((action) => action.type === 'shutdown'),
  false,
  'active controllers must not shut down before a full idle grace period'
);
actions = sessionPolicy.tick(start + 50_000 + SESSION_END_IDLE_MS);
assert.equal(actions[0]?.type, 'shutdown', 'activity must reset the session-end idle grace timer');

const gameplayPolicy = new ControllerIdlePolicy({ autoTurnOffMinutes: 5, shutdownWarning: true });
gameplayPolicy.connect('001122AABBCC', 'DualSense', start);
actions = gameplayPolicy.tick(start + 5 * 60_000 - CONTROLLER_SHUTDOWN_WARNING_MS);
assert.equal(actions[0]?.type, 'warning');
actions = gameplayPolicy.setGameplayActive(true, start + 5 * 60_000 - 10_000);
assert.equal(actions[0]?.type, 'warning-cancelled', 'starting gameplay must cancel a pending shutdown warning');
assert.deepEqual(
  gameplayPolicy.tick(start + 24 * 60 * 60_000),
  [],
  'automatic shutdown must remain blocked for the entire active game session'
);
gameplayPolicy.paidSessionEnded(start + 24 * 60 * 60_000);
gameplayPolicy.setGameplayActive(false, start + 24 * 60 * 60_000 + 5_000);
assert.equal(
  gameplayPolicy.tick(start + 24 * 60 * 60_000 + 5_000 + SESSION_END_IDLE_MS - 1).some((action) => action.type === 'shutdown'),
  false,
  'ending gameplay must start a fresh session-end grace period'
);
assert.equal(
  gameplayPolicy.tick(start + 24 * 60 * 60_000 + 5_000 + SESSION_END_IDLE_MS)[0]?.type,
  'shutdown',
  'idle shutdown may resume only after gameplay has ended and the full grace period elapsed'
);

sessionPolicy.shutdownFailed('001122AABBCC', start + 120_000);
assert.deepEqual(sessionPolicy.tick(start + 120_000 + SHUTDOWN_RETRY_COOLDOWN_MS - 1), [], 'failures must use a retry cooldown');

const root = process.cwd();
const helper = join(root, 'vendor', 'controller-idle-helper', 'NxgsControllerIdleHelper.exe');
assert.equal(execFileSync(helper, ['--self-test'], { encoding: 'utf8' }).trim(), 'SELF_TEST|OK');

if (process.env.NXGS_LIVE_CONTROLLER_TEST === '1') {
  const shouldShutdown = process.env.NXGS_LIVE_CONTROLLER_SHUTDOWN_TEST === '1';
  const traceInput = process.env.NXGS_TRACE_CONTROLLER_INPUT === '1';
  const liveOutput = await new Promise((resolve, reject) => {
    const child = spawn(helper, traceInput ? ['--trace-input'] : [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let shutdownRequested = false;
    let stopScheduled = false;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Live controller helper probe timed out. ${stderr}`));
    }, 10_000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const connected = stdout.match(/^CONNECTED\|([0-9A-F]{12})\|[^|]+\|bluetooth\|[0-9A-F]{12}$/m);
      if (shouldShutdown && connected && !shutdownRequested) {
        shutdownRequested = true;
        child.stdin.write(`SHUTDOWN|${connected[1]}\n`);
      }
      if (shouldShutdown && /^SHUTDOWN_RESULT\|[0-9A-F]{12}\|(?:OK|FAIL)\|/m.test(stdout) && !stopScheduled) {
        stopScheduled = true;
        setTimeout(() => child.stdin.end('STOP\n'), 500);
      } else if (!shouldShutdown && stdout.includes('READY|1') && !stopScheduled) {
        stopScheduled = true;
        setTimeout(() => child.stdin.end('STOP\n'), 2_000);
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`Live controller helper exited with ${code}. ${stderr}`));
    });
  });
  assert.match(liveOutput, /^READY\|1$/m, 'live helper must complete its startup handshake');
  assert.match(liveOutput, /^CONNECTED\|[0-9A-F]{12}\|[^|]+\|bluetooth\|[0-9A-F]{12}$/m, 'live Bluetooth DualSense must be detected with a resolvable address');
  if (shouldShutdown) {
    assert.match(liveOutput, /^SHUTDOWN_RESULT\|[0-9A-F]{12}\|OK\|(?:0|1167)\|IOCTL_BTH_DISCONNECT_DEVICE\|paired-link-disconnected$/m, 'live DualSense shutdown must use the paired-safe Bluetooth disconnect action');
    assert.match(liveOutput, /^DISCONNECTED\|[0-9A-F]{12}\|shutdown$/m, 'the helper must clear the connected HID state after shutdown');
    console.log('Live Bluetooth DualSense paired-safe shutdown passed.');
  }
  console.log('Live Bluetooth DualSense detection and helper IPC handshake passed.');
  if (traceInput) console.log(liveOutput.split(/\r?\n/).filter((line) => line.startsWith('TRACE|')).join('\n'));
}

const helperSource = readFileSync(join(root, 'native', 'controller-idle-helper', 'Program.cs'), 'utf8');
assert.match(helperSource, /SonyVendorId = 0x054C/);
assert.match(helperSource, /IsBluetoothPath/);
assert.match(helperSource, /IoctlBthDisconnectDevice = 0x0041000C/);
assert.match(helperSource, /report\[0\] == 0x01 \? 0x03 : 0xF7/, 'compact Bluetooth reports must ignore the rolling sequence counter');
assert.doesNotMatch(helperSource, /BluetoothRemoveDevice|UnpairAsync/);

const databaseSource = readFileSync(join(root, 'src', 'main', 'database.ts'), 'utf8');
assert.match(databaseSource, /autoTurnOffMinutes: 10/);
assert.match(databaseSource, /shutdownWarning: true/);

const mainSource = readFileSync(join(root, 'src', 'main', 'main.ts'), 'utf8');
assert.match(
  mainSource,
  /controllerIdleService\?\.setGameplayActive\(true\);[\s\S]*controllerCompatibility\.ensureReadyForGame\(game\)/,
  'launch must suspend idle shutdown before waiting for controller compatibility'
);
assert.match(mainSource, /onActiveGameChanged:[\s\S]*setGameplayActive\(launcher\.hasTrackedGames\)/);

const packageConfig = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
assert.ok(packageConfig.build.extraResources.some((resource) => resource.to === 'controller-idle-helper'));

console.log('Controller idle shutdown policy, helper parser, transport guard, defaults, cooldown, and packaging checks passed.');
