/*
  stripe-webhook: Stripe's events set the person's plan and its standing through billing_apply.
  No JWT (verify_jwt off); the signature is checked against STRIPE_WEBHOOK_SECRET instead, and the subscription is
  re-read from Stripe on every event. The person is the subscription's user_id metadata, else the row's customer.
*/
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { Stripe, admin, stripe } from '../_shared/http.ts';

const crypto = Stripe.createSubtleCryptoProvider();
const STANDS = new Set(['active', 'trialing', 'past_due']);

const planOf = (sub: Stripe.Subscription): { plan: string | null; period: string | null } => {
  const item = sub.items.data[0];
  const key = item?.price?.lookup_key ?? '';
  const [plan, period] = key.split('_');
  if (plan && period) return { plan, period };
  const m = sub.metadata ?? {};
  return { plan: m.plan ?? null, period: m.period ?? null };
};

const subjectOf = async (sub: Stripe.Subscription): Promise<string | null> => {
  if (sub.metadata?.user_id) return sub.metadata.user_id;
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const { data } = await admin().from('profiles').select('id').eq('stripe_customer_id', customer).maybeSingle();
  return data?.id ?? null;
};

/** the subscription's standing onto the row */
const apply = async (subId: string, note: string, fallbackSubject?: string | null): Promise<string> => {
  const sub = await stripe().subscriptions.retrieve(subId);
  const subject = (await subjectOf(sub)) ?? fallbackSubject ?? null;
  if (!subject) return `no account for subscription ${subId}`;
  const { plan, period } = planOf(sub);
  const stands = STANDS.has(sub.status);
  const renews = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
  const { error } = await admin().rpc('billing_apply', {
    subject,
    p_plan: stands ? plan : 'none',
    p_status: sub.status,
    p_period: stands ? period : null,
    p_renews_on: stands ? renews : null,
    p_customer: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
    p_subscription: sub.id,
    note,
  });
  return error ? `billing_apply: ${error.message}` : `ok ${subject} ${sub.status} ${plan ?? '-'}`;
};

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secret || !Deno.env.get('STRIPE_SECRET_KEY')) return new Response('billing is not switched on', { status: 503 });
  const sig = req.headers.get('stripe-signature') ?? '';
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(body, sig, secret, undefined, crypto);
  } catch (e) {
    return new Response(`bad signature: ${(e as Error).message}`, { status: 400 });
  }

  let said = 'ignored';
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.mode === 'subscription' && s.subscription) said = await apply(typeof s.subscription === 'string' ? s.subscription : s.subscription.id, `Stripe: paid at checkout`, s.client_reference_id);
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const why = event.type.endsWith('deleted') ? 'Stripe: the subscription ended' : event.type.endsWith('created') ? 'Stripe: a subscription began' : sub.cancel_at_period_end ? 'Stripe: cancelled, kept to the period end' : 'Stripe: the subscription changed';
        said = await apply(sub.id, why);
        break;
      }
      case 'invoice.paid':
      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice;
        /* newer API versions name the subscription under parent.subscription_details; the SDK type has the old field */
        const parent = (inv as unknown as { parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null }).parent;
        const named = inv.subscription ?? parent?.subscription_details?.subscription ?? null;
        const subId = typeof named === 'string' ? named : named?.id;
        if (subId) said = await apply(subId, event.type === 'invoice.paid' ? 'Stripe: an invoice was paid' : 'Stripe: a payment failed');
        break;
      }
    }
  } catch (e) {
    console.error(event.type, (e as Error).message);
    return new Response(`failed: ${(e as Error).message}`, { status: 500 });
  }
  console.log(event.type, said);
  return new Response(JSON.stringify({ received: true, said }), { headers: { 'Content-Type': 'application/json' } });
});
