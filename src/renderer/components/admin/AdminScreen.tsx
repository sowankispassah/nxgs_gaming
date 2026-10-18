import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import {
  CircleArrowDown,
  Gamepad2,
  House,
  Monitor,
  Network,
  Palette,
  ScanSearch,
  Settings,
  Ticket,
  Timer,
  Wallet,
  type LucideIcon
} from 'lucide-react';
import type { AppSettings, DeviceRecord, GameRecord, InitialData } from '../../../shared/types';
import { useControllerNavigation, type ControllerNavigationEvent } from '../../controllerNavigation';
import { ControllerHints } from '../../ui/ControllerHints';
import { useAdminThemePreference, useResolvedAdminTheme, type AdminThemePreference } from '../../ui/preferences';
import { playUiSound } from '../../ui/uiSound';
import { BrandLogo } from '../BrandLogo';
import { DeviceManager } from '../DeviceManager';
import { PlanManager } from '../PlanManager';
import { AccountsPanel, DEFAULT_ACCOUNTS_VIEW, type AccountsView } from './AccountsPanel';
import { PageActionsProvider } from './AdminKit';
import { withAccountsScope } from './fleetFormat';
import { DeviceManagementPanel } from './DeviceManagementPanel';
import { GameManager, ScanPanel } from './GameLibraryPanels';
import { BrandingSettingsPanel, KioskSettingsPanel, SessionSettings } from './SettingsPanels';
import { UpdatePanel } from './UpdatePanel';
import { OwnerSessionChip, useOwnerSession } from './useOwnerSession';

type AdminTab = 'games' | 'scan' | 'sessions' | 'plans' | 'device' | 'branding' | 'kiosk' | 'updates' | 'accounts' | 'fleet';

/** Sidebar order (Library, This device, Business); arrow keys and the D-pad cycle through it. */
const ADMIN_TABS: AdminTab[] = ['games', 'scan', 'sessions', 'plans', 'device', 'branding', 'kiosk', 'updates', 'accounts', 'fleet'];

/** Data pages get the wide (1760px) container; every other page is a 1240px form page. */
const DATA_TABS: AdminTab[] = ['games', 'accounts', 'fleet'];

const PAGE_COPY: Record<AdminTab, { title: string; description: string }> = {
  games: {
    title: 'Games',
    description: 'Link installed games to this device and choose what customers see on Home.'
  },
  scan: {
    title: 'Scan for games',
    description: 'Detect games installed on this device and add them to the library.'
  },
  sessions: {
    title: 'Sessions and access',
    description: 'Choose how customers start playing and set the admin PIN.'
  },
  plans: {
    title: 'Plans',
    description: 'Play-time plans and prices offered to customers at checkout.'
  },
  device: {
    title: 'Device details',
    description: 'Identity, location and activity for this device.'
  },
  branding: {
    title: 'Branding',
    description: 'Set the logo shown across NXGS Play.'
  },
  // Shown as "System" (the internal id stays `kiosk`: tests, preferences and the settings page use it).
  kiosk: {
    title: 'System',
    description: 'Lockdown behavior, live diagnostics, local storage and exit.'
  },
  updates: {
    title: 'Updates',
    description: 'Check for new NXGS Play releases and install them on this device.'
  },
  accounts: {
    title: 'Accounts',
    description: 'Income from paid sessions and the games played in each.'
  },
  fleet: {
    title: 'All devices',
    description: 'Main admin tools for every device: details, games and moderators.'
  }
};

/** Arrow keys inside these regions (such as the earnings table) stay with the region instead of switching sections. */
const LOCAL_KEYS_SELECTOR = '[data-admin-local-keys]';
/** An open filter popover owns Escape/B (it closes itself) as well as the arrows. */
const POPOVER_SELECTOR = '[data-admin-popover]';
/** The theme switch in the sidebar footer: left/right (keys, D-pad) move between its options. */
const THEME_SWITCH_SELECTOR = '[data-admin-theme-switch]';

const THEME_OPTIONS: Array<{ value: AdminThemePreference; label: string }> = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' }
];

