import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Eye, EyeOff, LoaderCircle, Minus, Plus, Trash2 } from 'lucide-react';
import type {
  AppDiagnostics,
  AppSettings,
  AudioDeviceSummary,
  AudioStatus,
  BluetoothDeviceSummary,
  BluetoothStatus,
  DisplayStatus,
  NetworkStatus,
  WifiNetworkSummary
} from '../../shared/types';
import { isBackKeyboardEvent, shouldKeepEditing } from '../navigation';
import { useControllerNavigation, type ControllerNavigationEvent } from '../controllerNavigation';
import { ConsoleClock } from '../ui/ConsoleClock';
import { ControllerHints, type ControllerHint } from '../ui/ControllerHints';
import { getUiPreference } from '../ui/preferences';
import { playUiSound } from '../ui/uiSound';
import { controllerDisplayName, SettingsNotice, SettingsStatus, SettingsStatusCard, type SettingsTone } from './settings/SettingsParts';
import { AccessibilitySettingsPage, GuideSettingsPage, StorageSettingsPage, UsersSettingsPage } from './settings/SettingsInfoPages';

type SettingsKey =
  | 'guide'
  | 'accessibility'
  | 'network'
  | 'controller'
  | 'users'
  | 'system'
  | 'storage'
  | 'control-room';

type Feedback = { tone: 'info' | 'success' | 'warning' | 'error'; message: string };
type CachedSettingsValue<T> = { value: T; updatedAt: number };
type RefreshOptions = { quiet?: boolean };
type BluetoothPairingStage = 'confirm' | 'pairing' | 'checking-input' | 'input-required' | 'connected' | 'failed' | 'staff-approval-required';

const NETWORK_CACHE_TTL_MS = 30_000;
const BLUETOOTH_CACHE_TTL_MS = 60_000;
const SYSTEM_CACHE_TTL_MS = 10_000;
const SETTINGS_PREVIEW_HYDRATION_DELAY_MS = 700;
const settingsDataCache: {
  network?: CachedSettingsValue<NetworkStatus>;
  bluetooth?: CachedSettingsValue<BluetoothStatus>;
  audio?: CachedSettingsValue<AudioStatus>;
  display?: CachedSettingsValue<DisplayStatus>;
} = {};

const SETTINGS_ITEMS: Array<{ key: SettingsKey; label: string; subtitle: string }> = [
  { key: 'guide', label: 'Guide & Tips / Info', subtitle: 'Controls and help for this station' },
  { key: 'accessibility', label: 'Accessibility', subtitle: 'Comfort options for every player' },
  { key: 'network', label: 'Network', subtitle: 'Choose a Wi-Fi network' },
  { key: 'controller', label: 'Bluetooth / Controller', subtitle: 'Find and pair controllers and devices' },
  { key: 'users', label: 'Users and Accounts', subtitle: 'Profiles on this station' },
  { key: 'system', label: 'System', subtitle: 'Display and audio controls' },
  { key: 'storage', label: 'Storage', subtitle: 'Games and data on this station' },
  { key: 'control-room', label: 'Control Room', subtitle: 'Protected administrator controls' }
];

const EMPTY_NETWORK: NetworkStatus = {
  supported: true,
  connected: false,
  connectivity: 'unknown',
  availableNetworks: []
};

const EMPTY_BLUETOOTH: BluetoothStatus = {
  supported: true,
  radioState: 'unknown',
  devices: []
};

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
  brightness: { supported: false, level: 0, message: 'Checking brightness support...' },
  nightLight: { supported: false, enabled: false, controlSupported: false, message: 'Night Light status is unavailable.' },
  colorProfile: { currentProfile: 'System default', availableProfiles: [], switchingSupported: false, message: 'Color profile switching is not supported yet.' },
  hdr: { support: 'unknown', enabled: false, controlSupported: false, message: 'HDR status is unavailable.' }
};

const FOCUS_GROUP_SELECTOR = '[data-settings-group]';
const CONSOLE_FOCUS_ATTRIBUTE = 'data-console-focus';

/**
 * Mirrors DOM focus as an attribute so the focus frame stays visible while the
 * launcher window is not the OS-focused window (controller input still works).
 */
function markConsoleFocus(target: Element | null): void {
  for (const element of Array.from(document.querySelectorAll(`[${CONSOLE_FOCUS_ATTRIBUTE}]`))) {
    if (element !== target) element.removeAttribute(CONSOLE_FOCUS_ATTRIBUTE);
  }
  target?.setAttribute(CONSOLE_FOCUS_ATTRIBUTE, '');
}

function focusConsoleElement(target: HTMLElement | null | undefined, options?: FocusOptions): boolean {
  if (!target) return false;
  target.focus(options);
  if (document.activeElement !== target) return false;
  markConsoleFocus(target);
  return true;
}

function focusableDetailActions(): HTMLElement[] {
  const confirmation = document.querySelector<HTMLElement>('.settings-confirmation-dialog');
  const contextMenu = document.querySelector<HTMLElement>('.wifi-context-menu');
  const scope = confirmation ?? contextMenu ?? document.querySelector<HTMLElement>('.console-settings-detail');
  if (!scope) return [];
  return Array.from(scope.querySelectorAll<HTMLElement>('[data-settings-action]'))
    .filter((element) => !element.hasAttribute('disabled') && element.getClientRects().length > 0);
}

/** Vertical focus stops: controls laid out side by side in a [data-settings-group] count as one stop. */
function detailFocusStops(actions: HTMLElement[]): HTMLElement[][] {
  const stops: HTMLElement[][] = [];
  let previousGroup: Element | null = null;
  for (const action of actions) {
    const group = action.closest(FOCUS_GROUP_SELECTOR);
    if (group && group === previousGroup) stops[stops.length - 1].push(action);
    else stops.push([action]);
    previousGroup = group;
  }
  return stops;
}

function preferredFocusTarget(stop: HTMLElement[]): HTMLElement {
  return stop.find((element) => element.matches('[data-settings-preferred], .selected')) ?? stop[0];
}

function preferredScrollBehavior(): ScrollBehavior {
  return getUiPreference('reduceMotion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

function focusDetailAction(target: HTMLElement): void {
  focusConsoleElement(target, { preventScroll: true });
  target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: preferredScrollBehavior() });
}

function focusFirstDetailAction(): boolean {
  const firstStop = detailFocusStops(focusableDetailActions())[0];
  return firstStop ? focusConsoleElement(preferredFocusTarget(firstStop)) : false;
}

const DETAIL_SCOPE_SELECTOR = '.console-settings-detail, .settings-confirmation-dialog, .wifi-context-menu';

/**
 * The control the player is on: DOM focus, or the marked control when focus
 * fell to <body> because that control disabled itself while its action runs.
 */
function currentDetailFocus(): HTMLElement | null {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) return active;
  return document.querySelector<HTMLElement>(`[${CONSOLE_FOCUS_ATTRIBUTE}]`);
}

function isDetailControl(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && element.closest(DETAIL_SCOPE_SELECTOR) !== null;
}

function isBusyDetailControl(element: Element | null): boolean {
  return isDetailControl(element) && element.matches(':disabled');
}

/** Nearest stop above or below a control that is not a stop itself (it is disabled), without wrapping. */
function adjacentStopIndex(stops: HTMLElement[][], control: HTMLElement, direction: number): number {
  const anchor = control.closest(FOCUS_GROUP_SELECTOR) ?? control;
  if (direction > 0) {
    return stops.findIndex((stop) => !anchor.contains(stop[0]) && Boolean(anchor.compareDocumentPosition(stop[0]) & Node.DOCUMENT_POSITION_FOLLOWING));
  }
  let index = -1;
  for (let position = 0; position < stops.length; position += 1) {
    if (anchor.compareDocumentPosition(stops[position][0]) & Node.DOCUMENT_POSITION_PRECEDING) index = position;
  }
  return index;
}

