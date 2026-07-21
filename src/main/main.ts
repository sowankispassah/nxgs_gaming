import { app, BrowserWindow, dialog, ipcMain, screen, type OpenDialogOptions, type OpenDialogReturnValue } from 'electron';
import { randomUUID } from 'node:crypto';
import { basename, dirname, extname, join } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { DataStore } from './database';
import { ControllerCompatibilityService } from './controllerCompatibilityService';
import { ControllerIdleService } from './controllerIdleService';
import { GameLauncher } from './gameLauncher';
import { scanInstalledGames } from './gameScanner';
import { KioskInputService } from './kioskInputService';
import { cancelBluetoothPairing, disconnectBluetoothDevice, pairBluetoothDevice, removeBluetoothDevice, scanBluetoothDevices } from './bluetoothService';
import { getAudioStatus, setMasterMuted, setMasterVolume, switchAudioDevice } from './audioService';
import { getDisplayStatus, setColorProfile, setDisplayBrightness, setHdr, setNightLight } from './displayService';
import { connectWifi, disconnectWifi, forgetWifi, getNetworkStatus } from './networkService';
import { getLogPath, logLine } from './logger';
import { SessionTimer } from './sessionTimer';
import { SessionCountdownOverlay } from './sessionCountdownOverlay';
import {
  SessionWarningOverlay,
  type SessionWarningAction,
  type SessionWarningStage
} from './sessionWarningOverlay';
import { checkForUpdates, downloadUpdate, startUpdateInstaller } from './updateService';
import { setWindowsTaskbarVisible } from './windowManagerService';
import { stopWindowsControlWorker, warmWindowsControlWorker } from './windowsControlWorker';
import { disableXboxGameBarControllerShortcut, suppressXboxGameBarSurfaces } from './gameBarGuard';
import { PaymentService } from './paymentService';
import type {
  AppDiagnostics,
  AppSettings,
  BluetoothPairRequest,
  ControllerStateReport,
  CreatePaymentCheckoutRequest,
  DisplayDeviceInfo,
  FilePickerResult,
  GameControlResult,
  GameImageKind,
  GameInput,
  GameRecord,
  KioskAdminAction,
  KioskAdminActionResult,
  KioskMode,
  LaunchRequest,
  PaymentCheckoutAccess,
  ShellHomeEvent,
  ShellHomeReason,
  SessionState,
  UpdateDownloadRequest,
  UpdateInstallRequest,
  WifiConnectRequest
} from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let taskbarHiddenByKiosk = false;
let kioskAdminActionGranted = false;
let secondInstanceFocusPending = false;
const sessionCountdownOverlay = new SessionCountdownOverlay();
let sessionWarningOverlay: SessionWarningOverlay | null = null;
type SessionExtensionRequest = { id: string; stage: SessionWarningStage };
let pendingSessionExtension: SessionExtensionRequest | null = null;
let sessionExtensionDeliveryTimers: NodeJS.Timeout[] = [];
let controllerDiagnostics: AppDiagnostics['controller'] = {
  detected: false,
  homeSupported: 'unknown'
};

const store = new DataStore();
const controllerCompatibility = new ControllerCompatibilityService();
const paymentService = new PaymentService();
let controllerIdleService: ControllerIdleService | null = null;

function getAppIconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'icon.ico') : join(app.getAppPath(), 'build', 'icon.ico');
}

