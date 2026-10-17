// Input validation for the stationFleet edge function. No Deno APIs, so
// scripts/verify-fleet-backend.mjs can import it with --experimental-strip-types.

export type Row = Record<string, any>;

export const MAX_GAMES = 500;
export const MAX_SESSIONS = 200;
export const MAX_SESSION_GAMES = 200;
export const MAX_LIST_ENTRIES = 50;
export const MAX_DURATION_MINUTES = 100_000;
export const MAX_AMOUNT_PAISE = 100_000_000;

export const STATION_ID_PATTERN = /^[A-Za-z0-9_-]{3,80}$/;
export const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const STATION_STATUSES = ["active", "inactive"];
const SESSION_STATUSES = ["active", "completed", "expired", "interrupted"];

export const ERROR_STATUS: Record<string, number> = {
  unauthorized_client: 401,
  unauthorized_station: 401,
  station_removed: 403,
  station_already_registered: 409,
  owner_pin_required: 401,
  invalid_owner_pin: 401,
  owner_locked: 423,
  not_found: 404,
  invalid_input: 400,
  request_failed: 500,
};

/** An expected failure whose code (and extra fields) are safe to return to the caller. */
export class FleetError extends Error {
  status: number;
  extra: Row;
  constructor(code: string, extra: Row = {}) {
    super(code);
    this.status = ERROR_STATUS[code] ?? 500;
    this.extra = extra;
  }
}

export function invalid(detail: string): FleetError {
  return new FleetError("invalid_input", { detail });
}

export function timeOf(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function isoOrNull(value: unknown): string | null {
  const time = timeOf(value);
  return time === null ? null : new Date(time).toISOString();
}

// ---------------------------------------------------------------------------
// Input validation (every failure is `invalid_input` with a `detail` field name)
// ---------------------------------------------------------------------------

export function objectField(value: unknown, field: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(field);
  return value as Row;
}

export function textField(value: unknown, field: string, max: number, min = 0): string {
  if ((value === undefined || value === null) && min === 0) return "";
  if (typeof value !== "string") throw invalid(field);
  const trimmed = value.trim();
  // Postgres text and jsonb cannot store NUL characters.
  if (trimmed.length < min || trimmed.length > max || trimmed.includes("\u0000")) throw invalid(field);
  return trimmed;
}

export function idField(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 200 || CONTROL_CHARACTERS.test(value)) throw invalid(field);
  return value;
}

export function stationIdField(value: unknown, field = "station_id"): string {
  if (typeof value !== "string" || !STATION_ID_PATTERN.test(value)) throw invalid(field);
  return value;
}

export function optionalStationIdField(value: unknown): string | null {
  return value === undefined || value === null || value === "" ? null : stationIdField(value);
}

export function uuidField(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw invalid(field);
  return value.toLowerCase();
}

export function isoField(value: unknown, field: string): string {
  if (typeof value !== "string" || !ISO_PATTERN.test(value)) throw invalid(field);
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw invalid(field);
  return new Date(time).toISOString();
}

export function optionalIsoField(value: unknown, field: string): string | null {
  return value === undefined || value === null || value === "" ? null : isoField(value, field);
}

export function integerField(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw invalid(field);
  return value;
}

export function booleanField(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw invalid(field);
  return value;
}

export function enumField(value: unknown, field: string, allowed: string[]): string {
  if (typeof value !== "string" || !allowed.includes(value)) throw invalid(field);
  return value;
}

export function arrayField(value: unknown, field: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw invalid(field);
  return value;
}

/** Optional string list (missing means empty), each entry at most 200 characters. */
export function textArrayField(value: unknown, field: string, max: number): string[] {
  return arrayField(value ?? [], field, max).map((item, index) => {
    if (typeof item !== "string" || item.length > 200 || item.includes("\u0000")) throw invalid(`${field}[${index}]`);
    return item;
  });
}

