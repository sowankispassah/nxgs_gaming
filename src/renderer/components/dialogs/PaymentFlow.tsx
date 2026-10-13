import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Gamepad2,
  LoaderCircle,
  RefreshCw,
  ScanLine,
  Timer,
  Wallet,
  X,
  XCircle
} from 'lucide-react';
import type {
  GameRecord,
  PaymentCheckout,
  PaymentCheckoutStatus,
  PaymentPlan
} from '../../../shared/types';
import { useControllerNavigation, type ControllerNavigationEvent } from '../../controllerNavigation';
import { ControllerHints } from '../../ui/ControllerHints';
import { playUiSound } from '../../ui/uiSound';
import { GameArtwork } from '../system/GameArtwork';

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'Min' : 'Mins'}`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} ${hours === 1 ? 'Hour' : 'Hours'}`;
}

function formatPrice(plan: PaymentPlan): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: plan.currency, minimumFractionDigits: 2
  }).format(plan.amountPaise / 100);
}

function formatCountdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function badgeForPlan(plan: PaymentPlan): string {
  if (/quick/i.test(plan.name)) return 'Quick test';
  if (/popular/i.test(plan.name)) return 'Popular';
  if (/best/i.test(plan.name)) return 'Best value';
  return '';
}

export function PaymentFlow(props: {
  mode: 'launch' | 'extend';
  game?: GameRecord;
  onClose: () => void;
  onCompleted: () => void;
}): JSX.Element {
  const [stage, setStage] = useState<'plans' | 'payment'>('plans');
  const [plans, setPlans] = useState<PaymentPlan[]>([]);
  const [planIndex, setPlanIndex] = useState(0);
  const [catalogPending, setCatalogPending] = useState(true);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [planPendingIndex, setPlanPendingIndex] = useState<number | null>(null);
  const [checkout, setCheckout] = useState<PaymentCheckout | null>(null);
  const [paymentActionIndex, setPaymentActionIndex] = useState(0);
  const [pendingAction, setPendingAction] = useState<'retry' | 'cancel' | 'launch' | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [error, setError] = useState('');
  const planRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const paymentActionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const retryCatalogRef = useRef<HTMLButtonElement | null>(null);
  const pollingRef = useRef(false);
  const completionStartedRef = useRef(false);
  const entitlementActivatedRef = useRef(false);
  const announcedStatusRef = useRef<PaymentCheckoutStatus | null>(null);

  const loadCatalog = useCallback(async (): Promise<void> => {
    setCatalogPending(true);
    setCatalogFailed(false);
    setError('');
    try {
      const result = await window.nxgs.getPaymentCatalog();
      if (!result.ok) {
        setError(result.error ?? 'Could not load play durations.');
        setCatalogFailed(true);
        playUiSound('error');
        return;
      }
      setPlans(result.plans);
      setPlanIndex(0);
      if (result.plans.length === 0) setError(result.error ?? 'No play plans available.');
    } catch (catalogError) {
      setError(catalogError instanceof Error ? catalogError.message : String(catalogError));
      setCatalogFailed(true);
      playUiSound('error');
    } finally {
      setCatalogPending(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (stage === 'plans') {
      const row = planRefs.current[planIndex];
      if (row) {
        row.focus({ preventScroll: true });
        row.scrollIntoView({ block: 'nearest' });
      } else if (!catalogPending && plans.length === 0) retryCatalogRef.current?.focus({ preventScroll: true });
    } else paymentActionRefs.current[paymentActionIndex]?.focus({ preventScroll: true });
  }, [catalogPending, paymentActionIndex, planIndex, plans.length, stage]);

  useEffect(() => {
    if (!checkout) return;
    const updateCountdown = (): void => {
      setRemainingSeconds(Math.max(0, Math.ceil((new Date(checkout.expiresAt).getTime() - Date.now()) / 1000)));
    };
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(timer);
  }, [checkout]);

  useEffect(() => {
    const current = checkout?.status ?? null;
    if (current === 'verified' && announcedStatusRef.current !== 'verified') playUiSound('notify');
    announcedStatusRef.current = current;
  }, [checkout?.status]);

  const completePayment = useCallback(async (paidCheckout: PaymentCheckout): Promise<void> => {
    if (completionStartedRef.current || pendingAction === 'launch') return;
    completionStartedRef.current = true;
    setPendingAction('launch');
    setError('');
    try {
      if (!entitlementActivatedRef.current) {
        const consumed = await window.nxgs.consumePaymentCheckout({
          checkoutId: paidCheckout.id,
          clientToken: paidCheckout.clientToken
        });
        if (!consumed.ok || !consumed.entitlement) {
          throw new Error(consumed.error ?? 'The paid session could not be authorized.');
        }
        entitlementActivatedRef.current = true;
      }
      if (props.mode === 'launch') {
        if (!props.game) throw new Error('No game was selected.');
        const launched = await window.nxgs.launchGame({ gameId: props.game.id });
        if (!launched.ok) throw new Error(launched.error ?? 'Game launch failed.');
      }
      props.onCompleted();
    } catch (launchError) {
      setError(launchError instanceof Error ? launchError.message : String(launchError));
      playUiSound('error');
    } finally {
      completionStartedRef.current = false;
      setPendingAction(null);
    }
  }, [pendingAction, props]);

  const choosePlan = useCallback(async (index: number): Promise<void> => {
    const plan = plans[index];
    if (!plan || planPendingIndex !== null || pendingAction) return;
    setPlanIndex(index);
    setPlanPendingIndex(index);
    setError('');
    try {
      const result = await window.nxgs.createPaymentCheckout({
        timePlanId: plan.id
      });
      if (!result.ok || !result.checkout) throw new Error(result.error ?? 'Could not start Razorpay Checkout.');
      setCheckout(result.checkout);
      setStage('payment');
      setPaymentActionIndex(0);
      if (result.status === 'verified') void completePayment(result.checkout);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : String(checkoutError));
      playUiSound('error');
    } finally {
      setPlanPendingIndex(null);
    }
  }, [completePayment, pendingAction, planPendingIndex, plans]);

  const retryPayment = useCallback(async (): Promise<void> => {
    if (!checkout || pendingAction) return;
    setPendingAction('retry');
    setError('');
    try {
      const result = await window.nxgs.retryPaymentCheckout({ checkoutId: checkout.id, clientToken: checkout.clientToken });
      if (!result.ok) throw new Error(result.error ?? 'Could not retry payment.');
      if (result.checkout) setCheckout(result.checkout);
      if (result.status === 'verified' && result.checkout) void completePayment(result.checkout);
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : String(retryError));
      playUiSound('error');
    } finally {
      setPendingAction(null);
    }
  }, [checkout, completePayment, pendingAction]);

  const cancelPayment = useCallback(async (destination: 'plans' | 'close'): Promise<void> => {
    if (!checkout || pendingAction) return;
    setPendingAction('cancel');
    setError('');
    try {
      const result = await window.nxgs.cancelPaymentCheckout({ checkoutId: checkout.id, clientToken: checkout.clientToken });
      if (!result.ok) throw new Error(result.error ?? 'Could not cancel payment.');
      if (result.status === 'verified' && result.checkout) {
        setCheckout(result.checkout);
        void completePayment(result.checkout);
        return;
      }
      setCheckout(null);
      if (destination === 'close') props.onClose();
      else {
        setStage('plans');
        setPaymentActionIndex(0);
      }
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : String(cancelError));
      playUiSound('error');
    } finally {
      setPendingAction(null);
    }
  }, [checkout, completePayment, pendingAction, props]);

  const requestClose = useCallback((): void => {
    if (pendingAction || planPendingIndex !== null) return;
    if (checkout) void cancelPayment('close');
    else props.onClose();
  }, [cancelPayment, checkout, pendingAction, planPendingIndex, props]);

  useEffect(() => {
    if (!checkout || checkout.status !== 'created' || pendingAction === 'launch') return;
    const poll = async (): Promise<void> => {
      if (pollingRef.current) return;
      pollingRef.current = true;
      try {
        const result = await window.nxgs.getPaymentStatus({ checkoutId: checkout.id, clientToken: checkout.clientToken });
        if (!result.ok) {
          setError(result.error ?? 'Could not confirm payment status.');
          return;
        }
        if (result.checkout) setCheckout(result.checkout);
        if (result.status === 'verified' && result.checkout) void completePayment(result.checkout);
      } finally {
        pollingRef.current = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    return () => window.clearInterval(timer);
  }, [checkout, completePayment, pendingAction]);

  const movePlan = useCallback((delta: number): void => {
    const next = Math.max(0, Math.min(plans.length - 1, planIndex + delta));
    if (next === planIndex) return;
    playUiSound('move');
    setPlanIndex(next);
  }, [planIndex, plans.length]);

  const togglePaymentAction = useCallback((): void => {
    playUiSound('move');
    setPaymentActionIndex((index) => index === 0 ? 1 : 0);
  }, []);

  const activatePaymentAction = useCallback((): void => {
    if (entitlementActivatedRef.current && error) void completePayment(checkout!);
    else if (paymentActionIndex === 0) void retryPayment();
    else void cancelPayment('close');
  }, [cancelPayment, checkout, completePayment, error, paymentActionIndex, retryPayment]);

  const handleLaunchControllerEvent = useCallback((event: ControllerNavigationEvent): void => {
    if (event.type === 'back') {
      playUiSound('back');
      if (stage === 'payment' && checkout) void cancelPayment('plans');
      else requestClose();
      return;
    }
    if (event.type === 'accept') {
      playUiSound('select');
      if (stage === 'plans' && plans.length === 0) void loadCatalog();
      else if (stage === 'plans') void choosePlan(planIndex);
      else activatePaymentAction();
      return;
    }
    if (stage === 'plans') {
      if (event.direction === 'up') movePlan(-1);
      else if (event.direction === 'down') movePlan(1);
    } else if (event.direction === 'left' || event.direction === 'right') {
      togglePaymentAction();
    }
  }, [activatePaymentAction, cancelPayment, checkout, choosePlan, loadCatalog, movePlan, planIndex, plans.length, requestClose, stage, togglePaymentAction]);

  const inputPending = catalogPending || planPendingIndex !== null || Boolean(pendingAction);
  useControllerNavigation(!inputPending, handleLaunchControllerEvent);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Backspace'].includes(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (inputPending) return;
      if (event.key === 'Escape' || event.key === 'Backspace') {
        playUiSound('back');
        if (stage === 'payment' && checkout) void cancelPayment('plans');
        else requestClose();
      } else if (stage === 'plans' && event.key === 'ArrowUp') movePlan(-1);
      else if (stage === 'plans' && event.key === 'ArrowDown') movePlan(1);
      else if (stage === 'payment' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        togglePaymentAction();
      } else if (event.key === 'Enter') {
        playUiSound('select');
        if (stage === 'plans' && plans.length === 0) void loadCatalog();
        else if (stage === 'plans') void choosePlan(planIndex);
        else activatePaymentAction();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [activatePaymentAction, cancelPayment, checkout, choosePlan, inputPending, loadCatalog, movePlan, planIndex, plans.length, requestClose, stage, togglePaymentAction]);

  const status = checkout?.status ?? 'creating';
  const statusLabel: Record<PaymentCheckoutStatus, string> = {
    creating: 'Creating secure checkout',
    created: 'Waiting for payment',
    verified: 'Payment received',
    consumed: props.mode === 'extend' ? 'Adding time to your session' : 'Starting your game',
    cancelled: 'Payment cancelled',
    expired: 'Payment window expired',
    failed: 'Payment failed'
  };
  const recoveryNeeded = entitlementActivatedRef.current && Boolean(error);
  const statusTone = recoveryNeeded
    ? 'warning'
    : status === 'verified' || status === 'consumed'
      ? 'success'
      : status === 'cancelled' || status === 'expired' || status === 'failed'
        ? 'danger'
        : 'waiting';
  const statusIcon = pendingAction === 'launch' || status === 'creating'
    ? <LoaderCircle size={20} className="spin" />
    : statusTone === 'success'
      ? <CheckCircle2 size={20} />
      : statusTone === 'danger'
        ? <XCircle size={20} />
        : statusTone === 'warning'
          ? <AlertTriangle size={20} />
          : <span className="payment-status-pulse" />;
  const countdownLow = status === 'created' && remainingSeconds <= 60;
  const qrState = status === 'verified' || status === 'consumed'
    ? 'paid'
    : status === 'expired' || status === 'cancelled'
      ? 'expired'
      : '';
  const extendMode = props.mode === 'extend';

  return (
    <div className="modal-backdrop payment-backdrop">
      <section
        key={stage}
        className={`modal launch-modal ${stage === 'payment' ? 'payment-modal' : 'duration-modal'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-flow-title"
      >
        {stage === 'plans' ? (
          <>
            {!extendMode && props.game && (
              <div className="checkout-hero-art" aria-hidden="true">
                <GameArtwork game={props.game} kind="cover" />
              </div>
            )}
            <header className="checkout-heading">
              <span className={`checkout-game-icon ${extendMode || !props.game ? 'is-symbol' : ''}`}>
                {extendMode || !props.game
                  ? <Timer size={34} />
                  : <GameArtwork game={props.game} kind="avatar" fallback={<Gamepad2 size={32} />} />}
              </span>
              <div className="checkout-heading-copy">
                <p className="eyebrow">{extendMode ? 'Active paid session' : props.game?.title}</p>
                <h2 id="payment-flow-title">{extendMode ? 'Extend Play Time' : 'Select Play Duration'}</h2>
              </div>
            </header>
            {catalogPending && (
              <div className="checkout-loading" role="status" aria-live="polite">
                <div className="duration-skeletons" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <p><LoaderCircle size={18} className="spin" /> Loading prices...</p>
              </div>
            )}
            {!catalogPending && plans.length > 0 && (
              <div className="duration-list" role="group" aria-label="Play durations">
                {plans.map((plan, index) => {
                  const badge = badgeForPlan(plan);
                  return (
                    <button
                      ref={(element) => {
                        planRefs.current[index] = element;
                      }}
                      key={plan.id}
                      type="button"
                      className={`duration-option ${planIndex === index ? 'selected' : ''}`}
                      aria-label={`${formatDuration(plan.durationMinutes)}, ${formatPrice(plan)}`}
                      onFocus={() => {
                        setPlanIndex(index);
                      }}
                      onMouseEnter={() => {
                        setPlanIndex(index);
                      }}
                      onClick={() => void choosePlan(index)}
                      disabled={planPendingIndex !== null}
                    >
                      <span className="duration-clock">
                        {planPendingIndex === index ? <LoaderCircle className="spin" size={24} /> : <Clock size={24} />}
                      </span>
                      <span className="duration-copy">
                        <strong>{formatDuration(plan.durationMinutes)}</strong>
                        {badge && <em className="duration-badge">{badge}</em>}
                      </span>
                      <span className="duration-price">{formatPrice(plan)}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {!catalogPending && plans.length === 0 && (
              <div className={`checkout-empty ${catalogFailed ? 'is-failed' : ''}`} role="alert">
                <span className="checkout-empty-icon" aria-hidden="true">
                  {catalogFailed ? <AlertTriangle size={30} /> : <Timer size={30} />}
                </span>
                <strong>{error || 'No play plans available.'}</strong>
                <p className="muted">Please ask a staff member for help, then try again.</p>
                <button
                  ref={retryCatalogRef}
                  type="button"
                  className="secondary-action controller-focused"
                  onClick={() => void loadCatalog()}
                >
                  <RefreshCw size={18} /> Try again
                </button>
              </div>
            )}
            {error && plans.length > 0 && (
              <div className="checkout-error" role="alert"><AlertTriangle size={20} /><span>{error}</span></div>
            )}
            <footer className="dialog-footer">
              <button className="dialog-text-button duration-cancel" type="button" onClick={props.onClose} disabled={inputPending}>
                Cancel
              </button>
              <ControllerHints hints={[{ glyph: 'cross', label: 'Select' }, { glyph: 'circle', label: 'Back' }]} />
            </footer>
          </>
        ) : checkout ? (
          <>
            <div className="payment-layout">
              <div className="payment-qr-panel">
                <div className={`payment-qr-frame ${qrState ? `is-${qrState}` : ''}`}>
                  {checkout.qrDataUrl
                    ? <img src={checkout.qrDataUrl} alt="Razorpay payment QR code" />
                    : <LoaderCircle className="spin" size={52} />}
                  {qrState && (
                    <span className="payment-qr-overlay" aria-hidden="true">
                      {qrState === 'paid' ? <CheckCircle2 size={72} strokeWidth={1.75} /> : <Timer size={64} strokeWidth={1.75} />}
                    </span>
                  )}
                </div>
                <p className="payment-qr-caption"><ScanLine size={20} /> Scan with your phone camera</p>
              </div>
              <div className="payment-summary">
                <p className="eyebrow">Razorpay Checkout</p>
                <h2 id="payment-flow-title">Pay with your phone</h2>
                <p className="payment-intro">
                  Razorpay Checkout opens securely on your phone. This screen updates automatically after payment.
                </p>
                <dl className="payment-details">
                  <div>
                    <dt><Clock size={20} /> Duration</dt>
                    <dd>{formatDuration(checkout.plan.durationMinutes)}</dd>
                  </div>
                  <div>
                    <dt><Wallet size={20} /> Amount</dt>
                    <dd className="payment-amount">{formatPrice(checkout.plan)}</dd>
                  </div>
                  <div>
                    <dt><Timer size={20} /> Payment window</dt>
                    <dd className={`payment-countdown ${countdownLow ? 'is-low' : ''}`}>{formatCountdown(remainingSeconds)}</dd>
                  </div>
                </dl>
                <div className={`payment-status ${status} tone-${statusTone}`} role="status" aria-live="polite">
                  <span className="payment-status-icon" aria-hidden="true">{statusIcon}</span>
                  <span>{recoveryNeeded ? 'Payment applied - action needs attention' : statusLabel[status]}</span>
                </div>
                {error && <div className="checkout-error" role="alert"><AlertTriangle size={20} /><span>{error}</span></div>}
                <div className="payment-actions">
                  <button
                    ref={(element) => { paymentActionRefs.current[0] = element; }}
                    type="button"
                    className={`secondary-action ${paymentActionIndex === 0 ? 'controller-focused' : ''} ${pendingAction === 'retry' || pendingAction === 'launch' ? 'is-pending' : ''}`}
                    disabled={Boolean(pendingAction)}
                    onFocus={() => setPaymentActionIndex(0)}
                    onClick={activatePaymentAction}
                  >
                    {pendingAction === 'retry' || pendingAction === 'launch' ? <LoaderCircle size={19} className="spin" /> : <RefreshCw size={19} />}
                    {recoveryNeeded ? (extendMode ? 'Finish Extension' : 'Retry Launch') : pendingAction === 'retry' ? 'Retrying...' : pendingAction === 'launch' ? (extendMode ? 'Extending...' : 'Starting...') : 'Retry Payment'}
                  </button>
                  <button
                    ref={(element) => { paymentActionRefs.current[1] = element; }}
                    type="button"
                    className={`secondary-action ${paymentActionIndex === 1 ? 'controller-focused' : ''} ${pendingAction === 'cancel' ? 'is-pending' : ''}`}
                    disabled={Boolean(pendingAction) || entitlementActivatedRef.current}
                    onFocus={() => setPaymentActionIndex(1)}
                    onClick={() => void cancelPayment('close')}
                  >
                    {pendingAction === 'cancel' ? <LoaderCircle size={19} className="spin" /> : <X size={19} />}
                    {pendingAction === 'cancel' ? 'Cancelling...' : 'Cancel Payment'}
                  </button>
                </div>
              </div>
            </div>
            <footer className="dialog-footer payment-footer">
              {recoveryNeeded && !extendMode && (
                // Payment is already applied, so Cancel Payment is disabled; give
                // pointer users a way out to pick another game.
                <button className="dialog-text-button" type="button" onClick={props.onClose} disabled={Boolean(pendingAction)}>
                  Close
                </button>
              )}
              <ControllerHints hints={[{ glyph: 'cross', label: 'Select / OK' }, { glyph: 'circle', label: 'Back / Change Price' }]} />
            </footer>
          </>
        ) : null}
      </section>
    </div>
  );
}
