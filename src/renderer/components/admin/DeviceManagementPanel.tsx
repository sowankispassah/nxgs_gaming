import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  Gamepad2,
  IndianRupee,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  MonitorCog,
  Network,
  RefreshCw,
  Save,
  Search,
  Store
} from 'lucide-react';
import type { FleetStation, ModeratorRecord } from '../../../shared/types';
import { CardHeader, EmptyState, LoadingState, Notice, revealInContent, type NoticeTone } from './AdminKit';
import { FleetStationPanel } from './FleetStationPanel';
import { FleetSyncCard } from './FleetSyncCard';
import {
  filterFleetStations,
  formatPaise,
  PIN_PATTERN,
  relativeTime,
  storeNames,
  toggleValue,
  type FleetStationState
} from './fleetFormat';
import { ModeratorsSection } from './ModeratorEditor';
import { OWNER_PIN_MESSAGES, type OwnerSession } from './useOwnerSession';

type Access = 'checking' | 'locked' | 'open';

const STATE_FILTERS: Array<{ id: FleetStationState; label: string }> = [
  { id: 'active', label: 'Active' },
  { id: 'inactive', label: 'Inactive' },
  { id: 'removed', label: 'Removed' }
];

/** Removed devices last; otherwise the cloud's order (most recently seen first). */
function sortStations(stations: FleetStation[]): FleetStation[] {
  return [...stations].sort((left, right) => Number(Boolean(left.removedAt)) - Number(Boolean(right.removedAt)));
}

/**
 * The "All Devices" tab: the main admin's view of every station. Everything
 * here needs the main admin PIN; cancelling the prompt leaves a locked card.
 */
