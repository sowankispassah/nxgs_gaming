import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  LayoutDashboard,
  LoaderCircle,
  Lock,
  Minimize2,
  Power,
  ShieldCheck
} from 'lucide-react';
import type { KioskAdminAction } from '../../../shared/types';
import { useControllerNavigation, type ControllerNavigationEvent } from '../../controllerNavigation';
import { ControllerHints } from '../../ui/ControllerHints';
import { playUiSound } from '../../ui/uiSound';

export function AdminOptionsDialog(props: { onAction: (action: KioskAdminAction) => Promise<void> }): JSX.Element {
  const [pendingAction, setPendingAction] = useState<KioskAdminAction | null>(null);
  const [error, setError] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const actionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const actions: Array<{ action: KioskAdminAction; label: string; pendingLabel: string; icon: ReactNode }> = [
    { action: 'minimize', label: 'Minimize App', pendingLabel: 'Minimizing...', icon: <ArrowDownToLine size={24} /> },
    { action: 'exitFullscreen', label: 'Exit Full Screen', pendingLabel: 'Exiting...', icon: <Minimize2 size={24} /> },
    { action: 'openManagement', label: 'Open Management', pendingLabel: 'Opening...', icon: <LayoutDashboard size={24} /> },
    { action: 'closeApp', label: 'Close NXGS', pendingLabel: 'Closing...', icon: <Power size={24} /> }
  ];

  const runAction = useCallback(async (action: KioskAdminAction): Promise<void> => {
    if (pendingAction) return;
    setPendingAction(action);
    setError('');
    try {
      await props.onAction(action);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
      playUiSound('error');
    } finally {
      setPendingAction(null);
    }
  }, [pendingAction, props]);

  const selectedAction = selectedIndex < actions.length ? actions[selectedIndex].action : 'returnLocked';

  useEffect(() => {
    actionRefs.current[selectedIndex]?.focus({ preventScroll: true });
  }, [selectedIndex]);

  const moveSelection = useCallback((delta: -1 | 1): void => {
    playUiSound('move');
    setSelectedIndex((index) => (index + delta + actions.length + 1) % (actions.length + 1));
  }, [actions.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Backspace'].includes(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (pendingAction) return;
      if (event.key === 'Escape' || event.key === 'Backspace') {
        playUiSound('back');
        void runAction('returnLocked');
      } else if (event.key === 'Enter') {
        playUiSound('select');
        void runAction(selectedAction);
      } else {
        moveSelection(event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [moveSelection, pendingAction, runAction, selectedAction]);

  const handleAdminOptionsControllerEvent = useCallback((event: ControllerNavigationEvent): void => {
    if (event.type === 'back') {
      playUiSound('back');
      void runAction('returnLocked');
    } else if (event.type === 'accept') {
      playUiSound('select');
      void runAction(selectedAction);
    } else {
      moveSelection(event.direction === 'left' || event.direction === 'up' ? -1 : 1);
    }
  }, [moveSelection, runAction, selectedAction]);

  useControllerNavigation(!pendingAction, handleAdminOptionsControllerEvent);

  return (
    <div className="modal-backdrop admin-options-backdrop">
      <section className="modal admin-options-modal" role="dialog" aria-modal="true" aria-label="Admin options">
        <header className="admin-options-header">
          <span className="admin-options-badge" aria-hidden="true"><ShieldCheck size={28} /></span>
          <div>
            <p className="eyebrow">Admin unlocked</p>
            <h2>Options</h2>
          </div>
        </header>
        <div className="admin-options-grid" role="group" aria-label="Admin actions">
          {actions.map(({ action, label, pendingLabel, icon }) => (
            <button
              ref={(element) => {
                actionRefs.current[actions.findIndex((item) => item.action === action)] = element;
              }}
              key={action}
              type="button"
              className={`admin-option ${action === 'closeApp' ? 'is-danger' : ''} ${selectedAction === action ? 'controller-focused' : ''}`}
              disabled={Boolean(pendingAction)}
              onFocus={() => setSelectedIndex(actions.findIndex((item) => item.action === action))}
              onClick={() => void runAction(action)}
            >
              <span className="admin-option-icon" aria-hidden="true">
                {pendingAction === action ? <LoaderCircle size={24} className="spin" /> : icon}
              </span>
              <span className="admin-option-label">{pendingAction === action ? pendingLabel : label}</span>
            </button>
          ))}
        </div>
        {error && <p className="admin-options-error" role="alert"><AlertTriangle size={18} /> {error}</p>}
        <button
          ref={(element) => {
            actionRefs.current[actions.length] = element;
          }}
          type="button"
          className={`primary-action wide admin-options-lock ${selectedAction === 'returnLocked' ? 'controller-focused' : ''}`}
          disabled={Boolean(pendingAction)}
          onFocus={() => setSelectedIndex(actions.length)}
          onClick={() => void runAction('returnLocked')}
        >
          {pendingAction === 'returnLocked' ? <LoaderCircle size={20} className="spin" /> : <Lock size={20} />}
          {pendingAction === 'returnLocked' ? 'Locking...' : 'Return to Locked Mode'}
        </button>
        <footer className="admin-options-footer">
          <p className="admin-lockdown-note">
            System security shortcuts remain protected while customer mode is active.
          </p>
          <ControllerHints hints={[{ glyph: 'cross', label: 'Select' }, { glyph: 'circle', label: 'Lock' }]} />
        </footer>
      </section>
    </div>
  );
}
