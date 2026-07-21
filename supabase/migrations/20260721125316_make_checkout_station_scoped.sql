alter table public.pc_checkouts
    alter column game_id drop not null,
    alter column game_title drop not null,
    add column if not exists entitlement_scope text not null default 'station';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pc_checkouts_entitlement_scope_check'
      and conrelid = 'public.pc_checkouts'::regclass
  ) then
    alter table public.pc_checkouts
      add constraint pc_checkouts_entitlement_scope_check
      check (entitlement_scope = 'station');
  end if;
end $$;

comment on column public.pc_checkouts.entitlement_scope is
    'Station-wide entitlement: purchased minutes may be used across any launcher game.';
