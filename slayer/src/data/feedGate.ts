/*
  Who may call the paid-data proxies (/api/uw, /api/theta) from this page. Calls are made only while the terminal's
  shell is mounted, and, when accounts are configured, only with a signed-in session whose token rides along.
  The landing and signed-out visitors therefore never reach either proxy; the server enforces the same rules.
*/

import { ACCOUNTS_ON, supabase } from './supabase';

let shellOpen = 0;

/** The terminal's shell is on screen (counted, so a remount never closes the gate early). */
export function openFeeds(): () => void {
  shellOpen += 1;
  return () => {
    shellOpen = Math.max(0, shellOpen - 1);
  };
}

/* the session's token, kept current by the client's own events so a call never waits on storage */
let token: string | null = null;
let expiresAt = 0;
if (supabase) {
  supabase.auth.onAuthStateChange((_event, session) => {
    token = session?.access_token ?? null;
    expiresAt = session?.expires_at ? session.expires_at * 1000 : 0;
  });
}

type FeedHeaders = { ok: true; headers: Record<string, string> } | { ok: false; code: 'closed' | 'signed_out' };

/** The headers a proxy call needs, or why it must not be made. */
export async function feedHeaders(): Promise<FeedHeaders> {
  if (shellOpen === 0) return { ok: false, code: 'closed' };
  if (!ACCOUNTS_ON || !supabase) return { ok: true, headers: {} };
  if (!token || Date.now() > expiresAt - 30_000) {
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token ?? null;
    expiresAt = data.session?.expires_at ? data.session.expires_at * 1000 : 0;
  }
  return token ? { ok: true, headers: { Authorization: `Bearer ${token}` } } : { ok: false, code: 'signed_out' };
}
