-- Preserve the existing schema and policies while reading current account status
-- from trusted Auth app_metadata. JWT claims may be stale until refresh.
create or replace function public.is_session_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from auth.sessions s
    join auth.users u on u.id = s.user_id
    where s.id::text = (select auth.jwt()->>'session_id')
      and s.user_id = (select auth.uid())
      and coalesce((u.raw_app_meta_data->>'is_active')::boolean, true)
      and (
        u.raw_app_meta_data->>'sessions_valid_after' is null
        or s.created_at > (u.raw_app_meta_data->>'sessions_valid_after')::timestamptz
      )
  );
$$;
