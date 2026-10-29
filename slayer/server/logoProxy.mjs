/*
  Company marks from the public logo source, through this server: GET /api/logo/{SYMBOL}. A symbol the source has
  no mark for answers 204 (the page draws the letters, and the browser logs nothing), never the source's 404. Hits and
  misses are kept for a day in this process, and the browser caches both for a day.
*/

const SOURCE = 'https://assets.parqet.com/logos/symbol/';
const DAY_MS = 86_400_000;
const MAX_ENTRIES = 3_000;
const MAX_BYTES = 256 * 1024;

const kept = new Map();
const inflight = new Map();

const remember = (sym, entry) => {
  kept.set(sym, entry);
  if (kept.size > MAX_ENTRIES) kept.delete(kept.keys().next().value);
};

async function load(sym) {
  const running = inflight.get(sym);
  if (running) return running;
  const job = (async () => {
    try {
      const r = await fetch(`${SOURCE}${sym}`, { signal: AbortSignal.timeout(6_000) });
      const type = r.headers.get('content-type') || '';
      if (r.status === 200 && type.startsWith('image/')) {
        const body = Buffer.from(await r.arrayBuffer());
        if (body.length > 0 && body.length <= MAX_BYTES) return { at: Date.now(), body, type };
      }
      if (r.status === 404 || r.status === 200) return { at: Date.now(), body: null, type: '' };
      return null;
    } catch {
      return null;
    }
  })();
  inflight.set(sym, job);
  try {
    const got = await job;
    if (got) remember(sym, got);
    return got;
  } finally {
    inflight.delete(sym);
  }
}

const none = (res, maxAge) => {
  res.statusCode = 204;
  res.setHeader('cache-control', `public, max-age=${maxAge}`);
  res.end();
};

/** Connect, Express and the Vercel Node function all hand over a Node request and response. */
export async function proxyLogo(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.end();
    return;
  }
  const sym = decodeURIComponent((req.url || '').replace(/^\/api\/logo/, '').replace(/^\//, '').split(/[?#]/)[0] || '').toUpperCase();
  /* plain symbols only: class shares, warrants and units have no mark at the source */
  if (!/^[A-Z]{1,5}$/.test(sym)) return none(res, 86_400);
  const hit = kept.get(sym);
  const got = hit && Date.now() - hit.at < DAY_MS ? hit : await load(sym);
  /* the source did not answer: no mark this time, asked again soon */
  if (!got) return none(res, 300);
  if (!got.body) return none(res, 86_400);
  res.statusCode = 200;
  res.setHeader('content-type', got.type);
  res.setHeader('cache-control', 'public, max-age=86400');
  res.setHeader('x-content-type-options', 'nosniff');
  /* a mark is a picture: opened on its own (an SVG is a document) it runs nothing */
  res.setHeader('content-security-policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox");
  res.end(req.method === 'HEAD' ? undefined : got.body);
}
