-- NXGS Play 0.25.0: cloud Device Management (Accounts + All Devices).
-- Only the stationFleet edge function (service role) reads or writes these
-- tables; stations and the renderer never get direct table access.

create table if not exists public.fleet_owner (
    id smallint primary key default 1 check (id = 1),
    pin_hash text,
    failed_attempts integer not null default 0 check (failed_attempts >= 0),
    locked_until timestamptz,
    updated_at timestamptz not null default now()
);

-- While pin_hash is null the main admin PIN is the documented default (1832).
insert into public.fleet_owner (id, pin_hash)
values (1, null)
on conflict (id) do nothing;

create table if not exists public.fleet_owner_sessions (
    id uuid primary key default gen_random_uuid(),
    token_hash text not null unique,
    expires_at timestamptz not null,
    created_at timestamptz not null default now(),
    last_used_at timestamptz not null default now()
);

create index if not exists fleet_owner_sessions_expires_at_idx
    on public.fleet_owner_sessions (expires_at);

create table if not exists public.fleet_stations (
    id text primary key check (id ~ '^[A-Za-z0-9_-]{3,80}$'),
    token_hash text,
    name text not null check (char_length(name) between 1 and 80),
    store_name text not null default '' check (char_length(store_name) <= 120),
    location text not null default '' check (char_length(location) <= 160),
    status text not null default 'active' check (status in ('active', 'inactive')),
    app_version text not null default '',
    local_updated_at timestamptz,
    owner_updated_at timestamptz,
    registered_at timestamptz not null default now(),
    last_seen_at timestamptz,
    removed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists fleet_stations_last_seen_at_idx
    on public.fleet_stations (last_seen_at desc nulls last);

create table if not exists public.fleet_station_games (
    station_id text not null references public.fleet_stations(id) on delete cascade,
    game_id text not null check (char_length(game_id) between 1 and 200),
    title text not null default '',
    enabled boolean not null default true,
    launch_type text not null default '',
    source text not null default '',
    availability_status text not null default '',
    local_updated_at timestamptz,
    owner_enabled boolean,
    owner_updated_at timestamptz,
    deleted_at timestamptz,
    updated_at timestamptz not null default now(),
    primary key (station_id, game_id)
);

-- Sessions keep earnings history, so a station row cannot be hard-deleted
-- while it still has sessions (remove_station only soft-removes).
create table if not exists public.fleet_sessions (
    station_id text not null references public.fleet_stations(id),
    session_id text not null check (char_length(session_id) between 1 and 200),
    status text not null check (status in ('active', 'completed', 'expired', 'interrupted')),
    started_at timestamptz not null,
    expires_at timestamptz not null,
    ended_at timestamptz,
    duration_minutes integer not null default 0 check (duration_minutes between 0 and 100000),
    amount_paise integer not null default 0 check (amount_paise between 0 and 100000000),
    currency text not null default 'INR',
    plan_ids text[] not null default '{}',
    plan_names text[] not null default '{}',
    checkout_ids text[] not null default '{}',
    games jsonb not null default '[]'::jsonb check (jsonb_typeof(games) = 'array'),
    local_updated_at timestamptz,
    synced_at timestamptz not null default now(),
    primary key (station_id, session_id)
);

create index if not exists fleet_sessions_started_at_idx
    on public.fleet_sessions (started_at desc);
create index if not exists fleet_sessions_station_started_at_idx
    on public.fleet_sessions (station_id, started_at desc);

create table if not exists public.fleet_moderators (
    id uuid primary key default gen_random_uuid(),
    name text not null check (char_length(name) between 1 and 60),
    pin_hash text not null,
    active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz
);

create table if not exists public.fleet_moderator_stations (
    moderator_id uuid not null references public.fleet_moderators(id) on delete cascade,
    station_id text not null references public.fleet_stations(id) on delete cascade,
    primary key (moderator_id, station_id)
);

create index if not exists fleet_moderator_stations_station_id_idx
    on public.fleet_moderator_stations (station_id);

-- Per-station aggregates for CloudStation (game_count, session_count, total_revenue_paise).
create or replace view public.fleet_station_totals
with (security_invoker = true) as
select
    station.id as station_id,
    game_totals.game_count,
    session_totals.session_count,
    session_totals.total_revenue_paise
from public.fleet_stations station
cross join lateral (
    select count(*)::integer as game_count
    from public.fleet_station_games game
    where game.station_id = station.id and game.deleted_at is null
) game_totals
cross join lateral (
    select count(*)::integer as session_count,
           coalesce(sum(fleet_session.amount_paise), 0)::bigint as total_revenue_paise
    from public.fleet_sessions fleet_session
    where fleet_session.station_id = station.id
) session_totals;

alter table public.fleet_owner enable row level security;
alter table public.fleet_owner_sessions enable row level security;
alter table public.fleet_stations enable row level security;
alter table public.fleet_station_games enable row level security;
alter table public.fleet_sessions enable row level security;
alter table public.fleet_moderators enable row level security;
alter table public.fleet_moderator_stations enable row level security;

revoke all on table public.fleet_owner from public, anon, authenticated;
revoke all on table public.fleet_owner_sessions from public, anon, authenticated;
revoke all on table public.fleet_stations from public, anon, authenticated;
revoke all on table public.fleet_station_games from public, anon, authenticated;
revoke all on table public.fleet_sessions from public, anon, authenticated;
revoke all on table public.fleet_moderators from public, anon, authenticated;
revoke all on table public.fleet_moderator_stations from public, anon, authenticated;
revoke all on table public.fleet_station_totals from public, anon, authenticated;
grant all on table public.fleet_owner to service_role;
grant all on table public.fleet_owner_sessions to service_role;
grant all on table public.fleet_stations to service_role;
grant all on table public.fleet_station_games to service_role;
grant all on table public.fleet_sessions to service_role;
grant all on table public.fleet_moderators to service_role;
grant all on table public.fleet_moderator_stations to service_role;
grant select on table public.fleet_station_totals to service_role;

comment on table public.fleet_owner is
    'Single main admin (owner) credential row for NXGS Play Device Management.';
comment on column public.fleet_owner.pin_hash is
    'pbkdf2-sha256$<iterations>$<saltHex>$<hashHex>; null means the default PIN 1832 is still in use.';
comment on column public.fleet_owner.locked_until is
    'Set for 10 minutes after 5 consecutive wrong main admin PINs.';
comment on table public.fleet_owner_sessions is
    'Main admin sessions with a 30 minute sliding expiry.';
comment on column public.fleet_owner_sessions.token_hash is
    'SHA-256 hash of the owner token returned once to the station main process.';
comment on table public.fleet_stations is
    'NXGS Play stations (local device IDs) registered with Device Management.';
comment on column public.fleet_stations.token_hash is
    'SHA-256 hash of the station token; null after the main admin removes the station.';
comment on column public.fleet_stations.owner_updated_at is
    'Last main admin edit of name/store/location/status; newer than local_updated_at wins.';
comment on table public.fleet_station_games is
    'Game library reported by each station, plus pending main admin enable/disable overrides.';
comment on column public.fleet_station_games.owner_enabled is
    'Pending main admin override; cleared once the station reports a newer local_updated_at.';
comment on table public.fleet_sessions is
    'Paid play sessions reported by stations, used for the All devices earnings report.';
comment on column public.fleet_sessions.games is
    'JSON array of { game_id, title, started_at, ended_at } played during the session.';
comment on table public.fleet_moderators is
    'People whose own PIN unlocks the Control Room on their assigned stations.';
comment on column public.fleet_moderators.pin_hash is
    'pbkdf2-sha256 PIN hash, sent only to assigned stations for offline PIN checks.';
comment on table public.fleet_moderator_stations is
    'Stations where each moderator PIN is accepted.';
comment on view public.fleet_station_totals is
    'Per-station game count (non-deleted), session count and revenue for the stationFleet function.';

create or replace function public.touch_fleet_updated_at()
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

create or replace trigger fleet_owner_touch_updated_at
before update on public.fleet_owner
for each row execute function public.touch_fleet_updated_at();

create or replace trigger fleet_stations_touch_updated_at
before update on public.fleet_stations
for each row execute function public.touch_fleet_updated_at();

create or replace trigger fleet_station_games_touch_updated_at
before update on public.fleet_station_games
for each row execute function public.touch_fleet_updated_at();

create or replace trigger fleet_moderators_touch_updated_at
before update on public.fleet_moderators
for each row execute function public.touch_fleet_updated_at();
