/*
  Unusual Whales proxy. The browser calls /api/uw/*; this checks the caller (server/auth.mjs), adds the bearer
  token from UNUSUAL_WHALES_API_KEY and never writes the token back out.
  Every answer goes through the shared hub (server/hub.mjs): one copy per request for all viewers, refreshed in the
  background while anyone watches it, so viewers never multiply the vendor calls. Fresh for 3 s, 15 s or 300 s by
  route class (ttlFor); a page of the past (older_than, an earlier date) for 30 minutes.
*/

import { gate, sendDenied } from './auth.mjs';
import { forwardPath } from './paths.mjs';
import { createHub } from './hub.mjs';

const T = '[A-Za-z0-9.%$_-]{1,32}';
const NAME = '[^/?]{1,80}';

const ALLOWED = [
  /^\/news\/headlines(?:\?|$)/,
  /^\/congress\/recent-trades(?:\?|$)/,
  /^\/congress\/politicians(?:\?|$)/,
  new RegExp(`^\\/congress\\/congress-trader(?:\\?|$)`),
  /^\/congress\/late-reports(?:\?|$)/,
  /^\/politician-portfolios\/disclosures(?:\?|$)/,
  new RegExp(`^\\/politician-portfolios\\/${NAME}(?:\\?|$)`),
  /^\/insider\/transactions(?:\?|$)/,
  new RegExp(`^\\/insider\\/${T}(?:\\?|$)`),
  new RegExp(`^\\/insider\\/${T}\\/ticker-flow(?:\\?|$)`),
  new RegExp(`^\\/insider\\/${NAME}\\/sector-flow(?:\\?|$)`),
  /^\/market\/insider-buy-sells(?:\?|$)/,
  /^\/market\/economic-calendar(?:\?|$)/,
  /^\/market\/fda-calendar(?:\?|$)/,
  /^\/market\/market-tide(?:\?|$)/,
  new RegExp(`^\\/market\\/${NAME}\\/sector-tide(?:\\?|$)`),
  new RegExp(`^\\/market\\/${T}\\/etf-tide(?:\\?|$)`),
  /^\/market\/top-net-impact(?:\?|$)/,
  /^\/net-flow\/expiry(?:\?|$)/,
  new RegExp(`^\\/group-flow\\/${NAME}\\/greek-flow(?:\\?|$)`),
  new RegExp(`^\\/group-flow\\/${NAME}\\/greek-flow\\/${NAME}(?:\\?|$)`),
  /^\/options-pulse\/(?:sectors|top|total)(?:\?|$)/,
  /^\/market\/daily-report(?:\?|$)/,
  /^\/potus\/posts(?:\?|$)/,
  /^\/potus\/schedule(?:\?|$)/,
  /^\/earnings\/(?:afterhours|premarket)(?:\?|$)/,
  new RegExp(`^\\/earnings\\/${T}(?:\\?|$)`),
  /^\/option-trades\/flow-alerts(?:\?|$)/,
  new RegExp(`^\\/option-trades\/flow-alerts\\/${NAME}(?:\\?|$)`),
  /^\/option-trades(?:\?|$)/,
  new RegExp(`^\\/option-trades\\/exchange-breakdown\\/${NAME}(?:\\?|$)`),
  /^\/option-trades\/multi-leg(?:\?|$)/,
  new RegExp(`^\\/option-trades\\/multi-leg\\/${NAME}\\/legs(?:\\?|$)`),
  /^\/darkpool\/recent(?:\?|$)/,
  new RegExp(`^\\/darkpool\\/${T}(?:\\?|$)`),
  new RegExp(`^\\/darkpool\\/${T}\\/price-levels(?:\\?|$)`),
  new RegExp(`^\\/lit-flow\\/${T}(?:\\?|$)`),
  /^\/lit-flow\/recent(?:\?|$)/,
  /^\/screener\/stocks(?:\?|$)/,
  /^\/screener\/option-contracts(?:\?|$)/,
  /^\/option-contract\/[A-Z0-9]{1,30}\/flow(?:\?|$)/,
  /^\/option-contract\/[A-Z0-9]{1,30}\/(?:historic|intraday|volume-profile)(?:\?|$)/,
  /^\/screener\/analysts(?:\?|$)/,
  /^\/institutions(?:\?|$)/,
  /^\/institutions\/latest_filings(?:\?|$)/,
  new RegExp(`^\\/institution\\/${NAME}\\/holdings(?:\\?|$)`),
  new RegExp(`^\\/institution\\/${NAME}\\/sectors(?:\\?|$)`),
  new RegExp(`^\\/institution\\/${T}\\/ownership(?:\\?|$)`),
  new RegExp(`^\\/institution\\/${T}\\/option-holders(?:\\?|$)`),
  /^\/short_screener(?:\?|$)/,
  new RegExp(`^\\/shorts\\/${T}\\/data(?:\\?|$)`),
  new RegExp(`^\\/shorts\\/${T}\\/ftds(?:\\?|$)`),
  new RegExp(`^\\/shorts\\/${T}\\/interest-float\\/v2(?:\\?|$)`),
  new RegExp(`^\\/shorts\\/${T}\\/volume-and-ratio(?:\\?|$)`),
  new RegExp(`^\\/shorts\\/${T}\\/volumes-by-exchange(?:\\?|$)`),
  /^\/flex-options(?:\?|$)/,
  /^\/flex-options\/market(?:\?|$)/,
  new RegExp(`^\\/flex-options\\/${T}(?:\\?|$)`),
  new RegExp(`^\\/flex-options\\/chain\\/${NAME}(?:\\?|$)`),
  new RegExp(`^\\/etfs\\/${T}\\/(?:holdings|in-outflow|info|exposure|weights)(?:\\?|$)`),
  /^\/seasonality\/market(?:\?|$)/,
  new RegExp(`^\\/seasonality\\/${T}\\/(?:monthly|year-month)(?:\\?|$)`),
  new RegExp(`^\\/seasonality\\/${NAME}\\/performers(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/info(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/stock-state(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/quote(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/greek-exposure(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/greek-exposure\\/strike(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/greek-exposure\\/expiry(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/greek-exposure\\/strike-expiry(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/gex-levels(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/greeks(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/spot-exposures(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/spot-exposures\\/strike(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/spot-exposures\\/expiry-strike(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/greek-flow(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/greek-flow\\/${NAME}(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/oi-per-strike(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/oi-per-expiry(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/oi-change(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/option\\/volume-oi-expiry(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/flow-per-strike(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/flow-per-expiry(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/flow-per-strike-intraday(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/iv-rank(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/volatility\\/term-structure(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/volatility\\/term-structure\\/distribution(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/volatility\\/(?:realized|stats|anomaly|character|context|option-sentiment)(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/volatility\\/realized\\/windows(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/volatility\\/variance-risk-premium(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/volatility\\/variance-risk-premium\\/windows(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/interpolated-iv(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/interpolated-iv\\/distribution(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/historical-risk-reversal-skew(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/(?:max-pain|nope|net-prem-ticks|atm-chains|options-volume|unusualness|ownership|option-stance|options-pulse)(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/option\\/stock-price-levels(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/stock-volume-price-levels(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/option-contracts(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/ohlc\\/(?:1m|5m|15m|1h|1d|2m|3m)(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${T}\\/(?:balance-sheets|cash-flows|income-statements|financials|fundamental-breakdown)(?:\\?|$)`),
  new RegExp(`^\\/stock\\/${NAME}\\/tickers(?:\\?|$)`),
];

