import type { GameLaunchMode } from '../shared/types';

export const CONSOLE_GAME_LAUNCH_MODE: GameLaunchMode = 'fullscreen';
export const FULLSCREEN_EDGE_TOLERANCE_PX = 4;

export interface GamePresentationSnapshot {
  foregroundHandle: number;
  isForeground: boolean;
  isMinimized: boolean;
  isVisible: boolean;
  hasWindowChrome: boolean;
  height: number;
  monitorHeight: number;
  monitorWidth: number;
  monitorX: number;
  monitorY: number;
  width: number;
  x: number;
  y: number;
}

export function gamePresentationFailures(
  state: GamePresentationSnapshot | null,
  taskbarVisible = false
): string[] {
  if (!state) {
    return ['no native window state was returned'];
  }

  const failures: string[] = [];
  const tolerance = FULLSCREEN_EDGE_TOLERANCE_PX;
  const monitorRight = state.monitorX + state.monitorWidth;
  const monitorBottom = state.monitorY + state.monitorHeight;
  const windowRight = state.x + state.width;
  const windowBottom = state.y + state.height;

  if (!state.isVisible) failures.push('window is not visible');
  if (state.isMinimized) failures.push('window is minimized');
  if (!state.isForeground) failures.push('window is not foreground');
  if (state.hasWindowChrome) failures.push('title bar or resizable border is still present');
  if (state.monitorWidth <= 0 || state.monitorHeight <= 0) {
    failures.push('monitor bounds are unavailable');
  } else if (
    state.x > state.monitorX + tolerance ||
    state.y > state.monitorY + tolerance ||
    windowRight < monitorRight - tolerance ||
    windowBottom < monitorBottom - tolerance
  ) {
    failures.push(
      `window ${state.width}x${state.height}@${state.x},${state.y} does not cover monitor ` +
        `${state.monitorWidth}x${state.monitorHeight}@${state.monitorX},${state.monitorY}`
    );
  }
  if (taskbarVisible) failures.push('Windows taskbar is visible');

  return failures;
}

export function isFullscreenGamePresentation(
  state: GamePresentationSnapshot | null,
  taskbarVisible = false
): boolean {
  return gamePresentationFailures(state, taskbarVisible).length === 0;
}

export function describeGamePresentation(
  state: GamePresentationSnapshot | null,
  taskbarVisible = false
): string {
  if (!state) {
    return `invalid: ${gamePresentationFailures(state, taskbarVisible).join('; ')}`;
  }
  const failures = gamePresentationFailures(state, taskbarVisible);
  const geometry =
    `window=${state.width}x${state.height}@${state.x},${state.y}, ` +
    `monitor=${state.monitorWidth}x${state.monitorHeight}@${state.monitorX},${state.monitorY}, ` +
    `foreground=${state.isForeground}, visible=${state.isVisible}, minimized=${state.isMinimized}, ` +
    `chrome=${state.hasWindowChrome}, taskbar=${taskbarVisible}`;
  return failures.length === 0 ? `valid: ${geometry}` : `invalid (${failures.join('; ')}): ${geometry}`;
}
