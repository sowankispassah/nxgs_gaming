import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { constantTimeEqual, hashPin, isValidPin, lockoutMinutes, randomHex, sha256Hex, verifyPin } from "./pin.ts";
import { payerColumnsFromPayment, payerDetailsKnown, payerWireFromCheckout } from "../_shared/razorpayPayer.ts";
import {
  arrayField,
  booleanField,
  FleetError,
  gamePayloads,
  idField,
  invalid,
  isoOrNull,
  optionalIsoField,
  optionalStationIdField,
  type Row,
  sessionPayloads,
  STATION_ID_PATTERN,
  stationEditFields,
  stationIdField,
  stationPayload,
  textArrayField,
  textField,
  timeOf,
  tokenField,
  TOKEN_PATTERN,
  UUID_PATTERN,
  uuidField,
} from "./validate.ts";

// NXGS Play Device Management (Accounts + All Devices). Stations authenticate
// with `station_id` + `station_token`; the main admin (owner) with a short-lived
// `owner_token` from `owner_login`. Only SHA-256 hashes of tokens are stored.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Main admin PIN while fleet_owner.pin_hash is null; the first successful login stores its hash.
const DEFAULT_OWNER_PIN = "1832";
const OWNER_ROW_ID = 1;
const OWNER_SESSION_MINUTES = 30;
// The 5th consecutive wrong PIN locks login; lockoutMinutes() doubles each lock up to 24 h.
const OWNER_MAX_FAILED_ATTEMPTS = 5;

const MAX_MODERATOR_STATIONS = 200;
const MAX_PAYER_CHECKOUTS = 200;
const EARNINGS_ROW_CAP = 5_000;
const LIST_ROW_CAP = 10_000;
// Matches the Supabase API max_rows default, so pages are never silently short.
const PAGE_SIZE = 1_000;
// Keeps `in.(...)` filters well under URL length limits.
const IN_FILTER_CHUNK = 100;
const PAYER_BACKFILL_LIMIT = 20;
const PAYER_BACKFILL_BATCH = 5;
// One deadline for every Razorpay call in a request, so station calls stay under their 8 s timeout.
const PAYER_BACKFILL_BUDGET_MS = 5_000;

// Column lists. token_hash / pin_hash only appear in the *_AUTH_COLUMNS lists used
// for credential checks, and in STATION_MODERATOR_COLUMNS, which `sync` returns
// so stations can check moderator PINs offline. Never select "*" here.
const STATION_AUTH_COLUMNS = "id, token_hash, removed_at, name, store_name, location, status, owner_edit_pending";
const OWNER_AUTH_COLUMNS = "id, pin_hash, failed_attempts, lockout_count, locked_until";
const OWNER_SESSION_AUTH_COLUMNS = "id, token_hash, expires_at";
const STATION_MODERATOR_COLUMNS = "id, name, pin_hash";
const STATION_COLUMNS = "id, name, store_name, location, status, app_version, registered_at, last_seen_at, removed_at, local_updated_at, owner_updated_at, owner_edit_pending";
const TOTALS_COLUMNS = "station_id, game_count, session_count, total_revenue_paise";
const GAME_COLUMNS = "game_id, title, enabled, launch_type, source, availability_status, local_updated_at, owner_enabled, owner_updated_at";
const SYNC_GAME_COLUMNS = "game_id, title, enabled, launch_type, source, availability_status, local_updated_at, owner_enabled, owner_updated_at, deleted_at";
const MODERATOR_COLUMNS = "id, name, active, created_at, updated_at";
const EARNINGS_COLUMNS = "station_id, session_id, status, started_at, expires_at, ended_at, duration_minutes, amount_paise, currency, plan_ids, plan_names, checkout_ids, games";
const CHECKOUT_PAYER_COLUMNS = "id, status, consumed_by_station_id, razorpay_payment_id, customer_name, payer_name, payer_phone, payer_email, payment_method, payer_upi_id, payment_bank, payment_wallet, card_network, card_last4, payment_captured_at, payer_details_fetched_at";

type AdminClient = ReturnType<typeof createClient>;
type QueryResult = { data: Row[] | null; error: unknown };
type OwnerHandler = (supabase: AdminClient, body: Row, session: Row) => Promise<Response>;

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function failure(error: unknown): Response {
  if (error instanceof FleetError) return json({ ...error.extra, error: true, message: error.message }, error.status);
  // Database and provider errors stay in the function logs.
  console.error("stationFleet request failed", error);
  return json({ error: true, message: "request_failed" }, 500);
}

function authorized(req: Request): boolean {
  const key = (req.headers.get("apikey") ?? "").trim();
  if (!key) return false;
  const allowed = new Set<string>();
  const legacy = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacy) allowed.add(legacy);
  try {
    const publishable = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}") as Record<string, string>;
    Object.values(publishable).forEach((value) => allowed.add(value));
  } catch {
    // A malformed platform variable must fail closed.
  }
  return allowed.has(key);
}

function admin(): AdminClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRole) throw new Error("missing_supabase_service_configuration");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function byName(left: Row, right: Row): number {
  return String(left.name).localeCompare(String(right.name));
}

async function inBatches<T, R>(items: T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += size) {
    results.push(...await Promise.all(items.slice(index, index + size).map(run)));
  }
  return results;
}

