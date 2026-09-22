import type { KioskAdminAction } from '../shared/types';

export type SecretAdminKey = 'c' | 'e' | 'm';
export type SecretAdminAction = Extract<KioskAdminAction, 'closeApp' | 'exitFullscreen' | 'minimize'>;

const ACTION_BY_KEY: Record<SecretAdminKey, SecretAdminAction> = {
  c: 'closeApp',
  e: 'exitFullscreen',
  m: 'minimize'
};

export class SecretAdminSequence {
  private key: SecretAdminKey | null = null;
  private count = 0;
  private lastPressedAt = 0;
  private readonly requiredPresses: number;
  private readonly maximumGapMs: number;

  constructor(requiredPresses = 5, maximumGapMs = 1400) {
    this.requiredPresses = requiredPresses;
    this.maximumGapMs = maximumGapMs;
  }

  observe(rawKey: string, now = Date.now()): SecretAdminAction | null {
    const normalized = rawKey.toLowerCase();
    if (!(normalized in ACTION_BY_KEY)) {
      this.reset();
      return null;
    }

    const key = normalized as SecretAdminKey;
    if (key !== this.key || now - this.lastPressedAt > this.maximumGapMs) {
      this.key = key;
      this.count = 1;
    } else {
      this.count += 1;
    }
    this.lastPressedAt = now;

    if (this.count < this.requiredPresses) return null;
    const action = ACTION_BY_KEY[key];
    this.reset();
    return action;
  }

  reset(): void {
    this.key = null;
    this.count = 0;
    this.lastPressedAt = 0;
  }
}
