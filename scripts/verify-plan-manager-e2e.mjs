import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const profile = await mkdtemp(join(tmpdir(), 'nxgs-plan-manager-'));
const port = 9342;
const child = spawn(electron, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '.'], {
  cwd: root,
  env: { ...process.env, APPDATA: profile },
  windowsHide: true,
  stdio: 'ignore'
});
const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function getPage() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const page = pages.find((candidate) => candidate.type === 'page');
      if (page) return page;
    } catch {}
    await delay(100);
  }
  throw new Error('NXGS Plan Manager test window did not expose a debug page.');
}

try {
  const page = await getPage();
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
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  };
  const waitFor = async (expression, message) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(message);
  };

  await send('Runtime.enable');
  await waitFor("Boolean(document.querySelector('button[aria-label=Settings]'))", 'Launcher Home did not render.');
  const defaults = await evaluate('window.nxgs.listPlayPlans()');
  assert.deepEqual(defaults.map(({ name, durationMinutes, amountPaise, currency, enabled }) => ({ name, durationMinutes, amountPaise, currency, enabled })), [
    { name: '30 Minutes', durationMinutes: 30, amountPaise: 5000, currency: 'INR', enabled: true },
    { name: '1 Hour', durationMinutes: 60, amountPaise: 10000, currency: 'INR', enabled: true },
    { name: '1 Hour 30 Minutes', durationMinutes: 90, amountPaise: 15000, currency: 'INR', enabled: true }
  ]);
  await evaluate("document.querySelector('button[aria-label=Settings]').click()");
  await waitFor("[...document.querySelectorAll('button')].some((button) => button.textContent.includes('Control Room'))", 'Control Room did not render.');
  await evaluate("[...document.querySelectorAll('button')].find((button) => button.textContent.includes('Control Room')).click()");
  await waitFor("Boolean(document.querySelector('.pin-modal input[type=password]'))", 'Admin PIN dialog did not open.');
  await evaluate("document.querySelector('.pin-modal input[type=password]').focus()");
  await send('Input.insertText', { text: '1234' });
  await evaluate("[...document.querySelectorAll('.pin-modal button')].find((button) => button.textContent.includes('Unlock')).click()");
  await waitFor("Boolean(document.querySelector('.admin-options-modal'))", 'Admin options did not open.');
  await evaluate("[...document.querySelectorAll('.admin-options-modal button')].find((button) => button.textContent.includes('Open Management')).click()");
  await waitFor("Boolean(document.querySelector('.admin-screen'))", 'Admin management did not open.');
  await evaluate("[...document.querySelectorAll('.admin-sidebar nav button')].find((button) => button.textContent.includes('Plan Manager')).click()");
  await waitFor("document.querySelectorAll('.plan-admin-row').length === 3", 'Default plans did not render in Plan Manager.');

  await evaluate(`(() => {
    const setValue = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setValue(document.querySelector('input[placeholder="30 Minutes"]'), '2 Hours');
    const numbers = [...document.querySelectorAll('.plan-editor-panel input[type="number"]')];
    setValue(numbers[0], '120');
    setValue(numbers[1], '200');
    document.querySelector('.plan-editor-panel form button[type="submit"]').click();
  })()`);
  await waitFor("document.querySelectorAll('.plan-admin-row').length === 4 && [...document.querySelectorAll('.plan-admin-row')].some((row) => row.textContent.includes('2 Hours') && row.textContent.includes('₹200.00'))", 'Added plan did not persist and render.');

  await evaluate(`(() => {
    const row = [...document.querySelectorAll('.plan-admin-row')].find((item) => item.textContent.includes('2 Hours'));
    [...row.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Disable').click();
  })()`);
  await waitFor("[...document.querySelectorAll('.plan-admin-row')].find((row) => row.textContent.includes('2 Hours'))?.textContent.includes('Disabled')", 'Disable action did not update the plan.');

  await evaluate(`(() => {
    const row = [...document.querySelectorAll('.plan-admin-row')].find((item) => item.textContent.includes('2 Hours'));
    [...row.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Edit').click();
    const price = [...document.querySelectorAll('.plan-editor-panel input[type="number"]')][1];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(price, '220');
    price.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.plan-editor-panel form button[type="submit"]').click();
  })()`);
  await waitFor("[...document.querySelectorAll('.plan-admin-row')].some((row) => row.textContent.includes('2 Hours') && row.textContent.includes('₹220.00'))", 'Edited price did not update the plan.');

  await evaluate(`(() => {
    const row = [...document.querySelectorAll('.plan-admin-row')].find((item) => item.textContent.includes('2 Hours'));
    const button = [...row.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Delete');
    button.click();
  })()`);
  await waitFor("[...document.querySelectorAll('.plan-admin-row')].find((row) => row.textContent.includes('2 Hours'))?.textContent.includes('Confirm')", 'Delete confirmation did not appear.');
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('.plan-admin-row')].find((item) => item.textContent.includes('2 Hours'));
    [...row.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Confirm').click();
  })()`);
  await waitFor("document.querySelectorAll('.plan-admin-row').length === 3", 'Delete action did not remove the plan.');

  const dataPath = await evaluate('window.nxgs.getInitialData().then((data) => data.dataPath)');
  const saved = JSON.parse(await readFile(dataPath, 'utf8'));
  assert.equal(saved.schemaVersion, 5);
  assert.equal(saved.devices.length, 1);
  assert.equal(saved.currentDeviceId, saved.devices[0].id);
  assert.equal(saved.plans.filter((plan) => !plan.deletedAt).length, 3);
  assert.equal(saved.plans.filter((plan) => plan.deletedAt).length, 1);
  assert.ok(saved.plans.every((plan) => plan.scope === 'global' || plan.deviceId === saved.currentDeviceId));

  for (const plan of await evaluate('window.nxgs.listPlayPlans()')) {
    await evaluate(`window.nxgs.setPlayPlanEnabled(${JSON.stringify(plan.id)}, false)`);
  }
  const emptyCatalog = await evaluate('window.nxgs.getPaymentCatalog()');
  assert.equal(emptyCatalog.plans.length, 0);
  assert.equal(emptyCatalog.error, 'No play plans available.');
  console.log('Plan Manager UI add, edit, delete, disable, local persistence, defaults, and empty customer catalog verified.');

  void evaluate("window.nxgs.exitApp('1234')").catch(() => {});
  await delay(700);
  socket.close();
} finally {
  for (let attempt = 0; attempt < 30 && child.exitCode === null; attempt += 1) await delay(100);
  if (child.exitCode === null) child.kill();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(profile, { recursive: true, force: true });
      break;
    } catch {
      await delay(150);
    }
  }
}
