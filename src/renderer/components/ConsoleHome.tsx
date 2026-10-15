import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type WheelEvent } from 'react';
import {
  CircleCheck,
  Gamepad2,
  Layers3,
  Library,
  LoaderCircle,
  Play,
  Search,
  Settings,
  Sparkles,
  Timer,
  UserRound,
  Zap,
  type LucideIcon
} from 'lucide-react';
import type { ActiveGameState, GameRecord, SessionState } from '../../shared/types';
import { BrandLogo } from './BrandLogo';
import { ConsoleClock } from '../ui/ConsoleClock';
import { SystemToast } from '../ui/SystemToast';
import { ActiveGameDock } from './home/ActiveGameDock';
import { GameHeroBackground } from './home/GameHeroBackground';
import { MediaShelf } from './home/MediaShelf';
import { SafeGameImage } from './home/SafeGameImage';
import { formatSessionTime, hasActiveGame, runningGameIds, tileSlotClass } from './home/homeUtils';

export { SafeGameImage };

export type ConsoleTab = 'games' | 'media';
export type ConsoleFocusSection = 'tabs' | 'utilities' | 'games' | 'hero' | 'content';
/** How a launch is paid for right now: free play, an active paid session, or a new purchase. */
export type HomePlayAccess = 'free' | 'session' | 'paid';

type UtilityNotice = 'search' | 'profile' | null;

const LONG_TITLE_LENGTH = 26;

function tileSlotStyle(slot: number): CSSProperties {
  return { '--slot': slot } as CSSProperties;
}

/** Keep pointer presses from moving DOM focus so a first click selects and a second click plays. */
function keepPointerFocus(event: MouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
}

function TopNav(props: {
  logoPath: string;
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
        <BrandLogo className="nxgs-mark" logoPath={props.logoPath} alt="NXGS Play" />
        <nav className={`console-tabs ${props.focusSection === 'tabs' ? 'keyboard-focus' : ''}`} aria-label="Dashboard sections">
          <button
            ref={(element) => {
              tabRefs.current[0] = element;
            }}
            className={props.activeTab === 'games' ? 'active' : ''}
            type="button"
            aria-current={props.activeTab === 'games' ? 'page' : undefined}
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
            aria-current={props.activeTab === 'media' ? 'page' : undefined}
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

function UtilityIcons(props: {
  session: SessionState;
  focused: boolean;
  focusedIndex: number;
  onFocusIndex: (index: number) => void;
  onOpenAdmin: () => void;
}): JSX.Element {
  const [notice, setNotice] = useState<UtilityNotice>(null);
  const utilityRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!notice) {
      return undefined;
    }
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!props.focused) return;
    utilityRefs.current[props.focusedIndex]?.focus({ preventScroll: true });
  }, [props.focused, props.focusedIndex]);

  const focusClass = (index: number): string => (props.focused && props.focusedIndex === index ? 'controller-focused' : '');

  return (
    <div className={`console-utilities ${props.focused ? 'keyboard-focus' : ''}`}>
      {props.session.status === 'running' && (
        <div
          className={`console-session-time ${props.session.warningFiveMinutes ? 'warning' : ''}`}
          role="timer"
          aria-label="Play time remaining"
        >
          <Timer size={18} />
          {formatSessionTime(props.session.remainingSeconds)}
        </div>
      )}
      <button
        ref={(element) => {
          utilityRefs.current[0] = element;
        }}
        data-home-utility-index="0"
        className={`console-icon-button ${focusClass(0)}`}
        type="button"
        title="Search"
        aria-label="Search"
        onFocus={() => props.onFocusIndex(0)}
        onClick={() => setNotice('search')}
      >
        <Search size={25} strokeWidth={2} />
      </button>
      <button
        ref={(element) => {
          utilityRefs.current[1] = element;
        }}
        data-home-utility-index="1"
        className={`console-icon-button ${focusClass(1)}`}
        type="button"
        title="Settings"
        aria-label="Settings"
        onFocus={() => props.onFocusIndex(1)}
        onClick={props.onOpenAdmin}
      >
        <Settings size={25} strokeWidth={2} />
      </button>
      <button
        ref={(element) => {
          utilityRefs.current[2] = element;
        }}
        data-home-utility-index="2"
        className={`console-avatar ${focusClass(2)}`}
        type="button"
        title="Player profile"
        aria-label="Player profile"
        onFocus={() => props.onFocusIndex(2)}
        onClick={() => setNotice('profile')}
      >
        <UserRound size={22} strokeWidth={2.2} />
      </button>
      <ConsoleClock className="console-home-clock" />
      {notice === 'search' && (
        <SystemToast
          className="console-home-notice"
          icon={<Search size={22} />}
          title="Search"
          message="Game search is coming soon."
        />
      )}
      {notice === 'profile' && (
        <SystemToast
          className="console-home-notice"
          icon={<UserRound size={22} />}
          title="Player profile"
          message="Player profiles are coming soon."
        />
      )}
    </div>
  );
}

