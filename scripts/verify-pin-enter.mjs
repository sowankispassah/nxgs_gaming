import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  const gameBarSetting = execFileSync(
    'reg.exe',
    ['query', 'HKCU\\Software\\Microsoft\\GameBar', '/v', 'UseNexusForGameBarEnabled'],
    { windowsHide: true, encoding: 'utf8' }
  );
  if (!/UseNexusForGameBarEnabled\s+REG_DWORD\s+0x0/i.test(gameBarSetting)) {
    throw new Error(`NXGS did not disable the controller-to-Game-Bar shortcut: ${gameBarSetting}`);
  }
  console.log('PASS: Controller Home is reserved for NXGS instead of Xbox Game Bar.');
  await waitFor("window.nxgs.getDiagnostics().then((data) => data.controllerCompatibility.driverInstalled && data.controllerCompatibility.status === 'idle' && !data.controllerCompatibility.mapperRunning)", 'Launcher Home did not keep the gameplay controller mapper idle.');
  console.log('PASS: Launcher Home prepared controller compatibility without starting the gameplay mapper.');
  const initialFocusDesign = await evaluate("(() => { const games = [...document.querySelectorAll('.console-tabs button')].find((button) => button.textContent.trim() === 'Games'); games.focus(); const button = getComputedStyle(games); const group = getComputedStyle(games.closest('.console-tabs')); return { outlineStyle: button.outlineStyle, outlineWidth: button.outlineWidth, buttonShadow: button.boxShadow, groupRadius: group.borderRadius, groupShadow: group.boxShadow }; })()");
  if (initialFocusDesign.outlineStyle !== 'none' || initialFocusDesign.outlineWidth !== '0px' || initialFocusDesign.buttonShadow === 'none' || initialFocusDesign.groupRadius === '0px' || initialFocusDesign.groupShadow === 'none') {
    throw new Error(`Initial fullscreen focus did not use the rounded NXGS style: ${JSON.stringify(initialFocusDesign)}`);
  }
  console.log('PASS: Initial fullscreen focus suppressed the browser outline and kept the rounded NXGS highlight.');
  assertConsoleLanguage(await evaluate("document.querySelector('main').innerText + ' ' + [...document.querySelectorAll('main [aria-label]')].map((node) => node.getAttribute('aria-label')).join(' ')"), 'Launcher Home');
  await evaluate("document.querySelector('button[aria-label=Settings]').click()");
  await waitFor("[...document.querySelectorAll('button')].some((button) => button.textContent.includes('Control Room'))", 'Control Room did not render.');
  const settingsShell = await evaluate("(() => { const header = document.querySelector('.console-settings-screen > header').getBoundingClientRect(); const layout = document.querySelector('.console-settings-layout').getBoundingClientRect(); const nav = document.querySelector('.console-settings-layout > nav').getBoundingClientRect(); const detail = document.querySelector('.console-settings-detail').getBoundingClientRect(); return { headerHeight: Math.round(header.height), navLeft: Math.round(nav.left), layoutTop: Math.round(layout.top), layoutBottom: Math.round(layout.bottom), navWidth: Math.round(nav.width), gap: Math.round(detail.left - nav.right) }; })()");
  if (settingsShell.headerHeight !== 142 || settingsShell.navLeft !== 40 || settingsShell.layoutTop !== 142 || settingsShell.gap !== 24) throw new Error(`Settings shell layout drifted from the console reference: ${JSON.stringify(settingsShell)}`);
  console.log('PASS: Settings shell matched the compact dark console layout geometry.');
  const settingsCategories = await evaluate("[...document.querySelectorAll('.console-settings-layout > nav button')].map((button) => button.textContent.trim())");
  if (settingsCategories.includes('Sound') || settingsCategories.includes('Screen and Video')) throw new Error(`Sound or Screen and Video remained as a separate Settings category: ${JSON.stringify(settingsCategories)}`);
  for (let step = 0; step < 6; step += 1) {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 });
  }
  await delay(100);
  const rapidScrollResult = await evaluate("(() => ({ selected: [...document.querySelectorAll('.console-settings-layout > nav button')].find((button) => button.classList.contains('selected'))?.textContent.trim(), opened: document.querySelector('.console-settings-detail h2')?.textContent.trim(), loading: /Searching\\.\\.\\.|Refreshing\\.\\.\\./.test(document.querySelector('.console-settings-detail')?.innerText ?? '') }))()");
  if (rapidScrollResult.selected !== 'Storage' || rapidScrollResult.opened !== 'Storage' || rapidScrollResult.loading) {
    throw new Error(`Rapid Settings navigation did not preview smoothly: ${JSON.stringify(rapidScrollResult)}`);
  }
  console.log('PASS: Rapid controller scrolling previewed every Settings page without waiting for earlier page data.');
  await evaluate("[...document.querySelectorAll('.console-settings-layout > nav button')].find((button) => button.textContent.trim() === 'Guide & Tips / Info').focus()");
  await delay(50);
  await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('.console-settings-layout > nav button')];
    const bluetooth = buttons.find((button) => button.textContent.trim() === 'Bluetooth / Controller');
    const system = buttons.find((button) => button.textContent.trim() === 'System');
    bluetooth.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    system.focus();
  })()`);
  await delay(150);
  const hoverResult = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('.console-settings-layout > nav button')];
    return {
      selected: buttons.find((button) => button.classList.contains('selected'))?.textContent.trim(),
      opened: document.querySelector('.console-settings-detail h2')?.textContent.trim(),
      searching: document.querySelector('.console-settings-detail')?.innerText.includes('Searching...')
    };
  })()`);
  if (hoverResult.selected !== 'System' || hoverResult.opened !== 'System' || hoverResult.searching) {
    throw new Error(`Settings hover did not preview instantly and quietly: ${JSON.stringify(hoverResult)}`);
  }
  console.log('PASS: Hover and focus instantly previewed the matching page without starting Bluetooth discovery.');
  await evaluate("[...document.querySelectorAll('.console-settings-layout > nav button')].find((button) => button.textContent.trim() === 'Bluetooth / Controller').click()");
  await waitFor("Boolean(document.querySelector('.bluetooth-device-list')) && [...document.querySelectorAll('.settings-detail-heading button')].some((button) => button.textContent.includes('Scan for Devices'))", 'Bluetooth controller status did not render.');
  const bluetoothOpenState = await evaluate("(() => { const button = [...document.querySelectorAll('.settings-detail-heading button')].find((item) => item.textContent.includes('Scan for Devices') || item.textContent.includes('Searching')); return { button: button?.textContent.trim(), page: document.querySelector('.console-settings-detail h2')?.textContent.trim() }; })()");
  if (bluetoothOpenState.page !== 'Bluetooth / Controller' || bluetoothOpenState.button !== 'Scan for Devices') {
    throw new Error(`Opening Bluetooth started discovery without an explicit Scan action: ${JSON.stringify(bluetoothOpenState)}`);
  }
  const bluetoothStatus = await evaluate("window.nxgs.getBluetoothStatus()");
  if (!bluetoothStatus.supported || /ENAMETOOLONG/i.test(bluetoothStatus.message ?? '')) {
    throw new Error(`Bluetooth status failed in the packaged launcher: ${JSON.stringify(bluetoothStatus)}`);
  }
  const availableController = bluetoothStatus.devices.find((device) => device.controller && !device.paired);
  if (availableController) {
    await waitFor(`(() => { const row = [...document.querySelectorAll('.bluetooth-device-list > div')].find((item) => item.textContent.includes(${JSON.stringify(availableController.name)})); return Boolean(row) && [...row.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Pair'); })()`, 'An available controller did not expose the NXGS Pair action.');
    await evaluate(`(() => { const row = [...document.querySelectorAll('.bluetooth-device-list > div')].find((item) => item.textContent.includes(${JSON.stringify(availableController.name)})); row.scrollIntoView({ block: 'end' }); return document.querySelector('.console-settings-detail').scrollTop; })()`);
    await evaluate(`(() => { const row = [...document.querySelectorAll('.bluetooth-device-list > div')].find((item) => item.textContent.includes(${JSON.stringify(availableController.name)})); [...row.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Pair').click(); })()`);
    await waitFor("Boolean(document.querySelector('.bluetooth-pairing-confirmation'))", 'The NXGS pairing confirmation did not open.');
    const pairingPrompt = await evaluate("document.querySelector('.bluetooth-pairing-confirmation').innerText");
    for (const requiredText of ['Pairing request', `Pair ${availableController.name}?`, 'Device name', 'Device type', 'Wireless controller', 'Cancel', 'Pair']) {
      if (!pairingPrompt.toLowerCase().includes(requiredText.toLowerCase())) throw new Error(`NXGS pairing confirmation omitted ${requiredText}: ${pairingPrompt}`);
    }
    assertConsoleLanguage(pairingPrompt, 'NXGS pairing confirmation');
    const pairingKiosk = await evaluate("window.nxgs.getDiagnostics().then((data) => data.kiosk)");
    if (pairingKiosk.mode !== 'customer' || !pairingKiosk.fullscreen || !pairingKiosk.taskbarHidden) {
      throw new Error(`Pairing confirmation left locked fullscreen: ${JSON.stringify(pairingKiosk)}`);
    }
    const pairingLayout = await evaluate(`(() => {
      const backdrop = document.querySelector('.bluetooth-confirmation-backdrop');
      const dialog = document.querySelector('.bluetooth-pairing-confirmation');
      const backdropRect = backdrop.getBoundingClientRect();
      const dialogRect = dialog.getBoundingClientRect();
      return {
        portaledToBody: backdrop.parentElement === document.body,
        position: getComputedStyle(backdrop).position,
        backdrop: { left: backdropRect.left, top: backdropRect.top, right: backdropRect.right, bottom: backdropRect.bottom },
        dialog: { left: dialogRect.left, top: dialogRect.top, right: dialogRect.right, bottom: dialogRect.bottom },
        centeredX: Math.abs((dialogRect.left + dialogRect.right) / 2 - innerWidth / 2) < 3,
        centeredY: Math.abs((dialogRect.top + dialogRect.bottom) / 2 - innerHeight / 2) < 3,
        focused: document.activeElement?.id
      };
    })()`);
    if (!pairingLayout.portaledToBody || pairingLayout.position !== 'fixed' || !pairingLayout.centeredX || !pairingLayout.centeredY || pairingLayout.backdrop.left !== 0 || pairingLayout.backdrop.top !== 0 || pairingLayout.backdrop.right !== await evaluate('innerWidth') || pairingLayout.backdrop.bottom !== await evaluate('innerHeight') || pairingLayout.dialog.top < 0 || pairingLayout.dialog.bottom > pairingLayout.backdrop.bottom || pairingLayout.focused !== 'bluetooth-pair-primary') {
      throw new Error(`Pairing confirmation was not centered and focused in the visible viewport: ${JSON.stringify(pairingLayout)}`);
    }
    await pressB();
    await waitFor("!document.querySelector('.bluetooth-pairing-confirmation')", 'B / Escape did not close the NXGS pairing confirmation.');
    console.log('PASS: Available controller opened a viewport-centered NXGS pairing confirmation, focused Pair, and B closed it without leaving locked fullscreen.');
  }
  const staleControllerLink = bluetoothStatus.devices.find((device) => device.controller && device.connected && !device.inputReady);
  if (staleControllerLink) {
    await waitFor("document.querySelector('.console-settings-detail').innerText.includes('Controller input unavailable') && [...document.querySelectorAll('.bluetooth-device-list button')].some((button) => button.textContent.includes('Check Input'))", 'A stale Bluetooth controller link did not expose the accurate warning and Check Input action.');
    console.log('PASS: Bluetooth-linked controller without HID input showed Controller input unavailable and non-destructive Check Input.');
  }
  const readyController = bluetoothStatus.devices.find((device) => device.controller && device.inputReady);
  if (readyController) {
    await waitFor(`(() => { const row = [...document.querySelectorAll('.bluetooth-device-list > div')].find((item) => item.textContent.includes(${JSON.stringify(readyController.name)})); return Boolean(row) && row.textContent.includes('Controller input ready') && [...row.querySelectorAll('button')].some((button) => button.textContent.includes('Disconnect')); })()`, 'An active controller still showed Reconnect instead of Disconnect.');
    console.log('PASS: Active controller input was detected as Connected with a Disconnect action.');
  }
  await evaluate("[...document.querySelectorAll('.console-settings-layout > nav button')].find((button) => button.textContent.trim() === 'Guide & Tips / Info').click()");
  await waitFor("document.querySelector('.console-settings-detail h2')?.textContent.trim() === 'Guide & Tips / Info'", 'Guide page did not open between Bluetooth cache checks.');
  await evaluate("[...document.querySelectorAll('.console-settings-layout > nav button')].find((button) => button.textContent.trim() === 'Bluetooth / Controller').click()");
  const bluetoothRevisit = await evaluate("(() => { const button = [...document.querySelectorAll('.settings-detail-heading button')].find((item) => item.textContent.includes('Scan for Devices') || item.textContent.includes('Searching')); return { button: button?.textContent.trim(), deviceRows: document.querySelectorAll('.bluetooth-device-list > div').length }; })()");
  if (bluetoothRevisit.button !== 'Scan for Devices') {
    throw new Error(`Revisiting Bluetooth restarted discovery instead of showing cached state: ${JSON.stringify(bluetoothRevisit)}`);
  }
  console.log(`PASS: Bluetooth revisit kept ${bluetoothRevisit.deviceRows} cached device rows visible without restarting discovery.`);
  const controllerPowerDefaults = await evaluate("(() => ({ options: [...document.querySelectorAll('.controller-power-options button')].map((button) => button.textContent.trim()), selected: document.querySelector('.controller-power-options button.selected')?.textContent.trim(), warning: document.querySelector('.controller-warning-toggle')?.getAttribute('aria-checked') }))()");
  if (JSON.stringify(controllerPowerDefaults.options) !== JSON.stringify(['Never', 'After 5 minutes', 'After 10 minutes', 'After 15 minutes', 'After 30 minutes']) || controllerPowerDefaults.selected !== 'After 10 minutes' || controllerPowerDefaults.warning !== 'true') {
    throw new Error(`Controller idle defaults or options are incorrect: ${JSON.stringify(controllerPowerDefaults)}`);
  }
  await evaluate("[...document.querySelectorAll('.controller-power-options button')].find((button) => button.textContent.trim() === 'After 15 minutes').click()");
  await waitFor("window.nxgs.getInitialData().then((data) => data.settings.controllerIdle.autoTurnOffMinutes === 15)", 'Controller idle timeout did not save through the trusted settings IPC.');
  const dataPath = await evaluate("window.nxgs.getInitialData().then((data) => data.dataPath)");
  const savedData = JSON.parse(await readFile(dataPath, 'utf8'));
  if (savedData.settings?.controllerIdle?.autoTurnOffMinutes !== 15 || savedData.settings?.controllerIdle?.shutdownWarning !== true) {
    throw new Error(`Controller idle settings were not persisted on disk: ${JSON.stringify(savedData.settings?.controllerIdle)}`);
  }
  await evaluate("[...document.querySelectorAll('.controller-power-options button')].find((button) => button.textContent.trim() === 'After 10 minutes').click()");
  await waitFor("window.nxgs.getInitialData().then((data) => data.settings.controllerIdle.autoTurnOffMinutes === 10)", 'Controller idle timeout did not restore after the persistence check.');
  console.log('PASS: Controller idle options, 10-minute default, warning default, trusted IPC, and disk persistence verified.');
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
  await evaluate("[...document.querySelectorAll('.console-settings-layout > nav button')].find((button) => button.textContent.trim() === 'Guide & Tips / Info').click()");
  await waitFor("document.querySelector('.console-settings-detail h2')?.textContent.trim() === 'Guide & Tips / Info'", 'Guide page did not open between System cache checks.');
  await evaluate("[...document.querySelectorAll('.console-settings-layout > nav button')].find((button) => button.textContent.trim() === 'System').click()");
  const systemRevisit = await evaluate("(() => ({ title: document.querySelector('.console-settings-detail h2')?.textContent.trim(), refresh: document.querySelector('.system-refresh-button')?.textContent.trim(), volume: document.querySelector('input[aria-label=\"Master volume\"]')?.value, brightness: document.querySelector('input[aria-label=\"Display brightness\"]')?.value }))()");
  if (systemRevisit.title !== 'System' || systemRevisit.refresh !== 'Refresh' || systemRevisit.volume === undefined || systemRevisit.brightness === undefined) {
    throw new Error(`Revisiting System did not render cached controls immediately: ${JSON.stringify(systemRevisit)}`);
  }
  console.log('PASS: System revisit rendered cached display and audio values immediately without a visible reload.');
  await evaluate("[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Control Room').click()");
  await waitFor("Boolean(document.querySelector('.pin-modal input[type=password]')) || [...document.querySelectorAll('button')].some((button) => button.textContent.includes('Enter Control Room'))", 'Control Room did not open its protected entry flow.');
  await evaluate("(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('Enter Control Room')); if (button) button.click(); })()");
  await waitFor("Boolean(document.querySelector('.pin-modal input[type=password]'))", 'PIN dialog did not open.');
  await waitFor("document.activeElement?.closest('.pin-keypad') && document.activeElement.textContent.trim() === '1'", 'PIN modal did not focus the first keypad item.');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 });
  }
  await waitFor("document.activeElement?.textContent.includes('Unlock')", 'PIN keypad Down navigation did not reach Unlock.');
  const unlockFocusDesign = await evaluate("(() => { const style = getComputedStyle(document.activeElement); return { shadow: style.boxShadow, borderColor: style.borderColor, outline: style.outlineStyle }; })()");
  if (unlockFocusDesign.shadow === 'none' || unlockFocusDesign.outline !== 'none' || !unlockFocusDesign.borderColor) {
    throw new Error(`Unlock did not show the custom controller focus design: ${JSON.stringify(unlockFocusDesign)}`);
  }
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38 });
  await waitFor("Boolean(document.activeElement?.closest('.pin-keypad'))", 'PIN Unlock Up navigation did not return to the keypad.');
  console.log('PASS: PIN controller focus moved from the keypad to Unlock and back.');
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
  await evaluate("document.querySelector('button[aria-label=Settings]').click()");
  await waitFor("Boolean(document.querySelector('.console-settings-screen'))", 'Settings did not open in windowed Admin mode.');
  await delay(650);
  await pressCtrlShiftH();
  await waitFor("Boolean(document.querySelector('.quick-home-overlay button[aria-label=\"Quick Settings\"]')) && Boolean(document.querySelector('.console-home')) && !document.querySelector('.console-settings-screen')", 'Ctrl+Shift+H did not leave Settings and visibly open the windowed Quick Switcher.');
  await waitFor("window.nxgs.getDiagnostics().then((data) => Boolean(data.kiosk.lastHomeTrigger) && data.kiosk.mode === 'admin' && !data.kiosk.fullscreen && data.kiosk.resizable)", 'Ctrl+Shift+H was not handled or windowed Admin mode was not preserved.');
  await pressB();
  await waitFor("!document.querySelector('.quick-home-overlay') && Boolean(document.querySelector('.console-home'))", 'Closing the windowed Quick Switcher did not return to Home.');
  console.log('PASS: Ctrl+Shift+H left Settings, opened the Quick Switcher, and preserved windowed Admin mode.');
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
  if (await evaluate("Boolean(document.querySelector('.console-game-avatar.selected'))")) {
    await evaluate("document.querySelector('.console-game-avatar.selected').click()");
    await waitFor("Boolean(document.querySelector('.launch-modal'))", 'Duration modal did not open.');
    await waitFor("document.activeElement?.closest('.duration-grid') && document.activeElement.getAttribute('aria-pressed') === 'true'", 'Duration modal did not focus the default duration.');
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await delay(200);
    if (!(await evaluate("Boolean(document.activeElement?.closest('.duration-grid')) && Boolean(document.querySelector('.launch-modal'))"))) {
      throw new Error('Selecting a duration moved focus or launched the game automatically.');
    }
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 });
    await waitFor("document.activeElement?.textContent.includes('Launch Game')", 'Duration modal Down navigation did not reach Launch Game.');
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38 });
    await waitFor("Boolean(document.activeElement?.closest('.duration-grid'))", 'Duration modal Up navigation did not return to the duration options.');
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await waitFor("!document.querySelector('.launch-modal')", 'Duration modal Escape did not close the modal.');
    console.log('PASS: Duration selection remained separate from Launch Game and supported Down/Up navigation.');
  } else {
    console.log('INFO: Duration runtime check skipped because the isolated test profile has no saved games.');
  }
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