/* Routes the vendor retired; refused even where a broader pattern above would match. */
const RETIRED = [
  /^\/stock\/[^/]+\/flow-alerts(?:\?|$)/,
  /^\/stock\/[^/]+\/spot-exposures\/[^/]+\/strike(?:\?|$)/,
  /^\/shorts\/[^/]+\/interest-float(?:\?|$)/,
  /^\/institution\/[^/]+\/activity(?:\?|$)/,
];

const JOB_MS = 30_000;
/* the last vendor answers, for the hub's counts */
const recent = [];

/* The key allows three concurrent requests across all viewers; past that the vendor answers 429 or a bare 500.
   Every upstream call takes a slot and the rest queue. The limit is per process (per Vercel instance). */
const UPSTREAM_SLOTS = 3;
let upstreamBusy = 0;
let refreshBusy = 0;
/* A viewer goes ahead of every background refresh, and a quick request ahead of a slow one: a route whose answers
   have been taking over 1.5 s (a whole chain, a long tape) waits behind the quick ones (a quote, the day's exposure),
   so one viewer's heavy walk never makes another's price time out. Refreshes hold at most one of the three slots. */
const quickQueue = [];
const viewerQueue = [];
const refreshQueue = [];
const took = new Map();
const routeOf = (path) => path.split('?')[0].replace(/\/[A-Z0-9.$_-]{1,12}(?=\/|$)/g, '/:t').replace(/\/[0-9a-f-]{20,}/g, '/:id');
const slow = (path) => (took.get(routeOf(path)) ?? 0) > 1_500;
const noteTook = (path, ms) => {
  const r = routeOf(path);
  const was = took.get(r);
  took.set(r, was == null ? ms : 0.7 * was + 0.3 * ms);
};
/* slow work (a viewer's heavy route, or a refresh) never holds the last slot: a quick ask always finds one free */
let slowBusy = 0;
const slowMayGo = () => upstreamBusy < UPSTREAM_SLOTS && slowBusy < UPSTREAM_SLOTS - 1;
const refreshMayGo = () => slowMayGo() && refreshBusy < 1 && quickQueue.length === 0 && viewerQueue.length === 0;
/* a slot is counted for the lane its holder was let in from */
function take(kind) {
  upstreamBusy += 1;
  if (kind !== 'quick') slowBusy += 1;
  if (kind === 'refresh') refreshBusy += 1;
}
function give(kind) {
  upstreamBusy -= 1;
  if (kind !== 'quick') slowBusy -= 1;
  if (kind === 'refresh') refreshBusy -= 1;
}
function wake() {
  while (upstreamBusy < UPSTREAM_SLOTS && quickQueue.length) {
    take('quick');
    quickQueue.shift().go('quick');
  }
  while (viewerQueue.length && slowMayGo()) {
    take('viewer');
    viewerQueue.shift().go('viewer');
  }
  if (refreshQueue.length && refreshMayGo()) {
    take('refresh');
    refreshQueue.shift().go('refresh');
  }
}
/* the background refreshes still waiting for a slot, by path */
const refreshWaiting = new Map();
/** A viewer is waiting on this path's background refresh (server/hub.mjs): it leaves the refresh lane for the viewers'. */
function promote(path) {
  const entry = refreshWaiting.get(path);
  const at = entry ? refreshQueue.indexOf(entry) : -1;
  if (at < 0) return;
  refreshQueue.splice(at, 1);
  refreshWaiting.delete(path);
  (slow(path) ? viewerQueue : quickQueue).push(entry);
  wake();
}
/** Takes a waiting ask out of its queue (its job was given up): it never reaches the vendor. */
function withdraw(entry) {
  for (const q of [quickQueue, viewerQueue, refreshQueue]) {
    const at = q.indexOf(entry);
    if (at >= 0) {
      q.splice(at, 1);
      if (refreshWaiting.get(entry.path) === entry) refreshWaiting.delete(entry.path);
      entry.go(null);
      return;
    }
  }
}
async function upstreamSlot(fn, lane = 'viewer', path = '', ticket = {}) {
  const refresh = lane !== 'viewer';
  /* a refresh is slow work whatever its route; a viewer's ask is slow when its route has been taking long */
  const heavy = refresh || slow(path);
  const want = refresh ? 'refresh' : heavy ? 'viewer' : 'quick';
  const free = refresh ? refreshMayGo() : heavy ? slowMayGo() && viewerQueue.length === 0 : upstreamBusy < UPSTREAM_SLOTS;
  let kind = want;
  if (free) take(kind);
  else {
    /* the slot is counted for us when we are woken (wake), so no caller can slip in between */
    const entry = { path, go: () => {} };
    kind = await new Promise((r) => {
      entry.go = r;
      (refresh ? refreshQueue : heavy ? viewerQueue : quickQueue).push(entry);
      if (refresh) refreshWaiting.set(path, entry);
      ticket.entry = entry;
    });
    ticket.entry = null;
    if (refreshWaiting.get(path) === entry) refreshWaiting.delete(path);
    if (!kind) throw new Error('withdrawn');
  }
  try {
    return await fn();
  } finally {
    give(kind);
    wake();
  }
}
/** A rate limit or a passing vendor error: worth a wait and another try. */
const retryable = (status) => status === 429 || status === 500 || status === 502 || status === 503 || status === 504;

