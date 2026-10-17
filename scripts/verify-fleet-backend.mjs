import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import {
  constantTimeEqual,
  hashPin,
  isValidPin,
  lockoutMinutes,
  randomHex,
  sha256Hex,
  verifyPin
} from '../supabase/functions/stationFleet/pin.ts';
import {
  payerColumnsFromPayment,
  payerDetailsKnown,
  payerWireFromCheckout
} from '../supabase/functions/_shared/razorpayPayer.ts';
import {
  FleetError,
  gamePayloads,
  sessionPayloads,
  stationEditFields,
  stationPayload,
  tokenField
} from '../supabase/functions/stationFleet/validate.ts';

// ---------------------------------------------------------------------------
// PIN hashing (WebCrypto module shared with the Deno function)
// ---------------------------------------------------------------------------

const PIN_HASH_FORMAT = /^pbkdf2-sha256\$10000\$[0-9a-f]{32}\$[0-9a-f]{64}$/;
const hash = await hashPin('1832');
assert.match(hash, PIN_HASH_FORMAT);
assert.equal(await verifyPin('1832', hash), true);
assert.equal(await verifyPin('1833', hash), false);
assert.equal(await verifyPin('18320', hash), false);
assert.notEqual(await hashPin('1832'), hash, 'every hash must use a fresh salt');
assert.equal(await verifyPin('1832', ''), false);
assert.equal(await verifyPin('1832', 'plain-1832'), false);
assert.equal(await verifyPin('1832', hash.replace('pbkdf2-sha256', 'pbkdf2-sha1')), false);
assert.equal(await verifyPin('1832', hash.replace('$10000$', '$99999999$')), false);
assert.equal(await verifyPin('1832', `${hash.slice(0, -2)}zz`), false);
const longPinHash = await hashPin('123456789012');
assert.equal(await verifyPin('123456789012', longPinHash), true);

assert.equal(isValidPin('1832'), true);
assert.equal(isValidPin('0000'), true);
assert.equal(isValidPin('123456789012'), true);
assert.equal(isValidPin('123'), false);
assert.equal(isValidPin('1234567890123'), false);
assert.equal(isValidPin('12a4'), false);
assert.equal(isValidPin(' 1234'), false);
assert.equal(isValidPin('١٢٣٤'), false, 'only ASCII digits are PIN digits');
assert.equal(isValidPin(1832), false);
assert.equal(isValidPin(null), false);

assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
const token = randomHex(32);
assert.match(token, /^[0-9a-f]{64}$/);
assert.notEqual(randomHex(32), token);
assert.equal(constantTimeEqual('abc', 'abc'), true);
assert.equal(constantTimeEqual('abc', 'abd'), false);
assert.equal(constantTimeEqual('abc', 'abcd'), false);

// Main admin lockout backoff: 10 min, doubling per consecutive lockout, at most 24 h.
assert.deepEqual([1, 2, 3, 4, 8, 9, 50, 10_000].map(lockoutMinutes), [10, 20, 40, 80, 1280, 1440, 1440, 1440]);
assert.equal(lockoutMinutes(0), 10);

// The Electron main process hashes moderator PINs with node:crypto; both sides must agree.
const nodePinHashPath = new URL('../src/main/pinHash.ts', import.meta.url);
if (existsSync(nodePinHashPath)) {
  const nodePinHash = await import(nodePinHashPath.href);
  assert.equal(nodePinHash.verifyPinHash('1832', hash), true, 'main process must accept edge-function hashes');
  assert.equal(nodePinHash.verifyPinHash('1833', hash), false);
  const fromNode = nodePinHash.hashPin('4321');
  assert.match(fromNode, PIN_HASH_FORMAT);
  assert.equal(await verifyPin('4321', fromNode), true, 'edge function must accept main-process hashes');
  assert.equal(await verifyPin('4322', fromNode), false);
}

// ---------------------------------------------------------------------------
// Input validation (stationFleet/validate.ts)
// ---------------------------------------------------------------------------

const rejects = (run, detail) => assert.throws(run, (error) => {
  assert.ok(error instanceof FleetError, `expected FleetError, got ${error}`);
  assert.equal(error.message, 'invalid_input');
  assert.equal(error.status, 400);
  assert.equal(error.extra.detail, detail);
  return true;
});
assert.equal(new FleetError('owner_locked', { locked_until: 'x' }).status, 423);
assert.equal(new FleetError('station_removed').status, 403);
assert.equal(new FleetError('unexpected_code').status, 500);

const station = {
  name: ' Counter 1 ',
  store_name: 'NXGS Shillong',
  location: '',
  status: 'active',
  app_version: '0.25.0',
  local_updated_at: '2026-10-17T17:30:00+05:30'
};
assert.deepEqual(stationPayload(station), {
  name: 'Counter 1',
  store_name: 'NXGS Shillong',
  location: '',
  status: 'active',
  app_version: '0.25.0',
  local_updated_at: '2026-10-17T12:00:00.000Z',
  dirty: false
});
assert.equal(stationPayload({ ...station, dirty: true }).dirty, true);
rejects(() => stationPayload({ ...station, dirty: 'yes' }), 'station.dirty');
rejects(() => stationPayload(null), 'station');
rejects(() => stationPayload({ ...station, name: '  ' }), 'station.name');
rejects(() => stationPayload({ ...station, name: 'x'.repeat(81) }), 'station.name');
rejects(() => stationPayload({ ...station, store_name: 'x'.repeat(121) }), 'station.store_name');
rejects(() => stationPayload({ ...station, location: 'x'.repeat(161) }), 'station.location');
rejects(() => stationPayload({ ...station, status: 'paused' }), 'station.status');
rejects(() => stationPayload({ ...station, local_updated_at: 'yesterday' }), 'station.local_updated_at');
rejects(() => stationPayload({ ...station, local_updated_at: '2026-10-17' }), 'station.local_updated_at');
assert.equal(stationEditFields({ ...station, name: 'x'.repeat(80) }).name.length, 80);
rejects(() => stationEditFields({ ...station, status: undefined }), 'status');

