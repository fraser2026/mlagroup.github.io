-- Professional seat allowance: 5 → 15 (marketing + invite enforcement parity)
CREATE OR REPLACE FUNCTION public.org_seat_limit(p_plan text)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT CASE lower(coalesce(p_plan, 'free'))
    WHEN 'professional' THEN 15
    WHEN 'enterprise' THEN 50
    ELSE 1
  END;
$$;
