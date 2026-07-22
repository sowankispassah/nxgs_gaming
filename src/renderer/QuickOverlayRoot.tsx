import { useEffect, useState, type CSSProperties } from 'react';
import type { ActiveGameState } from '../shared/types';
import { QuickHomeOverlay } from './components/QuickHomeOverlay';

const IDLE_GAME_STATE: ActiveGameState = {
  status: 'idle',
  updatedAt: new Date(0).toISOString()
};

export function QuickOverlayRoot(): JSX.Element {
  const [activeGame, setActiveGame] = useState<ActiveGameState>(IDLE_GAME_STATE);
  const [emergencyCloseRequestId, setEmergencyCloseRequestId] = useState(0);
  const [backdrop, setBackdrop] = useState({ dataUrl: '', displayHeight: 0 });

  useEffect(() => {
    let mounted = true;
    void window.nxgs.getInitialData().then((data) => {
      if (mounted) setActiveGame(data.activeGame);
    });
    const unsubscribeActiveGame = window.nxgs.onActiveGameState(setActiveGame);
    const unsubscribeBackdrop = window.nxgs.onQuickOverlayBackdrop(setBackdrop);
    const unsubscribeShellHome = window.nxgs.onShellHome((event) => {
      if (event.emergencyClose) {
        setEmergencyCloseRequestId((value) => value + 1);
      }
    });
    return () => {
      mounted = false;
      unsubscribeActiveGame();
      unsubscribeBackdrop();
      unsubscribeShellHome();
    };
  }, []);

  return (
    <main className="app-shell quick-overlay-shell compact-gameplay-overlay">
      {backdrop.dataUrl && (
        <div
          className="quick-overlay-captured-backdrop"
          aria-hidden="true"
          style={{
            backgroundImage: `url("${backdrop.dataUrl}")`,
            '--quick-overlay-display-height': `${backdrop.displayHeight}px`
          } as CSSProperties}
        />
      )}
      <QuickHomeOverlay
        activeGame={activeGame}
        emergencyCloseRequestId={emergencyCloseRequestId}
        liveGameBackdrop
        onDismiss={() => {
          void window.nxgs.dismissQuickOverlay();
        }}
      />
    </main>
  );
}
