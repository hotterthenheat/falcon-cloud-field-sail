/*
==================================================
  SLAYER TERMINAL - BILLING'S SEAM (data/billing.ts)

  What the Billing page reads: the plan, its
  standing, the card behind it, the invoices. THE
  SHAPE our server will hand back from Stripe
  (the customer, the subscription, the payment
  method, the invoice list) — never card numbers:
  Stripe's hosted Checkout takes a new card and
  Stripe's Customer Portal changes it, sees the
  invoices and cancels; this page shows what
  Stripe knows and opens those two doors. Until
  the keys are in (roadmap step 5) the state is a
  sample on this machine, so the page is the
  launch page, not a placeholder (Noah,
  2026-09-12: "the preview of how things would
  look after apis are plugged in and stripe is
  purchased").
==================================================
*/

import { useSyncExternalStore } from 'react';
import { ACCOUNTS_ON, supabase } from './supabase';
import type { PlanStatus } from './account';

/* STRIPE, IN TEST MODE (2026-10-10, Noah: "ive connected you to stripe"). The plans live in Stripe as three products
   with a monthly and a yearly price each (the lookup keys `book_month` … `desk_year`); a press on a plan opens Stripe's
   hosted Checkout through the project's `stripe-checkout` function, the card, the invoices and cancelling live on
   Stripe's Customer Portal through `stripe-portal`, and Stripe's own word lands on the profile row through
   `stripe-webhook` → billing_apply. The browser holds no key but the publishable one; the secret key and the webhook's
   signing secret are the functions' secrets, set in the Supabase dashboard. BILLING IS ON when the accounts are and the
   publishable key is in: the landing's doors read "Choose …" and go to checkout; off, they open the terminal as before. */
export const BILLING_ON: boolean = ACCOUNTS_ON && !!import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
export type Period = 'month' | 'year';

/* THE PLANS ARE BOOK · DESK · SEAT (Noah, 2026-10-02: "new names instead of pinpoint and compass for the plans, i want
   something unique to us but not corny" — three trading-floor nouns, each true of its plan). Book: the dealer book,
   read — the walls, the flip, the tape, the wire. Desk: the whole desk — contracts picked off the levels, the Weigher,
   the paper desk, the backtest, the journal, the room. Seat: a seat on an exchange was bought once and kept — one
   payment, yours for good. They were Pinpoint, Compass and Lifetime; a stored plan under an old key still reads. */
/* THREE PLANS AGAIN (Noah, 2026-10-05: "i still want there to be 3 plans … our top plan being 180 that includes compass"):
   BOOK $75 · TAPE $120 · DESK $180. Each answers one question, the way the rail does — Book: what do the dealers hold
   (Pulse, Terrain, Pinpoint, Alerts); Tape: what is the market doing (Trace, Dossier, scripts); Desk: which contract,
   and where do I practise (Compass, the Weigher, Practice — Desk's at his word later that day — and Community when it
   opens). Tape is a floor noun like the other two, true of its plan — Trace IS the tape. The Seat stays off the page
   (below). */
export type PlanKey = 'book' | 'tape' | 'desk' | 'seat';
const OLD_KEYS: Record<string, PlanKey> = { pinpoint: 'book', compass: 'desk', lifetime: 'seat' };
export const planKeyOf = (v: unknown): PlanKey => (v === 'book' || v === 'tape' || v === 'desk' || v === 'seat' ? v : OLD_KEYS[String(v)] ?? 'desk');

interface Plan {
  key: PlanKey;
  name: string;
  kicker: string;
  price: string;
  period: string;
  monthly: number | null;
}
/** The price a card prints for a period: a year is ten months — two months free (the yearly Stripe prices are set so).
    `amount` is the same figure as a number, for a card that ROLLS from one period's price to the other's (Noah,
    2026-10-10: "the transition from monthly to yearly should be smooth for the numbers"); null for a plan with no price. */
export const priceOf = (key: PlanKey, period: Period): { price: string; amount: number | null; period: string; aMonth: string | null; saves: string | null } => {
  const p = planOf(key);
  if (p.monthly == null) return { price: p.price, amount: null, period: p.period, aMonth: null, saves: null };
  if (period === 'year') {
    const yearly = p.monthly * 10;
    return { price: fmtDollars(yearly), amount: yearly, period: 'a year', aMonth: `$${(yearly / 12).toFixed(2)} a month`, saves: `two months free` };
  }
  return { price: p.price, amount: p.monthly, period: p.period, aMonth: null, saves: null };
};
/** a whole-dollar price, `$1,800` — also the shape a rolling price takes on every frame */
export const fmtDollars = (v: number): string => `$${Math.round(v).toLocaleString('en-US')}`;
/** The tiers as the landing prices them. Noah, 2026-09-19: $75 and $180 (they were $125 and $275); the Book $80 since
    2026-10-10 ("make the book plan be 80 dollars instead of 75"). */
