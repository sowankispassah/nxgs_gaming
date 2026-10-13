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
    const width = 720;
    const height = 350;
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
    const glyph = (symbol: string): string => `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5" fill="rgba(10,14,22,.55)" stroke="rgba(255,255,255,.55)" stroke-width="1"/>${symbol}</svg>`;
    const cross = glyph('<path d="M8.4 8.4 15.6 15.6M15.6 8.4 8.4 15.6" fill="none" stroke="#7da9ff" stroke-width="2" stroke-linecap="round"/>');
    const circle = glyph('<circle cx="12" cy="12" r="4.4" fill="none" stroke="#ff6b7d" stroke-width="2"/>');
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      *{box-sizing:border-box}html,body{margin:0;height:100%;background:transparent;color:#fff;overflow:hidden;cursor:default;user-select:none;
        font-family:'Segoe UI Variable Display','Segoe UI',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
      .panel{position:absolute;inset:30px;display:flex;flex-direction:column;padding:28px 32px 24px;
        border:1px solid rgba(255,255,255,.1);border-radius:24px;background:linear-gradient(180deg,#262b38 0%,#1b1f29 100%);
        box-shadow:0 14px 30px -14px rgba(0,0,0,.7),0 0 24px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.06);
        animation:enter .24s cubic-bezier(.22,1,.36,1) both}
      .head{display:flex;align-items:flex-start;gap:18px}.copy{min-width:0}
      .icon{flex:none;width:52px;height:52px;display:grid;place-items:center;border-radius:50%;background:rgba(255,191,71,.16);color:#ffbf47}
      .final .icon{background:rgba(255,79,99,.16);color:#ff6b7d}.icon svg{width:28px;height:28px}
      .eyebrow{color:rgba(232,237,247,.5);font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase}
      h1{margin:6px 0 0;font-size:26px;font-weight:600;letter-spacing:-.01em;line-height:1.2}
      p{margin:10px 0 0;color:rgba(232,237,247,.74);font-size:16px;line-height:1.5}
      .error{min-height:20px;margin-top:6px;color:#ff8d9b;font-size:14px;font-weight:500}
      .bar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:auto;padding-top:14px}
      .hints{display:flex;gap:18px;color:rgba(232,237,247,.62);font-size:13px;font-weight:500;white-space:nowrap}
      .hint{display:inline-flex;align-items:center;gap:7px}.hint svg{width:22px;height:22px}
      .actions{display:flex;gap:12px}
      button{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-width:150px;height:52px;padding:0 26px;
        border:0;border-radius:14px;background:rgba(255,255,255,.12);color:#fff;font-family:inherit;font-size:17px;font-weight:600;line-height:1;
        cursor:pointer;transition:background-color .14s,color .14s,box-shadow .14s}
      button:hover{background:rgba(255,255,255,.18)}button:focus{outline:none}
      button.selected,button:focus-visible{background:#fff;color:#0b0f17;box-shadow:0 0 0 3px #fff,0 0 22px 3px rgba(255,255,255,.32)}
      button:disabled{cursor:wait}button.pending{background:#fff;color:#0b0f17}
      button:disabled:not(.pending){background:rgba(255,255,255,.12);color:#fff;box-shadow:none;opacity:.5}
      .spinner{display:none;width:18px;height:18px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin .8s linear infinite}
      .pending .spinner{display:inline-block}@keyframes spin{to{transform:rotate(360deg)}}@keyframes enter{from{opacity:0;transform:scale(.96)}}
    </style></head><body class="${final ? 'final' : ''}"><main class="panel" role="alertdialog" aria-labelledby="title"><div class="head">
      <div class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2h4M12 14l3-3"/><circle cx="12" cy="14" r="8"/></svg></div>
      <div class="copy"><div class="eyebrow">Paid session warning</div><h1 id="title">${title}</h1><p>${message}</p><div class="error" id="error"></div></div></div>
      <div class="bar"><div class="hints"><span class="hint">${cross}Select</span><span class="hint">${circle}${skipLabel}</span></div><div class="actions">
      <button id="extend" class="selected" autofocus><span class="spinner"></span><span>Extend</span></button>
      <button id="skip"><span class="spinner"></span><span>${skipLabel}</span></button></div></div></main><script>
      let pending=false;const buttons=[document.getElementById('extend'),document.getElementById('skip')];
      function submit(action){if(pending)return;pending=true;buttons.forEach(button=>button.disabled=true);
        const button=document.getElementById(action);button.classList.add('pending');button.querySelector('span:last-child').textContent=action==='extend'?'Opening...':'${final ? 'Ending...' : 'Returning...'}';
        location.href='nxgs-warning://'+action}
      buttons[0].onclick=()=>submit('extend');buttons[1].onclick=()=>submit('skip');
      let selected=0,lastAccept=false,lastBack=false,lastLeft=false,lastRight=false;
      function select(index){selected=index;buttons.forEach((button,i)=>button.classList.toggle('selected',i===index));buttons[selected].focus()}
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
