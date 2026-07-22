import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ActiveGameState } from '../shared/types';
import { QuickHomeOverlay } from './components/QuickHomeOverlay';

const IDLE_GAME_STATE: ActiveGameState = {
  status: 'idle',
  updatedAt: new Date(0).toISOString()
};

export function QuickOverlayRoot(): JSX.Element {
  const [activeGame, setActiveGame] = useState<ActiveGameState>(IDLE_GAME_STATE);
  const [emergencyCloseRequestId, setEmergencyCloseRequestId] = useState(0);
  const [backdrop, setBackdrop] = useState({
    sourceId: '',
    dataUrl: '',
    displayWidth: 0,
    displayHeight: 0
  });
  const [liveBackdropReady, setLiveBackdropReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

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

  useEffect(() => {
    setLiveBackdropReady(false);
    const video = videoRef.current;
    if (!backdrop.sourceId || !video) return undefined;

    let disposed = false;
    let stream: MediaStream | null = null;
    const width = Math.max(1, backdrop.displayWidth);
    const height = Math.max(1, backdrop.displayHeight);
    const videoConstraints = {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: backdrop.sourceId,
        maxWidth: width,
        maxHeight: height,
        maxFrameRate: 60
      }
    } as unknown as MediaTrackConstraints;

    void navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints })
      .then(async (nextStream) => {
        if (disposed) {
          nextStream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = nextStream;
        video.srcObject = nextStream;
        await video.play();
      })
      .catch(() => {
        if (!disposed) setLiveBackdropReady(false);
      });

    return () => {
      disposed = true;
      setLiveBackdropReady(false);
      if (video.srcObject === stream) video.srcObject = null;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [backdrop.displayHeight, backdrop.displayWidth, backdrop.sourceId]);

  return (
    <main className="app-shell quick-overlay-shell live-gameplay-overlay">
      {backdrop.dataUrl && (
        <div
          className="quick-overlay-captured-backdrop"
          aria-hidden="true"
          style={{
            backgroundImage: `url("${backdrop.dataUrl}")`,
            '--quick-overlay-display-width': `${backdrop.displayWidth}px`,
            '--quick-overlay-display-height': `${backdrop.displayHeight}px`
          } as CSSProperties}
        />
      )}
      {backdrop.sourceId && (
        <video
          ref={videoRef}
          className={`quick-overlay-live-backdrop ${liveBackdropReady ? 'is-ready' : ''}`}
          muted
          autoPlay
          playsInline
          aria-hidden="true"
          onPlaying={() => setLiveBackdropReady(true)}
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
