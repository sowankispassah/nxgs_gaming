import { LoaderCircle } from 'lucide-react';
import type { GameRecord } from '../../../shared/types';
import { SafeGameImage } from '../ConsoleHome';

export function ControlCenterClosing(props: { game: GameRecord }): JSX.Element {
  return (
    <section className="quick-game-closing-transition" role="status" aria-live="polite">
      <div className="quick-closing-card">
        <span className="quick-closing-art" aria-hidden="true">
          <SafeGameImage game={props.game} kind="avatar" alt="" fallbackSize={34} />
        </span>
        <small>NXGS Play</small>
        <strong>Closing {props.game.title}</strong>
        <span>Returning to your game library...</span>
        <LoaderCircle size={30} className="spin" aria-hidden="true" />
      </div>
    </section>
  );
}
