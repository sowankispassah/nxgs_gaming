import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
const assertConsoleLanguage = (text, surface) => {
  const restricted = text.match(/\bwindows\b|\bpc\b|\bdesktop\b|\btaskbar\b|system command/i);
  if (restricted) throw new Error(`${surface} exposed restricted platform wording: ${restricted[0]}`);
};

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
  const pressCtrlShiftH = async () => {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'h', code: 'KeyH', modifiers: 10, windowsVirtualKeyCode: 72, nativeVirtualKeyCode: 72 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'h', code: 'KeyH', modifiers: 10, windowsVirtualKeyCode: 72, nativeVirtualKeyCode: 72 });
  };
  const pressB = async () => {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66, nativeVirtualKeyCode: 66 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66, nativeVirtualKeyCode: 66 });
  };

  await send('Runtime.enable');
  if (process.env.NXGS_SETTINGS_SCREENSHOT) {
    await send('Emulation.setDeviceMetricsOverride', { width: 1672, height: 941, deviceScaleFactor: 1, mobile: false });
  }
  await evaluate("Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [] })");
  await waitFor("Boolean(document.querySelector('button[aria-label=Settings]'))", 'Settings button did not render.');
  assertConsoleLanguage(await evaluate("document.querySelector('main').innerText + ' ' + [...document.querySelectorAll('main [aria-label]')].map((node) => node.getAttribute('aria-label')).join(' ')"), 'Launcher Home');
  await evaluate("document.querySelector('button[aria-label=Settings]').click()");
  await waitFor("[...document.querySelectorAll('button')].some((button) => button.textContent.includes('Control Room'))", 'Control Room did not render.');
  const settingsShell = await evaluate("(() => { const header = document.querySelector('.console-settings-screen > header').getBoundingClientRect(); const layout = document.querySelector('.console-settings-layout').getBoundingClientRect(); const nav = document.querySelector('.console-settings-layout > nav').getBoundingClientRect(); const detail = document.querySelector('.console-settings-detail').getBoundingClientRect(); return { headerHeight: Math.round(header.height), navLeft: Math.round(nav.left), layoutTop: Math.round(layout.top), layoutBottom: Math.round(layout.bottom), navWidth: Math.round(nav.width), gap: Math.round(detail.left - nav.right) }; })()");
  if (settingsShell.headerHeight !== 142 || settingsShell.navLeft !== 40 || settingsShell.layoutTop !== 142 || settingsShell.gap !== 24) throw new Error(`Settings shell layout drifted from the console reference: ${JSON.stringify(settingsShell)}`);
  console.log('PASS: Settings shell matched the compact dark console layout geometry.');
  const settingsCategories = await evaluate("[...document.querySelectorAll('.console-settings-layout > nav button')].map((button) => button.textContent.trim())");
  if (settingsCategories.includes('Sound') || settingsCategories.includes('Screen and Video')) throw new Error(`Sound or Screen and Video remained as a separate Settings category: ${JSON.stringify(settingsCategories)}`);
  await evaluate("[...document.querySelectorAll('.console-settings-layout > nav button')].find((button) => button.textContent.trim() === 'System').click()");
  await waitFor("(() => { const ready = Boolean(document.querySelector('input[aria-label=\"Display brightness\"]')) && Boolean(document.querySelector('input[aria-label=\"Master volume\"]')) && Boolean(document.querySelector('.system-collapsible-heading')) && document.querySelectorAll('.system-device-section').length === 2; if (!ready) [...document.querySelectorAll('.console-settings-layout > nav button')].find((button) => button.textContent.trim() === 'System')?.click(); return ready; })()", 'System did not render the combined display and sound controls.');
  await waitFor("document.querySelector('.system-refresh-button')?.textContent.trim() === 'Refresh'", 'System controls did not finish their initial refresh.');
  const displayFeatures = await evaluate("window.nxgs.getDisplayStatus()");
  const collapsedDisplayInfo = await evaluate("document.querySelector('.system-collapsible-heading').getAttribute('aria-expanded') === 'false' && !document.querySelector('.system-information-grid')");
  if (!collapsedDisplayInfo) throw new Error('Display information was not collapsed on the initial System view.');
  if (process.env.NXGS_SETTINGS_SCREENSHOT) {
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(resolve(process.env.NXGS_SETTINGS_SCREENSHOT), Buffer.from(screenshot.data, 'base64'));
  }
  const audioViewport = await evaluate("(() => { const detail = document.querySelector('.console-settings-detail').getBoundingClientRect(); const slider = document.querySelector('input[aria-label=\"Master volume\"]').getBoundingClientRect(); return { visible: slider.top >= detail.top && slider.bottom <= detail.bottom, detailTop: Math.round(detail.top), detailBottom: Math.round(detail.bottom), sliderTop: Math.round(slider.top), sliderBottom: Math.round(slider.bottom) }; })()");
  if (!audioViewport.visible) throw new Error(`The Audio volume slider was not visible in the initial System viewport: ${JSON.stringify(audioViewport)}`);
  assertConsoleLanguage(await evaluate("document.querySelector('.console-settings-screen').innerText + ' ' + [...document.querySelectorAll('.console-settings-screen [aria-label]')].map((node) => node.getAttribute('aria-label')).join(' ')"), 'System settings');
  await evaluate("document.querySelector('.system-collapsible-heading').click()");
  await waitFor("document.querySelector('.system-collapsible-heading').getAttribute('aria-expanded') === 'true' && Boolean(document.querySelector('.system-information-grid'))", 'Display information did not expand inside System.');
  await evaluate("document.querySelector('.system-collapsible-heading').click()");
  await waitFor("document.querySelector('.system-collapsible-heading').getAttribute('aria-expanded') === 'false' && !document.querySelector('.system-information-grid')", 'Display information did not collapse again.');
  const displayRows = await evaluate("[...document.querySelectorAll('.system-simple-row')].map((button) => button.textContent)");
  if (displayRows.some((text) => text.includes('Night Light'))) throw new Error('Unavailable Night Light control remained visible.');
  if ((!displayFeatures.hdr.controlSupported || displayFeatures.hdr.support !== 'supported') && displayRows.some((text) => text.includes('HDR'))) throw new Error('Unavailable HDR control remained visible.');
  if (displayRows.some((text) => text.includes('Color profile'))) throw new Error('Color Profile control remained visible.');
  if (!displayFeatures.hdr.message || !displayFeatures.colorProfile.message || !displayFeatures.nightLight.message) throw new Error('Display feature capability messages were incomplete.');
  console.log(`INFO: HDR ${displayFeatures.hdr.support}/${displayFeatures.hdr.enabled ? 'on' : 'off'} (${displayFeatures.hdr.message}); nonessential color controls hidden.`);
  console.log('PASS: System kept Audio visible initially and expanded or collapsed Display information on demand.');
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
  await waitFor("window.nxgs.getDiagnostics().then((data) => data.kiosk.mode === 'admin')", 'Exit Full Screen did not enter Admin mode.');
  await waitFor("window.nxgs.getDiagnostics().then((data) => data.kiosk.mode === 'admin' && !data.kiosk.fullscreen && !data.kiosk.maximized && data.kiosk.resizable && !data.kiosk.taskbarHidden && !data.kiosk.alwaysOnTop)", 'Exit Full Screen did not produce a normal admin window.');
  await waitFor("!document.querySelector('.admin-options-modal') && !document.querySelector('.quick-home-overlay') && Boolean(document.querySelector('.console-home')) && Boolean(document.querySelector('.windowed-admin-lock:not(:disabled)')) && !document.querySelector('main').classList.contains('cursor-hidden')", 'Windowed admin mode did not close options, show Home, expose the lock control, and keep the cursor visible.');
  console.log('PASS: Exit Full Screen produced a resizable admin Home window with taskbar, cursor, and lock control.');
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await delay(650);
    await pressCtrlShiftH();
    await waitFor("Boolean(document.querySelector('.quick-home-overlay button[aria-label=\"Quick Settings\"]'))", `Ctrl+Shift+H attempt ${attempt + 1} did not open the Quick Switcher in windowed Admin mode.`);
    await waitFor("window.nxgs.getDiagnostics().then((data) => data.kiosk.mode === 'admin' && !data.kiosk.fullscreen && !data.kiosk.maximized && data.kiosk.resizable && !data.kiosk.taskbarHidden && !data.kiosk.alwaysOnTop)", `Ctrl+Shift+H attempt ${attempt + 1} changed the windowed admin window back to fullscreen.`);
    await pressB();
    await waitFor("!document.querySelector('.quick-home-overlay') && Boolean(document.querySelector('.console-home')) && Boolean(document.querySelector('.windowed-admin-lock:not(:disabled)'))", `Ctrl+Shift+H attempt ${attempt + 1} did not return to the windowed launcher Home after closing the switcher.`);
  }
  console.log('PASS: Repeated Ctrl+Shift+H presses opened the Quick Switcher while preserving resizable windowed Admin mode.');
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
  await waitFor("Boolean(document.querySelector('.quick-home-overlay button[aria-label=\"Quick Settings\"]'))", 'Quick switcher did not render the Quick Settings button.');
  const quickNavLabels = await evaluate("[...document.querySelectorAll('.quick-navbar .quick-nav-item')].map((button) => button.getAttribute('aria-label'))");
  if (quickNavLabels.some((label) => /^Quick (brightness|volume)/i.test(label ?? ''))) throw new Error(`Separate brightness or volume buttons remained on the navbar: ${JSON.stringify(quickNavLabels)}`);
  await evaluate("document.querySelector('.quick-home-overlay button[aria-label=\"Quick Settings\"]').click()");
  await waitFor("Boolean(document.querySelector('#quick-settings-panel input[aria-label=\"Quick audio volume\"]')) && Boolean(document.querySelector('#quick-settings-panel input[aria-label=\"Quick display brightness\"]')) && !document.querySelector('.console-settings-screen')", 'Quick Settings did not open the combined inline Audio and Brightness panel.');
  const quickPanel = await evaluate("(() => { const panel = document.querySelector('#quick-settings-panel'); const navbar = document.querySelector('.quick-navbar'); const rows = [...panel.querySelectorAll('.quick-settings-control')]; const panelRect = panel.getBoundingClientRect(); const navbarRect = navbar.getBoundingClientRect(); return { rowCount: rows.length, audioFirst: rows[0]?.classList.contains('quick-settings-audio'), brightnessSecond: rows[1]?.classList.contains('quick-settings-brightness'), hasOpenSettings: /open settings/i.test(panel.textContent), panelBottom: Math.round(panelRect.bottom), navbarTop: Math.round(navbarRect.top), panelWidth: Math.round(parseFloat(getComputedStyle(panel).width)), centerDelta: Math.round((panelRect.left + panelRect.right - navbarRect.left - navbarRect.right) / 2) }; })()");
  if (quickPanel.rowCount !== 2 || !quickPanel.audioFirst || !quickPanel.brightnessSecond || quickPanel.hasOpenSettings || quickPanel.panelBottom > quickPanel.navbarTop || quickPanel.panelWidth !== 392 || Math.abs(quickPanel.centerDelta) > 1) throw new Error(`Quick Settings structure or centered placement is incorrect: ${JSON.stringify(quickPanel)}`);
  const neutralTheme = await evaluate("(() => { const root = getComputedStyle(document.documentElement); const gear = getComputedStyle(document.querySelector('button[aria-label=\"Quick Settings\"]')); const audio = getComputedStyle(document.querySelector('#quick-settings-audio')); const brightness = getComputedStyle(document.querySelector('#quick-settings-brightness')); const names = ['--focus-border', '--focus-bg', '--focus-glow', '--panel-bg', '--panel-border', '--text-primary', '--text-secondary', '--slider-track', '--slider-active', '--slider-thumb']; return { tokens: names.map((name) => [name, root.getPropertyValue(name).trim()]), gearBorder: gear.borderColor, gearBackground: gear.backgroundColor, audioTrack: audio.backgroundImage, brightnessTrack: brightness.backgroundImage }; })()");
  if (neutralTheme.tokens.some(([, value]) => !value)) throw new Error(`A central neutral theme token is missing: ${JSON.stringify(neutralTheme.tokens)}`);
  if (/113, 240, 215|255, 210, 111|88, 166, 255|29, 209, 161/.test(JSON.stringify(neutralTheme))) throw new Error(`Quick Settings still uses a colorful focus or slider accent: ${JSON.stringify(neutralTheme)}`);
  await waitFor("!document.querySelector('button[aria-label=\"Quick Settings\"]').disabled", 'Quick Settings did not finish reading the live controls.');
  await waitFor("window.nxgs.getAudioStatus().then((audio) => { const slider = document.querySelector('#quick-settings-audio'); return Boolean(slider) && Number(slider.value) === audio.masterVolume; })", 'Quick Settings did not show the current master volume.');
  await waitFor("window.nxgs.getDisplayStatus().then((display) => { const slider = document.querySelector('#quick-settings-brightness'); return display.brightness.supported ? Boolean(slider) && Number(slider.value) === display.brightness.level : document.querySelector('.quick-settings-brightness small')?.textContent.trim().length > 0; })", 'Quick Settings did not show the actual brightness or a clear unsupported state.');
  if (process.env.NXGS_QUICK_SETTINGS_SCREENSHOT) {
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(resolve(process.env.NXGS_QUICK_SETTINGS_SCREENSHOT), Buffer.from(screenshot.data, 'base64'));
  }
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 });
  await waitFor("document.querySelector('.quick-settings-brightness').classList.contains('selected')", 'Controller navigation did not move from Audio to Brightness.');
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38 });
  await waitFor("document.querySelector('.quick-settings-audio').classList.contains('selected')", 'Controller navigation did not return from Brightness to Audio.');
  assertConsoleLanguage(await evaluate("document.querySelector('.quick-home-overlay').innerText + ' ' + [...document.querySelectorAll('.quick-home-overlay [aria-label]')].map((node) => node.getAttribute('aria-label')).join(' ')"), 'Quick switcher');
  console.log('PASS: Quick Settings showed only compact Audio and Brightness controls above the gear.');
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66, nativeVirtualKeyCode: 66 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66, nativeVirtualKeyCode: 66 });
  await waitFor("!document.querySelector('#quick-settings-panel')", 'Quick Settings did not close back to the navbar.');
  await evaluate("document.querySelector('.quick-home-overlay button[aria-label=\"Quick Settings\"]').click()");
  await waitFor("Boolean(document.querySelector('#quick-settings-panel'))", 'Quick Settings did not reopen.');
  await evaluate("[...document.querySelectorAll('.quick-navbar .quick-nav-item')].find((button) => button.getAttribute('aria-label') === 'Protected power controls').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))");
  await waitFor("!document.querySelector('#quick-settings-panel')", 'Moving focus away did not close Quick Settings.');
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66, nativeVirtualKeyCode: 66 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66, nativeVirtualKeyCode: 66 });
  await waitFor("!document.querySelector('.quick-home-overlay')", 'Quick switcher did not dismiss after closing Quick Settings.');
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
