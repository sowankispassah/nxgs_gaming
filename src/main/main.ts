import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  screen,
  type NativeImage,
  type OpenDialogOptions,
  type OpenDialogReturnValue
} from 'electron';
import { randomUUID } from 'node:crypto';
import { basename, dirname, extname, join } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
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
import {
  enforceQuickOverlayZOrder,
  getRootWindowHandle,
  restoreWindowsTaskbarSync,
  setWindowsTaskbarVisible
} from './windowManagerService';
import { gameWindowMatchesGame } from './gameWindowIdentity';
import { stopWindowsControlWorker, warmWindowsControlWorker } from './windowsControlWorker';
import { disableXboxGameBarControllerShortcut, suppressXboxGameBarSurfaces } from './gameBarGuard';
import { PaymentService } from './paymentService';
import type {
  AppDiagnostics,
  AppSettings,
  BluetoothPairRequest,
  ControllerStateReport,
  CreatePaymentCheckoutRequest,
  DeviceInput,
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
  PlayPlanInput,
  QuickOverlayBackdrop,
  QuickOverlayBackdropKind,
  ShellHomeEvent,
  ShellHomeReason,
  SessionState,
  UpdateDownloadRequest,
  UpdateInstallRequest,
  WifiConnectRequest
} from '../shared/types';
import { requiresPaymentForLaunch } from '../shared/playAccess';

let mainWindow: BrowserWindow | null = null;
let gameplayQuickOverlayWindow: BrowserWindow | null = null;
let gameplayQuickOverlayWindowReady: Promise<void> | null = null;
let gameplayQuickOverlayShowPromise: Promise<void> | null = null;
let gameplayQuickOverlayPreparePromise: Promise<void> | null = null;
let gameplayQuickOverlayDesiredOpen = false;
let gameplayQuickOverlayTransitionGeneration = 0;
let gameplayQuickOverlayVisibilityGeneration = 0;
let gameplayQuickOverlayRequestId = 0;
let gameplayQuickOverlayPreparedGameId: string | null = null;
let gameplayQuickOverlayPreparedBackdropKind: QuickOverlayBackdropKind | null = null;
let gameplayQuickOverlayRendererReady = false;
let gameplayQuickOverlayNativeZOrderVerified = false;
let pendingQuickOverlayPaint: {
  requestId: number;
  resolve: (painted: boolean) => void;
  timeout: NodeJS.Timeout;
} | null = null;
let isQuitting = false;
let taskbarHiddenByKiosk = false;
let kioskAdminActionGranted = false;
let secondInstanceFocusPending = false;
const sessionCountdownOverlay = new SessionCountdownOverlay();
let sessionWarningOverlay: SessionWarningOverlay | null = null;
type SessionExtensionRequest = { id: string; stage: SessionWarningStage };
let pendingSessionExtension: SessionExtensionRequest | null = null;
let sessionExtensionDeliveryTimers: NodeJS.Timeout[] = [];
let launcherQuickNavOpen = false;
let controllerDiagnostics: AppDiagnostics['controller'] = {
  detected: false,
  homeSupported: 'unknown'
};

const store = new DataStore();
const controllerCompatibility = new ControllerCompatibilityService();
const paymentService = new PaymentService({
  listEnabled: () => store.listPlans(true),
  getById: (id) => store.getPlan(id)
});
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

function getLiveGameplayQuickOverlayWindow(): BrowserWindow | null {
  if (!gameplayQuickOverlayWindow || gameplayQuickOverlayWindow.isDestroyed()) {
    return null;
  }
  return gameplayQuickOverlayWindow;
}

function finishPendingQuickOverlayPaint(requestId: number, painted: boolean): void {
  if (pendingQuickOverlayPaint?.requestId !== requestId) return;
  const pending = pendingQuickOverlayPaint;
  pendingQuickOverlayPaint = null;
  clearTimeout(pending.timeout);
  pending.resolve(painted);
}

function waitForQuickOverlayPaint(requestId: number, timeoutMs = 5000): Promise<boolean> {
  if (pendingQuickOverlayPaint) {
    finishPendingQuickOverlayPaint(pendingQuickOverlayPaint.requestId, false);
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(() => finishPendingQuickOverlayPaint(requestId, false), timeoutMs);
    pendingQuickOverlayPaint = { requestId, resolve, timeout };
  });
}

function quickOverlaySnapshotIsUsable(image: NativeImage): boolean {
  if (image.isEmpty()) return false;
  const sample = image.resize({ width: 64, height: 36, quality: 'good' }).toBitmap();
  if (sample.length < 4) return false;

  let visiblePixels = 0;
  let minimumLuma = 255;
  let maximumLuma = 0;
  let totalLuma = 0;
  for (let index = 0; index + 3 < sample.length; index += 4) {
    const blue = sample[index];
    const green = sample[index + 1];
    const red = sample[index + 2];
    const alpha = sample[index + 3];
    if (alpha < 16) continue;
    const luma = Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722);
    visiblePixels += 1;
    minimumLuma = Math.min(minimumLuma, luma);
    maximumLuma = Math.max(maximumLuma, luma);
    totalLuma += luma;
  }
  if (visiblePixels < 64) return false;
  const averageLuma = totalLuma / visiblePixels;
  return averageLuma > 8 && maximumLuma - minimumLuma > 8;
}

