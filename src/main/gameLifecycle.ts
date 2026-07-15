import type { GameRecord } from '../shared/types';

export const GRACEFUL_CLOSE_INITIAL_DELAY_MS = 1200;
export const GRACEFUL_CLOSE_RETRY_DELAY_MS = 900;
export const GRACEFUL_CLOSE_MAX_ATTEMPTS = 2;
export const PROCESS_MONITOR_INTERVAL_MS = 5000;

export function hasReliableProcessIdentity(
  game: GameRecord,
  activeProcessId: number | null,
  activeWindowProcessName?: string
): boolean {
  if (game.processName?.trim()) {
    return true;
  }

  const shellHosted = /^(applicationframehost|explorer)$/i.test(activeWindowProcessName?.trim() ?? '');
  return Boolean(activeProcessId && activeProcessId > 0 && !shellHosted);
}