// Stations generate their own token: 32 random bytes as lowercase hex.
assert.equal(tokenField(token, 'station_token'), token);
rejects(() => tokenField(token.toUpperCase(), 'station_token'), 'station_token');
rejects(() => tokenField(token.slice(1), 'station_token'), 'station_token');
rejects(() => tokenField(undefined, 'station_token'), 'station_token');

const game = {
  game_id: 'game_abc',
  title: 'Forza Horizon',
  enabled: true,
  launch_type: 'steam',
  source: 'steam',
  availability_status: 'available',
  local_updated_at: '2026-10-17T12:00:00.000Z'
};
const manyGames = (count) => Array.from({ length: count }, (_, index) => ({ ...game, game_id: `game_${index}` }));
assert.equal(gamePayloads([game, { ...game, title: 'Forza Horizon 5' }]).length, 1, 'duplicate game ids collapse');
assert.equal(gamePayloads(manyGames(500)).length, 500);
rejects(() => gamePayloads(manyGames(501)), 'games');
rejects(() => gamePayloads(undefined), 'games'); // a missing list must never soft-delete a library
rejects(() => gamePayloads([{ ...game, enabled: 'yes' }]), 'games[0].enabled');
rejects(() => gamePayloads([{ ...game, game_id: '' }]), 'games[0].game_id');
rejects(() => gamePayloads([{ ...game, game_id: 'a\nb' }]), 'games[0].game_id');
rejects(() => gamePayloads([{ ...game, title: 'x'.repeat(201) }]), 'games[0].title');
rejects(() => gamePayloads([{ ...game, title: 'Bad\u0000Title' }]), 'games[0].title');

const session = {
  session_id: 'session_1',
  status: 'completed',
  started_at: '2026-10-17T10:00:00.000Z',
  expires_at: '2026-10-17T11:00:00.000Z',
  ended_at: null,
  duration_minutes: 60,
  amount_paise: 12000,
  currency: 'inr',
  plan_ids: ['plan_1'],
  plan_names: ['1 Hour'],
  checkout_ids: ['6f1c2a9e-0d7b-4c3e-9a51-2b8f7e6d5c4a'],
  games: [{ game_id: 'game_abc', title: 'Forza Horizon', started_at: '2026-10-17T10:01:00Z' }],
  local_updated_at: '2026-10-17T11:00:00.000Z'
};
const [parsedSession] = sessionPayloads([session]);
assert.equal(parsedSession.currency, 'INR');
assert.equal(parsedSession.ended_at, null);
assert.deepEqual(parsedSession.games, [
  { game_id: 'game_abc', title: 'Forza Horizon', started_at: '2026-10-17T10:01:00.000Z', ended_at: null }
]);
assert.deepEqual(sessionPayloads(undefined), []);
assert.deepEqual(sessionPayloads([{ ...session, plan_ids: undefined }])[0].plan_ids, []);
const manySessions = (count) => Array.from({ length: count }, (_, index) => ({ ...session, session_id: `session_${index}` }));
assert.equal(sessionPayloads(manySessions(200)).length, 200);
rejects(() => sessionPayloads(manySessions(201)), 'sessions');
for (const duration of [0, 100_000]) assert.equal(sessionPayloads([{ ...session, duration_minutes: duration }])[0].duration_minutes, duration);
for (const duration of [-1, 100_001, 1.5, '60', null]) rejects(() => sessionPayloads([{ ...session, duration_minutes: duration }]), 'sessions[0].duration_minutes');
for (const amount of [0, 100_000_000]) assert.equal(sessionPayloads([{ ...session, amount_paise: amount }])[0].amount_paise, amount);
for (const amount of [-1, 100_000_001, 120.5]) rejects(() => sessionPayloads([{ ...session, amount_paise: amount }]), 'sessions[0].amount_paise');
rejects(() => sessionPayloads([{ ...session, status: 'paid' }]), 'sessions[0].status');
rejects(() => sessionPayloads([{ ...session, currency: 'RUPEE' }]), 'sessions[0].currency');
rejects(() => sessionPayloads([{ ...session, started_at: 'not a date' }]), 'sessions[0].started_at');
rejects(() => sessionPayloads([{ ...session, checkout_ids: 'abc' }]), 'sessions[0].checkout_ids');
const sessionGameList = (count) => Array.from({ length: count }, () => session.games[0]);
assert.equal(sessionPayloads([{ ...session, games: sessionGameList(200) }])[0].games.length, 200);
rejects(() => sessionPayloads([{ ...session, games: sessionGameList(201) }]), 'sessions[0].games');
rejects(() => sessionPayloads([{ ...session, games: [{ ...session.games[0], ended_at: 'later' }] }]), 'sessions[0].games[0].ended_at');

