import { net } from 'electron';
import type {
  CreatePaymentCheckoutRequest,
  PaymentCatalogResult,
  PaymentCheckout,
  PaymentCheckoutAccess,
  PaymentCheckoutResult,
  PaymentPlan,
  PlayPlanRecord
} from '../shared/types';
import { normalizePayerDetails } from '../shared/earnings';
import { readBackendConfig, type BackendConfig } from './backendConfig';
import { logLine } from './logger';

type PaymentClientConfig = BackendConfig;

type PaymentFunctionResponse = Record<string, unknown>;

type PaymentPlanSource = {
  listEnabled: () => PlayPlanRecord[];
  getById: (id: string) => PlayPlanRecord | undefined;
};

const transientPaymentStatuses = new Set([429, 500, 502, 503, 504, 520, 522, 524, 540]);

const PAYMENTS_UNAVAILABLE = "Payments aren't available right now. Please ask staff for help.";
const PAYMENT_EXPIRED = 'This payment has expired. Please start again.';
const PAYMENT_NOT_RECEIVED = "This payment hasn't been received yet.";

// What a customer sees for the payment function's error codes. Anything else
// (network failures, server or Razorpay errors) reads as PAYMENTS_UNAVAILABLE;
// the technical reason goes to the log for staff.
const CUSTOMER_PAYMENT_MESSAGES: Record<string, string> = {
  checkout_not_found: PAYMENT_EXPIRED,
  unauthorized_checkout: PAYMENT_EXPIRED,
  payment_link_mismatch: PAYMENT_EXPIRED,
  payment_not_verified: PAYMENT_NOT_RECEIVED,
  payment_not_captured: PAYMENT_NOT_RECEIVED,
  captured_payment_not_found: PAYMENT_NOT_RECEIVED,
  payment_entitlement_already_used: 'This payment has already been used.',
  payment_attempt_limit_reached: 'Too many payment attempts. Please ask staff for help.'
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePlan(value: unknown): PaymentPlan | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const plan: PaymentPlan = {
    id: stringValue(row.id),
    name: stringValue(row.name),
    durationMinutes: numberValue(row.durationMinutes),
    amountPaise: numberValue(row.amountPaise),
    currency: stringValue(row.currency).toUpperCase() || 'INR'
  };
  return plan.id && plan.durationMinutes > 0 && plan.amountPaise > 0 ? plan : null;
}

function normalizeCheckout(value: unknown): PaymentCheckout | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  const plan = normalizePlan(row.plan);
  const id = stringValue(row.id);
  const clientToken = stringValue(row.clientToken);
  const expiresAt = stringValue(row.expiresAt);
  if (!id || !clientToken || !expiresAt || !plan) return undefined;
  return {
    id,
    clientToken,
    status: stringValue(row.status) as PaymentCheckout['status'],
    plan,
    qrDataUrl: stringValue(row.qrDataUrl),
    expiresAt
  };
}

// The payment function sends Razorpay payer details snake_cased; the rest of
// the entitlement is already camelCase.
function normalizeEntitlement(value: unknown): PaymentCheckoutResult['entitlement'] {
  if (!value || typeof value !== 'object') return undefined;
  const { payer, ...entitlement } = value as Record<string, unknown>;
  const details = normalizePayerDetails(payer, stringValue(entitlement.checkoutId));
  return {
    ...entitlement,
    ...(details ? { payer: details } : {})
  } as PaymentCheckoutResult['entitlement'];
}

export class PaymentService {
  private configPromise: Promise<PaymentClientConfig> | null = null;
  private readonly checkoutPlans = new Map<string, PaymentPlan>();

  constructor(
    private readonly plans: PaymentPlanSource,
    // This PC's device ID; consume binds the checkout to it in the cloud.
    private readonly currentStationId: () => string = () => ''
  ) {}

  private config(): Promise<PaymentClientConfig> {
    this.configPromise ??= readBackendConfig();
    return this.configPromise;
  }