/** Reads up to `cap` rows in PAGE_SIZE pages; `fetchPage` must build a fresh, ordered query. */
async function pagedRows(fetchPage: (from: number, to: number) => PromiseLike<QueryResult>, cap: number): Promise<Row[]> {
  const rows: Row[] = [];
  while (rows.length < cap) {
    const from = rows.length;
    const to = Math.min(from + PAGE_SIZE, cap) - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < to - from + 1) break;
  }
  return rows;
}

/** Runs `query` for chunks of `values` (an `.in()` filter each) and concatenates the rows. */
async function selectIn(values: string[], chunkSize: number, query: (chunk: string[]) => PromiseLike<QueryResult>): Promise<Row[]> {
  const distinct = unique(values);
  const chunks: string[][] = [];
  for (let index = 0; index < distinct.length; index += chunkSize) chunks.push(distinct.slice(index, index + chunkSize));
  const pages = await inBatches(chunks, 5, async (chunk) => {
    const { data, error } = await query(chunk);
    if (error) throw error;
    return data ?? [];
  });
  return pages.flat();
}

// ---------------------------------------------------------------------------
// Response shapes (never include token_hash or pin_hash)
// ---------------------------------------------------------------------------

function cloudStation(row: Row, totals: Row | undefined): Row {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    store_name: String(row.store_name ?? ""),
    location: String(row.location ?? ""),
    status: String(row.status ?? "active"),
    app_version: String(row.app_version ?? ""),
    registered_at: isoOrNull(row.registered_at),
    last_seen_at: isoOrNull(row.last_seen_at),
    removed_at: isoOrNull(row.removed_at),
    local_updated_at: isoOrNull(row.local_updated_at),
    owner_updated_at: isoOrNull(row.owner_updated_at),
    owner_edit_pending: Boolean(row.owner_edit_pending),
    game_count: Number(totals?.game_count ?? 0),
    session_count: Number(totals?.session_count ?? 0),
    total_revenue_paise: Number(totals?.total_revenue_paise ?? 0),
  };
}

function stationGameRow(row: Row): Row {
  return {
    game_id: String(row.game_id),
    title: String(row.title ?? ""),
    enabled: Boolean(row.enabled),
    launch_type: String(row.launch_type ?? ""),
    source: String(row.source ?? ""),
    availability_status: String(row.availability_status ?? ""),
    local_updated_at: isoOrNull(row.local_updated_at),
    owner_enabled: typeof row.owner_enabled === "boolean" ? row.owner_enabled : null,
    owner_updated_at: isoOrNull(row.owner_updated_at),
  };
}

function moderatorRecord(row: Row, stationIds: string[]): Row {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    station_ids: stationIds,
    active: Boolean(row.active),
    created_at: isoOrNull(row.created_at),
    updated_at: isoOrNull(row.updated_at),
  };
}

/** A checkout counts for a station only if no other station consumed it (null = consumed before 0.25.0). */
function checkoutTrustedFor(checkout: Row | undefined, stationId: string): checkout is Row {
  return Boolean(checkout) && (checkout!.consumed_by_station_id == null || String(checkout!.consumed_by_station_id) === stationId);
}

function earningsRow(row: Row, stationNames: Map<string, string>, checkouts: Map<string, Row>): Row {
  const stationId = String(row.station_id);
  const checkoutIds = textList(row.checkout_ids);
  const lookup = (id: string) => {
    const checkout = UUID_PATTERN.test(id) ? checkouts.get(id.toLowerCase()) : undefined;
    return checkoutTrustedFor(checkout, stationId) ? checkout : undefined;
  };
  const payers = unique(checkoutIds).map(lookup)
    .filter((checkout): checkout is Row => Boolean(checkout && (checkout.razorpay_payment_id || payerDetailsKnown(checkout))))
    .map(payerWireFromCheckout);
  return {
    session_id: String(row.session_id),
    status: String(row.status),
    started_at: isoOrNull(row.started_at),
    expires_at: isoOrNull(row.expires_at),
    ended_at: isoOrNull(row.ended_at),
    duration_minutes: Number(row.duration_minutes ?? 0),
    amount_paise: Number(row.amount_paise ?? 0),
    currency: String(row.currency ?? "INR"),
    plan_ids: textList(row.plan_ids),
    plan_names: textList(row.plan_names),
    checkout_ids: checkoutIds,
    games: Array.isArray(row.games) ? row.games : [],
    station_id: stationId,
    station_name: stationNames.get(stationId) ?? stationId,
    // Every checkout id must be a consumed pc_checkouts row not consumed by another
    // station; malformed ids never verify.
    payment_verified: checkoutIds.length > 0 && checkoutIds.every((id) => lookup(id)?.status === "consumed"),
    payers,
  };
}

// ---------------------------------------------------------------------------
// Shared queries
// ---------------------------------------------------------------------------

/** Aggregates from the fleet_station_totals view; `null` reads every station. */
async function stationTotals(supabase: AdminClient, stationIds: string[] | null): Promise<Map<string, Row>> {
  const rows = stationIds
    ? await selectIn(stationIds, IN_FILTER_CHUNK, (part) => supabase.from("fleet_station_totals").select(TOTALS_COLUMNS).in("station_id", part))
    : await pagedRows((from, to) => supabase.from("fleet_station_totals").select(TOTALS_COLUMNS).order("station_id").range(from, to), LIST_ROW_CAP);
  return new Map(rows.map((row) => [String(row.station_id), row]));
}

