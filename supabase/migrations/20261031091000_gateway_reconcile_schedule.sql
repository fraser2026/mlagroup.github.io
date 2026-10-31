-- Daily gateway reconciliation at 06:30 UTC. Anthropic analytics usually refresh within four
-- hours, so the previous day is normally ready; days still pending are retried on later runs.
-- The cron secret is generated inside Vault and read at run time; it never appears in SQL text.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'gateway_reconcile_cron') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'gateway_reconcile_cron',
      'Authenticates the scheduled gateway-reconcile edge function run.'
    );
  END IF;
END
$$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'gateway-reconcile-daily';

SELECT cron.schedule(
  'gateway-reconcile-daily',
  '30 6 * * *',
  $job$
  SELECT net.http_post(
    url := 'https://hueftewwenjaiagdoqmb.supabase.co/functions/v1/gateway-reconcile',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'gateway_reconcile_cron')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $job$
);
