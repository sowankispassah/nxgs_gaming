import { useEffect, useRef } from 'react';

export type ControllerDirection = 'left' | 'right' | 'up' | 'down';

export type ControllerNavigationEvent =
  | { type: 'direction'; direction: ControllerDirection; pad: Gamepad }
  | { type: 'accept'; pad: Gamepad }
  | { type: 'back'; pad: Gamepad };

export type ControllerHomeEvent = {
  pad: Gamepad;
  reason: 'guide' | 'options-share' | 'shoulder-options';
};

export const CONTROLLER_INITIAL_REPEAT_DELAY_MS = 300;
export const CONTROLLER_REPEAT_INTERVAL_MS = 150;
export const CONTROLLER_AXIS_ACTIVATION_THRESHOLD = 0.65;
export const CONTROLLER_AXIS_NEUTRAL_THRESHOLD = 0.4;

type EngineResult = {
  navigation: ControllerNavigationEvent[];
  home?: ControllerHomeEvent;
  connectionChanged: boolean;
  pad: Gamepad | null;
};

function buttonPressed(pad: Gamepad, index: number): boolean {
  return Boolean(pad.buttons[index]?.pressed);
}

function activatedDirection(pad: Gamepad): ControllerDirection | null {
  if (buttonPressed(pad, 15)) return 'right';
  if (buttonPressed(pad, 14)) return 'left';
  if (buttonPressed(pad, 13)) return 'down';
  if (buttonPressed(pad, 12)) return 'up';

  const horizontal = pad.axes[0] ?? 0;
  const vertical = pad.axes[1] ?? 0;
  if (
    Math.abs(horizontal) < CONTROLLER_AXIS_ACTIVATION_THRESHOLD &&
    Math.abs(vertical) < CONTROLLER_AXIS_ACTIVATION_THRESHOLD
  ) {
    return null;
  }
  if (Math.abs(horizontal) >= Math.abs(vertical)) {
    return horizontal > 0 ? 'right' : 'left';
  }
  return vertical > 0 ? 'down' : 'up';
}

function directionStillHeld(pad: Gamepad, direction: ControllerDirection): boolean {
  if (direction === 'right') return buttonPressed(pad, 15) || (pad.axes[0] ?? 0) > CONTROLLER_AXIS_NEUTRAL_THRESHOLD;
  if (direction === 'left') return buttonPressed(pad, 14) || (pad.axes[0] ?? 0) < -CONTROLLER_AXIS_NEUTRAL_THRESHOLD;
  if (direction === 'down') return buttonPressed(pad, 13) || (pad.axes[1] ?? 0) > CONTROLLER_AXIS_NEUTRAL_THRESHOLD;
  return buttonPressed(pad, 12) || (pad.axes[1] ?? 0) < -CONTROLLER_AXIS_NEUTRAL_THRESHOLD;
}

export class ControllerInputEngine {
  private activeDirection: ControllerDirection | null = null;
  private nextDirectionRepeatAt = 0;
  private acceptPressed = false;
  private backPressed = false;
  private homePressed = false;
  private controllerKey = 'none';

  reset(): void {
    this.activeDirection = null;
    this.nextDirectionRepeatAt = 0;
    this.acceptPressed = false;
    this.backPressed = false;
    this.homePressed = false;
  }

