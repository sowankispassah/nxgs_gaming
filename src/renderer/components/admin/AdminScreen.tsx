import { useCallback, useEffect, useState } from 'react';
import {
  Gamepad2,
  Home,
  Image as ImageIcon,
  IndianRupee,
  Monitor,
  MonitorCog,
  RefreshCw,
  Search,
  Timer
} from 'lucide-react';
import type { AppSettings, DeviceRecord, GameRecord, InitialData } from '../../../shared/types';
import { useControllerNavigation, type ControllerNavigationEvent } from '../../controllerNavigation';
import { BrandLogo } from '../BrandLogo';
import { DeviceManager } from '../DeviceManager';
import { PlanManager } from '../PlanManager';
import { GameManager, ScanPanel } from './GameLibraryPanels';
import { BrandingSettingsPanel, KioskSettingsPanel, SessionSettings } from './SettingsPanels';
import { UpdatePanel } from './UpdatePanel';

type AdminTab = 'games' | 'scan' | 'sessions' | 'branding' | 'kiosk' | 'updates' | 'plans' | 'device';

export function AdminScreen(props: {
  games: GameRecord[];
  settings: AppSettings;
  initialData: InitialData;
  onGamesChanged: (games: GameRecord[]) => void;
  onDeviceChanged: (device: DeviceRecord) => void;
  onSettingsChanged: (settings: AppSettings) => void;
  onClose: () => void;
}): JSX.Element {
  const [tab, setTab] = useState<AdminTab>('games');
  const adminTabs: AdminTab[] = ['games', 'scan', 'sessions', 'branding', 'kiosk', 'updates', 'plans', 'device'];
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
          <BrandLogo className="admin-brand-logo" logoPath={props.settings.branding.logoPath} />
          <p className="eyebrow">Admin mode</p>
          <h1>Settings</h1>
        </div>
        <nav>
          <TabButton active={tab === 'games'} icon={<Gamepad2 size={19} />} label="Games" onClick={() => setTab('games')} />
          <TabButton active={tab === 'scan'} icon={<Search size={19} />} label="Scan" onClick={() => setTab('scan')} />
          <TabButton active={tab === 'sessions'} icon={<Timer size={19} />} label="Sessions" onClick={() => setTab('sessions')} />
          <TabButton active={tab === 'branding'} icon={<ImageIcon size={19} />} label="Branding" onClick={() => setTab('branding')} />
          <TabButton active={tab === 'kiosk'} icon={<Monitor size={19} />} label="Kiosk" onClick={() => setTab('kiosk')} />
          <TabButton active={tab === 'updates'} icon={<RefreshCw size={19} />} label="Updates" onClick={() => setTab('updates')} />
          <TabButton active={tab === 'plans'} icon={<IndianRupee size={19} />} label="Plan Manager" onClick={() => setTab('plans')} />
          <TabButton active={tab === 'device'} icon={<MonitorCog size={19} />} label="Device Manager" onClick={() => setTab('device')} />
        </nav>
        <button className="secondary-action" type="button" onClick={props.onClose}>
          <Home size={18} />
          Home
        </button>
      </aside>

      <div className="admin-content">
        {tab === 'games' && <GameManager currentDevice={props.initialData.currentDevice} games={props.games} onGamesChanged={props.onGamesChanged} />}
        {tab === 'scan' && <ScanPanel currentDevice={props.initialData.currentDevice} onGamesChanged={props.onGamesChanged} />}
        {tab === 'sessions' && (
          <SessionSettings settings={props.settings} onSettingsChanged={props.onSettingsChanged} />
        )}
        {tab === 'branding' && (
          <BrandingSettingsPanel settings={props.settings} onSettingsChanged={props.onSettingsChanged} />
        )}
        {tab === 'kiosk' && (
          <KioskSettingsPanel
            settings={props.settings}
            initialData={props.initialData}
            onSettingsChanged={props.onSettingsChanged}
          />
        )}
        {tab === 'updates' && <UpdatePanel initialData={props.initialData} />}
        {tab === 'plans' && <PlanManager currentDevice={props.initialData.currentDevice} />}
        {tab === 'device' && <DeviceManager onDeviceChanged={props.onDeviceChanged} />}
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