async function createSafeQuickOverlayBackdrop(captureSnapshot: boolean): Promise<Omit<QuickOverlayBackdrop, 'requestId'>> {
  const game = launcher.activeState.game;
  const coverImage = game?.coverImagePath || game?.avatarImagePath || '';
  if (!game) return { kind: 'generated' };

  if (captureSnapshot) {
    try {
      const gameWindow = await launcher.getQuickOverlayBackdropWindow();
      if (gameWindow && gameWindowMatchesGame(game, gameWindow, launcher.diagnosticState.processId)) {
        const display = screen.getDisplayMatching(getLiveMainWindow()?.getBounds() ?? screen.getPrimaryDisplay().bounds);
        const sources = await desktopCapturer.getSources({
          types: ['window'],
          thumbnailSize: {
            width: Math.min(1920, Math.max(1, display.size.width)),
            height: Math.min(1080, Math.max(1, display.size.height))
          },
          fetchWindowIcons: false
        });
        // Microsoft Store/UWP games expose their render CoreWindow as a child
        // of an ApplicationFrameWindow. NXGS deliberately tracks the child PID
        // for identity safety, while desktopCapturer publishes only the root
        // frame HWND. Accept that root only when it is the native ancestor of
        // the already-verified tracked game window; never select by foreground
        // app, title, or an unrelated open window.
        const rootWindowHandle = await getRootWindowHandle(gameWindow.handle);
        const safeCaptureHandles = new Set([
          Math.trunc(gameWindow.handle),
          Math.trunc(rootWindowHandle)
        ]);
        const exactWindowSource = sources.find((source) => {
          const [kind, handle] = source.id.split(':');
          return kind === 'window' && safeCaptureHandles.has(Number(handle));
        });
        if (exactWindowSource) {
          const capturedHandle = Number(exactWindowSource.id.split(':')[1]);
          const snapshotIsUsable = quickOverlaySnapshotIsUsable(exactWindowSource.thumbnail);
          await logLine(
            'info',
            `Prepared exact live game-window source for ${game.title} from tracked window ` +
              `${gameWindow.handle} (capture root ${capturedHandle}; thumbnail usable: ${snapshotIsUsable}).`
          );
          return {
            kind: 'live',
            gameId: game.id,
            imageUrl: snapshotIsUsable ? exactWindowSource.thumbnail.toDataURL() : coverImage || undefined,
            posterKind: snapshotIsUsable ? 'snapshot' : coverImage ? 'cover' : undefined,
            sourceId: exactWindowSource.id,
            capturedWindowHandle: capturedHandle
          };
        }
        await logLine(
          'warn',
          `No exact desktop-capture source was published for ${game.title} (window ${gameWindow.handle}); using safe artwork while live discovery retries.`
        );
      } else if (!gameWindow) {
        await logLine('warn', `No visible tracked window was available to snapshot for ${game.title}; using safe artwork fallback.`);
      } else {
        await logLine(
          'warn',
          `Refused to snapshot mismatched or unsafe window ${gameWindow.handle} (${gameWindow.processName}) for ${game.title}; using safe artwork fallback.`
        );
      }
    } catch (error) {
      await logLine('warn', `Game-window snapshot failed for ${game.title}: ${String(error)}. Using safe artwork fallback.`);
    }
  }

  return coverImage
    ? { kind: 'cover', gameId: game.id, imageUrl: coverImage }
    : { kind: 'generated', gameId: game.id };
}

function clearGameplayQuickOverlayPreparation(overlay: BrowserWindow): void {
  gameplayQuickOverlayPreparedGameId = null;
  gameplayQuickOverlayPreparedBackdropKind = null;
  gameplayQuickOverlayRendererReady = false;
  if (!overlay.webContents.isDestroyed()) {
    overlay.webContents.send('quickOverlay:backdrop', { requestId: 0, kind: 'generated' } satisfies QuickOverlayBackdrop);
  }
}

function hideGameplayQuickOverlay(resetPreparation = false): void {
  gameplayQuickOverlayVisibilityGeneration += 1;
  gameplayQuickOverlayNativeZOrderVerified = false;
  if (pendingQuickOverlayPaint) {
    finishPendingQuickOverlayPaint(pendingQuickOverlayPaint.requestId, false);
  }
  const overlay = getLiveGameplayQuickOverlayWindow();
  if (!overlay) return;
  overlay.hide();
  overlay.setIgnoreMouseEvents(false);
  overlay.setAlwaysOnTop(false);
  if (resetPreparation) clearGameplayQuickOverlayPreparation(overlay);
}

