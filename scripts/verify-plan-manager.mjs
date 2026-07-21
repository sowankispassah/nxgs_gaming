import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [types, database, payment, main, preload, app, manager, edgeFunction, migration] = await Promise.all([
  readFile(new URL('../src/shared/types.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/database.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/paymentService.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/main.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/preload.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/components/PlanManager.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/functions/pcPayment/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260721152250_local_plan_checkouts.sql', import.meta.url), 'utf8')
]);

assert.match(types, /interface PlayPlanRecord extends PaymentPlan/);
assert.match(types, /displayOrder: number/);
assert.match(types, /createdAt: string/);
assert.match(types, /updatedAt: string/);

assert.match(database, /const SCHEMA_VERSION = 5/);
assert.match(database, /name: '30 Minutes', durationMinutes: 30, amountPaise: 5000/);
assert.match(database, /name: '1 Hour', durationMinutes: 60, amountPaise: 10000/);
assert.match(database, /name: '1 Hour 30 Minutes', durationMinutes: 90, amountPaise: 15000/);
assert.match(database, /Number\(parsed\.schemaVersion\) >= 4 \? plans : createDefaultPlans\(currentDevice\.id\)/);
assert.match(database, /normalizePlan\(migratedPlan, plan\.deviceId \|\| currentDevice\.id, plan, false\)/);
assert.match(database, /async savePlan/);
assert.match(database, /async deletePlan/);
assert.match(database, /async setPlanEnabled/);
assert.match(database, /async reorderPlans/);

assert.match(payment, /this\.plans\.listEnabled\(\)/);
assert.match(payment, /this\.plans\.getById\(request\.timePlanId\)/);
assert.match(payment, /plan: \{/);
assert.doesNotMatch(payment, /this\.invoke\('pricing'/);
assert.match(payment, /No play plans available\./);

for (const channel of ['plans:list', 'plans:save', 'plans:delete', 'plans:setEnabled', 'plans:reorder']) {
  assert.match(main, new RegExp(channel.replace(':', '\\:')));
}
assert.match(preload, /listPlayPlans/);
assert.match(preload, /savePlayPlan/);
assert.match(preload, /deletePlayPlan/);
assert.match(preload, /setPlayPlanEnabled/);
assert.match(preload, /reorderPlayPlans/);

assert.match(app, /label="Plan Manager"/);
assert.match(app, /tab === 'plans' && <PlanManager/);
assert.match(app, /Play durations and prices are managed from Plan Manager\./);
assert.match(app, /No play plans available\./);
assert.doesNotMatch(app, /plan\.durationMinutes === (5|30|180)/);

assert.match(manager, /Add New Plan/);
assert.match(manager, /savePlayPlan/);
assert.match(manager, /deletePlayPlan/);
assert.match(manager, /setPlayPlanEnabled/);
assert.match(manager, /reorderPlayPlans/);
assert.match(manager, /Global plan/);
assert.match(manager, /This device/);
assert.match(manager, /Saving\.\.\./);
assert.match(manager, /Deleting\.\.\./);

assert.match(edgeFunction, /function localPlan/);
assert.match(edgeFunction, /selectedLocalPlan/);
assert.match(edgeFunction, /legacyCatalog/);
assert.match(edgeFunction, /data\.plan_name/);
assert.match(migration, /drop constraint if exists pc_checkouts_time_plan_id_fkey/);
assert.match(migration, /alter column time_plan_id type text/);

console.log('Local Plan Manager persistence, admin CRUD, enabled customer catalog, and Razorpay plan snapshots verified.');
