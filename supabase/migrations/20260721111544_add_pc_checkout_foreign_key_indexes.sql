create index if not exists pc_checkouts_store_id_idx
  on public.pc_checkouts (store_id);

create index if not exists pc_checkouts_time_plan_id_idx
  on public.pc_checkouts (time_plan_id);
