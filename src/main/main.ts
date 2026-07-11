import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions, type OpenDialogReturnValue } from 'electron';
import { basename, dirname, extname, join } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { DataStore } from './database';
import { GameLauncher } from './gameLauncher';
import { scanInstalledGames } from './gameScanner';
import { KioskInputService } from './kioskInputService';
import { getLogPath, logLine } from './logger';
import { SessionTimer } from './sessionTimer';
import { checkForUpdates, downloadUpdate, startUpdateInstaller } from './updateService';
import { setWindowsTaskbarVisible } from './windowManagerService';
import type {
  AdminUnlockRequest,
  AppDiagnostics,
  AppSettings,
  ControllerStateReport,
  FilePickerResult,
  GameControlResult,
  GameImageKind,
  GameInput,
  KioskMode,
  LaunchRequest,
  ShellHomeEvent,
  ShellHomeReason,
  SessionState,
  UpdateDownloadRequest,
  UpdateInstallRequest
} from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let taskbarHiddenByKiosk = false;
let controllerDiagnostics: AppDiagnostics['controller'] = {
  detected: false,
  homeSupported: 'unknown'
};

const store = new DataStore();

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

function sendToRenderer(channel: string, ...args: unknown[]): void {
  const window = getLiveMainWindow();
  if (!window || window.webContents.isDestroyed()) {
    return;
  }
  window.webContents.send(channel, ...args);
}

function broadcastSession(state: SessionState): void {
  sendToRenderer('session:state', state);
}

function broadcastActiveGame(): void {
  sendToRenderer('activeGame:state', launcher.activeState);
}

