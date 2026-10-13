import { useCallback, useEffect, useRef, useState } from 'react';
import { Lock, X } from 'lucide-react';
import { useControllerNavigation, type ControllerNavigationEvent } from '../../controllerNavigation';

export function PinDialog(props: {
  title: string;
  message?: string;
  actionLabel: string;
  pendingLabel: string;
  onClose: () => void;
  onSubmit: (pin: string) => Promise<boolean>;
}): JSX.Element {
  const [pin, setPin] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const keypad = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Clear', '0', 'Submit'] as const;
  const [keypadIndex, setKeypadIndex] = useState(0);
  const [focusArea, setFocusArea] = useState<'keypad' | 'unlock'>('keypad');
  const keypadRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const unlockButtonRef = useRef<HTMLButtonElement | null>(null);

  const submitPin = useCallback(async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const ok = await props.onSubmit(pin);
      if (!ok) setError('Invalid PIN.');
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  }, [pending, pin, props]);

  const activateKeypad = useCallback((): void => {
    const key = keypad[keypadIndex];
    if (key === 'Submit') void submitPin();
    else if (key === 'Clear') setPin((value) => value.slice(0, -1));
    else setPin((value) => `${value}${key}`.slice(0, 12));
  }, [keypad, keypadIndex, submitPin]);

  useEffect(() => {
    if (focusArea === 'unlock') unlockButtonRef.current?.focus({ preventScroll: true });
    else keypadRefs.current[keypadIndex]?.focus({ preventScroll: true });
  }, [focusArea, keypadIndex]);

  const movePinVertical = useCallback((direction: -1 | 1): void => {
    if (focusArea === 'unlock') {
      if (direction < 0) setFocusArea('keypad');
      return;
    }
    const row = Math.floor(keypadIndex / 3);
    if (direction > 0 && row === 3) {
      setFocusArea('unlock');
      return;
    }
    setKeypadIndex((index) => Math.max(0, Math.min(keypad.length - 1, index + direction * 3)));
  }, [focusArea, keypad.length, keypadIndex]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Backspace', 'b', 'B'].includes(event.key)) return;
      if (event.target instanceof HTMLInputElement && event.key === 'Backspace') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (pending) return;
      if (event.key === 'Escape' || event.key === 'Backspace' || event.key.toLowerCase() === 'b') props.onClose();
      else if (event.key === 'Enter') {
        if (event.target instanceof HTMLInputElement || focusArea === 'unlock') void submitPin();
        else activateKeypad();
      } else if (event.key === 'ArrowLeft' && focusArea === 'keypad') {
        setKeypadIndex((index) => (index - 1 + keypad.length) % keypad.length);
      } else if (event.key === 'ArrowRight' && focusArea === 'keypad') {
        setKeypadIndex((index) => (index + 1) % keypad.length);
      } else if (event.key === 'ArrowUp') {
        movePinVertical(-1);
      } else if (event.key === 'ArrowDown') {
        movePinVertical(1);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [activateKeypad, focusArea, keypad.length, movePinVertical, pending, props, submitPin]);

  const handlePinControllerEvent = useCallback((event: ControllerNavigationEvent): void => {
    if (event.type === 'back') {
      props.onClose();
      void window.nxgs.reportControllerState({ detected: true, name: event.pad.id, homeSupported: event.pad.buttons.length > 16 ? 'unknown' : 'no', lastButtonPressed: 'Circle / B', lastNavigationAction: 'PIN keypad: cancel' });
      return;
    }
    if (event.type === 'accept') {
      if (focusArea === 'unlock') void submitPin();
      else activateKeypad();
      void window.nxgs.reportControllerState({ detected: true, name: event.pad.id, homeSupported: event.pad.buttons.length > 16 ? 'unknown' : 'no', lastButtonPressed: 'X / A', lastNavigationAction: focusArea === 'unlock' ? 'PIN: unlock' : 'PIN keypad: select' });
      return;
    }
    if (event.direction === 'left' && focusArea === 'keypad') {
      setKeypadIndex((index) => (index - 1 + keypad.length) % keypad.length);
    } else if (event.direction === 'right' && focusArea === 'keypad') {
      setKeypadIndex((index) => (index + 1) % keypad.length);
    } else if (event.direction === 'up') {
      movePinVertical(-1);
    } else if (event.direction === 'down') {
      movePinVertical(1);
    }
  }, [activateKeypad, focusArea, keypad.length, movePinVertical, props, submitPin]);

  useControllerNavigation(!pending, handlePinControllerEvent);

  return (
    <div className="modal-backdrop">
      <form
        className="modal pin-modal"
        onSubmit={async (event) => {
          event.preventDefault();
          await submitPin();
        }}
      >
        <button className="icon-button close-button" type="button" title="Close" onClick={props.onClose} disabled={pending}>
          <X size={20} />
        </button>
        <Lock size={34} />
        <h2>{props.title}</h2>
        {props.message && <p className="muted">{props.message}</p>}
        <input type="password" value={pin} onChange={(event) => setPin(event.target.value)} />
        <div className="pin-keypad" aria-label="Controller PIN keypad">
          {keypad.map((key, index) => (
            <button
              ref={(element) => {
                keypadRefs.current[index] = element;
              }}
              key={key}
              type="button"
              className={focusArea === 'keypad' && index === keypadIndex ? 'selected' : ''}
              disabled={pending}
              onFocus={() => {
                setKeypadIndex(index);
                setFocusArea('keypad');
              }}
              onMouseEnter={() => {
                setKeypadIndex(index);
                setFocusArea('keypad');
              }}
              onClick={() => {
                setKeypadIndex(index);
                if (key === 'Submit') void submitPin();
                else if (key === 'Clear') setPin((value) => value.slice(0, -1));
                else setPin((value) => `${value}${key}`.slice(0, 12));
              }}
            >
              {key}
            </button>
          ))}
        </div>
        {error && <p className="error-text">{error}</p>}
        <button
          ref={unlockButtonRef}
          className={`primary-action wide ${focusArea === 'unlock' ? 'controller-focused' : ''}`}
          type="submit"
          disabled={pending}
          onFocus={() => setFocusArea('unlock')}
        >
          <Lock size={18} />
          {pending ? props.pendingLabel : props.actionLabel}
        </button>
      </form>
    </div>
  );
}
