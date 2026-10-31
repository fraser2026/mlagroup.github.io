-- Which models and tools each agent uses, and a notification when an agent starts using a new one.
--
-- Each request records the names of the tools offered to the model and the tools the model asked to
-- call. Names only: no descriptions, schemas, arguments or results. gateway_inventory keeps one row
-- per agent and model or tool, with when it was first and last seen. During an agent's first 7 days
-- RegAnchor learns what is normal; after that, anything new raises a notification.

ALTER TABLE public.gateway_request_events
  ADD COLUMN IF NOT EXISTS tools_offered text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tools_called text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.gateway_request_events DROP CONSTRAINT IF EXISTS gateway_request_events_tools_check;
ALTER TABLE public.gateway_request_events ADD CONSTRAINT gateway_request_events_tools_check
  CHECK (cardinality(tools_offered) <= 128 AND cardinality(tools_called) <= 128);

COMMENT ON COLUMN public.gateway_request_events.tools_offered IS
  'Names of the tools offered to the model in the request: custom tool names, server tool names, and '
  'mcp:<server> for connected MCP servers. Names only.';
COMMENT ON COLUMN public.gateway_request_events.tools_called IS
  'Names of the tools the model asked to call in its response (tool_use, server_tool_use, and '
  'mcp:<server>/<tool> for MCP tools). Names only; arguments and results are not recorded.';

ALTER TABLE public.governance_alerts DROP CONSTRAINT IF EXISTS governance_alerts_alert_type_check;
ALTER TABLE public.governance_alerts ADD CONSTRAINT governance_alerts_alert_type_check CHECK (alert_type = ANY (ARRAY[
  'score_drop', 'control_overdue', 'assessment_due', 'control_regression', 'compliance_rule_fired',
  'support_response', 'task_assigned', 'task_overdue', 'policy_requires_ack', 'evidence_review',
  'budget_warning', 'budget_over', 'budget_projected',
  'gateway_new_model', 'gateway_new_tool'
]::text[]));

CREATE TABLE IF NOT EXISTS public.gateway_inventory (
  org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('model', 'tool')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  first_called_at timestamptz,
  last_called_at timestamptz,
  first_event_id uuid,
  PRIMARY KEY (org_id, asset_id, kind, name)
);

COMMENT ON TABLE public.gateway_inventory IS
  'Models served to, and tools offered to or called by, each agent through the gateway. last_seen_at and '
  'last_called_at are refreshed at most hourly. Maintained by trigger on gateway_request_events.';

ALTER TABLE public.gateway_inventory ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gateway_inventory FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.gateway_inventory TO authenticated;
GRANT ALL ON public.gateway_inventory TO service_role;

DROP POLICY IF EXISTS gateway_inventory_member_read ON public.gateway_inventory;
CREATE POLICY gateway_inventory_member_read ON public.gateway_inventory
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));

CREATE TABLE IF NOT EXISTS public.gateway_inventory_agents (
  org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL,
  learning_started_at timestamptz NOT NULL,
  PRIMARY KEY (org_id, asset_id)
);

COMMENT ON TABLE public.gateway_inventory_agents IS
  'When RegAnchor started learning each agent''s normal models and tools. New models and tools raise '
  'notifications only once 7 days have passed.';

ALTER TABLE public.gateway_inventory_agents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gateway_inventory_agents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.gateway_inventory_agents TO authenticated;
GRANT ALL ON public.gateway_inventory_agents TO service_role;

DROP POLICY IF EXISTS gateway_inventory_agents_member_read ON public.gateway_inventory_agents;
CREATE POLICY gateway_inventory_agents_member_read ON public.gateway_inventory_agents
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));

CREATE OR REPLACE FUNCTION public.gateway_inventory_apply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  baseline timestamptz;
  learned boolean;
  is_new boolean;
  new_model text;
  new_tools text[] := ARRAY[]::text[];
  t text;
  called boolean;
  agent text;
  seen_at text;
  listed text;
  new_alert uuid;
