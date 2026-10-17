import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Gamepad2 } from 'lucide-react';
import {
  ConsoleHome,
  type ConsoleFocusSection,
  type ConsoleTab,
  type HomePlayAccess
} from './components/ConsoleHome';
import { QuickHomeOverlay } from './components/QuickHomeOverlay';
import { ConsoleSettings } from './components/ConsoleSettings';
import { AdminScreen } from './components/admin/AdminScreen';
import { AdminOptionsDialog } from './components/dialogs/AdminOptionsDialog';
import { PaymentFlow } from './components/dialogs/PaymentFlow';
import { PinDialog } from './components/dialogs/PinDialog';
import { BootScreen } from './components/system/BootScreen';
import { GameTransitionOverlay } from './components/system/GameTransitionOverlay';
import { WindowedAdminControls } from './components/system/WindowedAdminControls';
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
  AppSettings,
  ControllerIdleNotification,
  GameRecord,
  InitialData,
  KioskAdminAction,
  SessionState
} from '../shared/types';
import { isFreePlayEnabled, requiresPaymentForLaunch } from '../shared/playAccess';
import { SystemToast } from './ui/SystemToast';
import { playUiSound } from './ui/uiSound';

type View = 'home' | 'settings' | 'admin';

const EMPTY_SESSION: SessionState = {
  status: 'idle',
  remainingSeconds: 0,
  warningFiveMinutes: false,
  revision: 0
};

const EMPTY_ACTIVE_GAME: ActiveGameState = {
  status: 'idle',
  updatedAt: new Date(0).toISOString()
};