/** Not-deleted moderators with their station assignments, by name; `null` reads all. */
async function moderatorRecords(supabase: AdminClient, moderatorIds: string[] | null): Promise<Row[]> {
  const moderators = moderatorIds
    ? await selectIn(moderatorIds, IN_FILTER_CHUNK, (part) => supabase.from("fleet_moderators").select(MODERATOR_COLUMNS).in("id", part).is("deleted_at", null))
    : await pagedRows((from, to) => supabase.from("fleet_moderators").select(MODERATOR_COLUMNS).is("deleted_at", null).order("name").order("id").range(from, to), LIST_ROW_CAP);
  // Small chunks: one moderator may have up to MAX_MODERATOR_STATIONS assignments.
  const links = await selectIn(moderators.map((row) => String(row.id)), 5, (part) => supabase.from("fleet_moderator_stations")
    .select("moderator_id, station_id").in("moderator_id", part).order("station_id"));
  const stationsByModerator = new Map<string, string[]>();
  for (const link of links) {
    const list = stationsByModerator.get(String(link.moderator_id)) ?? [];
    list.push(String(link.station_id));
    stationsByModerator.set(String(link.moderator_id), list);
  }
  return moderators.sort(byName).map((row) => moderatorRecord(row, stationsByModerator.get(String(row.id)) ?? []));
}

/** pc_checkouts rows (payer columns, never client_token_hash) for the uuid-shaped ids, without backfill. */
async function checkoutRows(supabase: AdminClient, checkoutIds: string[]): Promise<Row[]> {
  // pc_checkouts.id is a uuid; malformed ids would make the whole query fail.
  const ids = checkoutIds.filter((id) => UUID_PATTERN.test(id)).map((id) => id.toLowerCase());
  return await selectIn(ids, IN_FILTER_CHUNK, (part) => supabase.from("pc_checkouts").select(CHECKOUT_PAYER_COLUMNS).in("id", part));
}

function byCheckoutId(rows: Row[]): Map<string, Row> {
  return new Map(rows.map((row) => [String(row.id).toLowerCase(), row]));
}

function razorpayAuth(): string | null {
  const keyId = Deno.env.get("RAZORPAY_KEY_ID");
  const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
  return keyId && keySecret ? `Basic ${btoa(`${keyId}:${keySecret}`)}` : null;
}

async function razorpayGet(auth: string, url: string, deadline: number): Promise<Row> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("payer_backfill_budget_spent");
  const response = await fetch(url, { headers: { Authorization: auth }, signal: AbortSignal.timeout(remaining) });
  if (!response.ok) throw new Error(`razorpay_status_${response.status}`);
  return await response.json();
}

async function fetchRazorpayPayment(auth: string, paymentId: string, deadline: number): Promise<Row> {
  const url = `https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`;
  try {
    return await razorpayGet(auth, `${url}?expand[]=card`, deadline);
  } catch {
    // Card expansion only adds card details; the plain payment still has the payer.
    return await razorpayGet(auth, url, deadline);
  }
}

async function backfillPayer(supabase: AdminClient, auth: string, row: Row, deadline: number): Promise<void> {
  try {
    const paymentId = String(row.razorpay_payment_id);
    const payment = await fetchRazorpayPayment(auth, paymentId, deadline);
    if (String(payment.id) !== paymentId) return;
    const columns = { ...payerColumnsFromPayment(payment, row.customer_name), payer_details_fetched_at: nowIso() };
    const { error } = await supabase.from("pc_checkouts").update(columns)
      .eq("id", row.id).is("payer_details_fetched_at", null);
    if (error) throw error;
    Object.assign(row, columns);
  } catch (error) {
    // Best effort: nothing is stored, so the next request retries this checkout.
    console.error("stationFleet payer backfill failed", error instanceof Error ? error.message : error);
  }
}

/**
 * Fetches missing payer details from Razorpay for paid checkouts (updating the
 * rows in place): at most PAYER_BACKFILL_LIMIT per request, PAYER_BACKFILL_BATCH
 * in parallel, and every Razorpay call ends by the PAYER_BACKFILL_BUDGET_MS deadline.
 */
async function backfillPayers(supabase: AdminClient, checkouts: Row[]): Promise<void> {
  const pending = checkouts.filter((row) => row.razorpay_payment_id && !row.payer_details_fetched_at).slice(0, PAYER_BACKFILL_LIMIT);
  const auth = pending.length ? razorpayAuth() : null;
  if (!auth) return;
  const deadline = Date.now() + PAYER_BACKFILL_BUDGET_MS;
  for (let index = 0; index < pending.length && Date.now() < deadline; index += PAYER_BACKFILL_BATCH) {
    await Promise.all(pending.slice(index, index + PAYER_BACKFILL_BATCH).map((row) => backfillPayer(supabase, auth, row, deadline)));
  }
}

// ---------------------------------------------------------------------------
// Station actions
// ---------------------------------------------------------------------------

/** Credential and current name/store/location/status of a station (internal: includes token_hash). */
async function loadStationAuth(supabase: AdminClient, stationId: string): Promise<Row | null> {
  const { data, error } = await supabase.from("fleet_stations").select(STATION_AUTH_COLUMNS).eq("id", stationId).maybeSingle();
  if (error) throw error;
  return data;
}

