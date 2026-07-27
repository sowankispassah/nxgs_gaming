import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [mainSource, preloadSource, launcherSource, windowManagerSource, windowsControlSource, windowsProcessSource, identitySource, appSource, rendererMainSource, overlayRootSource, overlaySource, stylesSource] = await Promise.all([
  readFile(new URL('../src/main/main.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/preload.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/gameLauncher.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/windowManagerService.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/windowsControlWorker.ts', import.meta.url), 'utf8'),
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
assert.match(
  windowManagerSource,
  /\$shellHostedCandidates\.Count -gt 1[\s\S]*\$foregroundShellHosted\.Count -eq 1[\s\S]*\$foregroundHandle[\s\S]*score -ne 3/,
  'ambiguous shell-hosted Store frames must retain only one foreground frame and reject the rest'
);
assert.match(
  windowManagerSource,
  /isProvisionalShellHostedStoreWindow[\s\S]*provisionalDetectedAt[\s\S]*2500[\s\S]*return provisionalWindow/,
  'Store launch discovery must wait briefly for the real visual frame before accepting a blank shell fallback'
);
assert.match(
  launcherSource,
  /game\.launchType === 'microsoftStore'[\s\S]*findGameWindow[\s\S]*getForegroundWindowInfo[\s\S]*isProvisionalShellHostedStoreWindow[\s\S]*Using process-bound shell-hosted visual window/,
  'overlay staging must re-probe Store windows and retain a process-bound shell frame when Windows publishes no titled child HWND'
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
assert.match(mainSource, /kind: 'direct'[\s\S]*kind: 'live'[\s\S]*kind: 'cover'[\s\S]*kind: 'generated'/, 'the tracked live game must precede capture, artwork, and generated fallbacks');
assert.match(mainSource, /Prepared direct live game backdrop[\s\S]*capturedWindowHandle: gameWindow\.handle/, 'direct mode must be tied to the tracked game HWND');
assert.match(mainSource, /shellHostedStoreFrame[\s\S]*Prewarming exact capture for shell-hosted Store frame/, 'shell-hosted Store frames must prewarm exact capture instead of relying on unsafe direct composition');
assert.match(
  mainSource,
  /shellHostedStoreFrame[\s\S]*hostProcessName[\s\S]*windowProcessName/,
  'Store capture fallback must depend on the actual Windows host process, not the ApplicationFrameWindow class alone'
);
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
assert.match(mainSource, /await gameplayQuickOverlayPreparePromise[\s\S]*preparedBackdropIsAcceptable\(\)[\s\S]*return/, 'concurrent Home requests must reuse an already-prepared direct or captured live backdrop');
assert.match(mainSource, /performGameplayQuickOverlayShow[\s\S]*overlay\.setAlwaysOnTop\(true, 'screen-saver'\)[\s\S]*overlay\.show\(\)/);
assert.match(mainSource, /topmost restored: \$\{overlay\.isAlwaysOnTop\(\)\}/);
assert.match(
  mainSource,
  /enforceGameplayQuickOverlayZOrder\(overlay\)[\s\S]*gameplayQuickOverlayNativeZOrderVerified/,
  'overlay visibility must be backed by native z-order verification'
);
assert.match(
  windowManagerSource,
  /enforceQuickOverlayZOrder[\s\S]*SetWindowPos\(\$game, \$topMost[\s\S]*SetWindowPos\(\$overlay, \$topMost[\s\S]*AttachThreadInput[\s\S]*SystemParametersInfo[\s\S]*overlayAboveGame[\s\S]*overlayForeground/,
  'the exact game must be staged at the front before NXGS takes the topmost slot and foreground input'
);
assert.match(
  windowsControlSource,
  /public static string StageOverlay[\s\S]*SetWindowPos\(overlay, new IntPtr\(-1\)[\s\S]*foreground == overlay/,
  'the warm native worker must stage and verify the overlay window'
);
assert.match(
  windowsControlSource,
  /\$request\.command -eq 'stage-overlay'[\s\S]*\[NxgsWarningInput\]::StageOverlay/,
  'the persistent worker command loop must invoke native overlay staging without per-press PowerShell startup'
);
assert.match(
  windowsControlSource,
  /ShowWindow\(overlay, 5\)[\s\S]*IsWindowVisible\(overlay\)[\s\S]*ShowWindow\(game, 0\)/,
  'a composition-locked Store frame must stay visible until the painted overlay covers the display'
);
assert.match(windowsControlSource, /FocusWindow[\s\S]*EnableWindow\(window, true\)/, 'resume must ensure the tracked game accepts foreground input');
assert.doesNotMatch(windowsControlSource, /EnableWindow\(game, false\)/, 'opening Home must never disable the game and expose another desktop window');
assert.doesNotMatch(windowsControlSource, /SwitchToThisWindow/, 'overlay focus must not invoke Windows app switching');
assert.match(
  mainSource,
  /getRootWindowHandle\(gameWindow\.handle\)[\s\S]*safeCaptureHandles[\s\S]*exactWindowSource/,
  'UWP capture must resolve the verified tracked CoreWindow to its exact root frame'
);
assert.match(mainSource, /prepareGameplayQuickOverlayRenderer\(true\)[\s\S]*\['direct', 'live'\]\.includes[\s\S]*prepareGameplayQuickOverlayRenderer\(true\)[\s\S]*overlay\.show\(\)/, 'direct or captured live gameplay must be retried before the overlay shows a safe poster');
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
  /const shouldOpen = !gameplayQuickOverlayDesiredOpen[\s\S]*transitionGameplayQuickOverlay\(shouldOpen, reason\)/,
  'every external Home shortcut must flip the desired overlay state immediately'
);
assert.match(mainSource, /Coalesced duplicate \$\{reason\} Home input/, 'duplicate callbacks from one physical press must be coalesced');
assert.match(mainSource, /activeGameplayShouldOwnHome = launcher\.hasTrackedGames/);
assert.match(mainSource, /kioskInput\.currentMode === 'admin' && !activeGameplayShouldOwnHome/);
assert.match(mainSource, /active game takes priority over Admin mode/);
assert.match(mainSource, /gameplayQuickOverlayWindow[\s\S]*setAlwaysOnTop\(true, 'screen-saver'\)/);
assert.match(mainSource, /\['launching', 'running', 'quickOverlayOpen', 'resuming'\]/);
assert.match(mainSource, /if \(!hasActiveGame \|\| !gameplayContext\)/);
assert.match(mainSource, /gameplayQuickOverlayDesiredOpen = shouldOpen/);
assert.match(mainSource, /transitionGeneration !== gameplayQuickOverlayTransitionGeneration/);
assert.match(
  mainSource,
  /gameplayQuickOverlayTransitionQueue[\s\S]*was superseded before touching native focus/,
  'rapid Home requests must be serialized and stale requests must not touch foreground ownership'
);
assert.match(
  mainSource,
  /protectGameplayQuickOverlayDuringResume[\s\S]*overlay\.setAlwaysOnTop\(true, 'screen-saver'\)/,
  'the painted overlay must remain topmost until the tracked game is confirmed foreground'
);
assert.doesNotMatch(
  mainSource,
  /status === 'running'[\s\S]{0,260}(?:showGameplayQuickOverlay|hideGameplayQuickOverlay)/,
  'launcher state broadcasts must not start competing overlay focus transitions'
);
assert.match(mainSource, /if \(result\.ok\)[\s\S]*hideGameplayQuickOverlay\(\)/, 'hiding must retain the prewarmed backdrop for the next deterministic toggle');
assert.match(mainSource, /performGameplayQuickOverlayTransition[\s\S]*launcher\.resumeActiveGame\(gameId\)/);
assert.match(mainSource, /shell:dismissQuickOverlay[\s\S]*transitionGameplayQuickOverlay\(false, 'renderer-request'\)/);
assert.doesNotMatch(mainSource, /Ignored overlapping Home request/);
assert.match(mainSource, /endPaidSession[\s\S]*openQuickNav: false,[\s\S]*resetToHome: true/);
assert.match(launcherSource, /if \(focusLauncher\) \{[\s\S]*this\.focusLauncher\(\);[\s\S]*\} else \{[\s\S]*this\.releaseLaunchShield\(\)/);
assert.match(launcherSource, /fastResumeError instanceof FocusOperationCanceledError/);
assert.match(
  launcherSource,
  /if \(storeLaunchMayStillBePending\)[\s\S]*status: 'running'[\s\S]*finishes detecting its Store window/,
  'a late Store window must remain in gameplay instead of opening Home automatically'
);
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
assert.match(stylesSource, /\.live-gameplay-overlay \.quick-home-overlay\.direct-game-backdrop\s*\{[^}]*background:\s*transparent/s, 'verified direct gameplay must remain visible through the overlay');
assert.match(stylesSource, /\.quick-overlay-game-video\s*\{[^}]*background:\s*#050912/s, 'live capture must remain opaque if a frame is unavailable');
assert.match(mainSource, /getWindowCaptureTopInset\(capturedHandle\)[\s\S]*cropTopPx/, 'captured window chrome must be cropped from the fallback frame');
assert.match(
  windowManagerSource,
  /MonitorFromWindow[\s\S]*rcMonitor\.Top - \$windowRect\.Top[\s\S]*Math\]::Max\(\$clientInset, \$offscreenInset\)/,
  'captured fullscreen windows must crop both native chrome and their hidden off-screen top margin'
);
assert.match(overlaySource, /captureCropStyle[\s\S]*cropTopPx/, 'renderer must apply the native capture crop');
assert.doesNotMatch(appSource, /requestShellHome\('renderer-request'\)/, 'renderer key handling must not duplicate the global Home shortcut');
assert.match(stylesSource, /\.quick-overlay-backdrop-generated\s*\{[^}]*linear-gradient/s);
assert.match(stylesSource, /\.live-gameplay-overlay \.quick-navbar,[\s\S]*backdrop-filter: none/);
assert.match(preloadSource, /onQuickOverlayBackdrop/);
assert.match(overlayRootSource, /dismissQuickOverlay/);
assert.match(overlaySource, /props\.dismissResumesGame !== false/);
assert.match(overlaySource, /props\.backdrop \|\| safeBackdropImage/);

console.log('Home toggle, exact live game capture, clean end-session, and dismiss/resume boundaries verified.');
