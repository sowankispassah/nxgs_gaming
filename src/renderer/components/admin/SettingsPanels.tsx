import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, FileUp, LoaderCircle, Lock, Power, RefreshCw, RotateCcw } from 'lucide-react';
import type { AppDiagnostics, AppSettings, InitialData, KioskSettings } from '../../../shared/types';
import { BrandLogo } from '../BrandLogo';
import { Badge, Notice, PageSection, Panel, StatusText, SwitchRow, type Tone } from './AdminKit';

/*
 * This device's settings pages (Sessions, Branding, Kiosk). Each page is a
 * stack of PageSections; a section holds one panel of hairline rows
 * (Panel padding="rows") whose rows put the label and description on the left
 * and the control on the right (kit SwitchRow / .admin-value-row).
 */

/** A settings row with a non-switch control: copy on the left, the control on the right. */
function SettingRow(props: { label: ReactNode; description?: ReactNode; children?: ReactNode; className?: string }): JSX.Element {
  return (
    <div className={`admin-value-row${props.className ? ` ${props.className}` : ''}`}>
      <span className="admin-switch-copy">
        <strong>{props.label}</strong>
        {props.description && <small>{props.description}</small>}
      </span>
      {props.children}
    </div>
  );
}

/** Feedback on the left, the save button on the right: the footer of a settings panel, or (`page`) under several sections. */
function SaveBar(props: { message: string; ok: boolean; children: ReactNode; page?: boolean }): JSX.Element {
  const feedback = props.message ? <Notice tone={props.ok ? 'success' : 'error'}>{props.message}</Notice> : <span aria-hidden="true" />;
  return props.page ? (
    <div className="settings-save">{feedback}{props.children}</div>
  ) : (
    <footer className="admin-panel-footer">{feedback}{props.children}</footer>
  );
}

// ------------------------------------------------------------------ branding

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
      <PageSection
        title="Logo"
        description="Shown on the Home tile, launcher navigation, loading screens and the Control Room."
      >
        <Panel className="branding-panel">
          <div className="branding-row">
            <div className="branding-preview">
              <BrandLogo className="branding-preview-logo" logoPath={props.settings.branding.logoPath} />
            </div>
            <div className="branding-copy">
              <span className="branding-title">
                <strong>{customLogo ? 'Custom logo' : 'Built-in NXGS logo'}</strong>
                <Badge>{customLogo ? 'Custom' : 'Default'}</Badge>
              </span>
              <span className="admin-text-2">
                {customLogo ? 'Stored in NXGS app data on this device.' : 'Ships with NXGS Play.'}
              </span>
              <span className="admin-caption">PNG, JPG or WebP. Square artwork on a dark background looks best on the Home tile.</span>
            </div>
            <div className="branding-actions">
              {customLogo && (
                <button
                  className="admin-btn admin-btn--ghost"
                  type="button"
                  disabled={pendingAction !== null}
                  onClick={() => void resetLogo()}
                >
                  {pendingAction === 'reset' ? <LoaderCircle size={15} className="spin" /> : <RotateCcw size={15} />}
                  {pendingAction === 'reset' ? 'Restoring...' : 'Use built-in logo'}
                </button>
              )}
              <button
                className="admin-btn"
                type="button"
                disabled={pendingAction !== null}
                onClick={() => void chooseLogo()}
              >
                {pendingAction === 'upload' ? <LoaderCircle size={15} className="spin" /> : <FileUp size={15} />}
                {pendingAction === 'upload' ? 'Updating...' : customLogo ? 'Replace logo' : 'Upload logo'}
              </button>
            </div>
          </div>
        </Panel>
        {message && (
          <Notice tone={message.startsWith('Saved') || message.startsWith('Restored') ? 'success' : 'error'}>{message}</Notice>
        )}
      </PageSection>
    </div>
  );
}

// ------------------------------------------------------------------ sessions

