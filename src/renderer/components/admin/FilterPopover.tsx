import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useControllerNavigation, type ControllerNavigationEvent } from '../../controllerNavigation';
import { playUiSound } from '../../ui/uiSound';

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled)';
const TEXT_INPUT_TYPES = new Set(['email', 'number', 'password', 'search', 'tel', 'text', 'url']);

function isTextInput(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type);
}

/**
 * A filter button that opens a small panel under it.
 *
 * The button reads "Devices" while nothing is picked and "Devices | Station 01"
 * (or "| 3 devices") once the filter is on, styled like a selected toggle chip.
 *
 * The Control Room closes on Escape/B and switches sections on arrows, so key
 * presses inside an open popover stay here: Escape/B close the popover and
 * return focus to its button, Up/Down move between options, Enter toggles the
 * focused option. A controller drives it the same way while it is open.
 */
export function FilterPopover(props: {
  label: string;
  /** Short value, such as "All devices" or "3 games". Shown on the button while `active`; always read to screen readers. */
  value: string;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  /** Panel width in px (default 320). */
  width?: number;
  children: (close: () => void) => ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback((returnFocus = true): void => {
    setOpen(false);
    if (returnFocus) window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }, []);

  // Click or tap outside closes without stealing focus from what was clicked.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) close(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [close, open]);

  useEffect(() => {
    if (props.disabled && open) setOpen(false);
  }, [open, props.disabled]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!open) return;
    const back = event.key === 'Escape' || ((event.key === 'b' || event.key === 'B' || event.key === 'Backspace') && !isTextInput(event.target));
    if (back) {
      // Keep the key away from the Control Room and the app shell, which would close admin mode.
      event.preventDefault();
      event.stopPropagation();
      playUiSound('back');
      close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      moveFocus(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key.startsWith('Arrow') && !isTextInput(event.target)) {
      event.stopPropagation();
      return;
    }
    // The app shell swallows Enter on buttons; toggle the focused option here.
    if (event.key === 'Enter' && (event.target instanceof HTMLButtonElement || (event.target instanceof HTMLInputElement && event.target.type === 'checkbox'))) {
      event.preventDefault();
      event.target.click();
    }
  };

  const moveFocus = (delta: number): void => {
    const panel = rootRef.current?.querySelector<HTMLElement>('.admin-popover-panel');
    const items = [...(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = index < 0 ? (delta > 0 ? 0 : items.length - 1) : Math.max(0, Math.min(items.length - 1, index + delta));
    items[next].focus();
    items[next].scrollIntoView({ block: 'nearest' });
  };

  return (
    <div
      ref={rootRef}
      className={`admin-popover${open ? ' is-open' : ''}${props.className ? ` ${props.className}` : ''}`}
      data-admin-popover={open ? 'true' : undefined}
      data-admin-local-keys={open ? 'true' : undefined}
      onKeyDown={onKeyDown}
    >
      <button
        ref={triggerRef}
        className={`admin-popover-trigger${props.active ? ' is-active' : ''}`}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${props.label}: ${props.value}`}
        disabled={props.disabled}
        onClick={() => {
          playUiSound(open ? 'back' : 'open');
          setOpen((value) => !value);
        }}
      >
        <span className="admin-popover-label">{props.label}</span>
        {props.active && <span className="admin-popover-value" title={props.value}>{props.value}</span>}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <PopoverPanel label={props.label} width={props.width} onClose={() => close()} onMove={moveFocus}>
          {props.children(() => close())}
        </PopoverPanel>
      )}
    </div>
  );
}

function PopoverPanel(props: {
  label: string;
  width?: number;
  children: ReactNode;
  onClose: () => void;
  onMove: (delta: number) => void;
}): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
    // On short screens scroll the Control Room so the whole panel is visible.
    panelRef.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  // Mounted after the Control Room, so while open the controller drives the popover, not the sections.
  const handleController = (event: ControllerNavigationEvent): void => {
    if (event.type === 'back') {
      playUiSound('back');
      props.onClose();
    } else if (event.type === 'accept') {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && panelRef.current?.contains(focused)) focused.click();
    } else if (event.direction === 'up' || event.direction === 'down') {
      props.onMove(event.direction === 'down' ? 1 : -1);
    }
  };
  useControllerNavigation(true, handleController);

  return (
    <div
      ref={panelRef}
      className="admin-popover-panel"
      role="dialog"
      aria-label={props.label}
      style={props.width ? { width: `min(${props.width}px, calc(100vw - 48px))` } : undefined}
    >
      {props.children}
    </div>
  );
}
