import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Delete, LoaderCircle, Lock, LockKeyhole, X } from 'lucide-react';
import { useControllerNavigation, type ControllerNavigationEvent } from '../../controllerNavigation';
import { ControllerHints } from '../../ui/ControllerHints';
import { playUiSound } from '../../ui/uiSound';

const MIN_PIN_SLOTS = 4;
const MAX_PIN_SLOTS = 12;

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
      if (!ok) {
        setError('Invalid PIN.');
        playUiSound('error');
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      playUiSound('error');
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

  const movePinHorizontal = useCallback((direction: -1 | 1): void => {
    if (focusArea !== 'keypad') return;
    playUiSound('move');
    setKeypadIndex((index) => (index + direction + keypad.length) % keypad.length);
  }, [focusArea, keypad.length]);

  const movePinVertical = useCallback((direction: -1 | 1): void => {
    if (focusArea === 'unlock') {
      if (direction < 0) {
        playUiSound('move');
        setFocusArea('keypad');
      }
      return;
    }
    const row = Math.floor(keypadIndex / 3);
    if (direction > 0 && row === 3) {
      playUiSound('move');
      setFocusArea('unlock');
      return;
    }
    const next = Math.max(0, Math.min(keypad.length - 1, keypadIndex + direction * 3));
    if (next !== keypadIndex) playUiSound('move');
    setKeypadIndex(next);
  }, [focusArea, keypad.length, keypadIndex]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Backspace', 'b', 'B'].includes(event.key)) return;
      if (event.target instanceof HTMLInputElement && event.key === 'Backspace') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (pending) return;
      if (event.key === 'Escape' || event.key === 'Backspace' || event.key.toLowerCase() === 'b') {
        playUiSound('back');
        props.onClose();
      } else if (event.key === 'Enter') {
        playUiSound('select');
        if (event.target instanceof HTMLInputElement || focusArea === 'unlock') void submitPin();
        else activateKeypad();
      } else if (event.key === 'ArrowLeft') {
        movePinHorizontal(-1);
      } else if (event.key === 'ArrowRight') {
        movePinHorizontal(1);
      } else if (event.key === 'ArrowUp') {
        movePinVertical(-1);
      } else if (event.key === 'ArrowDown') {
        movePinVertical(1);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [activateKeypad, focusArea, movePinHorizontal, movePinVertical, pending, props, submitPin]);

  const handlePinControllerEvent = useCallback((event: ControllerNavigationEvent): void => {
    if (event.type === 'back') {
      playUiSound('back');
      props.onClose();
      void window.nxgs.reportControllerState({ detected: true, name: event.pad.id, homeSupported: event.pad.buttons.length > 16 ? 'unknown' : 'no', lastButtonPressed: 'Circle / B', lastNavigationAction: 'PIN keypad: cancel' });
      return;
    }
    if (event.type === 'accept') {
      playUiSound('select');
      if (focusArea === 'unlock') void submitPin();
      else activateKeypad();
      void window.nxgs.reportControllerState({ detected: true, name: event.pad.id, homeSupported: event.pad.buttons.length > 16 ? 'unknown' : 'no', lastButtonPressed: 'X / A', lastNavigationAction: focusArea === 'unlock' ? 'PIN: unlock' : 'PIN keypad: select' });
      return;
    }
    if (event.direction === 'left') {
      movePinHorizontal(-1);
    } else if (event.direction === 'right') {
      movePinHorizontal(1);
    } else if (event.direction === 'up') {
      movePinVertical(-1);
    } else if (event.direction === 'down') {
      movePinVertical(1);
    }
  }, [activateKeypad, focusArea, movePinHorizontal, movePinVertical, props, submitPin]);

  useControllerNavigation(!pending, handlePinControllerEvent);

  const slotCount = Math.min(MAX_PIN_SLOTS, Math.max(MIN_PIN_SLOTS, pin.length));

  return (
    <div className="modal-backdrop pin-backdrop">
      <form
        className="modal pin-modal"
        aria-labelledby="pin-dialog-title"
        onSubmit={async (event) => {
          event.preventDefault();
          await submitPin();
        }}
      >
        <button className="icon-button close-button" type="button" title="Close" aria-label="Close" onClick={props.onClose} disabled={pending}>
          <X size={20} />
        </button>
        <header className="pin-header">
          <span className="pin-lock" aria-hidden="true"><LockKeyhole size={30} /></span>
          <h2 id="pin-dialog-title">{props.title}</h2>
          {props.message && <p className="muted">{props.message}</p>}
        </header>
        <label className={`pin-field ${error ? 'has-error' : ''}`}>
          <input
            type="password"
            value={pin}
            aria-label="PIN"
            autoComplete="off"
            inputMode="numeric"
            onChange={(event) => setPin(event.target.value)}
          />
          <span className="pin-dots" aria-hidden="true">
            {Array.from({ length: slotCount }, (_, index) => (
              <span key={index} className={`pin-dot ${index < pin.length ? 'filled' : index === pin.length ? 'next' : ''}`} />
            ))}
          </span>
        </label>
        <p className="pin-error" role="alert">
          {error && <><AlertTriangle size={16} /> {error}</>}
        </p>
        <div className="pin-keypad" aria-label="Controller PIN keypad">
          {keypad.map((key, index) => (
            <button
              ref={(element) => {
                keypadRefs.current[index] = element;
              }}
              key={key}
              type="button"
              className={`pin-key ${key === 'Clear' || key === 'Submit' ? 'pin-key--action' : ''} ${focusArea === 'keypad' && index === keypadIndex ? 'selected' : ''}`}
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
              {key === 'Clear' ? (
                <>
                  <Delete size={26} aria-hidden="true" />
                  <span className="dialog-sr-only">Clear</span>
                </>
              ) : key === 'Submit' ? (
                <>
                  <Check size={28} aria-hidden="true" />
                  <span className="dialog-sr-only">Submit</span>
                </>
              ) : key}
            </button>
          ))}
        </div>
        <button
          ref={unlockButtonRef}
          className={`primary-action wide pin-unlock ${focusArea === 'unlock' ? 'controller-focused' : ''}`}
          type="submit"
          disabled={pending}
          onFocus={() => setFocusArea('unlock')}
        >
          {pending ? <LoaderCircle size={19} className="spin" /> : <Lock size={18} />}
          {pending ? props.pendingLabel : props.actionLabel}
        </button>
        <ControllerHints
          className="pin-hints"
          hints={[{ glyph: 'cross', label: 'Select' }, { glyph: 'circle', label: 'Cancel' }]}
        />
      </form>
    </div>
  );
}
