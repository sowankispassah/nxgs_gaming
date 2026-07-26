import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [mainSource, launcherSource, windowManagerSource, workerSource] = await Promise.all([
  readFile(new URL('../src/main/main.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/gameLauncher.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/windowManagerService.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/windowsControlWorker.ts', import.meta.url), 'utf8')
]);

assert.match(
  mainSource,
  /syncTaskbarForWindowPresentation[\s\S]*window\.isVisible\(\)[\s\S]*!window\.isMinimized\(\)[\s\S]*window\.isFullScreen\(\)/
);
assert.match(mainSource, /mainWindow\.on\('minimize'[\s\S]*setKioskTaskbarHidden\(false, 'launcher minimized'\)/);
assert.match(mainSource, /mainWindow\.on\('hide'[\s\S]*setKioskTaskbarHidden\(false, 'launcher hidden'\)/);
assert.match(mainSource, /mainWindow\.on\('leave-full-screen'[\s\S]*setKioskTaskbarHidden\(false, 'launcher left fullscreen'\)/);
assert.match(mainSource, /mainWindow\.on\('restore'[\s\S]*syncTaskbarForWindowPresentation/);
assert.match(mainSource, /stopWindowsControlWorker\(\);[\s\S]*restoreWindowsTaskbarSync\(\)/);
assert.match(
  launcherSource,
  /shouldSuppressTaskbarNow[\s\S]*window\.isVisible\(\)[\s\S]*!window\.isMinimized\(\)[\s\S]*window\.isFullScreen\(\)/
);
assert.match(windowManagerSource, /desiredTaskbarVisible/);
assert.match(windowManagerSource, /taskbarVisibilityReconcile/);
assert.match(windowManagerSource, /export function restoreWindowsTaskbarSync/);
assert.match(workerSource, /\| 'taskbar-visible'/);
assert.match(workerSource, /SetTaskbarVisible/);

console.log('Taskbar visibility is limited to active fullscreen NXGS presentation and restored on minimize, hide, windowed mode, and quit.');
