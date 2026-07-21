import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Gamepad2,
  Layers3,
  Library,
  LoaderCircle,
  Play,
  Power,
  Search,
  Settings,
  Sparkles,
  Timer,
  UserRound
} from 'lucide-react';
import type { ActiveGameState, GameRecord, SessionState } from '../../shared/types';

export type ConsoleTab = 'games' | 'media';
export type ConsoleFocusSection = 'tabs' | 'utilities' | 'games' | 'hero' | 'content';

function fileUrl(path: string): string {
  if (!path) {
    return '';
  }
  if (/^(https?:|file:)/i.test(path)) {
    return path;
  }
  return `file:///${path.replace(/\\/g, '/')}`;
}

function imageCandidates(game: GameRecord | null, kind: 'avatar' | 'cover'): string[] {
  if (!game) {
    return [];
  }
  const paths = kind === 'avatar'
    ? [game.avatarImagePath, game.coverImagePath]
    : [game.coverImagePath, game.avatarImagePath];
  return [...new Set(paths.filter((path): path is string => Boolean(path?.trim())))];
}

function formatSessionTime(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function SafeGameImage(props: {
  game: GameRecord;
  kind: 'avatar' | 'cover';
  alt: string;
  fallbackSize?: number;
}): JSX.Element {
  const candidates = useMemo(() => imageCandidates(props.game, props.kind), [props.game, props.kind]);
  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => setCandidateIndex(0), [candidates.join('|')]);

  const path = candidates[candidateIndex];
  if (!path) {
    return (
      <span className="nxgs-image-placeholder" aria-label={`${props.game.title} placeholder`}>
        <Gamepad2 size={props.fallbackSize ?? 34} />
      </span>
    );
  }

  return (
    <img
      src={fileUrl(path)}
      alt={props.alt}
      onError={() => setCandidateIndex((index) => index + 1)}
    />
  );
}

export function GameHeroBackground(props: { game: GameRecord | null }): JSX.Element {
  const candidates = useMemo(() => imageCandidates(props.game, 'cover'), [props.game]);
  const [currentPath, setCurrentPath] = useState('');
  const [previousPath, setPreviousPath] = useState('');
  const currentPathRef = useRef('');

  useEffect(() => {
    let cancelled = false;
    let clearTimer: number | undefined;

    const commit = (path: string): void => {
      if (cancelled || path === currentPathRef.current) {
        return;
      }
      setPreviousPath(currentPathRef.current);
      currentPathRef.current = path;
      setCurrentPath(path);
      clearTimer = window.setTimeout(() => setPreviousPath(''), 760);
    };

    const loadCandidate = (index: number): void => {
      const path = candidates[index];
      if (!path) {
        commit('');
        return;
      }
      const image = new Image();
      image.onload = () => commit(path);
      image.onerror = () => loadCandidate(index + 1);
      image.src = fileUrl(path);
    };

    loadCandidate(0);
    return () => {
      cancelled = true;
      window.clearTimeout(clearTimer);
    };
  }, [candidates.join('|')]);

  return (
    <div className="game-hero-background" aria-hidden="true">
      {previousPath && <img className="hero-image previous" src={fileUrl(previousPath)} alt="" />}
      {currentPath && (
        <img
          key={currentPath}
          className="hero-image current"
          src={fileUrl(currentPath)}
          alt=""
          onError={() => {
            currentPathRef.current = '';
            setCurrentPath('');
          }}
        />
      )}
      <div className="hero-ambient" />
      <div className="hero-scrim" />
    </div>
  );
}

export function TopNav(props: {
  activeTab: ConsoleTab;
  focusSection: ConsoleFocusSection;
  utilityIndex: number;
  onTabChange: (tab: ConsoleTab) => void;
  onUtilityFocus: (index: number) => void;
  session: SessionState;
  onOpenAdmin: () => void;
}): JSX.Element {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (props.focusSection !== 'tabs') return;
    tabRefs.current[props.activeTab === 'games' ? 0 : 1]?.focus({ preventScroll: true });
  }, [props.activeTab, props.focusSection]);

  return (
    <header className="console-top-nav">
      <div className="console-nav-left">
        <div className="nxgs-mark" aria-label="NXGS Play">
          <span>N</span>
        </div>
        <nav className={`console-tabs ${props.focusSection === 'tabs' ? 'keyboard-focus' : ''}`} aria-label="Dashboard sections">
          <button
            ref={(element) => {
              tabRefs.current[0] = element;
            }}
            className={props.activeTab === 'games' ? 'active' : ''}
            type="button"
            onClick={() => props.onTabChange('games')}
          >
            Games
          </button>
          <button
            ref={(element) => {
              tabRefs.current[1] = element;
            }}
            className={props.activeTab === 'media' ? 'active' : ''}
            type="button"
            onClick={() => props.onTabChange('media')}
          >
            Media
          </button>
        </nav>
      </div>
      <UtilityIcons
        session={props.session}
        focused={props.focusSection === 'utilities'}
        focusedIndex={props.utilityIndex}
        onFocusIndex={props.onUtilityFocus}
        onOpenAdmin={props.onOpenAdmin}
      />
    </header>
  );
}

