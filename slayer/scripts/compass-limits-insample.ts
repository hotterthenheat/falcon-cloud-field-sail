/*
  IN-SAMPLE, recorded quotes: what removing the fixed price and spread limits (2026-11-07) does to the contract choice
  on every recorded call, and to its P&L. Not evidence of anything: a handful of sessions, read after the fact, no
  holdout, one contract a call.

  Before = the rules as they stood on main (cb58b60): Model 3's bid over $0.15, spread within 8% and ask of $1.65 or
  less; the wing's ask of $1 or less; Model Risk's bid over $0.15, spread within 8% (then 4%) and $5 single-name cap,
  ranked by gamma over theta; the cost rule (smallest mu) among what each allowed.
  After = this branch: validity checks only (two-sided, size shown), Model 1's trained quotes for Model 1 alone, the
  wing and Model 3 by their delta, Model Risk by the cost rule.

    Model 1 (book A): the pool at the call's mark from the engine's scored-row log (<dir>/rows), as
      scripts/compass-cost-insample.ts reads it; before and after picked on the same rows.
    Model 1 (book B, the wing): no wing call is in the record. The scored-row log is searched for contracts a wing would
      now take that the $1 cap shut out (band, over the line, in Model 1's quotes, half the ask of 30 minutes earlier
      in the log), and the first one a root and day, not already called that day, is settled as a would-be call.
    Model 3 (book C) and Model Risk (book R): the whole chain at the call's minute from the terminal's recorded quotes
      (the scored-row log holds only what Model 1 could score), before and after picked on the same chain. A changed
      pick is settled by the call's own rules on the recorded quotes, and so is the recorded contract again (like with
      like): Model 3 by compassLedger settledCopy, Model Risk at the recorded exit minute (the fade's exit is the
      stock's, the same whichever contract).
    COMPASS_DIR=<a copy of the record> npx tsx scripts/compass-limits-insample.ts [--out file.json]
  Read-only on the record; one terminal request in flight, at least 100 ms apart.
*/
import { createReadStream, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { installTerminalHost, terminalReads } from './compassTerminal';
import { compassHost } from '../src/data/compassHost';
import { settledCopy, type Signal } from '../src/data/compassLedger';
import { atmIvOf, costPick, costRead, deltaOf, lotterySide, type CostQuote } from '../src/data/compassCost';
import {
  CLS_INDEX, P1_MIN, SPAN_INDEX, bookBRange, inModel1Domain, quoteTradable, sizeShown, spreadPass, strikeDistance, strikeSpan, wingShape, weekdayDte,
} from '../src/data/compassParams';
import { betterRank, contractRank, rankMinute, tailPick, TAIL_MONEY } from '../src/data/modelRisk';
import { nyParts, nyWallStamp, nyWallTime } from '../src/core/nyTime';
import { sessionCloseMinOn } from '../src/core/calendar';
import type { OptionRight } from '../src/types/compass';

const dir = process.env.COMPASS_DIR;
if (!dir) throw new Error('COMPASS_DIR: a copy of the record');
installTerminalHost();

type Q = CostQuote & { k: string; bidSize?: number; askSize?: number; p1?: number | null; p2?: number | null };
interface Row { m: number; q: number; k: string; e: string; b: number; a: number; s: number | null; p1: number | null; p2: number | null }
const days = readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map(f => f.slice(0, 10)).sort();
const calls = days.flatMap(d => ((JSON.parse(readFileSync(join(dir, `${d}.json`), 'utf8')) as { calls?: Signal[] }).calls ?? []));
const parse = (k: string) => {
  const m = /^(\S+) ([\d.]+)([CP])$/.exec(k);
  return m ? { ticker: m[1], strike: Number(m[2]), right: m[3] as OptionRight } : null;
};
const word = (root: string, K: number, right: OptionRight) => `${root} ${K % 1 === 0 ? K.toFixed(0) : K.toFixed(2)}${right}`;
const ymdOf = (iso: string) => iso.replace(/-/g, '').slice(0, 8);
const hm = (ms: number) => {
  const p = nyParts(ms);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:00`;
};
const r2 = (v: number) => Math.round(v * 100) / 100;

/** The whole recorded chain of one expiry at one minute (both sides, or one), from the terminal, `range` strikes either
    side of `spot`. The terminal centres strike_range on the underlying as it is now, not as it was then (a chain read a
    day later for QQQ at 652 came back 668 and up), so the ask is wide and the strikes are kept here around the spot. */
async function chainAt(root: string, expiry: string, at: number, range: number, spot: number, right?: OptionRight): Promise<Q[]> {
  const p = nyParts(at);
  const nyDay = `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`;
  const side = right ? `&right=${right === 'C' ? 'call' : 'put'}` : '';
  const got = await compassHost().theta(`/option/history/quote?symbol=${encodeURIComponent(root)}&expiration=${ymdOf(expiry)}&start_date=${nyDay}&end_date=${nyDay}&strike_range=${Math.max(80, range * 5)}${side}&interval=1m&start_time=${hm(at)}&end_time=${hm(at)}&format=json`);
  const out: Q[] = [];
  for (const item of Array.isArray(got.data) ? got.data : []) {
    const row = item as { contract?: Record<string, unknown>; data?: Record<string, unknown>[] };
    const c = row.contract ?? {};
    const strike = Number(c.strike);
    const rt = String(c.right ?? '').toUpperCase().startsWith('C') ? 'C' : 'P';
    const q = (row.data ?? []).filter(d => nyWallStamp(d.timestamp) <= at + 59_000).pop();
    if (!q || !(strike > 0)) continue;
    out.push({ k: word(root, strike, rt), strike, right: rt, bid: Number(q.bid), ask: Number(q.ask), expiryDate: expiry.slice(0, 10), bidSize: q.bid_size == null ? undefined : Number(q.bid_size), askSize: q.ask_size == null ? undefined : Number(q.ask_size) });
  }
  const strikes = [...new Set(out.map(q => q.strike))].sort((a, b) => a - b);
  let atm = 0;
  strikes.forEach((k, i) => {
    if (Math.abs(k - spot) < Math.abs(strikes[atm] - spot)) atm = i;
  });
  const keep = new Set(strikes.filter((_, i) => Math.abs(i - atm) <= range));
  return out.filter(q => keep.has(q.strike));
}

async function settle(s: Signal) {
  let cur = s;
  for (let i = 0; i < 8; i++) {
    const next = await settledCopy({ ...cur, pathAt: 0 }, Date.now());
    if (!next) break;
    cur = next;
    if (cur.outcome && (cur.outcome.status === 'closed' || cur.outcome.status === 'unavailable')) break;
  }
  return cur.outcome;
}

/** The scored rows of a day (the files are large: streamed) */
async function rowsOf(day: string, want?: Set<string>): Promise<Row[]> {
  const out: Row[] = [];
  try {
    const rl = createInterface({ input: createReadStream(join(dir!, 'rows', `${day}.jsonl`)) });
    for await (const line of rl) {
      const k = /"k":"([^"]+)"/.exec(line)?.[1];
      if (!k || (want && !want.has(k.split(' ')[0]))) continue;
      const r = JSON.parse(line) as Row;
      out.push({ m: r.m, q: r.q, k: r.k, e: r.e, b: r.b, a: r.a, s: r.s, p1: r.p1, p2: r.p2 });
    }
  } catch {
    /* no log that day */
  }
  return out;
}

const results: Record<string, unknown>[] = [];
const wingRows: Record<string, unknown>[] = [];
const budget: Record<string, unknown>[] = [];

for (const day of days) {
  const mine = calls.filter(c => c.day === day && !c.would).sort((a, b) => a.firedAt - b.firedAt);
  const rows = await rowsOf(day);
  if (!mine.length && !rows.length) continue;
  console.log(`${day}: ${mine.length} calls, ${rows.length} scored rows`);
  const p0 = nyParts(Date.parse(`${day}T17:00:00Z`));
  const regularFlat = nyWallTime(p0.year, p0.month, p0.day, 0, sessionCloseMinOn(day) - 5);
  const sweepFlat = nyWallTime(p0.year, p0.month, p0.day, 0, sessionCloseMinOn(day) - 10);

  for (const call of mine) {
    const markAt = call.mark ?? Math.floor(call.firedAt / 60_000) * 60_000;
    const recorded = { day, model: call.book === 'C' ? 'Model 3' : call.book === 'R' ? 'Model Risk' : 'Model 1', call: call.contract, ask: call.ask, recordedPnl: call.outcome?.pnl ?? null };
    if (call.ask * 100 > 500) budget.push({ ...recorded, perContract: r2(call.ask * 100) });

    if (call.book === 'A' || call.book === 'B') {
      const latest = new Map<string, Row>();
      for (const r of rows) {
        if (r.m !== markAt || r.e !== call.expiry || !r.k.startsWith(`${call.ticker} `) || (r.q && r.q > call.firedAt + 1_000)) continue;
        const had = latest.get(r.k);
        if (!had || (r.q ?? 0) >= (had.q ?? 0)) latest.set(r.k, r);
      }
      const board: Q[] = [...latest.values()].flatMap(r => {
        const c = parse(r.k);
        return c ? [{ k: r.k, strike: c.strike, right: c.right, bid: r.b, ask: r.a, expiryDate: r.e, p1: r.p1, p2: r.p2 }] : [];
      });
      const spot = [...latest.values()].find(r => (r.s ?? 0) > 0)?.s ?? call.spot ?? 0;
      const strikes = [...new Set(board.map(q => q.strike))];
      const span = strikeSpan(spot, strikes, (SPAN_INDEX as readonly string[]).includes(call.ticker));
      const atm = atmIvOf(board, spot, markAt);
      const flatAt = call.flatAt ?? regularFlat;
      const read = (q: Q) => (atm ? costRead(q, { spot, atmIv: atm, at: markAt, flatAt }) : null);
      const pool = (after: boolean) => board.filter(q => {
        if (q.right !== call.right || !(q.p1 != null && q.p1 + 1e-12 >= P1_MIN)) return false;
        if (after ? !(quoteTradable(q.bid, q.ask) && inModel1Domain(q.bid, q.ask)) : !spreadPass(q.bid, q.ask)) return false;
        const dist = strikeDistance(strikes, spot, q.strike);
        return call.book === 'A' ? dist <= span : dist > span && (after ? wingShape(deltaOf(q, spot, markAt)) : q.ask <= 1);
      });
      const before = costPick(pool(false), read)?.pick ?? null;
      const after = costPick(pool(true), read)?.pick ?? null;
      results.push({ ...recorded, source: board.length ? 'scored rows' : 'no rows at the mark', poolBefore: pool(false).length, poolAfter: pool(true).length, before: before?.k ?? null, after: after?.k ?? null, same: before && after ? before.k === after.k : null, recordedIsBefore: before?.k === call.contract });
      console.log(JSON.stringify(results[results.length - 1]));
      continue;
    }

    if (call.book === 'C') {
      /* the sweep's own minute (a late sweep fired after it, from the quotes at it) */
      const spot = call.spot ?? 0;
      const chain = await chainAt(call.ticker, call.expiry, markAt, 16, spot);
      const atm = atmIvOf(chain.filter(q => quoteTradable(q.bid, q.ask)), spot, markAt);
      const read = (q: Q) => (atm ? costRead(q, { spot, atmIv: atm, at: markAt, flatAt: sweepFlat }) : null);
      /* before: the old entry (bid over 0.15, spread within 8%, ask 1.65 or less), the nearest strike's side */
      const oldOk = (q: Q) => q.bid > 0.15 && q.ask > 0 && q.ask <= 1.65 && q.ask >= q.bid && spreadPass(q.bid, q.ask);
      const old = chain.filter(oldOk);
      const oldStrikes = [...new Set(old.map(q => q.strike))];
      old.sort((a, b) => strikeDistance(oldStrikes, spot, a.strike) - strikeDistance(oldStrikes, spot, b.strike) || a.strike - b.strike || (a.right === 'C' ? -1 : 1));
      const oldSide = old.filter(q => q.right === old[0]?.right);
      const before = (costPick(oldSide, read)?.pick ?? oldSide[0]) || null;
      const newSide = lotterySide(chain.filter(q => quoteTradable(q.bid, q.ask) && sizeShown(q.bidSize, q.askSize)), spot, markAt);
      const after = (costPick(newSide, read)?.pick ?? newSide[0]) || null;
      const row: Record<string, unknown> = {
        ...recorded, source: `terminal chain (${chain.length})`, before: before?.k ?? null, after: after?.k ?? null, same: before && after ? before.k === after.k : null, recordedIsBefore: before?.k === call.contract,
        afterAsk: after?.ask ?? null, afterDelta: after ? r2(deltaOf(after, spot, markAt) * 1000) / 1000 : null, afterOldExcluded: !!after && !oldOk(after),
      };
      if (after && before && after.k !== before.k) {
        const asSignal = (q: Q, tag: string): Signal => ({ ...call, key: `${call.key}|${tag}`, id: `${call.id}|${tag}`, contract: q.k, strike: q.strike, right: q.right, bid: q.bid, ask: q.ask, outcome: null, pathAt: 0, spark: [] });
        const a = await settle(asSignal(after, 'after'));
        const b = await settle(asSignal(before, 'before'));
        Object.assign(row, { afterStatus: a?.status ?? null, afterPnl: a?.pnl ?? null, afterWhy: a?.exit?.why ?? null, beforeStatus: b?.status ?? null, beforePnl: b?.pnl ?? null });
      }
      results.push(row);
      console.log(JSON.stringify(row));
      continue;
    }

    if (call.book === 'R') {
      const root = call.contract.split(' ')[0];
      const entryAt = call.outcome?.fill?.at ?? call.quoteAt ?? call.firedAt;
      const exitAt = call.outcome?.exit?.at ?? null;
      const spot = call.spot ?? 0;
      const chain = (await chainAt(root, call.expiry, entryAt, 12, spot, call.right)).filter(q => q.right === call.right);
      const strikes = [...new Set(chain.map(q => q.strike))].sort((a, b) => a - b);
      const index = (CLS_INDEX as readonly string[]).includes(call.ticker) || (CLS_INDEX as readonly string[]).includes(root);
      const span = strikeSpan(spot, strikes, index);
      const p = nyParts(entryAt);
      const minute = p.hour * 60 + p.minute;
      const dte = weekdayDte(day.replace(/-/g, ''), ymdOf(call.expiry));
      const ranked = chain.map(q => ({ q, rank: contractRank(spot, q.strike, rankMinute(minute), dte, (q.bid + q.ask) / 2, call.right === 'C'), dist: Math.abs(q.strike - spot) / spot }))
        .filter(x => x.rank && strikeDistance(strikes, spot, x.q.strike) <= span + 1e-9 && x.dist <= TAIL_MONEY + 1e-12);
      const INDEX_ROOTS = new Set(['SPX', 'SPY', 'QQQ', 'IWM', 'RUT', 'NDX', 'VIX', 'XSP', 'DJX', 'SPXW', 'RUTW', 'NDXP']);
      const capped = !INDEX_ROOTS.has(call.ticker) && !INDEX_ROOTS.has(root);
      const oldOk = (q: Q) => spreadPass(q.bid, q.ask) && (q.ask - q.bid) / ((q.ask + q.bid) / 2) <= 0.04 + 1e-12 && !(capped && q.ask >= 5);
      let before: Q | null = null;
      let bestRank: { score: number; dist: number } | null = null;
      for (const x of ranked.filter(x => oldOk(x.q))) {
        if (!bestRank || betterRank(x.rank!.score, x.dist, bestRank.score, bestRank.dist)) {
          before = x.q;
          bestRank = { score: x.rank!.score, dist: x.dist };
        }
      }
      const allowed = ranked.filter(x => quoteTradable(x.q.bid, x.q.ask) && sizeShown(x.q.bidSize, x.q.askSize)).sort((a, b) => a.dist - b.dist).map(x => x.q);
      const after = tailPick(allowed, call.right, call.expiry, spot, entryAt)?.leg ?? null;
      const row: Record<string, unknown> = {
        ...recorded, source: `terminal chain (${chain.length})`, before: before?.k ?? null, after: after?.k ?? null, same: before && after ? before.k === after.k : null, recordedIsBefore: before?.k === call.contract,
        afterAsk: after?.ask ?? null, afterOldExcluded: !!after && !oldOk(after),
      };
      if ((after || before) && exitAt && !(before && after && before.k === after.k)) {
        const exitChain = (await chainAt(root, call.expiry, exitAt, 12, spot, call.right));
        const pnlOf = (q: Q | null) => {
          const b = q ? exitChain.find(x => x.strike === q.strike)?.bid : undefined;
          return q && b != null ? r2((b - q.ask) * 100) : null;
        };
        const own = chain.find(q => q.k === call.contract) ?? null;
        Object.assign(row, { beforePnl: pnlOf(before), afterPnl: pnlOf(after), recordedAgainPnl: pnlOf(own) });
      } else if (before && after) {
        row.note = 'same contract: same P&L';
      }
      results.push(row);
      console.log(JSON.stringify(row));
    }
  }

  /* Book B: wings the $1 cap shut out, from the scored-row log */
  const byMark = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.m}|${r.k.split(' ')[0]}|${r.e}`;
    const l = byMark.get(key) ?? [];
    l.push(r);
    byMark.set(key, l);
  }
  const seenRoot = new Set(mine.filter(c => c.book === 'A' || c.book === 'B').map(c => c.ticker));
  const firstNew = new Map<string, { at: number; q: Q; spot: number; atm: number | null; root: string }>();
  let newOnly = 0;
  let oldAlso = 0;
  const priorOf = new Map<string, Row>();
  for (const r of rows) priorOf.set(`${r.m}|${r.k}|${r.e}`, r);
  for (const [key, list] of [...byMark].sort((a, b) => Number(a[0].split('|')[0]) - Number(b[0].split('|')[0]))) {
    const [mStr, root] = key.split('|');
    const m = Number(mStr);
    const last = new Map<string, Row>();
    for (const r of list) last.set(r.k, r);
    const board = [...last.values()];
    const spot = board.find(r => (r.s ?? 0) > 0)?.s ?? 0;
    if (!(spot > 0)) continue;
    const qs: Q[] = board.flatMap(r => {
      const c = parse(r.k);
      return c ? [{ k: r.k, strike: c.strike, right: c.right, bid: r.b, ask: r.a, expiryDate: r.e, p1: r.p1, p2: r.p2 }] : [];
    });
    const strikes = [...new Set(qs.map(q => q.strike))];
    const span = strikeSpan(spot, strikes, (SPAN_INDEX as readonly string[]).includes(root));
    const band = bookBRange(span);
    for (const q of qs) {
      if (!(q.p1 != null && q.p1 + 1e-12 >= P1_MIN) || !inModel1Domain(q.bid, q.ask)) continue;
      const dist = strikeDistance(strikes, spot, q.strike);
      if (!(dist >= band.inner && dist <= band.outer)) continue;
      const prior = priorOf.get(`${m - 30 * 60_000}|${q.k}|${q.expiryDate}`);
      if (!prior || !(q.ask <= 0.5 * prior.a)) continue;
      const isNew = wingShape(deltaOf(q, spot, m));
      const isOld = q.ask <= 1;
      if (isOld) oldAlso += 1;
      if (isNew && !isOld) {
        newOnly += 1;
        if (!seenRoot.has(root) && !firstNew.has(root)) firstNew.set(root, { at: m, q, spot, atm: atmIvOf(qs, spot, m), root });
      }
    }
  }
  const template = mine.find(c => c.book === 'A') ?? calls.find(c => c.book === 'A');
  for (const w of firstNew.values()) {
    const row: Record<string, unknown> = { day, root: w.root, contract: w.q.k, ask: w.q.ask, at: new Date(w.at).toISOString(), delta: r2(deltaOf(w.q, w.spot, w.at) * 1000) / 1000 };
    if (template) {
      const sig: Signal = {
        ...template, key: `${day}|wing|${w.q.k}`, id: `${day}|wing|${w.q.k}`, day, book: 'B', ticker: w.root, contract: w.q.k, right: w.q.right, strike: w.q.strike, expiry: w.q.expiryDate,
        firedAt: w.at, quoteAt: w.at, mark: w.at, bid: w.q.bid, ask: w.q.ask, spot: w.spot, p1: w.q.p1 ?? null, prun: w.q.p2 ?? null, runner: true, outcome: null, pathAt: 0, spark: [], flatAt: regularFlat, cost: undefined, would: undefined,
      };
      const o = await settle(sig);
      Object.assign(row, { status: o?.status ?? null, pnl: o?.pnl ?? null, why: o?.exit?.why ?? null });
    }
    wingRows.push(row);
    console.log('wing', JSON.stringify(row));
  }
  console.log(`${day}: wing candidates (line, band, Model 1 quotes, halved): $1 cap passed ${oldAlso}; delta wing only (the cap shut them out) ${newOnly}`);
  results.push({ day, model: 'Model 1 wing (log)', oldAlso, newOnly });
}

