import { BrowserWindow, shell } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { GameRecord } from '../shared/types';
import { logLine } from './logger';
import { closeProcessByName, closeProcessByPid, isProcessRunning } from './windowsProcess';

type LauncherEvents = {
  onGameExited: (game: GameRecord) => void;
  onError: (message: string) => void;
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

export class GameLauncher {
  private activeGame: GameRecord | null = null;
  private child: ChildProcessWithoutNullStreams | null = null;
  private monitor: NodeJS.Timeout | null = null;

  constructor(
    private readonly windowProvider: () => BrowserWindow | null,
    private readonly events: LauncherEvents
  ) {}

  get active(): GameRecord | null {
    return this.activeGame;
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
    await logLine('info', `Launching ${game.title} using ${game.launchType}: ${game.launchCommand}`);

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

    this.windowProvider()?.minimize();
  }

  async closeActiveGame(force: boolean): Promise<void> {
    const game = this.activeGame;
    if (!game) {
      return;
    }

    await logLine('info', `${force ? 'Force closing' : 'Closing'} ${game.title}`);
    const errors: string[] = [];

    if (this.child?.pid) {
      try {
        await closeProcessByPid(this.child.pid, force);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (game.processName) {
      try {
        await closeProcessByName(game.processName, force);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (errors.length > 0) {
      await logLine('warn', `Close game errors for ${game.title}: ${errors.join(' | ')}`);
    }
  }

  async clearActive(): Promise<void> {
    await this.stopMonitoring(false);
    this.activeGame = null;
    this.child = null;
  }

  focusLauncher(): void {
    const window = this.windowProvider();
    if (!window) {
      return;
    }
    window.show();
    window.setFullScreen(true);
    window.moveTop();
    window.focus();
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

    this.child.once('error', async (error) => {
      await logLine('error', `Launch failed for ${game.title}: ${error.message}`);
      this.events.onError(error.message);
    });
    this.child.once('close', () => {
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
    if (!game.processName) {
      return;
    }

    let seenRunning = false;
    this.monitor = setInterval(() => {
      void isProcessRunning(game.processName)
        .then((running) => {
          seenRunning ||= running;
          if (seenRunning && !running) {
            this.handleGameExit(game);
          }
        })
        .catch((error) => {
          void logLine('warn', `Process monitor failed for ${game.title}: ${String(error)}`);
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
    void logLine('info', `${game.title} exited; returning to launcher.`);
    this.focusLauncher();
    this.events.onGameExited(game);
  }

  private async stopMonitoring(closeGame: boolean): Promise<void> {
    if (this.monitor) {
      clearInterval(this.monitor);
      this.monitor = null;
    }
    if (closeGame) {
      await this.closeActiveGame(false);
    }
  }
}
