/* Billing state (plan, standing, card summary, invoices) as Stripe reports it, never card numbers; without keys a local sample. */

import { useSyncExternalStore } from 'react';
import { ACCOUNTS_ON, supabase } from './supabase';
import type { PlanStatus } from './account';

/* Stripe: three products, monthly and yearly (lookup keys `book_month` … `desk_year`); checkout via `stripe-checkout`, card and invoices
   via `stripe-portal`, events via `stripe-webhook` → billing_apply. The browser holds only the publishable key. */
export const BILLING_ON: boolean = ACCOUNTS_ON && !!import.meta.env?.VITE_STRIPE_PUBLISHABLE_KEY;
export type Period = 'month' | 'year';

/* Plan keys: book, tape, desk, seat. Old keys (pinpoint, compass, lifetime) still read. */
/* Book $80 (Pulse, Terrain, Pinpoint, Alerts), Tape $120 (adds Trace, Dossier, scripts), Desk $180 (adds Compass, the
   Weigher, Practice, Community). The Seat is off the page (below). */
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
/** The price a card prints for a period; a year is ten months. `amount` is the number, for a card that animates
    between periods; null for a plan without a price. */
export const priceOf = (key: PlanKey, period: Period): { price: string; amount: number | null; period: string; aMonth: string | null; saves: string | null } => {
  const p = planOf(key);
  if (p.monthly == null) return { price: p.price, amount: null, period: p.period, aMonth: null, saves: null };
  if (period === 'year') {
    const yearly = p.monthly * 10;
    return { price: fmtDollars(yearly), amount: yearly, period: 'a year', aMonth: `$${(yearly / 12).toFixed(2)} a month`, saves: `two months free` };
  }
  return { price: p.price, amount: p.monthly, period: p.period, aMonth: null, saves: null };
};
/** a whole-dollar price, `$1,800` */
export const fmtDollars = (v: number): string => `$${Math.round(v).toLocaleString('en-US')}`;
/** The tiers as the landing prices them. */
/* PLANS is what is sold. The Seat keeps its key (stored plans still read, planOf('seat') names it) and its row below
   returns to PLANS when it is sold again. */
export const PLANS: Plan[] = [
  { key: 'book', name: 'Book', kicker: 'The charts and the book', price: '$80', period: 'a month', monthly: 80 },
  { key: 'tape', name: 'Tape', kicker: 'The tape and the record', price: '$120', period: 'a month', monthly: 120 },
  { key: 'desk', name: 'Desk', kicker: 'The whole desk', price: '$180', period: 'a month', monthly: 180 },
];
const SEAT: Plan = { key: 'seat', name: 'Seat', kicker: 'Everything, for good — paid once', price: 'Custom', period: 'one payment', monthly: null };
export const planOf = (key: PlanKey): Plan => PLANS.find(p => p.key === key) ?? (key === 'seat' ? SEAT : PLANS[PLANS.length - 1]);

export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'trialing';

interface Invoice {
  id: string;
  /** ISO date */
  date: string;
  plan: PlanKey;
  amount: number;
  status: 'paid' | 'open' | 'void';
}

interface Billing {
  plan: PlanKey;
  status: SubscriptionStatus;
  /** ISO date: the next charge, or the end of a cancelled term */
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

/** The sample: on Desk for four months, renewing in a month, a Visa on file */
const SAMPLE_BILLING: Billing = {
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

/** A plan switch: Checkout (up) or the Portal (down) when live; the sample just moves */
export function setPlan(plan: PlanKey): void {
  billing = { ...billing, plan, status: 'active' };
  try {
    localStorage.setItem(KEY, JSON.stringify({ plan: billing.plan, status: billing.status, renewsOn: billing.renewsOn, card: billing.card }));
  } catch {
    /* storage off: the choice lives for the session */
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

/* ---- live calls (Stripe through the project's functions) ---- */

type BillingOutcome = { ok: true } | { ok: false; why: string };

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

/** Checkout: the browser leaves for Stripe (or the portal when a plan already stands) */
/** the publishable key, made for pages; the secret key stays in the functions' secrets */
export const STRIPE_PUBLISHABLE_KEY: string | undefined = import.meta.env?.VITE_STRIPE_PUBLISHABLE_KEY;

export type CheckoutMade =
  | { ok: true; kind: 'mount'; clientSecret: string }
  | { ok: true; kind: 'portal'; url: string }
  /** already on a plan and asking for a higher one: what the card pays today, and when the new price starts */
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

/** A client secret for /checkout to mount Stripe's framed fields (the card never reaches us). An upgrade gets its
    figures instead (confirmUpgrade applies it); the same or a lower plan gets the portal. */
async function makeCheckout(plan: PlanKey, period: Period): Promise<CheckoutMade> {
  if (!supabase || !BILLING_ON) return { ok: false, why: 'Billing is not switched on yet.' };
  const { data, error } = await supabase.functions.invoke<CheckoutAnswer>('stripe-checkout', { body: { plan, period } });
  if (error) return { ok: false, why: await whyOf(error) };
  return read(data);
}

/** The upgrade: the plan moves now and the card pays the prorated difference */
export async function confirmUpgrade(plan: PlanKey, period: Period): Promise<CheckoutMade> {
  if (!supabase || !BILLING_ON) return { ok: false, why: 'Billing is not switched on yet.' };
  const { data, error } = await supabase.functions.invoke<CheckoutAnswer>('stripe-checkout', { body: { plan, period, confirm: true } });
  if (error) return { ok: false, why: await whyOf(error) };
  return read(data);
}

/* a signed-in press on a plan starts the checkout session before the page opens, and the page reuses that answer */
let ahead: { plan: PlanKey; period: Period; made: Promise<CheckoutMade> } | null = null;
export const makeCheckoutAhead = (plan: PlanKey, period: Period): void => {
  ahead = { plan, period, made: makeCheckout(plan, period) };
};
/** the session made ahead for this plan and period, if waiting; else made now */
export const takeCheckout = (plan: PlanKey, period: Period): Promise<CheckoutMade> => {
  const a = ahead;
  ahead = null;
  return a && a.plan === plan && a.period === period ? a.made : makeCheckout(plan, period);
};

/** The customer portal: card, invoices, plan changes, cancelling */
export async function openPortal(): Promise<BillingOutcome> {
  if (!supabase || !BILLING_ON) return { ok: false, why: 'Billing is not switched on yet.' };
  const { data, error } = await supabase.functions.invoke<{ url?: string; error?: string }>('stripe-portal', { body: {} });
  if (error) return { ok: false, why: await whyOf(error) };
  if (!data?.url) return { ok: false, why: data?.error ?? 'Billing did not answer.' };
  window.location.assign(data.url);
  return { ok: true };
}