export function UtilityIcons(props: {
  session: SessionState;
  focused: boolean;
  focusedIndex: number;
  onFocusIndex: (index: number) => void;
  onOpenAdmin: () => void;
}): JSX.Element {
  const [now, setNow] = useState(() => new Date());
  const [notice, setNotice] = useState('');
  const utilityRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!notice) {
      return undefined;
    }
    const timer = window.setTimeout(() => setNotice(''), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!props.focused) return;
    utilityRefs.current[props.focusedIndex]?.focus({ preventScroll: true });
  }, [props.focused, props.focusedIndex]);

  return (
    <div className={`console-utilities ${props.focused ? 'keyboard-focus' : ''}`}>
      {props.session.status === 'running' && (
        <div className={`console-session-time ${props.session.warningFiveMinutes ? 'warning' : ''}`}>
          <Timer size={16} />
          {formatSessionTime(props.session.remainingSeconds)}
        </div>
      )}
      <button
        ref={(element) => {
          utilityRefs.current[0] = element;
        }}
        data-home-utility-index="0"
        className={`console-icon-button ${props.focused && props.focusedIndex === 0 ? 'controller-focused' : ''}`}
        type="button"
        title="Search"
        aria-label="Search"
        onFocus={() => props.onFocusIndex(0)}
        onClick={() => setNotice('Search coming soon')}
      >
        <Search size={21} />
      </button>
      <button
        ref={(element) => {
          utilityRefs.current[1] = element;
        }}
        data-home-utility-index="1"
        className={`console-icon-button ${props.focused && props.focusedIndex === 1 ? 'controller-focused' : ''}`}
        type="button"
        title="Settings"
        aria-label="Settings"
        onFocus={() => props.onFocusIndex(1)}
        onClick={props.onOpenAdmin}
      >
        <Settings size={21} />
      </button>
      <button
        ref={(element) => {
          utilityRefs.current[2] = element;
        }}
        data-home-utility-index="2"
        className={`console-avatar ${props.focused && props.focusedIndex === 2 ? 'controller-focused' : ''}`}
        type="button"
        title="Player profile"
        aria-label="Player profile"
        onFocus={() => props.onFocusIndex(2)}
        onClick={() => setNotice('Player profile coming soon')}
      >
        <UserRound size={20} />
      </button>
      <time dateTime={now.toISOString()}>
        {new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(now)}
      </time>
      {notice && <div className="console-toast">{notice}</div>}
    </div>
  );
}

export function GameAvatarRow(props: {
  games: GameRecord[];
  selectedIndex: number;
  focusSection: ConsoleFocusSection;
  onHighlight: (index: number) => void;
  onPlay: (game: GameRecord) => void;
  launchPendingGameId: string;
}): JSX.Element {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const tileRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const row = rowRef.current;
    const tile = tileRefs.current[props.selectedIndex];
    if (!row || !tile) {
      return;
    }
    const centeredLeft = tile.offsetLeft - (row.clientWidth - tile.clientWidth) / 2;
    row.scrollTo({ left: Math.max(0, centeredLeft), behavior: 'smooth' });
    if (props.focusSection === 'games') {
      tile.focus({ preventScroll: true });
    }
  }, [props.focusSection, props.selectedIndex]);

  return (
    <div ref={rowRef} className={`console-game-row ${props.focusSection === 'games' ? 'keyboard-focus' : ''}`} aria-label="Game library">
      {props.games.map((game, index) => {
        const selected = index === props.selectedIndex;
        return (
          <button
            ref={(element) => {
              tileRefs.current[index] = element;
            }}
            key={game.id}
            className={`console-game-avatar ${selected ? 'selected' : ''}`}
            type="button"
            aria-label={`${game.title}${selected ? ', selected' : ''}`}
            aria-pressed={selected}
            disabled={Boolean(props.launchPendingGameId)}
            onFocus={() => props.onHighlight(index)}
            onMouseEnter={() => props.onHighlight(index)}
            onClick={() => (selected ? props.onPlay(game) : props.onHighlight(index))}
          >
            <span className="game-avatar-art">
              {props.launchPendingGameId === game.id
                ? <LoaderCircle className="spin" size={34} />
                : <SafeGameImage game={game} kind="avatar" alt={`${game.title} avatar`} />}
            </span>
            <strong>{game.title}</strong>
          </button>
        );
      })}
    </div>
  );
}

