-- Razorpay payer details for the Accounts earnings table (NXGS Play 0.25.0).
-- Captured by pcPayment when a payment verifies, or lazily backfilled by
-- stationFleet. All columns are optional: missing details never block payment.
alter table public.pc_checkouts
    add column if not exists payer_phone text,
    add column if not exists payer_email text,
    add column if not exists payer_name text,
    add column if not exists payment_method text,
    add column if not exists payer_upi_id text,
    add column if not exists payment_bank text,
    add column if not exists payment_wallet text,
    add column if not exists card_network text,
    add column if not exists card_last4 text,
    add column if not exists payment_captured_at timestamptz,
    add column if not exists payer_details_fetched_at timestamptz;

comment on column public.pc_checkouts.payer_phone is 'Razorpay payment contact (phone) as reported by Razorpay.';
comment on column public.pc_checkouts.payer_email is 'Razorpay payment email; the void@razorpay.com placeholder is not stored.';
comment on column public.pc_checkouts.payer_name is 'Payment notes name, else the customer-provided name, when known.';
comment on column public.pc_checkouts.payment_method is 'Razorpay payment method (upi, card, netbanking, wallet, ...).';
comment on column public.pc_checkouts.payer_upi_id is 'UPI VPA used for the payment, when Razorpay reports it.';
comment on column public.pc_checkouts.payment_bank is 'Net banking bank code reported by Razorpay.';
comment on column public.pc_checkouts.payment_wallet is 'Wallet name reported by Razorpay.';
comment on column public.pc_checkouts.card_network is 'Card network only; full card numbers are never stored.';
comment on column public.pc_checkouts.card_last4 is 'Last four card digits as reported by Razorpay.';
comment on column public.pc_checkouts.payment_captured_at is 'Razorpay payment created_at (unix seconds) as a timestamp.';
comment on column public.pc_checkouts.payer_details_fetched_at is
    'When payer details were read from Razorpay; null means stationFleet may backfill them.';
-- Keep the existing service-role-only grants and RLS; no public table access.
