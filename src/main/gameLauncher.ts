import { BrowserWindow, screen, shell } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ActiveGameState, AppDiagnostics, GameControlResult, GameLaunchMode, GameRecord } from '../shared/types';
import { logLine } from './logger';
import { closeProcessByName, closeProcessByPid, isProcessRunning, isProcessRunningByPid } from './windowsProcess';
import {
  activateGameWindow,
  closeGameWindow,
  findGameWindow,
  keepGameWindowOnTop,
  type GameWindowInfo,
  minimizeGameWindow,
  prepareGameWindowForReveal,
  setWindowsTaskbarVisible,
  waitForGameWindow
} from './windowManagerService';

type LauncherEvents = {
  onGameExited: (game: GameRecord) => void;
  onError: (message: string) => void;
  onActiveGameChanged: (state: ActiveGameState) => void;
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
    return this.state;
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

      await this.stopMonitoring(false);
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

  async closeActiveGame(force: boolean, options: { retireActiveSession?: boolean } = {}): Promise<void> {
    if (this.operationInFlight) {
      await logLine('info', `Ignoring close request while ${this.operationInFlight} is in progress.`);
      return;
    }

    const game = this.activeGame;
    if (!game) {
      return;
    }

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

  async resumeActiveGame(): Promise<GameControlResult> {
    if (this.operationInFlight) {
      await logLine('info', `Ignoring resume request while ${this.operationInFlight} is in progress.`);
      return { ok: false, error: `Another game action is already in progress: ${this.operationInFlight}.` };
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
      const window = await this.getActiveWindow(game);
      this.assertFocusOperationCurrent(focusGeneration, game);
      if (!window) {
        const stillRunning = await this.isGameStillRunning(game);
        if (!stillRunning) {
          const message = `${game.title} is no longer running.`;
          await logLine('info', `Resume requested for ${game.title}, but the game is no longer running.`);
          this.finishActiveGameSession(game, message);
          this.lastResumeResult = message;
          return { ok: false, error: message };
        }

        const message = 'NXGS Play could not find the running game window.';
        await logLine('warn', `Resume requested for ${game.title}, but no game window was found.`);
        this.setActiveState({
          status: 'homeOverlayOpen',
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
      await this.handOffToGameWindow(game, window, this.launchMode(game), 'resume', focusGeneration);
      this.assertFocusOperationCurrent(focusGeneration, game);
      this.activeWindow = window;
      this.activeProcessId = window.processId;
      this.gameInForeground = true;
      this.setActiveState({
        status: 'running',
        game,
        message: `${game.title} is running.`,
        windowDetected: true,
        windowState: 'foreground'
      });
      this.lastHandoffError = undefined;
      this.lastResumeResult = `${game.title} restored and focused.`;
      await logLine('info', `Resume succeeded for ${game.title}; game window is foreground and NXGS Play is hidden.`);
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
        status: 'homeOverlayOpen',
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
      this.setActiveState({
        status: 'minimizing',
        game,
        message: `Minimizing ${game.title}...`,
        windowDetected: Boolean(this.activeWindow),
        windowState: this.activeWindow ? 'background' : 'unknown'
      });
      const window = await this.getActiveWindow(game);
      if (!window) {
        const message = 'NXGS Play could not find the running game window.';
        this.setActiveState({
          status: 'homeOverlayOpen',
          game,
          message,
          windowDetected: false,
          windowState: 'unknown'
        });
        return { ok: false, error: message };
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
        status: 'minimized',
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

  async returnToHome(): Promise<GameControlResult> {
    if (this.operationInFlight === 'home') {
      this.focusLauncher();
      return { ok: true };
    }

    if (this.state.status === 'homeOverlayOpen') {
      this.lastHomeResult = 'NXGS Home was already open and was refocused.';
      this.focusLauncher();
      return { ok: true };
    }

    const canceledOperation = this.operationInFlight;
    const stateBeforeHome = this.state.status;
    this.cancelFocusOperations(`Home requested from ${stateBeforeHome}`);
    this.operationInFlight = 'home';
    const game = this.activeGame;
    this.lastHomeResult = `Home started from ${stateBeforeHome}.`;
    await logLine('info', `Home pressed. State before Home: ${stateBeforeHome}.`);
    if (canceledOperation === 'launch' || canceledOperation === 'resume') {
      await logLine('info', `Canceled pending ${canceledOperation} focus loop before opening Home.`);
    }

    try {
      this.gameInForeground = false;
      this.clearReinforcementTimers();
      if (game) {
        this.setActiveState({
          status: 'homeOverlayOpen',
          game,
          message: `${game.title} is still running. Choose Resume or Close.`,
          windowDetected: Boolean(this.activeWindow),
          windowState: this.activeWindow ? 'background' : 'unknown'
        });
      }

      let minimized = false;
      if (game) {
        try {
          const window = await this.getActiveWindow(game);
          if (window) {
            this.activeWindow = window;
            this.activeProcessId = window.processId;
            await minimizeGameWindow(window);
            minimized = true;
            await logLine('info', `Game minimized for Home: ${game.title}, window ${window.handle}.`);
          } else if (!(await this.isGameStillRunning(game))) {
            this.finishActiveGameSession(game, `${game.title} is no longer running.`);
            this.lastHomeResult = `${game.title} had already closed; NXGS Home restored.`;
            return { ok: true };
          }
        } catch (error) {
          await logLine('warn', `Return home window lookup failed for ${game.title}: ${String(error)}`);
          this.lastHandoffError = error instanceof Error ? error.message : String(error);
        }
      }

      this.focusLauncher();
      if (game) {
        this.setActiveState({
          status: 'homeOverlayOpen',
          game,
          message: `${game.title} is still running. Choose Resume or Close.`,
          windowDetected: Boolean(this.activeWindow),
          windowState: minimized ? 'minimized' : this.activeWindow ? 'background' : 'unknown'
        });
      }
      this.lastHomeResult = minimized
        ? `${game?.title ?? 'Game'} minimized; NXGS Home restored and focused.`
        : 'NXGS Home restored and focused; no controllable game window was found.';
      await logLine('info', this.lastHomeResult);
      return { ok: true };
    } finally {
      if (this.operationInFlight === 'home') {
        this.operationInFlight = null;
      }
    }
  }

  async clearActive(): Promise<void> {
    await this.stopMonitoring(false);
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
        titleHint: game.title
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
      if (!(await this.isGameStillRunning(game))) {
        await logLine('info', `${game.title} exited before a controllable game window was detected.`);
        this.finishActiveGameSession(game, `${game.title} exited.`);
        return;
      }

      const message = `${game.title} started but the window could not be focused. Try Focus Game Again, Return Home, or Close Game.`;
      this.lastHandoffError = message;
      await logLine('warn', `Window detection timed out for ${game.title}; keeping NXGS Play visible.`);
      this.releaseLaunchShield();
      this.focusLauncher();
      this.setActiveState({
        status: 'homeOverlayOpen',
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
      await this.handOffToGameWindow(game, window, launchMode, 'launch', focusGeneration);
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
        status: 'homeOverlayOpen',
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
        ? findGameWindow({
            pid: expectedWindow.processId,
            processName: game.processName,
            titleHint: game.title
          })
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
    if (this.activeGame?.id !== game.id) {
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
    this.setActiveState({
      status: 'closed',
      message
    });
    void logLine('info', `${message} Returning to launcher.`);
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
      const stillCurrent = await findGameWindow({
        pid: this.activeWindow.processId,
        processName: game.processName,
        titleHint: game.title
      });
      if (stillCurrent) {
        if (stillCurrent.handle !== this.activeWindow.handle) {
          await logLine(
            'info',
            `Rediscovered ${game.title} window: ${this.activeWindow.handle} -> ${stillCurrent.handle} (process ${stillCurrent.processId}).`
          );
        }
        this.activeWindow = stillCurrent;
        this.activeProcessId = stillCurrent.processId;
        await logLine(
          'info',
          `Using ${game.title} window ${stillCurrent.handle} from ${stillCurrent.processName || 'unknown process'} (${stillCurrent.processId}).`
        );
        return stillCurrent;
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

    const window = await findGameWindow({
      pid: this.activeProcessId ?? this.child?.pid,
      processName: game.processName,
      titleHint: game.title
    });

    if (!window) {
      this.handleGameExit(game);
      return;
    }

    this.setActiveState({
      status: 'homeOverlayOpen',
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
    const wasSuppressed = this.taskbarSuppressed;
    this.taskbarSuppressed = true;
    try {
      await setWindowsTaskbarVisible(false);
      if (!wasSuppressed) {
        await logLine('info', 'Windows taskbar hidden for customer game handoff.');
      }
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
    window?.setAlwaysOnTop(false);
    window?.blur();
  }

  private hideLauncherForGame(): void {
    const window = this.windowProvider();
    if (!window || window.isDestroyed()) {
      return;
    }
    window.setAlwaysOnTop(false);
    window.hide();
    void logLine('info', 'NXGS Play hidden for the prepared game window foreground transfer.');
  }

  private async handOffToGameWindow(
    game: GameRecord,
    window: GameWindowInfo,
    launchMode: GameLaunchMode,
    reason: 'launch' | 'resume',
    focusGeneration: number
  ): Promise<void> {
    let launcherHidden = false;
    try {
      this.assertFocusOperationCurrent(focusGeneration, game);
      await this.suppressWindowsTaskbar();
      this.assertFocusOperationCurrent(focusGeneration, game);
      this.showLaunchShield();
      await logLine('info', `${reason} handoff for ${game.title}: preparing window ${window.handle} while NXGS Play remains visible.`);
      await prepareGameWindowForReveal(window, launchMode);
      this.assertFocusOperationCurrent(focusGeneration, game);

      // The prepared game already covers the display; hiding the shield lets Windows grant it foreground focus.
      this.releaseLaunchShield();
      this.hideLauncherForGame();
      launcherHidden = true;
      await activateGameWindow(window, launchMode);
      this.assertFocusOperationCurrent(focusGeneration, game);
      const reinforcement = await keepGameWindowOnTop(window, launchMode);
      this.assertFocusOperationCurrent(focusGeneration, game);
      if (!reinforcement?.isForeground || !reinforcement.isVisible || reinforcement.isMinimized) {
        throw new Error('Windows did not confirm the game window in the foreground. NXGS Play stayed visible.');
      }

      await logLine('info', `${reason} handoff for ${game.title}: visible, focused game window confirmed.`);
    } catch (error) {
      if (error instanceof FocusOperationCanceledError) {
        throw error;
      }
      this.lastHandoffError = error instanceof Error ? error.message : String(error);
      this.showLaunchShield();
      launcherHidden = false;
      throw error;
    } finally {
      if (launcherHidden) {
        this.releaseLaunchShield();
      }
    }
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

  private setActiveState(state: Omit<ActiveGameState, 'updatedAt'>): void {
    const previousStatus = this.state.status;
    this.state = {
      updatedAt: new Date().toISOString(),
      ...state
    };
    void logLine(
      'info',
      `Active game state ${previousStatus} -> ${this.state.status}${this.state.game ? ` (${this.state.game.title})` : ''}.`
    );
    this.events.onActiveGameChanged(this.state);
  }
}
