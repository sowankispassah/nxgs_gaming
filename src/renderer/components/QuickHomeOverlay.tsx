import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Bell, Home, Music2, Power, Settings, UsersRound } from 'lucide-react';
import type {
  ActiveGameState,
  AudioStatus,
  DisplayStatus,
  QuickOverlayBackdrop,
  TrackedGameSessionState
} from '../../shared/types';
import { SafeGameImage } from './ConsoleHome';
import { ControlCenterClosing } from './control-center/ControlCenterClosing';
import { ControlCenterGameCard, MENU_LABELS, type PendingAction } from './control-center/ControlCenterGameCard';
import { ControlCenterQuickSettings } from './control-center/ControlCenterQuickSettings';
import { ControlCenterStatus } from './control-center/ControlCenterStatus';
import { cx } from './control-center/cx';
import { isBackKeyboardEvent, shouldKeepEditing } from '../navigation';
import { useControllerNavigation, type ControllerNavigationEvent } from '../controllerNavigation';
import { ControllerHints, type ControllerHint } from '../ui/ControllerHints';
import { SystemToast } from '../ui/SystemToast';
import { playUiSound } from '../ui/uiSound';

type FocusArea = 'navbar' | 'menu' | 'quickAudio' | 'quickBrightness';
type NavGroup = 'switcher' | 'controls';
type NavItem = {
  key: string;
  label: string;
  caption: string;
  group: NavGroup;
  icon: JSX.Element | null;
  session?: TrackedGameSessionState;
  notice?: string;
};
type OverlayNotice = {
  key: string;
  title: string;
  message: string;
};

const SWITCHER_INPUT_DEDUPLICATION_MS = 120;
// Emergency request ids only grow within a window. Remember the last one shown
// at module scope so a remounted overlay never replays an old Close prompt.
let lastHandledEmergencyRequest = 0;
const NAV_GROUPS: NavGroup[] = ['switcher', 'controls'];
const COMING_SOON_NOTICE = 'Coming soon to NXGS Play.';

const NAVIGATION_HINTS: ControllerHint[] = [
  { glyph: 'dpad', label: 'Navigate' },
  { glyph: 'cross', label: 'Select' },
  { glyph: 'circle', label: 'Back' }
];
const CONFIRM_HINTS: ControllerHint[] = [
  { glyph: 'dpad-horizontal', label: 'Choose' },
  { glyph: 'cross', label: 'Select' },
  { glyph: 'circle', label: 'Cancel' }
];
const BRIGHTNESS_HINTS: ControllerHint[] = [
  { glyph: 'dpad-horizontal', label: 'Adjust' },
  { glyph: 'circle', label: 'Back' }
];
const UNAVAILABLE_CONTROL_HINTS: ControllerHint[] = [
  { glyph: 'dpad-vertical', label: 'Navigate' },
  { glyph: 'circle', label: 'Back' }
];

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

function captureCropStyle(cropTopPx = 0): CSSProperties | undefined {
  const safeCrop = Math.max(0, Math.min(160, Math.round(cropTopPx)));
  return safeCrop > 0
    ? {
        top: -safeCrop,
        bottom: 'auto',
        height: `calc(100% + ${safeCrop}px)`
      }
    : undefined;
}

function LiveGameBackdrop(props: { stream: MediaStream; poster: string; cropTopPx?: number }): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    video.srcObject = props.stream;
    void video.play().catch(() => undefined);
    return () => {
      video.srcObject = null;
    };
  }, [props.stream]);

  return (
    <video
      ref={videoRef}
      className="quick-overlay-game-video"
      poster={props.poster || undefined}
      style={captureCropStyle(props.cropTopPx)}
      autoPlay
      muted
      playsInline
      aria-hidden="true"
    />
  );
}

