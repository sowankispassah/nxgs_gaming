import { BrowserWindow, screen } from 'electron';
import type { SessionState } from '../shared/types';

export class SessionCountdownOverlay {
  private window: BrowserWindow | null = null;
  private pendingSeconds = 0;

  update(state: SessionState): void {
    if (state.status !== 'running' || state.remainingSeconds <= 0 || state.remainingSeconds > 60) {
      this.close();
      return;
    }

    this.pendingSeconds = state.remainingSeconds;
    if (!this.window || this.window.isDestroyed()) {
      this.create();
      return;
    }
    this.renderSeconds();
  }

  close(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
    }
    this.window = null;
    this.pendingSeconds = 0;
  }

  private create(): void {
    const display = screen.getPrimaryDisplay();
    const width = 320;
    const height = 76;
    this.window = new BrowserWindow({
      width,
      height,
      x: Math.round(display.workArea.x + (display.workArea.width - width) / 2),
      y: display.workArea.y + 18,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      focusable: false,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    this.window.setIgnoreMouseEvents(true);
    this.window.setAlwaysOnTop(true, 'screen-saver');
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.window.on('closed', () => {
      this.window = null;
    });
    this.window.webContents.once('did-finish-load', () => {
      this.renderSeconds();
      this.window?.showInactive();
    });
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;background:transparent;font-family:Segoe UI,Arial,sans-serif;overflow:hidden}
      .timer{height:64px;margin:6px;display:flex;align-items:center;justify-content:center;gap:12px;
        color:#fff;background:rgba(6,17,35,.94);border:2px solid #28a7ff;border-radius:18px;
        box-shadow:0 12px 34px rgba(0,0,0,.5),0 0 22px rgba(40,167,255,.28)}
      .dot{width:11px;height:11px;border-radius:50%;background:#ff4f70;box-shadow:0 0 14px #ff4f70}
      .label{font-size:15px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#b8c8df}
      #seconds{font-size:30px;font-weight:900;font-variant-numeric:tabular-nums;color:#fff}
    </style></head><body><div class="timer"><span class="dot"></span><span class="label">Play time ends in</span><span id="seconds">60s</span></div></body></html>`;
    void this.window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  }

  private renderSeconds(): void {
    const window = this.window;
    if (!window || window.isDestroyed() || window.webContents.isLoading()) return;
    const seconds = Math.max(0, Math.min(60, Math.floor(this.pendingSeconds)));
    void window.webContents.executeJavaScript(
      `document.getElementById('seconds').textContent = '${seconds}s'`,
      true
    );
  }
}
