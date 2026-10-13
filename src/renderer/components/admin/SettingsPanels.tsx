import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  FileUp,
  FolderOpen,
  Gamepad2,
  Info,
  KeyRound,
  LoaderCircle,
  Power,
  QrCode,
  RefreshCw,
  Save
} from 'lucide-react';
import type { AppDiagnostics, AppSettings, InitialData, KioskSettings } from '../../../shared/types';
import { BrandLogo } from '../BrandLogo';
import { CardHeader, Notice, SwitchRow } from './AdminKit';

const LOGO_PLACEMENTS = ['Home tile', 'Navigation', 'Loading screens', 'Control Room'];

export function BrandingSettingsPanel(props: {
  settings: AppSettings;
  onSettingsChanged: (settings: AppSettings) => void;
}): JSX.Element {
  const [pendingAction, setPendingAction] = useState<'upload' | 'reset' | null>(null);
  const [message, setMessage] = useState('');
  const customLogo = Boolean(props.settings.branding.logoPath);

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
    <div className="admin-stack">
      <section className="admin-card branding-panel">
        <CardHeader
          eyebrow="Launcher identity"
          title="NXGS logo"
          subtitle="This logo is shown on the Home tile, launcher navigation, loading screens, and admin branding."
        />
        <div className="branding-preview">
          <div className="branding-stage">
            <BrandLogo className="branding-preview-logo" logoPath={props.settings.branding.logoPath} />
          </div>
          <div className="branding-details">
            <span className={`ps-chip ${customLogo ? 'ps-chip--accent' : ''}`}>{customLogo ? 'Custom logo' : 'Default logo'}</span>
            <strong>Current logo</strong>
            <span className="branding-source">
              {props.settings.branding.logoPath ? 'Custom logo stored in NXGS app data' : 'Built-in NXGS logo'}
            </span>
            <div className="branding-usage" aria-label="Where the logo appears">
              {LOGO_PLACEMENTS.map((placement) => (
                <span key={placement} className="ps-chip">{placement}</span>
              ))}
            </div>
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
          </div>
        </div>
        {message && (
          <Notice tone={message.startsWith('Saved') || message.startsWith('Restored') ? 'success' : 'error'}>{message}</Notice>
        )}
        <p className="field-note">PNG, JPG or WebP. Square artwork on a dark background looks best on the Home tile.</p>
      </section>
    </div>
  );
}

