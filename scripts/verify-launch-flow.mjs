import assert from 'node:assert/strict';
import {
  hasConfirmedGameWindow,
  shouldShowBlockingLaunchTransition
} from '../src/renderer/launchFlow.ts';

const game = { id: 'chicken-invaders', title: 'Chicken Invaders 4 HD' };
const state = (status, windowDetected, stateGame = game) => ({
  status,
  game: stateGame,
  windowDetected,
  updatedAt: new Date(0).toISOString()
});

assert.equal(hasConfirmedGameWindow(game.id, state('launching', false)), false);
assert.equal(hasConfirmedGameWindow(game.id, state('launching', true)), true);
assert.equal(hasConfirmedGameWindow(game.id, state('launching', true, { id: 'other-game' })), false);
assert.equal(hasConfirmedGameWindow(game.id, state('error', true)), false);

assert.equal(shouldShowBlockingLaunchTransition(state('launching', false)), true);
assert.equal(shouldShowBlockingLaunchTransition(state('launching', true)), false);
assert.equal(shouldShowBlockingLaunchTransition(state('running', true)), false);

console.log('Launch confirmation dismissal and blocking transition boundary verified.');
