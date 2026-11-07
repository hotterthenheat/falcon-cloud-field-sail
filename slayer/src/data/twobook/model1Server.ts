/// <reference types="node" />
/*
  The open-interest book's keeper on the server: GET /api/twobook/oi?ticker=SPY (server/twoBookApi.mjs).
  One board per name, shared by every viewer, built from the vendor's pages through the shared hub's background lane
  (server/uwProxy.mjs uwDirect, lane 'record': a copy up to REUSE_MS old is reused, a vendor call waits behind every
  viewer, one slot at most). Every walk is paginated to the end (limit 500, page until a short page): a failed page
  fails the build — the board is never built from part of the population. Pure arithmetic in model1.ts.
*/

import { model1Board, type Model1Wire } from './model1';

type Read = (path: string) => Promise<{ status: number; body: string; at: number }>;
export const HOLD_MS = 2 * 60_000;
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

async function walk(read: Read, base: string): Promise<{ rows: Record<string, unknown>[]; pages: number } | null> {
  const rows: Record<string, unknown>[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
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
  const build = async (t: string): Promise<Model1Wire> => {
    const T = encodeURIComponent(t);
    const rows = await walk(o.uw, `/stock/${T}/spot-exposures/expiry-strike`);
    if (!rows) throw new Error('the listed exposure rows did not come back whole');
    const stats = await o.uw(`/stock/${T}/volatility/stats`);
    let iv30: number | null = null;
    let ivDate: string | null = null;
    try {
      const j = JSON.parse(stats.body)?.data;
      iv30 = Number(j?.iv) > 0 ? Number(j.iv) : null;
      ivDate = typeof j?.date === 'string' ? j.date : null;
    } catch {
      /* no IV: the board says so */
    }
    const contracts = rows.rows.length ? await walk(o.uw, `/stock/${T}/option-contracts`) : { rows: [], pages: 0 };
    if (!contracts) throw new Error('the listed contracts did not come back whole');
    return model1Board({ ticker: t, rows: rows.rows, pages: rows.pages + contracts.pages, iv30, iv30Date: ivDate, contracts: contracts.rows });
  };
  return {
    board(ticker: string): Promise<Model1Wire> {
      const t = ticker.toUpperCase();
      const hit = boards.get(t);
      if (hit && now() - hit.at < HOLD_MS) return Promise.resolve(hit.wire);
      const running = building.get(t);
      if (running) return running;
      const job = build(t)
        .then(wire => {
          boards.set(t, { at: now(), wire });
          if (boards.size > 40) boards.delete(boards.keys().next().value as string);
          return wire;
        })
        .finally(() => building.delete(t));
      building.set(t, job);
      return job;
    },
  };
}

type Req = { url?: string };
type Res = { statusCode: number; setHeader: (k: string, v: string) => void; end: (b?: string) => void };
export function model1Route(keeper: ReturnType<typeof startModel1>, req: Req, res: Res): void {
  const url = new URL(req.url || '/', 'http://local');
  const t = String(url.searchParams.get('ticker') ?? '').trim().toUpperCase();
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  const send = (s: number, b: unknown) => {
    res.statusCode = s;
    res.end(JSON.stringify(b));
  };
  if (!TICKER.test(t)) return send(400, { error: 'ask /api/twobook/oi?ticker=SPY' });
  keeper.board(t).then(
    w => send(200, w),
    e => send(503, { error: `the open-interest book could not be built: ${e instanceof Error ? e.message : e}`, code: 'oi_book_failed' }),
  );
}
