import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  LoaderCircle,
  Monitor,
  Play,
  Plus,
  Power,
  RefreshCw,
  Save,
  Search,
  Timer,
  Trash2,
  X
} from 'lucide-react';
import brandImage from './assets/nxgs-gaming-banner.png';
import {
  ConsoleHome,
  type ConsoleFocusSection,
  type ConsoleTab
} from './components/ConsoleHome';
import { QuickHomeOverlay } from './components/QuickHomeOverlay';
import { ConsoleSettings } from './components/ConsoleSettings';
import {
  hasConfirmedGameWindow,
  shouldShowBlockingLaunchTransition,
  shouldShowQuickGameOverlay
} from './launchFlow';
import { isBackKeyboardEvent, popNavigationEntry, pushNavigationEntry, shouldKeepEditing } from './navigation';
import {
  useControllerNavigation,
  useControllerSystem,
  type ControllerNavigationEvent
} from './controllerNavigation';
import type {
  ActiveGameState,
  AdminUnlockRequest,
  AppDiagnostics,
  AppSettings,
  GameInput,
  GameRecord,
  GameSuggestion,
  InitialData,
  KioskAdminAction,
  LaunchType,
  SessionState,
  UpdateCheckResult,
  UpdateDownloadProgress
} from '../shared/types';

type View = 'home' | 'settings' | 'admin';
type AdminTab = 'games' | 'scan' | 'sessions' | 'kiosk' | 'updates';

const EMPTY_SESSION: SessionState = {
  status: 'idle',
  remainingSeconds: 0,
  warningFiveMinutes: false
};

