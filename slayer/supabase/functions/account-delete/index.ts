/*
  SLAYER TERMINAL - THE DOOR OUT FOR GOOD (supabase/functions/account-delete)

  Settings › Account › Delete account (Noah, 2026-10-10: "build the delete account door"). The privacy page promises
  it and the terms say it is done from Settings; until now it was a mail to us.

  What it does, in order, for the signed-in person only:
    1. checks the confirmation — the request carries the email they typed, and it must be theirs;
    2. refuses to delete the last owner (someone else must be made an owner first — the People room);
    3. ends the billing: the Stripe customer is deleted, which cancels any subscription at once (no refund of the
       rest of the period — the terms say so); the invoices stay in Stripe's books as the law asks. If Stripe cannot
       do it, NOTHING is deleted and the person is told to try again — a plan must never outlive its account;
    4. deletes the auth user; the database cascades the profile, the carried stores (user_state) and the log rows
       about them (audit_log.subject).

  Secrets: STRIPE_SECRET_KEY (the Supabase dashboard; billing may be off on a build, then step 3 is skipped). The
  request carries the person's JWT (verify_jwt on). The service-role key is the runtime's own, never the browser's.
*/
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';

let client: Stripe | null = null;
const stripe = (): Stripe => (client ??= new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { httpClient: Stripe.createFetchHttpClient() }));
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

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

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
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

/* a throw above would leave the runtime's bare 500 with no CORS headers — unreadable to the browser; caught, said plainly */
Deno.serve(async (req: Request) => {
  try {
    return await handle(req);
  } catch (e) {
    console.error('account-delete', (e as Error)?.message ?? e);
    const m = (e as Error)?.message ?? '';
    return json({ error: m ? `Deleting hit a snag: ${m}` : 'Deleting hit a snag.' }, 500);
  }
});
