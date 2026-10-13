import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

const TONE_ICONS: Record<ToastTone, ReactNode> = {
  info: <Info size={22} />,
  success: <CheckCircle2 size={22} />,
  warning: <AlertTriangle size={22} />,
  error: <XCircle size={22} />
};

/**
 * Console notification card. Renders pinned to the top-right safe area by
 * default; wrap several in `.system-toast-stack` with `floating={false}`.
 * Callers own visibility and timing.
 */
export function SystemToast(props: {
  message: ReactNode;
  title?: ReactNode;
  icon?: ReactNode;
  tone?: ToastTone;
  floating?: boolean;
  className?: string;
}): JSX.Element {
  const tone = props.tone ?? 'info';
  const classes = ['system-toast', `system-toast--${tone}`];
  if (props.floating !== false) classes.push('system-toast--floating');
  if (props.className) classes.push(props.className);
  return (
    <aside className={classes.join(' ')} role="status" aria-live="polite">
      <span className="system-toast-icon" aria-hidden="true">{props.icon ?? TONE_ICONS[tone]}</span>
      <span className="system-toast-copy">
        {props.title && <strong>{props.title}</strong>}
        <span>{props.message}</span>
      </span>
    </aside>
  );
}