export function DashboardContentRow(props: {
  focusSection: ConsoleFocusSection;
  selectedIndex: number;
  game: GameRecord | null;
  onFocusIndex: (index: number) => void;
}): JSX.Element {
  const cardRefs = useRef<Array<HTMLElement | null>>([]);
  const cards = [
    { icon: <Sparkles size={19} />, label: 'Recently added', value: props.game?.title ?? 'Your library' },
    { icon: <Library size={19} />, label: 'Installed games', value: 'Ready to play' },
    { icon: <Play size={19} />, label: 'Continue playing', value: props.game ? `Return to ${props.game.title}` : 'Choose a game' },
    { icon: <Layers3 size={19} />, label: 'Game details', value: props.game ? 'Available in your library' : 'Your library' }
  ];

  useEffect(() => {
    if (props.focusSection !== 'content') return;
    cardRefs.current[props.selectedIndex]?.focus({ preventScroll: true });
  }, [props.focusSection, props.selectedIndex]);

  return (
    <section className={`dashboard-content ${props.focusSection === 'content' ? 'keyboard-focus' : ''}`} aria-label="Dashboard content">
      <div className="content-heading">
        <span>Must play</span>
        <small>NXGS Play</small>
      </div>
      <div className="content-card-row">
        {cards.map((card, index) => (
          <article
            ref={(element) => {
              cardRefs.current[index] = element;
            }}
            key={card.label}
            className={`dashboard-card ${props.focusSection === 'content' && index === props.selectedIndex ? 'selected' : ''}`}
            tabIndex={-1}
            onFocus={() => props.onFocusIndex(index)}
            onMouseEnter={() => props.onFocusIndex(index)}
          >
            {props.game && (index === 0 || index === 2) && (
              <div className="dashboard-card-art">
                <SafeGameImage game={props.game} kind="cover" alt="" />
              </div>
            )}
            <div className="dashboard-card-icon">{card.icon}</div>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </article>
        ))}
      </div>
    </section>
  );
}

