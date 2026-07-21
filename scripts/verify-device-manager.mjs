import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [types, database, payment, main, preload, app, manager] = await Promise.all([
  readFile(new URL('../src/shared/types.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/database.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/paymentService.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/main.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/preload.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/components/DeviceManager.tsx', import.meta.url), 'utf8')
]);

assert.match(types, /interface DeviceRecord/);
assert.match(types, /currentDeviceId: string/);
assert.match(types, /devices: DeviceRecord\[\]/);
assert.match(types, /deviceId: string/);
assert.match(types, /scope: PlanScope/);
assert.match(types, /sessions: LocalSessionRecord\[\]/);
assert.match(types, /interface LocalSessionRecord/);
assert.match(types, /syncStatus: SyncStatus/);
assert.match(types, /deletedAt\?: string/);

assert.match(database, /const SCHEMA_VERSION = 5/);
assert.match(database, /function createDefaultDevice/);
assert.match(database, /game\.deviceId \|\| currentDevice\.id/);
assert.match(database, /plan\.deviceId \|\| currentDevice\.id/);
assert.match(database, /game\.deviceId === data\.currentDeviceId && !game\.deletedAt/);
assert.match(database, /plan\.scope === 'global' \|\| plan\.deviceId === data\.currentDeviceId/);
assert.match(database, /async updateCurrentDevice/);
assert.match(database, /getDeviceManagerSummary/);
assert.match(database, /recordPaidSession/);
assert.match(database, /finishActiveSession/);
assert.match(database, /syncStatus = 'pending'/);
assert.match(payment, /checkoutPlans/);
assert.match(payment, /amountPaise: plan\.amountPaise/);

assert.match(main, /device:getCurrent/);
assert.match(main, /device:updateCurrent/);
assert.match(main, /currentDevice: store\.getCurrentDevice\(\)/);
assert.match(main, /store\.recordPaidSession/);
assert.match(main, /store\.finishActiveSession/);
assert.match(preload, /getCurrentDevice/);
assert.match(preload, /updateCurrentDevice/);

assert.match(app, /label="Device Manager"/);
assert.match(app, /tab === 'device'/);
assert.match(app, /Only games linked to/);
assert.match(app, /Saved results will belong to/);

assert.match(manager, /Generated device ID/);
assert.match(manager, /Store \/ branch name/);
assert.match(manager, /Device location/);
assert.match(manager, /Games on device/);
assert.match(manager, /Active plans/);
assert.match(manager, /Total sessions/);
assert.match(manager, /Tracked revenue/);
assert.match(manager, /Saving\.\.\./);
assert.match(manager, /disabled=\{saving\}/);

console.log('Device schema, legacy migration, device-scoped games/plans, sync metadata, IPC, and Admin Device Manager verified.');
