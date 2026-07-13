import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const electron = process.env.NXGS_TEST_EXECUTABLE || join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const profile = await mkdtemp(join(tmpdir(), 'nxgs-pin-enter-'));
const port = 9339;
const launchArguments = [`--remote-debugging-port=${port}`];
if (!process.env.NXGS_TEST_EXECUTABLE) launchArguments.push('.');
const child = spawn(electron, launchArguments, {
  cwd: root,
  env: { ...process.env, APPDATA: profile },
  windowsHide: true,
  stdio: 'ignore'
});

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function getPage() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const page = pages.find((candidate) => candidate.type === 'page');
      if (page) return page;
    } catch {}
    await delay(100);
  }
  throw new Error('NXGS test window did not expose a debug page.');
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression, message) => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(message);
  };

  await send('Runtime.enable');
  await waitFor("Boolean(document.querySelector('button[aria-label=Settings]'))", 'Settings button did not render.');
  await evaluate("document.querySelector('button[aria-label=Settings]').click()");
  await waitFor("[...document.querySelectorAll('button')].some((button) => button.textContent.includes('Control Room'))", 'Control Room did not render.');
  await evaluate("[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Control Room').click()");
  await waitFor("[...document.querySelectorAll('button')].some((button) => button.textContent.includes('Enter Control Room'))", 'Control Room detail did not open.');
  await evaluate("[...document.querySelectorAll('button')].find((button) => button.textContent.includes('Enter Control Room')).click()");
  await waitFor("Boolean(document.querySelector('.pin-modal input[type=password]'))", 'PIN dialog did not open.');
  await evaluate("document.querySelector('.pin-modal input[type=password]').focus()");
  await send('Input.insertText', { text: '1234' });
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await waitFor("Boolean(document.querySelector('.admin-options-modal'))", 'Enter did not submit the PIN and open Admin options.');
  console.log('PASS: Settings -> Control Room -> PIN -> Enter opened Admin options.');
  await evaluate("[...document.querySelectorAll('.admin-options-modal button')].find((button) => button.textContent.includes('Exit Full Screen')).click()");
  await waitFor("window.nxgs.getDiagnostics().then((data) => data.kiosk.mode === 'admin' && !data.kiosk.fullscreen && !data.kiosk.maximized && data.kiosk.resizable && !data.kiosk.taskbarHidden && !data.kiosk.alwaysOnTop)", 'Exit Full Screen did not produce a normal admin window.');
  await waitFor("Boolean(document.querySelector('.admin-options-modal')) && !document.querySelector('main').classList.contains('cursor-hidden')", 'Admin options or cursor visibility was not retained in windowed mode.');
  console.log('PASS: Exit Full Screen produced a resizable admin window with taskbar, cursor, and options available.');
  await waitFor("[...document.querySelectorAll('.admin-options-modal button')].some((button) => button.textContent.includes('Return to Locked Mode') && !button.disabled)", 'Return to Locked Mode did not become available after exiting fullscreen.');
  await evaluate("[...document.querySelectorAll('.admin-options-modal button')].find((button) => button.textContent.includes('Return to Locked Mode')).click()");
  await waitFor("window.nxgs.getDiagnostics().then((data) => data.kiosk.mode === 'customer' && data.kiosk.fullscreen && data.kiosk.taskbarHidden)", 'Return to Locked Mode did not restore fullscreen kiosk mode.');
  console.log('PASS: Return to Locked Mode restored customer fullscreen and taskbar hiding.');
  await evaluate("document.querySelector('button[aria-label=Settings]').click()");
  await waitFor("Boolean(document.querySelector('h1, h2'))", 'NXGS did not remain responsive after returning to locked mode.');
  void evaluate("window.nxgs.setAdminPinActive(true).then(() => window.nxgs.unlockKioskAdminActions('1234')).then(() => window.nxgs.performKioskAdminAction('closeApp'))").catch(() => {});
  await delay(500);
  socket.close();
} finally {
  for (let attempt = 0; attempt < 30 && child.exitCode === null; attempt += 1) await delay(100);
  if (child.exitCode === null) child.kill();
  await rm(profile, { recursive: true, force: true });
}
