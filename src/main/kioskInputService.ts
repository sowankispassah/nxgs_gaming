import { BrowserWindow, globalShortcut } from 'electron';
import type { AdminUnlockRequest, AppDiagnostics, KioskMode, ShellHomeReason } from '../shared/types';
import { logLine } from './logger';

type ShortcutLabel = keyof Pick<
  AppDiagnostics['shortcuts'],
  'homeRegistered' | 'f10Registered' | 'emergencyCloseRegistered' | 'adminUnlockRegistered'
>;

type KioskInputEvents = {
  onHome: (reason: ShellHomeReason) => void;
  onAdminUnlockRequest: (request: AdminUnlockRequest) => void;
  onEmergencyClose: () => void;
};

const RESTRICTED_SHORTCUTS = [
  'Alt+F4',
  'Alt+Tab',
  'Alt+Space',
  'CommandOrControl+Escape',
  'CommandOrControl+Shift+Escape',
  'Meta',
  'Super'
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
        lastHomeTrigger: this.lastHomeTrigger,
        lastRestrictedInput: this.lastRestrictedInput,
        lastInputError: this.lastInputError
      }
    };
  }

  get currentMode(): KioskMode {
    return this.mode;
  }

  register(): void {
    this.shortcutDiagnostics.failures = [];
    this.registerShortcut('CommandOrControl+Shift+H', 'homeRegistered', () => this.triggerHome('global-home'));
    this.registerShortcut('F10', 'f10Registered', () => this.triggerHome('global-f10'));
    this.registerShortcut('CommandOrControl+Shift+X', 'emergencyCloseRegistered', () => this.events.onEmergencyClose());
    this.registerShortcut('CommandOrControl+Shift+A', 'adminUnlockRegistered', () =>
      this.requestAdminUnlock('admin shortcut', 'Ctrl+Shift+A')
    );
    this.refreshRestrictedShortcuts();
  }

  unregisterAll(): void {
    globalShortcut.unregisterAll();
    this.restrictedRegistered.clear();
  }

  attachWindow(window: BrowserWindow): void {
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') {
        return;
      }

      if (this.isHomeInput(input)) {
        event.preventDefault();
        this.triggerHome(input.key === 'F10' ? 'global-f10' : 'global-home');
        return;
      }

      if (this.isAdminInput(input)) {
        event.preventDefault();
        this.requestAdminUnlock('admin shortcut', 'Ctrl+Shift+A');
        return;
      }

      if (this.mode === 'admin' || this.adminPinActive) {
        return;
      }

      event.preventDefault();
      this.requestAdminUnlock('restricted keyboard input', describeInput(input));
    });
  }

  setMode(mode: KioskMode): void {
    if (this.mode === mode) {
      return;
    }
    this.mode = mode;
    if (mode === 'admin') {
      this.adminPinActive = false;
    }
    this.refreshRestrictedShortcuts();
    void logLine('info', `Kiosk input mode changed to ${mode}.`);
  }

  setAdminPinActive(active: boolean): void {
    this.adminPinActive = active;
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

    if (this.mode !== 'customer') {
      return;
    }

    for (const accelerator of RESTRICTED_SHORTCUTS) {
      try {
        const registered = globalShortcut.register(accelerator, () =>
          this.requestAdminUnlock('restricted global shortcut', accelerator)
        );
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

  private requestAdminUnlock(source: string, key: string): void {
    if (this.mode === 'admin') {
      return;
    }

    const now = Date.now();
    if (now - this.lastRestrictedAt < 900 && this.lastRestrictedInput === key) {
      return;
    }

    this.lastRestrictedAt = now;
    this.lastRestrictedInput = `${source}: ${key}`;
    this.adminPinActive = true;
    void logLine('warn', `Admin PIN requested by ${this.lastRestrictedInput}.`);
    this.events.onAdminUnlockRequest({
      source,
      key,
      message: 'Enter Admin PIN to unlock PC controls.',
      requestedAt: new Date().toISOString()
    });
  }

  private isHomeInput(input: Electron.Input): boolean {
    const key = input.key.toLowerCase();
    return input.key === 'F10' || (input.control && input.shift && key === 'h');
  }

  private isAdminInput(input: Electron.Input): boolean {
    return input.control && input.shift && input.key.toLowerCase() === 'a';
  }
}