// ---------------------------------------------------------------------------
// Razorpay payer mapping (shared by pcPayment and stationFleet)
// ---------------------------------------------------------------------------

const upiPayment = {
  id: 'pay_upi123',
  contact: '+919876543210',
  email: 'void@razorpay.com',
  method: 'upi',
  vpa: 'player@okaxis',
  bank: null,
  wallet: null,
  card: null,
  notes: [],
  created_at: 1792238400
};
assert.deepEqual(payerColumnsFromPayment(upiPayment, null), {
  payer_name: null,
  payer_phone: '+919876543210',
  payer_email: null,
  payment_method: 'upi',
  payer_upi_id: 'player@okaxis',
  payment_bank: null,
  payment_wallet: null,
  card_network: null,
  card_last4: null,
  payment_captured_at: '2026-10-17T12:00:00.000Z'
});
assert.equal(payerColumnsFromPayment({ ...upiPayment, vpa: null, upi: { vpa: 'nested@ybl' } }).payer_upi_id, 'nested@ybl');
assert.equal(payerColumnsFromPayment({ ...upiPayment, email: 'VOID@razorpay.com ' }).payer_email, null);
assert.equal(payerColumnsFromPayment({ ...upiPayment, email: '   ' }).payer_email, null);
assert.equal(payerColumnsFromPayment(upiPayment, 'Asha').payer_name, 'Asha', 'customer_name is the fallback name');

const cardColumns = payerColumnsFromPayment({
  id: 'pay_card123',
  contact: '+919000000001',
  email: 'gamer@example.com',
  method: 'card',
  card: { network: 'Visa', last4: '1111', number: '4111111111111111' },
  notes: { name: 'Ravi' },
  created_at: 'not-a-time'
}, 'Asha');
assert.equal(cardColumns.payer_name, 'Ravi', 'payment notes name wins over customer_name');
assert.equal(cardColumns.payer_email, 'gamer@example.com');
assert.equal(cardColumns.card_network, 'Visa');
assert.equal(cardColumns.card_last4, '1111');
assert.equal(cardColumns.payment_captured_at, null);
assert.ok(!JSON.stringify(cardColumns).includes('4111111111111111'), 'full card numbers are never stored');
assert.equal(payerColumnsFromPayment({ method: 'card', card: { last4: '12345' } }).card_last4, null);
assert.equal(payerColumnsFromPayment({}).payment_method, null);

const checkoutRow = {
  id: '6f1c2a9e-0d7b-4c3e-9a51-2b8f7e6d5c4a',
  status: 'consumed',
  client_token_hash: 'secret',
  razorpay_payment_id: 'pay_upi123',
  customer_name: 'Asha',
  ...payerColumnsFromPayment(upiPayment, null),
  payment_captured_at: '2026-10-17T12:00:00+00:00',
  payer_details_fetched_at: '2026-10-17T12:00:05+00:00'
};
const wire = payerWireFromCheckout(checkoutRow);
assert.deepEqual(Object.keys(wire), [
  'checkout_id', 'razorpay_payment_id', 'name', 'phone', 'email', 'method', 'upi_id',
  'bank', 'wallet', 'card_network', 'card_last4', 'paid_at'
]);
assert.equal(wire.checkout_id, checkoutRow.id);
assert.equal(wire.name, 'Asha');
assert.equal(wire.phone, '+919876543210');
assert.equal(wire.upi_id, 'player@okaxis');
assert.equal(wire.paid_at, '2026-10-17T12:00:00.000Z');
assert.ok(!JSON.stringify(wire).includes('secret'), 'payer wire must not leak checkout secrets');
assert.equal(payerDetailsKnown(checkoutRow), true);
assert.equal(payerDetailsKnown({ id: checkoutRow.id, razorpay_payment_id: 'pay_x', payer_details_fetched_at: null }), false);
assert.equal(payerDetailsKnown({ id: checkoutRow.id, payer_phone: '+919000000000' }), true);

// ---------------------------------------------------------------------------
// Static checks: migrations
// ---------------------------------------------------------------------------