/* THE SEAT IS OFF THE PAGE FOR NOW (Noah, 2026-10-05: "we are thinking of removing the custom lifetime plan just until we
   get up and running so you can remove that from the page as of now"). PLANS is what is SOLD — Book and Desk; the Seat
   keeps its key, so a stored plan under it still reads and `planOf('seat')` still names it, and its row below comes back
   to PLANS the day he says so. */
export const PLANS: Plan[] = [
  { key: 'book', name: 'Book', kicker: 'The charts and the book', price: '$80', period: 'a month', monthly: 80 },
  { key: 'tape', name: 'Tape', kicker: 'The tape and the record', price: '$120', period: 'a month', monthly: 120 },
  { key: 'desk', name: 'Desk', kicker: 'The whole desk', price: '$180', period: 'a month', monthly: 180 },
];
const SEAT: Plan = { key: 'seat', name: 'Seat', kicker: 'Everything, for good — paid once', price: 'Custom', period: 'one payment', monthly: null };
export const planOf = (key: PlanKey): Plan => PLANS.find(p => p.key === key) ?? (key === 'seat' ? SEAT : PLANS[PLANS.length - 1]);

export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'trialing';

export interface Invoice {
  id: string;
  /** ISO date */
  date: string;
  plan: PlanKey;
  amount: number;
  status: 'paid' | 'open' | 'void';
}

export interface Billing {
  plan: PlanKey;
  status: SubscriptionStatus;
  /** ISO date — the next charge, or the end of a canceled term */
  renewsOn: string;
  /** what Stripe shows of the card, never the number */
  card: { brand: string; last4: string; expMonth: number; expYear: number } | null;
  invoices: Invoice[];
}

const KEY = 'slayer_billing';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monthsFrom = (n: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return iso(d);
};

/** The sample: on Desk since four months, renewing in a month, a Visa on file */
export const SAMPLE_BILLING: Billing = {
  plan: 'desk',
  status: 'active',
  renewsOn: monthsFrom(1),
  card: { brand: 'Visa', last4: '4242', expMonth: 8, expYear: 2028 },
  invoices: [0, -1, -2, -3].map((m, i) => ({ id: `in_${1000 - i}`, date: monthsFrom(m), plan: 'desk' as const, amount: planOf('desk').monthly ?? 0, status: 'paid' as const })),
};

let billing: Billing = (() => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return SAMPLE_BILLING;
    const b = JSON.parse(raw) as Partial<Billing>;
    return { ...SAMPLE_BILLING, ...b, plan: planKeyOf(b.plan), invoices: SAMPLE_BILLING.invoices };
  } catch {
    return SAMPLE_BILLING;
  }
})();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** A plan switch — at launch this is Stripe Checkout (up) or the Portal (down); the sample just moves */
export function setPlan(plan: PlanKey): void {
  billing = { ...billing, plan, status: 'active' };
  try {
    localStorage.setItem(KEY, JSON.stringify({ plan: billing.plan, status: billing.status, renewsOn: billing.renewsOn, card: billing.card }));
  } catch {
    /* storage off — the choice lives for the session */
  }
  listeners.forEach(fn => fn());
}

export const useBilling = (): Billing => useSyncExternalStore(subscribe, () => billing, () => SAMPLE_BILLING);

/** "Oct 12, 2026" */
export function fmtDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
/** the same, from an instant */
export const fmtWhen = (iso: string): string => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/* ---- the live doors (Stripe through the project's functions) ----------------------------------------------------- */

export type BillingOutcome = { ok: true } | { ok: false; why: string };

/** Stripe's standing, in the page's words */
export const STATUS_WORD: Record<PlanStatus, string> = {
  none: 'no plan',
  trialing: 'trial',
  active: 'active',
  past_due: 'payment due',
  canceled: 'ending',
  unpaid: 'unpaid',
  incomplete: 'not finished',
  incomplete_expired: 'lapsed',
  paused: 'paused',
};

/** what a function said went wrong, in plain words */
const whyOf = async (error: unknown): Promise<string> => {
  const e = error as { message?: string; context?: Response };
  try {
    const body = (await e.context?.clone().json()) as { error?: string } | undefined;
    if (body?.error) return body.error;
  } catch {
    /* no body to read */
  }
  const m = (e.message ?? '').toLowerCase();
  if (m.includes('fetch') || m.includes('network') || m.includes('failed to send')) return 'Could not reach billing. Check the connection and try again.';
  return e.message ? e.message.charAt(0).toUpperCase() + e.message.slice(1) : 'Billing did not answer.';
};

