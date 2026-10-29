/*
  Data for the admin People room: every account as the database gives it to an owner (the row plus last sign-in,
  confirmation and providers), and one change call that carries its reason so the audit log always has the why.
  The rules are the database's (supabase/migrations: admin_people, roles_grants). Without accounts it shows a sample.
*/

import { supabase } from './supabase';
import type { AccountPlan, GrantPlan, PlanStatus, Role } from './account';

export type PersonStatus = 'active' | 'unconfirmed' | 'banned' | 'new';

export interface Person {
  id: string;
  email: string;
  name: string;
  handle: string | null;
  avatar: string | null;
  role: Role;
  plan: AccountPlan;
  bannedUntil: string | null;
  createdAt: string;
  updatedAt: string;
  lastSignInAt: string | null;
  emailConfirmedAt: string | null;
  /** the ways in: 'email', 'google', 'apple' */
  providers: string[];
  /** the plan's standing, from Stripe */
  planStatus: PlanStatus;
  planPeriod: 'month' | 'year' | null;
  planRenewsOn: string | null;
  hasBilling: boolean;
  /** A grant: the plan given, until when, and why; beta opens walled rooms */
  grantPlan: GrantPlan | null;
  grantUntil: string | null;
  grantNote: string | null;
  beta: boolean;
}

export interface LogRow {
  id: number;
  at: string;
  /** the owner who made the change — null when the dashboard did */
  actor: string | null;
  subject: string;
  field: 'plan' | 'plan_status' | 'role' | 'banned_until' | 'grant_plan' | 'grant_until' | 'beta' | string;
  old: string | null;
  new: string | null;
  note: string | null;
}

type Outcome = { ok: true } | { ok: false; why: string };

/** What a person's row amounts to, in one of four words */
export const statusOf = (p: Person, now = Date.now()): PersonStatus => {
  if (p.bannedUntil && new Date(p.bannedUntil).getTime() > now) return 'banned';
  if (!p.emailConfirmedAt) return 'unconfirmed';
  if (now - new Date(p.createdAt).getTime() < 24 * 3600 * 1000) return 'new';
  return 'active';
};

export const STATUS_WORD: Record<PersonStatus, string> = { active: 'active', unconfirmed: 'unconfirmed', banned: 'banned', new: 'new today' };

/** How long ago, in a reader's words — 'never' for nothing */
export const ago = (iso: string | null, now = Date.now()): string => {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d > 300 ? 'numeric' : undefined });
};

/** The reason a call was refused, in plain words */
const plainWhy = (message: string): string => {
  const m = message.toLowerCase();
  if (m.includes('owners only')) return 'Owners only.';
  if (m.includes('the last owner stays')) return 'The last owner stays — make someone else an owner first.';
  if (m.includes('cannot ban yourself')) return 'You cannot ban yourself.';
  if (m.includes('a reason is needed')) return 'Say why, in a line.';
  if (m.includes('no such person')) return 'That account is gone.';
  if (m.includes('profiles_plan_check')) return 'That is not a plan.';
  if (m.includes('profiles_role_check')) return 'That is not a role.';
  if (m.includes('profiles_grant_plan_check')) return 'That is not a plan that can be given.';
  if (m.includes('owners and the team only')) return 'Owners and the team only.';
  if (m.includes('fetch') || m.includes('network')) return 'Could not reach the account service.';
  return message.charAt(0).toUpperCase() + message.slice(1);
};

interface PeopleRow {
  id: string;
  email: string;
  name: string;
  handle: string | null;
  avatar: string | null;
  role: Role;
  plan: AccountPlan;
  banned_until: string | null;
  created_at: string;
  updated_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  providers: string[] | null;
  plan_status: PlanStatus | null;
  plan_period: 'month' | 'year' | null;
  plan_renews_on: string | null;
  stripe_customer_id: string | null;
  grant_plan: GrantPlan | null;
  grant_until: string | null;
  grant_note: string | null;
  beta: boolean | null;
}

const personOf = (r: PeopleRow): Person => ({
  id: r.id,
  email: r.email,
  name: r.name,
  handle: r.handle,
  avatar: r.avatar,
  role: r.role,
  plan: r.plan,
  bannedUntil: r.banned_until,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  lastSignInAt: r.last_sign_in_at,
  emailConfirmedAt: r.email_confirmed_at,
  providers: r.providers ?? [],
  planStatus: r.plan_status ?? 'none',
  planPeriod: r.plan_period,
  planRenewsOn: r.plan_renews_on,
  hasBilling: !!r.stripe_customer_id,
  grantPlan: r.grant_plan ?? null,
  grantUntil: r.grant_until ?? null,
  grantNote: r.grant_note ?? null,
  beta: !!r.beta,
});

/** Every account, newest first (owners and the team; the database refuses anyone else) */
export async function loadPeople(): Promise<{ people: Person[]; why: string | null }> {
  if (!supabase) return { people: SAMPLE_PEOPLE, why: null };
  const { data, error } = await supabase.rpc('admin_people');
  if (error) return { people: [], why: plainWhy(error.message) };
  return { people: ((data ?? []) as PeopleRow[]).map(personOf), why: null };
}

/** The log, newest first — everyone's, or one person's */
export async function loadLog(limit = 100, subject?: string): Promise<LogRow[]> {
  if (!supabase) return subject ? SAMPLE_LOG.filter(l => l.subject === subject) : SAMPLE_LOG;
  let q = supabase.from('audit_log').select('id,at,actor,subject,field,old,new,note').order('at', { ascending: false }).limit(limit);
  if (subject) q = q.eq('subject', subject);
  const { data, error } = await q;
  if (error) return [];
  return (data ?? []) as LogRow[];
}

