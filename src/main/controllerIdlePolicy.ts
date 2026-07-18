import type { ControllerIdleSettings } from '../shared/types';

export const CONTROLLER_SHUTDOWN_WARNING_MS = 30_000;
export const SESSION_END_IDLE_MS = 60_000;
export const SHUTDOWN_RETRY_COOLDOWN_MS = 5 * 60_000;

export interface IdleController {
  id: string;
  name: string;
  connection: 'bluetooth';
  lastActivityAt: number;
  sessionGraceStartedAt?: number;
  warningShown: boolean;
  shutdownPending: boolean;
  retryAfter: number;
}

export type ControllerIdleAction =
  | { type: 'warning'; controller: IdleController }
  | { type: 'warning-cancelled'; controller: IdleController }
  | { type: 'shutdown'; controller: IdleController };

export class ControllerIdlePolicy {
  private readonly controllers = new Map<string, IdleController>();
  private settings: ControllerIdleSettings;

  constructor(settings: ControllerIdleSettings) {
    this.settings = settings;
  }

  get connectedControllers(): IdleController[] {
    return [...this.controllers.values()].map((controller) => ({ ...controller }));
  }

  updateSettings(settings: ControllerIdleSettings): ControllerIdleAction[] {
    this.settings = settings;
    if (settings.autoTurnOffMinutes !== 0) return [];
    const actions: ControllerIdleAction[] = [];
    for (const controller of this.controllers.values()) {
      controller.sessionGraceStartedAt = undefined;
      controller.shutdownPending = false;
      if (controller.warningShown) {
        controller.warningShown = false;
        actions.push({ type: 'warning-cancelled', controller: { ...controller } });
      }
    }
    return actions;
  }

  connect(id: string, name: string, now: number): IdleController {
    const existing = this.controllers.get(id);
    const controller: IdleController = {
      id,
      name,
      connection: 'bluetooth',
      lastActivityAt: now,
      warningShown: false,
      shutdownPending: false,
      retryAfter: existing?.retryAfter ?? 0
    };
    this.controllers.set(id, controller);
    return { ...controller };
  }

  disconnect(id: string): IdleController | undefined {
    const controller = this.controllers.get(id);
    if (!controller) return undefined;
    this.controllers.delete(id);
    return { ...controller };
  }

  activity(id: string, now: number): ControllerIdleAction[] {
    const controller = this.controllers.get(id);
    if (!controller) return [];
    controller.lastActivityAt = now;
    controller.shutdownPending = false;
    if (controller.sessionGraceStartedAt !== undefined) controller.sessionGraceStartedAt = now;
    if (!controller.warningShown) return [];
    controller.warningShown = false;
    return [{ type: 'warning-cancelled', controller: { ...controller } }];
  }

  paidSessionEnded(now: number): void {
    if (this.settings.autoTurnOffMinutes === 0) return;
    for (const controller of this.controllers.values()) {
      if (controller.sessionGraceStartedAt === undefined) controller.sessionGraceStartedAt = now;
    }
  }

  shutdownFailed(id: string, now: number): void {
    const controller = this.controllers.get(id);
    if (!controller) return;
    controller.shutdownPending = false;
    controller.warningShown = false;
    controller.sessionGraceStartedAt = undefined;
    controller.lastActivityAt = now;
    controller.retryAfter = now + SHUTDOWN_RETRY_COOLDOWN_MS;
  }

  tick(now: number): ControllerIdleAction[] {
    if (this.settings.autoTurnOffMinutes === 0) return [];
    const actions: ControllerIdleAction[] = [];
    const normalTimeoutMs = this.settings.autoTurnOffMinutes * 60_000;
    for (const controller of this.controllers.values()) {
      if (controller.shutdownPending || now < controller.retryAfter) continue;
      const normalDeadline = controller.lastActivityAt + normalTimeoutMs;
      const sessionDeadline = controller.sessionGraceStartedAt === undefined
        ? Number.POSITIVE_INFINITY
        : controller.sessionGraceStartedAt + SESSION_END_IDLE_MS;
      const deadline = Math.min(normalDeadline, sessionDeadline);
      if (now >= deadline) {
        controller.shutdownPending = true;
        controller.warningShown = false;
        actions.push({ type: 'shutdown', controller: { ...controller } });
      } else if (this.settings.shutdownWarning && !controller.warningShown && now >= deadline - CONTROLLER_SHUTDOWN_WARNING_MS) {
        controller.warningShown = true;
        actions.push({ type: 'warning', controller: { ...controller } });
      }
    }
    return actions;
  }
}
