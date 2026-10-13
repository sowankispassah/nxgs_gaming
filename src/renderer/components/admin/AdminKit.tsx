import { useEffect, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert } from 'lucide-react';
import { toFileUrl } from '../../ui/media';

export type NoticeTone = 'success' | 'error' | 'warning' | 'info';

/** Scrolls an editor card into view inside the Control Room content pane when its top is off screen. */
export function revealInContent(element: HTMLElement | null): void {
  const scroller = element?.closest('.admin-content');
  if (!element || !scroller) return;
  const top = element.getBoundingClientRect().top;
  const bounds = scroller.getBoundingClientRect();
  if (top < bounds.top || top > bounds.bottom - 120) {
    element.scrollIntoView({ block: 'start' });
  }
}

const NOTICE_ICONS: Record<NoticeTone, JSX.Element> = {
  success: <CircleCheck size={18} />,
  error: <CircleAlert size={18} />,
  warning: <TriangleAlert size={18} />,
  info: <Info size={18} />
};

export function Notice(props: { tone: NoticeTone; children: ReactNode; className?: string }): JSX.Element {
  return (
    <p
      className={`admin-notice admin-notice--${props.tone}${props.className ? ` ${props.className}` : ''}`}
      role={props.tone === 'error' ? 'alert' : 'status'}
    >
      <span className="admin-notice-icon" aria-hidden="true">{NOTICE_ICONS[props.tone]}</span>
      <span>{props.children}</span>
    </p>
  );
}

export function CardHeader(props: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <header className="admin-card-header">
      {props.icon && <span className="admin-card-icon" aria-hidden="true">{props.icon}</span>}
      <div className="admin-card-heading">
        {props.eyebrow && <p className="eyebrow">{props.eyebrow}</p>}
        <h2>{props.title}</h2>
        {props.subtitle && <p className="admin-card-subtitle">{props.subtitle}</p>}
      </div>
      {props.actions && <div className="admin-card-actions">{props.actions}</div>}
    </header>
  );
}

export function SwitchRow(props: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <label className={`admin-switch-row${props.disabled ? ' is-disabled' : ''}`}>
      <span className="admin-switch-copy">
        <strong>{props.label}</strong>
        {props.description && <small>{props.description}</small>}
      </span>
      <input
        className="admin-switch-input"
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span className="ps-switch" data-on={props.checked ? 'true' : 'false'} aria-hidden="true" />
    </label>
  );
}

export function EmptyState(props: { icon: ReactNode; title: string; children?: ReactNode }): JSX.Element {
  return (
    <div className="admin-empty">
      <span className="admin-empty-icon" aria-hidden="true">{props.icon}</span>
      <strong>{props.title}</strong>
      {props.children && <p>{props.children}</p>}
    </div>
  );
}

export function LoadingState(props: { label: string }): JSX.Element {
  return (
    <div className="admin-loading" role="status">
      <LoaderCircle className="spin" size={22} />
      <span>{props.label}</span>
    </div>
  );
}

export function ArtImage(props: { path?: string; className?: string; alt?: string; fallback: ReactNode }): JSX.Element {
  const [failed, setFailed] = useState(false);
  const source = toFileUrl(props.path);

  useEffect(() => setFailed(false), [props.path]);

  return (
    <span className={props.className}>
      {source && !failed ? <img src={source} alt={props.alt ?? ''} onError={() => setFailed(true)} /> : props.fallback}
    </span>
  );
}
