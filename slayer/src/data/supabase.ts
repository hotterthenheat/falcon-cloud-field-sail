/*
==================================================
  SLAYER TERMINAL - THE ACCOUNT SERVICE'S CLIENT (data/supabase.ts)

  One Supabase client for the browser (2026-10-03,
  Noah: "do auth right now"). It reads the project's
  address and PUBLISHABLE key from the environment
  (.env.local, never committed; .env.example shows
  the names). The publishable key is made for the
  browser — every row it can reach is governed by
  the database's own row-level policies
  (supabase/migrations). The SERVICE ROLE key never
  comes near this file, a VITE_ variable, or the
  repo.

  Without the two variables the terminal runs as it
  always has — the Account page is the preview on
  the sample profile — so the photographer, the
  checks and a clone without keys still open.
==================================================
*/

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PHOTO } from '../embed';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/** The account service is configured on this build — and NOT in the photographer's window (embed.ts PHOTO): a film or a
    still shows the sample account at the rail's foot, as every picture of the terminal has, never a "Sign in" door */
export const ACCOUNTS_ON: boolean = !!(url && key) && !PHOTO;

/** THE SERVICE'S OWN SETTINGS, public by design (`/auth/v1/settings`): which sign-in providers the project has switched
    on, among other things — read once so the sign-in page shows only the doors that open (2026-10-10: the Google door
    pressed before Google was switched on in the project landed the browser on the service's raw error page). Null when
    the accounts are off or the service cannot be reached. */
export async function fetchAuthSettings(): Promise<{ external?: Record<string, boolean> } | null> {
  if (!ACCOUNTS_ON) return null;
  try {
    const r = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key!, Authorization: `Bearer ${key!}` } });
    if (!r.ok) return null;
    return (await r.json()) as { external?: Record<string, boolean> };
  } catch {
    return null;
  }
}

export const supabase: SupabaseClient | null = ACCOUNTS_ON
  ? createClient(url!, key!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        /* a confirmation or password-reset link lands back on the site with the session in the address: the client
           reads it and the page carries on signed in */
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  : null;
