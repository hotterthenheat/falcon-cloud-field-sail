/// <reference types="node" />
/*
  The open-interest book's keeper on the server: GET /api/twobook/oi?ticker=SPY (server/twoBookApi.mjs).
  Two phases (the Map paints off the first): as soon as the exposure rows and the ticker IV are in, the board goes out with
  the four and every cell's four ('rows'); the contracts are walked next and the board is replaced whole ('full').
  One board per name, shared by every viewer, built from the vendor's pages through the shared hub's background lane
  (server/uwProxy.mjs uwDirect, lane 'record': a copy up to REUSE_MS old is reused, a vendor call waits behind every
  viewer, one slot at most). Every walk is paginated to the end (limit 500, page until a short page): a failed page
  fails the build — the board is never built from part of the population. Pure arithmetic in model1.ts.
*/

import { gzipSync } from 'node:zlib';
import { model1Board, type Model1Wire } from './model1';

type Read = (path: string) => Promise<{ status: number; body: string; at: number }>;
export const HOLD_MS = 2 * 60_000;
/** A board whose rows are a closed session's (no new minute until the next session) is held longer */
export const HOLD_SHUT_MS = 15 * 60_000;
export const REUSE_MS = 60_000;
const MAX_PAGES = 80;
const TICKER = /^[A-Z][A-Z0-9.]{0,9}$/;

const rowsOf = (body: string): Record<string, unknown>[] | null => {
  try {
    const j = JSON.parse(body);
    const d = j && typeof j === 'object' && !Array.isArray(j) && 'data' in j ? j.data : j;
    return Array.isArray(d) ? d : null;
  } catch {
    return null;
  }
};

/* The rows come first: a name's exposure rows put its board on screen (the four, every cell), its contracts only add the
   six. While any name's rows are being walked, a contracts walk waits between its pages (one name's long contracts walk
   — SPX's is ~60 pages — never holds a Board full of names off the screen). */
let rowsWalking = 0;
const rowsFirst = async () => {
  while (rowsWalking > 0) await new Promise(r => setTimeout(r, 50));
};

async function walk(read: Read, base: string, yieldToRows = false): Promise<{ rows: Record<string, unknown>[]; pages: number } | null> {
  const rows: Record<string, unknown>[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    if (yieldToRows) await rowsFirst();
    const got = await read(`${base}${base.includes('?') ? '&' : '?'}limit=500&page=${page}`);
    if (got.status !== 200) return page === 0 && (got.status === 404 || got.status === 422) ? { rows: [], pages: 0 } : null;
    const r = rowsOf(got.body);
    if (!r) return null;
    rows.push(...r);
    if (r.length < 500) return { rows, pages: page + 1 };
  }
  return null;
}

