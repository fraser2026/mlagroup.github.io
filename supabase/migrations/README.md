# Supabase migrations (RLS snapshot)

These files snapshot live RLS already applied on project `hueftewwenjaiagdoqmb`.

- Do not re-apply blindly if `supabase_migrations.schema_migrations` already has the version.
- Do **not** include the local agent-governance migrations (`ai_asset_registry_phase1`, `ai_asset_model_and_platforms`, `registry_asset_deletion`, `provider_connections_phase2a`); those stay in Fraser's local Cursor work.
- PR 35 (portal policy mint/edit UI) is separate and must not be mixed into this branch.
- Merge this branch into the agent-governance work when that phase is ready; expected conflict surface is low because this only touches existing RLS, not new models/health tables.
