import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const profile = await mkdtemp(join(tmpdir(), 'nxgs-device-manager-'));
const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function launch(port) {
  const child = spawn(electron, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '.'], {
    cwd: root,
    env: { ...process.env, APPDATA: profile },
    windowsHide: true,
    stdio: 'ignore'
  });

  let page;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      page = pages.find((candidate) => candidate.type === 'page');
      if (page) break;
    } catch {}
    await delay(100);
  }
  if (!page) throw new Error('NXGS Device Manager test window did not expose a debug page.');

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', rejectOpen, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolveSend, rejectSend) => {
    const id = ++nextId;
    pending.set(id, { resolve: resolveSend, reject: rejectSend });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression, message) => {
    for (let attempt = 0; attempt < 220; attempt += 1) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(message);
  };
  await send('Runtime.enable');
  await waitFor("Boolean(document.querySelector('button[aria-label=Settings]'))", 'Launcher Home did not render.');
  return { child, socket, send, evaluate, waitFor };
}

async function stop(client) {
  void client.evaluate("window.nxgs.exitApp('1234')").catch(() => {});
  for (let attempt = 0; attempt < 30 && client.child.exitCode === null; attempt += 1) await delay(100);
  if (client.child.exitCode === null) client.child.kill();
  client.socket.close();
}

let client;
try {
  client = await launch(9461);
  const dataPath = await client.evaluate('window.nxgs.getInitialData().then((data) => data.dataPath)');
  await stop(client);
  client = null;

  const legacyTimestamp = '2026-01-02T03:04:05.000Z';
  await writeFile(dataPath, `${JSON.stringify({
    schemaVersion: 4,
    games: [{
      id: 'legacy_game',
      title: 'Legacy Game',
      avatarImagePath: '',
      coverImagePath: '',
      source: 'Manual',
      availabilityStatus: 'available',
      launchType: 'custom',
      launchCommand: 'legacy-game',
      workingDirectory: '',
      processName: '',
      launchArguments: '',
      launchMode: 'borderlessPreferred',
      enabled: true,
      createdAt: legacyTimestamp,
      updatedAt: legacyTimestamp
    }],
    plans: [{
      id: 'legacy_plan',
      name: 'Legacy 30 Minutes',
      durationMinutes: 30,
      amountPaise: 5000,
      currency: 'INR',
      enabled: true,
      displayOrder: 0,
      createdAt: legacyTimestamp,
      updatedAt: legacyTimestamp
    }]
  }, null, 2)}\n`, 'utf8');

  client = await launch(9462);
  const migrated = await client.evaluate('window.nxgs.getInitialData()');
  assert.ok(migrated.currentDevice.id.startsWith('device_'));
  assert.equal(migrated.games.length, 1);
  assert.equal(migrated.games[0].id, 'legacy_game');
  assert.equal(migrated.games[0].deviceId, migrated.currentDevice.id);
  const migratedPlans = await client.evaluate('window.nxgs.listPlayPlans()');
  assert.equal(migratedPlans[0].deviceId, migrated.currentDevice.id);
  assert.equal(migratedPlans[0].scope, 'device');

  await client.evaluate("document.querySelector('button[aria-label=Settings]').click()");
  await client.waitFor("[...document.querySelectorAll('button')].some((button) => button.textContent.includes('Control Room'))", 'Control Room did not render.');
  await client.evaluate("[...document.querySelectorAll('button')].find((button) => button.textContent.includes('Control Room')).click()");
  await client.waitFor("Boolean(document.querySelector('.pin-modal input[type=password]'))", 'Admin PIN dialog did not open.');
  await client.evaluate("document.querySelector('.pin-modal input[type=password]').focus()");
  await client.send('Input.insertText', { text: '1234' });
  await client.evaluate("[...document.querySelectorAll('.pin-modal button')].find((button) => button.textContent.includes('Unlock')).click()");
  await client.waitFor("Boolean(document.querySelector('.admin-options-modal'))", 'Admin options did not open.');
  await client.evaluate("[...document.querySelectorAll('.admin-options-modal button')].find((button) => button.textContent.includes('Open Management')).click()");
  await client.waitFor("Boolean(document.querySelector('.admin-screen'))", 'Admin management did not open.');
  await client.evaluate("[...document.querySelectorAll('.admin-sidebar nav button')].find((button) => button.textContent.includes('Device Manager')).click()");
  await client.waitFor("Boolean(document.querySelector('.device-editor-panel'))", 'Device Manager did not render.');

  await client.evaluate(`(() => {
    const setValue = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const inputs = [...document.querySelectorAll('.device-editor-panel input')];
    setValue(inputs[0], 'PC 01');
    setValue(inputs[1], 'Main Store');
    setValue(inputs[2], 'Cabin 1');
    document.querySelector('.device-editor-panel form button[type="submit"]').click();
  })()`);
  await client.waitFor("document.querySelector('.device-overview-panel h2')?.textContent.includes('PC 01')", 'Saved device name did not render.');

  const savedSummary = await client.evaluate('window.nxgs.getCurrentDevice()');
  assert.equal(savedSummary.device.id, migrated.currentDevice.id);
  assert.equal(savedSummary.device.name, 'PC 01');
  assert.equal(savedSummary.device.storeName, 'Main Store');
  assert.equal(savedSummary.device.location, 'Cabin 1');
  assert.equal(savedSummary.gameCount, 1);
  assert.equal(savedSummary.activePlanCount, 1);

  const addedGame = await client.evaluate(`window.nxgs.saveGame({
    title: 'PC 01 Game', source: 'Manual', availabilityStatus: 'available', launchType: 'custom',
    launchCommand: 'pc01-game', workingDirectory: '', processName: '', launchArguments: '', enabled: true
  })`);
  assert.equal(addedGame.game.deviceId, migrated.currentDevice.id);
  const addedPlan = await client.evaluate(`window.nxgs.savePlayPlan({
    name: 'PC 01 Hour', durationMinutes: 60, amountPaise: 10000, currency: 'INR', scope: 'device', enabled: true
  })`);
  assert.equal(addedPlan.plan.deviceId, migrated.currentDevice.id);
  assert.equal(addedPlan.plan.scope, 'device');

  await client.evaluate(`window.nxgs.deleteGame(${JSON.stringify(addedGame.game.id)})`);
  await client.evaluate(`window.nxgs.deletePlayPlan(${JSON.stringify(addedPlan.plan.id)})`);
  const saved = JSON.parse(await readFile(dataPath, 'utf8'));
  assert.equal(saved.schemaVersion, 5);
  assert.equal(saved.currentDeviceId, migrated.currentDevice.id);
  assert.equal(saved.devices[0].name, 'PC 01');
  assert.ok(saved.games.find((game) => game.id === 'legacy_game' && game.deviceId === saved.currentDeviceId));
  assert.ok(saved.games.find((game) => game.id === addedGame.game.id)?.deletedAt);
  assert.ok(saved.plans.find((plan) => plan.id === 'legacy_plan' && plan.deviceId === saved.currentDeviceId));
  assert.ok(saved.plans.find((plan) => plan.id === addedPlan.plan.id)?.deletedAt);
  assert.deepEqual(saved.sessions, []);
  assert.ok(saved.games.every((game) => game.syncStatus));
  assert.ok(saved.plans.every((plan) => plan.syncStatus));

  console.log('Legacy games/plans migrated to a stable device, Device Manager saved PC 01, new records were device-linked, and sync tombstones persisted.');
  await stop(client);
  client = null;
} finally {
  if (client) await stop(client);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(profile, { recursive: true, force: true });
      break;
    } catch {
      await delay(150);
    }
  }
}
