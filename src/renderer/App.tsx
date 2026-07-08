import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clock,
  FileUp,
  FolderOpen,
  Gamepad2,
  Home,
  Image as ImageIcon,
  Lock,
  Monitor,
  Play,
  Plus,
  Power,
  RefreshCw,
  Save,
  Search,
  Settings,
  Timer,
  Trash2,
  X
} from 'lucide-react';
import brandImage from './assets/nxgs-gaming-banner.png';
import type {
  ActiveGameState,
  AppDiagnostics,
  AppSettings,
  GameInput,
  GameRecord,
  GameSuggestion,
  InitialData,
  LaunchType,
  SessionState,
  UpdateCheckResult,
  UpdateDownloadProgress
} from '../shared/types';

type View = 'home' | 'admin';
type AdminTab = 'games' | 'scan' | 'sessions' | 'kiosk' | 'updates';

const EMPTY_SESSION: SessionState = {
  status: 'idle',
  remainingSeconds: 0,
  warningFiveMinutes: false
};

const EMPTY_GAME: GameInput = {
  title: '',
  coverImagePath: '',
  source: 'Manual',
  availabilityStatus: 'unknown',
  launchType: 'localExe',
  launchCommand: '',
  workingDirectory: '',
  processName: '',
  launchArguments: '',
  launchMode: 'borderlessPreferred',
  enabled: true
};

const EMPTY_ACTIVE_GAME: ActiveGameState = {
  status: 'idle',
  updatedAt: new Date(0).toISOString()
};

const SOURCE_OPTIONS = ['Manual', 'Steam', 'Epic Games', 'Microsoft Store', 'Start Menu', 'Local', 'Local Folder', 'Custom'] as const;

function launchTypeLabel(launchType: LaunchType): string {
  if (launchType === 'steam') {
    return 'Steam game';
  }
  if (launchType === 'epic') {
    return 'Epic game';
  }
  if (launchType === 'microsoftStore') {
    return 'Microsoft Store app';
  }
  if (launchType === 'localExe') {
    return 'Local executable';
  }
  return 'Custom command';
}

function suggestionStatusLabel(status: GameSuggestion['status']): string {
  if (status === 'ready') {
    return 'ready';
  }
  if (status === 'needs-confirmation') {
    return 'needs confirmation';
  }
  return 'unsupported';
}

function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function coverUrl(path: string): string {
  if (!path) {
    return '';
  }
  if (/^(https?:|file:)/i.test(path)) {
    return path;
  }
  return `file:///${path.replace(/\\/g, '/')}`;
}

function normalizeForm(game?: GameRecord | GameInput): GameInput {
  return {
    ...EMPTY_GAME,
    ...(game ?? {})
  };
}

