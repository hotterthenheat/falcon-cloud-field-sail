/*
  One Compass scan pass, timed request by request, against a running server's ThetaData proxy.

  The pass is the late path (the quotes ThetaData recorded at the mark, option/at_time/quote) so it can be run on any
  past session, with every read the scorer makes (bars, SPY and the sector ETFs, the prior session, open interest,
  the 30-minute quote seed, the volume curve). It runs two marks five minutes apart: the first carries the session's
  one-time reads (prior day, curve, expirations), the second is a steady mark. The live path differs by the snapshot
  (option/snapshot/greeks) instead of at_time, and by the SPY/ETF trade snapshot; their cost is timed on their own.

    npx tsx scripts/compass-profile.ts 2026-10-28 10:30 [odte|weekly|both]   (both: the two sleeves at once)
    COMPASS_THETA=http://127.0.0.1:8080/api/theta (default)
*/
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setCompassHost } from '../src/data/compassHost';
import { thetaAnswer } from '../src/data/compassServer';
import { atMark, odteBook, WEEKLY_FOCUS } from '../src/data/compassScan';
import { scoreBook } from '../src/data/compassModel';
import { optionScanOpen } from '../src/data/compassSession';
import { nyWallTime } from '../src/core/nyTime';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.COMPASS_THETA ?? 'http://127.0.0.1:8080/api/theta';
const [isoDay = '2026-10-30', clock = '10:30', which = 'both'] = process.argv.slice(2);

type Hit = { kind: string; ms: number; bytes: number; name: string };
let hits: Hit[] = [];
let current = '';

function kindOf(path: string, day: string): string {
  const p = path.split('?')[0];
  const q = new URLSearchParams(path.split('?')[1] ?? '');
  if (p.includes('/history/ohlc')) {
    const d = q.get('start_date') ?? '';
    return d === day ? `${p.startsWith('/index') ? 'index' : 'stock'} bars, today` : 'bars, prior sessions';
  }
  if (p.includes('/history/quote')) return q.get('interval') === '1s' ? 'option quotes 1 s' : 'option quote seed';
  return p.replace(/^\//, '');
}

const day = isoDay.replace(/-/g, '');
setCompassHost({
  server: true,
  theta: async path => {
    const t0 = performance.now();
    let got;
    try {
      const res = await fetch(`${BASE}${path}`);
      const body = await res.text();
      got = thetaAnswer(res.status, body, res.headers.get('content-type') ?? '');
      hits.push({ kind: kindOf(path, day), ms: performance.now() - t0, bytes: body.length, name: current });
    } catch {
      got = { status: 503, data: null, error: 'terminal_down' };
    }
    return got;
  },
  asset: async p => {
    const b = readFileSync(join(here, '..', 'public', p.replace(/^\/+/, '')));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  },
  econ: () => [],
});

async function pool<T>(items: readonly T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

function table(label: string, wall: number, perName: Map<string, number>): void {
  const by = new Map<string, { n: number; ms: number; max: number; kb: number }>();
  for (const h of hits) {
    const row = by.get(h.kind) ?? { n: 0, ms: 0, max: 0, kb: 0 };
    row.n += 1;
    row.ms += h.ms;
    row.max = Math.max(row.max, h.ms);
    row.kb += h.bytes / 1024;
    by.set(h.kind, row);
  }
  console.log(`\n${label}: ${(wall / 1000).toFixed(1)} s wall, ${hits.length} requests`);
  console.log('kind | requests | total s | mean ms | max ms | KB');
  for (const [k, r] of [...by].sort((a, b) => b[1].ms - a[1].ms)) {
    console.log(`${k} | ${r.n} | ${(r.ms / 1000).toFixed(1)} | ${(r.ms / r.n).toFixed(0)} | ${r.max.toFixed(0)} | ${r.kb.toFixed(0)}`);
  }
  const slow = [...perName].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, ms]) => `${n} ${(ms / 1000).toFixed(1)} s`);
  console.log(`slowest names: ${slow.join(', ')}`);
}

async function pass(markAt: number, sleeve: 'odte' | 'weekly'): Promise<void> {
  hits = [];
  const names = sleeve === 'odte' ? odteBook(markAt).filter(t => optionScanOpen(t, 0, markAt)) : WEEKLY_FOCUS.filter(t => optionScanOpen(t, 1, markAt));
  const perName = new Map<string, number>();
  const t0 = performance.now();
  await pool(names, 6, async name => {
    const s0 = performance.now();
    current = name;
    const snap = await atMark(name, markAt, sleeve);
    if (snap.setups.length) await scoreBook(snap.setups, markAt, true, true);
    perName.set(name, performance.now() - s0);
  });
  table(`${sleeve} ${new Date(markAt).toISOString()} (${names.length} names)`, performance.now() - t0, perName);
}

const [hh, mm] = clock.split(':').map(Number);
const y = Number(isoDay.slice(0, 4));
const mo = Number(isoDay.slice(5, 7));
const d = Number(isoDay.slice(8, 10));
const first = nyWallTime(y, mo, d, hh, mm);
/* 'both' runs the two sleeves at once, as the live tick does (they share the request cap) */
async function both(markAt: number): Promise<void> {
  hits = [];
  const t0 = performance.now();
  const perName = new Map<string, number>();
  const run = async (sleeve: 'odte' | 'weekly') => {
    const names = sleeve === 'odte' ? odteBook(markAt).filter(t => optionScanOpen(t, 0, markAt)) : WEEKLY_FOCUS.filter(t => optionScanOpen(t, 1, markAt));
    await pool(names, 6, async name => {
      const s0 = performance.now();
      current = name;
      const snap = await atMark(name, markAt, sleeve);
      if (snap.setups.length) await scoreBook(snap.setups, markAt, true, true);
      perName.set(`${name}/${sleeve}`, performance.now() - s0);
    });
  };
  await Promise.all([run('odte'), run('weekly')]);
  table(`both sleeves at once ${new Date(markAt).toISOString()}`, performance.now() - t0, perName);
}
if (which === 'both') {
  await both(first);
  await both(first + 5 * 60_000);
} else {
  for (const sleeve of [which] as ('odte' | 'weekly')[]) {
    await pass(first, sleeve);
    await pass(first + 5 * 60_000, sleeve);
  }
}
/* the live path's own reads, once per name: the chain snapshot and the SPY trade snapshot */
hits = [];
const t0 = performance.now();
const live = odteBook(first);
await pool(live, 6, async name => {
  current = name;
  await fetch(`${BASE}/option/snapshot/greeks/first_order?symbol=${name}&expiration=*&right=both&strike_range=16&max_dte=0&format=json`).then(r => r.text()).catch(() => '');
});
console.log(`\nlive snapshot reads (not scored): ${live.length} names in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
process.exit(0);
