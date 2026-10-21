/*
  SLAYER TERMINAL - STRIPE'S SCRIPT, ONCE (data/stripeLoader.ts)

  The checkout page mounts Stripe's framed fields with Stripe's own script. Fetched once, from wherever asks first: the
  landing's pricing section asks ahead of time while the reader is still looking at the prices, so the checkout page
  finds it already here (Noah, 2026-10-10: "why does it take forever for stripe to load"); the page itself asks if
  nobody did. The browser holds only the publishable key.
*/
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { STRIPE_PUBLISHABLE_KEY } from './billing';

let loading: Promise<Stripe | null> | null = null;

export const stripeLoader = (): Promise<Stripe | null> => (loading ??= STRIPE_PUBLISHABLE_KEY ? loadStripe(STRIPE_PUBLISHABLE_KEY) : Promise.resolve(null));
