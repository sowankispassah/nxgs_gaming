import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { customerDetails, mobileToken, paymentUrl } from '../supabase/functions/pcPayment/mobileCheckout.ts';

assert.deepEqual(customerDetails('  D’Silva   玩家  ', '98765 43210'), { name: 'D’Silva 玩家', phone: '+919876543210' });
assert.equal(customerDetails('A', '+91 (98765) 43210').phone, '+919876543210');
for (const name of ['', ' '.repeat(5), 'a'.repeat(81), 'A\u200bB']) assert.throws(() => customerDetails(name, '9876543210'), /invalid_customer_name/);
for (const phone of ['', '1234567890', '987654321', '9876543210123', 'abc9876543210', '+449876543210']) assert.throws(() => customerDetails('Player', phone), /invalid_customer_phone/);
for (const url of ['http://rzp.io/link', 'https://rzp.io.evil.example/link', 'https://user@rzp.io/link']) assert.throws(() => paymentUrl(url), /invalid_payment_url/);

const tables = { pc_checkouts: [], stores: [{ id: 'store-1', name: 'NXGS', active: true }] };
const clone = (value) => structuredClone(value);
class Query {
  constructor(table) { this.table = table; this.filters = []; this.operation = 'select'; }
  select() { return this; }
  eq(key, value) { this.filters.push((row) => row[key] === value); return this; }
  neq(key, value) { this.filters.push((row) => row[key] !== value); return this; }
  gt(key, value) { this.filters.push((row) => row[key] > value); return this; }
  is(key, value) { this.filters.push((row) => (row[key] ?? null) === value); return this; }
  in(key, values) { this.filters.push((row) => values.includes(row[key])); return this; }
  order() { return this; }
  insert(data) { this.operation = 'insert'; this.value = clone(data); return this; }
  update(data) { this.operation = 'update'; this.value = clone(data); return this; }
  execute(single = false) {
    let rows;
    if (this.operation === 'insert') {
      const row = { attempt_number: 1, razorpay_payment_link_id: null, ...this.value };
      tables[this.table].push(row); rows = [row];
    } else {
      rows = tables[this.table].filter((row) => this.filters.every((filter) => filter(row)));
      if (this.operation === 'update') rows.forEach((row) => Object.assign(row, clone(this.value)));
    }
    return Promise.resolve({ data: clone(single ? rows[0] ?? null : rows), error: null });
  }
  single() { return this.execute(true); }
  maybeSingle() { return this.execute(true); }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
}