export function startModel1(o: { uw: Read; now?: () => number; log?: (s: string) => void }) {
  const now = o.now ?? Date.now;
  const boards = new Map<string, { at: number; wire: Model1Wire }>();
  const building = new Map<string, Promise<Model1Wire>>();
  /** The rows-phase board of a build in flight: served while the contracts are walked */
  const partial = new Map<string, Model1Wire>();
  /** What the last full build read, per name (a recorded fixture is these: scripts/twobook-map-proof.ts) */
  const inputs = new Map<string, Parameters<typeof model1Board>[0]>();
  const build = async (t: string): Promise<Model1Wire> => {
    const T = encodeURIComponent(t);
    rowsWalking++;
    let rows: Awaited<ReturnType<typeof walk>>;
    let stats: Awaited<ReturnType<Read>>;
    try {
      rows = await walk(o.uw, `/stock/${T}/spot-exposures/expiry-strike`);
      if (!rows) throw new Error('the listed exposure rows did not come back whole');
      stats = await o.uw(`/stock/${T}/volatility/stats`);
    } finally {
      rowsWalking--;
    }
    let iv30: number | null = null;
    let ivDate: string | null = null;
    try {
      const j = JSON.parse(stats.body)?.data;
      iv30 = Number(j?.iv) > 0 ? Number(j.iv) : null;
      ivDate = typeof j?.date === 'string' ? j.date : null;
    } catch {
      /* no IV: the board says so */
    }
    if (rows.rows.length) partial.set(t, { ...model1Board({ ticker: t, rows: rows.rows, pages: rows.pages, iv30, iv30Date: ivDate, contracts: null }), version: `${now()}|rows` });
    const contracts = rows.rows.length ? await walk(o.uw, `/stock/${T}/option-contracts`, true) : { rows: [], pages: 0 };
    if (!contracts) throw new Error('the listed contracts did not come back whole');
    const input = { ticker: t, rows: rows.rows, pages: rows.pages + contracts.pages, iv30, iv30Date: ivDate, contracts: contracts.rows };
    inputs.set(t, input);
    if (inputs.size > 8) inputs.delete(inputs.keys().next().value as string);
    return { ...model1Board(input), version: `${now()}|full` };
  };
  /* the exposure recorder reads the boards held here, never building one (src/data/exposureRecorder.ts heldModel1): a
     process-wide registry, the latest keeper's */
  (globalThis as Record<string, unknown>).__slayerModel1Held = (ticker: string): Model1Wire | null => {
    const t = ticker.toUpperCase();
    return boards.get(t)?.wire ?? partial.get(t) ?? null;
  };
  /* the rows say when they were priced: a board priced more than 30 minutes before now is a shut market's */
  const holdOf = (w: Model1Wire) => (w.at != null && now() - w.at > 30 * 60_000 ? HOLD_SHUT_MS : HOLD_MS);
  return {
    board(ticker: string): Promise<Model1Wire> {
      const t = ticker.toUpperCase();
      const hit = boards.get(t);
      if (hit && now() - hit.at < holdOf(hit.wire)) return Promise.resolve(hit.wire);
      let running = building.get(t);
      if (!running) {
        running = build(t)
          .then(wire => {
            boards.set(t, { at: now(), wire });
            if (boards.size > 40) boards.delete(boards.keys().next().value as string);
            return wire;
          })
          .finally(() => {
            building.delete(t);
            partial.delete(t);
          });
        building.set(t, running);
      }
      /* a board in hand (stale) is served while the new one builds; else the rows phase once it is in */
      if (hit) return Promise.resolve(hit.wire);
      const job = running;
      return new Promise<Model1Wire>((resolve, reject) => {
        let done = false;
        job.then(w => { done = true; resolve(w); }, e => { done = true; reject(e); });
        const peek = () => {
          if (done) return;
          const p = partial.get(t);
          if (p) resolve(p);
          else setTimeout(peek, 150);
        };
        peek();
      });
    },
    inputs: (ticker: string) => inputs.get(ticker.toUpperCase()) ?? null,
  };
}

type Req = { url?: string; headers?: Record<string, string | string[] | undefined> };
type Res = { statusCode: number; setHeader: (k: string, v: string) => void; end: (b?: string | Buffer) => void };
/* A board is encoded once (docs/OLD_PATH_AUDIT.md item 5): the same wire object is served to every viewer until the next
   build, and SPX's full board took ~220 ms of JSON and gzip on every request (12,303 cells × 28 figures). The bytes are
   the same JSON, full precision — only kept. Weak: a board the keeper lets go takes its bytes with it. */
const encoded = new WeakMap<object, { text: string; gz: Buffer | null }>();
export function encodedBoard(w: object): { text: string; gz: Buffer | null } {
  let hit = encoded.get(w);
  if (!hit) {
    const text = JSON.stringify(w);
    hit = { text, gz: text.length > 4096 ? gzipSync(text) : null };
    encoded.set(w, hit);
  }
  return hit;
}
export function model1Route(keeper: ReturnType<typeof startModel1>, req: Req, res: Res): void {
  const url = new URL(req.url || '/', 'http://local');
  const t = String(url.searchParams.get('ticker') ?? '').trim().toUpperCase();
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  const gzipOk = String(req.headers?.['accept-encoding'] ?? '').includes('gzip');
  const send = (s: number, b: unknown) => {
    res.statusCode = s;
    const text = JSON.stringify(b);
    if (text.length > 4096 && gzipOk) {
      res.setHeader('content-encoding', 'gzip');
      res.end(gzipSync(text));
    } else res.end(text);
  };
  /* a board: its bytes as encoded the first time it was served */
  const sendBoard = (w: Model1Wire) => {
    const e = encodedBoard(w);
    res.statusCode = 200;
    if (e.gz && gzipOk) {
      res.setHeader('content-encoding', 'gzip');
      res.end(e.gz);
    } else res.end(e.text);
  };
  if (!TICKER.test(t)) return send(400, { error: 'ask /api/twobook/oi?ticker=SPY' });
  /* what the last full build read — for recording a fixture; never in production */
  if (url.searchParams.get('inputs') === '1') {
    if (process.env.VERCEL_ENV === 'production') return send(404, { error: 'not found' });
    const got = keeper.inputs(t);
    return got ? send(200, got) : send(404, { error: 'no full build of this name yet' });
  }
  const have = url.searchParams.get('v');
  keeper.board(t).then(
    /* the board the browser already holds: answered in a few bytes */
    w => (have && w.version === have ? send(200, { same: true, version: have }) : sendBoard(w)),
    e => send(503, { error: `the open-interest book could not be built: ${e instanceof Error ? e.message : e}`, code: 'oi_book_failed' }),
  );
}