export function App(): JSX.Element {
  const [initialData, setInitialData] = useState<InitialData | null>(null);
  const [games, setGames] = useState<GameRecord[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [view, setView] = useState<View>('home');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [confirmGame, setConfirmGame] = useState<GameRecord | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [session, setSession] = useState<SessionState>(EMPTY_SESSION);
  const [activeGame, setActiveGame] = useState<ActiveGameState>(EMPTY_ACTIVE_GAME);
  const [bootError, setBootError] = useState('');
  const [cursorHidden, setCursorHidden] = useState(false);
  const [homeOverlayRequestId, setHomeOverlayRequestId] = useState(0);
  const [emergencyCloseRequestId, setEmergencyCloseRequestId] = useState(0);

  const enabledGames = useMemo(() => games.filter((game) => game.enabled), [games]);
  const selectedGame = enabledGames[selectedIndex] ?? null;

  useEffect(() => {
    let mounted = true;
    window.nxgs
      .getInitialData()
      .then((data) => {
        if (!mounted) {
          return;
        }
        setInitialData(data);
        setGames(data.games);
        setSettings(data.settings);
        setActiveGame(data.activeGame);
      })
      .catch((error) => setBootError(error instanceof Error ? error.message : String(error)));

    const unsubscribeSession = window.nxgs.onSessionState((next) => {
      setSession(next);
      if (next.status === 'expired') {
        setConfirmGame(null);
        setView('home');
      }
    });
    const unsubscribeActiveGame = window.nxgs.onActiveGameState((next) => {
      setActiveGame(next);
      if (next.status === 'launching' || next.status === 'returning') {
        setView('home');
      }
    });
    const unsubscribeShellHome = window.nxgs.onShellHome((event) => {
      setConfirmGame(null);
      setPinOpen(false);
      setView('home');
      if (event.openActiveGamePanel) {
        setHomeOverlayRequestId((value) => value + 1);
      }
      if (event.emergencyClose) {
        setEmergencyCloseRequestId((value) => value + 1);
      }
    });

    return () => {
      mounted = false;
      unsubscribeSession();
      unsubscribeActiveGame();
      unsubscribeShellHome();
    };
  }, []);

  useEffect(() => {
    if (selectedIndex >= enabledGames.length) {
      setSelectedIndex(Math.max(0, enabledGames.length - 1));
    }
  }, [enabledGames.length, selectedIndex]);

  useEffect(() => {
    if (!settings) {
      return undefined;
    }

    let timeout: number | undefined;
    const reset = (): void => {
      setCursorHidden(false);
      window.clearTimeout(timeout);
      const delay = settings.kiosk.hideCursorAfterSeconds * 1000;
      if (delay > 0) {
        timeout = window.setTimeout(() => setCursorHidden(true), delay);
      }
    };

    window.addEventListener('mousemove', reset);
    window.addEventListener('keydown', reset);
    reset();

    return () => {
      window.removeEventListener('mousemove', reset);
      window.removeEventListener('keydown', reset);
      window.clearTimeout(timeout);
    };
  }, [settings]);

  const moveSelection = useCallback(
    (delta: number) => {
      if (enabledGames.length === 0 || view !== 'home' || confirmGame || pinOpen) {
        return;
      }
      setSelectedIndex((index) => (index + delta + enabledGames.length) % enabledGames.length);
    },
    [confirmGame, enabledGames.length, pinOpen, view]
  );

  const acceptSelection = useCallback(() => {
    if (view === 'home' && selectedGame && !confirmGame && !pinOpen) {
      setConfirmGame(selectedGame);
    }
  }, [confirmGame, pinOpen, selectedGame, view]);

  const back = useCallback(() => {
    if (confirmGame) {
      setConfirmGame(null);
      return;
    }
    if (pinOpen) {
      setPinOpen(false);
      return;
    }
    if (view === 'admin') {
      setView('home');
    }
  }, [confirmGame, pinOpen, view]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setPinOpen(true);
        return;
      }
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        moveSelection(1);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        moveSelection(-1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        acceptSelection();
      } else if (event.key === 'Escape' || event.key.toLowerCase() === 'b') {
        event.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [acceptSelection, back, moveSelection]);

  useEffect(() => {
    let lastInput = 0;
    let lastHomeInput = 0;
    let lastControllerKey = '';
    const interval = window.setInterval(() => {
      const pad = navigator.getGamepads?.()[0];
      const controllerKey = pad ? `${pad.id}:${pad.mapping}:${pad.buttons.length}` : 'none';
      if (controllerKey !== lastControllerKey) {
        lastControllerKey = controllerKey;
        void window.nxgs.reportControllerState({
          detected: Boolean(pad),
          homeSupported: pad && pad.buttons.length > 16 ? 'unknown' : 'no',
          name: pad?.id
        });
      }
      if (!pad || Date.now() - lastInput < 180) {
        return;
      }
      const pressed = (index: number): boolean => Boolean(pad.buttons[index]?.pressed);
      const guidePressed = pressed(16) || pressed(17);
      const optionsSharePressed = pressed(8) && pressed(9);
      const shoulderOptionsPressed = pressed(4) && pressed(5) && pressed(9);
      if ((guidePressed || optionsSharePressed || shoulderOptionsPressed) && Date.now() - lastHomeInput > 900) {
        lastInput = Date.now();
        lastHomeInput = Date.now();
        void window.nxgs.reportControllerState({
          detected: true,
          homeSupported: guidePressed ? 'yes' : 'unknown',
          name: pad.id
        });
        void window.nxgs.requestShellHome(guidePressed ? 'controller-home' : 'controller-combo');
        return;
      }
      if (pressed(15) || pad.axes[0] > 0.65 || pad.axes[1] > 0.65) {
        lastInput = Date.now();
        moveSelection(1);
      } else if (pressed(14) || pad.axes[0] < -0.65 || pad.axes[1] < -0.65) {
        lastInput = Date.now();
        moveSelection(-1);
      } else if (pressed(0)) {
        lastInput = Date.now();
        acceptSelection();
      } else if (pressed(1)) {
        lastInput = Date.now();
        back();
      }
    }, 90);
    return () => window.clearInterval(interval);
  }, [acceptSelection, back, moveSelection]);

  if (bootError) {
    return (
      <main className="boot-state">
        <img className="boot-logo" src={brandImage} alt="NXGS Gaming" />
        <AlertTriangle size={34} />
        <h1>NXGS Play failed to start</h1>
        <p>{bootError}</p>
      </main>
    );
  }

  if (!initialData || !settings) {
    return (
      <main className="boot-state">
        <img className="boot-logo" src={brandImage} alt="NXGS Gaming" />
        <h1>NXGS Play</h1>
        <p>Loading local library...</p>
      </main>
    );
  }

  return (
    <main className={`app-shell ${cursorHidden ? 'cursor-hidden' : ''}`}>
      {view === 'home' ? (
        <HomeScreen
          games={enabledGames}
          selectedIndex={selectedIndex}
          selectedGame={selectedGame}
          session={session}
          activeGame={activeGame}
          homeOverlayRequestId={homeOverlayRequestId}
          emergencyCloseRequestId={emergencyCloseRequestId}
          onOpenAdmin={() => setPinOpen(true)}
          onSelectGame={setConfirmGame}
        />
      ) : (
        <AdminScreen
          games={games}
          settings={settings}
          initialData={initialData}
          onGamesChanged={setGames}
          onSettingsChanged={setSettings}
          onClose={() => setView('home')}
        />
      )}

      {confirmGame && (
        <LaunchConfirm
          game={confirmGame}
          durations={settings.sessionDurationsMinutes}
          onClose={() => setConfirmGame(null)}
          onLaunched={() => setConfirmGame(null)}
        />
      )}

      {pinOpen && (
        <PinDialog
          title="Admin PIN"
          actionLabel="Unlock"
          pendingLabel="Checking..."
          onClose={() => setPinOpen(false)}
          onSubmit={async (pin) => {
            const result = await window.nxgs.verifyPin(pin);
            if (!result.ok) {
              return false;
            }
            setPinOpen(false);
            setView('admin');
            return true;
          }}
        />
      )}

      {session.status === 'expired' && (
        <ExpiredDialog
          session={session}
          onDismiss={async () => {
            await window.nxgs.clearExpiredSession();
          }}
        />
      )}
      {(activeGame.status === 'launching' || activeGame.status === 'closing') && <GameTransitionOverlay activeGame={activeGame} />}
    </main>
  );
}

function HomeScreen(props: {
  games: GameRecord[];
  selectedIndex: number;
  selectedGame: GameRecord | null;
  session: SessionState;
  activeGame: ActiveGameState;
  homeOverlayRequestId: number;
  emergencyCloseRequestId: number;
  onOpenAdmin: () => void;
  onSelectGame: (game: GameRecord) => void;
}): JSX.Element {
  return (
    <section className="home-screen">
      <header className="top-bar">
        <div className="brand-lockup">
          <img className="brand-logo" src={brandImage} alt="NXGS Gaming" />
          <div>
          <p className="eyebrow">Windows gaming kiosk</p>
          <h1>NXGS Play</h1>
          </div>
        </div>
        <div className="top-actions">
          {props.session.status === 'running' && (
            <div className={`timer-pill ${props.session.warningFiveMinutes ? 'warning' : ''}`}>
              <Timer size={18} />
              {formatTime(props.session.remainingSeconds)}
            </div>
          )}
          <button className="icon-button" type="button" title="Admin settings" onClick={props.onOpenAdmin}>
            <Settings size={22} />
          </button>
        </div>
      </header>

      {props.games.length === 0 ? (
        <div className="empty-library">
          <img className="empty-brand" src={brandImage} alt="NXGS Gaming" />
          <h2>No games saved</h2>
          <p>Open admin settings with Ctrl+Shift+A and add a game to start the kiosk library.</p>
        </div>
      ) : (
        <>
          <div className="featured-panel">
            <div>
              <p className="eyebrow">Ready to play</p>
              <h2>{props.selectedGame?.title}</h2>
              <p>{props.selectedGame?.source}</p>
            </div>
            <button
              className="primary-action"
              type="button"
              onClick={() => props.selectedGame && props.onSelectGame(props.selectedGame)}
            >
              <Play size={20} />
              Play
            </button>
          </div>

          <div className="game-rail" aria-label="Game library">
            {props.games.map((game, index) => (
              <button
                key={game.id}
                className={`game-card ${index === props.selectedIndex ? 'selected' : ''}`}
                type="button"
                onClick={() => props.onSelectGame(game)}
              >
                <div className="cover">
                  {game.coverImagePath ? <img src={coverUrl(game.coverImagePath)} alt="" /> : <Gamepad2 size={52} />}
                </div>
                <div className="game-card-meta">
                  <strong>{game.title}</strong>
                  <span>{game.source || game.launchType}</span>
                  <small className={`status ${game.availabilityStatus}`}>{game.availabilityStatus}</small>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
      <ActiveGameDock
        activeGame={props.activeGame}
        openRequestId={props.homeOverlayRequestId}
        emergencyCloseRequestId={props.emergencyCloseRequestId}
      />
    </section>
  );
}

function ActiveGameDock(props: {
  activeGame: ActiveGameState;
  openRequestId: number;
  emergencyCloseRequestId: number;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [forceCloseOpen, setForceCloseOpen] = useState(false);
  const [forcePin, setForcePin] = useState('');
  const [pendingForce, setPendingForce] = useState(false);
  const [pendingAction, setPendingAction] = useState<'resume' | 'minimize' | 'close' | null>(null);
  const [message, setMessage] = useState('');
  const game = props.activeGame.game;

  useEffect(() => {
    if (!game) {
      setOpen(false);
      setConfirmClose(false);
      setForceCloseOpen(false);
      setForcePin('');
      setPendingAction(null);
      setMessage('');
    }
  }, [game]);

  useEffect(() => {
    if (game && props.openRequestId > 0) {
      setOpen(true);
    }
  }, [game, props.openRequestId]);

  useEffect(() => {
    if (game && props.emergencyCloseRequestId > 0) {
      setOpen(true);
      setConfirmClose(true);
    }
  }, [game, props.emergencyCloseRequestId]);

  if (!game || props.activeGame.status === 'idle') {
    return null;
  }

  const statusLabel =
    props.activeGame.status === 'launching'
      ? 'Launching'
      : props.activeGame.windowState === 'minimized'
        ? 'Minimized'
        : 'Running';

  const runControl = async (
    action: 'resume' | 'minimize' | 'close',
    control: () => Promise<{ ok: boolean; error?: string }>
  ): Promise<void> => {
    setPendingAction(action);
    setMessage('');
    try {
      const result = await control();
      if (!result.ok) {
        setMessage(result.error ?? 'Game control failed.');
      } else if (action === 'close') {
        setConfirmClose(false);
        setForceCloseOpen(true);
        setMessage('Close requested. If the game stays open, use admin Force Close.');
      }
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="active-game-dock">
      <button
        className={`active-game-tile ${open ? 'selected' : ''}`}
        type="button"
        title={game.title}
        onClick={() => setOpen((current) => !current)}
      >
        <div className="active-game-thumb">
          {game.coverImagePath ? <img src={coverUrl(game.coverImagePath)} alt="" /> : <Gamepad2 size={24} />}
        </div>
        <div className="active-game-tile-meta">
          <strong>{game.title}</strong>
          <span>{statusLabel}</span>
        </div>
      </button>
      {open && (
        <div className="active-game-panel">
          <div>
            <p className="eyebrow">Active game</p>
            <strong>{game.title}</strong>
            <span>{props.activeGame.message ?? 'Running in the background.'}</span>
          </div>
          {message && <p className="error-text">{message}</p>}
          {confirmClose ? (
            <div className="active-game-actions">
              <span>Close {game.title}?</span>
              <button className="secondary-action" type="button" disabled={pendingAction !== null} onClick={() => setConfirmClose(false)}>
                Cancel
              </button>
              <button
                className="danger-action"
                type="button"
                disabled={pendingAction !== null}
                onClick={() => runControl('close', window.nxgs.closeActiveGame)}
              >
                {pendingAction === 'close' ? 'Closing...' : 'Close Game'}
              </button>
            </div>
          ) : (
            <div className="active-game-actions">
              <button
                className="primary-action"
                type="button"
                disabled={pendingAction !== null}
                onClick={() => runControl('resume', window.nxgs.resumeActiveGame)}
              >
                <Play size={18} />
                {pendingAction === 'resume' ? 'Resuming...' : 'Resume Game'}
              </button>
              <button
                className="secondary-action"
                type="button"
                disabled={pendingAction !== null}
                onClick={() => runControl('minimize', window.nxgs.minimizeActiveGame)}
              >
                {pendingAction === 'minimize' ? 'Minimizing...' : 'Minimize Game'}
              </button>
              <button className="danger-action" type="button" disabled={pendingAction !== null} onClick={() => setConfirmClose(true)}>
                Close Game
              </button>
            </div>
          )}
          {forceCloseOpen && (
            <div className="force-close-box">
              <label>
                <span>Admin PIN for Force Close</span>
                <input type="password" value={forcePin} onChange={(event) => setForcePin(event.target.value)} />
              </label>
              <button
                className="danger-action"
                type="button"
                disabled={pendingForce}
                onClick={async () => {
                  setPendingForce(true);
                  setMessage('');
                  try {
                    const result = await window.nxgs.forceCloseGame(forcePin);
                    if (!result.ok) {
                      setMessage('Invalid admin PIN.');
                    }
                  } finally {
                    setPendingForce(false);
                  }
                }}
              >
                <Power size={18} />
                {pendingForce ? 'Force closing...' : 'Force Close'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GameTransitionOverlay(props: { activeGame: ActiveGameState }): JSX.Element {
  return (
    <div className="game-transition-overlay">
      <img className="boot-logo" src={brandImage} alt="NXGS Gaming" />
      <div>
        <p className="eyebrow">{props.activeGame.status === 'closing' ? 'Closing game' : 'Launching game'}</p>
        <h2>{props.activeGame.game?.title ?? 'Game'}</h2>
        <span>{props.activeGame.message ?? 'Preparing the game window...'}</span>
        <div className="launch-help">
          <span>Press Ctrl + Shift + H or F10 to return to NXGS.</span>
          <span>Press controller Home or Options + Share to open NXGS when supported by Windows.</span>
        </div>
      </div>
    </div>
  );
}

function LaunchConfirm(props: {
  game: GameRecord;
  durations: number[];
  onClose: () => void;
  onLaunched: () => void;
}): JSX.Element {
  const [duration, setDuration] = useState(props.durations[0] ?? 30);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  return (
    <div className="modal-backdrop">
      <section className="modal launch-modal">
        <button className="icon-button close-button" type="button" title="Close" onClick={props.onClose} disabled={pending}>
          <X size={20} />
        </button>
        <p className="eyebrow">Start session</p>
        <h2>{props.game.title}</h2>
        <p className="muted">Choose a duration before launching. NXGS Play will monitor the game and return here when it closes.</p>
        <div className="duration-grid">
          {props.durations.map((minutes) => (
            <button
              key={minutes}
              type="button"
              className={duration === minutes ? 'selected' : ''}
              onClick={() => setDuration(minutes)}
              disabled={pending}
            >
              <Clock size={18} />
              {minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}` : `${minutes}m`}
            </button>
          ))}
        </div>
        {error && <p className="error-text">{error}</p>}
        <button
          className="primary-action wide"
          type="button"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setError('');
            try {
              const result = await window.nxgs.launchGame({ gameId: props.game.id, durationMinutes: duration });
              if (!result.ok) {
                setError(result.error ?? 'Launch failed.');
                return;
              }
              props.onLaunched();
            } finally {
              setPending(false);
            }
          }}
        >
          <Play size={20} />
          {pending ? 'Launching...' : 'Launch Game'}
        </button>
      </section>
    </div>
  );
}

function AdminScreen(props: {
  games: GameRecord[];
  settings: AppSettings;
  initialData: InitialData;
  onGamesChanged: (games: GameRecord[]) => void;
  onSettingsChanged: (settings: AppSettings) => void;
  onClose: () => void;
}): JSX.Element {
  const [tab, setTab] = useState<AdminTab>('games');

  return (
    <section className="admin-screen">
      <aside className="admin-sidebar">
        <div>
          <img className="admin-brand-logo" src={brandImage} alt="NXGS Gaming" />
          <p className="eyebrow">Admin mode</p>
          <h1>Settings</h1>
        </div>
        <nav>
          <TabButton active={tab === 'games'} icon={<Gamepad2 size={19} />} label="Games" onClick={() => setTab('games')} />
          <TabButton active={tab === 'scan'} icon={<Search size={19} />} label="Scan" onClick={() => setTab('scan')} />
          <TabButton active={tab === 'sessions'} icon={<Timer size={19} />} label="Sessions" onClick={() => setTab('sessions')} />
          <TabButton active={tab === 'kiosk'} icon={<Monitor size={19} />} label="Kiosk" onClick={() => setTab('kiosk')} />
          <TabButton active={tab === 'updates'} icon={<RefreshCw size={19} />} label="Updates" onClick={() => setTab('updates')} />
        </nav>
        <button className="secondary-action" type="button" onClick={props.onClose}>
          <Home size={18} />
          Home
        </button>
      </aside>

      <div className="admin-content">
        {tab === 'games' && <GameManager games={props.games} onGamesChanged={props.onGamesChanged} />}
        {tab === 'scan' && <ScanPanel onGamesChanged={props.onGamesChanged} />}
        {tab === 'sessions' && (
          <SessionSettings settings={props.settings} onSettingsChanged={props.onSettingsChanged} />
        )}
        {tab === 'kiosk' && (
          <KioskSettingsPanel
            settings={props.settings}
            initialData={props.initialData}
            onSettingsChanged={props.onSettingsChanged}
          />
        )}
        {tab === 'updates' && <UpdatePanel initialData={props.initialData} />}
      </div>
    </section>
  );
}

function TabButton(props: { active: boolean; icon: JSX.Element; label: string; onClick: () => void }): JSX.Element {
  return (
    <button className={props.active ? 'active' : ''} type="button" onClick={props.onClick}>
      {props.icon}
      {props.label}
    </button>
  );
}

function GameManager(props: { games: GameRecord[]; onGamesChanged: (games: GameRecord[]) => void }): JSX.Element {
  const [form, setForm] = useState<GameInput>(EMPTY_GAME);
  const [pending, setPending] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [message, setMessage] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const update = <K extends keyof GameInput>(key: K, value: GameInput[K]): void => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const applySuggestion = (suggestion: GameSuggestion): void => {
    setForm({
      title: suggestion.title,
      coverImagePath: suggestion.coverImagePath ?? '',
      source: suggestion.source,
      availabilityStatus: suggestion.availabilityStatus,
      launchType: suggestion.launchType,
      launchCommand: suggestion.launchCommand,
      workingDirectory: suggestion.workingDirectory ?? '',
      processName: suggestion.processName ?? '',
      launchArguments: '',
      enabled: suggestion.enabled ?? true
    });
    setMessage(`${suggestion.title} selected. Review and save it to add it to the customer library.`);
  };

  return (
    <div className="admin-grid">
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Game linking</p>
            <h2>{form.id ? 'Edit game' : 'Add game'}</h2>
          </div>
          <button className="icon-button" type="button" title="New game" onClick={() => setForm(EMPTY_GAME)}>
            <Plus size={20} />
          </button>
        </div>
        <div className="linking-actions">
          <button className="primary-action" type="button" onClick={() => setPickerOpen(true)}>
            <Search size={19} />
            Choose Installed Game
          </button>
          <span className="muted">Use manual EXE browsing only when the game is not detected.</span>
        </div>
        <GameForm form={form} onChange={update} />
        {message && <p className={message.startsWith('Saved') ? 'success-text' : 'error-text'}>{message}</p>}
        <button
          className="primary-action wide"
          type="button"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setMessage('');
            try {
              const result = await window.nxgs.saveGame(form);
              props.onGamesChanged(result.games);
              setForm(normalizeForm(result.game));
              setMessage('Saved game.');
            } catch (error) {
              setMessage(error instanceof Error ? error.message : String(error));
            } finally {
              setPending(false);
            }
          }}
        >
          <Save size={19} />
          {pending ? 'Saving...' : 'Save Game'}
        </button>
      </section>

      <section className="panel game-list-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Library</p>
            <h2>{props.games.length} saved</h2>
          </div>
        </div>
        <div className="admin-list">
          {props.games.map((game) => (
            <div key={game.id} className="admin-list-row">
              <button type="button" className="row-main" onClick={() => setForm(normalizeForm(game))}>
                <strong>{game.title}</strong>
                <span>{launchTypeLabel(game.launchType)} - {game.enabled ? game.availabilityStatus : 'disabled'}</span>
              </button>
              <button
                className="icon-button danger"
                type="button"
                title="Delete game"
                disabled={deletingId === game.id}
                onClick={async () => {
                  setDeletingId(game.id);
                  try {
                    const result = await window.nxgs.deleteGame(game.id);
                    props.onGamesChanged(result.games);
                    if (form.id === game.id) {
                      setForm(EMPTY_GAME);
                    }
                  } finally {
                    setDeletingId('');
                  }
                }}
              >
                {deletingId === game.id ? <Clock size={18} /> : <Trash2 size={18} />}
              </button>
            </div>
          ))}
        </div>
      </section>
      {pickerOpen && (
        <InstalledGamePicker
          onClose={() => setPickerOpen(false)}
          onSelect={(suggestion) => {
            applySuggestion(suggestion);
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

function InstalledGamePicker(props: { onClose: () => void; onSelect: (suggestion: GameSuggestion) => void }): JSX.Element {
  const [suggestions, setSuggestions] = useState<GameSuggestion[]>([]);
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    setPending(true);
    setError('');
    window.nxgs
      .scanInstalledGames()
      .then((found) => {
        if (mounted) {
          setSuggestions(found);
        }
      })
      .catch((scanError) => {
        if (mounted) {
          setError(scanError instanceof Error ? scanError.message : String(scanError));
        }
      })
      .finally(() => {
        if (mounted) {
          setPending(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredSuggestions = suggestions.filter((suggestion) => {
    if (!normalizedQuery) {
      return true;
    }
    return [suggestion.title, suggestion.source, suggestion.launchMethod, suggestion.launchCommand]
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery);
  });

  return (
    <div className="modal-backdrop">
      <section className="modal installed-picker-modal">
        <button className="icon-button close-button" type="button" title="Close" onClick={props.onClose} disabled={pending}>
          <X size={20} />
        </button>
        <p className="eyebrow">Detected apps and games</p>
        <h2>Choose Installed Game</h2>
        <div className="picker-search">
          <Search size={18} />
          <input
            autoFocus
            placeholder="Search installed games, for example Chicken Invaders"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {pending && <p className="muted">Scanning installed games...</p>}
        {error && <p className="error-text">{error}</p>}
        <div className="installed-game-list">
          {filteredSuggestions.map((suggestion) => (
            <button
              key={suggestion.suggestionId}
              className="installed-game-row"
              type="button"
              disabled={suggestion.status === 'unsupported'}
              onClick={() => props.onSelect(suggestion)}
            >
              <div className="installed-game-icon">
                {suggestion.iconPath ? <img src={coverUrl(suggestion.iconPath)} alt="" /> : <Gamepad2 size={22} />}
              </div>
              <div>
                <strong>{suggestion.title}</strong>
                <span>
                  {suggestion.source} - {suggestion.launchMethod}
                </span>
                <small>{suggestion.notes}</small>
              </div>
              <em className={`picker-status ${suggestion.status}`}>{suggestionStatusLabel(suggestion.status)}</em>
            </button>
          ))}
          {!pending && filteredSuggestions.length === 0 && <p className="muted">No installed games matched your search.</p>}
        </div>
      </section>
    </div>
  );
}

function GameForm(props: {
  form: GameInput;
  onChange: <K extends keyof GameInput>(key: K, value: GameInput[K]) => void;
}): JSX.Element {
  const [picking, setPicking] = useState<'image' | 'exe' | 'folder' | null>(null);
  const [pickerError, setPickerError] = useState('');
  const sourceValue = SOURCE_OPTIONS.includes((props.form.source ?? '') as (typeof SOURCE_OPTIONS)[number])
    ? props.form.source
    : 'Manual';

  const pickImage = async (): Promise<void> => {
    setPicking('image');
    setPickerError('');
    try {
      const result = await window.nxgs.selectImageFile();
      if (result.canceled) {
        return;
      }
      if (result.error || !result.path) {
        setPickerError(result.error ?? 'No image file was selected.');
        return;
      }
      props.onChange('coverImagePath', result.path);
    } finally {
      setPicking(null);
    }
  };

  const pickExecutable = async (): Promise<void> => {
    setPicking('exe');
    setPickerError('');
    try {
      const result = await window.nxgs.selectExecutableFile();
      if (result.canceled) {
        return;
      }
      if (result.error || !result.path) {
        setPickerError(result.error ?? 'No executable file was selected.');
        return;
      }
      props.onChange('launchCommand', result.path);
      if (result.fileName) {
        props.onChange('processName', result.fileName);
      }
      if (!props.form.workingDirectory?.trim() && result.directory) {
        props.onChange('workingDirectory', result.directory);
      }
    } finally {
      setPicking(null);
    }
  };

  const pickFolder = async (): Promise<void> => {
    setPicking('folder');
    setPickerError('');
    try {
      const result = await window.nxgs.selectFolder();
      if (result.canceled) {
        return;
      }
      if (result.error || !result.path) {
        setPickerError(result.error ?? 'No folder was selected.');
        return;
      }
      props.onChange('workingDirectory', result.path);
    } finally {
      setPicking(null);
    }
  };

  return (
    <div className="form-grid">
      <label>
        <span>
          Game title <em className="required-badge">Required</em>
        </span>
        <input value={props.form.title} onChange={(event) => props.onChange('title', event.target.value)} />
      </label>
      <label>
        <span>Source</span>
        <select value={sourceValue} onChange={(event) => props.onChange('source', event.target.value)}>
          {SOURCE_OPTIONS.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
      </label>
      <div className="form-field full">
        <label htmlFor="cover-image-path">Cover image path</label>
        <div className="input-with-button">
          <input
            id="cover-image-path"
            value={props.form.coverImagePath ?? ''}
            onChange={(event) => props.onChange('coverImagePath', event.target.value)}
          />
          <button className="secondary-action browse-button" type="button" disabled={picking === 'image'} onClick={pickImage}>
            <ImageIcon size={18} />
            {picking === 'image' ? 'Browsing...' : 'Browse Image'}
          </button>
        </div>
        {props.form.coverImagePath && (
          <div className="cover-preview">
            <img src={coverUrl(props.form.coverImagePath)} alt="Selected cover preview" />
          </div>
        )}
      </div>
      <label>
        <span>
          Launch type <em className="required-badge">Required</em>
        </span>
        <select value={props.form.launchType} onChange={(event) => props.onChange('launchType', event.target.value as LaunchType)}>
          <option value="steam">Steam game</option>
          <option value="epic">Epic game</option>
          <option value="microsoftStore">Microsoft Store app</option>
          <option value="localExe">Local executable</option>
          <option value="custom">Custom command</option>
        </select>
      </label>
      <label>
        <span>Process name to monitor</span>
        <input value={props.form.processName ?? ''} onChange={(event) => props.onChange('processName', event.target.value)} />
      </label>
      <div className="form-field full">
        <label htmlFor="launch-command">
          Launch command <em className="required-badge">Required</em>
        </label>
        <div className="input-with-button">
          <input
            id="launch-command"
            value={props.form.launchCommand}
            onChange={(event) => props.onChange('launchCommand', event.target.value)}
          />
          {props.form.launchType === 'localExe' && (
            <button className="secondary-action browse-button" type="button" disabled={picking === 'exe'} onClick={pickExecutable}>
              <FileUp size={18} />
              {picking === 'exe' ? 'Browsing...' : 'Browse EXE manually'}
            </button>
          )}
        </div>
        {props.form.launchType === 'microsoftStore' && (
          <small className="field-note">Use the AppUserModelId from Choose Installed Game. No hidden WindowsApps EXE path is required.</small>
        )}
      </div>
      <div className="form-field full">
        <label htmlFor="working-directory">Working directory</label>
        <div className="input-with-button">
          <input
            id="working-directory"
            value={props.form.workingDirectory ?? ''}
            onChange={(event) => props.onChange('workingDirectory', event.target.value)}
          />
          <button className="secondary-action browse-button" type="button" disabled={picking === 'folder'} onClick={pickFolder}>
            <FolderOpen size={18} />
            {picking === 'folder' ? 'Browsing...' : 'Browse Folder'}
          </button>
        </div>
      </div>
      {pickerError && <p className="error-text full">{pickerError}</p>}
      <label className="checkbox-row full">
        <input
          type="checkbox"
          checked={props.form.enabled ?? true}
          onChange={(event) => props.onChange('enabled', event.target.checked)}
        />
        <span>Enabled on customer home screen</span>
      </label>
    </div>
  );
}

function ScanPanel(props: { onGamesChanged: (games: GameRecord[]) => void }): JSX.Element {
  const [suggestions, setSuggestions] = useState<GameSuggestion[]>([]);
  const [pendingScan, setPendingScan] = useState(false);
  const [savingId, setSavingId] = useState('');
  const [error, setError] = useState('');

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Suggestions only</p>
          <h2>Scan installed games</h2>
        </div>
        <button
          className="primary-action"
          type="button"
          disabled={pendingScan}
          onClick={async () => {
            setPendingScan(true);
            setError('');
            try {
              setSuggestions(await window.nxgs.scanInstalledGames());
            } catch (scanError) {
              setError(scanError instanceof Error ? scanError.message : String(scanError));
            } finally {
              setPendingScan(false);
            }
          }}
        >
          <Search size={19} />
          {pendingScan ? 'Scanning...' : 'Scan'}
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
      <div className="scan-results">
        {suggestions.map((suggestion) => (
          <article key={suggestion.suggestionId} className="suggestion-row">
            <div>
              <strong>{suggestion.title}</strong>
              <span>
                {suggestion.source} - {suggestion.launchMethod} - {suggestionStatusLabel(suggestion.status)}
              </span>
              <small>{suggestion.notes}</small>
            </div>
            <button
              className="secondary-action"
              type="button"
              disabled={savingId === suggestion.suggestionId}
              onClick={async () => {
                setSavingId(suggestion.suggestionId);
                try {
                  const result = await window.nxgs.saveGame(suggestion);
                  props.onGamesChanged(result.games);
                } finally {
                  setSavingId('');
                }
              }}
            >
              <Check size={18} />
              {savingId === suggestion.suggestionId ? 'Saving...' : 'Save'}
            </button>
          </article>
        ))}
        {!pendingScan && suggestions.length === 0 && <p className="muted">No scan results yet.</p>}
      </div>
    </section>
  );
}

function SessionSettings(props: {
  settings: AppSettings;
  onSettingsChanged: (settings: AppSettings) => void;
}): JSX.Element {
  const [pin, setPin] = useState(props.settings.adminPin);
  const [durations, setDurations] = useState(props.settings.sessionDurationsMinutes.join(', '));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  return (
    <section className="panel narrow-panel">
      <p className="eyebrow">Timer and security</p>
      <h2>Session settings</h2>
      <div className="form-grid single">
        <label>
          <span>Admin PIN</span>
          <input value={pin} onChange={(event) => setPin(event.target.value)} />
        </label>
        <label>
          <span>Durations in minutes</span>
          <input value={durations} onChange={(event) => setDurations(event.target.value)} />
        </label>
      </div>
      {message && <p className={message.startsWith('Saved') ? 'success-text' : 'error-text'}>{message}</p>}
      <button
        className="primary-action wide"
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setMessage('');
          try {
            const next: AppSettings = {
              ...props.settings,
              adminPin: pin,
              sessionDurationsMinutes: durations
                .split(',')
                .map((value) => Number(value.trim()))
                .filter((value) => Number.isFinite(value) && value > 0)
            };
            props.onSettingsChanged(await window.nxgs.updateSettings(next));
            setMessage('Saved settings.');
          } catch (error) {
            setMessage(error instanceof Error ? error.message : String(error));
          } finally {
            setPending(false);
          }
        }}
      >
        <Save size={19} />
        {pending ? 'Saving...' : 'Save Settings'}
      </button>
    </section>
  );
}

function KioskSettingsPanel(props: {
  settings: AppSettings;
  initialData: InitialData;
  onSettingsChanged: (settings: AppSettings) => void;
}): JSX.Element {
  const [settings, setSettings] = useState(props.settings);
  const [diagnostics, setDiagnostics] = useState<AppDiagnostics>(props.initialData.diagnostics);
  const [exitPin, setExitPin] = useState('');
  const [pending, setPending] = useState(false);
  const [pendingDiagnostics, setPendingDiagnostics] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [message, setMessage] = useState('');

  const refreshDiagnostics = async (): Promise<void> => {
    setPendingDiagnostics(true);
    try {
      setDiagnostics(await window.nxgs.getDiagnostics());
    } finally {
      setPendingDiagnostics(false);
    }
  };

  useEffect(() => {
    void refreshDiagnostics();
    const interval = window.setInterval(() => {
      void window.nxgs.getDiagnostics().then(setDiagnostics);
    }, 3000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <section className="panel narrow-panel">
      <p className="eyebrow">Best effort lockdown</p>
      <h2>Kiosk behavior</h2>
      <div className="toggle-stack">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.kiosk.alwaysOnTop}
            onChange={(event) => setSettings({ ...settings, kiosk: { ...settings.kiosk, alwaysOnTop: event.target.checked } })}
          />
          <span>Always on top</span>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.kiosk.preventClose}
            onChange={(event) => setSettings({ ...settings, kiosk: { ...settings.kiosk, preventClose: event.target.checked } })}
          />
          <span>Require admin PIN to close</span>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.kiosk.refocusOnBlur}
            onChange={(event) => setSettings({ ...settings, kiosk: { ...settings.kiosk, refocusOnBlur: event.target.checked } })}
          />
          <span>Refocus NXGS Play when idle</span>
        </label>
        <label>
          <span>Hide cursor after seconds</span>
          <input
            type="number"
            min={0}
            value={settings.kiosk.hideCursorAfterSeconds}
            onChange={(event) =>
              setSettings({
                ...settings,
                kiosk: { ...settings.kiosk, hideCursorAfterSeconds: Number(event.target.value) }
              })
            }
          />
        </label>
      </div>
      {message && <p className={message.startsWith('Saved') ? 'success-text' : 'error-text'}>{message}</p>}
      <button
        className="primary-action wide"
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setMessage('');
          try {
            props.onSettingsChanged(await window.nxgs.updateSettings(settings));
            setMessage('Saved kiosk settings.');
          } catch (error) {
            setMessage(error instanceof Error ? error.message : String(error));
          } finally {
            setPending(false);
          }
        }}
      >
        <Save size={19} />
        {pending ? 'Saving...' : 'Save Kiosk Settings'}
      </button>

      <div className="storage-block">
        <strong>Local storage</strong>
        <span>{props.initialData.dataPath}</span>
        <span>{props.initialData.logsPath}</span>
      </div>

      <div className="diagnostics-block">
        <div className="diagnostics-header">
          <strong>Diagnostics</strong>
          <button className="secondary-action" type="button" disabled={pendingDiagnostics} onClick={refreshDiagnostics}>
            <RefreshCw size={16} />
            {pendingDiagnostics ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        <div className="diagnostics-grid">
          <DiagnosticItem label="Ctrl + Shift + H" value={diagnostics.shortcuts.homeRegistered ? 'yes' : 'no'} />
          <DiagnosticItem label="F10" value={diagnostics.shortcuts.f10Registered ? 'yes' : 'no'} />
          <DiagnosticItem label="Ctrl + Shift + X" value={diagnostics.shortcuts.emergencyCloseRegistered ? 'yes' : 'no'} />
          <DiagnosticItem label="Controller detected" value={diagnostics.controller.detected ? 'yes' : 'no'} />
          <DiagnosticItem label="Controller Home" value={diagnostics.controller.homeSupported} />
          <DiagnosticItem label="Current game" value={diagnostics.activeGame.title ?? 'none'} />
          <DiagnosticItem label="Game process ID" value={diagnostics.activeGame.processId?.toString() ?? 'none'} />
          <DiagnosticItem label="Game window handle" value={diagnostics.activeGame.windowHandle?.toString() ?? 'none'} />
        </div>
        <p className="field-note">
          PS button detection depends on Windows/controller driver. Use Ctrl+Shift+H or F10 as reliable fallback.
        </p>
        {diagnostics.shortcuts.failures.length > 0 && (
          <div className="diagnostics-warning">
            {diagnostics.shortcuts.failures.map((failure) => (
              <span key={failure}>{failure}</span>
            ))}
          </div>
        )}
      </div>

      <div className="danger-zone">
        <label>
          <span>PIN to exit application</span>
          <input value={exitPin} onChange={(event) => setExitPin(event.target.value)} />
        </label>
        <button
          className="danger-action"
          type="button"
          disabled={exiting}
          onClick={async () => {
            setExiting(true);
            const result = await window.nxgs.exitApp(exitPin);
            if (!result.ok) {
              setMessage('Invalid admin PIN.');
              setExiting(false);
            }
          }}
        >
          <Power size={19} />
          {exiting ? 'Exiting...' : 'Exit NXGS Play'}
        </button>
      </div>
    </section>
  );
}

function DiagnosticItem(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="diagnostic-item">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function UpdatePanel(props: { initialData: InitialData }): JSX.Element {
  const [pendingAction, setPendingAction] = useState<'check' | 'download' | 'install' | null>(null);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [downloadedInstallerPath, setDownloadedInstallerPath] = useState('');
  const [downloadProgress, setDownloadProgress] = useState<UpdateDownloadProgress | null>(null);
  const [restartPromptOpen, setRestartPromptOpen] = useState(false);
  const [operationMessage, setOperationMessage] = useState('');
  const [operationOk, setOperationOk] = useState(true);

  const pending = pendingAction !== null;
  const progressPercent = downloadProgress?.percent ?? 0;
  const downloadFailed = Boolean(
    downloadProgress && operationMessage && !operationOk && !downloadedInstallerPath && pendingAction !== 'download'
  );
  const downloadProgressLabel =
    pendingAction === 'download' ? 'Downloading update...' : downloadFailed ? 'Download failed' : 'Download complete';

  useEffect(() => window.nxgs.onUpdateDownloadProgress(setDownloadProgress), []);

  const installDownloadedUpdate = async (): Promise<void> => {
    if (!downloadedInstallerPath) {
      setOperationMessage('No downloaded update installer is available.');
      setOperationOk(false);
      return;
    }

    setPendingAction('install');
    setOperationMessage('');
    setOperationOk(true);
    try {
      const install = await window.nxgs.installUpdate({
        installerPath: downloadedInstallerPath,
        sha256: result?.sha256
      });
      setOperationMessage(install.message);
      setOperationOk(install.ok);
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <section className="panel narrow-panel">
      <p className="eyebrow">Release management</p>
      <h2>Updates</h2>
      <div className="version-block">
        <span>Current app version</span>
        <strong>{props.initialData.appVersion}</strong>
      </div>
      <p className="muted">
        NXGS Play checks the release manifest for a newer packaged installer. The app stays open while the update downloads,
        then asks you to restart when the installer is ready.
      </p>
      <button
        className="primary-action wide"
        type="button"
        disabled={pending}
        onClick={async () => {
          setPendingAction('check');
          setOperationMessage('');
          setOperationOk(true);
          setDownloadedInstallerPath('');
          setDownloadProgress(null);
          setRestartPromptOpen(false);
          try {
            setResult(await window.nxgs.checkForUpdates());
          } finally {
            setPendingAction(null);
          }
        }}
      >
        <RefreshCw size={19} />
        {pendingAction === 'check' ? 'Checking for updates...' : 'Check for Updates'}
      </button>
      <div className={`update-status ${pendingAction === 'check' ? 'checking' : result?.status ?? ''}`}>
        {pendingAction === 'check' ? (
          <p>Checking for updates...</p>
        ) : result ? (
          <>
            <strong>
              {result.status === 'available'
                ? 'New update available'
                : result.status === 'latest'
                  ? 'You are on the latest version'
                  : 'Update check failed'}
            </strong>
            <span>{result.message}</span>
            {result.latestVersion && <span>Latest version: {result.latestVersion}</span>}
            {result.assetName && <span>Installer asset: {result.assetName}</span>}
            {result.notes && <span>{result.notes}</span>}
            {result.releaseUrl && (
              <a href={result.releaseUrl} target="_blank" rel="noreferrer">
                View GitHub release
              </a>
            )}
            <small>Checked at {new Date(result.checkedAt).toLocaleString()}</small>
          </>
        ) : (
          <p>No update check has been run yet.</p>
        )}
      </div>
      {result?.status === 'available' && result.canDownload && result.downloadUrl && !downloadedInstallerPath && (
        <button
          className="primary-action wide"
          type="button"
          disabled={pending}
          onClick={async () => {
            setPendingAction('download');
            setOperationMessage('');
            setOperationOk(true);
            setDownloadProgress({ receivedBytes: 0, percent: 0 });
            try {
              const download = await window.nxgs.downloadUpdate({
                downloadUrl: result.downloadUrl ?? '',
                assetName: result.assetName,
                sha256: result.sha256,
                latestVersion: result.latestVersion
              });
              setOperationMessage(download.message);
              setOperationOk(download.ok);
              if (download.ok && download.installerPath) {
                setDownloadedInstallerPath(download.installerPath);
                setRestartPromptOpen(true);
              }
            } finally {
              setPendingAction(null);
            }
          }}
        >
          <FileUp size={19} />
          {pendingAction === 'download' ? `Downloading update${progressPercent > 0 ? ` ${progressPercent}%` : '...'}` : 'Download Update'}
        </button>
      )}
      {(pendingAction === 'download' || downloadProgress) && (
        <div className={`download-progress ${downloadFailed ? 'failed' : ''}`}>
          <div>
            <span>{downloadProgressLabel}</span>
            <strong>{progressPercent}%</strong>
          </div>
          <div className="progress-track">
            <span style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
      )}
      {downloadedInstallerPath && (
        <div className="update-actions">
          <button className="primary-action wide" type="button" disabled={pending} onClick={() => setRestartPromptOpen(true)}>
            <Power size={19} />
            Restart to Install Update
          </button>
        </div>
      )}
      {operationMessage && <p className={operationOk ? 'success-text' : 'error-text'}>{operationMessage}</p>}
      {restartPromptOpen && (
        <div className="modal-backdrop">
          <div className="modal update-modal">
            <p className="eyebrow">Update ready</p>
            <h2>Restart to finish update</h2>
            <p className="muted">
              Version {result?.latestVersion ?? 'the new update'} is downloaded. NXGS Play will stay open until you choose
              Restart Now.
            </p>
            <div className="update-restart-note">
              Restart Now closes NXGS Play, runs the verified installer, and reopens the app after installation.
            </div>
            <div className="dialog-actions">
              <button
                className="secondary-action"
                type="button"
                disabled={pendingAction === 'install'}
                onClick={() => setRestartPromptOpen(false)}
              >
                Later
              </button>
              <button className="primary-action" type="button" disabled={pendingAction === 'install'} onClick={installDownloadedUpdate}>
                <Power size={18} />
                {pendingAction === 'install' ? 'Restarting...' : 'Restart Now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function PinDialog(props: {
  title: string;
  actionLabel: string;
  pendingLabel: string;
  onClose: () => void;
  onSubmit: (pin: string) => Promise<boolean>;
}): JSX.Element {
  const [pin, setPin] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  return (
    <div className="modal-backdrop">
      <form
        className="modal pin-modal"
        onSubmit={async (event) => {
          event.preventDefault();
          setPending(true);
          setError('');
          try {
            const ok = await props.onSubmit(pin);
            if (!ok) {
              setError('Invalid PIN.');
            }
          } finally {
            setPending(false);
          }
        }}
      >
        <button className="icon-button close-button" type="button" title="Close" onClick={props.onClose} disabled={pending}>
          <X size={20} />
        </button>
        <Lock size={34} />
        <h2>{props.title}</h2>
        <input autoFocus type="password" value={pin} onChange={(event) => setPin(event.target.value)} />
        {error && <p className="error-text">{error}</p>}
        <button className="primary-action wide" type="submit" disabled={pending}>
          <Lock size={18} />
          {pending ? props.pendingLabel : props.actionLabel}
        </button>
      </form>
    </div>
  );
}

function ExpiredDialog(props: { session: SessionState; onDismiss: () => Promise<void> }): JSX.Element {
  const [pin, setPin] = useState('');
  const [pendingDismiss, setPendingDismiss] = useState(false);
  const [pendingForce, setPendingForce] = useState(false);
  const [error, setError] = useState('');

  return (
    <div className="modal-backdrop urgent">
      <section className="modal">
        <AlertTriangle size={42} />
        <h2>Session expired</h2>
        <p className="muted">{props.session.gameTitle ? `${props.session.gameTitle} time has ended.` : 'The session time has ended.'}</p>
        {error && <p className="error-text">{error}</p>}
        <button
          className="primary-action wide"
          type="button"
          disabled={pendingDismiss}
          onClick={async () => {
            setPendingDismiss(true);
            try {
              await props.onDismiss();
            } finally {
              setPendingDismiss(false);
            }
          }}
        >
          <Home size={19} />
          {pendingDismiss ? 'Returning...' : 'Return Home'}
        </button>
        <div className="danger-zone compact">
          <label>
            <span>Admin PIN for forced close</span>
            <input type="password" value={pin} onChange={(event) => setPin(event.target.value)} />
          </label>
          <button
            className="danger-action"
            type="button"
            disabled={pendingForce}
            onClick={async () => {
              setPendingForce(true);
              setError('');
              try {
                const result = await window.nxgs.forceCloseGame(pin);
                if (!result.ok) {
                  setError('Invalid admin PIN.');
                }
              } finally {
                setPendingForce(false);
              }
            }}
          >
            <Power size={18} />
            {pendingForce ? 'Closing...' : 'Force Close Game'}
          </button>
        </div>
      </section>
    </div>
  );
}
