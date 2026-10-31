-- Budget alerts as in-app notifications, with per-user opt-in email.
-- gateway_budget_alerts_sync() raises one alert per budget, month, level and budget amount, so
-- an alert re-arms when a budget is changed. Email goes only to members who opted in.

ALTER TABLE public.governance_alerts DROP CONSTRAINT IF EXISTS governance_alerts_alert_type_check;
ALTER TABLE public.governance_alerts ADD CONSTRAINT governance_alerts_alert_type_check CHECK (alert_type = ANY (ARRAY[
  'score_drop', 'control_overdue', 'assessment_due', 'control_regression', 'compliance_rule_fired',
  'support_response', 'task_assigned', 'task_overdue', 'policy_requires_ack', 'evidence_review',
  'budget_warning', 'budget_over', 'budget_projected'
]::text[]));

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  email_budget_alerts boolean NOT NULL DEFAULT false,
  email_governance_alerts boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, org_id)
);

COMMENT ON TABLE public.notification_preferences IS
  'Per-user, per-organisation email opt-ins. Every alert appears in the app; email is off until the user turns it on.';

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;

DROP POLICY IF EXISTS notification_preferences_own_read ON public.notification_preferences;
CREATE POLICY notification_preferences_own_read ON public.notification_preferences
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS notification_preferences_own_insert ON public.notification_preferences;
CREATE POLICY notification_preferences_own_insert ON public.notification_preferences
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_org_member(org_id));

DROP POLICY IF EXISTS notification_preferences_own_update ON public.notification_preferences;
CREATE POLICY notification_preferences_own_update ON public.notification_preferences
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.is_org_member(org_id));

