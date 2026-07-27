import { useEffect, useRef, useState } from 'react';
import type { ActiveGameState, QuickOverlayBackdrop } from '../shared/types';
import { QuickHomeOverlay } from './components/QuickHomeOverlay';

const IDLE_GAME_STATE: ActiveGameState = {
  status: 'idle',
  updatedAt: new Date(0).toISOString()
};

const EMPTY_BACKDROP: QuickOverlayBackdrop = {
  requestId: 0,
  kind: 'generated'
};

function backdropImageUrl(path: string): string {
  if (/^(https?:|file:|data:)/i.test(path)) return path;
  return `file:///${path.replace(/\\/g, '/')}`;
}

export function QuickOverlayRoot(): JSX.Element {
  const [activeGame, setActiveGame] = useState<ActiveGameState>(IDLE_GAME_STATE);
  const [emergencyCloseRequestId, setEmergencyCloseRequestId] = useState(0);
  const [renderRequestId, setRenderRequestId] = useState(0);
  const [backdrop, setBackdrop] = useState<QuickOverlayBackdrop>(EMPTY_BACKDROP);
  const [backdropReadyRequestId, setBackdropReadyRequestId] = useState(0);
  const readyRequestRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    void window.nxgs.getInitialData().then((data) => {
      if (mounted) setActiveGame(data.activeGame);
    });
    const unsubscribeActiveGame = window.nxgs.onActiveGameState(setActiveGame);
    const unsubscribeBackdrop = window.nxgs.onQuickOverlayBackdrop((request) => {
      setRenderRequestId(request.requestId);
      setBackdrop(request);
      setBackdropReadyRequestId(0);
    });
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

  useEffect(() => {
    if (backdrop.requestId <= 0) return undefined;
    let cancelled = false;
    let firstFrame = 0;
    let secondFrame = 0;
    const markPaintable = () => {
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          if (!cancelled) setBackdropReadyRequestId(backdrop.requestId);
        });
      });
    };

    if (!backdrop.imageUrl) {
      markPaintable();
    } else {
      const image = new Image();
      image.onload = markPaintable;
      image.onerror = markPaintable;
      image.src = backdropImageUrl(backdrop.imageUrl);
    }
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [backdrop]);

  useEffect(() => {
    if (
      renderRequestId <= 0 ||
      backdropReadyRequestId !== renderRequestId ||
      readyRequestRef.current === renderRequestId
    ) return undefined;
    let cancelled = false;
    let timer = 0;
    let attempts = 0;
    const confirmControlsArePaintable = () => {
      if (cancelled || readyRequestRef.current === renderRequestId) return;
      const navbar = document.querySelector<HTMLElement>('.quick-navbar');
      const style = navbar ? window.getComputedStyle(navbar) : null;
      const bounds = navbar?.getBoundingClientRect();
      const paintable = Boolean(
        navbar &&
        style &&
        bounds &&
        bounds.width > 0 &&
        bounds.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) > 0
      );
      if (paintable) {
        readyRequestRef.current = renderRequestId;
        window.nxgs.notifyQuickOverlayBackdropReady(renderRequestId);
        return;
      }
      attempts += 1;
      if (attempts < 30) timer = window.setTimeout(confirmControlsArePaintable, 16);
    };
    timer = window.setTimeout(confirmControlsArePaintable, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeGame, backdropReadyRequestId, renderRequestId]);

  return (
    <main className="app-shell quick-overlay-shell live-gameplay-overlay">
      <QuickHomeOverlay
        activeGame={activeGame}
        emergencyCloseRequestId={emergencyCloseRequestId}
        backdrop={backdrop}
        onDismiss={() => {
          void window.nxgs.dismissQuickOverlay();
        }}
      />
    </main>
  );
}
