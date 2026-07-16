import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CONTROLLER_INITIAL_REPEAT_DELAY_MS,
  CONTROLLER_REPEAT_INTERVAL_MS,
  ControllerInputEngine
} from '../src/renderer/controllerNavigation.ts';

function createPad() {
  return {
    id: 'NXGS Test Controller',
    mapping: 'standard',
    buttons: Array.from({ length: 18 }, () => ({ pressed: false, touched: false, value: 0 })),
    axes: [0, 0],
    connected: true,
    index: 0,
    timestamp: 0,
    vibrationActuator: null
  };
}

function directions(result) {
  return result.navigation
    .filter((event) => event.type === 'direction')
    .map((event) => event.direction);
}

const engine = new ControllerInputEngine();
const pad = createPad();

pad.buttons[15].pressed = true;
assert.deepEqual(directions(engine.update(pad, 0)), ['right'], 'first D-pad press must move exactly once');
assert.deepEqual(directions(engine.update(pad, 120)), [], 'held D-pad must not repeat before the initial delay');
assert.deepEqual(
  directions(engine.update(pad, CONTROLLER_INITIAL_REPEAT_DELAY_MS)),
  ['right'],
  'held D-pad must repeat after the initial delay'
);
assert.deepEqual(
  directions(engine.update(pad, CONTROLLER_INITIAL_REPEAT_DELAY_MS + CONTROLLER_REPEAT_INTERVAL_MS - 1)),
  [],
  'held D-pad must respect the controlled repeat interval'
);
assert.deepEqual(
  directions(engine.update(pad, CONTROLLER_INITIAL_REPEAT_DELAY_MS + CONTROLLER_REPEAT_INTERVAL_MS)),
  ['right'],
  'held D-pad must repeat once per repeat interval'
);

pad.buttons[15].pressed = false;
engine.update(pad, 500);
pad.buttons[15].pressed = true;
assert.deepEqual(directions(engine.update(pad, 510)), ['right'], 'release must reset the direction edge');

pad.buttons[15].pressed = false;
pad.axes[0] = 0;
engine.update(pad, 600);
pad.axes[0] = 0.8;
assert.deepEqual(directions(engine.update(pad, 610)), ['right'], 'first analog flick must move exactly once');
pad.axes[0] = 0.5;
assert.deepEqual(directions(engine.update(pad, 720)), [], 'analog hysteresis must not create a second edge');
pad.axes[0] = 0.1;
engine.update(pad, 730);
pad.axes[0] = 0.8;
assert.deepEqual(directions(engine.update(pad, 740)), ['right'], 'returning to neutral must arm the next flick');

pad.axes[0] = 0;
engine.update(pad, 800);
pad.buttons[0].pressed = true;
assert.equal(engine.update(pad, 810).navigation.filter((event) => event.type === 'accept').length, 1);
assert.equal(
  engine.update(pad, 1000).navigation.filter((event) => event.type === 'accept').length,
  0,
  'holding A/X must not activate a newly opened modal a second time'
);
pad.buttons[0].pressed = false;
engine.update(pad, 1010);
pad.buttons[0].pressed = true;
assert.equal(engine.update(pad, 1020).navigation.filter((event) => event.type === 'accept').length, 1);

const [app, home, settings, switcher] = await Promise.all([
  readFile(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/components/ConsoleHome.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/components/ConsoleSettings.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/components/QuickHomeOverlay.tsx', import.meta.url), 'utf8')
]);

for (const [name, source] of [['App', app], ['ConsoleSettings', settings], ['QuickHomeOverlay', switcher]]) {
  assert.doesNotMatch(source, /navigator\.getGamepads/, `${name} must use the shared controller input hub`);
}
assert.match(app, /useControllerNavigation\(/, 'Home and modal navigation must use the shared controller hub');
assert.match(settings, /useControllerNavigation\(/, 'Settings must use the shared controller hub');
assert.match(switcher, /useControllerNavigation\(/, 'Switcher and quick settings must use the shared controller hub');
assert.match(home, /data-home-utility-index="0"/, 'Search must be controller focusable');
assert.match(home, /data-home-utility-index="1"/, 'Settings must be controller focusable');
assert.match(home, /data-home-utility-index="2"/, 'User profile must be controller focusable');
assert.match(app, /homeFocusSection === 'utilities'/, 'Home focus graph must include top-right utilities');
assert.match(app, /focusArea === 'launch'/, 'time selection must include a controller-focused launch action');
assert.match(app, /useControllerNavigation\(!pending, handleLaunchControllerEvent\)/, 'time selection must own controller input while open');

console.log('Global controller edge, repeat, focus graph, and modal navigation verified.');
