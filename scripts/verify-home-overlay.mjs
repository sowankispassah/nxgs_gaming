import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [mainSource, preloadSource, launcherSource, appSource, rendererMainSource, overlayRootSource, overlaySource, stylesSource] = await Promise.all([
  readFile(new URL('../src/main/main.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/preload.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/gameLauncher.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/main.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/QuickOverlayRoot.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/components/QuickHomeOverlay.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8')
]);

assert.match(mainSource, /title: 'NXGS Play Quick Switcher'[\s\S]*transparent: true/);
assert.doesNotMatch(mainSource, /GAMEPLAY_QUICK_OVERLAY_HEIGHT/);
assert.match(mainSource, /overlay\.setBounds\(display\.bounds\)/);
assert.match(mainSource, /desktopCapturer\.getSources\(\{[\s\S]*types: \['window'\]/);
assert.doesNotMatch(mainSource, /types:\s*\[[^\]]*'screen'/, 'overlay fallback must never capture the desktop');
assert.match(mainSource, /Number\(handle\) === Math\.trunc\(gameWindow\.handle\)/, 'snapshot must match the tracked game window handle exactly');
assert.match(mainSource, /unsafeShellProcesses[\s\S]*'chrome'[\s\S]*'explorer'/, 'browser and shell windows must never become game backdrops');
assert.match(mainSource, /processMatchesTitle \|\| titleMatches/, 'unconfigured Store games must still match the selected game identity');
assert.match(mainSource, /game\.launchType !== 'microsoftStore'\) return false/, 'unknown local processes must never be accepted as a game snapshot');
assert.match(mainSource, /kind: 'snapshot'[\s\S]*kind: 'cover'[\s\S]*kind: 'generated'/, 'snapshot must fall back to game artwork and then an opaque generated backdrop');
assert.match(mainSource, /quickOverlaySnapshotIsUsable/, 'blank hardware-capture frames must be rejected');
assert.match(mainSource, /quickOverlay:backdrop/);
assert.match(mainSource, /quickOverlay:backdropReady/);
assert.match(mainSource, /backgroundThrottling: false/);
assert.match(mainSource, /Preloaded the transparent quick-overlay renderer/);
assert.match(mainSource, /gameplayQuickOverlayShowPromise/);
assert.match(mainSource, /gameplayQuickOverlayPreparePromise/);
assert.match(mainSource, /reused prewarmed renderer/);
assert.match(mainSource, /performGameplayQuickOverlayShow[\s\S]*overlay\.setAlwaysOnTop\(true, 'screen-saver'\)[\s\S]*overlay\.show\(\)/);
assert.match(mainSource, /topmost restored: \$\{overlay\.isAlwaysOnTop\(\)\}/);
assert.match(mainSource, /status === 'running'[\s\S]*prepareGameplayQuickOverlayRenderer/);
assert.doesNotMatch(mainSource, /overlay\.setOpacity\(/);
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
assert.match(mainSource, /activeGameplayShouldOwnHome = launcher\.hasTrackedGames/);
assert.match(mainSource, /kioskInput\.currentMode === 'admin' && !activeGameplayShouldOwnHome/);
assert.match(mainSource, /active game takes priority over Admin mode/);
assert.match(mainSource, /gameplayQuickOverlayWindow[\s\S]*setAlwaysOnTop\(true, 'screen-saver'\)/);
assert.match(mainSource, /\['launching', 'running', 'quickOverlayOpen', 'resuming'\]/);
assert.match(mainSource, /if \(!hasActiveGame \|\| !gameplayContext\)/);
assert.match(mainSource, /gameplayQuickOverlayDesiredOpen = shouldOpen/);
assert.match(mainSource, /transitionGeneration !== gameplayQuickOverlayTransitionGeneration/);
assert.match(mainSource, /lowerGameplayQuickOverlayForResume[\s\S]*overlay\.setAlwaysOnTop\(false\)/);
assert.match(mainSource, /transitionGameplayQuickOverlay[\s\S]*launcher\.resumeActiveGame\(gameId\)/);
assert.match(mainSource, /shell:dismissQuickOverlay[\s\S]*transitionGameplayQuickOverlay\(false, 'renderer-request'\)/);
assert.doesNotMatch(mainSource, /Ignored overlapping Home request/);
assert.match(mainSource, /endPaidSession[\s\S]*openQuickNav: false,[\s\S]*resetToHome: true/);
assert.match(launcherSource, /if \(focusLauncher\) \{[\s\S]*this\.focusLauncher\(\);[\s\S]*\} else \{[\s\S]*this\.releaseLaunchShield\(\)/);
assert.match(launcherSource, /fastResumeError instanceof FocusOperationCanceledError/);
assert.match(
  launcherSource,
  /if \(game\) \{[\s\S]*releaseGameWindowsForQuickOverlay\(game, homeGeneration, focusLauncher\)/,
  'the dedicated gameplay overlay must release the game topmost lock before taking z-order'
);
assert.match(appSource, /if \(event\.resetToHome\) \{[\s\S]*resetToHome\(\)/);
assert.match(appSource, /setQuickNavOpen\(event\.openQuickNav \?\? false\)/);
assert.match(rendererMainSource, /isQuickOverlayWindow[\s\S]*document\.documentElement\.classList\.add\('quick-overlay-document'\)/);
assert.match(stylesSource, /html\.quick-overlay-document,[\s\S]*background: transparent/);
assert.match(overlayRootSource, /live-gameplay-overlay/);
assert.match(overlayRootSource, /backdropReadyRequestId !== renderRequestId/, 'overlay must wait for the safe backdrop before becoming paint-ready');
assert.match(overlayRootSource, /image\.onload = markPaintable/);
assert.match(overlayRootSource, /image\.onerror = markPaintable/);
assert.match(overlayRootSource, /notifyQuickOverlayBackdropReady/);
assert.match(overlayRootSource, /querySelector<HTMLElement>\('\.quick-navbar'\)/);
assert.match(overlayRootSource, /getBoundingClientRect\(\)/);
assert.match(overlayRootSource, /Number\(style\.opacity\) > 0/);
assert.doesNotMatch(overlayRootSource, /navigator\.mediaDevices\.getUserMedia/);
assert.doesNotMatch(overlayRootSource, /<canvas|<video/);
assert.match(stylesSource, /\.live-gameplay-overlay \.quick-overlay-shade,[\s\S]*animation: none/);
assert.match(stylesSource, /\.live-gameplay-overlay \.quick-home-overlay\s*\{[^}]*background:\s*#050912/s, 'gameplay overlay must always have an opaque safe base');
assert.match(stylesSource, /\.quick-overlay-backdrop-generated\s*\{[^}]*linear-gradient/s);
assert.match(stylesSource, /\.live-gameplay-overlay \.quick-navbar,[\s\S]*backdrop-filter: none/);
assert.match(preloadSource, /onQuickOverlayBackdrop/);
assert.match(overlayRootSource, /dismissQuickOverlay/);
assert.match(overlaySource, /props\.dismissResumesGame !== false/);
assert.match(overlaySource, /props\.backdrop \|\| safeBackdropImage/);

console.log('Home toggle, safe gameplay overlay, clean end-session, and dismiss/resume boundaries verified.');
