import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions, type OpenDialogReturnValue } from 'electron';
import { basename, dirname, extname, join } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { DataStore } from './database';
import { GameLauncher } from './gameLauncher';
import { scanInstalledGames } from './gameScanner';
import { getLogPath, logLine } from './logger';
import { SessionTimer } from './sessionTimer';
import { checkForUpdates } from './updateService';
import type { AppSettings, FilePickerResult, GameInput, LaunchRequest, SessionState } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

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

function broadcastSession(state: SessionState): void {
  mainWindow?.webContents.send('session:state', state);
}

const sessionTimer = new SessionTimer({
  onTick: broadcastSession,
  onExpired: (game) => {
    launcher.focusLauncher();
    void launcher.closeActiveGame(false);
    void logLine('warn', `Session expired for ${game.title}; requested graceful close.`);
  }
});

const launcher = new GameLauncher(
  () => mainWindow,
  {
    onGameExited: () => {
      sessionTimer.stop('idle');
    },
    onError: (message) => {
      sessionTimer.setError(message);
      launcher.focusLauncher();
    }
  }
);

function applyKioskSettings(settings: AppSettings): void {
  if (!mainWindow) {
    return;
  }
  mainWindow.setAlwaysOnTop(settings.kiosk.alwaysOnTop);
  mainWindow.setFullScreen(true);
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    title: 'NXGS Play',
    fullscreen: true,
    frame: false,
    icon: getAppIconPath(),
    autoHideMenuBar: true,
    backgroundColor: '#07090d',
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
      mainWindow?.show();
      mainWindow?.focus();
      mainWindow?.webContents.send('session:state', {
        ...sessionTimer.current,
        message: 'Admin PIN is required to exit NXGS Play.'
      });
    }
  });

  mainWindow.on('blur', () => {
    const settings = store.getSettings();
    if (settings.kiosk.refocusOnBlur && !launcher.active) {
      setTimeout(() => {
        mainWindow?.show();
        mainWindow?.focus();
      }, 500);
    }
  });

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
    isPackaged: app.isPackaged
  }));

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

  ipcMain.handle('dialog:selectImageFile', async (): Promise<FilePickerResult> => {
    const result = await showOpenDialog({
      title: 'Select Cover Image',
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
      return { ok: false, error: message };
    }
  });

  ipcMain.handle('session:forceClose', async (_event, pin: string) => {
    if (!store.verifyPin(pin)) {
      return { ok: false };
    }
    await launcher.closeActiveGame(true);
    await launcher.clearActive();
    sessionTimer.stop('idle');
    launcher.focusLauncher();
    return { ok: true };
  });

  ipcMain.handle('session:clearExpired', async () => {
    await launcher.clearActive();
    sessionTimer.stop('idle');
  });

  ipcMain.handle('app:exit', (_event, pin: string) => {
    if (!store.verifyPin(pin)) {
      return { ok: false };
    }
    isQuitting = true;
    app.quit();
    return { ok: true };
  });
}

app.whenReady().then(async () => {
  await store.init();
  registerIpc();
  await createWindow();
  await logLine('info', 'NXGS Play started.');
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
