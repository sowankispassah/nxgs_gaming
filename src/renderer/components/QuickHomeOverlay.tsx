import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Bell,
  Gamepad2,
  Home,
  LoaderCircle,
  Music2,
  Play,
  Power,
  Settings,
  Sun,
  UsersRound,
  Volume2,
  VolumeX,
  X
} from 'lucide-react';
import type { ActiveGameState, AudioStatus, DisplayStatus, TrackedGameSessionState } from '../../shared/types';
import { SafeGameImage } from './ConsoleHome';
import { isBackKeyboardEvent, shouldKeepEditing } from '../navigation';
import { useControllerNavigation, type ControllerNavigationEvent } from '../controllerNavigation';

type PendingAction = 'resume' | 'home' | 'close' | 'force' | null;
type FocusArea = 'navbar' | 'menu' | 'quickAudio' | 'quickBrightness';
type NavItem = {
  key: string;
  label: string;
  icon: JSX.Element | null;
  session?: TrackedGameSessionState;
};

const MENU_LABELS = ['Resume Game', 'Go to Launcher Home', 'Close Game'] as const;
const SWITCHER_INPUT_DEDUPLICATION_MS = 120;

const EMPTY_AUDIO: AudioStatus = {
  supported: true,
  masterVolume: 0,
  muted: false,
  inputVolume: 0,
  inputMuted: false,
  outputDevices: [],
  inputDevices: [],
  deviceSwitchingSupported: false
};

const EMPTY_DISPLAY: DisplayStatus = {
  supported: true,
  displays: [],
  brightness: { supported: true, level: 0 },
  nightLight: { supported: false, enabled: false, controlSupported: false, message: 'Night Light is unavailable.' },
  colorProfile: { currentProfile: 'System default', availableProfiles: [], switchingSupported: false, message: 'Color profile switching is unavailable.' },
  hdr: { support: 'unknown', enabled: false, controlSupported: false, message: 'HDR status is unavailable.' }
};

let quickAudioSnapshot: AudioStatus | null = null;
let quickDisplaySnapshot: DisplayStatus | null = null;

function quickOverlayImageUrl(path: string): string {
  if (!path) return '';
  if (/^(https?:|file:)/i.test(path)) return path;
  return `file:///${path.replace(/\\/g, '/')}`;
}

