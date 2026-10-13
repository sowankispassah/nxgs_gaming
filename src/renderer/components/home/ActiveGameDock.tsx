import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Play, Power, X } from 'lucide-react';
import type { ActiveGameState } from '../../../shared/types';
import { SafeGameImage } from './SafeGameImage';

type DockTone = 'live' | 'busy' | 'idle';

// Request ids only grow within the launcher window. Remember which ones were
// already shown so remounting Home (e.g. returning from Settings) doesn't
// replay an old open or Close prompt.
let lastHandledOpenRequest = 0;
let lastHandledEmergencyRequest = 0;

/**
 * "Now playing" card shown on Home while a game runs in the background. It
 * expands upward into the game's controls: resume, close (with confirm) and
 * the admin force close fallback when a normal close fails.
 */
export function ActiveGameDock(props: {
  activeGame: ActiveGameState;
  openRequestId: number;
  emergencyCloseRequestId: number;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [forceCloseOpen, setForceCloseOpen] = useState(false);
  const [forcePin, setForcePin] = useState('');
  const [pendingForce, setPendingForce] = useState(false);
  const [pendingAction, setPendingAction] = useState<'resume' | 'close' | null>(null);
  const [message, setMessage] = useState('');
  const game = props.activeGame.game;
  const retryFocus = props.activeGame.windowDetected === false;

  useEffect(() => {
    if (!game) {
      setOpen(false);
      setConfirmClose(false);
      setForceCloseOpen(false);
      setForcePin('');
      setPendingAction(null);
      setMessage('');
    }
  }, [game]);

  useEffect(() => {
    if (!game || props.openRequestId <= lastHandledOpenRequest) return;
    lastHandledOpenRequest = props.openRequestId;
    setOpen(true);
  }, [game, props.openRequestId]);

  useEffect(() => {
    if (!game || props.emergencyCloseRequestId <= lastHandledEmergencyRequest) return;
    lastHandledEmergencyRequest = props.emergencyCloseRequestId;
    setOpen(true);
    setConfirmClose(true);
  }, [game, props.emergencyCloseRequestId]);

  if (!game || props.activeGame.status === 'idle' || props.activeGame.status === 'closed' || props.activeGame.status === 'error') {
    return null;
  }

  const statusLabel =
    props.activeGame.status === 'launching'
      ? 'Launching'
      : props.activeGame.status === 'resuming'
        ? 'Resuming'
        : props.activeGame.status === 'minimizedToHome' || props.activeGame.windowState === 'minimized'
          ? 'Minimized'
          : props.activeGame.status === 'quickOverlayOpen'
            ? 'Active'
            : props.activeGame.status === 'closing'
              ? 'Closing'
              : 'Running';
  const tone: DockTone = ['launching', 'resuming', 'closing'].includes(props.activeGame.status)
    ? 'busy'
    : statusLabel === 'Minimized' ? 'idle' : 'live';

  const runControl = async (
    action: 'resume' | 'close',
    control: () => Promise<{ ok: boolean; error?: string }>
  ): Promise<void> => {
    if (pendingAction !== null) {
      return;
    }
    if (action === 'resume') {
      setOpen(false);
    }
    setPendingAction(action);
    setMessage('');
    try {
      const result = await control();
      if (!result.ok) {
        if (action === 'resume') {
          setOpen(true);
        }
        setMessage(result.error ?? 'Game control failed.');
      } else if (action === 'close') {
        setOpen(false);
        setConfirmClose(false);
        setForceCloseOpen(false);
        setMessage('');
      }
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className={`active-game-dock ${open ? 'open' : ''}`}>
      {open && (
        <div className="active-game-panel">
          <div className="active-game-panel-copy">
            <p className="eyebrow">Active game</p>
            <span>{props.activeGame.message ?? 'Running in the background.'}</span>
          </div>
          {message && <p className="error-text">{message}</p>}
          {confirmClose ? (
            <div className="active-game-actions confirm">
              <span>Close {game.title}?</span>
              <div className="active-game-confirm-buttons">
                <button className="secondary-action" type="button" disabled={pendingAction !== null} onClick={() => setConfirmClose(false)}>
                  Cancel
                </button>
                <button
                  className="danger-action"
                  type="button"
                  disabled={pendingAction !== null}
                  onClick={() => runControl('close', window.nxgs.closeActiveGame)}
                >
                  {pendingAction === 'close' ? 'Closing...' : 'Close Game'}
                </button>
              </div>
            </div>
          ) : (
            <div className="active-game-actions">
              <button
                className="primary-action"
                type="button"
                disabled={pendingAction !== null || props.activeGame.status === 'resuming' || props.activeGame.status === 'closing'}
                onClick={() => runControl('resume', window.nxgs.resumeActiveGame)}
              >
                <Play size={18} fill="currentColor" />
                {pendingAction === 'resume' ? 'Focusing...' : retryFocus ? 'Try Focus Again' : 'Resume Game'}
              </button>
              <button
                className="secondary-action active-game-close"
                type="button"
                disabled={pendingAction !== null || props.activeGame.status === 'closing'}
                onClick={() => setConfirmClose(true)}
              >
                <X size={18} />
                Close Game
              </button>
              {/did not close|force close/i.test(`${message} ${props.activeGame.message ?? ''}`) && (
                <button className="console-force-link" type="button" onClick={() => setForceCloseOpen((value) => !value)}>
                  Admin force close
                </button>
              )}
            </div>
          )}
          {forceCloseOpen && (
            <div className="force-close-box">
              <label>
                <span>Admin PIN for Force Close</span>
                <input type="password" value={forcePin} onChange={(event) => setForcePin(event.target.value)} />
              </label>
              <button
                className="danger-action"
                type="button"
                disabled={pendingForce}
                onClick={async () => {
                  setPendingForce(true);
                  setMessage('');
                  try {
                    const result = await window.nxgs.forceCloseGame(forcePin);
                    if (!result.ok) {
                      setMessage('Invalid admin PIN.');
                    }
                  } finally {
                    setPendingForce(false);
                  }
                }}
              >
                <Power size={18} />
                {pendingForce ? 'Force closing...' : 'Force Close'}
              </button>
            </div>
          )}
        </div>
      )}
      <button
        className={`active-game-tile ${open ? 'selected' : ''}`}
        type="button"
        title={game.title}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="active-game-thumb">
          <SafeGameImage game={game} kind="avatar" alt="" fallbackSize={24} />
        </span>
        <span className="active-game-tile-meta">
          <small>Now playing</small>
          <strong>{game.title}</strong>
          <span className={`active-game-status ${tone}`}>{statusLabel}</span>
        </span>
        <span className="active-game-chevron" aria-hidden="true">
          {open ? <ChevronDown size={22} /> : <ChevronUp size={22} />}
        </span>
      </button>
    </div>
  );
}
