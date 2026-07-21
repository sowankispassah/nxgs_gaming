import QRCode from "npm:qrcode@1.5.4";
import { createClient } from "npm:@supabase/supabase-js@2.49.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const LOCAL_EXPIRY_SECONDS = 5 * 60;
const PROVIDER_EXPIRY_SECONDS = 16 * 60;
const PROVIDER_POLL_INTERVAL_MS = 4_000;
const MAX_ATTEMPTS = 3;

type Row = Record<string, any>;
type AdminClient = ReturnType<typeof createClient>;

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : "request_failed";
}

function failure(error: unknown): Response {
  const message = safeMessage(error);
  const status = message.includes("unauthorized") ? 401
    : message.includes("not_found") ? 404
    : message.includes("already_used") || message.includes("expired") || message.includes("attempt_limit") ? 409
    : message.includes("invalid") || message.includes("mismatch") || message.includes("captured") ? 400
    : 500;
  return json({ error: true, message }, status);
}

function authorized(req: Request): boolean {
  const key = text(req.headers.get("apikey"));
  if (!key) return false;
  const allowed = new Set<string>();
  const legacy = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacy) allowed.add(legacy);
  try {
    const publishable = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}") as Record<string, string>;
    Object.values(publishable).forEach((value) => allowed.add(value));
  } catch {
    // A malformed platform variable must fail closed.
  }
  return allowed.has(key);
}

function admin(): AdminClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRole) throw new Error("missing_supabase_service_configuration");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToHex(new Uint8Array(digest));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function razorpayAuth(): string {
  const keyId = Deno.env.get("RAZORPAY_KEY_ID");
  const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
  if (!keyId || !keySecret) throw new Error("missing_razorpay_configuration");
  return `Basic ${btoa(`${keyId}:${keySecret}`)}`;
}

async function razorpay(path: string, init: RequestInit = {}): Promise<Row> {
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: razorpayAuth(),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.description ?? data?.error?.reason ?? "razorpay_request_failed");
  return data;
}

function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function qrDataUrl(url: string): Promise<string> {
  const svg = await QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 420,
    color: { dark: "#07111f", light: "#ffffff" },
  });
  return `data:image/svg+xml;base64,${toBase64(svg)}`;
}

async function catalog(supabase: AdminClient): Promise<{ store: Row; plans: Row[] }> {
  const [{ data: stores, error: storeError }, { data: timePlans, error: planError }, { data: prices, error: priceError }] =
    await Promise.all([
      supabase.from("stores").select("id, name, active").eq("active", true).order("name"),
      supabase.from("time_plans").select("id, name, duration_minutes, active, sort_order").eq("active", true).order("sort_order"),
      supabase.from("store_time_plan_prices").select("store_id, time_plan_id, amount_paise, currency, active").eq("active", true),
    ]);
  if (storeError) throw storeError;
  if (planError) throw planError;
  if (priceError) throw priceError;
  const requestedStoreId = text(Deno.env.get("NXGS_PC_STORE_ID"));
  const store = (stores ?? []).find((row: Row) => row.id === requestedStoreId) ?? stores?.[0];
  if (!store) throw new Error("payment_store_not_found");
  const plans = (timePlans ?? []).flatMap((plan: Row) => {
    const price = (prices ?? []).find((row: Row) => row.store_id === store.id && row.time_plan_id === plan.id);
    if (!price || Number(price.amount_paise) <= 0) return [];
    return [{
      id: String(plan.id),
      name: String(plan.name),
      durationMinutes: Number(plan.duration_minutes),
      amountPaise: Number(price.amount_paise),
      currency: String(price.currency || "INR").toUpperCase(),
      storeId: String(store.id),
    }];
  });
  return { store, plans };
}

function publicPlan(row: Row): Row {
  return {
    id: String(row.time_plan_id),
    name: String(row.plan_name ?? "Play session"),
    durationMinutes: Number(row.duration_minutes),
    amountPaise: Number(row.amount_paise),
    currency: String(row.currency || "INR").toUpperCase(),
  };
}

