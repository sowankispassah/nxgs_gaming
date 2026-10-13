import { CircleAlert, Home, Info, LoaderCircle, Play, Power, ShieldAlert, X } from 'lucide-react';
import type { TrackedGameSessionState } from '../../../shared/types';
import { SafeGameImage } from '../ConsoleHome';
import { cx } from './cx';

export type PendingAction = 'resume' | 'home' | 'close' | 'force' | null;

export const MENU_LABELS = ['Resume Game', 'Go to Launcher Home', 'Close Game'] as const;

const MENU_ICONS = [<Play key="resume" size={22} />, <Home key="home" size={22} />, <X key="close" size={22} />];

export function ControlCenterGameCard(props: {
  session: TrackedGameSessionState;
  message: string;
  menuFocused: boolean;
  menuIndex: number;
  confirmClose: boolean;
  pendingAction: PendingAction;
  disabled: boolean;
  closeFailed: boolean;
  forcePin: string;
  onForcePinChange: (value: string) => void;
  onForceClose: () => void;
  onActionHover: (index: number) => void;
  onActionSelect: (index: number) => void;
  onConfirmClose: () => void;
  onCancelClose: () => void;
}): JSX.Element {
  const { session } = props;
  const game = session.game;
  const confirmFocusIndex = props.menuIndex === 0 ? 0 : 1;

  return (
    <section className="quick-game-menu" aria-label={`${game.title} controls`}>
      <header className="quick-game-hero">
        <span className="quick-game-cover" aria-hidden="true">
          <SafeGameImage game={game} kind="cover" alt="" fallbackSize={44} />
        </span>
        <div className="quick-game-heading">
          <small className={cx('quick-game-state', session.isActive && 'active')}>
            {session.isActive ? 'Active game' : 'Running in background'}
          </small>
          <strong>{game.title}</strong>
        </div>
      </header>

      <div className="quick-game-body">
        {props.message && (
          <p className="quick-overlay-error" role="alert">
            <CircleAlert size={18} aria-hidden="true" />
            <span>{props.message}</span>
          </p>
        )}
        {!props.message && session.message && (
          <p className="quick-overlay-status">
            <Info size={18} aria-hidden="true" />
            <span>{session.message}</span>
          </p>
        )}

        {props.confirmClose ? (
          <div className="quick-close-confirm">
            <strong>Close {game.title}?</strong>
            <span>The game will be asked to close. Unsaved progress may be lost.</span>
            <div>
              <button
                className={cx(confirmFocusIndex === 0 && 'focused', props.pendingAction === 'close' && 'pending')}
                type="button"
                disabled={props.disabled}
                onClick={props.onConfirmClose}
              >
                {props.pendingAction === 'close'
                  ? <><LoaderCircle size={18} className="spin" aria-hidden="true" /> Closing...</>
                  : 'Confirm Close'}
              </button>
              <button
                className={cx(confirmFocusIndex === 1 && 'focused')}
                type="button"
                disabled={props.disabled}
                onClick={props.onCancelClose}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="quick-game-actions">
            {MENU_LABELS.map((label, index) => {
              const pending = (props.pendingAction === 'resume' && index === 0) || (props.pendingAction === 'home' && index === 1);
              return (
                <button
                  key={label}
                  className={cx(props.menuFocused && props.menuIndex === index && 'focused', pending && 'pending')}
                  type="button"
                  disabled={props.disabled}
                  onMouseEnter={() => props.onActionHover(index)}
                  onClick={() => props.onActionSelect(index)}
                >
                  <span className="quick-game-action-icon" aria-hidden="true">
                    {pending ? <LoaderCircle size={22} className="spin" /> : MENU_ICONS[index]}
                  </span>
                  <span>
                    {props.pendingAction === 'resume' && index === 0
                      ? 'Resuming...'
                      : props.pendingAction === 'home' && index === 1
                        ? 'Opening Home...'
                        : label}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {props.closeFailed && (
          <div className="quick-force-close">
            <p className="quick-force-close-note">
              <ShieldAlert size={17} aria-hidden="true" />
              <span>Staff only</span>
            </p>
            <label>
              <span>Admin PIN for Force Close</span>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={props.forcePin}
                onChange={(event) => props.onForcePinChange(event.target.value)}
              />
            </label>
            <button
              className={cx(props.pendingAction === 'force' && 'pending')}
              type="button"
              disabled={props.disabled || props.pendingAction === 'force'}
              onClick={props.onForceClose}
            >
              {props.pendingAction === 'force'
                ? <LoaderCircle size={18} className="spin" aria-hidden="true" />
                : <Power size={18} aria-hidden="true" />}
              {props.pendingAction === 'force' ? 'Force closing...' : 'Force Close'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
