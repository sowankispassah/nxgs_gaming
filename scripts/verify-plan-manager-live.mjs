import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const values = new Map();
let section = '';
for (const sourceLine of (await readFile(new URL('../build/nxgs-client.ini', import.meta.url), 'utf8')).split(/\r?\n/)) {
  const line = sourceLine.trim();
  if (!line || line.startsWith(';') || line.startsWith('#')) continue;
  const sectionMatch = /^\[([^\]]+)\]$/.exec(line);
  if (sectionMatch) {
    section = sectionMatch[1].toLowerCase();
    continue;
  }
  const separator = line.indexOf('=');
  if (separator > 0) values.set(`${section}/${line.slice(0, separator).trim().toLowerCase()}`, line.slice(separator + 1).trim());
}

const functionBaseUrl = values.get('backend/function_base_url');
const publishableKey = values.get('backend/supabase_anon_key');
if (!functionBaseUrl || !publishableKey) throw new Error('NXGS payment endpoint is not configured.');

const invoke = async (body) => {
  const response = await fetch(`${functionBaseUrl}/pcPayment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: publishableKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.error === true) throw new Error(result.message || `Payment service returned ${response.status}.`);
  return result;
};

let checkout;
try {
  const created = await invoke({
    action: 'create',
    plan: {
      id: `integration_plan_${Date.now()}`,
      name: '30 Minutes',
      durationMinutes: 30,
      amountPaise: 5000,
      currency: 'INR'
    }
  });
  checkout = created.checkout;
  assert.equal(checkout.plan.durationMinutes, 30);
  assert.equal(checkout.plan.amountPaise, 5000);
  assert.equal(checkout.plan.currency, 'INR');
  const cancelled = await invoke({
    action: 'cancel',
    checkout_id: checkout.id,
    client_token: checkout.clientToken
  });
  assert.equal(cancelled.status, 'cancelled');
  checkout = null;
  console.log('Live Supabase/Razorpay checkout accepted the local plan snapshot and cancelled the test link.');
} finally {
  if (checkout) {
    await invoke({ action: 'cancel', checkout_id: checkout.id, client_token: checkout.clientToken }).catch(() => {});
  }
}
