import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildEarningsReportForQuery,
  EARNINGS_SORT_LABELS,
  EARNINGS_SORTS,
  EARNINGS_STATUSES,
  earningsFacets,
  earningsRowMatchesSearch,
  earningsRowsInScope,
  filterEarningsRows,
  paymentMethodFilterLabel,
  sessionPaymentMethods,
  sortEarningsRows,
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
    byGame: [],
    facets: { games: [], paymentMethods: [], statuses: [], sessionCount: 0 },
    sort: 'newest'
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
// Earnings filters, search, sorts and facets (0.26.0)
// ---------------------------------------------------------------------------

const filterRows = [
  row({
    id: 'f1', stationId: 'device_a', stationName: 'Front PC', status: 'completed',
    startedAt: '2026-10-10T10:00:00.000Z', endedAt: '2026-10-10T11:00:00.000Z', amountPaise: 10000, durationMinutes: 60,
    planNames: ['1 Hour'], checkoutIds: ['chk-a1'], paymentVerified: true,
    games: [{ gameId: 'fifa', title: 'FIFA 25', startedAt: '2026-10-10T10:05:00.000Z' }],
    payers: [{ checkoutId: 'chk-a1', name: 'Ravi', phone: '+919876543210', email: 'Player@Example.com', method: 'upi', upiId: 'player@okaxis', razorpayPaymentId: 'pay_A1' }]
  }),
  row({
    id: 'f2', stationId: 'device_b', stationName: 'Back PC', status: 'expired',
    startedAt: '2026-10-11T10:00:00.000Z', endedAt: '2026-10-11T10:30:00.000Z', amountPaise: 5000, durationMinutes: 30,
    planNames: ['30 Minutes'], checkoutIds: ['chk-b1', 'chk-b2'], paymentVerified: false,
    games: [
      { gameId: 'gta', title: 'GTA V', startedAt: '2026-10-11T10:01:00.000Z' },
      { gameId: 'fifa', title: 'FIFA 26', startedAt: '2026-10-11T10:10:00.000Z' }
    ],
    payers: [{ checkoutId: 'chk-b1', phone: '+918888877777', method: 'card', cardNetwork: 'Visa', cardLast4: '4242' }]
  }),
  row({
    id: 'f3', stationId: 'device_c', stationName: 'Corner PC', status: 'active',
    startedAt: '2026-10-12T10:00:00.000Z', endedAt: undefined, amountPaise: 15000, durationMinutes: 90,
    planNames: ['1 Hour 30 Minutes'], checkoutIds: ['chk-c1'], games: [], payers: []
  }),
  row({
    id: 'f4', stationId: 'device_a', stationName: 'Front PC', status: 'interrupted',
    startedAt: '2026-10-09T10:00:00.000Z', endedAt: '2026-10-09T10:20:00.000Z', amountPaise: 10000, durationMinutes: 60,
    planNames: ['1 Hour'], checkoutIds: ['chk-a2'], paymentVerified: true,
    games: [{ gameId: 'nfs', title: 'NFS', startedAt: '2026-10-09T10:01:00.000Z' }],
    // A payer without a method counts as "unknown".
    payers: [{ checkoutId: 'chk-a2', razorpayPaymentId: 'pay_A2' }]
  }),
  row({
    id: 'f5', stationId: 'device_b', stationName: 'Back PC', status: 'completed',
    // Same start as f2: ties sort by id, newest-first puts f5 before f2.
    startedAt: '2026-10-11T10:00:00.000Z', endedAt: '2026-10-11T10:30:00.000Z', amountPaise: 5000, durationMinutes: 30,
    planNames: ['30 Minutes'], checkoutIds: ['chk-b3'], paymentVerified: true,
    games: [{ gameId: 'gta', title: 'GTA V', startedAt: '2026-10-11T10:02:00.000Z' }],
    payers: [{ checkoutId: 'chk-b3', phone: '+91 77777 66666', method: 'UPI' }]
  })
];
const filterSnapshot = JSON.stringify(filterRows);
const ids = (list) => list.map((entry) => entry.id);
const filtered = (query) => ids(filterEarningsRows(filterRows, query));

