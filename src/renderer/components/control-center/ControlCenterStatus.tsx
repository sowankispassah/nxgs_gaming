import { useEffect, useRef, useState } from 'react';
import { Timer } from 'lucide-react';
import type { SessionState } from '../../../shared/types';
import { ConsoleClock } from '../../ui/ConsoleClock';
import { cx } from './cx';

function secondsLeft(session: SessionState, now: number): number {
  const expiresAt = session.expiresAt ? Date.parse(session.expiresAt) : Number.NaN;
  if (Number.isFinite(expiresAt)) {
    return Math.max(0, Math.ceil((expiresAt - now) / 1000));
  }
  return Math.max(0, session.remainingSeconds);
}

function formatTimeLeft(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

function useSessionState(open: boolean): SessionState | null {
  const [session, setSession] = useState<SessionState | null>(null);
  const loaded = useRef(false);

  useEffect(() => window.nxgs.onSessionState(setSession), []);

  useEffect(() => {
    if (loaded.current && !open) return undefined;
    let active = true;
    window.nxgs.getInitialData()
      .then((data) => {
        if (!active) return;
        loaded.current = true;
        setSession((current) => (!current || data.session.revision >= current.revision ? data.session : current));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [open]);

  return session;
}

function SessionTimeLeft(props: { session: SessionState }): JSX.Element | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const seconds = secondsLeft(props.session, now);
  if (seconds <= 0) return null;
  return (
    <span className={cx('quick-session-time', seconds <= 300 && 'warning')}>
      <Timer size={18} aria-hidden="true" />
      <span>{formatTimeLeft(seconds)}</span>
      <small>left</small>
    </span>
  );
}

export function ControlCenterStatus(props: { open: boolean }): JSX.Element {
  const session = useSessionState(props.open);
  return (
    <div className="quick-nav-status">
      {session?.status === 'running' && <SessionTimeLeft session={session} />}
      <ConsoleClock className="quick-overlay-clock" />
    </div>
  );
}
