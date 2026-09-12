-- Display name only: model provider is Microsoft Foundry (slug stays azure for compatibility).
UPDATE public.provider_catalog
SET name = 'Microsoft Foundry'
WHERE slug IN ('azure', 'azureai');
