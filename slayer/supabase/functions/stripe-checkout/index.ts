/*
  stripe-checkout: a signed-in person picks a plan; this makes a Stripe Checkout session in "elements" mode and
  returns its client secret for the /checkout page. Someone already on a plan is upgraded in place (a higher plan,
  or the same plan yearly) or sent to the portal. Secret: STRIPE_SECRET_KEY; the gateway checks the JWT.
*/
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { CORS, Stripe, admin, json, originOf, serve, stripe } from '../_shared/http.ts';

const PLANS = new Set(['book', 'tape', 'desk']);
const PERIODS = new Set(['month', 'year']);
const RANK: Record<string, number> = { book: 1, tape: 2, desk: 3 };

/* the account's API version, named per request: the pinned SDK predates the "elements" checkout mode */
const API_VERSION = '2026-09-30.endive';

/* pay-later methods are excluded from every session, whatever the dashboard enables */
const NO_PAY_LATER = ['klarna', 'affirm', 'afterpay_clearpay', 'zip', 'sunbit', 'scalapay', 'alma', 'sequra', 'billie'];

/* a lookup key's price id, kept for the life of the instance */
const PRICE_IDS = new Map<string, string>();
const priceFor = async (lookup: string): Promise<string | null> => {
  const known = PRICE_IDS.get(lookup);
  if (known) return known;
  const prices = await stripe().prices.list({ lookup_keys: [lookup], active: true, limit: 1 });
  const id = prices.data[0]?.id ?? null;
  if (id) PRICE_IDS.set(lookup, id);
  return id;
};

const handle = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only.' }, 405);
  if (!Deno.env.get('STRIPE_SECRET_KEY')) return json({ error: 'Billing is not switched on yet.' }, 503);

  const url = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!);
  /* the gateway checked the signature; getClaims verifies the claims against the project's public keys */
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

  const [{ data: row }, priceId] = await Promise.all([
    admin().from('profiles').select('name, stripe_customer_id, stripe_subscription_id, plan_status').eq('id', user.id).maybeSingle(),
    priceFor(`${plan}_${period}`),
  ]);
  const origin = originOf(req);
  const back = `${origin}/settings/billing`;

  if (!priceId) return json({ error: 'That price is not set up yet.' }, 500);

  /* Already on a plan: a higher plan (or the same plan yearly) is upgraded in place, prorated today; asked without
     `confirm` it answers with the figures. A same or lower plan, or a past-due one, goes to the portal. */
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

  /* Checkout makes the Stripe customer on completion (the webhook stores its id); a known customer is reused. */
  const customer = row?.stripe_customer_id ?? null;
  const who = customer ? { customer } : { customer_email: user.email };

  /* "elements" mode returns a client secret that /checkout mounts Stripe's fields with; the card never reaches us.
     Managed Payments is off so Stripe is not the seller of record over our own terms. The SDK's types predate both
     fields, hence the cast. */
  const params = {
    mode: 'subscription',
    ui_mode: 'elements',
    ...who,
    client_reference_id: user.id,
    line_items: [{ price: priceId, quantity: 1 }],
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

serve('stripe-checkout', handle);
