import { app, net } from 'electron';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  CreatePaymentCheckoutRequest,
  PaymentCatalogResult,
  PaymentCheckout,
  PaymentCheckoutAccess,
  PaymentCheckoutResult,
  PaymentPlan,
  PlayPlanRecord
} from '../shared/types';

interface PaymentClientConfig {
  supabaseUrl: string;
  functionBaseUrl: string;
  publishableKey: string;
}

type PaymentFunctionResponse = Record<string, unknown>;

type PaymentPlanSource = {
  listEnabled: () => PlayPlanRecord[];
  getById: (id: string) => PlayPlanRecord | undefined;
};

const transientPaymentStatuses = new Set([429, 500, 502, 503, 504, 520, 522, 524, 540]);

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

function parseIni(source: string): Map<string, string> {
  const values = new Map<string, string>();
  let section = '';
  for (const sourceLine of source.split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const sectionMatch = /^\[([^\]]+)\]$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1].trim().toLowerCase();
      continue;
    }
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    values.set(`${section}/${key}`, line.slice(separator + 1).trim());
  }
  return values;
}

async function readClientConfig(): Promise<PaymentClientConfig> {
  let supabaseUrl = '';
  let functionBaseUrl = '';
  let publishableKey = '';
  const candidates = [
    join(process.cwd(), 'nxgs-client.ini'),
    join(app.getAppPath(), 'nxgs-client.ini'),
    join(process.resourcesPath, 'nxgs-client.ini'),
    join(dirname(process.execPath), 'nxgs-client.ini')
  ];

  for (const path of [...new Set(candidates)]) {
    if (!existsSync(path)) continue;
    const values = parseIni(await readFile(path, 'utf8'));
    functionBaseUrl ||= values.get('backend/function_base_url') ?? '';
    publishableKey ||= values.get('backend/supabase_anon_key') ?? '';
    supabaseUrl ||= values.get('backend/supabase_url') ?? '';
    if (!functionBaseUrl && supabaseUrl) {
      functionBaseUrl = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1`;
    }
    if (supabaseUrl && functionBaseUrl && publishableKey) break;
  }

  supabaseUrl ||= process.env.NXGS_SUPABASE_URL?.trim() ?? '';
  functionBaseUrl ||= process.env.NXGS_RENTAL_FUNCTION_BASE_URL?.trim() ?? '';
  publishableKey ||= process.env.NXGS_SUPABASE_ANON_KEY?.trim() ?? '';
  if (!functionBaseUrl && supabaseUrl) {
    functionBaseUrl = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1`;
  }

  return {
    supabaseUrl: supabaseUrl.replace(/\/+$/, ''),
    functionBaseUrl: functionBaseUrl.replace(/\/+$/, ''),
    publishableKey
  };
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

export class PaymentService {
  private configPromise: Promise<PaymentClientConfig> | null = null;
  private readonly checkoutPlans = new Map<string, PaymentPlan>();

  constructor(private readonly plans: PaymentPlanSource) {}

  private config(): Promise<PaymentClientConfig> {
    this.configPromise ??= readClientConfig();
    return this.configPromise;
  }

  private async invoke(
    action: string,
    body: Record<string, unknown> = {},
    retryTransient = false
  ): Promise<PaymentFunctionResponse> {
    const config = await this.config();
    if (!config.functionBaseUrl || !config.publishableKey) {
      throw new Error('Payment service is not configured on this PC.');
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
    const plans = this.plans.listEnabled().map(({ id, name, durationMinutes, amountPaise, currency }) => ({
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
    const result = await this.run('consume', this.accessBody(access));
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
        entitlement: result.entitlement as PaymentCheckoutResult['entitlement']
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