export function ConsoleSettings(props: { inputBlocked: boolean; settings: AppSettings; appVersion?: string; onSettingsChanged: (settings: AppSettings) => void; onBack: () => void; onControlRoom: () => void }): JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [openedIndex, setOpenedIndex] = useState(0);
  const [detailMode, setDetailMode] = useState(false);
  const [network, setNetwork] = useState<NetworkStatus>(() => settingsDataCache.network?.value ?? EMPTY_NETWORK);
  const [networkPending, setNetworkPending] = useState<'refresh' | 'connect' | 'disconnect' | 'forget' | null>(null);
  const [networkFeedback, setNetworkFeedback] = useState<Feedback | null>(null);
  const [selectedWifi, setSelectedWifi] = useState<WifiNetworkSummary | null>(null);
  const [forgetWifiTarget, setForgetWifiTarget] = useState<WifiNetworkSummary | null>(null);
  const [wifiContextMenu, setWifiContextMenu] = useState<{ wifi: WifiNetworkSummary; x: number; y: number } | null>(null);
  const [wifiPassword, setWifiPassword] = useState('');
  const [showWifiPassword, setShowWifiPassword] = useState(false);
  const [bluetooth, setBluetooth] = useState<BluetoothStatus>(() => settingsDataCache.bluetooth?.value ?? EMPTY_BLUETOOTH);
  const [bluetoothPending, setBluetoothPending] = useState<string | null>(null);
  const [bluetoothFeedback, setBluetoothFeedback] = useState<Feedback | null>(null);
  const [controllerIdlePending, setControllerIdlePending] = useState(false);
  const [controllerIdleFeedback, setControllerIdleFeedback] = useState<Feedback | null>(null);
  const [bluetoothDeviceStatuses, setBluetoothDeviceStatuses] = useState<Record<string, string>>({});
  const [bluetoothPairingTarget, setBluetoothPairingTarget] = useState<BluetoothDeviceSummary | null>(null);
  const [bluetoothPairingStage, setBluetoothPairingStage] = useState<BluetoothPairingStage>('confirm');
  const [bluetoothPairingMessage, setBluetoothPairingMessage] = useState('Confirm pairing to connect this device with NXGS.');
  const [removeBluetoothTarget, setRemoveBluetoothTarget] = useState<BluetoothDeviceSummary | null>(null);
  const [audio, setAudio] = useState<AudioStatus>(() => settingsDataCache.audio?.value ?? EMPTY_AUDIO);
  const [displayVolume, setDisplayVolume] = useState(() => settingsDataCache.audio?.value.masterVolume ?? 0);
  const [audioPending, setAudioPending] = useState<string | null>(null);
  const [audioFeedback, setAudioFeedback] = useState<Feedback | null>(null);
  const [display, setDisplay] = useState<DisplayStatus>(() => settingsDataCache.display?.value ?? EMPTY_DISPLAY);
  const [displayBrightness, setDisplayBrightness] = useState(() => settingsDataCache.display?.value.brightness.level ?? 0);
  const [displayPending, setDisplayPending] = useState<'refresh' | 'hdr' | null>(null);
  const [brightnessSyncing, setBrightnessSyncing] = useState(false);
  const [displayFeedback, setDisplayFeedback] = useState<Feedback | null>(null);
  const [displayInfoExpanded, setDisplayInfoExpanded] = useState(false);
  const [diagnostics, setDiagnostics] = useState<AppDiagnostics | null>(null);
  const networkBusy = useRef(false);
  const networkStatusBusy = useRef(false);
  const bluetoothBusy = useRef(false);
  const bluetoothStatusBusy = useRef(false);
  const audioBusy = useRef(false);
  const audioStatusBusy = useRef(false);
  const displayBusy = useRef(false);
  const displayStatusBusy = useRef(false);
  const networkUpdatedAt = useRef(settingsDataCache.network?.updatedAt ?? 0);
  const bluetoothUpdatedAt = useRef(settingsDataCache.bluetooth?.updatedAt ?? 0);
  const audioUpdatedAt = useRef(settingsDataCache.audio?.updatedAt ?? 0);
  const displayUpdatedAt = useRef(settingsDataCache.display?.updatedAt ?? 0);
  const networkActionStartedAt = useRef(0);
  const bluetoothActionStartedAt = useRef(0);
  const bluetoothPairingAttempt = useRef(0);
  const audioActionStartedAt = useRef(0);
  const displayActionStartedAt = useRef(0);
  const selectedIndexRef = useRef(0);
  const brightnessTarget = useRef<number | null>(null);
  const brightnessFlushActive = useRef(false);
  const dialogReturnFocus = useRef<HTMLElement | null>(null);
  const pendingDetailFocus = useRef(false);
  const selected = SETTINGS_ITEMS[selectedIndex];
  const opened = SETTINGS_ITEMS[openedIndex];
  const overlayOpen = Boolean(forgetWifiTarget || wifiContextMenu || removeBluetoothTarget || bluetoothPairingTarget);

  const commitNetwork = useCallback((next: NetworkStatus): void => {
    const updatedAt = Date.now();
    settingsDataCache.network = { value: next, updatedAt };
    networkUpdatedAt.current = updatedAt;
    setNetwork(next);
  }, []);

  const commitBluetooth = useCallback((next: BluetoothStatus): void => {
    const updatedAt = Date.now();
    settingsDataCache.bluetooth = { value: next, updatedAt };
    bluetoothUpdatedAt.current = updatedAt;
    setBluetooth(next);
  }, []);

  const saveControllerIdle = useCallback(async (controllerIdle: AppSettings['controllerIdle']): Promise<void> => {
    if (controllerIdlePending) return;
    setControllerIdlePending(true);
    setControllerIdleFeedback({ tone: 'info', message: 'Saving controller power settings...' });
    try {
      const updated = await window.nxgs.updateSettings({ ...props.settings, controllerIdle });
      props.onSettingsChanged(updated);
      setControllerIdleFeedback({ tone: 'success', message: 'Controller power settings saved.' });
    } catch (error) {
      setControllerIdleFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'Could not save controller power settings.' });
    } finally {
      setControllerIdlePending(false);
    }
  }, [controllerIdlePending, props]);

  const commitAudio = useCallback((next: AudioStatus): void => {
    const updatedAt = Date.now();
    settingsDataCache.audio = { value: next, updatedAt };
    audioUpdatedAt.current = updatedAt;
    setAudio(next);
    setDisplayVolume(next.masterVolume);
  }, []);

  const commitDisplay = useCallback((next: DisplayStatus, syncBrightness = true): void => {
    const updatedAt = Date.now();
    settingsDataCache.display = { value: next, updatedAt };
    displayUpdatedAt.current = updatedAt;
    setDisplay(next);
    if (syncBrightness) setDisplayBrightness(next.brightness.level);
  }, []);

  const refreshNetwork = useCallback(async (options: RefreshOptions = {}): Promise<void> => {
    if (options.quiet) {
      if (networkStatusBusy.current) return;
      networkStatusBusy.current = true;
    } else {
      if (networkBusy.current) return;
      networkBusy.current = true;
      networkActionStartedAt.current = Date.now();
      setNetworkPending('refresh');
      setNetworkFeedback({ tone: 'info', message: 'Scanning for Wi-Fi networks...' });
    }
    const startedAt = Date.now();
    try {
      const next = await window.nxgs.scanWifiNetworks();
      if (!options.quiet || networkActionStartedAt.current <= startedAt) {
        commitNetwork(next);
        setSelectedWifi((current) => current ? next.availableNetworks.find((item) => item.ssid === current.ssid) ?? null : null);
        if (!options.quiet || !next.supported) {
          setNetworkFeedback(next.supported
            ? next.connected && next.connectivity !== 'internet'
              ? { tone: 'warning', message: next.message ?? 'No internet / limited connection' }
              : null
            : { tone: 'error', message: next.message ?? 'Wi-Fi is unavailable.' });
        }
      }
    } catch (error) {
      if (!options.quiet || networkUpdatedAt.current === 0) {
        setNetworkFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'Wi-Fi scan failed.' });
      }
    } finally {
      if (options.quiet) networkStatusBusy.current = false;
      else {
        networkBusy.current = false;
        setNetworkPending(null);
      }
    }
  }, [commitNetwork]);

  const refreshBluetooth = useCallback(async (): Promise<void> => {
    if (bluetoothBusy.current) return;
    bluetoothBusy.current = true;
    bluetoothActionStartedAt.current = Date.now();
    setBluetoothPending('scan');
    setBluetoothFeedback({ tone: 'info', message: 'Searching...' });
    setBluetoothDeviceStatuses({});
    try {
      const next = await window.nxgs.scanBluetoothDevices();
      commitBluetooth(next);
      setBluetoothFeedback(next.message
        ? { tone: next.supported ? 'warning' : 'error', message: next.message }
        : next.devices.length === 0
          ? { tone: 'warning', message: 'No devices found. Put the controller in pairing mode and scan again.' }
          : null);
    } catch (error) {
      setBluetoothFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'Bluetooth scan failed.' });
    } finally {
      bluetoothBusy.current = false;
      setBluetoothPending(null);
    }
  }, [commitBluetooth]);

  const refreshBluetoothStatus = useCallback(async (): Promise<void> => {
    if (bluetoothStatusBusy.current) return;
    bluetoothStatusBusy.current = true;
    const startedAt = Date.now();
    try {
      const next = await window.nxgs.getBluetoothStatus();
      if (bluetoothActionStartedAt.current <= startedAt) {
        commitBluetooth(next);
        if (!next.supported) {
          setBluetoothFeedback({ tone: 'error', message: next.message ?? 'Bluetooth is unavailable.' });
        }
      }
    } catch (error) {
      if (bluetoothUpdatedAt.current === 0) {
        setBluetoothFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to read Bluetooth status.' });
      }
    } finally {
      bluetoothStatusBusy.current = false;
    }
  }, [commitBluetooth]);

  const refreshAudio = useCallback(async (options: RefreshOptions = {}): Promise<void> => {
    if (options.quiet) {
      if (audioStatusBusy.current) return;
      audioStatusBusy.current = true;
    } else {
      if (audioBusy.current) return;
      audioBusy.current = true;
      audioActionStartedAt.current = Date.now();
      setAudioPending('refresh');
      setAudioFeedback({ tone: 'info', message: 'Refreshing audio controls...' });
    }
    const startedAt = Date.now();
    try {
      const next = await window.nxgs.getAudioStatus();
      if (!options.quiet || audioActionStartedAt.current <= startedAt) {
        commitAudio(next);
        if (!options.quiet || !next.supported) {
          setAudioFeedback(next.supported ? null : { tone: 'error', message: next.message ?? 'Audio controls are unavailable.' });
        }
      }
    } catch (error) {
      if (!options.quiet || audioUpdatedAt.current === 0) {
        setAudioFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to read audio settings.' });
      }
    } finally {
      if (options.quiet) audioStatusBusy.current = false;
      else {
        audioBusy.current = false;
        setAudioPending(null);
      }
    }
  }, [commitAudio]);

  const refreshDisplay = useCallback(async (options: RefreshOptions = {}): Promise<void> => {
    if (options.quiet) {
      if (displayStatusBusy.current) return;
      displayStatusBusy.current = true;
    } else {
      if (displayBusy.current) return;
      displayBusy.current = true;
      displayActionStartedAt.current = Date.now();
      setDisplayPending('refresh');
      setDisplayFeedback({ tone: 'info', message: 'Refreshing display information...' });
    }
    const startedAt = Date.now();
    try {
      const next = await window.nxgs.getDisplayStatus();
      if (!options.quiet || displayActionStartedAt.current <= startedAt) {
        commitDisplay(next);
        if (!options.quiet || !next.supported) {
          setDisplayFeedback(next.supported
            ? next.brightness.supported
              ? null
              : { tone: 'warning', message: next.brightness.message ?? 'Brightness control is not supported on this display.' }
            : { tone: 'error', message: next.message ?? 'Display information is unavailable.' });
        }
      }
    } catch (error) {
      if (!options.quiet || displayUpdatedAt.current === 0) {
        setDisplayFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to read display information.' });
      }
    } finally {
      if (options.quiet) displayStatusBusy.current = false;
      else {
        displayBusy.current = false;
        setDisplayPending(null);
      }
    }
  }, [commitDisplay]);

  const refreshSystem = useCallback(async (): Promise<void> => {
    await Promise.all([refreshDisplay(), refreshAudio()]);
  }, [refreshAudio, refreshDisplay]);

  const hydrateSettingsPage = useCallback((key: SettingsKey, explicit = false): void => {
    const now = Date.now();
    if (key === 'network' && (networkUpdatedAt.current === 0 || now - networkUpdatedAt.current > NETWORK_CACHE_TTL_MS)) {
      void refreshNetwork({ quiet: !explicit || networkUpdatedAt.current > 0 });
    }
    if (key === 'controller' && (bluetoothUpdatedAt.current === 0 || now - bluetoothUpdatedAt.current > BLUETOOTH_CACHE_TTL_MS)) {
      void refreshBluetoothStatus();
    }
    if (key === 'system') {
      if (audioUpdatedAt.current === 0 || now - audioUpdatedAt.current > SYSTEM_CACHE_TTL_MS) void refreshAudio({ quiet: true });
      if (displayUpdatedAt.current === 0 || now - displayUpdatedAt.current > SYSTEM_CACHE_TTL_MS) void refreshDisplay({ quiet: true });
    }
  }, [refreshAudio, refreshBluetoothStatus, refreshDisplay, refreshNetwork]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => hydrateSettingsPage(opened.key),
      SETTINGS_PREVIEW_HYDRATION_DELAY_MS
    );
    return () => window.clearTimeout(timer);
  }, [hydrateSettingsPage, opened.key]);

  useEffect(() => {
    setSelectedWifi(null);
    setForgetWifiTarget(null);
    setWifiContextMenu(null);
    setWifiPassword('');
    setDisplayInfoExpanded(false);
  }, [openedIndex]);

  useEffect(() => {
    if (!wifiContextMenu) return;
    const close = (event: PointerEvent): void => {
      if (event.target instanceof Element && event.target.closest('.wifi-context-menu')) return;
      setWifiContextMenu(null);
    };
    const closeOnBlur = (): void => setWifiContextMenu(null);
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('blur', closeOnBlur, { once: true });
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('blur', closeOnBlur);
    };
  }, [wifiContextMenu]);

  useEffect(() => {
    let mounted = true;
    const refresh = (): void => {
      void window.nxgs.getDiagnostics().then((next) => {
        if (mounted) setDiagnostics(next);
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.matches('[data-settings-action]')) markConsoleFocus(target);
      else if (target.closest('.console-settings-screen')) markConsoleFocus(null);
    };
    const onFocusOut = (event: FocusEvent): void => {
      if (event.target instanceof HTMLElement && event.target.matches(':disabled')) return;
      if (event.relatedTarget === null && document.hasFocus()) markConsoleFocus(null);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      markConsoleFocus(null);
    };
  }, []);

  useEffect(() => {
    if (props.inputBlocked) return;
    const dialog = document.querySelector<HTMLElement>('.settings-confirmation-dialog');
    if (dialog) {
      if (!dialog.contains(document.activeElement)) {
        const firstStop = detailFocusStops(focusableDetailActions())[0];
        if (firstStop) focusConsoleElement(preferredFocusTarget(firstStop));
      }
      return;
    }
    if (!detailMode) {
      pendingDetailFocus.current = false;
      return;
    }
    if (pendingDetailFocus.current) {
      if (focusFirstDetailAction()) pendingDetailFocus.current = false;
      return;
    }
    if (document.activeElement && document.activeElement !== document.body) return;
    const marked = document.querySelector<HTMLElement>(`[${CONSOLE_FOCUS_ATTRIBUTE}]`);
    if (marked && !marked.matches(':disabled')) focusConsoleElement(marked, { preventScroll: true });
  });

  useEffect(() => {
    if (overlayOpen || props.inputBlocked) return;
    const opener = dialogReturnFocus.current;
    dialogReturnFocus.current = null;
    if (opener?.isConnected && !opener.hasAttribute('disabled')) focusConsoleElement(opener, { preventScroll: true });
  }, [overlayOpen, props.inputBlocked]);

  const applyMasterVolume = useCallback(async (value: number, source: 'up' | 'down' | 'slider'): Promise<void> => {
    if (audioBusy.current) return;
    const nextVolume = Math.max(0, Math.min(100, Math.round(value)));
    setDisplayVolume(nextVolume);
    audioBusy.current = true;
    audioActionStartedAt.current = Date.now();
    setAudioPending(`volume-${source}`);
    setAudioFeedback({ tone: 'info', message: `Setting volume to ${nextVolume}%...` });
    try {
      const result = await window.nxgs.setMasterVolume(nextVolume);
      commitAudio(result.audio);
      setAudioFeedback({ tone: result.ok ? 'success' : 'error', message: result.message });
    } catch (error) {
      setDisplayVolume(audio.masterVolume);
      setAudioFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to change system volume.' });
    } finally {
      audioBusy.current = false;
      setAudioPending(null);
    }
  }, [audio.masterVolume, commitAudio]);

  const applyDisplayBrightness = useCallback((value: number): void => {
    if (!display.brightness.supported) {
      setDisplayFeedback({ tone: 'warning', message: display.brightness.message ?? 'Brightness control is not supported on this display.' });
      return;
    }
    const nextBrightness = Math.max(0, Math.min(100, Math.round(value)));
    setDisplayBrightness(nextBrightness);
    brightnessTarget.current = nextBrightness;
    if (brightnessFlushActive.current) return;

    brightnessFlushActive.current = true;
    displayActionStartedAt.current = Date.now();
    setBrightnessSyncing(true);
    void (async () => {
      try {
        while (brightnessTarget.current !== null) {
          const target = brightnessTarget.current;
          brightnessTarget.current = null;
          const result = await window.nxgs.setBrightness(target);
          commitDisplay(result.display, false);
          if (!result.ok) {
            setDisplayFeedback({ tone: 'error', message: result.message });
            setDisplayBrightness(result.display.brightness.level);
            brightnessTarget.current = null;
            break;
          }
          if (brightnessTarget.current === null) {
            setDisplayBrightness(result.display.brightness.level);
            setDisplayFeedback({ tone: 'success', message: result.message });
          }
        }
      } catch (error) {
        setDisplayFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to change display brightness.' });
      } finally {
        brightnessFlushActive.current = false;
        setBrightnessSyncing(false);
        if (brightnessTarget.current !== null) applyDisplayBrightness(brightnessTarget.current);
      }
    })();
  }, [commitDisplay, display.brightness.message, display.brightness.supported]);

  const toggleHdr = useCallback(async (): Promise<void> => {
    if (displayBusy.current) return;
    displayBusy.current = true;
    displayActionStartedAt.current = Date.now();
    setDisplayPending('hdr');
    setDisplayFeedback({ tone: 'info', message: display.hdr.enabled ? 'Turning HDR off...' : 'Turning HDR on...' });
    try {
      const result = await window.nxgs.setHdr(!display.hdr.enabled);
      commitDisplay(result.display);
      setDisplayFeedback({ tone: result.ok ? 'success' : 'warning', message: result.message });
    } catch (error) {
      setDisplayFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'HDR could not be changed.' });
    } finally {
      displayBusy.current = false;
      setDisplayPending(null);
    }
  }, [commitDisplay, display.hdr.enabled]);

  const toggleMasterMute = useCallback(async (): Promise<void> => {
    if (audioBusy.current) return;
    audioBusy.current = true;
    audioActionStartedAt.current = Date.now();
    setAudioPending('mute');
    setAudioFeedback({ tone: 'info', message: audio.muted ? 'Unmuting system sound...' : 'Muting system sound...' });
    try {
      const result = await window.nxgs.setMasterMuted(!audio.muted);
      commitAudio(result.audio);
      setAudioFeedback({ tone: result.ok ? 'success' : 'error', message: result.message });
    } catch (error) {
      setAudioFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to change mute status.' });
    } finally {
      audioBusy.current = false;
      setAudioPending(null);
    }
  }, [audio.muted, commitAudio]);

  const switchAudioEndpoint = useCallback(async (device: AudioDeviceSummary): Promise<void> => {
    if (audioBusy.current || device.isDefault) return;
    audioBusy.current = true;
    audioActionStartedAt.current = Date.now();
    setAudioPending(`switch:${device.id}`);
    setAudioFeedback({ tone: 'info', message: `Switching to ${device.name}...` });
    try {
      const result = device.kind === 'output'
        ? await window.nxgs.switchAudioOutput(device.id)
        : await window.nxgs.switchAudioInput(device.id);
      commitAudio(result.audio);
      setAudioFeedback({ tone: result.ok ? 'success' : 'warning', message: result.message });
    } catch (error) {
      setAudioFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to change the audio device.' });
    } finally {
      audioBusy.current = false;
      setAudioPending(null);
    }
  }, [commitAudio]);

  const adjustFocusedSlider = useCallback((direction: -1 | 1): boolean => {
    const active = currentDetailFocus();
    if (!(active instanceof HTMLInputElement)) return false;
    const slider = active.dataset.settingsSlider;
    if (slider !== 'volume' && slider !== 'brightness') return false;
    if (active.disabled) return true;
    if (slider === 'volume') {
      const next = Math.max(0, Math.min(100, displayVolume + direction * 5));
      if (next !== displayVolume && !audioBusy.current) playUiSound('move');
      void applyMasterVolume(next, direction > 0 ? 'up' : 'down');
      return true;
    }
    const next = Math.max(0, Math.min(100, displayBrightness + direction * 5));
    if (next !== displayBrightness) playUiSound('move');
    applyDisplayBrightness(displayBrightness + direction * 5);
    return true;
  }, [applyDisplayBrightness, applyMasterVolume, displayBrightness, displayVolume]);

  const previewSettingsIndex = useCallback((index: number): void => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('.console-settings-detail')) active.blur();
    markConsoleFocus(null);
    selectedIndexRef.current = index;
    setSelectedIndex(index);
    setOpenedIndex(index);
    setDetailMode(false);
  }, []);

  const moveSettingsPreview = useCallback((direction: -1 | 1): void => {
    const next = (selectedIndexRef.current + direction + SETTINGS_ITEMS.length) % SETTINGS_ITEMS.length;
    previewSettingsIndex(next);
    playUiSound('move');
  }, [previewSettingsIndex]);

  const rememberDialogOpener = useCallback((): void => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('.console-settings-detail') && !active.closest('.wifi-context-menu')) {
      dialogReturnFocus.current = active;
    }
  }, []);

  const enterDetail = useCallback((): void => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('.console-settings-layout > nav')) active.blur();
    setDetailMode(true);
    pendingDetailFocus.current = true;
    window.setTimeout(() => {
      if (pendingDetailFocus.current && focusFirstDetailAction()) pendingDetailFocus.current = false;
    }, 0);
  }, []);

  const leaveDetail = useCallback((): void => {
    previewSettingsIndex(openedIndex);
    (document.querySelector<HTMLElement>(`.console-settings-layout > nav button[data-index="${openedIndex}"]`))?.focus();
  }, [openedIndex, previewSettingsIndex]);

  const handleSettingsBack = useCallback((): void => {
    if (forgetWifiTarget || wifiContextMenu || removeBluetoothTarget || bluetoothPairingTarget) {
      if (bluetoothPairingTarget && (bluetoothPairingStage === 'pairing' || bluetoothPairingStage === 'checking-input')) {
        bluetoothPairingAttempt.current += 1;
        void window.nxgs.cancelBluetoothPairing();
        setBluetoothPending(null);
        setBluetoothPairingTarget(null);
        return;
      }
      setForgetWifiTarget(null);
      setWifiContextMenu(null);
      setRemoveBluetoothTarget(null);
      setBluetoothPairingTarget(null);
      return;
    }
    if (selectedWifi) {
      const ssid = selectedWifi.ssid;
      const focusInPanel = document.activeElement instanceof Element && Boolean(document.activeElement.closest('.wifi-selected-panel'));
      setSelectedWifi(null);
      setWifiPassword('');
      setShowWifiPassword(false);
      if (focusInPanel) {
        window.setTimeout(() => {
          focusConsoleElement(Array.from(document.querySelectorAll<HTMLElement>('.wifi-network-list > button')).find((row) => row.dataset.ssid === ssid));
        }, 0);
      }
      return;
    }
    if (displayInfoExpanded) {
      setDisplayInfoExpanded(false);
      return;
    }
    if (detailMode) {
      leaveDetail();
      return;
    }
    props.onBack();
  }, [bluetoothPairingStage, bluetoothPairingTarget, detailMode, displayInfoExpanded, forgetWifiTarget, leaveDetail, props, removeBluetoothTarget, selectedWifi, wifiContextMenu]);

  const moveDetailFocus = useCallback((direction: number): void => {
    const stops = detailFocusStops(focusableDetailActions());
    if (stops.length === 0) return;
    const control = currentDetailFocus();
    const current = control ? stops.findIndex((stop) => stop.includes(control)) : -1;
    let next: number;
    if (current >= 0) next = (current + direction + stops.length) % stops.length;
    else if (control && isDetailControl(control)) next = adjacentStopIndex(stops, control, direction);
    else next = direction > 0 ? 0 : stops.length - 1;
    if (next < 0 || next === current) return;
    pendingDetailFocus.current = false;
    focusDetailAction(preferredFocusTarget(stops[next]));
    playUiSound('move');
  }, []);

  const moveDetailFocusWithinGroup = useCallback((direction: -1 | 1): boolean => {
    const control = currentDetailFocus();
    const group = control?.closest(FOCUS_GROUP_SELECTOR);
    if (!control || !group) return false;
    const members = focusableDetailActions().filter((element) => group.contains(element));
    const index = members.indexOf(control);
    let target: HTMLElement | undefined;
    if (index >= 0) {
      if (members.length < 2) return false;
      target = members[index + direction];
      if (!target) return direction > 0;
    } else {
      target = direction > 0
        ? members.find((element) => Boolean(control.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING))
        : [...members].reverse().find((element) => Boolean(control.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING));
      if (!target) return true;
    }
    focusDetailAction(target);
    playUiSound('move');
    return true;
  }, []);

  const closeOverlaysOrLeaveDetail = useCallback((): void => {
    if (forgetWifiTarget || wifiContextMenu || removeBluetoothTarget || bluetoothPairingTarget) {
      if (bluetoothPairingTarget && (bluetoothPairingStage === 'pairing' || bluetoothPairingStage === 'checking-input')) return;
      setForgetWifiTarget(null);
      setWifiContextMenu(null);
      setRemoveBluetoothTarget(null);
      setBluetoothPairingTarget(null);
    } else {
      leaveDetail();
    }
    playUiSound('back');
  }, [bluetoothPairingStage, bluetoothPairingTarget, forgetWifiTarget, leaveDetail, removeBluetoothTarget, wifiContextMenu]);

  const activateFocusedAction = useCallback((): void => {
    const control = currentDetailFocus();
    if (!(control instanceof HTMLButtonElement) || !isDetailControl(control)) return;
    if (control.disabled) {
      playUiSound('error');
      return;
    }
    const toggles = control.getAttribute('role') === 'switch' || Boolean(control.closest('.controller-power-options'));
    control.click();
    playUiSound(toggles ? 'toggle' : 'select');
  }, []);

  const activateSelected = useCallback((): void => {
    const index = selectedIndexRef.current;
    const key = SETTINGS_ITEMS[index].key;
    if (key === 'control-room') {
      playUiSound('select');
      props.onControlRoom();
    } else {
      playUiSound('open');
      setOpenedIndex(index);
      hydrateSettingsPage(key, true);
      enterDetail();
    }
  }, [enterDetail, hydrateSettingsPage, props]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (props.inputBlocked) return;
      const backRequested = isBackKeyboardEvent(event);
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(event.key) && !backRequested) return;
      if (backRequested && shouldKeepEditing(event)) return;
      if (detailMode) {
        const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
        if (horizontal && shouldKeepEditing(event)) {
          event.stopImmediatePropagation();
          return;
        }
        if (backRequested) {
          event.preventDefault();
          event.stopImmediatePropagation();
          playUiSound('back');
          handleSettingsBack();
          return;
        }
        if (horizontal) {
          const direction = event.key === 'ArrowRight' ? 1 : -1;
          if (adjustFocusedSlider(direction) || moveDetailFocusWithinGroup(direction) || isBusyDetailControl(currentDetailFocus())) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
          }
        }
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          event.stopImmediatePropagation();
          moveDetailFocus(event.key === 'ArrowUp' ? -1 : 1);
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          event.stopImmediatePropagation();
          closeOverlaysOrLeaveDetail();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          event.stopImmediatePropagation();
          activateFocusedAction();
        }
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'ArrowUp') moveSettingsPreview(-1);
      else if (event.key === 'ArrowDown') moveSettingsPreview(1);
      else if (event.key === 'Enter' || event.key === 'ArrowRight') activateSelected();
      else {
        playUiSound('back');
        handleSettingsBack();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [activateFocusedAction, activateSelected, adjustFocusedSlider, closeOverlaysOrLeaveDetail, detailMode, handleSettingsBack, moveDetailFocus, moveDetailFocusWithinGroup, moveSettingsPreview, props.inputBlocked]);

  const handleSettingsControllerEvent = useCallback((event: ControllerNavigationEvent): void => {
    if (event.type === 'back') {
      playUiSound('back');
      handleSettingsBack();
      void window.nxgs.reportControllerState({ detected: true, name: event.pad.id, homeSupported: event.pad.buttons.length > 16 ? 'unknown' : 'no', lastButtonPressed: 'Circle / B', lastNavigationAction: 'Settings: back' });
      return;
    }
    if (event.type === 'accept') {
      if (detailMode) activateFocusedAction();
      else activateSelected();
      void window.nxgs.reportControllerState({ detected: true, name: event.pad.id, homeSupported: event.pad.buttons.length > 16 ? 'unknown' : 'no', lastButtonPressed: 'X / A', lastNavigationAction: `Settings: select ${selected.label}` });
      return;
    }

    if (detailMode) {
      const control = currentDetailFocus();
      const sliderFocused =
        control instanceof HTMLInputElement &&
        ['volume', 'brightness'].includes(control.dataset.settingsSlider ?? '');
      if (sliderFocused && event.direction === 'left') adjustFocusedSlider(-1);
      else if (sliderFocused && event.direction === 'right') adjustFocusedSlider(1);
      else if (event.direction === 'up') moveDetailFocus(-1);
      else if (event.direction === 'down') moveDetailFocus(1);
      else if (event.direction === 'right') moveDetailFocusWithinGroup(1);
      else if (event.direction === 'left' && !moveDetailFocusWithinGroup(-1) && !isBusyDetailControl(control)) closeOverlaysOrLeaveDetail();
      return;
    }

    if (event.direction === 'up') {
      moveSettingsPreview(-1);
    } else if (event.direction === 'down') {
      moveSettingsPreview(1);
    } else if (event.direction === 'right') {
      activateSelected();
    }
  }, [activateFocusedAction, activateSelected, adjustFocusedSlider, closeOverlaysOrLeaveDetail, detailMode, handleSettingsBack, moveDetailFocus, moveDetailFocusWithinGroup, moveSettingsPreview, selected.label]);

  useControllerNavigation(!props.inputBlocked, handleSettingsControllerEvent);

  const performWifiConnect = useCallback(async (wifi: WifiNetworkSummary, password?: string): Promise<void> => {
    if (networkBusy.current) return;
    networkBusy.current = true;
    networkActionStartedAt.current = Date.now();
    setNetworkPending('connect');
    setNetworkFeedback({ tone: 'info', message: `Connecting to ${wifi.ssid}...` });
    try {
      const result = await window.nxgs.connectWifi({ ssid: wifi.ssid, password });
      commitNetwork(result.network);
      setSelectedWifi(result.network.availableNetworks.find((item) => item.ssid === wifi.ssid) ?? wifi);
      if (result.ok) {
        setWifiPassword('');
        setNetworkFeedback({
          tone: result.network.connectivity === 'internet' ? 'success' : 'warning',
          message: result.message
        });
      } else {
        setNetworkFeedback({ tone: 'error', message: result.status === 'incorrect-password' ? `Incorrect password: ${result.message}` : result.message });
        if (wifi.requiresPassword) setSelectedWifi(wifi);
      }
    } catch (error) {
      setNetworkFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to connect.' });
    } finally {
      networkBusy.current = false;
      setNetworkPending(null);
    }
  }, [commitNetwork]);

  const selectWifi = useCallback((wifi: WifiNetworkSummary): void => {
    if (networkBusy.current) return;
    const alreadySelected = selectedWifi?.ssid === wifi.ssid;
    setSelectedWifi(wifi);
    setWifiContextMenu(null);
    if (!alreadySelected) {
      setWifiPassword('');
      setShowWifiPassword(false);
      setNetworkFeedback({ tone: 'info', message: `${wifi.ssid} selected. Choose an action below.` });
      window.setTimeout(() => document.querySelector<HTMLElement>('.wifi-selected-panel')?.scrollIntoView({ block: 'nearest', behavior: preferredScrollBehavior() }), 0);
    } else {
      window.setTimeout(() => focusConsoleElement(document.querySelector<HTMLElement>('#selected-wifi-primary-action')), 0);
    }
  }, [selectedWifi?.ssid]);

  const openWifiContextMenu = useCallback((wifi: WifiNetworkSummary, clientX: number, clientY: number): void => {
    const detail = document.querySelector<HTMLElement>('.console-settings-detail');
    const bounds = detail?.getBoundingClientRect();
    const scrollLeft = detail?.scrollLeft ?? 0;
    const scrollTop = detail?.scrollTop ?? 0;
    const x = bounds ? clientX - bounds.left + scrollLeft : clientX;
    const y = bounds ? clientY - bounds.top + scrollTop : clientY;
    const maxX = detail ? scrollLeft + detail.clientWidth - 230 : window.innerWidth - 230;
    const maxY = detail ? scrollTop + detail.clientHeight - 90 : window.innerHeight - 90;
    rememberDialogOpener();
    setSelectedWifi(wifi);
    setWifiPassword('');
    setWifiContextMenu({
      wifi,
      x: Math.max(scrollLeft + 8, Math.min(x, maxX)),
      y: Math.max(scrollTop + 8, Math.min(y, maxY))
    });
    window.setTimeout(() => focusConsoleElement(document.querySelector<HTMLButtonElement>('.wifi-context-menu [role="menuitem"]')), 0);
  }, [rememberDialogOpener]);

  const disconnectNetwork = useCallback(async (): Promise<void> => {
    if (networkBusy.current) return;
    networkBusy.current = true;
    networkActionStartedAt.current = Date.now();
    setNetworkPending('disconnect');
    setNetworkFeedback({ tone: 'info', message: 'Disconnecting...' });
    try {
      const result = await window.nxgs.disconnectWifi();
      commitNetwork(result.network);
      setSelectedWifi((current) => current ? result.network.availableNetworks.find((item) => item.ssid === current.ssid) ?? current : null);
      setNetworkFeedback({ tone: result.ok ? 'success' : 'error', message: result.message });
    } catch (error) {
      setNetworkFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to disconnect.' });
    } finally {
      networkBusy.current = false;
      setNetworkPending(null);
    }
  }, [commitNetwork]);

  const requestForgetWifi = useCallback((wifi: WifiNetworkSummary): void => {
    if (!wifi.saved || networkBusy.current) return;
    rememberDialogOpener();
    setWifiContextMenu(null);
    setForgetWifiTarget(wifi);
    window.setTimeout(() => focusConsoleElement(document.querySelector<HTMLButtonElement>('#wifi-forget-cancel')), 0);
  }, [rememberDialogOpener]);

  const forgetSelectedWifi = useCallback(async (): Promise<void> => {
    if (!forgetWifiTarget || networkBusy.current) return;
    networkBusy.current = true;
    networkActionStartedAt.current = Date.now();
    setNetworkPending('forget');
    setNetworkFeedback({ tone: 'info', message: `Forgetting ${forgetWifiTarget.ssid}...` });
    try {
      const result = await window.nxgs.forgetWifi(forgetWifiTarget.ssid);
      commitNetwork(result.network);
      setSelectedWifi(result.network.availableNetworks.find((item) => item.ssid === forgetWifiTarget.ssid) ?? null);
      setWifiPassword('');
      setNetworkFeedback({ tone: result.ok ? 'success' : 'error', message: result.message });
      setForgetWifiTarget(null);
    } catch (error) {
      setNetworkFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to forget this network.' });
      setForgetWifiTarget(null);
    } finally {
      networkBusy.current = false;
      setNetworkPending(null);
    }
  }, [commitNetwork, forgetWifiTarget]);

  const handleBluetoothDevice = useCallback(async (device: BluetoothDeviceSummary, action: 'connect' | 'disconnect'): Promise<void> => {
    if (bluetoothBusy.current) return;
    bluetoothBusy.current = true;
    bluetoothActionStartedAt.current = Date.now();
    const disconnecting = action === 'disconnect';
    const checkingInput = action === 'connect' && device.controller && device.connected && !device.inputReady;
    setBluetoothPending(`${action}:${device.id}`);
    setBluetoothFeedback({
      tone: 'info',
      message: disconnecting
        ? `Disconnecting ${device.name}...`
        : checkingInput
          ? `Checking ${device.name} controller input...`
          : device.paired
            ? `Reconnecting ${device.name}...`
            : `Pairing ${device.name}...`
    });
    try {
      const result = disconnecting
        ? await window.nxgs.disconnectBluetoothDevice(device.id)
        : await window.nxgs.pairBluetoothDevice({ device, bluetooth, fastPairing: false });
      commitBluetooth(result.bluetooth);
      setBluetoothFeedback({ tone: result.status === 'paired' ? 'warning' : result.ok ? 'success' : 'error', message: result.message });
      setBluetoothDeviceStatuses((current) => ({
        ...current,
        [device.id]: result.status === 'connected'
          ? device.controller ? 'Controller input ready' : 'Connected'
          : result.status === 'paired'
            ? device.controller ? 'Paired / input unavailable' : 'Paired / Disconnected'
            : 'Failed'
      }));
    } catch (error) {
      setBluetoothFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'Bluetooth action failed.' });
      setBluetoothDeviceStatuses((current) => ({ ...current, [device.id]: 'Failed' }));
    } finally {
      bluetoothBusy.current = false;
      setBluetoothPending(null);
    }
  }, [bluetooth, commitBluetooth]);

  const requestPairBluetoothDevice = useCallback((device: BluetoothDeviceSummary): void => {
    if (device.paired || bluetoothBusy.current) return;
    rememberDialogOpener();
    setBluetoothPairingTarget(device);
    setBluetoothPairingStage('confirm');
    setBluetoothPairingMessage('Confirm pairing to connect this device with NXGS.');
    setBluetoothFeedback(null);
    window.setTimeout(() => focusConsoleElement(document.querySelector<HTMLButtonElement>('#bluetooth-pair-primary')), 0);
  }, [rememberDialogOpener]);

  const confirmPairBluetoothDevice = useCallback(async (): Promise<void> => {
    if (!bluetoothPairingTarget || bluetoothBusy.current) return;
    const target = bluetoothPairingTarget;
    const attempt = ++bluetoothPairingAttempt.current;
    bluetoothBusy.current = true;
    bluetoothActionStartedAt.current = Date.now();
    setBluetoothPending(`pair:${target.id}`);
    const checkingInput = target.paired || bluetoothPairingStage === 'input-required';
    setBluetoothPairingStage(checkingInput ? 'checking-input' : 'pairing');
    setBluetoothPairingMessage(checkingInput
      ? 'Checking controller input... Keep the controller awake and press PS / Home once.'
      : 'Pairing... Keep the controller awake and in pairing mode.');
    setBluetoothFeedback({ tone: 'info', message: checkingInput ? `Checking ${target.name} controller input...` : `Pairing ${target.name}...` });
    try {
      const result = await window.nxgs.pairBluetoothDevice({ device: target, bluetooth, fastPairing: !checkingInput });
      if (attempt !== bluetoothPairingAttempt.current) return;
      commitBluetooth(result.bluetooth);
      setBluetoothPairingMessage(result.message);
      setBluetoothFeedback({
        tone: result.status === 'paired' ? 'warning' : result.ok ? 'success' : result.status === 'staff-approval-required' ? 'warning' : 'error',
        message: result.message
      });
      const refreshedTarget = result.bluetooth.devices.find((device) => device.id.toLowerCase() === target.id.toLowerCase());
      if (refreshedTarget) setBluetoothPairingTarget(refreshedTarget);
      setBluetoothDeviceStatuses((current) => ({
        ...current,
        [target.id]: result.status === 'connected'
          ? target.controller ? 'Controller input ready' : 'Connected'
          : result.status === 'paired'
            ? 'Paired / input unavailable'
            : result.status === 'staff-approval-required' ? 'Staff approval required' : 'Pairing failed'
      }));
      setBluetoothPairingStage(
        result.status === 'connected'
          ? 'connected'
          : result.status === 'paired'
            ? 'input-required'
            : result.status === 'staff-approval-required' ? 'staff-approval-required' : 'failed'
      );
      if (result.status === 'connected') window.setTimeout(() => void refreshBluetoothStatus(), 1800);
    } catch (error) {
      if (attempt !== bluetoothPairingAttempt.current) return;
      const message = error instanceof Error ? error.message : 'Pairing failed. Try again.';
      setBluetoothPairingStage('failed');
      setBluetoothPairingMessage(message);
      setBluetoothFeedback({ tone: 'error', message });
      setBluetoothDeviceStatuses((current) => ({ ...current, [target.id]: 'Pairing failed' }));
    } finally {
      bluetoothBusy.current = false;
      setBluetoothPending(null);
      if (attempt === bluetoothPairingAttempt.current) {
        window.setTimeout(() => focusConsoleElement(document.querySelector<HTMLButtonElement>('#bluetooth-pair-primary')), 0);
      }
    }
  }, [bluetooth, bluetoothPairingStage, bluetoothPairingTarget, commitBluetooth, refreshBluetoothStatus]);

  const requestRemoveBluetoothDevice = useCallback((device: BluetoothDeviceSummary): void => {
    if (!device.paired || bluetoothBusy.current) return;
    rememberDialogOpener();
    setRemoveBluetoothTarget(device);
    window.setTimeout(() => focusConsoleElement(document.querySelector<HTMLButtonElement>('#bluetooth-remove-cancel')), 0);
  }, [rememberDialogOpener]);

  const confirmRemoveBluetoothDevice = useCallback(async (): Promise<void> => {
    if (!removeBluetoothTarget || bluetoothBusy.current) return;
    const target = removeBluetoothTarget;
    bluetoothBusy.current = true;
    bluetoothActionStartedAt.current = Date.now();
    setBluetoothPending(`remove:${target.id}`);
    setBluetoothFeedback({ tone: 'info', message: `Removing ${target.name}...` });
    try {
      const result = await window.nxgs.removeBluetoothDevice(target.id);
      commitBluetooth(result.bluetooth);
      setBluetoothFeedback({ tone: result.ok ? 'success' : 'error', message: result.message });
      if (!result.ok) setBluetoothDeviceStatuses((current) => ({ ...current, [target.id]: 'Failed' }));
      setRemoveBluetoothTarget(null);
    } catch (error) {
      setBluetoothFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to remove this Bluetooth device.' });
      setBluetoothDeviceStatuses((current) => ({ ...current, [target.id]: 'Failed' }));
      setRemoveBluetoothTarget(null);
    } finally {
      bluetoothBusy.current = false;
      setBluetoothPending(null);
    }
  }, [commitBluetooth, removeBluetoothTarget]);

  const detail = useMemo(() => {
    const focusDetail = (): void => {
      pendingDetailFocus.current = false;
      setDetailMode(true);
    };

    if (opened.key === 'network') {
      const selectedConnected = Boolean(selectedWifi && network.connected && network.ssid === selectedWifi.ssid);
      const selectedNeedsPassword = Boolean(selectedWifi?.requiresPassword && !selectedWifi.saved && !selectedConnected);
      const connectedLabel = networkPending === 'connect'
        ? 'Connecting...'
        : network.connected
          ? network.connectivity === 'internet' ? 'Connected' : 'No internet / limited connection'
          : 'Not connected';
      const networkTone: SettingsTone = networkPending === 'connect'
        ? 'info'
        : !network.supported
          ? 'warning'
          : network.connected
            ? network.connectivity === 'internet' ? 'success' : 'warning'
            : 'neutral';
      const selectedInList = Boolean(selectedWifi && network.availableNetworks.some((item) => item.ssid === selectedWifi.ssid));
      const selectedPanel = selectedWifi ? (
        <div className={`wifi-selected-panel${selectedInList ? ' inline' : ''}`}>
          {!selectedInList && (
            <div className="wifi-selected-title">
              <span className="settings-row-text"><small>Selected network</small><strong>{selectedWifi.ssid}</strong></span>
              <SettingsStatus tone={selectedConnected ? 'success' : 'neutral'}>{selectedConnected ? 'Connected' : selectedWifi.saved ? 'Saved' : 'Available'}</SettingsStatus>
            </div>
          )}
          <div className="wifi-selected-details">
            <span>Signal<strong>{selectedWifi.signal ?? 'Unknown'}</strong></span>
            <span>Security<strong>{selectedWifi.security ?? 'Open'}</strong></span>
            <span>Profile<strong>{selectedWifi.saved ? 'Saved' : 'Not saved'}</strong></span>
          </div>
          {selectedNeedsPassword && (
            <div className="wifi-password-panel">
              <label htmlFor="nxgs-wifi-password">Password for {selectedWifi.ssid}</label>
              <div className="wifi-password-input">
                <input
                  data-settings-action
                  id="nxgs-wifi-password"
                  type={showWifiPassword ? 'text' : 'password'}
                  value={wifiPassword}
                  disabled={networkPending !== null}
                  autoComplete="current-password"
                  onChange={(event) => setWifiPassword(event.target.value)}
                />
                <button className="settings-icon-button" data-settings-action type="button" disabled={networkPending !== null} aria-label={showWifiPassword ? 'Hide password' : 'Show password'} onClick={() => setShowWifiPassword((shown) => !shown)}>
                  {showWifiPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>
          )}
          <div className="settings-action-row" data-settings-group>
            {selectedConnected ? (
              <button id="selected-wifi-primary-action" className="settings-button" data-settings-action type="button" disabled={networkPending !== null} onClick={() => void disconnectNetwork()}>
                {networkPending === 'disconnect' && <LoaderCircle size={18} className="spin" />}
                {networkPending === 'disconnect' ? 'Disconnecting...' : 'Disconnect'}
              </button>
            ) : (
              <button id="selected-wifi-primary-action" className="settings-button primary" data-settings-action type="button" disabled={networkPending !== null || (selectedNeedsPassword && !wifiPassword)} onClick={() => void performWifiConnect(selectedWifi, selectedNeedsPassword ? wifiPassword : undefined)}>
                {networkPending === 'connect' && <LoaderCircle size={18} className="spin" />}
                {networkPending === 'connect' ? 'Connecting...' : 'Connect'}
              </button>
            )}
            {selectedWifi.saved && (
              <button className="settings-button danger" data-settings-action type="button" disabled={networkPending !== null} onClick={() => requestForgetWifi(selectedWifi)}>
                Forget Network
              </button>
            )}
          </div>
        </div>
      ) : null;
      return (
        <SettingsDetail title={opened.label} subtitle={opened.subtitle} onFocus={focusDetail}>
          <SettingsStatusCard
            tone={networkTone}
            label={connectedLabel}
            title={network.ssid ?? network.interfaceName ?? 'Wi-Fi'}
            detail={network.signal ? `Signal ${network.signal}` : network.message ?? 'Choose a network below.'}
          />
          {networkFeedback && <SettingsNotice tone={networkFeedback.tone} message={networkFeedback.message} />}
          <div className="settings-detail-heading">
            <h3>Available networks</h3>
            <button className="settings-button" data-settings-action type="button" disabled={networkPending !== null} onClick={() => void refreshNetwork()}>
              {networkPending === 'refresh' && <LoaderCircle size={18} className="spin" />}
              {networkPending === 'refresh' ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
          <div className="wifi-network-list">
            {!selectedInList && selectedPanel}
            {network.availableNetworks.length > 0 ? network.availableNetworks.map((item) => {
              const connected = network.connected && network.ssid === item.ssid;
              const isSelected = selectedWifi?.ssid === item.ssid;
              return (
                <Fragment key={item.ssid}>
                  <button
                    data-settings-action
                    data-ssid={item.ssid}
                    type="button"
                    disabled={networkPending !== null}
                    aria-pressed={isSelected}
                    aria-haspopup="menu"
                    className={`settings-row wifi-row${connected ? ' connected' : ''}${isSelected ? ' selected' : ''}`}
                    onClick={() => selectWifi(item)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      openWifiContextMenu(item, event.clientX, event.clientY);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
                      event.preventDefault();
                      const bounds = event.currentTarget.getBoundingClientRect();
                      openWifiContextMenu(item, bounds.right - 12, bounds.bottom - 4);
                    }}
                  >
                    <span className="settings-row-text"><strong>{item.ssid}</strong><small>{item.security ?? 'Open network'}{item.saved ? ' · Saved' : ''}</small></span>
                    <span className="settings-row-value">
                      {connected ? <SettingsStatus tone="success">Connected</SettingsStatus> : <span className="wifi-row-signal">{item.signal ?? 'Available'}</span>}
                    </span>
                  </button>
                  {isSelected && selectedPanel}
                </Fragment>
              );
            }) : (
              <p className="settings-empty-state">No Wi-Fi networks found. Select Refresh to scan again.</p>
            )}
          </div>
          {wifiContextMenu && (
            <div className="wifi-context-menu" role="menu" style={{ left: wifiContextMenu.x, top: wifiContextMenu.y }}>
              <strong>{wifiContextMenu.wifi.ssid}</strong>
              <button className="danger" data-settings-action type="button" role="menuitem" disabled={!wifiContextMenu.wifi.saved || networkPending !== null} onClick={() => requestForgetWifi(wifiContextMenu.wifi)}>
                Forget Network
              </button>
            </div>
          )}
          {forgetWifiTarget && !props.inputBlocked && createPortal(
            <div
              className="wifi-confirmation-backdrop"
              role="presentation"
              onPointerDown={(event) => {
                if (event.target === event.currentTarget && networkPending !== 'forget') setForgetWifiTarget(null);
              }}
            >
              <div className="wifi-forget-confirmation settings-confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="wifi-forget-title" aria-describedby="wifi-forget-description">
                <h3 id="wifi-forget-title">Forget this Wi-Fi network?</h3>
                <strong className="settings-dialog-subject">{forgetWifiTarget.ssid}</strong>
                <p id="wifi-forget-description">The saved password will be removed. You will need to enter it again next time.</p>
                <div className="settings-action-row" data-settings-group>
                  <button id="wifi-forget-cancel" data-settings-action type="button" disabled={networkPending === 'forget'} onClick={() => setForgetWifiTarget(null)}>Cancel</button>
                  <button className="danger" data-settings-action type="button" disabled={networkPending === 'forget'} onClick={() => void forgetSelectedWifi()}>
                    {networkPending === 'forget' && <LoaderCircle size={18} className="spin" />}
                    {networkPending === 'forget' ? 'Forgetting...' : 'Forget Network'}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}
        </SettingsDetail>
      );
    }
    if (opened.key === 'controller') {
      const radioLabel = bluetooth.radioState === 'on' ? 'Bluetooth on' : bluetooth.radioState === 'off' ? 'Bluetooth off' : bluetooth.radioState === 'disabled' ? 'Bluetooth disabled' : 'Bluetooth status unknown';
      const pairedControllers = bluetooth.devices.filter((device) => device.controller && device.paired);
      const inputReadyController = pairedControllers.find((device) => device.inputReady);
      const linkedInputInactiveController = pairedControllers.find((device) => device.connected && !device.inputReady);
      const controllerDetected = Boolean(diagnostics?.controller.detected);
      const controllerTitle = controllerDetected
        ? controllerDisplayName(diagnostics?.controller.name) ?? 'Controller active'
        : inputReadyController
          ? `${inputReadyController.name} ready`
          : linkedInputInactiveController
            ? 'Controller input unavailable'
            : pairedControllers.length > 0
              ? 'Controller paired / asleep'
              : 'No controller paired';
      const controllerDetail = controllerDetected
        ? 'Your controller is connected and ready.'
        : inputReadyController
          ? 'Press any button on the controller to start using it.'
          : linkedInputInactiveController
            ? 'Bluetooth is linked, but controller input is not active yet. Keep the controller on, press PS / Home, then select Check Input. NXGS will not disconnect it.'
            : pairedControllers.length > 0
              ? 'Press the controller PS / Home button once to reconnect it.'
              : 'Put the controller in pairing mode, then scan.';
      const controllerWarning = bluetooth.radioState === 'on' && !controllerDetected && pairedControllers.length > 0;
      const radioUnavailable = !bluetooth.supported || bluetooth.radioState === 'off' || bluetooth.radioState === 'disabled' || bluetooth.radioState === 'unsupported';
      const controllerTone: SettingsTone = bluetoothPending === 'scan'
        ? 'info'
        : radioUnavailable
          ? 'warning'
          : controllerDetected || inputReadyController
            ? 'success'
            : controllerWarning || linkedInputInactiveController ? 'warning' : 'neutral';
      const compatibilityStatus = diagnostics?.controllerCompatibility.status ?? 'idle';
      const compatibilityWarning = compatibilityStatus === 'error' || compatibilityStatus === 'driverRequired';
      const compatibilityTitle = diagnostics?.controllerCompatibility.xinputReady
        ? 'Xbox / XInput ready'
        : compatibilityStatus === 'idle'
          ? 'Ready for gameplay'
          : 'Preparing controller bridge';
      const pairingStatusTitle = bluetoothPairingStage === 'pairing'
        ? 'Pairing...'
        : bluetoothPairingStage === 'checking-input'
          ? 'Checking controller input...'
          : bluetoothPairingStage === 'input-required'
            ? 'Controller input not connected'
        : bluetoothPairingStage === 'connected'
          ? 'Connected'
          : bluetoothPairingStage === 'failed'
            ? 'Pairing failed'
            : bluetoothPairingStage === 'staff-approval-required'
              ? 'Staff approval required'
              : 'Confirm pairing';
      const pairingTone: SettingsTone = bluetoothPairingStage === 'pairing' || bluetoothPairingStage === 'checking-input'
        ? 'info'
        : bluetoothPairingStage === 'connected'
          ? 'success'
          : bluetoothPairingStage === 'failed'
            ? 'error'
            : bluetoothPairingStage === 'confirm' ? 'neutral' : 'warning';
      return (
        <SettingsDetail title={opened.label} subtitle={opened.subtitle} onFocus={focusDetail}>
          <SettingsStatusCard
            tone={controllerTone}
            label={bluetoothPending === 'scan' ? 'Searching...' : radioLabel}
            title={controllerTitle}
            detail={controllerDetail}
          />
          <div className="settings-list settings-compatibility">
            <div className="settings-row settings-info-row">
              <span className="settings-row-text">
                <strong>Game compatibility</strong>
                <small>{diagnostics?.controllerCompatibility.message ?? 'Starts automatically when a game launches or resumes.'}</small>
              </span>
              <span className="settings-row-value">
                <SettingsStatus tone={compatibilityWarning ? 'warning' : diagnostics?.controllerCompatibility.xinputReady ? 'success' : 'neutral'}>{compatibilityTitle}</SettingsStatus>
              </span>
            </div>
          </div>
          {bluetoothFeedback && <SettingsNotice tone={bluetoothFeedback.tone} message={bluetoothFeedback.message} />}
          <div className="settings-detail-heading">
            <h3>Bluetooth devices</h3>
            <button className="settings-button" data-settings-action type="button" disabled={bluetoothPending !== null} onClick={() => void refreshBluetooth()}>
              {bluetoothPending === 'scan' && <LoaderCircle size={18} className="spin" />}
              {bluetoothPending === 'scan' ? 'Searching...' : 'Scan for Devices'}
            </button>
          </div>
          <div className="bluetooth-device-list">
            {bluetooth.devices.length > 0 ? bluetooth.devices.map((device) => {
              const pending = bluetoothPending?.endsWith(`:${device.id}`) ?? false;
              const pendingAction = pending ? bluetoothPending?.split(':', 1)[0] : null;
              const launcherInputActive = device.controller && controllerDetected && pairedControllers.length === 1;
              const effectiveConnected = device.connected || device.inputReady || launcherInputActive;
              const inputInactive = device.controller && effectiveConnected && !device.inputReady && !launcherInputActive;
              const shouldDisconnect = effectiveConnected && !inputInactive;
              const label = inputInactive ? 'Check Input' : shouldDisconnect ? 'Disconnect' : device.paired ? 'Reconnect' : 'Pair';
              const status = pendingAction === 'connect'
                ? inputInactive ? 'Checking controller input' : 'Connecting'
                : pendingAction === 'disconnect'
                  ? 'Disconnecting'
                  : pendingAction === 'remove'
                    ? 'Removing'
                    : bluetoothDeviceStatuses[device.id] ?? (
                      launcherInputActive
                        ? 'Controller input active'
                        : device.inputReady
                          ? 'Controller input ready'
                          : inputInactive
                            ? 'Bluetooth linked / input inactive'
                            : effectiveConnected
                              ? 'Connected'
                              : device.paired ? 'Paired / Disconnected' : 'Available'
                    );
              const rowState = launcherInputActive || device.inputReady ? 'connected' : inputInactive ? 'input-inactive' : device.connected ? 'connected' : '';
              const statusTone: SettingsTone = pendingAction
                ? 'info'
                : /failed/i.test(status)
                  ? 'error'
                  : rowState === 'input-inactive' || status === 'Staff approval required' || status.endsWith('input unavailable')
                    ? 'warning'
                    : rowState === 'connected' ? 'success' : 'neutral';
              return (
                <div key={device.id} className={`settings-row bluetooth-device-row${rowState ? ` ${rowState}` : ''}`}>
                  <span className="settings-row-text">
                    <strong>{device.name}</strong>
                    <small><SettingsStatus tone={statusTone}>{status}</SettingsStatus>{device.address && <span className="bluetooth-device-address"> · {device.address}</span>}</small>
                  </span>
                  <div className="bluetooth-device-actions" data-settings-group>
                    <button
                      className={`settings-button${device.paired ? '' : ' primary'}`}
                      data-settings-action
                      type="button"
                      disabled={bluetoothPending !== null || (!device.connectable && !device.paired)}
                      onClick={() => device.paired
                        ? void handleBluetoothDevice(device, shouldDisconnect ? 'disconnect' : 'connect')
                        : requestPairBluetoothDevice(device)}
                    >
                      {pending && pendingAction !== 'remove' && <LoaderCircle size={18} className="spin" />}
                      {pendingAction === 'connect' ? inputInactive ? 'Checking...' : 'Connecting...' : pendingAction === 'disconnect' ? 'Disconnecting...' : label}
                    </button>
                    {device.paired && (
                      <button className="settings-icon-button danger" data-settings-action type="button" aria-label={`Remove ${device.name}`} title="Remove Device" disabled={bluetoothPending !== null} onClick={() => requestRemoveBluetoothDevice(device)}>
                        {pendingAction === 'remove' ? <LoaderCircle size={19} className="spin" /> : <Trash2 size={19} />}
                      </button>
                    )}
                  </div>
                </div>
              );
            }) : (
              <p className="settings-empty-state">No Bluetooth devices found. Put the controller in pairing mode and select Scan for Devices.</p>
            )}
          </div>
          <section className="controller-power-settings" aria-labelledby="controller-power-title">
            <div className="settings-detail-heading">
              <h3 id="controller-power-title">Controller power</h3>
              <small>Bluetooth DualSense controllers only</small>
            </div>
            <div className="settings-list">
              <div className="controller-power-choice">
                <span className="settings-row-text">
                  <strong>Auto turn off controller</strong>
                  <small>Turn idle controllers off to save their battery.</small>
                </span>
                <div className="controller-power-options" role="group" aria-label="Auto turn off controller" data-settings-group>
                  {([0, 5, 10, 15, 30] as const).map((minutes) => {
                    const current = props.settings.controllerIdle.autoTurnOffMinutes === minutes;
                    return (
                      <button
                        data-settings-action
                        type="button"
                        key={minutes}
                        className={current ? 'selected' : ''}
                        aria-pressed={current}
                        disabled={controllerIdlePending}
                        onClick={() => void saveControllerIdle({ ...props.settings.controllerIdle, autoTurnOffMinutes: minutes })}
                      >
                        {minutes === 0 ? 'Never' : `After ${minutes} minutes`}
                      </button>
                    );
                  })}
                </div>
              </div>
              <button
                className={`settings-row controller-warning-toggle ${props.settings.controllerIdle.shutdownWarning ? 'enabled' : ''}`}
                data-settings-action
                type="button"
                role="switch"
                aria-checked={props.settings.controllerIdle.shutdownWarning}
                disabled={controllerIdlePending}
                onClick={() => void saveControllerIdle({ ...props.settings.controllerIdle, shutdownWarning: !props.settings.controllerIdle.shutdownWarning })}
              >
                <span className="settings-row-text"><strong>Controller shutdown warning</strong><small>Show an NXGS notification 30 seconds before turn off</small></span>
                <span className="ps-switch" data-on={props.settings.controllerIdle.shutdownWarning} aria-hidden="true" />
              </button>
            </div>
            {controllerIdleFeedback && <SettingsNotice tone={controllerIdleFeedback.tone} message={controllerIdleFeedback.message} />}
          </section>
          <p className="settings-capability-note">Disconnect keeps the device paired. Removing a device clears its saved pairing, so it must be scanned and paired again. Some device profiles control their own final connection; NXGS will show a clear message when they cannot be disconnected here.</p>
          {bluetoothPairingTarget && !props.inputBlocked && createPortal(
            <div
              className="bluetooth-confirmation-backdrop"
              role="presentation"
              onPointerDown={(event) => {
                if (event.target === event.currentTarget && bluetoothPairingStage !== 'pairing' && bluetoothPairingStage !== 'checking-input') setBluetoothPairingTarget(null);
              }}
            >
              <div
                className={`bluetooth-pairing-confirmation settings-confirmation-dialog ${bluetoothPairingStage}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby="bluetooth-pair-title"
                aria-describedby="bluetooth-pair-description"
              >
                <SettingsStatus tone={pairingTone} className="bluetooth-pairing-state is-plain">Pairing request</SettingsStatus>
                <h3 id="bluetooth-pair-title">
                  {bluetoothPairingStage === 'confirm' ? `Pair ${bluetoothPairingTarget.name}?` : pairingStatusTitle}
                </h3>
                <div className="bluetooth-pairing-device">
                  <span><small>Device name</small><strong>{bluetoothPairingTarget.name}</strong></span>
                  <span><small>Device type</small><strong>{bluetoothPairingTarget.controller ? 'Wireless controller' : 'Bluetooth device'}</strong></span>
                </div>
                <p id="bluetooth-pair-description" role="status">{bluetoothPairingMessage}</p>
                <div className="settings-action-row" data-settings-group>
                  {bluetoothPairingStage === 'connected' ? (
                    <button id="bluetooth-pair-primary" className="primary" data-settings-action type="button" onClick={() => setBluetoothPairingTarget(null)}>
                      Done
                    </button>
                  ) : bluetoothPairingStage === 'staff-approval-required' ? (
                    <button id="bluetooth-pair-primary" data-settings-action type="button" onClick={() => setBluetoothPairingTarget(null)}>Cancel</button>
                  ) : (
                    <>
                      <button
                        id="bluetooth-pair-cancel"
                        data-settings-action
                        type="button"
                        disabled={bluetoothPairingStage === 'pairing' || bluetoothPairingStage === 'checking-input'}
                        onClick={() => setBluetoothPairingTarget(null)}
                      >
                        Cancel
                      </button>
                      <button
                        id="bluetooth-pair-primary"
                        className="primary"
                        data-settings-action
                        data-settings-preferred
                        type="button"
                        disabled={bluetoothPairingStage === 'pairing' || bluetoothPairingStage === 'checking-input'}
                        onClick={() => void confirmPairBluetoothDevice()}
                      >
                        {(bluetoothPairingStage === 'pairing' || bluetoothPairingStage === 'checking-input') && <LoaderCircle size={18} className="spin" />}
                        {bluetoothPairingStage === 'pairing'
                          ? 'Pairing...'
                          : bluetoothPairingStage === 'checking-input'
                            ? 'Checking...'
                            : bluetoothPairingStage === 'input-required'
                              ? 'Check Input'
                              : bluetoothPairingStage === 'failed' ? 'Try again' : 'Pair'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>,
            document.body
          )}
          {removeBluetoothTarget && !props.inputBlocked && createPortal(
            <div
              className="bluetooth-confirmation-backdrop"
              role="presentation"
              onPointerDown={(event) => {
                if (event.target === event.currentTarget && !bluetoothPending?.startsWith('remove:')) setRemoveBluetoothTarget(null);
              }}
            >
              <div className="bluetooth-remove-confirmation settings-confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="bluetooth-remove-title" aria-describedby="bluetooth-remove-description">
                <h3 id="bluetooth-remove-title">Remove this Bluetooth device?</h3>
                <strong className="settings-dialog-subject">{removeBluetoothTarget.name}</strong>
                <p id="bluetooth-remove-description">This removes the saved pairing. You will need to scan and pair the device again to use it later.</p>
                <div className="settings-action-row" data-settings-group>
                  <button id="bluetooth-remove-cancel" data-settings-action type="button" disabled={bluetoothPending?.startsWith('remove:')} onClick={() => setRemoveBluetoothTarget(null)}>Cancel</button>
                  <button className="danger" data-settings-action type="button" disabled={bluetoothPending?.startsWith('remove:')} onClick={() => void confirmRemoveBluetoothDevice()}>
                    {bluetoothPending?.startsWith('remove:') && <LoaderCircle size={18} className="spin" />}
                    {bluetoothPending?.startsWith('remove:') ? 'Removing...' : 'Remove Device'}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}
        </SettingsDetail>
      );
    }
    if (opened.key === 'system') {
      const activeDisplay = display.displays.find((item) => item.id === display.currentDisplayId)
        ?? display.displays.find((item) => item.primary)
        ?? display.displays[0];
      const outputDevice = audio.outputDevices.find((device) => device.isDefault);
      const inputDevice = audio.inputDevices.find((device) => device.isDefault);
      const volumeBusy = audioPending?.startsWith('volume-') ?? false;
      const volumeLocked = audioPending !== null && !volumeBusy;
      const systemRefreshing = displayPending === 'refresh' || audioPending === 'refresh';
      const showHdr = display.hdr.support === 'supported' && display.hdr.controlSupported;
      const brightnessHint = display.brightness.supported
        ? brightnessSyncing
          ? 'Updating brightness...'
          : `${activeDisplay?.primary ? 'Primary display' : 'Active display'}${activeDisplay?.name ? ` · ${activeDisplay.name}` : ''}`
        : display.brightness.message ?? 'Brightness control is not supported on this display.';
      const displaySummary = activeDisplay
        ? [activeDisplay.resolution, activeDisplay.refreshRate ? `${activeDisplay.refreshRate} Hz` : '', `${activeDisplay.scalePercent}% scale`].filter(Boolean).join(' · ')
        : 'Resolution, refresh rate and color output';
      return (
        <SettingsDetail
          title={opened.label}
          subtitle={opened.subtitle}
          onFocus={focusDetail}
          action={(
            <button className="settings-button system-refresh-button" data-settings-action type="button" disabled={displayPending !== null || audioPending !== null} onClick={() => void refreshSystem()}>
              {systemRefreshing && <LoaderCircle size={18} className="spin" />}
              {systemRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          )}
        >
          <div className="system-page">
            <section className="system-section" aria-labelledby="system-display-heading">
              <h3 className="settings-section-heading" id="system-display-heading">Display</h3>
              {displayFeedback && <SettingsNotice tone={displayFeedback.tone} message={displayFeedback.message} />}
              <div className="settings-list">
                <div className={`settings-row system-slider-row${display.brightness.supported ? '' : ' unsupported'}`}>
                  <span className="settings-row-text">
                    <strong>Brightness</strong>
                    <small className={brightnessSyncing ? 'system-inline-status active' : 'system-inline-status'}>{brightnessHint}</small>
                  </span>
                  <span className="system-slider-control">
                    <input
                      data-settings-action
                      data-settings-slider="brightness"
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={displayBrightness}
                      aria-label="Display brightness"
                      aria-valuetext={display.brightness.supported ? `${displayBrightness} percent` : 'Brightness unavailable'}
                      disabled={!display.brightness.supported || displayPending !== null}
                      style={{ background: `linear-gradient(90deg, var(--slider-active) 0%, var(--slider-active) ${displayBrightness}%, var(--slider-track) ${displayBrightness}%)` }}
                      onInput={(event) => applyDisplayBrightness(Number(event.currentTarget.value))}
                    />
                    <strong className="system-slider-value">{display.brightness.supported ? `${displayBrightness}%` : 'Off'}</strong>
                  </span>
                </div>
                <button
                  className="settings-row system-collapsible-heading"
                  data-settings-action
                  type="button"
                  aria-expanded={displayInfoExpanded}
                  aria-controls="system-display-information"
                  onClick={() => setDisplayInfoExpanded((expanded) => !expanded)}
                >
                  <span className="settings-row-text"><strong>Display information</strong><small>{displaySummary}</small></span>
                  <ChevronRight size={22} className={`settings-row-chevron${displayInfoExpanded ? ' expanded' : ''}`} />
                </button>
                {displayInfoExpanded && (
                  <div className="system-information-grid" id="system-display-information">
                    <div><small>Display name</small><strong>{activeDisplay?.name ?? 'Unavailable'}</strong></div>
                    <div><small>Resolution</small><strong>{activeDisplay?.resolution ?? 'Unavailable'}</strong></div>
                    <div><small>Refresh rate</small><strong>{activeDisplay?.refreshRate ? `${activeDisplay.refreshRate} Hz` : 'Unavailable'}</strong></div>
                    <div><small>Scale</small><strong>{activeDisplay ? `${activeDisplay.scalePercent}%` : 'Unavailable'}</strong></div>
                    <div><small>Orientation</small><strong>{activeDisplay?.orientation ?? 'Unavailable'}</strong></div>
                    <div><small>Color output</small><strong>{activeDisplay ? `${activeDisplay.colorDepth}-bit` : 'Unavailable'}</strong></div>
                  </div>
                )}
                {showHdr && (
                  <button className="settings-row system-simple-row" data-settings-action type="button" role="switch" aria-checked={display.hdr.enabled} disabled={displayPending !== null} onClick={() => void toggleHdr()}>
                    <span className="settings-row-text"><strong>HDR</strong><small>{display.hdr.message}</small></span>
                    {displayPending === 'hdr' ? <LoaderCircle size={22} className="spin settings-row-spinner" /> : <span className="ps-switch" data-on={display.hdr.enabled} aria-hidden="true" />}
                  </button>
                )}
              </div>
            </section>

            <section className="system-section" aria-labelledby="system-sound-heading">
              <h3 className="settings-section-heading" id="system-sound-heading">Audio</h3>
              {audioFeedback && <SettingsNotice tone={audioFeedback.tone} message={audioFeedback.message} />}
              <div className="settings-list">
                <div className="settings-row system-slider-row system-volume-row">
                  <span className="settings-row-text">
                    <strong>Volume</strong>
                    <small className={volumeBusy ? 'system-inline-status active' : 'system-inline-status'}>
                      {volumeBusy ? 'Updating volume...' : audio.muted ? 'Muted' : outputDevice?.name ?? audio.currentOutputName ?? 'Default output device'}
                    </small>
                  </span>
                  <span className="system-slider-control system-volume-controls" data-settings-group>
                    <button className="settings-icon-button" data-settings-action type="button" aria-label="Volume down" disabled={volumeLocked || displayVolume <= 0} onClick={() => void applyMasterVolume(displayVolume - 5, 'down')}>
                      {audioPending === 'volume-down' ? <LoaderCircle size={18} className="spin" /> : <Minus size={19} />}
                    </button>
                    <input
                      data-settings-action
                      data-settings-preferred
                      data-settings-slider="volume"
                      aria-label="Master volume"
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={displayVolume}
                      style={{ background: `linear-gradient(90deg, var(--slider-active) 0%, var(--slider-active) ${displayVolume}%, var(--slider-track) ${displayVolume}%)` }}
                      disabled={volumeLocked || !audio.supported}
                      onChange={(event) => setDisplayVolume(Number(event.currentTarget.value))}
                      onPointerUp={(event) => void applyMasterVolume(Number(event.currentTarget.value), 'slider')}
                      onBlur={(event) => {
                        const next = Number(event.currentTarget.value);
                        if (next !== audio.masterVolume && !audioBusy.current) void applyMasterVolume(next, 'slider');
                      }}
                    />
                    <button className="settings-icon-button" data-settings-action type="button" aria-label="Volume up" disabled={volumeLocked || displayVolume >= 100} onClick={() => void applyMasterVolume(displayVolume + 5, 'up')}>
                      {audioPending === 'volume-up' ? <LoaderCircle size={18} className="spin" /> : <Plus size={19} />}
                    </button>
                    <strong className="system-slider-value">{displayVolume}%</strong>
                  </span>
                </div>
                <button
                  className={`settings-row system-mute-button ${audio.muted ? 'active' : ''}`}
                  data-settings-action
                  type="button"
                  role="switch"
                  aria-checked={audio.muted}
                  disabled={audioPending !== null || !audio.supported}
                  onClick={() => void toggleMasterMute()}
                >
                  <span className="settings-row-text">
                    <strong>Mute</strong>
                    <small>{audioPending === 'mute' ? audio.muted ? 'Unmuting...' : 'Muting...' : audio.muted ? 'All sound from this station is muted' : 'Silence all sound from this station'}</small>
                  </span>
                  {audioPending === 'mute' ? <LoaderCircle size={22} className="spin settings-row-spinner" /> : <span className="ps-switch" data-on={audio.muted} aria-hidden="true" />}
                </button>
                <div className="system-current-devices">
                  <div><small>Current output</small><strong>{outputDevice?.name ?? 'No active output'}</strong></div>
                  <div><small>Current microphone</small><strong>{inputDevice?.name ?? 'No active microphone'}</strong><em>{inputDevice ? audio.inputMuted ? 'Muted' : `${audio.inputVolume}% level` : 'Unavailable'}</em></div>
                </div>
              </div>

              <SystemDeviceList title="Output devices" devices={audio.outputDevices} pending={audioPending} onSelect={switchAudioEndpoint} />
              <SystemDeviceList title="Microphones" devices={audio.inputDevices} pending={audioPending} onSelect={switchAudioEndpoint} />
              {!audio.deviceSwitchingSupported && <p className="system-capability-note">Output switching is unavailable on this station. Volume and mute still work.</p>}
            </section>
          </div>
        </SettingsDetail>
      );
    }
    if (opened.key === 'control-room') {
      return (
        <SettingsDetail title={opened.label} subtitle={opened.subtitle} onFocus={focusDetail}>
          <div className="control-room-card">
            <span className="control-room-copy">
              <h3>Admin PIN required</h3>
              <p>Open game management, station controls, diagnostics, and updates.</p>
            </span>
            <button className="settings-button primary" data-settings-action type="button" onClick={props.onControlRoom}>
              Enter Control Room
            </button>
          </div>
          <p className="settings-capability-note">Staff only. Every other setting stays available without a PIN.</p>
        </SettingsDetail>
      );
    }
    if (opened.key === 'guide') {
      return (
        <SettingsDetail title={opened.label} subtitle={opened.subtitle} onFocus={focusDetail}>
          <GuideSettingsPage appVersion={props.appVersion} controllerName={controllerDisplayName(diagnostics?.controller.name)} controllerDetected={Boolean(diagnostics?.controller.detected)} />
        </SettingsDetail>
      );
    }
    return (
      <SettingsDetail title={opened.label} subtitle={opened.subtitle} onFocus={focusDetail}>
        {opened.key === 'accessibility' ? <AccessibilitySettingsPage /> : opened.key === 'users' ? <UsersSettingsPage /> : <StorageSettingsPage />}
      </SettingsDetail>
    );
  }, [applyDisplayBrightness, applyMasterVolume, audio, audioFeedback, audioPending, bluetooth, bluetoothDeviceStatuses, bluetoothFeedback, bluetoothPairingMessage, bluetoothPairingStage, bluetoothPairingTarget, bluetoothPending, brightnessSyncing, confirmPairBluetoothDevice, confirmRemoveBluetoothDevice, controllerIdleFeedback, controllerIdlePending, diagnostics, disconnectNetwork, display, displayBrightness, displayFeedback, displayInfoExpanded, displayPending, displayVolume, forgetSelectedWifi, forgetWifiTarget, handleBluetoothDevice, network, networkFeedback, networkPending, openWifiContextMenu, opened, performWifiConnect, props.appVersion, props.inputBlocked, props.onControlRoom, props.settings.controllerIdle, refreshBluetooth, refreshNetwork, refreshSystem, removeBluetoothTarget, requestForgetWifi, requestPairBluetoothDevice, requestRemoveBluetoothDevice, saveControllerIdle, selectedWifi, selectWifi, showWifiPassword, switchAudioEndpoint, toggleHdr, toggleMasterMute, wifiContextMenu, wifiPassword]);

  const hints: ControllerHint[] = [{ glyph: 'dpad-vertical', label: detailMode ? 'Choose' : 'Navigate' }];
  if (detailMode && opened.key === 'system') hints.push({ glyph: 'dpad-horizontal', label: 'Adjust' });
  hints.push({ glyph: 'cross', label: 'Select' }, { glyph: 'circle', label: detailMode ? 'Categories' : 'Back' });

  return (
    <section className="console-settings-screen">
      <header>
        <button type="button" className="settings-back-button" aria-label="Back" onClick={handleSettingsBack}><ChevronLeft size={24} /></button>
        <div className="settings-header-title"><h1>Settings</h1></div>
        <div className="settings-header-meta"><span>NXGS Play</span><ConsoleClock /></div>
      </header>
      <div className="console-settings-layout">
        <nav aria-label="Console settings categories">
          {SETTINGS_ITEMS.map((item, index) => {
            const highlighted = index === selectedIndex;
            return (
              <button
                data-index={index}
                key={item.key}
                type="button"
                className={highlighted ? detailMode ? 'selected' : 'selected focused' : ''}
                aria-current={index === openedIndex ? 'page' : undefined}
                onMouseEnter={() => previewSettingsIndex(index)}
                onFocus={() => {
                  if (!detailMode) previewSettingsIndex(index);
                }}
                onClick={() => {
                  previewSettingsIndex(index);
                  if (item.key === 'control-room') props.onControlRoom();
                  else {
                    setOpenedIndex(index);
                    hydrateSettingsPage(item.key, true);
                    enterDetail();
                  }
                }}
              >
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <Fragment key={opened.key}>{detail}</Fragment>
      </div>
      <footer><ControllerHints hints={hints} /></footer>
    </section>
  );
}

function SettingsDetail(props: { title: string; subtitle: string; children: ReactNode; action?: ReactNode; onFocus?: () => void }): JSX.Element {
  return (
    <article className="console-settings-detail" onFocusCapture={props.onFocus}>
      <div className="settings-detail-title">
        <div className="settings-detail-name"><h2>{props.title}</h2><span>{props.subtitle}</span></div>
        {props.action && <div className="settings-title-action">{props.action}</div>}
      </div>
      {props.children}
    </article>
  );
}

function SystemDeviceList(props: { title: string; devices: AudioDeviceSummary[]; pending: string | null; onSelect: (device: AudioDeviceSummary) => Promise<void> }): JSX.Element {
  return (
    <section className="system-device-section">
      <div className="system-device-heading"><h4>{props.title}</h4><em>{props.devices.length}</em></div>
      <div className="system-device-list">
        {props.devices.length > 0 ? props.devices.map((device) => {
          const switching = props.pending === `switch:${device.id}`;
          return (
            <div key={device.id} className={`settings-row system-device-row${device.isDefault ? ' current' : ''}`}>
              <span className="settings-row-text"><strong>{device.name}</strong><small>{device.isDefault ? device.kind === 'output' ? 'Current output' : 'Current microphone' : 'Available device'} · {device.muted ? 'Muted' : `${device.volume}%${device.kind === 'input' ? ' level' : ''}`}</small></span>
              {device.isDefault ? <span className="settings-row-value"><SettingsStatus tone="success" className="system-current-badge">Current</SettingsStatus></span> : (
                <button className="settings-button" data-settings-action type="button" disabled={props.pending !== null} onClick={() => void props.onSelect(device)}>
                  {switching && <LoaderCircle size={18} className="spin" />}
                  {switching ? 'Switching...' : device.kind === 'output' ? 'Use Output' : 'Use Input'}
                </button>
              )}
            </div>
          );
        }) : <p className="settings-empty-state">No audio devices were found.</p>}
      </div>
    </section>
  );
}
