import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [mainSource, preloadSource, launcherSource, windowManagerSource, windowsProcessSource, identitySource, appSource, rendererMainSource, overlayRootSource, overlaySource, stylesSource] = await Promise.all([
  readFile(new URL('../src/main/main.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/preload.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/gameLauncher.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/windowManagerService.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/windowsProcess.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/gameWindowIdentity.ts', import.meta.url), 'utf8'),
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
assert.match(
  mainSource,
  /safeCaptureHandles = new Set\(\[[\s\S]*gameWindow\.handle[\s\S]*rootWindowHandle[\s\S]*safeCaptureHandles\.has\(Number\(handle\)\)/,
  'snapshot must match only the tracked game window or its verified native root'
);
assert.match(identitySource, /UNSAFE_WINDOW_PROCESSES[\s\S]*'chatgpt'[\s\S]*'chrome'[\s\S]*'explorer'/, 'browser, Codex, and shell windows must never become game backdrops');
assert.match(identitySource, /processMatchesTitle \|\| titleMatches/, 'unconfigured Store games must still match the selected game identity');
assert.match(identitySource, /game\.launchType !== 'microsoftStore'\) return false/, 'unknown local processes must never be accepted as a game snapshot');
assert.match(
  identitySource,
  /actualProcess === 'applicationframehost'[\s\S]*titleMatches/,
  'configured Store games must accept only a correctly titled ApplicationFrameHost visual window'
);
assert.match(windowManagerSource, /unsafeProcess[\s\S]*'chatgpt'[\s\S]*'explorer'/, 'global window discovery must reject unrelated apps');
assert.doesNotMatch(windowManagerSource, /allowUntitledStoreFrame/, 'untitled Explorer Store frames must never be treated as games');
assert.match(windowManagerSource, /allowVerifiedShellHostedStoreFrame[\s\S]*\$targetProcess[\s\S]*ApplicationFrameWindow/, 'shell-hosted Store frames require an exact package process');
assert.match(windowManagerSource, /\$shellHostedCandidates\.Count -gt 1[\s\S]*score -ne 3/, 'ambiguous shell-hosted Store frames must be rejected');
assert.match(
  windowManagerSource,
  /isProvisionalShellHostedStoreWindow[\s\S]*provisionalDetectedAt[\s\S]*2500[\s\S]*return provisionalWindow/,
  'Store launch discovery must wait briefly for the real visual frame before accepting a blank shell fallback'
);
assert.match(
  launcherSource,
  /game\.launchType === 'microsoftStore'[\s\S]*findGameWindow[\s\S]*getForegroundWindowInfo[\s\S]*gameWindowMatchesGame[\s\S]*Reconciled \$\{game\.title\} visual window/,
  'overlay capture must re-probe every Store visual window and reject provisional frames'
);
assert.match(
  launcherSource,
  /foregroundWindow[\s\S]*gameWindowMatchesGame\(game, candidate, this\.activeProcessId\)/,
  'a foreground candidate must pass selected-game identity checks before it can replace a Store shell frame'
);
assert.match(
  windowManagerSource,
  /titleMatchesHint[\s\S]*\$windowPid -eq \$targetPid -or \$titleMatchesHint[\s\S]*Sort-Object score,[\s\S]*foreground/,
  'duplicate Store frames must prefer the titled or foreground frame for the exact tracked process'
);
assert.match(launcherSource, /allowVerifiedShellHostedStoreFrame:[\s\S]*game\.launchType === 'microsoftStore'[\s\S]*Boolean\(this\.activeProcessId\)/, 'shell-hosted discovery must be scoped to a tracked Store process');
assert.match(windowsProcessSource, /Get-AppxPackageManifest[\s\S]*application\.Executable/, 'Store games must bind to their package application executable');
assert.match(launcherSource, /Bound \$\{game\.title\} to Microsoft Store process/, 'Store launch must retain the discovered process identity');
assert.equal(
  launcherSource.match(/activateMicrosoftStoreApp\(appUserModelId\);/g)?.length,
  2,
  'Store games must be reactivated after their exact package process is ready so the real game frame becomes visible'
);
assert.match(mainSource, /kind: 'live'[\s\S]*kind: 'cover'[\s\S]*kind: 'generated'/, 'exact live capture must fall back to game artwork and then an opaque generated backdrop');
assert.doesNotMatch(mainSource, /stageQuickOverlayBackdropWindow\(gameWindow\)[\s\S]*kind: 'direct'/, 'blank captures must never expose unrelated desktop windows through a transparent direct backdrop');
assert.match(mainSource, /if \(exactWindowSource\)[\s\S]*thumbnail usable[\s\S]*kind: 'live'/, 'an exact UWP source must be tried as a live stream even when its thumbnail is blank');
assert.match(mainSource, /snapshotIsUsable \? exactWindowSource\.thumbnail\.toDataURL\(\) : coverImage/, 'blank thumbnails may be posters but must not reject exact live capture');
assert.match(mainSource, /posterKind === 'snapshot'[\s\S]*kind: 'snapshot'/, 'a real game-window snapshot must be preserved ahead of cover art when live decoding fails');
assert.match(mainSource, /quickOverlay:backdrop/);
assert.match(mainSource, /quickOverlay:backdropReady/);
assert.match(mainSource, /backgroundThrottling: false/);
assert.match(mainSource, /Preloaded the transparent quick-overlay renderer/);
assert.match(mainSource, /gameplayQuickOverlayShowPromise/);
assert.match(mainSource, /gameplayQuickOverlayPreparePromise/);
assert.match(mainSource, /reused prewarmed renderer/);
assert.match(mainSource, /await gameplayQuickOverlayPreparePromise[\s\S]*gameplayQuickOverlayPreparedBackdropKind === 'live'[\s\S]*return/, 'concurrent Home requests must reuse the already-decoding live stream instead of recapturing it');
assert.match(mainSource, /performGameplayQuickOverlayShow[\s\S]*overlay\.setAlwaysOnTop\(true, 'screen-saver'\)[\s\S]*overlay\.show\(\)/);
assert.match(mainSource, /topmost restored: \$\{overlay\.isAlwaysOnTop\(\)\}/);
assert.match(
  mainSource,
  /enforceGameplayQuickOverlayZOrder\(overlay\)[\s\S]*gameplayQuickOverlayNativeZOrderVerified/,
  'overlay visibility must be backed by native z-order verification'
);
assert.match(
  windowManagerSource,
  /enforceQuickOverlayZOrder[\s\S]*SetWindowPos\(\$game, \$notTopMost[\s\S]*SetWindowPos\(\$overlay, \$topMost[\s\S]*AttachThreadInput[\s\S]*SystemParametersInfo[\s\S]*overlayAboveGame[\s\S]*overlayForeground/,
  'the game topmost lock must be released before NXGS takes the topmost band and foreground input'
);
assert.match(
  mainSource,
  /getRootWindowHandle\(gameWindow\.handle\)[\s\S]*safeCaptureHandles[\s\S]*exactWindowSource/,
  'UWP capture must resolve the verified tracked CoreWindow to its exact root frame'
);
assert.match(mainSource, /prepareGameplayQuickOverlayRenderer\(true\)[\s\S]*gameplayQuickOverlayPreparedBackdropKind !== 'live'[\s\S]*prepareGameplayQuickOverlayRenderer\(true\)[\s\S]*overlay\.show\(\)/, 'live capture must be retried before the overlay can show a safe poster');
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
assert.match(
  mainSource,
  /Home is a one-way request[\s\S]*transitionGameplayQuickOverlay\(true, reason\)/,
  'external Home shortcuts must always show the gameplay overlay instead of toggling stale state'
);
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
  /if \(game && focusLauncher\) \{[\s\S]*releaseGameWindowsForQuickOverlay\(game, homeGeneration, focusLauncher\)/,
  'overlay-only Home must not race live capture by releasing the game topmost lock'
);
assert.match(launcherSource, /Discarded stale or unrelated cached window/, 'cached resume handles must be identity-checked');
assert.match(appSource, /if \(event\.resetToHome\) \{[\s\S]*resetToHome\(\)/);
assert.match(appSource, /setQuickNavOpen\(event\.openQuickNav \?\? false\)/);
assert.match(rendererMainSource, /isQuickOverlayWindow[\s\S]*document\.documentElement\.classList\.add\('quick-overlay-document'\)/);
assert.match(stylesSource, /html\.quick-overlay-document,[\s\S]*background: transparent/);
assert.match(overlayRootSource, /live-gameplay-overlay/);
assert.match(overlayRootSource, /backdropReadyRequestId !== renderRequestId/, 'overlay must wait for the safe backdrop before becoming paint-ready');
assert.match(overlayRootSource, /backdrop\.kind === 'live'[\s\S]*probe\.onloadeddata[\s\S]*markPaintable/, 'live readiness must require a decoded game video frame');
assert.match(overlayRootSource, /notifyQuickOverlayBackdropFailed/, 'live capture failures must be reported instead of accepting the poster as live');
assert.match(overlayRootSource, /notifyQuickOverlayBackdropReady/);
assert.match(overlayRootSource, /querySelector<HTMLElement>\('\.quick-navbar'\)/);
assert.match(overlayRootSource, /getBoundingClientRect\(\)/);
assert.match(overlayRootSource, /Number\(style\.opacity\) > 0/);
assert.match(overlayRootSource, /chromeMediaSourceId: backdrop\.sourceId/, 'live capture must use only the exact main-process source id');
assert.match(overlayRootSource, /navigator\.mediaDevices\.getUserMedia\(constraints\)/);
assert.match(overlaySource, /quick-overlay-game-video/);
assert.match(stylesSource, /\.live-gameplay-overlay \.quick-overlay-shade,[\s\S]*animation: none/);
assert.match(stylesSource, /\.live-gameplay-overlay \.quick-home-overlay\s*\{[^}]*background:\s*#050912/s, 'gameplay overlay must always have an opaque safe base');
assert.match(stylesSource, /\.quick-overlay-game-video\s*\{[^}]*background:\s*#050912/s, 'live capture must remain opaque if a frame is unavailable');
assert.match(stylesSource, /\.quick-overlay-backdrop-generated\s*\{[^}]*linear-gradient/s);
assert.match(stylesSource, /\.live-gameplay-overlay \.quick-navbar,[\s\S]*backdrop-filter: none/);
assert.match(preloadSource, /onQuickOverlayBackdrop/);
assert.match(overlayRootSource, /dismissQuickOverlay/);
assert.match(overlaySource, /props\.dismissResumesGame !== false/);
assert.match(overlaySource, /props\.backdrop \|\| safeBackdropImage/);

console.log('Home toggle, exact live game capture, clean end-session, and dismiss/resume boundaries verified.');
