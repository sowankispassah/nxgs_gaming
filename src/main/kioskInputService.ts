import { BrowserWindow, globalShortcut } from 'electron';
import type { AppDiagnostics, KioskMode, ShellHomeReason } from '../shared/types';
import { logLine } from './logger';
import { NativeKioskHook } from './nativeKioskHook';

type ShortcutLabel = keyof Pick<
  AppDiagnostics['shortcuts'],
  'homeRegistered' | 'f10Registered' | 'emergencyCloseRegistered' | 'adminUnlockRegistered'
>;

type KioskInputEvents = {
  onHome: (reason: ShellHomeReason) => void;
  onRestrictedInput: (input: string) => void;
  onEmergencyClose: () => void;
};

const BLOCKED_SYSTEM_SHORTCUTS = [
  'CommandOrControl+Tab'
] as const;

function describeInput(input: Electron.Input): string {
  const parts = [
    input.control ? 'Ctrl' : '',
    input.shift ? 'Shift' : '',
    input.alt ? 'Alt' : '',
    input.meta ? 'Meta' : '',
    input.key
  ].filter(Boolean);
  return parts.join('+') || input.type;
}

export class KioskInputService {
  private mode: KioskMode = 'customer';
  private adminPinActive = false;
  private adminControlsUnlocked = false;
  private lastHomeAt = 0;
  private lastRestrictedAt = 0;
  private lastHomeTrigger: ShellHomeReason | undefined;
  private lastRestrictedInput: string | undefined;
  private lastInputError: string | undefined;
  private restrictedRegistered = new Set<string>();
  private readonly shortcutDiagnostics: AppDiagnostics['shortcuts'] = {
    homeRegistered: false,
    f10Registered: false,
    emergencyCloseRegistered: false,
    adminUnlockRegistered: false,
    restrictedRegisteredCount: 0,
    failures: []
  };
  private readonly nativeHook = new NativeKioskHook((input) => this.blockRestrictedInput('Native system input guard', input));

  constructor(private readonly events: KioskInputEvents) {}

  get diagnostics(): Pick<AppDiagnostics, 'shortcuts' | 'kiosk'> {
    return {
      shortcuts: {
        ...this.shortcutDiagnostics,
        restrictedRegisteredCount: this.restrictedRegistered.size,
        failures: [...this.shortcutDiagnostics.failures]
      },
      kiosk: {
        mode: this.mode,
        taskbarHidden: false,
        alwaysOnTop: false,
        launcherVisible: false,
        fullscreen: false,
        maximized: false,
        resizable: false,
        lastHomeTrigger: this.lastHomeTrigger,
        lastRestrictedInput: this.lastRestrictedInput,
        lastInputError: this.lastInputError
      }
    };
  }

  get currentMode(): KioskMode {
    return this.mode;
  }

  get isAdminPinActive(): boolean {
    return this.adminPinActive;
  }

  register(): void {
    this.shortcutDiagnostics.failures = [];
    this.registerShortcut('CommandOrControl+Shift+H', 'homeRegistered', () => this.requestHome('global-home'));
    this.registerShortcut('F10', 'f10Registered', () => this.requestHome('global-f10'));
    this.registerShortcut('CommandOrControl+Shift+X', 'emergencyCloseRegistered', () => this.events.onEmergencyClose());
    this.shortcutDiagnostics.adminUnlockRegistered = false;
    this.refreshRestrictedShortcuts();
  }

  unregisterAll(): void {
    this.nativeHook.stop();
    globalShortcut.unregisterAll();
    this.restrictedRegistered.clear();
  }

  attachWindow(window: BrowserWindow): void {
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') {
        return;
      }

      const key = input.key.toLowerCase();
      if (input.control && input.shift && key === 'h') {
        event.preventDefault();
        this.requestHome('global-home');
        return;
      }
      if (key === 'f10') {
        event.preventDefault();
        this.requestHome('global-f10');
        return;
      }

      if (this.mode === 'admin' || this.adminControlsUnlocked) {
        return;
      }