async function publicCheckout(row: Row, clientToken: string): Promise<Row> {
  return {
    id: String(row.id),
    clientToken,
    status: String(row.status),
    plan: publicPlan(row),
    qrDataUrl: row.razorpay_payment_link_url ? await qrDataUrl(String(row.razorpay_payment_link_url)) : "",
    expiresAt: String(row.expires_at),
  };
}

async function requireCheckout(supabase: AdminClient, body: Row): Promise<{ checkout: Row; token: string }> {
  const checkoutId = text(body.checkout_id);
  const token = text(body.client_token);
  if (!checkoutId || !token) throw new Error("unauthorized_checkout");
  const { data, error } = await supabase.from("pc_checkouts").select("*").eq("id", checkoutId).single();
  if (error || !data) throw new Error("checkout_not_found");
  if (!constantTimeEqual(await hashToken(token), String(data.client_token_hash))) {
    throw new Error("unauthorized_checkout");
  }
  return { checkout: data, token };
}

async function createProviderLink(row: Row): Promise<Row> {
  return await razorpay("/payment_links", {
    method: "POST",
    body: JSON.stringify({
      amount: Number(row.amount_paise),
      currency: String(row.currency),
      accept_partial: false,
      reference_id: String(row.razorpay_payment_link_reference),
      description: `NXGS Play station session - ${row.plan_name}`.slice(0, 255),
      expire_by: Math.floor(Date.now() / 1000) + PROVIDER_EXPIRY_SECONDS,
      reminder_enable: false,
      notify: { sms: false, email: false },
      notes: {
        pc_checkout_id: String(row.id),
        entitlement_scope: "station",
        time_plan_id: String(row.time_plan_id),
        duration_minutes: String(row.duration_minutes),
      },
    }),
  });
}

async function saveProviderLink(supabase: AdminClient, row: Row): Promise<Row> {
  try {
    const link = await createProviderLink(row);
    const { data, error } = await supabase.from("pc_checkouts").update({
      status: "created",
      provider_status: String(link.status),
      razorpay_payment_link_id: String(link.id),
      razorpay_payment_link_url: String(link.short_url),
      last_provider_check_at: new Date().toISOString(),
    }).eq("id", row.id).select().single();
    if (error || !data) throw error ?? new Error("payment_link_save_failed");
    return { ...data, plan_name: row.plan_name };
  } catch (error) {
    await supabase.from("pc_checkouts").update({
      status: "failed",
      provider_status: "failed",
      terminal_reason: safeMessage(error),
    }).eq("id", row.id);
    throw error;
  }
}

function capturedPaymentId(link: Row): string {
  const payments = Array.isArray(link.payments) ? link.payments : [];
  const captured = payments.find((item: Row) => item?.status === "captured") ?? payments[0];
  return text(captured?.payment_id ?? captured?.id);
}

async function reconcilePaid(supabase: AdminClient, checkout: Row, link: Row): Promise<Row> {
  if (String(link.id) !== String(checkout.razorpay_payment_link_id)
      || String(link.reference_id) !== String(checkout.razorpay_payment_link_reference)
      || Number(link.amount) !== Number(checkout.amount_paise)
      || String(link.currency).toUpperCase() !== String(checkout.currency).toUpperCase()
      || Number(link.amount_paid) < Number(checkout.amount_paise)
      || String(link.status) !== "paid") {
    throw new Error("payment_link_mismatch");
  }
  const paymentId = capturedPaymentId(link);
  if (!paymentId) throw new Error("captured_payment_not_found");
  const payment = await razorpay(`/payments/${encodeURIComponent(paymentId)}`);
  if (String(payment.status) !== "captured"
      || Number(payment.amount) !== Number(checkout.amount_paise)
      || String(payment.currency).toUpperCase() !== String(checkout.currency).toUpperCase()) {
    throw new Error("payment_not_captured");
  }
  const { data, error } = await supabase.from("pc_checkouts").update({
    status: "verified",
    provider_status: "paid",
    razorpay_payment_id: paymentId,
    verified_at: new Date().toISOString(),
    last_provider_check_at: new Date().toISOString(),
  }).eq("id", checkout.id).in("status", ["creating", "created"]).select().maybeSingle();
  if (error) throw error;
  if (data) return data;
  const { data: current, error: currentError } = await supabase.from("pc_checkouts").select("*").eq("id", checkout.id).single();
  if (currentError || !current) throw currentError ?? new Error("checkout_not_found");
  return current;
}

