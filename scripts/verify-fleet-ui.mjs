import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readRendererStyles } from './lib/rendererSources.mjs';
import {
  accountsFilterCount,
  buildEarningsQuery,
  clearAccountsFilters,
  DEFAULT_ACCOUNTS_VIEW,
  filterFleetStations,
  groupStationsByStore,
  withAccountsScope,
  durationLabel,
  formatPaise,
  isUnfinishedSession,
  paymentMethodDetail,
  paymentMethodLabel,
  phoneLabel,
  PIN_PATTERN,
  summarizeSessionGames
} from '../src/renderer/components/admin/fleetFormat.ts';

// Control Room Accounts (earnings) and All Devices (Device Management) UI.
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [admin, accounts, filters, popover, ownerGate, fleetPanel, stationPanel, moderators, syncCard, deviceManager, app, settingsPanels, styles] = await Promise.all([
  read('../src/renderer/components/admin/AdminScreen.tsx'),
  read('../src/renderer/components/admin/AccountsPanel.tsx'),
  read('../src/renderer/components/admin/AccountsFilters.tsx'),
  read('../src/renderer/components/admin/FilterPopover.tsx'),
  read('../src/renderer/components/admin/useOwnerSession.tsx'),
  read('../src/renderer/components/admin/DeviceManagementPanel.tsx'),
  read('../src/renderer/components/admin/FleetStationPanel.tsx'),
  read('../src/renderer/components/admin/ModeratorEditor.tsx'),
  read('../src/renderer/components/admin/FleetSyncCard.tsx'),
  read('../src/renderer/components/DeviceManager.tsx'),
  read('../src/renderer/App.tsx'),
  read('../src/renderer/components/admin/SettingsPanels.tsx'),
  readRendererStyles()
]);
const fleet = [fleetPanel, stationPanel, moderators].join('\n');

