/*
  Shared by the edge functions: the Stripe client, CORS, JSON answers, the return origin and plain error words.
*/
import Stripe from 'npm:stripe@17';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export { Stripe };

/* made on first use, after the secret is checked: made at boot without a key it throws and the worker dies */
let client: Stripe | null = null;
export const stripe = (): Stripe => (client ??= new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { httpClient: Stripe.createFetchHttpClient() }));

export const admin = (): SupabaseClient => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const siteUrl = (): string => (Deno.env.get('SITE_URL') ?? 'https://slayerterminal.com').replace(/\/+$/, '');

/** Origins a checkout or portal may return to: SITE_URL, the comma-separated SITE_ORIGINS, and localhost. */
const allowedOrigins = (): Set<string> => {
  const extra = (Deno.env.get('SITE_ORIGINS') ?? '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
  return new Set([siteUrl(), ...extra]);
};

/** Where to send the person back: the asking page's origin when it is one of ours, else SITE_URL. */
export const originOf = (req: Request): string => {
  const o = req.headers.get('origin') ?? '';
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o) || allowedOrigins().has(o)) return o;
  return siteUrl();
};

/** What went wrong, in words a page can show. A refused key is named as such, never shown. */
export const plain = (e: unknown, what = 'Billing'): string => {
  if (e instanceof Stripe.errors.StripeAuthenticationError) return 'Stripe refused our key: the secret key in the dashboard is not right.';
  const m = (e as Error)?.message ?? '';
  return m ? `${what} hit a snag: ${m}` : `${what} hit a snag.`;
};

/** Serves `handle`, turning a throw into a readable JSON 500 with CORS headers. */
export const serve = (name: string, handle: (req: Request) => Promise<Response>, what = 'Billing'): void => {
  Deno.serve(async (req: Request) => {
    try {
      return await handle(req);
    } catch (e) {
      console.error(name, (e as Error)?.message ?? e);
      return json({ error: plain(e, what) }, 500);
    }
  });
};
