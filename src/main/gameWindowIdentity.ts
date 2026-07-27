import { basename, extname } from 'node:path';
import type { GameRecord } from '../shared/types';
import type { GameWindowInfo } from './windowManagerService';

const UNSAFE_WINDOW_PROCESSES = new Set([
  'brave',
  'chatgpt',
  'chrome',
  'code',
  'electron',
  'explorer',
  'firefox',
  'msedge',
  'nxgsplay',
  'opera'
]);

export function normalizeWindowIdentity(value: string): string {
  return value.replace(/\.exe$/i, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function isUnsafeGameWindowProcess(processName: string): boolean {
  const identity = normalizeWindowIdentity(processName);
  return !identity || UNSAFE_WINDOW_PROCESSES.has(identity);
}

export function gameWindowMatchesGame(
  game: GameRecord,
  window: GameWindowInfo,
  trackedProcessId?: number | null
): boolean {
  if (isUnsafeGameWindowProcess(window.processName)) return false;
  if (trackedProcessId && trackedProcessId > 0 && window.processId === trackedProcessId) return true;

  const actualProcess = normalizeWindowIdentity(window.processName);
  const configuredProcess = game.processName ||
    (game.launchType === 'localExe' ? basename(game.launchCommand, extname(game.launchCommand)) : '');
  const expectedProcess = normalizeWindowIdentity(configuredProcess);
  const expectedTitle = normalizeWindowIdentity(game.title);
  const actualTitle = normalizeWindowIdentity(window.title);
  const titleMatches = actualTitle.length >= 4 &&
    (actualTitle.includes(expectedTitle) || expectedTitle.includes(actualTitle));
  if (expectedProcess) {
    if (actualProcess === expectedProcess) return true;
    // Packaged games run their visual frame in ApplicationFrameHost even when
    // NXGS correctly tracks a different package executable PID. Accept only
    // that Windows host and only when its title identifies the selected Store
    // game; browsers, Explorer, Codex, and untitled frames remain rejected.
    return game.launchType === 'microsoftStore' &&
      actualProcess === 'applicationframehost' &&
      titleMatches;
  }
  if (game.launchType !== 'microsoftStore') return false;

  const processMatchesTitle = actualProcess.length >= 4 &&
    (actualProcess.includes(expectedTitle) || expectedTitle.includes(actualProcess));
  return processMatchesTitle || titleMatches;
}