export function SessionSettings(props: {
  settings: AppSettings;
  onSettingsChanged: (settings: AppSettings) => void;
  onOpenPlans?: () => void;
}): JSX.Element {
  const [pin, setPin] = useState(props.settings.adminPin);
  const [playAccessMode, setPlayAccessMode] = useState(props.settings.playAccessMode);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  return (
    <div className="admin-stack">
      <section className="admin-card">
        <CardHeader
          eyebrow="Session security"
          title="Customer play access"
          subtitle="Choose what happens when a customer starts a game."
        />
        <fieldset className="play-access-options">
          <legend className="admin-visually-hidden">Customer play access</legend>
          <label className={`play-access-option ${playAccessMode === 'paid' ? 'selected' : ''}`}>
            <input
              type="radio"
              name="play-access-mode"
              value="paid"
              checked={playAccessMode === 'paid'}
              onChange={() => setPlayAccessMode('paid')}
            />
            <span className="play-access-icon" aria-hidden="true"><QrCode size={24} /></span>
            <span className="play-access-copy"><strong>Require payment</strong><small>Customers select a plan and complete checkout before launching games.</small></span>
          </label>
          <label className={`play-access-option ${playAccessMode === 'free' ? 'selected' : ''}`}>
            <input
              type="radio"
              name="play-access-mode"
              value="free"
              checked={playAccessMode === 'free'}
              onChange={() => setPlayAccessMode('free')}
            />
            <span className="play-access-icon" aria-hidden="true"><Gamepad2 size={24} /></span>
            <span className="play-access-copy"><strong>Allow free play</strong><small>Games launch immediately without opening the plan or payment pages.</small></span>
          </label>
        </fieldset>
        <div className="admin-inline-note">
          <Info size={18} aria-hidden="true" />
          <p className="field-note">Play durations and prices are managed from Plan Manager.</p>
          {props.onOpenPlans && (
            <button className="secondary-action compact" type="button" onClick={props.onOpenPlans}>
              Open Plan Manager
              <ArrowRight size={16} />
            </button>
          )}
        </div>
      </section>

      <section className="admin-card">
        <CardHeader
          icon={<KeyRound size={22} />}
          title="Admin PIN"
          subtitle="Unlocks the Control Room and other staff-only actions on this station."
        />
        <label className="admin-field admin-pin-field">
          <span className="admin-field-label">Admin PIN</span>
          <input value={pin} autoComplete="off" onChange={(event) => setPin(event.target.value)} />
        </label>
      </section>

      <div className="admin-save-bar">
        {message ? <Notice tone={message.startsWith('Saved') ? 'success' : 'error'}>{message}</Notice> : <span aria-hidden="true" />}
        <button
          className="primary-action"
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
          {pending ? <LoaderCircle className="spin" size={19} /> : <Save size={19} />}
          {pending ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
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
  const [exitMessage, setExitMessage] = useState('');

  const updateKiosk = <K extends keyof KioskSettings>(key: K, value: KioskSettings[K]): void => {
    setSettings((current) => ({ ...current, kiosk: { ...current.kiosk, [key]: value } }));
  };

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

  const exitApplication = async (): Promise<void> => {
    setExiting(true);
    setExitMessage('');
    try {
      const result = await window.nxgs.exitApp(exitPin);
      if (!result.ok) {
        setExitMessage('Invalid admin PIN.');
        setExiting(false);
      }
    } catch (error) {
      setExitMessage(error instanceof Error ? error.message : String(error));
      setExiting(false);
    }
  };

  return (
    <div className="admin-columns admin-columns--kiosk">
      <div className="admin-stack">
        <section className="admin-card kiosk-behavior-panel">
          <CardHeader
            eyebrow="Best effort lockdown"
            title="Kiosk behavior"
            subtitle="How NXGS Play holds the screen while customers use this station."
          />
          <div className="admin-switch-list">
            <SwitchRow
              label="Always on top"
              description="Keep NXGS Play above other apps."
              checked={settings.kiosk.alwaysOnTop}
              onChange={(checked) => updateKiosk('alwaysOnTop', checked)}
            />
            <SwitchRow
              label="Require admin PIN to close"
              description="Closing NXGS Play asks for the admin PIN."
              checked={settings.kiosk.preventClose}
              onChange={(checked) => updateKiosk('preventClose', checked)}
            />
            <SwitchRow
              label="Refocus NXGS Play when idle"
              description="Bring the launcher back to the front when it loses focus."
              checked={settings.kiosk.refocusOnBlur}
              onChange={(checked) => updateKiosk('refocusOnBlur', checked)}
            />
            <label className="admin-value-row">
              <span className="admin-switch-copy">
                <strong>Hide cursor after seconds</strong>
                <small>Idle seconds before the pointer hides. 0 keeps it visible.</small>
              </span>
              <span className="admin-affix-input admin-seconds-input">
                <input
                  type="number"
                  min={0}
                  value={settings.kiosk.hideCursorAfterSeconds}
                  onChange={(event) => updateKiosk('hideCursorAfterSeconds', Number(event.target.value))}
                />
                <em>sec</em>
              </span>
            </label>
          </div>
          <footer className="admin-card-footer admin-card-footer--stacked">
            {message && <Notice tone={message.startsWith('Saved') ? 'success' : 'error'}>{message}</Notice>}
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
              {pending ? <LoaderCircle className="spin" size={19} /> : <Save size={19} />}
              {pending ? 'Saving...' : 'Save Kiosk Settings'}
            </button>
          </footer>
        </section>

        <section className="admin-card storage-block">
          <CardHeader icon={<FolderOpen size={20} />} title="Local storage" subtitle="Where NXGS Play keeps its data on this station." />
          <dl className="admin-meta-list storage-list">
            <div>
              <dt>Data</dt>
              <dd><code>{props.initialData.dataPath}</code></dd>
            </div>
            <div>
              <dt>Logs</dt>
              <dd><code>{props.initialData.logsPath}</code></dd>
            </div>
          </dl>
        </section>

        <section className="admin-card danger-zone">
          <CardHeader
            icon={<Power size={20} />}
            eyebrow="Danger zone"
            title="Exit NXGS Play"
            subtitle="Closes the launcher on this station until it is started again."
          />
          <form
            className="danger-zone-form"
            onSubmit={(event) => {
              event.preventDefault();
              void exitApplication();
            }}
          >
            <label className="admin-field">
              <span className="admin-field-label">PIN to exit application</span>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={exitPin}
                onChange={(event) => setExitPin(event.target.value)}
              />
            </label>
            <button className="danger-action" type="submit" disabled={exiting}>
              {exiting ? <LoaderCircle className="spin" size={19} /> : <Power size={19} />}
              {exiting ? 'Exiting...' : 'Exit NXGS Play'}
            </button>
          </form>
          {exitMessage && <Notice tone="error">{exitMessage}</Notice>}
        </section>
      </div>

      <section className="admin-card diagnostics-block">
        <CardHeader
          eyebrow="Station health"
          title="Diagnostics"
          subtitle={(
            <span className="diagnostics-live">
              <i aria-hidden="true" />
              Live · refreshes every 3 seconds
            </span>
          )}
          actions={(
            <button className="secondary-action compact" type="button" disabled={pendingDiagnostics} onClick={() => void refreshDiagnostics()}>
              <RefreshCw size={16} className={pendingDiagnostics ? 'spin' : undefined} />
              {pendingDiagnostics ? 'Refreshing...' : 'Refresh'}
            </button>
          )}
        />
        {diagnostics.shortcuts.failures.length > 0 && (
          <div className="diagnostics-warning" role="alert">
            {diagnostics.shortcuts.failures.map((failure) => (
              <Notice key={failure} tone="warning">{failure}</Notice>
            ))}
          </div>
        )}
        <DiagnosticGroup title="Kiosk">
          <DiagnosticItem label="Current mode" value={diagnostics.kiosk.mode} />
          <DiagnosticItem label="NXGS visible" value={diagnostics.kiosk.launcherVisible ? 'yes' : 'no'} />
          <DiagnosticItem label="System bar hidden" value={diagnostics.kiosk.taskbarHidden ? 'yes' : 'no'} />
          <DiagnosticItem label="Always on top" value={diagnostics.kiosk.alwaysOnTop ? 'yes' : 'no'} />
          <DiagnosticItem label="Last Home trigger" value={diagnostics.kiosk.lastHomeTrigger ?? 'none'} />
          <DiagnosticItem label="Last restricted input" value={diagnostics.kiosk.lastRestrictedInput ?? 'none'} />
          <DiagnosticItem label="Last input error" value={diagnostics.kiosk.lastInputError ?? 'none'} />
        </DiagnosticGroup>
        <DiagnosticGroup title="Shortcuts">
          <DiagnosticItem label="Ctrl + Shift + H" value={diagnostics.shortcuts.homeRegistered ? 'yes' : 'no'} />
          <DiagnosticItem label="F10" value={diagnostics.shortcuts.f10Registered ? 'yes' : 'no'} />
          <DiagnosticItem label="Ctrl + Shift + X" value={diagnostics.shortcuts.emergencyCloseRegistered ? 'yes' : 'no'} />
          <DiagnosticItem label="Ctrl + Shift + A" value={diagnostics.shortcuts.adminUnlockRegistered ? 'yes' : 'no'} />
          <DiagnosticItem label="Restricted shortcuts" value={diagnostics.shortcuts.restrictedRegisteredCount.toString()} />
        </DiagnosticGroup>
        <DiagnosticGroup title="Controller">
          <DiagnosticItem label="Controller detected" value={diagnostics.controller.detected ? 'yes' : 'no'} />
          <DiagnosticItem label="Controller name" value={diagnostics.controller.name ?? 'none'} />
          <DiagnosticItem label="Controller Home" value={diagnostics.controller.homeSupported} />
          <DiagnosticItem label="Last controller button" value={diagnostics.controller.lastButtonPressed ?? 'none'} />
          <DiagnosticItem label="Last controller action" value={diagnostics.controller.lastNavigationAction ?? 'none'} />
        </DiagnosticGroup>
        <DiagnosticGroup title="Controller bridge">
          <DiagnosticItem label="Game controller bridge" value={diagnostics.controllerCompatibility.status} />
          <DiagnosticItem label="Virtual controller driver" value={diagnostics.controllerCompatibility.driverInstalled ? 'installed' : 'missing'} />
          <DiagnosticItem label="Controller mapper" value={diagnostics.controllerCompatibility.mapperRunning ? 'running' : 'stopped'} />
          <DiagnosticItem label="XInput ready" value={diagnostics.controllerCompatibility.xinputReady ? 'yes' : 'no'} />
          <DiagnosticItem label="Controller bridge detail" value={diagnostics.controllerCompatibility.message ?? 'none'} />
        </DiagnosticGroup>
        <DiagnosticGroup title="Active game">
          <DiagnosticItem label="Active game state" value={diagnostics.activeGame.status} />
          <DiagnosticItem label="Current game" value={diagnostics.activeGame.title ?? 'none'} />
          <DiagnosticItem label="Game process ID" value={diagnostics.activeGame.processId?.toString() ?? 'none'} />
          <DiagnosticItem label="Game window handle" value={diagnostics.activeGame.windowHandle?.toString() ?? 'none'} />
          <DiagnosticItem label="Game window detected" value={diagnostics.activeGame.windowDetected ? 'yes' : 'no'} />
          <DiagnosticItem label="Game state" value={diagnostics.activeGame.windowState ?? 'unknown'} />
          <DiagnosticItem label="Last Home result" value={diagnostics.activeGame.lastHomeResult ?? 'none'} />
          <DiagnosticItem label="Last Resume result" value={diagnostics.activeGame.lastResumeResult ?? 'none'} />
          <DiagnosticItem label="Last handoff error" value={diagnostics.activeGame.lastError ?? 'none'} />
        </DiagnosticGroup>
        <p className="field-note diagnostics-note">
          Controller Home support depends on the connected controller. Ctrl+Shift+H and F10 are test fallbacks; production
          lockdown depends on the configured device policy.
        </p>
      </section>
    </div>
  );
}

const GOOD_DIAGNOSTIC_VALUES = new Set(['yes', 'installed', 'running', 'ready']);
const WARN_DIAGNOSTIC_VALUES = new Set(['no', 'missing', 'stopped', 'driverRequired', 'unavailable']);
const BAD_DIAGNOSTIC_VALUES = new Set(['error']);
const EMPTY_DIAGNOSTIC_VALUES = new Set(['none', 'unknown']);

function diagnosticTone(value: string): 'good' | 'warn' | 'bad' | 'empty' | 'neutral' {
  if (GOOD_DIAGNOSTIC_VALUES.has(value)) return 'good';
  if (WARN_DIAGNOSTIC_VALUES.has(value)) return 'warn';
  if (BAD_DIAGNOSTIC_VALUES.has(value)) return 'bad';
  if (EMPTY_DIAGNOSTIC_VALUES.has(value)) return 'empty';
  return 'neutral';
}

function DiagnosticGroup(props: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="diagnostics-group">
      <h3 className="admin-section-title">{props.title}</h3>
      <div className="diagnostics-grid">{props.children}</div>
    </section>
  );
}

function DiagnosticItem(props: { label: string; value: string }): JSX.Element {
  const tone = diagnosticTone(props.value);
  return (
    <div className={`diagnostic-item diagnostic-item--${tone}${props.value.length > 26 ? ' wide' : ''}`}>
      <span>{props.label}</span>
      <strong title={props.value}>
        {(tone === 'good' || tone === 'warn' || tone === 'bad') && <i className="diagnostic-dot" aria-hidden="true" />}
        {props.value}
      </strong>
    </div>
  );
}
