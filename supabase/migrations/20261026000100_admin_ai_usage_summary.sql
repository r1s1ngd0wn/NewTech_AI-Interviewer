create or replace function public.admin_ai_usage_summary(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with filtered as (
    select created_at, tokens_in, tokens_out, latency_ms, cost_usd, status
    from public.ai_logs
    where created_at >= p_from and created_at <= p_to
  ),
  totals as (
    select count(*)::bigint as requests,
      coalesce(sum(tokens_in), 0)::bigint as tokens_in,
      coalesce(sum(tokens_out), 0)::bigint as tokens_out,
      avg(latency_ms)::numeric as avg_latency_ms,
      sum(cost_usd)::numeric as known_cost_usd,
      count(cost_usd)::bigint as priced_requests,
      count(*) filter (where cost_usd is null)::bigint as unknown_cost_requests,
      count(*) filter (where status in ('error', 'timeout', 'invalid_json'))::bigint as failed_requests,
      count(*) filter (where status = 'refused')::bigint as refused_requests
    from filtered
  ),
  daily as (
    select date_trunc('day', created_at at time zone 'UTC')::date as day,
      count(*)::bigint as requests,
      sum(cost_usd)::numeric as known_cost_usd,
      count(*) filter (where status in ('error', 'timeout', 'invalid_json'))::bigint as failed_requests,
      count(*) filter (where status = 'refused')::bigint as refused_requests
    from filtered
    group by 1
  ),
  days as (
    select generate_series(
      date_trunc('day', p_from at time zone 'UTC'),
      date_trunc('day', p_to at time zone 'UTC'),
      interval '1 day'
    )::date as day
  )
  select jsonb_build_object(
    'requests', totals.requests,
    'tokensIn', totals.tokens_in,
    'tokensOut', totals.tokens_out,
    'avgLatencyMs', totals.avg_latency_ms,
    'knownCostUsd', totals.known_cost_usd,
    'avgKnownCostUsd', case when totals.priced_requests > 0 then totals.known_cost_usd / totals.priced_requests else null end,
    'pricedRequests', totals.priced_requests,
    'unknownCostRequests', totals.unknown_cost_requests,
    'failedRequests', totals.failed_requests,
    'refusedRequests', totals.refused_requests,
    'trend', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', days.day,
        'requests', coalesce(daily.requests, 0),
        'knownCostUsd', daily.known_cost_usd,
        'failedRequests', coalesce(daily.failed_requests, 0),
        'refusedRequests', coalesce(daily.refused_requests, 0)
      ) order by days.day)
      from days left join daily using (day)
    ), '[]'::jsonb)
  )
  from totals;
$$;

revoke all on function public.admin_ai_usage_summary(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_ai_usage_summary(timestamptz, timestamptz) to service_role;
