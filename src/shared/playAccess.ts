import type { AppSettings, SessionState } from './types';

export function isFreePlayEnabled(settings: Pick<AppSettings, 'playAccessMode'>): boolean {
  return settings.playAccessMode === 'free';
}

export function requiresPaymentForLaunch(
  settings: Pick<AppSettings, 'playAccessMode'>,
  session: Pick<SessionState, 'status' | 'remainingSeconds'>
): boolean {
  return !isFreePlayEnabled(settings) && (session.status !== 'running' || session.remainingSeconds <= 0);
}
