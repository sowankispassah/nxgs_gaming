create table if not exists public.stores (
    id uuid primary key default gen_random_uuid(),
    name text not null unique,
    location text,
    active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.time_plans (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    duration_minutes integer not null unique check (duration_minutes > 0),
    active boolean not null default true,
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.store_time_plan_prices (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references public.stores(id) on delete restrict,
    time_plan_id uuid not null references public.time_plans(id) on delete restrict,
    amount_paise integer not null check (amount_paise > 0),
    currency text not null default 'INR',
    active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (store_id, time_plan_id)
);

create index if not exists store_time_plan_prices_store_idx
    on public.store_time_plan_prices (store_id);
create index if not exists store_time_plan_prices_time_plan_idx
    on public.store_time_plan_prices (time_plan_id);

alter table public.stores enable row level security;
alter table public.time_plans enable row level security;
alter table public.store_time_plan_prices enable row level security;

revoke all on table public.stores from public, anon, authenticated;
revoke all on table public.time_plans from public, anon, authenticated;
revoke all on table public.store_time_plan_prices from public, anon, authenticated;
grant all on table public.stores to service_role;
grant all on table public.time_plans to service_role;
grant all on table public.store_time_plan_prices to service_role;

insert into public.stores (name, location, active)
values ('NXGS Play', '', true)
on conflict (name) do update set active = excluded.active;

insert into public.time_plans (name, duration_minutes, active, sort_order)
values
    ('Quick test', 5, true, 5),
    ('Popular', 30, true, 30),
    ('1 Hour', 60, true, 60),
    ('1.5 Hours', 90, true, 90),
    ('2 Hours', 120, true, 120),
    ('Best value', 180, true, 180),
    ('4 Hours', 240, true, 240)
on conflict (duration_minutes) do update
set name = excluded.name,
    active = excluded.active,
    sort_order = excluded.sort_order;

insert into public.store_time_plan_prices (store_id, time_plan_id, amount_paise, currency, active)
select store_row.id, plan_row.id, price.amount_paise, 'INR', true
from public.stores store_row
cross join (values
    (5, 200),
    (30, 7000),
    (60, 12000),
    (90, 16000),
    (120, 20000),
    (180, 30000),
    (240, 40000)
) as price(duration_minutes, amount_paise)
join public.time_plans plan_row on plan_row.duration_minutes = price.duration_minutes
where store_row.name = 'NXGS Play'
on conflict (store_id, time_plan_id) do update
set amount_paise = excluded.amount_paise,
    currency = excluded.currency,
    active = excluded.active;

create table if not exists public.pc_checkouts (
    id uuid primary key default gen_random_uuid(),
    client_token_hash text not null,
    game_id text not null,
    game_title text not null,
    store_id uuid not null references public.stores(id) on delete restrict,
    time_plan_id uuid not null references public.time_plans(id) on delete restrict,
    plan_name text not null,
    duration_minutes integer not null check (duration_minutes > 0),
    amount_paise integer not null check (amount_paise > 0),
    currency text not null default 'INR',
    status text not null default 'creating'
        check (status in ('creating', 'created', 'verified', 'consumed', 'cancelled', 'expired', 'failed')),
    razorpay_payment_link_id text,
    razorpay_payment_link_url text,
    razorpay_payment_link_reference text not null,
    razorpay_payment_id text,
    provider_status text not null default 'creating',
    attempt_number integer not null default 1 check (attempt_number between 1 and 3),
    expires_at timestamptz not null,
    last_provider_check_at timestamptz,
    verified_at timestamptz,
    consumed_at timestamptz,
    terminal_reason text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists pc_checkouts_payment_link_id_idx
    on public.pc_checkouts(razorpay_payment_link_id)
    where razorpay_payment_link_id is not null;

create unique index if not exists pc_checkouts_reference_idx
    on public.pc_checkouts(razorpay_payment_link_reference);

create index if not exists pc_checkouts_status_expiry_idx
    on public.pc_checkouts(status, expires_at);

alter table public.pc_checkouts enable row level security;

revoke all on table public.pc_checkouts from public, anon, authenticated;
grant all on table public.pc_checkouts to service_role;

comment on table public.pc_checkouts is
    'Server-authoritative Razorpay checkout attempts for local NXGS Play game sessions.';
comment on column public.pc_checkouts.client_token_hash is
    'SHA-256 hash of the unguessable token returned once to the kiosk client.';

create or replace function public.touch_pc_checkout_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists pc_checkouts_touch_updated_at on public.pc_checkouts;
create trigger pc_checkouts_touch_updated_at
before update on public.pc_checkouts
for each row execute function public.touch_pc_checkout_updated_at();
