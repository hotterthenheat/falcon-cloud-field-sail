/*
  A name's card in one request: GET /api/name-card/<T>.

  Terrain's name search (src/components/ui/NameSearchSheet.tsx) reads the name the pointer or the arrow keys rest on:
  its next report, its wire, its insiders' filings and its Congress reports. Asked from the browser that is four /api/uw calls a name, each queued beside the
  pages people are actually reading, on a key that allows three requests in flight for everyone. Here the four are
  composed into one answer from the shared hub (server/uwProxy.mjs uwDirect):

  · the paths are the browser's own spellings (data/earningsFeed.ts, data/liveRecord.ts), so the hub's copy is the
    same one the Dossier's pages and the name's own hooks read — a name someone already opened costs nothing;
  · they travel in the hub's background lane ('record'), so a page's first paint always takes a slot first, any copy
    younger than READ_MAX_AGE_MS is reused, and a hover never marks a name "opened today" (no day pins, no refreshes
    kept warm on a hover's account);
  · the composed card is kept for MEMO_MS (three minutes) and one in flight per name is shared, so a thousand viewers resting on NVDA
    cost one compose every three minutes and, past it, one vendor read per table per its freshness.

  Behind the same gate as /api/uw (server/auth.mjs). Each table carries the vendor's status; a table the hub could not
  read is null and the browser says so in its slot (it does not ask again on its own).
*/

import { gate, sendDenied } from './auth.mjs';

export const CARD_TABLES = /** @type {const} */ (['earnings', 'news', 'insiders', 'congress']);
/** A composed card stands this long before its tables are looked at again */
export const MEMO_MS = 3 * 60_000;
/** The hub's copy of a table is reused up to this old (the route class's freshness is 5 minutes in the session) */
export const READ_MAX_AGE_MS = 10 * 60_000;
const SYM = /^[A-Z][A-Z0-9.]{0,9}$/;

/** The browser's own paths for a name's four tables — one spelling, so the hub's copy is shared with the pages */
export function cardPath(table, t) {
  const T = encodeURIComponent(t);
  if (table === 'earnings') return `/earnings/${T}`;
  if (table === 'news') return `/news/headlines?ticker=${T}&limit=50&page=0`;
  if (table === 'insiders') return `/insider/transactions?ticker_symbol=${T}`;
  return `/congress/recent-trades?ticker=${T}&limit=200`;
}

/** The vendor's body as rows: its `data` envelope opened (data/whales.ts reads it the same way); null when not a list */
export function rowsOfBody(body) {
  let parsed = null;
  try {
    parsed = body ? JSON.parse(body) : null;
  } catch {
    return null;
  }
  const data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'data' in parsed ? parsed.data : parsed;
  return Array.isArray(data) ? data : null;
}

/**
 * The card keeper: `read(path, opt)` is the hub (uwDirect), injected so the proof can count.
 * @param {{ read: (path: string, opt?: { lane?: 'viewer' | 'record'; maxAge?: number }) => Promise<{ status: number; body: string; at: number }>, now?: () => number, memoMs?: number }} o
 */
export function createNameCard(o) {
  const now = o.now ?? Date.now;
  const memoMs = o.memoMs ?? MEMO_MS;
  const memo = new Map();
  const building = new Map();
  const stats = { asked: 0, memo: 0, joined: 0, composed: 0, reads: 0 };

  async function compose(t) {
    const got = await Promise.all(
      CARD_TABLES.map(async (table) => {
        stats.reads += 1;
        try {
          const r = await o.read(cardPath(table, t), { lane: 'record', maxAge: READ_MAX_AGE_MS });
          const rows = r.status === 200 ? rowsOfBody(r.body) : null;
          return [table, { status: rows ? r.status : r.status || 0, rows, at: rows ? r.at : null }];
        } catch {
          return [table, { status: 0, rows: null, at: null }];
        }
      }),
    );
    const card = { ticker: t, at: now(), tables: Object.fromEntries(got) };
    memo.set(t, card);
    /* a desk rests on a few hundred names a day at most */
    if (memo.size > 600) memo.delete(memo.keys().next().value);
    stats.composed += 1;
    return card;
  }

  /** The card for a symbol: the memo, the compose already in flight, or a new one */
  async function ask(sym) {
    stats.asked += 1;
    const t = String(sym || '').trim().toUpperCase();
    if (!SYM.test(t)) return null;
    const had = memo.get(t);
    if (had && now() - had.at < memoMs) {
      stats.memo += 1;
      return had;
    }
    let p = building.get(t);
    if (p) stats.joined += 1;
    else {
      p = compose(t).finally(() => building.delete(t));
      building.set(t, p);
    }
    return p;
  }

  return { ask, stats: () => ({ ...stats, kept: memo.size }) };
}

let shared = null;
async function keeper() {
  if (shared) return shared;
  const { uwDirect } = await import('./uwProxy.mjs');
  shared = createNameCard({ read: uwDirect });
  return shared;
}

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
};

/** GET /api/name-card/<T> (mounted at /api/name-card, or the whole URL on Vercel) */
export async function proxyNameCard(req, res, k) {
  if (req.method !== 'GET') {
    send(res, 405, { error: 'method not allowed' });
    return;
  }
  const url = new URL(req.url || '/', 'http://x');
  const sym = decodeURIComponent(url.pathname.replace(/^\/api\/name-card/, '').replace(/^\/+|\/+$/g, '')).toUpperCase();
  if (!SYM.test(sym)) {
    send(res, 404, { error: 'not found' });
    return;
  }
  const verdict = await gate(req, 'uw');
  if (!verdict.ok) {
    sendDenied(res, verdict);
    return;
  }
  if (!k && !process.env.UNUSUAL_WHALES_API_KEY) {
    send(res, 503, { error: 'the flow feed is not configured', code: 'feed_unconfigured' });
    return;
  }
  try {
    const card = await (k ?? (await keeper())).ask(sym);
    if (!card) send(res, 404, { error: 'not found' });
    else send(res, 200, card);
  } catch {
    send(res, 502, { error: 'the name card did not compose', code: 'card_failed' });
  }
}

/** For the load check: the keeper's counts so far */
export const nameCardStats = () => (shared ? shared.stats() : null);