// Period and devices.
assert.deepEqual(ids(earningsRowsInScope(filterRows, { from: '2026-10-10T00:00:00.000Z', to: '2026-10-12T00:00:00.000Z' })), ['f1', 'f2', 'f5']);
assert.deepEqual(ids(earningsRowsInScope(filterRows, { stationIds: ['device_a'] })), ['f1', 'f4']);
assert.deepEqual(ids(earningsRowsInScope(filterRows, { stationId: 'device_c', stationIds: ['device_b'] })), ['f2', 'f3', 'f5'], 'stationId merges into stationIds');
assert.deepEqual(filtered({}), ['f1', 'f2', 'f3', 'f4', 'f5'], 'no filters keeps every row in order');
// Games: any entry with a selected game.
assert.deepEqual(filtered({ gameIds: ['fifa'] }), ['f1', 'f2']);
assert.deepEqual(filtered({ gameIds: ['nfs', 'gta'] }), ['f2', 'f4', 'f5']);
// Payment methods: any payer's lowercased method; unknown = no payer with a method.
assert.deepEqual(sessionPaymentMethods(filterRows[4]), ['upi']);
assert.deepEqual(sessionPaymentMethods(filterRows[3]), ['unknown']);
assert.deepEqual(filtered({ paymentMethods: ['unknown'] }), ['f3', 'f4']);
assert.deepEqual(filtered({ paymentMethods: ['upi'] }), ['f1', 'f5']);
assert.deepEqual(filtered({ paymentMethods: ['UPI'] }), ['f1', 'f5']);
assert.deepEqual(filtered({ paymentMethods: ['card', 'unknown'] }), ['f2', 'f3', 'f4']);
// Raw statuses and verified payments.
assert.deepEqual(filtered({ statuses: ['active'] }), ['f3']);
assert.deepEqual(filtered({ statuses: ['completed', 'expired'] }), ['f1', 'f2', 'f5']);
assert.deepEqual(filtered({ verifiedOnly: true }), ['f1', 'f4', 'f5']);
assert.deepEqual(filtered({ verifiedOnly: false }), ['f1', 'f2', 'f3', 'f4', 'f5']);
// Search: trimmed, case-insensitive substring over payer, checkout, plan, device and game fields.
for (const [search, expected] of [
  ['9876543210', ['f1']],
  ['+91 98765 43210', ['f1']],
  ['98765', ['f1']],
  ['+91-98765-43210', ['f1']],
  ['7777766666', ['f5']],
  ['player@example.COM', ['f1']],
  ['  Ravi  ', ['f1']],
  ['okaxis', ['f1']],
  ['PAY_a2', ['f4']],
  ['chk-b2', ['f2']],
  ['30 minutes', ['f2', 'f3', 'f5']],
  ['1 hour 30', ['f3']],
  ['corner', ['f3']],
  ['gta', ['f2', 'f5']],
  ['4242', []],
  ['nobody', []],
  ['   ', ['f1', 'f2', 'f3', 'f4', 'f5']]
]) {
  assert.deepEqual(filtered({ search }), expected, `search "${search}"`);
}
assert.equal(earningsRowMatchesSearch(filterRows[0], '9876 543'), true, 'a phone in groups still matches by digits');
assert.equal(earningsRowMatchesSearch(filterRows[0], '+91 9'), false, 'fewer than 4 digits only match as text');
// Every filter at once.
assert.deepEqual(filtered({ stationIds: ['device_a', 'device_b'], paymentMethods: ['upi'], statuses: ['completed'], search: 'front' }), ['f1']);
assert.equal(JSON.stringify(filterRows), filterSnapshot, 'filters never mutate rows');

// Sorts.
assert.deepEqual([...EARNINGS_SORTS], ['newest', 'oldest', 'amount_high', 'amount_low', 'longest']);
assert.equal(EARNINGS_SORT_LABELS.amount_high, 'Highest amount');
assert.deepEqual(ids(sortEarningsRows(filterRows, 'newest')), ['f3', 'f5', 'f2', 'f1', 'f4']);
assert.deepEqual(ids(sortEarningsRows(filterRows)), ['f3', 'f5', 'f2', 'f1', 'f4'], 'newest is the default');
assert.deepEqual(ids(sortEarningsRows(filterRows, 'oldest')), ['f4', 'f1', 'f2', 'f5', 'f3']);
assert.deepEqual(ids(sortEarningsRows(filterRows, 'amount_high')), ['f3', 'f1', 'f4', 'f5', 'f2'], 'amount ties fall back to newest');
assert.deepEqual(ids(sortEarningsRows(filterRows, 'amount_low')), ['f5', 'f2', 'f1', 'f4', 'f3']);
assert.deepEqual(ids(sortEarningsRows(filterRows, 'longest')), ['f3', 'f1', 'f4', 'f5', 'f2']);
assert.equal(JSON.stringify(filterRows), filterSnapshot, 'sorting copies');

