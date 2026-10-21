/*
  SLAYER TERMINAL - THE DOOR TO CHECKOUT (supabase/functions/stripe-checkout)

  A signed-in person presses a plan; this opens Stripe's own hosted checkout for it and hands back the address to go to.
  The card is typed on Stripe's page, never ours. Someone already on a plan is sent to the customer portal instead —
  that is where a plan is changed. The Stripe customer is made on the first press and remembered on the profile row.

  Secrets, set in the Supabase dashboard (Edge Functions → Secrets), never in the repo: STRIPE_SECRET_KEY. The service
  role key is the runtime's own (SUPABASE_SERVICE_ROLE_KEY); the request must carry the person's JWT (verify_jwt on).
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
const PLANS = new Set(['book', 'tape', 'desk']);
const PERIODS = new Set(['month', 'year']);
const RANK: Record<string, number> = { book: 1, tape: 2, desk: 3 };

/* the account's own API version — the one its webhook endpoint speaks — named on the session request, because the SDK
   pinned here predates Stripe's "elements" checkout mode (2026-10-10) */
const API_VERSION = '2026-09-30.endive';

/* NO BUY-NOW-PAY-LATER ON OUR PAGE (Noah, 2026-10-10: "anything related to buy now pay later websites are not on this
   page, we dont want it"): every instalment and pay-later way Stripe knows is kept off the session, whatever the
   dashboard switches on — Klarna, Affirm, Afterpay, Zip, Sunbit, Scalapay, Alma, SeQura, Billie (the ones Stripe's
   exclusion list accepts; the first list named ways it does not, and Stripe refused the whole session) */
const NO_PAY_LATER = ['klarna', 'affirm', 'afterpay_clearpay', 'zip', 'sunbit', 'scalapay', 'alma', 'sequra', 'billie'];

/* a lookup key's price id, remembered for the life of the instance — one Stripe round trip fewer on a warm press */
const PRICE_IDS = new Map<string, string>();
const priceFor = async (lookup: string): Promise<string | null> => {
  const known = PRICE_IDS.get(lookup);
  if (known) return known;
  const prices = await stripe().prices.list({ lookup_keys: [lookup], active: true, limit: 1 });
  const id = prices.data[0]?.id ?? null;
  if (id) PRICE_IDS.set(lookup, id);
  return id;
};

