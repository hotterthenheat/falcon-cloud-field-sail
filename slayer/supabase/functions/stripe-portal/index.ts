/*
  SLAYER TERMINAL - THE DOOR TO THE CUSTOMER PORTAL (supabase/functions/stripe-portal)

  The card, the invoices, a change of plan, cancelling: all on Stripe's own portal, one door from Settings › Billing.
  Hands back the portal's address for the signed-in person's Stripe customer; someone with no billing yet is told so.

  Secrets: STRIPE_SECRET_KEY (the Supabase dashboard). The request carries the person's JWT (verify_jwt on).
*/
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';

/* the client is made when a request comes, after the secret is checked — made at boot with no key it throws, and the
   whole function dies with a bare "worker error" */
let client: Stripe | null = null;
const stripe = (): Stripe => (client ??= new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { httpClient: Stripe.createFetchHttpClient() }));
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const originOf = (req: Request): string => {
  const o = req.headers.get('origin') ?? '';
  /* the dev servers, the domain, and the Vercel addresses (the test of the wallets before launch, 2026-10-11) */
  if (/^http:\/\/localhost(:\d+)?$/.test(o) || /^https:\/\/([a-z0-9-]+\.)?slayerterminal\.com$/.test(o) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(o)) return o;
  return Deno.env.get('SITE_URL') ?? 'https://slayerterminal.com';
};

/** what went wrong, in words the page can show — Stripe refusing our key is said as that, never the key itself */
const plain = (e: unknown): string => {
  if (e instanceof Stripe.errors.StripeAuthenticationError) return 'Stripe refused our key — the secret key in the dashboard is not right.';
  const m = (e as Error)?.message ?? '';
  return m ? `Billing hit a snag: ${m}` : 'Billing hit a snag.';
};

const handle = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only.' }, 405);
  if (!Deno.env.get('STRIPE_SECRET_KEY')) return json({ error: 'Billing is not switched on yet.' }, 503);

  const url = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: 'Sign in first.' }, 401);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: row } = await admin.from('profiles').select('stripe_customer_id').eq('id', user.id).maybeSingle();
  if (!row?.stripe_customer_id) return json({ error: 'No billing yet — pick a plan first.' }, 400);

  const portal = await stripe().billingPortal.sessions.create({ customer: row.stripe_customer_id, return_url: `${originOf(req)}/settings/billing` });
  return json({ url: portal.url });
};

/* a throw above would leave the runtime's bare 500 with no CORS headers — unreadable to the browser; caught, said plainly */
Deno.serve(async (req: Request) => {
  try {
    return await handle(req);
  } catch (e) {
    console.error('stripe-portal', (e as Error)?.message ?? e);
    return json({ error: plain(e) }, 500);
  }
});