// Accounts and All devices close the sidebar (Business group); the tab cycle follows the sidebar order.
assert.match(
  admin,
  /const ADMIN_TABS: AdminTab\[\] = \['games', 'scan', 'sessions', 'plans', 'device', 'branding', 'kiosk', 'updates', 'accounts', 'fleet'\]/,
  'Accounts and All devices must follow the station sections (Device included) in the tab cycle'
);
assert.match(admin, /label="Details"[\s\S]*label="Business">[\s\S]*label="Accounts"[\s\S]*label="All devices"/, 'sidebar must list Accounts then All devices, in the Business group after Details');
assert.match(admin, /accounts: \{\s*title: 'Accounts'/);
assert.match(admin, /fleet: \{\s*title: 'All devices'/);
assert.match(admin, /tab === 'accounts' && \(\s*<AccountsPanel/);
assert.match(admin, /tab === 'fleet' && <DeviceManagementPanel/);
assert.match(admin, /useEffect\(\(\) => \(\) => \{\s*void window\.nxgs\.lockOwner\(\)/, 'closing the Control Room must lock the main admin');
assert.match(admin, /ownerView \? \(\s*owner\.unlocked && <OwnerSessionChip/, 'main admin pages must not claim to apply to this station only');
assert.match(admin, /\{owner\.dialog\}/, 'the main admin PIN dialog must render inside the Control Room');
assert.match(admin, /closest\(LOCAL_KEYS_SELECTOR\)\) return;/, 'arrow keys inside the earnings table must not switch sections');

// Main admin PIN gate.
assert.match(ownerGate, /window\.nxgs\.getOwnerSession\(\)/);
assert.match(ownerGate, /window\.nxgs\.unlockOwner\(pin\)/);
assert.match(ownerGate, /title="Main admin PIN"/);
assert.match(ownerGate, /if \(result\.code === 'invalid_owner_pin'\) return false;/, 'a wrong main admin PIN must show Invalid PIN.');
assert.match(ownerGate, /throw new Error\(unlockErrorMessage\(result\)\)/, 'lockout and offline errors must reach the PIN dialog');
assert.match(ownerGate, /first\.code !== 'owner_pin_required'\) return first;[\s\S]*requestPin\(/, 'an expired main admin session must ask for the PIN again');
assert.match(ownerGate, /createPortal\(/, 'the PIN dialog must be a full-screen overlay, not clipped by a card');
assert.match(ownerGate, /Main admin unlocked/);

// Accounts.
assert.match(accounts, /window\.nxgs\.getEarnings\(query\)/);
assert.match(accounts, /chooseScope\('device'\)/);
assert.match(accounts, /chooseScope\('all'\)/);
assert.match(
  accounts,
  /if \(scope === 'all'\) \{[\s\S]{0,120}owner\.ensureUnlocked\(OWNER_PIN_MESSAGES\.accounts\)[\s\S]{0,120}if \(!unlocked\) return;/,
  'All devices must ask for the main admin PIN first'
);
assert.match(accounts, /query\.scope === 'all'\s*\?\s*await owner\.run\(\(\) => window\.nxgs\.getEarnings\(query\)/);
assert.match(accounts, /window\.nxgs\.listFleetStations\(\)/);
assert.match(filters, /' \(removed\)'/);
for (const label of ['Today', 'Last 7 days', 'This month', 'All time', 'Custom']) {
  assert.match(accounts, new RegExp(`label: '${label}'`), `period preset ${label}`);
}
for (const label of ['Total earned', 'Paid sessions', 'Paid time', 'Most played game', 'By device', 'Top games']) {
  assert.ok(accounts.includes(label), `Accounts must show ${label}`);
}
assert.match(accounts, /<th scope="col">Games played<\/th>/);
assert.match(accounts, /<th scope="col">Customer<\/th>/, 'the sessions table must show the Razorpay customer');
assert.match(accounts, /\{props\.allScope && <th scope="col">Device<\/th>\}/);
assert.match(accounts, /\{props\.allScope && <th scope="col">Payment<\/th>\}/);
assert.match(accounts, /Not recorded/);
assert.match(accounts, /No paid sessions in this period/);
assert.match(accounts, /window\.nxgs\.exportEarningsCsv\(query\)/);
assert.match(accounts, /'Export CSV'/);
assert.match(accounts, /Razorpay payment ID/);
assert.match(accounts, /aria-expanded=\{props\.open\}/);
assert.match(accounts, /data-admin-local-keys="true"/);
assert.doesNotMatch(accounts, /reduce\(\(total/, 'totals come from the report, never recomputed');

// Device Management.
for (const api of [
  'listFleetStations',
  'getFleetStation',
  'updateFleetStation',
  'removeFleetStation',
  'setFleetGameEnabled',
  'listModerators',
  'saveModerator',
  'deleteModerator',
  'changeOwnerPin'
]) {
  assert.match(fleet, new RegExp(`window\\.nxgs\\.${api}\\(`), `Device Management must use ${api}`);
}
assert.match(fleetPanel, /owner\.ensureUnlocked\(OWNER_PIN_MESSAGES\.fleet\)/, 'All Devices must be gated by the main admin PIN');
assert.match(fleetPanel, /Main admin PIN needed/);
assert.match(stationPanel, /Waiting for device/);
assert.match(stationPanel, /View earnings/);
assert.match(stationPanel, /This is the device you are using now\./);
assert.match(moderators, /A moderator's PIN unlocks the Control Room on the devices you pick\./);
assert.match(moderators, /Leave blank to keep the current PIN/);
assert.equal((moderators.match(/type="password"\s+inputMode="numeric"/g) ?? []).length, 2, 'moderator PIN fields must be numeric password inputs');
assert.match(admin, /setAccountsView\(\(current\) => \(\{ \.\.\.withAccountsScope\(current, 'all'\), stationIds: \[stationId\] \}\)\)/, 'View earnings must open Accounts for that device');

// Review fixes (contract addendum B).
assert.match(fleetPanel, /Use 6 or more digits\./, 'the main admin PIN card must recommend a longer PIN');
assert.match(accounts, /\{report\.truncated && \(/, 'a capped earnings report must say so');
assert.match(accounts, /label: 'Unfinished'/, 'an active session past its paid time must not show as Playing');
assert.match(accounts, /isUnfinishedSession\(row, now\)\) return UNFINISHED_CHIP/);
assert.match(
  moderators,
  /stationIds: form\.stationIds\.filter\(\(id\) => !props\.stations\.some\(\(station\) => station\.id === id && station\.removedAt\)\)/,
  'saving a moderator must keep assignments the device list does not know'
);
assert.match(moderators, /disabled=\{busy \|\| !props\.stationsReady\}/, 'moderators cannot be saved before the device list loads');
assert.match(fleetPanel, /stationsReady=\{stations !== null && !listError\}/);
assert.match(app, /setAdminRole\(result\.role \?\? 'admin'\)/, 'App must keep who unlocked the Control Room');
assert.equal((app.match(/setAdminRole\(null\)/g) ?? []).length >= 4, true, 'the unlock role must clear whenever admin mode ends');
assert.match(app, /adminRole=\{adminRole \?\? 'moderator'\}/);
assert.match(admin, /<SessionSettings[\s\S]{0,120}adminRole=\{props\.adminRole \?\? 'admin'\}/);
assert.match(settingsPanels, /Only the device admin can see or change the admin PIN\./);
assert.match(settingsPanels, /adminPin: isModerator \? props\.settings\.adminPin : pin/, 'a moderator must save the existing admin PIN unchanged');

// Cloud sync on this device's page, and live updates from sync.
assert.match(syncCard, /window\.nxgs\.getFleetSyncStatus\(\)/);
assert.match(syncCard, /window\.nxgs\.syncFleetNow\(\)/);
assert.match(syncCard, /owner\.run\(\(\) => window\.nxgs\.rejoinFleet\(\), OWNER_PIN_MESSAGES\.rejoin\)/);
assert.match(syncCard, /Removed by main admin/);
assert.match(syncCard, /status && \(status\.needsRejoin \|\| status\.removedByOwner\) && owner && \(/, 'Rejoin must cover removal and a blocked registration');
assert.match(syncCard, /Rejoin needed/);
assert.match(deviceManager, /<FleetSyncCard owner=\{props\.owner\}/);
assert.match(app, /window\.nxgs\.onFleetLocalDataChanged\(\(change\) => \{[\s\S]{0,200}setGames\(change\.games\)/);
assert.match(app, /unsubscribeFleetLocalData\(\);/);

assert.match(accounts, /className=\{`admin-table accounts-table/, 'the sessions table must be a kit table');
assert.match(styles, /\.admin-table th \{[^}]*position: sticky;/, 'the sessions table header must stay visible while scrolling');
assert.match(styles, /\.accounts-table-scroll \{[^}]*overflow: auto;/);

// Earnings filters (contract addendum C): the bar only builds the query; main filters.
assert.match(accounts, /<AccountsFilterBar[\s\S]{0,200}facets=\{report\?\.facets\}/);
assert.match(accounts, /const viewKey = JSON\.stringify\(built\.query\)/, 'every filter must reload the report');
assert.match(accounts, /stationIds: toggleValue\(current\.stationIds, station\.stationId\)/, 'By device adds devices to the filter');
assert.match(accounts, /No sessions match these filters/);
for (const label of ['Devices', 'Games', 'Payment', 'Status', 'Search', 'Sort']) {
  assert.ok(filters.includes(`>${label}<`) || filters.includes(`label="${label}"`), `filter bar must have ${label}`);
}
assert.match(filters, /Phone, email, UPI ID or payment ID/);
assert.match(filters, /SEARCH_DEBOUNCE_MS = 300/);
assert.match(filters, /Verified payments only/);
assert.match(filters, /Whole store/);
assert.match(filters, /This device/);
assert.match(filters, /'No details'/);
assert.match(filters, /Showing \$\{props\.shownCount\.toLocaleString\('en-IN'\)\} of \$\{total\.toLocaleString\('en-IN'\)\} sessions/);
assert.match(filters, /Clear filters/);
assert.match(filters, /EARNINGS_SORT_OPTIONS\.map/);
assert.match(popover, /event\.key === 'Escape'[\s\S]{0,400}event\.stopPropagation\(\);[\s\S]{0,80}close\(\);/, 'Escape in a popover must close it, not the Control Room');
assert.match(popover, /data-admin-popover=\{open \? 'true' : undefined\}/);
assert.match(popover, /triggerRef\.current\?\.focus/, 'closing a popover returns focus to its button');
assert.match(popover, /addEventListener\('pointerdown'/, 'clicking outside closes a popover');
assert.match(popover, /useControllerNavigation\(true, handleController\)/);
assert.match(admin, /event\.target\.closest\(POPOVER_SELECTOR\)\) return;/, 'the Control Room ignores keys inside an open popover');
assert.match(fleetPanel, /filterFleetStations\(stations \?\? \[\], \{ search: deviceSearch, states: deviceStates, store: deviceStore \}\)/);
assert.match(fleetPanel, /Name, store, location or device ID/);
assert.match(fleetPanel, /All stores/);

{
  const base = { ...DEFAULT_ACCOUNTS_VIEW, range: 'all' };
  const all = { ...base, scope: 'all' };
  assert.deepEqual(buildEarningsQuery({ ...all, stationIds: ['a', 'b'], verifiedOnly: true, search: '  98765 ', sort: 'amount_high' }).query, {
    scope: 'all', sort: 'amount_high', stationIds: ['a', 'b'], verifiedOnly: true, search: '98765'
  });
  // Device scope never sends devices or verified-only.
  assert.deepEqual(buildEarningsQuery({ ...base, stationIds: ['a'], verifiedOnly: true }).query, { scope: 'device', sort: 'newest' });
  assert.deepEqual(
    buildEarningsQuery({ ...base, gameIds: ['g1'], paymentMethods: ['upi', 'unknown'], statuses: ['active'] }).query,
    { scope: 'device', sort: 'newest', gameIds: ['g1'], paymentMethods: ['upi', 'unknown'], statuses: ['active'] }
  );
  const busy = { ...all, stationIds: ['a'], gameIds: ['g1'], paymentMethods: ['upi'], statuses: ['completed'], verifiedOnly: true, search: 'x', sort: 'oldest', range: 'week' };
  assert.equal(accountsFilterCount(busy), 6);
  assert.deepEqual(clearAccountsFilters(busy), { ...all, range: 'week', sort: 'oldest' });
  // Changing scope keeps period, search, sort and session filters; clears devices and verified-only.
  assert.deepEqual(withAccountsScope(busy, 'device'), { ...busy, scope: 'device', stationIds: [], verifiedOnly: false });
}
{
  const station = (id, name, storeName, extra = {}) => ({
    id, name, storeName, location: 'Cabin', status: 'active', appVersion: '0.26.0', registeredAt: '', gameCount: 0,
    sessionCount: 0, totalRevenuePaise: 0, isCurrentDevice: false, ...extra
  });
  const fleet = [
    station('d1', 'Station 01', 'Main Store'),
    station('d2', 'Lounge PC', 'Downtown', { status: 'inactive' }),
    station('d3', 'Old PC', 'Downtown', { removedAt: '2026-10-01T00:00:00.000Z' }),
    station('d4', 'Spare', '')
  ];
  assert.deepEqual(groupStationsByStore(fleet).map((group) => [group.store, group.stations.map((item) => item.id)]), [
    ['Downtown', ['d2', 'd3']], ['Main Store', ['d1']], ['No store', ['d4']]
  ]);
  const ids = (picked) => filterFleetStations(fleet, { search: '', states: [], store: '', ...picked }).map((item) => item.id);
  assert.deepEqual(ids({ search: 'lounge' }), ['d2']);
  assert.deepEqual(ids({ search: 'D3' }), ['d3']);
  assert.deepEqual(ids({ states: ['removed', 'inactive'] }), ['d2', 'd3']);
  assert.deepEqual(ids({ store: 'Downtown', states: ['active'] }), []);
  assert.deepEqual(ids({ store: 'No store' }), ['d4']);
}

// Period presets send local-day boundaries: inclusive from, exclusive to.
const now = new Date(2026, 9, 17, 15, 30);
const view = (range, extra = {}) => ({ ...DEFAULT_ACCOUNTS_VIEW, range, ...extra });
assert.deepEqual(buildEarningsQuery(view('today'), now).query, {
  scope: 'device',
  sort: 'newest',
  from: new Date(2026, 9, 17).toISOString(),
  to: new Date(2026, 9, 18).toISOString()
});
assert.equal(buildEarningsQuery(view('week'), now).query.from, new Date(2026, 9, 11).toISOString());
assert.deepEqual(buildEarningsQuery(view('month'), now).query, {
  scope: 'device',
  sort: 'newest',
  from: new Date(2026, 9, 1).toISOString(),
  to: new Date(2026, 10, 1).toISOString()
});
assert.deepEqual(buildEarningsQuery(view('all'), now).query, { scope: 'device', sort: 'newest' });
assert.deepEqual(buildEarningsQuery(view('custom', { customFrom: '2026-10-01', customTo: '2026-10-05' }), now).query, {
  scope: 'device',
  sort: 'newest',
  from: new Date(2026, 9, 1).toISOString(),
  to: new Date(2026, 9, 6).toISOString()
});
assert.ok(buildEarningsQuery(view('custom', { customFrom: '2026-10-05', customTo: '2026-10-01' }), now).invalid);
assert.deepEqual(buildEarningsQuery(view('all', { scope: 'all', stationIds: ['device_a'] }), now).query.stationIds, ['device_a']);
assert.equal(buildEarningsQuery(view('all', { stationIds: ['device_a'] }), now).query.stationIds, undefined);

assert.equal(formatPaise(150000), '₹1,500');
assert.equal(formatPaise(12345650), '₹1,23,456.50');
assert.equal(durationLabel(45), '45 min');
assert.equal(durationLabel(90), '1 hr 30 min');
assert.equal(paymentMethodLabel('upi'), 'UPI');
assert.equal(paymentMethodLabel('netbanking'), 'Net banking');
assert.equal(paymentMethodLabel('paylater'), 'Pay later');
assert.equal(paymentMethodLabel('some_new_method'), 'Some New Method');
assert.equal(paymentMethodDetail({ checkoutId: 'c', cardNetwork: 'Visa', cardLast4: '4242' }), 'Visa •••• 4242');
assert.equal(paymentMethodDetail({ checkoutId: 'c', upiId: 'rahul@okaxis' }), 'rahul@okaxis');
assert.equal(phoneLabel('+919876543210'), '+91 98765 43210');
assert.ok(PIN_PATTERN.test('1832') && !PIN_PATTERN.test('123') && !PIN_PATTERN.test('12ab'));
const played = summarizeSessionGames({
  id: 's', stationId: 'd', stationName: 'D', status: 'completed', startedAt: '2026-10-17T10:00:00.000Z',
  endedAt: '2026-10-17T11:00:00.000Z', durationMinutes: 60, amountPaise: 10000, currency: 'INR', planNames: [],
  checkoutIds: [], payers: [],
  games: [
    { gameId: 'g1', title: 'Racer', startedAt: '2026-10-17T10:00:00.000Z', endedAt: '2026-10-17T10:20:00.000Z' },
    { gameId: 'g2', title: 'Shooter', startedAt: '2026-10-17T10:20:00.000Z', endedAt: '2026-10-17T10:40:00.000Z' },
    { gameId: 'g1', title: 'Racer', startedAt: '2026-10-17T10:40:00.000Z' }
  ]
});
assert.deepEqual(played.map((game) => [game.title, Math.round(game.minutes), game.plays]), [['Racer', 40, 2], ['Shooter', 20, 1]]);

// An open entry in a session that never finished stops at the paid time's end, not now.
const stale = {
  id: 'u', stationId: 'd', stationName: 'D', status: 'active', startedAt: '2026-10-17T10:00:00.000Z',
  expiresAt: '2026-10-17T10:30:00.000Z', durationMinutes: 30, amountPaise: 5000, currency: 'INR', planNames: [],
  checkoutIds: [], payers: [], games: [{ gameId: 'g1', title: 'Racer', startedAt: '2026-10-17T10:10:00.000Z' }]
};
const later = Date.parse('2026-10-17T15:00:00.000Z');
assert.equal(Math.round(summarizeSessionGames(stale, later)[0].minutes), 20);
assert.equal(Math.round(summarizeSessionGames(stale, Date.parse('2026-10-17T10:25:00.000Z'))[0].minutes), 15);
assert.equal(isUnfinishedSession(stale, later), true);
assert.equal(isUnfinishedSession(stale, Date.parse('2026-10-17T10:25:00.000Z')), false);
assert.equal(isUnfinishedSession({ ...stale, status: 'completed' }, later), false);

console.log('Accounts tab and filters, main admin PIN gate, All Devices management and list filters, moderators, cloud sync and Razorpay customer details verified.');
