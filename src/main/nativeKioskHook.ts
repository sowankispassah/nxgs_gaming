import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { app } from 'electron';
import { logLine } from './logger';

function getHookScriptPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'native-kiosk-hook.ps1')
    : join(app.getAppPath(), 'build', 'native-kiosk-hook.ps1');
}

export class NativeKioskHook {
  private process: ChildProcess | null = null;
  private buffer = '';
  private wanted = false;

  constructor(private readonly onRestrictedInput: (input: string) => void) {}

  start(): void {
    this.wanted = true;
    if (process.platform !== 'win32' || this.process) return;
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        getHookScriptPath(),
        '-ParentProcessId',
        String(process.pid)
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    this.process = child;
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.handleOutput(chunk));
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      const message = chunk.trim();
      if (message) void logLine('warn', `Native kiosk hook error: ${message}`);
    });
    child.once('exit', (code) => {
      if (this.process === child) this.process = null;
      if (this.wanted) {
        void logLine('warn', `Native kiosk hook exited unexpectedly (${String(code)}); restarting.`);
        setTimeout(() => this.start(), 300);
      }
    });
  }

  stop(): void {
    this.wanted = false;
    const child = this.process;
    this.process = null;
    this.buffer = '';
    child?.kill();
  }

  private handleOutput(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? '';
    for (const line of lines.map((value) => value.trim()).filter(Boolean)) {
      if (line === 'READY') {
        void logLine('info', 'Native Windows customer-mode keyboard and notification guard is active.');
      } else if (line.startsWith('NOTIFICATION_SUPPRESSED|')) {
        const [, processName = 'unknown', className = 'unknown'] = line.split('|');
        void logLine(
          'info',
          `Suppressed Windows system notification popup while customer fullscreen was active: ${processName}/${className}.`
        );
      } else {
        this.onRestrictedInput(line);
      }
    }
  }
}