function lowerGameplayQuickOverlayForResume(): void {
  gameplayQuickOverlayVisibilityGeneration += 1;
  gameplayQuickOverlayNativeZOrderVerified = false;
  if (pendingQuickOverlayPaint) {
    finishPendingQuickOverlayPaint(pendingQuickOverlayPaint.requestId, false);
  }
  const overlay = getLiveGameplayQuickOverlayWindow();
  if (!overlay) return;
  // Keep the already-painted transparent surface alive while Windows moves
  // foreground ownership back to the game. Hiding it first caused a black or
  // desktop flash whenever native focus took more than a frame.
  overlay.setIgnoreMouseEvents(true);
  overlay.setAlwaysOnTop(false);
  overlay.blur();
}

function browserWindowNativeHandle(window: BrowserWindow): number {
  const handle = window.getNativeWindowHandle();
  return handle.length >= 8 ? Number(handle.readBigUInt64LE(0)) : handle.readUInt32LE(0);
}

async function enforceGameplayQuickOverlayZOrder(overlay: BrowserWindow): Promise<boolean> {
  const gameWindow = await launcher.getQuickOverlayBackdropWindow();
  const overlayHandle = browserWindowNativeHandle(overlay);
  const state = await enforceQuickOverlayZOrder(overlayHandle, gameWindow?.handle);
  const verified = Boolean(
    state?.overlayVisible &&
    state.overlayTopMost &&
    state.overlayAboveGame &&
    state.overlayForeground
  );
  gameplayQuickOverlayNativeZOrderVerified = verified;
  await logLine(
    verified ? 'info' : 'warn',
    `Quick overlay native z-order ${verified ? 'verified' : 'failed'}: ` +
      `overlay=${overlayHandle}, game=${gameWindow?.handle ?? 0}, ` +
      `foreground=${state?.foregroundHandle ?? 0}, overlayVisible=${state?.overlayVisible ?? false}, ` +
      `overlayForeground=${state?.overlayForeground ?? false}, overlayTopMost=${state?.overlayTopMost ?? false}, ` +
      `overlayAboveGame=${state?.overlayAboveGame ?? false}, ` +
      `gameVisible=${state?.gameVisible ?? false}, gameTopMost=${state?.gameTopMost ?? false}.`
  );
  return verified;
}

async function createGameplayQuickOverlayWindow(): Promise<BrowserWindow> {
  const existing = getLiveGameplayQuickOverlayWindow();
  if (existing) {
    await gameplayQuickOverlayWindowReady;
    return existing;
  }

  const display = screen.getPrimaryDisplay();
  const overlay = new BrowserWindow({
    title: 'NXGS Play Quick Switcher',
    ...display.bounds,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    skipTaskbar: true,
    focusable: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  gameplayQuickOverlayWindow = overlay;
  overlay.setFocusable(true);
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.on('closed', () => {
    if (gameplayQuickOverlayWindow === overlay) {
      gameplayQuickOverlayWindow = null;
      gameplayQuickOverlayWindowReady = null;
    }
  });
  overlay.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      overlay.hide();
    }
  });
  gameplayQuickOverlayWindowReady = (async () => {
    if (process.env.VITE_DEV_SERVER_URL) {
      const url = new URL(process.env.VITE_DEV_SERVER_URL);
      url.searchParams.set('view', 'quick-overlay');
      await overlay.loadURL(url.toString());
    } else {
      await overlay.loadFile(join(__dirname, '../renderer/index.html'), {
        query: { view: 'quick-overlay' }
      });
    }

    await logLine('info', 'Preloaded the transparent quick-overlay renderer.');
  })();
  await gameplayQuickOverlayWindowReady;
  return overlay;
}

