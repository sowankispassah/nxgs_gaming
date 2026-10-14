import { useEffect, useRef, useState, type CSSProperties } from 'react';
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
  const [liveBackdropStream, setLiveBackdropStream] = useState<MediaStream | null>(null);
  const [solidCover, setSolidCover] = useState({ visible: false, fade: false });
  const readyRequestRef = useRef(0);
  const coverArt = activeGame.game?.coverImagePath || activeGame.game?.avatarImagePath || '';

  useEffect(() => {
    // Decode the cover art early so the solid cover never shows it popping in.
    if (!coverArt) return;
    const image = new Image();
    image.src = backdropImageUrl(coverArt);
  }, [coverArt]);

  useEffect(() => {
    let mounted = true;
    void window.nxgs.getInitialData().then((data) => {
      if (mounted) setActiveGame(data.activeGame);
    });
    const unsubscribeActiveGame = window.nxgs.onActiveGameState(setActiveGame);
    const unsubscribeSolidCover = window.nxgs.onQuickOverlaySolidCover(setSolidCover);
    const unsubscribeBackdrop = window.nxgs.onQuickOverlayBackdrop((request) => {
      setRenderRequestId(request.requestId);
      setBackdrop(request);
      setBackdropReadyRequestId(0);
    });
    // Main emits shell:home only after the controls are already on screen.
    // Re-animating them then made every Home press dip and jump once.
    const unsubscribeShellHome = window.nxgs.onShellHome((event) => {
      if (event.emergencyClose) {
        setEmergencyCloseRequestId((value) => value + 1);
      }
    });
    // Main shows the overlay underneath the game and asks for this before
    // raising it. Answer only after the frame holding every state update
    // received so far has been presented; a hidden window otherwise reappears
    // with the frame it painted when Home last closed.
    const frameSyncAnimationFrames = new Set<number>();
    const unsubscribeFrameSync = window.nxgs.onQuickOverlayFrameSync((requestId) => {
      let remainingFrames = 3;
      const waitForFrame = () => {
        const frame = window.requestAnimationFrame(() => {
          frameSyncAnimationFrames.delete(frame);
          remainingFrames -= 1;
          if (remainingFrames > 0) waitForFrame();
          else window.nxgs.notifyQuickOverlayFrameSynced(requestId);
        });
        frameSyncAnimationFrames.add(frame);
      };
      waitForFrame();
    });
    return () => {
      mounted = false;
      unsubscribeActiveGame();
      unsubscribeSolidCover();
      unsubscribeBackdrop();
      unsubscribeShellHome();
      unsubscribeFrameSync();
      for (const frame of frameSyncAnimationFrames) window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (backdrop.requestId <= 0) return undefined;
    let cancelled = false;
    const animationFrames = new Set<number>();
    let captureStream: MediaStream | null = null;
    let captureTimeout = 0;
    let captureSettled = false;
    setLiveBackdropStream(null);
    const markPaintable = () => {
      const firstFrame = window.requestAnimationFrame(() => {
        animationFrames.delete(firstFrame);
        const secondFrame = window.requestAnimationFrame(() => {
          animationFrames.delete(secondFrame);
          if (!cancelled) setBackdropReadyRequestId(backdrop.requestId);
        });
        animationFrames.add(secondFrame);
      });
      animationFrames.add(firstFrame);
    };

    if (backdrop.kind === 'live' && backdrop.sourceId && navigator.mediaDevices?.getUserMedia) {
      const failLiveCapture = (reason: string) => {
        if (cancelled || captureSettled) return;
        captureSettled = true;
        window.clearTimeout(captureTimeout);
        for (const track of captureStream?.getTracks() ?? []) track.stop();
        captureStream = null;
        window.nxgs.notifyQuickOverlayBackdropFailed(backdrop.requestId, reason);
      };
      captureTimeout = window.setTimeout(() => {
        failLiveCapture('timed out waiting for a decoded game frame');
      }, 4000);
      const constraints = {
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: backdrop.sourceId
          }
        }
      } as unknown as MediaStreamConstraints;
      void navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        captureStream = stream;
        const probe = document.createElement('video');
        probe.muted = true;
        probe.playsInline = true;
        probe.srcObject = stream;
        probe.onloadeddata = () => {
          if (cancelled || captureSettled) return;
          if (probe.videoWidth <= 0 || probe.videoHeight <= 0) {
            failLiveCapture('capture stream returned an empty video frame');
            return;
          }
          captureSettled = true;
          window.clearTimeout(captureTimeout);
          setLiveBackdropStream(stream);
          markPaintable();
        };
        probe.onerror = () => {
          failLiveCapture('game video element could not decode the capture stream');
        };
        void probe.play().catch((error) => {
          failLiveCapture(error instanceof Error ? error.message : 'game capture playback was rejected');
        });
      }).catch((error) => {
        failLiveCapture(error instanceof Error ? error.message : 'desktop capture permission was rejected');
      });
    } else if (backdrop.kind === 'live') {
      window.nxgs.notifyQuickOverlayBackdropFailed(backdrop.requestId, 'exact live source was unavailable');
    } else if (backdrop.imageUrl) {
      const image = new Image();
      image.onload = markPaintable;
      image.onerror = markPaintable;
      image.src = backdropImageUrl(backdrop.imageUrl);
    } else {
      markPaintable();
    }

    return () => {
      cancelled = true;
      window.clearTimeout(captureTimeout);
      for (const frame of animationFrames) window.cancelAnimationFrame(frame);
      for (const track of captureStream?.getTracks() ?? []) track.stop();
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
      {/* Hides a game's restyle while it leaves Windows' immersive full screen. */}
      <div
        className={`quick-overlay-solid-cover${solidCover.visible ? ' is-visible' : solidCover.fade ? ' is-fading' : ''}`}
        style={coverArt
          ? { '--qc-cover-art': `url("${backdropImageUrl(coverArt).replace(/"/g, '%22')}")` } as CSSProperties
          : undefined}
        aria-hidden="true"
      />
      <QuickHomeOverlay
        activeGame={activeGame}
        emergencyCloseRequestId={emergencyCloseRequestId}
        backdrop={backdrop}
        liveBackdropStream={liveBackdropStream}
        onDismiss={() => {
          void window.nxgs.dismissQuickOverlay();
        }}
      />
    </main>
  );
}
