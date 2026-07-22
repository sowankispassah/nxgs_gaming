import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [mainSource, preloadSource, launcherSource, appSource, overlayRootSource, overlaySource] = await Promise.all([
  readFile(new URL('../src/main/main.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/preload.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/gameLauncher.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/QuickOverlayRoot.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/components/QuickHomeOverlay.tsx', import.meta.url), 'utf8')
]);

assert.match(mainSource, /title: 'NXGS Play Quick Switcher'[\s\S]*transparent: true/);
assert.match(mainSource, /const GAMEPLAY_QUICK_OVERLAY_HEIGHT = 600/);
assert.match(mainSource, /getGameplayQuickOverlayBounds\(display\.bounds\)/);
assert.match(mainSource, /desktopCapturer\.getSources/);
assert.match(mainSource, /types: \['window', 'screen'\]/);
assert.match(mainSource, /launcher\.activeState\.game\?\.title/);
assert.match(mainSource, /quickOverlay:backdrop/);
assert.match(mainSource, /fullscreenable: false/);
assert.match(mainSource, /setVisibleOnAllWorkspaces\(true, \{ visibleOnFullScreen: true \}\)/);
assert.doesNotMatch(
  mainSource.slice(
    mainSource.indexOf('async function createGameplayQuickOverlayWindow'),
    mainSource.indexOf('function broadcastActiveGame')
  ),
  /fullscreen: true|setFullScreen\(true\)/
);
assert.match(mainSource, /launcher\.openQuickOverlay\(\{ focusLauncher: false \}\)/);
assert.match(mainSource, /gameplayQuickOverlayWindow[\s\S]*setAlwaysOnTop\(true, 'screen-saver'\)/);
assert.match(mainSource, /\['launching', 'running', 'quickOverlayOpen', 'resuming'\]/);
assert.match(mainSource, /if \(!hasActiveGame \|\| !gameplayContext\)/);
assert.match(mainSource, /if \(gameplayOverlayOpen && reason !== 'emergency-close'\)[\s\S]*launcher\.resumeActiveGame\(\)/);
assert.match(mainSource, /shell:dismissQuickOverlay[\s\S]*hideGameplayQuickOverlay\(\)[\s\S]*launcher\.resumeActiveGame\(\)/);
assert.match(mainSource, /endPaidSession[\s\S]*openQuickNav: false,[\s\S]*resetToHome: true/);
assert.match(launcherSource, /if \(focusLauncher\) \{[\s\S]*this\.focusLauncher\(\);[\s\S]*\} else \{[\s\S]*this\.releaseLaunchShield\(\)/);
assert.match(appSource, /if \(event\.resetToHome\) \{[\s\S]*resetToHome\(\)/);
assert.match(appSource, /setQuickNavOpen\(event\.openQuickNav \?\? false\)/);
assert.match(overlayRootSource, /liveGameBackdrop/);
assert.match(overlayRootSource, /compact-gameplay-overlay/);
assert.match(overlayRootSource, /quick-overlay-captured-backdrop/);
assert.match(preloadSource, /onQuickOverlayBackdrop/);
assert.match(overlayRootSource, /dismissQuickOverlay/);
assert.match(overlaySource, /props\.dismissResumesGame !== false/);
assert.match(overlaySource, /!props\.liveGameBackdrop && backgroundImage/);

console.log('Home toggle, transparent gameplay overlay, clean end-session, and dismiss/resume boundaries verified.');
