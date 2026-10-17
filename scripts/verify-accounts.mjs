import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  buildEarningsReport,
  EARNINGS_CSV_COLUMNS,
  earningsReportToCsv,
  formatCsvDateTime,
  formatPaise,
  normalizePayerDetails,
  normalizePayerList,
  paymentMethodLabel,
  upsertPayer
} from '../src/shared/earnings.ts';
import { hashPin, isValidPin, PIN_HASH_ITERATIONS, verifyPinHash } from '../src/main/pinHash.ts';

// ---------------------------------------------------------------------------
// Earnings aggregation
// ---------------------------------------------------------------------------

const now = '2026-10-17T12:00:00.000Z';
const row = (overrides) => ({
  id: 'session_x',
  stationId: 'device_a',
  stationName: 'Front PC',
  status: 'completed',
  startedAt: '2026-10-17T08:00:00.000Z',
  endedAt: '2026-10-17T09:00:00.000Z',
  durationMinutes: 60,
  amountPaise: 10000,
  currency: 'INR',
  planNames: ['1 Hour'],
  checkoutIds: ['checkout-1'],
  games: [],
  payers: [],
  ...overrides
});

const rows = [
  row({
    id: 'session_1',
    games: [
      { gameId: 'fifa', title: 'FIFA', startedAt: '2026-10-17T08:00:00.000Z', endedAt: '2026-10-17T08:30:00.000Z' },
      // Open entry: runs to the session end (09:00) = 20 minutes.
      { gameId: 'gta', title: 'GTA V', startedAt: '2026-10-17T08:40:00.000Z' },
      // Relaunch of FIFA in the same session counts one session, more minutes.
      { gameId: 'fifa', title: 'FIFA 26', startedAt: '2026-10-17T08:30:00.000Z', endedAt: '2026-10-17T08:35:00.000Z' }
    ]
  }),
  row({
    id: 'session_2',
    stationId: 'device_b',
    stationName: 'Back PC',
    startedAt: '2026-10-17T10:00:00.000Z',
    endedAt: undefined,
    status: 'active',
    durationMinutes: 90,
    amountPaise: 15000,
    // Open entry in an active session: runs to `now` (12:00) = 90 minutes.
    games: [{ gameId: 'gta', title: 'GTA V', startedAt: '2026-10-17T10:30:00.000Z' }]
  }),
  row({
    id: 'session_3',
    startedAt: '2026-10-16T08:00:00.000Z',
    endedAt: '2026-10-16T08:30:00.000Z',
    durationMinutes: 30,
    amountPaise: 5000,
    // A clock jump must never produce negative play time.
    games: [{ gameId: 'fifa', title: 'FIFA', startedAt: '2026-10-16T08:20:00.000Z', endedAt: '2026-10-16T08:10:00.000Z' }]
  })
];
const inputSnapshot = JSON.stringify(rows);

const report = buildEarningsReport(rows, { scope: 'all', from: '2026-10-01T00:00:00.000Z', now });
assert.equal(JSON.stringify(rows), inputSnapshot, 'buildEarningsReport must not mutate its input');
assert.equal(report.scope, 'all');
assert.equal(report.generatedAt, now);
assert.equal(report.from, '2026-10-01T00:00:00.000Z');
assert.equal(report.to, undefined);
assert.equal(report.currency, 'INR');
assert.equal(report.totalPaise, 30000);
assert.equal(report.sessionCount, 3);
assert.equal(report.paidMinutes, 180);
assert.deepEqual(report.rows.map((entry) => entry.id), ['session_2', 'session_1', 'session_3'], 'rows are newest first');
assert.deepEqual(report.byStation, [
  { stationId: 'device_a', stationName: 'Front PC', sessionCount: 2, amountPaise: 15000 },
  { stationId: 'device_b', stationName: 'Back PC', sessionCount: 1, amountPaise: 15000 }
], 'stations sort by amount, then by session count');
assert.deepEqual(report.byGame, [
  { gameId: 'gta', title: 'GTA V', sessionCount: 2, playMinutes: 110 },
  { gameId: 'fifa', title: 'FIFA', sessionCount: 2, playMinutes: 35 }
], 'games sum play minutes (open entries to session end or now, clamped at zero) and count sessions once');

