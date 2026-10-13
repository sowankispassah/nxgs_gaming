import type { ReactNode } from 'react';
import { CircleCheck, CircleX, Info, TriangleAlert } from 'lucide-react';

export type SettingsTone = 'neutral' | 'info' | 'success' | 'warning' | 'error';
export type SettingsNoticeTone = 'info' | 'success' | 'warning' | 'error';

const NOTICE_ICONS: Record<SettingsNoticeTone, JSX.Element> = {
  info: <Info size={20} />,
  success: <CircleCheck size={20} />,
  warning: <TriangleAlert size={20} />,
  error: <CircleX size={20} />
};

export function toneChipClass(tone: SettingsTone): string {
  if (tone === 'success') return 'ps-chip ps-chip--success';
  if (tone === 'warning') return 'ps-chip ps-chip--warning';
  if (tone === 'error') return 'ps-chip ps-chip--danger';
  if (tone === 'info') return 'ps-chip ps-chip--accent';
  return 'ps-chip';
}

/** Inline status line under a settings section (progress, results, errors). */
export function SettingsNotice(props: { tone: SettingsNoticeTone; message: string }): JSX.Element {
  return (
    <div className={`settings-feedback ${props.tone}`} role="status">
      <span className="settings-feedback-icon" aria-hidden="true">{NOTICE_ICONS[props.tone]}</span>
      <span>{props.message}</span>
    </div>
  );
}

/** Large status card at the top of a settings page. */
export function SettingsStatusCard(props: {
  tone: SettingsTone;
  icon: ReactNode;
  label: string;
  title: string;
  detail: ReactNode;
}): JSX.Element {
  return (
    <div className={`settings-status-card tone-${props.tone}`}>
      <span className="settings-status-icon" aria-hidden="true">{props.icon}</span>
      <span className="settings-status-copy">
        <span className={toneChipClass(props.tone)}>{props.label}</span>
        <strong>{props.title}</strong>
        <small>{props.detail}</small>
      </span>
    </div>
  );
}

/** Read-only list row. Focusable by default so controller users can scroll through it. */
export function SettingsInfoRow(props: {
  label: string;
  description?: ReactNode;
  value?: ReactNode;
  icon?: ReactNode;
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
      {props.icon && <span className="settings-row-icon" aria-hidden="true">{props.icon}</span>}
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
