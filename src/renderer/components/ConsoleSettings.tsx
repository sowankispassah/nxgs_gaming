import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Accessibility,
  Bluetooth,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  Gamepad2,
  Globe2,
  HardDrive,
  Info,
  LoaderCircle,
  Lock,
  LockKeyhole,
  Monitor,
  RefreshCw,
  Search,
  Settings,
  Speaker,
  Trash2,
  Unplug,
  Users,
  Wifi,
  WifiOff
} from 'lucide-react';
import type {
  AppDiagnostics,
  BluetoothDeviceSummary,
  BluetoothStatus,
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
  | 'sound'
  | 'screen'
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
  { key: 'sound', label: 'Sound', icon: <Speaker size={25} /> },
  { key: 'screen', label: 'Screen and Video', icon: <Monitor size={25} /> },
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

function focusableDetailActions(): HTMLElement[] {
  const confirmation = document.querySelector<HTMLElement>('.wifi-forget-confirmation');
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
  const [diagnostics, setDiagnostics] = useState<AppDiagnostics | null>(null);
  const networkBusy = useRef(false);
  const bluetoothBusy = useRef(false);
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

  useEffect(() => {
    void refreshNetwork();
  }, [refreshNetwork]);

  useEffect(() => {
    if (selected.key === 'controller' && bluetooth.radioState === 'unknown' && !bluetoothBusy.current) {
      void refreshBluetooth();
    }
  }, [bluetooth.radioState, refreshBluetooth, selected.key]);

  useEffect(() => {
    setDetailMode(false);
    setSelectedWifi(null);
    setForgetWifiTarget(null);
    setWifiContextMenu(null);
    setWifiPassword('');
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
    else if (key === 'network' || key === 'controller') enterDetail();
  }, [enterDetail, props, selectedIndex]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (props.inputBlocked) return;
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'b', 'B'].includes(event.key)) return;
      if (detailMode) {
        if ((event.key === 'Escape' || event.key === 'b' || event.key === 'B') && (forgetWifiTarget || wifiContextMenu)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          setForgetWifiTarget(null);
          setWifiContextMenu(null);
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
  }, [activateSelected, detailMode, forgetWifiTarget, leaveDetail, moveDetailFocus, props, wifiContextMenu]);

  useEffect(() => {
    let lastInputAt = 0;
    const timer = window.setInterval(() => {
      if (props.inputBlocked) return;
      const pad = navigator.getGamepads?.()[0];
      if (!pad || Date.now() - lastInputAt < 190) return;
      const pressed = (index: number): boolean => Boolean(pad.buttons[index]?.pressed);
      if (detailMode) {
        if (pressed(12) || pad.axes[1] < -0.65) {
          lastInputAt = Date.now();
          moveDetailFocus(-1);
        } else if (pressed(13) || pad.axes[1] > 0.65) {
          lastInputAt = Date.now();
          moveDetailFocus(1);
        } else if (pressed(14) || pressed(1)) {
          lastInputAt = Date.now();
          if (forgetWifiTarget || wifiContextMenu) {
            setForgetWifiTarget(null);
            setWifiContextMenu(null);
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
  }, [activateSelected, detailMode, forgetWifiTarget, leaveDetail, moveDetailFocus, props, selected.label, wifiContextMenu]);

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

  const handleBluetoothDevice = useCallback(async (device: BluetoothDeviceSummary): Promise<void> => {
    if (bluetoothBusy.current) return;
    bluetoothBusy.current = true;
    const disconnecting = device.connected;
    setBluetoothPending(`${disconnecting ? 'disconnect' : 'pair'}:${device.id}`);
    setBluetoothFeedback({ tone: 'info', message: disconnecting ? 'Disconnecting...' : 'Pairing...' });
    try {
      const result = disconnecting
        ? await window.nxgs.disconnectBluetoothDevice(device.id)
        : await window.nxgs.pairBluetoothDevice(device.id);
      setBluetooth(result.bluetooth);
      setBluetoothFeedback({ tone: result.ok ? result.status === 'paired' ? 'warning' : 'success' : 'error', message: result.message });
    } catch (error) {
      setBluetoothFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'Bluetooth action failed.' });
    } finally {
      bluetoothBusy.current = false;
      setBluetoothPending(null);
    }
  }, []);

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
              <div className="wifi-forget-confirmation" role="dialog" aria-modal="true" aria-labelledby="wifi-forget-title" aria-describedby="wifi-forget-description">
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
              const label = device.connected ? 'Disconnect' : device.paired ? 'Reconnect' : 'Pair';
              return (
                <div key={device.id} className={device.connected ? 'connected' : ''}>
                  <Bluetooth size={21} />
                  <span><strong>{device.name}</strong><small>{device.connected ? 'Connected' : device.paired ? 'Paired' : 'Available'}{device.address ? ` · ${device.address}` : ''}</small></span>
                  <button data-settings-action type="button" disabled={bluetoothPending !== null || (!device.connectable && !device.paired)} onClick={() => void handleBluetoothDevice(device)}>
                    {pending ? <LoaderCircle size={17} className="spin" /> : device.connected ? <Unplug size={17} /> : <Bluetooth size={17} />}
                    {pending ? device.connected ? 'Disconnecting...' : 'Pairing...' : label}
                  </button>
                </div>
              );
            }) : <p className="settings-placeholder">No Bluetooth devices found. Put the controller in pairing mode and select Scan for Devices.</p>}
          </div>
          <p className="settings-capability-note">Windows controls the final Bluetooth HID connection and may show a consent prompt over NXGS. Disconnect removes the Windows pairing so the device can be paired elsewhere. Some Bluetooth LE-only devices remain driver-managed.</p>
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
        <p className="settings-placeholder">This section is ready for its launcher-native controls. It will remain inside NXGS and use the same controller-first navigation.</p>
      </SettingsDetail>
    );
  }, [bluetooth, bluetoothFeedback, bluetoothPending, diagnostics, disconnectNetwork, forgetSelectedWifi, forgetWifiTarget, handleBluetoothDevice, network, networkFeedback, networkPending, openWifiContextMenu, performWifiConnect, props.onControlRoom, refreshBluetooth, refreshNetwork, requestForgetWifi, selected, selectedWifi, selectWifi, showWifiPassword, wifiContextMenu, wifiPassword]);

  return (
    <section className="console-settings-screen">
      <div className="console-settings-backdrop" />
      <header><button type="button" onClick={props.onBack}>Back</button><div><span>NXGS Play</span><h1>Settings</h1></div></header>
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
      <footer>{detailMode ? '↑ ↓ Choose action  ·  X / A Select  ·  ← / Circle / B Categories' : '↑ ↓ Navigate  ·  X / A Select  ·  Circle / B Back'}</footer>
    </section>
  );
}

function SettingsDetail(props: { title: string; subtitle: string; icon: JSX.Element; children: React.ReactNode; onFocus?: () => void }): JSX.Element {
  return <article className="console-settings-detail" onFocusCapture={props.onFocus}><div className="settings-detail-title">{props.icon}<div><span>{props.subtitle}</span><h2>{props.title}</h2></div></div>{props.children}</article>;
}
