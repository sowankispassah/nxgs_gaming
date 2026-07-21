import { BrowserWindow, screen } from 'electron';

export type SessionWarningStage = 'two' | 'final';
export type SessionWarningAction = 'extend' | 'skip';

type WarningActionResult = { ok: boolean; error?: string };

export class SessionWarningOverlay {
  private window: BrowserWindow | null = null;
  private stage: SessionWarningStage = 'two';

  constructor(
    private readonly onAction: (
      action: SessionWarningAction,
      stage: SessionWarningStage
    ) => Promise<WarningActionResult>
  ) {}

  show(stage: SessionWarningStage): void {
    this.close();
    this.stage = stage;
    const display = screen.getPrimaryDisplay();
    const width = 660;
    const height = 330;
    const window = new BrowserWindow({
      width,
      height,
      x: Math.round(display.bounds.x + (display.bounds.width - width) / 2),
      y: Math.round(display.bounds.y + (display.bounds.height - height) / 2),
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      focusable: true,
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
    this.window = window;
    window.setAlwaysOnTop(true, 'screen-saver');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.on('closed', () => {
      if (this.window === window) this.window = null;
    });
    window.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith('nxgs-warning://')) return;
      event.preventDefault();
      const action = url.endsWith('extend') ? 'extend' : 'skip';
      void this.runAction(action);
    });
    window.webContents.once('did-finish-load', () => {
      if (this.window !== window) return;
      window.show();
      window.moveTop();
      window.focus();
    });
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(this.html(stage))}`);
  }

  close(): void {
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }

  private async runAction(action: SessionWarningAction): Promise<void> {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    const result = await this.onAction(action, this.stage);
    if (!result.ok && this.window === window && !window.isDestroyed()) {
      const message = JSON.stringify(result.error ?? 'The action could not be completed.');
      void window.webContents.executeJavaScript(`window.resetWarning(${message})`, true);
    }
  }

  private html(stage: SessionWarningStage): string {
    const final = stage === 'final';
    const title = final ? 'Your play time has ended' : 'Your play time will end in 2 minutes';
    const message = final
      ? 'Extend now to keep playing. End Session closes all running games and returns to NXGS Home.'
      : 'Extend your session now, or skip this warning and continue playing.';
    const skipLabel = final ? 'End Session' : 'Skip';
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      *{box-sizing:border-box}html,body{margin:0;background:transparent;font-family:Segoe UI,Arial,sans-serif;color:#fff;overflow:hidden}
      .panel{height:310px;margin:10px;padding:30px 34px;display:grid;align-content:center;gap:14px;text-align:center;
        background:rgba(5,16,34,.97);border:2px solid #28a7ff;border-radius:24px;
        box-shadow:0 24px 70px rgba(0,0,0,.65),0 0 34px rgba(40,167,255,.24)}
      .icon{width:52px;height:52px;margin:0 auto;display:grid;place-items:center;border-radius:50%;
        color:#ff8295;background:rgba(255,79,112,.14);font-size:30px;font-weight:900}
      .eyebrow{color:#8fa9ca;font-size:13px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}
      h1{margin:0;font-size:30px;line-height:1.15}p{margin:0 auto;max-width:540px;color:#b9c9de;font-size:16px;line-height:1.5}
      .actions{display:flex;justify-content:center;gap:14px;margin-top:8px}button{min-width:190px;height:50px;border-radius:12px;
        border:1px solid rgba(255,255,255,.16);color:#fff;font-size:16px;font-weight:800;cursor:pointer}
      #extend{background:#168ff1;border-color:#48b4ff}#skip{background:#1a2940}button:focus{outline:3px solid rgba(111,210,255,.85);outline-offset:2px}
      button:disabled{opacity:.65;cursor:wait}.spinner{display:none;width:17px;height:17px;margin-right:8px;vertical-align:-3px;
        border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite}
      .pending .spinner{display:inline-block}.error{min-height:18px;color:#ff93a3;font-size:13px}@keyframes spin{to{transform:rotate(360deg)}}
    </style></head><body><main class="panel"><div class="icon">!</div><div class="eyebrow">Paid session warning</div>
      <h1>${title}</h1><p>${message}</p><div class="error" id="error"></div><div class="actions">
      <button id="extend" autofocus><span class="spinner"></span><span>Extend</span></button>
      <button id="skip"><span class="spinner"></span><span>${skipLabel}</span></button></div></main><script>
      let pending=false;const buttons=[document.getElementById('extend'),document.getElementById('skip')];
      function submit(action){if(pending)return;pending=true;buttons.forEach(button=>button.disabled=true);
        const button=document.getElementById(action);button.classList.add('pending');button.querySelector('span:last-child').textContent=action==='extend'?'Opening...':'${final ? 'Ending...' : 'Returning...'}';
        location.href='nxgs-warning://'+action}
      buttons[0].onclick=()=>submit('extend');buttons[1].onclick=()=>submit('skip');
      let selected=0,lastAccept=false,lastBack=false,lastLeft=false,lastRight=false;
      function select(index){selected=index;buttons[selected].focus()}
      addEventListener('keydown',event=>{if(pending)return;if(['ArrowLeft','ArrowRight','Enter','Escape'].includes(event.key))event.preventDefault();
        if(event.key==='ArrowLeft')select(0);else if(event.key==='ArrowRight')select(1);else if(event.key==='Enter')buttons[selected].click();else if(event.key==='Escape')buttons[1].click()});
      function pollGamepad(){const pad=navigator.getGamepads?.()[0];if(pad&&!pending){const accept=Boolean(pad.buttons[0]?.pressed);const back=Boolean(pad.buttons[1]?.pressed);
        const left=Boolean(pad.buttons[14]?.pressed)||(pad.axes[0]??0)<-.6;const right=Boolean(pad.buttons[15]?.pressed)||(pad.axes[0]??0)>.6;
        if(accept&&!lastAccept)buttons[selected].click();else if(back&&!lastBack)buttons[1].click();else if(left&&!lastLeft)select(0);else if(right&&!lastRight)select(1);
        lastAccept=accept;lastBack=back;lastLeft=left;lastRight=right}requestAnimationFrame(pollGamepad)}pollGamepad();
      window.resetWarning=(message)=>{pending=false;buttons.forEach(button=>{button.disabled=false;button.classList.remove('pending')});
        buttons[0].querySelector('span:last-child').textContent='Extend';buttons[1].querySelector('span:last-child').textContent='${skipLabel}';document.getElementById('error').textContent=message};
    </script></body></html>`;
  }
}
