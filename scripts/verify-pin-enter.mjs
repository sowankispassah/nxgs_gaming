import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const electron = process.env.NXGS_TEST_EXECUTABLE || join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const profile = await mkdtemp(join(tmpdir(), 'nxgs-pin-enter-'));
const port = 9339;
const launchArguments = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`];
if (!process.env.NXGS_TEST_EXECUTABLE) launchArguments.push('.');
const appEnvironment = { ...process.env, APPDATA: profile };
const child = spawn(electron, launchArguments, {
  cwd: root,
  env: appEnvironment,
  windowsHide: true,
  stdio: 'ignore'
});
let duplicateChild = null;

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
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(message);
  };

  await send('Runtime.enable');
  await evaluate("Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [] })");
  await waitFor("Boolean(document.querySelector('button[aria-label=Settings]'))", 'Settings button did not render.');
  await evaluate("document.querySelector('button[aria-label=Settings]').click()");
  await waitFor("[...document.querySelectorAll('button')].some((button) => button.textContent.includes('Control Room'))", 'Control Room did not render.');
  await evaluate("[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Screen and Video').click()");
  await waitFor("(() => { const ready = Boolean(document.querySelector('input[aria-label=\"Display brightness\"]')) && Boolean(document.querySelector('.display-information-grid')); if (!ready) [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Screen and Video')?.click(); return ready; })()", 'Display settings did not render brightness and display information.');
  const displayFeatures = await evaluate("window.nxgs.getDisplayStatus()");
  if (displayFeatures.colorProfile.switchingSupported) {
    if (displayFeatures.colorProfile.availableProfiles.length === 0) throw new Error('Color-profile switching was enabled without selectable profiles.');
    await evaluate("[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Screen and Video').click()");
    await waitFor("[...document.querySelectorAll('.display-setting-row')].some((button) => button.textContent.includes('Color profile'))", 'Color-profile row did not remain available.');
    await evaluate("[...document.querySelectorAll('.display-setting-row')].find((button) => button.textContent.includes('Color profile')).click()");
    await waitFor("document.querySelectorAll('.display-color-profile-options button').length > 0", 'Selectable Windows color profiles did not open inside NXGS.');
  }
  if (!displayFeatures.hdr.message || !displayFeatures.colorProfile.message || !displayFeatures.nightLight.message) throw new Error('Display feature capability messages were incomplete.');
  console.log(`INFO: HDR ${displayFeatures.hdr.support}/${displayFeatures.hdr.enabled ? 'on' : 'off'} (${displayFeatures.hdr.message}), color profiles ${displayFeatures.colorProfile.availableProfiles.length} (${displayFeatures.colorProfile.message}).`);
  console.log('PASS: Display settings showed live Windows display information and brightness capability.');
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
  await waitFor("!document.querySelector('.admin-options-modal') && Boolean(document.querySelector('.console-home')) && Boolean(document.querySelector('.windowed-admin-lock:not(:disabled)')) && !document.querySelector('main').classList.contains('cursor-hidden')", 'Windowed admin mode did not close options, show Home, expose the lock control, and keep the cursor visible.');
  console.log('PASS: Exit Full Screen produced a resizable admin Home window with taskbar, cursor, and lock control.');
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'h', code: 'KeyH', modifiers: 10, windowsVirtualKeyCode: 72, nativeVirtualKeyCode: 72 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'h', code: 'KeyH', modifiers: 10, windowsVirtualKeyCode: 72, nativeVirtualKeyCode: 72 });
  await waitFor("window.nxgs.getDiagnostics().then((data) => data.kiosk.mode === 'admin' && !data.kiosk.fullscreen && !data.kiosk.maximized && data.kiosk.resizable && !data.kiosk.taskbarHidden && !data.kiosk.alwaysOnTop)", 'Ctrl+Shift+H changed the windowed admin window back to fullscreen.');
  await waitFor("Boolean(document.querySelector('.console-home')) && Boolean(document.querySelector('.windowed-admin-lock:not(:disabled)'))", 'Ctrl+Shift+H did not keep the launcher Home and windowed admin lock control visible.');
  console.log('PASS: Ctrl+Shift+H kept Exit Full Screen in resizable windowed admin mode.');
  await delay(750);
  const duplicateArguments = process.env.NXGS_TEST_EXECUTABLE ? [`--user-data-dir=${profile}`] : [`--user-data-dir=${profile}`, '.'];
  duplicateChild = spawn(electron, duplicateArguments, {
    cwd: root,
    env: appEnvironment,
    windowsHide: true,
    stdio: 'ignore'
  });
  for (let attempt = 0; attempt < 150 && duplicateChild.exitCode === null; attempt += 1) await delay(100);
  if (duplicateChild.exitCode === null) {
    throw new Error('Opening NXGS again left a duplicate launcher process running.');
  }
  await waitFor("window.nxgs.getDiagnostics().then((data) => data.kiosk.mode === 'admin' && !data.kiosk.fullscreen && data.kiosk.resizable && data.kiosk.launcherVisible)", 'The second launch did not refocus the existing window in windowed Admin mode.');
  await waitFor("Boolean(document.querySelector('.console-home')) && Boolean(document.querySelector('.windowed-admin-lock:not(:disabled)'))", 'The refocused existing launcher did not show the NXGS Home page.');
  console.log('PASS: A second launch exited without duplication and refocused the existing windowed Admin launcher.');
  await evaluate("document.querySelector('.windowed-admin-lock').click()");
  await waitFor("window.nxgs.getDiagnostics().then((data) => data.kiosk.mode === 'customer' && data.kiosk.fullscreen && data.kiosk.taskbarHidden)", 'Return to Locked Mode did not restore fullscreen kiosk mode.');
  await waitFor("Boolean(document.querySelector('.console-home')) && !document.querySelector('.windowed-admin-lock')", 'Locked mode did not retain Home or hide the windowed admin lock control.');
  console.log('PASS: Lock control restored customer fullscreen, taskbar hiding, and the launcher Home page.');
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'h', code: 'KeyH', modifiers: 10, windowsVirtualKeyCode: 72, nativeVirtualKeyCode: 72 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'h', code: 'KeyH', modifiers: 10, windowsVirtualKeyCode: 72, nativeVirtualKeyCode: 72 });
  await waitFor("Boolean(document.querySelector('.quick-home-overlay button[aria-label^=\"Quick brightness\"]'))", 'Quick switcher did not render the brightness button.');
  await waitFor("Boolean(document.querySelector('.quick-home-overlay button[aria-label^=\"Quick volume\"]'))", 'Quick switcher did not render the volume button.');
  await waitFor("[...document.querySelectorAll('.quick-navbar .quick-nav-item')].findIndex((button) => button.getAttribute('aria-label')?.startsWith('Quick brightness')) < [...document.querySelectorAll('.quick-navbar .quick-nav-item')].findIndex((button) => button.getAttribute('aria-label')?.startsWith('Quick volume')) && [...document.querySelectorAll('.quick-navbar .quick-nav-item')].findIndex((button) => button.getAttribute('aria-label')?.startsWith('Quick volume')) < [...document.querySelectorAll('.quick-navbar .quick-nav-item')].findIndex((button) => button.getAttribute('aria-label') === 'Protected settings')", 'Quick brightness and volume were not placed before Settings in the expected order.');
  await evaluate("document.querySelector('.quick-home-overlay button[aria-label^=\"Quick brightness\"]').click()");
  await waitFor("Boolean(document.querySelector('#quick-brightness-control input[aria-label=\"Quick display brightness\"]')) && !document.querySelector('.console-settings-screen')", 'Quick brightness did not open as an inline navbar control.');
  await waitFor("window.nxgs.getDisplayStatus().then((display) => display.brightness.supported ? Number(document.querySelector('#quick-brightness-control input').value) === display.brightness.level : document.querySelector('#quick-brightness-control footer').textContent.trim().length > 0)", 'Quick brightness did not show the actual Windows brightness or a clear unsupported state.');
  console.log('PASS: Quick switcher brightness opened inline before volume and showed the real Windows capability.');
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66, nativeVirtualKeyCode: 66 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66, nativeVirtualKeyCode: 66 });
  await waitFor("!document.querySelector('#quick-brightness-control')", 'Quick brightness did not close back to the navbar.');
  await evaluate("document.querySelector('.quick-home-overlay button[aria-label^=\"Quick volume\"]').click()");
  await waitFor("Boolean(document.querySelector('#quick-volume-control input[aria-label=\"Quick system volume\"]')) && Boolean(document.querySelector('#quick-volume-control button[aria-label*=\"Windows audio\"]')) && !document.querySelector('.console-settings-screen')", 'Quick volume did not open as an inline navbar control.');
  await waitFor("window.nxgs.getAudioStatus().then((audio) => Number(document.querySelector('#quick-volume-control input').value) === audio.masterVolume)", 'Quick volume did not show the current Windows master volume.');
  console.log('PASS: Quick switcher volume opened inline before Settings and showed the real Windows volume.');
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66, nativeVirtualKeyCode: 66 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66, nativeVirtualKeyCode: 66 });
  await waitFor("!document.querySelector('#quick-volume-control')", 'Quick volume did not close back to the navbar.');
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66, nativeVirtualKeyCode: 66 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66, nativeVirtualKeyCode: 66 });
  await waitFor("!document.querySelector('.quick-home-overlay')", 'Quick switcher did not dismiss after closing volume.');
  await evaluate("document.querySelector('button[aria-label=Settings]').click()");
  await waitFor("Boolean(document.querySelector('h1, h2'))", 'NXGS did not remain responsive after returning to locked mode.');
  void evaluate("window.nxgs.setAdminPinActive(true).then(() => window.nxgs.unlockKioskAdminActions('1234')).then(() => window.nxgs.performKioskAdminAction('closeApp'))").catch(() => {});
  await delay(500);
  socket.close();
} finally {
  if (duplicateChild?.exitCode === null) duplicateChild.kill();
  for (let attempt = 0; attempt < 30 && child.exitCode === null; attempt += 1) await delay(100);
  if (child.exitCode === null) child.kill();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(profile, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 19) console.warn(`WARN: Could not remove isolated test profile: ${error.message}`);
      else await delay(150);
    }
  }
}