CREATE TABLE IF NOT EXISTS public.gateway_budget_alert_log (
  budget_id uuid NOT NULL REFERENCES public.gateway_budgets(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  level text NOT NULL CHECK (level IN ('projected', 'warn', 'over')),
  amount_usd numeric(14, 2) NOT NULL,
  alert_id uuid REFERENCES public.governance_alerts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (budget_id, period_start, level, amount_usd)
);

ALTER TABLE public.gateway_budget_alert_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gateway_budget_alert_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.gateway_budget_alert_log TO service_role;

-- Same rule as the app: whole cents from $1, three significant digits below.
CREATE OR REPLACE FUNCTION public.gateway_fmt_usd(p numeric)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v numeric;
  digits integer;
  t text;
  frac text;
BEGIN
  IF p IS NULL OR p = 0 THEN
    RETURN '$0.00';
  END IF;
  v := abs(p);
  IF v >= 1 THEN
    RETURN CASE WHEN p < 0 THEN '-' ELSE '' END || '$' || to_char(round(v, 2), 'FM999,999,999,990.00');
  END IF;
  digits := least(8, greatest(2, 2 - floor(log(v))::integer));
  t := rtrim(round(v, digits)::text, '0');
  frac := split_part(t, '.', 2);
  RETURN CASE WHEN p < 0 THEN '-' ELSE '' END || '$' || split_part(t, '.', 1) || '.' || rpad(frac, greatest(2, length(frac)), '0');
END;
$$;

-- Hands an alert to send-mail when someone in the organisation opted in. Needs pg_net and the
-- Vault secret; without either it does nothing, and the alert still shows in the app.
CREATE OR REPLACE FUNCTION public.gateway_budget_alert_dispatch(p_alert_id uuid, p_org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.notification_preferences np
    JOIN public.org_members m ON m.user_id = np.user_id AND m.org_id = np.org_id
    WHERE np.org_id = p_org_id AND np.email_budget_alerts
  ) THEN
    RETURN false;
  END IF;
  IF to_regnamespace('net') IS NULL OR to_regnamespace('vault') IS NULL THEN
    RETURN false;
  END IF;
  EXECUTE $q$
    SELECT net.http_post(
      url := 'https://hueftewwenjaiagdoqmb.supabase.co/functions/v1/send-mail',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'alert_mail_cron')
      ),
      body := jsonb_build_object('kind', 'budget-alert', 'alert_id', $1),
      timeout_milliseconds := 30000
    )
  $q$ USING p_alert_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.gateway_budget_alert_dispatch(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_budget_alert_dispatch(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.gateway_budget_alerts_sync(p_org_id uuid DEFAULT NULL, p_at timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  o record;
  s jsonb;
  b jsonb;
  lvl text;
  scope text;
  org_name text;
  inserted integer;
  new_alert uuid;
  created integer := 0;
  period date;
BEGIN
  FOR o IN
    SELECT DISTINCT gb.org_id FROM public.gateway_budgets gb
    WHERE p_org_id IS NULL OR gb.org_id = p_org_id
  LOOP
    s := public.gateway_budget_status(o.org_id, p_at);
    period := (s->>'period_start')::timestamptz AT TIME ZONE 'UTC';
    SELECT coalesce(nullif(trim(name), ''), 'Your organisation') INTO org_name
    FROM public.organisations WHERE id = o.org_id;

    FOR b IN SELECT * FROM jsonb_array_elements(coalesce(s->'budgets', '[]'::jsonb)) LOOP
      lvl := CASE b->>'state' WHEN 'over' THEN 'over' WHEN 'warn' THEN 'warn' WHEN 'projected_over' THEN 'projected' END;
      CONTINUE WHEN lvl IS NULL;

      INSERT INTO public.gateway_budget_alert_log (budget_id, period_start, level, amount_usd)
      VALUES ((b->>'id')::uuid, period, lvl, (b->>'amount_usd')::numeric)
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS inserted = ROW_COUNT;
      CONTINUE WHEN inserted = 0;

      scope := coalesce(nullif(b->>'asset_name', ''), org_name);
      INSERT INTO public.governance_alerts (org_id, system_id, alert_type, severity, title, body, ref_id, ref_type)
      VALUES (
        o.org_id,
        nullif(b->>'asset_id', '')::uuid,
        CASE lvl WHEN 'over' THEN 'budget_over' WHEN 'warn' THEN 'budget_warning' ELSE 'budget_projected' END,
        CASE lvl WHEN 'over' THEN 'critical' ELSE 'warning' END,
        CASE lvl
          WHEN 'over' THEN format('Over budget: %s', scope)
          WHEN 'warn' THEN format('Budget warning: %s', scope)
          ELSE format('Projected over budget: %s', scope)
        END,
        CASE lvl
          WHEN 'over' THEN format(
            '%s has spent %s this month, %s%% of its %s monthly budget. Budgets monitor spend and do not block requests. Months run in UTC.',
            scope, public.gateway_fmt_usd((b->>'spend_usd')::numeric), b->>'used_pct', public.gateway_fmt_usd((b->>'amount_usd')::numeric))
          WHEN 'warn' THEN format(
            '%s has spent %s this month, %s%% of its %s monthly budget. The warning level is %s%%. Months run in UTC.',
            scope, public.gateway_fmt_usd((b->>'spend_usd')::numeric), b->>'used_pct', public.gateway_fmt_usd((b->>'amount_usd')::numeric), b->>'warn_at_pct')
          ELSE format(
            'At the average daily rate so far, %s will spend about %s by the end of the month, above its %s monthly budget. Spent so far: %s. Months run in UTC.',
            scope, public.gateway_fmt_usd((b->>'projected_usd')::numeric), public.gateway_fmt_usd((b->>'amount_usd')::numeric), public.gateway_fmt_usd((b->>'spend_usd')::numeric))
        END,
        (b->>'id')::uuid,
        'gateway_budget'
      )
      RETURNING id INTO new_alert;

      UPDATE public.gateway_budget_alert_log
      SET alert_id = new_alert
      WHERE budget_id = (b->>'id')::uuid AND period_start = period AND level = lvl AND amount_usd = (b->>'amount_usd')::numeric;

      PERFORM public.gateway_budget_alert_dispatch(new_alert, o.org_id);
      created := created + 1;
    END LOOP;
  END LOOP;

  RETURN created;
END;
$$;

REVOKE ALL ON FUNCTION public.gateway_budget_alerts_sync(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_budget_alerts_sync(uuid, timestamptz) TO service_role;

-- send-mail asks here before sending a budget alert.
CREATE OR REPLACE FUNCTION public.alert_mail_secret_ok(p_secret text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_secret IS NULL OR length(p_secret) < 32 THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name = 'alert_mail_cron' AND s.decrypted_secret = p_secret
  );
END;
$$;

REVOKE ALL ON FUNCTION public.alert_mail_secret_ok(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.alert_mail_secret_ok(text) TO service_role;