function buildDiagnostics(): AppDiagnostics {
  const inputDiagnostics = kioskInput.diagnostics;
  const window = getLiveMainWindow();
  return {
    shortcuts: inputDiagnostics.shortcuts,
    controller: controllerDiagnostics,
    activeGame: launcher.diagnosticState,
    kiosk: {
      ...inputDiagnostics.kiosk,
      taskbarHidden: taskbarHiddenByKiosk || launcher.taskbarHidden,
      alwaysOnTop: Boolean(window?.isAlwaysOnTop()),
      launcherVisible: Boolean(window?.isVisible())
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

function requestEmergencyCloseOverlay(): void {
  void logLine('warn', 'Emergency close shortcut requested for the active game.');
  openHomeFromGame('emergency-close');
}

function requestAdminUnlock(request: AdminUnlockRequest): void {
  void launcher.returnToHome().then(() => {
    applyKioskSettings(store.getSettings());
    sendToRenderer('kiosk:adminUnlockRequested', request);
  });
}

const sessionTimer = new SessionTimer({
  onTick: broadcastSession,
  onExpired: (game) => {
    launcher.focusLauncher();
    void launcher.closeActiveGame(false, { gameId: game.id });
    void logLine('warn', `Session expired for ${game.title}; requested graceful close.`);
  }
});

const launcher = new GameLauncher(
  () => mainWindow,
  {
    onGameExited: (game) => {
      if (sessionTimer.current.gameId === game.id) {
        sessionTimer.stop('idle');
      }
      applyKioskSettings(store.getSettings());
    },
    onError: (message) => {
      sessionTimer.setError(message);
      launcher.focusLauncher();
      applyKioskSettings(store.getSettings());
    },
    onActiveGameChanged: () => {
      broadcastActiveGame();
    }
  }
);

const kioskInput = new KioskInputService({
  onHome: openHomeFromGame,
  onAdminUnlockRequest: requestAdminUnlock,
  onEmergencyClose: requestEmergencyCloseOverlay
});

function setKioskMode(mode: KioskMode): void {
  kioskInput.setMode(mode);
  applyKioskSettings(store.getSettings());
}

function setKioskTaskbarHidden(hidden: boolean, reason: string): void {
  taskbarHiddenByKiosk = hidden;
  void setWindowsTaskbarVisible(!hidden).catch((error) => {
    void logLine('warn', `Could not ${hidden ? 'hide' : 'restore'} Windows taskbar for ${reason}: ${String(error)}`);
  });
}

function applyKioskSettings(settings: AppSettings): void {
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
    window.maximize();
    window.show();
    window.focus();
    return;
  }

  setKioskTaskbarHidden(true, 'customer mode');
  const shouldStayOnTop =
    settings.kiosk.alwaysOnTop ||
    launcher.activeState.status === 'quickOverlayOpen' ||
    launcher.activeState.status === 'resuming' ||
    launcher.activeState.status === 'closing';
  window.setSkipTaskbar(true);
  window.setAlwaysOnTop(shouldStayOnTop, shouldStayOnTop ? 'screen-saver' : undefined);
  window.setFullScreen(true);
}

function prepareForQuit(): void {
  isQuitting = true;
  sessionTimer.stop('idle', false);
  void setWindowsTaskbarVisible(true);
  kioskInput.unregisterAll();
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    title: 'NXGS Play',
    fullscreen: true,
    frame: false,
    transparent: true,
    hasShadow: false,
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
    if (!isQuitting && settings.kiosk.preventClose) {
      event.preventDefault();
      const window = getLiveMainWindow();
      window?.show();
      window?.focus();
      sendToRenderer('session:state', {
        ...sessionTimer.current,
        message: 'Admin PIN is required to exit NXGS Play.'
      });
    }
  });

  mainWindow.on('blur', () => {
    const settings = store.getSettings();
    if (kioskInput.currentMode === 'customer' && settings.kiosk.refocusOnBlur && !launcher.active) {
      setTimeout(() => {
        const window = getLiveMainWindow();
        window?.show();
        window?.focus();
      }, 500);
    }
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
    diagnostics: buildDiagnostics()
  }));

  ipcMain.handle('app:getDiagnostics', () => buildDiagnostics());

  ipcMain.handle('kiosk:setMode', (_event, mode: KioskMode) => {
    setKioskMode(mode);
    return buildDiagnostics();
  });

  ipcMain.handle('kiosk:setAdminPinActive', (_event, active: boolean) => {
    kioskInput.setAdminPinActive(active);
    return { ok: true };
  });

  ipcMain.handle('input:controllerState', (_event, report: ControllerStateReport) => {
    controllerDiagnostics = {
      ...report,
      lastInputAt: new Date().toISOString()
    };
    return buildDiagnostics();
  });

  ipcMain.handle('shell:homeRequest', (_event, reason: ShellHomeReason = 'renderer-request') => {
    openHomeFromGame(reason);
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
      filters: [{ name: 'Windows Executable', extensions: ['exe'] }]
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

  ipcMain.handle('game:launch', async (_event, request: LaunchRequest) => {
    try {
      const game = store.getGame(request.gameId);
      if (!game) {
        throw new Error('Game not found.');
      }
      sessionTimer.setLaunching(game, request.durationMinutes);
      await launcher.launch(game);
      sessionTimer.start(game, request.durationMinutes);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logLine('error', `Launch request failed: ${message}`);
      sessionTimer.setError(message);
      launcher.focusLauncher();
      applyKioskSettings(store.getSettings());
      return { ok: false, error: message };
    }
  });

  ipcMain.handle('game:resumeActive', async (_event, gameId?: string): Promise<GameControlResult> =>
    launcher.resumeActiveGame(gameId)
  );

  ipcMain.handle('game:minimizeActive', async (): Promise<GameControlResult> => {
    const result = await launcher.minimizeActiveGame();
    if (result.ok) {
      applyKioskSettings(store.getSettings());
    }
    return result;
  });

  ipcMain.handle('game:goToLauncherHome', async (): Promise<GameControlResult> => {
    const result = await launcher.returnToHome();
    if (result.ok) {
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
    if (!launcher.hasTrackedGames) {
      sessionTimer.stop('idle');
    }
    launcher.focusLauncher();
    applyKioskSettings(store.getSettings());
    return { ok: true };
  });

  ipcMain.handle('session:clearExpired', async () => {
    await launcher.clearActive();
    sessionTimer.stop('idle');
    applyKioskSettings(store.getSettings());
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

app.whenReady().then(async () => {
  await store.init();
  registerIpc();
  await createWindow();
  kioskInput.register();
  await logLine('info', 'NXGS Play started.');
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
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
