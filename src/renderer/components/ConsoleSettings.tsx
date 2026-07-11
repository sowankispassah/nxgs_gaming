import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Accessibility,
  Bluetooth,
  BookOpen,
  ChevronRight,
  Gamepad2,
  Globe2,
  HardDrive,
  Info,
  Lock,
  Monitor,
  RefreshCw,
  Settings,
  Speaker,
  Users,
  Wifi
} from 'lucide-react';
import type { AppDiagnostics, NetworkStatus } from '../../shared/types';

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
  availableNetworks: []
};

export function ConsoleSettings(props: { onBack: () => void; onControlRoom: () => void }): JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [network, setNetwork] = useState<NetworkStatus>(EMPTY_NETWORK);
  const [networkPending, setNetworkPending] = useState(false);
  const [diagnostics, setDiagnostics] = useState<AppDiagnostics | null>(null);
  const selected = SETTINGS_ITEMS[selectedIndex];

  const refreshNetwork = useCallback(async (): Promise<void> => {
    if (networkPending) return;
    setNetworkPending(true);
    try {
      setNetwork(await window.nxgs.getNetworkStatus());
    } finally {
      setNetworkPending(false);
    }
  }, [networkPending]);

  useEffect(() => {
    void refreshNetwork();
  }, []);

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

  const activateSelected = useCallback((): void => {
    if (SETTINGS_ITEMS[selectedIndex].key === 'control-room') {
      props.onControlRoom();
    }
  }, [props, selectedIndex]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!['ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'b', 'B'].includes(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'ArrowUp') setSelectedIndex((index) => (index - 1 + SETTINGS_ITEMS.length) % SETTINGS_ITEMS.length);
      else if (event.key === 'ArrowDown') setSelectedIndex((index) => (index + 1) % SETTINGS_ITEMS.length);
      else if (event.key === 'Enter') activateSelected();
      else props.onBack();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [activateSelected, props]);

  useEffect(() => {
    let lastInputAt = 0;
    const timer = window.setInterval(() => {
      const pad = navigator.getGamepads?.()[0];
      if (!pad || Date.now() - lastInputAt < 190) return;
      const pressed = (index: number): boolean => Boolean(pad.buttons[index]?.pressed);
      if (pressed(12) || pad.axes[1] < -0.65) {
        lastInputAt = Date.now();
        setSelectedIndex((index) => (index - 1 + SETTINGS_ITEMS.length) % SETTINGS_ITEMS.length);
        void window.nxgs.reportControllerState({ detected: true, name: pad.id, homeSupported: pad.buttons.length > 16 ? 'unknown' : 'no', lastButtonPressed: 'D-pad Up', lastNavigationAction: 'Settings: move up' });
      } else if (pressed(13) || pad.axes[1] > 0.65) {
        lastInputAt = Date.now();
        setSelectedIndex((index) => (index + 1) % SETTINGS_ITEMS.length);
        void window.nxgs.reportControllerState({ detected: true, name: pad.id, homeSupported: pad.buttons.length > 16 ? 'unknown' : 'no', lastButtonPressed: 'D-pad Down', lastNavigationAction: 'Settings: move down' });
      } else if (pressed(0)) {
        lastInputAt = Date.now();
        activateSelected();
        void window.nxgs.reportControllerState({ detected: true, name: pad.id, homeSupported: pad.buttons.length > 16 ? 'unknown' : 'no', lastButtonPressed: 'X / A', lastNavigationAction: `Settings: select ${selected.label}` });
      } else if (pressed(1)) {
        lastInputAt = Date.now();
        props.onBack();
        void window.nxgs.reportControllerState({ detected: true, name: pad.id, homeSupported: pad.buttons.length > 16 ? 'unknown' : 'no', lastButtonPressed: 'Circle / B', lastNavigationAction: 'Settings: back' });
      }
    }, 90);
    return () => window.clearInterval(timer);
  }, [activateSelected, props, selected.label]);

  const detail = useMemo(() => {
    if (selected.key === 'network') {
      return (
        <SettingsDetail title="Network" icon={<Wifi size={34} />} subtitle="Wi-Fi and network status">
          <div className="settings-status-card">
            <span>{network.connected ? 'Connected' : 'Not connected'}</span>
            <strong>{network.ssid ?? network.interfaceName ?? 'Wi-Fi'}</strong>
            <small>{network.signal ? `Signal ${network.signal}` : network.message ?? 'Network details are unavailable.'}</small>
          </div>
          <div className="settings-detail-heading">
            <h3>Available networks</h3>
            <button type="button" disabled={networkPending} onClick={() => void refreshNetwork()}>
              <RefreshCw size={18} className={networkPending ? 'spin' : ''} />
              {networkPending ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
          <div className="wifi-network-list">
            {network.availableNetworks.length > 0 ? network.availableNetworks.map((item) => (
              <div key={item.ssid}><Wifi size={19} /><strong>{item.ssid}</strong><span>{item.signal ?? item.security ?? 'Available'}</span></div>
            )) : <p className="settings-placeholder">No Wi-Fi networks were reported. Connection controls will stay inside NXGS when enabled.</p>}
          </div>
        </SettingsDetail>
      );
    }
    if (selected.key === 'controller') {
      return (
        <SettingsDetail title="Bluetooth / Controller" icon={<Gamepad2 size={34} />} subtitle="Controller connection and pairing">
          <div className="settings-status-card">
            <span>{diagnostics?.controller.detected ? 'Controller connected' : 'No controller detected'}</span>
            <strong>{diagnostics?.controller.name ?? 'Standard game controller'}</strong>
            <small>Home support: {diagnostics?.controller.homeSupported ?? 'unknown'}</small>
          </div>
          <div className="controller-diagnostic-list">
            <div><span>Last button</span><strong>{diagnostics?.controller.lastButtonPressed ?? 'none'}</strong></div>
            <div><span>Last action</span><strong>{diagnostics?.controller.lastNavigationAction ?? 'none'}</strong></div>
          </div>
          <p className="settings-placeholder">Bluetooth pairing will be added here without exposing the Windows desktop. Wired, paired Bluetooth, and standard XInput controllers are detected automatically.</p>
        </SettingsDetail>
      );
    }
    if (selected.key === 'control-room') {
      return (
        <SettingsDetail title="Control Room" icon={<Lock size={34} />} subtitle="Protected administrator controls">
          <div className="control-room-card"><Lock size={32} /><h3>Admin PIN required</h3><p>Open game management, kiosk controls, diagnostics, and updates.</p><button type="button" onClick={props.onControlRoom}>Enter Control Room</button></div>
        </SettingsDetail>
      );
    }
    return (
      <SettingsDetail title={selected.label} icon={<Info size={34} />} subtitle="NXGS console settings">
        <p className="settings-placeholder">This section is ready for its launcher-native controls. It will remain inside NXGS and use the same controller-first navigation.</p>
      </SettingsDetail>
    );
  }, [diagnostics, network, networkPending, props.onControlRoom, refreshNetwork, selected]);

  return (
    <section className="console-settings-screen">
      <div className="console-settings-backdrop" />
      <header><button type="button" onClick={props.onBack}>Back</button><div><span>NXGS Play</span><h1>Settings</h1></div></header>
      <div className="console-settings-layout">
        <nav aria-label="Console settings categories">
          {SETTINGS_ITEMS.map((item, index) => (
            <button key={item.key} type="button" className={index === selectedIndex ? 'selected' : ''} onMouseEnter={() => setSelectedIndex(index)} onClick={() => { setSelectedIndex(index); if (item.key === 'control-room') props.onControlRoom(); }}>
              {item.icon}<span>{item.label}</span><ChevronRight size={22} />
            </button>
          ))}
        </nav>
        {detail}
      </div>
      <footer>↑ ↓ Navigate&nbsp;&nbsp; • &nbsp;&nbsp;X / A Select&nbsp;&nbsp; • &nbsp;&nbsp;Circle / B Back</footer>
    </section>
  );
}

function SettingsDetail(props: { title: string; subtitle: string; icon: JSX.Element; children: React.ReactNode }): JSX.Element {
  return <article className="console-settings-detail"><div className="settings-detail-title">{props.icon}<div><span>{props.subtitle}</span><h2>{props.title}</h2></div></div>{props.children}</article>;
}
