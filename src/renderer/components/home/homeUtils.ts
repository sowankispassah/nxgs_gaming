import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { ActiveGameState, GameRecord } from '../../../shared/types';

const INACTIVE_STATUSES = new Set(['idle', 'closed', 'error']);

export function imageCandidates(game: GameRecord | null, kind: 'avatar' | 'cover'): string[] {
  if (!game) return [];
  const paths = kind === 'avatar'
    ? [game.avatarImagePath, game.coverImagePath]
    : [game.coverImagePath, game.avatarImagePath];
  return [...new Set(paths.filter((path): path is string => Boolean(path?.trim())))];
}

export function formatSessionTime(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

/** Position class for a tile relative to the selected (anchored) tile of a row. */
export function tileSlotClass(slot: number): string {
  return slot < 0 ? 'before' : slot === 0 ? 'current' : 'after';
}

/** Stable hue for a game's generated artwork placeholder. */
export function placeholderHue(title: string): number {
  let hash = 0;
  for (const character of title) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return 190 + (hash % 120);
}

export function hasActiveGame(activeGame: ActiveGameState): boolean {
  return Boolean(activeGame.game && !INACTIVE_STATUSES.has(activeGame.status));
}

/** Ids of every game that is currently running, including background sessions. */
export function runningGameIds(activeGame: ActiveGameState): Set<string> {
  const ids = new Set<string>();
  if (activeGame.game && hasActiveGame(activeGame) && activeGame.status !== 'launching') {
    ids.add(activeGame.game.id);
  }
  for (const session of activeGame.sessions ?? []) {
    if (!INACTIVE_STATUSES.has(session.status)) ids.add(session.game.id);
  }
  return ids;
}

/** Layout width of a row caption, re-measured when its text or font changes. */
export function useMeasuredWidth<T extends HTMLElement>(measureKey: string): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = (): void => setWidth(element.offsetWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measureKey]);

  return [ref, width];
}