const NY_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
/* a page that ends in the past (older_than a moment, or an earlier session's date) never changes again */
const pastPage = (path) => {
  const q = new URLSearchParams(path.split('?')[1] || '');
  if (q.has('older_than')) return true;
  const d = q.get('date');
  return !!d && d < NY_DATE.format(new Date());
};

const ttlFor = (path) => {
  if (pastPage(path)) return 30 * 60_000;
  const p = path.split('?')[0];
  if (/^\/option-contract\/[^/]+\/(?:flow|intraday)$/.test(p)) return 10_000;
  if (/^\/option-contract\/[^/]+\/(?:historic|volume-profile)$/.test(p)) return 60_000;
  if (/\/(option-trades|flow-alerts|market-tide|sector-tide|etf-tide|top-net-impact|net-flow|greek-flow|stock-state|quote|flow-per-strike-intraday|net-prem-ticks|nope|spot-exposures)(\/|$)/.test(p)) return 3_000;
  if (/\/(greek-exposure|gex-levels|flow-per-|oi-|option-contracts|atm-chains|interpolated-iv|ohlc\/(?:1m|2m|3m|5m|15m|1h)|darkpool|lit-flow|options-volume|stock-price-levels|stock-volume-price-levels)(\/|$)/.test(p)) return 15_000;
  return 300_000;
};

