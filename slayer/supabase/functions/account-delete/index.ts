/*
  account-delete: Settings > Account > Delete account, for the signed-in person only.
    1. the typed email must be the account's;  2. the last owner cannot leave;
    3. the Stripe customer is deleted (cancelling any subscription); if Stripe fails, nothing is deleted;
    4. the auth user is deleted, and the database cascades the profile, user_state and audit rows.
  Secret: STRIPE_SECRET_KEY (step 3 is skipped without it). The gateway checks the JWT (verify_jwt on).
*/
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { CORS, admin as adminClient, json, serve, stripe } from '../_shared/http.ts';

const handle = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only.' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: 'Sign in first.' }, 401);

  /* 1. the confirmation: the email typed on the page must be this account's */
  let typed = '';
  try {
    const body = (await req.json()) as { email?: unknown };
    typed = typeof body.email === 'string' ? body.email : '';
  } catch {
    /* no body */
  }
  if (!user.email || typed.trim().toLowerCase() !== user.email.toLowerCase()) return json({ error: 'Type the account’s email exactly to confirm.' }, 400);

  const admin = adminClient();
  const { data: row, error: rowError } = await admin.from('profiles').select('role,stripe_customer_id').eq('id', user.id).maybeSingle();
  if (rowError) return json({ error: `Could not read the account: ${rowError.message}` }, 500);

  /* 2. the last owner stays */
  if (row?.role === 'owner') {
    const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'owner');
    if ((count ?? 0) <= 1) return json({ error: 'You are the last owner. Make someone else an owner in Settings › People first.' }, 400);
  }

  /* 3. the billing ends first — a plan must never outlive its account */
  let customer: string | null = row?.stripe_customer_id ?? null;
  if (customer && Deno.env.get('STRIPE_SECRET_KEY')) {
    try {
      await stripe().customers.del(customer);
    } catch (e) {
      /* a customer already gone (a sandbox reset) is no reason to keep the account */
      const code = (e as { code?: string })?.code;
      if (code !== 'resource_missing') {
        console.error('account-delete stripe', user.id, (e as Error)?.message ?? e);
        return json({ error: 'Billing could not end the plan, so nothing was deleted. Try again in a minute.' }, 502);
      }
      customer = `${customer} (already gone)`;
    }
  }

  /* 4. the account itself; the database cascades the rest */
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    console.error('account-delete auth', user.id, error.message);
    return json({ error: `The account could not be deleted: ${error.message}` }, 500);
  }
  console.log('account-delete', user.id, 'customer', customer ?? '-');
  return json({ deleted: true });
};

serve('account-delete', handle, 'Deleting');
