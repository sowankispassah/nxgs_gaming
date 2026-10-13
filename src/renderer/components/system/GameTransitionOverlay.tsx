import type { ActiveGameState } from '../../../shared/types';
import { BrandLogo } from '../BrandLogo';

export function GameTransitionOverlay(props: { activeGame: ActiveGameState; logoPath: string }): JSX.Element {
  return (
    <div className="game-transition-overlay">
      <BrandLogo className="boot-logo" logoPath={props.logoPath} />
      <div>
        <p className="eyebrow">{props.activeGame.status === 'closing' ? 'Closing game' : 'Launching game'}</p>
        <h2>{props.activeGame.game?.title ?? 'Game'}</h2>
        <span>{props.activeGame.message ?? 'Preparing the game window...'}</span>
        <div className="launch-help">
          <span>Press Ctrl + Shift + H or F10 to return to NXGS.</span>
          <span>Press controller Home or Options + Share to open NXGS when supported by the connected controller.</span>
        </div>
      </div>
    </div>
  );
}
