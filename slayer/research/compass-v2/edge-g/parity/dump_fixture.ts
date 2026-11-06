/* EDGE-G parity: the recorded pinpoint-2026-10-29 book (SPY, NVDA) read exactly as pinpoint-golden.ts reads it: the
   page's spot, the app's levels (net, walls, supreme, flip, netAtSpot) for Today and All, and pinpointRaw's independent
   priced legs of the raw rows. Writes JSON to argv[2]. */
import { writeFileSync } from 'node:fs';
import { freezeClock, installUwFixtures, recordedAt, settleOn } from '../../../../scripts/golden/uwFixtures';
import { byStrike, contractOi, contractVols, exposureRows, levelsOfRows, pricedLegs, rawAnswers, termVols } from '../../../../scripts/golden/pinpointRaw';

const SET = 'pinpoint-2026-10-29';
const mem = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.window = globalThis;
g.location = { search: '', pathname: '/pinpoint/map', href: 'http://127.0.0.1/pinpoint/map', hostname: '127.0.0.1', origin: 'http://127.0.0.1' };
g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)), removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear(), key: () => null, length: 0 };
const fx = installUwFixtures(SET);
freezeClock(recordedAt(SET, new Date().toISOString()));
const book = await import('../../../../src/data/uwBook');
const { openFeeds } = await import('../../../../src/data/feedGate');
openFeeds();
const { levelsFor } = await import('../../../../src/data/levelsFor');
const FRONT: Record<string, string> = { SPY: '2026-10-29', NVDA: '2026-10-30' };
const raw = rawAnswers(SET);
const out: Record<string, unknown> = {};
for (const t of ['SPY', 'NVDA']) {
  book.ensureBook(t, 'full');
  await settleOn(fx, () => { const e = book.peekEntry(t); return !!e && e.status === 'live' && !!e.everFull; }, t);
  const snap = book.snapshotFor(t, '0DTE', 'full')!;
  const rows = exposureRows(raw, t);
  const marked = Number([...rows].sort((a, b) => String(b.time).localeCompare(String(a.time)))[0].price);
  const vols = contractVols(raw, t, marked, '2026-10-28');
  const ois = contractOi(raw, t);
  const liveDates = new Set(rows.map(r => String(r.expiry)).filter(d => d >= '2026-10-29'));
  const scopes: Record<string, unknown> = {};
  for (const [name, scope, dates] of [['today', '0DTE', new Set([FRONT[t]])], ['all', 'ALL', liveDates]] as const) {
    const lv = levelsFor(t, scope)!;
    const priced = pricedLegs(rows, dates, vols, ois, termVols(raw, t));
    scopes[name] = { app: { net: lv.netGex, flip: lv.flip, netAtSpot: lv.netAtSpot, callWall: lv.callWall, putWall: lv.putWall, supreme: lv.supreme }, hand: levelsOfRows(byStrike(rows, dates)), dates: [...dates], priced };
  }
  out[t] = { spot: snap.spot, marked, scopes };
}
writeFileSync(process.argv[2], JSON.stringify(out));
process.exit(0);