export function SessionSettings(props: {
  settings: AppSettings;
  /** Moderators unlock with their own PIN and must not see or change the device admin PIN. */
  adminRole?: 'admin' | 'moderator';
  onSettingsChanged: (settings: AppSettings) => void;
  onOpenPlans?: () => void;
}): JSX.Element {
  const isModerator = props.adminRole === 'moderator';
  const [pin, setPin] = useState(isModerator ? '' : props.settings.adminPin);
  const [playAccessMode, setPlayAccessMode] = useState(props.settings.playAccessMode);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  const save = async (): Promise<void> => {
    setPending(true);
    setMessage('');
    try {
      const next: AppSettings = {
        ...props.settings,
        // A moderator saves the existing PIN unchanged (main ignores it for moderators too).
        adminPin: isModerator ? props.settings.adminPin : pin,
        playAccessMode
      };
      props.onSettingsChanged(await window.nxgs.updateSettings(next));
      setMessage('Saved settings.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="admin-stack">
      <PageSection title="Customer play access" description="Choose what happens when a customer starts a game.">
        <Panel padding="rows">
          <fieldset className="settings-choices">
            <legend className="admin-visually-hidden">Customer play access</legend>
            <AccessOption
              value="paid"
              selected={playAccessMode}
              label="Require payment"
              description="Customers select a plan and complete checkout before launching games."
              onSelect={setPlayAccessMode}
            />
            <AccessOption
              value="free"
              selected={playAccessMode}
              label="Allow free play"
              description="Games launch immediately without opening the plan or payment pages."
              onSelect={setPlayAccessMode}
            />
          </fieldset>
        </Panel>
        <div className="settings-note">
          <p>Play durations and prices are managed from Plans.</p>
          {props.onOpenPlans && (
            <button className="admin-btn admin-btn--sm admin-btn--ghost" type="button" onClick={props.onOpenPlans}>
              Open Plans
              <ArrowRight size={14} />
            </button>
          )}
        </div>
      </PageSection>

      <PageSection title="Staff access">
        <Panel padding="rows">
          {isModerator ? (
            <SettingRow label="Admin PIN" description="Only the device admin can see or change the admin PIN.">
              <Badge className="settings-locked"><Lock size={12} aria-hidden="true" />Device admin only</Badge>
            </SettingRow>
          ) : (
            <label className="admin-value-row">
              <span className="admin-switch-copy">
                <strong>Admin PIN</strong>
                <small>Unlocks the Control Room and other staff-only actions on this device.</small>
              </span>
              <input className="settings-pin-input" value={pin} autoComplete="off" onChange={(event) => setPin(event.target.value)} />
            </label>
          )}
        </Panel>
      </PageSection>

      <SaveBar page message={message} ok={message.startsWith('Saved')}>
        <button className="admin-btn admin-btn--primary" type="button" disabled={pending} onClick={() => void save()}>
          {pending && <LoaderCircle className="spin" size={15} />}
          {pending ? 'Saving...' : 'Save settings'}
        </button>
      </SaveBar>
    </div>
  );
}

function AccessOption(props: {
  value: AppSettings['playAccessMode'];
  selected: AppSettings['playAccessMode'];
  label: string;
  description: string;
  onSelect: (value: AppSettings['playAccessMode']) => void;
}): JSX.Element {
  const checked = props.value === props.selected;
  return (
    <label className={`settings-choice${checked ? ' is-selected' : ''}`}>
      <input
        type="radio"
        name="play-access-mode"
        value={props.value}
        checked={checked}
        onChange={() => props.onSelect(props.value)}
      />
      <span className="admin-switch-copy">
        <strong>{props.label}</strong>
        <small>{props.description}</small>
      </span>
    </label>
  );
}

// --------------------------------------------------------------------- kiosk

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

  const saveKiosk = async (): Promise<void> => {
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
  };

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

  const { kiosk, shortcuts, controller, controllerCompatibility: bridge, activeGame } = diagnostics;
  // Lockdown flags only matter while customers are using the device.
  const lockdownTone: Tone = kiosk.mode === 'customer' ? 'warning' : 'neutral';

  return (
    <div className="admin-stack">
      <PageSection title="Kiosk behavior" description="How NXGS Play holds the screen while customers use this device.">
        <Panel padding="rows">
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
              <span className="admin-affix-input settings-seconds-input">
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
          <SaveBar message={message} ok={message.startsWith('Saved')}>
            <button className="admin-btn admin-btn--primary" type="button" disabled={pending} onClick={() => void saveKiosk()}>
              {pending && <LoaderCircle className="spin" size={15} />}
              {pending ? 'Saving...' : 'Save kiosk settings'}
            </button>
          </SaveBar>
        </Panel>
      </PageSection>

      <PageSection
        title="Diagnostics"
        description={(
          <span className="diagnostics-live">
            <StatusText tone="info">Live</StatusText>
            Refreshes every 3 seconds.
          </span>
        )}
        actions={(
          <button className="admin-btn admin-btn--sm" type="button" disabled={pendingDiagnostics} onClick={() => void refreshDiagnostics()}>
            <RefreshCw size={14} className={pendingDiagnostics ? 'spin' : undefined} />
            {pendingDiagnostics ? 'Refreshing...' : 'Refresh'}
          </button>
        )}
      >
        {shortcuts.failures.length > 0 && (
          <div className="diagnostics-warnings" role="alert">
            {shortcuts.failures.map((failure) => (
              <Notice key={failure} tone="warning">{failure}</Notice>
            ))}
          </div>
        )}
        <Panel className="diagnostics-panel">
          <div className="diagnostics-column">
            <DiagnosticGroup title="Kiosk">
              <DiagnosticItem label="Current mode" value={code(kiosk.mode)} />
              <DiagnosticItem label="NXGS visible" value={flag(kiosk.launcherVisible, 'warning')} />
              <DiagnosticItem label="System bar hidden" value={flag(kiosk.taskbarHidden, lockdownTone)} />
              <DiagnosticItem label="Always on top" value={flag(kiosk.alwaysOnTop, lockdownTone)} />
              <DiagnosticItem label="Last Home trigger" value={code(kiosk.lastHomeTrigger)} />
              <DiagnosticItem label="Last restricted input" value={text(kiosk.lastRestrictedInput)} />
              <DiagnosticItem label="Last input error" value={problem(kiosk.lastInputError)} />
            </DiagnosticGroup>
            <DiagnosticGroup title="Active game">
              <DiagnosticItem
                label="Active game state"
                value={status(activeGame.status, activeGameTone(activeGame.status))}
              />
              <DiagnosticItem label="Current game" value={text(activeGame.title)} />
              <DiagnosticItem label="Game process ID" value={text(activeGame.processId?.toString())} />
              <DiagnosticItem label="Game window handle" value={text(activeGame.windowHandle?.toString())} />
              <DiagnosticItem label="Game window detected" value={flag(activeGame.windowDetected, 'neutral')} />
              <DiagnosticItem label="Game state" value={code(activeGame.windowState === 'unknown' ? undefined : activeGame.windowState, 'Unknown')} />
              <DiagnosticItem label="Last Home result" value={text(activeGame.lastHomeResult)} />
              <DiagnosticItem label="Last resume result" value={text(activeGame.lastResumeResult)} />
              <DiagnosticItem label="Last handoff error" value={problem(activeGame.lastError)} />
            </DiagnosticGroup>
          </div>
          <div className="diagnostics-column">
            <DiagnosticGroup title="Shortcuts">
              <DiagnosticItem label={<Keys combo="Ctrl Shift H" />} value={registered(shortcuts.homeRegistered)} />
              <DiagnosticItem label={<Keys combo="F10" />} value={registered(shortcuts.f10Registered)} />
              <DiagnosticItem label={<Keys combo="Ctrl Shift X" />} value={registered(shortcuts.emergencyCloseRegistered)} />
              <DiagnosticItem label={<Keys combo="Ctrl Shift A" />} value={registered(shortcuts.adminUnlockRegistered)} />
              <DiagnosticItem label="Restricted shortcuts" value={text(shortcuts.restrictedRegisteredCount.toString())} />
            </DiagnosticGroup>
            <DiagnosticGroup title="Controller">
              <DiagnosticItem label="Controller detected" value={flag(controller.detected, 'warning')} />
              <DiagnosticItem label="Controller name" value={text(controller.name)} />
              <DiagnosticItem
                label="Controller Home"
                value={controller.homeSupported === 'unknown'
                  ? { text: 'Unknown', kind: 'empty' }
                  : status(controller.homeSupported === 'yes' ? 'Supported' : 'Not supported', controller.homeSupported === 'yes' ? 'success' : 'warning')}
              />
              <DiagnosticItem label="Last controller button" value={text(controller.lastButtonPressed)} />
              <DiagnosticItem label="Last controller action" value={code(controller.lastNavigationAction)} />
            </DiagnosticGroup>
            <DiagnosticGroup title="Controller bridge">
              <DiagnosticItem label="Game controller bridge" value={status(bridge.status, bridgeTone(bridge.status))} />
              <DiagnosticItem
                label="Virtual controller driver"
                value={status(bridge.driverInstalled ? 'Installed' : 'Missing', bridge.driverInstalled ? 'success' : 'warning')}
              />
              <DiagnosticItem
                label="Controller mapper"
                value={status(bridge.mapperRunning ? 'Running' : 'Stopped', bridge.mapperRunning ? 'success' : 'neutral')}
              />
              <DiagnosticItem label="XInput ready" value={flag(bridge.xinputReady, 'neutral')} />
              <DiagnosticItem label="Controller bridge detail" value={text(bridge.message)} />
            </DiagnosticGroup>
          </div>
        </Panel>
        <p className="admin-caption diagnostics-note">
          Controller Home support depends on the connected controller. Ctrl+Shift+H and F10 are test fallbacks; production
          lockdown depends on the configured device policy.
        </p>
      </PageSection>

      <PageSection title="Local storage" description="Where NXGS Play keeps its data on this device.">
        <Panel padding="rows">
          <dl className="admin-meta-list admin-meta-list--left settings-paths">
            <div>
              <dt>Data</dt>
              <dd className="admin-mono">{props.initialData.dataPath}</dd>
            </div>
            <div>
              <dt>Logs</dt>
              <dd className="admin-mono">{props.initialData.logsPath}</dd>
            </div>
          </dl>
        </Panel>
      </PageSection>

      <PageSection title="Danger zone">
        <Panel padding="rows" className="admin-danger-zone">
          <form
            className="admin-value-row danger-zone-row"
            onSubmit={(event) => {
              event.preventDefault();
              void exitApplication();
            }}
          >
            <span className="admin-switch-copy">
              <strong>Exit NXGS Play</strong>
              <small>Closes the launcher on this device until it is started again.</small>
            </span>
            <span className="admin-row-actions">
              <input
                className="settings-pin-input"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                placeholder="Admin PIN"
                aria-label="PIN to exit application"
                value={exitPin}
                onChange={(event) => setExitPin(event.target.value)}
              />
              <button className="admin-btn admin-btn--danger" type="submit" disabled={exiting}>
                {exiting ? <LoaderCircle className="spin" size={15} /> : <Power size={15} />}
                {exiting ? 'Exiting...' : 'Exit NXGS Play'}
              </button>
            </span>
          </form>
          {exitMessage && <Notice tone="error" className="danger-zone-notice">{exitMessage}</Notice>}
        </Panel>
      </PageSection>
    </div>
  );
}

// --------------------------------------------------------------- diagnostics

type DiagnosticValue =
  | { kind: 'status'; text: string; tone: Tone }
  | { kind: 'text'; text: string }
  | { kind: 'problem'; text: string }
  | { kind: 'empty'; text: string };

/** "driverRequired" -> "Driver required", "controller-home" -> "Controller home", "global-f10" -> "Global F10". */
function humanize(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((word) => (/^f\d+$/i.test(word) ? word.toUpperCase() : word.toLowerCase()))
    .join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function text(value: string | undefined): DiagnosticValue {
  return value ? { kind: 'text', text: value } : { kind: 'empty', text: 'None' };
}

/** A machine code (mode, trigger, state) shown in words. */
function code(value: string | undefined, emptyLabel = 'None'): DiagnosticValue {
  return value ? { kind: 'text', text: humanize(value) } : { kind: 'empty', text: emptyLabel };
}

function problem(value: string | undefined): DiagnosticValue {
  return value ? { kind: 'problem', text: value } : { kind: 'empty', text: 'None' };
}

function status(value: string, tone: Tone): DiagnosticValue {
  return { kind: 'status', text: humanize(value), tone };
}

/** Yes is good; `offTone` says whether No is a problem here or just a fact. */
function flag(value: boolean, offTone: Tone): DiagnosticValue {
  return value ? status('Yes', 'success') : status('No', offTone);
}

function registered(value: boolean): DiagnosticValue {
  return value ? status('Registered', 'success') : status('Not registered', 'warning');
}

/** A game that is live (launching, running, in the overlay, minimized to Home...) is blue; a failed one red. */
function activeGameTone(value: AppDiagnostics['activeGame']['status']): Tone {
  if (value === 'error') return 'danger';
  if (value === 'idle' || value === 'closed') return 'neutral';
  return 'info';
}

function bridgeTone(value: AppDiagnostics['controllerCompatibility']['status']): Tone {
  if (value === 'ready') return 'success';
  if (value === 'error') return 'danger';
  if (value === 'driverRequired' || value === 'unavailable') return 'warning';
  return 'neutral';
}

function Keys(props: { combo: string }): JSX.Element {
  const keys = props.combo.split(' ');
  return (
    <span className="diagnostics-keys">
      {keys.map((key, index) => (
        <span key={key} className="diagnostics-key">
          {index > 0 && <span>+</span>}
          <kbd className="admin-kbd">{key}</kbd>
        </span>
      ))}
    </span>
  );
}

function DiagnosticGroup(props: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="diagnostics-group">
      <h3 className="admin-subheading">{props.title}</h3>
      <dl className="admin-meta-list admin-meta-list--left diagnostics-list">{props.children}</dl>
    </section>
  );
}

function DiagnosticItem(props: { label: ReactNode; value: DiagnosticValue }): JSX.Element {
  const { value } = props;
  return (
    <div>
      <dt>{props.label}</dt>
      <dd className={`diagnostics-value diagnostics-value--${value.kind}`} title={value.text}>
        {value.kind === 'status' ? <StatusText tone={value.tone}>{value.text}</StatusText> : value.text}
      </dd>
    </div>
  );
}
