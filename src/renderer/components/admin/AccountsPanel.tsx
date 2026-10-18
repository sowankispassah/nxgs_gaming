import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type KeyboardEvent,
  type ReactNode,
  type SetStateAction
} from 'react';
import { Check, ChevronRight, Download, RefreshCw } from 'lucide-react';
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
const MINUTE = 60_000;

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
          <RefreshCw aria-hidden="true" />
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
        <button className="admin-btn" type="button" disabled={exporting || Boolean(invalidRange)} onClick={() => void exportCsv()}>
          <Download aria-hidden="true" />
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
            {loading ? 'Retrying...' : 'Retry'}
          </button>
        </div>
      )}

      {!error && !report && loading && <LoadingState label="Loading earnings..." />}

      {report && (
        <>
          {/* One hero figure (Total earned); the other figures are quieter facts beside it. */}
          <dl className="accounts-figures" aria-label="Totals">
            <div className="accounts-hero">
              <dt className="accounts-figure-label">Total earned</dt>
              <dd className="accounts-hero-value">{formatPaise(report.totalPaise, report.currency)}</dd>
              <dd className="accounts-figure-sub">{period} · {scopeName}</dd>
            </div>
            <Figure
              label="Paid sessions"
              value={report.sessionCount.toLocaleString('en-IN')}
              sub={report.sessionCount > 0
                ? `${formatPaise(Math.round(report.totalPaise / report.sessionCount), report.currency)} on average`
                : period}
            />
            <Figure label="Paid time" value={durationLabel(report.paidMinutes)} sub={`${report.paidMinutes.toLocaleString('en-IN')} min sold`} />
            <Figure
              label="Most played game"
              value={topGame?.title ?? 'None yet'}
              title={topGame?.title}
              name
              sub={topGame
                ? `${plural(topGame.sessionCount, 'session', 'sessions')} · ${durationLabel(topGame.playMinutes)}`
                : 'No games recorded in this period'}
            />
          </dl>

          <PageSection
            title="Paid sessions"
            description={report.rows.length > 0 ? `${sortLabel}. Each strip is the paid time, marked where games were played. Select a session for details.` : undefined}
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
                {/* An empty breakdown keeps its container, so it lines up with the table beside it. */}
                {report.byStation.length === 0 ? (
                  <Panel><p className="accounts-note">No device earned in this period.</p></Panel>
                ) : (
                  <div className="admin-table-scroll accounts-rank-table">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th scope="col" className="accounts-rank-col"><span className="admin-visually-hidden">Rank</span></th>
                          <th scope="col">Device</th>
                          <th scope="col" className="admin-num">Sessions</th>
                          <th scope="col" className="admin-num">Amount</th>
                          <th scope="col" className="admin-num accounts-share-col">Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.byStation.map((station, index) => (
                          <StationShareRow
                            key={station.stationId}
                            rank={index + 1}
                            station={station}
                            totalPaise={report.totalPaise}
                            currency={report.currency}
                            picked={view.stationIds.includes(station.stationId)}
                            onToggle={() => toggleStation(station)}
                          />
                        ))}
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
                <Panel><p className="accounts-note">No games recorded in this period. Sessions from before version 0.25.0 did not record games.</p></Panel>
              ) : (
                <div className="admin-table-scroll accounts-rank-table accounts-rank-table--games">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th scope="col" className="accounts-rank-col"><span className="admin-visually-hidden">Rank</span></th>
                        <th scope="col">Game</th>
                        <th scope="col" className="admin-num">Sessions</th>
                        <th scope="col" className="admin-num accounts-share-col">Play time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {games.map((game, index) => (
                        <GameShareRow key={game.gameId || game.title} rank={index + 1} game={game} maxMinutes={maxGameMinutes} />
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

/** A secondary figure beside the hero: label, value (quieter than the hero), optional sub line. `name` sets a word value (a game title) a step smaller than a number. */
function Figure(props: { label: string; value: ReactNode; sub?: ReactNode; title?: string; name?: boolean }): JSX.Element {
  return (
    <div className="accounts-figure">
      <dt className="accounts-figure-label">{props.label}</dt>
      <dd className={`accounts-figure-value${props.name ? ' accounts-figure-value--name' : ''}`} title={props.title}>{props.value}</dd>
      {props.sub && <dd className="accounts-figure-sub">{props.sub}</dd>}
    </div>
  );
}

// ------------------------------------------------------------- chart tooltip

interface ChartTipState {
  anchor: DOMRect;
  content: ReactNode;
}

interface ChartTipController {
  tip: ChartTipState | null;
  show: (anchor: DOMRect, content: ReactNode) => void;
  hide: () => void;
}

/** Hover/focus readout for a chart mark (timeline segment, share bar). Hides on scroll or resize. */
function useChartTip(): ChartTipController {
  const [tip, setTip] = useState<ChartTipState | null>(null);
  const open = tip !== null;
  useEffect(() => {
    if (!open) return undefined;
    const hide = (): void => setTip(null);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [open]);
  return useMemo(() => ({
    tip,
    show: (anchor: DOMRect, content: ReactNode) => setTip({ anchor, content }),
    hide: () => setTip(null)
  }), [tip]);
}

/**
 * The readout floats above its mark (below it when there is no room), kept
 * inside the window. It is fixed-positioned so table scrollers never clip it,
 * and stays inside .admin-screen so it follows the theme. Screen readers get
 * the same text from the mark's label.
 */
function ChartTip(props: { tip: ChartTipState | null }): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !props.tip) {
      setPosition(null);
      return;
    }
    const { anchor } = props.tip;
    const gap = 8;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const left = Math.min(Math.max(8, anchor.left + anchor.width / 2 - width / 2), window.innerWidth - width - 8);
    const above = anchor.top - gap - height;
    setPosition({ left, top: above >= 8 ? above : anchor.bottom + gap });
  }, [props.tip]);

  if (!props.tip) return null;
  return (
    <div
      ref={ref}
      className="accounts-tip"
      aria-hidden="true"
      style={position ? { left: position.left, top: position.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {props.tip.content}
    </div>
  );
}

function TipLines(props: { title: ReactNode; detail: ReactNode }): JSX.Element {
  return (
    <>
      <span className="accounts-tip-title">{props.title}</span>
      <span className="accounts-tip-detail">{props.detail}</span>
    </>
  );
}

// ------------------------------------------------------------ share bars

/** One thin single-hue bar from the start, the exact value in a right-aligned tabular column. */
function ShareMeter(props: { percent: number; value: ReactNode; tip: ChartTipController; tipContent: ReactNode; meterRef?: { current: HTMLSpanElement | null } }): JSX.Element {
  const width = props.percent > 0 ? Math.max(1.5, Math.min(100, props.percent)) : 0;
  return (
    <span
      ref={(element) => {
        if (props.meterRef) props.meterRef.current = element;
      }}
      className="accounts-meter"
      onMouseEnter={(event) => props.tip.show(barRect(event.currentTarget), props.tipContent)}
      onMouseLeave={props.tip.hide}
    >
      <span className="accounts-meter-track" aria-hidden="true">
        <span className="accounts-meter-fill" style={{ width: `${width}%` }} />
      </span>
      <span className="accounts-meter-value">{props.value}</span>
    </span>
  );
}

/** The bar's own box, so the readout sits just above the bar rather than above the cell. */
function barRect(meter: HTMLElement): DOMRect {
  return (meter.querySelector('.accounts-meter-track') ?? meter).getBoundingClientRect();
}

function StationShareRow(props: {
  rank: number;
  station: EarningsReport['byStation'][number];
  totalPaise: number;
  currency: string;
  picked: boolean;
  onToggle: () => void;
}): JSX.Element {
  const { station } = props;
  const tip = useChartTip();
  const meterRef = useRef<HTMLSpanElement | null>(null);
  const share = props.totalPaise > 0 ? (station.amountPaise / props.totalPaise) * 100 : 0;
  const amount = formatPaise(station.amountPaise, props.currency);
  const tipContent = (
    <TipLines
      title={station.stationName}
      detail={<><strong>{amount}</strong> · {share.toLocaleString('en-IN', { maximumFractionDigits: 1 })}% of the total</>}
    />
  );
  return (
    <tr className={`accounts-rank-row is-clickable${props.picked ? ' is-selected' : ''}`} onClick={props.onToggle}>
      <td className="accounts-rank">{props.rank}</td>
      <td className="accounts-rank-name">
        <button
          className="accounts-row-pick"
          type="button"
          aria-pressed={props.picked}
          title={props.picked ? `Stop filtering by ${station.stationName}` : `Show only ${station.stationName}`}
          onClick={(event) => {
            event.stopPropagation();
            props.onToggle();
          }}
          onFocus={() => {
            if (meterRef.current) tip.show(barRect(meterRef.current), tipContent);
          }}
          onBlur={tip.hide}
        >
          <span>{station.stationName}</span>
        </button>
      </td>
      <td className="admin-num">{station.sessionCount.toLocaleString('en-IN')}</td>
      <td className="admin-num accounts-amount">{amount}</td>
      <td className="accounts-share-cell">
        <ShareMeter percent={share} value={`${Math.round(share)}%`} tip={tip} tipContent={tipContent} meterRef={meterRef} />
        <ChartTip tip={tip.tip} />
      </td>
    </tr>
  );
}

function GameShareRow(props: { rank: number; game: EarningsReport['byGame'][number]; maxMinutes: number }): JSX.Element {
  const { game } = props;
  const tip = useChartTip();
  const tipContent = (
    <TipLines
      title={game.title}
      detail={<><strong>{durationLabel(game.playMinutes)}</strong> · {plural(game.sessionCount, 'session', 'sessions')}</>}
    />
  );
  return (
    <tr>
      <td className="accounts-rank">{props.rank}</td>
      <td className="accounts-rank-name"><span title={game.title}>{game.title}</span></td>
      <td className="admin-num">{game.sessionCount.toLocaleString('en-IN')}</td>
      <td className="accounts-share-cell">
        <ShareMeter percent={(game.playMinutes / props.maxMinutes) * 100} value={durationLabel(game.playMinutes)} tip={tip} tipContent={tipContent} />
        <ChartTip tip={tip.tip} />
      </td>
    </tr>
  );
}

// ---------------------------------------------------------- session timeline

/** One game entry on the strip: real times for the labels, the part inside the paid time for drawing. */
interface TimelinePlay {
  /** Index in `row.games`, so the expanded list and the strip can point at each other. */
  entryIndex: number;
  title: string;
  from: number;
  to: number;
  /** Still open and counting up to now. */
  live: boolean;
  minutes: number;
  drawFrom: number;
  drawTo: number;
  /** "Forza Horizon 5 · 2:06–2:50 pm · 44 min" */
  label: string;
}

interface TimelinePiece {
  /** A game played, paid time with no game, or (live sessions) paid time still to come. */
  kind: 'game' | 'idle' | 'left';
  from: number;
  to: number;
  /** Index in `plays` for game pieces. */
  play?: number;
}

interface SessionTimeline {
  /** The paid window: from the session start for its paid minutes. */
  start: number;
  end: number;
  paidMinutes: number;
  plays: TimelinePlay[];
  /** Game and idle pieces covering the paid window, in order. */
  pieces: TimelinePiece[];
  playedMinutes: number;
  /** Set while the session is live: now, inside the paid window. */
  now?: number;
}

/** "2:06–2:50 pm" (one am/pm when both ends share it), or "2:51 pm–now". */
function timeRangeLabel(from: number, to: number, toNow: boolean): string {
  const start = timeLabel(new Date(from).toISOString());
  if (toNow) return `${start}–now`;
  const end = timeLabel(new Date(to).toISOString());
  const split = (label: string): [string, string] => {
    const match = /^(.*?)[\s  ]*([ap]\.?\s?m\.?)$/i.exec(label);
    return match ? [match[1], match[2].toLowerCase()] : [label, ''];
  };
  const [startTime, startHalf] = split(start);
  const [, endHalf] = split(end);
  return startHalf && startHalf === endHalf ? `${startTime}–${end}` : `${start}–${end}`;
}

/** "3 pm" for a scale label. */
function hourLabel(time: number): string {
  return new Date(time).toLocaleTimeString('en-IN', { hour: 'numeric' });
}

/**
 * How the paid time was used. The paid window runs from `startedAt` for
 * `durationMinutes`. Each game entry is a piece from its start to its end,
 * where an open entry ends like the minutes do (`entryEnd`: the session end,
 * else the paid time's end but never after now, else now), clamped to the
 * paid window. Whatever is left between games is idle.
 */
function sessionTimeline(row: EarningsSessionRow, now: number): SessionTimeline | null {
  const start = new Date(row.startedAt).getTime();
  const paidMinutes = Math.max(0, row.durationMinutes);
  if (!Number.isFinite(start) || paidMinutes <= 0) return null;
  const end = start + paidMinutes * MINUTE;

  const plays: TimelinePlay[] = [];
  row.games.forEach((entry, entryIndex) => {
    const from = new Date(entry.startedAt).getTime();
    const to = entryEnd(entry, row, now);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    const drawFrom = Math.max(from, start);
    const drawTo = Math.min(to, end);
    if (drawTo <= drawFrom) return;
    const live = !entry.endedAt && !row.endedAt && to >= now;
    const title = entry.title || 'Unknown game';
    const minutes = entryMinutes(entry, row, now);
    plays.push({
      entryIndex,
      title,
      from,
      to,
      live,
      minutes,
      drawFrom,
      drawTo,
      label: `${title} · ${timeRangeLabel(from, to, live)} · ${durationLabel(minutes)}`
    });
  });
  plays.sort((left, right) => left.drawFrom - right.drawFrom);

  const pieces: TimelinePiece[] = [];
  let cursor = start;
  let played = 0;
  plays.forEach((play, index) => {
    // Entries never overlap in practice; if they do, the later one starts where the earlier one ends.
    const from = Math.max(play.drawFrom, cursor);
    if (play.drawTo <= from) return;
    if (from > cursor) pieces.push({ kind: 'idle', from: cursor, to: from });
    pieces.push({ kind: 'game', from, to: play.drawTo, play: index });
    played += play.drawTo - from;
    cursor = play.drawTo;
  });
  const live = row.status === 'active' && !row.endedAt && !isUnfinishedSession(row, now) && now > start && now < end;
  if (cursor < end) {
    // A live session splits what is left at now: idle so far, then the time still to come.
    if (live && now > cursor) pieces.push({ kind: 'idle', from: cursor, to: now });
    pieces.push({ kind: live ? 'left' : 'idle', from: live ? Math.max(cursor, now) : cursor, to: end });
  }

  return { start, end, paidMinutes, plays, pieces, playedMinutes: played / MINUTE, now: live ? now : undefined };
}

/** "Paid time 1 hr 30 min, 1 hr 28 min played: Forza Horizon 5, 2:06 to 2:50 pm, 44 min; ..." */
function timelineSummary(timeline: SessionTimeline): string {
  const paid = `Paid time ${durationLabel(timeline.paidMinutes)}`;
  if (timeline.plays.length === 0) return `${paid}. No games recorded.`;
  const plays = timeline.plays.map((play) => `${play.title}, ${timeRangeLabel(play.from, play.to, play.live).replace('–', ' to ')}, ${durationLabel(play.minutes)}`);
  return `${paid}, ${durationLabel(timeline.playedMinutes)} played: ${plays.join('; ')}.`;
}

/** Ticks on the clock's quarter (half, whole) hours inside the paid window. */
function scaleTicks(start: number, end: number): number[] {
  const span = (end - start) / MINUTE;
  const step = span <= 150 ? 15 : span <= 300 ? 30 : 60;
  const first = new Date(start);
  first.setSeconds(0, 0);
  const offset = first.getMinutes() % step;
  let tick = first.getTime() + (offset === 0 && first.getTime() >= start ? 0 : (step - offset) * MINUTE);
  const ticks: number[] = [];
  for (; tick < end; tick += step * MINUTE) {
    if (tick - start >= MINUTE && end - tick >= MINUTE) ticks.push(tick);
  }
  return ticks;
}

/**
 * The session timeline strip, the Accounts signature: the full width is the
 * paid time; each game played is a neutral segment (alternating two tones),
 * idle time stays empty track, and every piece is separated by a 2px gap.
 * `detail` is the larger strip of the expanded row, with a clock scale and
 * focusable segments; the table cell strip is one image with a summary label.
 */
function SessionStrip(props: {
  timeline: SessionTimeline;
  detail?: boolean;
  activeEntry?: number | null;
  onActiveEntry?: (entryIndex: number | null) => void;
}): JSX.Element {
  const { timeline, detail } = props;
  const tip = useChartTip();
  const stripRef = useRef<HTMLSpanElement>(null);
  const span = timeline.end - timeline.start;
  const percent = (time: number): number => ((time - timeline.start) / span) * 100;
  const last = timeline.pieces.length - 1;

  // The readout points at the drawn bar, not at the taller hit area around it.
  const anchorFor = (piece: HTMLElement): DOMRect => {
    const box = piece.getBoundingClientRect();
    const strip = stripRef.current?.getBoundingClientRect();
    return strip ? new DOMRect(box.left, strip.top, box.width, strip.height) : box;
  };

  let gameIndex = 0;
  const pieces = timeline.pieces.map((piece, index) => {
    const left = percent(piece.from);
    const width = percent(piece.to) - left;
    // A 2px gap at every inner boundary: 1px off each neighbour. The strip's own ends stay square to the track.
    const insetLeft = index === 0 ? 0 : 1;
    const insetRight = index === last ? 0 : 1;
    const style: CSSProperties = {
      left: `calc(${left.toFixed(3)}% + ${insetLeft}px)`,
      width: `max(${piece.kind === 'game' ? 2 : 0}px, calc(${width.toFixed(3)}% - ${insetLeft + insetRight}px))`
    };

    if (piece.kind !== 'game') {
      const minutes = (piece.to - piece.from) / MINUTE;
      const content = (
        <TipLines
          title={piece.kind === 'left' ? 'Time left' : 'No game'}
          detail={<>{timeRangeLabel(piece.from, piece.to, false)} · <strong>{durationLabel(minutes)}</strong></>}
        />
      );
      return (
        <span
          key={`${piece.kind}-${piece.from}`}
          className={`accounts-strip-piece is-idle${piece.kind === 'left' ? ' is-left' : ''}`}
          style={style}
          onMouseEnter={(event) => tip.show(anchorFor(event.currentTarget), content)}
          onMouseLeave={tip.hide}
        />
      );
    }

    const play = timeline.plays[piece.play ?? 0];
    const alternate = gameIndex % 2 === 1;
    gameIndex += 1;
    const content = (
      <TipLines
        title={play.title}
        detail={<>{timeRangeLabel(play.from, play.to, play.live)} · <strong>{durationLabel(play.minutes)}</strong></>}
      />
    );
    const enter = (element: HTMLElement): void => {
      tip.show(anchorFor(element), content);
      props.onActiveEntry?.(play.entryIndex);
    };
    const leave = (): void => {
      tip.hide();
      props.onActiveEntry?.(null);
    };
    return (
      <span
        key={`game-${play.entryIndex}`}
        className={`accounts-strip-piece is-game${alternate ? ' is-alt' : ''}${props.activeEntry === play.entryIndex ? ' is-active' : ''}`}
        style={style}
        role={detail ? 'img' : undefined}
        tabIndex={detail ? 0 : undefined}
        aria-label={detail ? play.label : undefined}
        onMouseEnter={(event) => enter(event.currentTarget)}
        onMouseLeave={leave}
        onFocus={detail ? (event) => enter(event.currentTarget) : undefined}
        onBlur={detail ? leave : undefined}
      />
    );
  });

  const strip = (
    <span
      ref={stripRef}
      className={`accounts-strip${detail ? ' accounts-strip--detail' : ''}`}
      role={detail ? 'group' : 'img'}
      aria-label={detail ? `Session timeline, ${timeRangeLabel(timeline.start, timeline.end, false).replace('–', ' to ')}` : timelineSummary(timeline)}
    >
      {pieces}
      {detail && timeline.now !== undefined && (
        <span className="accounts-strip-now" style={{ left: `${percent(timeline.now).toFixed(3)}%` }} aria-hidden="true" />
      )}
    </span>
  );

  if (!detail) {
    return (
      <>
        {strip}
        <ChartTip tip={tip.tip} />
      </>
    );
  }

  // Scale: start and end of the paid time, clock ticks between, hour labels where they have room.
  const nowAt = timeline.now !== undefined ? percent(timeline.now) : undefined;
  const ticks = scaleTicks(timeline.start, timeline.end);
  return (
    <div className="accounts-strip-chart">
      {strip}
      <div className="accounts-strip-scale" aria-hidden="true">
        {ticks.map((tick) => {
          const at = percent(tick);
          const hour = new Date(tick).getMinutes() === 0;
          const labelled = hour && at > 16 && at < 84 && (nowAt === undefined || Math.abs(at - nowAt) > 12);
          return (
            <span key={tick} className={`accounts-strip-tick${hour ? ' is-hour' : ''}`} style={{ left: `${at.toFixed(3)}%` }}>
              {labelled && <span className="accounts-strip-tick-label">{hourLabel(tick)}</span>}
            </span>
          );
        })}
        {nowAt !== undefined && nowAt > 10 && nowAt < 90 && (
          <span className="accounts-strip-tick is-now" style={{ left: `${nowAt.toFixed(3)}%` }}>
            <span className="accounts-strip-tick-label">Now</span>
          </span>
        )}
        <span className="accounts-strip-end is-start">{timeLabel(new Date(timeline.start).toISOString())}</span>
        <span className="accounts-strip-end is-end">{timeLabel(new Date(timeline.end).toISOString())}</span>
      </div>
      <ChartTip tip={tip.tip} />
    </div>
  );
}

// ------------------------------------------------------------ sessions table

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
  const timeline = sessionTimeline(row, props.now);
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
          {timeline && <SessionStrip timeline={timeline} />}
          {props.sessionGames.length === 0 ? (
            <span className="accounts-games accounts-muted">{row.status === 'active' && !isUnfinishedSession(row, props.now) ? 'None yet' : 'Not recorded'}</span>
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
            <SessionDetail row={row} now={props.now} timeline={timeline} />
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

function SessionDetail(props: { row: EarningsSessionRow; now: number; timeline: SessionTimeline | null }): JSX.Element {
  const { row, timeline } = props;
  const [activeEntry, setActiveEntry] = useState<number | null>(null);
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
  const usage = timeline && timeline.plays.length > 0
    ? [
        `${durationLabel(timeline.playedMinutes)} played of ${durationLabel(timeline.paidMinutes)}`,
        timeline.now !== undefined ? `${durationLabel((timeline.end - timeline.now) / MINUTE)} left` : ''
      ].filter(Boolean).join(' · ')
    : '';

  return (
    <div className="accounts-detail">
      <section className="accounts-detail-section">
        <header className="accounts-detail-heading">
          <h3 className="admin-subheading">Games played</h3>
          {usage && <span className="accounts-detail-usage">{usage}</span>}
        </header>
        {timeline && <SessionStrip timeline={timeline} detail activeEntry={activeEntry} onActiveEntry={setActiveEntry} />}
        {row.games.length === 0 ? (
          <p className="accounts-note">
            {playing ? 'No game started yet.' : 'Not recorded. Games are recorded for sessions from version 0.25.0.'}
          </p>
        ) : (
          <ol className="accounts-timeline">
            {row.games.map((entry, index) => (
              <li
                key={`${entry.gameId}-${entry.startedAt}-${index}`}
                className={activeEntry === index ? 'is-active' : undefined}
                onMouseEnter={() => setActiveEntry(index)}
                onMouseLeave={() => setActiveEntry(null)}
              >
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
        <header className="accounts-detail-heading">
          <h3 className="admin-subheading">{payers.length > 1 ? `Payments (${payers.length})` : 'Payment'}</h3>
        </header>
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
