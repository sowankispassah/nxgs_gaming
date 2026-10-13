import { LoaderCircle, Lock } from 'lucide-react';

export function WindowedAdminControls(props: {
  error: string;
  pending: boolean;
  onLock: () => void;
}): JSX.Element {
  return (
    <div className="windowed-admin-controls">
      {props.error && <p role="alert">{props.error}</p>}
      <button
        type="button"
        className="windowed-admin-lock"
        disabled={props.pending}
        aria-label={props.pending ? 'Returning NXGS to locked kiosk mode' : 'Return NXGS to locked kiosk mode'}
        title="Return to locked kiosk mode"
        onClick={props.onLock}
      >
        {props.pending ? <LoaderCircle size={22} className="spin" /> : <Lock size={22} />}
      </button>
    </div>
  );
}
