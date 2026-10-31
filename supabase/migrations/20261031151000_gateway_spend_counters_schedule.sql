-- Daily recount of the running spend counters from the request records, for this month and last.

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'gateway-spend-counters-rebuild';

SELECT cron.schedule(
  'gateway-spend-counters-rebuild',
  '20 0 * * *',
  $job$
    SELECT public.gateway_spend_counters_rebuild(date_trunc('month', now() AT TIME ZONE 'UTC')::date);
    SELECT public.gateway_spend_counters_rebuild((date_trunc('month', now() AT TIME ZONE 'UTC') - interval '1 month')::date);
  $job$
);