async function requireStation(supabase: AdminClient, body: Row): Promise<Row> {
  const stationId = typeof body.station_id === "string" && STATION_ID_PATTERN.test(body.station_id) ? body.station_id : "";
  const token = typeof body.station_token === "string" ? body.station_token.trim() : "";
  if (!stationId || !TOKEN_PATTERN.test(token)) throw new FleetError("unauthorized_station");
  const data = await loadStationAuth(supabase, stationId);
  if (!data) throw new FleetError("unauthorized_station");
  // Removal nulls the token, so report it first: the station then pauses sync until it rejoins.
  if (data.removed_at) throw new FleetError("station_removed");
  if (!data.token_hash || !constantTimeEqual(await sha256Hex(token), String(data.token_hash))) {
    throw new FleetError("unauthorized_station");
  }
  return data;
}

const STATION_FIELDS = ["name", "store_name", "location", "status"];

function editableFields(payload: Row): Row {
  return { name: payload.name, store_name: payload.store_name, location: payload.location, status: payload.status };
}

/**
 * The station generates its token and stores it before calling, so a lost
 * response is simply retried with the same token. A different token (re-key)
 * or a removed station (rejoin) needs a valid owner_token.
 */
async function registerStation(supabase: AdminClient, body: Row): Promise<Response> {
  const stationId = stationIdField(body.station_id);
  const token = tokenField(body.station_token, "station_token");
  const payload = stationPayload(body.station);
  const tokenHash = await sha256Hex(token);
  const now = nowIso();
  let existing = await loadStationAuth(supabase, stationId);

  if (!existing) {
    const { data, error } = await supabase.from("fleet_stations").insert({
      id: stationId,
      token_hash: tokenHash,
      ...editableFields(payload),
      app_version: payload.app_version,
      local_updated_at: payload.local_updated_at,
      registered_at: now,
      last_seen_at: now,
    }).select(STATION_COLUMNS).single();
    // The token is echoed back: it is the caller's own, so nothing new is revealed.
    if (!error && data) return json({ station_token: token, station: cloudStation(data, undefined) });
    if (error?.code !== "23505") throw error ?? new Error("station_insert_failed");
    // A concurrent register created the row first; continue as for an existing station.
    existing = await loadStationAuth(supabase, stationId);
    if (!existing) throw new Error("station_insert_failed");
  }

  let station: Row;
  if (!existing.removed_at && existing.token_hash && constantTimeEqual(tokenHash, String(existing.token_hash))) {
    // Same station retrying: refresh it like a sync without local edits.
    station = await saveStationSync(supabase, existing, { ...payload, dirty: false }, now);
  } else {
    if (!body.owner_token) throw new FleetError(existing.removed_at ? "station_removed" : "station_already_registered");
    await requireOwner(supabase, body.owner_token);
    const { data, error } = await supabase.from("fleet_stations").update({
      token_hash: tokenHash,
      removed_at: null,
      app_version: payload.app_version,
      local_updated_at: payload.local_updated_at,
      last_seen_at: now,
    }).eq("id", stationId).select(STATION_COLUMNS).maybeSingle();
    if (error) throw error;
    if (!data) throw new FleetError("not_found");
    station = data;
  }
  const totals = await stationTotals(supabase, [stationId]);
  return json({ station_token: token, station: cloudStation(station, totals.get(stationId)) });
}

/**
 * Station fields without comparing clocks: a pending main admin edit wins until
 * the station reports the same values (then it is cleared); otherwise a station
 * with local edits (`dirty`) wins; otherwise the stored values stay. Always
 * refreshes app_version, local_updated_at (information only) and last_seen_at.
 */
async function saveStationSync(supabase: AdminClient, stored: Row, payload: Row, now: string): Promise<Row> {
  const base = { app_version: payload.app_version, local_updated_at: payload.local_updated_at, last_seen_at: now };
  const incoming = editableFields(payload);
  if (stored.owner_edit_pending) {
    if (STATION_FIELDS.every((field) => incoming[field] === stored[field])) {
      // The station shows the main admin's edit now. Guarded so a newer edit stays pending.
      let applied = supabase.from("fleet_stations").update({ ...base, owner_edit_pending: false })
        .eq("id", stored.id).eq("owner_edit_pending", true);
      for (const field of STATION_FIELDS) applied = applied.eq(field, stored[field]);
      const { data, error } = await applied.select(STATION_COLUMNS).maybeSingle();
      if (error) throw error;
      if (data) return data;
    }
  } else if (payload.dirty) {
    // Local edits on the station; a main admin edit made meanwhile still wins.
    const { data, error } = await supabase.from("fleet_stations").update({ ...base, ...incoming })
      .eq("id", stored.id).eq("owner_edit_pending", false).select(STATION_COLUMNS).maybeSingle();
    if (error) throw error;
    if (data) return data;
  }
  const { data, error } = await supabase.from("fleet_stations").update(base).eq("id", stored.id).select(STATION_COLUMNS).maybeSingle();
  if (error) throw error;
  if (!data) throw new FleetError("unauthorized_station");
  return data;
}

/**
 * Upserts the reported games and soft-deletes missing ones. A main admin
 * override is pending while owner_enabled is set; it is cleared once the
 * station reports the same `enabled`, and the rest come back as game_overrides.
 */
