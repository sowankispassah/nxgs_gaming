import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isFreePlayEnabled, requiresPaymentForLaunch } from '../src/shared/playAccess.ts';

const paid = { playAccessMode: 'paid' };
const free = { playAccessMode: 'free' };

assert.equal(isFreePlayEnabled(paid), false);
assert.equal(isFreePlayEnabled(free), true);
assert.equal(requiresPaymentForLaunch(paid, { status: 'idle', remainingSeconds: 0 }), true);
assert.equal(requiresPaymentForLaunch(paid, { status: 'running', remainingSeconds: 30 }), false);
assert.equal(requiresPaymentForLaunch(free, { status: 'idle', remainingSeconds: 0 }), false);
assert.equal(requiresPaymentForLaunch(free, { status: 'expired', remainingSeconds: 0 }), false);

const [databaseSource, mainSource, appSource] = await Promise.all([
  readFile(new URL('../src/main/database.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/main.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8')
]);

assert.match(databaseSource, /playAccessMode: 'paid'/);
assert.match(databaseSource, /settings\.playAccessMode === 'free' \? 'free' : 'paid'/);
assert.match(mainSource, /requiresPaymentForLaunch\(store\.getSettings\(\), sessionTimer\.current\)/);
assert.match(appSource, /Allow free play/);
assert.match(appSource, /Games launch immediately without opening the plan or payment pages/);
assert.match(appSource, /requiresPaymentForLaunch\(settings, session\)/);
assert.match(appSource, /pending \? 'Saving\.\.\.' : 'Save Settings'/);

console.log('Paid/free access persistence, payment bypass, and Admin save feedback verified.');