      const restrictedInput = this.getRestrictedInput(input);
      if (restrictedInput) {
        event.preventDefault();
        this.blockRestrictedInput(restrictedInput.source, describeInput(input));
      }
    });
  }

  setMode(mode: KioskMode): void {
    if (this.mode === mode) {
      return;
    }
    this.mode = mode;
    if (mode === 'admin') {
      this.adminPinActive = false;
    } else {
      this.adminControlsUnlocked = false;
    }
    this.refreshRestrictedShortcuts();
    void logLine('info', `Kiosk input mode changed to ${mode}.`);
  }

  setAdminPinActive(active: boolean): void {
    if (this.adminPinActive === active) {
      return;
    }
    this.adminPinActive = active;
  }

  setAdminControlsUnlocked(unlocked: boolean): void {
    if (this.adminControlsUnlocked === unlocked) return;
    this.adminControlsUnlocked = unlocked;
    this.refreshRestrictedShortcuts();
  }

  requestHome(reason: ShellHomeReason): void {
    this.triggerHome(reason);
  }

  handleFocusEscape(key: string): void {
    if (this.mode !== 'customer' || this.adminControlsUnlocked) {
      return;
    }
    this.blockRestrictedInput('Window switching attempt', key);
  }

  private registerShortcut(accelerator: string, label: ShortcutLabel, handler: () => void): void {
    try {
      const registered = globalShortcut.register(accelerator, handler);
      this.shortcutDiagnostics[label] = registered;
      const message = `${accelerator} global shortcut ${registered ? 'registered' : 'failed to register'}.`;
      if (registered) {
        void logLine('info', message);
        return;
      }
      this.shortcutDiagnostics.failures.push(message);
      void logLine('warn', message);
    } catch (error) {
      const message = `${accelerator} global shortcut failed: ${error instanceof Error ? error.message : String(error)}`;
      this.shortcutDiagnostics[label] = false;
      this.shortcutDiagnostics.failures.push(message);
      this.lastInputError = message;
      void logLine('warn', message);
    }
  }

  private refreshRestrictedShortcuts(): void {
    for (const accelerator of this.restrictedRegistered) {
      globalShortcut.unregister(accelerator);
    }
    this.restrictedRegistered.clear();

    if (this.mode !== 'customer' || this.adminPinActive) {
      this.nativeHook.stop();
      return;
    }

    this.nativeHook.start();

    for (const accelerator of BLOCKED_SYSTEM_SHORTCUTS) {
      try {
        const registered = globalShortcut.register(accelerator, () => this.blockSystemShortcut(accelerator));
        if (registered) {
          this.restrictedRegistered.add(accelerator);
        } else {
          const message = `${accelerator} restricted shortcut failed to register.`;
          this.shortcutDiagnostics.failures.push(message);
          void logLine('warn', message);
        }
      } catch (error) {
        const message = `${accelerator} restricted shortcut failed: ${error instanceof Error ? error.message : String(error)}`;
        this.shortcutDiagnostics.failures.push(message);
        this.lastInputError = message;
        void logLine('warn', message);
      }
    }

  }

  private triggerHome(reason: ShellHomeReason): void {
    const now = Date.now();
    if (now - this.lastHomeAt < 600) {
      return;
    }
    this.lastHomeAt = now;
    this.lastHomeTrigger = reason;
    void logLine('info', `Kiosk Home triggered by ${reason}.`);
    this.events.onHome(reason);
  }

  private blockRestrictedInput(source: string, key: string): void {
    if (this.mode !== 'customer' || this.adminControlsUnlocked) {
      return;
    }

    const now = Date.now();
    if (now - this.lastRestrictedAt < 900 && this.lastRestrictedInput === key) {
      return;
    }

    this.lastRestrictedAt = now;
    this.lastRestrictedInput = `${source}: ${key}`;
    void logLine('info', `Silently blocked customer input: ${this.lastRestrictedInput}.`);
    this.events.onRestrictedInput(this.lastRestrictedInput);
  }

  private isWindowsSystemInput(input: Electron.Input): boolean {
    const key = input.key.toLowerCase();
    return input.meta || key === 'meta' || key === 'super' || key === 'os' || key === 'win' || key === 'windows';
  }

  private getRestrictedInput(input: Electron.Input): { source: string } | null {
    if (this.isWindowsSystemInput(input)) {
      return { source: 'System key' };
    }

    const key = input.key.toLowerCase();
    if (input.alt && (key === 'tab' || key === 'f4' || key === ' ' || key === 'space')) {
      return { source: 'Window switching attempt' };
    }
    if (input.control && (key === 'tab' || key === 'escape')) {
      return { source: 'Window switching attempt' };
    }
    return null;
  }

  private blockSystemShortcut(accelerator: string): void {
    if (this.mode !== 'customer') {
      return;
    }

    this.blockRestrictedInput('Restricted customer shortcut', accelerator);
  }
}