export function QuickHomeOverlay(props: {
  activeGame: ActiveGameState;
  emergencyCloseRequestId: number;
  backdrop?: QuickOverlayBackdrop;
  liveBackdropStream?: MediaStream | null;
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
  const [notice, setNotice] = useState<OverlayNotice | null>(null);
  const [forcePin, setForcePin] = useState('');
  const [audio, setAudio] = useState<AudioStatus>(() => quickAudioSnapshot ?? EMPTY_AUDIO);
  const [displayVolume, setDisplayVolume] = useState(() => quickAudioSnapshot?.masterVolume ?? 0);
  const [quickSettingsOpen, setQuickSettingsOpen] = useState(false);
  const [audioPending, setAudioPending] = useState<'volume' | 'mute' | null>(null);
  const [audioMessage, setAudioMessage] = useState('');
  const [display, setDisplay] = useState<DisplayStatus>(() => quickDisplaySnapshot ?? EMPTY_DISPLAY);
  const [displayBrightness, setDisplayBrightness] = useState(() => quickDisplaySnapshot?.brightness.level ?? 0);
  const [brightnessMessage, setBrightnessMessage] = useState('');
  const overlayRef = useRef<HTMLElement | null>(null);
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
  const emergencyNavKey = useRef<string | null>(null);
  const previousNavKey = useRef(selectedNavKey);

  // A layout effect lands this reset in the same frame as the Home status, so
  // the frame painted before Home is raised never shows the previous menu.
  useLayoutEffect(() => {
    if (props.activeGame.status !== 'quickOverlayOpen' && props.activeGame.status !== 'launching') return;
    setSelectedNavKey(initialNavKey);
    setFocusArea('navbar');
    setMenuIndex(0);
    setConfirmClose(false);
    setQuickSettingsOpen(false);
    setMessage('');
    lastSwitcherInput.current = { action: '', at: 0 };
    const frame = window.requestAnimationFrame(() => initialNavActionRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [props.activeGame.status, initialNavKey]);

  const navItems = useMemo<NavItem[]>(
    () => [
      { key: 'home', label: 'Launcher Home', caption: 'Home', group: 'switcher', icon: <Home size={24} /> },
      ...sessions.map((session) => ({
        key: `game:${session.game.id}`,
        label: session.game.title,
        caption: session.game.title,
        group: 'switcher' as const,
        icon: null,
        session
      })),
      { key: 'notifications', label: 'Notifications coming soon', caption: 'Notifications', group: 'controls', icon: <Bell size={24} />, notice: COMING_SOON_NOTICE },
      { key: 'players', label: 'Players coming soon', caption: 'Players', group: 'controls', icon: <UsersRound size={24} />, notice: COMING_SOON_NOTICE },
      { key: 'audio', label: 'Audio coming soon', caption: 'Audio', group: 'controls', icon: <Music2 size={24} />, notice: COMING_SOON_NOTICE },
      { key: 'settings', label: 'Quick Settings', caption: 'Quick Settings', group: 'controls', icon: <Settings size={24} /> },
      { key: 'power', label: 'Protected power controls', caption: 'Power', group: 'controls', icon: <Power size={24} />, notice: 'Power controls are available inside Control Room.' }
    ],
    [sessions]
  );

  const selectedNavIndex = Math.max(0, navItems.findIndex((item) => item.key === selectedNavKey));
  const activeNavItem = navItems[selectedNavIndex];
  const selectedSession = activeNavItem?.session;
  const selectedSessionIndex = Math.max(0, sessions.findIndex((session) => session === selectedSession));
  const activeSession = sessions.find((session) => session.isActive) ?? sessions[0];
  const resumeTargetSession = selectedSession ?? activeSession;
  const gameSelected = Boolean(selectedSession);
  const closeFailed = /did not close|force close/i.test(selectedSession?.message ?? '');
  const closingSession = sessions.find((session) => session.status === 'closing');
  const isClosingGame = Boolean(closingSession);
  const disabled = pendingAction !== null || selectedSession?.status === 'closing';
  const navFocused = focusArea === 'navbar' && !confirmClose;
  const backgroundGame = activeSession?.game;
  const backgroundImage = quickOverlayImageUrl(backgroundGame?.coverImagePath || backgroundGame?.avatarImagePath || '');
  const safeBackdropImage = props.backdrop?.kind === 'direct'
    ? ''
    : props.backdrop?.imageUrl
      ? quickOverlayImageUrl(props.backdrop.imageUrl)
      : backgroundImage;

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
    if (props.emergencyCloseRequestId <= lastHandledEmergencyRequest || sessions.length === 0) return;
    lastHandledEmergencyRequest = props.emergencyCloseRequestId;
    const activeIndex = sessions.findIndex((session) => session.isActive);
    const emergencySession = sessions[activeIndex >= 0 ? activeIndex : 0];
    const emergencyKey = `game:${emergencySession.game.id}`;
    emergencyNavKey.current = emergencyKey;
    setSelectedNavKey(emergencyKey);
    setQuickSettingsOpen(false);
    setFocusArea('menu');
    setMenuIndex(2);
    setConfirmClose(true);
  }, [props.emergencyCloseRequestId, sessions]);

  useEffect(() => {
    if (!notice) {
      return undefined;
    }
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (previousNavKey.current === selectedNavKey) return;
    previousNavKey.current = selectedNavKey;
    if (emergencyNavKey.current === selectedNavKey) {
      emergencyNavKey.current = null;
      return;
    }
    emergencyNavKey.current = null;
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
    const nextVolume = Math.max(0, Math.min(100, displayVolumeRef.current + direction * 2));
    if (audioSupportedRef.current && nextVolume !== displayVolumeRef.current) playUiSound('move');
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

  const closeQuickSettings = useCallback((): void => {
    setQuickSettingsOpen(false);
    setFocusArea('navbar');
  }, []);

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
    const nextBrightness = Math.max(0, Math.min(100, brightnessValueRef.current + direction * 2));
    if (brightnessSupportedRef.current && nextBrightness !== brightnessValueRef.current) playUiSound('move');
    setSystemBrightness(brightnessValueRef.current + direction * 2);
  }, [setSystemBrightness]);

  const toggleSystemMute = useCallback(async (): Promise<void> => {
    if (audioBusy.current || volumeFlushActive.current || !audio.supported) return;
    audioBusy.current = true;
    audioInteractionVersion.current += 1;
    playUiSound('toggle');
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
        playUiSound('error');
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
        playUiSound('error');
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
        playUiSound('error');
        setMessage(result.error ?? 'NXGS could not close the game.');
      } else {
        setConfirmClose(false);
      }
    } finally {
      setPendingAction(null);
    }
  }, [pendingAction, selectedSession]);

  const forceCloseGame = useCallback(async (): Promise<void> => {
    setPendingAction('force');
    setMessage('');
    try {
      const result = await window.nxgs.forceCloseGame(forcePin, selectedSession?.game.id);
      if (!result.ok) {
        playUiSound('error');
        setMessage('Invalid admin PIN.');
      }
    } finally {
      setPendingAction(null);
    }
  }, [forcePin, selectedSession]);

  const selectMenuAction = useCallback(
    (index: number): void => {
      if (disabled) {
        return;
      }
      playUiSound('select');
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
        playUiSound('select');
        void goToLauncherHome();
      } else if (item.session) {
        playUiSound('select');
        setFocusArea('menu');
      } else if (item.key === 'settings') {
        if (quickSettingsOpen) {
          playUiSound('close');
          closeQuickSettings();
        } else {
          playUiSound('open');
          openQuickSettings();
        }
      } else {
        playUiSound('select');
        setNotice({ key: item.key, title: item.caption, message: item.notice ?? COMING_SOON_NOTICE });
      }
    },
    [closeQuickSettings, disabled, goToLauncherHome, navItems, openQuickSettings, quickSettingsOpen]
  );

  const dismissOverlay = useCallback((): void => {
    if (disabled) return;
    playUiSound('back');
    if (resumeTargetSession && props.dismissResumesGame !== false) {
      void resumeGame();
    } else {
      props.onDismiss();
    }
  }, [disabled, props, resumeGame, resumeTargetSession]);

  const handleBack = useCallback((): void => {
    if (confirmClose) {
      playUiSound('back');
      setConfirmClose(false);
      return;
    }
    if (quickSettingsOpen) {
      playUiSound('back');
      closeQuickSettings();
      return;
    }
    dismissOverlay();
  }, [closeQuickSettings, confirmClose, dismissOverlay, quickSettingsOpen]);

  const toggleCloseChoice = useCallback((): void => {
    playUiSound('move');
    setMenuIndex((index) => (index === 0 ? 1 : 0));
  }, []);

  const acceptCloseChoice = useCallback((): void => {
    if (menuIndex === 0) {
      playUiSound('select');
      void closeGame();
    } else {
      playUiSound('back');
      setConfirmClose(false);
    }
  }, [closeGame, menuIndex]);

  const moveQuickSettingsFocus = useCallback((direction: 'up' | 'down'): void => {
    const next: FocusArea = direction === 'down' ? 'quickBrightness' : 'quickAudio';
    if (next !== focusArea) playUiSound('move');
    setFocusArea(next);
  }, [focusArea]);

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
      playUiSound('move');
      return;
    }
    if (direction === 'up') {
      if (focusArea === 'menu') {
        if (menuIndex > 0) playUiSound('move');
        setMenuIndex((index) => Math.max(0, index - 1));
      } else if (focusArea === 'navbar' && gameSelected) {
        setMenuIndex(0);
        setFocusArea('menu');
        playUiSound('move');
      }
      return;
    }
    if (focusArea === 'menu') {
      playUiSound('move');
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
          moveQuickSettingsFocus('down');
        } else if (event.key === 'ArrowUp') {
          moveQuickSettingsFocus('up');
        }
        return;
      }
      if (backRequested) {
        handleBack();
        return;
      }
      if (confirmClose) {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          toggleCloseChoice();
        } else if (event.key === 'Enter') {
          acceptCloseChoice();
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
  }, [acceptCloseChoice, adjustSystemBrightness, adjustSystemVolume, claimSwitcherInput, confirmClose, disabled, focusArea, gameSelected, handleBack, menuIndex, moveQuickSettingsFocus, moveSwitcherDirection, quickSettingsOpen, selectMenuAction, selectNavAction, selectedNavIndex, toggleCloseChoice, toggleSystemMute]);

  useEffect(() => {
    if (!quickSettingsOpen) return;
    const selector = focusArea === 'quickBrightness'
      ? '#quick-settings-brightness'
      : '#quick-settings-audio';
    document.querySelector<HTMLInputElement>(selector)?.focus({ preventScroll: true });
  }, [focusArea, quickSettingsOpen]);

  useEffect(() => {
    const root = overlayRef.current;
    if (!root || (focusArea !== 'navbar' && focusArea !== 'menu')) return;
    const current = document.activeElement;
    if (current instanceof HTMLInputElement && current.type === 'password' && root.contains(current)) return;
    const target = root.querySelector<HTMLButtonElement>(
      focusArea === 'menu' || confirmClose ? '.quick-game-menu button.focused' : '.quick-navbar .quick-nav-item.selected'
    );
    if (target && target !== current) target.focus({ preventScroll: true });
  }, [confirmClose, focusArea, menuIndex, pendingAction, selectedNavKey]);

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
        acceptCloseChoice();
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
      } else {
        moveQuickSettingsFocus(event.direction);
      }
      return;
    }

    if (confirmClose) {
      if (event.direction === 'left' || event.direction === 'right') {
        toggleCloseChoice();
      }
      return;
    }

    moveSwitcherDirection(event.direction);
  }, [acceptCloseChoice, adjustSystemBrightness, adjustSystemVolume, claimSwitcherInput, confirmClose, focusArea, gameSelected, handleBack, menuIndex, moveQuickSettingsFocus, moveSwitcherDirection, quickSettingsOpen, selectMenuAction, selectNavAction, selectedNavIndex, toggleCloseChoice, toggleSystemMute]);

  useControllerNavigation(!disabled, handleSwitcherControllerEvent);

  const hints: ControllerHint[] = quickSettingsOpen && focusArea === 'quickAudio'
    ? audio.supported
      ? [
          { glyph: 'dpad-horizontal', label: 'Adjust' },
          { glyph: 'cross', label: audio.muted ? 'Unmute' : 'Mute' },
          { glyph: 'circle', label: 'Back' }
        ]
      : UNAVAILABLE_CONTROL_HINTS
    : quickSettingsOpen && focusArea === 'quickBrightness'
      ? display.brightness.supported ? BRIGHTNESS_HINTS : UNAVAILABLE_CONTROL_HINTS
      : confirmClose
        ? CONFIRM_HINTS
        : NAVIGATION_HINTS;
  const noticeItem = notice ? navItems.find((item) => item.key === notice.key) : undefined;

  return (
    <section
      ref={overlayRef}
      className={cx('quick-home-overlay', props.backdrop?.kind === 'direct' && 'direct-game-backdrop', isClosingGame && 'closing-game')}
      aria-label="NXGS quick home overlay"
      style={{ '--qc-session-index': selectedSessionIndex } as CSSProperties}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const target = event.target;
        if (target instanceof Element && target.closest('.quick-navbar, .quick-game-menu, .quick-overlay-toast')) return;
        event.preventDefault();
        event.stopPropagation();
        dismissOverlay();
      }}
    >
      {props.liveBackdropStream ? (
        <LiveGameBackdrop
          stream={props.liveBackdropStream}
          poster={safeBackdropImage}
          cropTopPx={props.backdrop?.cropTopPx}
        />
      ) : (props.backdrop || safeBackdropImage) && (
        <div
          className={`quick-overlay-game-backdrop quick-overlay-backdrop-${props.backdrop?.kind ?? 'cover'}`}
          style={{
            ...(safeBackdropImage
              ? { backgroundImage: `url("${safeBackdropImage.replace(/"/g, '%22')}")` }
              : {}),
            ...captureCropStyle(props.backdrop?.cropTopPx)
          }}
          aria-hidden="true"
        />
      )}
      <div className="quick-overlay-shade" />
      {closingSession && <ControlCenterClosing game={closingSession.game} />}

      {gameSelected && selectedSession && (
        <ControlCenterGameCard
          session={selectedSession}
          message={message}
          menuFocused={focusArea === 'menu'}
          menuIndex={menuIndex}
          confirmClose={confirmClose}
          pendingAction={pendingAction}
          disabled={disabled}
          closeFailed={closeFailed}
          forcePin={forcePin}
          onForcePinChange={setForcePin}
          onForceClose={() => void forceCloseGame()}
          onActionHover={(index) => {
            setFocusArea('menu');
            setMenuIndex(index);
          }}
          onActionSelect={selectMenuAction}
          onConfirmClose={() => {
            playUiSound('select');
            void closeGame();
          }}
          onCancelClose={() => {
            playUiSound('back');
            setConfirmClose(false);
          }}
        />
      )}

      <nav className="quick-navbar" aria-label="NXGS quick navigation">
        {NAV_GROUPS.map((group) => (
          <div className={`quick-nav-group quick-nav-group--${group}`} key={group}>
            {navItems.map((item, index) => item.group === group && (
              <div className="quick-nav-slot" key={item.key}>
                {item.key === 'settings' && quickSettingsOpen && (
                  <ControlCenterQuickSettings
                    selected={focusArea === 'quickAudio' ? 'audio' : focusArea === 'quickBrightness' ? 'brightness' : null}
                    audio={audio}
                    volume={displayVolume}
                    audioPending={audioPending}
                    audioMessage={audioMessage}
                    display={display}
                    brightness={displayBrightness}
                    brightnessMessage={brightnessMessage}
                    onRequestClose={closeQuickSettings}
                    onSelectAudio={() => setFocusArea('quickAudio')}
                    onSelectBrightness={() => setFocusArea('quickBrightness')}
                    onToggleMute={() => void toggleSystemMute()}
                    onVolumeInput={setSystemVolume}
                    onBrightnessInput={setSystemBrightness}
                  />
                )}
                <button
                  ref={item.key === initialNavKey ? initialNavActionRef : undefined}
                  className={cx(
                    'quick-nav-item',
                    selectedNavIndex === index && 'selected',
                    selectedNavIndex === index && navFocused && 'focused',
                    item.session && 'active-game'
                  )}
                  type="button"
                  aria-label={item.label}
                  aria-expanded={item.key === 'settings' ? quickSettingsOpen : undefined}
                  aria-controls={item.key === 'settings' ? 'quick-settings-panel' : undefined}
                  disabled={disabled}
                  onMouseEnter={() => { setSelectedNavKey(item.key); setFocusArea('navbar'); }}
                  onClick={() => selectNavAction(index)}
                >
                  {!item.session && <span className="quick-nav-caption" aria-hidden="true">{item.caption}</span>}
                  <span className="quick-nav-face" aria-hidden="true">
                    {item.session
                      ? <SafeGameImage game={item.session.game} kind="avatar" alt="" fallbackSize={25} />
                      : item.icon}
                  </span>
                  {item.session && <span className={cx('active-dot', !item.session.isActive && 'minimized')} aria-hidden="true" />}
                </button>
              </div>
            ))}
          </div>
        ))}
        <ControlCenterStatus open={props.activeGame.status === 'quickOverlayOpen' || props.activeGame.status === 'launching'} />
      </nav>

      <ControllerHints className="quick-overlay-hints" hints={hints} />
      {notice && (
        <SystemToast
          className="quick-overlay-toast"
          title={notice.title}
          message={notice.message}
          icon={noticeItem?.icon}
        />
      )}
    </section>
  );
}
