-- Prefer first_name + last_name for people labels; keep full_name as compat sync.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text;

COMMENT ON COLUMN public.profiles.first_name IS 'Given name; preferred with last_name for member/assignee labels.';
COMMENT ON COLUMN public.profiles.last_name IS 'Family name; preferred with first_name for member/assignee labels.';
COMMENT ON COLUMN public.profiles.full_name IS 'Compat display string; kept in sync with first_name + last_name.';

-- Real multi-word full_name → first + last
UPDATE public.profiles p
SET
  first_name = NULLIF(btrim(split_part(btrim(p.full_name), ' ', 1)), ''),
  last_name = NULLIF(
    btrim(substr(btrim(p.full_name), length(split_part(btrim(p.full_name), ' ', 1)) + 2)),
    ''
  )
WHERE coalesce(btrim(p.full_name), '') <> ''
  AND position(' ' in btrim(p.full_name)) > 0
  AND p.first_name IS NULL
  AND p.last_name IS NULL;

-- Auth metadata first/last or spaced full_name
UPDATE public.profiles p
SET
  first_name = COALESCE(
    p.first_name,
    NULLIF(btrim(u.raw_user_meta_data->>'first_name'), ''),
    CASE
      WHEN position(' ' in btrim(coalesce(u.raw_user_meta_data->>'full_name', ''))) > 0
      THEN NULLIF(btrim(split_part(btrim(u.raw_user_meta_data->>'full_name'), ' ', 1)), '')
      ELSE NULL
    END
  ),
  last_name = COALESCE(
    p.last_name,
    NULLIF(btrim(u.raw_user_meta_data->>'last_name'), ''),
    CASE
      WHEN position(' ' in btrim(coalesce(u.raw_user_meta_data->>'full_name', ''))) > 0
      THEN NULLIF(
        btrim(
          substr(
            btrim(u.raw_user_meta_data->>'full_name'),
            length(split_part(btrim(u.raw_user_meta_data->>'full_name'), ' ', 1)) + 2
          )
        ),
        ''
      )
      ELSE NULL
    END
  )
FROM auth.users u
WHERE u.id = p.id
  AND (p.first_name IS NULL OR p.last_name IS NULL);

-- Single-token real names (not email local-part) → first_name only
UPDATE public.profiles p
SET first_name = NULLIF(btrim(p.full_name), '')
WHERE p.first_name IS NULL
  AND p.last_name IS NULL
  AND coalesce(btrim(p.full_name), '') <> ''
  AND position(' ' in btrim(p.full_name)) = 0
  AND (
    p.email IS NULL
    OR lower(btrim(p.full_name)) <> lower(split_part(btrim(p.email), '@', 1))
  );

-- Recompose full_name from structured parts
UPDATE public.profiles
SET full_name = NULLIF(btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
WHERE first_name IS NOT NULL OR last_name IS NOT NULL;

-- Drop fake full_name that is only the email local-part (no structured name)
UPDATE public.profiles p
SET full_name = NULL
WHERE p.email IS NOT NULL
  AND p.first_name IS NULL
  AND p.last_name IS NULL
  AND lower(btrim(coalesce(p.full_name, ''))) = lower(split_part(btrim(p.email), '@', 1));

CREATE OR REPLACE FUNCTION public.profiles_sync_display_name()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  composed text;
BEGIN
  NEW.first_name := NULLIF(btrim(NEW.first_name), '');
  NEW.last_name := NULLIF(btrim(NEW.last_name), '');
  NEW.full_name := NULLIF(btrim(NEW.full_name), '');

  composed := NULLIF(
    btrim(coalesce(NEW.first_name, '') || ' ' || coalesce(NEW.last_name, '')),
    ''
  );

  IF composed IS NOT NULL THEN
    NEW.full_name := composed;
  ELSIF NEW.full_name IS NOT NULL
    AND position(' ' in NEW.full_name) > 0
    AND NEW.first_name IS NULL
    AND NEW.last_name IS NULL
  THEN
    NEW.first_name := NULLIF(btrim(split_part(NEW.full_name, ' ', 1)), '');
    NEW.last_name := NULLIF(
      btrim(substr(NEW.full_name, length(split_part(NEW.full_name, ' ', 1)) + 2)),
      ''
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_sync_display_name ON public.profiles;
CREATE TRIGGER profiles_sync_display_name
  BEFORE INSERT OR UPDATE OF first_name, last_name, full_name
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_sync_display_name();
