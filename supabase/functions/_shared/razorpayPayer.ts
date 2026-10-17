// Razorpay payer details shared by pcPayment and stationFleet.
// Pure functions without Deno or Node APIs, so scripts/verify-fleet-backend.mjs
// can import this file with --experimental-strip-types.

type Source = Record<string, unknown>;

/** Nullable payer columns on public.pc_checkouts (migration 20261017120100). */
export type PayerColumns = {
  payer_name: string | null;
  payer_phone: string | null;
  payer_email: string | null;
  payment_method: string | null;
  payer_upi_id: string | null;
  payment_bank: string | null;
  payment_wallet: string | null;
  card_network: string | null;
  card_last4: string | null;
  payment_captured_at: string | null;
};

/** Wire shape returned to stations (`PayerWire` in the contract). */
export type PayerWire = {
  checkout_id: string;
  razorpay_payment_id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  method: string | null;
  upi_id: string | null;
  bank: string | null;
  wallet: string | null;
  card_network: string | null;
  card_last4: string | null;
  paid_at: string | null;
};

export const PAYER_COLUMN_NAMES: readonly string[] = [
  "payer_name", "payer_phone", "payer_email", "payment_method", "payer_upi_id",
  "payment_bank", "payment_wallet", "card_network", "card_last4", "payment_captured_at",
];

// Razorpay fills `email` with this placeholder when the customer gave none.
const PLACEHOLDER_EMAIL = "void@razorpay.com";
const MAX_FIELD_LENGTH = 200;

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_FIELD_LENGTH) : null;
}

function record(value: unknown): Source {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Source : {};
}

function isoFromUnixSeconds(value: unknown): string | null {
  const seconds = typeof value === "string" ? Number(value) : value;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/**
 * Maps a Razorpay payment (`GET /v1/payments/{id}?expand[]=card`) to the payer
 * columns. Razorpay never returns full card numbers; only network and last 4 are kept.
 */
export function payerColumnsFromPayment(payment: Source, fallbackName: unknown = null): PayerColumns {
  const card = record(payment.card);
  const upi = record(payment.upi);
  const email = clean(payment.email);
  const last4 = clean(card.last4);
  return {
    payer_name: clean(record(payment.notes).name) ?? clean(fallbackName),
    payer_phone: clean(payment.contact),
    payer_email: email && email.toLowerCase() !== PLACEHOLDER_EMAIL ? email : null,
    payment_method: clean(payment.method),
    payer_upi_id: clean(payment.vpa) ?? clean(upi.vpa),
    payment_bank: clean(payment.bank),
    payment_wallet: clean(payment.wallet),
    card_network: clean(card.network),
    card_last4: last4 && /^\d{4}$/.test(last4) ? last4 : null,
    payment_captured_at: isoFromUnixSeconds(payment.created_at),
  };
}

/** True once payer details were fetched from Razorpay or any detail column is set. */
export function payerDetailsKnown(row: Source): boolean {
  if (row.payer_details_fetched_at) return true;
  return PAYER_COLUMN_NAMES.some((column) => row[column] !== null && row[column] !== undefined && row[column] !== "");
}

/** Builds the wire payer from a pc_checkouts row (customer_name is the name fallback). */
export function payerWireFromCheckout(row: Source): PayerWire {
  return {
    checkout_id: String(row.id),
    razorpay_payment_id: clean(row.razorpay_payment_id),
    name: clean(row.payer_name) ?? clean(row.customer_name),
    phone: clean(row.payer_phone),
    email: clean(row.payer_email),
    method: clean(row.payment_method),
    upi_id: clean(row.payer_upi_id),
    bank: clean(row.payment_bank),
    wallet: clean(row.payment_wallet),
    card_network: clean(row.card_network),
    card_last4: clean(row.card_last4),
    paid_at: isoOrNull(row.payment_captured_at),
  };
}
