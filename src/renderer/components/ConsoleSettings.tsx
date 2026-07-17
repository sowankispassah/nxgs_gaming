import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Accessibility,
  Bluetooth,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Gamepad2,
  Globe2,
  HardDrive,
  Headphones,
  Info,
  LoaderCircle,
  Lock,
  LockKeyhole,
  Mic2,
  Minus,
  Monitor,
  Maximize2,
  Palette,
  RefreshCw,
  Scaling,
  Search,
  Settings,
  Smartphone,
  Plus,
  Trash2,
  Unplug,
  Users,
  Wifi,
  WifiOff,
  Volume2,
  VolumeX
} from 'lucide-react';
import type {
  AppDiagnostics,
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
type BluetoothPairingStage = 'confirm' | 'pairing' | 'connected' | 'failed' | 'staff-approval-required';

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

const SETTINGS_ITEMS: Array<{ key: SettingsKey; label: string; icon: JSX.Element }> = [
  { key: 'guide', label: 'Guide & Tips / Info', icon: <BookOpen size={25} /> },
  { key: 'accessibility', label: 'Accessibility', icon: <Accessibility size={25} /> },
  { key: 'network', label: 'Network', icon: <Globe2 size={25} /> },
  { key: 'controller', label: 'Bluetooth / Controller', icon: <Bluetooth size={25} /> },
  { key: 'users', label: 'Users and Accounts', icon: <Users size={25} /> },
  { key: 'system', label: 'System', icon: <Settings size={25} /> },
  { key: 'storage', label: 'Storage', icon: <HardDrive size={25} /> },
  { key: 'control-room', label: 'Control Room', icon: <Lock size={25} /> }
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

function focusableDetailActions(): HTMLElement[] {
  const confirmation = document.querySelector<HTMLElement>('.settings-confirmation-dialog');
  const contextMenu = document.querySelector<HTMLElement>('.wifi-context-menu');
  const scope = confirmation ?? contextMenu ?? document.querySelector<HTMLElement>('.console-settings-detail');
  if (!scope) return [];
  return Array.from(scope.querySelectorAll<HTMLElement>('[data-settings-action]'))
    .filter((element) => !element.hasAttribute('disabled') && element.getClientRects().length > 0);
}

export function ConsoleSettings(props: { inputBlocked: boolean; onBack: () => void; onControlRoom: () => void }): JSX.Element {
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
  const audioActionStartedAt = useRef(0);
  const displayActionStartedAt = useRef(0);
  const selectedIndexRef = useRef(0);
  const brightnessTarget = useRef<number | null>(null);
  const brightnessFlushActive = useRef(false);
  const selected = SETTINGS_ITEMS[selectedIndex];
  const opened = SETTINGS_ITEMS[openedIndex];

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
    const active = document.activeElement;
    if (!(active instanceof HTMLInputElement)) return false;
    if (active.dataset.settingsSlider === 'volume') {
      const next = Math.max(0, Math.min(100, displayVolume + direction * 5));
      void applyMasterVolume(next, direction > 0 ? 'up' : 'down');
      return true;
    }
    if (active.dataset.settingsSlider === 'brightness') {
      applyDisplayBrightness(displayBrightness + direction * 5);
      return true;
    }
    return false;
  }, [applyDisplayBrightness, applyMasterVolume, displayBrightness, displayVolume]);

  const previewSettingsIndex = useCallback((index: number): void => {
    selectedIndexRef.current = index;
    setSelectedIndex(index);
    setOpenedIndex(index);
    setDetailMode(false);
  }, []);

  const moveSettingsPreview = useCallback((direction: -1 | 1): void => {
    const next = (selectedIndexRef.current + direction + SETTINGS_ITEMS.length) % SETTINGS_ITEMS.length;
    previewSettingsIndex(next);
  }, [previewSettingsIndex]);

  const enterDetail = useCallback((): void => {
    setDetailMode(true);
    window.setTimeout(() => focusableDetailActions()[0]?.focus(), 0);
  }, []);

  const leaveDetail = useCallback((): void => {
    previewSettingsIndex(openedIndex);
    (document.querySelector<HTMLElement>(`.console-settings-layout > nav button[data-index="${openedIndex}"]`))?.focus();
  }, [openedIndex, previewSettingsIndex]);

  const handleSettingsBack = useCallback((): void => {
    if (forgetWifiTarget || wifiContextMenu || removeBluetoothTarget || bluetoothPairingTarget) {
      if (bluetoothPairingStage === 'pairing') return;
      setForgetWifiTarget(null);
      setWifiContextMenu(null);
      setRemoveBluetoothTarget(null);
      setBluetoothPairingTarget(null);
      return;
    }
    if (selectedWifi) {
      setSelectedWifi(null);
      setWifiPassword('');
      setShowWifiPassword(false);
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
    const actions = focusableDetailActions();
    if (actions.length === 0) return;
    const current = actions.indexOf(document.activeElement as HTMLElement);
    actions[(current + direction + actions.length) % actions.length]?.focus();
  }, []);

  const activateSelected = useCallback((): void => {
    const index = selectedIndexRef.current;
    const key = SETTINGS_ITEMS[index].key;
    if (key === 'control-room') props.onControlRoom();
    else {
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
        if (backRequested) {
          event.preventDefault();
          event.stopImmediatePropagation();
          handleSettingsBack();
          return;
        }
        if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && adjustFocusedSlider(event.key === 'ArrowRight' ? 1 : -1)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          event.stopImmediatePropagation();
          moveDetailFocus(event.key === 'ArrowUp' ? -1 : 1);
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          event.stopImmediatePropagation();
          leaveDetail();
        } else if (event.key === 'Enter' && document.activeElement instanceof HTMLButtonElement) {
          event.preventDefault();
          event.stopImmediatePropagation();
          document.activeElement.click();
        }
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'ArrowUp') moveSettingsPreview(-1);
      else if (event.key === 'ArrowDown') moveSettingsPreview(1);
      else if (event.key === 'Enter' || event.key === 'ArrowRight') activateSelected();
      else handleSettingsBack();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [activateSelected, adjustFocusedSlider, detailMode, handleSettingsBack, leaveDetail, moveDetailFocus, moveSettingsPreview, props.inputBlocked]);

  const handleSettingsControllerEvent = useCallback((event: ControllerNavigationEvent): void => {
    if (event.type === 'back') {
      handleSettingsBack();
      void window.nxgs.reportControllerState({ detected: true, name: event.pad.id, homeSupported: event.pad.buttons.length > 16 ? 'unknown' : 'no', lastButtonPressed: 'Circle / B', lastNavigationAction: 'Settings: back' });
      return;
    }
    if (event.type === 'accept') {
      if (detailMode) {
        const active = document.activeElement;
        if (active instanceof HTMLButtonElement) active.click();
      } else {
        activateSelected();
      }
      void window.nxgs.reportControllerState({ detected: true, name: event.pad.id, homeSupported: event.pad.buttons.length > 16 ? 'unknown' : 'no', lastButtonPressed: 'X / A', lastNavigationAction: `Settings: select ${selected.label}` });
      return;
    }

    if (detailMode) {
      const sliderFocused =
        document.activeElement instanceof HTMLInputElement &&
        ['volume', 'brightness'].includes(document.activeElement.dataset.settingsSlider ?? '');
      if (sliderFocused && event.direction === 'left') adjustFocusedSlider(-1);
      else if (sliderFocused && event.direction === 'right') adjustFocusedSlider(1);
      else if (event.direction === 'up') moveDetailFocus(-1);
      else if (event.direction === 'down') moveDetailFocus(1);
      else if (event.direction === 'left') {
        if (forgetWifiTarget || wifiContextMenu || removeBluetoothTarget || bluetoothPairingTarget) {
          if (bluetoothPairingStage === 'pairing') return;
          setForgetWifiTarget(null);
          setWifiContextMenu(null);
          setRemoveBluetoothTarget(null);
          setBluetoothPairingTarget(null);
        } else {
          leaveDetail();
        }
      }
      return;
    }

    if (event.direction === 'up') {
      moveSettingsPreview(-1);
    } else if (event.direction === 'down') {
      moveSettingsPreview(1);
    } else if (event.direction === 'right') {
      activateSelected();
    }
  }, [activateSelected, adjustFocusedSlider, bluetoothPairingStage, bluetoothPairingTarget, detailMode, forgetWifiTarget, handleSettingsBack, leaveDetail, moveDetailFocus, moveSettingsPreview, removeBluetoothTarget, selected.label, wifiContextMenu]);

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
    } else {
      window.setTimeout(() => document.querySelector<HTMLElement>('#selected-wifi-primary-action')?.focus(), 0);
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
    setSelectedWifi(wifi);
    setWifiPassword('');
    setWifiContextMenu({
      wifi,
      x: Math.max(scrollLeft + 8, Math.min(x, maxX)),
      y: Math.max(scrollTop + 8, Math.min(y, maxY))
    });
    window.setTimeout(() => document.querySelector<HTMLButtonElement>('.wifi-context-menu [role="menuitem"]')?.focus(), 0);
  }, []);

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
    setWifiContextMenu(null);
    setForgetWifiTarget(wifi);
    window.setTimeout(() => document.querySelector<HTMLButtonElement>('#wifi-forget-cancel')?.focus(), 0);
  }, []);

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
      setBluetoothFeedback({ tone: result.ok ? result.status === 'paired' ? 'warning' : 'success' : 'error', message: result.message });
      setBluetoothDeviceStatuses((current) => ({
        ...current,
        [device.id]: result.ok
          ? result.status === 'connected'
            ? device.controller ? 'Controller input ready' : 'Connected'
            : device.controller ? 'Paired / press PS or Home' : 'Paired / Disconnected'
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
    setBluetoothPairingTarget(device);
    setBluetoothPairingStage('confirm');
    setBluetoothPairingMessage('Confirm pairing to connect this device with NXGS.');
    setBluetoothFeedback(null);
    window.setTimeout(() => document.querySelector<HTMLButtonElement>('#bluetooth-pair-primary')?.focus(), 0);
  }, []);

  const confirmPairBluetoothDevice = useCallback(async (): Promise<void> => {
    if (!bluetoothPairingTarget || bluetoothBusy.current) return;
    const target = bluetoothPairingTarget;
    bluetoothBusy.current = true;
    bluetoothActionStartedAt.current = Date.now();
    setBluetoothPending(`pair:${target.id}`);
    setBluetoothPairingStage('pairing');
    setBluetoothPairingMessage('Pairing... Keep the controller awake and in pairing mode.');
    setBluetoothFeedback({ tone: 'info', message: `Pairing ${target.name}...` });
    try {
      const result = await window.nxgs.pairBluetoothDevice({ device: target, bluetooth, fastPairing: true });
      commitBluetooth(result.bluetooth);
      setBluetoothPairingMessage(result.message);
      setBluetoothFeedback({
        tone: result.ok ? result.status === 'paired' ? 'warning' : 'success' : result.status === 'staff-approval-required' ? 'warning' : 'error',
        message: result.message
      });
      setBluetoothDeviceStatuses((current) => ({
        ...current,
        [target.id]: result.ok
          ? result.status === 'connected' ? target.controller ? 'Controller input ready' : 'Connected' : 'Pairing complete'
          : result.status === 'staff-approval-required' ? 'Staff approval required' : 'Pairing failed'
      }));
      setBluetoothPairingStage(
        result.ok ? 'connected' : result.status === 'staff-approval-required' ? 'staff-approval-required' : 'failed'
      );
      if (result.ok) window.setTimeout(() => void refreshBluetoothStatus(), 1800);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Pairing failed. Try again.';
      setBluetoothPairingStage('failed');
      setBluetoothPairingMessage(message);
      setBluetoothFeedback({ tone: 'error', message });
      setBluetoothDeviceStatuses((current) => ({ ...current, [target.id]: 'Pairing failed' }));
    } finally {
      bluetoothBusy.current = false;
      setBluetoothPending(null);
      window.setTimeout(() => document.querySelector<HTMLButtonElement>('#bluetooth-pair-primary')?.focus(), 0);
    }
  }, [bluetooth, bluetoothPairingTarget, commitBluetooth, refreshBluetoothStatus]);

  const requestRemoveBluetoothDevice = useCallback((device: BluetoothDeviceSummary): void => {
    if (!device.paired || bluetoothBusy.current) return;
    setRemoveBluetoothTarget(device);
    window.setTimeout(() => document.querySelector<HTMLButtonElement>('#bluetooth-remove-cancel')?.focus(), 0);
  }, []);

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
    if (opened.key === 'network') {
      const selectedConnected = Boolean(selectedWifi && network.connected && network.ssid === selectedWifi.ssid);
      const selectedNeedsPassword = Boolean(selectedWifi?.requiresPassword && !selectedWifi.saved && !selectedConnected);
      const connectedLabel = networkPending === 'connect'
        ? 'Connecting...'
        : network.connected
          ? network.connectivity === 'internet' ? 'Connected' : 'No internet / limited connection'
          : 'Not connected';
      return (
        <SettingsDetail title="Network" icon={<Wifi size={34} />} subtitle="Switch Wi-Fi without leaving NXGS" onFocus={() => setDetailMode(true)}>
          <div className={`settings-status-card ${network.connected && network.connectivity !== 'internet' ? 'warning' : ''}`}>
            <span>{connectedLabel}</span>
            <strong>{network.ssid ?? network.interfaceName ?? 'Wi-Fi'}</strong>
            <small>{network.signal ? `Signal ${network.signal}` : network.message ?? 'Choose a network below.'}</small>
          </div>
          {networkFeedback && <div className={`settings-feedback ${networkFeedback.tone}`} role="status">{networkFeedback.message}</div>}
          <div className="settings-detail-heading">
            <h3>Available networks</h3>
            <button data-settings-action type="button" disabled={networkPending !== null} onClick={() => void refreshNetwork()}>
              <RefreshCw size={18} className={networkPending === 'refresh' ? 'spin' : ''} />
              {networkPending === 'refresh' ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
          {selectedWifi && (
            <div className="wifi-selected-panel">
              <div className="wifi-selected-title">
                {selectedConnected ? <CheckCircle2 size={24} /> : <Wifi size={24} />}
                <span><small>Selected network</small><strong>{selectedWifi.ssid}</strong></span>
                <span className={selectedConnected ? 'connected' : ''}>{selectedConnected ? 'Connected' : selectedWifi.saved ? 'Saved' : 'Available'}</span>
              </div>
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
                    <button data-settings-action type="button" disabled={networkPending !== null} aria-label={showWifiPassword ? 'Hide password' : 'Show password'} onClick={() => setShowWifiPassword((shown) => !shown)}>
                      {showWifiPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                    </button>
                  </div>
                </div>
              )}
              <div className="settings-action-row">
                {selectedConnected ? (
                  <button id="selected-wifi-primary-action" data-settings-action type="button" disabled={networkPending !== null} onClick={() => void disconnectNetwork()}>
                    {networkPending === 'disconnect' ? <LoaderCircle size={17} className="spin" /> : <WifiOff size={17} />}
                    {networkPending === 'disconnect' ? 'Disconnecting...' : 'Disconnect'}
                  </button>
                ) : (
                  <button id="selected-wifi-primary-action" data-settings-action type="button" disabled={networkPending !== null || (selectedNeedsPassword && !wifiPassword)} onClick={() => void performWifiConnect(selectedWifi, selectedNeedsPassword ? wifiPassword : undefined)}>
                    {networkPending === 'connect' ? <LoaderCircle size={17} className="spin" /> : <Wifi size={17} />}
                    {networkPending === 'connect' ? 'Connecting...' : 'Connect'}
                  </button>
                )}
                {selectedWifi.saved && (
                  <button className="danger" data-settings-action type="button" disabled={networkPending !== null} onClick={() => requestForgetWifi(selectedWifi)}>
                    <Trash2 size={17} /> Forget Network
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="wifi-network-list">
            {network.availableNetworks.length > 0 ? network.availableNetworks.map((item) => {
              const connected = network.connected && network.ssid === item.ssid;
              const isSelected = selectedWifi?.ssid === item.ssid;
              return (
                <button
                  data-settings-action
                  key={item.ssid}
                  type="button"
                  disabled={networkPending !== null}
                  aria-pressed={isSelected}
                  aria-haspopup="menu"
                  className={`${connected ? 'connected ' : ''}${isSelected ? 'selected' : ''}`.trim()}
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
                  {connected ? <CheckCircle2 size={20} /> : <Wifi size={20} />}
                  <span><strong>{item.ssid}</strong><small>{item.security ?? 'Open network'}{item.saved ? ' · Saved' : ''}</small></span>
                  <span>{connected ? 'Connected' : item.signal ?? 'Available'}</span>
                  {item.requiresPassword && <LockKeyhole size={16} />}
                </button>
              );
            }) : <p className="settings-placeholder">No Wi-Fi networks found. Select Refresh to scan again.</p>}
          </div>
          {wifiContextMenu && (
            <div className="wifi-context-menu" role="menu" style={{ left: wifiContextMenu.x, top: wifiContextMenu.y }}>
              <strong>{wifiContextMenu.wifi.ssid}</strong>
              <button className="danger" data-settings-action type="button" role="menuitem" disabled={!wifiContextMenu.wifi.saved || networkPending !== null} onClick={() => requestForgetWifi(wifiContextMenu.wifi)}>
                <Trash2 size={17} /> Forget Network
              </button>
            </div>
          )}
          {forgetWifiTarget && (
            <div
              className="wifi-confirmation-backdrop"
              role="presentation"
              onPointerDown={(event) => {
                if (event.target === event.currentTarget && networkPending !== 'forget') setForgetWifiTarget(null);
              }}
            >
              <div className="wifi-forget-confirmation settings-confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="wifi-forget-title" aria-describedby="wifi-forget-description">
                <Trash2 size={30} />
                <h3 id="wifi-forget-title">Forget this Wi-Fi network?</h3>
                <strong>{forgetWifiTarget.ssid}</strong>
                <p id="wifi-forget-description">The saved password will be removed. You will need to enter it again next time.</p>
                <div className="settings-action-row">
                  <button id="wifi-forget-cancel" data-settings-action type="button" disabled={networkPending === 'forget'} onClick={() => setForgetWifiTarget(null)}>Cancel</button>
                  <button className="danger" data-settings-action type="button" disabled={networkPending === 'forget'} onClick={() => void forgetSelectedWifi()}>
                    {networkPending === 'forget' ? <LoaderCircle size={17} className="spin" /> : <Trash2 size={17} />}
                    {networkPending === 'forget' ? 'Forgetting...' : 'Forget Network'}
                  </button>
                </div>
              </div>
            </div>
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
        ? diagnostics?.controller.name ?? 'Controller active'
        : inputReadyController
          ? `${inputReadyController.name} ready`
          : linkedInputInactiveController
            ? 'Controller input unavailable'
            : pairedControllers.length > 0
              ? 'Controller paired / asleep'
              : 'No controller paired';
      const controllerDetail = controllerDetected
        ? 'Controller input is active in the launcher.'
        : inputReadyController
          ? 'Controller input is ready. Press any controller button to activate launcher navigation.'
          : linkedInputInactiveController
            ? 'Bluetooth is linked, but controller input is not active yet. Keep the controller on, press PS / Home, then select Check Input. NXGS will not disconnect it.'
            : pairedControllers.length > 0
              ? 'Press the controller PS / Home button once to reconnect it.'
              : 'Put the controller in pairing mode, then scan.';
      const controllerWarning = bluetooth.radioState === 'on' && !controllerDetected && pairedControllers.length > 0;
      const compatibilityStatus = diagnostics?.controllerCompatibility.status ?? 'idle';
      const compatibilityWarning = compatibilityStatus === 'error' || compatibilityStatus === 'driverRequired';
      const compatibilityTitle = diagnostics?.controllerCompatibility.xinputReady
        ? 'Xbox / XInput ready'
        : compatibilityStatus === 'idle'
          ? 'Ready for gameplay'
          : 'Preparing controller bridge';
      const pairingStatusTitle = bluetoothPairingStage === 'pairing'
        ? 'Pairing...'
        : bluetoothPairingStage === 'connected'
          ? 'Pairing complete'
          : bluetoothPairingStage === 'failed'
            ? 'Pairing failed'
            : bluetoothPairingStage === 'staff-approval-required'
              ? 'Staff approval required'
              : 'Confirm pairing';
      return (
        <SettingsDetail title="Bluetooth / Controller" icon={<Gamepad2 size={34} />} subtitle="Find and pair devices inside NXGS" onFocus={() => setDetailMode(true)}>
          <div className={`settings-status-card ${bluetooth.radioState !== 'on' || controllerWarning ? 'warning' : ''}`}>
            <span>{bluetoothPending === 'scan' ? 'Searching...' : radioLabel}</span>
            <strong>{controllerTitle}</strong>
            <small>{controllerDetail}</small>
          </div>
          <div className={`settings-status-card ${compatibilityWarning ? 'warning' : ''}`}>
            <span>Game compatibility</span>
            <strong>{compatibilityTitle}</strong>
            <small>{diagnostics?.controllerCompatibility.message ?? 'Starts automatically when a game launches or resumes.'}</small>
          </div>
          {bluetoothFeedback && <div className={`settings-feedback ${bluetoothFeedback.tone}`} role="status">{bluetoothFeedback.message}</div>}
          <div className="settings-detail-heading">
            <h3>Bluetooth devices</h3>
            <button data-settings-action type="button" disabled={bluetoothPending !== null} onClick={() => void refreshBluetooth()}>
              {bluetoothPending === 'scan' ? <LoaderCircle size={18} className="spin" /> : <Search size={18} />}
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
              return (
                <div key={device.id} className={launcherInputActive || device.inputReady ? 'connected' : inputInactive ? 'input-inactive' : device.connected ? 'connected' : ''}>
                  <Bluetooth size={21} />
                  <span><strong>{device.name}</strong><small>{status}{device.address ? ` · ${device.address}` : ''}</small></span>
                  <div className="bluetooth-device-actions">
                    <button
                      data-settings-action
                      type="button"
                      disabled={bluetoothPending !== null || (!device.connectable && !device.paired)}
                      onClick={() => device.paired
                        ? void handleBluetoothDevice(device, shouldDisconnect ? 'disconnect' : 'connect')
                        : requestPairBluetoothDevice(device)}
                    >
                      {pending && pendingAction !== 'remove' ? <LoaderCircle size={17} className="spin" /> : shouldDisconnect ? <Unplug size={17} /> : <Bluetooth size={17} />}
                      {pendingAction === 'connect' ? inputInactive ? 'Checking...' : 'Connecting...' : pendingAction === 'disconnect' ? 'Disconnecting...' : label}
                    </button>
                    {device.paired && (
                      <button className="danger" data-settings-action type="button" aria-label={`Remove ${device.name}`} disabled={bluetoothPending !== null} onClick={() => requestRemoveBluetoothDevice(device)}>
                        {pendingAction === 'remove' ? <LoaderCircle size={17} className="spin" /> : <Trash2 size={17} />}
                        Remove Device
                      </button>
                    )}
                  </div>
                </div>
              );
            }) : <p className="settings-placeholder">No Bluetooth devices found. Put the controller in pairing mode and select Scan for Devices.</p>}
          </div>
          <p className="settings-capability-note">Disconnect keeps the device paired. Remove Device clears the saved pairing, so the device must be scanned and paired again. Some device profiles control their own final connection; NXGS will show a clear message when they cannot be disconnected here.</p>
          {bluetoothPairingTarget && createPortal(
            <div
              className="bluetooth-confirmation-backdrop"
              role="presentation"
              onPointerDown={(event) => {
                if (event.target === event.currentTarget && bluetoothPairingStage !== 'pairing') setBluetoothPairingTarget(null);
              }}
            >
              <div
                className={`bluetooth-pairing-confirmation settings-confirmation-dialog ${bluetoothPairingStage}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby="bluetooth-pair-title"
                aria-describedby="bluetooth-pair-description"
              >
                <div className="bluetooth-pairing-icon" aria-hidden="true">
                  {bluetoothPairingStage === 'pairing'
                    ? <LoaderCircle size={34} className="spin" />
                    : bluetoothPairingStage === 'connected'
                      ? <CheckCircle2 size={34} />
                      : bluetoothPairingStage === 'staff-approval-required'
                        ? <LockKeyhole size={34} />
                        : <Gamepad2 size={34} />}
                </div>
                <span className="bluetooth-pairing-eyebrow">Pairing request</span>
                <h3 id="bluetooth-pair-title">
                  {bluetoothPairingStage === 'confirm' ? `Pair ${bluetoothPairingTarget.name}?` : pairingStatusTitle}
                </h3>
                <div className="bluetooth-pairing-device">
                  <span><small>Device name</small><strong>{bluetoothPairingTarget.name}</strong></span>
                  <span><small>Device type</small><strong>{bluetoothPairingTarget.controller ? 'Wireless controller' : 'Bluetooth device'}</strong></span>
                </div>
                <p id="bluetooth-pair-description" role="status">{bluetoothPairingMessage}</p>
                <div className="settings-action-row">
                  {bluetoothPairingStage === 'connected' ? (
                    <button id="bluetooth-pair-primary" className="primary" data-settings-action type="button" onClick={() => setBluetoothPairingTarget(null)}>
                      <CheckCircle2 size={17} />Done
                    </button>
                  ) : bluetoothPairingStage === 'staff-approval-required' ? (
                    <button id="bluetooth-pair-primary" data-settings-action type="button" onClick={() => setBluetoothPairingTarget(null)}>Cancel</button>
                  ) : (
                    <>
                      <button
                        id="bluetooth-pair-cancel"
                        data-settings-action
                        type="button"
                        disabled={bluetoothPairingStage === 'pairing'}
                        onClick={() => setBluetoothPairingTarget(null)}
                      >
                        Cancel
                      </button>
                      <button
                        id="bluetooth-pair-primary"
                        className="primary"
                        data-settings-action
                        type="button"
                        disabled={bluetoothPairingStage === 'pairing'}
                        onClick={() => void confirmPairBluetoothDevice()}
                      >
                        {bluetoothPairingStage === 'pairing'
                          ? <LoaderCircle size={17} className="spin" />
                          : bluetoothPairingStage === 'failed'
                            ? <RefreshCw size={17} />
                            : <Bluetooth size={17} />}
                        {bluetoothPairingStage === 'pairing' ? 'Pairing...' : bluetoothPairingStage === 'failed' ? 'Try again' : 'Pair'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>,
            document.body
          )}
          {removeBluetoothTarget && (
            <div
              className="bluetooth-confirmation-backdrop"
              role="presentation"
              onPointerDown={(event) => {
                if (event.target === event.currentTarget && !bluetoothPending?.startsWith('remove:')) setRemoveBluetoothTarget(null);
              }}
            >
              <div className="bluetooth-remove-confirmation settings-confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="bluetooth-remove-title" aria-describedby="bluetooth-remove-description">
                <Trash2 size={30} />
                <h3 id="bluetooth-remove-title">Remove this Bluetooth device?</h3>
                <strong>{removeBluetoothTarget.name}</strong>
                <p id="bluetooth-remove-description">This removes the saved pairing. You will need to scan and pair the device again to use it later.</p>
                <div className="settings-action-row">
                  <button id="bluetooth-remove-cancel" data-settings-action type="button" disabled={bluetoothPending?.startsWith('remove:')} onClick={() => setRemoveBluetoothTarget(null)}>Cancel</button>
                  <button className="danger" data-settings-action type="button" disabled={bluetoothPending?.startsWith('remove:')} onClick={() => void confirmRemoveBluetoothDevice()}>
                    {bluetoothPending?.startsWith('remove:') ? <LoaderCircle size={17} className="spin" /> : <Trash2 size={17} />}
                    {bluetoothPending?.startsWith('remove:') ? 'Removing...' : 'Remove Device'}
                  </button>
                </div>
              </div>
            </div>
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
      const systemRefreshing = displayPending === 'refresh' || audioPending === 'refresh';
      const hdrLabel = display.hdr.enabled ? 'On' : 'Off';
      const showHdr = display.hdr.support === 'supported' && display.hdr.controlSupported;
      return (
        <SettingsDetail
          title="System"
          icon={<Settings size={34} />}
          subtitle="Display and audio controls"
          onFocus={() => setDetailMode(true)}
          action={(
            <button className="system-refresh-button" data-settings-action type="button" disabled={displayPending !== null || audioPending !== null} onClick={() => void refreshSystem()}>
              {systemRefreshing ? <LoaderCircle size={18} className="spin" /> : <RefreshCw size={18} />}
              {systemRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          )}
        >
          <div className="system-page">
            <section className="system-section" aria-labelledby="system-display-heading">
              <div className="system-section-title">
                <Monitor size={31} />
                <div><span>Display controls</span><h3 id="system-display-heading">Display</h3></div>
              </div>
              {displayFeedback && <div className={`settings-feedback ${displayFeedback.tone}`} role="status">{displayFeedback.message}</div>}

              <div className="system-primary-display">
                <span>{activeDisplay?.primary ? 'Primary display' : 'Active display'}</span>
                <strong>{activeDisplay?.name ?? 'Active display'}</strong>
              </div>

              <div className={`system-slider-card ${display.brightness.supported ? '' : 'unsupported'}`}>
                <div className="system-control-label"><span>Brightness</span><strong>{display.brightness.supported ? `${displayBrightness}%` : 'Unavailable'}</strong></div>
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
                <small className={brightnessSyncing ? 'system-inline-status active' : 'system-inline-status'}>
                  {display.brightness.supported
                    ? brightnessSyncing ? 'Updating brightness...' : 'Use left/right or drag the slider'
                    : display.brightness.message ?? 'Brightness control is not supported on this display.'}
                </small>
              </div>

              <button
                className="system-collapsible-heading"
                data-settings-action
                type="button"
                aria-expanded={displayInfoExpanded}
                aria-controls="system-display-information"
                onClick={() => setDisplayInfoExpanded((expanded) => !expanded)}
              >
                <span>Display information</span>
                <ChevronRight size={20} className={displayInfoExpanded ? 'expanded' : ''} />
              </button>
              {displayInfoExpanded && (
                <div className="system-information-grid" id="system-display-information">
                  <div><span className="system-info-icon"><Monitor size={20} /></span><span><small>Display name</small><strong>{activeDisplay?.name ?? 'Unavailable'}</strong></span></div>
                  <div><span className="system-info-icon"><Maximize2 size={20} /></span><span><small>Resolution</small><strong>{activeDisplay?.resolution ?? 'Unavailable'}</strong></span></div>
                  <div><span className="system-info-icon"><RefreshCw size={20} /></span><span><small>Refresh rate</small><strong>{activeDisplay?.refreshRate ? `${activeDisplay.refreshRate} Hz` : 'Unavailable'}</strong></span></div>
                  <div><span className="system-info-icon"><Scaling size={20} /></span><span><small>Scale</small><strong>{activeDisplay ? `${activeDisplay.scalePercent}%` : 'Unavailable'}</strong></span></div>
                  <div><span className="system-info-icon"><Smartphone size={20} /></span><span><small>Orientation</small><strong>{activeDisplay?.orientation ?? 'Unavailable'}</strong></span></div>
                  <div><span className="system-info-icon"><Palette size={20} /></span><span><small>Color output</small><strong>{activeDisplay ? `${activeDisplay.colorDepth}-bit` : 'Unavailable'}</strong></span></div>
                </div>
              )}

              {showHdr && (
                <button className="system-simple-row" data-settings-action type="button" disabled={displayPending !== null} onClick={() => void toggleHdr()}>
                  <span><Monitor size={20} /><span><strong>HDR</strong><small>{display.hdr.message}</small></span></span>
                  <em>{displayPending === 'hdr' ? <LoaderCircle size={18} className="spin" /> : hdrLabel}</em>
                </button>
              )}
            </section>

            <section className="system-section" aria-labelledby="system-sound-heading">
              <div className="system-section-title">
                {audio.muted ? <VolumeX size={31} /> : <Volume2 size={31} />}
                <div><span>Audio controls</span><h3 id="system-sound-heading">Audio</h3></div>
              </div>
              {audioFeedback && <div className={`settings-feedback ${audioFeedback.tone}`} role="status">{audioFeedback.message}</div>}

              <div className="system-volume-card">
                <div className="system-volume-summary"><small>Current volume</small><strong>{audio.muted ? 'Muted' : `${displayVolume}% volume`}</strong><span>{outputDevice?.name ?? audio.currentOutputName ?? 'Default output device'}</span></div>
                <div className="system-volume-controls">
                  <button data-settings-action type="button" aria-label="Volume down" disabled={audioPending !== null || displayVolume <= 0} onClick={() => void applyMasterVolume(displayVolume - 5, 'down')}>
                    {audioPending === 'volume-down' ? <LoaderCircle size={18} className="spin" /> : <Minus size={19} />}
                  </button>
                  <input
                    data-settings-action
                    data-settings-slider="volume"
                    aria-label="Master volume"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={displayVolume}
                    style={{ background: `linear-gradient(90deg, var(--slider-active) 0%, var(--slider-active) ${displayVolume}%, var(--slider-track) ${displayVolume}%)` }}
                    disabled={audioPending !== null || !audio.supported}
                    onChange={(event) => setDisplayVolume(Number(event.currentTarget.value))}
                    onPointerUp={(event) => void applyMasterVolume(Number(event.currentTarget.value), 'slider')}
                    onBlur={(event) => {
                      const next = Number(event.currentTarget.value);
                      if (next !== audio.masterVolume && !audioBusy.current) void applyMasterVolume(next, 'slider');
                    }}
                  />
                  <button data-settings-action type="button" aria-label="Volume up" disabled={audioPending !== null || displayVolume >= 100} onClick={() => void applyMasterVolume(displayVolume + 5, 'up')}>
                    {audioPending === 'volume-up' ? <LoaderCircle size={18} className="spin" /> : <Plus size={19} />}
                  </button>
                  <strong>{displayVolume}%</strong>
                </div>
                <button className={`system-mute-button ${audio.muted ? 'active' : ''}`} data-settings-action type="button" disabled={audioPending !== null || !audio.supported} onClick={() => void toggleMasterMute()}>
                  {audioPending === 'mute' ? <LoaderCircle size={18} className="spin" /> : audio.muted ? <Volume2 size={18} /> : <VolumeX size={18} />}
                  {audioPending === 'mute' ? audio.muted ? 'Unmuting...' : 'Muting...' : audio.muted ? 'Unmute' : 'Mute'}
                </button>
                {volumeBusy && <small className="system-inline-status active">Updating volume...</small>}
              </div>

              <div className="system-current-devices">
                <div><Headphones size={21} /><span><small>Current output</small><strong>{outputDevice?.name ?? 'No active output'}</strong></span></div>
                <div><Mic2 size={21} /><span><small>Current microphone</small><strong>{inputDevice?.name ?? 'No active microphone'}</strong><em>{inputDevice ? audio.inputMuted ? 'Muted' : `${audio.inputVolume}% level` : 'Unavailable'}</em></span></div>
              </div>

              <SystemDeviceList title="Output devices" icon={<Headphones size={20} />} devices={audio.outputDevices} pending={audioPending} onSelect={switchAudioEndpoint} />
              <SystemDeviceList title="Microphones" icon={<Mic2 size={20} />} devices={audio.inputDevices} pending={audioPending} onSelect={switchAudioEndpoint} />
              {!audio.deviceSwitchingSupported && <p className="system-capability-note">Output switching is unavailable on this device. Volume and mute remain fully functional inside NXGS.</p>}
            </section>
          </div>
        </SettingsDetail>
      );
    }
    if (opened.key === 'control-room') {
      return (
        <SettingsDetail title="Control Room" icon={<Lock size={34} />} subtitle="Protected administrator controls" onFocus={() => setDetailMode(true)}>
          <div className="control-room-card"><Lock size={32} /><h3>Admin PIN required</h3><p>Open game management, kiosk controls, diagnostics, and updates.</p><button data-settings-action type="button" onClick={props.onControlRoom}>Enter Control Room</button></div>
        </SettingsDetail>
      );
    }
    return (
      <SettingsDetail title={opened.label} icon={<Info size={34} />} subtitle="NXGS console settings">
        <p className="settings-placeholder">This section is ready for its launcher-native controls.<br />It will remain inside NXGS and use the same controller-first navigation.</p>
      </SettingsDetail>
    );
  }, [applyDisplayBrightness, applyMasterVolume, audio, audioFeedback, audioPending, bluetooth, bluetoothDeviceStatuses, bluetoothFeedback, bluetoothPairingMessage, bluetoothPairingStage, bluetoothPairingTarget, bluetoothPending, brightnessSyncing, confirmPairBluetoothDevice, confirmRemoveBluetoothDevice, diagnostics, disconnectNetwork, display, displayBrightness, displayFeedback, displayInfoExpanded, displayPending, displayVolume, forgetSelectedWifi, forgetWifiTarget, handleBluetoothDevice, network, networkFeedback, networkPending, openWifiContextMenu, opened, performWifiConnect, props.onControlRoom, refreshAudio, refreshBluetooth, refreshDisplay, refreshNetwork, refreshSystem, removeBluetoothTarget, requestForgetWifi, requestPairBluetoothDevice, requestRemoveBluetoothDevice, selectedWifi, selectWifi, showWifiPassword, switchAudioEndpoint, toggleHdr, toggleMasterMute, wifiContextMenu, wifiPassword]);

  return (
    <section className="console-settings-screen">
      <div className="console-settings-backdrop" />
      <header><button type="button" onClick={handleSettingsBack}><ChevronLeft size={21} />Back</button><div><span>NXGS Play</span><h1>Settings</h1></div></header>
      <div className="console-settings-layout">
        <nav aria-label="Console settings categories">
          {SETTINGS_ITEMS.map((item, index) => (
            <button
              data-index={index}
              key={item.key}
              type="button"
              className={index === selectedIndex ? 'selected' : ''}
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
              {item.icon}<span>{item.label}</span><ChevronRight size={22} />
            </button>
          ))}
        </nav>
        {detail}
      </div>
      <footer>{detailMode ? opened.key === 'system' ? '↑ ↓ Choose control  ·  ← → Adjust sliders  ·  X / A Select  ·  Circle / B Categories' : '↑ ↓ Choose action  ·  X / A Select  ·  ← / Circle / B Categories' : '↑ ↓ Navigate  ·  X / A Select  ·  Circle / B Back'}</footer>
    </section>
  );
}

function SettingsDetail(props: { title: string; subtitle: string; icon: JSX.Element; children: React.ReactNode; action?: React.ReactNode; onFocus?: () => void }): JSX.Element {
  return <article className="console-settings-detail" onFocusCapture={props.onFocus}><div className="settings-detail-title">{props.icon}<div><span>{props.subtitle}</span><h2>{props.title}</h2></div>{props.action && <div className="settings-title-action">{props.action}</div>}</div>{props.children}</article>;
}

function SystemDeviceList(props: { title: string; icon: JSX.Element; devices: AudioDeviceSummary[]; pending: string | null; onSelect: (device: AudioDeviceSummary) => Promise<void> }): JSX.Element {
  return (
    <section className="system-device-section">
      <div className="system-device-heading"><span>{props.icon}<strong>{props.title}</strong></span><em>{props.devices.length}</em></div>
      <div className="system-device-list">
        {props.devices.length > 0 ? props.devices.map((device) => {
          const switching = props.pending === `switch:${device.id}`;
          return (
            <div key={device.id} className={device.isDefault ? 'current' : ''}>
              {device.kind === 'output' ? <Headphones size={19} /> : <Mic2 size={19} />}
              <span><strong>{device.name}</strong><small>{device.isDefault ? device.kind === 'output' ? 'Current output' : 'Current microphone' : 'Available device'} · {device.muted ? 'Muted' : `${device.volume}%${device.kind === 'input' ? ' level' : ''}`}</small></span>
              {device.isDefault ? <em className="system-current-badge">Current</em> : (
                <button data-settings-action type="button" disabled={props.pending !== null} onClick={() => void props.onSelect(device)}>
                  {switching ? <LoaderCircle size={17} className="spin" /> : device.kind === 'output' ? <Headphones size={17} /> : <Mic2 size={17} />}
                  {switching ? 'Switching...' : device.kind === 'output' ? 'Use Output' : 'Use Input'}
                </button>
              )}
            </div>
          );
        }) : <p className="settings-placeholder">No audio devices were found.</p>}
      </div>
    </section>
  );
}
