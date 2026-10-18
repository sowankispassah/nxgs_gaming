import { useEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react';
import { Check, ChevronRight, Download, LoaderCircle, RefreshCw } from 'lucide-react';
import type {
  DeviceRecord,
  EarningsReport,
  EarningsScope,
  EarningsSessionRow,
  FleetStation,
  LocalSessionStatus,
  PaymentPayerDetails
} from '../../../shared/types';
import {
  EmptyState,
  LoadingState,
  Notice,
  PageActions,
  PageSection,
  Panel,
  Segmented,
  Stat,
  StatRow,
  StatusText,
  type NoticeTone,
  type Tone
} from './AdminKit';
import { AccountsFilterBar } from './AccountsFilters';
import {
  accountsFilterCount,
  buildEarningsQuery,
  clearAccountsFilters,
  dateLabel,
  dateTimeLabel,
  durationLabel,
  EARNINGS_SORT_OPTIONS,
  entryEnd,
  entryMinutes,
  formatPaise,
  isUnfinishedSession,
  parseDateInput,
  payerHasDetails,
  paymentMethodDetail,
  paymentMethodLabel,
  phoneLabel,
  summarizeSessionGames,
  timeLabel,
  toDateInputValue,
  toggleValue,
  withAccountsScope,
  type AccountsView,
  type RangePreset
} from './fleetFormat';
import { OWNER_PIN_MESSAGES, type OwnerSession } from './useOwnerSession';

export { DEFAULT_ACCOUNTS_VIEW, type AccountsView, type RangePreset } from './fleetFormat';

const RANGE_OPTIONS: Array<{ id: RangePreset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Last 7 days' },
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom' }
];

type SessionStatus = { label: string; tone: Tone };

/** The one status mapping (docs/admin-design.md): done is green, live is blue, needs a look is amber, over is grey. */
const STATUS_LABELS: Record<LocalSessionStatus, SessionStatus> = {
  active: { label: 'Playing', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  expired: { label: 'Time up', tone: 'neutral' },
  interrupted: { label: 'Interrupted', tone: 'neutral' }
};

/** Still "active" after its paid time ended: the app closed before the session finished. */
const UNFINISHED_CHIP: SessionStatus = { label: 'Unfinished', tone: 'warning' };

function sessionStatusChip(row: EarningsSessionRow, now: number): SessionStatus {
  if (isUnfinishedSession(row, now)) return UNFINISHED_CHIP;
  return STATUS_LABELS[row.status] ?? { label: row.status, tone: 'neutral' };
}

const TOP_GAMES_PREVIEW = 8;

function periodLabel(view: AccountsView): string {
  if (view.range !== 'custom') return RANGE_OPTIONS.find((option) => option.id === view.range)?.label ?? '';
  const from = parseDateInput(view.customFrom);
  const to = parseDateInput(view.customTo);
  if (from && to) return `${dateLabel(from.toISOString())} – ${dateLabel(to.toISOString())}`;
  if (from) return `From ${dateLabel(from.toISOString())}`;
  if (to) return `Up to ${dateLabel(to.toISOString())}`;
  return 'All time';
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en-IN')} ${count === 1 ? one : many}`;
}

export function AccountsPanel(props: {
  view: AccountsView;
  onViewChange: Dispatch<SetStateAction<AccountsView>>;
  owner: OwnerSession;
  currentDevice: DeviceRecord;
}): JSX.Element {
  const { view, onViewChange, owner } = props;
  const [report, setReport] = useState<EarningsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshCount, setRefreshCount] = useState(0);
  const [scopePending, setScopePending] = useState(false);
  const [stations, setStations] = useState<FleetStation[]>([]);
  const [stationsError, setStationsError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [showAllGames, setShowAllGames] = useState(false);
  const requestRef = useRef(0);

  const allScope = view.scope === 'all';
  const built = useMemo(() => buildEarningsQuery(view), [view]);
  const invalidRange = built.invalid ?? '';
  // Every filter is part of the query the main process applies; any change reloads the report.
  const viewKey = JSON.stringify(built.query);

  // The other scope has different columns and devices: drop its report so stale rows never show.
  // Other filter changes keep the current report on screen (dimmed) until the new one arrives.
  useEffect(() => {
    setReport(null);
    setExpanded(new Set());
    setShowAllGames(false);
  }, [view.scope]);

  useEffect(() => {
    setExportNotice(null);
  }, [viewKey]);

  useEffect(() => {
    const requestId = ++requestRef.current;
    const { query, invalid } = buildEarningsQuery(view);
    if (invalid) {
      setLoading(false);
      setError('');
      return;
    }
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const result = query.scope === 'all'
          ? await owner.run(() => window.nxgs.getEarnings(query), OWNER_PIN_MESSAGES.accounts)
          : await window.nxgs.getEarnings(query);
        if (requestId !== requestRef.current) return;
        if (result.ok && result.data) {
          setReport(result.data);
        } else if (result.code === 'owner_pin_required') {
          // The main admin PIN was cancelled: go back to this device.
          onViewChange((current) => withAccountsScope(current, 'device'));
        } else {
          setError(result.error ?? 'Could not load earnings.');
        }
      } catch (loadError) {
        if (requestId === requestRef.current) setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (requestId === requestRef.current) setLoading(false);
      }
    })();
    // `view` is read through viewKey; refreshCount re-runs the same query.
  }, [viewKey, refreshCount, owner.run, onViewChange]);

  useEffect(() => {
    if (!allScope) return undefined;
    let mounted = true;
    setStationsError('');
    void owner.run(() => window.nxgs.listFleetStations()).then((result) => {
      if (!mounted) return;
      if (result.ok && result.data) {
        setStations(
          [...result.data].sort((left, right) =>
            Number(Boolean(left.removedAt)) - Number(Boolean(right.removedAt)) || left.name.localeCompare(right.name)
          )
        );
      } else if (result.code !== 'owner_pin_required') {
        setStationsError(result.error ?? 'Could not load the device list.');
      }
    }).catch((listError) => {
      if (mounted) setStationsError(listError instanceof Error ? listError.message : String(listError));
    });
    return () => {
      mounted = false;
    };
  }, [allScope, owner.run]);

  const chooseScope = async (scope: EarningsScope): Promise<void> => {
    if (scope === view.scope || scopePending) return;
    if (scope === 'all') {
      setScopePending(true);
      const unlocked = await owner.ensureUnlocked(OWNER_PIN_MESSAGES.accounts);
      setScopePending(false);
      if (!unlocked) return;
    }
    onViewChange((current) => withAccountsScope(current, scope));
  };

  const chooseRange = (range: RangePreset): void => {
    onViewChange((current) => {
      if (range !== 'custom' || current.customFrom || current.customTo) return { ...current, range };
      const now = new Date();
      return {
        ...current,
        range,
        customFrom: toDateInputValue(new Date(now.getFullYear(), now.getMonth(), 1)),
        customTo: toDateInputValue(now)
      };
    });
  };

  const refresh = (): void => setRefreshCount((count) => count + 1);

  const exportCsv = async (): Promise<void> => {
    if (exporting) return;
    const { query, invalid } = buildEarningsQuery(view);
    if (invalid) return;
    setExporting(true);
    setExportNotice(null);
    try {
      const result = await window.nxgs.exportEarningsCsv(query);
      if (result.ok && result.path) setExportNotice({ tone: 'success', text: `CSV saved to ${result.path}` });
      else if (!result.canceled) setExportNotice({ tone: 'error', text: result.error ?? 'Could not save the CSV file.' });
    } catch (exportError) {
      setExportNotice({ tone: 'error', text: exportError instanceof Error ? exportError.message : String(exportError) });
    } finally {
      setExporting(false);
    }
  };

  const toggleRow = (id: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // By device rows add (or remove) their device from the Devices filter.
  const toggleStation = (station: { stationId: string }): void => {
    onViewChange((current) => ({
      ...current,
      stationIds: toggleValue(current.stationIds, station.stationId)
    }));
  };

  const pickedStations = allScope ? view.stationIds : [];
  const scopeName = !allScope
    ? props.currentDevice.name
    : pickedStations.length === 0
      ? 'All devices'
      : pickedStations.length === 1
        ? stations.find((station) => station.id === pickedStations[0])?.name || '1 device'
        : `${pickedStations.length} devices`;
  const filterCount = accountsFilterCount(view);
  const sortLabel = EARNINGS_SORT_OPTIONS.find((option) => option.id === (report?.sort ?? view.sort))?.label ?? 'Newest first';
  const period = periodLabel(view);
  const topGame = report?.byGame[0];
  const games = report ? (showAllGames ? report.byGame : report.byGame.slice(0, TOP_GAMES_PREVIEW)) : [];
  const maxGameMinutes = Math.max(1, ...(report?.byGame.map((game) => game.playMinutes) ?? [1]));
  const busy = loading || scopePending;

  return (
    <div className={`accounts-page${report && loading ? ' is-busy' : ''}`} aria-busy={loading}>
      <PageActions>
        <button className="admin-btn" type="button" disabled={busy} onClick={refresh}>
          {loading ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />}
          Refresh
        </button>
        <button className="admin-btn" type="button" disabled={exporting || Boolean(invalidRange)} onClick={() => void exportCsv()}>
          {exporting ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
          {exporting ? 'Saving...' : 'Export CSV'}
        </button>
      </PageActions>

      <div className="accounts-controls">
        <AccountsFilterBar
          view={view}
          facets={report?.facets}
          onViewChange={onViewChange}
          stations={stations}
          shownCount={report?.sessionCount}
          disabled={scopePending}
          meta={report && <>Updated {timeLabel(report.generatedAt)}</>}
        >
          <div className="admin-segmented accounts-scope" role="group" aria-label="Earnings scope">
            <button type="button" aria-pressed={!allScope} disabled={scopePending} onClick={() => void chooseScope('device')}>
              This device
            </button>
            <button type="button" aria-pressed={allScope} disabled={scopePending} onClick={() => void chooseScope('all')}>
              {scopePending && <LoaderCircle className="spin" size={14} aria-hidden="true" />}
              All devices
            </button>
          </div>
          <Segmented
            aria-label="Period"
            value={view.range}
            onChange={chooseRange}
            options={RANGE_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
          />
          {view.range === 'custom' && (
            <div className="accounts-dates" role="group" aria-label="Custom period">
              <input
                type="date"
                aria-label="From"
                value={view.customFrom}
                max={view.customTo || undefined}
                onChange={(event) => onViewChange((current) => ({ ...current, customFrom: event.target.value }))}
              />
              <span aria-hidden="true">to</span>
              <input
                type="date"
                aria-label="To"
                value={view.customTo}
                min={view.customFrom || undefined}
                onChange={(event) => onViewChange((current) => ({ ...current, customTo: event.target.value }))}
              />
            </div>
          )}
        </AccountsFilterBar>
        {allScope && stationsError && <Notice tone="warning">{stationsError}</Notice>}
        {invalidRange && <Notice tone="warning">{invalidRange}</Notice>}
        {exportNotice && <Notice tone={exportNotice.tone} className="accounts-export-notice">{exportNotice.text}</Notice>}
      </div>

      {error && (
        <div className="accounts-error">
          <Notice tone="error">{error}</Notice>
          <button className="admin-btn admin-btn--sm" type="button" disabled={loading} onClick={refresh}>
            <RefreshCw size={14} aria-hidden="true" />
            Retry
          </button>
        </div>
      )}

      {!error && !report && loading && <LoadingState label="Loading earnings..." />}

      {report && (
        <>
          <StatRow aria-label="Totals" minCellWidth={200}>
            <Stat label="Total earned" value={formatPaise(report.totalPaise, report.currency)} sub={`${period} · ${scopeName}`} />
            <Stat
              label="Paid sessions"
              value={report.sessionCount.toLocaleString('en-IN')}
              sub={report.sessionCount > 0
                ? `${formatPaise(Math.round(report.totalPaise / report.sessionCount), report.currency)} on average`
                : period}
            />
            <Stat label="Paid time" value={durationLabel(report.paidMinutes)} sub={`${report.paidMinutes.toLocaleString('en-IN')} min sold`} />
            <Stat
              label="Most played game"
              value={topGame?.title ?? 'None yet'}
              title={topGame?.title}
              sub={topGame
                ? `${plural(topGame.sessionCount, 'session', 'sessions')} · ${durationLabel(topGame.playMinutes)}`
                : 'No games recorded in this period'}
            />
          </StatRow>

          <PageSection
            title="Paid sessions"
            description={report.rows.length > 0 ? `${sortLabel}. Select a session to see the games played and who paid.` : undefined}
            actions={<span className="admin-count">{plural(report.rows.length, 'session', 'sessions')}</span>}
          >
            {report.truncated && (
              <Notice tone="warning">
                Too many sessions to show at once: the totals and table cover only the newest {report.rows.length.toLocaleString('en-IN')}. Pick a shorter period or one device to see everything.
              </Notice>
            )}
            {report.rows.length === 0 ? (
              <Panel>
                {filterCount > 0 ? (
                  <EmptyState
                    title="No sessions match these filters"
                    action={(
                      <button className="admin-btn admin-btn--sm" type="button" onClick={() => onViewChange((current) => clearAccountsFilters(current))}>
                        Clear filters
                      </button>
                    )}
                  />
                ) : (
                  <EmptyState title="No paid sessions in this period">
                    {allScope ? 'Try a longer period or another device.' : 'Try a longer period. Sessions customers pay for on this device appear here.'}
                  </EmptyState>
                )}
              </Panel>
            ) : (
              <SessionsTable rows={report.rows} allScope={allScope} expanded={expanded} onToggle={toggleRow} />
            )}
          </PageSection>

          <div className={`accounts-breakdown${allScope ? '' : ' accounts-breakdown--single'}`}>
            {allScope && (
              <PageSection title="By device" description="Select a device to show only its sessions.">
                {report.byStation.length === 0 ? (
                  <p className="accounts-note">No device earned in this period.</p>
                ) : (
                  <div className="admin-table-scroll accounts-rank-table">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th scope="col" className="accounts-rank-col"><span className="admin-visually-hidden">Rank</span></th>
                          <th scope="col">Device</th>
                          <th scope="col" className="admin-num">Sessions</th>
                          <th scope="col" className="admin-num">Amount</th>
                          <th scope="col" className="accounts-share-col">Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.byStation.map((station, index) => {
                          const picked = view.stationIds.includes(station.stationId);
                          const share = report.totalPaise > 0 ? (station.amountPaise / report.totalPaise) * 100 : 0;
                          return (
                            <tr key={station.stationId} className={`accounts-rank-row is-clickable${picked ? ' is-selected' : ''}`} onClick={() => toggleStation(station)}>
                              <td className="accounts-rank">{index + 1}</td>
                              <td className="accounts-rank-name">
                                <button
                                  className="accounts-row-pick"
                                  type="button"
                                  aria-pressed={picked}
                                  title={picked ? `Stop filtering by ${station.stationName}` : `Show only ${station.stationName}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    toggleStation(station);
                                  }}
                                >
                                  <span>{station.stationName}</span>
                                  {picked && <Check size={14} aria-hidden="true" />}
                                </button>
                              </td>
                              <td className="admin-num">{station.sessionCount.toLocaleString('en-IN')}</td>
                              <td className="admin-num accounts-amount">{formatPaise(station.amountPaise, report.currency)}</td>
                              <td className="accounts-share-cell">
                                <ShareBar percent={share} />
                                <span className="accounts-share-value">{Math.round(share)}%</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </PageSection>
            )}
            <PageSection
              title="Top games"
              actions={report.byGame.length > TOP_GAMES_PREVIEW && (
                <button className="admin-btn admin-btn--ghost admin-btn--sm" type="button" onClick={() => setShowAllGames((value) => !value)}>
                  {showAllGames ? 'Show fewer' : `Show all ${report.byGame.length}`}
                </button>
              )}
            >
              {report.byGame.length === 0 ? (
                <p className="accounts-note">No games recorded in this period. Sessions from before version 0.25.0 did not record games.</p>
              ) : (
                <div className="admin-table-scroll accounts-rank-table">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th scope="col" className="accounts-rank-col"><span className="admin-visually-hidden">Rank</span></th>
                        <th scope="col">Game</th>
                        <th scope="col" className="admin-num">Sessions</th>
                        <th scope="col" className="admin-num">Play time</th>
                        <th scope="col" className="accounts-share-col"><span className="admin-visually-hidden">Compared with the top game</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {games.map((game, index) => (
                        <tr key={game.gameId || game.title}>
                          <td className="accounts-rank">{index + 1}</td>
                          <td className="accounts-rank-name"><span title={game.title}>{game.title}</span></td>
                          <td className="admin-num">{game.sessionCount.toLocaleString('en-IN')}</td>
                          <td className="admin-num">{durationLabel(game.playMinutes)}</td>
                          <td className="accounts-share-cell"><ShareBar percent={(game.playMinutes / maxGameMinutes) * 100} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </PageSection>
          </div>
        </>
      )}
    </div>
  );
}

/** A thin neutral bar for a share of the whole (or of the top row). */
function ShareBar(props: { percent: number }): JSX.Element {
  const width = props.percent > 0 ? Math.max(2, Math.min(100, props.percent)) : 0;
  return (
    <span className="accounts-share-bar" aria-hidden="true">
      <span style={{ width: `${width}%` }} />
    </span>
  );
}

function SessionsTable(props: {
  rows: EarningsSessionRow[];
  allScope: boolean;
  expanded: Set<string>;
  onToggle: (id: string) => void;
}): JSX.Element {
  const tableRef = useRef<HTMLTableElement>(null);
  const columnCount = props.allScope ? 10 : 8;
  const now = Date.now();

  // Up/Down move between rows; the Control Room keeps Left/Right for its own tabs elsewhere.
  const moveRowFocus = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const toggles = [...(tableRef.current?.querySelectorAll<HTMLButtonElement>('[data-accounts-row-toggle]') ?? [])];
    const index = toggles.indexOf(event.currentTarget);
    toggles[index + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
  };

  return (
    <div className="admin-table-scroll accounts-table-scroll" data-admin-local-keys="true">
      <table ref={tableRef} className={`admin-table accounts-table${props.allScope ? ' accounts-table--all' : ''}`}>
        <thead>
          <tr>
            <th scope="col" className="accounts-toggle-col"><span className="admin-visually-hidden">Details</span></th>
            <th scope="col">Started</th>
            {props.allScope && <th scope="col">Device</th>}
            <th scope="col">Customer</th>
            <th scope="col">Plan</th>
            <th scope="col">Games played</th>
            <th scope="col" className="admin-num">Duration</th>
            <th scope="col" className="admin-num">Amount</th>
            <th scope="col">Status</th>
            {props.allScope && <th scope="col">Payment</th>}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => {
            const rowKey = `${row.stationId}:${row.id}`;
            const open = props.expanded.has(rowKey);
            const status = sessionStatusChip(row, now);
            const sessionGames = summarizeSessionGames(row, now);
            return (
              <SessionRows
                key={rowKey}
                row={row}
                open={open}
                status={status}
                sessionGames={sessionGames}
                allScope={props.allScope}
                columnCount={columnCount}
                now={now}
                onToggle={() => props.onToggle(rowKey)}
                onKeyDown={moveRowFocus}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SessionRows(props: {
  row: EarningsSessionRow;
  open: boolean;
  status: SessionStatus;
  sessionGames: ReturnType<typeof summarizeSessionGames>;
  allScope: boolean;
  columnCount: number;
  now: number;
  onToggle: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}): JSX.Element {
  const { row } = props;
  const detailId = `accounts-session-${row.stationId}-${row.id}`;
  const gamesTitle = props.sessionGames.map((game) => `${game.title} (${durationLabel(game.minutes)})`).join(', ');
  return (
    <>
      <tr className={`accounts-row is-clickable${props.open ? ' is-open' : ''}`} onClick={props.onToggle}>
        <td className="accounts-toggle-cell">
          <button
            className="accounts-row-toggle"
            type="button"
            data-accounts-row-toggle="true"
            aria-expanded={props.open}
            aria-controls={props.open ? detailId : undefined}
            aria-label={props.open ? 'Hide session details' : 'Show session details'}
            onKeyDown={(event) => {
              // The app shell swallows Enter on buttons, so toggle here.
              if (event.key === 'Enter') {
                event.preventDefault();
                props.onToggle();
                return;
              }
              props.onKeyDown(event);
            }}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </td>
        <td className="accounts-started">
          <span className="accounts-cell-stack">
            <span>{dateLabel(row.startedAt)}</span>
            <small>{timeLabel(row.startedAt)}</small>
          </span>
        </td>
        {props.allScope && <td className="accounts-device-cell">{row.stationName || row.stationId}</td>}
        <td className="accounts-customer-cell"><CustomerSummary payers={row.payers ?? []} /></td>
        <td className="accounts-plan-cell">{row.planNames.length ? row.planNames.join(', ') : '—'}</td>
        <td className="accounts-games-cell">
          {props.sessionGames.length === 0 ? (
            <span className="accounts-muted">{row.status === 'active' && !isUnfinishedSession(row, props.now) ? 'None yet' : 'Not recorded'}</span>
          ) : (
            <span className="accounts-games" title={gamesTitle}>
              {props.sessionGames.map((game, index) => (
                <span key={game.gameId} className="accounts-game">
                  {game.title}
                  <span className="accounts-game-time">{durationLabel(game.minutes)}</span>
                  {index < props.sessionGames.length - 1 && <span className="accounts-game-sep">, </span>}
                </span>
              ))}
            </span>
          )}
        </td>
        <td className="admin-num accounts-duration">{durationLabel(row.durationMinutes)}</td>
        <td className="admin-num accounts-amount">{formatPaise(row.amountPaise, row.currency)}</td>
        <td><StatusText tone={props.status.tone}>{props.status.label}</StatusText></td>
        {props.allScope && (
          <td>
            {row.paymentVerified === undefined ? (
              <span className="accounts-muted">—</span>
            ) : row.paymentVerified ? (
              <StatusText tone="success" icon={<Check size={14} aria-hidden="true" />}>Verified</StatusText>
            ) : (
              <StatusText tone="warning">Not verified</StatusText>
            )}
          </td>
        )}
      </tr>
      {props.open && (
        <tr className="admin-table-detail accounts-detail-row" id={detailId}>
          <td colSpan={props.columnCount}>
            <SessionDetail row={row} now={props.now} />
          </td>
        </tr>
      )}
    </>
  );
}

/** The table cell: the first payer Razorpay told us about (phone first), how they paid, and how many more paid. */
function CustomerSummary(props: { payers: PaymentPayerDetails[] }): JSX.Element {
  const known = props.payers.filter(payerHasDetails);
  const payer = known[0];
  if (!payer) return <span className="accounts-muted">—</span>;
  const primary = phoneLabel(payer.phone) || payer.name || payer.email || payer.upiId || payer.razorpayPaymentId || '—';
  const detail = paymentMethodDetail(payer);
  const method = [paymentMethodLabel(payer.method), detail !== primary ? detail : ''].filter(Boolean).join(' · ');
  const fallback = payer.phone ? payer.name || payer.email || '' : '';
  const secondary = [
    method || fallback,
    known.length > 1 ? `+${known.length - 1} more ${known.length === 2 ? 'payment' : 'payments'}` : ''
  ].filter(Boolean).join(' · ');
  return (
    <span className="accounts-cell-stack">
      <span>{primary}</span>
      {secondary && <small title={secondary}>{secondary}</small>}
    </span>
  );
}

function SessionDetail(props: { row: EarningsSessionRow; now: number }): JSX.Element {
  const { row } = props;
  const payers = (row.payers ?? []).filter(payerHasDetails);
  const missingCheckouts = row.checkoutIds.filter((id) => !payers.some((payer) => payer.checkoutId === id));
  const unfinished = isUnfinishedSession(row, props.now);
  const playing = row.status === 'active' && !unfinished;
  // Open entries end where entryEnd says (session end, paid time end, or now).
  const endLabel = (entry: EarningsSessionRow['games'][number]): string => {
    if (entry.endedAt || row.endedAt || row.expiresAt) {
      const end = entryEnd(entry, row, props.now);
      if (!entry.endedAt && !row.endedAt && end >= props.now) return 'Now';
      return timeLabel(new Date(end).toISOString());
    }
    return 'Now';
  };

  return (
    <div className="accounts-detail">
      <section className="accounts-detail-section">
        <h3 className="admin-subheading">Games played</h3>
        {row.games.length === 0 ? (
          <p className="accounts-note">
            {playing ? 'No game started yet.' : 'Not recorded. Games are recorded for sessions from version 0.25.0.'}
          </p>
        ) : (
          <ol className="accounts-timeline">
            {row.games.map((entry, index) => (
              <li key={`${entry.gameId}-${entry.startedAt}-${index}`}>
                <span className="accounts-timeline-time">{timeLabel(entry.startedAt)} – {endLabel(entry)}</span>
                <span className="accounts-timeline-title">{entry.title || 'Unknown game'}</span>
                <span className="accounts-timeline-duration">{durationLabel(entryMinutes(entry, row, props.now))}</span>
              </li>
            ))}
          </ol>
        )}
        <dl className="accounts-kv">
          <div><dt>Started</dt><dd>{dateTimeLabel(row.startedAt)}</dd></div>
          <div>
            <dt>Ended</dt>
            <dd>
              {row.endedAt
                ? dateTimeLabel(row.endedAt)
                : unfinished
                  ? `Not recorded. Paid time ended ${dateTimeLabel(row.expiresAt)}.`
                  : playing ? 'Still playing' : '—'}
            </dd>
          </div>
          <div><dt>Session ID</dt><dd className="admin-mono">{row.id}</dd></div>
        </dl>
      </section>

      <section className="accounts-detail-section">
        <h3 className="admin-subheading">{payers.length > 1 ? `Payments (${payers.length})` : 'Payment'}</h3>
        {payers.length === 0 && missingCheckouts.length === 0 && <p className="accounts-note">No payment details recorded.</p>}
        {payers.map((payer) => {
          const method = paymentMethodLabel(payer.method);
          const methodDetail = paymentMethodDetail(payer);
          return (
            <dl key={payer.checkoutId} className="accounts-kv accounts-payer">
              {payer.name && <div><dt>Name</dt><dd>{payer.name}</dd></div>}
              <div><dt>Phone</dt><dd>{phoneLabel(payer.phone) || '—'}</dd></div>
              {payer.email && <div><dt>Email</dt><dd>{payer.email}</dd></div>}
              <div>
                <dt>Method</dt>
                <dd>{[method, methodDetail].filter(Boolean).join(' · ') || '—'}</dd>
              </div>
              {payer.upiId && methodDetail !== payer.upiId && <div><dt>UPI ID</dt><dd>{payer.upiId}</dd></div>}
              {payer.bank && methodDetail !== payer.bank && <div><dt>Bank</dt><dd>{payer.bank}</dd></div>}
              <div><dt>Paid</dt><dd>{payer.paidAt ? dateTimeLabel(payer.paidAt) : '—'}</dd></div>
              <div><dt>Razorpay payment ID</dt><dd className="admin-mono">{payer.razorpayPaymentId || '—'}</dd></div>
              <div><dt>Checkout ID</dt><dd className="admin-mono">{payer.checkoutId}</dd></div>
            </dl>
          );
        })}
        {missingCheckouts.map((checkoutId) => (
          <div key={checkoutId} className="accounts-payer">
            <p className="accounts-note">Customer details not available yet for this payment.</p>
            <dl className="accounts-kv">
              <div><dt>Checkout ID</dt><dd className="admin-mono">{checkoutId}</dd></div>
            </dl>
          </div>
        ))}
      </section>
    </div>
  );
}