  update(pad: Gamepad | null, now: number): EngineResult {
    const controllerKey = pad ? `${pad.id}:${pad.mapping}:${pad.buttons.length}:${pad.axes.length}` : 'none';
    const connectionChanged = controllerKey !== this.controllerKey;
    this.controllerKey = controllerKey;
    if (!pad) {
      this.reset();
      return { navigation: [], connectionChanged, pad: null };
    }

    const navigation: ControllerNavigationEvent[] = [];
    const acceptDown = buttonPressed(pad, 0);
    const backDown = buttonPressed(pad, 1);
    const guideDown = buttonPressed(pad, 16) || buttonPressed(pad, 17);
    const optionsShareDown = buttonPressed(pad, 8) && buttonPressed(pad, 9);
    const shoulderOptionsDown = buttonPressed(pad, 4) && buttonPressed(pad, 5) && buttonPressed(pad, 9);
    const homeDown = guideDown || optionsShareDown || shoulderOptionsDown;
    const acceptJustPressed = acceptDown && !this.acceptPressed;
    const backJustPressed = backDown && !this.backPressed;
    const homeJustPressed = homeDown && !this.homePressed;
    this.acceptPressed = acceptDown;
    this.backPressed = backDown;
    this.homePressed = homeDown;

    let home: ControllerHomeEvent | undefined;
    if (homeJustPressed) {
      home = {
        pad,
        reason: guideDown ? 'guide' : optionsShareDown ? 'options-share' : 'shoulder-options'
      };
    }

    let direction: ControllerDirection | null = null;
    if (this.activeDirection && directionStillHeld(pad, this.activeDirection)) {
      direction = this.activeDirection;
    } else {
      direction = activatedDirection(pad);
    }

    if (!direction) {
      this.activeDirection = null;
      this.nextDirectionRepeatAt = 0;
    } else if (direction !== this.activeDirection) {
      this.activeDirection = direction;
      this.nextDirectionRepeatAt = now + CONTROLLER_INITIAL_REPEAT_DELAY_MS;
      navigation.push({ type: 'direction', direction, pad });
    } else if (now >= this.nextDirectionRepeatAt) {
      this.nextDirectionRepeatAt = now + CONTROLLER_REPEAT_INTERVAL_MS;
      navigation.push({ type: 'direction', direction, pad });
    }

    if (backJustPressed) navigation.push({ type: 'back', pad });
    else if (acceptJustPressed) navigation.push({ type: 'accept', pad });

    return { navigation, home, connectionChanged, pad };
  }
}

type NavigationSubscription = {
  enabled: { current: boolean };
  handler: { current: (event: ControllerNavigationEvent) => void };
};

type SystemSubscription = {
  onConnection: { current: (pad: Gamepad | null) => void };
  onHome: { current: (event: ControllerHomeEvent) => void };
};

class ControllerInputHub {
  private readonly engine = new ControllerInputEngine();
  private readonly navigationSubscriptions: NavigationSubscription[] = [];
  private readonly systemSubscriptions: SystemSubscription[] = [];
  private timer: number | null = null;

  subscribeNavigation(subscription: NavigationSubscription): () => void {
    this.navigationSubscriptions.push(subscription);
    this.ensurePolling();
    return () => {
      const index = this.navigationSubscriptions.indexOf(subscription);
      if (index >= 0) this.navigationSubscriptions.splice(index, 1);
      this.stopIfIdle();
    };
  }

  subscribeSystem(subscription: SystemSubscription): () => void {
    this.systemSubscriptions.push(subscription);
    this.ensurePolling();
    return () => {
      const index = this.systemSubscriptions.indexOf(subscription);
      if (index >= 0) this.systemSubscriptions.splice(index, 1);
      this.stopIfIdle();
    };
  }

  private ensurePolling(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => this.poll(), 50);
  }

  private stopIfIdle(): void {
    if (this.navigationSubscriptions.length > 0 || this.systemSubscriptions.length > 0 || this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
    this.engine.reset();
  }

  private poll(): void {
    const pad = Array.from(navigator.getGamepads?.() ?? []).find((candidate): candidate is Gamepad => Boolean(candidate)) ?? null;
    const result = this.engine.update(pad, performance.now());
    if (result.connectionChanged) {
      for (const subscription of this.systemSubscriptions) subscription.onConnection.current(result.pad);
    }
    if (result.home) {
      for (const subscription of this.systemSubscriptions) subscription.onHome.current(result.home);
      return;
    }
    const owner = [...this.navigationSubscriptions].reverse().find((subscription) => subscription.enabled.current);
    if (!owner) return;
    for (const event of result.navigation) owner.handler.current(event);
  }
}

const controllerInputHub = new ControllerInputHub();

export function useControllerNavigation(
  enabled: boolean,
  handler: (event: ControllerNavigationEvent) => void
): void {
  const enabledRef = useRef(enabled);
  const handlerRef = useRef(handler);
  enabledRef.current = enabled;
  handlerRef.current = handler;

  useEffect(
    () => controllerInputHub.subscribeNavigation({ enabled: enabledRef, handler: handlerRef }),
    []
  );
}

export function useControllerSystem(
  onConnection: (pad: Gamepad | null) => void,
  onHome: (event: ControllerHomeEvent) => void
): void {
  const connectionRef = useRef(onConnection);
  const homeRef = useRef(onHome);
  connectionRef.current = onConnection;
  homeRef.current = onHome;

  useEffect(
    () => controllerInputHub.subscribeSystem({ onConnection: connectionRef, onHome: homeRef }),
    []
  );
}
