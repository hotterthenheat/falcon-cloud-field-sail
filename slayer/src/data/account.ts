/*
==================================================
  SLAYER TERMINAL - THE ACCOUNT (data/account.ts)

  Who is signed in, and the doors in and out
  (2026-10-03, the first cut of auth at Noah's
  word: email and password on Supabase Auth; the
  terminal stays open while signed out until
  billing exists). One store the shell and the
  Account page read:

    status     off — no account service on this
                     build (the preview stays)
               loading — asking whether a session
                     is kept
               out · in
    user       the signed-in person's id and email
    profile    their row in `profiles` — name,
               handle, picture, ROLE (owner · team ·
               member), plan, a ban, and since
               2026-10-17 A GRANT (a plan given, until
               a date) and the BETA door — the shape
               the admin rooms read
    recovering they arrived from a password-reset
               link: the page asks for the new one

  While someone is signed in THE TERMINAL'S OWN
  PROFILE STORE (data/profile.ts — the rail's foot,
  the room's ME, the Account rows) mirrors the
  account's row, and a change saved there is
  written back to the row (the sink), so nothing
  that reads the profile had to learn about auth.

  The database decides what a row may do
  (supabase/migrations/…_profiles.sql): a member
  reads and edits their own row and cannot touch
  role, plan or the ban; an owner reads all. This
  file never pretends otherwise.
==================================================
*/

import { useSyncExternalStore } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { ACCOUNTS_ON, fetchAuthSettings, supabase } from './supabase';
import { onProfileSaved, readAvatar, SAMPLE_PROFILE, setProfile, type Profile } from './profile';
import { clearCarried, flushSync, settleSync, syncAfterSignIn } from './sync';

export type AccountStatus = 'off' | 'loading' | 'out' | 'in';
/** ROLES (2026-10-17): who someone is to the company — an owner runs the terminal, the team reads People and the log
    and changes nothing, a member is a trader. What they can SEE is the plan's business, not the role's. */
export type Role = 'owner' | 'team' | 'member';
/** a plan that can be given — every sold plan */
export type GrantPlan = Exclude<AccountPlan, 'none'>;
export type AccountPlan = 'none' | 'book' | 'tape' | 'desk' | 'seat';

export interface AccountProfile {
  id: string;
  email: string;
  name: string;
  handle: string | null;
  /** a small data URL (data/profile.ts readAvatar), or none */
  avatar: string | null;
  role: Role;
  plan: AccountPlan;
  /** set by an owner; the app reads it to say so plainly */
  bannedUntil: string | null;
  /** THE PLAN'S STANDING, from Stripe (2026-10-10): none until a payment lands; then Stripe's own word */
  planStatus: PlanStatus;
  planPeriod: 'month' | 'year' | null;
  /** when the plan renews — or, cancelled, when it ends */
  planRenewsOn: string | null;
  /** a Stripe customer exists for this person (the portal opens) */
  hasBilling: boolean;
  /** THE GRANT (2026-10-17): a complimentary plan given by an owner — "legacy" — and when it ends; the gates read the
      higher of this and anything paid while the end has not passed; the Account page says "with our thanks" */
  grantPlan: GrantPlan | null;
  grantUntil: string | null;
  grantNote: string | null;
  /** opens rooms still behind the coming-soon wall for this person */
  beta: boolean;
}
export type PlanStatus = 'none' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' | 'incomplete_expired' | 'paused';

export interface AccountState {
  status: AccountStatus;
  user: { id: string; email: string } | null;
  profile: AccountProfile | null;
  recovering: boolean;
}

export type Outcome = { ok: true } | { ok: false; why: string };
/** the two sign-ins beside the password (the sign-in page's doors); each is switched on in the project's dashboard */
export type Provider = 'google' | 'apple';