// Facets: games by title (latest name), methods with unknown last, statuses in chip order.
assert.deepEqual([...EARNINGS_STATUSES], ['completed', 'expired', 'interrupted', 'active']);
assert.deepEqual(earningsFacets(filterRows), {
  games: [{ gameId: 'fifa', title: 'FIFA 26' }, { gameId: 'gta', title: 'GTA V' }, { gameId: 'nfs', title: 'NFS' }],
  paymentMethods: ['card', 'upi', 'unknown'],
  statuses: ['completed', 'expired', 'interrupted', 'active'],
  sessionCount: 5
});
assert.deepEqual(earningsFacets([]), { games: [], paymentMethods: [], statuses: [], sessionCount: 0 });
assert.equal(paymentMethodFilterLabel('unknown'), 'No details');
assert.equal(paymentMethodFilterLabel('netbanking'), 'Net banking');

// One path: facets from period + devices, then filters, then sort; the CSV follows it.
const filteredReport = buildEarningsReportForQuery(filterRows, {
  scope: 'all',
  stationIds: ['device_a', 'device_b'],
  paymentMethods: ['upi'],
  sort: 'amount_low'
}, { now });
assert.deepEqual(ids(filteredReport.rows), ['f5', 'f1']);
assert.equal(filteredReport.sort, 'amount_low');
assert.equal(filteredReport.totalPaise, 15000, 'totals cover only the filtered sessions');
assert.equal(filteredReport.sessionCount, 2);
assert.deepEqual(filteredReport.byStation.map((station) => station.stationId), ['device_a', 'device_b']);
assert.deepEqual(filteredReport.facets, {
  games: [{ gameId: 'fifa', title: 'FIFA 26' }, { gameId: 'gta', title: 'GTA V' }, { gameId: 'nfs', title: 'NFS' }],
  paymentMethods: ['card', 'upi', 'unknown'],
  statuses: ['completed', 'expired', 'interrupted'],
  sessionCount: 4
}, 'facets ignore the method filter but respect the device filter');
const filteredCsv = parseCsv(earningsReportToCsv(filteredReport));
assert.deepEqual(filteredCsv.slice(1).map((record) => record[15]), ['chk-b3', 'chk-a1'], 'the CSV holds exactly the filtered rows, in the chosen order');
const defaultReport = buildEarningsReport(filterRows, { scope: 'device', now, sort: 'bogus' });
assert.equal(defaultReport.sort, 'newest', 'an unknown sort falls back to newest');
assert.deepEqual(defaultReport.facets, earningsFacets(filterRows), 'facets default to the given rows');

// ---------------------------------------------------------------------------
// FleetService.getEarnings: validation and multi-station fan-out (fake fetch)
// ---------------------------------------------------------------------------

