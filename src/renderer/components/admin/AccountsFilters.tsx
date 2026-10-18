import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { ArrowDownUp, Gamepad2, Network, Search, ShieldCheck, Store, X } from 'lucide-react';
import { UNKNOWN_PAYMENT_METHOD } from '../../../shared/types';
import type { EarningsFacets, EarningsSort, FleetStation, LocalSessionStatus } from '../../../shared/types';
import {
  accountsFilterCount,
  clearAccountsFilters,
  EARNINGS_SORT_OPTIONS,
  groupStationsByStore,
  paymentMethodLabel,
  stationMatchesSearch,
  toggleValue,
  type AccountsView
} from './fleetFormat';
import { FilterPopover } from './FilterPopover';

const SEARCH_DEBOUNCE_MS = 300;

export const STATUS_FILTERS: Array<{ id: LocalSessionStatus; label: string }> = [
  { id: 'completed', label: 'Completed' },
  { id: 'expired', label: 'Time up' },
  { id: 'interrupted', label: 'Interrupted' },
  { id: 'active', label: 'Playing / Unfinished' }
];

export function paymentMethodFilterLabel(method: string): string {
  return method === UNKNOWN_PAYMENT_METHOD ? 'No details' : paymentMethodLabel(method);
}

type GameGroup = { key: string; title: string; ids: string[] };

/** One option per game title: the same game on several devices can have a different ID on each. */
function groupGames(games: EarningsFacets['games'], selected: string[], titles: Map<string, string>): GameGroup[] {
  const groups = new Map<string, GameGroup>();
  const add = (gameId: string, title: string): void => {
    const key = title.trim().toLowerCase() || gameId;
    const group = groups.get(key) ?? { key, title: title.trim() || 'Unknown game', ids: [] };
    if (!group.ids.includes(gameId)) group.ids.push(gameId);
    groups.set(key, group);
  };
  for (const game of games) add(game.gameId, game.title);
  for (const gameId of selected) {
    if (!games.some((game) => game.gameId === gameId)) add(gameId, titles.get(gameId) ?? 'Game not in this period');
  }
  return [...groups.values()].sort((left, right) => left.title.localeCompare(right.title));
}