function GameAvatarRow(props: {
  games: GameRecord[];
  logoPath: string;
  selectedIndex: number;
  focused: boolean;
  runningIds: Set<string>;
  onHighlightHome: () => void;
  onHighlight: (index: number) => void;
  onPlay: (game: GameRecord) => void;
  launchPendingGameId: string;
}): JSX.Element {
  const tileRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedSlot = props.selectedIndex + 1;
  const label = props.games[props.selectedIndex]?.title ?? 'Home';
  const labelKey = `${selectedSlot}:${label}`;
  const lastWheelAt = useRef(0);

  // Earlier tiles slide out of view, so pointer users step the selection with the wheel.
  const stepWithWheel = (event: WheelEvent<HTMLDivElement>): void => {
    if (props.launchPendingGameId) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const now = performance.now();
    if (Math.abs(delta) < 4 || now - lastWheelAt.current < 140) return;
    lastWheelAt.current = now;
    const next = Math.max(-1, Math.min(props.games.length - 1, props.selectedIndex + (delta > 0 ? 1 : -1)));
    if (next === props.selectedIndex) return;
    if (next === -1) props.onHighlightHome();
    else props.onHighlight(next);
  };

  useEffect(() => {
    if (!props.focused) return;
    tileRefs.current[selectedSlot]?.focus({ preventScroll: true });
  }, [props.focused, selectedSlot]);

  return (
    <div
      className={`console-tile-row console-game-row ${props.focused ? 'keyboard-focus' : ''}`}
      aria-label="NXGS Home and game library"
      onWheel={stepWithWheel}
    >
      <button
        ref={(element) => {
          tileRefs.current[0] = element;
        }}
        className={`console-tile console-game-avatar console-home-avatar ${tileSlotClass(-selectedSlot)}`}
        style={tileSlotStyle(-selectedSlot)}
        type="button"
        aria-label={`NXGS Home${props.selectedIndex === -1 ? ', selected' : ''}`}
        aria-pressed={props.selectedIndex === -1}
        onMouseDown={keepPointerFocus}
        onFocus={props.onHighlightHome}
        onClick={props.onHighlightHome}
      >
        <span className="console-tile-art game-avatar-art home-avatar-art">
          <BrandLogo logoPath={props.logoPath} alt="" />
        </span>
      </button>
      {props.games.map((game, index) => {
        const slot = index + 1 - selectedSlot;
        const selected = index === props.selectedIndex;
        const running = props.runningIds.has(game.id);
        return (
          <button
            ref={(element) => {
              tileRefs.current[index + 1] = element;
            }}
            key={game.id}
            className={`console-tile console-game-avatar ${tileSlotClass(slot)} ${selected ? 'selected' : ''} ${running ? 'running' : ''}`}
            style={tileSlotStyle(slot)}
            type="button"
            aria-label={`${game.title}${running ? ', running' : ''}${selected ? ', selected' : ''}`}
            aria-pressed={selected}
            disabled={Boolean(props.launchPendingGameId)}
            onMouseDown={keepPointerFocus}
            onFocus={() => props.onHighlight(index)}
            onClick={() => (selected ? props.onPlay(game) : props.onHighlight(index))}
          >
            <span className="console-tile-art game-avatar-art">
              <SafeGameImage game={game} kind="avatar" alt={`${game.title} avatar`} fallbackSize={52} />
              {props.launchPendingGameId === game.id && (
                <span className="tile-pending">
                  <LoaderCircle className="spin" size={44} />
                </span>
              )}
            </span>
            {running && (
              <span className="tile-running-badge" aria-hidden="true">
                <Play size={15} fill="currentColor" strokeWidth={0} />
              </span>
            )}
          </button>
        );
      })}
      <span key={labelKey} className="console-row-label" aria-hidden="true">
        <span className="console-row-label-title">{label}</span>
      </span>
    </div>
  );
}

