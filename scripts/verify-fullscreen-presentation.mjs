import assert from 'node:assert/strict';
import {
  CONSOLE_GAME_LAUNCH_MODE,
  gamePresentationFailures,
  isFullscreenGamePresentation
} from '../src/main/gamePresentation.ts';

const fullscreen = {
  foregroundHandle: 101,
  hasWindowChrome: false,
  isForeground: true,
  isMinimized: false,
  isVisible: true,
  height: 1080,
  monitorHeight: 1080,
  monitorWidth: 1920,
  monitorX: 0,
  monitorY: 0,
  width: 1920,
  x: 0,
  y: 0
};

assert.equal(CONSOLE_GAME_LAUNCH_MODE, 'fullscreen', 'console gameplay must always request fullscreen');
assert.equal(isFullscreenGamePresentation(fullscreen), true, 'exact monitor coverage must pass');
assert.equal(
  isFullscreenGamePresentation({ ...fullscreen, x: -2, y: -2, width: 1924, height: 1084 }),
  true,
  'borderless overscan must pass'
);

const smallWindow = { ...fullscreen, x: 240, y: 120, width: 1280, height: 720 };
assert.equal(isFullscreenGamePresentation(smallWindow), false, 'a focused small game window must be rejected');
assert.match(gamePresentationFailures(smallWindow).join(' '), /does not cover monitor/);
assert.equal(
  isFullscreenGamePresentation({ ...fullscreen, hasWindowChrome: true }),
  false,
  'a title bar or window border must be rejected'
);
assert.equal(isFullscreenGamePresentation(fullscreen, true), false, 'a visible taskbar must be rejected');
assert.equal(
  isFullscreenGamePresentation({ ...fullscreen, isForeground: false }),
  false,
  'background gameplay must be rejected'
);
assert.equal(
  isFullscreenGamePresentation({ ...fullscreen, y: 20, height: 1060 }),
  false,
  'a taskbar-sized monitor gap must be rejected'
);
assert.equal(
  isFullscreenGamePresentation({ ...fullscreen, monitorX: -1920, x: -1920 }),
  true,
  'fullscreen validation must support non-primary monitors'
);

console.log('Fullscreen presentation checks passed.');
