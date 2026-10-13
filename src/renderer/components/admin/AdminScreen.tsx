import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Gamepad2,
  House,
  Image as ImageIcon,
  IndianRupee,
  MonitorCog,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  Timer
} from 'lucide-react';
import type { AppSettings, DeviceRecord, GameRecord, InitialData } from '../../../shared/types';
import { useControllerNavigation, type ControllerNavigationEvent } from '../../controllerNavigation';
import { ControllerHints } from '../../ui/ControllerHints';
import { playUiSound } from '../../ui/uiSound';
import { BrandLogo } from '../BrandLogo';
import { DeviceManager } from '../DeviceManager';
import { PlanManager } from '../PlanManager';
import { GameManager, ScanPanel } from './GameLibraryPanels';
import { BrandingSettingsPanel, KioskSettingsPanel, SessionSettings } from './SettingsPanels';
import { UpdatePanel } from './UpdatePanel';

type AdminTab = 'games' | 'scan' | 'sessions' | 'branding' | 'kiosk' | 'updates' | 'plans' | 'device';

const ADMIN_TABS: AdminTab[] = ['games', 'scan', 'sessions', 'branding', 'kiosk', 'updates', 'plans', 'device'];

const SINGLE_COLUMN_TABS: AdminTab[] = ['scan', 'sessions', 'branding', 'updates'];

