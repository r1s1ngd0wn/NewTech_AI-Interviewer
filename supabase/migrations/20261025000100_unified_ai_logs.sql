-- One source for RAG, critique and agent usage. Unknown historical usage stays NULL.
alter table public.ai_logs add column if not exists provider text;
alter table public.ai_logs add column if not exists operation text not null default 'unknown';
alter table public.ai_logs add column if not exists legacy_id bigint;
alter table public.ai_logs add column if not exists legacy_user_id text;
create unique index if not exists ai_logs_legacy_id on public.ai_logs(legacy_id);
create index if not exists ai_logs_request on public.ai_logs(request_id) where request_id is not null;
create index if not exists ai_logs_owner_time on public.ai_logs(user_id, created_at desc);
create index if not exists ai_logs_legacy_owner_time on public.ai_logs(legacy_user_id, created_at desc)
  where legacy_user_id is not null;

do $$
begin
  if to_regclass('public.interviewai_ai_request_logs') is not null then
    lock table public.interviewai_ai_request_logs in access exclusive mode;
    insert into public.ai_logs(created_at,user_id,legacy_id,legacy_user_id,provider,model,operation,
      capability,prompt_version,latency_ms,status,error_code)
    select l.created_at,p.id,l.id,l.user_id,l.provider,l.model,l.operation,
      case when l.operation like 'embed%' then 'embed' when l.operation='json' then 'critique' else 'coach' end,
      l.prompt_version,greatest(0,l.duration_ms),
      case when l.status='cancelled' then 'error' else l.status end,
      case when l.status='cancelled' then 'cancelled' else null end
    from public.interviewai_ai_request_logs l
    left join public.profiles p on p.id::text=l.user_id
    on conflict(legacy_id) do nothing;
    -- Retain the source for reconciliation, but application writers must use ai_logs.
    revoke all on public.interviewai_ai_request_logs from anon,authenticated,service_role;
  end if;
end;
$$;

-- An account erasure must not be undone by a later backfill replay.
create or replace function public.erase_legacy_ai_log() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.legacy_id is not null and to_regclass('public.interviewai_ai_request_logs') is not null then
    delete from public.interviewai_ai_request_logs where id=old.legacy_id;
  end if;
  return old;
end;
$$;
revoke all on function public.erase_legacy_ai_log() from public,anon,authenticated;
drop trigger if exists ai_logs_erase_legacy on public.ai_logs;
create trigger ai_logs_erase_legacy after delete on public.ai_logs
for each row execute function public.erase_legacy_ai_log();
