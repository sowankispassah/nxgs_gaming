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
    const width = 340;
    const height = 92;
    this.window = new BrowserWindow({
      width,
      height,
      x: Math.round(display.workArea.x + (display.workArea.width - width) / 2),
      y: display.workArea.y + 8,
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
      *{box-sizing:border-box}html,body{margin:0;height:100%;background:transparent;overflow:hidden;user-select:none;
        font-family:'Segoe UI Variable Display','Segoe UI',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
      body{display:grid;place-items:center}
      .timer{display:flex;align-items:center;gap:14px;height:56px;padding:0 24px 0 22px;color:#fff;
        border:1px solid rgba(255,255,255,.12);border-radius:999px;background:linear-gradient(180deg,rgba(48,55,72,.97),rgba(29,34,47,.97));
        box-shadow:0 6px 14px -4px rgba(0,0,0,.6),0 0 14px rgba(0,0,0,.32),inset 0 1px 0 rgba(255,255,255,.07);
        animation:enter .32s cubic-bezier(.22,1,.36,1) both}
      .dot{position:relative;flex:none;width:10px;height:10px;border-radius:50%;background:#ff4f63}
      .dot::after{content:'';position:absolute;inset:0;border-radius:50%;background:inherit;animation:pulse 1.4s ease-out infinite}
      .label{color:rgba(232,237,247,.74);font-size:15px;font-weight:500;white-space:nowrap}
      #seconds{min-width:50px;font-size:24px;font-weight:600;letter-spacing:-.01em;font-variant-numeric:tabular-nums;text-align:right}
      @keyframes pulse{from{opacity:.7;transform:scale(1)}to{opacity:0;transform:scale(2.6)}}
      @keyframes enter{from{opacity:0;transform:translateY(-10px)}}
    </style></head><body><div class="timer" role="timer"><span class="dot"></span><span class="label">Play time ends in</span><span id="seconds">60s</span></div></body></html>`;
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