export function QuickHomeOverlay(props: {
  activeGame: ActiveGameState;
  emergencyCloseRequestId: number;
  liveGameBackdrop?: boolean;
  dismissResumesGame?: boolean;
  onDismiss: () => void;
}): JSX.Element {
  const sessions = useMemo<TrackedGameSessionState[]>(() => {
    if (props.activeGame.sessions?.length) {
      return props.activeGame.sessions;
    }
    if (!props.activeGame.game) {
      return [];
    }
    return [{
      game: props.activeGame.game,
      status: props.activeGame.status,
      message: props.activeGame.message,
      windowDetected: Boolean(props.activeGame.windowDetected),
      windowState: props.activeGame.windowState ?? 'unknown',
      isActive: true,
      updatedAt: props.activeGame.updatedAt
    }];
  }, [props.activeGame]);
  const initiallyActiveIndex = Math.max(0, sessions.findIndex((session) => session.isActive));
  const initialNavKey = sessions.length > 0 ? `game:${sessions[initiallyActiveIndex].game.id}` : 'home';
  const [selectedNavKey, setSelectedNavKey] = useState(
    initialNavKey
  );
  const [menuIndex, setMenuIndex] = useState(0);
  const [focusArea, setFocusArea] = useState<FocusArea>('navbar');
  const [confirmClose, setConfirmClose] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [forcePin, setForcePin] = useState('');
  const [now, setNow] = useState(() => new Date());
  const [audio, setAudio] = useState<AudioStatus>(() => quickAudioSnapshot ?? EMPTY_AUDIO);
  const [displayVolume, setDisplayVolume] = useState(() => quickAudioSnapshot?.masterVolume ?? 0);
  const [quickSettingsOpen, setQuickSettingsOpen] = useState(false);
  const [audioPending, setAudioPending] = useState<'volume' | 'mute' | null>(null);
  const [audioMessage, setAudioMessage] = useState('');
  const [display, setDisplay] = useState<DisplayStatus>(() => quickDisplaySnapshot ?? EMPTY_DISPLAY);
  const [displayBrightness, setDisplayBrightness] = useState(() => quickDisplaySnapshot?.brightness.level ?? 0);
  const [brightnessMessage, setBrightnessMessage] = useState('');
  const audioBusy = useRef(false);
  const audioRefreshActive = useRef(false);
  const audioInteractionVersion = useRef(0);
  const displayVolumeRef = useRef(quickAudioSnapshot?.masterVolume ?? 0);
  const audioSupportedRef = useRef(quickAudioSnapshot?.supported ?? true);
  const volumeTarget = useRef<number | null>(null);
  const volumeFlushActive = useRef(false);
  const brightnessRefreshActive = useRef(false);
  const brightnessInteractionVersion = useRef(0);
  const brightnessValueRef = useRef(quickDisplaySnapshot?.brightness.level ?? 0);
  const brightnessSupportedRef = useRef(quickDisplaySnapshot?.brightness.supported ?? true);
  const brightnessTarget = useRef<number | null>(null);
  const brightnessFlushActive = useRef(false);
  const initialNavActionRef = useRef<HTMLButtonElement | null>(null);
  const lastSwitcherInput = useRef({ action: '', at: 0 });

  const navItems = useMemo<NavItem[]>(
    () => [
      { key: 'home', label: 'Launcher Home', icon: <Home size={23} /> },
      ...sessions.map((session) => ({
        key: `game:${session.game.id}`,
        label: session.game.title,
        icon: null,
        session
      })),
      { key: 'notifications', label: 'Notifications coming soon', icon: <Bell size={21} /> },
      { key: 'players', label: 'Players coming soon', icon: <UsersRound size={22} /> },
      { key: 'audio', label: 'Audio coming soon', icon: <Music2 size={22} /> },
      { key: 'settings', label: 'Quick Settings', icon: <Settings size={22} /> },
      { key: 'power', label: 'Protected power controls', icon: <Power size={22} /> }
    ],
    [sessions]
  );

  const selectedNavIndex = Math.max(0, navItems.findIndex((item) => item.key === selectedNavKey));
  const activeNavItem = navItems[selectedNavIndex];
  const selectedSession = activeNavItem?.session;
  const activeSession = sessions.find((session) => session.isActive) ?? sessions[0];
  const resumeTargetSession = selectedSession ?? activeSession;
  const game = selectedSession?.game;
  const gameSelected = Boolean(selectedSession);
  const closeFailed = /did not close|force close/i.test(selectedSession?.message ?? '');
  const closingSession = sessions.find((session) => session.status === 'closing');
  const isClosingGame = Boolean(closingSession);
  const disabled = pendingAction !== null || selectedSession?.status === 'closing';
  const backgroundGame = activeSession?.game;
  const backgroundImage = quickOverlayImageUrl(backgroundGame?.coverImagePath || backgroundGame?.avatarImagePath || '');

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      initialNavActionRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    displayVolumeRef.current = displayVolume;
    audioSupportedRef.current = audio.supported;
  }, [audio.supported, displayVolume]);

  useEffect(() => {
    brightnessValueRef.current = displayBrightness;
    brightnessSupportedRef.current = display.brightness.supported;
  }, [display.brightness.supported, displayBrightness]);

  useEffect(() => {
    setSelectedNavKey((current) => {
      if (navItems.some((item) => item.key === current)) {
        return current;
      }
      const activeSession = sessions.find((session) => session.isActive);
      return activeSession ? `game:${activeSession.game.id}` : 'home';
    });
  }, [navItems, sessions]);

  useEffect(() => {
    if (props.emergencyCloseRequestId > 0) {
      const activeIndex = sessions.findIndex((session) => session.isActive);
      const selectedSession = sessions[activeIndex >= 0 ? activeIndex : 0];
      setSelectedNavKey(selectedSession ? `game:${selectedSession.game.id}` : 'home');
      setFocusArea('menu');
      setMenuIndex(2);
      setConfirmClose(true);
    }
  }, [props.emergencyCloseRequestId, sessions]);

  useEffect(() => {
    if (!notice) {
      return undefined;
    }
    const timer = window.setTimeout(() => setNotice(''), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    setMessage('');
    setConfirmClose(false);
    if (selectedNavKey !== 'settings') {
      setQuickSettingsOpen(false);
      setAudioMessage('');
      setBrightnessMessage('');
    }
  }, [selectedNavKey]);

  const refreshAudio = useCallback(async (): Promise<void> => {
    if (audioRefreshActive.current) return;
    audioRefreshActive.current = true;
    const interactionVersion = audioInteractionVersion.current;
    try {
      const next = await window.nxgs.getAudioStatus();
      if (interactionVersion === audioInteractionVersion.current) {
        quickAudioSnapshot = next;
        setAudio(next);
        displayVolumeRef.current = next.masterVolume;
        audioSupportedRef.current = next.supported;
        setDisplayVolume(next.masterVolume);
        setAudioMessage(next.supported ? '' : next.message ?? 'Volume control is unavailable.');
      }
    } catch (error) {
      if (interactionVersion === audioInteractionVersion.current) {
        const nextMessage = error instanceof Error ? error.message : 'Could not read the current volume.';
        audioSupportedRef.current = false;
        setAudio((current) => ({ ...current, supported: false, message: nextMessage }));
        setAudioMessage(nextMessage);
      }
    } finally {
      audioRefreshActive.current = false;
    }
  }, []);

  const setSystemVolume = useCallback((value: number): void => {
    if (!audioSupportedRef.current) return;
    audioInteractionVersion.current += 1;
    const nextVolume = Math.max(0, Math.min(100, Math.round(value)));
    displayVolumeRef.current = nextVolume;
    setDisplayVolume(nextVolume);
    volumeTarget.current = nextVolume;
    if (volumeFlushActive.current) return;

    volumeFlushActive.current = true;
    setAudioPending('volume');
    setAudioMessage(`Live · ${nextVolume}%`);
    void (async () => {
      try {
        while (volumeTarget.current !== null) {
          const target = volumeTarget.current;
          volumeTarget.current = null;
          const result = await window.nxgs.setMasterVolume(target);
          quickAudioSnapshot = result.audio;
          audioSupportedRef.current = result.audio.supported;
          setAudio(result.audio);
          if (!result.ok) {
            setAudioMessage(result.message);
            displayVolumeRef.current = result.audio.masterVolume;
            setDisplayVolume(result.audio.masterVolume);
            volumeTarget.current = null;
            break;
          }
          if (volumeTarget.current === null) {
            displayVolumeRef.current = result.audio.masterVolume;
            setDisplayVolume(result.audio.masterVolume);
            setAudioMessage(`${result.audio.masterVolume}%`);
          }
        }
      } catch (error) {
        setAudioMessage(error instanceof Error ? error.message : 'Could not change the volume.');
      } finally {
        volumeFlushActive.current = false;
        setAudioPending(null);
        if (volumeTarget.current !== null) setSystemVolume(volumeTarget.current);
      }
    })();
  }, []);

  const adjustSystemVolume = useCallback((direction: -1 | 1): void => {
    setSystemVolume(displayVolumeRef.current + direction * 2);
  }, [setSystemVolume]);

  const refreshDisplay = useCallback(async (): Promise<void> => {
    if (brightnessRefreshActive.current) return;
    brightnessRefreshActive.current = true;
    const interactionVersion = brightnessInteractionVersion.current;
    try {
      const next = await window.nxgs.getDisplayStatus();
      if (interactionVersion === brightnessInteractionVersion.current) {
        quickDisplaySnapshot = next;
        setDisplay(next);
        brightnessValueRef.current = next.brightness.level;
        brightnessSupportedRef.current = next.brightness.supported;
        setDisplayBrightness(next.brightness.level);
        setBrightnessMessage(next.brightness.supported ? '' : next.brightness.message ?? 'Brightness control is not supported on this display.');
      }
    } catch (error) {
      if (interactionVersion === brightnessInteractionVersion.current) {
        const nextMessage = error instanceof Error ? error.message : 'Could not read the current brightness.';
        brightnessSupportedRef.current = false;
        setDisplay((current) => ({
          ...current,
          brightness: { ...current.brightness, supported: false, message: nextMessage }
        }));
        setBrightnessMessage(nextMessage);
      }
    } finally {
      brightnessRefreshActive.current = false;
    }
  }, []);

  useEffect(() => {
    void Promise.all([refreshAudio(), refreshDisplay()]);
  }, [refreshAudio, refreshDisplay]);

  const openQuickSettings = useCallback((): void => {
    setSelectedNavKey('settings');
    setFocusArea('quickAudio');
    setQuickSettingsOpen(true);
    setAudioMessage('');
    setBrightnessMessage('');
    void Promise.all([refreshAudio(), refreshDisplay()]);
  }, [refreshAudio, refreshDisplay]);

  const setSystemBrightness = useCallback((value: number): void => {
    if (!brightnessSupportedRef.current) return;
    brightnessInteractionVersion.current += 1;
    const nextBrightness = Math.max(0, Math.min(100, Math.round(value)));
    brightnessValueRef.current = nextBrightness;
    setDisplayBrightness(nextBrightness);
    brightnessTarget.current = nextBrightness;
    if (brightnessFlushActive.current) return;

    brightnessFlushActive.current = true;
    setBrightnessMessage(`Live · ${nextBrightness}%`);
    void (async () => {
      try {
        while (brightnessTarget.current !== null) {
          const target = brightnessTarget.current;
          brightnessTarget.current = null;
          const result = await window.nxgs.setBrightness(target);
          quickDisplaySnapshot = result.display;
          brightnessSupportedRef.current = result.display.brightness.supported;
          setDisplay(result.display);
          if (!result.ok) {
            setBrightnessMessage(result.message);
            brightnessValueRef.current = result.display.brightness.level;
            setDisplayBrightness(result.display.brightness.level);
            brightnessTarget.current = null;
            break;
          }
          if (brightnessTarget.current === null) {
            brightnessValueRef.current = result.display.brightness.level;
            setDisplayBrightness(result.display.brightness.level);
            setBrightnessMessage(`${result.display.brightness.level}%`);
          }
        }
      } catch (error) {
        setBrightnessMessage(error instanceof Error ? error.message : 'Could not change the brightness.');
      } finally {
        brightnessFlushActive.current = false;
        if (brightnessTarget.current !== null) setSystemBrightness(brightnessTarget.current);
      }
    })();
  }, []);

  const adjustSystemBrightness = useCallback((direction: -1 | 1): void => {
    setSystemBrightness(brightnessValueRef.current + direction * 2);
  }, [setSystemBrightness]);

  const toggleSystemMute = useCallback(async (): Promise<void> => {
    if (audioBusy.current || volumeFlushActive.current || !audio.supported) return;
    audioBusy.current = true;
    audioInteractionVersion.current += 1;
    setAudioPending('mute');
    setAudioMessage(audio.muted ? 'Unmuting...' : 'Muting...');
    try {
      const result = await window.nxgs.setMasterMuted(!audio.muted);
      quickAudioSnapshot = result.audio;
      audioSupportedRef.current = result.audio.supported;
      setAudio(result.audio);
      setDisplayVolume(result.audio.masterVolume);
      setAudioMessage(result.message);
    } catch (error) {
      setAudioMessage(error instanceof Error ? error.message : 'Could not change mute status.');
    } finally {
      audioBusy.current = false;
      setAudioPending(null);
    }
  }, [audio.muted, audio.supported]);

  const resumeGame = useCallback(async (): Promise<void> => {
    if (pendingAction || !resumeTargetSession) {
      return;
    }
    setPendingAction('resume');
    setMessage('');
    try {
      const result = await window.nxgs.resumeActiveGame(resumeTargetSession.game.id);
      if (!result.ok) {
        setMessage(result.error ?? 'NXGS could not resume the game.');
      }
    } finally {
      setPendingAction(null);
    }
  }, [pendingAction, resumeTargetSession]);

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
      } else {
        props.onDismiss();
      }
    } finally {
      setPendingAction(null);
    }
  }, [pendingAction, props]);

  const closeGame = useCallback(async (): Promise<void> => {
    if (pendingAction || !selectedSession) {
      return;
    }
    setPendingAction('close');
    setMessage('');
    try {
      const result = await window.nxgs.closeActiveGame(selectedSession.game.id);
      if (!result.ok) {
        setMessage(result.error ?? 'NXGS could not close the game.');
      } else {
        setConfirmClose(false);
      }
    } finally {
      setPendingAction(null);
    }
  }, [pendingAction, selectedSession]);

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
      setSelectedNavKey(item.key);
      if (item.key === 'home') {
        void goToLauncherHome();
      } else if (item.session) {
        setFocusArea('menu');
      } else if (item.key === 'settings') {
        if (quickSettingsOpen) {
          setQuickSettingsOpen(false);
          setFocusArea('navbar');
        } else {
          openQuickSettings();
        }
      } else if (item.key === 'power') {
        setNotice('Power controls are available inside Control Room.');
      } else {
        setNotice(item.label);
      }
    },
    [disabled, goToLauncherHome, navItems, openQuickSettings, quickSettingsOpen]
  );

  const dismissOverlay = useCallback((): void => {
    if (disabled) return;
    if (resumeTargetSession && props.dismissResumesGame !== false) {
      void resumeGame();
    } else {
      props.onDismiss();
    }
  }, [disabled, props, resumeGame, resumeTargetSession]);

  const handleBack = useCallback((): void => {
    if (confirmClose) {
      setConfirmClose(false);
      return;
    }
    if (quickSettingsOpen) {
      setQuickSettingsOpen(false);
      setFocusArea('navbar');
      return;
    }
    dismissOverlay();
  }, [confirmClose, dismissOverlay, quickSettingsOpen]);

  const claimSwitcherInput = useCallback((action: string): boolean => {
    const at = performance.now();
    if (lastSwitcherInput.current.action === action && at - lastSwitcherInput.current.at < SWITCHER_INPUT_DEDUPLICATION_MS) {
      return false;
    }
    lastSwitcherInput.current = { action, at };
    return true;
  }, []);

  const moveSwitcherDirection = useCallback((direction: 'left' | 'right' | 'up' | 'down'): void => {
    if (direction === 'left' || direction === 'right') {
      const delta = direction === 'right' ? 1 : -1;
      setSelectedNavKey(navItems[(selectedNavIndex + delta + navItems.length) % navItems.length].key);
      setFocusArea('navbar');
      return;
    }
    if (direction === 'up') {
      if (focusArea === 'menu') {
        setMenuIndex((index) => Math.max(0, index - 1));
      } else if (focusArea === 'navbar' && gameSelected) {
        setMenuIndex(0);
        setFocusArea('menu');
      }
      return;
    }
    if (focusArea === 'menu') {
      if (menuIndex >= MENU_LABELS.length - 1) {
        setFocusArea('navbar');
      } else {
        setMenuIndex((index) => index + 1);
      }
    }
  }, [focusArea, gameSelected, menuIndex, navItems, selectedNavIndex]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const backRequested = isBackKeyboardEvent(event);
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(event.key) && !backRequested) {
        return;
      }
      if (backRequested && shouldKeepEditing(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (disabled) {
        return;
      }
      const inputAction = backRequested ? 'back' : event.key === 'Enter' ? 'accept' : event.key;
      if (!claimSwitcherInput(inputAction)) return;
      if (quickSettingsOpen && (focusArea === 'quickAudio' || focusArea === 'quickBrightness')) {
        if (backRequested) {
          handleBack();
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          if (focusArea === 'quickAudio') adjustSystemVolume(event.key === 'ArrowRight' ? 1 : -1);
          else adjustSystemBrightness(event.key === 'ArrowRight' ? 1 : -1);
        } else if (event.key === 'Enter' && focusArea === 'quickAudio') {
          void toggleSystemMute();
        } else if (event.key === 'ArrowDown') {
          setFocusArea('quickBrightness');
        } else if (event.key === 'ArrowUp') {
          setFocusArea('quickAudio');
        }
        return;
      }
      if (backRequested) {
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
        moveSwitcherDirection(event.key === 'ArrowRight' ? 'right' : 'left');
        return;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        moveSwitcherDirection(event.key === 'ArrowUp' ? 'up' : 'down');
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
  }, [adjustSystemBrightness, adjustSystemVolume, claimSwitcherInput, closeGame, confirmClose, disabled, focusArea, gameSelected, handleBack, menuIndex, moveSwitcherDirection, quickSettingsOpen, selectMenuAction, selectNavAction, selectedNavIndex, toggleSystemMute]);

  useEffect(() => {
    if (!quickSettingsOpen) return;
    const selector = focusArea === 'quickBrightness'
      ? '#quick-settings-brightness'
      : '#quick-settings-audio';
    document.querySelector<HTMLInputElement>(selector)?.focus({ preventScroll: true });
  }, [focusArea, quickSettingsOpen]);

  const handleSwitcherControllerEvent = useCallback((event: ControllerNavigationEvent): void => {
    const inputAction = event.type === 'direction' ? `Arrow${event.direction[0].toUpperCase()}${event.direction.slice(1)}` : event.type;
    if (!claimSwitcherInput(inputAction)) return;
    if (event.type === 'back') {
      handleBack();
      void window.nxgs.reportControllerState({ detected: true, name: event.pad.id, homeSupported: event.pad.buttons.length > 16 ? 'unknown' : 'no', lastButtonPressed: 'Circle / B', lastNavigationAction: 'Switcher: back' });
      return;
    }
    if (event.type === 'accept') {
      void window.nxgs.reportControllerState({ detected: true, name: event.pad.id, homeSupported: event.pad.buttons.length > 16 ? 'unknown' : 'no', lastButtonPressed: 'X / A', lastNavigationAction: 'Switcher: select' });
      if (quickSettingsOpen && focusArea === 'quickAudio') {
        void toggleSystemMute();
      } else if (confirmClose) {
        if (menuIndex === 0) void closeGame();
        else setConfirmClose(false);
      } else if (focusArea === 'menu' && gameSelected) {
        selectMenuAction(menuIndex);
      } else {
        selectNavAction(selectedNavIndex);
      }
      return;
    }

    if (quickSettingsOpen && (focusArea === 'quickAudio' || focusArea === 'quickBrightness')) {
      if (event.direction === 'left') {
        if (focusArea === 'quickAudio') adjustSystemVolume(-1);
        else adjustSystemBrightness(-1);
      } else if (event.direction === 'right') {
        if (focusArea === 'quickAudio') adjustSystemVolume(1);
        else adjustSystemBrightness(1);
      } else if (event.direction === 'down') {
        setFocusArea('quickBrightness');
      } else if (event.direction === 'up') {
        setFocusArea('quickAudio');
      }
      return;
    }

    if (confirmClose) {
      if (event.direction === 'left' || event.direction === 'right') {
        setMenuIndex((index) => (index === 0 ? 1 : 0));
      }
      return;
    }

    moveSwitcherDirection(event.direction);
  }, [adjustSystemBrightness, adjustSystemVolume, claimSwitcherInput, closeGame, confirmClose, focusArea, gameSelected, handleBack, menuIndex, moveSwitcherDirection, quickSettingsOpen, selectMenuAction, selectNavAction, selectedNavIndex, toggleSystemMute]);

  useControllerNavigation(!disabled, handleSwitcherControllerEvent);

  return (
    <section
      className={`quick-home-overlay ${isClosingGame ? 'closing-game' : ''}`}
      aria-label="NXGS quick home overlay"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const target = event.target;
        if (target instanceof Element && target.closest('.quick-navbar, .quick-game-menu')) return;
        event.preventDefault();
        event.stopPropagation();
        dismissOverlay();
      }}
    >
      {!props.liveGameBackdrop && backgroundImage && (
        <div
          className="quick-overlay-game-backdrop"
          style={{ backgroundImage: `url("${backgroundImage.replace(/"/g, '%22')}")` }}
          aria-hidden="true"
        />
      )}
      <div className="quick-overlay-shade" />
      {closingSession && (
        <section className="quick-game-closing-transition" role="status" aria-live="polite">
          <LoaderCircle size={34} className="spin" />
          <small>NXGS Play</small>
          <strong>Closing {closingSession.game.title}</strong>
          <span>Returning to your game library...</span>
        </section>
      )}
      <header className="quick-overlay-header">
        <div className="quick-overlay-brand"><Gamepad2 size={18} /> NXGS Switcher</div>
        <time dateTime={now.toISOString()}>
          {new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(now)}
        </time>
      </header>

      {gameSelected && game && (
        <section className="quick-game-menu" aria-label={`${game.title} controls`}>
          <div className="quick-game-heading">
            <span className="quick-game-art"><SafeGameImage game={game} kind="avatar" alt="" fallbackSize={28} /></span>
            <div><small>{selectedSession?.isActive ? 'Active game' : 'Running / minimized game'}</small><strong>{game.title}</strong></div>
          </div>
          {message && <p className="quick-overlay-error">{message}</p>}
          {!message && selectedSession?.message && <p className="quick-overlay-status">{selectedSession.message}</p>}

          {confirmClose ? (
            <div className="quick-close-confirm">
              <strong>Close {game.title}?</strong>
              <span>The game will receive a normal close request.</span>
              <div>
                <button className={menuIndex === 0 ? 'focused' : ''} type="button" disabled={disabled} onClick={() => void closeGame()}>
                  {pendingAction === 'close'
                    ? <><LoaderCircle size={16} className="spin" /> Closing...</>
                    : 'Confirm Close'}
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
                    const result = await window.nxgs.forceCloseGame(forcePin, selectedSession?.game.id);
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
          <div className="quick-nav-slot" key={item.key}>
            {item.key === 'settings' && quickSettingsOpen && (
              <section
                className="quick-settings-panel"
                id="quick-settings-panel"
                aria-label="Quick Settings"
                onBlurCapture={(event) => {
                  const next = event.relatedTarget;
                  if (next === null) return;
                  if (next instanceof Node && event.currentTarget.parentElement?.contains(next)) return;
                  setQuickSettingsOpen(false);
                  setFocusArea('navbar');
                }}
              >
                <div
                  className={`quick-settings-control quick-settings-audio ${focusArea === 'quickAudio' ? 'selected' : ''}`}
                  onMouseEnter={() => setFocusArea('quickAudio')}
                >
                  <header>
                    <button
                      type="button"
                      className={audio.muted ? 'muted' : ''}
                      disabled={audioPending !== null || !audio.supported}
                      aria-label={audioPending === 'mute' ? 'Updating mute status' : audio.muted ? 'Unmute audio' : 'Mute audio'}
                      onClick={() => void toggleSystemMute()}
                    >
                      {audioPending === 'mute'
                        ? <LoaderCircle size={16} className="spin" />
                        : audio.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                    </button>
                    <strong>Audio</strong>
                    <b>{audio.muted ? 'Muted' : `${displayVolume}%`}</b>
                  </header>
                  <div className="quick-settings-range" style={{ '--quick-range-value': `${displayVolume}%` } as CSSProperties}>
                    <span className="quick-settings-range-track" aria-hidden="true">
                      <span className="quick-settings-range-fill" />
                    </span>
                    <input
                      id="quick-settings-audio"
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={displayVolume}
                      aria-label="Quick audio volume"
                      aria-valuetext={audio.muted ? `Muted at ${displayVolume} percent` : `${displayVolume} percent`}
                      disabled={audioPending === 'mute' || !audio.supported}
                      onFocus={() => setFocusArea('quickAudio')}
                      onInput={(event) => void setSystemVolume(Number(event.currentTarget.value))}
                    />
                  </div>
                  {!audio.supported && <small role="status">{audioMessage || audio.message || 'Audio control is unavailable.'}</small>}
                </div>

                <div
                  className={`quick-settings-control quick-settings-brightness ${focusArea === 'quickBrightness' ? 'selected' : ''}`}
                  onMouseEnter={() => setFocusArea('quickBrightness')}
                >
                  <header>
                    <span aria-hidden="true"><Sun size={17} /></span>
                    <strong>Brightness</strong>
                    <b>{display.brightness.supported ? `${displayBrightness}%` : 'Unavailable'}</b>
                  </header>
                  <div className="quick-settings-range" style={{ '--quick-range-value': `${displayBrightness}%` } as CSSProperties}>
                    <span className="quick-settings-range-track" aria-hidden="true">
                      <span className="quick-settings-range-fill" />
                    </span>
                    <input
                      id="quick-settings-brightness"
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={displayBrightness}
                      aria-label="Quick display brightness"
                      aria-valuetext={display.brightness.supported ? `${displayBrightness} percent` : 'Brightness unavailable'}
                      disabled={!display.brightness.supported}
                      onFocus={() => setFocusArea('quickBrightness')}
                      onInput={(event) => void setSystemBrightness(Number(event.currentTarget.value))}
                    />
                  </div>
                  {!display.brightness.supported && (
                    <small role="status">{brightnessMessage || display.brightness.message || 'Brightness control is unavailable for this display.'}</small>
                  )}
                </div>
              </section>
            )}
            <button
              ref={item.key === initialNavKey ? initialNavActionRef : undefined}
              className={`quick-nav-item ${selectedNavIndex === index ? 'selected' : ''} ${item.session ? 'active-game' : ''}`}
              type="button"
              title={item.label}
              aria-label={item.label}
              aria-expanded={item.key === 'settings' ? quickSettingsOpen : undefined}
              aria-controls={item.key === 'settings' ? 'quick-settings-panel' : undefined}
              disabled={disabled}
              onMouseEnter={() => { setSelectedNavKey(item.key); setFocusArea('navbar'); }}
              onClick={() => selectNavAction(index)}
            >
              {item.session
                ? <SafeGameImage game={item.session.game} kind="avatar" alt="" fallbackSize={25} />
                : item.icon}
              {item.session && <span className={`active-dot ${item.session.isActive ? '' : 'minimized'}`} />}
            </button>
          </div>
        ))}
      </nav>

      {notice && <div className="quick-overlay-toast">{notice}</div>}
      <div className="quick-overlay-hint">← → Navigate&nbsp;&nbsp; • &nbsp;&nbsp;A / Enter Select&nbsp;&nbsp; • &nbsp;&nbsp;B / Esc Back</div>
    </section>
  );
}
