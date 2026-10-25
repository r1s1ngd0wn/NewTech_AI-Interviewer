create table public.practice_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  title text not null check (length(trim(title)) between 1 and 120),
  created_at timestamptz not null default now(),
  unique(id, user_id)
);
create table public.practice_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null,
  user_id uuid not null default auth.uid(),
  scenario_id text not null check (length(scenario_id) between 1 and 120),
  scheduled_date date not null,
  status text not null default 'scheduled' check (status in ('scheduled','done','skipped')),
  foreign key (plan_id, user_id) references public.practice_plans(id, user_id) on delete cascade
);
create index practice_plans_owner on public.practice_plans(user_id, created_at desc);
create index practice_plan_items_owner on public.practice_plan_items(user_id, plan_id);
create table public.pending_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  tool text not null check (tool in ('create_practice_plan','update_practice_plan_item')),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','confirmed','cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  result jsonb
);
create index pending_actions_owner on public.pending_actions(user_id, created_at desc);
create table public.ai_logs (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  request_id uuid, user_id uuid references public.profiles(id) on delete set null,
  capability text not null, prompt_name text, prompt_version text, model text,
  tools text[] not null default '{}', tokens_in bigint, tokens_out bigint,
  latency_ms integer not null check(latency_ms >= 0), cost_usd numeric,
  status text not null check(status in ('ok','error','timeout','invalid_json','refused')),
  error_code text, provider_status integer,
  check(tokens_in is null or tokens_in >= 0), check(tokens_out is null or tokens_out >= 0)
);
create index ai_logs_dashboard on public.ai_logs(created_at desc, capability, model);

alter table public.practice_plans enable row level security;
alter table public.practice_plan_items enable row level security;
alter table public.pending_actions enable row level security;
alter table public.ai_logs enable row level security;
revoke all on public.practice_plans, public.practice_plan_items, public.pending_actions, public.ai_logs from anon, authenticated;
grant select, insert, update, delete on public.practice_plans, public.practice_plan_items to authenticated;
grant select on public.pending_actions to authenticated;
create policy plans_owner on public.practice_plans to authenticated
  using(user_id = (select auth.uid()) and (select public.is_session_active()))
  with check(user_id = (select auth.uid()) and (select public.is_session_active()));
create policy plan_items_owner on public.practice_plan_items to authenticated
  using(user_id = (select auth.uid()) and (select public.is_session_active()))
  with check(user_id = (select auth.uid()) and (select public.is_session_active()));
create policy pending_owner on public.pending_actions for select to authenticated
  using(user_id = (select auth.uid()) and (select public.is_session_active()));
-- Dashboard queries are performed by the privileged backend after requireRole.
-- No client may write logs or mutate the immutable pending-action payload.
grant all on public.profiles, public.practice_plans, public.practice_plan_items, public.pending_actions, public.ai_logs to service_role;

create function public.create_practice_plan(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare plan public.practice_plans; entry jsonb; result jsonb;
begin
  if auth.uid() is null or not public.is_session_active() then raise insufficient_privilege; end if;
  if jsonb_typeof(payload->'items') is distinct from 'array' then raise exception 'items must be an array'; end if;
  if jsonb_array_length(payload->'items') not between 1 and 20 then raise exception 'provide 1 to 20 items'; end if;
  insert into public.practice_plans(user_id,title) values(auth.uid(),payload->>'title') returning * into plan;
  for entry in select * from jsonb_array_elements(payload->'items') loop
    insert into public.practice_plan_items(plan_id,user_id,scenario_id,scheduled_date,status)
    values(plan.id,auth.uid(),entry->>'scenarioId',(entry->>'scheduledDate')::date,coalesce(entry->>'status','scheduled'));
  end loop;
  select to_jsonb(plan) || jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(i) order by i.scheduled_date,i.id),'[]'::jsonb))
  into result from public.practice_plan_items i where i.plan_id=plan.id;
  return result;
end;
$$;

create function public.propose_coach_action(tool_name text,payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare action public.pending_actions;
begin
  if auth.uid() is null or not public.is_session_active() then raise insufficient_privilege; end if;
  if tool_name = 'update_practice_plan_item' and not exists(
    select 1 from public.practice_plan_items where id = (payload->>'id')::uuid and user_id=auth.uid()
  ) then raise no_data_found; end if;
  insert into public.pending_actions(user_id,tool,payload) values(auth.uid(),tool_name,payload) returning * into action;
  return to_jsonb(action);
end;
$$;

create function public.confirm_coach_action(action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare action public.pending_actions; action_result jsonb; item public.practice_plan_items; change jsonb;
begin
  if auth.uid() is null or not public.is_session_active() then raise insufficient_privilege; end if;
  select * into action from public.pending_actions where id=action_id and user_id=auth.uid() for update;
  if not found then raise no_data_found; end if;
  if action.status <> 'pending' then raise exception using errcode='P0003', message='action is no longer pending'; end if;
  if action.expires_at <= clock_timestamp() then raise exception using errcode='P0004', message='action expired'; end if;
  if action.tool = 'create_practice_plan' then
    action_result := public.create_practice_plan(action.payload);
  elsif action.tool = 'update_practice_plan_item' then
    change := action.payload->'change';
    update public.practice_plan_items set
      scenario_id = case when change ? 'scenarioId' then change->>'scenarioId' else scenario_id end,
      scheduled_date = case when change ? 'scheduledDate' then (change->>'scheduledDate')::date else scheduled_date end,
      status = case when change ? 'status' then change->>'status' else status end
    where id=(action.payload->>'id')::uuid and user_id=auth.uid() returning * into item;
    if not found then raise no_data_found; end if;
    action_result := to_jsonb(item);
  else raise exception 'unknown tool'; end if;
  update public.pending_actions set status='confirmed',result=action_result where id=action_id;
  return jsonb_build_object('status','confirmed','result',action_result);
end;
$$;
create function public.cancel_coach_action(action_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare action public.pending_actions;
begin
  if auth.uid() is null or not public.is_session_active() then raise insufficient_privilege; end if;
  select * into action from public.pending_actions where id=action_id and user_id=auth.uid() for update;
  if not found then raise no_data_found; end if;
  if action.status <> 'pending' then raise exception using errcode='P0003', message='action is no longer pending'; end if;
  if action.expires_at <= clock_timestamp() then raise exception using errcode='P0004', message='action expired'; end if;
  update public.pending_actions set status='cancelled' where id=action_id;
  return jsonb_build_object('status','cancelled');
end;
$$;
revoke all on function public.create_practice_plan(jsonb),public.propose_coach_action(text,jsonb),public.confirm_coach_action(uuid),public.cancel_coach_action(uuid) from public,anon;
grant execute on function public.create_practice_plan(jsonb),public.propose_coach_action(text,jsonb),public.confirm_coach_action(uuid),public.cancel_coach_action(uuid) to authenticated;