export function AdminScreen(props: {
  games: GameRecord[];
  settings: AppSettings;
  initialData: InitialData;
  onGamesChanged: (games: GameRecord[]) => void;
  onDeviceChanged: (device: DeviceRecord) => void;
  onSettingsChanged: (settings: AppSettings) => void;
  /** Who unlocked the Control Room; moderators cannot see or change the device admin PIN. */
  adminRole?: 'admin' | 'moderator';
  onClose: () => void;
}): JSX.Element {
  const [tab, setTab] = useState<AdminTab>('games');
  const [accountsView, setAccountsView] = useState<AccountsView>(DEFAULT_ACCOUNTS_VIEW);
  const owner = useOwnerSession();
  const [themePreference, setThemePreference] = useAdminThemePreference();
  const theme = useResolvedAdminTheme(themePreference);
  const [navFocused, setNavFocused] = useState(false);
  const [pageActionsTarget, setPageActionsTarget] = useState<HTMLElement | null>(null);
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
      if (event.key.startsWith('Arrow') && event.target instanceof Element && event.target.closest(LOCAL_KEYS_SELECTOR)) return;
      if (event.target instanceof Element && event.target.closest(POPOVER_SELECTOR)) return;
      event.preventDefault();
      if (event.key === 'Escape' || event.key.toLowerCase() === 'b') closeAdmin();
      else moveAdminTab(event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeAdmin, moveAdminTab]);

  const handleAdminControllerEvent = useCallback((event: ControllerNavigationEvent): void => {
    const focused = document.activeElement;
    const themeOption = focused instanceof HTMLElement && focused.closest(THEME_SWITCH_SELECTOR) ? focused : null;
    if (event.type === 'back') {
      closeAdmin();
    } else if (event.type === 'accept') {
      themeOption?.click();
    } else if (event.type === 'direction') {
      if (themeOption && (event.direction === 'left' || event.direction === 'right')) {
        stepThemeSwitch(themeOption, event.direction === 'left' ? -1 : 1);
      } else {
        moveAdminTab(event.direction === 'left' || event.direction === 'up' ? -1 : 1);
      }
    }
  }, [closeAdmin, moveAdminTab]);

  useControllerNavigation(true, handleAdminControllerEvent);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [tab]);

  // The main admin session never outlives the Control Room.
  useEffect(() => () => {
    void window.nxgs.lockOwner().catch(() => undefined);
  }, []);

  // Locked (or the PIN prompt was cancelled): every-device earnings go back to this device.
  useEffect(() => {
    if (!owner.unlocked && !owner.prompting && accountsView.scope === 'all') {
      setAccountsView((current) => withAccountsScope(current, 'device'));
    }
  }, [accountsView.scope, owner.prompting, owner.unlocked]);

  const viewStationEarnings = useCallback((stationId: string): void => {
    setAccountsView((current) => ({ ...withAccountsScope(current, 'all'), stationIds: [stationId] }));
    setTab('accounts');
  }, []);

  useEffect(() => {
    if (!navFocused) return;
    navRef.current?.querySelector<HTMLButtonElement>(`[data-admin-tab="${tab}"]`)?.focus({ preventScroll: true });
  }, [navFocused, tab]);

  const page = PAGE_COPY[tab];
  const stationName = props.initialData.currentDevice.name;
  const tabFocus = (id: AdminTab): boolean => navFocused && tab === id;
  // Main admin pages cover every device, so they say so instead of naming this one.
  const ownerView = tab === 'fleet' || (tab === 'accounts' && accountsView.scope === 'all');
  const tabProps = (id: AdminTab) => ({
    id,
    active: tab === id,
    focused: tabFocus(id),
    onClick: () => setTab(id)
  });

  return (
    <section className="admin-screen" data-admin-theme={theme} spellCheck={false} onPointerDown={() => setNavFocused(false)}>
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <BrandLogo className="admin-brand-logo" logoPath={props.settings.branding.logoPath} />
          <div className="admin-brand-copy">
            <p className="admin-brand-title">Control Room</p>
            <p className="admin-brand-station" title={stationName}>{stationName}</p>
          </div>
        </div>
        <nav ref={navRef} aria-label="Control Room sections">
          <NavGroup label="Library">
            <TabButton {...tabProps('games')} label="Games" icon={Gamepad2} />
            <TabButton {...tabProps('scan')} label="Scan" icon={ScanSearch} />
          </NavGroup>
          <NavGroup label="This device">
            <TabButton {...tabProps('sessions')} label="Sessions" icon={Timer} />
            <TabButton {...tabProps('plans')} label="Plans" icon={Ticket} />
            <TabButton {...tabProps('device')} label="Details" icon={Monitor} />
            <TabButton {...tabProps('branding')} label="Branding" icon={Palette} />
            <TabButton {...tabProps('kiosk')} label="System" icon={Settings} />
            <TabButton {...tabProps('updates')} label="Updates" icon={CircleArrowDown} />
          </NavGroup>
          <NavGroup label="Business">
            <TabButton {...tabProps('accounts')} label="Accounts" icon={Wallet} />
            <TabButton {...tabProps('fleet')} label="All devices" icon={Network} />
          </NavGroup>
        </nav>
        <div className="admin-sidebar-footer" onFocus={() => setNavFocused(false)}>
          <AdminThemeSwitch value={themePreference} onChange={setThemePreference} />
          <button className="admin-home-button" type="button" onClick={props.onClose}>
            <House className="admin-nav-icon" aria-hidden="true" />
            <span className="admin-nav-label">Back to Home</span>
          </button>
          <ControllerHints
            className="admin-hints"
            hints={[
              { glyph: 'dpad-vertical', label: 'Section' },
              { glyph: 'circle', label: 'Home' }
            ]}
          />
        </div>
      </aside>

      <div className="admin-content" ref={contentRef} onFocus={() => setNavFocused(false)}>
        {/*
          * The header stays mounted across tabs so <PageActions> always has the same slot.
          * Its first row (title + actions) is the sticky page bar; the description and
          * scope note scroll away under it.
          */}
        <div className={`admin-page${DATA_TABS.includes(tab) ? ' admin-page--data' : ''}`}>
          <header className="admin-page-header">
            <h1>{page.title}</h1>
            <div className="admin-page-actions">
              <div className="admin-page-actions-slot" ref={setPageActionsTarget} />
              {ownerView ? (
                owner.unlocked && <OwnerSessionChip onLock={() => void owner.lock()} />
              ) : null}
            </div>
          </header>
          <div className="admin-page-intro">
            <p className="admin-page-description">{page.description}</p>
            <p className="admin-page-scope">
              {ownerView
                ? tab === 'accounts' ? 'Earnings from every device' : 'Covers every device'
                : tab === 'accounts' ? `Earnings from ${stationName}` : `Applies to ${stationName}`}
            </p>
          </div>

          {/* Keyed by tab so each section fades in when it opens. */}
          <div className="admin-page-body" key={tab}>
            <PageActionsProvider value={pageActionsTarget}>
              {tab === 'games' && <GameManager currentDevice={props.initialData.currentDevice} games={props.games} onGamesChanged={props.onGamesChanged} />}
              {tab === 'scan' && <ScanPanel currentDevice={props.initialData.currentDevice} onGamesChanged={props.onGamesChanged} />}
              {tab === 'sessions' && (
                <SessionSettings
                  settings={props.settings}
                  adminRole={props.adminRole ?? 'admin'}
                  onSettingsChanged={props.onSettingsChanged}
                  onOpenPlans={() => setTab('plans')}
                />
              )}
              {tab === 'plans' && <PlanManager currentDevice={props.initialData.currentDevice} />}
              {tab === 'device' && <DeviceManager onDeviceChanged={props.onDeviceChanged} owner={owner} />}
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
              {tab === 'accounts' && (
                <AccountsPanel
                  view={accountsView}
                  onViewChange={setAccountsView}
                  owner={owner}
                  currentDevice={props.initialData.currentDevice}
                />
              )}
              {tab === 'fleet' && <DeviceManagementPanel owner={owner} onViewEarnings={viewStationEarnings} />}
            </PageActionsProvider>
          </div>
        </div>
      </div>
      {owner.dialog}
    </section>
  );
}

