import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Lock, LockOpen } from 'lucide-react';
import type { FleetErrorCode, OwnerUnlockResult } from '../../../shared/types';
import { PinDialog } from '../dialogs/PinDialog';
import { timeLabel } from './fleetFormat';

/**
 * Main admin (owner) PIN gate for the Control Room.
 *
 * The owner token lives only in the main process; the renderer just asks
 * whether a main admin session is open and, when it is not, shows the shared
 * PinDialog. Any owner call that comes back with `owner_pin_required` (the
 * 30 minute session ended) re-prompts once and retries.
 */

export const OWNER_PIN_MESSAGES = {
  accounts: 'Enter the main admin PIN to see every device.',
  fleet: 'Enter the main admin PIN to manage every device.',
  rejoin: 'Enter the main admin PIN to rejoin this device.',
  expired: 'The main admin session ended. Enter the PIN again.'
} as const;

type OwnerCallResult = { ok: boolean; code?: FleetErrorCode };

export interface OwnerSession {
  /** A main admin session is open in the main process (as far as the renderer knows). */
  unlocked: boolean;
  /** The main admin PIN dialog is on screen. */
  prompting: boolean;
  /** Resolves true once the main admin is unlocked, asking for the PIN when needed; false when cancelled. */
  ensureUnlocked: (message?: string) => Promise<boolean>;
  /** Runs an owner call; on `owner_pin_required` asks for the PIN again and retries once. */
  run: <T extends OwnerCallResult>(call: () => Promise<T>, message?: string) => Promise<T>;
  /** Ends the main admin session. */
  lock: () => Promise<void>;
  /** The PIN dialog element; render it once. */
  dialog: JSX.Element | null;
}

function unlockErrorMessage(result: OwnerUnlockResult): string {
  if (result.error) return result.error;
  if (result.code === 'owner_locked') {
    return result.lockedUntil
      ? `Too many wrong PINs. Try again after ${timeLabel(result.lockedUntil)}.`
      : 'Too many wrong PINs. Try again in a few minutes.';
  }
  if (result.code === 'offline') return 'This device is offline. Connect to the internet and try again.';
  if (result.code === 'not_configured' || result.code === 'not_deployed') return 'Device Management is not set up on this device.';
  return 'Could not check the main admin PIN. Try again.';
}

export function useOwnerSession(): OwnerSession {
  const [unlocked, setUnlocked] = useState(false);
  const [prompt, setPrompt] = useState<{ message: string } | null>(null);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);
  const pendingRef = useRef<Promise<boolean> | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const settle = useCallback((ok: boolean): void => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    pendingRef.current = null;
    setPrompt(null);
    resolve?.(ok);
    // Put keyboard focus back where it was before the PIN dialog took it.
    const returnFocus = returnFocusRef.current;
    returnFocusRef.current = null;
    window.requestAnimationFrame(() => {
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    });
  }, []);

  const requestPin = useCallback((message: string): Promise<boolean> => {
    if (pendingRef.current) return pendingRef.current;
    const pending = new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
    pendingRef.current = pending;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPrompt({ message });
    return pending;
  }, []);

  const ensureUnlocked = useCallback(async (message: string = OWNER_PIN_MESSAGES.accounts): Promise<boolean> => {
    try {
      const session = await window.nxgs.getOwnerSession();
      if (session.unlocked) {
        setUnlocked(true);
        return true;
      }
    } catch {
      // Fall through to the PIN prompt; unlockOwner reports the real problem.
    }
    setUnlocked(false);
    return requestPin(message);
  }, [requestPin]);

  const run = useCallback(async <T extends OwnerCallResult>(call: () => Promise<T>, message?: string): Promise<T> => {
    const first = await call();
    if (first.ok) setUnlocked(true);
    if (first.ok || first.code !== 'owner_pin_required') return first;
    setUnlocked(false);
    if (!(await requestPin(message ?? OWNER_PIN_MESSAGES.expired))) return first;
    const retry = await call();
    if (retry.code === 'owner_pin_required') setUnlocked(false);
    return retry;
  }, [requestPin]);

  const lock = useCallback(async (): Promise<void> => {
    setUnlocked(false);
    try {
      await window.nxgs.lockOwner();
    } catch {
      // The main process also clears the session when admin mode ends.
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    window.nxgs
      .getOwnerSession()
      .then((session) => {
        if (mounted) setUnlocked(session.unlocked);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
      // A screen that unmounts mid-prompt counts as cancelled.
      resolverRef.current?.(false);
      resolverRef.current = null;
      pendingRef.current = null;
    };
  }, []);

  const dialog = prompt
    ? createPortal(
      <PinDialog
        title="Main admin PIN"
        message={prompt.message}
        actionLabel="Unlock"
        pendingLabel="Checking..."
        onClose={() => settle(false)}
        onSubmit={async (pin) => {
          const result = await window.nxgs.unlockOwner(pin);
          if (result.ok) {
            setUnlocked(true);
            settle(true);
            return true;
          }
          if (result.code === 'invalid_owner_pin') return false;
          throw new Error(unlockErrorMessage(result));
        }}
      />,
      document.querySelector('.app-shell') ?? document.body
    )
    : null;

  // ensureUnlocked, run and lock are stable, so pages can list them as effect dependencies.
  return { unlocked, prompting: prompt !== null, ensureUnlocked, run, lock, dialog };
}

/** Header chip shown on main admin pages while the main admin session is open. */
export function OwnerSessionChip(props: { onLock: () => void }): JSX.Element {
  return (
    <span className="admin-owner-chip" role="status">
      <LockOpen size={16} aria-hidden="true" />
      <span>Main admin unlocked</span>
      <button className="secondary-action compact admin-owner-lock" type="button" onClick={props.onLock}>
        <Lock size={14} />
        Lock
      </button>
    </span>
  );
}
