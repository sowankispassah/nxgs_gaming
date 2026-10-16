import { LoaderCircle } from 'lucide-react';
import type { TrackedGameSessionState } from '../../../shared/types';
import { SafeGameImage } from '../ConsoleHome';
import { CLOSE_FAILED_PATTERN } from './ControlCenterGameCard';
import { cx } from './cx';

/**
 * The PS5-style Switcher above the single game tile: the active game first,
 * then every other game still running in the background. Selecting a row
 * opens that game's card beside the list, where Resume is the first action.
 */
export function ControlCenterSwitcher(props: {
  sessions: TrackedGameSessionState[];
  focusedIndex: number | null;
  optionsGameId: string | null;
  resumingGameId: string | null;
  disabled: boolean;
  onRowHover: (index: number) => void;
  onSelect: (index: number) => void;
}): JSX.Element {
  const activeFirst = props.sessions[0]?.isActive ?? false;
  const sections = [
    { label: 'Active', start: 0, rows: activeFirst ? props.sessions.slice(0, 1) : [] },
    { label: 'Recent games', start: activeFirst ? 1 : 0, rows: props.sessions.slice(activeFirst ? 1 : 0) }
  ].filter((section) => section.rows.length > 0);

  return (
    <section className="quick-switcher" aria-label="Switcher">
      <h2 className="quick-switcher-title">Switcher</h2>
      {sections.map((section) => (
        <div className="quick-switcher-section" key={section.label}>
          <p className="quick-switcher-section-label">{section.label}</p>
          <div className="quick-switcher-list" role="list">
            {section.rows.map((session, offset) => {
              const index = section.start + offset;
              const game = session.game;
              const focused = props.focusedIndex === index;
              const optionsOpen = props.optionsGameId === game.id;
              const closing = session.status === 'closing';
              const resuming = props.resumingGameId === game.id;
              const closeFailed = !closing && CLOSE_FAILED_PATTERN.test(session.message ?? '');
              return (
                <div
                  className={cx('quick-switcher-row', focused && 'focused', optionsOpen && 'options-open')}
                  role="listitem"
                  key={game.id}
                >
                  <button
                    className={cx('quick-switcher-select', focused && 'focused')}
                    type="button"
                    aria-label={`${game.title} options`}
                    aria-expanded={optionsOpen}
                    disabled={props.disabled || closing}
                    onMouseEnter={() => props.onRowHover(index)}
                    onClick={() => props.onSelect(index)}
                  >
                    <span className="quick-switcher-icon" aria-hidden="true">
                      <SafeGameImage game={game} kind="avatar" alt="" fallbackSize={22} />
                    </span>
                    <span className="quick-switcher-name">{game.title}</span>
                    {(resuming || closing) && (
                      <span className="quick-switcher-status">
                        <LoaderCircle size={16} className="spin" aria-hidden="true" />
                        {resuming ? 'Resuming...' : 'Closing...'}
                      </span>
                    )}
                    {closeFailed && !resuming && (
                      <span className="quick-switcher-status warning">Didn&apos;t close</span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
