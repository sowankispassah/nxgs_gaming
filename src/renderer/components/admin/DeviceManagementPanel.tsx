import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronRight, Lock, RefreshCw, Search } from 'lucide-react';
import type { FleetStation, ModeratorRecord } from '../../../shared/types';
import {
  Badge,
  EmptyState,
  Field,
  LoadingState,
  Notice,
  PageActions,
  PageSection,
  Panel,
  revealInContent,
  StatusText,
  ToggleChip,
  Toolbar,
  ToolbarSpacer,
  type NoticeTone
} from './AdminKit';
import { FleetStationPanel } from './FleetStationPanel';
import { FleetSyncCard } from './FleetSyncCard';
import {
  dateTimeLabel,
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
 * The "All devices" tab: the main admin's view of every device. Everything
 * here needs the main admin PIN; cancelling the prompt leaves a short locked message.
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
  const listRef = useRef<HTMLDivElement>(null);

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
    return <LoadingState label="Checking main admin..." />;
  }

  if (access === 'locked') {
    return (
      // The same shape as every empty state on this page: a panel in the content's place, the outline lock above the title.
      <Panel className="fleet-locked">
        <EmptyState
          icon={<Lock />}
          title="Main admin PIN needed"
          action={(
            <button className="admin-btn admin-btn--primary" type="button" disabled={owner.prompting} onClick={() => void unlock()}>
              Unlock
            </button>
          )}
        >
          This page shows every device, its games and moderators. Enter the main admin PIN to continue.
        </EmptyState>
      </Panel>
    );
  }

  const selected = stations?.find((station) => station.id === selectedId);
  const stores = storeNames(stations ?? []);
  const visibleStations = filterFleetStations(stations ?? [], { search: deviceSearch, states: deviceStates, store: deviceStore });
  const listFiltered = Boolean(deviceSearch.trim() || deviceStates.length || deviceStore);
  const activeCount = (stations ?? []).filter((station) => !station.removedAt).length;
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
          onManageModerators={() => {
            // Moderators live on the list page: go back and bring them into view.
            setSelectedId('');
            window.requestAnimationFrame(() => moderatorsRef.current?.scrollIntoView({ block: 'start' }));
          }}
        />
      ) : (
        <div ref={listRef} className="fleet-list-anchor">
          <PageActions>
            <button className="admin-btn" type="button" disabled={loading} onClick={() => void loadAll()}>
              <RefreshCw aria-hidden="true" />
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </PageActions>
          <PageSection
            title="Devices"
            description="Pick a device to see its games, edit its details or remove it."
            className="fleet-stations"
          >
            {listNotice && <Notice tone="success">{listNotice}</Notice>}
            {listError && <Notice tone="error">{listError}</Notice>}
            {!stations && loading && <LoadingState label="Loading devices..." />}
            {stations && stations.length === 0 && (
              <Panel>
                <EmptyState title="No devices yet">
                  Devices appear here after they sync for the first time.
                </EmptyState>
              </Panel>
            )}
            {stations && stations.length > 0 && (
              <Toolbar className="fleet-toolbar" aria-label="Device filters">
                <span className="admin-affix-input fleet-toolbar-search">
                  <Search size={15} aria-hidden="true" />
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
                <div className="admin-chip-toggles" role="group" aria-label="Device status">
                  {STATE_FILTERS.map((state) => (
                    <ToggleChip
                      key={state.id}
                      pressed={deviceStates.includes(state.id)}
                      onChange={() => setDeviceStates((current) => toggleValue(current, state.id))}
                    >
                      {state.label}
                    </ToggleChip>
                  ))}
                </div>
                {stores.length > 1 && (
                  <select
                    className="fleet-toolbar-store"
                    value={deviceStore}
                    aria-label="Store"
                    onChange={(event) => setDeviceStore(event.target.value)}
                  >
                    <option value="">All stores</option>
                    {stores.map((store) => <option key={store} value={store}>{store}</option>)}
                  </select>
                )}
                <ToolbarSpacer />
                <span className="admin-count" role="status">
                  {listFiltered
                    ? `Showing ${visibleStations.length} of ${stations.length} devices`
                    : `${stations.length} ${stations.length === 1 ? 'device' : 'devices'} · ${activeCount} active`}
                </span>
                {listFiltered && (
                  <button className="admin-btn admin-btn--ghost admin-btn--sm" type="button" onClick={clearDeviceFilters}>
                    Clear filters
                  </button>
                )}
              </Toolbar>
            )}
            {/* In the table's place, on the same panel tone; Clear filters is in the toolbar right above. */}
            {stations && stations.length > 0 && visibleStations.length === 0 && (
              <Panel>
                <EmptyState title="No devices match these filters">
                  Try another search, or clear the filters to see every device.
                </EmptyState>
              </Panel>
            )}
            {visibleStations.length > 0 && (
              <StationTable
                stations={visibleStations}
                onSelect={(stationId) => {
                  setListNotice('');
                  setSelectedId(stationId);
                }}
              />
            )}
          </PageSection>
        </div>
      )}

      {/* Hidden, not unmounted, while a device is open: a half-typed moderator or PIN survives the detour. */}
      <div className="fleet-list-extras" hidden={Boolean(selectedId)}>
        <div className="admin-stack">
          <div ref={moderatorsRef} className="fleet-moderators-anchor admin-stack">
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

          <div className="fleet-settings-grid">
            <OwnerPinCard owner={owner} />
            <FleetSyncCard owner={owner} title="Cloud sync on this device" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Every device as one table row; the row (or Enter on its name) opens the device. */
