import { useEffect, useState } from 'react';
import { FileUp, LoaderCircle, Power, RefreshCw, Save } from 'lucide-react';
import type { AppDiagnostics, AppSettings, InitialData } from '../../../shared/types';
import { BrandLogo } from '../BrandLogo';

export function BrandingSettingsPanel(props: {
  settings: AppSettings;
  onSettingsChanged: (settings: AppSettings) => void;
}): JSX.Element {
  const [pendingAction, setPendingAction] = useState<'upload' | 'reset' | null>(null);
  const [message, setMessage] = useState('');

  const saveLogoPath = async (logoPath: string): Promise<void> => {
    const next = await window.nxgs.updateSettings({
      ...props.settings,
      branding: { logoPath }
    });
    props.onSettingsChanged(next);
  };

  const chooseLogo = async (): Promise<void> => {
    if (pendingAction) return;
    setPendingAction('upload');
    setMessage('');
    try {
      const selected = await window.nxgs.selectBrandLogo();
      if (selected.canceled) return;
      if (selected.error || !selected.path) {
        throw new Error(selected.error ?? 'No logo image was selected.');
      }
      await saveLogoPath(selected.path);
      setMessage('Saved NXGS logo. Branding updated across the launcher.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  };

  const resetLogo = async (): Promise<void> => {
    if (pendingAction) return;
    setPendingAction('reset');
    setMessage('');
    try {
      await saveLogoPath('');
      setMessage('Restored the built-in NXGS logo.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <section className="panel narrow-panel branding-panel">
      <p className="eyebrow">Launcher identity</p>
      <h2>NXGS logo</h2>
      <p className="muted">
        This logo is shown on the Home tile, launcher navigation, loading screens, and admin branding.
      </p>
      <div className="branding-preview">
        <BrandLogo className="branding-preview-logo" logoPath={props.settings.branding.logoPath} />
        <div>
          <strong>Current logo</strong>
          <span>{props.settings.branding.logoPath ? 'Custom logo stored in NXGS app data' : 'Built-in NXGS logo'}</span>
        </div>
      </div>
      {message && (
        <p className={message.startsWith('Saved') || message.startsWith('Restored') ? 'success-text' : 'error-text'} role="status">
          {message}
        </p>
      )}
      <div className="branding-actions">
        <button
          className="primary-action"
          type="button"
          disabled={pendingAction !== null}
          onClick={() => void chooseLogo()}
        >
          {pendingAction === 'upload' ? <LoaderCircle size={19} className="spin" /> : <FileUp size={19} />}
          {pendingAction === 'upload' ? 'Updating...' : 'Upload / Change Logo'}
        </button>
        {props.settings.branding.logoPath && (
          <button
            className="secondary-action"
            type="button"
            disabled={pendingAction !== null}
            onClick={() => void resetLogo()}
          >
            {pendingAction === 'reset' ? <LoaderCircle size={19} className="spin" /> : <RefreshCw size={19} />}
            {pendingAction === 'reset' ? 'Restoring...' : 'Use Built-in Logo'}
          </button>
        )}
      </div>
    </section>
  );
}

export function SessionSettings(props: {
  settings: AppSettings;
  onSettingsChanged: (settings: AppSettings) => void;
}): JSX.Element {
  const [pin, setPin] = useState(props.settings.adminPin);
  const [playAccessMode, setPlayAccessMode] = useState(props.settings.playAccessMode);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  return (
    <section className="panel narrow-panel">
      <p className="eyebrow">Session security</p>
      <h2>Session settings</h2>
      <div className="form-grid single">
        <fieldset className="play-access-options">
          <legend>Customer play access</legend>
          <label className={`play-access-option ${playAccessMode === 'paid' ? 'selected' : ''}`}>
            <input
              type="radio"
              name="play-access-mode"
              value="paid"
              checked={playAccessMode === 'paid'}
              onChange={() => setPlayAccessMode('paid')}
            />
            <span><strong>Require payment</strong><small>Customers select a plan and complete checkout before launching games.</small></span>
          </label>
          <label className={`play-access-option ${playAccessMode === 'free' ? 'selected' : ''}`}>
            <input
              type="radio"
              name="play-access-mode"
              value="free"
              checked={playAccessMode === 'free'}
              onChange={() => setPlayAccessMode('free')}
            />
            <span><strong>Allow free play</strong><small>Games launch immediately without opening the plan or payment pages.</small></span>
          </label>
        </fieldset>
        <label>
          <span>Admin PIN</span>
          <input value={pin} onChange={(event) => setPin(event.target.value)} />
        </label>
        <p className="field-note">Play durations and prices are managed from Plan Manager.</p>
      </div>
      {message && <p className={message.startsWith('Saved') ? 'success-text' : 'error-text'}>{message}</p>}
      <button
        className="primary-action wide"
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setMessage('');
          try {
            const next: AppSettings = {
              ...props.settings,
              adminPin: pin,
              playAccessMode
            };
            props.onSettingsChanged(await window.nxgs.updateSettings(next));
            setMessage('Saved settings.');
          } catch (error) {
            setMessage(error instanceof Error ? error.message : String(error));
          } finally {
            setPending(false);
          }
        }}
      >
        <Save size={19} />
        {pending ? 'Saving...' : 'Save Settings'}
      </button>
    </section>
  );
}

export function KioskSettingsPanel(props: {
  settings: AppSettings;
  initialData: InitialData;
  onSettingsChanged: (settings: AppSettings) => void;
}): JSX.Element {
  const [settings, setSettings] = useState(props.settings);
  const [diagnostics, setDiagnostics] = useState<AppDiagnostics>(props.initialData.diagnostics);
  const [exitPin, setExitPin] = useState('');
  const [pending, setPending] = useState(false);
  const [pendingDiagnostics, setPendingDiagnostics] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [message, setMessage] = useState('');

  const refreshDiagnostics = async (): Promise<void> => {
    setPendingDiagnostics(true);
    try {
      setDiagnostics(await window.nxgs.getDiagnostics());
    } finally {
      setPendingDiagnostics(false);
    }
  };

  useEffect(() => {
    void refreshDiagnostics();
    const interval = window.setInterval(() => {
      void window.nxgs.getDiagnostics().then(setDiagnostics);
    }, 3000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <section className="panel narrow-panel">
      <p className="eyebrow">Best effort lockdown</p>
      <h2>Kiosk behavior</h2>
      <div className="toggle-stack">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.kiosk.alwaysOnTop}
            onChange={(event) => setSettings({ ...settings, kiosk: { ...settings.kiosk, alwaysOnTop: event.target.checked } })}
          />
          <span>Always on top</span>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.kiosk.preventClose}
            onChange={(event) => setSettings({ ...settings, kiosk: { ...settings.kiosk, preventClose: event.target.checked } })}
          />
          <span>Require admin PIN to close</span>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.kiosk.refocusOnBlur}
            onChange={(event) => setSettings({ ...settings, kiosk: { ...settings.kiosk, refocusOnBlur: event.target.checked } })}
          />
          <span>Refocus NXGS Play when idle</span>
        </label>
        <label>
          <span>Hide cursor after seconds</span>
          <input
            type="number"
            min={0}
            value={settings.kiosk.hideCursorAfterSeconds}
            onChange={(event) =>
              setSettings({
                ...settings,
                kiosk: { ...settings.kiosk, hideCursorAfterSeconds: Number(event.target.value) }
              })
            }
          />
        </label>
      </div>
      {message && <p className={message.startsWith('Saved') ? 'success-text' : 'error-text'}>{message}</p>}
      <button
        className="primary-action wide"
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setMessage('');
          try {
            props.onSettingsChanged(await window.nxgs.updateSettings(settings));
            setMessage('Saved kiosk settings.');
          } catch (error) {
            setMessage(error instanceof Error ? error.message : String(error));
          } finally {
            setPending(false);
          }
        }}
      >
        <Save size={19} />
        {pending ? 'Saving...' : 'Save Kiosk Settings'}
      </button>

      <div className="storage-block">
        <strong>Local storage</strong>
        <span>{props.initialData.dataPath}</span>
        <span>{props.initialData.logsPath}</span>
      </div>

      <div className="diagnostics-block">
        <div className="diagnostics-header">
          <strong>Diagnostics</strong>
          <button className="secondary-action" type="button" disabled={pendingDiagnostics} onClick={refreshDiagnostics}>
            <RefreshCw size={16} />
            {pendingDiagnostics ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        <div className="diagnostics-grid">
          <DiagnosticItem label="Current mode" value={diagnostics.kiosk.mode} />
          <DiagnosticItem label="Ctrl + Shift + H" value={diagnostics.shortcuts.homeRegistered ? 'yes' : 'no'} />
          <DiagnosticItem label="F10" value={diagnostics.shortcuts.f10Registered ? 'yes' : 'no'} />
          <DiagnosticItem label="Ctrl + Shift + X" value={diagnostics.shortcuts.emergencyCloseRegistered ? 'yes' : 'no'} />
          <DiagnosticItem label="Ctrl + Shift + A" value={diagnostics.shortcuts.adminUnlockRegistered ? 'yes' : 'no'} />
          <DiagnosticItem label="Restricted shortcuts" value={diagnostics.shortcuts.restrictedRegisteredCount.toString()} />
          <DiagnosticItem label="Controller detected" value={diagnostics.controller.detected ? 'yes' : 'no'} />
          <DiagnosticItem label="Controller name" value={diagnostics.controller.name ?? 'none'} />
          <DiagnosticItem label="Controller Home" value={diagnostics.controller.homeSupported} />
          <DiagnosticItem label="Last controller button" value={diagnostics.controller.lastButtonPressed ?? 'none'} />
          <DiagnosticItem label="Last controller action" value={diagnostics.controller.lastNavigationAction ?? 'none'} />
          <DiagnosticItem label="Game controller bridge" value={diagnostics.controllerCompatibility.status} />
          <DiagnosticItem label="Virtual controller driver" value={diagnostics.controllerCompatibility.driverInstalled ? 'installed' : 'missing'} />
          <DiagnosticItem label="Controller mapper" value={diagnostics.controllerCompatibility.mapperRunning ? 'running' : 'stopped'} />
          <DiagnosticItem label="XInput ready" value={diagnostics.controllerCompatibility.xinputReady ? 'yes' : 'no'} />
          <DiagnosticItem label="Controller bridge detail" value={diagnostics.controllerCompatibility.message ?? 'none'} />
          <DiagnosticItem label="Active game state" value={diagnostics.activeGame.status} />
          <DiagnosticItem label="Current game" value={diagnostics.activeGame.title ?? 'none'} />
          <DiagnosticItem label="Game process ID" value={diagnostics.activeGame.processId?.toString() ?? 'none'} />
          <DiagnosticItem label="Game window handle" value={diagnostics.activeGame.windowHandle?.toString() ?? 'none'} />
          <DiagnosticItem label="Game window detected" value={diagnostics.activeGame.windowDetected ? 'yes' : 'no'} />
          <DiagnosticItem label="Game state" value={diagnostics.activeGame.windowState ?? 'unknown'} />
          <DiagnosticItem label="Last Home result" value={diagnostics.activeGame.lastHomeResult ?? 'none'} />
          <DiagnosticItem label="Last Resume result" value={diagnostics.activeGame.lastResumeResult ?? 'none'} />
          <DiagnosticItem label="Last handoff error" value={diagnostics.activeGame.lastError ?? 'none'} />
          <DiagnosticItem label="NXGS visible" value={diagnostics.kiosk.launcherVisible ? 'yes' : 'no'} />
          <DiagnosticItem label="System bar hidden" value={diagnostics.kiosk.taskbarHidden ? 'yes' : 'no'} />
          <DiagnosticItem label="Always on top" value={diagnostics.kiosk.alwaysOnTop ? 'yes' : 'no'} />
          <DiagnosticItem label="Last Home trigger" value={diagnostics.kiosk.lastHomeTrigger ?? 'none'} />
          <DiagnosticItem label="Last restricted input" value={diagnostics.kiosk.lastRestrictedInput ?? 'none'} />
          <DiagnosticItem label="Last input error" value={diagnostics.kiosk.lastInputError ?? 'none'} />
        </div>
        <p className="field-note">
          Controller Home support depends on the connected controller. Ctrl+Shift+H and F10 are test fallbacks; production
          lockdown depends on the configured device policy.
        </p>
        {diagnostics.shortcuts.failures.length > 0 && (
          <div className="diagnostics-warning">
            {diagnostics.shortcuts.failures.map((failure) => (
              <span key={failure}>{failure}</span>
            ))}
          </div>
        )}
      </div>

      <div className="danger-zone">
        <label>
          <span>PIN to exit application</span>
          <input value={exitPin} onChange={(event) => setExitPin(event.target.value)} />
        </label>
        <button
          className="danger-action"
          type="button"
          disabled={exiting}
          onClick={async () => {
            setExiting(true);
            const result = await window.nxgs.exitApp(exitPin);
            if (!result.ok) {
              setMessage('Invalid admin PIN.');
              setExiting(false);
            }
          }}
        >
          <Power size={19} />
          {exiting ? 'Exiting...' : 'Exit NXGS Play'}
        </button>
      </div>
    </section>
  );
}

function DiagnosticItem(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="diagnostic-item">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}