const allowed = (path) => !RETIRED.some((re) => re.test(path)) && ALLOWED.some((re) => re.test(path));

const send = (res, status, body, type = 'application/json') => {
  res.statusCode = status;
  res.setHeader('content-type', type);
  res.setHeader('cache-control', 'no-store');
  res.end(body);
};

/* ---- the key's breaker ----
   A 429 is about the key, not the path: every caller holds off until the vendor's Retry-After (else 1 s, 2 s, 4 s … up
   to 30 s) has passed. The wait happens outside the three slots, background work (refreshes, the recorder) never waits
   at all (it gives up at once and the hub keeps the last good copy), and a viewer waits at most VIEWER_COOL_MS before
   being answered 429 with the time left, which the browser honours (data/whales.ts). */
let coolUntil = 0;
let strikes = 0;
const VIEWER_COOL_MS = 8_000;
const MAX_COOL_MS = 60_000;
const stats429 = { refusals: 0, held: 0, gaveUp: 0 };
/** ms the vendor asked us to wait (Retry-After in seconds or as a date), or 0 */
function retryAfterMs(h) {
  if (!h) return 0;
  const s = Number(h);
  if (Number.isFinite(s)) return s > 0 ? s * 1000 : 0;
  const at = Date.parse(h);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 0;
}
function noteRefused(header) {
  strikes += 1;
  stats429.refusals += 1;
  const ms = Math.min(MAX_COOL_MS, retryAfterMs(header) || Math.min(30_000, 1000 * 2 ** (strikes - 1)));
  coolUntil = Math.max(coolUntil, Date.now() + ms);
}
const coolLeft = () => Math.max(0, coolUntil - Date.now());
const tooMany = () => ({
  status: 429,
  body: Buffer.from(JSON.stringify({ error: 'unusual whales is rate limiting this key; asked again shortly', code: 'rate_limited_upstream' })),
  type: 'application/json',
});
const COOLING = Symbol('cooling');

