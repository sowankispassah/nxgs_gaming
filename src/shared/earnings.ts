// Pure earnings helpers shared by the main process (both report scopes) and
// verification scripts. Keep this file dependency-free and type-only imports
// so Node can load it with --experimental-strip-types.
import type {
  EarningsFacets,
  EarningsGameTotal,
  EarningsQuery,
  EarningsReport,
  EarningsScope,
  EarningsSessionRow,
  EarningsSort,
  EarningsStationTotal,
  LocalSessionStatus,
  PaymentPayerDetails,
  SessionGamePlay,
  UNKNOWN_PAYMENT_METHOD
} from './types';

export interface EarningsReportOptions {
  scope: EarningsScope;
  from?: string;
  to?: string;
  /** Used for open game entries in active sessions and `generatedAt`. Defaults to the current time. */
  now?: Date | string | number;
  /** The cloud hit its row cap, so `rows` is incomplete. */
  truncated?: boolean;
  /** Filter options from the sessions before the attribute filters; computed from `rows` when omitted. */
  facets?: EarningsFacets;
  /** Row order; defaults to `newest`. */
  sort?: EarningsSort;
}

// Same value as UNKNOWN_PAYMENT_METHOD in types.ts (a type-only import keeps
// this file loadable by Node; the type annotation keeps them in step).
const NO_PAYMENT_METHOD: typeof UNKNOWN_PAYMENT_METHOD = 'unknown';

export const EARNINGS_SORTS: readonly EarningsSort[] = ['newest', 'oldest', 'amount_high', 'amount_low', 'longest'];

export const EARNINGS_SORT_LABELS: Readonly<Record<EarningsSort, string>> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  amount_high: 'Highest amount',
  amount_low: 'Lowest amount',
  longest: 'Longest session'
};

/** Every session status, in the order filter chips and facets list them. */
export const EARNINGS_STATUSES: readonly LocalSessionStatus[] = ['completed', 'expired', 'interrupted', 'active'];