const providerLinks = new Map();
const createdPayloads = [];
const qrUrls = [];
const secret = 'test-server-secret';
let handler;
let blockProvider;
let providerStarted;
const source = await readFile(new URL('../supabase/functions/pcPayment/index.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
vm.runInNewContext(compiled.outputText, {
  exports: {}, Error, Request, Response, URL, URLSearchParams, TextEncoder, Uint8Array, crypto, btoa, console,
  Deno: { env: { get: (key) => ({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: secret, SUPABASE_ANON_KEY: 'station-key', RAZORPAY_KEY_ID: 'test-key', RAZORPAY_KEY_SECRET: 'test-secret' })[key] }, serve: (value) => { handler = value; } },
  require: (name) => {
    if (name.startsWith('npm:qrcode')) return { toString: async (url) => { qrUrls.push(url); return '<svg/>'; } };
    if (name.startsWith('npm:@supabase/supabase-js')) return { createClient: () => ({ from: (table) => new Query(table) }) };
    if (name === './mobileCheckout.ts') return { customerDetails, mobileToken, paymentUrl, DEFAULT_CHECKOUT_PAGE_URL: 'https://nxgs-play-checkout.vercel.app/' };
    throw new Error(`Unexpected import ${name}`);
  },
  fetch: async (url, init = {}) => {
    const path = new URL(url).pathname.replace('/v1', '');
    if (path === '/payment_links' && init.method === 'POST') {
      const payload = JSON.parse(init.body);
      createdPayloads.push(payload);
      providerStarted?.();
      if (blockProvider) await blockProvider;
      const id = `plink_${providerLinks.size + 1}`;
      const link = { ...payload, id, short_url: `https://rzp.io/rzp/${id}`, status: 'created', amount_paid: 0 };
      providerLinks.set(id, link);
      return Response.json(link);
    }
    const id = path.split('/')[2];
    if (path.startsWith('/payment_links/')) {
      const link = providerLinks.get(id);
      if (path.endsWith('/cancel')) link.status = 'cancelled';
      return Response.json(link);
    }
    if (path.startsWith('/payments/')) return Response.json({ status: 'captured', amount: 100, currency: 'INR' });
    throw new Error(`Unexpected provider request ${path}`);
  }
});

async function request(body, station = false) {
  const response = await handler(new Request('https://test.supabase.co/functions/v1/pcPayment', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(station ? { apikey: 'station-key' } : {}) }, body: JSON.stringify(body)
  }));
  return { status: response.status, data: await response.json() };
}
async function create() {
  const result = await request({ action: 'create', plan: { id: 'test-plan', name: 'Test play', durationMinutes: 5, amountPaise: 100, currency: 'INR' } }, true);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const checkout = result.data.checkout;
  const params = new URLSearchParams(new URL(qrUrls.at(-1)).hash.slice(1));
  return { row: tables.pc_checkouts.find((row) => row.id === checkout.id), station: { checkout_id: checkout.id, client_token: checkout.clientToken }, mobile: { checkout_id: checkout.id, mobile_token: params.get('token') } };
}
const first = await create();
assert.equal(createdPayloads.length, 0, 'Scanning must collect details before creating the provider link');
assert.equal((await request({ action: 'mobile_view', ...first.mobile })).data.detailsSubmitted, false);
assert.equal((await request({ action: 'mobile_view', ...first.mobile, mobile_token: 'a'.repeat(64) })).status, 401);
assert.equal((await request({ action: 'consume', ...first.mobile })).status, 401);
assert.equal((await request({ action: 'consume', ...first.station, client_token: first.mobile.mobile_token }, true)).status, 401);
assert.equal((await request({ action: 'consume', ...first.station }, true)).data.message, 'payment_not_verified');
const submit = { action: 'mobile_pay', ...first.mobile, customer_name: '  Test Player  ', customer_phone: '9876543210' };
assert.equal((await request({ ...submit, customer_name: '' })).status, 400);
assert.equal((await request({ ...submit, customer_phone: '123' })).status, 400);
assert.equal(createdPayloads.length, 0);
const submissions = await Promise.all([request(submit), request(submit)]);
assert.equal(createdPayloads.length, 1, 'Concurrent taps must create a single provider link');
assert.ok(submissions.some((result) => result.status === 200));
assert.ok(submissions.every((result) => [200, 409].includes(result.status)));
assert.deepEqual(createdPayloads[0].customer, { name: 'Test Player', contact: '+919876543210' });
assert.deepEqual(createdPayloads[0].notify, { sms: false, email: false });
assert.equal(first.row.customer_name, 'Test Player');
assert.equal(first.row.status, 'created', 'Saving customer details must not verify payment');
assert.equal((await request({ action: 'mobile_pay', ...first.mobile })).data.paymentUrl, 'https://rzp.io/rzp/plink_1');
assert.equal(createdPayloads.length, 1);
const view = (await request({ action: 'mobile_view', ...first.mobile })).data;
assert.equal(view.detailsSubmitted, true);
assert.equal(view.customer_name, undefined, 'The view endpoint must not echo personal details');
assert.equal(view.clientToken, undefined, 'The mobile endpoint must not disclose station access');
const paidLink = providerLinks.get(first.row.razorpay_payment_link_id);
paidLink.status = 'paid'; paidLink.amount_paid = 99; paidLink.payments = [{ status: 'captured', payment_id: 'pay_test' }];
assert.equal((await request({ action: 'consume', ...first.station }, true)).data.message, 'payment_link_mismatch');
assert.equal(first.row.status, 'created', 'An underpaid provider link must not grant play time');
paidLink.amount_paid = 100;
assert.equal((await request({ action: 'consume', ...first.station }, true)).data.status, 'consumed');
assert.equal((await request({ action: 'consume', ...first.station }, true)).data.message, 'payment_entitlement_already_used');
assert.equal((await request({ action: 'mobile_view', ...first.mobile })).data.status, 'paid');

const expired = await create();
expired.row.expires_at = new Date(Date.now() - 1000).toISOString();
expired.mobile.mobile_token = await mobileToken(expired.row, secret);
assert.equal((await request({ action: 'mobile_pay', ...expired.mobile, customer_name: 'Player', customer_phone: '9876543210' })).data.message, 'checkout_expired');
assert.equal((await request({ action: 'status', ...expired.station }, true)).data.status, 'expired');
assert.equal((await request({ action: 'retry', ...expired.station }, true)).data.status, 'created');
assert.equal((await request({ action: 'mobile_view', ...expired.mobile })).status, 401, 'Retry must invalidate the old phone link');

const cancelled = await create();
await request({ action: 'cancel', ...cancelled.station }, true);
assert.equal((await request({ action: 'mobile_pay', ...cancelled.mobile, customer_name: 'Player', customer_phone: '9876543210' })).status, 409);

// Cancelling the station during a slow provider request must cancel the orphan link.
const racing = await create();
let releaseProvider;
blockProvider = new Promise((resolve) => { releaseProvider = resolve; });
const started = new Promise((resolve) => { providerStarted = resolve; });
const pending = request({ action: 'mobile_pay', ...racing.mobile, customer_name: 'Player', customer_phone: '9876543210' });
await started;
await request({ action: 'cancel', ...racing.station }, true);
releaseProvider();
assert.equal((await pending).status, 409);
assert.equal(racing.row.status, 'cancelled');
assert.equal([...providerLinks.values()].at(-1).status, 'cancelled');

blockProvider = null;
providerStarted = null;
const legacy = await create();
legacy.row.customer_details_required = false;
legacy.row.razorpay_payment_link_id = 'plink_legacy';
legacy.row.razorpay_payment_link_url = 'https://rzp.io/rzp/legacy';
providerLinks.set('plink_legacy', { id: 'plink_legacy', status: 'created' });
assert.equal((await request({ action: 'status', ...legacy.station }, true)).data.status, 'created');
assert.equal(qrUrls.at(-1), 'https://rzp.io/rzp/legacy', 'Existing provider QR codes must keep working');
assert.equal((await request({ action: 'mobile_view', ...legacy.mobile })).status, 401);

console.log('Mobile checkout verified: validation, scoped access, duplicate submissions, capture-only entitlement, expiry, retry and cancellation races.');
