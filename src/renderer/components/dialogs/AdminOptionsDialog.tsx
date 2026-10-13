import { useCallback, useEffect, useRef, useState } from 'react';
import type { KioskAdminAction } from '../../../shared/types';
import { useControllerNavigation, type ControllerNavigationEvent } from '../../controllerNavigation';

export function AdminOptionsDialog(props: { onAction: (action: KioskAdminAction) => Promise<void> }): JSX.Element {
  const [pendingAction, setPendingAction] = useState<KioskAdminAction | null>(null);
  const [error, setError] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const actionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const actions: Array<{ action: KioskAdminAction; label: string; pendingLabel: string }> = [
    { action: 'minimize', label: 'Minimize App', pendingLabel: 'Minimizing...' },
    { action: 'exitFullscreen', label: 'Exit Full Screen', pendingLabel: 'Exiting...' },
    { action: 'openManagement', label: 'Open Management', pendingLabel: 'Opening...' },
    { action: 'closeApp', label: 'Close NXGS', pendingLabel: 'Closing...' }
  ];

  const runAction = useCallback(async (action: KioskAdminAction): Promise<void> => {
    if (pendingAction) return;
    setPendingAction(action);
    setError('');
    try {
      await props.onAction(action);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setPendingAction(null);
    }
  }, [pendingAction, props]);

  const selectedAction = selectedIndex < actions.length ? actions[selectedIndex].action : 'returnLocked';

  useEffect(() => {
    actionRefs.current[selectedIndex]?.focus({ preventScroll: true });
  }, [selectedIndex]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Backspace'].includes(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (pendingAction) return;
      if (event.key === 'Escape' || event.key === 'Backspace') void runAction('returnLocked');
      else if (event.key === 'Enter') void runAction(selectedAction);
      else {
        const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
        setSelectedIndex((index) => (index + delta + actions.length + 1) % (actions.length + 1));
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [actions.length, pendingAction, runAction, selectedAction]);

  const handleAdminOptionsControllerEvent = useCallback((event: ControllerNavigationEvent): void => {
    if (event.type === 'back') {
      void runAction('returnLocked');
    } else if (event.type === 'accept') {
      void runAction(selectedAction);
    } else {
      const delta = event.direction === 'left' || event.direction === 'up' ? -1 : 1;
      setSelectedIndex((index) => (index + delta + actions.length + 1) % (actions.length + 1));
    }
  }, [actions.length, runAction, selectedAction]);

  useControllerNavigation(!pendingAction, handleAdminOptionsControllerEvent);

  return (
    <div className="modal-backdrop admin-options-backdrop">
      <section className="modal admin-options-modal" aria-label="Admin options">
        <p className="eyebrow">Admin unlocked</p>
        <h2>Options</h2>
        <div className="admin-options-grid">
          {actions.map(({ action, label, pendingLabel }) => (
            <button
              ref={(element) => {
                actionRefs.current[actions.findIndex((item) => item.action === action)] = element;
              }}
              key={action}
              type="button"
              className={`secondary-action ${selectedAction === action ? 'controller-focused' : ''}`}
              disabled={Boolean(pendingAction)}
              onFocus={() => setSelectedIndex(actions.findIndex((item) => item.action === action))}
              onClick={() => void runAction(action)}
            >
              {pendingAction === action ? pendingLabel : label}
            </button>
          ))}
        </div>
        {error && <p className="error-text">{error}</p>}
        <button
          ref={(element) => {
            actionRefs.current[actions.length] = element;
          }}
          type="button"
          className={`primary-action wide ${selectedAction === 'returnLocked' ? 'controller-focused' : ''}`}
          disabled={Boolean(pendingAction)}
          onFocus={() => setSelectedIndex(actions.length)}
          onClick={() => void runAction('returnLocked')}
        >
          {pendingAction === 'returnLocked' ? 'Locking...' : 'Return to Locked Mode'}
        </button>
        <p className="admin-lockdown-note">
          System security shortcuts remain protected while customer mode is active.
        </p>
      </section>
    </div>
  );
}