function currencyField(value: unknown, field: string): string {
  const currency = textField(value, field, 3, 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw invalid(field);
  return currency;
}

/** name / store_name / location / status, validated like the station's own device form. */
export function stationEditFields(source: Row, prefix = ""): Row {
  return {
    name: textField(source.name, `${prefix}name`, 80, 1),
    store_name: textField(source.store_name, `${prefix}store_name`, 120),
    location: textField(source.location, `${prefix}location`, 160),
    status: enumField(source.status, `${prefix}status`, STATION_STATUSES),
  };
}

/** A station token the station generated itself: 32 random bytes as lowercase hex. */
export function tokenField(value: unknown, field: string): string {
  if (typeof value !== "string" || !TOKEN_PATTERN.test(value)) throw invalid(field);
  return value;
}

/**
 * `dirty` = the station's device record had unsynced local edits when the
 * payload was built (missing means false). `local_updated_at` is information only.
 */
export function stationPayload(value: unknown): Row {
  const station = objectField(value, "station");
  return {
    ...stationEditFields(station, "station."),
    app_version: textField(station.app_version, "station.app_version", 40),
    local_updated_at: isoField(station.local_updated_at, "station.local_updated_at"),
    dirty: station.dirty === undefined || station.dirty === null ? false : booleanField(station.dirty, "station.dirty"),
  };
}

export function gamePayloads(value: unknown): Row[] {
  const games = new Map<string, Row>();
  arrayField(value, "games", MAX_GAMES).forEach((item, index) => {
    const field = `games[${index}]`;
    const game = objectField(item, field);
    const gameId = idField(game.game_id, `${field}.game_id`);
    games.set(gameId, {
      game_id: gameId,
      title: textField(game.title, `${field}.title`, 200),
      enabled: booleanField(game.enabled, `${field}.enabled`),
      launch_type: textField(game.launch_type, `${field}.launch_type`, 40),
      source: textField(game.source, `${field}.source`, 200),
      availability_status: textField(game.availability_status, `${field}.availability_status`, 40),
      local_updated_at: isoField(game.local_updated_at, `${field}.local_updated_at`),
    });
  });
  return [...games.values()];
}

function sessionGames(value: unknown, field: string): Row[] {
  return arrayField(value ?? [], field, MAX_SESSION_GAMES).map((item, index) => {
    const entry = `${field}[${index}]`;
    const play = objectField(item, entry);
    return {
      game_id: idField(play.game_id, `${entry}.game_id`),
      title: textField(play.title, `${entry}.title`, 200),
      started_at: isoField(play.started_at, `${entry}.started_at`),
      ended_at: optionalIsoField(play.ended_at, `${entry}.ended_at`),
    };
  });
}

/** Sessions are optional in a sync body; duplicates keep the last entry. */
export function sessionPayloads(value: unknown): Row[] {
  const sessions = new Map<string, Row>();
  arrayField(value ?? [], "sessions", MAX_SESSIONS).forEach((item, index) => {
    const field = `sessions[${index}]`;
    const session = objectField(item, field);
    const sessionId = idField(session.session_id, `${field}.session_id`);
    sessions.set(sessionId, {
      session_id: sessionId,
      status: enumField(session.status, `${field}.status`, SESSION_STATUSES),
      started_at: isoField(session.started_at, `${field}.started_at`),
      expires_at: isoField(session.expires_at, `${field}.expires_at`),
      ended_at: optionalIsoField(session.ended_at, `${field}.ended_at`),
      duration_minutes: integerField(session.duration_minutes, `${field}.duration_minutes`, 0, MAX_DURATION_MINUTES),
      amount_paise: integerField(session.amount_paise, `${field}.amount_paise`, 0, MAX_AMOUNT_PAISE),
      currency: currencyField(session.currency, `${field}.currency`),
      plan_ids: textArrayField(session.plan_ids, `${field}.plan_ids`, MAX_LIST_ENTRIES),
      plan_names: textArrayField(session.plan_names, `${field}.plan_names`, MAX_LIST_ENTRIES),
      checkout_ids: textArrayField(session.checkout_ids, `${field}.checkout_ids`, MAX_LIST_ENTRIES),
      games: sessionGames(session.games, `${field}.games`),
      local_updated_at: isoField(session.local_updated_at, `${field}.local_updated_at`),
    });
  });
  return [...sessions.values()];
}
