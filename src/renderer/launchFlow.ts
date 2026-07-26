import type { ActiveGameState } from '../shared/types';

export function hasConfirmedGameWindow(gameId: string, state: ActiveGameState): boolean {
  return state.game?.id === gameId
    && state.status === 'launching'
    && state.windowDetected === true;
}

export function shouldShowBlockingLaunchTransition(state: ActiveGameState): boolean {
  return state.status === 'launching';
}

export function shouldShowQuickGameOverlay(state: ActiveGameState): boolean {
  return state.status === 'quickOverlayOpen' || state.status === 'resuming';
}
