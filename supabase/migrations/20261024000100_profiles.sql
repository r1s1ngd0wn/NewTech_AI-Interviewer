-- Apply after the three Long_RAG baseline migrations.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  role text not null default 'user' check (role in ('user', 'admin')),
  target_industry text,
  target_role text,
  experience_level text,
  onboarding_complete boolean generated always as (
    coalesce(length(target_industry) > 0 and length(target_role) > 0 and length(experience_level) > 0, false)
  ) stored,
  created_at timestamptz not null default now(),
  check (length(name) <= 80),
  check (length(target_industry) <= 80),
  check (length(target_role) <= 80),
  check (length(experience_level) <= 80)
);

create function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, name)
  values (new.id, left(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), 80))
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_auth_user();
insert into public.profiles(id, name)
select id, left(coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', ''), 80) from auth.users
on conflict (id) do nothing;

create function public.is_session_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from auth.sessions s
    where s.id::text = (select auth.jwt()->>'session_id') and s.user_id = (select auth.uid()));
$$;
revoke all on function public.is_session_active() from public, anon;
grant execute on function public.is_session_active() to authenticated;
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update(name, target_industry, target_role, experience_level) on public.profiles to authenticated;
create policy own_profile_read on public.profiles for select to authenticated using (id = (select auth.uid()) and (select public.is_session_active()));
create policy own_profile_update on public.profiles for update to authenticated
using (id = (select auth.uid()) and (select public.is_session_active()))
with check (id = (select auth.uid()) and (select public.is_session_active()));