function DashboardContentRow(props: {
  focused: boolean;
  selectedIndex: number;
  game: GameRecord | null;
  games: GameRecord[];
  session: SessionState;
  activeGame: ActiveGameState;
  appVersion: string;
  onFocusIndex: (index: number) => void;
}): JSX.Element {
  const cardRefs = useRef<Array<HTMLElement | null>>([]);
  const activityGame = hasActiveGame(props.activeGame) ? props.activeGame.game ?? null : null;
  const libraryThumbs = props.games.slice(0, 4);
  const cards: Array<{
    icon: LucideIcon;
    label: string;
    value: string;
    art?: { game: GameRecord; kind: 'avatar' | 'cover' };
    thumbs?: GameRecord[];
  }> = props.game
    ? [
      { icon: Sparkles, label: 'Recently added', value: props.game.title, art: { game: props.game, kind: 'cover' } },
      { icon: Library, label: 'Installed games', value: 'Ready to play', thumbs: libraryThumbs },
      { icon: Play, label: 'Continue playing', value: `Return to ${props.game.title}`, art: { game: props.game, kind: 'avatar' } },
      { icon: Layers3, label: 'Game details', value: 'Available in your library' }
    ]
    : [
      {
        icon: Library,
        label: 'Game library',
        value: `${props.games.length} ${props.games.length === 1 ? 'game' : 'games'} ready`,
        thumbs: libraryThumbs
      },
      {
        icon: Timer,
        label: 'Current session',
        value: props.session.status === 'running'
          ? `${formatSessionTime(props.session.remainingSeconds)} remaining`
          : 'Ready when you are'
      },
      {
        icon: Play,
        label: 'Current activity',
        value: activityGame?.title ?? 'No game running',
        art: activityGame ? { game: activityGame, kind: 'cover' } : undefined
      },
      {
        icon: Layers3,
        label: 'Launcher',
        value: `NXGS Play ${props.appVersion}`
      }
    ];

  useEffect(() => {
    if (!props.focused) return;
    cardRefs.current[props.selectedIndex]?.focus({ preventScroll: true });
  }, [props.focused, props.selectedIndex]);

  return (
    <section className={`dashboard-content ${props.focused ? 'keyboard-focus' : ''}`} aria-label="Dashboard content">
      <div className="content-heading">
        <span className="eyebrow">{props.game ? 'Game hub' : 'NXGS Play'}</span>
        <h2>{props.game ? props.game.title : 'Launcher overview'}</h2>
      </div>
      <div className="content-card-row">
        {cards.map((card, index) => {
          const Icon = card.icon;
          return (
            <article
              ref={(element) => {
                cardRefs.current[index] = element;
              }}
              key={card.label}
              className={`dashboard-card ${card.art ? 'has-art' : `tone-${index}`} ${card.thumbs?.length ? 'has-thumbs' : ''} ${props.focused && index === props.selectedIndex ? 'selected' : ''}`}
              tabIndex={-1}
              onFocus={() => props.onFocusIndex(index)}
              onClick={() => props.onFocusIndex(index)}
            >
              {card.art ? (
                <div className="dashboard-card-art">
                  <SafeGameImage game={card.art.game} kind={card.art.kind} alt="" fallbackSize={40} />
                </div>
              ) : (
                <span className="dashboard-card-watermark" aria-hidden="true">
                  <Icon />
                </span>
              )}
              {card.thumbs && card.thumbs.length > 0 && (
                <span className="dashboard-card-thumbs" aria-hidden="true">
                  {card.thumbs.map((game) => (
                    <span key={game.id}>
                      <SafeGameImage game={game} kind="avatar" alt="" fallbackSize={18} />
                    </span>
                  ))}
                </span>
              )}
              <div className="dashboard-card-top">
                <span className="dashboard-card-icon"><Icon size={20} /></span>
                <span className="dashboard-card-label">{card.label}</span>
              </div>
              <strong className="dashboard-card-value">{card.value}</strong>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function ConsoleHome(props: {
  games: GameRecord[];
  logoPath: string;
  appVersion: string;
  selectedIndex: number;
  selectedGame: GameRecord | null;
  session: SessionState;
  activeGame: ActiveGameState;
  playAccess: HomePlayAccess;
  activeTab: ConsoleTab;
  focusSection: ConsoleFocusSection;
  utilityIndex: number;
  contentIndex: number;
  homeOverlayRequestId: number;
  emergencyCloseRequestId: number;
  onTabChange: (tab: ConsoleTab) => void;
  onHighlightHome: () => void;
  onHighlightGame: (index: number) => void;
  onUtilityFocus: (index: number) => void;
  onContentFocus: (index: number) => void;
  onOpenAdmin: () => void;
  onBrowseGames: () => void;
  onSelectGame: (game: GameRecord) => void;
  launchPendingGameId: string;
}): JSX.Element {
  const playButtonRef = useRef<HTMLButtonElement | null>(null);
  const showingGames = props.activeTab === 'games';
  const heroGame = showingGames ? props.selectedGame : null;
  const gameRunning = hasActiveGame(props.activeGame);
  const gameInForeground = ['launching', 'running', 'quickOverlayOpen', 'resuming', 'closing'].includes(props.activeGame.status);
  const runningIds = runningGameIds(props.activeGame);
  const selectedRunning = Boolean(props.selectedGame && runningIds.has(props.selectedGame.id));
  const launchPending = Boolean(props.selectedGame && props.launchPendingGameId === props.selectedGame.id);
  const longTitle = (props.selectedGame?.title.length ?? 0) > LONG_TITLE_LENGTH;

  useEffect(() => {
    if (props.focusSection === 'hero') {
      playButtonRef.current?.focus({ preventScroll: true });
    }
  }, [props.focusSection]);

  return (
    <section
      className={`console-home ${gameRunning ? 'has-active-game' : ''} ${gameInForeground ? 'game-in-foreground' : ''}`}
      data-tab={props.activeTab}
      data-focus={props.focusSection}
    >
      <GameHeroBackground game={heroGame} />
      <div className="console-dashboard">
        <TopNav
          logoPath={props.logoPath}
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
            <GameAvatarRow
              games={props.games}
              logoPath={props.logoPath}
              selectedIndex={props.selectedIndex}
              focused={props.focusSection === 'games'}
              runningIds={runningIds}
              onHighlightHome={props.onHighlightHome}
              onHighlight={props.onHighlightGame}
              onPlay={props.onSelectGame}
              launchPendingGameId={props.launchPendingGameId}
            />
            <section
              className={`console-hero-copy ${props.selectedGame ? '' : 'home-hero-copy'} ${longTitle ? 'long-title' : ''}`}
              aria-live="polite"
            >
              <div className="console-hero-text" key={props.selectedGame?.id ?? 'home'}>
                <h1 title={props.selectedGame?.title ?? 'Welcome to NXGS Play'}>
                  {props.selectedGame?.title ?? 'Welcome to NXGS Play'}
                </h1>
                {props.selectedGame ? (
                  <div className="console-hero-chips">
                    {props.selectedGame.availabilityStatus === 'available' ? (
                      <span className="ps-chip ps-chip--success">
                        <CircleCheck size={16} />
                        Ready to play
                      </span>
                    ) : (
                      <span className="ps-chip">
                        <Library size={16} />
                        In your library
                      </span>
                    )}
                    {selectedRunning && (
                      <span className="ps-chip ps-chip--accent">
                        <Gamepad2 size={16} />
                        Running now
                      </span>
                    )}
                    {props.playAccess === 'free' ? (
                      <span className="ps-chip">
                        <Zap size={16} />
                        Free play
                      </span>
                    ) : props.playAccess === 'session' ? (
                      <span className="ps-chip">
                        <Timer size={16} />
                        Play time active
                      </span>
                    ) : (
                      <span className="ps-chip">
                        <Timer size={16} />
                        Choose play time
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="console-hero-subtitle">
                    {props.games.length > 0
                      ? 'Your launcher, library, and current session at a glance.'
                      : 'Your library is empty. Add games from Settings to get started.'}
                  </p>
                )}
              </div>
              <div className="console-hero-actions">
                <button
                  ref={playButtonRef}
                  className={`console-play-button ${props.focusSection === 'hero' ? 'controller-focused' : ''} ${launchPending ? 'pending' : ''}`}
                  type="button"
                  disabled={Boolean(props.launchPendingGameId)}
                  onClick={() => props.selectedGame ? props.onSelectGame(props.selectedGame) : props.games.length > 0 ? props.onBrowseGames() : props.onOpenAdmin()}
                >
                  {launchPending
                    ? <LoaderCircle size={24} className="spin" />
                    : props.selectedGame
                      ? <Play size={22} fill="currentColor" strokeWidth={0} />
                      : props.games.length > 0
                        ? <Gamepad2 size={24} />
                        : <Settings size={24} />}
                  <span>
                    {launchPending
                      ? 'Starting...'
                      : props.selectedGame
                        ? 'Play'
                        : props.games.length > 0
                          ? 'Browse games'
                          : 'Open Admin Settings'}
                  </span>
                </button>
              </div>
            </section>
            <DashboardContentRow
              focused={props.focusSection === 'content'}
              selectedIndex={props.contentIndex}
              game={props.selectedGame}
              games={props.games}
              session={props.session}
              activeGame={props.activeGame}
              appVersion={props.appVersion}
              onFocusIndex={props.onContentFocus}
            />
          </>
        ) : (
          <MediaShelf
            focused={props.focusSection === 'content'}
            selectedIndex={props.contentIndex}
            onFocusIndex={props.onContentFocus}
          />
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