async function load(path, key, lane) {
  const ticket = { entry: null, dead: false };
  const background = lane !== 'viewer';
  const job = (async () => {
    /* At most one retry of a 429 (after the key's breaker has passed) and two of a gateway error; never a sleep inside
       a slot. */
    let upstream;
    let buf;
    let refusals = 0;
    for (let attempt = 0; ; attempt++) {
      if (ticket.dead) throw new Error('withdrawn');
      const wait = coolLeft();
      if (wait > 0) {
        if (background || wait > VIEWER_COOL_MS) {
          stats429.gaveUp += 1;
          return tooMany();
        }
        stats429.held += 1;
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      /* the body is read inside the slot, so a slot frees only once the vendor has finished answering */
      const got = await upstreamSlot(async () => {
        /* the breaker tripped while this ask waited for its slot: give the slot back without a call */
        if (coolLeft() > 0) return COOLING;
        const t0 = Date.now();
        const r = await fetch(`https://api.unusualwhales.com/api${path}`, {
          headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(12_000),
        });
        const body = Buffer.from(await r.arrayBuffer());
        noteTook(path, Date.now() - t0);
        return [r, body];
      }, lane, path, ticket).catch((e) => {
        if (!ticket.dead) recent.push(`${e?.name || 'error'} ${path.slice(0, 60)}`);
        throw e;
      });
      if (got === COOLING) {
        attempt -= 1;
        continue;
      }
      [upstream, buf] = got;
      recent.push(`${upstream.status} ${path.slice(0, 60)}`);
      if (recent.length > 20) recent.splice(0, recent.length - 20);
      if (upstream.status === 429) {
        noteRefused(upstream.headers.get('retry-after'));
        refusals += 1;
        if (refusals >= 2 || background) break;
        continue;
      }
      if (upstream.status < 500) strikes = 0;
      if (!retryable(upstream.status) || attempt >= 2) break;
      await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
    }
    /* a refusal that outlasts the retries comes back as is; the hub keeps the last good answer on screen */
    const type = upstream.headers.get('content-type') || 'application/json';
    return { status: upstream.status, body: buf, type };
  })();
  /* A job is let go after JOB_MS so later asks for the path are not stuck behind it; its late failure is ignored. A job
     still waiting for a slot then is withdrawn, so a given-up ask never reaches the vendor later. */
  job.catch(() => {});
  let timer;
  try {
    return await Promise.race([
      job,
      new Promise((resolve) => {
        timer = setTimeout(() => {
          ticket.dead = true;
          if (ticket.entry) withdraw(ticket.entry);
          resolve({ status: 504, body: Buffer.from(JSON.stringify({ error: 'unusual whales timed out' })), type: 'application/json' });
        }, JOB_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const hub = createHub({
  name: 'uw',
  fetch: (path, lane) => load(path, process.env.UNUSUAL_WHALES_API_KEY, lane),
  ttl: ttlFor,
  refreshPerSec: Number(process.env.UW_HUB_REFRESH_PER_SEC) || 3,
  /* the vendor refusing for a moment (429, a gateway error) keeps the last answer up to a minute old on screen */
  keepOnFail: (path, age) => age < Math.max(60_000, 4 * ttlFor(path)),
  promote,
});
/** The hub's counts, for the load check (scripts/load-proof.mjs). */
export const uwHubStats = () => hub.stats();

/** One answer for a reader inside this process (the Compass engine, the exposure recorder): the same hub, cache and
    three slots. `lane: 'record'` is for work no viewer is waiting on: it reuses any copy younger than `maxAge`, and a
    vendor call it needs goes in the background lane (one slot at most, behind every waiting viewer). `at` is when the
    answer was taken. */
export async function uwDirect(path, opt) {
  if (!process.env.UNUSUAL_WHALES_API_KEY || !allowed(path)) return { status: 503, body: '{}', at: Date.now() };
  const got = await hub.get(path, opt?.lane === 'record' ? { lane: 'record', maxAge: opt.maxAge } : undefined);
  return { status: got.status, body: got.body.toString('utf8'), at: got.at };
}

/** Connect, Express and the Vercel Node function all hand over a Node request and response. */
export async function proxyUw(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, JSON.stringify({ error: 'method not allowed' }));
    return;
  }
  if (/^(?:\/api\/uw)?\/__hub(?:\?|$)/.test(req.url || '') && process.env.VERCEL_ENV !== 'production') {
    send(res, 200, JSON.stringify({ ...hub.stats(), slotsBusy: upstreamBusy, slowSlots: slowBusy, refreshSlots: refreshBusy, quickQueued: quickQueue.length, viewersQueued: viewerQueue.length, refreshesQueued: refreshQueue.length, coolingMs: coolLeft(), ...stats429, recent }));
    return;
  }
  const path = forwardPath(req.url, /^\/api\/uw/, 400);
  if (!path || !allowed(path)) {
    send(res, 404, JSON.stringify({ error: 'not found' }));
    return;
  }
  const verdict = await gate(req, 'uw');
  if (!verdict.ok) {
    sendDenied(res, verdict);
    return;
  }
  const key = process.env.UNUSUAL_WHALES_API_KEY;
  if (!key) {
    send(res, 503, JSON.stringify({ error: 'unusual whales is not configured' }));
    return;
  }
  try {
    const got = await hub.get(path);
    /* a refusal tells the browser how long the key's breaker still holds, so it waits that out instead of asking again */
    if (got.status === 429) res.setHeader('retry-after', String(Math.max(1, Math.ceil(coolLeft() / 1000))));
    /* how old the answer is (Age, x-hub-at), so a feed can say "as of" when the hub is holding an old copy */
    else for (const [k, v] of Object.entries(hub.ageHeaders(path, got))) res.setHeader(k, v);
    send(res, got.status, got.body, got.type);
  } catch {
    send(res, 502, JSON.stringify({ error: 'unusual whales unreachable' }));
  }
}
