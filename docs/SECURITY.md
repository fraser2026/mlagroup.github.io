# RegAnchor platform security

Source of truth for the public [Security](../security.html) page. Product name is **RegAnchor**; legal issuer is **MLA Group Ltd**.

## In production today

| Control | How it is implemented |
|---|---|
| Authentication | Email/password via Supabase Auth. Google OAuth (`signInWithOAuth`) when the Google provider is enabled in the Supabase project. |
| Sessions | JWT access tokens; publishable (anon) key only in the browser. Service role never ships in client code. |
| Multi-user seats | Professional = 5 seats (members + pending invites). Free/Essentials = 1. Enforced in `invite_org_member`, not only in the UI. |
| RBAC | Organisation roles: Owner, Admin, Editor, Viewer. Privileged membership changes go through `SECURITY DEFINER` RPCs (`invite_org_member`, `accept_org_invite`, `set_org_member_role`, `remove_org_member`). Row-level security on `organisations`, `org_members`, `org_invites`, and `ai_systems` uses `is_org_member` / `has_org_role`. |
| Invitations | Hashed tokens (`sha256`), 14-day expiry, email must match the signed-in user. Raw token is shown once and is not stored. |
| Profile privileges | `profiles.role` and `profiles.paid` cannot be changed from the client. RLS on `profiles` limits reads to self and same-organisation colleagues. |

## Enable Google sign-in (ops)

1. [Supabase Dashboard](https://supabase.com/dashboard) → Authentication → Providers → Google.
2. Create OAuth credentials in Google Cloud (Web application).
3. Add authorised redirect: `https://<project-ref>.supabase.co/auth/v1/callback`.
4. Add site URLs: production origin plus `/login.html` and `/portal.html`.
5. Paste Client ID and secret into the Google provider. Save.

Until this is on, the login button returns a provider error; password sign-in still works.

## Not yet (Enterprise / later)

- SAML / OIDC SSO for a customer IdP (Azure AD, Okta, Google Workspace organisation-wide). Login already has a **Continue with SAML SSO** path (`login.html` second panel) so the product opening exists; IdP connection is not live yet.
- SCIM provisioning.
- Organisation-wide Audit Log search UI (events already write to `registry_audit_log`).
- Step-up / hardware keys.

## Engineering rules

- Never put authorisation in `user_metadata` (user-editable). Org role lives in `org_members`.
- Never expose the service role key in GitHub Pages.
- Invite and role changes must not be raw client `update`s on `org_members` (no UPDATE policy for self-promotion).
