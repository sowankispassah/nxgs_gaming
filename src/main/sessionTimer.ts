import type { SessionState } from '../shared/types';

type SessionEvents = {
  onTick: (state: SessionState) => void;
  onWarning: (minutesRemaining: 2) => void;
  onExpired: () => void;
};

export class SessionTimer {
  private readonly events: SessionEvents;
  private interval: NodeJS.Timeout | null = null;
  private state: SessionState = {
    status: 'idle',
    remainingSeconds: 0,
    warningFiveMinutes: false,
    revision: 0
  };
  private expiresAt = 0;
  private warned = new Set<number>();

  constructor(events: SessionEvents) {
    this.events = events;
  }

  get current(): SessionState {
    return { ...this.state };
  }

  get active(): boolean {
    return this.state.status === 'running' && this.state.remainingSeconds > 0;
  }

  start(durationMinutes: number): SessionState {
    this.stop('idle', false);
    this.expiresAt = Date.now() + durationMinutes * 60 * 1000;
    this.warned.clear();
    this.state = {
      status: 'running',
      durationMinutes,
      remainingSeconds: durationMinutes * 60,
      warningFiveMinutes: durationMinutes <= 5,
      expiresAt: new Date(this.expiresAt).toISOString(),
      revision: this.state.revision + 1
    };
    this.events.onTick(this.current);
    this.emitWarnings(this.state.remainingSeconds);
    this.interval = setInterval(() => this.tick(), 1000);
    return this.current;
  }

  extend(durationMinutes: number): SessionState {
    const remainingMilliseconds = this.state.status === 'running'
      ? Math.max(0, this.expiresAt - Date.now())
      : 0;
    this.stopInterval();
    this.expiresAt = Date.now() + remainingMilliseconds + durationMinutes * 60 * 1000;
    this.warned.clear();
    const remainingSeconds = Math.max(1, Math.ceil((this.expiresAt - Date.now()) / 1000));
    this.state = {
      status: 'running',
      durationMinutes: Math.ceil(remainingSeconds / 60),
      remainingSeconds,
      warningFiveMinutes: remainingSeconds <= 300,
      expiresAt: new Date(this.expiresAt).toISOString(),
      revision: this.state.revision + 1
    };
    this.events.onTick(this.current);
    this.emitWarnings(remainingSeconds);
    this.interval = setInterval(() => this.tick(), 1000);
    return this.current;
  }

  expire(message = 'Session expired'): void {
    this.stopInterval();
    this.state = {
      ...this.state,
      status: 'expired',
      remainingSeconds: 0,
      warningFiveMinutes: true,
      message
    };
    this.events.onTick(this.current);
    this.events.onExpired();
  }

  stop(status: SessionState['status'] = 'idle', notify = true): void {
    this.stopInterval();
    this.state = {
      status,
      remainingSeconds: 0,
      warningFiveMinutes: false,
      revision: this.state.revision
    };
    this.warned.clear();
    this.expiresAt = 0;
    if (notify) {
      this.events.onTick(this.current);
    }
  }

  private tick(): void {
    const remainingSeconds = Math.max(0, Math.ceil((this.expiresAt - Date.now()) / 1000));
    this.state = {
      ...this.state,
      remainingSeconds,
      warningFiveMinutes: remainingSeconds <= 300
    };
    this.events.onTick(this.current);
    this.emitWarnings(remainingSeconds);
    if (remainingSeconds <= 0) {
      this.expire();
    }
  }

  private emitWarnings(remainingSeconds: number): void {
    const minutes = 2 as const;
    if (remainingSeconds <= minutes * 60 && !this.warned.has(minutes)) {
      this.warned.add(minutes);
      this.events.onWarning(minutes);
    }
  }

  private stopInterval(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}
