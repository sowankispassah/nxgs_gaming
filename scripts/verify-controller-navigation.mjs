import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readAppShellSource, readRendererStyles } from './lib/rendererSources.mjs';
import {
  CONTROLLER_INITIAL_REPEAT_DELAY_MS,
  CONTROLLER_REPEAT_INTERVAL_MS,
  ControllerInputEngine,
  ControllerPadSelector
} from '../src/renderer/controllerNavigation.ts';

function createPad(id = 'NXGS Test Controller', index = 0) {
  return {
    id,
    mapping: 'standard',
    buttons: Array.from({ length: 18 }, () => ({ pressed: false, touched: false, value: 0 })),
    axes: [0, 0],
    connected: true,
    index,
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
const selector = new ControllerPadSelector();
const idleVirtualPad = createPad('Xbox 360 Controller (XInput STANDARD GAMEPAD)', 0);
const physicalDualSense = createPad('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', 1);

physicalDualSense.buttons[0].pressed = true;
assert.equal(
  selector.select([idleVirtualPad, physicalDualSense]),
  physicalDualSense,
  'launcher must choose the Bluetooth controller producing input instead of an idle virtual slot'
);
physicalDualSense.buttons[0].pressed = false;
assert.equal(selector.select([idleVirtualPad, physicalDualSense]), physicalDualSense, 'active physical controller must stay selected after release');
idleVirtualPad.buttons[0].pressed = true;
assert.equal(selector.select([idleVirtualPad, physicalDualSense]), idleVirtualPad, 'launcher must switch when the virtual controller becomes the input source');
idleVirtualPad.buttons[0].pressed = false;
selector.reset();
assert.equal(selector.select([idleVirtualPad, physicalDualSense]), physicalDualSense, 'launcher must prefer a physical PlayStation controller when all pads are idle');

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

const [app, home, settings, switcher, styles, launcher, windowManager] = await Promise.all([
  readAppShellSource(),
  readFile(new URL('../src/renderer/components/ConsoleHome.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/components/ConsoleSettings.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/components/QuickHomeOverlay.tsx', import.meta.url), 'utf8'),
  readRendererStyles(),
  readFile(new URL('../src/main/gameLauncher.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/windowManagerService.ts', import.meta.url), 'utf8')
]);

for (const [name, source] of [['App', app], ['ConsoleSettings', settings], ['QuickHomeOverlay', switcher]]) {
  assert.doesNotMatch(source, /navigator\.getGamepads/, `${name} must use the shared controller input hub`);
}
assert.match(app, /useControllerNavigation\(/, 'Home and modal navigation must use the shared controller hub');
assert.match(settings, /useControllerNavigation\(/, 'Settings must use the shared controller hub');
assert.match(settings, /previewSettingsIndex[\s\S]*setSelectedIndex\(index\);[\s\S]*setOpenedIndex\(index\);/, 'Settings menu movement must immediately preview the highlighted page');
assert.match(settings, /SETTINGS_PREVIEW_HYDRATION_DELAY_MS/, 'Settings preview hydration must be cancellably delayed during rapid navigation');
assert.match(settings, /hydrateSettingsPage\(item\.key, true\)/, 'Explicit page selection must hydrate immediately');
assert.match(settings, /window\.nxgs\.getBluetoothStatus\(\)/, 'Bluetooth page hydration must use a status-only read instead of device discovery');
assert.match(settings, /window\.nxgs\.scanBluetoothDevices\(\)/, 'Bluetooth discovery must remain available as an explicit action');
assert.match(settings, /settingsDataCache/, 'Settings system data must remain cached across page revisits');
assert.doesNotMatch(
  settings,
  /selected\.key === 'controller'[\s\S]{0,180}refreshBluetooth\(/,
  'highlighting Bluetooth must never start device discovery'
);
assert.match(switcher, /useControllerNavigation\(/, 'Switcher and quick settings must use the shared controller hub');
assert.match(switcher, /initialNavActionRef\.current\?\.focus\(\{ preventScroll: true \}\)/, 'the active game navbar icon must receive DOM focus on first open');
// PS5-style Switcher: one game tile, a list of running games, options per game.
assert.match(switcher, /switcherSessions\.slice\(0, 1\)\.map\(\(session\) => \(\{\s*key: 'switcher'/, 'the bar must show one tile for all running games');
assert.match(switcher, /direction === 'up' && focusArea === 'navbar' && switcherSelected\) \{[\s\S]{0,120}enterSwitcher\(\)/, 'Up from the game tile must enter the Switcher list');
const switcherGraph = switcher.slice(switcher.indexOf('const moveSwitcherDirection'), switcher.indexOf('const acceptFocused'));
assert.match(switcherGraph, /if \(focusArea === 'switcher'\) \{[^]{0,800}direction === 'right'\) \{\s*openSwitcherOptions\(switcherIndex\)/, 'Right on a Switcher row must open that game\'s options');
assert.match(switcherGraph, /if \(focusArea === 'switcher'\) \{[^]{0,800}switcherIndex >= switcherSessions\.length - 1\) setFocusArea\('navbar'\)/, 'Down from the last row must return to the bar');
assert.match(switcher, /focusArea === 'switcher'\) \{\s*resumeSwitcherRow\(switcherIndex\)/, 'selecting a Switcher row must resume that game');
assert.match(switcher, /if \(optionsSession\) \{\s*playUiSound\('back'\);\s*closeSwitcherOptions\(\);[^]{0,200}if \(focusArea === 'switcher'\) \{\s*playUiSound\('back'\);\s*setFocusArea\('navbar'\);/, 'Back must step from a game\'s options to the list, then to the bar');
assert.match(switcher, /const dismissOverlay = useCallback[^]{0,400}resumeGame\(activeSession\)/, 'leaving Home must return to the game it was opened over');
assert.match(switcher, /setOptionsGameId\(switcherSessions\[0\]\.game\.id\);\s*setFocusArea\('menu'\);\s*setMenuIndex\(2\);\s*setConfirmClose\(true\);/, 'emergency close must open the active game\'s close confirmation');
assert.match(switcher, /if \(!result\.ok\) \{[^]{0,600}setConfirmClose\(false\);\s*setFocusArea\('menu'\);\s*setMenuIndex\(0\);/, 'a failed resume must show its error with Resume focused, never an armed Close');
assert.match(switcher, /const disabled = pendingAction !== null \|\| isClosingGame;/, 'nothing behind the closing screen may take input');
assert.match(switcher, /previousStatus\.current === 'resuming' && status === 'quickOverlayOpen'/, 'a failed resume must keep its card and error instead of resetting Home');
assert.match(switcher, /SWITCHER_INPUT_DEDUPLICATION_MS/, 'duplicate keyboard and native controller events must be suppressed');
assert.match(switcher, /moveSwitcherDirection\(event\.direction\)/, 'keyboard and controller directions must share the same switcher focus graph');
assert.match(launcher, /releaseGameWindowTopMost[\s\S]*focusLauncherAfterGameRelease/, 'quick Home must restore launcher input focus after releasing the game topmost lock');
assert.match(launcher, /window\.webContents\.focus\(\)/, 'launcher focus must explicitly include its web contents');
assert.match(windowManager, /activateLauncherWindow[\s\S]*isForeground/, 'native launcher activation must verify that the overlay owns foreground keyboard input');
assert.match(home, /data-home-utility-index="0"/, 'Search must be controller focusable');
assert.match(home, /data-home-utility-index="1"/, 'Settings must be controller focusable');
assert.match(home, /data-home-utility-index="2"/, 'User profile must be controller focusable');
assert.match(app, /homeFocusSection === 'utilities'/, 'Home focus graph must include top-right utilities');
assert.match(app, /stage === 'plans'\) void choosePlan\(planIndex\)/, 'A/X on a duration must immediately create its checkout');
assert.match(app, /useControllerNavigation\(!inputPending, handleLaunchControllerEvent\)/, 'checkout flow must own controller input while open');
assert.match(app, /event\.direction === 'down'\) movePlan\(1\)/, 'Down must move to the next duration');
assert.match(app, /event\.direction === 'left' \|\| event\.direction === 'right'/, 'payment actions must support horizontal controller navigation');
assert.doesNotMatch(app, />Launch Game</, 'the removed duration submit button must not return');
assert.match(app, /focusArea === 'unlock'/, 'PIN modal must include Unlock in its controller focus map');
assert.match(app, /unlockButtonRef/, 'PIN Unlock must receive real DOM focus');
assert.match(
  styles,
  /:where\(button, input, select, textarea, a, \[tabindex\]\):focus[\s\S]*outline:\s*none;/,
  'all focusable launcher controls must suppress the browser outline'
);

console.log('Global controller edge, repeat, focus graph, and modal navigation verified.');
