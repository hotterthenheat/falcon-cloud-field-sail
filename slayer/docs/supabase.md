# Supabase: migrations and functions

## Migrations

`supabase/migrations/` holds the schema in apply order. Every file has a unique version now; the files that were
applied by hand in the SQL editor were renamed (contents unchanged) so the Supabase CLI can track them:

| Version | Was |
|---|---|
| `20261003000000_profiles` | `20261003_profiles` |
| `20261005000000_plan_tape` | `20261005_plan_tape` |
| `20261010000001_protect_dashboard` | `20261010_protect_dashboard` |
| `20261010000002_rpc_lockdown` | `20261010_rpc_lockdown` |
| `20261010000003_rls_initplan` | `20261010_rls_initplan` |
| `20261010000004_platform_lockdown` | `20261010_platform_lockdown` |
| `20261011000001_admin_people` | `20261011_admin_people` |
| `20261011000002_billing` | `20261011_billing` |
| `20261011000003_avatar_from_provider` | `20261011_avatar_from_provider` |
| `20261011000004_user_state` | `20261011_user_state` |
| `20261017000000_roles_grants` | `20261017_roles_grants` |

The "Run after ..." notes inside the older files use the old names; the order above is the one they describe.

**On the live project (once):** mark the already-applied files as applied, then push only the new ones:

```sh
supabase link --project-ref <ref>
supabase migration repair --status applied 20261003000000 20261005000000 20261010000001 20261010000002 \
  20261010000003 20261010000004 20261011000001 20261011000002 20261011000003 20261011000004 20261017000000
supabase db push    # applies 20261029000001 and 20261029000002
```

Or paste the two new files into the SQL editor, in order.

New in this round:

- `20261029000001_profile_hardening`: members cannot change their own `email` (it follows `auth.users`); a
  member's avatar must be a `data:image/...;base64` URL of at most 64 KB or a Google/GitHub picture URL; every avatar
  is capped at 256 KB and name/handle at 120/64 characters (new writes only); `admin_people()` reports the sign-in
  email from `auth.users`.
- `20261029000002_user_state_caps`: at most 100 keys and 8 MB of synced state per user.

Never edit a migration that has been applied; add a new one.

## Edge functions

`supabase/functions/_shared/http.ts` holds what the four functions share: the Stripe client, CORS, JSON answers,
the return origin and error wording. `supabase/config.toml` records `verify_jwt` per function (off only for
`stripe-webhook`, which checks Stripe's signature instead).

Checkout and portal return only to `SITE_URL` (default `https://slayerterminal.com`), any exact origin listed in
the comma-separated `SITE_ORIGINS` secret (for example a fixed Vercel preview domain), or localhost. Arbitrary
`*.vercel.app` origins are no longer accepted. Set the secrets under Edge Functions → Secrets.

Deploy: `supabase functions deploy stripe-checkout stripe-portal stripe-webhook account-delete`.