function countLabel(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Accounts filters under the scope and period controls: devices, games,
 * payment method, status, verified payments, search and sort, plus the row of
 * active filters. The main process applies every filter; this only edits the
 * view that AdminScreen keeps.
 */
export function AccountsFilterBar(props: {
  view: AccountsView;
  onViewChange: Dispatch<SetStateAction<AccountsView>>;
  stations: FleetStation[];
  facets?: EarningsFacets;
  /** Sessions in the report after every filter. */
  shownCount?: number;
  disabled?: boolean;
}): JSX.Element {
  const { view, onViewChange } = props;
  const allScope = view.scope === 'all';
  const [searchDraft, setSearchDraft] = useState(view.search);
  const committedSearch = useRef(view.search);
  const gameTitles = useRef(new Map<string, string>());

  for (const game of props.facets?.games ?? []) gameTitles.current.set(game.gameId, game.title);

  // Clear filters (or another page) changed the search: show it in the box.
  useEffect(() => {
    if (view.search === committedSearch.current) return;
    committedSearch.current = view.search;
    setSearchDraft(view.search);
  }, [view.search]);

  // Typing updates the report about 300 ms after the last key.
  useEffect(() => {
    if (searchDraft === committedSearch.current) return undefined;
    const timer = window.setTimeout(() => {
      committedSearch.current = searchDraft;
      onViewChange((current) => ({ ...current, search: searchDraft }));
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [onViewChange, searchDraft]);

  const games = useMemo(
    () => groupGames(props.facets?.games ?? [], view.gameIds, gameTitles.current),
    [props.facets?.games, view.gameIds]
  );
  const methods = useMemo(() => {
    const listed = props.facets?.paymentMethods ?? [];
    const extra = view.paymentMethods.filter((method) => !listed.includes(method));
    return [...listed, ...extra];
  }, [props.facets?.paymentMethods, view.paymentMethods]);

  const stationName = (id: string): string => props.stations.find((station) => station.id === id)?.name || 'Device';
  const selectedGames = games.filter((group) => group.ids.some((id) => view.gameIds.includes(id)));
  const filterCount = accountsFilterCount(view);
  const total = props.facets?.sessionCount;

  const devicesValue = view.stationIds.length === 0
    ? 'All devices'
    : view.stationIds.length === 1 ? stationName(view.stationIds[0]) : countLabel(view.stationIds.length, 'device', 'devices');
  const gamesValue = selectedGames.length === 0
    ? 'All games'
    : selectedGames.length === 1 ? selectedGames[0].title : countLabel(selectedGames.length, 'game', 'games');

  const toggleGameGroup = (group: GameGroup): void => {
    onViewChange((current) => {
      const selected = group.ids.some((id) => current.gameIds.includes(id));
      return {
        ...current,
        gameIds: selected
          ? current.gameIds.filter((id) => !group.ids.includes(id))
          : [...current.gameIds, ...group.ids.filter((id) => !current.gameIds.includes(id))]
      };
    });
  };

  return (
    <div className="accounts-filter-bar">
      <div className="accounts-filter-row accounts-filter-row--controls">
        {allScope && (
          <FilterPopover
            label="Devices"
            value={devicesValue}
            icon={<Network size={16} />}
            active={view.stationIds.length > 0}
            disabled={props.disabled}
            className="accounts-device-popover"
          >
            {() => (
              <DevicePicker
                stations={props.stations}
                selected={view.stationIds}
                onChange={(stationIds) => onViewChange((current) => ({ ...current, stationIds }))}
              />
            )}
          </FilterPopover>
        )}
        <FilterPopover
          label="Games"
          value={gamesValue}
          icon={<Gamepad2 size={16} />}
          active={selectedGames.length > 0}
          disabled={props.disabled || games.length === 0}
          className="accounts-game-popover"
        >
          {() => (
            <GamePicker
              games={games}
              selected={view.gameIds}
              onToggle={toggleGameGroup}
              onClear={() => onViewChange((current) => ({ ...current, gameIds: [] }))}
            />
          )}
        </FilterPopover>
        <label className="admin-field accounts-search-field">
          <span className="admin-section-title">Search</span>
          <span className="admin-affix-input">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              value={searchDraft}
              maxLength={100}
              placeholder="Phone, email, UPI ID or payment ID"
              aria-label="Search sessions"
              onChange={(event) => setSearchDraft(event.target.value)}
              onKeyDown={(event) => {
                // Escape clears the search first; only an empty box lets Escape leave the Control Room.
                if (event.key === 'Escape' && searchDraft) {
                  event.preventDefault();
                  event.stopPropagation();
                  setSearchDraft('');
                }
              }}
            />
          </span>
        </label>
        <label className="admin-field accounts-sort-field">
          <span className="admin-section-title">Sort</span>
          <span className="admin-affix-input accounts-sort-input">
            <ArrowDownUp size={16} aria-hidden="true" />
            <select
              value={view.sort}
              aria-label="Sort sessions"
              onChange={(event) => onViewChange((current) => ({ ...current, sort: event.target.value as EarningsSort }))}
            >
              {EARNINGS_SORT_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </span>
        </label>
      </div>

      <div className="accounts-filter-row accounts-filter-row--chips">
        <div className="accounts-filter-group">
          <span className="admin-section-title">Payment</span>
          <div className="admin-chip-toggles" role="group" aria-label="Payment method">
            {methods.length === 0 && <span className="field-note">No payments in this period</span>}
            {methods.map((method) => (
              <button
                key={method}
                className="admin-chip-toggle"
                type="button"
                aria-pressed={view.paymentMethods.includes(method)}
                onClick={() => onViewChange((current) => ({ ...current, paymentMethods: toggleValue(current.paymentMethods, method) }))}
              >
                {paymentMethodFilterLabel(method)}
              </button>
            ))}
          </div>
        </div>
        <div className="accounts-filter-group">
          <span className="admin-section-title">Status</span>
          <div className="admin-chip-toggles" role="group" aria-label="Session status">
            {STATUS_FILTERS.map((status) => (
              <button
                key={status.id}
                className="admin-chip-toggle"
                type="button"
                aria-pressed={view.statuses.includes(status.id)}
                onClick={() => onViewChange((current) => ({ ...current, statuses: toggleValue(current.statuses, status.id) }))}
              >
                {status.label}
              </button>
            ))}
          </div>
        </div>
        {allScope && (
          <label className="accounts-inline-switch">
            <input
              type="checkbox"
              checked={view.verifiedOnly}
              onChange={(event) => onViewChange((current) => ({ ...current, verifiedOnly: event.target.checked }))}
            />
            <span className="ps-switch" data-on={view.verifiedOnly ? 'true' : 'false'} aria-hidden="true" />
            <span><ShieldCheck size={16} aria-hidden="true" />Verified payments only</span>
          </label>
        )}
      </div>

      <div className="accounts-active-filters" aria-live="polite">
        <span className="accounts-result-count">
          {props.shownCount === undefined || total === undefined
            ? 'Loading sessions...'
            : filterCount > 0
              ? `Showing ${props.shownCount.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')} sessions`
              : `Showing all ${total.toLocaleString('en-IN')} ${total === 1 ? 'session' : 'sessions'}`}
        </span>
        {filterCount > 0 && (
          <>
            <ul className="accounts-active-chips" aria-label="Active filters">
              {allScope && view.stationIds.map((id) => (
                <ActiveChip
                  key={`device:${id}`}
                  label={stationName(id)}
                  onRemove={() => onViewChange((current) => ({ ...current, stationIds: current.stationIds.filter((item) => item !== id) }))}
                />
              ))}
              {selectedGames.map((group) => (
                <ActiveChip key={`game:${group.key}`} label={group.title} onRemove={() => toggleGameGroup(group)} />
              ))}
              {view.paymentMethods.map((method) => (
                <ActiveChip
                  key={`method:${method}`}
                  label={paymentMethodFilterLabel(method)}
                  onRemove={() => onViewChange((current) => ({ ...current, paymentMethods: current.paymentMethods.filter((item) => item !== method) }))}
                />
              ))}
              {view.statuses.map((status) => (
                <ActiveChip
                  key={`status:${status}`}
                  label={STATUS_FILTERS.find((item) => item.id === status)?.label ?? status}
                  onRemove={() => onViewChange((current) => ({ ...current, statuses: current.statuses.filter((item) => item !== status) }))}
                />
              ))}
              {allScope && view.verifiedOnly && (
                <ActiveChip label="Verified only" onRemove={() => onViewChange((current) => ({ ...current, verifiedOnly: false }))} />
              )}
              {view.search.trim() && (
                <ActiveChip
                  label={`"${view.search.trim()}"`}
                  onRemove={() => onViewChange((current) => ({ ...current, search: '' }))}
                />
              )}
            </ul>
            <button
              className="secondary-action compact"
              type="button"
              onClick={() => onViewChange((current) => clearAccountsFilters(current))}
            >
              <X size={15} />
              Clear filters
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ActiveChip(props: { label: string; onRemove: () => void }): JSX.Element {
  return (
    <li>
      <button className="admin-active-chip" type="button" aria-label={`Remove filter: ${props.label}`} onClick={props.onRemove}>
        <span>{props.label}</span>
        <X size={14} aria-hidden="true" />
      </button>
    </li>
  );
}

/** Devices grouped by store, each store with a one-click toggle for all its devices. */
function DevicePicker(props: { stations: FleetStation[]; selected: string[]; onChange: (stationIds: string[]) => void }): JSX.Element {
  const [search, setSearch] = useState('');
  const visible = props.stations.filter((station) => stationMatchesSearch(station, search));
  const groups = groupStationsByStore(visible);
  const selected = new Set(props.selected);

  const setMany = (ids: string[], on: boolean): void => {
    const next = new Set(props.selected);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    props.onChange([...next]);
  };

  return (
    <div className="admin-picker">
      <span className="admin-affix-input admin-picker-search">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          value={search}
          placeholder="Find a device or store"
          aria-label="Find a device or store"
          onChange={(event) => setSearch(event.target.value)}
        />
      </span>
      <div className="admin-picker-actions">
        <button className="secondary-action compact" type="button" onClick={() => setMany(visible.map((station) => station.id), true)}>
          Select all
        </button>
        <button className="secondary-action compact" type="button" disabled={props.selected.length === 0} onClick={() => props.onChange([])}>
          Clear
        </button>
        <span className="field-note">{props.selected.length === 0 ? 'Showing every device' : `${props.selected.length} picked`}</span>
      </div>
      <div className="admin-picker-list">
        {props.stations.length === 0 && <p className="field-note">Loading devices...</p>}
        {props.stations.length > 0 && groups.length === 0 && <p className="field-note">No device matches "{search.trim()}".</p>}
        {groups.map((group) => {
          const ids = group.stations.map((station) => station.id);
          const whole = ids.every((id) => selected.has(id));
          return (
            <section key={group.store} className="admin-picker-group" aria-label={group.store}>
              <header className="admin-picker-group-header">
                <span><Store size={15} aria-hidden="true" />{group.store}</span>
                <button
                  className="admin-chip-toggle"
                  type="button"
                  aria-pressed={whole}
                  onClick={() => setMany(ids, !whole)}
                >
                  {whole ? 'Whole store picked' : 'Whole store'}
                </button>
              </header>
              {group.stations.map((station) => (
                <label key={station.id} className="admin-picker-option">
                  <input type="checkbox" checked={selected.has(station.id)} onChange={(event) => setMany([station.id], event.target.checked)} />
                  <span className="admin-picker-copy">
                    <strong>{station.name || 'Unnamed device'}{station.removedAt ? ' (removed)' : ''}</strong>
                    <small>{station.location || 'Location not set'}</small>
                  </span>
                  {station.isCurrentDevice && <span className="ps-chip ps-chip--accent">This device</span>}
                </label>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function GamePicker(props: { games: GameGroup[]; selected: string[]; onToggle: (group: GameGroup) => void; onClear: () => void }): JSX.Element {
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const visible = props.games.filter((game) => !needle || game.title.toLowerCase().includes(needle));
  return (
    <div className="admin-picker">
      {props.games.length > 8 && (
        <span className="admin-affix-input admin-picker-search">
          <Search size={16} aria-hidden="true" />
          <input type="search" value={search} placeholder="Find a game" aria-label="Find a game" onChange={(event) => setSearch(event.target.value)} />
        </span>
      )}
      <div className="admin-picker-actions">
        <button className="secondary-action compact" type="button" disabled={props.selected.length === 0} onClick={props.onClear}>
          Clear
        </button>
        <span className="field-note">Sessions where any picked game was played.</span>
      </div>
      <div className="admin-picker-list">
        {visible.length === 0 && <p className="field-note">No game matches "{search.trim()}".</p>}
        {visible.map((game) => (
          <label key={game.key} className="admin-picker-option">
            <input type="checkbox" checked={game.ids.some((id) => props.selected.includes(id))} onChange={() => props.onToggle(game)} />
            <span className="admin-picker-copy">
              <strong>{game.title}</strong>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
