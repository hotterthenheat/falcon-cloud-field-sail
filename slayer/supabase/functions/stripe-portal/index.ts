/*
  stripe-portal: the address of Stripe's customer portal (card, invoices, plan changes, cancelling) for the
  signed-in person's Stripe customer. Secret: STRIPE_SECRET_KEY. The gateway checks the JWT (verify_jwt on).
*/
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { CORS, admin, json, originOf, serve, stripe } from '../_shared/http.ts';

const handle = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only.' }, 405);
  if (!Deno.env.get('STRIPE_SECRET_KEY')) return json({ error: 'Billing is not switched on yet.' }, 503);

  const url = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: 'Sign in first.' }, 401);

  const { data: row } = await admin().from('profiles').select('stripe_customer_id').eq('id', user.id).maybeSingle();
  if (!row?.stripe_customer_id) return json({ error: 'No billing yet — pick a plan first.' }, 400);

  const portal = await stripe().billingPortal.sessions.create({ customer: row.stripe_customer_id, return_url: `${originOf(req)}/settings/billing` });
  return json({ url: portal.url });
};

serve('stripe-portal', handle);