export interface AdminPatch {
  plan?: AccountPlan;
  role?: Role;
  /** an ISO instant, or null to lift the ban */
  banned_until?: string | null;
  /** a plan given, or null to take the grant back (its end and note go with it) */
  grant_plan?: GrantPlan | null;
  /** an ISO instant — the database sets ten years out when a grant comes without one */
  grant_until?: string | null;
  grant_note?: string | null;
  beta?: boolean;
}

/** The one change call: a patch and its reason together */
export async function adminUpdate(subject: string, patch: AdminPatch, note: string): Promise<Outcome> {
  if (!supabase) return { ok: true };
  const body: Record<string, string> = {};
  if (patch.plan !== undefined) body.plan = patch.plan;
  if (patch.role !== undefined) body.role = patch.role;
  if (patch.banned_until !== undefined) body.banned_until = patch.banned_until ?? '';
  if (patch.grant_plan !== undefined) body.grant_plan = patch.grant_plan ?? '';
  if (patch.grant_until !== undefined) body.grant_until = patch.grant_until ?? '';
  if (patch.grant_note !== undefined) body.grant_note = patch.grant_note ?? '';
  if (patch.beta !== undefined) body.beta = patch.beta ? 'true' : 'false';
  const { error } = await supabase.rpc('admin_update', { subject, patch: body, note });
  return error ? { ok: false, why: plainWhy(error.message) } : { ok: true };
}

/* ---- sample, for a build without the account service ---- */

const day = 24 * 3600 * 1000;
const at = (daysAgo: number, hours = 0): string => new Date(Date.now() - daysAgo * day - hours * 3600 * 1000).toISOString();
const sample = (n: number, p: Partial<Person> & { email: string; name: string }): Person => ({
  id: `sample-${n}`,
  handle: p.email.split('@')[0] ?? null,
  avatar: null,
  role: 'member',
  plan: 'none',
  bannedUntil: null,
  createdAt: at(30 - n),
  updatedAt: at(1),
  lastSignInAt: at(0, n),
  emailConfirmedAt: at(30 - n),
  providers: ['email'],
  planStatus: p.plan && p.plan !== 'none' ? 'active' : 'none',
  planPeriod: p.plan && p.plan !== 'none' ? 'month' : null,
  planRenewsOn: p.plan && p.plan !== 'none' ? at(-20) : null,
  hasBilling: !!p.plan && p.plan !== 'none',
  grantPlan: null,
  grantUntil: null,
  grantNote: null,
  beta: false,
  ...p,
});

const SAMPLE_PEOPLE: Person[] = [
  sample(1, { email: 'noah@slayerterminal.com', name: 'Noah', role: 'owner', plan: 'desk', providers: ['email', 'google'], createdAt: at(31) }),
  sample(2, { email: 'mo@slayerterminal.com', name: 'Mo', role: 'owner', plan: 'desk', createdAt: at(31) }),
  sample(3, { email: 'r.okafor@gmail.com', name: 'Rina Okafor', plan: 'tape', providers: ['google'] }),
  sample(4, { email: 'dstrand@proton.me', name: 'Daniel Strand', plan: 'book' }),
  sample(5, { email: 'jmerrick@outlook.com', name: 'Jo Merrick', plan: 'desk', bannedUntil: at(-14), lastSignInAt: at(6) }),
  sample(6, { email: 'ty.walsh@icloud.com', name: 'Ty Walsh', emailConfirmedAt: null, lastSignInAt: null, createdAt: at(0, 3) }),
  sample(7, { email: 'priya.n@gmail.com', name: 'Priya N', plan: 'tape', providers: ['google'], createdAt: at(0, 9), beta: true }),
  sample(8, { email: 'hal@fastmail.com', name: 'Hal', lastSignInAt: at(21) }),
  sample(9, { email: 'k.aldana@gmail.com', name: 'Kai Aldana', providers: ['google'], grantPlan: 'desk', grantUntil: at(-3652), grantNote: 'Tested the book every morning for a month', beta: true }),
  sample(10, { email: 'sam@slayerterminal.com', name: 'Sam', role: 'team', createdAt: at(12) }),
];

const SAMPLE_LOG: LogRow[] = [
  { id: 9, at: at(0, 1), actor: 'sample-1', subject: 'sample-9', field: 'grant_until', old: null, new: at(-3652), note: 'Tested the book every morning for a month' },
  { id: 8, at: at(0, 1), actor: 'sample-1', subject: 'sample-9', field: 'grant_plan', old: null, new: 'desk', note: 'Tested the book every morning for a month' },
  { id: 5, at: at(0, 2), actor: 'sample-1', subject: 'sample-5', field: 'banned_until', old: null, new: at(-14), note: 'Shared screenshots of the book with the mark cropped out' },
  { id: 4, at: at(1), actor: 'sample-2', subject: 'sample-3', field: 'plan', old: 'book', new: 'tape', note: 'Paid the difference by hand — Stripe is not up yet' },
  { id: 7, at: at(2), actor: 'sample-2', subject: 'sample-10', field: 'role', old: 'member', new: 'team', note: 'Answers the support inbox' },
  { id: 3, at: at(3), actor: 'sample-1', subject: 'sample-4', field: 'plan', old: 'none', new: 'book', note: 'First month on the house' },
  { id: 6, at: at(4), actor: 'sample-1', subject: 'sample-7', field: 'beta', old: 'false', new: 'true', note: 'Asked to see the room early' },
  { id: 2, at: at(30), actor: null, subject: 'sample-2', field: 'role', old: 'member', new: 'owner', note: null },
  { id: 1, at: at(30), actor: null, subject: 'sample-1', field: 'role', old: 'member', new: 'owner', note: null },
];
