-- NXGS Play 0.25.0 review fixes for Device Management. Additive only: the two
-- earlier fleet migrations are already applied, and grants/RLS stay as they are.

-- Main admin login backoff: each lockout doubles (10 min, 20 min, ... up to 24 h).
alter table public.fleet_owner
    add column if not exists lockout_count integer not null default 0 check (lockout_count >= 0);

-- Clock-free conflict resolution: a main admin edit stays pending until the
-- station reports the same name/store/location/status.
alter table public.fleet_stations
    add column if not exists owner_edit_pending boolean not null default false;

-- The station that consumed a checkout; earnings and payer lookups only trust
-- a checkout for that station.
alter table public.pc_checkouts
    add column if not exists consumed_by_station_id text
        check (consumed_by_station_id is null or consumed_by_station_id ~ '^[A-Za-z0-9_-]{3,80}$');

comment on column public.fleet_owner.lockout_count is
    'Consecutive main admin lockouts; the next lock lasts 10 min * 2^(count - 1), at most 24 h. Reset by a correct PIN.';
comment on column public.fleet_stations.owner_edit_pending is
    'True after a main admin edit until the station reports the same name, store, location and status.';
comment on column public.pc_checkouts.consumed_by_station_id is
    'Station device ID sent with consume; null for checkouts consumed before NXGS Play 0.25.0.';
