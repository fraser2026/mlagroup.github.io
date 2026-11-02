-- Daily Bedrock price import at 05:15 UTC, before gateway reconciliation at 06:30.
-- The cron secret is generated inside Vault and read at run time; it never appears in SQL text.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'bedrock-price-sync-daily';

SELECT cron.schedule(
  'bedrock-price-sync-daily',
  '15 5 * * *',
  $job$
  SELECT net.http_post(
    url := 'https://hueftewwenjaiagdoqmb.supabase.co/functions/v1/bedrock-price-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'bedrock_price_sync_cron')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);
