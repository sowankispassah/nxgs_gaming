import { AlertTriangle, LoaderCircle, Lock } from 'lucide-react';

export function WindowedAdminControls(props: {
  error: string;
  pending: boolean;
  onLock: () => void;
}): JSX.Element {
  return (
    <div className="windowed-admin-controls">
      {props.error && (
        <p className="windowed-admin-error" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>{props.error}</span>
        </p>
      )}
      <button
        type="button"
        className={`windowed-admin-lock ${props.pending ? 'is-pending' : ''}`}
        disabled={props.pending}
        aria-label={props.pending ? 'Returning NXGS to locked kiosk mode' : 'Return NXGS to locked kiosk mode'}
        onClick={props.onLock}
      >
        <span className="windowed-admin-caption" aria-hidden="true">
          {props.pending ? 'Locking...' : 'Return to Locked Mode'}
        </span>
        <span className="windowed-admin-icon" aria-hidden="true">
          {props.pending ? <LoaderCircle size={24} className="spin" /> : <Lock size={24} />}
        </span>
      </button>
    </div>
  );
}
