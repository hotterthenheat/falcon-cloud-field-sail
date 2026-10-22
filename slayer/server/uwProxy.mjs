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

const ttlFor = (path) => {
  const p = path.split('?')[0];
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
    const upstream = await fetch(`https://api.unusualwhales.com/api${path}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    const type = upstream.headers.get('content-type') || 'application/json';
    if (upstream.status === 200) {
      cache.set(path, { at: Date.now(), status: 200, body: buf, type });
      if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    }
    return { status: upstream.status, body: buf, type };
  })();
  inflight.set(path, job);
  try {
    return await job;
  } finally {
    inflight.delete(path);
  }
}

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
