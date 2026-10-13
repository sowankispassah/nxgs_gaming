import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Clock,
  LoaderCircle,
  RefreshCw,
  Smartphone,
  Timer,
  X
} from 'lucide-react';
import type {
  GameRecord,
  PaymentCheckout,
  PaymentCheckoutStatus,
  PaymentPlan
} from '../../../shared/types';
import { useControllerNavigation, type ControllerNavigationEvent } from '../../controllerNavigation';
import { toFileUrl } from '../../ui/media';

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
  const [planPendingIndex, setPlanPendingIndex] = useState<number | null>(null);
  const [checkout, setCheckout] = useState<PaymentCheckout | null>(null);
  const [paymentActionIndex, setPaymentActionIndex] = useState(0);
  const [pendingAction, setPendingAction] = useState<'retry' | 'cancel' | 'launch' | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [error, setError] = useState('');
  const planRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const paymentActionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const pollingRef = useRef(false);
  const completionStartedRef = useRef(false);
  const entitlementActivatedRef = useRef(false);

  const loadCatalog = useCallback(async (): Promise<void> => {
    setCatalogPending(true);
    setError('');
    try {
      const result = await window.nxgs.getPaymentCatalog();
      if (!result.ok) {
        setError(result.error ?? 'Could not load play durations.');
        return;
      }
      setPlans(result.plans);
      setPlanIndex(0);
      if (result.plans.length === 0) setError(result.error ?? 'No play plans available.');
    } catch (catalogError) {
      setError(catalogError instanceof Error ? catalogError.message : String(catalogError));
    } finally {
      setCatalogPending(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (stage === 'plans') planRefs.current[planIndex]?.focus({ preventScroll: true });
    else paymentActionRefs.current[paymentActionIndex]?.focus({ preventScroll: true });
  }, [paymentActionIndex, planIndex, plans.length, stage]);

  useEffect(() => {
    if (!checkout) return;
    const updateCountdown = (): void => {
      setRemainingSeconds(Math.max(0, Math.ceil((new Date(checkout.expiresAt).getTime() - Date.now()) / 1000)));
    };
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(timer);
  }, [checkout]);

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
    setPlanIndex((index) => Math.max(0, Math.min(plans.length - 1, index + delta)));
  }, [plans.length]);

  const activatePaymentAction = useCallback((): void => {
    if (entitlementActivatedRef.current && error) void completePayment(checkout!);
    else if (paymentActionIndex === 0) void retryPayment();
    else void cancelPayment('close');
  }, [cancelPayment, checkout, completePayment, error, paymentActionIndex, retryPayment]);

  const handleLaunchControllerEvent = useCallback((event: ControllerNavigationEvent): void => {
    if (event.type === 'back') {
      if (stage === 'payment' && checkout) void cancelPayment('plans');
      else requestClose();
      return;
    }
    if (event.type === 'accept') {
      if (stage === 'plans') void choosePlan(planIndex);
      else activatePaymentAction();
      return;
    }
    if (stage === 'plans') {
      if (event.direction === 'up') movePlan(-1);
      else if (event.direction === 'down') movePlan(1);
    } else if (event.direction === 'left' || event.direction === 'right') {
      setPaymentActionIndex((index) => index === 0 ? 1 : 0);
    }
  }, [activatePaymentAction, cancelPayment, checkout, choosePlan, movePlan, planIndex, requestClose, stage]);

  const inputPending = catalogPending || planPendingIndex !== null || Boolean(pendingAction);
  useControllerNavigation(!inputPending, handleLaunchControllerEvent);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Backspace'].includes(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (inputPending) return;
      if (event.key === 'Escape' || event.key === 'Backspace') {
        if (stage === 'payment' && checkout) void cancelPayment('plans');
        else requestClose();
      } else if (stage === 'plans' && event.key === 'ArrowUp') movePlan(-1);
      else if (stage === 'plans' && event.key === 'ArrowDown') movePlan(1);
      else if (stage === 'payment' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        setPaymentActionIndex((index) => index === 0 ? 1 : 0);
      } else if (event.key === 'Enter') {
        if (stage === 'plans') void choosePlan(planIndex);
        else activatePaymentAction();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [activatePaymentAction, cancelPayment, checkout, choosePlan, inputPending, movePlan, planIndex, requestClose, stage]);

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
  const formatDuration = (minutes: number): string => {
    if (minutes < 60) return `${minutes} ${minutes === 1 ? 'Min' : 'Mins'}`;
    const hours = minutes / 60;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} ${hours === 1 ? 'Hour' : 'Hours'}`;
  };
  const formatPrice = (plan: PaymentPlan): string => new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: plan.currency, minimumFractionDigits: 2
  }).format(plan.amountPaise / 100);
  const formatCountdown = (seconds: number): string =>
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const badgeForPlan = (plan: PaymentPlan): string => {
    if (/quick/i.test(plan.name)) return 'Quick test';
    if (/popular/i.test(plan.name)) return 'Popular';
    if (/best/i.test(plan.name)) return 'Best value';
    return '';
  };

  return (
    <div className="modal-backdrop payment-backdrop">
      <section className={`modal launch-modal ${stage === 'payment' ? 'payment-modal' : 'duration-modal'}`}>
        <button className="icon-button close-button" type="button" title="Close" onClick={requestClose} disabled={inputPending}>
          {pendingAction === 'cancel' ? <LoaderCircle size={20} className="spin" /> : <X size={20} />}
        </button>
        {stage === 'plans' ? (
          <>
            <header className="checkout-heading">
              <span className="checkout-game-icon">
                {props.game?.avatarImagePath ? <img src={toFileUrl(props.game.avatarImagePath)} alt="" /> : <Timer size={25} />}
              </span>
              <div>
                <p className="eyebrow">{props.mode === 'extend' ? 'Active paid session' : props.game?.title}</p>
                <h2>{props.mode === 'extend' ? 'Extend Play Time' : 'Select Play Duration'}</h2>
              </div>
            </header>
            {catalogPending && <div className="checkout-loading"><LoaderCircle className="spin" /> Loading prices...</div>}
            {!catalogPending && plans.length > 0 && <div className="duration-list">
              {plans.map((plan, index) => (
            <button
              ref={(element) => {
                    planRefs.current[index] = element;
              }}
                  key={plan.id}
              type="button"
                  className={planIndex === index ? 'selected' : ''}
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
                  <span className="duration-clock">{planPendingIndex === index ? <LoaderCircle className="spin" size={24} /> : <Clock size={24} />}</span>
                  <strong>{formatDuration(plan.durationMinutes)}</strong>
                  {badgeForPlan(plan) && <em>{badgeForPlan(plan)}</em>}
                  <span className="duration-price">{formatPrice(plan)}</span>
            </button>
              ))}
            </div>}
            {error && <div className="checkout-error" role="alert"><AlertTriangle size={18} /><span>{error}</span></div>}
            {!catalogPending && plans.length === 0 && (
              <button type="button" className="secondary-action wide" onClick={() => void loadCatalog()}>
                <RefreshCw size={18} /> Try again
              </button>
            )}
            <button className="duration-cancel" type="button" onClick={props.onClose} disabled={inputPending}>Cancel</button>
          </>
        ) : checkout ? (
          <>
            <header className="checkout-heading payment-heading">
              <span className="checkout-game-icon"><Smartphone size={25} /></span>
              <div>
                <p className="eyebrow">Razorpay Checkout</p>
                <h2>Pay with your phone</h2>
              </div>
            </header>
            <div className="payment-layout">
              <div className="payment-qr-panel">
                <span>Razorpay Checkout</span>
                <div className="payment-qr-frame">
                  {checkout.qrDataUrl ? <img src={checkout.qrDataUrl} alt="Razorpay payment QR code" /> : <LoaderCircle className="spin" size={52} />}
                </div>
                <p><Smartphone size={20} /> Scan QR</p>
              </div>
              <div className="payment-summary">
                <h3>Scan with your phone to pay</h3>
                <p className="muted">Razorpay Checkout opens securely on your phone. This screen updates automatically after payment.</p>
                <dl className="payment-details">
                  <div><dt><Clock size={20} /> Duration</dt><dd>{formatDuration(checkout.plan.durationMinutes)}</dd></div>
                  <div><dt><span className="detail-dot" /> Amount</dt><dd className="payment-amount">{formatPrice(checkout.plan)}</dd></div>
                  <div><dt><Timer size={20} /> Payment window</dt><dd>{formatCountdown(remainingSeconds)}</dd></div>
                </dl>
                <div className={`payment-status ${status}`} role="status" aria-live="polite">
                  {pendingAction === 'launch' && <LoaderCircle size={19} className="spin" />}
                  {entitlementActivatedRef.current && error ? 'Payment applied - action needs attention' : statusLabel[status]}
                </div>
                {error && <div className="checkout-error" role="alert"><AlertTriangle size={18} /><span>{error}</span></div>}
                <div className="payment-actions">
                  <button
                    ref={(element) => { paymentActionRefs.current[0] = element; }}
                    type="button"
                    className={`primary-action ${paymentActionIndex === 0 ? 'controller-focused' : ''}`}
                    disabled={Boolean(pendingAction)}
                    onFocus={() => setPaymentActionIndex(0)}
                    onClick={activatePaymentAction}
                  >
                    {pendingAction === 'retry' || pendingAction === 'launch' ? <LoaderCircle size={19} className="spin" /> : <RefreshCw size={19} />}
                    {entitlementActivatedRef.current && error ? (props.mode === 'extend' ? 'Finish Extension' : 'Retry Launch') : pendingAction === 'retry' ? 'Retrying...' : pendingAction === 'launch' ? (props.mode === 'extend' ? 'Extending...' : 'Starting...') : 'Retry Payment'}
                  </button>
                  <button
                    ref={(element) => { paymentActionRefs.current[1] = element; }}
                    type="button"
                    className={`secondary-action ${paymentActionIndex === 1 ? 'controller-focused' : ''}`}
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
            <footer className="payment-controller-help">
              <span><kbd>A</kbd> Select / OK</span>
              <span><kbd>B</kbd> Back / Change Price</span>
            </footer>
          </>
        ) : null}
      </section>
    </div>
  );
}