  private async invoke(
    action: string,
    body: Record<string, unknown> = {},
    retryTransient = false
  ): Promise<PaymentFunctionResponse> {
    const config = await this.config();
    if (!config.functionBaseUrl || !config.publishableKey) {
      throw new Error('The payment backend is not set in nxgs-client.ini.');
    }
    const attempts = retryTransient ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let response: Response;
      try {
        response = await this.request(config, action, body);
      } catch (error) {
        if (attempt + 1 < attempts) {
          await delay(600 * (attempt + 1));
          continue;
        }
        throw error;
      }
      const result = await response.json().catch(() => ({})) as PaymentFunctionResponse;
      if (response.ok && result.error !== true) return result;
      if (attempt + 1 < attempts && transientPaymentStatuses.has(response.status)) {
        await delay(600 * (attempt + 1));
        continue;
      }
      throw new Error(stringValue(result.message) || `Payment service returned ${response.status}.`);
    }
    throw new Error('Payment service is temporarily unavailable.');
  }

  private request(
    config: PaymentClientConfig,
    action: string,
    body: Record<string, unknown>
  ): Promise<Response> {
    return net.fetch(`${config.functionBaseUrl}/pcPayment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.publishableKey
      },
      body: JSON.stringify({ action, ...body }),
      signal: AbortSignal.timeout(20_000)
    });
  }

  async catalog(): Promise<PaymentCatalogResult> {
    const plans = this.plans.listEnabled()
      .sort((left, right) =>
        left.durationMinutes - right.durationMinutes
        || left.amountPaise - right.amountPaise
        || left.name.localeCompare(right.name)
      )
      .map(({ id, name, durationMinutes, amountPaise, currency }) => ({
        id,
        name,
        durationMinutes,
        amountPaise,
        currency
      }));
    return plans.length > 0
      ? { ok: true, plans }
      : { ok: true, plans: [], error: 'No play plans available.' };
  }

  async create(request: CreatePaymentCheckoutRequest): Promise<PaymentCheckoutResult> {
    const plan = this.plans.getById(request.timePlanId);
    if (!plan || !plan.enabled) return { ok: false, error: 'This play plan is no longer available.' };
    const result = await this.run('create', {
      plan: {
        id: plan.id,
        name: plan.name,
        durationMinutes: plan.durationMinutes,
        amountPaise: plan.amountPaise,
        currency: plan.currency
      }
    });
    if (result.checkout) this.checkoutPlans.set(result.checkout.id, result.checkout.plan);
    return result;
  }

  status(access: PaymentCheckoutAccess): Promise<PaymentCheckoutResult> {
    return this.run('status', this.accessBody(access));
  }

  retry(access: PaymentCheckoutAccess): Promise<PaymentCheckoutResult> {
    return this.run('retry', this.accessBody(access));
  }

  cancel(access: PaymentCheckoutAccess): Promise<PaymentCheckoutResult> {
    return this.run('cancel', this.accessBody(access));
  }

  async consume(access: PaymentCheckoutAccess): Promise<PaymentCheckoutResult> {
    const result = await this.run('consume', { ...this.accessBody(access), ...this.stationBody() });
    const plan = this.checkoutPlans.get(access.checkoutId);
    if (result.ok && result.entitlement && plan) {
      result.entitlement = {
        ...result.entitlement,
        planId: plan.id,
        amountPaise: plan.amountPaise,
        currency: plan.currency
      };
      this.checkoutPlans.delete(access.checkoutId);
    }
    return result;
  }

  /** Optional: a consume never fails because the station ID is unknown. */
  private stationBody(): Record<string, unknown> {
    let stationId = '';
    try {
      stationId = this.currentStationId();
    } catch {
      stationId = '';
    }
    return /^[A-Za-z0-9_-]{3,80}$/.test(stationId) ? { station_id: stationId } : {};
  }

  private accessBody(access: PaymentCheckoutAccess): Record<string, unknown> {
    return { checkout_id: access.checkoutId, client_token: access.clientToken };
  }

  private async run(action: string, body: Record<string, unknown>): Promise<PaymentCheckoutResult> {
    try {
      const result = await this.invoke(action, body);
      return {
        ok: true,
        status: stringValue(result.status) as PaymentCheckoutResult['status'],
        checkout: normalizeCheckout(result.checkout),
        entitlement: normalizeEntitlement(result.entitlement)
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const backend = await this.config().then((config) => config.functionBaseUrl || 'no backend configured', () => 'unreadable config');
      await logLine('warn', `Payment ${action} failed (${backend}): ${reason}`);
      return { ok: false, error: CUSTOMER_PAYMENT_MESSAGES[reason] ?? PAYMENTS_UNAVAILABLE };
    }
  }
}