export function DeviceManagementPanel(props: {
  owner: OwnerSession;
  onViewEarnings: (stationId: string) => void;
}): JSX.Element {
  const { owner } = props;
  const [access, setAccess] = useState<Access>('checking');
  const [stations, setStations] = useState<FleetStation[] | null>(null);
  const [moderators, setModerators] = useState<ModeratorRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [moderatorError, setModeratorError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [listNotice, setListNotice] = useState('');
  // Device list filters; kept here so they survive opening a device and coming back.
  const [deviceSearch, setDeviceSearch] = useState('');
  const [deviceStates, setDeviceStates] = useState<FleetStationState[]>([]);
  const [deviceStore, setDeviceStore] = useState('');
  const moderatorsRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLElement>(null);

  const unlock = useCallback(async (): Promise<void> => {
    setAccess('checking');
    const unlocked = await owner.ensureUnlocked(OWNER_PIN_MESSAGES.fleet);
    setAccess(unlocked ? 'open' : 'locked');
  }, [owner.ensureUnlocked]);

  useEffect(() => {
    void unlock();
  }, [unlock]);

  // Lock pressed, or the session ended and the new prompt was cancelled.
  useEffect(() => {
    if (access === 'open' && !owner.unlocked && !owner.prompting) setAccess('locked');
  }, [access, owner.prompting, owner.unlocked]);

  const loadAll = useCallback(async (): Promise<void> => {
    setLoading(true);
    setListError('');
    setModeratorError('');
    try {
      const [stationResult, moderatorResult] = await Promise.all([
        owner.run(() => window.nxgs.listFleetStations()),
        owner.run(() => window.nxgs.listModerators())
      ]);
      if (stationResult.ok && stationResult.data) setStations(sortStations(stationResult.data));
      else if (stationResult.code !== 'owner_pin_required') setListError(stationResult.error ?? 'Could not load devices.');
      if (moderatorResult.ok && moderatorResult.data) setModerators(moderatorResult.data);
      else if (moderatorResult.code !== 'owner_pin_required') setModeratorError(moderatorResult.error ?? 'Could not load moderators.');
    } catch (error) {
      setListError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [owner.run]);

  useEffect(() => {
    if (access === 'open') void loadAll();
  }, [access, loadAll]);

  const replaceStation = (station: FleetStation): void => {
    setStations((current) => current && sortStations(current.map((item) => (item.id === station.id ? station : item))));
  };

  if (access === 'checking') {
    return (
      <section className="admin-card admin-loading-card">
        <LoadingState label="Checking main admin..." />
      </section>
    );
  }

  if (access === 'locked') {
    return (
      <section className="admin-card fleet-locked-card">
        <EmptyState icon={<LockKeyhole size={28} />} title="Main admin PIN needed">
          Device Management shows every device, their games and moderators. Enter the main admin PIN to continue.
        </EmptyState>
        <button className="primary-action" type="button" disabled={owner.prompting} onClick={() => void unlock()}>
          <LockKeyhole size={18} />
          Unlock
        </button>
      </section>
    );
  }

  const selected = stations?.find((station) => station.id === selectedId);
  const stores = storeNames(stations ?? []);
  const visibleStations = filterFleetStations(stations ?? [], { search: deviceSearch, states: deviceStates, store: deviceStore });
  const listFiltered = Boolean(deviceSearch.trim() || deviceStates.length || deviceStore);
  const clearDeviceFilters = (): void => {
    setDeviceSearch('');
    setDeviceStates([]);
    setDeviceStore('');
  };

  return (
    <div className="fleet-page admin-stack">
      {selectedId ? (
        <FleetStationPanel
          stationId={selectedId}
          summary={selected}
          moderators={moderators}
          owner={owner}
          onBack={() => {
            setSelectedId('');
            window.requestAnimationFrame(() => revealInContent(listRef.current));
          }}
          onStationChanged={replaceStation}
          onRemoved={(stationId) => {
            setSelectedId('');
            setListNotice('Device removed. Its sessions and earnings stay in Accounts.');
            setModerators((current) => current && current.map((moderator) => ({
              ...moderator,
              stationIds: moderator.stationIds.filter((id) => id !== stationId)
            })));
            void loadAll();
          }}
          onViewEarnings={props.onViewEarnings}
          onManageModerators={() => revealInContent(moderatorsRef.current)}
        />
      ) : (
        <section className="admin-card fleet-stations-card" ref={listRef}>
          <CardHeader
            eyebrow="Every device"
            title="Devices"
            subtitle="Pick a device to see its games, edit its details or remove it."
            icon={<Network size={20} />}
            actions={(
              <>
                {stations && <span className="ps-chip admin-count-chip">{stations.filter((station) => !station.removedAt).length} active</span>}
                <button className="secondary-action compact" type="button" disabled={loading} onClick={() => void loadAll()}>
                  {loading ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
                  Refresh
                </button>
              </>
            )}
          />
          {listNotice && <Notice tone="success" className="fleet-list-notice">{listNotice}</Notice>}
          {listError && <Notice tone="error" className="fleet-list-notice">{listError}</Notice>}
          {!stations && loading && <LoadingState label="Loading devices..." />}
          {stations && stations.length === 0 && (
            <EmptyState icon={<MonitorCog size={28} />} title="No devices yet">
              Devices appear here after they sync for the first time.
            </EmptyState>
          )}
          {stations && stations.length > 0 && (
            <div className="fleet-list-filters">
              <label className="admin-field fleet-list-search">
                <span className="admin-section-title">Search</span>
                <span className="admin-affix-input">
                  <Search size={17} aria-hidden="true" />
                  <input
                    type="search"
                    value={deviceSearch}
                    placeholder="Name, store, location or device ID"
                    aria-label="Search devices"
                    onChange={(event) => setDeviceSearch(event.target.value)}
                    onKeyDown={(event) => {
                      // Escape clears the search first; only an empty box lets Escape leave the Control Room.
                      if (event.key === 'Escape' && deviceSearch) {
                        event.preventDefault();
                        event.stopPropagation();
                        setDeviceSearch('');
                      }
                    }}
                  />
                </span>
              </label>
              <div className="accounts-filter-group">
                <span className="admin-section-title">Status</span>
                <div className="admin-chip-toggles" role="group" aria-label="Device status">
                  {STATE_FILTERS.map((state) => (
                    <button
                      key={state.id}
                      className="admin-chip-toggle"
                      type="button"
                      aria-pressed={deviceStates.includes(state.id)}
                      onClick={() => setDeviceStates((current) => toggleValue(current, state.id))}
                    >
                      {state.label}
                    </button>
                  ))}
                </div>
              </div>
              {stores.length > 1 && (
                <label className="admin-field fleet-list-store">
                  <span className="admin-section-title">Store</span>
                  <span className="admin-affix-input accounts-sort-input">
                    <Store size={16} aria-hidden="true" />
                    <select value={deviceStore} aria-label="Store" onChange={(event) => setDeviceStore(event.target.value)}>
                      <option value="">All stores</option>
                      {stores.map((store) => <option key={store} value={store}>{store}</option>)}
                    </select>
                  </span>
                </label>
              )}
              <div className="accounts-active-filters fleet-list-count">
                <span className="accounts-result-count">
                  {listFiltered
                    ? `Showing ${visibleStations.length} of ${stations.length} devices`
                    : `Showing all ${stations.length} ${stations.length === 1 ? 'device' : 'devices'}`}
                </span>
                {listFiltered && (
                  <button className="secondary-action compact" type="button" onClick={clearDeviceFilters}>
                    Clear filters
                  </button>
                )}
              </div>
            </div>
          )}
          {stations && stations.length > 0 && visibleStations.length === 0 && (
            <EmptyState icon={<Search size={28} />} title="No devices match these filters">
              <button className="secondary-action compact" type="button" onClick={clearDeviceFilters}>
                Clear filters
              </button>
            </EmptyState>
          )}
          {visibleStations.length > 0 && (
            <ul className="fleet-station-grid">
              {visibleStations.map((station) => (
                <li key={station.id}>
                  <StationCard
                    station={station}
                    onSelect={() => {
                      setListNotice('');
                      setSelectedId(station.id);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div ref={moderatorsRef} className="fleet-moderators-anchor">
        <ModeratorsSection
          owner={owner}
          stations={stations ?? []}
          stationsReady={stations !== null && !listError}
          stationsError={listError}
          moderators={moderators}
          loadError={moderatorError}
          loading={loading}
          onModeratorsChanged={setModerators}
        />
      </div>

      <div className="admin-columns fleet-settings-grid">
        <OwnerPinCard owner={owner} />
        <FleetSyncCard owner={owner} eyebrow="This device" />
      </div>
    </div>
  );
}

function StationCard(props: { station: FleetStation; onSelect: () => void }): JSX.Element {
  const { station } = props;
  const place = [station.storeName, station.location].filter(Boolean).join(' · ');
  const removed = Boolean(station.removedAt);
  return (
    <button className={`fleet-station-card${removed ? ' is-removed' : ''}`} type="button" onClick={props.onSelect}>
      <span className="fleet-station-head">
        <strong>{station.name || 'Unnamed device'}</strong>
        {station.isCurrentDevice && <span className="ps-chip ps-chip--accent">This device</span>}
      </span>
      <span className="fleet-station-place">{place || 'Store and location not set'}</span>
      <span className="fleet-station-chips">
        {removed ? (
          <span className="ps-chip ps-chip--danger">Removed</span>
        ) : (
          <span className={`ps-chip device-status-pill ${station.status === 'active' ? 'ps-chip--success' : ''}`}>
            {station.status === 'active' ? 'Active' : 'Inactive'}
          </span>
        )}
        {station.appVersion && <span className="ps-chip">v{station.appVersion}</span>}
      </span>
      <span className="fleet-station-stats">
        <span><Gamepad2 size={15} aria-hidden="true" />{station.gameCount} {station.gameCount === 1 ? 'game' : 'games'}</span>
        <span><Activity size={15} aria-hidden="true" />{station.sessionCount} {station.sessionCount === 1 ? 'session' : 'sessions'}</span>
        <span><IndianRupee size={15} aria-hidden="true" />{formatPaise(station.totalRevenuePaise)}</span>
      </span>
      <span className="fleet-station-seen">
        {removed ? `Removed ${relativeTime(station.removedAt).toLowerCase()}` : `Last seen ${relativeTime(station.lastSeenAt).toLowerCase()}`}
      </span>
    </button>
  );
}

function OwnerPinCard(props: { owner: OwnerSession }): JSX.Element {
  const [currentPin, setCurrentPin] = useState('');
  const [nextPin, setNextPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);

  const changePin = async (): Promise<void> => {
    if (saving) return;
    if (!PIN_PATTERN.test(currentPin)) {
      setNotice({ tone: 'error', text: 'Enter the current main admin PIN (4 to 12 digits).' });
      return;
    }
    if (!PIN_PATTERN.test(nextPin)) {
      setNotice({ tone: 'error', text: 'The new PIN must be 4 to 12 digits.' });
      return;
    }
    if (nextPin !== confirmPin) {
      setNotice({ tone: 'error', text: 'The new PIN and the confirmation do not match.' });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const result = await props.owner.run(() => window.nxgs.changeOwnerPin(currentPin, nextPin));
      if (result.ok) {
        setCurrentPin('');
        setNextPin('');
        setConfirmPin('');
        setNotice({ tone: 'success', text: 'Main admin PIN changed. Other main admin sessions were signed out.' });
      } else if (result.code !== 'owner_pin_required') {
        setNotice({ tone: 'error', text: result.error ?? 'Could not change the main admin PIN.' });
      }
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  };

  const pinInput = (value: string, onChange: (value: string) => void, label: string): JSX.Element => (
    <label className="admin-field">
      <span className="admin-field-label">{label}</span>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={12}
        value={value}
        disabled={saving}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, ''))}
      />
    </label>
  );

  return (
    <section className="admin-card fleet-owner-pin-card">
      <CardHeader
        eyebrow="Main admin"
        title="Main admin PIN"
        subtitle="Unlocks Accounts for every device and this page. It is separate from each device's admin PIN."
        icon={<KeyRound size={20} />}
      />
      <form
        className="admin-form fleet-owner-pin-form"
        onSubmit={(event) => {
          event.preventDefault();
          void changePin();
        }}
      >
        {pinInput(currentPin, setCurrentPin, 'Current PIN')}
        <div className="form-grid">
          {pinInput(nextPin, setNextPin, 'New PIN')}
          {pinInput(confirmPin, setConfirmPin, 'Confirm new PIN')}
        </div>
        <small className="field-note">Use 6 or more digits. Any PIN of 4 to 12 digits is accepted.</small>
        <footer className="admin-card-footer admin-card-footer--stacked">
          {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
          <button className="primary-action wide" type="submit" disabled={saving}>
            {saving ? <LoaderCircle className="spin" size={19} /> : <Save size={19} />}
            {saving ? 'Saving...' : 'Change PIN'}
          </button>
        </footer>
      </form>
    </section>
  );
}
