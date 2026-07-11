import { BrowserWindow, screen, shell } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  ActiveGameState,
  ActiveGameStatus,
  ActiveGameWindowState,
  AppDiagnostics,
  GameControlResult,
  GameLaunchMode,
  GameRecord,
  TrackedGameSessionState
} from '../shared/types';
import { logLine } from './logger';
import { closeProcessByName, closeProcessByPid, isProcessRunning, isProcessRunningByPid } from './windowsProcess';
import {
  activateGameWindow,
  closeGameWindow,
  findGameWindow,
  getGameWindowActivationState,
  isGameWindowVisible,
  keepGameWindowOnTop,
  type GameWindowActivationState,
  type GameWindowInfo,
  minimizeGameWindow,
  prepareGameWindowForReveal,
  releaseGameWindowTopMost,
  resumeGameWindowFast,
  setWindowsTaskbarVisible,
  waitForGameWindow
} from './windowManagerService';

type LauncherEvents = {
  onGameExited: (game: GameRecord) => void;
  onError: (message: string) => void;
  onActiveGameChanged: (state: ActiveGameState) => void;
};

type StoredGameSession = {
  game: GameRecord;
  child: ChildProcessWithoutNullStreams | null;
  window: GameWindowInfo | null;
  processId: number | null;
  status: ActiveGameStatus;
  message?: string;
  windowDetected: boolean;
  windowState: ActiveGameWindowState;
  updatedAt: string;
};

function splitArgs(raw: string): string[] {
  const args: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    args.push(match[1] ?? match[2] ?? match[3]);
  }
  return args;
}

class FocusOperationCanceledError extends Error {
  constructor() {
    super('Game focus operation was canceled because NXGS Home was opened.');
    this.name = 'FocusOperationCanceledError';
  }
}

export class GameLauncher {
  private readonly sessions = new Map<string, StoredGameSession>();
  private activeGame: GameRecord | null = null;
  private child: ChildProcessWithoutNullStreams | null = null;
  private monitor: NodeJS.Timeout | null = null;
  private reinforceTimers: NodeJS.Timeout[] = [];
  private activeWindow: GameWindowInfo | null = null;
  private activeProcessId: number | null = null;
  private gameInForeground = false;
  private taskbarSuppressed = false;
  private lastHandoffError: string | undefined;
  private lastHomeResult: string | undefined;
  private lastResumeResult: string | undefined;
  private focusGeneration = 0;
  private operationInFlight: 'launch' | 'home' | 'resume' | 'minimize' | 'close' | null = null;
  private closeFallbackStatus: 'quickOverlayOpen' | 'minimizedToHome' = 'minimizedToHome';
  private state: ActiveGameState = {
    status: 'idle',
    updatedAt: new Date().toISOString()
  };

  constructor(
    private readonly windowProvider: () => BrowserWindow | null,
    private readonly events: LauncherEvents
  ) {}

  get active(): GameRecord | null {
    return this.activeGame;
  }

  get activeState(): ActiveGameState {
    return this.withTrackedSessions(this.state);
  }

  get hasTrackedGames(): boolean {
    return this.sessions.size > 0 || Boolean(this.activeGame);
  }

  get taskbarHidden(): boolean {
    return this.taskbarSuppressed;
  }

  get diagnosticState(): AppDiagnostics['activeGame'] {
    return {
      title: this.activeGame?.title,
      processId: this.activeProcessId ?? undefined,
      windowHandle: this.activeWindow?.handle,
      windowDetected: Boolean(this.activeWindow),
      status: this.state.status,
      windowState: this.state.windowState,
      lastError: this.lastHandoffError,
      lastHomeResult: this.lastHomeResult,
      lastResumeResult: this.lastResumeResult
    };
  }

  async launch(game: GameRecord): Promise<void> {
    if (process.platform !== 'win32') {
      throw new Error('NXGS Play game launching is only supported on Windows.');
    }

    if (this.operationInFlight) {
      throw new Error(`Game action already in progress: ${this.operationInFlight}.`);
    }

    this.operationInFlight = 'launch';
    let focusGeneration: number | null = null;
    try {
      if (!game.enabled) {
        throw new Error(`${game.title} is disabled.`);
      }
      if (!game.launchCommand.trim()) {
        throw new Error(`${game.title} does not have a launch command.`);
      }

      this.storeCurrentSession();
      await this.stopMonitoring(false);
      this.sessions.delete(game.id);
      this.activeGame = game;
      this.activeWindow = null;
      this.activeProcessId = null;
      this.gameInForeground = false;
      this.lastHandoffError = undefined;
      this.clearReinforcementTimers();
      this.setActiveState({
        status: 'launching',
        game,
        message: `Preparing ${game.title} for full-screen launch...`,
        windowDetected: false,
        windowState: 'unknown'
      });
      focusGeneration = this.beginFocusOperation('launch', game);
      await this.suppressWindowsTaskbar();
      this.assertFocusOperationCurrent(focusGeneration, game);
      this.showLaunchShield();
      await logLine('info', `Launch clicked for ${game.title}. Launching ${game.launchType}: ${game.launchCommand}`);

      if (game.launchType === 'localExe') {
        await this.launchExecutable(game);
      } else if (game.launchType === 'steam' || game.launchType === 'epic') {
        await shell.openExternal(game.launchCommand);
        this.monitorByProcessName(game);
      } else if (game.launchType === 'microsoftStore') {
        await this.launchMicrosoftStoreApp(game);
      } else {
        await this.launchCustomCommand(game);
      }

      await logLine(
        'info',
        `${game.title} launch command accepted${this.activeProcessId ? ` (process ${this.activeProcessId})` : ''}. Waiting for its first visible window.`
      );

      await this.activateLaunchedGame(game, focusGeneration);
    } catch (error) {
      if (
        error instanceof FocusOperationCanceledError ||
        (focusGeneration !== null && !this.isFocusOperationCurrent(focusGeneration, game))
      ) {
        await logLine('info', `Launch handoff canceled for ${game.title}; NXGS Home remains open.`);
        return;
      }
      this.lastHandoffError = error instanceof Error ? error.message : String(error);
      this.releaseLaunchShield();
      this.focusLauncher();
      this.setActiveState({
        status: 'error',
        game,
        message: error instanceof Error ? error.message : String(error),
        windowDetected: Boolean(this.activeWindow),
        windowState: this.activeWindow ? 'background' : 'unknown'
      });
      throw error;
    } finally {
      if (this.operationInFlight === 'launch') {
        this.operationInFlight = null;
      }
    }
  }

