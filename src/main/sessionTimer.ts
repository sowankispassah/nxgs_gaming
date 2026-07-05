import type { GameRecord, SessionState } from '../shared/types';

type SessionEvents = {
  onTick: (state: SessionState) => void;
  onExpired: (game: GameRecord) => void;
};

export class SessionTimer {
  private interval: NodeJS.Timeout | null = null;
  private state: SessionState = {
    status: 'idle',
    remainingSeconds: 0,
    warningFiveMinutes: false
  };
  private expiresAt = 0;
  private game: GameRecord | null = null;

  constructor(private readonly events: SessionEvents) {}

  get current(): SessionState {
    return { ...this.state };
  }

  setLaunching(game: GameRecord, durationMinutes: number): SessionState {
    this.game = game;
    this.state = {
      status: 'launching',
      gameId: game.id,
      gameTitle: game.title,
      durationMinutes,
      remainingSeconds: durationMinutes * 60,
      warningFiveMinutes: durationMinutes <= 5
    };
    this.events.onTick(this.current);
    return this.current;
  }

  start(game: GameRecord, durationMinutes: number): void {
    this.stop('idle', false);
    this.game = game;
    this.expiresAt = Date.now() + durationMinutes * 60 * 1000;
    this.state = {
      status: 'running',
      gameId: game.id,
      gameTitle: game.title,
      durationMinutes,
      remainingSeconds: durationMinutes * 60,
      warningFiveMinutes: durationMinutes <= 5
    };
    this.events.onTick(this.current);
    this.interval = setInterval(() => this.tick(), 1000);
  }

  expire(message = 'Session expired'): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    const game = this.game;
    this.state = {
      ...this.state,
      status: 'expired',
      remainingSeconds: 0,
      warningFiveMinutes: true,
      message
    };
    this.events.onTick(this.current);
    if (game) {
      this.events.onExpired(game);
    }
  }

  stop(status: SessionState['status'] = 'idle', notify = true): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.state = {
      status,
      remainingSeconds: 0,
      warningFiveMinutes: false
    };
    this.game = null;
    this.expiresAt = 0;
    if (notify) {
      this.events.onTick(this.current);
    }
  }

  setError(message: string): void {
    this.stop('error', false);
    this.state = {
      status: 'error',
      remainingSeconds: 0,
      warningFiveMinutes: false,
      message
    };
    this.events.onTick(this.current);
  }

  private tick(): void {
    const remainingSeconds = Math.max(0, Math.ceil((this.expiresAt - Date.now()) / 1000));
    this.state = {
      ...this.state,
      remainingSeconds,
      warningFiveMinutes: remainingSeconds <= 300
    };
    this.events.onTick(this.current);
    if (remainingSeconds <= 0) {
      this.expire();
    }
  }
}
