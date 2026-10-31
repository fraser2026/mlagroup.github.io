-- Budget alerts are checked every 10 minutes. The email secret is generated inside Vault and
-- read at run time; it never appears in SQL text.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'alert_mail_cron') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'alert_mail_cron',
      'Authenticates database-initiated alert emails to send-mail.'
    );
  END IF;
END
$$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'gateway-budget-alerts';

SELECT cron.schedule(
  'gateway-budget-alerts',
  '*/10 * * * *',
  $job$ SELECT public.gateway_budget_alerts_sync(); $job$
);
