import type { ReactNode } from 'react';

export type SettingsTone = 'neutral' | 'info' | 'success' | 'warning' | 'error';
export type SettingsNoticeTone = 'info' | 'success' | 'warning' | 'error';

/**
 * The browser's gamepad id with its technical suffix removed, e.g.
 * "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)"
 * becomes "DualSense Wireless Controller".
 */
export function controllerDisplayName(name?: string): string | undefined {
  const cleaned = name?.replace(/\s*\([^)]*(?:STANDARD GAMEPAD|Vendor:)[^)]*\)\s*$/i, '').trim();
  return cleaned || undefined;
}

/** A state in words: a coloured dot and its label (Connected, Off, Failed...). */
export function SettingsStatus(props: { tone: SettingsTone; children: ReactNode; className?: string }): JSX.Element {
  return (
    <span className={`settings-status tone-${props.tone}${props.className ? ` ${props.className}` : ''}`}>
      <i className="settings-status-dot" aria-hidden="true" />
      <span>{props.children}</span>
    </span>
  );
}

/** Inline status line under a settings section (progress, results, errors). */
export function SettingsNotice(props: { tone: SettingsNoticeTone; message: string }): JSX.Element {
  return (
    <div className={`settings-feedback ${props.tone}`} role="status">
      <i className="settings-status-dot" aria-hidden="true" />
      <span>{props.message}</span>
    </div>
  );
}

/** Summary at the top of a settings page: what it is on the left, its state on the right. */
export function SettingsStatusCard(props: {
  tone: SettingsTone;
  label: string;
  title: string;
  detail: ReactNode;
}): JSX.Element {
  return (
    <div className={`settings-status-card tone-${props.tone}`}>
      <span className="settings-status-copy">
        <strong>{props.title}</strong>
        <small>{props.detail}</small>
      </span>
      <SettingsStatus tone={props.tone}>{props.label}</SettingsStatus>
    </div>
  );
}

/** Read-only list row. Focusable by default so controller users can scroll through it. */
export function SettingsInfoRow(props: {
  label: string;
  description?: ReactNode;
  value?: ReactNode;
  focusable?: boolean;
  className?: string;
}): JSX.Element {
  const focusable = props.focusable !== false;
  return (
    <div
      className={`settings-row settings-info-row${props.className ? ` ${props.className}` : ''}`}
      tabIndex={focusable ? -1 : undefined}
      data-settings-action={focusable ? true : undefined}
    >
      <span className="settings-row-text">
        <strong>{props.label}</strong>
        {props.description && <small>{props.description}</small>}
      </span>
      {props.value !== undefined && <span className="settings-row-value">{props.value}</span>}
    </div>
  );
}

/** On/off list row with a console switch. */
export function SettingsSwitchRow(props: {
  label: string;
  description: ReactNode;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      className="settings-row settings-switch-row"
      data-settings-action
      type="button"
      role="switch"
      aria-checked={props.checked}
      disabled={props.disabled}
      onClick={props.onToggle}
    >
      <span className="settings-row-text">
        <strong>{props.label}</strong>
        <small>{props.description}</small>
      </span>
      <span className="ps-switch" data-on={props.checked} aria-hidden="true" />
    </button>
  );
}