function validatePickedPath(path: string, allowedExtensions?: string[], mustBeDirectory = false): FilePickerResult {
  try {
    if (!existsSync(path)) {
      return { canceled: false, error: `Selected path does not exist: ${path}` };
    }

    const stats = statSync(path);
    if (mustBeDirectory) {
      if (!stats.isDirectory()) {
        return { canceled: false, error: `Selected path is not a folder: ${path}` };
      }
      return { canceled: false, path };
    }

    if (!stats.isFile()) {
      return { canceled: false, error: `Selected path is not a file: ${path}` };
    }

    const extension = extname(path).toLowerCase();
    if (allowedExtensions && !allowedExtensions.includes(extension)) {
      return { canceled: false, error: `Invalid file type selected: ${extension || 'unknown'}` };
    }

    return {
      canceled: false,
      path,
      fileName: basename(path),
      directory: dirname(path)
    };
  } catch (error) {
    return { canceled: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function showOpenDialog(options: OpenDialogOptions): Promise<OpenDialogReturnValue> {
  return mainWindow ? dialog.showOpenDialog(mainWindow, options) : dialog.showOpenDialog(options);
}

function getLiveMainWindow(): BrowserWindow | null {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }
  return mainWindow;
}

function getDisplayDevices(): DisplayDeviceInfo[] {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((display, index) => ({
    id: String(display.id),
    name: display.label?.trim() || `Display ${index + 1}`,
    resolution: `${Math.round(display.size.width * display.scaleFactor)} × ${Math.round(display.size.height * display.scaleFactor)}`,
    refreshRate: Math.round(display.displayFrequency || 0),
    scalePercent: Math.round(display.scaleFactor * 100),
    orientation: display.rotation === 90
      ? 'Portrait'
      : display.rotation === 180
        ? 'Landscape (flipped)'
        : display.rotation === 270
          ? 'Portrait (flipped)'
          : 'Landscape',
    primary: display.id === primaryId,
    internal: display.internal,
    colorDepth: display.colorDepth,
    depthPerComponent: display.depthPerComponent,
    colorSpace: display.colorSpace
  }));
}

function sendToRenderer(channel: string, ...args: unknown[]): void {
  const window = getLiveMainWindow();
  if (!window || window.webContents.isDestroyed()) {
    return;
  }
  window.webContents.send(channel, ...args);
}

function broadcastSession(state: SessionState): void {
  sessionCountdownOverlay.update(state);
  sendToRenderer('session:state', state);
}

function broadcastActiveGame(): void {
  sendToRenderer('activeGame:state', launcher.activeState);
}

function clearPendingSessionExtension(): void {
  for (const timer of sessionExtensionDeliveryTimers) clearTimeout(timer);
  sessionExtensionDeliveryTimers = [];
  pendingSessionExtension = null;
}

function deliverPendingSessionExtension(request: SessionExtensionRequest): void {
  if (pendingSessionExtension?.id !== request.id) return;
  sendToRenderer('session:extendRequested', request);
}

function requestSessionExtension(stage: SessionWarningStage): void {
  clearPendingSessionExtension();
  const request = { id: randomUUID(), stage } satisfies SessionExtensionRequest;
  pendingSessionExtension = request;
  sessionWarningOverlay?.close();
  launcher.focusLauncher();
  applyKioskSettings(store.getSettings());

  for (const delay of [0, 100, 350, 900, 1800]) {
    const timer = setTimeout(() => deliverPendingSessionExtension(request), delay);
    sessionExtensionDeliveryTimers.push(timer);
  }
  void logLine('info', `Requested ${stage} paid-session extension flow (${request.id}); awaiting renderer acknowledgement.`);
}

function showSessionWarning(stage: SessionWarningStage): void {
  void launcher.pauseActiveGameForWarning().catch((error) => {
    void logLine('warn', `Could not send Escape for the ${stage} paid-session warning: ${String(error)}`);
  });
  sessionWarningOverlay?.show(stage);
}

function buildDiagnostics(): AppDiagnostics {
  const inputDiagnostics = kioskInput.diagnostics;
  const window = getLiveMainWindow();
  const bounds = window?.getBounds();
  const displayBounds = bounds ? screen.getDisplayMatching(bounds).bounds : undefined;
  const coversDisplay = Boolean(
    bounds &&
    displayBounds &&
    bounds.x === displayBounds.x &&
    bounds.y === displayBounds.y &&
    bounds.width === displayBounds.width &&
    bounds.height === displayBounds.height
  );
  return {
    shortcuts: inputDiagnostics.shortcuts,
    controller: controllerDiagnostics,
    controllerCompatibility: controllerCompatibility.diagnostics,
    activeGame: launcher.diagnosticState,
    kiosk: {
      ...inputDiagnostics.kiosk,
      taskbarHidden: taskbarHiddenByKiosk || launcher.taskbarHidden,
      alwaysOnTop: Boolean(window?.isAlwaysOnTop()),
      launcherVisible: Boolean(window?.isVisible()),
      fullscreen: Boolean(window?.isFullScreen()) || coversDisplay,
      maximized: Boolean(window?.isMaximized()),
      resizable: Boolean(window?.isResizable())
    }
  };
}

function sendShellHome(event: ShellHomeEvent): void {
  sendToRenderer('shell:home', event);
}

let homeActionInFlight: Promise<void> | null = null;

function openHomeFromGame(reason: ShellHomeReason = 'system'): void {
  if (homeActionInFlight) {
    void logLine('info', `Ignored overlapping Home request from ${reason}; current Home action is still running.`);
    launcher.focusLauncher();
    return;
  }

  void logLine('info', `Shell home requested by ${reason}.`);
  const hasActiveGame = launcher.hasTrackedGames;
  homeActionInFlight = (hasActiveGame ? launcher.openQuickOverlay() : launcher.returnToHome())
    .then((result) => {
      applyKioskSettings(store.getSettings());
      sendShellHome({
        reason,
        openActiveGamePanel: false,
        emergencyClose: reason === 'emergency-close'
      });
      if (!result.ok) {
        void logLine('warn', `Home action completed with a warning: ${result.error ?? 'unknown error'}`);
      }
    })
    .catch((error) => {
      launcher.focusLauncher();
      applyKioskSettings(store.getSettings());
      void logLine('error', `Home action failed: ${error instanceof Error ? error.message : String(error)}`);
    })
    .finally(() => {
      homeActionInFlight = null;
    });
}

function focusExistingInstance(): void {
  const window = getLiveMainWindow();
  if (!window) {
    secondInstanceFocusPending = true;
    return;
  }

  secondInstanceFocusPending = false;
  if (window.isMinimized()) {
    window.restore();
  }
  handleShellHomeRequest('second-instance');
  void logLine('info', 'A second NXGS launch restored and focused the existing launcher window.');
}

function requestEmergencyCloseOverlay(): void {
  void logLine('warn', 'Emergency close shortcut requested for the active game.');
  openHomeFromGame('emergency-close');
}

function handleRestrictedCustomerInput(input: string): void {
  void logLine('info', `Keeping NXGS focused after blocked input: ${input}.`);
  applyKioskSettings(store.getSettings());
  for (const delay of [0, 80, 220]) {
    setTimeout(() => {
      const window = getLiveMainWindow();
      window?.show();
      window?.focus();
    }, delay);
  }
}

const sessionTimer = new SessionTimer({
  onTick: broadcastSession,
  onWarning: (minutesRemaining) => {
    showSessionWarning('two');
    void logLine('warn', `Paid play session has ${minutesRemaining} minutes remaining.`);
  },
  onExpired: () => {
    controllerIdleService?.paidSessionEnded();
    showSessionWarning('final');
    void logLine('warn', 'Paid play session expired; awaiting Extend or Skip while games remain open.');
  }
});

const launcher = new GameLauncher(
  () => mainWindow,
  {
    onGameExited: (game) => {
      if (!launcher.hasTrackedGames) {
        controllerIdleService?.setGameplayActive(false);
        controllerCompatibility.stop();
      }
      applyKioskSettings(store.getSettings());
    },
    onError: (message) => {
      if (!launcher.hasTrackedGames) {
        controllerIdleService?.setGameplayActive(false);
        controllerCompatibility.stop();
      }
      launcher.focusLauncher();
      applyKioskSettings(store.getSettings());
    },
    onGameWindowDetected: () => undefined,
    onActiveGameChanged: () => {
      controllerIdleService?.setGameplayActive(launcher.hasTrackedGames);
      broadcastActiveGame();
    }
  },
  () => kioskInput.currentMode === 'customer'
);

const kioskInput = new KioskInputService({
  onHome: handleShellHomeRequest,
  onRestrictedInput: handleRestrictedCustomerInput,
  onEmergencyClose: requestEmergencyCloseOverlay
});

async function endPaidSession(): Promise<GameControlResult> {
  try {
    await launcher.closeAllGames();
    sessionTimer.stop('idle');
    clearPendingSessionExtension();
    sessionWarningOverlay?.close();
    controllerIdleService?.setGameplayActive(false);
    controllerCompatibility.stop();
    launcher.focusLauncher();
    applyKioskSettings(store.getSettings());
    sendShellHome({ reason: 'system', openActiveGamePanel: false, emergencyClose: false });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logLine('error', `Could not end paid session cleanly: ${message}`);
    return { ok: false, error: message };
  }
}

async function handleSessionWarningAction(
  action: SessionWarningAction,
  stage: SessionWarningStage
): Promise<GameControlResult> {
  if (action === 'extend') {
    requestSessionExtension(stage);
    return { ok: true };
  }
  if (stage === 'final') return endPaidSession();

  sessionWarningOverlay?.close();
  const result = await launcher.resumeActiveGame();
  if (!result.ok && !launcher.hasTrackedGames) {
    launcher.focusLauncher();
    applyKioskSettings(store.getSettings());
  }
  return result;
}

sessionWarningOverlay = new SessionWarningOverlay(handleSessionWarningAction);

function handleShellHomeRequest(reason: ShellHomeReason): void {
  if (reason === 'controller-home' || reason === 'controller-combo') {
    void suppressXboxGameBarSurfaces();
  }
  if (kioskInput.currentMode === 'admin') {
    applyKioskSettings(store.getSettings());
    sendShellHome({
      reason,
      openActiveGamePanel: false,
      emergencyClose: false,
      preserveAdminWindow: true,
      openQuickNav: reason !== 'second-instance'
    });
    void logLine('info', `Handled ${reason} inside windowed Admin mode without changing presentation mode.`);
    return;
  }

  kioskAdminActionGranted = false;
  kioskInput.setAdminPinActive(false);
  kioskInput.setAdminControlsUnlocked(false);
  openHomeFromGame(reason);
}

function setKioskMode(mode: KioskMode): void {
  if (mode === 'customer') {
    kioskAdminActionGranted = false;
  }
  kioskInput.setMode(mode);
  applyKioskSettings(store.getSettings());
}

function returnToLockedMode(): void {
  kioskAdminActionGranted = false;
  kioskInput.setAdminPinActive(false);
  kioskInput.setAdminControlsUnlocked(false);
  setKioskMode('customer');
  const window = getLiveMainWindow();
  window?.show();
  window?.focus();
}

async function performKioskAdminAction(action: KioskAdminAction): Promise<KioskAdminActionResult> {
  if (action === 'returnLocked') {
    returnToLockedMode();
    return { ok: true };
  }
  if (!kioskAdminActionGranted) {
    return { ok: false, error: 'Admin PIN verification is required.' };
  }

  const window = getLiveMainWindow();
  if (!window) {
    return { ok: false, error: 'NXGS window is unavailable.' };
  }

  kioskAdminActionGranted = false;
  if (action === 'closeApp') {
    isQuitting = true;
    sessionTimer.stop('idle', false);
    sessionCountdownOverlay.close();
    sessionWarningOverlay?.close();
    kioskInput.unregisterAll();
    window.setSkipTaskbar(false);
    try {
      await setWindowsTaskbarVisible(true);
      taskbarHiddenByKiosk = false;
    } catch (error) {
      await logLine('warn', `Could not restore Windows taskbar before closing NXGS: ${String(error)}`);
    }
    app.quit();
    return { ok: true };
  }

  setKioskMode('admin');
  kioskInput.setAdminPinActive(false);
  kioskInput.setAdminControlsUnlocked(false);
  if (action === 'minimize') {
    window.minimize();
  } else if (action === 'exitFullscreen') {
    launcher.restoreTaskbarForAdmin();
    await setWindowsTaskbarVisible(true);
    taskbarHiddenByKiosk = false;
    window.setSkipTaskbar(false);
    window.setAlwaysOnTop(false);
    window.setFullScreen(false);
    window.setResizable(true);
    window.setMaximizable(true);
    window.setMinimizable(true);
    window.setMovable(true);
    if (window.isMaximized()) window.unmaximize();
    const workArea = screen.getDisplayMatching(window.getBounds()).workArea;
    const width = Math.min(workArea.width, Math.max(900, Math.floor(workArea.width * 0.78)));
    const height = Math.min(workArea.height, Math.max(620, Math.floor(workArea.height * 0.82)));
    window.setBounds({
      x: workArea.x + Math.floor((workArea.width - width) / 2),
      y: workArea.y + Math.floor((workArea.height - height) / 2),
      width,
      height
    });
    window.show();
    window.focus();
  } else if (action === 'openManagement') {
    window.show();
    window.focus();
  }
  return { ok: true };
}

function setKioskTaskbarHidden(hidden: boolean, reason: string): void {
  taskbarHiddenByKiosk = hidden;
  void setWindowsTaskbarVisible(!hidden).catch((error) => {
    void logLine('warn', `Could not ${hidden ? 'hide' : 'restore'} Windows taskbar for ${reason}: ${String(error)}`);
  });
}

function applyKioskSettings(_settings: AppSettings): void {
  const window = getLiveMainWindow();
  if (!window) {
    return;
  }

  if (kioskInput.currentMode === 'admin') {
    launcher.restoreTaskbarForAdmin();
    setKioskTaskbarHidden(false, 'admin mode');
    window.setSkipTaskbar(false);
    window.setAlwaysOnTop(false);
    window.setFullScreen(false);
    window.setResizable(true);
    window.setMaximizable(true);
    window.setMinimizable(true);
    window.setMovable(true);
    window.show();
    window.focus();
    return;
  }

  setKioskTaskbarHidden(true, 'customer mode');
  window.setSkipTaskbar(true);
  // Customer fullscreen is the console shell. Keep it in the highest supported
  // Electron layer so shell popups cannot be inserted above it between native
  // notification-guard sweeps.
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setResizable(false);
  window.setMaximizable(false);
  window.setMinimizable(false);
  window.setMovable(false);
  const display = screen.getDisplayMatching(window.getBounds());
  window.setBounds(display.bounds);
  window.setMenuBarVisibility(false);
  window.setFullScreen(true);
}

function prepareForQuit(): void {
  isQuitting = true;
  clearPendingSessionExtension();
  sessionTimer.stop('idle', false);
  sessionCountdownOverlay.close();
  sessionWarningOverlay?.close();
  controllerCompatibility.stop();
  controllerIdleService?.stop();
  controllerIdleService = null;
  void setWindowsTaskbarVisible(true);
  kioskInput.unregisterAll();
  stopWindowsControlWorker();
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    title: 'NXGS Play',
    fullscreen: true,
    frame: true,
    transparent: false,
    hasShadow: true,
    skipTaskbar: true,
    icon: getAppIconPath(),
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.on('close', (event) => {
    const settings = store.getSettings();
    if (!isQuitting && (kioskInput.currentMode === 'customer' || settings.kiosk.preventClose)) {
      event.preventDefault();
      handleRestrictedCustomerInput('Close request: Alt+F4 / window close');
    }
  });

  mainWindow.on('blur', () => {
    // Launch, resume, and close handoffs intentionally move focus between NXGS and
    // the selected game window. They are trusted launcher actions, not attempts to
    // escape customer mode, so the blur guard must not request an Admin PIN.
    const gameShouldOwnForeground = ['launching', 'running', 'resuming', 'closing'].includes(
      launcher.activeState.status
    );
    if (kioskInput.currentMode === 'customer' && !kioskInput.isAdminPinActive && !gameShouldOwnForeground) {
      kioskInput.handleFocusEscape('Launcher lost focus');
    }
  });

  mainWindow.on('app-command', (event, command) => {
    if (command !== 'browser-backward') return;
    event.preventDefault();
    const window = getLiveMainWindow();
    window?.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window?.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });

  kioskInput.attachWindow(mainWindow);
  applyKioskSettings(store.getSettings());

  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function registerIpc(): void {
  ipcMain.handle('app:getInitialData', () => ({
    games: store.listGames(),
    settings: store.getSettings(),
    appVersion: app.getVersion(),
    platform: process.platform,
    dataPath: store.path,
    logsPath: getLogPath(),
    isPackaged: app.isPackaged,
    activeGame: launcher.activeState,
    session: sessionTimer.current,
    diagnostics: buildDiagnostics()
  }));

  ipcMain.handle('app:getDiagnostics', () => buildDiagnostics());
  ipcMain.handle('network:getStatus', async () => getNetworkStatus());
  ipcMain.handle('network:getCurrent', async () => getNetworkStatus());
  ipcMain.handle('network:scan', async () => getNetworkStatus());
  ipcMain.handle('network:connect', async (_event, request: WifiConnectRequest) => connectWifi(request));
  ipcMain.handle('network:disconnect', async () => disconnectWifi());
  ipcMain.handle('network:forget', async (_event, ssid: string) => forgetWifi(ssid));
  ipcMain.handle('bluetooth:getStatus', async () => scanBluetoothDevices(false));
  ipcMain.handle('bluetooth:scan', async () => scanBluetoothDevices(true));
  ipcMain.handle('bluetooth:pair', async (_event, request: BluetoothPairRequest) => pairBluetoothDevice(request));
  ipcMain.handle('bluetooth:cancelPair', () => cancelBluetoothPairing());
  ipcMain.handle('bluetooth:disconnect', async (_event, deviceId: string) => disconnectBluetoothDevice(deviceId));
  ipcMain.handle('bluetooth:remove', async (_event, deviceId: string) => removeBluetoothDevice(deviceId));
  ipcMain.handle('audio:getStatus', async () => getAudioStatus());
  ipcMain.handle('audio:getOutputDevices', async () => getAudioStatus());
  ipcMain.handle('audio:getInputDevices', async () => getAudioStatus());
  ipcMain.handle('audio:setVolume', async (_event, volume: number) => setMasterVolume(volume));
  ipcMain.handle('audio:setMuted', async (_event, muted: boolean) => setMasterMuted(muted));
  ipcMain.handle('audio:switchOutput', async (_event, deviceId: string) => switchAudioDevice(deviceId, 'output'));
  ipcMain.handle('audio:switchInput', async (_event, deviceId: string) => switchAudioDevice(deviceId, 'input'));
  ipcMain.handle('display:getStatus', async () => getDisplayStatus(getDisplayDevices()));
  ipcMain.handle('display:setBrightness', async (_event, value: number) => setDisplayBrightness(value, getDisplayDevices()));
  ipcMain.handle('display:setNightLight', async (_event, enabled: boolean) => setNightLight(enabled, getDisplayDevices()));
  ipcMain.handle('display:setColorProfile', async (_event, profileName: string) => setColorProfile(profileName, getDisplayDevices()));
  ipcMain.handle('display:setHdr', async (_event, enabled: boolean) => setHdr(enabled, getDisplayDevices()));

  ipcMain.handle('kiosk:setMode', (_event, mode: KioskMode) => {
    if (mode !== 'customer') {
      throw new Error('Admin mode requires a verified kiosk admin action.');
    }
    setKioskMode(mode);
    return buildDiagnostics();
  });

  ipcMain.handle('kiosk:setAdminPinActive', (_event, active: boolean) => {
    kioskInput.setAdminPinActive(active);
    return { ok: true };
  });

  ipcMain.handle('kiosk:unlockAdminActions', (_event, pin: string) => {
    const ok = store.verifyPin(pin);
    kioskAdminActionGranted = ok;
    kioskInput.setAdminPinActive(ok);
    kioskInput.setAdminControlsUnlocked(ok);
    if (!ok) {
      returnToLockedMode();
    }
    return { ok };
  });

  ipcMain.handle('kiosk:performAdminAction', (_event, action: KioskAdminAction) =>
    performKioskAdminAction(action)
  );

  ipcMain.handle('input:controllerState', (_event, report: ControllerStateReport) => {
    controllerDiagnostics = {
      ...report,
      lastInputAt: new Date().toISOString()
    };
    return buildDiagnostics();
  });

  ipcMain.handle('shell:homeRequest', (_event, reason: ShellHomeReason = 'renderer-request') => {
    kioskInput.requestHome(reason);
    return { ok: true };
  });

  ipcMain.handle('auth:verifyPin', (_event, pin: string) => ({ ok: store.verifyPin(pin) }));

  ipcMain.handle('games:save', async (_event, input: GameInput) => {
    const saved = await store.saveGame(input);
    return { game: saved, games: store.listGames() };
  });

  ipcMain.handle('games:delete', async (_event, id: string) => {
    await store.deleteGame(id);
    return { games: store.listGames() };
  });

  ipcMain.handle('games:scanInstalled', async () => scanInstalledGames());

  ipcMain.handle('settings:update', async (_event, settings: AppSettings) => {
    const updated = await store.updateSettings(settings);
    applyKioskSettings(updated);
    controllerIdleService?.updateSettings(updated.controllerIdle);
    return updated;
  });

  ipcMain.handle('updates:check', async () => checkForUpdates());

  ipcMain.handle('updates:download', async (event, request: UpdateDownloadRequest) =>
    downloadUpdate(request, (progress) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('updates:downloadProgress', progress);
      }
    })
  );

  ipcMain.handle('updates:install', async (_event, request: UpdateInstallRequest) => {
    const result = await startUpdateInstaller(request);
    if (result.ok) {
      prepareForQuit();
      setTimeout(() => app.exit(0), 500);
    }
    return result;
  });

  ipcMain.handle('dialog:selectImageFile', async (_event, imageKind: GameImageKind = 'cover'): Promise<FilePickerResult> => {
    const result = await showOpenDialog({
      title: imageKind === 'avatar' ? 'Select Avatar Image' : 'Select Cover / Background Image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    return validatePickedPath(result.filePaths[0], ['.png', '.jpg', '.jpeg', '.webp']);
  });

  ipcMain.handle('dialog:selectExecutableFile', async (): Promise<FilePickerResult> => {
    const result = await showOpenDialog({
      title: 'Select Game Executable',
      properties: ['openFile'],
      filters: [{ name: 'Game Executable', extensions: ['exe'] }]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    return validatePickedPath(result.filePaths[0], ['.exe']);
  });

  ipcMain.handle('dialog:selectFolder', async (): Promise<FilePickerResult> => {
    const result = await showOpenDialog({
      title: 'Select Working Directory',
      properties: ['openDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    return validatePickedPath(result.filePaths[0], undefined, true);
  });

  ipcMain.handle('payment:catalog', () => paymentService.catalog());
  ipcMain.handle('payment:create', (_event, request: CreatePaymentCheckoutRequest) =>
    paymentService.create(request));
  ipcMain.handle('payment:status', (_event, access: PaymentCheckoutAccess) =>
    paymentService.status(access));
  ipcMain.handle('payment:retry', (_event, access: PaymentCheckoutAccess) =>
    paymentService.retry(access));
  ipcMain.handle('payment:cancel', (_event, access: PaymentCheckoutAccess) =>
    paymentService.cancel(access));
  ipcMain.handle('payment:consume', async (_event, access: PaymentCheckoutAccess) => {
    const result = await paymentService.consume(access);
    if (!result.ok || !result.entitlement) return result;
    const state = sessionTimer.active
      ? sessionTimer.extend(result.entitlement.durationMinutes)
      : sessionTimer.start(result.entitlement.durationMinutes);
    await logLine(
      'info',
      `${state.revision > 1 ? 'Extended' : 'Started'} station-wide paid session by ${result.entitlement.durationMinutes} minutes.`
    );
    return {
      ...result,
      entitlement: {
        ...result.entitlement,
        sessionExpiresAt: state.expiresAt
      }
    };
  });

  ipcMain.handle('game:launch', async (_event, request: LaunchRequest) => {
    try {
      const game = store.getGame(request.gameId);
      if (!game) {
        throw new Error('Game not found.');
      }
      if (!sessionTimer.active) {
        throw new Error('Paid play time is required before launching a game.');
      }
      if (launcher.activeState.sessions?.some((session) => session.game.id === game.id)) {
        return launcher.resumeActiveGame(game.id);
      }
      controllerIdleService?.setGameplayActive(true);
      const launch = launcher.launch(game);
      void controllerCompatibility.ensureReadyForGame(game).then((compatibility) => {
        if (compatibility.status !== 'ready') {
          void logLine('warn', `Launching ${game.title} without ready controller compatibility: ${compatibility.message ?? compatibility.status}`);
        }
      }).catch((error) => {
        void logLine('warn', `Background controller preparation failed for ${game.title}: ${String(error)}`);
      });
      void launch.catch(async (error) => {
        const message = error instanceof Error ? error.message : String(error);
        await logLine('error', `Background launch request failed for ${game.title}: ${message}`);
        if (!launcher.hasTrackedGames) controllerIdleService?.setGameplayActive(false);
        launcher.focusLauncher();
        applyKioskSettings(store.getSettings());
      });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logLine('error', `Launch request failed: ${message}`);
      if (!launcher.hasTrackedGames) controllerIdleService?.setGameplayActive(false);
      launcher.focusLauncher();
      applyKioskSettings(store.getSettings());
      return { ok: false, error: message };
    }
  });

  ipcMain.handle('game:resumeActive', async (_event, gameId?: string): Promise<GameControlResult> => {
    const game = gameId
      ? launcher.activeState.sessions?.find((session) => session.game.id === gameId)?.game ?? launcher.active
      : launcher.active;
    const resume = launcher.resumeActiveGame(gameId);
    void (game
      ? controllerCompatibility.ensureReadyForGame(game)
      : controllerCompatibility.ensureReady()
    ).then((compatibility) => {
      if (compatibility.status !== 'ready') {
        void logLine('warn', `Resuming a game without ready controller compatibility: ${compatibility.message ?? compatibility.status}`);
      }
    }).catch((error) => {
      void logLine('warn', `Background controller preparation during resume failed: ${String(error)}`);
    });
    return resume;
  });

  ipcMain.handle('game:minimizeActive', async (): Promise<GameControlResult> => {
    const result = await launcher.minimizeActiveGame();
    if (result.ok) {
      controllerCompatibility.stop();
      applyKioskSettings(store.getSettings());
    }
    return result;
  });

  ipcMain.handle('game:goToLauncherHome', async (): Promise<GameControlResult> => {
    const result = await launcher.returnToHome();
    if (result.ok) {
      controllerCompatibility.stop();
      applyKioskSettings(store.getSettings());
    }
    return result;
  });

  ipcMain.handle('game:closeActive', async (_event, gameId?: string): Promise<GameControlResult> => {
    try {
      await launcher.closeActiveGame(false, { gameId });
      launcher.focusLauncher();
      applyKioskSettings(store.getSettings());
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('session:forceClose', async (_event, pin: string, gameId?: string) => {
    if (!store.verifyPin(pin)) {
      return { ok: false };
    }
    await launcher.closeActiveGame(true, { gameId });
    launcher.focusLauncher();
    applyKioskSettings(store.getSettings());
    return { ok: true };
  });

  ipcMain.handle('session:end', endPaidSession);
  ipcMain.handle('session:getPendingExtension', () => pendingSessionExtension);
  ipcMain.handle('session:extensionOpened', async (_event, requestId: string) => {
    if (!pendingSessionExtension || pendingSessionExtension.id !== requestId) {
      return { ok: false };
    }
    const acknowledged = pendingSessionExtension;
    clearPendingSessionExtension();
    await logLine('info', `Renderer opened the ${acknowledged.stage} paid-session extension flow (${acknowledged.id}).`);
    return { ok: true };
  });
  ipcMain.handle('session:cancelExtension', async (_event, stage: SessionWarningStage) => {
    clearPendingSessionExtension();
    if (stage === 'final' && sessionTimer.current.status === 'expired') {
      await launcher.resumeActiveGame();
      sessionWarningOverlay?.show('final');
      return { ok: true };
    }
    const result = await launcher.resumeActiveGame();
    if (!result.ok && !launcher.hasTrackedGames) launcher.focusLauncher();
    return result;
  });

  ipcMain.handle('game:closeForSwitch', async (_event, gameId?: string): Promise<GameControlResult> => {
    try {
      await launcher.closeActiveGame(false, { gameId, retireActiveSession: true });
      applyKioskSettings(store.getSettings());
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('session:clearExpired', async () => {
    await endPaidSession();
  });

  ipcMain.handle('app:exit', (_event, pin: string) => {
    if (!store.verifyPin(pin)) {
      return { ok: false };
    }
    prepareForQuit();
    app.quit();
    return { ok: true };
  });
}

app.setAppUserModelId('com.nxgs.play');

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    focusExistingInstance();
  });

  app.whenReady().then(async () => {
    await store.init();
    await disableXboxGameBarControllerShortcut();
    registerIpc();
    await createWindow();
    controllerIdleService = new ControllerIdleService(store.getSettings().controllerIdle, {
      onNotification: (notification) => sendToRenderer('controllerIdle:notification', notification),
      onInputState: (state) => sendToRenderer('controller:inputState', state)
    });
    controllerIdleService.start();
    warmWindowsControlWorker();
    kioskInput.register();
    void controllerCompatibility.prepare();
    if (secondInstanceFocusPending) {
      focusExistingInstance();
    }
    await logLine('info', 'NXGS Play started.');
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    } else {
      focusExistingInstance();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      prepareForQuit();
      app.quit();
    }
  });

  app.on('will-quit', () => {
    prepareForQuit();
  });
}
