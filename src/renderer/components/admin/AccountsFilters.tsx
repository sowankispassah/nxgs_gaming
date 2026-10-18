import { useEffect, useId, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { Check, Search, X } from 'lucide-react';
import { UNKNOWN_PAYMENT_METHOD } from '../../../shared/types';
import type { EarningsFacets, EarningsSort, FleetStation, LocalSessionStatus } from '../../../shared/types';
import { Badge, InlineSwitch, Toolbar, ToggleChip } from './AdminKit';
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
 * The Accounts toolbar, directly under the page header.
 *
 * Top row: the scope and period controls AccountsPanel passes in as children,
 * then search and sort. Second row: devices, games, payment method, status and
 * verified payments. Then one quiet line with the result count, the active
 * filters and Clear filters. The main process applies every filter; this only
 * edits the view that AdminScreen keeps.
 */
export function AccountsFilterBar(props: {
  view: AccountsView;
  facets?: EarningsFacets;
  onViewChange: Dispatch<SetStateAction<AccountsView>>;
  stations: FleetStation[];
  /** Sessions in the report after every filter. */
  shownCount?: number;
  disabled?: boolean;
  /** Scope and period controls, first in the top row. */
  children?: ReactNode;
  /** Right end of the result line, such as "Updated 2:31 pm". */
  meta?: ReactNode;
}): JSX.Element {
  const { view, onViewChange } = props;
  const allScope = view.scope === 'all';
  const [searchDraft, setSearchDraft] = useState(view.search);
  const committedSearch = useRef(view.search);
  const gameTitles = useRef(new Map<string, string>());
  const paymentLabelId = useId();
  const statusLabelId = useId();

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
    <div className="accounts-filters" role="search" aria-label="Earnings filters">
      <Toolbar className="accounts-toolbar">
        {props.children}
        <label className="admin-affix-input accounts-search">
          <span className="admin-visually-hidden">Search</span>
          <Search size={15} aria-hidden="true" />
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
        </label>
        <label className="admin-affix-input accounts-sort">
          <span className="accounts-sort-label">Sort</span>
          <select
            value={view.sort}
            aria-label="Sort sessions"
            onChange={(event) => onViewChange((current) => ({ ...current, sort: event.target.value as EarningsSort }))}
          >
            {EARNINGS_SORT_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
      </Toolbar>

      <Toolbar className="accounts-toolbar accounts-toolbar--filters">
        <div className="accounts-filter-cluster">
          {allScope && (
            <FilterPopover
              label="Devices"
              value={devicesValue}
              active={view.stationIds.length > 0}
              disabled={props.disabled}
              width={340}
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
        </div>
        <div className="accounts-filter-cluster">
          <span className="accounts-filter-label" id={paymentLabelId}>Payment</span>
          <div className="admin-chip-toggles" role="group" aria-labelledby={paymentLabelId}>
            {methods.length === 0 && <span className="accounts-filter-empty">No payments in this period</span>}
            {methods.map((method) => (
              <ToggleChip
                key={method}
                pressed={view.paymentMethods.includes(method)}
                onChange={() => onViewChange((current) => ({ ...current, paymentMethods: toggleValue(current.paymentMethods, method) }))}
              >
                {paymentMethodFilterLabel(method)}
              </ToggleChip>
            ))}
          </div>
        </div>
        <div className="accounts-filter-cluster">
          <span className="accounts-filter-label" id={statusLabelId}>Status</span>
          <div className="admin-chip-toggles" role="group" aria-labelledby={statusLabelId}>
            {STATUS_FILTERS.map((status) => (
              <ToggleChip
                key={status.id}
                pressed={view.statuses.includes(status.id)}
                onChange={() => onViewChange((current) => ({ ...current, statuses: toggleValue(current.statuses, status.id) }))}
              >
                {status.label}
              </ToggleChip>
            ))}
          </div>
        </div>
        {allScope && (
          <InlineSwitch
            checked={view.verifiedOnly}
            label="Verified payments only"
            onChange={(checked) => onViewChange((current) => ({ ...current, verifiedOnly: checked }))}
          />
        )}
      </Toolbar>

      {/* Before the first report the page shows its own loading line; the count appears with the report. */}
      <div className="accounts-results" aria-live="polite" hidden={(props.shownCount === undefined || total === undefined) && filterCount === 0}>
        {props.shownCount !== undefined && total !== undefined && (
          <span className="accounts-results-count">
            {filterCount > 0
              ? `Showing ${props.shownCount.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')} sessions`
              : total === 0
                ? 'No sessions'
                : `Showing all ${total.toLocaleString('en-IN')} ${total === 1 ? 'session' : 'sessions'}`}
          </span>
        )}
        {filterCount > 0 && (
          <ul className="accounts-active-chips" aria-label="Active filters">
            {allScope && view.stationIds.map((id) => (
              <ActiveChip
                key={`device:${id}`}
                kind="Device"
                label={stationName(id)}
                onRemove={() => onViewChange((current) => ({ ...current, stationIds: current.stationIds.filter((item) => item !== id) }))}
              />
            ))}
            {selectedGames.map((group) => (
              <ActiveChip key={`game:${group.key}`} kind="Game" label={group.title} onRemove={() => toggleGameGroup(group)} />
            ))}
            {view.paymentMethods.map((method) => (
              <ActiveChip
                key={`method:${method}`}
                kind="Payment"
                label={paymentMethodFilterLabel(method)}
                onRemove={() => onViewChange((current) => ({ ...current, paymentMethods: current.paymentMethods.filter((item) => item !== method) }))}
              />
            ))}
            {view.statuses.map((status) => (
              <ActiveChip
                key={`status:${status}`}
                kind="Status"
                label={STATUS_FILTERS.find((item) => item.id === status)?.label ?? status}
                onRemove={() => onViewChange((current) => ({ ...current, statuses: current.statuses.filter((item) => item !== status) }))}
              />
            ))}
            {allScope && view.verifiedOnly && (
              <ActiveChip kind="Payment" label="Verified only" onRemove={() => onViewChange((current) => ({ ...current, verifiedOnly: false }))} />
            )}
            {view.search.trim() && (
              <ActiveChip
                kind="Search"
                label={`"${view.search.trim()}"`}
                onRemove={() => onViewChange((current) => ({ ...current, search: '' }))}
              />
            )}
            <li>
              <button
                className="admin-btn admin-btn--ghost admin-btn--sm"
                type="button"
                onClick={() => onViewChange((current) => clearAccountsFilters(current))}
              >
                Clear filters
              </button>
            </li>
          </ul>
        )}
        {props.meta && <span className="accounts-results-meta">{props.meta}</span>}
      </div>
    </div>
  );
}

function ActiveChip(props: { kind: string; label: string; onRemove: () => void }): JSX.Element {
  return (
    <li>
      <button className="admin-active-chip" type="button" aria-label={`Remove filter: ${props.label}`} title={props.label} onClick={props.onRemove}>
        <span className="admin-active-chip-kind">{props.kind}</span>
        <span className="admin-active-chip-value">{props.label}</span>
        <X size={12} aria-hidden="true" />
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
      <div className="admin-picker-head">
        <span className="admin-affix-input admin-picker-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={search}
            placeholder="Find a device or store"
            aria-label="Find a device or store"
            onChange={(event) => setSearch(event.target.value)}
          />
        </span>
        <div className="admin-picker-actions">
          <span className="admin-picker-status">{props.selected.length === 0 ? 'Showing every device' : `${props.selected.length} picked`}</span>
          <button className="admin-btn admin-btn--ghost admin-btn--sm" type="button" onClick={() => setMany(visible.map((station) => station.id), true)}>
            Select all
          </button>
          <button className="admin-btn admin-btn--ghost admin-btn--sm" type="button" disabled={props.selected.length === 0} onClick={() => props.onChange([])}>
            Clear
          </button>
        </div>
      </div>
      <div className="admin-picker-list">
        {props.stations.length === 0 && <p className="admin-picker-note">Loading devices...</p>}
        {props.stations.length > 0 && groups.length === 0 && <p className="admin-picker-note">No device matches "{search.trim()}".</p>}
        {groups.map((group) => {
          const ids = group.stations.map((station) => station.id);
          const whole = ids.every((id) => selected.has(id));
          return (
            <section key={group.store} className="admin-picker-group" aria-label={group.store}>
              <header className="admin-picker-group-header">
                <span>{group.store}</span>
                <button
                  className="admin-btn admin-btn--ghost admin-btn--sm admin-picker-store"
                  type="button"
                  aria-pressed={whole}
                  onClick={() => setMany(ids, !whole)}
                >
                  {whole && <Check size={14} aria-hidden="true" />}
                  Whole store
                </button>
              </header>
              {group.stations.map((station) => (
                <label key={station.id} className="admin-picker-option">
                  <input type="checkbox" checked={selected.has(station.id)} onChange={(event) => setMany([station.id], event.target.checked)} />
                  <span className="admin-picker-name">{station.name || 'Unnamed device'}{station.removedAt ? ' (removed)' : ''}</span>
                  <span className="admin-picker-meta">{station.location || 'Location not set'}</span>
                  {station.isCurrentDevice && <Badge>This device</Badge>}
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
      <div className="admin-picker-head">
        {props.games.length > 8 && (
          <span className="admin-affix-input admin-picker-search">
            <Search size={15} aria-hidden="true" />
            <input type="search" value={search} placeholder="Find a game" aria-label="Find a game" onChange={(event) => setSearch(event.target.value)} />
          </span>
        )}
        <div className="admin-picker-actions">
          <span className="admin-picker-status">Sessions where any picked game was played.</span>
          <button className="admin-btn admin-btn--ghost admin-btn--sm" type="button" disabled={props.selected.length === 0} onClick={props.onClear}>
            Clear
          </button>
        </div>
      </div>
      <div className="admin-picker-list">
        {visible.length === 0 && <p className="admin-picker-note">No game matches "{search.trim()}".</p>}
        {visible.map((game) => (
          <label key={game.key} className="admin-picker-option">
            <input type="checkbox" checked={game.ids.some((id) => props.selected.includes(id))} onChange={() => props.onToggle(game)} />
            <span className="admin-picker-name">{game.title}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