const PAYER_FIELDS: Array<[keyof Omit<PaymentPayerDetails, 'checkoutId'>, string]> = [
  ['razorpayPaymentId', 'razorpay_payment_id'],
  ['name', 'name'],
  ['phone', 'phone'],
  ['email', 'email'],
  ['method', 'method'],
  ['upiId', 'upi_id'],
  ['bank', 'bank'],
  ['wallet', 'wallet'],
  ['cardNetwork', 'card_network'],
  ['cardLast4', 'card_last4'],
  ['paidAt', 'paid_at']
];

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  upi: 'UPI',
  card: 'Card',
  netbanking: 'Net banking',
  wallet: 'Wallet',
  emi: 'EMI',
  paylater: 'Pay later',
  cardless_emi: 'Cardless EMI',
  bank_transfer: 'Bank transfer'
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function timeOf(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/** Paise as plain rupees with two decimals, e.g. 12345 -> "123.45". */
export function formatPaise(paise: number): string {
  const rounded = Math.round(Number(paise) || 0);
  const sign = rounded < 0 ? '-' : '';
  const absolute = Math.abs(rounded);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

/** Staff-readable Razorpay method name: `upi` -> "UPI", `netbanking` -> "Net banking". */
export function paymentMethodLabel(method: string | undefined): string {
  const key = text(method).toLowerCase();
  if (!key) return '';
  return PAYMENT_METHOD_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/** Label for a payment-method filter value; `unknown` reads "No details". */
export function paymentMethodFilterLabel(method: string): string {
  return method === NO_PAYMENT_METHOD ? 'No details' : paymentMethodLabel(method);
}

/**
 * Accepts payer details in wire (snake_case) or local (camelCase) form and
 * returns them camelCased, or undefined when nothing beyond the checkout ID is
 * known. Razorpay's placeholder email is dropped.
 */
export function normalizePayerDetails(value: unknown, fallbackCheckoutId = ''): PaymentPayerDetails | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const checkoutId = text(row.checkoutId) || text(row.checkout_id) || text(fallbackCheckoutId);
  if (!checkoutId) return undefined;
  const payer: PaymentPayerDetails = { checkoutId };
  let known = false;
  for (const [camel, snake] of PAYER_FIELDS) {
    let fieldValue = text(row[camel]) || text(row[snake]);
    if (camel === 'email' && fieldValue.toLowerCase() === 'void@razorpay.com') fieldValue = '';
    if (camel === 'paidAt' && fieldValue && !Number.isFinite(Date.parse(fieldValue))) fieldValue = '';
    if (!fieldValue) continue;
    payer[camel] = fieldValue;
    known = true;
  }
  return known ? payer : undefined;
}

export function normalizePayerList(value: unknown): PaymentPayerDetails[] {
  if (!Array.isArray(value)) return [];
  const byCheckout = new Map<string, PaymentPayerDetails>();
  for (const entry of value) {
    const payer = normalizePayerDetails(entry);
    if (payer) byCheckout.set(payer.checkoutId, payer);
  }
  return [...byCheckout.values()];
}

/** Adds or replaces the payer for its checkout. Returns true when the list changed. */
export function upsertPayer(payers: PaymentPayerDetails[], payer: PaymentPayerDetails): boolean {
  const index = payers.findIndex((entry) => entry.checkoutId === payer.checkoutId);
  if (index < 0) {
    payers.push(payer);
    return true;
  }
  if (JSON.stringify(payers[index]) === JSON.stringify(payer)) return false;
  payers[index] = payer;
  return true;
}

/**
 * Minutes played for one entry. An open entry runs to the session end; while
 * the session has no end it stops at the paid expiry (a station that went
 * offline mid-session never reports an end), or `now` if that comes first.
 */
export function gamePlayMinutes(
  entry: SessionGamePlay,
  session: Pick<EarningsSessionRow, 'endedAt' | 'expiresAt'>,
  now: number
): number {
  const startedAt = timeOf(entry.startedAt);
  if (!Number.isFinite(startedAt)) return 0;
  let end = timeOf(entry.endedAt);
  if (!Number.isFinite(end)) end = timeOf(session.endedAt);
  if (!Number.isFinite(end)) {
    const expiresAt = timeOf(session.expiresAt);
    end = Number.isFinite(expiresAt) ? Math.min(now, expiresAt) : now;
  }
  return Math.max(0, (end - startedAt) / 60_000);
}

/** Distinct game titles in play order. */
export function sessionGameTitles(row: Pick<EarningsSessionRow, 'games'>): string[] {
  return unique(row.games.map((game) => game.title || game.gameId));
}

// ---------------------------------------------------------------------------
// Filters, sorting and facets: one path for the table, the tiles and the CSV
// ---------------------------------------------------------------------------

function nowTime(now: Date | string | number | undefined): number {
  if (now === undefined) return Date.now();
  const time = new Date(now).getTime();
  return Number.isFinite(time) ? time : Date.now();
}

function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

/** Lowercase payment methods of a session's payers; `unknown` when none is known. */
export function sessionPaymentMethods(row: Pick<EarningsSessionRow, 'payers'>): string[] {
  const methods = unique((row.payers ?? []).map((payer) => text(payer.method).toLowerCase()));
  return methods.length > 0 ? methods : [NO_PAYMENT_METHOD];
}

/** Stations asked for: `stationIds` plus the older single `stationId`. Empty means every station. */
export function earningsStationIds(query: Pick<EarningsQuery, 'stationId' | 'stationIds'>): string[] {
  return unique([...(query.stationIds ?? []), ...(query.stationId ? [query.stationId] : [])]);
}

/** Period and device filtering only: the sessions the facets describe. */
export function earningsRowsInScope(
  rows: EarningsSessionRow[],
  query: Pick<EarningsQuery, 'from' | 'to' | 'stationId' | 'stationIds'>
): EarningsSessionRow[] {
  const from = timeOf(query.from);
  const to = timeOf(query.to);
  const stations = new Set(earningsStationIds(query));
  return rows.filter((row) => {
    const startedAt = timeOf(row.startedAt);
    if (Number.isFinite(from) && !(startedAt >= from)) return false;
    if (Number.isFinite(to) && !(startedAt < to)) return false;
    return stations.size === 0 || stations.has(row.stationId);
  });
}

/**
 * True when the session matches the search text: a case-insensitive substring
 * of a payer's phone, email, name, UPI ID or Razorpay payment ID, a checkout
 * ID, plan name, device name or game title. With 4 or more digits the phone is
 * also compared digits-only, so "+91 98765 43210" finds "+919876543210".
 */
export function earningsRowMatchesSearch(row: EarningsSessionRow, search: string): boolean {
  const needle = text(search).toLowerCase();
  if (!needle) return true;
  const payers = row.payers ?? [];
  const haystack = [
    ...payers.flatMap((payer) => [payer.phone, payer.email, payer.name, payer.upiId, payer.razorpayPaymentId]),
    ...(row.checkoutIds ?? []),
    ...(row.planNames ?? []),
    row.stationName,
    ...(row.games ?? []).map((game) => game.title)
  ];
  if (haystack.some((value) => typeof value === 'string' && value.toLowerCase().includes(needle))) return true;
  const digits = digitsOf(needle);
  return digits.length >= 4 && payers.some((payer) => digitsOf(payer.phone ?? '').includes(digits));
}

/**
 * Applies every filter in `query` to the rows: period (`from` inclusive, `to`
 * exclusive), devices, games, payment methods, statuses, verified payments and
 * search. Order is kept. `now` is accepted for call sites that pass it, but no
 * filter reads the clock: stations' clocks differ, and their rows must not vanish.
 */
export function filterEarningsRows(
  rows: EarningsSessionRow[],
  query: Omit<EarningsQuery, 'scope' | 'sort'>,
  _now?: Date | string | number
): EarningsSessionRow[] {
  const games = new Set(query.gameIds ?? []);
  const methods = new Set((query.paymentMethods ?? []).map((method) => method.toLowerCase()));
  const statuses = new Set(query.statuses ?? []);
  const search = text(query.search);
  return earningsRowsInScope(rows, query).filter((row) =>
    (games.size === 0 || (row.games ?? []).some((game) => games.has(game.gameId)))
    && (methods.size === 0 || sessionPaymentMethods(row).some((method) => methods.has(method)))
    && (statuses.size === 0 || statuses.has(row.status))
    && (!query.verifiedOnly || row.paymentVerified === true)
    && (!search || earningsRowMatchesSearch(row, search))
  );
}

function newestFirst(left: EarningsSessionRow, right: EarningsSessionRow): number {
  return (timeOf(right.startedAt) || 0) - (timeOf(left.startedAt) || 0) || right.id.localeCompare(left.id);
}

/** A sorted copy: by start time, amount (ties newest first) or paid duration (ties newest first). */
export function sortEarningsRows(rows: EarningsSessionRow[], sort: EarningsSort = 'newest'): EarningsSessionRow[] {
  const amount = (row: EarningsSessionRow) => Number(row.amountPaise) || 0;
  const minutes = (row: EarningsSessionRow) => Number(row.durationMinutes) || 0;
  const compare: Record<EarningsSort, (left: EarningsSessionRow, right: EarningsSessionRow) => number> = {
    newest: newestFirst,
    oldest: (left, right) => -newestFirst(left, right),
    amount_high: (left, right) => amount(right) - amount(left) || newestFirst(left, right),
    amount_low: (left, right) => amount(left) - amount(right) || newestFirst(left, right),
    longest: (left, right) => minutes(right) - minutes(left) || newestFirst(left, right)
  };
  return [...rows].sort(compare[sort] ?? newestFirst);
}

/** Filter options for the sessions in the period and devices (before the other filters). */
export function earningsFacets(rows: EarningsSessionRow[]): EarningsFacets {
  const games = new Map<string, string>();
  const methods = new Set<string>();
  const statuses = new Set<LocalSessionStatus>();
  for (const row of sortEarningsRows(rows, 'newest')) {
    statuses.add(row.status);
    for (const method of sessionPaymentMethods(row)) methods.add(method);
    // Newest first, so the first title seen for a game is its latest name.
    for (const game of row.games ?? []) {
      if (game?.gameId && !games.has(game.gameId)) games.set(game.gameId, game.title || game.gameId);
    }
  }
  return {
    games: [...games].map(([gameId, title]) => ({ gameId, title }))
      .sort((left, right) => left.title.localeCompare(right.title) || left.gameId.localeCompare(right.gameId)),
    paymentMethods: [...methods].sort((left, right) =>
      Number(left === NO_PAYMENT_METHOD) - Number(right === NO_PAYMENT_METHOD) || left.localeCompare(right)
    ),
    statuses: EARNINGS_STATUSES.filter((status) => statuses.has(status)),
    sessionCount: rows.length
  };
}

/**
 * The single path from raw rows to a report: facets from the period and
 * devices, then every filter, then the sort. Used for both scopes and the CSV.
 */
export function buildEarningsReportForQuery(
  rows: EarningsSessionRow[],
  query: EarningsQuery,
  options: { now?: Date | string | number; truncated?: boolean } = {}
): EarningsReport {
  const now = nowTime(options.now);
  const inScope = earningsRowsInScope(rows, query);
  return buildEarningsReport(filterEarningsRows(inScope, query, now), {
    scope: query.scope,
    from: query.from,
    to: query.to,
    now,
    truncated: options.truncated,
    facets: earningsFacets(inScope),
    sort: query.sort
  });
}

export function buildEarningsReport(rows: EarningsSessionRow[], options: EarningsReportOptions): EarningsReport {
  const now = nowTime(options.now);
  const sort = options.sort && EARNINGS_SORTS.includes(options.sort) ? options.sort : 'newest';
  // Totals walk newest first so station names and game titles are the latest ones.
  const sorted = sortEarningsRows(rows, 'newest');

  const stations = new Map<string, EarningsStationTotal>();
  const games = new Map<string, { title: string; sessions: Set<string>; minutes: number }>();
  let totalPaise = 0;
  let paidMinutes = 0;

  for (const row of sorted) {
    const amount = Number(row.amountPaise) || 0;
    totalPaise += amount;
    paidMinutes += Number(row.durationMinutes) || 0;

    const station = stations.get(row.stationId)
      ?? { stationId: row.stationId, stationName: row.stationName, sessionCount: 0, amountPaise: 0 };
    station.sessionCount += 1;
    station.amountPaise += amount;
    stations.set(row.stationId, station);

    for (const entry of row.games ?? []) {
      if (!entry?.gameId) continue;
      // Rows are newest first, so the first title seen is the most recent one.
      const game = games.get(entry.gameId) ?? { title: entry.title || entry.gameId, sessions: new Set<string>(), minutes: 0 };
      game.sessions.add(`${row.stationId}\u0000${row.id}`);
      game.minutes += gamePlayMinutes(entry, row, now);
      games.set(entry.gameId, game);
    }
  }

  const byStation = [...stations.values()].sort((left, right) =>
    right.amountPaise - left.amountPaise
    || right.sessionCount - left.sessionCount
    || left.stationName.localeCompare(right.stationName)
  );
  const byGame: EarningsGameTotal[] = [...games.entries()]
    .map(([gameId, game]) => ({
      gameId,
      title: game.title,
      sessionCount: game.sessions.size,
      playMinutes: Math.round(game.minutes)
    }))
    .sort((left, right) =>
      right.playMinutes - left.playMinutes
      || right.sessionCount - left.sessionCount
      || left.title.localeCompare(right.title)
    );

  return {
    scope: options.scope,
    generatedAt: new Date(now).toISOString(),
    ...(options.from ? { from: options.from } : {}),
    ...(options.to ? { to: options.to } : {}),
    ...(options.truncated ? { truncated: true } : {}),
    currency: sorted.find((row) => row.currency)?.currency || 'INR',
    totalPaise,
    sessionCount: sorted.length,
    paidMinutes,
    rows: sort === 'newest' ? sorted : sortEarningsRows(rows, sort),
    byStation,
    byGame,
    facets: options.facets ?? earningsFacets(rows),
    sort
  };
}

// ---------------------------------------------------------------------------
// CSV export (RFC 4180, CRLF line ends)
// ---------------------------------------------------------------------------

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Local date and time, e.g. "2026-10-17 19:42", which spreadsheets read as a date. */
export function formatCsvDateTime(value: string | undefined): string {
  const time = timeOf(value);
  if (!Number.isFinite(time)) return '';
  const date = new Date(time);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function quoteCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Text from people or the cloud: neutralise spreadsheet formulas, then quote. */
export function csvTextCell(value: string): string {
  const cell = value ?? '';
  return quoteCsv(/^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell);
}

function csvNumberCell(value: number | string): string {
  return quoteCsv(String(value));
}

function payerMethodText(payer: PaymentPayerDetails): string {
  const label = paymentMethodLabel(payer.method);
  if (!label) return '';
  const method = payer.method?.toLowerCase();
  const detail = method === 'card'
    ? [payer.cardNetwork, payer.cardLast4 ? `****${payer.cardLast4}` : ''].filter(Boolean).join(' ')
    : method === 'netbanking'
      ? payer.bank ?? ''
      : method === 'wallet'
        ? payer.wallet ?? ''
        : '';
  return detail ? `${label} (${detail})` : label;
}

function joinPayers(payers: PaymentPayerDetails[], pick: (payer: PaymentPayerDetails) => string | undefined): string {
  return unique(payers.map((payer) => pick(payer) ?? '')).join('; ');
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  completed: 'Completed',
  expired: 'Expired',
  interrupted: 'Interrupted'
};

export const EARNINGS_CSV_COLUMNS = [
  'Started',
  'Ended',
  'Device',
  'Customer',
  'Phone',
  'Email',
  'Payment method',
  'UPI ID',
  'Razorpay payment ID',
  'Status',
  'Plans',
  'Minutes',
  'Amount',
  'Games',
  'Payment verified',
  'Checkout IDs'
] as const;

export function earningsReportToCsv(report: EarningsReport): string {
  const header = EARNINGS_CSV_COLUMNS.map((column) =>
    column === 'Amount' ? `Amount (${report.currency || 'INR'})` : column
  );
  const lines = [header.map(csvTextCell).join(',')];
  for (const row of report.rows) {
    const payers = row.payers ?? [];
    const cells = [
      csvTextCell(formatCsvDateTime(row.startedAt)),
      csvTextCell(formatCsvDateTime(row.endedAt)),
      csvTextCell(row.stationName),
      csvTextCell(joinPayers(payers, (payer) => payer.name)),
      csvTextCell(joinPayers(payers, (payer) => payer.phone)),
      csvTextCell(joinPayers(payers, (payer) => payer.email)),
      csvTextCell(joinPayers(payers, payerMethodText)),
      csvTextCell(joinPayers(payers, (payer) => payer.upiId)),
      csvTextCell(joinPayers(payers, (payer) => payer.razorpayPaymentId)),
      csvTextCell(STATUS_LABELS[row.status] ?? row.status),
      csvTextCell(unique(row.planNames ?? []).join('; ')),
      csvNumberCell(Number(row.durationMinutes) || 0),
      csvNumberCell(formatPaise(row.amountPaise)),
      csvTextCell(sessionGameTitles(row).join('; ')),
      csvTextCell(report.scope === 'device' || row.paymentVerified === undefined ? '' : row.paymentVerified ? 'Yes' : 'No'),
      csvTextCell(unique(row.checkoutIds ?? []).join('; '))
    ];
    lines.push(cells.join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
