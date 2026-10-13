import type { ActiveGameState } from '../../../shared/types';
import { BrandLogo } from '../BrandLogo';
import { GameArtwork } from './GameArtwork';

export function GameTransitionOverlay(props: { activeGame: ActiveGameState; logoPath: string }): JSX.Element {
  const closing = props.activeGame.status === 'closing';
  const game = props.activeGame.game;

  return (
    <div
      className={`game-transition-overlay ${closing ? 'is-closing' : 'is-launching'}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="game-transition-art" aria-hidden="true">
        <GameArtwork
          game={game}
          kind="cover"
          fallback={(
            <div className="game-transition-fallback">
              <BrandLogo className="game-transition-logo" logoPath={props.logoPath} alt="" />
            </div>
          )}
        />
      </div>
      <div className="game-transition-scrim" aria-hidden="true" />
      <div className="game-transition-copy">
        <p className="eyebrow">{closing ? 'Closing game' : 'Launching game'}</p>
        <h2>{game?.title ?? 'Game'}</h2>
        <p className="game-transition-message">{props.activeGame.message ?? 'Preparing the game window...'}</p>
      </div>
      <div className="launch-help">
        <span>Press Ctrl + Shift + H or F10 to return to NXGS.</span>
        <span>Press controller Home or Options + Share to open NXGS when supported by the connected controller.</span>
      </div>
      <div className="game-transition-status">
        <span className="game-transition-spinner spin" aria-hidden="true" />
        <span>{closing ? 'Closing…' : 'Starting…'}</span>
      </div>
    </div>
  );
}
