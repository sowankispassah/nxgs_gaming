import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Gamepad2,
  Home,
  Music2,
  Play,
  Power,
  Settings,
  UsersRound,
  X
} from 'lucide-react';
import type { ActiveGameState } from '../../shared/types';
import { SafeGameImage } from './ConsoleHome';

type PendingAction = 'resume' | 'home' | 'close' | 'admin' | 'force' | null;
type FocusArea = 'navbar' | 'menu';

const MENU_LABELS = ['Resume Game', 'Go to Launcher Home', 'Close Game'] as const;

export function QuickHomeOverlay(props: {
  activeGame: ActiveGameState;
  emergencyCloseRequestId: number;
  onOpenAdmin: (source: string) => void;
}): JSX.Element {
  const game = props.activeGame.game;
  const [selectedNavIndex, setSelectedNavIndex] = useState(1);
  const [menuIndex, setMenuIndex] = useState(0);
  const [focusArea, setFocusArea] = useState<FocusArea>('menu');
  const [confirmClose, setConfirmClose] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [forcePin, setForcePin] = useState('');
  const [now, setNow] = useState(() => new Date());

  const navItems = useMemo(
    () => [
      { key: 'home', label: 'Launcher Home', icon: <Home size={23} /> },
      { key: 'game', label: game?.title ?? 'Active game', icon: null },
      { key: 'notifications', label: 'Notifications coming soon', icon: <Bell size={21} /> },
      { key: 'players', label: 'Players coming soon', icon: <UsersRound size={22} /> },
      { key: 'audio', label: 'Audio coming soon', icon: <Music2 size={22} /> },
      { key: 'settings', label: 'Protected settings', icon: <Settings size={22} /> },
      { key: 'power', label: 'Protected power controls', icon: <Power size={22} /> }
    ],
    [game?.title]
  );

  const closeFailed = /did not close|force close/i.test(props.activeGame.message ?? '');
  const activeNavItem = navItems[selectedNavIndex];
  const gameSelected = activeNavItem?.key === 'game';
  const disabled = pendingAction !== null || props.activeGame.status === 'closing';

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (props.emergencyCloseRequestId > 0) {
      setSelectedNavIndex(1);
      setFocusArea('menu');
      setMenuIndex(2);
      setConfirmClose(true);
    }
  }, [props.emergencyCloseRequestId]);

  useEffect(() => {
    if (!notice) {
      return undefined;
    }
    const timer = window.setTimeout(() => setNotice(''), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const resumeGame = useCallback(async (): Promise<void> => {
    if (pendingAction) {
      return;
    }
    setPendingAction('resume');
    setMessage('');
    try {
      const result = await window.nxgs.resumeActiveGame();
      if (!result.ok) {
        setMessage(result.error ?? 'NXGS could not resume the game.');
      }
    } finally {
      setPendingAction(null);
    }
  }, [pendingAction]);

  const goToLauncherHome = useCallback(async (): Promise<void> => {
    if (pendingAction) {
      return;
    }
    setPendingAction('home');
    setMessage('');
    try {
      const result = await window.nxgs.goToLauncherHome();
      if (!result.ok) {
        setMessage(result.error ?? 'NXGS could not open Launcher Home.');
      }
    } finally {
      setPendingAction(null);
    }
  }, [pendingAction]);

  const closeGame = useCallback(async (): Promise<void> => {
    if (pendingAction) {
      return;
    }
    setPendingAction('close');
    setMessage('');
    try {
      const result = await window.nxgs.closeActiveGame();
      if (!result.ok) {
        setMessage(result.error ?? 'NXGS could not close the game.');
      }
    } finally {
      setPendingAction(null);
    }
  }, [pendingAction]);

  const openProtectedArea = useCallback(
    async (source: string): Promise<void> => {
      if (pendingAction) {
        return;
      }
      setPendingAction('admin');
      setMessage('');
      try {
        const result = await window.nxgs.goToLauncherHome();
        if (!result.ok) {
          setMessage(result.error ?? 'NXGS could not safely open the protected controls.');
          return;
        }
        props.onOpenAdmin(source);
      } finally {
        setPendingAction(null);
      }
    },
    [pendingAction, props]
  );

  const selectMenuAction = useCallback(
    (index: number): void => {
      if (disabled) {
        return;
      }
      if (index === 0) {
        void resumeGame();
      } else if (index === 1) {
        void goToLauncherHome();
      } else {
        setMenuIndex(0);
        setConfirmClose(true);
      }
    },
    [disabled, goToLauncherHome, resumeGame]
  );

  const selectNavAction = useCallback(
    (index: number): void => {
      const item = navItems[index];
      if (!item || disabled) {
        return;
      }
      setSelectedNavIndex(index);
      if (item.key === 'home') {
        void goToLauncherHome();
      } else if (item.key === 'game') {
        setFocusArea('menu');
      } else if (item.key === 'settings' || item.key === 'power') {
        void openProtectedArea(item.key === 'settings' ? 'quick overlay settings' : 'quick overlay power controls');
      } else {
        setNotice(item.label);
      }
    },
    [disabled, goToLauncherHome, navItems, openProtectedArea]
  );

  const handleBack = useCallback((): void => {
    if (confirmClose) {
      setConfirmClose(false);
      return;
    }
    if (focusArea === 'menu' && menuIndex !== 0) {
      setMenuIndex(0);
      return;
    }
    void resumeGame();
  }, [confirmClose, focusArea, menuIndex, resumeGame]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'b', 'B'].includes(event.key)) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (disabled) {
        return;
      }
      if (event.key === 'Escape' || event.key.toLowerCase() === 'b') {
        handleBack();
        return;
      }
      if (confirmClose) {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          setMenuIndex((index) => (index === 0 ? 1 : 0));
        } else if (event.key === 'Enter') {
          if (menuIndex === 0) {
            void closeGame();
          } else {
            setConfirmClose(false);
          }
        }
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const delta = event.key === 'ArrowRight' ? 1 : -1;
        setSelectedNavIndex((index) => (index + delta + navItems.length) % navItems.length);
        setFocusArea('navbar');
        return;
      }
      if (event.key === 'ArrowUp' && gameSelected) {
        setFocusArea('menu');
        return;
      }
      if (event.key === 'ArrowDown' && focusArea === 'menu') {
        setMenuIndex((index) => Math.min(MENU_LABELS.length - 1, index + 1));
        return;
      }
      if (event.key === 'ArrowUp' && focusArea === 'menu') {
        setMenuIndex((index) => Math.max(0, index - 1));
        return;
      }
      if (event.key === 'Enter') {
        if (focusArea === 'menu' && gameSelected) {
          selectMenuAction(menuIndex);
        } else {
          selectNavAction(selectedNavIndex);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [closeGame, confirmClose, disabled, focusArea, gameSelected, handleBack, menuIndex, navItems.length, selectMenuAction, selectNavAction, selectedNavIndex]);

  useEffect(() => {
    let lastInputAt = 0;
    const interval = window.setInterval(() => {
      const pad = navigator.getGamepads?.()[0];
      if (!pad || Date.now() - lastInputAt < 190 || disabled) {
        return;
      }
      const pressed = (index: number): boolean => Boolean(pad.buttons[index]?.pressed);
      if (pressed(15) || pad.axes[0] > 0.65) {
        lastInputAt = Date.now();
        setSelectedNavIndex((index) => (index + 1) % navItems.length);
        setFocusArea('navbar');
      } else if (pressed(14) || pad.axes[0] < -0.65) {
        lastInputAt = Date.now();
        setSelectedNavIndex((index) => (index - 1 + navItems.length) % navItems.length);
        setFocusArea('navbar');
      } else if (pressed(13) || pad.axes[1] > 0.65) {
        lastInputAt = Date.now();
        if (focusArea === 'menu') {
          setMenuIndex((index) => Math.min(MENU_LABELS.length - 1, index + 1));
        }
      } else if (pressed(12) || pad.axes[1] < -0.65) {
        lastInputAt = Date.now();
        if (gameSelected) {
          setFocusArea('menu');
          setMenuIndex((index) => Math.max(0, index - 1));
        }
      } else if (pressed(0)) {
        lastInputAt = Date.now();
        if (confirmClose) {
          if (menuIndex === 0) void closeGame();
          else setConfirmClose(false);
        } else if (focusArea === 'menu' && gameSelected) {
          selectMenuAction(menuIndex);
        } else {
          selectNavAction(selectedNavIndex);
        }
      } else if (pressed(1)) {
        lastInputAt = Date.now();
        handleBack();
      }
    }, 90);
    return () => window.clearInterval(interval);
  }, [closeGame, confirmClose, disabled, focusArea, gameSelected, handleBack, menuIndex, navItems.length, selectMenuAction, selectNavAction, selectedNavIndex]);

  if (!game) {
    return <div className="quick-home-overlay" />;
  }

  return (
    <section className="quick-home-overlay" aria-label="NXGS quick home overlay">
      <div className="quick-overlay-shade" />
      <header className="quick-overlay-header">
        <div className="quick-overlay-brand"><Gamepad2 size={18} /> NXGS Switcher</div>
        <time dateTime={now.toISOString()}>
          {new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(now)}
        </time>
      </header>

      {gameSelected && (
        <section className="quick-game-menu" aria-label={`${game.title} controls`}>
          <div className="quick-game-heading">
            <span className="quick-game-art"><SafeGameImage game={game} kind="avatar" alt="" fallbackSize={28} /></span>
            <div><small>Active game</small><strong>{game.title}</strong></div>
          </div>
          {message && <p className="quick-overlay-error">{message}</p>}
          {!message && props.activeGame.message && <p className="quick-overlay-status">{props.activeGame.message}</p>}

          {confirmClose ? (
            <div className="quick-close-confirm">
              <strong>Close {game.title}?</strong>
              <span>The game will receive a normal close request.</span>
              <div>
                <button className={menuIndex === 0 ? 'focused' : ''} type="button" disabled={disabled} onClick={() => void closeGame()}>
                  {pendingAction === 'close' ? 'Closing...' : 'Confirm Close'}
                </button>
                <button className={menuIndex === 1 ? 'focused' : ''} type="button" disabled={disabled} onClick={() => setConfirmClose(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="quick-game-actions">
              {MENU_LABELS.map((label, index) => (
                <button
                  key={label}
                  className={focusArea === 'menu' && menuIndex === index ? 'focused' : ''}
                  type="button"
                  disabled={disabled}
                  onMouseEnter={() => { setFocusArea('menu'); setMenuIndex(index); }}
                  onClick={() => selectMenuAction(index)}
                >
                  {index === 0 && <Play size={18} />}
                  {index === 1 && <Home size={18} />}
                  {index === 2 && <X size={18} />}
                  {pendingAction === 'resume' && index === 0
                    ? 'Resuming...'
                    : pendingAction === 'home' && index === 1
                      ? 'Opening Home...'
                      : label}
                </button>
              ))}
            </div>
          )}

          {closeFailed && (
            <div className="quick-force-close">
              <label><span>Admin PIN for Force Close</span><input type="password" value={forcePin} onChange={(event) => setForcePin(event.target.value)} /></label>
              <button
                type="button"
                disabled={disabled || pendingAction === 'force'}
                onClick={async () => {
                  setPendingAction('force');
                  setMessage('');
                  try {
                    const result = await window.nxgs.forceCloseGame(forcePin);
                    if (!result.ok) setMessage('Invalid admin PIN.');
                  } finally {
                    setPendingAction(null);
                  }
                }}
              >
                <Power size={17} /> {pendingAction === 'force' ? 'Force closing...' : 'Force Close'}
              </button>
            </div>
          )}
        </section>
      )}

      <nav className="quick-navbar" aria-label="NXGS quick navigation">
        {navItems.map((item, index) => (
          <button
            key={item.key}
            className={`quick-nav-item ${selectedNavIndex === index ? 'selected' : ''} ${item.key === 'game' ? 'active-game' : ''}`}
            type="button"
            title={item.label}
            aria-label={item.label}
            disabled={disabled}
            onMouseEnter={() => { setSelectedNavIndex(index); setFocusArea('navbar'); }}
            onClick={() => selectNavAction(index)}
          >
            {item.key === 'game' ? <SafeGameImage game={game} kind="avatar" alt="" fallbackSize={25} /> : item.icon}
            {item.key === 'game' && <span className="active-dot" />}
          </button>
        ))}
      </nav>

      {notice && <div className="quick-overlay-toast">{notice}</div>}
      <div className="quick-overlay-hint">← → Navigate&nbsp;&nbsp; • &nbsp;&nbsp;A / Enter Select&nbsp;&nbsp; • &nbsp;&nbsp;B / Esc Back</div>
    </section>
  );
}