async function performGameplayQuickOverlayPreparation(gameId: string, captureSnapshot: boolean): Promise<void> {
  const overlay = await createGameplayQuickOverlayWindow();
  const preparationStartedAt = Date.now();
  const owner = getLiveMainWindow();
  const display = screen.getDisplayMatching(owner?.getBounds() ?? screen.getPrimaryDisplay().bounds);
  const currentBounds = overlay.getBounds();
  if (
    currentBounds.x !== display.bounds.x ||
    currentBounds.y !== display.bounds.y ||
    currentBounds.width !== display.bounds.width ||
    currentBounds.height !== display.bounds.height
  ) {
    overlay.setBounds(display.bounds);
  }
  if (launcher.activeState.game?.id !== gameId || overlay.isDestroyed()) return;

  const shouldStageHiddenRenderer =
    captureSnapshot &&
    !overlay.isVisible() &&
    ['launching', 'running', 'resuming'].includes(launcher.activeState.status);
  if (shouldStageHiddenRenderer) {
    // Chromium can defer video decoding in a never-shown transparent window.
    // Paint it inactive underneath the still-topmost game so the live stream is
    // already producing frames before Home needs to take foreground.
    overlay.setAlwaysOnTop(false);
    overlay.setIgnoreMouseEvents(true);
    overlay.showInactive();
  }

  const backdrop = await createSafeQuickOverlayBackdrop(captureSnapshot);
  if (launcher.activeState.game?.id !== gameId || overlay.isDestroyed()) return;
  let preparedKind = backdrop.kind;
  let requestId = ++gameplayQuickOverlayRequestId;
  let paintReady = waitForQuickOverlayPaint(requestId);
  overlay.webContents.send('activeGame:state', launcher.activeState);
  overlay.webContents.send('quickOverlay:backdrop', {
    ...backdrop,
    requestId
  } satisfies QuickOverlayBackdrop);
  let painted = await paintReady;
  if (launcher.activeState.game?.id !== gameId || overlay.isDestroyed()) return;

  if (!painted && backdrop.kind === 'live' && backdrop.posterKind === 'snapshot' && backdrop.imageUrl) {
    // Preserve the exact game-window frame ahead of cover art if the live
    // desktop stream itself cannot decode on this GPU.
    preparedKind = 'snapshot';
    requestId = ++gameplayQuickOverlayRequestId;
    paintReady = waitForQuickOverlayPaint(requestId);
    overlay.webContents.send('quickOverlay:backdrop', {
      requestId,
      gameId,
      kind: 'snapshot',
      imageUrl: backdrop.imageUrl,
      capturedWindowHandle: backdrop.capturedWindowHandle
    } satisfies QuickOverlayBackdrop);
    painted = await paintReady;
    if (launcher.activeState.game?.id !== gameId || overlay.isDestroyed()) return;
  }

  gameplayQuickOverlayPreparedGameId = gameId;
  gameplayQuickOverlayPreparedBackdropKind = preparedKind;
  gameplayQuickOverlayRendererReady = painted;
  if (launcher.activeState.status !== 'quickOverlayOpen') {
    overlay.hide();
  }
  await logLine(
    gameplayQuickOverlayRendererReady ? 'info' : 'warn',
    `Quick overlay renderer prepared in ${Date.now() - preparationStartedAt}ms ` +
      `(renderer ready: ${gameplayQuickOverlayRendererReady}; backdrop: ${preparedKind}).`
  );
}

async function prepareGameplayQuickOverlayRenderer(captureSnapshot = false): Promise<void> {
  const gameId = launcher.activeState.game?.id;
  if (!gameId) return;
  if (
    gameplayQuickOverlayPreparedGameId === gameId &&
    gameplayQuickOverlayRendererReady &&
    (!captureSnapshot || gameplayQuickOverlayPreparedBackdropKind === 'live')
  ) return;
  if (gameplayQuickOverlayPreparePromise) {
    await gameplayQuickOverlayPreparePromise;
    if (
      gameplayQuickOverlayPreparedGameId === gameId &&
      gameplayQuickOverlayRendererReady &&
      (!captureSnapshot || gameplayQuickOverlayPreparedBackdropKind === 'live')
    ) return;
  }

  const operation = performGameplayQuickOverlayPreparation(gameId, captureSnapshot);
  gameplayQuickOverlayPreparePromise = operation;
  try {
    await operation;
  } finally {
    if (gameplayQuickOverlayPreparePromise === operation) {
      gameplayQuickOverlayPreparePromise = null;
    }
  }
}

async function performGameplayQuickOverlayShow(): Promise<void> {
  const transitionStartedAt = Date.now();
  const overlay = await createGameplayQuickOverlayWindow();
  const gameId = launcher.activeState.game?.id ?? null;
  if (!gameplayQuickOverlayDesiredOpen) return;
  if (overlay.isVisible() && gameplayQuickOverlayPreparedGameId === gameId) {
    // A Store game can publish its real HWND shortly after Home was pressed.
    // Re-probe on the scheduled show reconciliations so a temporary cover
    // automatically upgrades to the exact live game source.
    await prepareGameplayQuickOverlayRenderer(true);
    if (!gameplayQuickOverlayDesiredOpen || overlay.isDestroyed()) return;
    overlay.webContents.send('activeGame:state', launcher.activeState);
    overlay.setIgnoreMouseEvents(false);
    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.moveTop();
    overlay.focus();
    overlay.webContents.focus();
    await enforceGameplayQuickOverlayZOrder(overlay);
    if (!gameplayQuickOverlayDesiredOpen || overlay.isDestroyed()) return;
    overlay.webContents.focus();
    return;
  }

  const visibilityGeneration = ++gameplayQuickOverlayVisibilityGeneration;
  await prepareGameplayQuickOverlayRenderer(true);
  if (
    gameplayQuickOverlayDesiredOpen &&
    visibilityGeneration === gameplayQuickOverlayVisibilityGeneration &&
    !overlay.isDestroyed() &&
    (!gameplayQuickOverlayRendererReady || gameplayQuickOverlayPreparedBackdropKind !== 'live')
  ) {
    // Re-probe once before showing artwork. A Store game's titled visual frame
    // often appears just after its provisional package shell.
    await new Promise((resolve) => setTimeout(resolve, 250));
    await prepareGameplayQuickOverlayRenderer(true);
  }
  if (
    gameplayQuickOverlayDesiredOpen &&
    visibilityGeneration === gameplayQuickOverlayVisibilityGeneration &&
    !overlay.isDestroyed() &&
    !gameplayQuickOverlayRendererReady
  ) {
    // A safe opaque poster is permitted only after live capture itself has
    // failed. Scheduled reconciliations continue upgrading it to live.
    await prepareGameplayQuickOverlayRenderer(false);
  }
  if (
    !gameplayQuickOverlayDesiredOpen ||
    visibilityGeneration !== gameplayQuickOverlayVisibilityGeneration ||
    overlay.isDestroyed()
  ) return;

  // The prewarm/hide path deliberately releases topmost. Reapply it on every
  // show before asking Windows for focus, otherwise the transparent renderer
  // is fully painted but remains hidden behind the topmost game window.
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(false);
  overlay.show();
  overlay.moveTop();
  overlay.focus();
  overlay.webContents.focus();
  await enforceGameplayQuickOverlayZOrder(overlay);
  if (!gameplayQuickOverlayDesiredOpen || overlay.isDestroyed()) return;
  overlay.webContents.focus();
  await logLine(
    gameplayQuickOverlayRendererReady ? 'info' : 'warn',
    `Quick overlay transition completed in ${Date.now() - transitionStartedAt}ms ` +
      `(reused prewarmed renderer: ${gameplayQuickOverlayRendererReady}; topmost restored: ${overlay.isAlwaysOnTop()}).`
  );
}