// An open entry in a session that never reported an end stops at the paid expiry (or now, if sooner).
const capped = buildEarningsReport([
  row({
    id: 'session_stale',
    status: 'active',
    startedAt: '2026-10-17T10:00:00.000Z',
    endedAt: undefined,
    expiresAt: '2026-10-17T10:30:00.000Z',
    games: [{ gameId: 'gta', title: 'GTA V', startedAt: '2026-10-17T10:05:00.000Z' }]
  }),
  row({
    id: 'session_live',
    status: 'active',
    startedAt: '2026-10-17T11:00:00.000Z',
    endedAt: undefined,
    expiresAt: '2026-10-17T13:00:00.000Z',
    games: [{ gameId: 'fifa', title: 'FIFA', startedAt: '2026-10-17T11:30:00.000Z' }]
  }),
  row({
    id: 'session_late',
    status: 'active',
    startedAt: '2026-10-17T09:00:00.000Z',
    endedAt: undefined,
    expiresAt: '2026-10-17T09:30:00.000Z',
    // Started after the paid time ran out: clamps to zero.
    games: [{ gameId: 'nfs', title: 'NFS', startedAt: '2026-10-17T09:45:00.000Z' }]
  })
], { scope: 'all', now, truncated: true });
assert.deepEqual(
  Object.fromEntries(capped.byGame.map((game) => [game.gameId, game.playMinutes])),
  { gta: 25, fifa: 30, nfs: 0 },
  'open entries end at min(now, expiresAt) when the session has no end'
);
assert.equal(capped.truncated, true, 'a capped cloud answer is flagged');
assert.equal(report.truncated, undefined, 'complete reports carry no truncated flag');

const empty = buildEarningsReport([], { scope: 'device', now });
assert.deepEqual(
  { ...empty, generatedAt: undefined },
  {
    scope: 'device',
    generatedAt: undefined,
    currency: 'INR',
    totalPaise: 0,
    sessionCount: 0,
    paidMinutes: 0,
    rows: [],
    byStation: [],
    byGame: []
  }
);

assert.equal(formatPaise(12345), '123.45');
assert.equal(formatPaise(5000), '50.00');
assert.equal(formatPaise(5), '0.05');
assert.equal(formatPaise(0), '0.00');
assert.equal(formatPaise(-250), '-2.50');

// ---------------------------------------------------------------------------
// Razorpay payer details
// ---------------------------------------------------------------------------