export function App(): JSX.Element {
  const [initialData, setInitialData] = useState<InitialData | null>(null);
  const [games, setGames] = useState<GameRecord[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [viewHistory, setViewHistory] = useState<View[]>(['home']);
  const [homeTab, setHomeTab] = useState<ConsoleTab>('games');
  const [homeFocusSection, setHomeFocusSection] = useState<ConsoleFocusSection>('games');
  const [homeUtilityIndex, setHomeUtilityIndex] = useState(0);
  const [homeContentIndex, setHomeContentIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [confirmGame, setConfirmGame] = useState<GameRecord | null>(null);
  const [extendPaymentOpen, setExtendPaymentOpen] = useState(false);
  const [extensionStage, setExtensionStage] = useState<'two' | 'final'>('two');
  const [extensionRequestId, setExtensionRequestId] = useState('');
  const [launchPendingGameId, setLaunchPendingGameId] = useState('');
  const [launchNotice, setLaunchNotice] = useState('');
  const [pinOpen, setPinOpen] = useState(false);
  const [session, setSession] = useState<SessionState>(EMPTY_SESSION);
  const [activeGame, setActiveGame] = useState<ActiveGameState>(EMPTY_ACTIVE_GAME);
  const [bootError, setBootError] = useState('');
  const [cursorHidden, setCursorHidden] = useState(false);
  const [homeOverlayRequestId, setHomeOverlayRequestId] = useState(0);
  const [emergencyCloseRequestId, setEmergencyCloseRequestId] = useState(0);
  // Request ids grow monotonically so consumers can tell new requests from
  // ones they already handled, even after remounting.
  const homeOverlaySequence = useRef(0);
  const emergencyCloseSequence = useRef(0);
  const [quickNavOpen, setQuickNavOpen] = useState(false);
  const [adminUnlockRequest, setAdminUnlockRequest] = useState<AdminUnlockRequest | null>(null);
  const [adminOptionsOpen, setAdminOptionsOpen] = useState(false);
  const [adminControlsActive, setAdminControlsActive] = useState(false);
  // Who unlocked the Control Room: the station admin or a moderator. Cleared whenever admin mode ends.
  const [adminRole, setAdminRole] = useState<'admin' | 'moderator' | null>(null);
  const [windowedAdminMode, setWindowedAdminMode] = useState(false);
  const [adminModeTransitionPending, setAdminModeTransitionPending] = useState(false);
  const [adminModeError, setAdminModeError] = useState('');
  const [controllerIdleNotification, setControllerIdleNotification] = useState<ControllerIdleNotification | null>(null);
  const adminModeTransitionBusy = useRef(false);

  const view = viewHistory[viewHistory.length - 1] ?? 'home';
  const navigateToView = useCallback((nextView: View): void => {
    setViewHistory((current) => pushNavigationEntry(current, nextView));
  }, []);
  const navigateBack = useCallback((): void => {
    setViewHistory((current) => popNavigationEntry(current, 'home'));
  }, []);
  const resetToHome = useCallback((): void => {
    setViewHistory(['home']);
    setHomeTab('games');
    setHomeFocusSection('games');
    setHomeContentIndex(0);
    setSelectedIndex(-1);
  }, []);

  const enabledGames = useMemo(() => games.filter((game) => game.enabled), [games]);
  const selectedGame = enabledGames[selectedIndex] ?? null;

  const openAdminPin = useCallback((request?: Partial<AdminUnlockRequest>) => {
    setAdminUnlockRequest({
      source: request?.source ?? 'ui',
      key: request?.key,
      action: request?.action,
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
    setAdminRole(null);
    setWindowedAdminMode(false);
    setAdminModeError('');
    void window.nxgs.performKioskAdminAction('returnLocked');
  }, []);

  const returnToCustomerHome = useCallback(() => {
    resetToHome();
    setQuickNavOpen(false);
    setAdminOptionsOpen(false);
    setAdminControlsActive(false);
    setAdminRole(null);
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
      setAdminRole(null);
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

  const executeAdminAction = useCallback(async (action: KioskAdminAction): Promise<void> => {
    if (action === 'returnLocked') {
      await returnWindowedAdminToKiosk();
      return;
    }
    if (action === 'exitFullscreen') {
      setConfirmGame(null);
      setQuickNavOpen(false);
      resetToHome();
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
    setAdminControlsActive(true);
    if (action === 'openManagement') {
      navigateToView('admin');
    } else if (action === 'exitFullscreen') {
      resetToHome();
      setQuickNavOpen(false);
      const data = await window.nxgs.getInitialData();
      setActiveGame(data.activeGame);
    }
    if (action !== 'closeApp') setAdminOptionsOpen(false);
  }, [navigateToView, resetToHome, returnWindowedAdminToKiosk]);

  const openConsoleSettings = useCallback(() => {
    setConfirmGame(null);
    setQuickNavOpen(false);
    navigateToView('settings');
    if (view !== 'settings') playUiSound('open');
  }, [navigateToView, view]);

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
        setSession(data.session);
      })
      .catch((error) => setBootError(error instanceof Error ? error.message : String(error)));

    const unsubscribeSession = window.nxgs.onSessionState((next) => {
      setSession(next);
    });
    const openExtensionRequest = (request: { id: string; stage: 'two' | 'final' }): void => {
      setConfirmGame(null);
      setExtensionStage(request.stage);
      setExtensionRequestId(request.id);
      setExtendPaymentOpen(true);
    };
    const unsubscribeExtendRequested = window.nxgs.onSessionExtendRequested(openExtensionRequest);
    void window.nxgs.getPendingSessionExtension().then((request) => {
      if (request) openExtensionRequest(request);
    });
    const unsubscribeActiveGame = window.nxgs.onActiveGameState((next) => {
      setActiveGame(next);
      if (next.status === 'error') {
        setLaunchPendingGameId('');
        setLaunchNotice(next.message ?? 'The game could not be started.');
      } else if (next.status === 'running') {
        setLaunchPendingGameId('');
        setLaunchNotice('');
      }
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
      if (event.resetToHome) {
        resetToHome();
      }
      if (event.preserveAdminWindow) {
        setAdminControlsActive(true);
        setWindowedAdminMode(true);
        setAdminModeError('');
      } else {
        setAdminControlsActive(false);
        setAdminRole(null);
        setWindowedAdminMode(false);
        setAdminModeError('');
      }
      setQuickNavOpen(event.openQuickNav ?? false);
      if (event.openActiveGamePanel) {
        homeOverlaySequence.current += 1;
        setHomeOverlayRequestId(homeOverlaySequence.current);
      }
      // Only the Home event that carried the emergency may open the close
      // prompt; later ordinary Home presses must not replay an old request.
      if (event.emergencyClose) {
        emergencyCloseSequence.current += 1;
        setEmergencyCloseRequestId(emergencyCloseSequence.current);
      } else {
        setEmergencyCloseRequestId(0);
      }
    });
    const unsubscribeAdminUnlock = window.nxgs.onAdminUnlockRequested((request) => {
      setConfirmGame(null);
      setQuickNavOpen(false);
      openAdminPin(request);
    });
    // A cloud sync applied main admin edits (device details, games turned on/off) to this station.
    const unsubscribeFleetLocalData = window.nxgs.onFleetLocalDataChanged((change) => {
      setInitialData((current) => current ? { ...current, currentDevice: change.device } : current);
      setGames(change.games);
    });
    const unsubscribeControllerIdle = window.nxgs.onControllerIdleNotification((notification) => {
      setControllerIdleNotification((current) => notification.action === 'clear'
        ? current?.controllerId === notification.controllerId ? null : current
        : notification);
    });
    return () => {
      mounted = false;
      unsubscribeSession();
      unsubscribeExtendRequested();
      unsubscribeActiveGame();
      unsubscribeShellHome();
      unsubscribeAdminUnlock();
      unsubscribeFleetLocalData();
      unsubscribeControllerIdle();
    };
  }, [openAdminPin, resetToHome]);

  useEffect(() => {
    if (!extendPaymentOpen || !extensionRequestId) return;
    const frame = window.requestAnimationFrame(() => {
      void window.nxgs.acknowledgeSessionExtensionOpened(extensionRequestId);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [extendPaymentOpen, extensionRequestId]);

  const launchPaidGame = useCallback(async (game: GameRecord): Promise<boolean> => {
    if (launchPendingGameId) return false;
    setLaunchPendingGameId(game.id);
    setLaunchNotice(`Starting ${game.title}...`);
    try {
      const result = await window.nxgs.launchGame({ gameId: game.id });
      if (!result.ok) throw new Error(result.error ?? 'Game launch failed.');
      setLaunchNotice('');
      return true;
    } catch (error) {
      setLaunchNotice(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setLaunchPendingGameId('');
    }
  }, [launchPendingGameId]);

  const selectGame = useCallback(async (game: GameRecord): Promise<void> => {
    if (launchPendingGameId) return;
    if (!settings || requiresPaymentForLaunch(settings, session)) {
      setConfirmGame(game);
      return;
    }
    await launchPaidGame(game);
  }, [launchPaidGame, launchPendingGameId, session, settings]);

  useEffect(() => {
    if (selectedIndex >= enabledGames.length) {
      setSelectedIndex(enabledGames.length - 1);
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
        } else {
          return;
        }
        playUiSound('move');
        return;
      }
      if (homeFocusSection === 'utilities') {
        const next = homeUtilityIndex + delta;
        if (next < 0) {
          setHomeUtilityIndex(0);
          setHomeTab('media');
          setHomeFocusSection('tabs');
        } else if (next > 2) {
          return;
        } else {
          setHomeUtilityIndex(next);
        }
        playUiSound('move');
        return;
      }
      if (homeFocusSection === 'games' && homeTab === 'games') {
        const next = selectedIndex + delta;
        if (next >= enabledGames.length) {
          setHomeUtilityIndex(0);
          setHomeFocusSection('utilities');
        } else if (Math.max(-1, next) === selectedIndex) {
          return;
        } else {
          setSelectedIndex(Math.max(-1, next));
        }
        playUiSound('move');
        return;
      }
      if (homeFocusSection === 'content') {
        const next = Math.max(0, Math.min(3, homeContentIndex + delta));
        if (next === homeContentIndex) return;
        setHomeContentIndex(next);
        playUiSound('move');
      }
    },
    [confirmGame, enabledGames.length, homeContentIndex, homeFocusSection, homeTab, homeUtilityIndex, pinOpen, selectedIndex, view]
  );

  const moveVertical = useCallback(
    (delta: number) => {
      if (view !== 'home' || confirmGame || pinOpen) {
        return;
      }
      const current = homeFocusSection;
      let next: ConsoleFocusSection = current;
      if (delta < 0) {
        if (current === 'content') next = homeTab === 'games' ? 'hero' : 'tabs';
        else if (current === 'hero') next = 'games';
        else if (current === 'games') next = 'tabs';
      } else if (current === 'tabs' || current === 'utilities') {
        next = homeTab === 'games' ? 'games' : 'content';
      } else if (current === 'games') {
        next = 'hero';
      } else if (current === 'hero') {
        next = 'content';
      }
      if (next === current) return;
      setHomeFocusSection(next);
      playUiSound('move');
    },
    [confirmGame, homeFocusSection, homeTab, pinOpen, view]
  );

  const acceptSelection = useCallback(() => {
    if (view !== 'home' || confirmGame || pinOpen) return;
    if (homeFocusSection === 'utilities') {
      if (homeUtilityIndex !== 1) playUiSound('select');
      document.querySelector<HTMLButtonElement>(`[data-home-utility-index="${homeUtilityIndex}"]`)?.click();
      return;
    }
    if (
      homeTab === 'games' &&
      (homeFocusSection === 'games' || homeFocusSection === 'hero') &&
      selectedGame
    ) {
      if (!launchPendingGameId) playUiSound('select');
      void selectGame(selectedGame);
    } else if (homeTab === 'games' && homeFocusSection === 'hero' && selectedIndex === -1) {
      if (enabledGames.length > 0) {
        playUiSound('select');
        setSelectedIndex(0);
        setHomeFocusSection('games');
      } else {
        openConsoleSettings();
      }
    }
  }, [confirmGame, enabledGames.length, homeFocusSection, homeTab, homeUtilityIndex, launchPendingGameId, openConsoleSettings, pinOpen, selectGame, selectedGame, selectedIndex, view]);

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
      setSelectedIndex(-1);
      setHomeFocusSection('games');
      playUiSound('back');
      return;
    }
    if (homeFocusSection !== 'games' || selectedIndex !== -1) {
      setSelectedIndex(-1);
      setHomeFocusSection('games');
      playUiSound('back');
    }
  }, [closeAdminPin, confirmGame, homeFocusSection, homeTab, navigateBack, pinOpen, returnToCustomerHome, selectedIndex, view]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (pinOpen || adminOptionsOpen) return;
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

  // Native controller input reaches this window even while a game owns the
  // foreground, so Home must ignore it then (mirrors main's foreground rule).
  const gameOwnsForeground = ['launching', 'running', 'quickOverlayOpen', 'resuming', 'closing'].includes(activeGame.status);

  useControllerNavigation(
    view === 'home' &&
      !confirmGame &&
      !pinOpen &&
      !adminOptionsOpen &&
      !quickNavOpen &&
      !gameOwnsForeground &&
      !shouldShowQuickGameOverlay(activeGame),
    handleHomeControllerEvent
  );

  if (bootError) {
    return <BootScreen error={bootError} />;
  }

  if (!initialData || !settings) {
    return <BootScreen />;
  }

  const activeGameOverlayVisible = quickNavOpen && shouldShowQuickGameOverlay(activeGame);
  const homeQuickNavVisible = quickNavOpen && !activeGameOverlayVisible;
  const homePlayAccess: HomePlayAccess = isFreePlayEnabled(settings)
    ? 'free'
    : requiresPaymentForLaunch(settings, session) ? 'paid' : 'session';

  return (
    <main className={`app-shell ${activeGameOverlayVisible ? 'quick-overlay-shell' : ''} ${cursorHidden ? 'cursor-hidden' : ''}`}>
      {activeGameOverlayVisible ? (
        <QuickHomeOverlay
          activeGame={activeGame}
          emergencyCloseRequestId={emergencyCloseRequestId}
          dismissResumesGame={false}
          onDismiss={() => {
            setQuickNavOpen(false);
            void window.nxgs.dismissQuickOverlay();
          }}
        />
      ) : (
        <div key={view} className={`app-screen app-screen--${view}`}>
          {view === 'home' ? (
            <ConsoleHome
              games={enabledGames}
              logoPath={settings.branding.logoPath}
              appVersion={initialData.appVersion}
              selectedIndex={selectedIndex}
              selectedGame={selectedGame}
              session={session}
              activeGame={activeGame}
              playAccess={homePlayAccess}
              activeTab={homeTab}
              focusSection={homeFocusSection}
              utilityIndex={homeUtilityIndex}
              contentIndex={homeContentIndex}
              homeOverlayRequestId={homeOverlayRequestId}
              emergencyCloseRequestId={emergencyCloseRequestId}
              onTabChange={(tab) => {
                setHomeTab(tab);
                if (tab === 'games') {
                  setSelectedIndex(-1);
                  setHomeFocusSection('games');
                } else {
                  setHomeFocusSection('tabs');
                }
              }}
              onHighlightHome={() => {
                setSelectedIndex(-1);
                setHomeFocusSection('games');
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
              onBrowseGames={() => {
                if (enabledGames.length > 0) {
                  setSelectedIndex(0);
                  setHomeFocusSection('games');
                }
              }}
              onSelectGame={(game) => void selectGame(game)}
              launchPendingGameId={launchPendingGameId || (activeGame.status === 'launching' ? activeGame.game?.id ?? '' : '')}
            />
          ) : view === 'settings' ? (
            <ConsoleSettings
              inputBlocked={pinOpen || adminOptionsOpen || quickNavOpen || extendPaymentOpen}
              settings={settings}
              appVersion={initialData.appVersion}
              onSettingsChanged={setSettings}
              onBack={navigateBack}
              onControlRoom={() => openAdminPin({ source: 'Control Room', message: 'Enter Admin PIN to open Control Room.' })}
            />
          ) : (
            <AdminScreen
              games={games}
              settings={settings}
              initialData={initialData}
              onDeviceChanged={(currentDevice) => setInitialData((current) => current ? { ...current, currentDevice } : current)}
              onGamesChanged={setGames}
              onSettingsChanged={setSettings}
              adminRole={adminRole ?? 'moderator'}
              onClose={returnToCustomerHome}
            />
          )}
        </div>
      )}

      {homeQuickNavVisible && (
        <QuickHomeOverlay
          activeGame={activeGame}
          emergencyCloseRequestId={emergencyCloseRequestId}
          dismissResumesGame={false}
          onDismiss={() => {
            setQuickNavOpen(false);
            void window.nxgs.dismissQuickOverlay();
          }}
        />
      )}

      {(controllerIdleNotification?.action === 'show' || launchNotice) && (
        <div className="system-toast-stack">
          {controllerIdleNotification?.action === 'show' && (
            <SystemToast
              floating={false}
              className="controller-idle-notification"
              tone={controllerIdleNotification.kind === 'error' ? 'error' : 'warning'}
              icon={<Gamepad2 size={22} />}
              title={controllerIdleNotification.title}
              message={controllerIdleNotification.message}
            />
          )}
          {launchNotice && (
            <SystemToast
              floating={false}
              className="launch-notice"
              icon={<Gamepad2 size={22} />}
              message={launchNotice}
            />
          )}
        </div>
      )}

      {confirmGame && (
        <PaymentFlow
          mode="launch"
          game={confirmGame}
          onClose={() => setConfirmGame(null)}
          onCompleted={() => setConfirmGame(null)}
        />
      )}

      {extendPaymentOpen && (
        <PaymentFlow
          mode="extend"
          key={extensionRequestId}
          onClose={() => {
            setExtendPaymentOpen(false);
            setExtensionRequestId('');
            void window.nxgs.cancelSessionExtension(extensionStage);
          }}
          onCompleted={() => {
            setExtendPaymentOpen(false);
            setExtensionRequestId('');
            if (activeGame.game) void window.nxgs.resumeActiveGame(activeGame.game.id);
          }}
        />
      )}

      {pinOpen && (
        <PinDialog
          title="Admin PIN"
          message={adminUnlockRequest?.message}
          actionLabel={adminUnlockRequest?.action === 'closeApp' ? 'Close NXGS'
            : adminUnlockRequest?.action === 'exitFullscreen' ? 'Exit Full Screen'
              : adminUnlockRequest?.action === 'minimize' ? 'Minimize NXGS' : 'Unlock'}
          pendingLabel={adminUnlockRequest?.action === 'closeApp' ? 'Closing...'
            : adminUnlockRequest?.action === 'exitFullscreen' ? 'Exiting...'
              : adminUnlockRequest?.action === 'minimize' ? 'Minimizing...' : 'Checking...'}
          onClose={closeAdminPin}
          onSubmit={async (pin) => {
            const result = await window.nxgs.unlockKioskAdminActions(pin);
            if (!result.ok) {
              setAdminRole(null);
              setPinOpen(false);
              setAdminUnlockRequest(null);
              await window.nxgs.performKioskAdminAction('returnLocked');
              return true;
            }
            setAdminRole(result.role ?? 'admin');
            if (adminUnlockRequest?.action) {
              await executeAdminAction(adminUnlockRequest.action);
              setPinOpen(false);
              setAdminUnlockRequest(null);
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
          onAction={executeAdminAction}
        />
      )}

      {windowedAdminMode && adminControlsActive && !adminOptionsOpen && !pinOpen && (
        <WindowedAdminControls
          error={adminModeError}
          pending={adminModeTransitionPending}
          onLock={() => void returnWindowedAdminToKiosk()}
        />
      )}

      {shouldShowBlockingLaunchTransition(activeGame) && (
        <GameTransitionOverlay activeGame={activeGame} logoPath={settings.branding.logoPath} />
      )}
    </main>
  );
}
