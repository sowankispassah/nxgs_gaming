import { BrowserWindow, shell } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ActiveGameState, GameControlResult, GameLaunchMode, GameRecord } from '../shared/types';
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  async launch(game: GameRecord): Promise<void> {
    if (process.platform !== 'win32') {
      throw new Error('NXGS Play game launching is only supported on Windows.');
    }
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
    this.restoreWindowsTaskbar();
    this.clearReinforcementTimers();
    this.setActiveState({
      status: 'launching',
      game,
      message: `Preparing ${game.title} for full-screen launch...`,
      windowDetected: false
    });
    await this.suppressWindowsTaskbar();
    this.showLaunchShield();
    await delay(160);
    await logLine('info', `Launching ${game.title} using ${game.launchType}: ${game.launchCommand}`);

    try {
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

      await this.activateLaunchedGame(game);
    } catch (error) {
      this.releaseLaunchShield();
      this.restoreWindowsTaskbar();
      throw error;
    }
  }

  async closeActiveGame(force: boolean): Promise<void> {
    const game = this.activeGame;
    if (!game) {
      return;
    }

    await logLine('info', `${force ? 'Force closing' : 'Closing'} ${game.title}`);
    this.setActiveState({
      status: 'closing',
      game,
      message: `Closing ${game.title}...`,
      windowDetected: Boolean(this.activeWindow)
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

    if (!force) {
      setTimeout(() => {
        void this.checkGracefulCloseResult(game);
      }, 2500);
    }
  }

  async resumeActiveGame(): Promise<GameControlResult> {
    const game = this.activeGame;
    if (!game) {
      return { ok: false, error: 'No game is currently running.' };
    }

    if (game.launchType === 'microsoftStore') {
      return this.resumeMicrosoftStoreApp(game);
    }

    const window = await this.getActiveWindow(game);
    if (!window) {
      await logLine('warn', `Resume requested for ${game.title}, but no game window was found.`);
      return { ok: false, error: 'NXGS Play could not find the running game window.' };
    }

    try {
      this.showLaunchShield();
      await this.suppressWindowsTaskbar();
      await this.revealGameWindow(window, this.launchMode(game));
      this.activeWindow = window;
      this.activeProcessId = window.processId;
      this.gameInForeground = true;
      this.scheduleGameWindowReinforcement(game, window, this.launchMode(game));
      this.setActiveState({
        status: 'running',
        game,
        message: `${game.title} is running.`,
        windowDetected: true
      });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logLine('warn', `Native resume failed for ${game.title}: ${message}`);
      return { ok: false, error: message };
    }
  }

  async minimizeActiveGame(): Promise<GameControlResult> {
    const game = this.activeGame;
    if (!game) {
      return { ok: false, error: 'No game is currently running.' };
    }

    const window = await this.getActiveWindow(game);
    if (!window) {
      return { ok: false, error: 'NXGS Play could not find the running game window.' };
    }

    try {
      await minimizeGameWindow(window);
      this.restoreWindowsTaskbar();
      this.focusLauncher();
      this.setActiveState({
        status: 'running',
        game,
        message: `${game.title} is minimized.`,
        windowDetected: true
      });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logLine('warn', `Minimize failed for ${game.title}: ${message}`);
      return { ok: false, error: message };
    }
  }

  async returnToHome(): Promise<GameControlResult> {
    const game = this.activeGame;
    if (game) {
      try {
        const window = await this.getActiveWindow(game);
        if (window) {
          this.gameInForeground = false;
          await minimizeGameWindow(window);
          this.activeWindow = window;
          this.activeProcessId = window.processId;
        }
      } catch (error) {
        await logLine('warn', `Return home minimize failed for ${game.title}: ${String(error)}`);
      }
    }
    this.restoreWindowsTaskbar();
    this.focusLauncher();
    if (game) {
      this.setActiveState({
        status: 'running',
        game,
        message: `${game.title} is running in the background.`,
        windowDetected: Boolean(this.activeWindow)
      });
    }
    return { ok: true };
  }

  async clearActive(): Promise<void> {
    await this.stopMonitoring(false);
    this.activeGame = null;
    this.child = null;
    this.activeWindow = null;
    this.activeProcessId = null;
    this.gameInForeground = false;
    this.restoreWindowsTaskbar();
    this.clearReinforcementTimers();
    this.setActiveState({
      status: 'idle'
    });
  }

  focusLauncher(): void {
    const window = this.windowProvider();
    if (!window) {
      return;
    }
    window.show();
    window.setFullScreen(true);
    window.setAlwaysOnTop(true, 'screen-saver');
    window.moveTop();
    window.focus();
  }

  private async activateLaunchedGame(game: GameRecord): Promise<void> {
    const window = await waitForGameWindow(
      {
        pid: this.child?.pid,
        processName: game.processName,
        titleHint: game.title
      },
      22000,
      200
    );

    if (!window) {
      await logLine('warn', `No main game window detected for ${game.title}; leaving NXGS Play visible.`);
      this.releaseLaunchShield();
      this.restoreWindowsTaskbar();
      this.setActiveState({
        status: 'running',
        game,
        message: `${game.title} launched. Game window detection is still best-effort.`,
        windowDetected: false
      });
      return;
    }

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

    this.setActiveState({
      status: 'launching',
      game,
      message: `Preparing ${game.title} borderless full-screen view...`,
      windowDetected: true
    });

    try {
      await this.revealGameWindow(window, launchMode);
    } catch (error) {
      const currentWindow = await findGameWindow({
        pid: window.processId,
        processName: game.processName,
        titleHint: game.title
      });
      if (!currentWindow) {
        await logLine('info', `${game.title} closed before full-screen activation completed.`);
        this.handleGameExit(game);
        return;
      }
      throw error;
    }
    this.gameInForeground = true;
    this.scheduleGameWindowReinforcement(game, window, launchMode);
    this.setActiveState({
      status: 'running',
      game,
      message: `${game.title} is running.`,
      windowDetected: true
    });
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

  private async resumeMicrosoftStoreApp(game: GameRecord): Promise<GameControlResult> {
    try {
      await logLine('info', `Retrying Microsoft Store activation for ${game.title}`);
      await this.launchMicrosoftStoreApp(game);
      const window = await waitForGameWindow(
        {
          pid: this.activeProcessId ?? this.child?.pid,
          processName: game.processName,
          titleHint: game.title
        },
        8000,
        200
      );

      if (!window) {
        const message = 'Windows accepted the app activation, but NXGS Play could not find the game window.';
        await logLine('warn', `${game.title}: ${message}`);
        this.setActiveState({
          status: 'running',
          game,
          message,
          windowDetected: false
        });
        return { ok: false, error: message };
      }

      this.activeWindow = window;
      this.activeProcessId = window.processId;
      this.showLaunchShield();
      await this.suppressWindowsTaskbar();
      await this.revealGameWindow(window, this.launchMode(game));
      this.gameInForeground = true;
      this.scheduleGameWindowReinforcement(game, window, this.launchMode(game));
      this.setActiveState({
        status: 'running',
        game,
        message: `${game.title} was activated through Windows shell.`,
        windowDetected: true
      });
      return { ok: true };
    } catch (fallbackError) {
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      await logLine('warn', `Microsoft Store resume fallback failed for ${game.title}: ${fallbackMessage}`);
      return { ok: false, error: fallbackMessage };
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
    this.restoreWindowsTaskbar();
    this.clearReinforcementTimers();
    this.setActiveState({
      status: 'idle',
      message: `${game.title} exited.`
    });
    void logLine('info', `${game.title} exited; returning to launcher.`);
    this.focusLauncher();
    this.events.onGameExited(game);
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
      status: 'running',
      game,
      message: `${game.title} did not close yet. Admin force close is available from settings if needed.`,
      windowDetected: Boolean(window)
    });
  }

  private launchMode(game: GameRecord): GameLaunchMode {
    return game.launchMode ?? 'borderlessPreferred';
  }

  private scheduleGameWindowReinforcement(game: GameRecord, window: GameWindowInfo, launchMode: GameLaunchMode): void {
    this.clearReinforcementTimers();
    if (launchMode === 'normal') {
      return;
    }

    for (const delayMs of [250, 600, 1000, 1600, 2400, 3600, 5200, 7600, 10000]) {
      const timer = setTimeout(() => {
        void this.reinforceGameWindow(game, window, launchMode);
      }, delayMs);
      this.reinforceTimers.push(timer);
    }
  }

  private async reinforceGameWindow(game: GameRecord, window: GameWindowInfo, launchMode: GameLaunchMode): Promise<void> {
    if (!this.gameInForeground || this.activeGame?.id !== game.id) {
      return;
    }

    try {
      const currentWindow =
        (await findGameWindow({
          pid: window.processId,
          processName: game.processName,
          titleHint: game.title
        })) ?? window;
      await keepGameWindowOnTop(currentWindow, launchMode);
      this.activeWindow = currentWindow;
      this.activeProcessId = currentWindow.processId;
    } catch (error) {
      await logLine('warn', `Borderless reinforcement failed for ${game.title}: ${String(error)}`);
    }
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
    } catch (error) {
      await logLine('warn', `Could not hide Windows taskbar during game launch: ${String(error)}`);
    }
  }

  private restoreWindowsTaskbar(): void {
    if (!this.taskbarSuppressed) {
      return;
    }

    this.taskbarSuppressed = false;
    void setWindowsTaskbarVisible(true).catch((error) => {
      void logLine('warn', `Could not restore Windows taskbar after game session: ${String(error)}`);
    });
  }

  private showLaunchShield(): void {
    const window = this.windowProvider();
    if (!window) {
      return;
    }
    window.show();
    window.setFullScreen(true);
    window.setAlwaysOnTop(true, 'screen-saver');
    window.moveTop();
    window.focus();
  }

  private releaseLaunchShield(): void {
    this.windowProvider()?.setAlwaysOnTop(false);
  }

  private async revealGameWindow(window: GameWindowInfo, launchMode: GameLaunchMode): Promise<void> {
    try {
      await this.suppressWindowsTaskbar();
      this.showLaunchShield();
      if (launchMode !== 'normal') {
        for (const delayMs of [0, 220, 420, 700]) {
          if (delayMs > 0) {
            await delay(delayMs);
          }
          await prepareGameWindowForReveal(window, launchMode);
          this.showLaunchShield();
        }
        await delay(220);
      }
      await activateGameWindow(window, launchMode);
      if (launchMode !== 'normal') {
        await delay(260);
        await prepareGameWindowForReveal(window, launchMode);
        this.showLaunchShield();
        await delay(140);
        await activateGameWindow(window, launchMode);
        await delay(140);
      }
    } finally {
      this.releaseLaunchShield();
    }
  }

  private setActiveState(state: Omit<ActiveGameState, 'updatedAt'>): void {
    this.state = {
      updatedAt: new Date().toISOString(),
      ...state
    };
    this.events.onActiveGameChanged(this.state);
  }
}
