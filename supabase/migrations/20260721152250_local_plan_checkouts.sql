alter table public.pc_checkouts
    drop constraint if exists pc_checkouts_time_plan_id_fkey;

alter table public.pc_checkouts
    alter column time_plan_id type text using time_plan_id::text;

alter table public.pc_checkouts
    drop constraint if exists pc_checkouts_time_plan_id_length_check;

alter table public.pc_checkouts
    add constraint pc_checkouts_time_plan_id_length_check
    check (char_length(time_plan_id) between 1 and 120);

comment on column public.pc_checkouts.time_plan_id is
    'Identifier of the locally managed NXGS Play plan snapshot used for this checkout.';
