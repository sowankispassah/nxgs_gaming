import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const [detailMode, setDetailMode] = useState(false);
  const [network, setNetwork] = useState<NetworkStatus>(EMPTY_NETWORK);
  const [networkPending, setNetworkPending] = useState<'refresh' | 'connect' | 'disconnect' | 'forget' | null>(null);
  const [networkFeedback, setNetworkFeedback] = useState<Feedback | null>(null);
  const [selectedWifi, setSelectedWifi] = useState<WifiNetworkSummary | null>(null);
  const [forgetWifiTarget, setForgetWifiTarget] = useState<WifiNetworkSummary | null>(null);
  const [wifiContextMenu, setWifiContextMenu] = useState<{ wifi: WifiNetworkSummary; x: number; y: number } | null>(null);
  const [wifiPassword, setWifiPassword] = useState('');
  const [showWifiPassword, setShowWifiPassword] = useState(false);
  const [bluetooth, setBluetooth] = useState<BluetoothStatus>(EMPTY_BLUETOOTH);
  const [bluetoothPending, setBluetoothPending] = useState<string | null>(null);
  const [bluetoothFeedback, setBluetoothFeedback] = useState<Feedback | null>(null);
  const [bluetoothDeviceStatuses, setBluetoothDeviceStatuses] = useState<Record<string, 'Connected' | 'Paired / Disconnected' | 'Failed'>>({});
  const [removeBluetoothTarget, setRemoveBluetoothTarget] = useState<BluetoothDeviceSummary | null>(null);
  const [audio, setAudio] = useState<AudioStatus>(EMPTY_AUDIO);
  const [displayVolume, setDisplayVolume] = useState(0);
  const [audioPending, setAudioPending] = useState<string | null>(null);
  const [audioFeedback, setAudioFeedback] = useState<Feedback | null>(null);
  const [display, setDisplay] = useState<DisplayStatus>(EMPTY_DISPLAY);
  const [displayBrightness, setDisplayBrightness] = useState(0);
  const [displayPending, setDisplayPending] = useState<'refresh' | 'hdr' | null>(null);
  const [brightnessSyncing, setBrightnessSyncing] = useState(false);
  const [displayFeedback, setDisplayFeedback] = useState<Feedback | null>(null);
  const [displayInfoExpanded, setDisplayInfoExpanded] = useState(false);
  const [diagnostics, setDiagnostics] = useState<AppDiagnostics | null>(null);
  const networkBusy = useRef(false);
  const bluetoothBusy = useRef(false);
  const audioBusy = useRef(false);
  const displayBusy = useRef(false);
  const brightnessTarget = useRef<number | null>(null);
  const brightnessFlushActive = useRef(false);
  const selected = SETTINGS_ITEMS[selectedIndex];

  const refreshNetwork = useCallback(async (): Promise<void> => {
    if (networkBusy.current) return;
    networkBusy.current = true;
    setNetworkPending('refresh');
    setNetworkFeedback({ tone: 'info', message: 'Scanning for Wi-Fi networks...' });
    try {
      const next = await window.nxgs.scanWifiNetworks();
      setNetwork(next);
      setSelectedWifi((current) => current ? next.availableNetworks.find((item) => item.ssid === current.ssid) ?? null : null);
      setNetworkFeedback(next.supported
        ? next.connected && next.connectivity !== 'internet'
          ? { tone: 'warning', message: next.message ?? 'No internet / limited connection' }
          : null
        : { tone: 'error', message: next.message ?? 'Wi-Fi is unavailable.' });
    } catch (error) {
      setNetworkFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'Wi-Fi scan failed.' });
    } finally {
      networkBusy.current = false;
      setNetworkPending(null);
    }
  }, []);

  const refreshBluetooth = useCallback(async (): Promise<void> => {
    if (bluetoothBusy.current) return;
    bluetoothBusy.current = true;
    setBluetoothPending('scan');
    setBluetoothFeedback({ tone: 'info', message: 'Searching...' });
    setBluetoothDeviceStatuses({});
    try {
      const next = await window.nxgs.scanBluetoothDevices();
      setBluetooth(next);
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
  }, []);

  const refreshAudio = useCallback(async (): Promise<void> => {
    if (audioBusy.current) return;
    audioBusy.current = true;
    setAudioPending('refresh');
    setAudioFeedback({ tone: 'info', message: 'Reading audio settings...' });
    try {
      const next = await window.nxgs.getAudioStatus();
      setAudio(next);
      setDisplayVolume(next.masterVolume);
      setAudioFeedback(next.supported ? null : { tone: 'error', message: next.message ?? 'Audio controls are unavailable.' });
    } catch (error) {
      setAudioFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to read audio settings.' });
    } finally {
      audioBusy.current = false;
      setAudioPending(null);
    }
  }, []);

  const refreshDisplay = useCallback(async (): Promise<void> => {
    if (displayBusy.current) return;
    displayBusy.current = true;
    setDisplayPending('refresh');
    setDisplayFeedback({ tone: 'info', message: 'Reading display information...' });
    try {
      const next = await window.nxgs.getDisplayStatus();
      setDisplay(next);
      setDisplayBrightness(next.brightness.level);
      setDisplayFeedback(next.supported
        ? next.brightness.supported
          ? null
          : { tone: 'warning', message: next.brightness.message ?? 'Brightness control is not supported on this display.' }
        : { tone: 'error', message: next.message ?? 'Display information is unavailable.' });
    } catch (error) {
      setDisplayFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to read display information.' });
    } finally {
      displayBusy.current = false;
      setDisplayPending(null);
    }
  }, []);

  const refreshSystem = useCallback(async (): Promise<void> => {
    await Promise.all([refreshDisplay(), refreshAudio()]);
  }, [refreshAudio, refreshDisplay]);

  useEffect(() => {
    void refreshNetwork();
  }, [refreshNetwork]);

  useEffect(() => {
    if (selected.key === 'controller' && bluetooth.radioState === 'unknown' && !bluetoothBusy.current) {
      void refreshBluetooth();
    }
  }, [bluetooth.radioState, refreshBluetooth, selected.key]);

  useEffect(() => {
    if (selected.key === 'system' && audio.outputDevices.length === 0 && !audioBusy.current) void refreshAudio();
  }, [audio.outputDevices.length, refreshAudio, selected.key]);

  useEffect(() => {
    if (selected.key === 'system' && display.displays.length === 0 && !displayBusy.current) void refreshDisplay();
  }, [display.displays.length, refreshDisplay, selected.key]);

  useEffect(() => {
    setDetailMode(false);
    setSelectedWifi(null);
    setForgetWifiTarget(null);
    setWifiContextMenu(null);
    setWifiPassword('');
    setDisplayInfoExpanded(false);
  }, [selectedIndex]);

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
    setAudioPending(`volume-${source}`);
    setAudioFeedback({ tone: 'info', message: `Setting volume to ${nextVolume}%...` });
    try {
      const result = await window.nxgs.setMasterVolume(nextVolume);
      setAudio(result.audio);
      setDisplayVolume(result.audio.masterVolume);
      setAudioFeedback({ tone: result.ok ? 'success' : 'error', message: result.message });
    } catch (error) {
      setDisplayVolume(audio.masterVolume);
      setAudioFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to change system volume.' });
    } finally {
      audioBusy.current = false;
      setAudioPending(null);
    }
  }, [audio.masterVolume]);

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
    setBrightnessSyncing(true);
    void (async () => {
      try {
        while (brightnessTarget.current !== null) {
          const target = brightnessTarget.current;
          brightnessTarget.current = null;
          const result = await window.nxgs.setBrightness(target);
          setDisplay(result.display);
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
  }, [display.brightness.message, display.brightness.supported]);

  const toggleHdr = useCallback(async (): Promise<void> => {
    if (displayBusy.current) return;
    displayBusy.current = true;
    setDisplayPending('hdr');
    setDisplayFeedback({ tone: 'info', message: display.hdr.enabled ? 'Turning HDR off...' : 'Turning HDR on...' });
    try {
      const result = await window.nxgs.setHdr(!display.hdr.enabled);
      setDisplay(result.display);
      setDisplayFeedback({ tone: result.ok ? 'success' : 'warning', message: result.message });
    } catch (error) {
      setDisplayFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'HDR could not be changed.' });
    } finally {
      displayBusy.current = false;
      setDisplayPending(null);
    }
  }, [display.hdr.enabled]);

  const toggleMasterMute = useCallback(async (): Promise<void> => {
    if (audioBusy.current) return;
    audioBusy.current = true;
    setAudioPending('mute');
    setAudioFeedback({ tone: 'info', message: audio.muted ? 'Unmuting system sound...' : 'Muting system sound...' });
    try {
      const result = await window.nxgs.setMasterMuted(!audio.muted);
      setAudio(result.audio);
      setDisplayVolume(result.audio.masterVolume);
      setAudioFeedback({ tone: result.ok ? 'success' : 'error', message: result.message });
    } catch (error) {
      setAudioFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to change mute status.' });
    } finally {
      audioBusy.current = false;
      setAudioPending(null);
    }
  }, [audio.muted]);

  const switchAudioEndpoint = useCallback(async (device: AudioDeviceSummary): Promise<void> => {
    if (audioBusy.current || device.isDefault) return;
    audioBusy.current = true;
    setAudioPending(`switch:${device.id}`);
    setAudioFeedback({ tone: 'info', message: `Switching to ${device.name}...` });
    try {
      const result = device.kind === 'output'
        ? await window.nxgs.switchAudioOutput(device.id)
        : await window.nxgs.switchAudioInput(device.id);
      setAudio(result.audio);
      setDisplayVolume(result.audio.masterVolume);
      setAudioFeedback({ tone: result.ok ? 'success' : 'warning', message: result.message });
    } catch (error) {
      setAudioFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to change the audio device.' });
    } finally {
      audioBusy.current = false;
      setAudioPending(null);
    }
  }, []);

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

  const enterDetail = useCallback((): void => {
    setDetailMode(true);
    window.setTimeout(() => focusableDetailActions()[0]?.focus(), 0);
  }, []);

  const leaveDetail = useCallback((): void => {
    setDetailMode(false);
    (document.querySelector<HTMLElement>(`.console-settings-layout > nav button[data-index="${selectedIndex}"]`))?.focus();
  }, [selectedIndex]);

  const moveDetailFocus = useCallback((direction: number): void => {
    const actions = focusableDetailActions();
    if (actions.length === 0) return;
    const current = actions.indexOf(document.activeElement as HTMLElement);
    actions[(current + direction + actions.length) % actions.length]?.focus();
  }, []);

  const activateSelected = useCallback((): void => {
    const key = SETTINGS_ITEMS[selectedIndex].key;
    if (key === 'control-room') props.onControlRoom();
    else if (key === 'network' || key === 'controller' || key === 'system') enterDetail();
  }, [enterDetail, props, selectedIndex]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (props.inputBlocked) return;
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'b', 'B'].includes(event.key)) return;
      if (detailMode) {
        if ((event.key === 'Escape' || event.key === 'b' || event.key === 'B') && (forgetWifiTarget || wifiContextMenu || removeBluetoothTarget)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          setForgetWifiTarget(null);
          setWifiContextMenu(null);
          setRemoveBluetoothTarget(null);
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
        } else if (event.key === 'ArrowLeft' || event.key === 'Escape' || event.key === 'b' || event.key === 'B') {
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
      if (event.key === 'ArrowUp') setSelectedIndex((index) => (index - 1 + SETTINGS_ITEMS.length) % SETTINGS_ITEMS.length);
      else if (event.key === 'ArrowDown') setSelectedIndex((index) => (index + 1) % SETTINGS_ITEMS.length);
      else if (event.key === 'Enter' || event.key === 'ArrowRight') activateSelected();
      else props.onBack();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [activateSelected, adjustFocusedSlider, detailMode, forgetWifiTarget, leaveDetail, moveDetailFocus, props, removeBluetoothTarget, wifiContextMenu]);

  useEffect(() => {
    let lastInputAt = 0;
    const timer = window.setInterval(() => {
      if (props.inputBlocked) return;
      const pad = navigator.getGamepads?.()[0];
      if (!pad || Date.now() - lastInputAt < 190) return;
      const pressed = (index: number): boolean => Boolean(pad.buttons[index]?.pressed);
      if (detailMode) {
        const sliderFocused = document.activeElement instanceof HTMLInputElement && ['volume', 'brightness'].includes(document.activeElement.dataset.settingsSlider ?? '');
        if (sliderFocused && (pressed(14) || pad.axes[0] < -0.65)) {
          lastInputAt = Date.now();
          adjustFocusedSlider(-1);
        } else if (sliderFocused && (pressed(15) || pad.axes[0] > 0.65)) {
          lastInputAt = Date.now();
          adjustFocusedSlider(1);
        } else if (pressed(12) || pad.axes[1] < -0.65) {
          lastInputAt = Date.now();
          moveDetailFocus(-1);
        } else if (pressed(13) || pad.axes[1] > 0.65) {
          lastInputAt = Date.now();
          moveDetailFocus(1);
        } else if (pressed(14) || pressed(1)) {
          lastInputAt = Date.now();
          if (forgetWifiTarget || wifiContextMenu || removeBluetoothTarget) {
            setForgetWifiTarget(null);
            setWifiContextMenu(null);
            setRemoveBluetoothTarget(null);
          } else {
            leaveDetail();
          }
        } else if (pressed(0)) {
          lastInputAt = Date.now();
          const active = document.activeElement;
          if (active instanceof HTMLButtonElement) active.click();
        }
        return;
      }
      if (pressed(12) || pad.axes[1] < -0.65) {
        lastInputAt = Date.now();
        setSelectedIndex((index) => (index - 1 + SETTINGS_ITEMS.length) % SETTINGS_ITEMS.length);
        void window.nxgs.reportControllerState({ detected: true, name: pad.id, homeSupported: pad.buttons.length > 16 ? 'unknown' : 'no', lastButtonPressed: 'D-pad Up', lastNavigationAction: 'Settings: move up' });
      } else if (pressed(13) || pad.axes[1] > 0.65) {
        lastInputAt = Date.now();
        setSelectedIndex((index) => (index + 1) % SETTINGS_ITEMS.length);
        void window.nxgs.reportControllerState({ detected: true, name: pad.id, homeSupported: pad.buttons.length > 16 ? 'unknown' : 'no', lastButtonPressed: 'D-pad Down', lastNavigationAction: 'Settings: move down' });
      } else if (pressed(15) || pressed(0)) {
        lastInputAt = Date.now();
        activateSelected();
        void window.nxgs.reportControllerState({ detected: true, name: pad.id, homeSupported: pad.buttons.length > 16 ? 'unknown' : 'no', lastButtonPressed: 'X / A', lastNavigationAction: `Settings: select ${selected.label}` });
      } else if (pressed(1)) {
        lastInputAt = Date.now();
        props.onBack();
      }
    }, 90);
    return () => window.clearInterval(timer);
  }, [activateSelected, adjustFocusedSlider, detailMode, forgetWifiTarget, leaveDetail, moveDetailFocus, props, removeBluetoothTarget, selected.label, wifiContextMenu]);

  const performWifiConnect = useCallback(async (wifi: WifiNetworkSummary, password?: string): Promise<void> => {
    if (networkBusy.current) return;
    networkBusy.current = true;
    setNetworkPending('connect');
    setNetworkFeedback({ tone: 'info', message: `Connecting to ${wifi.ssid}...` });
    try {
      const result = await window.nxgs.connectWifi({ ssid: wifi.ssid, password });
      setNetwork(result.network);
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
  }, []);

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
    setNetworkPending('disconnect');
    setNetworkFeedback({ tone: 'info', message: 'Disconnecting...' });
    try {
      const result = await window.nxgs.disconnectWifi();
      setNetwork(result.network);
      setSelectedWifi((current) => current ? result.network.availableNetworks.find((item) => item.ssid === current.ssid) ?? current : null);
      setNetworkFeedback({ tone: result.ok ? 'success' : 'error', message: result.message });
    } catch (error) {
      setNetworkFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to disconnect.' });
    } finally {
      networkBusy.current = false;
      setNetworkPending(null);
    }
  }, []);

  const requestForgetWifi = useCallback((wifi: WifiNetworkSummary): void => {
    if (!wifi.saved || networkBusy.current) return;
    setWifiContextMenu(null);
    setForgetWifiTarget(wifi);
    window.setTimeout(() => document.querySelector<HTMLButtonElement>('#wifi-forget-cancel')?.focus(), 0);
  }, []);

  const forgetSelectedWifi = useCallback(async (): Promise<void> => {
    if (!forgetWifiTarget || networkBusy.current) return;
    networkBusy.current = true;
    setNetworkPending('forget');
    setNetworkFeedback({ tone: 'info', message: `Forgetting ${forgetWifiTarget.ssid}...` });
    try {
      const result = await window.nxgs.forgetWifi(forgetWifiTarget.ssid);
      setNetwork(result.network);
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
  }, [forgetWifiTarget]);

  const handleBluetoothDevice = useCallback(async (device: BluetoothDeviceSummary, action: 'connect' | 'disconnect'): Promise<void> => {
    if (bluetoothBusy.current) return;
    bluetoothBusy.current = true;
    const disconnecting = action === 'disconnect';
    setBluetoothPending(`${action}:${device.id}`);
    setBluetoothFeedback({
      tone: 'info',
      message: disconnecting ? `Disconnecting ${device.name}...` : device.paired ? `Reconnecting ${device.name}...` : `Pairing ${device.name}...`
    });
    try {
      const result = disconnecting
        ? await window.nxgs.disconnectBluetoothDevice(device.id)
        : await window.nxgs.pairBluetoothDevice(device.id);
      setBluetooth(result.bluetooth);
      setBluetoothFeedback({ tone: result.ok ? result.status === 'paired' ? 'warning' : 'success' : 'error', message: result.message });
      setBluetoothDeviceStatuses((current) => ({
        ...current,
        [device.id]: result.ok
          ? result.status === 'connected' ? 'Connected' : 'Paired / Disconnected'
          : 'Failed'
      }));
    } catch (error) {
      setBluetoothFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'Bluetooth action failed.' });
      setBluetoothDeviceStatuses((current) => ({ ...current, [device.id]: 'Failed' }));
    } finally {
      bluetoothBusy.current = false;
      setBluetoothPending(null);
    }
  }, []);

  const requestRemoveBluetoothDevice = useCallback((device: BluetoothDeviceSummary): void => {
    if (!device.paired || bluetoothBusy.current) return;
    setRemoveBluetoothTarget(device);
    window.setTimeout(() => document.querySelector<HTMLButtonElement>('#bluetooth-remove-cancel')?.focus(), 0);
  }, []);

  const confirmRemoveBluetoothDevice = useCallback(async (): Promise<void> => {
    if (!removeBluetoothTarget || bluetoothBusy.current) return;
    const target = removeBluetoothTarget;
    bluetoothBusy.current = true;
    setBluetoothPending(`remove:${target.id}`);
    setBluetoothFeedback({ tone: 'info', message: `Removing ${target.name}...` });
    try {
      const result = await window.nxgs.removeBluetoothDevice(target.id);
      setBluetooth(result.bluetooth);
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
  }, [removeBluetoothTarget]);

  const detail = useMemo(() => {
    if (selected.key === 'network') {
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
            <div className="wifi-confirmation-backdrop" role="presentation">
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
    if (selected.key === 'controller') {
      const radioLabel = bluetooth.radioState === 'on' ? 'Bluetooth on' : bluetooth.radioState === 'off' ? 'Bluetooth off' : bluetooth.radioState === 'disabled' ? 'Bluetooth disabled' : 'Bluetooth status unknown';
      return (
        <SettingsDetail title="Bluetooth / Controller" icon={<Gamepad2 size={34} />} subtitle="Find and pair devices inside NXGS" onFocus={() => setDetailMode(true)}>
          <div className={`settings-status-card ${bluetooth.radioState !== 'on' ? 'warning' : ''}`}>
            <span>{bluetoothPending === 'scan' ? 'Searching...' : radioLabel}</span>
            <strong>{diagnostics?.controller.detected ? diagnostics.controller.name ?? 'Controller connected' : 'No active controller'}</strong>
            <small>{diagnostics?.controller.detected ? 'Connected controller is available to the launcher.' : 'Put the controller in pairing mode, then scan.'}</small>
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
              const label = device.connected ? 'Disconnect' : device.paired ? 'Reconnect' : 'Pair';
              const status = pendingAction === 'connect'
                ? 'Connecting'
                : pendingAction === 'disconnect'
                  ? 'Disconnecting'
                  : pendingAction === 'remove'
                    ? 'Removing'
                    : bluetoothDeviceStatuses[device.id] ?? (device.connected ? 'Connected' : device.paired ? 'Paired / Disconnected' : 'Available');
              return (
                <div key={device.id} className={device.connected ? 'connected' : ''}>
                  <Bluetooth size={21} />
                  <span><strong>{device.name}</strong><small>{status}{device.address ? ` · ${device.address}` : ''}</small></span>
                  <div className="bluetooth-device-actions">
                    <button data-settings-action type="button" disabled={bluetoothPending !== null || (!device.connectable && !device.paired)} onClick={() => void handleBluetoothDevice(device, device.connected ? 'disconnect' : 'connect')}>
                      {pending && pendingAction !== 'remove' ? <LoaderCircle size={17} className="spin" /> : device.connected ? <Unplug size={17} /> : <Bluetooth size={17} />}
                      {pendingAction === 'connect' ? 'Connecting...' : pendingAction === 'disconnect' ? 'Disconnecting...' : label}
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
          {removeBluetoothTarget && (
            <div className="bluetooth-confirmation-backdrop" role="presentation">
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
    if (selected.key === 'system') {
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
                  style={{ background: `linear-gradient(90deg, #58a6ff 0%, #58a6ff ${displayBrightness}%, rgba(255, 255, 255, 0.14) ${displayBrightness}%)` }}
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
                    style={{ background: `linear-gradient(90deg, #f4f7fb 0%, #f4f7fb ${displayVolume}%, rgba(255, 255, 255, 0.14) ${displayVolume}%)` }}
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
    if (selected.key === 'control-room') {
      return (
        <SettingsDetail title="Control Room" icon={<Lock size={34} />} subtitle="Protected administrator controls" onFocus={() => setDetailMode(true)}>
          <div className="control-room-card"><Lock size={32} /><h3>Admin PIN required</h3><p>Open game management, kiosk controls, diagnostics, and updates.</p><button data-settings-action type="button" onClick={props.onControlRoom}>Enter Control Room</button></div>
        </SettingsDetail>
      );
    }
    return (
      <SettingsDetail title={selected.label} icon={<Info size={34} />} subtitle="NXGS console settings">
        <p className="settings-placeholder">This section is ready for its launcher-native controls.<br />It will remain inside NXGS and use the same controller-first navigation.</p>
      </SettingsDetail>
    );
  }, [applyDisplayBrightness, applyMasterVolume, audio, audioFeedback, audioPending, bluetooth, bluetoothDeviceStatuses, bluetoothFeedback, bluetoothPending, brightnessSyncing, confirmRemoveBluetoothDevice, diagnostics, disconnectNetwork, display, displayBrightness, displayFeedback, displayInfoExpanded, displayPending, displayVolume, forgetSelectedWifi, forgetWifiTarget, handleBluetoothDevice, network, networkFeedback, networkPending, openWifiContextMenu, performWifiConnect, props.onControlRoom, refreshAudio, refreshBluetooth, refreshDisplay, refreshNetwork, refreshSystem, removeBluetoothTarget, requestForgetWifi, requestRemoveBluetoothDevice, selected, selectedWifi, selectWifi, showWifiPassword, switchAudioEndpoint, toggleHdr, toggleMasterMute, wifiContextMenu, wifiPassword]);

  return (
    <section className="console-settings-screen">
      <div className="console-settings-backdrop" />
      <header><button type="button" onClick={props.onBack}><ChevronLeft size={21} />Back</button><div><span>NXGS Play</span><h1>Settings</h1></div></header>
      <div className="console-settings-layout">
        <nav aria-label="Console settings categories">
          {SETTINGS_ITEMS.map((item, index) => (
            <button data-index={index} key={item.key} type="button" className={index === selectedIndex ? 'selected' : ''} onMouseEnter={() => setSelectedIndex(index)} onClick={() => { setSelectedIndex(index); if (item.key === 'control-room') props.onControlRoom(); }}>
              {item.icon}<span>{item.label}</span><ChevronRight size={22} />
            </button>
          ))}
        </nav>
        {detail}
      </div>
      <footer>{detailMode ? selected.key === 'system' ? '↑ ↓ Choose control  ·  ← → Adjust sliders  ·  X / A Select  ·  Circle / B Categories' : '↑ ↓ Choose action  ·  X / A Select  ·  ← / Circle / B Categories' : '↑ ↓ Navigate  ·  X / A Select  ·  Circle / B Back'}</footer>
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
