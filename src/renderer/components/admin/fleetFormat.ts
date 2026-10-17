import type {
  EarningsQuery,
  EarningsScope,
  EarningsSessionRow,
  PaymentPayerDetails,
  SessionGamePlay
} from '../../../shared/types';

/** Shared label helpers for the Accounts and Device Management pages. */

export const PIN_PATTERN = /^\d{4,12}$/;

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  upi: 'UPI',
  card: 'Card',
  netbanking: 'Net banking',
  wallet: 'Wallet',
  emi: 'EMI',
  cardless_emi: 'Cardless EMI',
  paylater: 'Pay later',
  bank_transfer: 'Bank transfer',
  emandate: 'eMandate',
  nach: 'NACH'
};

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Razorpay payment method as staff read it: UPI, Card, Net banking, Wallet... */
export function paymentMethodLabel(method?: string): string {
  if (!method) return '';
  return PAYMENT_METHOD_LABELS[method.toLowerCase()] ?? titleCase(method);
}

/** Indian mobile numbers as "+91 98765 43210"; anything else unchanged. */
export function phoneLabel(phone?: string): string {
  if (!phone) return '';
  const match = /^(?:\+?91)?(\d{5})(\d{5})$/.exec(phone.replace(/[\s-]/g, ''));
  return match ? `+91 ${match[1]} ${match[2]}` : phone;
}

/** What the method itself says: "Visa •••• 4242", "rahul@okaxis", "HDFC", "Paytm". */
export function paymentMethodDetail(payer: PaymentPayerDetails): string {
  if (payer.cardNetwork || payer.cardLast4) {
    return [payer.cardNetwork, payer.cardLast4 ? `•••• ${payer.cardLast4}` : ''].filter(Boolean).join(' ');
  }
  if (payer.upiId) return payer.upiId;
  if (payer.bank) return payer.bank;
  if (payer.wallet) return titleCase(payer.wallet);
  return '';
}

/** True when Razorpay told us anything about this payer beyond the checkout id. */
export function payerHasDetails(payer: PaymentPayerDetails): boolean {
  return Boolean(
    payer.razorpayPaymentId || payer.name || payer.phone || payer.email || payer.method || payer.upiId ||
    payer.bank || payer.wallet || payer.cardNetwork || payer.cardLast4
  );
}

export function formatPaise(paise: number, currency = 'INR'): string {
  const amount = paise / 100;
  const whole = Number.isInteger(amount);
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    return `₹${amount.toLocaleString('en-IN')}`;
  }
}

export function durationLabel(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

export function dateLabel(value?: string): string {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function timeLabel(value?: string): string {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

export function dateTimeLabel(value?: string): string {
  if (!value) return '';
  return `${dateLabel(value)}, ${timeLabel(value)}`;
}

/** "Just now", "5 min ago", "3 hr ago", "2 days ago", then the date. */
export function relativeTime(value?: string, now = Date.now()): string {
  if (!value) return 'Never';
  const elapsed = now - new Date(value).getTime();
  if (!Number.isFinite(elapsed)) return 'Unknown';
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return dateLabel(value);
}

/**
 * When a game entry stops counting: its own end; for an open entry the session
 * end, else the paid time's end (never later than now), else now. Matches
 * `buildEarningsReport` so per-session and report totals agree.
 */
export function entryEnd(entry: SessionGamePlay, row: EarningsSessionRow, now = Date.now()): number {
  if (entry.endedAt) return new Date(entry.endedAt).getTime();
  if (row.endedAt) return new Date(row.endedAt).getTime();
  const expires = row.expiresAt ? new Date(row.expiresAt).getTime() : Number.NaN;
  return Number.isFinite(expires) ? Math.min(now, expires) : now;
}

/** A session still marked active although its paid time has ended (the app closed before it finished). */
export function isUnfinishedSession(row: EarningsSessionRow, now = Date.now()): boolean {
  if (row.status !== 'active' || !row.expiresAt) return false;
  const expires = new Date(row.expiresAt).getTime();
  return Number.isFinite(expires) && expires <= now;
}

export function entryMinutes(entry: SessionGamePlay, row: EarningsSessionRow, now = Date.now()): number {
  const minutes = (entryEnd(entry, row, now) - new Date(entry.startedAt).getTime()) / 60_000;
  return Number.isFinite(minutes) ? Math.max(0, minutes) : 0;
}

export interface SessionGameSummary {
  gameId: string;
  title: string;
  minutes: number;
  plays: number;
}

/** Per-game play time inside one session, in the order games were first launched. */
export function summarizeSessionGames(row: EarningsSessionRow, now = Date.now()): SessionGameSummary[] {
  const byGame = new Map<string, SessionGameSummary>();
  for (const entry of row.games) {
    const key = entry.gameId || entry.title;
    const current = byGame.get(key) ?? { gameId: key, title: entry.title || 'Unknown game', minutes: 0, plays: 0 };
    current.minutes += entryMinutes(entry, row, now);
    current.plays += 1;
    byGame.set(key, current);
  }
  return [...byGame.values()];
}

/** Local calendar date as `YYYY-MM-DD` for date inputs. */
export function toDateInputValue(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Start of the given `YYYY-MM-DD` day in local time, or null when the value is not a date. */
export function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

// ---------------------------------------------------------------------------
// Accounts period filter
// ---------------------------------------------------------------------------

export type RangePreset = 'today' | 'week' | 'month' | 'all' | 'custom';

/** What the Accounts page shows. Kept by AdminScreen so "View earnings" can open it filtered. */
export interface AccountsView {
  scope: EarningsScope;
  /** Scope `all` only; empty means every device. */
  stationId: string;
  range: RangePreset;
  /** `YYYY-MM-DD`, used by the Custom range. */
  customFrom: string;
  customTo: string;
}

export const DEFAULT_ACCOUNTS_VIEW: AccountsView = {
  scope: 'device',
  stationId: '',
  range: 'month',
  customFrom: '',
  customTo: ''
};

/** Converts the chosen period to the ISO `from` (inclusive) / `to` (exclusive) the main process filters by. */
export function buildEarningsQuery(view: AccountsView, now = new Date()): { query: EarningsQuery; invalid?: string } {
  const query: EarningsQuery = { scope: view.scope };
  if (view.scope === 'all' && view.stationId) query.stationId = view.stationId;
  const today = startOfDay(now);
  if (view.range === 'today') {
    query.from = today.toISOString();
    query.to = addDays(today, 1).toISOString();
  } else if (view.range === 'week') {
    query.from = addDays(today, -6).toISOString();
    query.to = addDays(today, 1).toISOString();
  } else if (view.range === 'month') {
    query.from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    query.to = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  } else if (view.range === 'custom') {
    const from = parseDateInput(view.customFrom);
    const to = parseDateInput(view.customTo);
    if (from && to && from > to) {
      return { query, invalid: 'The start date is after the end date.' };
    }
    if (from) query.from = from.toISOString();
    if (to) query.to = addDays(to, 1).toISOString();
  }
  return { query };
}
