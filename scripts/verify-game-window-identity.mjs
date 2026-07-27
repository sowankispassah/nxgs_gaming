import assert from 'node:assert/strict';
import { gameWindowMatchesGame } from '../src/main/gameWindowIdentity.ts';

const game = (overrides = {}) => ({
  id: 'angry-birds-2',
  deviceId: 'device',
  title: 'Angry Birds 2',
  avatarImagePath: '',
  coverImagePath: '',
  source: 'Microsoft Store',
  availabilityStatus: 'available',
  launchType: 'microsoftStore',
  launchCommand: '1ED5AEA5.4160926B82DB_p2gbknwb5d8r2!App',
  workingDirectory: '',
  processName: '',
  launchArguments: '',
  enabled: true,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  syncStatus: 'local',
  ...overrides
});

const window = (overrides = {}) => ({
  handle: 100,
  processId: 200,
  processName: 'Angry Birds 2',
  title: 'Angry Birds 2',
  ...overrides
});

assert.equal(gameWindowMatchesGame(game(), window(), 200), true);
assert.equal(
  gameWindowMatchesGame(game(), window({ processName: 'ApplicationFrameHost', title: 'Angry Birds 2' }), 300),
  true
);
assert.equal(
  gameWindowMatchesGame(game(), window({ processName: 'ApplicationFrameHost', title: 'Photos' }), 300),
  false
);
assert.equal(
  gameWindowMatchesGame(game(), window({ processId: 7652, processName: 'explorer', title: '' }), 7652),
  false,
  'an Explorer PID must never become the tracked game even if it was cached'
);
assert.equal(
  gameWindowMatchesGame(game(), window({ processName: 'ChatGPT', title: 'Angry Birds 2 Home overlay' })),
  false,
  'another app must never match by title text'
);
assert.equal(
  gameWindowMatchesGame(
    game({ launchType: 'localExe', launchCommand: 'D:\\Games\\ExampleGame.exe', processName: 'ExampleGame.exe' }),
    window({ processName: 'ExampleGame', title: 'Example Game' })
  ),
  true
);

console.log('Exact game-window identity and unrelated-app rejection verified.');
