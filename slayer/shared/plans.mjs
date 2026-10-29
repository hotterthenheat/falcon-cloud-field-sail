/*
  Plan entitlements, shared by the browser's gates (src/data/access.ts) and the data proxies (server/).
  A plan opens its own rooms and every room of a lower rank; an owner holds 'seat', the top rank.
*/

/** @type {Record<'book'|'tape'|'desk'|'seat', number>} */
export const PLAN_RANK = { book: 1, tape: 2, desk: 3, seat: 4 };

/** Each room and the lowest plan that opens it, matched by the longest path prefix. */
export const ROOM_PLAN = [
  ['/pulse', 'book'],
  ['/terrain', 'book'],
  ['/pinpoint', 'book'],
  ['/trace', 'tape'],
  ['/dossier', 'tape'],
  ['/compass', 'desk'],
  ['/weigher', 'desk'],
  ['/practice', 'desk'],
  ['/community', 'desk'],
];

/** The lowest plan whose rooms read each feed: Book's rooms (Pulse, Terrain, Pinpoint) already read both. */
export const FEED_PLAN = { uw: 'book', theta: 'book' };

const PLANS = new Set(Object.keys(PLAN_RANK));
export const isPlan = (v) => typeof v === 'string' && PLANS.has(v);

export function planFor(pathname) {
  let best = null;
  for (const r of ROOM_PLAN) {
    if (pathname !== r[0] && !pathname.startsWith(`${r[0]}/`)) continue;
    if (!best || r[0].length > best[0].length) best = r;
  }
  return best ? best[1] : null;
}

/** A complimentary plan stands until grantUntil passes. */
export function grantHeld(p, now = Date.now()) {
  if (!p || !isPlan(p.grantPlan)) return null;
  if (p.grantUntil && Date.parse(p.grantUntil) <= now) return null;
  return p.grantPlan;
}

/**
 * The plan a profile holds: the higher of a standing paid plan (active or trialing) and a live grant.
 * An owner holds 'seat' unless viewing as a lower plan ('none' views as no plan).
 */
export function planHeld(p, view = 'self', now = Date.now()) {
  if (!p) return null;
  if (p.role === 'owner') return view === 'self' ? 'seat' : view === 'none' ? null : view;
  const paid = isPlan(p.plan) && (p.planStatus === 'active' || p.planStatus === 'trialing') ? p.plan : null;
  const given = grantHeld(p, now);
  if (paid && given) return PLAN_RANK[given] > PLAN_RANK[paid] ? given : paid;
  return paid ?? given;
}

/** Does a held plan open something that needs `needed`? Nothing needed opens to everyone. */
export const opens = (held, needed) => !needed || (!!held && PLAN_RANK[held] >= PLAN_RANK[needed]);