async function refreshStatus(supabase: AdminClient, checkout: Row, force = false): Promise<Row> {
  if (checkout.status !== "created" && checkout.status !== "creating") return checkout;
  if (!checkout.razorpay_payment_link_id) return checkout;
  const lastCheck = checkout.last_provider_check_at ? new Date(checkout.last_provider_check_at).getTime() : 0;
  if (!force && Date.now() - lastCheck < PROVIDER_POLL_INTERVAL_MS) return checkout;
  let link = await razorpay(`/payment_links/${encodeURIComponent(checkout.razorpay_payment_link_id)}`);
  if (link.status === "paid") return await reconcilePaid(supabase, checkout, link);
  if (Date.now() >= new Date(checkout.expires_at).getTime()) {
    if (link.status === "created") {
      try {
        link = await razorpay(`/payment_links/${encodeURIComponent(checkout.razorpay_payment_link_id)}/cancel`, { method: "POST" });
      } catch {
        link = await razorpay(`/payment_links/${encodeURIComponent(checkout.razorpay_payment_link_id)}`);
        if (link.status === "paid") return await reconcilePaid(supabase, checkout, link);
      }
    }
    const { data } = await supabase.from("pc_checkouts").update({
      status: "expired", provider_status: String(link.status), terminal_reason: "payment_window_expired",
      last_provider_check_at: new Date().toISOString(),
    }).eq("id", checkout.id).in("status", ["creating", "created"]).select().maybeSingle();
    return data ?? checkout;
  }
  if (link.status === "cancelled" || link.status === "expired") {
    const status = link.status === "expired" ? "expired" : "cancelled";
    const { data } = await supabase.from("pc_checkouts").update({
      status, provider_status: String(link.status), terminal_reason: `provider_${link.status}`,
      last_provider_check_at: new Date().toISOString(),
    }).eq("id", checkout.id).in("status", ["creating", "created"]).select().maybeSingle();
    return data ?? checkout;
  }
  const { data } = await supabase.from("pc_checkouts").update({
    provider_status: String(link.status), last_provider_check_at: new Date().toISOString(),
  }).eq("id", checkout.id).select().single();
  return data ?? checkout;
}

async function createCheckout(supabase: AdminClient, body: Row): Promise<Response> {
  const timePlanId = text(body.time_plan_id);
  if (!timePlanId) throw new Error("invalid_checkout_selection");
  const { store, plans } = await catalog(supabase);
  const plan = plans.find((item) => item.id === timePlanId);
  if (!plan) throw new Error("invalid_pricing_selection");
  const clientToken = randomToken();
  const id = crypto.randomUUID();
  const reference = `nxgspc_${id.replaceAll("-", "")}`;
  const { data, error } = await supabase.from("pc_checkouts").insert({
    id,
    client_token_hash: await hashToken(clientToken),
    game_id: null,
    game_title: null,
    entitlement_scope: "station",
    store_id: store.id,
    time_plan_id: plan.id,
    plan_name: plan.name,
    duration_minutes: plan.durationMinutes,
    amount_paise: plan.amountPaise,
    currency: plan.currency,
    status: "creating",
    provider_status: "creating",
    razorpay_payment_link_reference: reference,
    expires_at: new Date(Date.now() + LOCAL_EXPIRY_SECONDS * 1000).toISOString(),
  }).select().single();
  if (error || !data) throw error ?? new Error("checkout_create_failed");
  const completed = await saveProviderLink(supabase, { ...data, plan_name: plan.name });
  return json({ status: completed.status, checkout: await publicCheckout(completed, clientToken) });
}

async function statusCheckout(supabase: AdminClient, body: Row): Promise<Response> {
  const { checkout, token } = await requireCheckout(supabase, body);
  const refreshed = await refreshStatus(supabase, checkout);
  return json({ status: refreshed.status, checkout: await publicCheckout(refreshed, token) });
}