const wirePayer = {
  checkout_id: 'checkout-1',
  razorpay_payment_id: 'pay_ABC123',
  name: null,
  phone: '+919876543210',
  email: 'void@razorpay.com',
  method: 'upi',
  upi_id: 'player@okaxis',
  bank: null,
  wallet: null,
  card_network: null,
  card_last4: null,
  paid_at: '2026-10-17T08:00:05.000Z'
};
assert.deepEqual(normalizePayerDetails(wirePayer), {
  checkoutId: 'checkout-1',
  razorpayPaymentId: 'pay_ABC123',
  phone: '+919876543210',
  method: 'upi',
  upiId: 'player@okaxis',
  paidAt: '2026-10-17T08:00:05.000Z'
}, 'wire payers are camelCased, nulls and the Razorpay placeholder email dropped');
assert.deepEqual(
  normalizePayerDetails({ razorpayPaymentId: 'pay_X', cardNetwork: 'Visa', cardLast4: '1234', method: 'card' }, 'checkout-9'),
  { checkoutId: 'checkout-9', razorpayPaymentId: 'pay_X', method: 'card', cardNetwork: 'Visa', cardLast4: '1234' },
  'local camelCase payers normalise too, with the entitlement checkout as fallback'
);
assert.equal(normalizePayerDetails({ checkout_id: 'checkout-1', phone: null, email: '' }), undefined, 'nothing known means no payer');
assert.equal(normalizePayerDetails({ phone: '+91' }), undefined, 'a payer needs a checkout id');
assert.equal(normalizePayerDetails(null), undefined);
assert.equal(normalizePayerDetails({ checkout_id: 'c', phone: '1', paid_at: 'not a date' }).paidAt, undefined);
assert.deepEqual(
  normalizePayerList([wirePayer, { checkout_id: 'checkout-1', phone: '+910000000000' }, 'junk', { checkout_id: 'checkout-2' }]),
  [{ checkoutId: 'checkout-1', phone: '+910000000000' }],
  'payer lists keep one entry per checkout and drop junk'
);
assert.deepEqual(normalizePayerList(undefined), []);
const payerList = [{ checkoutId: 'a', phone: '1' }];
assert.equal(upsertPayer(payerList, { checkoutId: 'a', phone: '1' }), false);
assert.equal(upsertPayer(payerList, { checkoutId: 'a', phone: '2' }), true);
assert.equal(upsertPayer(payerList, { checkoutId: 'b', phone: '3' }), true);
assert.deepEqual(payerList, [{ checkoutId: 'a', phone: '2' }, { checkoutId: 'b', phone: '3' }]);
assert.equal(paymentMethodLabel('upi'), 'UPI');
assert.equal(paymentMethodLabel('netbanking'), 'Net banking');
assert.equal(paymentMethodLabel('crypto'), 'Crypto');
assert.equal(paymentMethodLabel(undefined), '');

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

assert.deepEqual([...EARNINGS_CSV_COLUMNS], [
  'Started', 'Ended', 'Device', 'Customer', 'Phone', 'Email', 'Payment method', 'UPI ID', 'Razorpay payment ID',
  'Status', 'Plans', 'Minutes', 'Amount', 'Games', 'Payment verified', 'Checkout IDs'
]);

function parseCsv(source) {
  const records = [];
  let record = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      assert.equal(cell, '', 'quotes may only open a cell');
      quoted = true;
    } else if (char === ',') {
      record.push(cell);
      cell = '';
    } else if (char === '\r' && source[index + 1] === '\n') {
      record.push(cell);
      records.push(record);
      record = [];
      cell = '';
      index += 1;
    } else {
      assert.notEqual(char, '\n', 'bare LF outside quotes breaks RFC 4180');
      cell += char;
    }
  }
  assert.equal(quoted, false, 'unterminated quoted cell');
  assert.equal(record.length + cell.length, 0, 'CSV must end with CRLF');
  return records;
}

const csvRows = [
  row({
    id: 'session_csv_1',
    stationName: 'Counter "A", Floor 1',
    planNames: ['1 Hour', '30 Minutes'],
    checkoutIds: ['checkout-1', 'checkout-2'],
    games: [
      { gameId: 'fifa', title: 'FIFA', startedAt: '2026-10-17T08:00:00.000Z', endedAt: '2026-10-17T08:10:00.000Z' },
      { gameId: 'gta', title: 'GTA\nV', startedAt: '2026-10-17T08:10:00.000Z' },
      { gameId: 'fifa', title: 'FIFA', startedAt: '2026-10-17T08:20:00.000Z' }
    ],
    amountPaise: 15050,
    durationMinutes: 90,
    paymentVerified: true,
    payers: normalizePayerList([
      wirePayer,
      {
        checkout_id: 'checkout-2',
        razorpay_payment_id: 'pay_DEF456',
        name: '@admin',
        phone: '+919876543210',
        email: 'player@example.com',
        method: 'card',
        card_network: 'Visa',
        card_last4: '1234'
      }
    ])
  }),
  row({
    id: 'session_csv_2',
    stationName: '=HYPERLINK("http://evil.example","x")',
    startedAt: '2026-10-17T06:00:00.000Z',
    endedAt: undefined,
    status: 'interrupted',
    planNames: ['+cmd', '-2+3', '@SUM(A1)'],
    checkoutIds: [],
    games: [],
    payers: [],
    paymentVerified: false
  })
];

