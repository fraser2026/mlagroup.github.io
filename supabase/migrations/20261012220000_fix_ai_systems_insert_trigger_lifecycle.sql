-- Sync with live: migration fix_ai_systems_insert_trigger_lifecycle (applied 2026-10-11).
-- ai_systems.deployment_status was renamed to lifecycle; the insert trigger must read NEW.lifecycle.
-- Audit entry keeps the legacy deployment_status key for readers, plus lifecycle.
-- Only replaces this one function. No tables, policies, grants or triggers change.
CREATE OR REPLACE FUNCTION public.fn_populate_compliance_on_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.risk_tier IS NOT NULL THEN
    INSERT INTO public.system_compliance (system_id, obligation_id, status)
    SELECT NEW.id, cf.id, 'not_started'
    FROM public.compliance_frameworks cf
    WHERE cf.is_active = true
      AND NEW.risk_tier = ANY(cf.applicable_risk_tiers)
    ON CONFLICT (system_id, obligation_id) DO NOTHING;

    UPDATE public.ai_systems SET risk_tier_set_at = now() WHERE id = NEW.id;

    INSERT INTO public.registry_audit_log (org_id, user_id, action, entity_type, entity_id, changes)
    VALUES (NEW.org_id, NEW.created_by, 'system_created', 'ai_system', NEW.id,
      jsonb_build_object('name', NEW.name, 'risk_tier', NEW.risk_tier, 'deployment_status', NEW.lifecycle, 'lifecycle', NEW.lifecycle));
  ELSE
    INSERT INTO public.registry_audit_log (org_id, user_id, action, entity_type, entity_id, changes)
    VALUES (NEW.org_id, NEW.created_by, 'system_created', 'ai_system', NEW.id,
      jsonb_build_object('name', NEW.name, 'deployment_status', NEW.lifecycle, 'lifecycle', NEW.lifecycle));
  END IF;
  RETURN NEW;
END;
$function$;