/** THE DOOR TO CHECKOUT — the browser leaves for Stripe's page (or the portal, when a plan already stands) */
/** the browser's own Stripe key — the one made for pages; the secret key never leaves the functions' secrets */
export const STRIPE_PUBLISHABLE_KEY: string | undefined = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

export type CheckoutMade =
  | { ok: true; kind: 'mount'; clientSecret: string }
  | { ok: true; kind: 'portal'; url: string }
  /** already on a plan and asking for a higher one: what the card on file pays today, and when the new price starts */
  | { ok: true; kind: 'upgrade'; from: PlanKey; fromPeriod: Period; dueToday: number; nextOn: string | null }
  | { ok: true; kind: 'upgraded' }
  | { ok: false; why: string };

type CheckoutAnswer = {
  client_secret?: string;
  url?: string;
  portal?: boolean;
  upgrade?: { from: string; from_period: string; due_today: number; next_on: number | null };
  upgraded?: boolean;
  error?: string;
};
const read = (data: CheckoutAnswer | null): CheckoutMade => {
  if (data?.upgraded) return { ok: true, kind: 'upgraded' };
  if (data?.upgrade) return { ok: true, kind: 'upgrade', from: planKeyOf(data.upgrade.from), fromPeriod: data.upgrade.from_period === 'year' ? 'year' : 'month', dueToday: data.upgrade.due_today, nextOn: data.upgrade.next_on ? new Date(data.upgrade.next_on * 1000).toISOString() : null };
  if (data?.portal && data.url) return { ok: true, kind: 'portal', url: data.url };
  if (data?.client_secret) return { ok: true, kind: 'mount', clientSecret: data.client_secret };
  return { ok: false, why: data?.error ?? 'Billing did not answer.' };
};

/** THE CHECKOUT, MADE (2026-10-10): a client secret for OUR OWN PAGE (/checkout) to mount Stripe's framed fields with —
    the card is typed into Stripe's frames inside our layout and never reaches us. Someone already on a plan asking for a
    higher one gets the UPGRADE's figures instead (confirmUpgrade does it); the same plan or a lower one, the portal. */
export async function makeCheckout(plan: PlanKey, period: Period): Promise<CheckoutMade> {
  if (!supabase || !BILLING_ON) return { ok: false, why: 'Billing is not switched on yet.' };
  const { data, error } = await supabase.functions.invoke<CheckoutAnswer>('stripe-checkout', { body: { plan, period } });
  if (error) return { ok: false, why: await whyOf(error) };
  return read(data);
}

/** THE UPGRADE, DONE: the plan moves now and the card on file pays the difference for the rest of the period */
export async function confirmUpgrade(plan: PlanKey, period: Period): Promise<CheckoutMade> {
  if (!supabase || !BILLING_ON) return { ok: false, why: 'Billing is not switched on yet.' };
  const { data, error } = await supabase.functions.invoke<CheckoutAnswer>('stripe-checkout', { body: { plan, period, confirm: true } });
  if (error) return { ok: false, why: await whyOf(error) };
  return read(data);
}

/* THE SESSION MADE AHEAD (Noah, 2026-10-10: "why does it take forever for stripe to load"): a signed-in press on a plan
   asks Stripe for the session before the checkout page even opens, and the page takes that answer instead of asking
   again — the function's second passes during the page change, not after it */
let ahead: { plan: PlanKey; period: Period; made: Promise<CheckoutMade> } | null = null;
export const makeCheckoutAhead = (plan: PlanKey, period: Period): void => {
  ahead = { plan, period, made: makeCheckout(plan, period) };
};
/** the session made ahead for this plan and period, if one is waiting — else made now */
export const takeCheckout = (plan: PlanKey, period: Period): Promise<CheckoutMade> => {
  const a = ahead;
  ahead = null;
  return a && a.plan === plan && a.period === period ? a.made : makeCheckout(plan, period);
};

/** THE DOOR TO THE PORTAL — the card, the invoices, a change of plan, cancelling, on Stripe's page */
export async function openPortal(): Promise<BillingOutcome> {
  if (!supabase || !BILLING_ON) return { ok: false, why: 'Billing is not switched on yet.' };
  const { data, error } = await supabase.functions.invoke<{ url?: string; error?: string }>('stripe-portal', { body: {} });
  if (error) return { ok: false, why: await whyOf(error) };
  if (!data?.url) return { ok: false, why: data?.error ?? 'Billing did not answer.' };
  window.location.assign(data.url);
  return { ok: true };
}