async function saveGames(supabase: AdminClient, stationId: string, games: Row[], now: string): Promise<Row[]> {
  const existing = await pagedRows((from, to) => supabase.from("fleet_station_games").select(SYNC_GAME_COLUMNS)
    .eq("station_id", stationId).order("game_id").range(from, to), LIST_ROW_CAP);
  const current = new Map(existing.map((row) => [String(row.game_id), row]));
  const reported = new Set(games.map((game) => String(game.game_id)));
  const rows: Row[] = [];
  const overrides: Row[] = [];
  const applied: Row[] = [];

  for (const game of games) {
    const stored = current.get(game.game_id);
    const ownerEnabled = typeof stored?.owner_enabled === "boolean" ? stored.owner_enabled : null;
    if (ownerEnabled === game.enabled) {
      applied.push(game);
    } else if (ownerEnabled !== null) {
      overrides.push({ game_id: game.game_id, enabled: ownerEnabled, owner_updated_at: isoOrNull(stored!.owner_updated_at) });
    }
    // While an override is pending, `enabled` shows the main admin's choice.
    rows.push({ station_id: stationId, ...game, enabled: ownerEnabled ?? game.enabled, deleted_at: null });
  }
  for (const row of existing) {
    if (row.deleted_at || reported.has(String(row.game_id))) continue;
    rows.push({
      station_id: stationId,
      game_id: row.game_id,
      title: row.title,
      enabled: row.enabled,
      launch_type: row.launch_type,
      source: row.source,
      availability_status: row.availability_status,
      local_updated_at: row.local_updated_at,
      deleted_at: now,
    });
  }
  // Owner columns are not part of the upsert, so a concurrent set_game_enabled is never overwritten.
  if (rows.length) {
    const { error } = await supabase.from("fleet_station_games").upsert(rows, { onConflict: "station_id,game_id" });
    if (error) throw error;
  }
  // The station shows the override now; clear it unless the main admin changed it again meanwhile.
  await inBatches(applied, 10, async (game) => {
    const { error } = await supabase.from("fleet_station_games").update({ owner_enabled: null, owner_updated_at: null })
      .eq("station_id", stationId).eq("game_id", game.game_id).eq("owner_enabled", game.enabled);
    if (error) throw error;
  });
  return overrides;
}

async function saveSessions(supabase: AdminClient, stationId: string, sessions: Row[], now: string): Promise<void> {
  if (!sessions.length) return;
  const rows = sessions.map((session) => ({ station_id: stationId, ...session, synced_at: now }));
  const { error } = await supabase.from("fleet_sessions").upsert(rows, { onConflict: "station_id,session_id" });
  if (error) throw error;
}

/** Active, not-deleted moderators assigned to the station, including pin_hash for offline checks. */
async function stationModerators(supabase: AdminClient, stationId: string): Promise<Row[]> {
  const { data: links, error } = await supabase.from("fleet_moderator_stations").select("moderator_id").eq("station_id", stationId);
  if (error) throw error;
  const ids = (links ?? []).map((link: Row) => String(link.moderator_id));
  const rows = await selectIn(ids, IN_FILTER_CHUNK, (part) => supabase.from("fleet_moderators").select(STATION_MODERATOR_COLUMNS)
    .in("id", part).eq("active", true).is("deleted_at", null));
  return rows.sort(byName).map((row) => ({ id: String(row.id), name: String(row.name), pin_hash: String(row.pin_hash) }));
}

async function syncStation(supabase: AdminClient, body: Row): Promise<Response> {
  const auth = await requireStation(supabase, body);
  const stationId = String(auth.id);
  // Validate everything before writing anything.
  const payload = stationPayload(body.station);
  const games = gamePayloads(body.games);
  const sessions = sessionPayloads(body.sessions);
  const now = nowIso();
  const station = await saveStationSync(supabase, auth, payload, now);
  const gameOverrides = await saveGames(supabase, stationId, games, now);
  await saveSessions(supabase, stationId, sessions, now);
  const [moderators, totals] = await Promise.all([
    stationModerators(supabase, stationId),
    stationTotals(supabase, [stationId]),
  ]);
  return json({
    station: cloudStation(station, totals.get(stationId)),
    game_overrides: gameOverrides,
    moderators,
    accepted_session_ids: sessions.map((session) => String(session.session_id)),
  });
}

/**
 * Payer details for checkouts referenced by this station's own sessions and not
 * consumed by another station; anything else is ignored silently.
 */
async function sessionPayers(supabase: AdminClient, body: Row): Promise<Response> {
  const auth = await requireStation(supabase, body);
  const stationId = String(auth.id);
  const requested = unique(textArrayField(body.checkout_ids, "checkout_ids", MAX_PAYER_CHECKOUTS).filter((id) => UUID_PATTERN.test(id)));
  const sessions = await selectIn(requested, IN_FILTER_CHUNK, (part) => supabase.from("fleet_sessions").select("checkout_ids")
    .eq("station_id", stationId).overlaps("checkout_ids", part));
  const owned = new Set(sessions.flatMap((row) => textList(row.checkout_ids)));
  const allowed = requested.filter((id) => owned.has(id));
  // Filter before the backfill so a station never triggers Razorpay lookups for another station's checkout.
  const checkouts = (await checkoutRows(supabase, allowed)).filter((row) => checkoutTrustedFor(row, stationId));
  await backfillPayers(supabase, checkouts);
  // Only checkouts with known details, so the station asks again for the rest later.
  const payers = checkouts.filter((row) => payerDetailsKnown(row)).map(payerWireFromCheckout);
  return json({ payers });
}

// ---------------------------------------------------------------------------
// Owner (main admin) authentication
// ---------------------------------------------------------------------------

