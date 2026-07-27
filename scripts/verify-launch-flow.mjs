import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
assert.equal(shouldShowBlockingLaunchTransition(state('launching', true)), true);
assert.equal(shouldShowBlockingLaunchTransition(state('running', true)), false);

const [appSource, launcherSource] = await Promise.all([
  readFile(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/gameLauncher.ts', import.meta.url), 'utf8')
]);

assert.doesNotMatch(appSource, /GameSwitchDialog|switchTargetGame|Keep Running & Switch/);
assert.match(appSource, /const selectGame[\s\S]*await launchPaidGame\(game\)/);
assert.match(
  launcherSource,
  /this\.storeCurrentSession\(\)[\s\S]*this\.sessions\.delete\(game\.id\)[\s\S]*this\.activeGame = game/,
  'launching another game must preserve the previous session before selecting the new game'
);

console.log('Concurrent game launch and full handoff transition boundaries verified.');