// Older files are checked out with CRLF line endings; compare on LF.
const normalize = (text) => text.replace(/\r\n/g, '\n');
const read = async (path) => normalize(await readFile(new URL(path, import.meta.url), 'utf8'));
const [migration, payerMigration, hardeningMigration, fleet, validation, payment] = await Promise.all([
  read('../supabase/migrations/20261017120000_station_fleet.sql'),
  read('../supabase/migrations/20261017120100_checkout_payer_details.sql'),
  read('../supabase/migrations/20261017130000_fleet_hardening.sql'),
  read('../supabase/functions/stationFleet/index.ts'),
  read('../supabase/functions/stationFleet/validate.ts'),
  read('../supabase/functions/pcPayment/index.ts')
]);
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const FLEET_TABLES = [
  'fleet_owner',
  'fleet_owner_sessions',
  'fleet_stations',
  'fleet_station_games',
  'fleet_sessions',
  'fleet_moderators',
  'fleet_moderator_stations'
];
const createdTables = [...migration.matchAll(/create table if not exists public\.(\w+)/g)].map((match) => match[1]);
assert.deepEqual([...createdTables].sort(), [...FLEET_TABLES].sort(), 'migration must create exactly the contract tables');
for (const table of FLEET_TABLES) {
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security;`), `${table} needs RLS`);
  assert.match(migration, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated;`), `${table} must revoke client roles`);
  assert.match(migration, new RegExp(`grant all on table public\\.${table} to service_role;`), `${table} must grant service_role`);
  assert.match(migration, new RegExp(`comment on table public\\.${table} is`), `${table} needs a comment`);
}
assert.match(migration, /revoke all on table public\.fleet_station_totals from public, anon, authenticated;/);
assert.match(migration, /create or replace view public\.fleet_station_totals\s+with \(security_invoker = true\)/);
assert.doesNotMatch(migration, /grant [^;]* to (anon|authenticated)/i, 'no client role may be granted fleet access');
assert.match(migration, /insert into public\.fleet_owner \(id, pin_hash\)\s+values \(1, null\)\s+on conflict \(id\) do nothing;/);
assert.match(migration, /id smallint primary key default 1 check \(id = 1\)/);
assert.match(migration, /token_hash text not null unique/);
assert.match(migration, /primary key \(station_id, game_id\)/);
assert.match(migration, /primary key \(station_id, session_id\)/);
assert.match(migration, /primary key \(moderator_id, station_id\)/);
assert.match(migration, /on public\.fleet_sessions \(started_at desc\)/);
assert.match(migration, /games jsonb not null default '\[\]'::jsonb/);
assert.match(migration, /moderator_id uuid not null references public\.fleet_moderators\(id\) on delete cascade/);
assert.match(migration, /station_id text not null references public\.fleet_stations\(id\) on delete cascade,\s+primary key \(moderator_id, station_id\)/);
for (const table of ['fleet_owner', 'fleet_stations', 'fleet_station_games', 'fleet_moderators']) {
  assert.match(migration, new RegExp(`create or replace trigger ${table}_touch_updated_at\\s+before update on public\\.${table}\\s+for each row execute function public\\.touch_fleet_updated_at\\(\\);`), `${table} needs the updated_at trigger`);
}
assert.doesNotMatch(migration, /drop trigger/i, 'triggers use create or replace trigger');

// Hardening migration: additive only (the live deploy tool cancels destructive SQL).
const hardeningSql = hardeningMigration.replace(/--.*$/gm, '');
assert.doesNotMatch(hardeningSql, /\b(drop|revoke|truncate|delete|rename|alter column)\b/i, 'fleet hardening migration must stay additive');
assert.match(hardeningSql, /alter table public\.fleet_owner\s+add column if not exists lockout_count integer not null default 0/);
assert.match(hardeningSql, /alter table public\.fleet_stations\s+add column if not exists owner_edit_pending boolean not null default false/);
assert.match(hardeningSql, /alter table public\.pc_checkouts\s+add column if not exists consumed_by_station_id text/);
for (const column of ['fleet_owner.lockout_count', 'fleet_stations.owner_edit_pending', 'pc_checkouts.consumed_by_station_id']) {
  assert.match(hardeningSql, new RegExp(`comment on column public\\.${escape(column)} is`), `${column} needs a comment`);
}

const PAYER_COLUMNS = [
  'payer_phone', 'payer_email', 'payer_name', 'payment_method', 'payer_upi_id', 'payment_bank',
  'payment_wallet', 'card_network', 'card_last4', 'payment_captured_at', 'payer_details_fetched_at'
];
for (const column of PAYER_COLUMNS) {
  assert.match(payerMigration, new RegExp(`add column if not exists ${column} (text|timestamptz)`), `pc_checkouts.${column} missing`);
  assert.match(payerMigration, new RegExp(`comment on column public\\.pc_checkouts\\.${column} is`), `pc_checkouts.${column} needs a comment`);
}
assert.doesNotMatch(payerMigration, /^\s*(grant|revoke)\b|disable row level security/im, 'payer migration must keep existing grants and RLS');

// Column inventory per table, from every migration, to cross-check the function's column lists.
const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const allMigrations = await Promise.all((await readdir(migrationDirectory)).filter((name) => name.endsWith('.sql')).sort()
  .map(async (name) => normalize(await readFile(new URL(name, migrationDirectory), 'utf8'))));
const tableColumns = new Map();
for (const sql of allMigrations) {
  for (const match of sql.matchAll(/create table if not exists public\.(\w+) \(([\s\S]*?)\n\);/g)) {
    const columns = [...match[2].matchAll(/^\s+(\w+) (?:text|uuid|smallint|integer|boolean|timestamptz|jsonb)\b/gm)].map((column) => column[1]);
    tableColumns.set(match[1], new Set(columns));
  }
  for (const match of sql.matchAll(/alter table public\.(\w+)([\s\S]*?);/g)) {
    const columns = tableColumns.get(match[1]) ?? new Set();
    for (const column of match[2].matchAll(/add column (?:if not exists )?(\w+)/g)) columns.add(column[1]);
    tableColumns.set(match[1], columns);
  }
}
tableColumns.set('fleet_station_totals', new Set(['station_id', 'game_count', 'session_count', 'total_revenue_paise']));
for (const column of tableColumns.get('fleet_station_totals')) assert.match(migration, new RegExp(`\\b${column}\\b`));

