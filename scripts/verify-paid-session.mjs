import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SessionTimer } from '../src/main/sessionTimer.ts';

const states = [];
const warnings = [];
let expirations = 0;
const timer = new SessionTimer({
  onTick: (state) => states.push(state),
  onWarning: (minutes) => warnings.push(minutes),
  onExpired: () => { expirations += 1; }
});

const started = timer.start(30);
assert.equal(started.status, 'running');
assert.equal(started.remainingSeconds, 1800);
assert.equal(timer.active, true);
assert.equal(warnings.length, 0);

const extended = timer.extend(15);
assert.equal(extended.status, 'running');
assert.ok(extended.remainingSeconds >= 2699 && extended.remainingSeconds <= 2700);
assert.ok(extended.revision > started.revision);
assert.equal(extended.expiresAt > started.expiresAt, true);

timer.expire();
assert.equal(timer.active, false);
assert.equal(timer.current.status, 'expired');
assert.equal(expirations, 1);
timer.stop('idle', false);

const [mainSource, paymentSource, functionSource, overlaySource] = await Promise.all([
  readFile(new URL('../src/main/main.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/paymentService.ts', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/functions/pcPayment/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/sessionCountdownOverlay.ts', import.meta.url), 'utf8')
]);

assert.match(mainSource, /if \(!sessionTimer\.active\)/);
assert.match(mainSource, /sessionTimer\.extend\(result\.entitlement\.durationMinutes\)/);
assert.match(mainSource, /launcher\.closeAllGames\(\)/);
assert.doesNotMatch(paymentSource, /game_id: request\./);
assert.doesNotMatch(functionSource, /gameId: String\(data\.game_id\)/);
assert.match(functionSource, /entitlement_scope: "station"/);
assert.match(overlaySource, /state\.remainingSeconds > 60/);
assert.match(overlaySource, /visibleOnFullScreen: true/);

console.log('Station-wide paid timer, extension, expiry, checkout scope, and countdown overlay verified.');
