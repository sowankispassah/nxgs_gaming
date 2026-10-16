const endpoint = 'https://oqcezdcnozgguytudliv.supabase.co/functions/v1/pcPayment';
const params = new URLSearchParams(location.hash.slice(1));
const access = { checkout_id: params.get('checkout') || '', mobile_token: params.get('token') || '' };
const byId = (id) => document.getElementById(id);
const form = byId('details-form');
const button = byId('submit');
const errorBox = byId('error');
let expiresAt = 0;
let detailsSubmitted = false;
let busy = false;
let expiryTimer;

const messages = {
  unauthorized_checkout: 'This session link is no longer valid. Scan the current QR code on your station.',
  checkout_expired: 'This session link has expired. Start again on your station and scan the new QR code.',
  invalid_customer_name: 'Please enter your name, using up to 80 characters.',
  invalid_customer_phone: 'Please enter a valid 10-digit Indian mobile number.',
  payment_already_completed: 'Payment is already complete. Return to your station to play.',
  payment_in_progress: 'Your payment is being prepared. Please try again in a few seconds.'
};

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

async function invoke(action, details = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...access, ...details }),
    signal: AbortSignal.timeout(25000),
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer'
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    const error = new Error(messages[data.message] || 'Payment is unavailable right now. Please try again or ask staff for help.');
    error.code = data.message;
    throw error;
  }
  return data;
}

function tick() {
  const seconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  byId('expiry').textContent = `Complete payment within ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  if (!seconds) {
    clearInterval(expiryTimer);
    form.hidden = true;
    showError(messages.checkout_expired);
  }
}

async function load() {
  errorBox.hidden = true;
  byId('loading').hidden = false;
  try {
    if (!/^[a-f0-9-]{36}$/i.test(access.checkout_id) || !/^[a-f0-9]{64}$/.test(access.mobile_token)) {
      throw new Error('Scan the QR code on your NXGS Play station to open your session.');
    }
    const data = await invoke('mobile_view');
    byId('plan').hidden = false;
    byId('duration').textContent = `${data.plan.durationMinutes} minutes`;
    byId('plan-name').textContent = data.plan.name;
    byId('amount').textContent = new Intl.NumberFormat('en-IN', { style: 'currency', currency: data.plan.currency, maximumFractionDigits: 2 }).format(data.plan.amountPaise / 100);
    if (data.status === 'paid') {
      byId('heading').textContent = 'You’re ready to play.';
      byId('intro').textContent = 'Your payment is confirmed.';
      byId('success').textContent = 'Return to your station. Your session will be ready there.';
      byId('success').hidden = false;
      form.hidden = true;
      byId('expiry').hidden = true;
      clearInterval(expiryTimer);
      return;
    }
    detailsSubmitted = data.detailsSubmitted;
    byId('fields').hidden = detailsSubmitted;
    byId('fields').disabled = detailsSubmitted;
    if (detailsSubmitted) byId('intro').textContent = 'Your details are saved. Continue to complete your payment.';
    expiresAt = new Date(data.expiresAt).getTime();
    form.hidden = false;
    byId('expiry').hidden = false;
    clearInterval(expiryTimer);
    tick();
    expiryTimer = setInterval(tick, 1000);
  } catch (error) {
    showError(error.message || 'Could not load your session. Please scan the QR code again.');
  } finally {
    byId('loading').hidden = true;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || Date.now() >= expiresAt) return;
  busy = true;
  button.disabled = true;
  byId('button-label').textContent = 'Preparing payment…';
  errorBox.hidden = true;
  try {
    const details = detailsSubmitted ? {} : {
      customer_name: byId('customer-name').value,
      customer_phone: byId('customer-phone').value
    };
    const result = await invoke('mobile_pay', details);
    const url = new URL(result.paymentUrl);
    if (url.protocol !== 'https:' || url.username || url.password || !['rzp.io', 'rzp.link', 'razorpay.com'].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
      throw new Error('Could not open secure payment. Please ask staff for help.');
    }
    byId('customer-name').value = '';
    byId('customer-phone').value = '';
    detailsSubmitted = true;
    location.assign(url.href);
  } catch (error) {
    showError(error.message || 'Could not prepare payment. Please try again.');
    if (['checkout_expired', 'unauthorized_checkout', 'payment_already_completed'].includes(error.code)) form.hidden = true;
  } finally {
    busy = false;
    button.disabled = false;
    byId('button-label').textContent = 'Continue to payment';
  }
});

// Refresh after returning from Razorpay, including the browser back/forward cache.
window.addEventListener('pageshow', (event) => { if (event.persisted) void load(); });
// Scanning a second QR in the same browser tab changes only the fragment.
window.addEventListener('hashchange', () => location.reload());
void load();