BEGIN
  BEGIN
    INSERT INTO public.gateway_inventory_agents (org_id, asset_id, learning_started_at)
    VALUES (NEW.org_id, NEW.asset_id, NEW.created_at)
    ON CONFLICT DO NOTHING;
    SELECT learning_started_at INTO baseline
    FROM public.gateway_inventory_agents
    WHERE org_id = NEW.org_id AND asset_id = NEW.asset_id;
    learned := baseline IS NOT NULL AND baseline <= NEW.created_at - interval '7 days';

    -- Only requests the provider answered tell us which model served them.
    IF NEW.outcome IN ('success', 'client_aborted', 'stream_error', 'blocked_dlp_response')
       AND coalesce(NEW.model, '') <> '' THEN
      is_new := false;
      INSERT INTO public.gateway_inventory AS i (org_id, asset_id, kind, name, first_seen_at, last_seen_at, first_event_id)
      VALUES (NEW.org_id, NEW.asset_id, 'model', left(NEW.model, 200), NEW.created_at, NEW.created_at, NEW.id)
      ON CONFLICT (org_id, asset_id, kind, name) DO UPDATE
        SET last_seen_at = EXCLUDED.last_seen_at
        WHERE i.last_seen_at < EXCLUDED.last_seen_at - interval '1 hour'
      RETURNING (xmax = 0) INTO is_new;
      IF is_new THEN
        new_model := left(NEW.model, 200);
      END IF;
    END IF;

    FOR t IN
      SELECT DISTINCT left(btrim(x), 200) FROM unnest(NEW.tools_offered || NEW.tools_called) AS x
      WHERE btrim(x) <> ''
      ORDER BY 1
    LOOP
      called := t = ANY (NEW.tools_called);
      is_new := false;
      INSERT INTO public.gateway_inventory AS i
        (org_id, asset_id, kind, name, first_seen_at, last_seen_at, first_called_at, last_called_at, first_event_id)
      VALUES (
        NEW.org_id, NEW.asset_id, 'tool', t, NEW.created_at, NEW.created_at,
        CASE WHEN called THEN NEW.created_at END, CASE WHEN called THEN NEW.created_at END, NEW.id
      )
      ON CONFLICT (org_id, asset_id, kind, name) DO UPDATE
        SET last_seen_at = greatest(i.last_seen_at, EXCLUDED.last_seen_at),
            first_called_at = coalesce(i.first_called_at, EXCLUDED.first_called_at),
            last_called_at = greatest(i.last_called_at, EXCLUDED.last_called_at)
        WHERE i.last_seen_at < EXCLUDED.last_seen_at - interval '1 hour'
           OR (EXCLUDED.first_called_at IS NOT NULL
               AND (i.last_called_at IS NULL OR i.last_called_at < EXCLUDED.last_called_at - interval '1 hour'))
      RETURNING (xmax = 0) INTO is_new;
      IF is_new THEN
        new_tools := new_tools || t;
      END IF;
    END LOOP;

    IF NOT learned OR (new_model IS NULL AND cardinality(new_tools) = 0) THEN
      RETURN NULL;
    END IF;

    SELECT coalesce(nullif(btrim(name), ''), 'An agent') INTO agent FROM public.ai_systems WHERE id = NEW.asset_id;
    agent := coalesce(agent, 'An agent');
    seen_at := to_char(NEW.created_at AT TIME ZONE 'UTC', 'FMDD Mon YYYY, HH24:MI');

    IF new_model IS NOT NULL THEN
      INSERT INTO public.governance_alerts (org_id, system_id, alert_type, severity, title, body, ref_id, ref_type)
      VALUES (
        NEW.org_id, NEW.asset_id, 'gateway_new_model', 'warning',
        format('New model in use: %s', agent),
        format('%s was served by %s for the first time at %s UTC. RegAnchor had not seen this model for this agent before. '
               'If the change was not expected, check with whoever runs the agent, and confirm budgets and pricing cover the new model.',
               agent, new_model, seen_at),
        NEW.asset_id, 'gateway_inventory'
      )
      RETURNING id INTO new_alert;
      PERFORM public.gateway_budget_alert_dispatch(new_alert, NEW.org_id);
    END IF;

    IF cardinality(new_tools) > 0 THEN
      listed := array_to_string(new_tools[1:20], ', ')
        || CASE WHEN cardinality(new_tools) > 20 THEN format(' and %s more', cardinality(new_tools) - 20) ELSE '' END;
      INSERT INTO public.governance_alerts (org_id, system_id, alert_type, severity, title, body, ref_id, ref_type)
      VALUES (
        NEW.org_id, NEW.asset_id, 'gateway_new_tool', 'warning',
        CASE WHEN cardinality(new_tools) = 1
          THEN format('New tool for %s: %s', agent, new_tools[1])
          ELSE format('%s new tools for %s', cardinality(new_tools), agent) END,
        format('Requests from %s included %s not seen for this agent before, first at %s UTC: %s. Tools let the model '
               'ask for actions such as searching, reading data or sending messages. If this was not expected, check '
               'with whoever runs the agent.',
               agent, CASE WHEN cardinality(new_tools) = 1 THEN 'a tool' ELSE format('%s tools', cardinality(new_tools)) END,
               seen_at, listed),
        NEW.asset_id, 'gateway_inventory'
      )
      RETURNING id INTO new_alert;
      PERFORM public.gateway_budget_alert_dispatch(new_alert, NEW.org_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Recording the request matters more than the inventory; never fail the insert.
    RAISE WARNING 'gateway inventory update failed: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.gateway_inventory_apply() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS gateway_request_events_inventory ON public.gateway_request_events;
CREATE TRIGGER gateway_request_events_inventory
  AFTER INSERT ON public.gateway_request_events
  FOR EACH ROW
  EXECUTE FUNCTION public.gateway_inventory_apply();

-- Tools were not recorded before now, so existing agents start learning today.
INSERT INTO public.gateway_inventory_agents (org_id, asset_id, learning_started_at)
SELECT DISTINCT e.org_id, e.asset_id, now()
FROM public.gateway_request_events e
ON CONFLICT DO NOTHING;

-- Models already seen, without notifications.
INSERT INTO public.gateway_inventory (org_id, asset_id, kind, name, first_seen_at, last_seen_at)
SELECT e.org_id, e.asset_id, 'model', left(e.model, 200), min(e.created_at), max(e.created_at)
FROM public.gateway_request_events e
WHERE e.outcome IN ('success', 'client_aborted', 'stream_error', 'blocked_dlp_response')
  AND coalesce(e.model, '') <> ''
GROUP BY e.org_id, e.asset_id, left(e.model, 200)
ON CONFLICT DO NOTHING;
