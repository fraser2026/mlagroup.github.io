-- Phase 7: additional provider adapters.
-- Only key-only connectors with a live verification path are enabled.

UPDATE public.provider_catalog
SET
  auth_method = 'api_key',
  connector_available = true,
  docs_url = 'https://platform.openai.com/docs/api-reference/models/list'
WHERE slug = 'openai';

UPDATE public.provider_catalog
SET
  auth_method = 'api_key',
  connector_available = true,
  docs_url = 'https://ai.google.dev/gemini-api/docs/api-key'
WHERE slug IN ('google', 'gemini');

UPDATE public.provider_catalog
SET
  auth_method = 'iam',
  connector_available = false,
  docs_url = 'https://docs.aws.amazon.com/bedrock/latest/userguide/security-iam.html'
WHERE slug = 'bedrock';

UPDATE public.provider_catalog
SET
  auth_method = 'oauth',
  connector_available = false,
  docs_url = 'https://learn.microsoft.com/azure/ai-services/openai/how-to/managed-identity'
WHERE slug = 'azure';

COMMENT ON COLUMN public.provider_catalog.connector_available IS
  'True only when RegAnchor can verify the catalog provider using the currently modelled credentials. Phase 7 enables OpenAI and Google; AWS/Azure await IAM context.';
