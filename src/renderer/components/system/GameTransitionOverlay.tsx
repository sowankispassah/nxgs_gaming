import type { ActiveGameState } from '../../../shared/types';
import { BrandLogo } from '../BrandLogo';
import { GameArtwork } from './GameArtwork';

/**
 * Full-screen black loading screen while a game starts or closes, with the
 * loader in the centre so customers can see the game is opening.
 */
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
      <div className="game-transition-center">
        <span className="game-transition-icon" aria-hidden="true">
          <GameArtwork
            game={game}
            kind="avatar"
            fallback={<BrandLogo className="game-transition-logo" logoPath={props.logoPath} alt="" />}
          />
        </span>
        <h2 className="game-transition-title">{game?.title ?? 'Game'}</h2>
        <span className="game-transition-spinner spin" aria-hidden="true" />
        <p className="game-transition-state">{closing ? 'Closing game…' : 'Opening game…'}</p>
        {props.activeGame.message && <p className="game-transition-message">{props.activeGame.message}</p>}
      </div>
      <div className="launch-help">
        <span>Press the Home button on your controller to go to Home.</span>
        <span>No Home button? Press Options + Share together, or F10 or Ctrl + Shift + H on a keyboard.</span>
      </div>
    </div>
  );
}
