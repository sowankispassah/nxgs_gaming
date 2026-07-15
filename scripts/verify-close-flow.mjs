import assert from 'node:assert/strict';
import {
  GRACEFUL_CLOSE_INITIAL_DELAY_MS,
  GRACEFUL_CLOSE_MAX_ATTEMPTS,
  GRACEFUL_CLOSE_RETRY_DELAY_MS,
  hasReliableProcessIdentity,
  PROCESS_MONITOR_INTERVAL_MS
} from '../src/main/gameLifecycle.ts';
import { shouldShowQuickGameOverlay } from '../src/renderer/launchFlow.ts';

const game = (overrides = {}) => ({
  id: 'game',
  title: 'Game',
  source: 'Manual',
  availabilityStatus: 'installed',
  launchType: 'localExe',
  launchCommand: 'game.exe',
  workingDirectory: '',
  processName: '',
  launchArguments: '',
  launchMode: 'borderlessPreferred',
  enabled: true,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  ...overrides
});

assert.equal(hasReliableProcessIdentity(game({ processName: 'game.exe' }), null), true);
assert.equal(hasReliableProcessIdentity(game(), 1234, 'game'), true);
assert.equal(hasReliableProcessIdentity(game({ launchType: 'microsoftStore' }), 1234, 'ApplicationFrameHost'), false);
assert.equal(hasReliableProcessIdentity(game({ launchType: 'microsoftStore' }), 1234, 'explorer'), false);

const state = (status) => ({ status, updatedAt: new Date(0).toISOString() });
assert.equal(shouldShowQuickGameOverlay(state('quickOverlayOpen')), true);
assert.equal(shouldShowQuickGameOverlay(state('resuming')), true);
assert.equal(shouldShowQuickGameOverlay(state('closing')), false, 'Closing must return to an interactive launcher view.');

assert.ok(GRACEFUL_CLOSE_INITIAL_DELAY_MS <= 1500);
assert.ok(GRACEFUL_CLOSE_RETRY_DELAY_MS <= 1000);
assert.ok(GRACEFUL_CLOSE_MAX_ATTEMPTS <= 2);
assert.ok(PROCESS_MONITOR_INTERVAL_MS >= 5000);

console.log('Non-blocking close state and lightweight process monitoring verified.');