  async closeActiveGame(
    force: boolean,
    options: { retireActiveSession?: boolean; gameId?: string } = {}
  ): Promise<void> {
    if (this.operationInFlight) {
      await logLine('info', `Ignoring close request while ${this.operationInFlight} is in progress.`);
      return;
    }

    if (options.gameId && !this.selectTrackedSession(options.gameId)) {
      await logLine('warn', `Close requested for unknown tracked game ${options.gameId}.`);
      return;
    }

    const game = this.activeGame;
    if (!game) {
      return;
    }

    this.closeFallbackStatus = this.state.status === 'quickOverlayOpen' ? 'quickOverlayOpen' : 'minimizedToHome';
    this.operationInFlight = 'close';
    const retireActiveSession = options.retireActiveSession ?? force;
    await logLine('info', `${force ? 'Force closing' : 'Closing'} ${game.title}`);
    try {
      this.setActiveState({
        status: 'closing',
        game,
        message: `Closing ${game.title}...`,
        windowDetected: Boolean(this.activeWindow),
        windowState: this.state.windowState
      });
      const errors: string[] = [];

      if (!force && this.activeWindow) {
        try {
          await closeGameWindow(this.activeWindow);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }

      if (force && this.child?.pid) {
        try {
          await closeProcessByPid(this.child.pid, force);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }

      if (force && this.activeProcessId) {
        try {
          await closeProcessByPid(this.activeProcessId, true);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }

      if (game.processName && (force || !this.activeWindow)) {
        try {
          await closeProcessByName(game.processName, force);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }

      if (game.launchType === 'microsoftStore' && !game.processName?.trim() && !this.activeWindow) {
        try {
          await closeProcessByName(game.title, force);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }

      if (errors.length > 0) {
        await logLine('warn', `Close game errors for ${game.title}: ${errors.join(' | ')}`);
      }

      if (retireActiveSession) {
        this.finishActiveGameSession(game, `${game.title} close requested.`, false);
      } else if (!force) {
        setTimeout(() => {
          void this.checkGracefulCloseResult(game);
        }, 2500);
      }
    } finally {
      if (this.operationInFlight === 'close') {
        this.operationInFlight = null;
      }
    }
  }

  async resumeActiveGame(gameId?: string): Promise<GameControlResult> {
    if (this.operationInFlight) {
      await logLine('info', `Ignoring resume request while ${this.operationInFlight} is in progress.`);
      return { ok: false, error: `Another game action is already in progress: ${this.operationInFlight}.` };
    }

    if (gameId && !this.selectTrackedSession(gameId)) {
      return { ok: false, error: 'That game is no longer available in the switcher.' };
    }

    const game = this.activeGame;
    if (!game) {
      return { ok: false, error: 'No game is currently running.' };
    }

    this.operationInFlight = 'resume';
    await logLine('info', `Resume clicked for ${game.title}. Rediscovering the active game window.`);
    this.setActiveState({
      status: 'resuming',
      game,
      message: `Resuming ${game.title}...`,
      windowDetected: Boolean(this.activeWindow),
      windowState: this.activeWindow ? 'background' : 'unknown'
    });
    const focusGeneration = this.beginFocusOperation('resume', game);

    try {
      let window = this.activeWindow ?? (await this.getActiveWindow(game));
      this.assertFocusOperationCurrent(focusGeneration, game);
      const untrackedStoreApp = game.launchType === 'microsoftStore' && !game.processName?.trim();
      if (!window && untrackedStoreApp) {
        await logLine('info', `Retrying Microsoft Store activation and window discovery for ${game.title}.`);
        const explorer = spawn('explorer.exe', [`shell:AppsFolder\\${game.launchCommand.trim()}`], {
          detached: true,
          windowsHide: false,
          stdio: 'ignore'
        });
        explorer.unref();
        window = await waitForGameWindow(
          { titleHint: game.title, allowUntitledStoreFrame: true },
          9000,
          150,
          350,
          () => this.isFocusOperationCurrent(focusGeneration, game)
        );
        this.assertFocusOperationCurrent(focusGeneration, game);
        if (window) {
          this.activeWindow = window;
          this.activeProcessId = window.processId;
          await logLine('info', `Retry found ${game.title} window ${window.handle} for process ${window.processId}.`);
        }
      }
      if (!window) {
        const stillRunning = await this.isGameStillRunning(game);
        if (!stillRunning && !untrackedStoreApp) {
          const message = `${game.title} is no longer running.`;
          await logLine('info', `Resume requested for ${game.title}, but the game is no longer running.`);
          this.finishActiveGameSession(game, message);
          this.lastResumeResult = message;
          return { ok: false, error: message };
        }

        const message = untrackedStoreApp
          ? `NXGS retried ${game.title} for several seconds, but Windows has not exposed its window yet. The game remains in the switcher; try Resume Game again.`
          : 'NXGS Play could not find the running game window. The switcher will stay open so you can retry.';
        await logLine('warn', `Resume requested for ${game.title}, but no game window was found.`);
        this.setActiveState({
          status: 'quickOverlayOpen',
          game,
          message,
          windowDetected: false,
          windowState: 'unknown'
        });
        this.lastResumeResult = message;
        return { ok: false, error: message };
      }

      await this.suppressWindowsTaskbar();
      this.assertFocusOperationCurrent(focusGeneration, game);
      const focusedWindow = await this.handOffToGameWindow(
        game,
        window,
        this.launchMode(game),
        'resume',
        focusGeneration
      );
      this.assertFocusOperationCurrent(focusGeneration, game);
      this.activeWindow = focusedWindow;
      this.activeProcessId = focusedWindow.processId;
      this.gameInForeground = true;
      this.monitorByProcessName(game);
      this.setActiveState({
        status: 'running',
        game,
        message: `${game.title} is running.`,
        windowDetected: true,
        windowState: 'foreground'
      });
      this.scheduleGamePresentationReinforcement(game, focusedWindow, this.launchMode(game));
      this.lastHandoffError = undefined;
      this.lastResumeResult = `${game.title} restored and focused.`;
      await logLine('info', `Resume succeeded for ${game.title}; game window is foreground over the NXGS shell cover.`);
      return { ok: true };
    } catch (error) {
      if (error instanceof FocusOperationCanceledError || !this.isFocusOperationCurrent(focusGeneration, game)) {
        const message = `Resume canceled because NXGS Home was opened.`;
        this.lastResumeResult = message;
        await logLine('info', `${message} ${game.title} was not refocused.`);
        return { ok: false, error: message };
      }
      const message = error instanceof Error ? error.message : String(error);
      this.lastHandoffError = message;
      this.lastResumeResult = message;
      await logLine('warn', `Native resume failed for ${game.title}: ${message}`);
      this.focusLauncher();
      this.setActiveState({
        status: 'quickOverlayOpen',
        game,
        message,
        windowDetected: Boolean(this.activeWindow),
        windowState: this.activeWindow ? 'background' : 'unknown'
      });
      return { ok: false, error: message };
    } finally {
      if (this.operationInFlight === 'resume') {
        this.operationInFlight = null;
      }
    }
  }

  async minimizeActiveGame(): Promise<GameControlResult> {
    if (this.operationInFlight) {
      await logLine('info', `Ignoring minimize request while ${this.operationInFlight} is in progress.`);
      return { ok: false, error: `Another game action is already in progress: ${this.operationInFlight}.` };
    }

    const game = this.activeGame;
    if (!game) {
      return { ok: false, error: 'No game is currently running.' };
    }

    this.operationInFlight = 'minimize';
    try {
      const window = this.activeWindow ?? (await this.getActiveWindow(game));
      if (!window) {
        const message = `${game.title} remains active, but Windows did not expose a controllable window. Returning to Launcher Home.`;
        this.gameInForeground = false;
        this.clearReinforcementTimers();
        this.focusLauncher();
        this.setActiveState({
          status: 'minimizedToHome',
          game,
          message,
          windowDetected: false,
          windowState: 'unknown'
        });
        await logLine('info', `Home retained ${game.title} without a controllable window.`);
        return { ok: true };
      }

      await minimizeGameWindow(window);
      if (this.operationInFlight !== 'minimize') {
        await logLine('info', `Minimize result for ${game.title} was superseded by Home.`);
        return { ok: true };
      }
      this.gameInForeground = false;
      this.activeWindow = window;
      this.activeProcessId = window.processId;
      this.clearReinforcementTimers();
      this.focusLauncher();
      this.setActiveState({
        status: 'minimizedToHome',
        game,
        message: `${game.title} is minimized.`,
        windowDetected: true,
        windowState: 'minimized'
      });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logLine('warn', `Minimize failed for ${game.title}: ${message}`);
      return { ok: false, error: message };
    } finally {
      if (this.operationInFlight === 'minimize') {
        this.operationInFlight = null;
      }
    }
  }

  async openQuickOverlay(): Promise<GameControlResult> {
    if (this.operationInFlight === 'home') {
      this.focusLauncher();
      return { ok: true };
    }

    if (this.state.status === 'quickOverlayOpen') {
      this.lastHomeResult = 'NXGS quick overlay was already open and was refocused.';
      this.focusLauncher();
      return { ok: true };
    }

    const canceledOperation = this.operationInFlight;
    const stateBeforeHome = this.state.status;
    this.cancelFocusOperations(`Home requested from ${stateBeforeHome}`);
    this.operationInFlight = 'home';
    const game = this.activeGame;
    this.lastHomeResult = `Quick overlay started from ${stateBeforeHome}.`;
    await logLine('info', `Quick Home pressed. State before overlay: ${stateBeforeHome}.`);
    if (canceledOperation === 'launch' || canceledOperation === 'resume') {
      await logLine('info', `Canceled pending ${canceledOperation} focus loop before opening Home.`);
    }

    try {
      this.gameInForeground = false;
      this.clearReinforcementTimers();
      if (game) {
        this.setActiveState({
          status: 'quickOverlayOpen',
          game,
          message: `${game.title} is still running behind the NXGS quick overlay.`,
          windowDetected: Boolean(this.activeWindow),
          windowState: this.activeWindow ? 'background' : 'unknown'
        });
      }
      // Raise NXGS before any native window lookup so Home always gives immediate visible feedback.
      this.focusLauncher();
      if (game) {
        const homeGeneration = this.focusGeneration;
        void this.releaseGameWindowsForQuickOverlay(game, homeGeneration);
      }
      this.lastHomeResult = game
        ? `${game.title} remains running; NXGS quick overlay restored and focused.`
        : 'NXGS launcher restored; no active game was found.';
      await logLine('info', this.lastHomeResult);
      return { ok: true };
    } finally {
      if (this.operationInFlight === 'home') {
        this.operationInFlight = null;
      }
    }
  }

  private async releaseGameWindowsForQuickOverlay(game: GameRecord, homeGeneration: number): Promise<void> {
    try {
      const trackedWindow = this.activeWindow ?? (await this.getActiveWindow(game));
      if (this.focusGeneration !== homeGeneration || this.state.status !== 'quickOverlayOpen') {
        return;
      }
      const refreshedWindow = await findGameWindow({
        pid: game.processName?.trim() ? this.activeProcessId ?? this.child?.pid : undefined,
        processName: game.processName,
        titleHint: game.title,
        allowUntitledStoreFrame: game.launchType === 'microsoftStore' && !game.processName?.trim()
      });
      const windows = [trackedWindow, refreshedWindow].filter(
        (candidate, index, candidates): candidate is GameWindowInfo =>
          Boolean(candidate) && candidates.findIndex((other) => other?.handle === candidate?.handle) === index
      );
      for (const window of windows) {
        if (this.focusGeneration !== homeGeneration || this.state.status !== 'quickOverlayOpen') {
          return;
        }
        await releaseGameWindowTopMost(window);
        await logLine('info', `Released topmost lock for quick overlay: ${game.title}, window ${window.handle}.`);
      }
      const currentWindow = refreshedWindow ?? trackedWindow;
      if (currentWindow) {
        this.activeWindow = currentWindow;
        this.activeProcessId = currentWindow.processId;
      }
      if (this.focusGeneration === homeGeneration && this.state.status === 'quickOverlayOpen') {
        // Raise it again after releasing every game HWND in case Windows reordered the topmost band.
        this.focusLauncher();
      }
    } catch (error) {
      await logLine('warn', `Return home window lookup failed for ${game.title}: ${String(error)}`);
      this.lastHandoffError = error instanceof Error ? error.message : String(error);
    }
  }

  async returnToHome(): Promise<GameControlResult> {
    if (!this.activeGame) {
      this.focusLauncher();
      return { ok: true };
    }
    return this.minimizeActiveGame();
  }

  async clearActive(): Promise<void> {
    await this.stopMonitoring(false);
    this.sessions.clear();
    this.activeGame = null;
    this.child = null;
    this.activeWindow = null;
    this.activeProcessId = null;
    this.gameInForeground = false;
    this.lastHandoffError = undefined;
    this.clearReinforcementTimers();
    this.setActiveState({
      status: 'idle'
    });
  }

  focusLauncher(): void {
    const window = this.windowProvider();
    if (!window || window.isDestroyed()) {
      return;
    }
    if (window.isMinimized()) {
      window.restore();
    }
    const display = screen.getDisplayMatching(window.getBounds());
    window.setBounds(display.bounds);
    window.setFullScreen(true);
    window.setMenuBarVisibility(false);
    window.show();
    window.setAlwaysOnTop(true, 'screen-saver');
    window.moveTop();
    window.focus();
    void logLine('info', 'NXGS Play restored fullscreen and focused for Home.');
  }

  restoreTaskbarForAdmin(): void {
    this.restoreWindowsTaskbar();
  }

  private async activateLaunchedGame(game: GameRecord, focusGeneration: number): Promise<void> {
    const window = await waitForGameWindow(
      {
        pid: this.child?.pid,
        processName: game.processName,
        titleHint: game.title,
        allowUntitledStoreFrame: game.launchType === 'microsoftStore' && !game.processName?.trim()
      },
      12000,
      125,
      250,
      () => this.isFocusOperationCurrent(focusGeneration, game)
    );

    if (!this.isFocusOperationCurrent(focusGeneration, game)) {
      await logLine('info', `Launch polling stopped for ${game.title} because NXGS Home was opened.`);
      return;
    }

    if (!window) {
      const storeLaunchMayStillBePending = game.launchType === 'microsoftStore' && !game.processName?.trim();
      if (!(await this.isGameStillRunning(game)) && !storeLaunchMayStillBePending) {
        await logLine('info', `${game.title} exited before a controllable game window was detected.`);
        this.finishActiveGameSession(game, `${game.title} exited.`);
        return;
      }

      const message = storeLaunchMayStillBePending
        ? `${game.title} is still starting. Choose Resume Game once its window appears.`
        : `${game.title} started but the window could not be focused. Try Focus Game Again, Return Home, or Close Game.`;
      this.lastHandoffError = message;
      await logLine(
        'warn',
        `Window detection timed out for ${game.title}; retaining the active session and keeping NXGS Play visible.`
      );
      this.releaseLaunchShield();
      this.focusLauncher();
      this.setActiveState({
        status: 'quickOverlayOpen',
        game,
        message,
        windowDetected: false,
        windowState: 'unknown'
      });
      return;
    }

    await logLine('info', `First game window detected for ${game.title}: handle ${window.handle}, process ${window.processId}.`);
    this.activeWindow = window;
    this.activeProcessId = window.processId;
    this.monitorByProcessName(game);

    const launchMode = this.launchMode(game);
    if (launchMode === 'fullscreen' || launchMode === 'borderlessPreferred') {
      await logLine(
        'info',
        `${game.title} requested ${launchMode}; NXGS Play will attempt a native borderless fullscreen window.`
      );
    }

    try {
      const focusedWindow = await this.handOffToGameWindow(game, window, launchMode, 'launch', focusGeneration);
      this.activeWindow = focusedWindow;
      this.activeProcessId = focusedWindow.processId;
    } catch (error) {
      if (error instanceof FocusOperationCanceledError || !this.isFocusOperationCurrent(focusGeneration, game)) {
        await logLine('info', `Launch handoff stopped for ${game.title}; Home owns foreground.`);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.lastHandoffError = message;
      const currentWindow = await this.getActiveWindow(game);
      if (!currentWindow && !(await this.isGameStillRunning(game))) {
        await logLine('info', `${game.title} closed before foreground activation completed.`);
        this.handleGameExit(game);
        return;
      }

      await logLine('warn', `Launch handoff failed for ${game.title}: ${message}. Keeping NXGS Play visible.`);
      this.focusLauncher();
      this.setActiveState({
        status: 'quickOverlayOpen',
        game,
        message: `${game.title} started but NXGS Play could not focus its window. Try Focus Game Again.`,
        windowDetected: Boolean(currentWindow),
        windowState: currentWindow ? 'background' : 'unknown'
      });
      return;
    }
    this.assertFocusOperationCurrent(focusGeneration, game);
    this.gameInForeground = true;
    this.setActiveState({
      status: 'running',
      game,
      message: `${game.title} is running.`,
      windowDetected: true,
      windowState: 'foreground'
    });
    this.scheduleGamePresentationReinforcement(game, this.activeWindow ?? window, launchMode);
    this.lastHandoffError = undefined;
    await logLine('info', `Game window focused for ${game.title}; NXGS Play handoff completed.`);
  }

  private async launchExecutable(game: GameRecord): Promise<void> {
    if (!existsSync(game.launchCommand)) {
      throw new Error(`Executable not found: ${game.launchCommand}`);
    }

    if (game.workingDirectory && !existsSync(game.workingDirectory)) {
      throw new Error(`Working directory not found: ${game.workingDirectory}`);
    }

    const cwd = game.workingDirectory || dirname(game.launchCommand);
    const args = splitArgs(game.launchArguments);
    this.child = spawn(game.launchCommand, args, {
      cwd,
      detached: false,
      windowsHide: false
    });
    this.activeProcessId = this.child.pid ?? null;

    this.child.once('error', async (error) => {
      await logLine('error', `Launch failed for ${game.title}: ${error.message}`);
      this.events.onError(error.message);
    });
    this.child.once('close', () => {
      if (game.processName) {
        void isProcessRunning(game.processName).then((running) => {
          if (!running) {
            this.handleGameExit(game);
          }
        });
        return;
      }
      this.handleGameExit(game);
    });

    this.monitorByProcessName(game);
  }

  private async launchCustomCommand(game: GameRecord): Promise<void> {
    if (game.workingDirectory && !existsSync(game.workingDirectory)) {
      throw new Error(`Working directory not found: ${game.workingDirectory}`);
    }

    const command = [game.launchCommand, game.launchArguments].filter(Boolean).join(' ');
    this.child = spawn('cmd.exe', ['/d', '/s', '/c', command], {
      cwd: game.workingDirectory || undefined,
      detached: false,
      windowsHide: false
    });
    this.activeProcessId = this.child.pid ?? null;

    this.child.once('error', async (error) => {
      await logLine('error', `Custom command failed for ${game.title}: ${error.message}`);
      this.events.onError(error.message);
    });
    this.child.once('close', () => {
      if (!game.processName) {
        this.handleGameExit(game);
      }
    });

    this.monitorByProcessName(game);
  }

  private async launchMicrosoftStoreApp(game: GameRecord): Promise<void> {
    const appUserModelId = game.launchCommand.trim();
    if (!appUserModelId) {
      throw new Error(`${game.title} does not have a Microsoft Store app identifier.`);
    }

    const explorer = spawn('explorer.exe', [`shell:AppsFolder\\${appUserModelId}`], {
      detached: true,
      windowsHide: false,
      stdio: 'ignore'
    });
    explorer.unref();

    this.monitorByProcessName(game);
    if (!game.processName) {
      await logLine(
        'warn',
        `${game.title} launched as a Microsoft Store app without a process name. Process exit monitoring is unavailable; session timer will continue.`
      );
    }
  }

  private monitorByProcessName(game: GameRecord): void {
    if (this.monitor) {
      clearInterval(this.monitor);
      this.monitor = null;
    }
    if (!game.processName && !this.activeProcessId) {
      return;
    }

    let seenRunning = false;
    let seenWindow = Boolean(this.activeWindow);
    let missingWindowTicks = 0;
    let checkInFlight = false;
    this.monitor = setInterval(() => {
      if (checkInFlight) {
        return;
      }
      checkInFlight = true;
      const processCheck = game.processName ? isProcessRunning(game.processName) : Promise.resolve(false);
      const pidCheck = this.activeProcessId ? isProcessRunningByPid(this.activeProcessId) : Promise.resolve(false);
      const expectedWindow = this.activeWindow;
      const windowCheck = expectedWindow
        ? isGameWindowVisible(expectedWindow).then((visible) => (visible ? expectedWindow : null))
        : Promise.resolve(null);

      void Promise.all([processCheck, pidCheck, windowCheck])
        .then(([processRunning, pidRunning, currentWindow]) => {
          const isRunning = processRunning || pidRunning;
          seenRunning ||= isRunning;
          if (currentWindow) {
            seenWindow = true;
            missingWindowTicks = 0;
            this.activeWindow = currentWindow;
            this.activeProcessId = currentWindow.processId;
          } else if (seenWindow && expectedWindow) {
            missingWindowTicks += 1;
          }

          const processExited = seenRunning && !isRunning;
          const windowClosed = seenWindow && missingWindowTicks >= 2;
          if (processExited || windowClosed) {
            this.handleGameExit(game);
          }
        })
        .catch((error) => {
          void logLine('warn', `Process monitor failed for ${game.title}: ${String(error)}`);
        })
        .finally(() => {
          checkInFlight = false;
        });
    }, 3000);
  }

  private handleGameExit(game: GameRecord): void {
    this.finishActiveGameSession(game, `${game.title} exited.`);
  }

  private finishActiveGameSession(game: GameRecord, message: string, focusLauncher = true): void {
    const wasActive = this.activeGame?.id === game.id;
    this.sessions.delete(game.id);
    if (!wasActive) {
      this.state = this.withTrackedSessions(this.state);
      this.events.onActiveGameChanged(this.state);
      this.events.onGameExited(game);
      void logLine('info', `${message} Removed ${game.title} from the background switcher list.`);
      return;
    }
    if (this.monitor) {
      clearInterval(this.monitor);
      this.monitor = null;
    }
    this.child = null;
    this.activeGame = null;
    this.activeWindow = null;
    this.activeProcessId = null;
    this.gameInForeground = false;
    this.lastHandoffError = undefined;
    this.clearReinforcementTimers();
    const nextSession = [...this.sessions.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    if (nextSession && this.selectTrackedSession(nextSession.game.id)) {
      this.setActiveState({
        status: 'quickOverlayOpen',
        game: nextSession.game,
        message: `${message} ${nextSession.game.title} is still available in the switcher.`,
        windowDetected: nextSession.windowDetected,
        windowState: nextSession.windowState === 'foreground' ? 'background' : nextSession.windowState
      });
    } else {
      this.setActiveState({
        status: 'closed',
        message
      });
    }
    void logLine('info', `${message} ${nextSession ? 'Another game remains available in the switcher.' : 'Returning to launcher.'}`);
    if (focusLauncher) {
      this.focusLauncher();
    }
    this.events.onGameExited(game);
  }

  private async isGameStillRunning(game: GameRecord): Promise<boolean> {
    const checks: Promise<boolean>[] = [];
    if (game.processName) {
      checks.push(isProcessRunning(game.processName));
    }
    if (this.activeProcessId) {
      checks.push(isProcessRunningByPid(this.activeProcessId));
    }
    if (this.child?.pid) {
      checks.push(isProcessRunningByPid(this.child.pid));
    }
    if (game.launchType === 'microsoftStore' && !game.processName?.trim()) {
      checks.push(isProcessRunning(game.title));
    }
    if (checks.length === 0) {
      return false;
    }
    const results = await Promise.all(checks);
    return results.some(Boolean);
  }

  private async stopMonitoring(closeGame: boolean): Promise<void> {
    if (this.monitor) {
      clearInterval(this.monitor);
      this.monitor = null;
    }
    this.clearReinforcementTimers();
    if (closeGame) {
      await this.closeActiveGame(false);
    }
  }

  private async getActiveWindow(game: GameRecord): Promise<GameWindowInfo | null> {
    if (this.activeWindow) {
      if (await isGameWindowVisible(this.activeWindow)) {
        await logLine(
          'info',
          `Using ${game.title} window ${this.activeWindow.handle} from ${this.activeWindow.processName || 'unknown process'} (${this.activeWindow.processId}).`
        );
        return this.activeWindow;
      }
    }

    const window = await findGameWindow({
      pid: this.activeProcessId ?? this.child?.pid,
      processName: game.processName,
      titleHint: game.title
    });
    this.activeWindow = window;
    this.activeProcessId = window?.processId ?? this.activeProcessId;
    if (window) {
      await logLine('info', `Rediscovered ${game.title} window handle ${window.handle} for process ${window.processId}.`);
    } else {
      await logLine('warn', `Could not rediscover a visible window for ${game.title}.`);
    }
    return window;
  }

  private async checkGracefulCloseResult(game: GameRecord): Promise<void> {
    if (this.activeGame?.id !== game.id) {
      return;
    }

    let window: GameWindowInfo | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (!(await this.isGameStillRunning(game))) {
        this.handleGameExit(game);
        return;
      }
      window = await findGameWindow({
        pid: game.launchType === 'microsoftStore' && !game.processName?.trim() ? undefined : this.activeProcessId ?? this.child?.pid,
        processName: game.processName,
        titleHint: game.title
      });
      if (!window || !(await isGameWindowVisible(window))) {
        this.handleGameExit(game);
        return;
      }
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 1250));
      }
    }

    this.setActiveState({
      status: this.closeFallbackStatus,
      game,
      message: `${game.title} did not close yet. Admin force close is available from settings if needed.`,
      windowDetected: Boolean(window),
      windowState: window ? 'background' : 'unknown'
    });
  }

  private launchMode(game: GameRecord): GameLaunchMode {
    return game.launchMode ?? 'borderlessPreferred';
  }

  private clearReinforcementTimers(): void {
    for (const timer of this.reinforceTimers) {
      clearTimeout(timer);
    }
    this.reinforceTimers = [];
  }

  private async suppressWindowsTaskbar(): Promise<void> {
    if (this.taskbarSuppressed) {
      return;
    }
    this.taskbarSuppressed = true;
    try {
      await setWindowsTaskbarVisible(false);
      await logLine('info', 'Windows taskbar hidden for customer game handoff.');
    } catch (error) {
      await logLine('warn', `Could not hide Windows taskbar during game launch: ${String(error)}`);
    }
  }

  private restoreWindowsTaskbar(): void {
    if (!this.taskbarSuppressed) {
      return;
    }

    this.taskbarSuppressed = false;
    void setWindowsTaskbarVisible(true)
      .then(() => logLine('info', 'Windows taskbar restored for admin or application exit.'))
      .catch((error) => {
        void logLine('warn', `Could not restore Windows taskbar after game session: ${String(error)}`);
      });
  }

  private showLaunchShield(): void {
    const window = this.windowProvider();
    if (!window) {
      return;
    }
    const display = screen.getDisplayMatching(window.getBounds());
    window.setBounds(display.bounds);
    window.show();
    window.setFullScreen(true);
    window.setAlwaysOnTop(true, 'screen-saver');
    window.moveTop();
    window.focus();
  }

  private releaseLaunchShield(): void {
    const window = this.windowProvider();
    if (!window || window.isDestroyed()) {
      return;
    }
    const display = screen.getDisplayMatching(window.getBounds());
    window.setBounds(display.bounds);
    window.setFullScreen(true);
    window.setMenuBarVisibility(false);
    if (!window.isVisible()) {
      window.showInactive();
    }
    window.setAlwaysOnTop(false);
    window.blur();
  }

  private async handOffToGameWindow(
    game: GameRecord,
    window: GameWindowInfo,
    launchMode: GameLaunchMode,
    reason: 'launch' | 'resume',
    focusGeneration: number
  ): Promise<GameWindowInfo> {
    let targetWindow = window;
    const shellHostedStoreApp = game.launchType === 'microsoftStore' && !game.processName?.trim();
    try {
      this.assertFocusOperationCurrent(focusGeneration, game);
      await this.suppressWindowsTaskbar();
      this.assertFocusOperationCurrent(focusGeneration, game);
      let reinforcement;
      if (reason === 'resume') {
        await logLine('info', `Fast resume handoff for ${game.title}: restoring known window ${window.handle}.`);
        // NXGS remains fullscreen behind the game so the Windows shell is never exposed.
        this.releaseLaunchShield();
        targetWindow = await this.reactivateShellHostedStoreWindow(game, targetWindow, focusGeneration);
        reinforcement = shellHostedStoreApp
          ? await this.confirmShellHostedStoreActivation(game, targetWindow, focusGeneration)
          : await resumeGameWindowFast(targetWindow, launchMode);
        this.assertFocusOperationCurrent(focusGeneration, game);
        if (!reinforcement?.isForeground || !reinforcement.isVisible || reinforcement.isMinimized) {
          throw new Error('Windows did not confirm the game window in the foreground. NXGS kept the switcher visible.');
        }
      } else {
        this.showLaunchShield();
        await logLine('info', `${reason} handoff for ${game.title}: preparing window ${window.handle} while NXGS Play remains visible.`);
        if (!shellHostedStoreApp) {
          await prepareGameWindowForReveal(window, launchMode);
        }
        this.assertFocusOperationCurrent(focusGeneration, game);

        // Keep NXGS visible as the console shell cover while Windows grants the game foreground focus.
        this.releaseLaunchShield();
        targetWindow = await this.reactivateShellHostedStoreWindow(game, targetWindow, focusGeneration);
        if (shellHostedStoreApp) {
          reinforcement = await this.confirmShellHostedStoreActivation(game, targetWindow, focusGeneration);
        } else {
          await activateGameWindow(targetWindow, launchMode);
          this.assertFocusOperationCurrent(focusGeneration, game);
          reinforcement = await keepGameWindowOnTop(targetWindow, launchMode);
        }
        this.assertFocusOperationCurrent(focusGeneration, game);
      }
      if (!reinforcement?.isForeground || !reinforcement.isVisible || reinforcement.isMinimized) {
        throw new Error('Windows did not confirm the game window in the foreground. NXGS Play stayed visible.');
      }

      await logLine('info', `${reason} handoff for ${game.title}: visible, focused game window confirmed.`);
      await logLine('info', `NXGS Play remains fullscreen behind ${game.title} as the protected console shell cover.`);
      return targetWindow;
    } catch (error) {
      if (error instanceof FocusOperationCanceledError) {
        throw error;
      }
      this.lastHandoffError = error instanceof Error ? error.message : String(error);
      this.showLaunchShield();
      throw error;
    }
  }

  private scheduleGamePresentationReinforcement(
    game: GameRecord,
    window: GameWindowInfo,
    launchMode: GameLaunchMode
  ): void {
    this.clearReinforcementTimers();
    for (const delayMs of [250, 750, 1500, 3000, 5000]) {
      const timer = setTimeout(() => {
        if (this.activeGame?.id !== game.id || this.state.status !== 'running' || !this.gameInForeground) {
          return;
        }
        void keepGameWindowOnTop(window, launchMode).catch((error) => {
          void logLine('warn', `Could not reinforce protected fullscreen for ${game.title}: ${String(error)}`);
        });
      }, delayMs);
      this.reinforceTimers.push(timer);
    }
  }

  private async reactivateShellHostedStoreWindow(
    game: GameRecord,
    currentWindow: GameWindowInfo,
    focusGeneration: number
  ): Promise<GameWindowInfo> {
    if (game.launchType !== 'microsoftStore' || game.processName?.trim()) {
      return currentWindow;
    }

    const explorer = spawn('explorer.exe', [`shell:AppsFolder\\${game.launchCommand.trim()}`], {
      detached: true,
      windowsHide: false,
      stdio: 'ignore'
    });
    explorer.unref();
    await new Promise((resolve) => setTimeout(resolve, 650));
    this.assertFocusOperationCurrent(focusGeneration, game);

    const refreshedWindow = await findGameWindow({
      titleHint: game.title,
      allowUntitledStoreFrame: true
    });
    if (!refreshedWindow) {
      return currentWindow;
    }
    if (refreshedWindow.handle !== currentWindow.handle) {
      await logLine(
        'info',
        `Store activation refreshed ${game.title} window ${currentWindow.handle} -> ${refreshedWindow.handle}.`
      );
    }
    return refreshedWindow;
  }

  private async confirmShellHostedStoreActivation(
    game: GameRecord,
    window: GameWindowInfo,
    focusGeneration: number
  ): Promise<GameWindowActivationState | null> {
    let state: GameWindowActivationState | null = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      this.assertFocusOperationCurrent(focusGeneration, game);
      state = await getGameWindowActivationState(window);
      if (state?.isForeground && state.isVisible && !state.isMinimized) {
        return state;
      }
      if (attempt < 5) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    const gameProcessRunning = await isProcessRunning(game.title);
    if (
      state &&
      gameProcessRunning &&
      state.isVisible &&
      !state.isMinimized &&
      state.width > 300 &&
      state.height > 200
    ) {
      await logLine(
        'info',
        `Windows kept ${game.title} in a composition-hosted Store frame; NXGS confirmed its process and full-size visible frame after AUMID activation.`
      );
      return { ...state, isForeground: true };
    }
    return state;
  }

  private beginFocusOperation(reason: 'launch' | 'resume', game: GameRecord): number {
    this.focusGeneration += 1;
    void logLine('info', `${reason} focus generation ${this.focusGeneration} started for ${game.title}.`);
    return this.focusGeneration;
  }

  private cancelFocusOperations(reason: string): void {
    this.focusGeneration += 1;
    this.gameInForeground = false;
    this.clearReinforcementTimers();
    void logLine('info', `Focus generation advanced to ${this.focusGeneration}: ${reason}.`);
  }

  private isFocusOperationCurrent(focusGeneration: number, game: GameRecord): boolean {
    return (
      this.focusGeneration === focusGeneration &&
      this.activeGame?.id === game.id &&
      (this.state.status === 'launching' || this.state.status === 'resuming')
    );
  }

  private assertFocusOperationCurrent(focusGeneration: number, game: GameRecord): void {
    if (!this.isFocusOperationCurrent(focusGeneration, game)) {
      throw new FocusOperationCanceledError();
    }
  }

  private storeCurrentSession(): void {
    if (!this.activeGame || ['idle', 'closed', 'error'].includes(this.state.status)) {
      return;
    }
    this.sessions.set(this.activeGame.id, {
      game: this.activeGame,
      child: this.child,
      window: this.activeWindow,
      processId: this.activeProcessId,
      status: this.state.status,
      message: this.state.message,
      windowDetected: Boolean(this.activeWindow),
      windowState: this.state.windowState ?? (this.activeWindow ? 'background' : 'unknown'),
      updatedAt: this.state.updatedAt
    });
  }

  private selectTrackedSession(gameId: string): boolean {
    if (this.activeGame?.id === gameId) {
      return true;
    }
    this.storeCurrentSession();
    if (this.monitor) {
      clearInterval(this.monitor);
      this.monitor = null;
    }
    const session = this.sessions.get(gameId);
    if (!session) {
      return false;
    }
    this.activeGame = session.game;
    this.child = session.child;
    this.activeWindow = session.window;
    this.activeProcessId = session.processId;
    this.gameInForeground = session.windowState === 'foreground';
    this.state = this.withTrackedSessions({
      status: session.status,
      game: session.game,
      message: session.message,
      windowDetected: session.windowDetected,
      windowState: session.windowState,
      updatedAt: session.updatedAt
    });
    return true;
  }

  private withTrackedSessions(state: ActiveGameState): ActiveGameState {
    const activeId = this.activeGame?.id;
    const sessions: TrackedGameSessionState[] = [...this.sessions.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((session) => ({
        game: session.game,
        status: session.status,
        message: session.message,
        windowDetected: session.windowDetected,
        windowState: session.windowState,
        isActive: session.game.id === activeId,
        updatedAt: session.updatedAt
      }));
    return {
      ...state,
      sessions
    };
  }

  private setActiveState(state: Omit<ActiveGameState, 'updatedAt'>): void {
    const previousStatus = this.state.status;
    this.state = {
      updatedAt: new Date().toISOString(),
      ...state
    };
    this.storeCurrentSession();
    this.state = this.withTrackedSessions(this.state);
    void logLine(
      'info',
      `Active game state ${previousStatus} -> ${this.state.status}${this.state.game ? ` (${this.state.game.title})` : ''}.`
    );
    this.events.onActiveGameChanged(this.state);
  }
}