const EMPTY_GAME: GameInput = {
  title: '',
  avatarImagePath: '',
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
  const [viewHistory, setViewHistory] = useState<View[]>(['home']);
  const [homeTab, setHomeTab] = useState<ConsoleTab>('games');
  const [homeFocusSection, setHomeFocusSection] = useState<ConsoleFocusSection>('games');
  const [homeUtilityIndex, setHomeUtilityIndex] = useState(0);
  const [homeContentIndex, setHomeContentIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [confirmGame, setConfirmGame] = useState<GameRecord | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [session, setSession] = useState<SessionState>(EMPTY_SESSION);
  const [activeGame, setActiveGame] = useState<ActiveGameState>(EMPTY_ACTIVE_GAME);
  const [bootError, setBootError] = useState('');
  const [cursorHidden, setCursorHidden] = useState(false);
  const [homeOverlayRequestId, setHomeOverlayRequestId] = useState(0);
  const [emergencyCloseRequestId, setEmergencyCloseRequestId] = useState(0);
  const [quickNavOpen, setQuickNavOpen] = useState(false);
  const [adminUnlockRequest, setAdminUnlockRequest] = useState<AdminUnlockRequest | null>(null);
  const [adminOptionsOpen, setAdminOptionsOpen] = useState(false);
  const [adminControlsActive, setAdminControlsActive] = useState(false);
  const [windowedAdminMode, setWindowedAdminMode] = useState(false);
  const [adminModeTransitionPending, setAdminModeTransitionPending] = useState(false);
  const [adminModeError, setAdminModeError] = useState('');
  const adminModeTransitionBusy = useRef(false);

  const view = viewHistory[viewHistory.length - 1] ?? 'home';
  const navigateToView = useCallback((nextView: View): void => {
    setViewHistory((current) => pushNavigationEntry(current, nextView));
  }, []);
  const navigateBack = useCallback((): void => {
    setViewHistory((current) => popNavigationEntry(current, 'home'));
  }, []);
  const resetToHome = useCallback((): void => setViewHistory(['home']), []);

  const enabledGames = useMemo(() => games.filter((game) => game.enabled), [games]);
  const selectedGame = enabledGames[selectedIndex] ?? null;

  const openAdminPin = useCallback((request?: Partial<AdminUnlockRequest>) => {
    setAdminUnlockRequest({
      source: request?.source ?? 'ui',
      key: request?.key,
      message: request?.message ?? 'Enter Admin PIN to unlock admin controls.',
      requestedAt: request?.requestedAt ?? new Date().toISOString()
    });
    setPinOpen(true);
    void window.nxgs.setAdminPinActive(true);
  }, []);

  const closeAdminPin = useCallback(() => {
    setPinOpen(false);
    setAdminUnlockRequest(null);
    setAdminControlsActive(false);
    setWindowedAdminMode(false);
    setAdminModeError('');
    void window.nxgs.performKioskAdminAction('returnLocked');
  }, []);

  const returnToCustomerHome = useCallback(() => {
    resetToHome();
    setQuickNavOpen(false);
    setAdminOptionsOpen(false);
    setAdminControlsActive(false);
    setWindowedAdminMode(false);
    setAdminModeError('');
    void (async () => {
      await window.nxgs.setKioskMode('customer');
      const data = await window.nxgs.getInitialData();
      setActiveGame(data.activeGame);
    })();
  }, [resetToHome]);

  const returnWindowedAdminToKiosk = useCallback(async (): Promise<void> => {
    if (adminModeTransitionBusy.current) return;
    adminModeTransitionBusy.current = true;
    setAdminModeTransitionPending(true);
    setAdminModeError('');
    setConfirmGame(null);
    setQuickNavOpen(false);
    setAdminOptionsOpen(false);
    resetToHome();
    try {
      const result = await window.nxgs.performKioskAdminAction('returnLocked');
      if (!result.ok) {
        throw new Error(result.error ?? 'Could not return NXGS to locked mode.');
      }
      setAdminControlsActive(false);
      setWindowedAdminMode(false);
      const data = await window.nxgs.getInitialData();
      setActiveGame(data.activeGame);
    } catch (error) {
      setAdminControlsActive(true);
      setWindowedAdminMode(true);
      setAdminModeError(error instanceof Error ? error.message : String(error));
    } finally {
      adminModeTransitionBusy.current = false;
      setAdminModeTransitionPending(false);
    }
  }, [resetToHome]);

  const openConsoleSettings = useCallback(() => {
    setConfirmGame(null);
    setQuickNavOpen(false);
    navigateToView('settings');
  }, [navigateToView]);

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
        resetToHome();
      }
    });
    const unsubscribeActiveGame = window.nxgs.onActiveGameState((next) => {
      setActiveGame(next);
      setConfirmGame((game) => game && hasConfirmedGameWindow(game.id, next) ? null : game);
      if (next.status === 'closing') {
        setHomeOverlayRequestId(0);
      }
      if (['launching', 'running', 'minimizedToHome', 'resuming', 'closing', 'closed', 'error'].includes(next.status)) {
        setQuickNavOpen(false);
      }
      if (next.status === 'launching' || next.status === 'minimizedToHome' || next.status === 'closed') {
        resetToHome();
      }
    });
    const unsubscribeShellHome = window.nxgs.onShellHome((event) => {
      setConfirmGame(null);
      setPinOpen(false);
      setAdminUnlockRequest(null);
      setAdminOptionsOpen(false);
      if (event.preserveAdminWindow) {
        setAdminControlsActive(true);
        setWindowedAdminMode(true);
        setAdminModeError('');
      } else {
        setAdminControlsActive(false);
        setWindowedAdminMode(false);
        setAdminModeError('');
      }
      setQuickNavOpen(event.openQuickNav ?? !event.preserveAdminWindow);
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
  }, [resetToHome]);

  useEffect(() => {
    if (selectedIndex >= enabledGames.length) {
      setSelectedIndex(Math.max(0, enabledGames.length - 1));
    }
    if (initialData && enabledGames.length === 0 && homeFocusSection === 'games') {
      setHomeFocusSection('tabs');
    }
  }, [enabledGames.length, homeFocusSection, initialData, selectedIndex]);

  useEffect(() => {
    if (!settings || adminControlsActive) {
      setCursorHidden(false);
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
  }, [adminControlsActive, settings]);

  const moveHorizontal = useCallback(
    (delta: number) => {
      if (view !== 'home' || confirmGame || pinOpen) {
        return;
      }
      if (homeFocusSection === 'tabs') {
        if (delta > 0 && homeTab === 'games') {
          setHomeTab('media');
        } else if (delta > 0) {
          setHomeUtilityIndex(0);
          setHomeFocusSection('utilities');
        } else if (homeTab === 'media') {
          setHomeTab('games');
        }
        return;
      }
      if (homeFocusSection === 'utilities') {
        setHomeUtilityIndex((index) => {
          const next = index + delta;
          if (next < 0) {
            setHomeTab('media');
            setHomeFocusSection('tabs');
            return 0;
          }
          return Math.min(2, next);
        });
        return;
      }
      if (homeFocusSection === 'games' && homeTab === 'games' && enabledGames.length > 0) {
        setSelectedIndex((index) => {
          const next = index + delta;
          if (next >= enabledGames.length) {
            setHomeUtilityIndex(0);
            setHomeFocusSection('utilities');
            return index;
          }
          return Math.max(0, next);
        });
        return;
      }
      if (homeFocusSection === 'content') {
        setHomeContentIndex((index) => Math.max(0, Math.min(3, index + delta)));
      }
    },
    [confirmGame, enabledGames.length, homeFocusSection, homeTab, pinOpen, view]
  );

  const moveVertical = useCallback(
    (delta: number) => {
      if (view !== 'home' || confirmGame || pinOpen) {
        return;
      }
      setHomeFocusSection((current) => {
        if (delta < 0) {
          if (current === 'content') return homeTab === 'games' && enabledGames.length > 0 ? 'hero' : 'tabs';
          if (current === 'hero') return enabledGames.length > 0 ? 'games' : 'tabs';
          if (current === 'games') return 'tabs';
          return current;
        }
        if (current === 'tabs' || current === 'utilities') {
          return homeTab === 'games' && enabledGames.length > 0 ? 'games' : 'content';
        }
        if (current === 'games') return 'hero';
        if (current === 'hero') return 'content';
        return current;
      });
    },
    [confirmGame, enabledGames.length, homeTab, pinOpen, view]
  );

  const acceptSelection = useCallback(() => {
    if (view !== 'home' || confirmGame || pinOpen) return;
    if (homeFocusSection === 'utilities') {
      document.querySelector<HTMLButtonElement>(`[data-home-utility-index="${homeUtilityIndex}"]`)?.click();
      return;
    }
    if (
      homeTab === 'games' &&
      (homeFocusSection === 'games' || homeFocusSection === 'hero') &&
      selectedGame
    ) {
      setConfirmGame(selectedGame);
    }
  }, [confirmGame, homeFocusSection, homeTab, homeUtilityIndex, pinOpen, selectedGame, view]);

  const back = useCallback(() => {
    if (confirmGame) {
      setConfirmGame(null);
      return;
    }
    if (pinOpen) {
      closeAdminPin();
      return;
    }
    if (view === 'admin') {
      returnToCustomerHome();
      return;
    }
    if (view === 'settings') {
      navigateBack();
      return;
    }
    if (homeTab === 'media') {
      setHomeTab('games');
      setHomeFocusSection(enabledGames.length > 0 ? 'games' : 'tabs');
      return;
    }
    if (homeFocusSection !== 'games' && enabledGames.length > 0) {
      setHomeFocusSection('games');
    }
  }, [closeAdminPin, confirmGame, enabledGames.length, homeFocusSection, homeTab, navigateBack, pinOpen, returnToCustomerHome, view]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (pinOpen || adminOptionsOpen) return;
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'h') {
        event.preventDefault();
        void window.nxgs.requestShellHome('renderer-request');
        return;
      }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        openConsoleSettings();
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        moveHorizontal(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        moveHorizontal(-1);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveVertical(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveVertical(-1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        acceptSelection();
      } else if (isBackKeyboardEvent(event) && !shouldKeepEditing(event)) {
        event.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [acceptSelection, adminOptionsOpen, back, moveHorizontal, moveVertical, openConsoleSettings, pinOpen, view]);


  useControllerSystem(
    useCallback((pad: Gamepad | null) => {
      void window.nxgs.reportControllerState({
        detected: Boolean(pad),
        homeSupported: pad && pad.buttons.length > 16 ? 'unknown' : 'no',
        name: pad?.id
      });
    }, []),
    useCallback((event) => {
      const guidePressed = event.reason === 'guide';
      void window.nxgs.reportControllerState({
        detected: true,
        homeSupported: guidePressed ? 'yes' : 'unknown',
        name: event.pad.id,
        lastButtonPressed: guidePressed
          ? 'PS / Home'
          : event.reason === 'options-share'
            ? 'Options + Share'
            : 'L1 + R1 + Options',
        lastNavigationAction: 'Open quick switcher'
      });
      void window.nxgs.requestShellHome(guidePressed ? 'controller-home' : 'controller-combo');
    }, [])
  );

  const handleHomeControllerEvent = useCallback((event: ControllerNavigationEvent): void => {
    if (event.type === 'back') {
      back();
      void window.nxgs.reportControllerState({ detected: true, homeSupported: event.pad.buttons.length > 16 ? 'unknown' : 'no', name: event.pad.id, lastButtonPressed: 'Circle / B', lastNavigationAction: 'Back' });
      return;
    }
    if (event.type === 'accept') {
      acceptSelection();
      void window.nxgs.reportControllerState({ detected: true, homeSupported: event.pad.buttons.length > 16 ? 'unknown' : 'no', name: event.pad.id, lastButtonPressed: 'X / A', lastNavigationAction: 'Select' });
      return;
    }
    const horizontal = event.direction === 'left' || event.direction === 'right';
    if (horizontal) moveHorizontal(event.direction === 'right' ? 1 : -1);
    else moveVertical(event.direction === 'down' ? 1 : -1);
    void window.nxgs.reportControllerState({
      detected: true,
      homeSupported: event.pad.buttons.length > 16 ? 'unknown' : 'no',
      name: event.pad.id,
      lastButtonPressed: `D-pad / Stick ${event.direction[0].toUpperCase()}${event.direction.slice(1)}`,
      lastNavigationAction: `Move ${event.direction}`
    });
  }, [acceptSelection, back, moveHorizontal, moveVertical]);

  useControllerNavigation(
    view === 'home' &&
      !confirmGame &&
      !pinOpen &&
      !adminOptionsOpen &&
      !quickNavOpen &&
      !shouldShowQuickGameOverlay(activeGame),
    handleHomeControllerEvent
  );

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

  const activeGameOverlayVisible = shouldShowQuickGameOverlay(activeGame);
  const homeQuickNavVisible = quickNavOpen && !activeGameOverlayVisible;

  return (
    <main className={`app-shell ${activeGameOverlayVisible ? 'quick-overlay-shell' : ''} ${cursorHidden ? 'cursor-hidden' : ''}`}>
      {activeGameOverlayVisible ? (
        <QuickHomeOverlay
          activeGame={activeGame}
          emergencyCloseRequestId={emergencyCloseRequestId}
          onDismiss={() => setQuickNavOpen(false)}
        />
      ) : view === 'home' ? (
        <ConsoleHome
          games={enabledGames}
          selectedIndex={selectedIndex}
          selectedGame={selectedGame}
          session={session}
          activeGame={activeGame}
          activeTab={homeTab}
          focusSection={homeFocusSection}
          utilityIndex={homeUtilityIndex}
          contentIndex={homeContentIndex}
          homeOverlayRequestId={homeOverlayRequestId}
          emergencyCloseRequestId={emergencyCloseRequestId}
          onTabChange={(tab) => {
            setHomeTab(tab);
            setHomeFocusSection(tab === 'games' && enabledGames.length > 0 ? 'games' : 'tabs');
          }}
          onHighlightGame={(index) => {
            setSelectedIndex(index);
            setHomeFocusSection('games');
          }}
          onUtilityFocus={(index) => {
            setHomeUtilityIndex(index);
            setHomeFocusSection('utilities');
          }}
          onContentFocus={(index) => {
            setHomeContentIndex(index);
            setHomeFocusSection('content');
          }}
          onOpenAdmin={openConsoleSettings}
          onSelectGame={setConfirmGame}
        />
      ) : view === 'settings' ? (
        <ConsoleSettings
          inputBlocked={pinOpen || adminOptionsOpen}
          onBack={navigateBack}
          onControlRoom={() => openAdminPin({ source: 'Control Room', message: 'Enter Admin PIN to open Control Room.' })}
        />
      ) : (
        <AdminScreen
          games={games}
          settings={settings}
          initialData={initialData}
          onGamesChanged={setGames}
          onSettingsChanged={setSettings}
          onClose={returnToCustomerHome}
        />
      )}

      {homeQuickNavVisible && (
        <QuickHomeOverlay
          activeGame={activeGame}
          emergencyCloseRequestId={emergencyCloseRequestId}
          onDismiss={() => setQuickNavOpen(false)}
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
          message={adminUnlockRequest?.message}
          actionLabel="Unlock"
          pendingLabel="Checking..."
          onClose={closeAdminPin}
          onSubmit={async (pin) => {
            const result = await window.nxgs.unlockKioskAdminActions(pin);
            if (!result.ok) {
              setPinOpen(false);
              setAdminUnlockRequest(null);
              await window.nxgs.performKioskAdminAction('returnLocked');
              return true;
            }
            setPinOpen(false);
            setAdminUnlockRequest(null);
            setAdminControlsActive(true);
            setAdminOptionsOpen(true);
            return true;
          }}
        />
      )}

      {adminOptionsOpen && (
        <AdminOptionsDialog
          onAction={async (action) => {
            if (action === 'returnLocked') {
              await returnWindowedAdminToKiosk();
              return;
            }
            if (action === 'exitFullscreen') {
              setConfirmGame(null);
              setQuickNavOpen(false);
              resetToHome();
              setAdminOptionsOpen(false);
              setAdminModeError('');
            }
            const result = await window.nxgs.performKioskAdminAction(action);
            if (!result.ok) {
              if (action === 'exitFullscreen') {
                setAdminModeError(result.error ?? 'Could not enter windowed admin mode.');
              }
              throw new Error(result.error ?? 'Admin action failed.');
            }
            setWindowedAdminMode(true);
            if (action === 'openManagement') {
              navigateToView('admin');
            } else if (action === 'exitFullscreen') {
              resetToHome();
              setQuickNavOpen(false);
              const data = await window.nxgs.getInitialData();
              setActiveGame(data.activeGame);
            }
            if (action !== 'closeApp') {
              setAdminOptionsOpen(false);
            }
          }}
        />
      )}

      {windowedAdminMode && adminControlsActive && !adminOptionsOpen && !pinOpen && (
        <div className="windowed-admin-controls">
          {adminModeError && <p role="alert">{adminModeError}</p>}
          <button
            type="button"
            className="windowed-admin-lock"
            disabled={adminModeTransitionPending}
            aria-label={adminModeTransitionPending ? 'Returning NXGS to locked kiosk mode' : 'Return NXGS to locked kiosk mode'}
            title="Return to locked kiosk mode"
            onClick={() => void returnWindowedAdminToKiosk()}
          >
            {adminModeTransitionPending ? <LoaderCircle size={22} className="spin" /> : <Lock size={22} />}
          </button>
        </div>
      )}

      {session.status === 'expired' && (
        <ExpiredDialog
          session={session}
          onDismiss={async () => {
            await window.nxgs.clearExpiredSession();
          }}
        />
      )}
      {shouldShowBlockingLaunchTransition(activeGame) && (
        <GameTransitionOverlay activeGame={activeGame} />
      )}
    </main>
  );
}

function AdminOptionsDialog(props: { onAction: (action: KioskAdminAction) => Promise<void> }): JSX.Element {
  const [pendingAction, setPendingAction] = useState<KioskAdminAction | null>(null);
  const [error, setError] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const actionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const actions: Array<{ action: KioskAdminAction; label: string; pendingLabel: string }> = [
    { action: 'minimize', label: 'Minimize App', pendingLabel: 'Minimizing...' },
    { action: 'exitFullscreen', label: 'Exit Full Screen', pendingLabel: 'Exiting...' },
    { action: 'openManagement', label: 'Open Management', pendingLabel: 'Opening...' },
    { action: 'closeApp', label: 'Close NXGS', pendingLabel: 'Closing...' }
  ];

  const runAction = useCallback(async (action: KioskAdminAction): Promise<void> => {
    if (pendingAction) return;
    setPendingAction(action);
    setError('');
    try {
      await props.onAction(action);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setPendingAction(null);
    }
  }, [pendingAction, props]);

  const selectedAction = selectedIndex < actions.length ? actions[selectedIndex].action : 'returnLocked';

  useEffect(() => {
    actionRefs.current[selectedIndex]?.focus({ preventScroll: true });
  }, [selectedIndex]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Backspace'].includes(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (pendingAction) return;
      if (event.key === 'Escape' || event.key === 'Backspace') void runAction('returnLocked');
      else if (event.key === 'Enter') void runAction(selectedAction);
      else {
        const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
        setSelectedIndex((index) => (index + delta + actions.length + 1) % (actions.length + 1));
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [actions.length, pendingAction, runAction, selectedAction]);

  const handleAdminOptionsControllerEvent = useCallback((event: ControllerNavigationEvent): void => {
    if (event.type === 'back') {
      void runAction('returnLocked');
    } else if (event.type === 'accept') {
      void runAction(selectedAction);
    } else {
      const delta = event.direction === 'left' || event.direction === 'up' ? -1 : 1;
      setSelectedIndex((index) => (index + delta + actions.length + 1) % (actions.length + 1));
    }
  }, [actions.length, runAction, selectedAction]);

  useControllerNavigation(!pendingAction, handleAdminOptionsControllerEvent);

  return (
    <div className="modal-backdrop admin-options-backdrop">
      <section className="modal admin-options-modal" aria-label="Admin options">
        <p className="eyebrow">Admin unlocked</p>
        <h2>Options</h2>
        <div className="admin-options-grid">
          {actions.map(({ action, label, pendingLabel }) => (
            <button
              ref={(element) => {
                actionRefs.current[actions.findIndex((item) => item.action === action)] = element;
              }}
              key={action}
              type="button"
              className={`secondary-action ${selectedAction === action ? 'controller-focused' : ''}`}
              disabled={Boolean(pendingAction)}
              onFocus={() => setSelectedIndex(actions.findIndex((item) => item.action === action))}
              onClick={() => void runAction(action)}
            >
              {pendingAction === action ? pendingLabel : label}
            </button>
          ))}
        </div>
        {error && <p className="error-text">{error}</p>}
        <button
          ref={(element) => {
            actionRefs.current[actions.length] = element;
          }}
          type="button"
          className={`primary-action wide ${selectedAction === 'returnLocked' ? 'controller-focused' : ''}`}
          disabled={Boolean(pendingAction)}
          onFocus={() => setSelectedIndex(actions.length)}
          onClick={() => void runAction('returnLocked')}
        >
          {pendingAction === 'returnLocked' ? 'Locking...' : 'Return to Locked Mode'}
        </button>
        <p className="admin-lockdown-note">
          System security shortcuts remain protected while customer mode is active.
        </p>
      </section>
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
          <span>Press controller Home or Options + Share to open NXGS when supported by the connected controller.</span>
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
  const durationOptions = props.durations.length > 0 ? props.durations : [30];
  const [durationIndex, setDurationIndex] = useState(0);
  const [focusArea, setFocusArea] = useState<'durations' | 'launch'>('durations');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const durationRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const launchButtonRef = useRef<HTMLButtonElement | null>(null);
  const duration = durationOptions[durationIndex] ?? durationOptions[0];

  const launch = useCallback(async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const result = await window.nxgs.launchGame({ gameId: props.game.id, durationMinutes: duration });
      if (!result.ok) {
        setError(result.error ?? 'Launch failed.');
        return;
      }
      props.onLaunched();
    } catch (launchError) {
      setError(launchError instanceof Error ? launchError.message : String(launchError));
    } finally {
      setPending(false);
    }
  }, [duration, pending, props]);

  const moveDuration = useCallback((delta: number): void => {
    setFocusArea('durations');
    setDurationIndex((index) => Math.max(0, Math.min(durationOptions.length - 1, index + delta)));
  }, [durationOptions.length]);

  useEffect(() => {
    if (focusArea === 'launch') launchButtonRef.current?.focus({ preventScroll: true });
    else durationRefs.current[durationIndex]?.focus({ preventScroll: true });
  }, [durationIndex, focusArea]);

  const handleLaunchControllerEvent = useCallback((event: ControllerNavigationEvent): void => {
    if (event.type === 'back') {
      if (!pending) props.onClose();
      return;
    }
    if (event.type === 'accept') {
      if (focusArea === 'launch') void launch();
      return;
    }
    if (event.direction === 'left' && focusArea === 'durations') moveDuration(-1);
    else if (event.direction === 'right' && focusArea === 'durations') moveDuration(1);
    else if (event.direction === 'down') setFocusArea('launch');
    else if (event.direction === 'up') setFocusArea('durations');
  }, [focusArea, launch, moveDuration, pending, props]);

  useControllerNavigation(!pending, handleLaunchControllerEvent);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Backspace'].includes(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (pending) return;
      if (event.key === 'Escape' || event.key === 'Backspace') props.onClose();
      else if (event.key === 'ArrowLeft' && focusArea === 'durations') moveDuration(-1);
      else if (event.key === 'ArrowRight' && focusArea === 'durations') moveDuration(1);
      else if (event.key === 'ArrowDown') setFocusArea('launch');
      else if (event.key === 'ArrowUp') setFocusArea('durations');
      else if (focusArea === 'launch') void launch();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [focusArea, launch, moveDuration, pending, props]);

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
          {durationOptions.map((minutes, index) => (
            <button
              ref={(element) => {
                durationRefs.current[index] = element;
              }}
              key={minutes}
              type="button"
              className={durationIndex === index ? 'selected' : ''}
              aria-pressed={durationIndex === index}
              onFocus={() => {
                setDurationIndex(index);
                setFocusArea('durations');
              }}
              onMouseEnter={() => {
                setDurationIndex(index);
                setFocusArea('durations');
              }}
              onClick={() => {
                setDurationIndex(index);
                setFocusArea('durations');
              }}
              disabled={pending}
            >
              <Clock size={18} />
              {minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}` : `${minutes}m`}
            </button>
          ))}
        </div>
        {error && <p className="error-text">{error}</p>}
        <button
          ref={launchButtonRef}
          className={`primary-action wide ${focusArea === 'launch' ? 'controller-focused' : ''}`}
          type="button"
          disabled={pending}
          onFocus={() => setFocusArea('launch')}
          onClick={() => void launch()}
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
  const adminTabs: AdminTab[] = ['games', 'scan', 'sessions', 'kiosk', 'updates'];
  const moveAdminTab = useCallback((delta: number): void => {
    setTab((current) => adminTabs[(adminTabs.indexOf(current) + delta + adminTabs.length) % adminTabs.length]);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Escape', 'b', 'B'].includes(event.key)) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      event.preventDefault();
      const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
      if (event.key === 'Escape' || event.key.toLowerCase() === 'b') props.onClose();
      else setTab((current) => adminTabs[(adminTabs.indexOf(current) + delta + adminTabs.length) % adminTabs.length]);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [props]);

  const handleAdminControllerEvent = useCallback((event: ControllerNavigationEvent): void => {
    if (event.type === 'back') {
      props.onClose();
    } else if (event.type === 'direction') {
      moveAdminTab(event.direction === 'left' || event.direction === 'up' ? -1 : 1);
    }
  }, [moveAdminTab, props]);

  useControllerNavigation(true, handleAdminControllerEvent);

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
      avatarImagePath: suggestion.avatarImagePath ?? suggestion.iconPath ?? suggestion.coverImagePath ?? '',
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
  const [picking, setPicking] = useState<'avatar' | 'cover' | 'exe' | 'folder' | null>(null);
  const [pickerError, setPickerError] = useState('');
  const sourceValue = SOURCE_OPTIONS.includes((props.form.source ?? '') as (typeof SOURCE_OPTIONS)[number])
    ? props.form.source
    : 'Manual';

  const pickImage = async (imageKind: 'avatar' | 'cover'): Promise<void> => {
    setPicking(imageKind);
    setPickerError('');
    try {
      const result = await window.nxgs.selectImageFile(imageKind);
      if (result.canceled) {
        return;
      }
      if (result.error || !result.path) {
        setPickerError(result.error ?? 'No image file was selected.');
        return;
      }
      props.onChange(imageKind === 'avatar' ? 'avatarImagePath' : 'coverImagePath', result.path);
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
      <div className="game-assets full">
        <div className="form-field asset-field">
          <label htmlFor="avatar-image-path">Avatar image path</label>
          <div className="input-with-button">
            <input
              id="avatar-image-path"
              value={props.form.avatarImagePath ?? ''}
              onChange={(event) => props.onChange('avatarImagePath', event.target.value)}
            />
            <button
              className="secondary-action browse-button"
              type="button"
              disabled={picking === 'avatar'}
              onClick={() => pickImage('avatar')}
            >
              <ImageIcon size={18} />
              {picking === 'avatar' ? 'Browsing...' : 'Browse Avatar'}
            </button>
          </div>
          <small className="field-note">Square artwork for the customer game row. Falls back to the cover image.</small>
          {(props.form.avatarImagePath || props.form.coverImagePath) && (
            <div className="asset-preview avatar-preview">
              <img src={coverUrl(props.form.avatarImagePath || props.form.coverImagePath || '')} alt="Selected avatar preview" />
            </div>
          )}
        </div>
        <div className="form-field asset-field">
          <label htmlFor="cover-image-path">Cover / background image path</label>
          <div className="input-with-button">
            <input
              id="cover-image-path"
              value={props.form.coverImagePath ?? ''}
              onChange={(event) => props.onChange('coverImagePath', event.target.value)}
            />
            <button
              className="secondary-action browse-button"
              type="button"
              disabled={picking === 'cover'}
              onClick={() => pickImage('cover')}
            >
              <ImageIcon size={18} />
              {picking === 'cover' ? 'Browsing...' : 'Browse Cover'}
            </button>
          </div>
          <small className="field-note">Wide 16:9 artwork for the console background. Falls back to the avatar image.</small>
          {(props.form.coverImagePath || props.form.avatarImagePath) && (
            <div className="asset-preview cover-preview">
              <img src={coverUrl(props.form.coverImagePath || props.form.avatarImagePath || '')} alt="Selected cover preview" />
            </div>
          )}
        </div>
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
          <small className="field-note">Use the app identifier from Choose Installed Game. No hidden executable path is required.</small>
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
          <DiagnosticItem label="Current mode" value={diagnostics.kiosk.mode} />
          <DiagnosticItem label="Ctrl + Shift + H" value={diagnostics.shortcuts.homeRegistered ? 'yes' : 'no'} />
          <DiagnosticItem label="F10" value={diagnostics.shortcuts.f10Registered ? 'yes' : 'no'} />
          <DiagnosticItem label="Ctrl + Shift + X" value={diagnostics.shortcuts.emergencyCloseRegistered ? 'yes' : 'no'} />
          <DiagnosticItem label="Ctrl + Shift + A" value={diagnostics.shortcuts.adminUnlockRegistered ? 'yes' : 'no'} />
          <DiagnosticItem label="Restricted shortcuts" value={diagnostics.shortcuts.restrictedRegisteredCount.toString()} />
          <DiagnosticItem label="Controller detected" value={diagnostics.controller.detected ? 'yes' : 'no'} />
          <DiagnosticItem label="Controller name" value={diagnostics.controller.name ?? 'none'} />
          <DiagnosticItem label="Controller Home" value={diagnostics.controller.homeSupported} />
          <DiagnosticItem label="Last controller button" value={diagnostics.controller.lastButtonPressed ?? 'none'} />
          <DiagnosticItem label="Last controller action" value={diagnostics.controller.lastNavigationAction ?? 'none'} />
          <DiagnosticItem label="Game controller bridge" value={diagnostics.controllerCompatibility.status} />
          <DiagnosticItem label="Virtual controller driver" value={diagnostics.controllerCompatibility.driverInstalled ? 'installed' : 'missing'} />
          <DiagnosticItem label="Controller mapper" value={diagnostics.controllerCompatibility.mapperRunning ? 'running' : 'stopped'} />
          <DiagnosticItem label="XInput ready" value={diagnostics.controllerCompatibility.xinputReady ? 'yes' : 'no'} />
          <DiagnosticItem label="Controller bridge detail" value={diagnostics.controllerCompatibility.message ?? 'none'} />
          <DiagnosticItem label="Active game state" value={diagnostics.activeGame.status} />
          <DiagnosticItem label="Current game" value={diagnostics.activeGame.title ?? 'none'} />
          <DiagnosticItem label="Game process ID" value={diagnostics.activeGame.processId?.toString() ?? 'none'} />
          <DiagnosticItem label="Game window handle" value={diagnostics.activeGame.windowHandle?.toString() ?? 'none'} />
          <DiagnosticItem label="Game window detected" value={diagnostics.activeGame.windowDetected ? 'yes' : 'no'} />
          <DiagnosticItem label="Game state" value={diagnostics.activeGame.windowState ?? 'unknown'} />
          <DiagnosticItem label="Last Home result" value={diagnostics.activeGame.lastHomeResult ?? 'none'} />
          <DiagnosticItem label="Last Resume result" value={diagnostics.activeGame.lastResumeResult ?? 'none'} />
          <DiagnosticItem label="Last handoff error" value={diagnostics.activeGame.lastError ?? 'none'} />
          <DiagnosticItem label="NXGS visible" value={diagnostics.kiosk.launcherVisible ? 'yes' : 'no'} />
          <DiagnosticItem label="System bar hidden" value={diagnostics.kiosk.taskbarHidden ? 'yes' : 'no'} />
          <DiagnosticItem label="Always on top" value={diagnostics.kiosk.alwaysOnTop ? 'yes' : 'no'} />
          <DiagnosticItem label="Last Home trigger" value={diagnostics.kiosk.lastHomeTrigger ?? 'none'} />
          <DiagnosticItem label="Last restricted input" value={diagnostics.kiosk.lastRestrictedInput ?? 'none'} />
          <DiagnosticItem label="Last input error" value={diagnostics.kiosk.lastInputError ?? 'none'} />
        </div>
        <p className="field-note">
          Controller Home support depends on the connected controller. Ctrl+Shift+H and F10 are test fallbacks; production
          lockdown depends on the configured device policy.
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
  const [downloadedInstallerSha256, setDownloadedInstallerSha256] = useState('');
  const [downloadProgress, setDownloadProgress] = useState<UpdateDownloadProgress | null>(null);
  const [restartPromptOpen, setRestartPromptOpen] = useState(false);
  const [restartPromptIndex, setRestartPromptIndex] = useState(0);
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
        sha256: downloadedInstallerSha256 || result?.sha256
      });
      setOperationMessage(install.message);
      setOperationOk(install.ok);
    } finally {
      setPendingAction(null);
    }
  };

  const handleUpdatePromptControllerEvent = useCallback((event: ControllerNavigationEvent): void => {
    if (event.type === 'back') {
      setRestartPromptOpen(false);
    } else if (event.type === 'accept') {
      if (restartPromptIndex === 0) setRestartPromptOpen(false);
      else void installDownloadedUpdate();
    } else {
      setRestartPromptIndex(event.direction === 'left' || event.direction === 'up' ? 0 : 1);
    }
  }, [installDownloadedUpdate, restartPromptIndex]);

  useControllerNavigation(restartPromptOpen && !pending, handleUpdatePromptControllerEvent);

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
                setDownloadedInstallerSha256(download.sha256 ?? result.sha256 ?? '');
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
                className={`secondary-action ${restartPromptIndex === 0 ? 'controller-focused' : ''}`}
                type="button"
                disabled={pendingAction === 'install'}
                onFocus={() => setRestartPromptIndex(0)}
                onClick={() => setRestartPromptOpen(false)}
              >
                Later
              </button>
              <button
                className={`primary-action ${restartPromptIndex === 1 ? 'controller-focused' : ''}`}
                type="button"
                disabled={pendingAction === 'install'}
                onFocus={() => setRestartPromptIndex(1)}
                onClick={installDownloadedUpdate}
              >
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
  message?: string;
  actionLabel: string;
  pendingLabel: string;
  onClose: () => void;
  onSubmit: (pin: string) => Promise<boolean>;
}): JSX.Element {
  const [pin, setPin] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const keypad = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Clear', '0', 'Submit'] as const;
  const [keypadIndex, setKeypadIndex] = useState(0);
  const [focusArea, setFocusArea] = useState<'keypad' | 'unlock'>('keypad');
  const keypadRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const unlockButtonRef = useRef<HTMLButtonElement | null>(null);

  const submitPin = useCallback(async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const ok = await props.onSubmit(pin);
      if (!ok) setError('Invalid PIN.');
    } finally {
      setPending(false);
    }
  }, [pending, pin, props]);

  const activateKeypad = useCallback((): void => {
    const key = keypad[keypadIndex];
    if (key === 'Submit') void submitPin();
    else if (key === 'Clear') setPin((value) => value.slice(0, -1));
    else setPin((value) => `${value}${key}`.slice(0, 12));
  }, [keypad, keypadIndex, submitPin]);

  useEffect(() => {
    if (focusArea === 'unlock') unlockButtonRef.current?.focus({ preventScroll: true });
    else keypadRefs.current[keypadIndex]?.focus({ preventScroll: true });
  }, [focusArea, keypadIndex]);

  const movePinVertical = useCallback((direction: -1 | 1): void => {
    if (focusArea === 'unlock') {
      if (direction < 0) setFocusArea('keypad');
      return;
    }
    const row = Math.floor(keypadIndex / 3);
    if (direction > 0 && row === 3) {
      setFocusArea('unlock');
      return;
    }
    setKeypadIndex((index) => Math.max(0, Math.min(keypad.length - 1, index + direction * 3)));
  }, [focusArea, keypad.length, keypadIndex]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Backspace', 'b', 'B'].includes(event.key)) return;
      if (event.target instanceof HTMLInputElement && event.key === 'Backspace') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (pending) return;
      if (event.key === 'Escape' || event.key === 'Backspace' || event.key.toLowerCase() === 'b') props.onClose();
      else if (event.key === 'Enter') {
        if (event.target instanceof HTMLInputElement || focusArea === 'unlock') void submitPin();
        else activateKeypad();
      } else if (event.key === 'ArrowLeft' && focusArea === 'keypad') {
        setKeypadIndex((index) => (index - 1 + keypad.length) % keypad.length);
      } else if (event.key === 'ArrowRight' && focusArea === 'keypad') {
        setKeypadIndex((index) => (index + 1) % keypad.length);
      } else if (event.key === 'ArrowUp') {
        movePinVertical(-1);
      } else if (event.key === 'ArrowDown') {
        movePinVertical(1);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [activateKeypad, focusArea, keypad.length, movePinVertical, pending, props, submitPin]);

  const handlePinControllerEvent = useCallback((event: ControllerNavigationEvent): void => {
    if (event.type === 'back') {
      props.onClose();
      void window.nxgs.reportControllerState({ detected: true, name: event.pad.id, homeSupported: event.pad.buttons.length > 16 ? 'unknown' : 'no', lastButtonPressed: 'Circle / B', lastNavigationAction: 'PIN keypad: cancel' });
      return;
    }
    if (event.type === 'accept') {
      if (focusArea === 'unlock') void submitPin();
      else activateKeypad();
      void window.nxgs.reportControllerState({ detected: true, name: event.pad.id, homeSupported: event.pad.buttons.length > 16 ? 'unknown' : 'no', lastButtonPressed: 'X / A', lastNavigationAction: focusArea === 'unlock' ? 'PIN: unlock' : 'PIN keypad: select' });
      return;
    }
    if (event.direction === 'left' && focusArea === 'keypad') {
      setKeypadIndex((index) => (index - 1 + keypad.length) % keypad.length);
    } else if (event.direction === 'right' && focusArea === 'keypad') {
      setKeypadIndex((index) => (index + 1) % keypad.length);
    } else if (event.direction === 'up') {
      movePinVertical(-1);
    } else if (event.direction === 'down') {
      movePinVertical(1);
    }
  }, [activateKeypad, focusArea, keypad.length, movePinVertical, props, submitPin]);

  useControllerNavigation(!pending, handlePinControllerEvent);

  return (
    <div className="modal-backdrop">
      <form
        className="modal pin-modal"
        onSubmit={async (event) => {
          event.preventDefault();
          await submitPin();
        }}
      >
        <button className="icon-button close-button" type="button" title="Close" onClick={props.onClose} disabled={pending}>
          <X size={20} />
        </button>
        <Lock size={34} />
        <h2>{props.title}</h2>
        {props.message && <p className="muted">{props.message}</p>}
        <input type="password" value={pin} onChange={(event) => setPin(event.target.value)} />
        <div className="pin-keypad" aria-label="Controller PIN keypad">
          {keypad.map((key, index) => (
            <button
              ref={(element) => {
                keypadRefs.current[index] = element;
              }}
              key={key}
              type="button"
              className={focusArea === 'keypad' && index === keypadIndex ? 'selected' : ''}
              disabled={pending}
              onFocus={() => {
                setKeypadIndex(index);
                setFocusArea('keypad');
              }}
              onMouseEnter={() => {
                setKeypadIndex(index);
                setFocusArea('keypad');
              }}
              onClick={() => {
                setKeypadIndex(index);
                if (key === 'Submit') void submitPin();
                else if (key === 'Clear') setPin((value) => value.slice(0, -1));
                else setPin((value) => `${value}${key}`.slice(0, 12));
              }}
            >
              {key}
            </button>
          ))}
        </div>
        {error && <p className="error-text">{error}</p>}
        <button
          ref={unlockButtonRef}
          className={`primary-action wide ${focusArea === 'unlock' ? 'controller-focused' : ''}`}
          type="submit"
          disabled={pending}
          onFocus={() => setFocusArea('unlock')}
        >
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
  const dismiss = useCallback(async (): Promise<void> => {
    if (pendingDismiss) return;
    setPendingDismiss(true);
    try {
      await props.onDismiss();
    } finally {
      setPendingDismiss(false);
    }
  }, [pendingDismiss, props]);

  const handleExpiredControllerEvent = useCallback((event: ControllerNavigationEvent): void => {
    if (event.type === 'accept' || event.type === 'back') void dismiss();
  }, [dismiss]);

  useControllerNavigation(!pendingDismiss && !pendingForce, handleExpiredControllerEvent);

  return (
    <div className="modal-backdrop urgent">
      <section className="modal">
        <AlertTriangle size={42} />
        <h2>Session expired</h2>
        <p className="muted">{props.session.gameTitle ? `${props.session.gameTitle} time has ended.` : 'The session time has ended.'}</p>
        {error && <p className="error-text">{error}</p>}
        <button
          className="primary-action wide controller-focused"
          type="button"
          disabled={pendingDismiss}
          onClick={() => void dismiss()}
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
