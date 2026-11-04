-- Requests recorded before guardrail_hits existed carry DLP findings only. Give them the same hits
-- the gateway now writes, so guardrail counts and filters include them.

UPDATE public.gateway_request_events e
SET guardrail_hits = h.hits
FROM (
  SELECT
    e2.id,
    jsonb_agg(DISTINCT jsonb_build_object(
      'key', CASE f -> 'profile' ->> 'profile_id'
        WHEN 'e91a2360-da51-4fdf-9711-bcdecd462614' THEN 'dlp_financial'
        WHEN 'd658f520-6ecb-4a34-a725-ba37243c2d28' THEN 'dlp_identifiers'
      END,
      'action', CASE WHEN e2.dlp ->> 'action' = 'BLOCK' THEN 'BLOCK' ELSE 'FLAG' END,
      'check', CASE WHEN f ->> 'check' = 'RESPONSE' THEN 'RESPONSE' ELSE 'REQUEST' END,
      'source', 'cloudflare'
    )) AS hits
  FROM public.gateway_request_events e2
  CROSS JOIN LATERAL jsonb_array_elements(e2.dlp -> 'findings') f
  WHERE e2.guardrail_hits IS NULL
    AND jsonb_typeof(e2.dlp -> 'findings') = 'array'
    AND f -> 'profile' ->> 'profile_id' IN ('e91a2360-da51-4fdf-9711-bcdecd462614', 'd658f520-6ecb-4a34-a725-ba37243c2d28')
  GROUP BY e2.id
) h
WHERE e.id = h.id;