const PAGE_COPY: Record<AdminTab, { title: string; description: string }> = {
  games: {
    title: 'Game Library',
    description: 'Link installed games to this station and choose what customers see on Home.'
  },
  scan: {
    title: 'Scan for Games',
    description: 'Detect games installed on this station and add them to the library.'
  },
  sessions: {
    title: 'Sessions & Access',
    description: 'Choose how customers start playing and set the admin PIN.'
  },
  branding: {
    title: 'Branding',
    description: 'Set the logo shown across NXGS Play.'
  },
  kiosk: {
    title: 'Kiosk & Diagnostics',
    description: 'Lockdown behavior, live station diagnostics, local storage and exit.'
  },
  updates: {
    title: 'Updates',
    description: 'Check for new NXGS Play releases and install them on this station.'
  },
  plans: {
    title: 'Plan Manager',
    description: 'Play-time plans and prices offered to customers at checkout.'
  },
  device: {
    title: 'Device Manager',
    description: 'Identity, location and activity for this station.'
  }
};

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
  const [navFocused, setNavFocused] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;

  const moveAdminTab = useCallback((delta: number): void => {
    setTab((current) => ADMIN_TABS[(ADMIN_TABS.indexOf(current) + delta + ADMIN_TABS.length) % ADMIN_TABS.length]);
    setNavFocused(true);
    playUiSound('move');
  }, []);

  const closeAdmin = useCallback((): void => {
    playUiSound('back');
    onCloseRef.current();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Escape', 'b', 'B'].includes(event.key)) return;
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      event.preventDefault();
      if (event.key === 'Escape' || event.key.toLowerCase() === 'b') closeAdmin();
      else moveAdminTab(event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeAdmin, moveAdminTab]);

  const handleAdminControllerEvent = useCallback((event: ControllerNavigationEvent): void => {
    if (event.type === 'back') {
      closeAdmin();
    } else if (event.type === 'direction') {
      moveAdminTab(event.direction === 'left' || event.direction === 'up' ? -1 : 1);
    }
  }, [closeAdmin, moveAdminTab]);

  useControllerNavigation(true, handleAdminControllerEvent);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [tab]);

  useEffect(() => {
    if (!navFocused) return;
    navRef.current?.querySelector<HTMLButtonElement>(`[data-admin-tab="${tab}"]`)?.focus({ preventScroll: true });
  }, [navFocused, tab]);

  const page = PAGE_COPY[tab];
  const tabFocus = (id: AdminTab): boolean => navFocused && tab === id;

  return (
    <section className="admin-screen" spellCheck={false} onPointerDown={() => setNavFocused(false)}>
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <BrandLogo className="admin-brand-logo" logoPath={props.settings.branding.logoPath} />
          <div className="admin-brand-copy">
            <p className="eyebrow">Admin mode</p>
            <p className="admin-brand-title">Control Room</p>
          </div>
        </div>
        <nav ref={navRef} aria-label="Control Room sections">
          <TabButton id="games" active={tab === 'games'} focused={tabFocus('games')} icon={<Gamepad2 size={19} />} label="Games" onClick={() => setTab('games')} />
          <TabButton id="scan" active={tab === 'scan'} focused={tabFocus('scan')} icon={<ScanSearch size={19} />} label="Scan" onClick={() => setTab('scan')} />
          <TabButton id="sessions" active={tab === 'sessions'} focused={tabFocus('sessions')} icon={<Timer size={19} />} label="Sessions" onClick={() => setTab('sessions')} />
          <TabButton id="branding" active={tab === 'branding'} focused={tabFocus('branding')} icon={<ImageIcon size={19} />} label="Branding" onClick={() => setTab('branding')} />
          <TabButton id="kiosk" active={tab === 'kiosk'} focused={tabFocus('kiosk')} icon={<ShieldCheck size={19} />} label="Kiosk" onClick={() => setTab('kiosk')} />
          <TabButton id="updates" active={tab === 'updates'} focused={tabFocus('updates')} icon={<RefreshCw size={19} />} label="Updates" onClick={() => setTab('updates')} />
          <TabButton id="plans" active={tab === 'plans'} focused={tabFocus('plans')} icon={<IndianRupee size={19} />} label="Plan Manager" onClick={() => setTab('plans')} />
          <TabButton id="device" active={tab === 'device'} focused={tabFocus('device')} icon={<MonitorCog size={19} />} label="Device Manager" onClick={() => setTab('device')} />
        </nav>
        <div className="admin-sidebar-footer">
          <ControllerHints
            className="admin-hints"
            hints={[
              { glyph: 'dpad-vertical', label: 'Section' },
              { glyph: 'circle', label: 'Home' }
            ]}
          />
          <button className="secondary-action admin-home-button" type="button" onClick={props.onClose}>
            <House size={19} />
            Home
          </button>
        </div>
      </aside>

      <div className="admin-content" ref={contentRef} onFocus={() => setNavFocused(false)}>
        <div className={`admin-page${SINGLE_COLUMN_TABS.includes(tab) ? ' admin-page--single' : ''}`} key={tab}>
          <header className="admin-page-header">
            <div className="admin-page-heading">
              <h1>{page.title}</h1>
              <p className="admin-page-description">{page.description}</p>
            </div>
            <span className="admin-station-chip" title="Changes on this page apply to this station">
              <MonitorCog size={17} aria-hidden="true" />
              <span>{props.initialData.currentDevice.name}</span>
            </span>
          </header>

          {tab === 'games' && <GameManager currentDevice={props.initialData.currentDevice} games={props.games} onGamesChanged={props.onGamesChanged} />}
          {tab === 'scan' && <ScanPanel currentDevice={props.initialData.currentDevice} onGamesChanged={props.onGamesChanged} />}
          {tab === 'sessions' && (
            <SessionSettings
              settings={props.settings}
              onSettingsChanged={props.onSettingsChanged}
              onOpenPlans={() => setTab('plans')}
            />
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
      </div>
    </section>
  );
}

function TabButton(props: {
  id: AdminTab;
  active: boolean;
  focused: boolean;
  icon: JSX.Element;
  label: string;
  onClick: () => void;
}): JSX.Element {
  const classes = [props.active ? 'active' : '', props.focused ? 'controller-focused' : ''].filter(Boolean).join(' ');
  return (
    <button
      className={classes || undefined}
      type="button"
      data-admin-tab={props.id}
      aria-current={props.active ? 'page' : undefined}
      onClick={props.onClick}
    >
      <span className="admin-nav-icon" aria-hidden="true">{props.icon}</span>
      <span className="admin-nav-label">{props.label}</span>
    </button>
  );
}