let state: AccountState = { status: ACCOUNTS_ON ? 'loading' : 'off', user: null, profile: null, recovering: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<AccountState>): void => {
  state = { ...state, ...patch };
  listeners.forEach(fn => fn());
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export const useAccount = (): AccountState => useSyncExternalStore(subscribe, () => state, () => state);
export const readAccount = (): AccountState => state;

/* ---- the row ------------------------------------------------------------------ */

interface Row {
  id: string;
  email: string;
  name: string;
  handle: string | null;
  avatar: string | null;
  role: Role;
  plan: AccountPlan;
  banned_until: string | null;
  plan_status: PlanStatus | null;
  plan_period: 'month' | 'year' | null;
  plan_renews_on: string | null;
  stripe_customer_id: string | null;
  grant_plan: GrantPlan | null;
  grant_until: string | null;
  grant_note: string | null;
  beta: boolean | null;
}
const COLUMNS = 'id,email,name,handle,avatar,role,plan,banned_until,plan_status,plan_period,plan_renews_on,stripe_customer_id,grant_plan,grant_until,grant_note,beta';

const nameFromEmail = (email: string): string => email.split('@')[0] ?? 'Trader';
const handleFromEmail = (email: string): string => (email.split('@')[0] ?? 'trader').toLowerCase().replace(/[^a-z0-9_]/g, '') || 'trader';
const thisMachine = (): string => {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : 'This machine';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${os} · ${browser}`;
};

/** the mirror is writing the profile store itself — the sink must not echo it back to the row */
let mirroring = false;

const mirror = (p: AccountProfile): void => {
  mirroring = true;
  try {
    setProfile({
      name: p.name || nameFromEmail(p.email),
      handle: p.handle ?? handleFromEmail(p.email),
      email: p.email,
      avatar: p.avatar,
      signIn: 'email',
      devices: [{ id: 'this', name: thisMachine(), lastSeen: 'now', thisOne: true }],
    });
  } finally {
    mirroring = false;
  }
};

const loadProfile = async (user: User): Promise<void> => {
  if (!supabase) return;
  const { data, error } = await supabase.from('profiles').select(COLUMNS).eq('id', user.id).maybeSingle();
  if (error) console.warn('[account] the profile row:', error.message);
  const row = data as Row | null;
  const fallbackName = typeof user.user_metadata?.name === 'string' ? (user.user_metadata.name as string) : '';
  const profile: AccountProfile = row
    ? {
        id: row.id,
        email: row.email,
        name: row.name,
        handle: row.handle,
        avatar: row.avatar,
        role: row.role,
        plan: row.plan,
        bannedUntil: row.banned_until,
        planStatus: row.plan_status ?? 'none',
        planPeriod: row.plan_period,
        planRenewsOn: row.plan_renews_on,
        hasBilling: !!row.stripe_customer_id,
        grantPlan: row.grant_plan ?? null,
        grantUntil: row.grant_until ?? null,
        grantNote: row.grant_note ?? null,
        beta: !!row.beta,
      }
    : { id: user.id, email: user.email ?? '', name: fallbackName, handle: null, avatar: null, role: 'member', plan: 'none', bannedUntil: null, planStatus: 'none', planPeriod: null, planRenewsOn: null, hasBilling: false, grantPlan: null, grantUntil: null, grantNote: null, beta: false };
  /* the session may have ended while the row travelled */
  if (state.user?.id !== user.id) return;
  set({ profile });
  mirror(profile);
  if (profile.avatar && /^https?:\/\//.test(profile.avatar)) void keepProviderPicture(user.id, profile.avatar);
};

/* THE PROVIDER'S PICTURE IS COPIED IN (Noah, 2026-10-14, a bare ring on the Account page: "what happened to our
   icon??"): the row held Google's picture as a URL (the sign-in's, supabase/migrations/20261011_avatar_from_provider.sql),
   and Google's picture host rate-limits a site that keeps asking for it — a 429 with an HTML page the browser then refuses
   as an image, so the rail and the Account page drew nothing. Once, while the row holds a URL: the picture is fetched
   with CORS (the host allows any origin), cropped to the house's 128px data URL (profile.ts readAvatar, the drop's own
   path) and saved — the store's sink writes the row — so no page asks Google for it again. A fetch that fails leaves the
   URL; the mark falls back to the initials meanwhile (ui/Avatar). */
const inlining = new Set<string>();
async function keepProviderPicture(userId: string, url: string): Promise<void> {
  if (inlining.has(url)) return;
  inlining.add(url);
  try {
    const res = await fetch(url, { mode: 'cors', referrerPolicy: 'no-referrer' });
    if (!res.ok) return;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return;
    const data = await readAvatar(new File([blob], 'picture', { type: blob.type }));
    if (state.user?.id !== userId || state.profile?.avatar !== url) return;
    setProfile({ avatar: data });
  } catch {
    /* the host said no — the URL stays, the initials stand in */
  }
}

/** The row read again — after Stripe has spoken (the Billing page, back from checkout) */
export async function reloadProfile(): Promise<void> {
  if (!supabase) return;
  const { data } = await supabase.auth.getUser();
  if (data.user) await loadProfile(data.user);
}

const STANDING = new Set<PlanStatus>(['active', 'trialing', 'past_due']);
/** AFTER A PURCHASE (2026-10-10): Stripe's word lands on the row a breath after the card clears — the row is read again
    every two seconds until the plan stands (or twelve tries), so the rail and Billing show it without a reload */
export function settleAfterPurchase(): void {
  let tries = 0;
  const tick = async () => {
    await reloadProfile();
    const p = state.profile;
    if ((p && p.plan !== 'none' && STANDING.has(p.planStatus)) || ++tries >= 12) return;
    window.setTimeout(tick, 2000);
  };
  void tick();
}

const onSession = (session: Session | null): void => {
  if (!session?.user) {
    set({ status: 'out', user: null, profile: null });
    return;
  }
  const user = session.user;
  set({ status: 'in', user: { id: user.id, email: user.email ?? '' } });
  /* never await another call inside the auth callback (the client's own rule) — the row is read on the next tick */
  window.setTimeout(() => void loadProfile(user), 0);
};

if (supabase) {
  const client = supabase;
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') set({ recovering: true });
    if (event === 'SIGNED_OUT') {
      set({ status: 'out', user: null, profile: null, recovering: false });
      return;
    }
    /* A FRESH SIGN-IN on a page already running (not the session found at boot, not the SIGNED_IN the client repeats
       when a tab comes back): the account's stores are pulled, and the page reloads once if anything landed
       (data/sync.ts) — never awaited inside the callback, the client's rule */
    const fresh = event === 'SIGNED_IN' && state.status !== 'in' && !!session?.user;
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') onSession(session);
    if (session?.user) {
      const id = session.user.id;
      /* the session found at boot (its pull ran before the stores read their keys): what the stores wrote since goes
         up; a fresh sign-in pulls first, then settles */
      window.setTimeout(() => (fresh ? void syncAfterSignIn(id) : settleSync(id)), 0);
    }
  });
  /* THE SINK: a change saved to the terminal's profile store while signed in is written to the row — name, handle and
     picture; the email moves only through the account service's own confirmation */
  onProfileSaved((patch: Partial<Profile>) => {
    if (mirroring || state.status !== 'in' || !state.user) return;
    const row: Partial<Pick<Row, 'name' | 'handle' | 'avatar'>> = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.handle !== undefined) row.handle = patch.handle;
    if (patch.avatar !== undefined) row.avatar = patch.avatar;
    if (!Object.keys(row).length) return;
    void client
      .from('profiles')
      .update(row)
      .eq('id', state.user.id)
      .then(({ error }) => {
        if (error) console.warn('[account] saving the profile:', error.message);
        else if (state.profile) set({ profile: { ...state.profile, ...row } });
      });
  });
}

/* ---- the words for what went wrong -------------------------------------------- */

/** The service's messages, said plainly — never its codes */
export const plainWhy = (message: string): string => {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials') || m.includes('invalid_credentials')) return 'That email and password do not match.';
  if (m.includes('email not confirmed')) return 'Confirm your address first — the link is in your inbox.';
  if (m.includes('already registered') || m.includes('already been registered')) return 'There is already an account with that address. Sign in instead.';
  if (m.includes('password should be') || m.includes('weak password') || m.includes('password is too short')) return 'Choose a longer password — eight characters at least.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many tries. Wait a minute and try again.';
  if (m.includes('unable to validate email') || m.includes('invalid email') || m.includes('is invalid')) return 'That is not an email address.';
  if (m.includes('fetch') || m.includes('network')) return 'Could not reach the account service. Check the connection and try again.';
  if (m.includes('same password') || m.includes('different from the old')) return 'That is the password you already have.';
  return message;
};

const OFF: Outcome = { ok: false, why: 'The account service is not set up on this build.' };
const where = (path: string): string => `${window.location.origin}${path}`;

/* ---- the doors ---------------------------------------------------------------- */

export const MIN_PASSWORD = 8;

/** Create the account. With "confirm email" on in the project, the person has a link to open first — `confirm` says so. */
export async function signUp(email: string, password: string, name: string): Promise<Outcome & { confirm?: boolean }> {
  if (!supabase) return OFF;
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: where('/signin') } });
  if (error) return { ok: false, why: plainWhy(error.message) };
  /* an address that already has an account comes back as a user with no identities, not as an error */
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return { ok: false, why: 'There is already an account with that address. Sign in instead.' };
  return { ok: true, confirm: !data.session };
}

export async function signIn(email: string, password: string): Promise<Outcome> {
  if (!supabase) return OFF;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? { ok: false, why: plainWhy(error.message) } : { ok: true };
}

export async function signOut(): Promise<Outcome> {
  if (!supabase) return OFF;
  /* what this machine changed goes up first; after, it forgets the carried stores — the account keeps them, a shared
     machine starts the next person clean, and the page reloads so every store reads the clean slate (data/sync.ts) */
  await flushSync();
  const { error } = await supabase.auth.signOut();
  if (error) return { ok: false, why: plainWhy(error.message) };
  clearCarried();
  window.setTimeout(() => window.location.reload(), 150);
  /* the rail and the room go back to the placeholder, not to the person who just left */
  mirroring = true;
  try {
    setProfile({ ...SAMPLE_PROFILE });
  } finally {
    mirroring = false;
  }
  return { ok: true };
}

/** THE DOOR OUT FOR GOOD (2026-10-10, Noah: "build the delete account door"): the function (supabase/functions/
    account-delete) checks the typed email is this account's, refuses the last owner, ends the billing on Stripe, then
    deletes the user — the database cascades the profile, the carried stores and the log. Here, after it has: the
    carried stores leave this machine, the dead session is dropped (the server has no user to sign out any more), and
    the caller takes the person to the front page. */
export async function deleteAccount(emailTyped: string): Promise<Outcome> {
  if (!supabase || !state.user) return OFF;
  if (emailTyped.trim().toLowerCase() !== state.user.email.toLowerCase()) return { ok: false, why: 'Type the account’s email exactly to confirm.' };
  const { data, error } = await supabase.functions.invoke<{ deleted?: boolean; error?: string }>('account-delete', { body: { email: emailTyped.trim() } });
  if (error) {
    const e = error as { message?: string; context?: Response };
    try {
      const body = (await e.context?.clone().json()) as { error?: string } | undefined;
      if (body?.error) return { ok: false, why: body.error };
    } catch {
      /* no body to read */
    }
    const m = (e.message ?? '').toLowerCase();
    if (m.includes('fetch') || m.includes('network') || m.includes('failed to send')) return { ok: false, why: 'Could not reach the account service. Check the connection and try again.' };
    return { ok: false, why: e.message ? plainWhy(e.message) : 'The account service did not answer.' };
  }
  if (!data?.deleted) return { ok: false, why: data?.error ?? 'The account service did not answer.' };
  return { ok: true };
}

/** AFTER THE DELETE, the leaving: the carried stores leave this machine, the rail goes back to the placeholder, the dead
    session is dropped (the server has no user to sign out any more — only this machine's copy is left), and the front
    page loads clean. Kept apart from deleteAccount so the page can show "Deleted" for a breath before it goes. */
export async function leaveAfterDelete(): Promise<void> {
  clearCarried();
  mirroring = true;
  try {
    setProfile({ ...SAMPLE_PROFILE });
  } finally {
    mirroring = false;
  }
  if (supabase) await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
  window.location.assign('/');
}

/** A reset link to the inbox; opening it lands on the Account page with `recovering` set */
export async function sendReset(email: string): Promise<Outcome> {
  if (!supabase) return OFF;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: where('/signin') });
  return error ? { ok: false, why: plainWhy(error.message) } : { ok: true };
}

/** Google or Apple: the browser leaves for the provider and comes back to the sign-in page, signed in, which sends it
    on to `next`. A provider not yet switched on in the project's dashboard says so in plain words. */
/** WHICH DOORS OPEN: the providers the project has switched on, asked of the service once a page load (its settings are
    public). When the service cannot say, every door is offered and a press says what the service says. */
let providersAsked: Promise<Record<Provider, boolean>> | null = null;
export function providersOn(): Promise<Record<Provider, boolean>> {
  if (!providersAsked) {
    providersAsked = fetchAuthSettings().then(s => {
      const ext = s?.external;
      return ext ? { google: !!ext.google, apple: !!ext.apple } : { google: true, apple: true };
    });
  }
  return providersAsked;
}

export async function signInWithProvider(provider: Provider, next?: string | null): Promise<Outcome> {
  if (!supabase) return OFF;
  /* a provider the project has not switched on is said here, on our page — the service's answer to the browser is a raw
     error page, not a way back */
  if (!(await providersOn())[provider]) return { ok: false, why: `${provider === 'google' ? 'Google' : 'Apple'} sign-in is not switched on yet.` };
  const back = next && next.startsWith('/') ? `/signin?next=${encodeURIComponent(next)}` : '/signin';
  const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: where(back) } });
  if (!error) return { ok: true };
  const m = error.message.toLowerCase();
  if (m.includes('not enabled') || m.includes('unsupported provider')) return { ok: false, why: `${provider === 'google' ? 'Google' : 'Apple'} sign-in is not switched on yet.` };
  return { ok: false, why: plainWhy(error.message) };
}

export async function setPassword(password: string): Promise<Outcome> {
  if (!supabase) return OFF;
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { ok: false, why: plainWhy(error.message) };
  set({ recovering: false });
  return { ok: true };
}

export const checkPassword = (v: string): string | null => (v.length < MIN_PASSWORD ? `${MIN_PASSWORD} characters at least` : null);