async function requireOwner(supabase: AdminClient, ownerToken: unknown): Promise<Row> {
  const token = typeof ownerToken === "string" ? ownerToken.trim() : "";
  if (!TOKEN_PATTERN.test(token)) throw new FleetError("owner_pin_required");
  const tokenHash = await sha256Hex(token);
  const { data, error } = await supabase.from("fleet_owner_sessions").select(OWNER_SESSION_AUTH_COLUMNS).eq("token_hash", tokenHash).maybeSingle();
  if (error) throw error;
  if (!data || !constantTimeEqual(tokenHash, String(data.token_hash))) throw new FleetError("owner_pin_required");
  const sessionId = String(data.id);
  const now = nowIso();
  if ((timeOf(data.expires_at) ?? 0) <= Date.now()) {
    await supabase.from("fleet_owner_sessions").delete().eq("id", sessionId);
    throw new FleetError("owner_pin_required");
  }
  // Sliding expiry: every authorised owner call extends the session.
  const expiresAt = minutesFromNow(OWNER_SESSION_MINUTES);
  const { data: extended, error: extendError } = await supabase.from("fleet_owner_sessions")
    .update({ expires_at: expiresAt, last_used_at: now })
    .eq("id", sessionId).gt("expires_at", now).select("id").maybeSingle();
  if (extendError) throw extendError;
  if (!extended) throw new FleetError("owner_pin_required");
  return { id: sessionId, expires_at: expiresAt };
}

async function loadOwner(supabase: AdminClient): Promise<Row> {
  const { data, error } = await supabase.from("fleet_owner").select(OWNER_AUTH_COLUMNS).eq("id", OWNER_ROW_ID).maybeSingle();
  if (error) throw error;
  if (data) return data;
  // The migration seeds this row; recreate it (default PIN) if it was deleted.
  const { error: seedError } = await supabase.from("fleet_owner").upsert({ id: OWNER_ROW_ID }, { onConflict: "id", ignoreDuplicates: true });
  if (seedError) throw seedError;
  return { id: OWNER_ROW_ID, pin_hash: null, failed_attempts: 0, lockout_count: 0, locked_until: null };
}

/**
 * Counts an attempt before the PIN is checked, so parallel guesses cannot get
 * past the lockout. The fifth consecutive failure locks login (10 min, doubling
 * with each further lockout up to 24 h) and restarts the attempt count; a
 * correct PIN clears everything in checkOwnerPin.
 */
async function reserveOwnerAttempt(supabase: AdminClient): Promise<Row> {
  for (let retry = 0; retry < 5; retry += 1) {
    const owner = await loadOwner(supabase);
    const now = nowIso();
    const lockedUntil = timeOf(owner.locked_until);
    if (lockedUntil !== null && lockedUntil > Date.now()) {
      throw new FleetError("owner_locked", { locked_until: isoOrNull(owner.locked_until) });
    }
    const failures = Number(owner.failed_attempts ?? 0);
    const lockouts = Number(owner.lockout_count ?? 0);
    const locking = failures + 1 >= OWNER_MAX_FAILED_ATTEMPTS;
    const lock = locking ? minutesFromNow(lockoutMinutes(lockouts + 1)) : null;
    const { data, error } = await supabase.from("fleet_owner")
      .update({ failed_attempts: locking ? 0 : failures + 1, lockout_count: locking ? lockouts + 1 : lockouts, locked_until: lock })
      .eq("id", OWNER_ROW_ID).eq("failed_attempts", failures).eq("lockout_count", lockouts)
      .or(`locked_until.is.null,locked_until.lte."${now}"`)
      .select("id").maybeSingle();
    if (error) throw error;
    if (data) return { ...owner, locked_until: lock };
  }
  throw new Error("owner_attempt_contended");
}

/** Verifies the main admin PIN with lockout; on success optionally stores `nextPinHash`. */
async function checkOwnerPin(supabase: AdminClient, pin: unknown, nextPinHash: string | null = null): Promise<void> {
  const owner = await reserveOwnerAttempt(supabase);
  const candidate = isValidPin(pin) ? pin : "";
  const matches = candidate !== "" && (owner.pin_hash
    ? await verifyPin(candidate, String(owner.pin_hash))
    : constantTimeEqual(candidate, DEFAULT_OWNER_PIN));
  if (!matches) {
    if (owner.locked_until) throw new FleetError("owner_locked", { locked_until: owner.locked_until });
    throw new FleetError("invalid_owner_pin");
  }
  // The first successful login with the default PIN stores a real hash of it.
  const pinHash = nextPinHash ?? (owner.pin_hash ? null : await hashPin(candidate));
  const { error } = await supabase.from("fleet_owner")
    .update({ failed_attempts: 0, lockout_count: 0, locked_until: null, ...(pinHash ? { pin_hash: pinHash } : {}) })
    .eq("id", OWNER_ROW_ID);
  if (error) throw error;
}

async function ownerLogin(supabase: AdminClient, body: Row): Promise<Response> {
  await checkOwnerPin(supabase, body.pin);
  const token = randomHex(32);
  const now = nowIso();
  const expiresAt = minutesFromNow(OWNER_SESSION_MINUTES);
  const { error: cleanupError } = await supabase.from("fleet_owner_sessions").delete().lt("expires_at", now);
  if (cleanupError) console.error("stationFleet owner session cleanup failed", cleanupError);
  const { error } = await supabase.from("fleet_owner_sessions").insert({
    token_hash: await sha256Hex(token),
    expires_at: expiresAt,
    last_used_at: now,
  });
  if (error) throw error;
  return json({ owner_token: token, expires_at: expiresAt });
}

