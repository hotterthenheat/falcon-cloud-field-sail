/*
  Live sanity run for the flow analytics (flowRolls, flowRepeats, darkBaseline) against the running app server's
  Unusual Whales proxy. Not part of CI: it needs the server and spends vendor calls (one at a time).
  Run:  npx tsx scripts/flow-analytics-live.ts [SPY,NVDA,TSLA] [session YYYY-MM-DD] [tape|dark|all] [HH:MM]
  Writes the raw rows it read to /tmp/flow-live/ so the spot-checks can be done by hand.
*/
import { mkdirSync, writeFileSync } from 'node:fs';
import { detectRolls, printsOfRows } from '../src/data/flowRolls';
import { detectRepeats } from '../src/data/flowRepeats';
import { loadDarkBaseline } from '../src/data/darkBaseline';
import { nyWallTime } from '../src/core/nyTime';
import { rowsOf } from '../src/data/traceLive';

const BASE = process.env.FLOW_UW_BASE ?? 'http://127.0.0.1:8080/api/uw';
const names = (process.argv[2] ?? 'SPY,NVDA,TSLA').split(',');
const session = process.argv[3] ?? '2026-10-30';
/** 'tape', 'dark' or both (default) */
const parts = process.argv[4] ?? 'all';
/** New York clock the name tape is walked back from, HH:MM */
const [fromH, fromM] = (process.argv[5] ?? '15:00').split(':').map(Number);
const OUT = '/tmp/flow-live';
mkdirSync(OUT, { recursive: true });

let calls = 0;
async function get(path: string): Promise<unknown> {
  for (let attempt = 0; attempt < 5; attempt++) {
    calls++;
    const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' } });
    if (res.status === 429 || res.status >= 500) {
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    return res.json();
  }
  throw new Error(`no answer ${path}`);
}

const [y, m, d] = session.split('-').map(Number);
/** The name's tape walked back from an instant, `pages` pages of 500 */
async function tape(q: string, fromMs: number, pages: number): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let older = fromMs;
  for (let i = 0; i < pages; i++) {
    const rows = rowsOf(await get(`/option-trades?limit=500&${q}&older_than=${older}`));
    out.push(...rows);
    if (rows.length < 500) break;
    const oldest = Math.min(...rows.map(r => Date.parse(String(r.executed_at))));
    if (!(oldest < older)) break;
    older = oldest;
  }
  return out;
}

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false });
for (const t of parts === 'dark' ? [] : names) {
  const rows = await tape(`ticker_symbol=${t}`, nyWallTime(y, m, d, fromH, fromM), 6);
  writeFileSync(`${OUT}/${t}-tape-${fromH}${fromM}.json`, JSON.stringify(rows));
  const prints = printsOfRows(rows);
  const span = prints.length ? `${hhmm(Math.min(...prints.map(p => p.epochMs!)))}–${hhmm(Math.max(...prints.map(p => p.epochMs!)))}` : '—';
  const rr = detectRolls(prints);
  console.log(`\n== ${t} tape ${prints.length} prints (${rows.length - prints.length} cancelled) ${span} ET`);
  console.log(`rolls: ${rr.rolls.length} (tagged ${rr.rolls.filter(r => r.confidence === 'tagged').length}, inferred ${rr.rolls.filter(r => r.confidence === 'inferred').length}), legs excluded ${rr.excludeIds.size}`);
  for (const r of rr.rolls.slice(0, 6)) console.log(`  ${hhmm(r.ts)} ${r.confidence} ${r.kind} ${r.holder} ${r.from.contract}(${r.from.side} ${r.from.size}) → ${r.to.contract}(${r.to.side} ${r.to.size}) net ${r.netPremium.toFixed(0)} gap ${r.gapMs}ms ids ${[...r.from.printIds, ...r.to.printIds].join(',')}`);
  /* repeats: the tape above, and the day's heaviest contract walked back from 15:00 */
  const rp = detectRepeats(prints, { exclude: rr.excludeIds });
  console.log(`repeat clusters (name tape): ${rp.clusters.length}, strips ${rp.strips.length}`);
  const top = rowsOf(await get(`/screener/option-contracts?ticker_symbol=${t}&limit=1&order=premium&order_direction=desc`))[0];
  const occ = top ? String(top.option_symbol) : '';
  if (occ) {
    const crows = await tape(`option_contracts[]=${occ}`, nyWallTime(y, m, d, 16, 15), 4);
    writeFileSync(`${OUT}/${t}-${occ}.json`, JSON.stringify(crows));
    const cp = printsOfRows(crows);
    const cr = detectRepeats(cp);
    console.log(`top contract ${occ}: ${cp.length} prints ${cp.length ? `${hhmm(Math.min(...cp.map(p => p.epochMs!)))}–${hhmm(Math.max(...cp.map(p => p.epochMs!)))}` : ''}, clusters ${cr.clusters.length}`);
    for (const c of cr.clusters.slice(0, 5)) console.log(`  ${c.side} ${c.hits} hits ${hhmm(c.firstTs)}–${hhmm(c.lastTs)} size ${c.totalSize} prem ${c.totalPremium.toFixed(0)} median ${c.medianSize} fillPos ${c.avgFillPos.toFixed(3)} sweep ${c.sweepShare.toFixed(3)} ids ${c.prints.slice(0, 8).join(',')}${c.prints.length > 8 ? '…' : ''}`);
  }
  for (const c of rp.clusters.slice(0, 4)) console.log(`  [tape] ${c.contract} ${c.side} ${c.hits} hits ${hhmm(c.firstTs)}–${hhmm(c.lastTs)} size ${c.totalSize} median ${c.medianSize}`);
}

for (const t of parts === 'tape' ? [] : names) {
  const b = await loadDarkBaseline(get, t, session);
  writeFileSync(`${OUT}/${t}-dark.json`, JSON.stringify(b, null, 1));
  const f = (v: number | null, k = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(k));
  console.log(`\n== ${t} dark ${session}: floor $${b.floorUsd.toFixed(0)}`);
  console.log(`  share today ${f(b.share.today)}% vs ${b.share.n} sessions mean ${f(b.share.mean)} sd ${f(b.share.sd)} → z ${f(b.share.z)} pct ${f(b.share.percentile, 1)} ${b.share.status}`);
  console.log(`  posture today ${f(b.posture.today)} (${b.today.postureRead} read, ${b.posture.todayPosture ?? 'none'}) vs ${b.posture.n} sessions mean ${f(b.posture.mean)} sd ${f(b.posture.sd)} → z ${f(b.posture.z)} pct ${f(b.posture.percentile, 1)} ${b.posture.status}`);
  console.log(`  coverage: asked ${b.coverage.asked.length} (${b.coverage.asked.at(-1)}…${b.coverage.asked[0]}), share ${b.coverage.withShare.length}, posture ${b.coverage.withPosture.length}, missing ${b.coverage.missing.join(',') || 'none'}`);
}
console.log(`\nvendor calls: ${calls}`);
