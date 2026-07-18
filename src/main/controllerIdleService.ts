import { app } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import type { ControllerIdleNotification, ControllerIdleSettings } from '../shared/types';
import { ControllerIdlePolicy, type ControllerIdleAction } from './controllerIdlePolicy';
import { logLine } from './logger';

const HELPER_PROTOCOL_VERSION = '1';
const STICK_DEAD_ZONE = 32;
const TRIGGER_THRESHOLD = 15;
const MAX_RESTARTS_PER_WINDOW = 5;
const RESTART_WINDOW_MS = 5 * 60_000;
const MAX_RESTART_DELAY_MS = 30_000;
const CONTROLLER_ID_PATTERN = /^(?:[0-9A-F]{12}|HID-[0-9A-F]{16})$/;

type ControllerIdleEvents = {
  onNotification: (notification: ControllerIdleNotification) => void;
};

export class ControllerIdleService {
  private helper: ChildProcessWithoutNullStreams | null = null;
  private readonly policy: ControllerIdlePolicy;
  private tickTimer: NodeJS.Timeout | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private restartHistory: number[] = [];
  private stdoutBuffer = '';
  private stopping = false;
  private helperReady = false;
  private readonly lastActivityLog = new Map<string, number>();
  private readonly knownControllerIds = new Set<string>();

  constructor(settings: ControllerIdleSettings, private readonly events: ControllerIdleEvents) {
    this.policy = new ControllerIdlePolicy(settings);
  }

  start(): void {
    if (process.platform !== 'win32' || this.helper || this.stopping) return;
    this.spawnHelper();
    if (!this.tickTimer) this.tickTimer = setInterval(() => this.processActions(this.policy.tick(Date.now())), 1_000);
  }

  updateSettings(settings: ControllerIdleSettings): void {
    this.processActions(this.policy.updateSettings(settings));
  }

  setGameplayActive(active: boolean): void {
    if (this.policy.isGameplayActive === active) return;
    this.processActions(this.policy.setGameplayActive(active, Date.now()));
    void logLine(
      'info',
      active
        ? 'Controller idle shutdown suspended while a game session is active.'
        : 'Controller idle shutdown resumed after all game sessions ended.'
    );
  }

  paidSessionEnded(): void {
    this.policy.paidSessionEnded(Date.now());
    void logLine('info', 'Controller idle monitor started the 60-second paid-session-end idle grace period.');
  }

  stop(): void {
    this.stopping = true;
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.tickTimer = null;
    this.restartTimer = null;
    const child = this.helper;
    this.helper = null;
    if (!child) return;
    try {
      child.stdin.write('STOP\n');
      child.stdin.end();
    } catch {
      child.kill();
    }
    const killTimer = setTimeout(() => {
      if (!child.killed) child.kill();
    }, 2_000);
    killTimer.unref();
    void logLine('info', 'Native DualSense idle helper stop requested.');
  }

  private helperPath(): string {
    const root = app.isPackaged ? process.resourcesPath : app.getAppPath();
    return join(root, app.isPackaged ? 'controller-idle-helper' : 'vendor/controller-idle-helper', 'NxgsControllerIdleHelper.exe');
  }