const by = (model: string) => {
  const rs = results.filter(r => r.model === model && 'same' in r);
  const ch = rs.filter(r => r.same === false);
  const unbuilt = rs.filter(r => r.same == null).length;
  const settled = ch.filter(r => r.afterPnl != null && r.beforePnl != null);
  return {
    calls: rs.length, notRebuilt: unbuilt, same: rs.filter(r => r.same === true).length, changed: ch.length,
    changedToOldExcluded: ch.filter(r => r.afterOldExcluded === true).length,
    settledBoth: settled.length,
    beforePnl: r2(settled.reduce((s, r) => s + Number(r.beforePnl), 0)),
    afterPnl: r2(settled.reduce((s, r) => s + Number(r.afterPnl), 0)),
    afterWon: settled.filter(r => Number(r.afterPnl) > 0).length, beforeWon: settled.filter(r => Number(r.beforePnl) > 0).length,
  };
};
const summary = {
  inSample: true, note: 'IN-SAMPLE on recorded quotes; a handful of sessions, no holdout, one contract a call; not evidence',
  model1: by('Model 1'), model3: by('Model 3'), modelRisk: by('Model Risk'),
  wing: { wouldCalls: wingRows.length, settled: wingRows.filter(r => r.status === 'closed').length, pnl: r2(wingRows.reduce((s, r) => s + Number(r.pnl ?? 0), 0)), rows: wingRows },
  overBudget500: budget, terminalReads,
};
console.log(JSON.stringify(summary, null, 2));
const outAt = process.argv.indexOf('--out');
if (outAt > 0) writeFileSync(process.argv[outAt + 1], JSON.stringify({ summary, results }, null, 2));
process.exit(0);