async function showGameplayQuickOverlay(): Promise<void> {
  // A hide can cancel an in-flight paint. If Home is pressed again before
  // that promise settles, immediately reconcile the newest intent instead of
  // losing the second show behind the stale promise.
  for (let attempt = 0; attempt < 2 && gameplayQuickOverlayDesiredOpen; attempt += 1) {
    if (gameplayQuickOverlayShowPromise) {
      await gameplayQuickOverlayShowPromise;
    } else {
      const operation = performGameplayQuickOverlayShow();
      gameplayQuickOverlayShowPromise = operation;
      try {
        await operation;
      } finally {
        if (gameplayQuickOverlayShowPromise === operation) {
          gameplayQuickOverlayShowPromise = null;
        }
      }
    }

    const overlay = getLiveGameplayQuickOverlayWindow();
    if (
      !gameplayQuickOverlayDesiredOpen ||
      (overlay?.isVisible() && overlay.isAlwaysOnTop() && gameplayQuickOverlayNativeZOrderVerified)
    ) return;
  }
}

function broadcastActiveGame(): void {
  sendToRenderer('activeGame:state', launcher.activeState);
  const overlay = getLiveGameplayQuickOverlayWindow();
  if (overlay && !overlay.webContents.isDestroyed()) {
    overlay.webContents.send('activeGame:state', launcher.activeState);
  }
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

async function showSessionWarning(stage: SessionWarningStage): Promise<void> {
  try {
    await launcher.pauseActiveGameForWarning();
  } catch (error) {
    void logLine('warn', `Could not send Escape for the ${stage} paid-session warning: ${String(error)}`);
  } finally {
    sessionWarningOverlay?.show(stage);
  }
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
  const overlay = getLiveGameplayQuickOverlayWindow();
  if (overlay && !overlay.webContents.isDestroyed()) {
    overlay.webContents.send('shell:home', event);
  }
}

async function transitionGameplayQuickOverlay(
  shouldOpen: boolean,
  reason: ShellHomeReason,
  gameId?: string
): Promise<GameControlResult> {
  const transitionGeneration = ++gameplayQuickOverlayTransitionGeneration;
  gameplayQuickOverlayDesiredOpen = shouldOpen;
  launcherQuickNavOpen = false;
  await logLine(
    'info',
    `Gameplay Home transition ${transitionGeneration} requested by ${reason}: ${shouldOpen ? 'show' : 'hide'}.`
  );

  if (shouldOpen) {
    const showOperation = showGameplayQuickOverlay();
    try {
      const result = await launcher.openQuickOverlay({ focusLauncher: false });
      await showOperation;
      if (
        transitionGeneration !== gameplayQuickOverlayTransitionGeneration ||
        !gameplayQuickOverlayDesiredOpen
      ) {
        return result;
      }
      for (const delayMs of [80, 240, 500]) {
        setTimeout(() => {
          if (
            transitionGeneration === gameplayQuickOverlayTransitionGeneration &&
            gameplayQuickOverlayDesiredOpen
          ) void showGameplayQuickOverlay();
        }, delayMs);
      }
      sendShellHome({
        reason,
        openActiveGamePanel: false,
        emergencyClose: reason === 'emergency-close',
        openQuickNav: false,
        resetToHome: false
      });
      if (!result.ok) {
        await logLine('warn', `Home overlay opened with a warning: ${result.error ?? 'unknown error'}`);
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await showOperation.catch(() => undefined);
      if (
        transitionGeneration === gameplayQuickOverlayTransitionGeneration &&
        gameplayQuickOverlayDesiredOpen
      ) {
        await showGameplayQuickOverlay();
      }
      await logLine('error', `Home overlay show failed: ${message}`);
      return { ok: false, error: message };
    }
  }

  lowerGameplayQuickOverlayForResume();
  try {
    const result = await launcher.resumeActiveGame(gameId);
    if (
      transitionGeneration !== gameplayQuickOverlayTransitionGeneration ||
      gameplayQuickOverlayDesiredOpen
    ) {
      // A native focus request cannot be interrupted once Windows is handling
      // it. If Home was pressed again while that request completed, reclaim
      // foreground for the already-painted overlay now so the game cannot
      // cover the navbar after the newer show transition.
      if (gameplayQuickOverlayDesiredOpen) {
        await showGameplayQuickOverlay();
      }
      return result;
    }

    sendShellHome({
      reason,
      openActiveGamePanel: false,
      emergencyClose: false,
      openQuickNav: false,
      resetToHome: false
    });
    if (result.ok) {
      hideGameplayQuickOverlay(true);
      return result;
    }

    gameplayQuickOverlayDesiredOpen = true;
    gameplayQuickOverlayTransitionGeneration += 1;
    await showGameplayQuickOverlay();
    await logLine('warn', `Home toggle could not return to the game: ${result.error ?? 'unknown error'}`);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      transitionGeneration === gameplayQuickOverlayTransitionGeneration &&
      !gameplayQuickOverlayDesiredOpen
    ) {
      gameplayQuickOverlayDesiredOpen = true;
      gameplayQuickOverlayTransitionGeneration += 1;
      await showGameplayQuickOverlay();
    }
    await logLine('error', `Home toggle resume failed: ${message}`);
    return { ok: false, error: message };
  }
}

function openHomeFromGame(reason: ShellHomeReason = 'system'): void {
  void logLine('info', `Shell home requested by ${reason}.`);
  const hasActiveGame = launcher.hasTrackedGames;
  const gameplayContext = ['launching', 'running', 'quickOverlayOpen', 'resuming'].includes(
    launcher.activeState.status
  );

  if (!hasActiveGame || !gameplayContext) {
    gameplayQuickOverlayDesiredOpen = false;
    gameplayQuickOverlayTransitionGeneration += 1;
    hideGameplayQuickOverlay();
    launcherQuickNavOpen = reason === 'emergency-close' ? true : !launcherQuickNavOpen;
    launcher.focusLauncher();
    applyKioskSettings(store.getSettings());
    sendShellHome({
      reason,
      openActiveGamePanel: false,
      emergencyClose: reason === 'emergency-close',
      openQuickNav: launcherQuickNavOpen,
      resetToHome: false
    });
    return;
  }

  // Home is a one-way request to reveal the gameplay overlay. Toggling from
  // an internal boolean allowed a stale "open" flag to route a real Home press
  // into resume/hide while Chrome or another app remained foreground. Esc,
  // Back, Resume Game, and renderer-request remain the only hide paths.
  void transitionGameplayQuickOverlay(true, reason).catch((error) => {
    void logLine('error', `Unhandled gameplay Home transition failure: ${String(error)}`);
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
    void showSessionWarning('two');
    void logLine('warn', `Paid play session has ${minutesRemaining} minutes remaining.`);
  },
  onExpired: () => {
    controllerIdleService?.paidSessionEnded();
    void showSessionWarning('final');
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
      const status = launcher.activeState.status;
      if (status === 'quickOverlayOpen') {
        gameplayQuickOverlayDesiredOpen = true;
        void showGameplayQuickOverlay();
      } else if (status === 'launching' && launcher.activeState.windowDetected) {
        void prepareGameplayQuickOverlayRenderer(true);
      } else if (status === 'closing') {
        if (gameplayQuickOverlayDesiredOpen) void showGameplayQuickOverlay();
      } else if (status === 'running') {
        if (gameplayQuickOverlayDesiredOpen) {
          void showGameplayQuickOverlay();
        } else {
          hideGameplayQuickOverlay();
        }
        void prepareGameplayQuickOverlayRenderer(true);
      } else if (status === 'minimizedToHome') {
        if (gameplayQuickOverlayDesiredOpen) {
          void showGameplayQuickOverlay();
        } else {
          hideGameplayQuickOverlay();
        }
      } else if (['idle', 'closed', 'error'].includes(status)) {
        gameplayQuickOverlayDesiredOpen = false;
        gameplayQuickOverlayTransitionGeneration += 1;
        if (status === 'closed') {
          launcher.focusLauncher();
          applyKioskSettings(store.getSettings());
        }
        hideGameplayQuickOverlay(true);
      }
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
    const endedAfterExpiry = sessionTimer.current.status === 'expired';
    hideGameplayQuickOverlay(true);
    launcherQuickNavOpen = false;
    await launcher.closeAllGames();
    sessionTimer.stop('idle');
    await store.finishActiveSession(endedAfterExpiry ? 'expired' : 'completed');
    clearPendingSessionExtension();
    sessionWarningOverlay?.close();
    controllerIdleService?.setGameplayActive(false);
    controllerCompatibility.stop();
    launcher.focusLauncher();
    applyKioskSettings(store.getSettings());
    sendShellHome({
      reason: 'system',
      openActiveGamePanel: false,
      emergencyClose: false,
      openQuickNav: false,
      resetToHome: true
    });
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
  const activeGameplayShouldOwnHome = launcher.hasTrackedGames &&
    ['launching', 'running', 'quickOverlayOpen', 'resuming'].includes(launcher.activeState.status);
  if (kioskInput.currentMode === 'admin' && !activeGameplayShouldOwnHome) {
    launcherQuickNavOpen = reason === 'second-instance' ? false : !launcherQuickNavOpen;
    applyKioskSettings(store.getSettings());
    sendShellHome({
      reason,
      openActiveGamePanel: false,
      emergencyClose: false,
      preserveAdminWindow: true,
      openQuickNav: launcherQuickNavOpen,
      resetToHome: false
    });
    void logLine('info', `Handled ${reason} inside windowed Admin mode without changing presentation mode.`);
    return;
  }

  if (kioskInput.currentMode === 'admin') {
    void logLine('info', `Routing ${reason} to the gameplay quick overlay because an active game takes priority over Admin mode.`);
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

function syncTaskbarForWindowPresentation(reason: string): void {
  const window = getLiveMainWindow();
  const shouldHide = Boolean(
    kioskInput.currentMode === 'customer' &&
    window &&
    window.isVisible() &&
    !window.isMinimized() &&
    window.isFullScreen()
  );
  setKioskTaskbarHidden(shouldHide, reason);
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
  syncTaskbarForWindowPresentation('customer fullscreen');
}

function prepareForQuit(): void {
  isQuitting = true;
  gameplayQuickOverlayWindow?.destroy();
  gameplayQuickOverlayWindow = null;
  clearPendingSessionExtension();
  sessionTimer.stop('idle', false);
  sessionCountdownOverlay.close();
  sessionWarningOverlay?.close();
  controllerCompatibility.stop();
  controllerIdleService?.stop();
  controllerIdleService = null;
  kioskInput.unregisterAll();
  stopWindowsControlWorker();
  taskbarHiddenByKiosk = false;
  restoreWindowsTaskbarSync();
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

  mainWindow.on('minimize', () => {
    setKioskTaskbarHidden(false, 'launcher minimized');
  });
  mainWindow.on('hide', () => {
    setKioskTaskbarHidden(false, 'launcher hidden');
  });
  mainWindow.on('restore', () => {
    syncTaskbarForWindowPresentation('launcher restored');
  });
  mainWindow.on('show', () => {
    syncTaskbarForWindowPresentation('launcher shown');
  });
  mainWindow.on('enter-full-screen', () => {
    syncTaskbarForWindowPresentation('launcher entered fullscreen');
  });
  mainWindow.on('leave-full-screen', () => {
    setKioskTaskbarHidden(false, 'launcher left fullscreen');
  });

  mainWindow.on('blur', () => {
    // Launch, resume, and close handoffs intentionally move focus between NXGS and
    // the selected game window. They are trusted launcher actions, not attempts to
    // escape customer mode, so the blur guard must not request an Admin PIN.
    const gameShouldOwnForeground = ['launching', 'running', 'quickOverlayOpen', 'resuming', 'closing'].includes(
      launcher.activeState.status
    ) || Boolean(getLiveGameplayQuickOverlayWindow()?.isVisible());
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
    currentDevice: store.getCurrentDevice(),
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

  ipcMain.on('quickOverlay:backdropReady', (event, requestId: number) => {
    const overlay = getLiveGameplayQuickOverlayWindow();
    if (!overlay || event.sender !== overlay.webContents || !Number.isInteger(requestId)) return;
    finishPendingQuickOverlayPaint(requestId, true);
  });

  ipcMain.on('quickOverlay:backdropFailed', (event, requestId: number, reason: string) => {
    const overlay = getLiveGameplayQuickOverlayWindow();
    if (!overlay || event.sender !== overlay.webContents || !Number.isInteger(requestId)) return;
    void logLine('warn', `Quick overlay live capture ${requestId} failed before first frame: ${reason || 'unknown error'}.`);
    finishPendingQuickOverlayPaint(requestId, false);
  });

  ipcMain.handle('shell:dismissQuickOverlay', async (): Promise<GameControlResult> => {
    launcherQuickNavOpen = false;
    if (
      Boolean(getLiveGameplayQuickOverlayWindow()?.isVisible()) ||
      launcher.activeState.status === 'quickOverlayOpen'
    ) {
      return transitionGameplayQuickOverlay(false, 'renderer-request');
    }
    sendShellHome({
      reason: 'renderer-request',
      openActiveGamePanel: false,
      emergencyClose: false,
      openQuickNav: false,
      resetToHome: false
    });
    return { ok: true };
  });

  ipcMain.handle('auth:verifyPin', (_event, pin: string) => ({ ok: store.verifyPin(pin) }));

  ipcMain.handle('device:getCurrent', () => store.getDeviceManagerSummary());
  ipcMain.handle('device:updateCurrent', async (_event, input: DeviceInput) => store.updateCurrentDevice(input));

  ipcMain.handle('games:save', async (_event, input: GameInput) => {
    const saved = await store.saveGame(input);
    return { game: saved, games: store.listGames() };
  });

  ipcMain.handle('games:delete', async (_event, id: string) => {
    await store.deleteGame(id);
    return { games: store.listGames() };
  });

  ipcMain.handle('games:scanInstalled', async () => scanInstalledGames());

  ipcMain.handle('plans:list', () => store.listPlans());
  ipcMain.handle('plans:save', async (_event, input: PlayPlanInput) => {
    const plan = await store.savePlan(input);
    return { plan, plans: store.listPlans() };
  });
  ipcMain.handle('plans:delete', async (_event, id: string) => {
    await store.deletePlan(id);
    return { plans: store.listPlans() };
  });
  ipcMain.handle('plans:setEnabled', async (_event, id: string, enabled: boolean) => {
    const plan = await store.setPlanEnabled(id, enabled);
    return { plan, plans: store.listPlans() };
  });
  ipcMain.handle('plans:reorder', async (_event, orderedIds: string[]) => ({
    plans: await store.reorderPlans(orderedIds)
  }));

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

  ipcMain.handle('dialog:selectBrandLogo', async (): Promise<FilePickerResult> => {
    const result = await showOpenDialog({
      title: 'Select NXGS Logo',
      properties: ['openFile'],
      filters: [{ name: 'Logo image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    const selected = validatePickedPath(result.filePaths[0], ['.png', '.jpg', '.jpeg', '.webp']);
    if (selected.canceled || selected.error || !selected.path) {
      return selected;
    }

    try {
      const brandingDirectory = join(app.getPath('userData'), 'branding');
      const storedPath = join(brandingDirectory, `nxgs-logo${extname(selected.path).toLowerCase()}`);
      await mkdir(brandingDirectory, { recursive: true });
      await copyFile(selected.path, storedPath);
      return {
        canceled: false,
        path: storedPath,
        fileName: basename(storedPath),
        directory: brandingDirectory
      };
    } catch (error) {
      return { canceled: false, error: error instanceof Error ? error.message : String(error) };
    }
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
    const extending = sessionTimer.active || sessionTimer.current.status === 'expired';
    const state = extending
      ? sessionTimer.extend(result.entitlement.durationMinutes)
      : sessionTimer.start(result.entitlement.durationMinutes);
    if (state.expiresAt) {
      await store.recordPaidSession(result.entitlement, state.expiresAt, extending);
    }
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
      if (requiresPaymentForLaunch(store.getSettings(), sessionTimer.current)) {
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
    const resume = transitionGameplayQuickOverlay(false, 'renderer-request', gameId);
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
    gameplayQuickOverlayDesiredOpen = false;
    gameplayQuickOverlayTransitionGeneration += 1;
    hideGameplayQuickOverlay();
    const result = await launcher.minimizeActiveGame();
    if (result.ok) {
      controllerCompatibility.stop();
      applyKioskSettings(store.getSettings());
    }
    return result;
  });

  ipcMain.handle('game:goToLauncherHome', async (): Promise<GameControlResult> => {
    gameplayQuickOverlayDesiredOpen = false;
    gameplayQuickOverlayTransitionGeneration += 1;
    hideGameplayQuickOverlay();
    launcherQuickNavOpen = false;
    const result = await launcher.returnToHome();
    if (result.ok) {
      controllerCompatibility.stop();
      applyKioskSettings(store.getSettings());
    }
    return result;
  });

  ipcMain.handle('game:closeActive', async (_event, gameId?: string): Promise<GameControlResult> => {
    const keepQuickOverlayVisible = Boolean(getLiveGameplayQuickOverlayWindow()?.isVisible());
    if (keepQuickOverlayVisible) gameplayQuickOverlayDesiredOpen = true;
    try {
      await launcher.closeActiveGame(false, { gameId, focusLauncher: !keepQuickOverlayVisible });
      if (keepQuickOverlayVisible) {
        await showGameplayQuickOverlay();
      } else {
        launcher.focusLauncher();
        applyKioskSettings(store.getSettings());
      }
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
    void createGameplayQuickOverlayWindow().catch((error) => {
      void logLine('warn', `Could not prewarm the gameplay quick overlay: ${String(error)}`);
    });
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
