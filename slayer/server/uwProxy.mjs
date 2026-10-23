/*
  Unusual Whales proxy. The browser calls /api/uw/*; this adds the bearer
  token from UNUSUAL_WHALES_API_KEY and never writes the token back out.

  Identical GETs that are already in flight share one upstream call.
  A hit is kept for 3s (quotes, state, minute flow), 15s (the book and
  the intraday chain), or 300s (a daily, a filing, a calendar).
*/

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
  /* one contract's last trades — the contract card's anchor print */
  /^\/option-contract\/[A-Z0-9]{1,30}\/flow(?:\?|$)/,
  /* one contract's daily history, minute bars and fill-price profile — the Trace contract card's tape */
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
  /* greeks for every strike of one expiry (?expiry=YYYY-MM-DD) — Pinpoint's greeks once the Theta terminal is out of the picture */
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

/* The four retired routes. A typo must not reach the vendor. */
const RETIRED = [
  /^\/stock\/[^/]+\/flow-alerts(?:\?|$)/,
  /^\/stock\/[^/]+\/spot-exposures\/[^/]+\/strike(?:\?|$)/,
  /^\/shorts\/[^/]+\/interest-float(?:\?|$)/,
  /^\/institution\/[^/]+\/activity(?:\?|$)/,
];

const cache = new Map();
const inflight = new Map();
const MAX_CACHE = 400;

/* THE KEY'S CONCURRENCY CAP (the live-session sweep, 2026-10-22): the plan allows THREE requests in flight at once —
   for the whole key, every viewer together ("You have exceeded 3 concurrent requests, the maximum allowed for your
   current plan"). Past it the vendor answers 429, and under a burst sometimes a bare 500, and the page shows an empty
   cell. Every upstream call takes a slot here and the rest queue, so the server never asks for more than the key may. */
const UPSTREAM_SLOTS = 3;
let upstreamBusy = 0;
const upstreamQueue = [];
async function upstreamSlot(fn) {
  if (upstreamBusy >= UPSTREAM_SLOTS) await new Promise(r => upstreamQueue.push(r));
  upstreamBusy += 1;
  try {
    return await fn();
  } finally {
    upstreamBusy -= 1;
    const next = upstreamQueue.shift();
    if (next) next();
  }
}
/** A rate-limit or a passing vendor error — worth a wait and another ask */
const retryable = status => status === 429 || status === 500 || status === 502 || status === 503 || status === 504;

const ttlFor = (path) => {
  const p = path.split('?')[0];
  /* one contract's prints and minutes move with the tape; its daily history only once a session */
  if (/^\/option-contract\/[^/]+\/(?:flow|intraday)$/.test(p)) return 10_000;
  if (/^\/option-contract\/[^/]+\/(?:historic|volume-profile)$/.test(p)) return 60_000;
  if (/\/(option-trades|flow-alerts|market-tide|sector-tide|etf-tide|top-net-impact|net-flow|greek-flow|stock-state|quote|flow-per-strike-intraday|net-prem-ticks|nope|spot-exposures)(\/|$)/.test(p)) return 3_000;
  if (/\/(greek-exposure|gex-levels|flow-per-|oi-|option-contracts|atm-chains|interpolated-iv|ohlc\/(?:1m|2m|3m|5m|15m|1h)|darkpool|lit-flow|options-volume|stock-price-levels|stock-volume-price-levels)(\/|$)/.test(p)) return 15_000;
  return 300_000;
};

const allowed = (path) =>
  path.length < 400 &&
  !path.includes('..') &&
  !RETIRED.some((re) => re.test(path)) &&
  ALLOWED.some((re) => re.test(path));

const send = (res, status, body, type = 'application/json') => {
  res.statusCode = status;
  res.setHeader('content-type', type);
  res.setHeader('cache-control', 'no-store');
  res.end(body);
};

async function load(path, key) {
  const running = inflight.get(path);
  if (running) return running;
  const job = (async () => {
    /* THE VENDOR'S RATE LIMIT IS ANSWERED HERE, NOT IN THE BROWSER (the Pinpoint sweep, 2026-10-22): a 20-name Board
       asks ~275 routes in its first half-minute and the vendor answers some of them 429. The browser's one retry still
       left red "Failed to load resource" lines and empty cells; the proxy now waits the vendor out (its Retry-After, or
       0.8s, 1.6s, 3.2s) and only then gives up — handing back the last good print for the path when it has one. */
    let upstream;
    let buf;
    for (let attempt = 0; ; attempt++) {
      /* the body is read inside the slot, so a slot is only freed once the vendor has finished answering */
      [upstream, buf] = await upstreamSlot(async () => {
        const r = await fetch(`https://api.unusualwhales.com/api${path}`, {
          headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(12_000),
        });
        return [r, Buffer.from(await r.arrayBuffer())];
      });
      if (!retryable(upstream.status) || attempt >= 3) break;
      const after = Number(upstream.headers.get('retry-after'));
      await new Promise(r => setTimeout(r, Number.isFinite(after) && after > 0 && after <= 5 ? after * 1000 : 800 * 2 ** attempt));
    }
    /* still refused after the retries: the last good print for the path beats an empty cell */
    if (retryable(upstream.status)) {
      const stale = cache.get(path);
      if (stale) return { status: stale.status, body: stale.body, type: stale.type };
    }
    const type = upstream.headers.get('content-type') || 'application/json';
    if (upstream.status === 200) {
      cache.set(path, { at: Date.now(), status: 200, body: buf, type });
      if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    }
    return { status: upstream.status, body: buf, type };
  })();
  /* NO ASK WAITS FOREVER (the tenth Pinpoint pass, 2026-10-23: one page of SPY's expiry walk sat unanswered here for
     100s+ on every ask while the vendor answered the same URL in 0.6s — every later ask for the path joined the stuck
     job). After 30s the job is let go: the path is free for a fresh ask, and this one gets the last good copy or a 504. */
  /* a job let go may still fail later: that failure is nobody's to handle, and must not take the server down */
  job.catch(() => {});
  let timer;
  const capped = Promise.race([
    job,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), JOB_MS);
    }),
  ]);
  inflight.set(path, capped);
  try {
    return await capped;
  } catch (e) {
    const stale = cache.get(path);
    if (stale) return { status: stale.status, body: stale.body, type: stale.type };
    if (e instanceof Error && e.message === 'timeout') return { status: 504, body: Buffer.from(JSON.stringify({ error: 'unusual whales timed out' })), type: 'application/json' };
    throw e;
  } finally {
    clearTimeout(timer);
    if (inflight.get(path) === capped) inflight.delete(path);
  }
}
const JOB_MS = 30_000;

/** Connect, Express, and the Vercel node function all hand us a Node response. */
export async function proxyUw(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, JSON.stringify({ error: 'method not allowed' }));
    return;
  }
  let path = req.url || '/';
  path = path.replace(/^\/api\/uw/, '') || '/';
  if (!path.startsWith('/')) path = `/${path}`;
  if (!allowed(path)) {
    send(res, 404, JSON.stringify({ error: 'not found' }));
    return;
  }
  const key = process.env.UNUSUAL_WHALES_API_KEY;
  if (!key) {
    send(res, 503, JSON.stringify({ error: 'unusual whales is not configured' }));
    return;
  }
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < ttlFor(path)) {
    send(res, hit.status, hit.body, hit.type);
    return;
  }
  try {
    const got = await load(path, key);
    send(res, got.status, got.body, got.type);
  } catch {
    send(res, 502, JSON.stringify({ error: 'unusual whales unreachable' }));
  }
}