const deviceCsv = earningsReportToCsv(buildEarningsReport(csvRows, { scope: 'device', now }));
const deviceRecords = parseCsv(deviceCsv);
assert.deepEqual(deviceRecords[0], [
  'Started', 'Ended', 'Device', 'Customer', 'Phone', 'Email', 'Payment method', 'UPI ID', 'Razorpay payment ID',
  'Status', 'Plans', 'Minutes', 'Amount (INR)', 'Games', 'Payment verified', 'Checkout IDs'
]);
assert.equal(deviceRecords.length, 3, 'one line per session plus the header');
const [first, second] = deviceRecords.slice(1);
assert.equal(first.length, 16);
assert.equal(first[0], formatCsvDateTime('2026-10-17T08:00:00.000Z'));
assert.match(first[0], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
assert.equal(first[2], 'Counter "A", Floor 1', 'quotes and commas survive RFC 4180 quoting');
assert.ok(deviceCsv.includes('"Counter ""A"", Floor 1"'));
assert.equal(first[3], "'@admin", 'payer names are guarded against formulas');
assert.equal(first[4], "'+919876543210", 'repeated phones collapse; a leading + is neutralised');
assert.equal(first[5], 'player@example.com');
assert.equal(first[6], 'UPI; Card (Visa ****1234)');
assert.equal(first[7], 'player@okaxis');
assert.equal(first[8], 'pay_ABC123; pay_DEF456');
assert.equal(first[9], 'Completed');
assert.equal(first[10], '1 Hour; 30 Minutes');
assert.equal(first[11], '90');
assert.equal(first[12], '150.50');
assert.equal(first[13], 'FIFA; GTA\nV', 'game titles are distinct, in play order, and keep embedded newlines inside quotes');
assert.equal(first[14], '', 'payment verification is a cloud fact, blank for this device');
assert.equal(first[15], 'checkout-1; checkout-2');

assert.equal(second[1], '', 'an unfinished session has no end time');
assert.equal(second[2], `'=HYPERLINK("http://evil.example","x")`, 'formula injection is neutralised');
assert.equal(second[3], '');
assert.equal(second[9], 'Interrupted');
assert.equal(second[10], "'+cmd; -2+3; @SUM(A1)", 'only the cell start matters for the formula guard');
assert.equal(second[12], '100.00');

const allRecords = parseCsv(earningsReportToCsv(buildEarningsReport(csvRows, { scope: 'all', now })));
assert.equal(allRecords[1][14], 'Yes');
assert.equal(allRecords[2][14], 'No');
assert.equal(parseCsv(earningsReportToCsv(empty)).length, 1, 'an empty report exports just the header');

// ---------------------------------------------------------------------------
// PIN hashes (Node main process <-> Deno stationFleet)
// ---------------------------------------------------------------------------

assert.equal(isValidPin('1832'), true);
assert.equal(isValidPin('123456789012'), true);
assert.equal(isValidPin('123'), false);
assert.equal(isValidPin('1234567890123'), false);
assert.equal(isValidPin('12a4'), false);
assert.equal(isValidPin(1832), false);

const nodeHash = hashPin('4321');
assert.match(nodeHash, new RegExp(`^pbkdf2-sha256\\$${PIN_HASH_ITERATIONS}\\$[0-9a-f]{32}\\$[0-9a-f]{64}$`));
assert.notEqual(hashPin('4321'), nodeHash, 'every hash gets a fresh salt');
assert.equal(verifyPinHash('4321', nodeHash), true);
assert.equal(verifyPinHash('4322', nodeHash), false);
assert.equal(verifyPinHash('', nodeHash), false);
const [prefix, iterations, salt, hash] = nodeHash.split('$');
for (const malformed of [
  '',
  'garbage',
  `sha1$${iterations}$${salt}$${hash}`,
  `${prefix}$${iterations}$${salt}`,
  `${prefix}$${iterations}$${salt}$${hash}$extra`,
  `${prefix}$0$${salt}$${hash}`,
  `${prefix}$99999999$${salt}$${hash}`,
  `${prefix}$abc$${salt}$${hash}`,
  `${prefix}$${iterations}$zz${salt.slice(2)}$${hash}`,
  `${prefix}$${iterations}$${salt}$${hash.slice(1)}`,
  `${prefix}$${iterations}$${salt}$${hash.slice(0, 16)}`
]) {
  assert.equal(verifyPinHash('4321', malformed), false, `malformed hash must not match: ${malformed}`);
}
assert.equal(verifyPinHash('4321', null), false);

const denoPinPath = fileURLToPath(new URL('../supabase/functions/stationFleet/pin.ts', import.meta.url));
let crossChecked = false;
if (existsSync(denoPinPath)) {
  const deno = await import(new URL('../supabase/functions/stationFleet/pin.ts', import.meta.url).href);
  const denoHash = await deno.hashPin('567890');
  assert.equal(verifyPinHash('567890', denoHash), true, 'a hash made by the edge function verifies in the main process');
  assert.equal(verifyPinHash('567891', denoHash), false);
  assert.equal(await deno.verifyPin('4321', nodeHash), true, 'a hash made by the main process verifies in the edge function');
  assert.equal(await deno.verifyPin('4320', nodeHash), false);
  crossChecked = true;
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

const [mainSource, databaseSource, preloadSource, fleetSource, paymentSource] = await Promise.all([
  readFile(new URL('../src/main/main.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/database.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/preload.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/fleetService.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/paymentService.ts', import.meta.url), 'utf8')
]);

const contractChannels = [
  'accounts:getEarnings', 'accounts:exportCsv', 'owner:getSession', 'owner:unlock', 'owner:lock', 'owner:changePin',
  'fleet:listStations', 'fleet:getStation', 'fleet:updateStation', 'fleet:removeStation', 'fleet:setGameEnabled',
  'fleet:listModerators', 'fleet:saveModerator', 'fleet:deleteModerator', 'fleet:getSyncStatus', 'fleet:syncNow',
  'fleet:rejoin'
];
const preloadChannels = [...preloadSource.matchAll(/ipcRenderer\.invoke\('((?:accounts|owner|fleet):[A-Za-z]+)'/g)]
  .map((match) => match[1]);
for (const channel of new Set([...contractChannels, ...preloadChannels])) {
  assert.ok(mainSource.includes(`ipcMain.handle('${channel}'`), `main.ts must handle ${channel}`);
}
// B7: everything but owner:lock answers only inside the Control Room.
function handlerSource(channel) {
  const start = mainSource.indexOf(`ipcMain.handle('${channel}'`);
  const next = mainSource.indexOf('ipcMain.handle(', start + 1);
  return mainSource.slice(start, next < 0 ? undefined : next);
}
for (const channel of contractChannels.filter((name) => name !== 'owner:lock')) {
  assert.match(
    handlerSource(channel),
    /controlRoomOnly\(|inControlRoom\(\)|requireControlRoom\(\)/,
    `${channel} must require the Control Room`
  );
}
assert.doesNotMatch(handlerSource('owner:lock'), /controlRoomOnly|inControlRoom|requireControlRoom/, 'locking always works');
assert.match(mainSource, /function inControlRoom\(\): boolean \{\s*return kioskInput\.currentMode === 'admin';/);
assert.match(mainSource, /error: CONTROL_ROOM_REQUIRED/);
assert.match(mainSource, /const CONTROL_ROOM_REQUIRED = 'Open the Control Room first\.'/);
assert.match(handlerSource('fleet:getSyncStatus'), /requireControlRoom\(\)/, 'sync status throws outside the Control Room');
assert.match(handlerSource('fleet:syncNow'), /requireControlRoom\(\)/);
// B8: the unlock role is returned, reset in customer mode, and protects the admin PIN.
assert.match(handlerSource('kiosk:unlockAdminActions'), /return role \? \{ ok, role \} : \{ ok \};/);
assert.match(mainSource, /if \(mode === 'customer'\) \{[\s\S]*?controlRoomRole = null;/, 'customer mode forgets the unlock role');
assert.match(
  handlerSource('settings:update'),
  /controlRoomRole === 'moderator' \? \{ \.\.\.settings, adminPin: store\.getSettings\(\)\.adminPin \} : settings/,
  'a moderator cannot change the admin PIN'
);
// B4: consume binds the checkout to this PC.
assert.match(mainSource, /\}, \(\) => store\.getCurrentDevice\(\)\.id\);/);
assert.match(mainSource, /sendToRenderer\('fleet:localDataChanged', change\)/);
assert.match(mainSource, /new FleetService\(/);
assert.match(mainSource, /fleetService\.start\(\)/);
assert.match(mainSource, /dialog\.showSaveDialog\(window, options\)/);
assert.match(mainSource, /earningsReportToCsv\(report\.data\)/);
assert.match(mainSource, /nxgs-earnings-\$\{query\?\.scope === 'all' \? 'all-devices'/);
assert.match(mainSource, /Control Room unlocked by moderator/);
assert.match(mainSource, /store\.identifyPin\(pin\)/);
assert.match(mainSource, /if \(mode === 'customer'\) \{[\s\S]*?fleetService\?\.clearOwnerSession/, 'customer mode ends the main admin session');
assert.match(mainSource, /store\.recordSessionGameStart\(game\)/);
assert.match(mainSource, /store\.recordSessionGameEnd\(/);
assert.match(mainSource, /onActiveGameChanged:[\s\S]*?broadcastActiveGame\(\);\s*recordSessionGamePlays\(\);/);
assert.match(mainSource, /store\.recordPaidSession\(result\.entitlement, state\.expiresAt, extending, trackedGamesForSession\(\)\)/);
for (const reason of ['paid session recorded', 'paid session finished', 'device edited', 'game saved', 'game deleted', 'game played']) {
  assert.ok(mainSource.includes(`requestFleetSync('${reason}')`), `local change "${reason}" must trigger a sync`);
}

assert.match(databaseSource, /const SCHEMA_VERSION = 7/);
assert.match(databaseSource, /identifyPin\(pin: string\): PinIdentity/);
assert.match(databaseSource, /verifyPin\(pin: string\): boolean \{\s*return this\.identifyPin\(pin\)\.ok;/);
assert.match(databaseSource, /verifyPinHash\(pin, item\.pinHash\)/);
assert.match(databaseSource, /async recordSessionGameStart/);
assert.match(databaseSource, /async recordSessionGameEnd/);
assert.match(databaseSource, /entry\.endedAt \?\?= timestamp/, 'finishing a session closes its open games');
assert.match(databaseSource, /games: normalizeSessionGames\(session\.games/);
assert.match(databaseSource, /payers: normalizePayerList\(session\.payers\)/);
assert.match(databaseSource, /cloud: normalizeCloudState\(parsed\.cloud\)/);
assert.match(databaseSource, /listEarningsRows/);
assert.match(databaseSource, /async markSessionsSynced/);
assert.match(databaseSource, /session\.updatedAt !== entry\.updatedAt/, 'sessions changed after sending stay pending');
assert.match(databaseSource, /async reconcileCloudDevice/);
assert.match(databaseSource, /device\.updatedAt === sentUpdatedAt/, 'cloud values are adopted only when the device did not change in flight');
assert.match(databaseSource, /async applyCloudDeviceFields/);
assert.doesNotMatch(databaseSource, /laterIso|ownerUpdatedAt/, 'no clock comparisons in the station rules');
assert.match(databaseSource, /if \(!isValidPin\(pin\) \|\| data\.cloud\.removedByOwner\) return \{ ok: false \};/, 'removed PCs ignore moderator PINs');
assert.match(databaseSource, /expiresAt: session\.expiresAt,/);
assert.match(databaseSource, /async applyGameOverrides/);
assert.match(databaseSource, /async applySessionPayers/);
assert.match(databaseSource, /if \(payer\) upsertPayer\(active\.payers, payer\)/);

assert.match(fleetSource, /\/stationFleet`/);
assert.match(fleetSource, /apikey: config\.publishableKey/);
assert.match(fleetSource, /AbortSignal\.timeout\(timeoutMs\)/);
assert.match(fleetSource, /const REQUEST_TIMEOUT_MS = 20_000/);
assert.match(fleetSource, /const PAYER_LOOKUP_TIMEOUT_MS = 8_000/);
assert.match(fleetSource, /'session_payers'/);
assert.match(fleetSource, /payers: normalizePayerList\(wire\.payers\)/, 'all-device rows map wire payers');
assert.match(fleetSource, /buildEarningsReport\(list\(response\.rows\)\.flatMap\(toEarningsRow\), \{\s*scope: 'all'/);
assert.match(fleetSource, /if \(cloud\.removedByOwner\) return;/, 'sync pauses after removal');
assert.doesNotMatch(fleetSource, /logLine\([^)]*(station_token|owner_token|stationToken)\b[^)]*\)/, 'tokens never reach the log');
assert.match(paymentSource, /normalizePayerDetails\(payer, stringValue\(entitlement\.checkoutId\)\)/);
assert.match(paymentSource, /readBackendConfig\(\)/);
assert.match(paymentSource, /\{ \.\.\.this\.accessBody\(access\), \.\.\.this\.stationBody\(\) \}/);
assert.match(paymentSource, /\{ station_id: stationId \}/);

// B2/B3/B5/B6/B7/B9 in FleetService.
assert.match(fleetSource, /dirty: device\.syncStatus !== 'synced'/);
assert.doesNotMatch(fleetSource, /Date\.parse\([^)]*owner_updated_at/, 'no ordering decision compares the station clock with the cloud clock');
assert.match(fleetSource, /pendingOwnerChange: typeof wire\.owner_enabled === 'boolean'/);
assert.match(fleetSource, /\[\{ gameId, enabled: wire\.enabled \}\]/, 'every received override applies');
assert.match(fleetSource, /token = randomBytes\(32\)\.toString\('hex'\);\s*await this\.store\.updateCloudState\(\{ stationToken: token, registeredAt: undefined \}\);[\s\S]*?this\.invoke\('register'/, 'the station key is stored before register');
assert.match(fleetSource, /station_token: token,/);
assert.match(fleetSource, /needsRejoin: cloud\.removedByOwner \|\| this\.registrationBlocked/);
assert.match(fleetSource, /await this\.register\(owner\.token, true\)/, 'rejoin re-keys with the owner token');
assert.match(fleetSource, /truncated: response\.truncated === true/);
assert.match(fleetSource, /\.\.\.\(expiresAt \? \{ expiresAt \} : \{\}\)/);
assert.match(fleetSource, /if \(generation !== this\.ownerGeneration\) \{[\s\S]*?owner_logout[\s\S]*?code: 'owner_pin_required', error: MESSAGES\.controlRoomClosed/);
assert.match(fleetSource, /clearOwnerSession\(reason: string\): void \{\s*this\.ownerGeneration \+= 1;/);
assert.match(fleetSource, /if \(cloud\.removedByOwner \|\| cloud\.stationToken !== stationToken\) \{/, 'late sync answers are ignored after removal or re-key');
assert.doesNotMatch(paymentSource, /function parseIni|function readClientConfig/);

console.log(
  `Accounts verified: earnings aggregation, payer mapping, RFC 4180 CSV with formula guard, PIN hashes${crossChecked ? ' (cross-checked with stationFleet/pin.ts)' : ' (stationFleet/pin.ts not present; cross-check skipped)'}, IPC channels, and DataStore sync wiring.`
);