/**
 * A sidebar group: a non-interactive section label (small uppercase caption,
 * not focusable, no hover) above its nav items. Items carry icons; labels do not.
 */
function NavGroup(props: { label: string; children: ReactNode }): JSX.Element {
  const labelId = useId();
  return (
    <div className="admin-nav-group" role="group" aria-labelledby={labelId}>
      <p className="admin-nav-group-label" id={labelId}>{props.label}</p>
      {props.children}
    </div>
  );
}

function TabButton(props: {
  id: AdminTab;
  active: boolean;
  focused: boolean;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}): JSX.Element {
  const classes = [props.active ? 'active' : '', props.focused ? 'controller-focused' : ''].filter(Boolean).join(' ');
  const Icon = props.icon;
  return (
    <button
      className={classes || undefined}
      type="button"
      data-admin-tab={props.id}
      aria-current={props.active ? 'page' : undefined}
      onClick={props.onClick}
    >
      <Icon className="admin-nav-icon" aria-hidden="true" />
      <span className="admin-nav-label">{props.label}</span>
    </button>
  );
}

/** Moves focus to the next/previous theme option and picks it (radio behaviour). */
function stepThemeSwitch(from: HTMLElement, delta: number): void {
  const options = Array.from(from.closest(THEME_SWITCH_SELECTOR)?.querySelectorAll<HTMLButtonElement>('button') ?? []);
  const index = options.indexOf(from as HTMLButtonElement);
  if (index < 0) return;
  const next = options[Math.min(options.length - 1, Math.max(0, index + delta))];
  if (!next || next === from) return;
  playUiSound('move');
  next.focus({ preventScroll: true });
  next.click();
}

/**
 * Control Room theme: Dark, Light or System, per station (ui/preferences.ts).
 * A radio group: Tab reaches the chosen option, left/right (keys or D-pad)
 * move and pick, Enter/Space/A pick. The arrows stay inside it
 * (data-admin-local-keys), so they do not switch sections from here.
 */
export function AdminThemeSwitch(props: { value: AdminThemePreference; onChange: (value: AdminThemePreference) => void }): JSX.Element {
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      stepThemeSwitch(event.currentTarget, event.key === 'ArrowLeft' ? -1 : 1);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      stepThemeSwitch(event.currentTarget, event.key === 'Home' ? -THEME_OPTIONS.length : THEME_OPTIONS.length);
    }
  };
  return (
    <div
      className="admin-segmented admin-theme-switch"
      role="radiogroup"
      aria-label="Control Room theme"
      data-admin-theme-switch="true"
      data-admin-local-keys="true"
    >
      {THEME_OPTIONS.map((option) => {
        const checked = option.value === props.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            title={option.value === 'system' ? 'Follow the Windows app theme' : undefined}
            onKeyDown={onKeyDown}
            onClick={() => {
              if (!checked) props.onChange(option.value);
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
