-- Already applied live. Stamp JWT actor on client-writable audit/history inserts.
CREATE OR REPLACE FUNCTION public.stamp_registry_audit_actor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.user_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS stamp_registry_audit_actor ON public.registry_audit_log;
CREATE TRIGGER stamp_registry_audit_actor
  BEFORE INSERT ON public.registry_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION stamp_registry_audit_actor();

CREATE OR REPLACE FUNCTION public.stamp_score_history_actor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS stamp_score_history_actor ON public.governance_score_history;
CREATE TRIGGER stamp_score_history_actor
  BEFORE INSERT ON public.governance_score_history
  FOR EACH ROW
  EXECUTE FUNCTION stamp_score_history_actor();