function StationTable(props: { stations: FleetStation[]; onSelect: (stationId: string) => void }): JSX.Element {
  const tableRef = useRef<HTMLTableElement>(null);

  // Up/Down move between devices; the Control Room keeps the arrows for its sections elsewhere.
  const onRowKeyDown = (event: KeyboardEvent<HTMLButtonElement>, stationId: string): void => {
    if (event.key === 'Enter') {
      // The app shell swallows Enter on buttons, so open here.
      event.preventDefault();
      props.onSelect(stationId);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const rows = [...(tableRef.current?.querySelectorAll<HTMLButtonElement>('[data-fleet-row-open]') ?? [])];
    rows[rows.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
  };

  return (
    <div className="admin-table-scroll fleet-table-scroll" data-admin-local-keys="true">
      <table ref={tableRef} className="admin-table fleet-table">
        <thead>
          <tr>
            <th scope="col">Device</th>
            <th scope="col" className="fleet-col-status">Status</th>
            <th scope="col" className="fleet-col-version">Version</th>
            <th scope="col" className="fleet-col-seen">Last seen</th>
            <th scope="col" className="admin-num fleet-col-count">Games</th>
            <th scope="col" className="admin-num fleet-col-count">Sessions</th>
            <th scope="col" className="admin-num fleet-col-money">Revenue</th>
            <th scope="col" className="fleet-table-chevron"><span className="admin-visually-hidden">Open</span></th>
          </tr>
        </thead>
        <tbody>
          {props.stations.map((station) => {
            const removed = Boolean(station.removedAt);
            const place = [station.storeName, station.location].filter(Boolean).join(' · ');
            return (
              <tr key={station.id} className={`is-clickable${removed ? ' is-removed' : ''}`} onClick={() => props.onSelect(station.id)}>
                <td className="fleet-device-cell">
                  <button
                    className="fleet-row-open"
                    type="button"
                    data-fleet-row-open="true"
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onSelect(station.id);
                    }}
                    onKeyDown={(event) => onRowKeyDown(event, station.id)}
                  >
                    <span className="fleet-device-name">
                      <strong>{station.name || 'Unnamed device'}</strong>
                      {station.isCurrentDevice && <Badge>This device</Badge>}
                    </span>
                    <span className="fleet-device-place">{place || 'Store and location not set'}</span>
                  </button>
                </td>
                <td>
                  {removed ? (
                    <span className="fleet-cell-stack">
                      <StatusText tone="danger" title={`Removed ${dateTimeLabel(station.removedAt)}`}>Removed</StatusText>
                      <small>{relativeTime(station.removedAt)}</small>
                    </span>
                  ) : (
                    <StatusText tone={station.status === 'active' ? 'success' : 'neutral'}>
                      {station.status === 'active' ? 'Active' : 'Inactive'}
                    </StatusText>
                  )}
                </td>
                <td className="fleet-cell-muted">{station.appVersion || '—'}</td>
                <td className="fleet-cell-muted" title={station.lastSeenAt ? dateTimeLabel(station.lastSeenAt) : undefined}>
                  {relativeTime(station.lastSeenAt)}
                </td>
                <td className="admin-num">{station.gameCount.toLocaleString('en-IN')}</td>
                <td className="admin-num">{station.sessionCount.toLocaleString('en-IN')}</td>
                <td className="admin-num">{formatPaise(station.totalRevenuePaise)}</td>
                <td className="fleet-table-chevron" aria-hidden="true"><ChevronRight size={16} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
    <Field label={label}>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={12}
        value={value}
        disabled={saving}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, ''))}
      />
    </Field>
  );

  return (
    <PageSection
      title="Main admin PIN"
      description="Unlocks Accounts for every device and this page. It is separate from each device's admin PIN."
      className="fleet-owner-pin"
    >
      <Panel
        as="form"
        className="admin-form fleet-owner-pin-form"
        onSubmit={(event) => {
          event.preventDefault();
          void changePin();
        }}
      >
        <div className="form-grid">
          {pinInput(currentPin, setCurrentPin, 'Current PIN')}
          <span aria-hidden="true" />
          {pinInput(nextPin, setNextPin, 'New PIN')}
          {pinInput(confirmPin, setConfirmPin, 'Confirm new PIN')}
          <small className="admin-field-help full">Use 6 or more digits. Any PIN of 4 to 12 digits is accepted.</small>
        </div>
        <footer className="admin-panel-footer">
          {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
          <button className="admin-btn admin-btn--primary" type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Change PIN'}
          </button>
        </footer>
      </Panel>
    </PageSection>
  );
}