/** where to send the person back: the page that asked (our own origins only), else the site */
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
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!);
  /* WHO IS ASKING, without a round trip to Auth: the gateway already checked the token's signature (verify_jwt on) and
     the project signs with asymmetric keys, so the claims are verified here against the public keys, fetched once per
     instance — the earlier getUser() cost a network hop on every press (2026-10-10) */
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: verified } = await asUser.auth.getClaims(token);
  const claims = verified?.claims;
  const user = claims?.sub ? { id: String(claims.sub), email: typeof claims.email === 'string' ? claims.email : undefined } : null;
  if (!user) return json({ error: 'Sign in first.' }, 401);

  let plan = '', period = '', confirm = false;
  try {
    const body = await req.json();
    plan = String(body.plan ?? '');
    period = String(body.period ?? 'month');
    confirm = body.confirm === true;
  } catch {
    return json({ error: 'Say which plan.' }, 400);
  }
  if (!PLANS.has(plan) || !PERIODS.has(period)) return json({ error: 'That is not a plan.' }, 400);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  /* the row and the price side by side — every round trip here is a beat the person waits on the door */
  const [{ data: row }, priceId] = await Promise.all([
    admin.from('profiles').select('name, stripe_customer_id, stripe_subscription_id, plan_status').eq('id', user.id).maybeSingle(),
    priceFor(`${plan}_${period}`),
  ]);
  const origin = originOf(req);
  const back = `${origin}/settings/billing`;

  if (!priceId) return json({ error: 'That price is not set up yet.' }, 500);

  /* ALREADY ON A PLAN. A higher plan, or the same plan by the year, is an UPGRADE IN PLACE (2026-10-10 — the walls
     "tease the user so they can upgrade their plan to the highest one"): the card on file pays the difference for the
     rest of the period today and the plan moves now. Asked plainly, this answers with the figures; asked with
     `confirm`, it does it. The same plan, or a lower one, is the portal's business. */
  if (row?.stripe_customer_id && row.stripe_subscription_id && ['active', 'trialing', 'past_due'].includes(row.plan_status ?? '')) {
    const sub = await stripe().subscriptions.retrieve(row.stripe_subscription_id);
    const item = sub.items.data[0];
    const [fromPlan = '', fromPeriod = ''] = (item?.price?.lookup_key ?? '').split('_');
    const higher = (RANK[plan] ?? 0) > (RANK[fromPlan] ?? 0) || (plan === fromPlan && period === 'year' && fromPeriod === 'month');
    if (!item || !higher || sub.status === 'past_due') {
      const portal = await stripe().billingPortal.sessions.create({ customer: row.stripe_customer_id, return_url: back });
      return json({ url: portal.url, portal: true });
    }
    if (!confirm) {
      const preview = await stripe().invoices.createPreview({
        customer: row.stripe_customer_id,
        subscription: sub.id,
        subscription_details: { items: [{ id: item.id, price: priceId }], proration_behavior: 'always_invoice' },
      });
      return json({ upgrade: { from: fromPlan, from_period: fromPeriod, due_today: preview.amount_due, next_on: sub.current_period_end ?? null } });
    }
    const moved = await stripe().subscriptions.update(sub.id, {
      items: [{ id: item.id, price: priceId }],
      proration_behavior: 'always_invoice',
      payment_behavior: 'error_if_incomplete',
      metadata: { user_id: user.id, plan, period },
    });
    return json({ upgraded: true, status: moved.status });
  }

  /* THE CUSTOMER IS MADE BY CHECKOUT ITSELF when the session completes — one round trip fewer on the first press, and an
     abandoned checkout leaves nothing behind at Stripe; the webhook writes the id on the row. A row that already names
     one is sent as that customer, so the portal and a second purchase are the same person at Stripe. */
  const customer = row?.stripe_customer_id ?? null;
  const who = customer ? { customer } : { customer_email: user.email };

  /* THE CHECKOUT IS OUR OWN PAGE NOW (Noah, 2026-10-10, of Stripe's hosted page: "the shapes and spaces are off"): the
     session is made in Stripe's "elements" mode, which hands back a CLIENT SECRET instead of an address — the page at
     /checkout mounts Stripe's framed fields inside our own layout with it, and the card still never touches us. The
     return address is where Stripe sends a redirect-based payment back to; a card completes in place.

     MANAGED PAYMENTS IS OFF ON OUR SESSIONS. Stripe switches its "Managed Payments" on by default for a new account —
     Stripe itself becomes the seller of record, files the sales tax, and applies ITS consumer terms and refund rules
     (which would sit over our Terms' no-refunds line), at a higher fee (+3.5%). Left on, Checkout refused the first
     press ("the product tax code is missing"). Standard Stripe at Noah's word; the products carry their tax code.

     The SDK's types and pinned API version predate the elements mode and the field, hence the cast and the API version
     named on the request (the account's own, the one its webhook endpoint speaks). */
  const params = {
    mode: 'subscription',
    ui_mode: 'elements',
    ...who,
    client_reference_id: user.id,
    line_items: [{ price: priceId, quantity: 1 }],
    /* paid, the person lands on the start page — every room a card, pick where to begin (Noah, 2026-10-10) */
    return_url: `${origin}/start?checkout=success`,
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
    subscription_data: { metadata: { user_id: user.id, plan, period } },
    managed_payments: { enabled: false },
    excluded_payment_method_types: NO_PAY_LATER,
  } as unknown as Stripe.Checkout.SessionCreateParams;
  const session = await stripe().checkout.sessions.create(params, { apiVersion: API_VERSION } as Stripe.RequestOptions);
  if (!session.client_secret) return json({ error: 'Stripe gave no checkout to mount.' }, 500);
  return json({ client_secret: session.client_secret });
};

/* a throw anywhere above would leave the runtime's bare 500 with no CORS headers on it — the browser then cannot read
   it and the page can only say it could not reach billing (Noah's first press, 2026-10-10); caught, it is said plainly */
Deno.serve(async (req: Request) => {
  try {
    return await handle(req);
  } catch (e) {
    console.error('stripe-checkout', (e as Error)?.message ?? e);
    return json({ error: plain(e) }, 500);
  }
});