// ---------------------------------------------------------------------------
// Static checks: stationFleet function
// ---------------------------------------------------------------------------

// Comment lines are dropped so usage counts and secret checks only see code.
const fleetCode = fleet.replace(/^\s*(\/\/|\/\*\*|\*).*$/gm, '');

/** Source of a top-level function, from its declaration to the closing brace at column 0. */
function functionBody(source, name) {
  const start = source.search(new RegExp(`(?:async )?function ${escape(name)}[<(]`));
  assert.ok(start >= 0, `function ${name} not found`);
  const end = source.indexOf('\n}\n', start);
  assert.ok(end > start, `end of function ${name} not found`);
  return source.slice(start, end + 2);
}

assert.match(fleet, /import \{ createClient \} from "npm:@supabase\/supabase-js@2\.49\.8";/);
assert.match(fleet, /from "\.\/pin\.ts";/);
assert.match(fleet, /from "\.\/validate\.ts";/);
assert.doesNotMatch(validation, /Deno\.|supabase|fetch\(/, 'validate.ts must stay pure');
const fleetAll = `${fleet}\n${validation}`;
assert.match(fleet, /SUPABASE_PUBLISHABLE_KEYS/);
assert.match(fleet, /SUPABASE_ANON_KEY/);
assert.match(fleet, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(fleet, /if \(!authorized\(req\)\) return json\(\{ error: true, message: "unauthorized_client" \}, 401\);/);

const STATION_ACTIONS = ['register', 'sync', 'session_payers', 'owner_login', 'owner_logout'];
const OWNER_ACTIONS = [
  'owner_change_pin', 'list_stations', 'get_station', 'update_station', 'remove_station',
  'set_game_enabled', 'earnings', 'list_moderators', 'save_moderator', 'delete_moderator'
];
for (const action of STATION_ACTIONS) assert.match(fleet, new RegExp(`action === "${action}"`), `action ${action} missing`);
const ownerActionTable = fleet.slice(fleet.indexOf('const OWNER_ACTIONS'), fleet.indexOf('};', fleet.indexOf('const OWNER_ACTIONS')));
for (const action of OWNER_ACTIONS) assert.match(ownerActionTable, new RegExp(`\\b${action}\\b`), `owner action ${action} missing`);
// Owner actions all pass through requireOwner before their handler runs.
assert.match(fleet, /const session = await requireOwner\(supabase, body\.owner_token\);\s+return await handler\(supabase, body, session\);/);

const ERROR_CODES = {
  unauthorized_client: 401,
  unauthorized_station: 401,
  station_removed: 403,
  station_already_registered: 409,
  owner_pin_required: 401,
  invalid_owner_pin: 401,
  owner_locked: 423,
  not_found: 404,
  invalid_input: 400,
  request_failed: 500
};
for (const [code, status] of Object.entries(ERROR_CODES)) {
  assert.match(validation, new RegExp(`${code}: ${status},`), `error code ${code} must map to ${status}`);
}
for (const code of ['unauthorized_station', 'station_removed', 'station_already_registered', 'owner_pin_required', 'invalid_owner_pin', 'owner_locked', 'not_found']) {
  assert.match(fleet, new RegExp(`new FleetError\\([^)]*"${code}"`), `error code ${code} is never raised`);
}
assert.match(validation, /new FleetError\("invalid_input", \{ detail \}\)/);
assert.match(fleet, /new FleetError\("owner_locked", \{ locked_until:/);
assert.match(fleet, /return json\(\{ error: true, message: "request_failed" \}, 500\);/);

// Constant-time comparisons for every credential check.
assert.match(functionBody(fleet, 'requireStation'), /constantTimeEqual\(await sha256Hex\(token\), String\(data\.token_hash\)\)/);
assert.match(functionBody(fleet, 'requireOwner'), /constantTimeEqual\(tokenHash, String\(data\.token_hash\)\)/);
assert.match(functionBody(fleet, 'checkOwnerPin'), /constantTimeEqual\(candidate, DEFAULT_OWNER_PIN\)/);
assert.match(functionBody(fleet, 'checkOwnerPin'), /await verifyPin\(candidate, String\(owner\.pin_hash\)\)/);
assert.doesNotMatch(fleet, /(token_hash|pin_hash|tokenHash|DEFAULT_OWNER_PIN)\)?\s*[!=]==|[!=]==\s*(DEFAULT_OWNER_PIN|tokenHash)/, 'credentials must not use === comparisons');

// Default PIN, lockout and sliding owner session.
assert.match(fleet, /const DEFAULT_OWNER_PIN = "1832";/);
assert.equal(fleet.split('1832').length - 1, 1, 'the default PIN must only appear in its named constant');
assert.match(fleet, /const OWNER_MAX_FAILED_ATTEMPTS = 5;/);
assert.match(functionBody(fleet, 'reserveOwnerAttempt'), /minutesFromNow\(lockoutMinutes\(lockouts \+ 1\)\)/);
assert.match(functionBody(fleet, 'reserveOwnerAttempt'), /lockout_count: locking \? lockouts \+ 1 : lockouts/);
assert.match(functionBody(fleet, 'reserveOwnerAttempt'), /\.eq\("lockout_count", lockouts\)/);
assert.match(functionBody(fleet, 'checkOwnerPin'), /update\(\{ failed_attempts: 0, lockout_count: 0, locked_until: null/);
assert.match(functionBody(fleet, 'changeOwnerPin'), /await checkOwnerPin\(supabase, body\.current_pin,/, 'current_pin follows the same lockout');
assert.match(fleet, /const OWNER_SESSION_MINUTES = 30;/);
assert.match(functionBody(fleet, 'requireOwner'), /update\(\{ expires_at: expiresAt, last_used_at: now \}\)/);
assert.match(functionBody(fleet, 'reserveOwnerAttempt'), /\.eq\("failed_attempts", failures\)/);
assert.match(functionBody(fleet, 'changeOwnerPin'), /\.delete\(\)\.neq\("id", session\.id\)/);

// Input limits from the contract.
for (const limit of [
  'MAX_GAMES = 500', 'MAX_SESSIONS = 200', 'MAX_SESSION_GAMES = 200', 'MAX_DURATION_MINUTES = 100_000',
  'MAX_AMOUNT_PAISE = 100_000_000', 'EARNINGS_ROW_CAP = 5_000', 'MAX_PAYER_CHECKOUTS = 200',
  'PAYER_BACKFILL_LIMIT = 20', 'PAYER_BACKFILL_BATCH = 5'
]) {
  assert.match(fleetAll, new RegExp(`const ${escape(limit)};`), `${limit} missing`);
}
assert.match(validation, /const STATION_ID_PATTERN = \/\^\[A-Za-z0-9_-\]\{3,80\}\$\/;/);
assert.match(functionBody(validation, 'stationEditFields'), /textField\(source\.name, `\$\{prefix\}name`, 80, 1\)/);
assert.match(functionBody(validation, 'stationEditFields'), /store_name`, 120\)/);
assert.match(functionBody(validation, 'stationEditFields'), /location`, 160\)/);
assert.match(functionBody(fleet, 'saveModerator'), /textField\(body\.name, "name", 60, 1\)/);

// Secrets never reach owner-facing responses.
const columnLists = new Map([...fleet.matchAll(/const (\w+_COLUMNS) = "([^"]+)";/g)].map((match) => [match[1], match[2]]));
const SECRET_LISTS = new Map([
  ['STATION_AUTH_COLUMNS', ['loadStationAuth']],
  ['OWNER_AUTH_COLUMNS', ['loadOwner']],
  ['OWNER_SESSION_AUTH_COLUMNS', ['requireOwner']],
  ['STATION_MODERATOR_COLUMNS', ['stationModerators']]
]);
for (const [name, columns] of columnLists) {
  if (/token_hash|pin_hash/.test(columns)) assert.ok(SECRET_LISTS.has(name), `${name} selects a secret column`);
}
for (const [name, allowedFunctions] of SECRET_LISTS) {
  const uses = [...fleetCode.matchAll(new RegExp(`\\b${name}\\b`, 'g'))].length - 1;
  const allowedUses = allowedFunctions.reduce((count, fn) => count + [...functionBody(fleetCode, fn).matchAll(new RegExp(`\\b${name}\\b`, 'g'))].length, 0);
  assert.equal(uses, allowedUses, `${name} may only be used in ${allowedFunctions.join(', ')}`);
}
// pin_hash leaves the function only through sync, for offline moderator PIN checks.
assert.equal([...fleetCode.matchAll(/stationModerators\(/g)].length, 2);
assert.match(functionBody(fleet, 'syncStation'), /stationModerators\(supabase, stationId\)/);
assert.doesNotMatch(columnLists.get('CHECKOUT_PAYER_COLUMNS'), /token|secret/);
for (const call of fleet.matchAll(/\.select\(([^)]*)\)/g)) {
  const argument = call[1].trim();
  assert.notEqual(argument, '', 'select() without columns would return every column');
  if (argument.startsWith('"')) {
    assert.doesNotMatch(argument, /\*|token_hash|pin_hash/, `select(${argument}) must list safe columns`);
  } else {
    assert.ok(columnLists.has(argument), `select(${argument}) must use a named column list`);
  }
}
for (const mapper of [
  'cloudStation', 'stationGameRow', 'moderatorRecord', 'moderatorRecords', 'earningsRow', 'listStations',
  'getStation', 'earnings', 'listModerators', 'updateStation', 'setGameEnabled', 'sessionPayers'
]) {
  assert.doesNotMatch(functionBody(fleetCode, mapper), /token_hash|pin_hash|_AUTH_COLUMNS|STATION_MODERATOR_COLUMNS/, `${mapper} must not touch secrets`);
}
assert.match(functionBody(fleet, 'stationModerators'), /pin_hash: String\(row\.pin_hash\)/);
// saveModerator writes pin_hash but reads back and returns only the safe moderator shape.
assert.match(functionBody(fleet, 'saveModerator'), /return json\(\{ moderator: moderatorRecord\(saved, stationIds\) \}\);/);
for (const call of functionBody(fleet, 'saveModerator').matchAll(/\.select\(([^)]*)\)/g)) {
  assert.ok(['MODERATOR_COLUMNS', '"id, removed_at"'].includes(call[1]), `saveModerator select(${call[1]})`);
}

// Column lists and upsert payloads match the migration.
const LIST_TABLES = {
  STATION_AUTH_COLUMNS: 'fleet_stations',
  STATION_COLUMNS: 'fleet_stations',
  OWNER_AUTH_COLUMNS: 'fleet_owner',
  OWNER_SESSION_AUTH_COLUMNS: 'fleet_owner_sessions',
  STATION_MODERATOR_COLUMNS: 'fleet_moderators',
  MODERATOR_COLUMNS: 'fleet_moderators',
  TOTALS_COLUMNS: 'fleet_station_totals',
  GAME_COLUMNS: 'fleet_station_games',
  SYNC_GAME_COLUMNS: 'fleet_station_games',
  EARNINGS_COLUMNS: 'fleet_sessions',
  CHECKOUT_PAYER_COLUMNS: 'pc_checkouts'
};
assert.deepEqual([...columnLists.keys()].sort(), Object.keys(LIST_TABLES).sort());
for (const [name, table] of Object.entries(LIST_TABLES)) {
  const known = tableColumns.get(table);
  assert.ok(known, `table ${table} not found in migrations`);
  for (const column of columnLists.get(name).split(',').map((value) => value.trim())) {
    assert.ok(known.has(column), `${name}: ${table}.${column} does not exist`);
  }
}
const payloadKeys = (fn) => [...functionBody(validation, fn).matchAll(/^ {6}(\w+):/gm)].map((match) => match[1]);
for (const column of payloadKeys('gamePayloads')) assert.ok(tableColumns.get('fleet_station_games').has(column), `fleet_station_games.${column} missing`);
for (const column of payloadKeys('sessionPayloads')) assert.ok(tableColumns.get('fleet_sessions').has(column), `fleet_sessions.${column} missing`);
assert.match(fleet, /upsert\(rows, \{ onConflict: "station_id,game_id" \}\)/);
assert.match(fleet, /upsert\(rows, \{ onConflict: "station_id,session_id" \}\)/);
assert.match(fleet, /\{ onConflict: "moderator_id,station_id", ignoreDuplicates: true \}/);

// Sync: no ordering decision compares a station clock with the server clock.
assert.doesNotMatch(fleetCode, /Date\.parse\(|stationWins|timeOf\([^)]*(local_updated_at|owner_updated_at)|\.(lt|lte|gt|gte)\("?(owner_updated_at|local_updated_at)|(owner_updated_at|local_updated_at)\.(lt|lte|gt|gte)\./,
  'station and server clocks must never be compared');
const saveStationSync = functionBody(fleet, 'saveStationSync');
assert.match(saveStationSync, /if \(stored\.owner_edit_pending\) \{\s+if \(STATION_FIELDS\.every\(\(field\) => incoming\[field\] === stored\[field\]\)\)/);
assert.match(saveStationSync, /update\(\{ \.\.\.base, owner_edit_pending: false \}\)[\s\S]*\.eq\("owner_edit_pending", true\)/);
assert.match(saveStationSync, /\} else if \(payload\.dirty\) \{[\s\S]*update\(\{ \.\.\.base, \.\.\.incoming \}\)[\s\S]*\.eq\("owner_edit_pending", false\)/);
assert.match(functionBody(fleet, 'updateStation'), /owner_edit_pending: true/);
assert.match(fleet, /const STATION_FIELDS = \["name", "store_name", "location", "status"\];/);
const saveGames = functionBody(fleet, 'saveGames');
assert.match(saveGames, /deleted_at: now/);
assert.match(saveGames, /if \(ownerEnabled === game\.enabled\) \{\s+applied\.push\(game\);/);
assert.match(saveGames, /enabled: ownerEnabled \?\? game\.enabled/);
assert.match(saveGames, /\.eq\("owner_enabled", game\.enabled\)/);

// Register: station-generated token, idempotent retry, owner-approved rejoin / re-key.
const register = functionBody(fleet, 'registerStation');
assert.match(register, /const token = tokenField\(body\.station_token, "station_token"\);/);
assert.doesNotMatch(register, /randomHex\(/, 'the station generates its own token');
assert.match(register, /constantTimeEqual\(tokenHash, String\(existing\.token_hash\)\)/);
assert.match(register, /saveStationSync\(supabase, existing, \{ \.\.\.payload, dirty: false \}, now\)/);
assert.match(register, /throw new FleetError\(existing\.removed_at \? "station_removed" : "station_already_registered"\);\s+await requireOwner\(supabase, body\.owner_token\);/);
assert.match(register, /token_hash: tokenHash,\s+removed_at: null,/);

// Earnings and payers only trust a checkout for the station that consumed it.
assert.match(functionBody(fleet, 'checkoutTrustedFor'), /consumed_by_station_id == null \|\| String\(checkout!\.consumed_by_station_id\) === stationId/);
const earningsRowSource = functionBody(fleet, 'earningsRow');
assert.match(earningsRowSource, /return checkoutTrustedFor\(checkout, stationId\) \? checkout : undefined;/);
assert.match(earningsRowSource, /payment_verified: checkoutIds\.length > 0 && checkoutIds\.every\(\(id\) => lookup\(id\)\?\.status === "consumed"\)/);
assert.match(earningsRowSource, /const payers = unique\(checkoutIds\)\.map\(lookup\)/);
const sessionPayersSource = functionBody(fleet, 'sessionPayers');
assert.match(sessionPayersSource, /\.eq\("station_id", stationId\)\.overlaps\("checkout_ids", part\)/);
assert.match(sessionPayersSource, /\.filter\(\(row\) => checkoutTrustedFor\(row, stationId\)\);\s+await backfillPayers\(supabase, checkouts\);/);
assert.match(functionBody(fleet, 'checkoutRows'), /UUID_PATTERN\.test\(id\)/);
const earningsSource = functionBody(fleet, 'earnings');
assert.match(earningsSource, /EARNINGS_ROW_CAP \+ 1\);\s+const truncated = found\.length > EARNINGS_ROW_CAP;/);
assert.match(earningsSource, /json\(\{ rows: [^}]*\), truncated \}\)/);

// Payer backfill: card expansion falls back to the plain payment, all within one deadline.
const fetchRazorpay = functionBody(fleet, 'fetchRazorpayPayment');
assert.match(fetchRazorpay, /razorpayGet\(auth, `\$\{url\}\?expand\[\]=card`, deadline\)/);
assert.match(fetchRazorpay, /catch \{[\s\S]*return await razorpayGet\(auth, url, deadline\);/);
assert.match(functionBody(fleet, 'razorpayGet'), /AbortSignal\.timeout\(remaining\)/);
assert.match(functionBody(fleet, 'backfillPayer'), /\.is\("payer_details_fetched_at", null\)/);
assert.match(functionBody(fleet, 'backfillPayers'), /\.slice\(0, PAYER_BACKFILL_LIMIT\)/);
assert.match(functionBody(fleet, 'removeStation'), /token_hash: null/);
assert.match(functionBody(fleet, 'removeStation'), /from\("fleet_moderator_stations"\)\.delete\(\)\.eq\("station_id", stationId\)/);

// ---------------------------------------------------------------------------
// Static checks: pcPayment payer capture must never affect verification
// ---------------------------------------------------------------------------

assert.match(payment, /from "\.\.\/_shared\/razorpayPayer\.ts";/);
for (const action of ['pricing', 'create', 'status', 'retry', 'cancel', 'consume']) {
  assert.match(payment, new RegExp(`action === "${action}"`), `pcPayment lost action ${action}`);
}
const fetchPayment = functionBody(payment, 'fetchPayment');
assert.match(fetchPayment, /razorpay\(`\$\{path\}\?expand\[\]=card`\)/);
assert.match(fetchPayment, /catch \{[\s\S]*return await razorpay\(path\);/, 'plain payment fetch must remain the fallback');
assert.match(functionBody(payment, 'payerDetails'), /try \{[\s\S]*payer_details_fetched_at[\s\S]*\} catch \{\s+return \{\};/);
assert.match(functionBody(payment, 'entitlementPayer'), /try \{[\s\S]*\} catch \{\s+return null;/);
const reconcile = functionBody(payment, 'reconcilePaid');
assert.match(reconcile, /const payment = await fetchPayment\(paymentId\);/);
assert.match(reconcile, /String\(payment\.status\) !== "captured"/);
assert.match(reconcile, /update\(\{ \.\.\.verifiedFields, \.\.\.payer \}\)/);
assert.match(reconcile, /if \(error && Object\.keys\(payer\)\.length > 0\) \{[\s\S]*update\(verifiedFields\)/, 'verification must retry without payer columns');
assert.match(reconcile, /status: "verified"/);
const consume = functionBody(payment, 'consumeCheckout');
assert.match(consume, /const stationId = consumingStationId\(body\.station_id\);/);
assert.match(consume, /\.update\(stationId \? \{ \.\.\.consumedFields, consumed_by_station_id: stationId \} : consumedFields\)\s+\.eq\("id", current\.id\)\.eq\("status", "verified"\)/, 'station binding is stored in the same update');
assert.match(consume, /if \(error && stationId\) \{[\s\S]*update\(consumedFields\)\s+\.eq\("id", current\.id\)\.eq\("status", "verified"\)/, 'consume must retry without the station column');
assert.match(consume, /if \(error\) throw error;\s+if \(!data\) throw new Error\("payment_entitlement_already_used"\);\s+const payer = entitlementPayer\(data\);/);
assert.match(consume, /\.\.\.\(payer \? \{ payer \} : \{\}\)/);
assert.match(functionBody(payment, 'consumingStationId'), /typeof value === "string" && \/\^\[A-Za-z0-9_-\]\{3,80\}\$\/\.test\(value\) \? value : null/);

// Operator doc stays in step with the code.
const operatorDoc = await read('../docs/device-management-cloud.md');
assert.ok(operatorDoc.includes('npx supabase functions deploy stationFleet --project-ref oqcezdcnozgguytudliv --no-verify-jwt'));
assert.match(operatorDoc, /default main admin PIN is \*\*1832\*\*/);
assert.match(operatorDoc, /5 consecutive wrong PINs lock main admin login/);
assert.match(operatorDoc, /20261017130000_fleet_hardening\.sql/);
assert.match(operatorDoc, /consumed_by_station_id/);

console.log('Fleet backend verified: PIN hashing, input validation limits, payer mapping, migration RLS/grants and columns, stationFleet actions/error codes, secret-safe selects, and pcPayment payer capture.');