async function ownerLogout(supabase: AdminClient, body: Row): Promise<Response> {
  try {
    const token = typeof body.owner_token === "string" ? body.owner_token.trim() : "";
    if (TOKEN_PATTERN.test(token)) {
      const { error } = await supabase.from("fleet_owner_sessions").delete().eq("token_hash", await sha256Hex(token));
      if (error) console.error("stationFleet owner logout failed", error);
    }
  } catch (error) {
    console.error("stationFleet owner logout failed", error);
  }
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// Owner actions (requireOwner has already run)
// ---------------------------------------------------------------------------

async function changeOwnerPin(supabase: AdminClient, body: Row, session: Row): Promise<Response> {
  if (!isValidPin(body.next_pin)) throw invalid("next_pin");
  await checkOwnerPin(supabase, body.current_pin, await hashPin(body.next_pin));
  // Every other main admin session must sign in again with the new PIN.
  const { error } = await supabase.from("fleet_owner_sessions").delete().neq("id", session.id);
  if (error) throw error;
  return json({ changed: true });
}

async function listStations(supabase: AdminClient): Promise<Response> {
  const [stations, totals] = await Promise.all([
    pagedRows((from, to) => supabase.from("fleet_stations").select(STATION_COLUMNS)
      .order("last_seen_at", { ascending: false, nullsFirst: false }).order("id").range(from, to), LIST_ROW_CAP),
    stationTotals(supabase, null),
  ]);
  return json({ stations: stations.map((row) => cloudStation(row, totals.get(String(row.id)))) });
}

async function getStation(supabase: AdminClient, body: Row): Promise<Response> {
  const stationId = stationIdField(body.station_id);
  const { data: station, error } = await supabase.from("fleet_stations").select(STATION_COLUMNS).eq("id", stationId).maybeSingle();
  if (error) throw error;
  if (!station) throw new FleetError("not_found");
  const [games, totals, links] = await Promise.all([
    pagedRows((from, to) => supabase.from("fleet_station_games").select(GAME_COLUMNS)
      .eq("station_id", stationId).is("deleted_at", null).order("title").order("game_id").range(from, to), LIST_ROW_CAP),
    stationTotals(supabase, [stationId]),
    pagedRows((from, to) => supabase.from("fleet_moderator_stations").select("moderator_id")
      .eq("station_id", stationId).order("moderator_id").range(from, to), LIST_ROW_CAP),
  ]);
  const moderators = await moderatorRecords(supabase, links.map((link) => String(link.moderator_id)));
  return json({ station: cloudStation(station, totals.get(stationId)), games: games.map(stationGameRow), moderators });
}

async function updateStation(supabase: AdminClient, body: Row): Promise<Response> {
  const stationId = stationIdField(body.station_id);
  const fields = stationEditFields(body);
  // Pending until the station reports these values; owner_updated_at is for display only.
  const { data, error } = await supabase.from("fleet_stations").update({ ...fields, owner_edit_pending: true, owner_updated_at: nowIso() })
    .eq("id", stationId).select(STATION_COLUMNS).maybeSingle();
  if (error) throw error;
  if (!data) throw new FleetError("not_found");
  const totals = await stationTotals(supabase, [stationId]);
  return json({ station: cloudStation(data, totals.get(stationId)) });
}

async function removeStation(supabase: AdminClient, body: Row): Promise<Response> {
  const stationId = stationIdField(body.station_id);
  const { data: station, error } = await supabase.from("fleet_stations").select("id, removed_at").eq("id", stationId).maybeSingle();
  if (error) throw error;
  if (!station) throw new FleetError("not_found");
  // Sessions and games stay for history; only the credential and moderator access go.
  const { error: removeError } = await supabase.from("fleet_stations")
    .update({ removed_at: station.removed_at ?? nowIso(), token_hash: null }).eq("id", stationId);
  if (removeError) throw removeError;
  const { error: unlinkError } = await supabase.from("fleet_moderator_stations").delete().eq("station_id", stationId);
  if (unlinkError) throw unlinkError;
  return json({ removed: true });
}

async function setGameEnabled(supabase: AdminClient, body: Row): Promise<Response> {
  const stationId = stationIdField(body.station_id);
  const gameId = idField(body.game_id, "game_id");
  const enabled = booleanField(body.enabled, "enabled");
  const { data, error } = await supabase.from("fleet_station_games")
    .update({ enabled, owner_enabled: enabled, owner_updated_at: nowIso() })
    .eq("station_id", stationId).eq("game_id", gameId).is("deleted_at", null)
    .select(GAME_COLUMNS).maybeSingle();
  if (error) throw error;
  if (!data) throw new FleetError("not_found");
  return json({ game: stationGameRow(data) });
}

async function earnings(supabase: AdminClient, body: Row): Promise<Response> {
  const from = optionalIsoField(body.from, "from");
  const to = optionalIsoField(body.to, "to");
  const stationId = optionalStationIdField(body.station_id);
  // One row past the cap tells whether the report was cut short.
  const found = await pagedRows((start, end) => {
    let query = supabase.from("fleet_sessions").select(EARNINGS_COLUMNS);
    if (from) query = query.gte("started_at", from);
    if (to) query = query.lt("started_at", to);
    if (stationId) query = query.eq("station_id", stationId);
    return query.order("started_at", { ascending: false }).order("station_id").order("session_id").range(start, end);
  }, EARNINGS_ROW_CAP + 1);
  const truncated = found.length > EARNINGS_ROW_CAP;
  const sessions = found.slice(0, EARNINGS_ROW_CAP);
  const [stations, checkouts] = await Promise.all([
    selectIn(sessions.map((row) => String(row.station_id)), IN_FILTER_CHUNK,
      (part) => supabase.from("fleet_stations").select("id, name").in("id", part)),
    checkoutRows(supabase, sessions.flatMap((row) => textList(row.checkout_ids))),
  ]);
  await backfillPayers(supabase, checkouts);
  const stationNames = new Map(stations.map((row) => [String(row.id), String(row.name)]));
  const checkoutsById = byCheckoutId(checkouts);
  return json({ rows: sessions.map((row) => earningsRow(row, stationNames, checkoutsById)), truncated });
}

async function listModerators(supabase: AdminClient): Promise<Response> {
  return json({ moderators: await moderatorRecords(supabase, null) });
}

async function replaceAssignments(supabase: AdminClient, moderatorId: string, stationIds: string[]): Promise<void> {
  let removal = supabase.from("fleet_moderator_stations").delete().eq("moderator_id", moderatorId);
  // Station IDs match STATION_ID_PATTERN, so they are safe inside a PostgREST list.
  if (stationIds.length) removal = removal.not("station_id", "in", `(${stationIds.join(",")})`);
  const { error } = await removal;
  if (error) throw error;
  if (!stationIds.length) return;
  const { error: insertError } = await supabase.from("fleet_moderator_stations").upsert(
    stationIds.map((stationId) => ({ moderator_id: moderatorId, station_id: stationId })),
    { onConflict: "moderator_id,station_id", ignoreDuplicates: true },
  );
  if (insertError) throw insertError;
}

async function saveModerator(supabase: AdminClient, body: Row): Promise<Response> {
  const id = body.id === undefined || body.id === null || body.id === "" ? null : uuidField(body.id, "id");
  const name = textField(body.name, "name", 60, 1);
  const active = booleanField(body.active, "active");
  const stationIds = unique(arrayField(body.station_ids, "station_ids", MAX_MODERATOR_STATIONS)
    .map((value) => stationIdField(value, "station_ids")));
  const pin = body.pin === undefined || body.pin === null || body.pin === "" ? null : body.pin;
  if ((id === null && pin === null) || (pin !== null && !isValidPin(pin))) throw invalid("pin");

  const stations = await selectIn(stationIds, IN_FILTER_CHUNK, (part) => supabase.from("fleet_stations").select("id, removed_at").in("id", part));
  const assignable = new Set(stations.filter((row) => !row.removed_at).map((row) => String(row.id)));
  if (stationIds.some((stationId) => !assignable.has(stationId))) throw invalid("station_ids");

  const pinHash = pin === null ? null : await hashPin(String(pin));
  let saved: Row | null;
  if (id) {
    const { data, error } = await supabase.from("fleet_moderators")
      .update({ name, active, ...(pinHash ? { pin_hash: pinHash } : {}) })
      .eq("id", id).is("deleted_at", null).select(MODERATOR_COLUMNS).maybeSingle();
    if (error) throw error;
    saved = data;
  } else {
    const { data, error } = await supabase.from("fleet_moderators")
      .insert({ name, active, pin_hash: pinHash }).select(MODERATOR_COLUMNS).single();
    if (error) throw error;
    saved = data;
  }
  if (!saved) throw new FleetError("not_found");
  await replaceAssignments(supabase, String(saved.id), stationIds);
  return json({ moderator: moderatorRecord(saved, stationIds) });
}

async function deleteModerator(supabase: AdminClient, body: Row): Promise<Response> {
  const id = uuidField(body.id, "id");
  const { data, error } = await supabase.from("fleet_moderators")
    .update({ deleted_at: nowIso(), active: false })
    .eq("id", id).is("deleted_at", null).select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new FleetError("not_found");
  return json({ deleted: true });
}

const OWNER_ACTIONS: Record<string, OwnerHandler> = {
  owner_change_pin: changeOwnerPin,
  list_stations: listStations,
  get_station: getStation,
  update_station: updateStation,
  remove_station: removeStation,
  set_game_enabled: setGameEnabled,
  earnings,
  list_moderators: listModerators,
  save_moderator: saveModerator,
  delete_moderator: deleteModerator,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: true, message: "method_not_allowed" }, 405);
  if (!authorized(req)) return json({ error: true, message: "unauthorized_client" }, 401);
  try {
    const parsed = await req.json().catch(() => null);
    const body: Row = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    const action = typeof body.action === "string" ? body.action.trim() : "";
    const supabase = admin();
    if (action === "register") return await registerStation(supabase, body);
    if (action === "sync") return await syncStation(supabase, body);
    if (action === "session_payers") return await sessionPayers(supabase, body);
    if (action === "owner_login") return await ownerLogin(supabase, body);
    if (action === "owner_logout") return await ownerLogout(supabase, body);
    const handler = Object.hasOwn(OWNER_ACTIONS, action) ? OWNER_ACTIONS[action] : undefined;
    if (!handler) throw invalid("action");
    const session = await requireOwner(supabase, body.owner_token);
    return await handler(supabase, body, session);
  } catch (error) {
    return failure(error);
  }
});
