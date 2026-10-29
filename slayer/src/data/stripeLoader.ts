/*
  Loads Stripe's script once, for whoever asks first: the landing's pricing asks ahead so /checkout finds it ready.
  The browser holds only the publishable key.
*/
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { STRIPE_PUBLISHABLE_KEY } from './billing';

let loading: Promise<Stripe | null> | null = null;

export const stripeLoader = (): Promise<Stripe | null> => (loading ??= STRIPE_PUBLISHABLE_KEY ? loadStripe(STRIPE_PUBLISHABLE_KEY) : Promise.resolve(null));