async function retryCheckout(supabase: AdminClient, body: Row): Promise<Response> {
  const access = await requireCheckout(supabase, body);
  const current = await refreshStatus(supabase, access.checkout, true);
  if (current.status === "verified" || current.status === "consumed") {
    return json({ status: current.status, checkout: await publicCheckout(current, access.token) });
  }
  if (Number(current.attempt_number) >= MAX_ATTEMPTS) throw new Error("payment_attempt_limit_reached");
  if (current.razorpay_payment_link_id && current.provider_status === "created") {
    await razorpay(`/payment_links/${encodeURIComponent(current.razorpay_payment_link_id)}/cancel`, { method: "POST" });
  }
  const reference = `nxgspc_${crypto.randomUUID().replaceAll("-", "")}`;
  const { data, error } = await supabase.from("pc_checkouts").update({
    status: "creating",
    provider_status: "creating",
    razorpay_payment_link_id: null,
    razorpay_payment_link_url: null,
    razorpay_payment_link_reference: reference,
    razorpay_payment_id: null,
    attempt_number: Number(current.attempt_number) + 1,
    expires_at: new Date(Date.now() + LOCAL_EXPIRY_SECONDS * 1000).toISOString(),
    terminal_reason: null,
    last_provider_check_at: null,
  }).eq("id", current.id).neq("status", "consumed").select().single();
  if (error || !data) throw error ?? new Error("checkout_retry_failed");
  const catalogData = await catalog(supabase);
  const plan = catalogData.plans.find((item) => item.id === String(data.time_plan_id));
  if (!plan) throw new Error("invalid_pricing_selection");
  const completed = await saveProviderLink(supabase, { ...data, plan_name: plan.name });
  return json({ status: completed.status, checkout: await publicCheckout(completed, access.token) });
}

async function cancelCheckout(supabase: AdminClient, body: Row): Promise<Response> {
  const access = await requireCheckout(supabase, body);
  const current = await refreshStatus(supabase, access.checkout, true);
  if (current.status === "verified" || current.status === "consumed") {
    return json({ status: current.status, checkout: await publicCheckout(current, access.token) });
  }
  if (current.razorpay_payment_link_id && current.provider_status === "created") {
    await razorpay(`/payment_links/${encodeURIComponent(current.razorpay_payment_link_id)}/cancel`, { method: "POST" });
  }
  const { data, error } = await supabase.from("pc_checkouts").update({
    status: "cancelled", provider_status: "cancelled", terminal_reason: "user_cancelled",
    last_provider_check_at: new Date().toISOString(),
  }).eq("id", current.id).in("status", ["creating", "created", "failed", "expired"]).select().maybeSingle();
  if (error) throw error;
  const result = data ?? current;
  return json({ status: result.status, checkout: await publicCheckout(result, access.token) });
}

async function consumeCheckout(supabase: AdminClient, body: Row): Promise<Response> {
  const access = await requireCheckout(supabase, body);
  const current = await refreshStatus(supabase, access.checkout, true);
  if (current.status === "consumed") throw new Error("payment_entitlement_already_used");
  if (current.status !== "verified") throw new Error("payment_not_verified");
  const { data, error } = await supabase.from("pc_checkouts").update({
    status: "consumed", consumed_at: new Date().toISOString(),
  }).eq("id", current.id).eq("status", "verified").select().maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("payment_entitlement_already_used");
  return json({
    status: "consumed",
    entitlement: {
      checkoutId: String(data.id),
      durationMinutes: Number(data.duration_minutes),
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: true, message: "method_not_allowed" }, 405);
  if (!authorized(req)) return json({ error: true, message: "unauthorized_client" }, 401);
  try {
    const body = await req.json().catch(() => ({})) as Row;
    const action = text(body.action).toLowerCase();
    const supabase = admin();
    if (action === "pricing") {
      const result = await catalog(supabase);
      return json({ plans: result.plans.map(({ storeId: _storeId, ...plan }) => plan) });
    }
    if (action === "create") return await createCheckout(supabase, body);
    if (action === "status") return await statusCheckout(supabase, body);
    if (action === "retry") return await retryCheckout(supabase, body);
    if (action === "cancel") return await cancelCheckout(supabase, body);
    if (action === "consume") return await consumeCheckout(supabase, body);
    return json({ error: true, message: "invalid_payment_action" }, 400);
  } catch (error) {
    return failure(error);
  }
});