export function ConsoleHome(props: {
  games: GameRecord[];
  selectedIndex: number;
  selectedGame: GameRecord | null;
  session: SessionState;
  activeGame: ActiveGameState;
  activeTab: ConsoleTab;
  focusSection: ConsoleFocusSection;
  utilityIndex: number;
  contentIndex: number;
  homeOverlayRequestId: number;
  emergencyCloseRequestId: number;
  onTabChange: (tab: ConsoleTab) => void;
  onHighlightGame: (index: number) => void;
  onUtilityFocus: (index: number) => void;
  onContentFocus: (index: number) => void;
  onOpenAdmin: () => void;
  onSelectGame: (game: GameRecord) => void;
  launchPendingGameId: string;
}): JSX.Element {
  const playButtonRef = useRef<HTMLButtonElement | null>(null);
  const showingGames = props.activeTab === 'games';
  const heroGame = showingGames ? props.selectedGame : null;
  const hasActiveGame = Boolean(
    props.activeGame.game && !['idle', 'closed', 'error'].includes(props.activeGame.status)
  );

  useEffect(() => {
    if (props.focusSection === 'hero') {
      playButtonRef.current?.focus({ preventScroll: true });
    }
  }, [props.focusSection]);

  return (
    <section className="console-home">
      <GameHeroBackground game={heroGame} />
      <div className={`console-dashboard ${hasActiveGame ? 'has-active-game' : ''}`}>
        <TopNav
          activeTab={props.activeTab}
          focusSection={props.focusSection}
          utilityIndex={props.utilityIndex}
          onTabChange={props.onTabChange}
          onUtilityFocus={props.onUtilityFocus}
          session={props.session}
          onOpenAdmin={props.onOpenAdmin}
        />

        {showingGames ? (
          <>
            {props.games.length > 0 ? (
              <>
                <GameAvatarRow
                  games={props.games}
                  selectedIndex={props.selectedIndex}
                  focusSection={props.focusSection}
                  onHighlight={props.onHighlightGame}
                  onPlay={props.onSelectGame}
                  launchPendingGameId={props.launchPendingGameId}
                />
                <section className="console-hero-copy" aria-live="polite">
                  <h1 title={props.selectedGame?.title}>{props.selectedGame?.title}</h1>
                  <span>{props.selectedGame?.availabilityStatus === 'available' ? 'Installed and ready' : 'Ready from your saved library'}</span>
                  <button
                    ref={playButtonRef}
                    className={`console-play-button ${props.focusSection === 'hero' ? 'controller-focused' : ''}`}
                    type="button"
                    disabled={Boolean(props.launchPendingGameId)}
                    onClick={() => props.selectedGame && props.onSelectGame(props.selectedGame)}
                  >
                    {props.launchPendingGameId === props.selectedGame?.id
                      ? <LoaderCircle size={20} className="spin" />
                      : <Play size={20} fill="currentColor" />}
                    {props.launchPendingGameId === props.selectedGame?.id ? 'Starting...' : 'Play'}
                  </button>
                </section>
                <DashboardContentRow
                  focusSection={props.focusSection}
                  selectedIndex={props.contentIndex}
                  game={props.selectedGame}
                  onFocusIndex={props.onContentFocus}
                />
              </>
            ) : (
              <section className="console-empty-state">
                <div className="empty-state-mark"><Gamepad2 size={42} /></div>
                <p>NXGS Play library</p>
                <h1>No games added yet</h1>
                <span>Open Admin Settings to add games.</span>
                <button className="console-play-button" type="button" onClick={props.onOpenAdmin}>
                  <Settings size={19} />
                  Open Admin Settings
                </button>
              </section>
            )}
          </>
        ) : (
          <section className="media-placeholder">
            <div><Layers3 size={38} /></div>
            <p>NXGS Media</p>
            <h1>Media coming soon</h1>
            <span>This space is reserved for a future NXGS entertainment experience.</span>
          </section>
        )}
      </div>
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
  const [pendingAction, setPendingAction] = useState<'resume' | 'close' | null>(null);
  const [message, setMessage] = useState('');
  const game = props.activeGame.game;
  const retryFocus = props.activeGame.windowDetected === false;

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

  if (!game || props.activeGame.status === 'idle' || props.activeGame.status === 'closed' || props.activeGame.status === 'error') {
    return null;
  }

  const statusLabel =
    props.activeGame.status === 'launching'
      ? 'Launching'
      : props.activeGame.status === 'resuming'
        ? 'Resuming'
        : props.activeGame.status === 'minimizedToHome' || props.activeGame.windowState === 'minimized'
          ? 'Minimized'
          : props.activeGame.status === 'quickOverlayOpen'
            ? 'Active'
            : props.activeGame.status === 'closing'
              ? 'Closing'
              : 'Running';

  const runControl = async (
    action: 'resume' | 'close',
    control: () => Promise<{ ok: boolean; error?: string }>
  ): Promise<void> => {
    if (pendingAction !== null) {
      return;
    }
    if (action === 'resume') {
      setOpen(false);
    }
    setPendingAction(action);
    setMessage('');
    try {
      const result = await control();
      if (!result.ok) {
        if (action === 'resume') {
          setOpen(true);
        }
        setMessage(result.error ?? 'Game control failed.');
      } else if (action === 'close') {
        setOpen(false);
        setConfirmClose(false);
        setForceCloseOpen(false);
        setMessage('');
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
          <SafeGameImage game={game} kind="avatar" alt="" fallbackSize={24} />
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
                disabled={pendingAction !== null || props.activeGame.status === 'resuming' || props.activeGame.status === 'closing'}
                onClick={() => runControl('resume', window.nxgs.resumeActiveGame)}
              >
                <Play size={18} />
                {pendingAction === 'resume' ? 'Focusing...' : retryFocus ? 'Try Focus Again' : 'Resume Game'}
              </button>
              <button
                className="danger-action"
                type="button"
                disabled={pendingAction !== null || props.activeGame.status === 'closing'}
                onClick={() => setConfirmClose(true)}
              >
                Close Game
              </button>
              {/did not close|force close/i.test(`${message} ${props.activeGame.message ?? ''}`) && (
                <button className="console-force-link" type="button" onClick={() => setForceCloseOpen((value) => !value)}>
                  Admin force close
                </button>
              )}
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
