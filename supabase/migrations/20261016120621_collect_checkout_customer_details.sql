-- Existing Payment Link QR codes continue to work; new attempts opt into details.
alter table public.pc_checkouts
  add column customer_details_required boolean not null default false,
  add column customer_name text,
  add column customer_phone text,
  add column customer_details_at timestamptz,
  add constraint pc_checkouts_customer_name_length check (
    customer_name is null or char_length(btrim(customer_name)) between 1 and 80
  ),
  add constraint pc_checkouts_customer_phone_format check (
    customer_phone is null or customer_phone ~ '^\+91[6-9][0-9]{9}$'
  ),
  add constraint pc_checkouts_customer_details_complete check (
    (customer_name is null and customer_phone is null and customer_details_at is null)
    or (customer_name is not null and customer_phone is not null and customer_details_at is not null)
  );

comment on column public.pc_checkouts.customer_name is 'Customer-provided name for this checkout, not a verified identity.';
comment on column public.pc_checkouts.customer_phone is 'Customer-provided Indian mobile number in +91 format.';
-- Keep the existing service-role-only grants and RLS; no public table access.
