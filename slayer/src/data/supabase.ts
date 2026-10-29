/*
  The browser's Supabase client. It uses the project URL and the publishable key (row-level security governs what
  that key reaches); the service-role key never comes near the browser. Without both variables, or in the landing's
  photographer window (embed.ts PHOTO), accounts are off and the client is null. Under Node (tsx proof scripts)
  import.meta.env is absent, which reads as accounts off.
*/

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PHOTO } from '../embed';

const env: Record<string, string | undefined> = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const ACCOUNTS_ON: boolean = !!(url && key) && !PHOTO;

/** The project's public auth settings (which sign-in providers are on), so the sign-in page shows only working doors.
    Null when accounts are off or the service cannot be reached. */
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
        /* confirmation and password-reset links land with the session in the address */
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  : null;