// Load the real FleetService with an Electron stub and extensionless .ts imports.
const electronStub = [
  'export const app = { getPath: () => globalThis.__nxgsTestDir, getAppPath: () => globalThis.__nxgsTestDir, getVersion: () => "0.0.0-test" };',
  'export const net = { fetch: (...args) => globalThis.__nxgsFetch(...args) };'
].join('\n');
const hooks = `
const electron = ${JSON.stringify(`data:text/javascript,${encodeURIComponent(electronStub)}`)};
export async function resolve(specifier, context, next) {
  if (specifier === 'electron') return { url: electron, shortCircuit: true };
  if (/^\\.\\.?\\//.test(specifier) && !/\\.[cm]?[jt]s$/.test(specifier) && context.parentURL?.endsWith('.ts')) {
    try { return await next(specifier + '.ts', context); } catch {}
  }
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);
const testDir = await mkdtemp(join(tmpdir(), 'nxgs-verify-accounts-'));
globalThis.__nxgsTestDir = testDir;
process.resourcesPath ??= testDir;
process.env.NXGS_RENTAL_FUNCTION_BASE_URL = 'https://fleet.test/functions/v1';
process.env.NXGS_SUPABASE_ANON_KEY = 'test-key';
const { FleetService } = await import('../src/main/fleetService.ts');

const toWire = (entry) => ({
  session_id: entry.id,
  station_id: entry.stationId,
  station_name: entry.stationName,
  status: entry.status,
  started_at: entry.startedAt,
  ended_at: entry.endedAt ?? null,
  expires_at: entry.expiresAt ?? null,
  duration_minutes: entry.durationMinutes,
  amount_paise: entry.amountPaise,
  currency: entry.currency,
  plan_ids: [],
  plan_names: entry.planNames,
  checkout_ids: entry.checkoutIds,
  games: entry.games.map((game) => ({ game_id: game.gameId, title: game.title, started_at: game.startedAt, ended_at: game.endedAt ?? null })),
  payment_verified: entry.paymentVerified === true,
  payers: entry.payers.map((payer) => ({
    checkout_id: payer.checkoutId, name: payer.name ?? null, phone: payer.phone ?? null, email: payer.email ?? null,
    method: payer.method ?? null, upi_id: payer.upiId ?? null, razorpay_payment_id: payer.razorpayPaymentId ?? null
  }))
});
const OWNER_TOKEN = 'a'.repeat(64);
const fetchLog = [];
let inFlight = 0;
let maxInFlight = 0;
globalThis.__nxgsFetch = async (url, init) => {
  assert.equal(url, 'https://fleet.test/functions/v1/stationFleet');
  assert.ok(init.signal, 'every request has a timeout');
  const body = JSON.parse(init.body);
  fetchLog.push(body);
  const json = (status, value) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  if (body.action === 'owner_login') return json(200, { owner_token: OWNER_TOKEN, expires_at: '2026-10-18T12:00:00.000Z' });
  if (body.action === 'owner_logout') return json(200, { ok: true });
  assert.equal(body.action, 'earnings');
  assert.equal(body.owner_token, OWNER_TOKEN);
  inFlight += 1;
  maxInFlight = Math.max(maxInFlight, inFlight);
  await new Promise((resolve) => setTimeout(resolve, 15));
  inFlight -= 1;
  if (body.station_id === 'device_fail') return json(500, { error: true, message: 'request_failed' });
  const stationRows = filterRows.filter((entry) => !body.station_id || entry.stationId === body.station_id).map(toWire);
  // Station b answers its rows twice: merged rows are deduped by station + session.
  if (body.station_id === 'device_b') stationRows.push(toWire(filterRows[1]));
  return json(200, { rows: stationRows, truncated: body.station_id === 'device_c' });
};
const fakeStore = {
  getCloudState: () => ({ removedByOwner: false, moderators: [] }),
  getCurrentDevice: () => ({ id: 'device_local', name: 'Local PC' }),
  listEarningsRows: () => structuredClone(filterRows),
  listCheckoutIdsMissingPayers: () => []
};
const fleet = new FleetService({ store: fakeStore, appVersion: '0.26.0', onLocalDataChanged: () => undefined });
assert.equal((await fleet.getEarnings({ scope: 'all' })).code, 'owner_pin_required');
assert.equal((await fleet.unlockOwner('1832')).ok, true);
const earningsCalls = () => fetchLog.filter((entry) => entry.action === 'earnings');

// Six stations: one request each, never more than four at once, rows merged and deduped.
let before = earningsCalls().length;
const fanOut = await fleet.getEarnings({
  scope: 'all',
  stationIds: ['device_a', 'device_b', 'device_c', 'device_d', 'device_e', 'device_f']
});
assert.equal(fanOut.ok, true, JSON.stringify(fanOut));
const fanOutCalls = earningsCalls().slice(before);
assert.deepEqual(fanOutCalls.map((entry) => entry.station_id).sort(), ['device_a', 'device_b', 'device_c', 'device_d', 'device_e', 'device_f']);
assert.equal(maxInFlight, 4, 'at most four station requests run at once');
assert.deepEqual(ids(fanOut.data.rows), ['f3', 'f5', 'f2', 'f1', 'f4'], 'merged, deduped and sorted newest first');
assert.equal(fanOut.data.truncated, true, 'truncated if any station answer was');
assert.equal(fanOut.data.facets.sessionCount, 5);

// The older stationId merges into stationIds.
before = earningsCalls().length;
const merged = await fleet.getEarnings({ scope: 'all', stationId: 'device_a', stationIds: ['device_a', 'device_b'] });
assert.deepEqual(earningsCalls().slice(before).map((entry) => entry.station_id).sort(), ['device_a', 'device_b']);
assert.deepEqual(ids(merged.data.rows), ['f5', 'f2', 'f1', 'f4']);
assert.equal(merged.data.truncated, undefined);

// No devices chosen: one request for every station.
before = earningsCalls().length;
const everyStation = await fleet.getEarnings({ scope: 'all', from: '2026-10-10T00:00:00.000Z' });
const everyCall = earningsCalls().slice(before);
assert.equal(everyCall.length, 1);
assert.equal(everyCall[0].station_id, undefined);
assert.equal(everyCall[0].from, '2026-10-10T00:00:00.000Z');
assert.deepEqual(ids(everyStation.data.rows), ['f3', 'f5', 'f2', 'f1'], 'the period applies to merged rows too');

// Filters, sort and facets after the merge.
const combined = await fleet.getEarnings({
  scope: 'all', stationIds: ['device_a', 'device_b'], statuses: ['completed'], verifiedOnly: true, search: ' +91 77777 ', sort: 'oldest'
});
assert.deepEqual(ids(combined.data.rows), ['f5']);
assert.equal(combined.data.sort, 'oldest');
assert.equal(combined.data.facets.sessionCount, 4);

// One failed station fails the report.
const failedFanOut = await fleet.getEarnings({ scope: 'all', stationIds: ['device_a', 'device_fail'] });
assert.equal(failedFanOut.ok, false);
assert.equal(failedFanOut.code, 'failed');

// Invalid filters never reach the cloud.
before = fetchLog.length;
for (const [query, label] of [
  [{ scope: 'all', stationIds: ['bad id!'] }, 'station id pattern'],
  [{ scope: 'all', stationId: 'x' }, 'short station id'],
  [{ scope: 'all', stationIds: Array.from({ length: 201 }, (_, index) => `device_${index}`) }, 'more than 200 stations'],
  [{ scope: 'all', stationIds: 'device_a' }, 'stationIds not a list'],
  [{ scope: 'device', gameIds: [42] }, 'game id type'],
  [{ scope: 'device', gameIds: ['bad\u0000id'] }, 'game id control character'],
  [{ scope: 'device', paymentMethods: ['up i'] }, 'payment method pattern'],
  [{ scope: 'device', statuses: ['playing'] }, 'unknown status'],
  [{ scope: 'device', sort: 'random' }, 'unknown sort'],
  [{ scope: 'device', search: 'x'.repeat(101) }, 'search too long'],
  [{ scope: 'device', search: 42 }, 'search type'],
  [{ scope: 'all', verifiedOnly: 'yes' }, 'verifiedOnly type'],
  [{ scope: 'device', from: 'not a date' }, 'bad date']
]) {
  const result = await fleet.getEarnings(query);
  assert.equal(result.code, 'invalid_input', label);
  assert.ok(result.error, label);
}
assert.equal(fetchLog.length, before, 'validation happens before any request');
assert.equal((await fleet.getEarnings({ scope: 'device', search: 'x'.repeat(100) })).ok, true, '100 characters is allowed');

// This device: devices and verified-only do not apply; the same filters and sort do.
const local = await fleet.getEarnings({ scope: 'device', stationIds: ['device_x'], verifiedOnly: true, search: 'pc', sort: 'amount_high' });
assert.equal(local.ok, true, JSON.stringify(local));
assert.deepEqual(ids(local.data.rows), ['f3', 'f1', 'f4', 'f5', 'f2']);
assert.equal(local.data.scope, 'device');
const localGames = await fleet.getEarnings({ scope: 'device', gameIds: ['gta'] });
assert.deepEqual(ids(localGames.data.rows), ['f5', 'f2']);
assert.equal(localGames.data.facets.sessionCount, 5);
fleet.stop();

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
assert.match(fleetSource, /list\(response\.rows\)\.flatMap\(toEarningsRow\)/);
assert.match(fleetSource, /return buildEarningsReportForQuery\(\[\.\.\.rows\.values\(\)\], query, \{/, 'all devices go through the same filter path');
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
assert.match(fleetSource, /truncated: responses\.some\(\(response\) => response\.truncated === true\)/);
assert.match(fleetSource, /const EARNINGS_FAN_OUT = 4;/);
assert.match(fleetSource, /buildEarningsReportForQuery\(this\.store\.listEarningsRows\(range\), query\)/, 'this device goes through the same filter path');
assert.match(mainSource, /const report = await requireFleetService\(\)\.getEarnings\(query\);/, 'the CSV export goes through getEarnings');
assert.match(fleetSource, /\.\.\.\(expiresAt \? \{ expiresAt \} : \{\}\)/);
assert.match(fleetSource, /if \(generation !== this\.ownerGeneration\) \{[\s\S]*?owner_logout[\s\S]*?code: 'owner_pin_required', error: MESSAGES\.controlRoomClosed/);
assert.match(fleetSource, /clearOwnerSession\(reason: string\): void \{\s*this\.ownerGeneration \+= 1;/);
assert.match(fleetSource, /if \(cloud\.removedByOwner \|\| cloud\.stationToken !== stationToken\) \{/, 'late sync answers are ignored after removal or re-key');
assert.doesNotMatch(paymentSource, /function parseIni|function readClientConfig/);

console.log(
  `Accounts verified: earnings aggregation, filters/search/sorts/facets, multi-station fan-out, payer mapping, RFC 4180 CSV with formula guard, PIN hashes${crossChecked ? ' (cross-checked with stationFleet/pin.ts)' : ' (stationFleet/pin.ts not present; cross-check skipped)'}, IPC channels, and DataStore sync wiring.`
);
