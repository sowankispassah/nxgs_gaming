import { useEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react';
import {
  BadgeCheck,
  CalendarRange,
  ChevronRight,
  Clock,
  Download,
  IndianRupee,
  LoaderCircle,
  MonitorCog,
  Network,
  ReceiptIndianRupee,
  RefreshCw,
  ShieldAlert,
  Timer,
  Trophy
} from 'lucide-react';
import type {
  DeviceRecord,
  EarningsReport,
  EarningsScope,
  EarningsSessionRow,
  FleetStation,
  LocalSessionStatus,
  PaymentPayerDetails
} from '../../../shared/types';
import { CardHeader, EmptyState, LoadingState, Notice, type NoticeTone } from './AdminKit';
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

const STATUS_CHIPS: Record<LocalSessionStatus, { label: string; tone: string }> = {
  active: { label: 'Playing', tone: 'ps-chip--accent' },
  completed: { label: 'Completed', tone: 'ps-chip--success' },
  expired: { label: 'Time up', tone: '' },
  interrupted: { label: 'Interrupted', tone: 'ps-chip--warning' }
};

/** Still "active" after its paid time ended: the app closed before the session finished. */
const UNFINISHED_CHIP = { label: 'Unfinished', tone: 'ps-chip--warning' };

function sessionStatusChip(row: EarningsSessionRow, now: number): { label: string; tone: string } {
  if (isUnfinishedSession(row, now)) return UNFINISHED_CHIP;
  return STATUS_CHIPS[row.status] ?? { label: row.status, tone: '' };
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
  const maxStationPaise = Math.max(1, ...(report?.byStation.map((station) => station.amountPaise) ?? [1]));
  const busy = loading || scopePending;

  return (
    <div className="accounts-page admin-stack">
      <section className="admin-card accounts-filters" aria-label="Earnings filters">
        <div className="accounts-filter-row">
          <div className="accounts-filter-group">
            <span className="admin-section-title">Show</span>
            <div className="admin-segmented" role="group" aria-label="Earnings scope">
              <button type="button" aria-pressed={!allScope} disabled={scopePending} onClick={() => void chooseScope('device')}>
                <MonitorCog size={16} aria-hidden="true" />
                This device
              </button>
              <button type="button" aria-pressed={allScope} disabled={scopePending} onClick={() => void chooseScope('all')}>
                {scopePending ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <Network size={16} aria-hidden="true" />}
                All devices
              </button>
            </div>
          </div>
          <div className="accounts-filter-actions">
            <button className="secondary-action compact" type="button" disabled={busy} onClick={() => setRefreshCount((count) => count + 1)}>
              {loading ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
              Refresh
            </button>
            <button className="secondary-action compact" type="button" disabled={exporting || Boolean(invalidRange)} onClick={() => void exportCsv()}>
              {exporting ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}
              {exporting ? 'Saving...' : 'Export CSV'}
            </button>
          </div>
        </div>
        <div className="accounts-filter-row">
          <div className="accounts-filter-group">
            <span className="admin-section-title">Period</span>
            <div className="admin-segmented" role="group" aria-label="Period">
              {RANGE_OPTIONS.map((option) => (
                <button key={option.id} type="button" aria-pressed={view.range === option.id} onClick={() => chooseRange(option.id)}>
                  {option.id === 'custom' && <CalendarRange size={16} aria-hidden="true" />}
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          {view.range === 'custom' && (
            <div className="accounts-custom-range">
              <label className="admin-field">
                <span className="admin-section-title">From</span>
                <input
                  type="date"
                  value={view.customFrom}
                  max={view.customTo || undefined}
                  onChange={(event) => onViewChange((current) => ({ ...current, customFrom: event.target.value }))}
                />
              </label>
              <label className="admin-field">
                <span className="admin-section-title">To</span>
                <input
                  type="date"
                  value={view.customTo}
                  min={view.customFrom || undefined}
                  onChange={(event) => onViewChange((current) => ({ ...current, customTo: event.target.value }))}
                />
              </label>
            </div>
          )}
        </div>
        <AccountsFilterBar
          view={view}
          onViewChange={onViewChange}
          stations={stations}
          facets={report?.facets}
          shownCount={report?.sessionCount}
          disabled={scopePending}
        />
        {allScope && stationsError && <Notice tone="warning">{stationsError}</Notice>}
        {invalidRange && <Notice tone="warning">{invalidRange}</Notice>}
        {exportNotice && <Notice tone={exportNotice.tone} className="accounts-export-notice">{exportNotice.text}</Notice>}
      </section>

      {error && (
        <section className="admin-card accounts-error-card">
          <Notice tone="error">{error}</Notice>
          <button className="secondary-action compact" type="button" disabled={loading} onClick={() => setRefreshCount((count) => count + 1)}>
            <RefreshCw size={15} />
            Retry
          </button>
        </section>
      )}

      {!error && !report && loading && (
        <section className="admin-card admin-loading-card">
          <LoadingState label="Loading earnings..." />
        </section>
      )}

      {report && (
        <>
          <div className="accounts-stat-grid">
            <article className="accounts-stat">
              <span className="accounts-stat-icon" aria-hidden="true"><IndianRupee size={20} /></span>
              <strong>{formatPaise(report.totalPaise, report.currency)}</strong>
              <span>Total earned</span>
              <small>{period} · {scopeName}</small>
            </article>
            <article className="accounts-stat">
              <span className="accounts-stat-icon" aria-hidden="true"><ReceiptIndianRupee size={20} /></span>
              <strong>{report.sessionCount.toLocaleString('en-IN')}</strong>
              <span>Paid sessions</span>
              <small>{period}</small>
            </article>
            <article className="accounts-stat">
              <span className="accounts-stat-icon" aria-hidden="true"><Timer size={20} /></span>
              <strong>{durationLabel(report.paidMinutes)}</strong>
              <span>Paid time</span>
              <small>{report.paidMinutes.toLocaleString('en-IN')} min sold</small>
            </article>
            <article className="accounts-stat">
              <span className="accounts-stat-icon" aria-hidden="true"><Trophy size={20} /></span>
              <strong className="accounts-stat-text" title={topGame?.title}>{topGame?.title ?? 'None yet'}</strong>
              <span>Most played game</span>
              <small>
                {topGame
                  ? `${topGame.sessionCount} ${topGame.sessionCount === 1 ? 'session' : 'sessions'} · ${durationLabel(topGame.playMinutes)}`
                  : 'No games recorded in this period'}
              </small>
            </article>
          </div>

          <section className="admin-card accounts-sessions-card" aria-busy={loading}>
            <CardHeader
              eyebrow={allScope ? scopeName : 'This device'}
              title="Paid sessions"
              subtitle={`${period} · ${sortLabel} · Updated ${timeLabel(report.generatedAt)}`}
              actions={<span className="ps-chip admin-count-chip">{report.rows.length} {report.rows.length === 1 ? 'session' : 'sessions'}</span>}
            />
            {report.truncated && (
              <Notice tone="warning" className="accounts-truncated-notice">
                Too many sessions to show at once: the totals and table cover only the newest {report.rows.length.toLocaleString('en-IN')}. Pick a shorter period or one device to see everything.
              </Notice>
            )}
            {report.rows.length === 0 ? (
              filterCount > 0 ? (
                <EmptyState icon={<ReceiptIndianRupee size={28} />} title="No sessions match these filters">
                  <button className="secondary-action compact" type="button" onClick={() => onViewChange((current) => clearAccountsFilters(current))}>
                    Clear filters
                  </button>
                </EmptyState>
              ) : (
                <EmptyState icon={<ReceiptIndianRupee size={28} />} title="No paid sessions in this period">
                  {allScope ? 'Try a longer period or another device.' : 'Try a longer period. Sessions customers pay for on this device appear here.'}
                </EmptyState>
              )
            ) : (
              <SessionsTable rows={report.rows} allScope={allScope} expanded={expanded} onToggle={toggleRow} />
            )}
          </section>

          <div className={`admin-columns accounts-breakdown${allScope ? '' : ' accounts-breakdown--single'}`}>
            {allScope && (
              <section className="admin-card accounts-device-card">
                <CardHeader
                  eyebrow="Breakdown"
                  title="By device"
                  subtitle="Pick devices to see only their sessions."
                />
                {report.byStation.length === 0 ? (
                  <p className="field-note">No device earned in this period.</p>
                ) : (
                  <ol className="accounts-bar-list">
                    {report.byStation.map((station) => (
                      <li key={station.stationId}>
                        <button
                          className="accounts-bar-row"
                          type="button"
                          aria-pressed={view.stationIds.includes(station.stationId)}
                          onClick={() => onViewChange((current) => ({
                            ...current,
                            stationIds: toggleValue(current.stationIds, station.stationId)
                          }))}
                        >
                          <span className="accounts-bar-copy">
                            <strong>{station.stationName}</strong>
                            <small>{station.sessionCount} {station.sessionCount === 1 ? 'session' : 'sessions'}</small>
                          </span>
                          <strong className="accounts-bar-value">{formatPaise(station.amountPaise, report.currency)}</strong>
                          <span className="accounts-bar-track" aria-hidden="true">
                            <span style={{ width: `${Math.max(2, (station.amountPaise / maxStationPaise) * 100)}%` }} />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            )}
            <section className="admin-card accounts-games-card">
              <CardHeader
                eyebrow="Breakdown"
                title="Top games"
                subtitle="Paid sessions each game was played in, and total play time."
                actions={report.byGame.length > TOP_GAMES_PREVIEW && (
                  <button className="secondary-action compact" type="button" onClick={() => setShowAllGames((value) => !value)}>
                    {showAllGames ? 'Show fewer' : `Show all ${report.byGame.length}`}
                  </button>
                )}
              />
              {report.byGame.length === 0 ? (
                <p className="field-note">No games recorded in this period. Sessions from before version 0.25.0 did not record games.</p>
              ) : (
                <ol className="accounts-bar-list accounts-game-list">
                  {games.map((game, index) => (
                    <li key={game.gameId || game.title} className="accounts-bar-row">
                      <span className="accounts-bar-copy">
                        <strong><em className="accounts-rank">{index + 1}</em>{game.title}</strong>
                        <small>{game.sessionCount} {game.sessionCount === 1 ? 'session' : 'sessions'}</small>
                      </span>
                      <strong className="accounts-bar-value">{durationLabel(game.playMinutes)}</strong>
                      <span className="accounts-bar-track" aria-hidden="true">
                        <span style={{ width: `${Math.max(2, (game.playMinutes / maxGameMinutes) * 100)}%` }} />
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        </>
      )}
    </div>
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
    <div className="accounts-table-scroll" data-admin-local-keys="true">
      <table ref={tableRef} className={`accounts-table${props.allScope ? ' accounts-table--all' : ''}`}>
        <thead>
          <tr>
            <th scope="col"><span className="admin-visually-hidden">Details</span></th>
            <th scope="col">Started</th>
            {props.allScope && <th scope="col">Device</th>}
            <th scope="col">Plan</th>
            <th scope="col">Duration</th>
            <th scope="col" className="accounts-num">Amount</th>
            <th scope="col">Status</th>
            <th scope="col">Customer</th>
            <th scope="col">Games played</th>
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
  status: { label: string; tone: string };
  sessionGames: ReturnType<typeof summarizeSessionGames>;
  allScope: boolean;
  columnCount: number;
  now: number;
  onToggle: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}): JSX.Element {
  const { row } = props;
  const detailId = `accounts-session-${row.stationId}-${row.id}`;
  return (
    <>
      <tr className={`accounts-row${props.open ? ' is-open' : ''}`} onClick={props.onToggle}>
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
            <ChevronRight size={17} aria-hidden="true" />
          </button>
        </td>
        <td>
          <span className="accounts-cell-stack">
            <strong>{dateLabel(row.startedAt)}</strong>
            <small>{timeLabel(row.startedAt)}</small>
          </span>
        </td>
        {props.allScope && <td className="accounts-device-cell">{row.stationName || row.stationId}</td>}
        <td className="accounts-plan-cell">{row.planNames.length ? row.planNames.join(', ') : '—'}</td>
        <td className="accounts-nowrap">{durationLabel(row.durationMinutes)}</td>
        <td className="accounts-num accounts-amount">{formatPaise(row.amountPaise, row.currency)}</td>
        <td><span className={`ps-chip ${props.status.tone}`}>{props.status.label}</span></td>
        <td className="accounts-customer-cell"><CustomerSummary payers={row.payers ?? []} /></td>
        <td className="accounts-games-cell">
          {props.sessionGames.length === 0 ? (
            <span className="accounts-muted">{row.status === 'active' && !isUnfinishedSession(row, props.now) ? 'None yet' : 'Not recorded'}</span>
          ) : (
            <span className="accounts-game-chips">
              {props.sessionGames.map((game) => (
                <span key={game.gameId} className="ps-chip accounts-game-chip" title={game.title}>
                  <span className="accounts-game-title">{game.title}</span>
                  <em>{durationLabel(game.minutes)}</em>
                </span>
              ))}
            </span>
          )}
        </td>
        {props.allScope && (
          <td>
            {row.paymentVerified === undefined ? (
              <span className="accounts-muted">—</span>
            ) : row.paymentVerified ? (
              <span className="ps-chip ps-chip--success"><BadgeCheck size={14} aria-hidden="true" />Verified</span>
            ) : (
              <span className="ps-chip ps-chip--warning"><ShieldAlert size={14} aria-hidden="true" />Not verified</span>
            )}
          </td>
        )}
      </tr>
      {props.open && (
        <tr className="accounts-detail-row" id={detailId}>
          <td colSpan={props.columnCount}>
            <SessionDetail row={row} now={props.now} />
          </td>
        </tr>
      )}
    </>
  );
}

/** The table cell: the first payer Razorpay told us about, and how many more paid. */
function CustomerSummary(props: { payers: PaymentPayerDetails[] }): JSX.Element {
  const known = props.payers.filter(payerHasDetails);
  const payer = known[0];
  if (!payer) return <span className="accounts-muted">—</span>;
  const primary = phoneLabel(payer.phone) || payer.name || payer.email || payer.upiId || payer.razorpayPaymentId || '—';
  const secondary = [
    payer.phone ? payer.name : '',
    payer.email && payer.email !== primary ? payer.email : payer.upiId && payer.upiId !== primary ? payer.upiId : ''
  ].filter(Boolean).join(' · ');
  const method = paymentMethodLabel(payer.method);
  return (
    <span className="accounts-cell-stack accounts-customer">
      <strong className="accounts-customer-primary">{primary}</strong>
      {secondary && <small title={secondary}>{secondary}</small>}
      {(method || known.length > 1) && (
        <span className="accounts-customer-tags">
          {method && <span className="ps-chip accounts-method-chip">{method}</span>}
          {known.length > 1 && <small>+{known.length - 1} more {known.length === 2 ? 'payment' : 'payments'}</small>}
        </span>
      )}
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
        <h3 className="admin-section-title">Games played</h3>
        {row.games.length === 0 ? (
          <p className="field-note">
            {playing ? 'No game started yet.' : 'Not recorded. Games are recorded for sessions from version 0.25.0.'}
          </p>
        ) : (
          <ol className="accounts-timeline">
            {row.games.map((entry, index) => (
              <li key={`${entry.gameId}-${entry.startedAt}-${index}`}>
                <span className="accounts-timeline-time">
                  <Clock size={14} aria-hidden="true" />
                  {timeLabel(entry.startedAt)} – {endLabel(entry)}
                </span>
                <strong>{entry.title || 'Unknown game'}</strong>
                <small>{durationLabel(entryMinutes(entry, row, props.now))}</small>
              </li>
            ))}
          </ol>
        )}
        <dl className="accounts-detail-meta">
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
          <div><dt>Session ID</dt><dd><code>{row.id}</code></dd></div>
        </dl>
      </section>

      <section className="accounts-detail-section">
        <h3 className="admin-section-title">{payers.length > 1 ? `Payments (${payers.length})` : 'Payment'}</h3>
        {payers.length === 0 && missingCheckouts.length === 0 && <p className="field-note">No payment details recorded.</p>}
        <ul className="accounts-payer-list">
          {payers.map((payer) => {
            const method = paymentMethodLabel(payer.method);
            const methodDetail = paymentMethodDetail(payer);
            return (
              <li key={payer.checkoutId} className="accounts-payer">
                <dl className="accounts-detail-meta">
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
                  <div><dt>Razorpay payment ID</dt><dd><code>{payer.razorpayPaymentId || '—'}</code></dd></div>
                  <div><dt>Checkout ID</dt><dd><code>{payer.checkoutId}</code></dd></div>
                </dl>
              </li>
            );
          })}
          {missingCheckouts.map((checkoutId) => (
            <li key={checkoutId} className="accounts-payer accounts-payer--missing">
              <p className="field-note">Customer details not available yet for this payment.</p>
              <dl className="accounts-detail-meta">
                <div><dt>Checkout ID</dt><dd><code>{checkoutId}</code></dd></div>
              </dl>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