  private spawnHelper(): void {
    this.stopping = false;
    this.stdoutBuffer = '';
    this.helperReady = false;
    const child = spawn(this.helperPath(), [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    this.helper = child;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.consumeOutput(chunk));
    child.stderr.on('data', (chunk: string) => {
      const message = chunk.trim();
      if (message) void logLine('warn', `Native DualSense idle helper: ${message.slice(0, 500)}`);
    });
    child.once('error', (error) => {
      void logLine('error', `Native DualSense idle helper failed to start: ${String(error)}`);
    });
    child.once('exit', (code, signal) => {
      if (this.helper === child) this.helper = null;
      const wasStopping = this.stopping;
      this.helperReady = false;
      for (const controller of this.policy.connectedControllers) {
        this.policy.disconnect(controller.id);
        this.clearNotification(controller.id);
      }
      void logLine(wasStopping ? 'info' : 'warn', `Native DualSense idle helper stopped (code=${code ?? 'none'}, signal=${signal ?? 'none'}).`);
      if (!wasStopping) this.scheduleRestart();
    });
  }

  private scheduleRestart(): void {
    const now = Date.now();
    this.restartHistory = this.restartHistory.filter((time) => now - time < RESTART_WINDOW_MS);
    if (this.restartHistory.length >= MAX_RESTARTS_PER_WINDOW) {
      void logLine('error', 'Native DualSense idle helper restart limit reached; automatic restart paused for five minutes.');
      this.restartTimer = setTimeout(() => {
        this.restartHistory = [];
        this.restartTimer = null;
        if (!this.stopping) this.spawnHelper();
      }, RESTART_WINDOW_MS);
      this.restartTimer.unref();
      return;
    }
    this.restartHistory.push(now);
    const delay = Math.min(1_000 * 2 ** (this.restartHistory.length - 1), MAX_RESTART_DELAY_MS);
    void logLine('warn', `Native DualSense idle helper restart scheduled in ${delay} ms.`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.stopping) this.spawnHelper();
    }, delay);
    this.restartTimer.unref();
  }

  private consumeOutput(chunk: string): void {
    this.stdoutBuffer += chunk;
    if (this.stdoutBuffer.length > 64 * 1024) {
      void logLine('error', 'Native DualSense idle helper exceeded the IPC buffer limit; restarting it.');
      this.stdoutBuffer = '';
      this.helper?.kill();
      return;
    }
    let newline = this.stdoutBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).replace(/\r$/, '');
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line.length <= 2_048) this.handleHelperLine(line);
      else void logLine('warn', 'Ignored an oversized message from the native DualSense idle helper.');
      newline = this.stdoutBuffer.indexOf('\n');
    }
  }

  private handleHelperLine(line: string): void {
    const parts = line.split('|');
    const event = parts[0];
    if (event === 'READY' && parts.length === 2 && parts[1] === HELPER_PROTOCOL_VERSION) {
      this.helperReady = true;
      this.helper?.stdin.write(`CONFIG|${STICK_DEAD_ZONE}|${TRIGGER_THRESHOLD}\n`);
      void logLine('info', 'Native DualSense idle helper started with global Raw Input monitoring.');
      return;
    }
    const id = parts[1] ?? '';
    if (!CONTROLLER_ID_PATTERN.test(id)) {
      void logLine('warn', `Ignored invalid native controller IPC event: ${event || 'empty'}.`);
      return;
    }
    if (event === 'CONNECTED' && parts.length === 5 && parts[3] === 'bluetooth') {
      const name = decodeField(parts[2], 'DualSense Wireless Controller');
      const reconnected = this.knownControllerIds.has(id);
      this.knownControllerIds.add(id);
      this.policy.connect(id, name, Date.now());
      void logLine('info', `${reconnected ? 'Controller reconnected' : 'Controller connected'}: id=${id} name=${name} connection=bluetooth; idle timer started.`);
      return;
    }
    if (event === 'ACTIVITY' && parts.length === 3 && /^\d{1,16}$/.test(parts[2])) {
      const now = Date.now();
      this.processActions(this.policy.activity(id, now));
      const lastLogged = this.lastActivityLog.get(id) ?? 0;
      if (now - lastLogged >= 60_000) {
        this.lastActivityLog.set(id, now);
        void logLine('info', `Meaningful controller activity detected: id=${id} connection=bluetooth.`);
      }
      return;
    }
    if (event === 'DISCONNECTED' && parts.length === 3) {
      const controller = this.policy.disconnect(id);
      this.lastActivityLog.delete(id);
      this.clearNotification(id);
      if (controller) void logLine('info', `Controller disconnected: id=${id} connection=bluetooth reason=${decodeField(parts[2], 'unknown')}.`);
      return;
    }
    if (event === 'SHUTDOWN_RESULT' && parts.length === 6 && (parts[2] === 'OK' || parts[2] === 'FAIL') && /^-?\d+$/.test(parts[3])) {
      const ok = parts[2] === 'OK';
      const code = parts[3];
      const action = decodeField(parts[4], 'IOCTL_BTH_DISCONNECT_DEVICE');
      const detail = decodeField(parts[5], 'unknown');
      if (ok) {
        this.clearNotification(id);
        void logLine('info', `Controller shutdown succeeded: id=${id} connection=bluetooth action=${action} code=${code} paired=true.`);
      } else {
        this.policy.shutdownFailed(id, Date.now());
        void logLine('error', `Controller shutdown failed: id=${id} connection=bluetooth action=${action} code=${code} detail=${detail}.`);
        this.events.onNotification({
          action: 'show',
          controllerId: id,
          kind: 'error',
          title: 'Controller could not turn off',
          message: 'NXGS could not automatically turn off this controller. You can hold the PS button to turn it off manually.'
        });
      }
      return;
    }
    if (event === 'ERROR' && parts.length >= 3) {
      void logLine('warn', `Native DualSense idle helper error: id=${id} detail=${decodeField(parts.slice(2).join('|'), 'unknown')}.`);
      return;
    }
    void logLine('warn', `Ignored unknown or malformed native controller IPC event: ${event || 'empty'}.`);
  }

  private processActions(actions: ControllerIdleAction[]): void {
    for (const action of actions) {
      if (action.type === 'warning-cancelled') {
        this.clearNotification(action.controller.id);
        void logLine('info', `Controller shutdown warning cancelled by meaningful activity: id=${action.controller.id}.`);
      } else if (action.type === 'warning') {
        this.events.onNotification({
          action: 'show',
          controllerId: action.controller.id,
          kind: 'warning',
          title: 'Controller turning off soon',
          message: 'Your controller has been inactive and will turn off in 30 seconds. Press any button to keep it connected.'
        });
        void logLine('info', `Controller shutdown warning countdown started: id=${action.controller.id} seconds=30.`);
      } else {
        if (!this.helperReady || !this.helper) {
          this.policy.shutdownFailed(action.controller.id, Date.now());
          void logLine('warn', `Controller shutdown deferred because native helper is unavailable: id=${action.controller.id}.`);
          continue;
        }
        this.clearNotification(action.controller.id);
        this.helper.stdin.write(`SHUTDOWN|${action.controller.id}\n`);
        void logLine('info', `Controller shutdown requested: id=${action.controller.id} connection=bluetooth action=IOCTL_BTH_DISCONNECT_DEVICE.`);
      }
    }
  }

  private clearNotification(controllerId: string): void {
    this.events.onNotification({ action: 'clear', controllerId, kind: 'warning' });
  }
}

function decodeField(value: string, fallback: string): string {
  try {
    const decoded = decodeURIComponent(value);
    return decoded && decoded.length <= 300 ? decoded : fallback;
  } catch {
    return fallback;
  }
}
