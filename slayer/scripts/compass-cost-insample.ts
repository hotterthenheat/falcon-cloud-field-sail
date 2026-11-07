/*
  IN-SAMPLE, recorded quotes: how many of the recorded Model 1 and Model 3 calls the cost-aware choice
  (data/compassCost.ts) would have called on a different contract, and what that did to their P&L. Not evidence of
  anything: the same few sessions, chosen after the fact, no holdout.

  For each call: the contracts its rule allowed at its mark, rebuilt from the engine's own scored-row log
  (<dir>/rows/YYYY-MM-DD.jsonl: every contract Model 1 scored at the mark, with the quote it read):
    Model 1 (books A, B): same root, expiry and side, cleared the line, in Model 1's trained quotes, within the
      near-the-money span (book B's far wing: beyond it, a wing by its delta, compassParams wingShape); Model 3 (book C):
      same root, same-day, same side, Model 3's live rule (lotteryEntry, or lotteryShape with COMPASS_M3_SHAPE=1), at the latest mark at or before the
      sweep. The scored-row log holds only contracts Model 1 could score, so Model 3's pool here misses the contracts
      outside Model 1's trained quotes: scripts/compass-limits-insample.ts rebuilds the whole chain from the terminal.
  The smallest-mu contract is picked (ATM IV from the mark's ATM pair, held to the call's flat). Where it differs, it is
  settled by the call's own rules on the terminal's recorded quotes (compassLedger settledCopy), and so is the call
  itself (to compare like with like); the recorded outcome is printed beside it.
    COMPASS_DIR=<the record> npx tsx scripts/compass-cost-insample.ts [--out file.json]
  Read-only on the record; one terminal request in flight.
*/
import { createReadStream, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { installTerminalHost, terminalReads } from './compassTerminal';
import { settledCopy, type Signal } from '../src/data/compassLedger';
import { atmIvOf, costPick, costRead, deltaOf, type CostQuote } from '../src/data/compassCost';
import { P1_MIN, SPAN_INDEX, inModel1Domain, lotteryEntry, lotteryShape, m3ShapeOn, runnerFlag, strikeDistance, strikeSpan, wingShape } from '../src/data/compassParams';
import { nyParts, nyWallTime } from '../src/core/nyTime';
import { sessionCloseMinOn } from '../src/core/calendar';
import type { OptionRight } from '../src/types/compass';

const dir = process.env.COMPASS_DIR;
if (!dir) throw new Error('COMPASS_DIR: the record');
installTerminalHost();

interface Row { m: number; q: number; k: string; e: string; b: number; a: number; s: number | null; p1: number | null; p2: number | null }
const days = readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map(f => f.slice(0, 10)).sort();
const calls = days.flatMap(d => ((JSON.parse(readFileSync(join(dir, `${d}.json`), 'utf8')) as { calls?: Signal[] }).calls ?? []).filter(c => c.book !== 'R'));

/** The scored rows of a day for the roots and marks the calls need (the files are large: streamed, filtered) */
async function rowsOf(day: string, want: Set<string>): Promise<Row[]> {
  const out: Row[] = [];
  let rl;
  try {
    rl = createInterface({ input: createReadStream(join(dir!, 'rows', `${day}.jsonl`)) });
  } catch {
    return out;
  }
  try {
    for await (const line of rl) {
      const k = /"k":"([^"]+)"/.exec(line)?.[1];
      if (!k || !want.has(k.split(' ')[0])) continue;
      const r = JSON.parse(line) as Row;
      out.push({ m: r.m, q: r.q, k: r.k, e: r.e, b: r.b, a: r.a, s: r.s, p1: r.p1, p2: r.p2 });
    }
  } catch {
    return out;
  }
  return out;
}

const parse = (k: string) => {
  const m = /^(\S+) ([\d.]+)([CP])$/.exec(k);
  return m ? { ticker: m[1], strike: Number(m[2]), right: m[3] as OptionRight } : null;
};

const results: Record<string, unknown>[] = [];
for (const day of days) {
  const mine = calls.filter(c => c.day === day);
  if (!mine.length) continue;
  const rows = await rowsOf(day, new Set(mine.map(c => c.ticker)));
  console.log(`${day}: ${mine.length} calls, ${rows.length} scored rows of their roots`);
  for (const call of mine.sort((a, b) => a.firedAt - b.firedAt)) {
    const markAt = call.mark ?? Math.floor(call.firedAt / 60_000) * 60_000;
    /* the mark the rule read: the call's own (Model 1), or the latest scored mark at or before the sweep (Model 3) */
    const marks = [...new Set(rows.filter(r => r.k.startsWith(`${call.ticker} `) && r.e === call.expiry && r.m <= markAt).map(r => r.m))].sort((a, b) => b - a);
    const m = call.book === 'C' ? marks[0] : marks.find(x => x === markAt);
    /* a mark can be scored more than once (a pass, then a late fill): one row a contract, the last quote read at or
       before the call */
    const latest = new Map<string, Row>();
    for (const r of rows) {
      if (r.m !== m || r.e !== call.expiry || !r.k.startsWith(`${call.ticker} `) || (r.q && r.q > call.firedAt + 1_000)) continue;
      const had = latest.get(r.k);
      if (!had || (r.q ?? 0) >= (had.q ?? 0)) latest.set(r.k, r);
    }
    const board = [...latest.values()];
    const spot = board.find(r => (r.s ?? 0) > 0)?.s ?? call.spot ?? 0;
    const quotes: (CostQuote & { k: string; p1: number | null; p2: number | null })[] = board.flatMap(r => {
      const c = parse(r.k);
      return c ? [{ ...c, bid: r.b, ask: r.a, expiryDate: r.e, k: r.k, p1: r.p1, p2: r.p2 }] : [];
    });
    const strikes = [...new Set(quotes.map(q => q.strike))];
    const index = (SPAN_INDEX as readonly string[]).includes(call.ticker);
    const span = strikeSpan(spot, strikes, index);
    const allowed = quotes.filter(q => {
      if (q.right !== call.right) return false;
      if (call.book === 'C') return m3ShapeOn() ? lotteryShape(q.bid, q.ask, deltaOf(q, spot, markAt)) : lotteryEntry(q.bid, q.ask);
      if (!(q.p1 != null && q.p1 + 1e-12 >= P1_MIN) || !inModel1Domain(q.bid, q.ask)) return false;
      const dist = strikeDistance(strikes, spot, q.strike);
      return call.book === 'A' ? dist <= span : dist > span && wingShape(deltaOf(q, spot, markAt));
    });
    const p = nyParts(markAt);
    const flatAt = call.book === 'C'
      ? nyWallTime(p.year, p.month, p.day, 0, sessionCloseMinOn(day) - 10)
      : call.flatAt ?? nyWallTime(p.year, p.month, p.day, 0, sessionCloseMinOn(day) - 5);
    const atm = atmIvOf(quotes, spot, markAt);
    const read = (q: CostQuote) => (atm ? costRead(q, { spot, atmIv: atm, at: markAt, flatAt }) : null);
    const pick = costPick(allowed, read);
    const own = allowed.find(q => q.k === call.contract);
    const row: Record<string, unknown> = {
      day, model: call.book === 'C' ? 'Model 3' : 'Model 1', call: call.contract, pool: allowed.length, ownInPool: !!own,
      recordedPnl: call.outcome?.pnl ?? null, recordedRet: call.outcome?.ret ?? null,
      ownMu: own ? read(own)?.mu ?? null : null, pick: pick?.pick.k ?? null, pickMu: pick?.read.mu ?? null,
    };
    if (!pick) {
      row.note = !board.length ? 'no scored rows at the mark' : !atm ? 'no ATM IV' : 'nothing readable';
    } else if (pick.pick.k === call.contract) {
      row.same = true;
    } else {
      row.same = false;
      const alt: Signal = {
        ...call, key: `${call.key}|cost`, id: `${call.id}|cost`, contract: pick.pick.k, strike: pick.pick.strike, bid: pick.pick.bid, ask: pick.pick.ask,
        runner: call.book === 'B' || (call.book === 'A' && pick.pick.p2 != null && runnerFlag(pick.pick.p2)), outcome: null, pathAt: 0, spark: [],
      };
      const again: Signal = { ...call, key: `${call.key}|again`, outcome: null, pathAt: 0, spark: [] };
      const settle = async (s: Signal) => {
        let cur = s;
        for (let i = 0; i < 8; i++) {
          const next = await settledCopy({ ...cur, pathAt: 0 }, Date.now());
          if (!next) break;
          cur = next;
          if (cur.outcome && (cur.outcome.status === 'closed' || cur.outcome.status === 'unavailable')) break;
        }
        return cur.outcome;
      };
      const a = await settle(alt);
      const b = await settle(again);
      Object.assign(row, {
        altStatus: a?.status ?? null, altFill: a?.fill?.ask ?? null, altExit: a?.exit?.px ?? null, altWhy: a?.exit?.why ?? null, altPnl: a?.pnl ?? null, altRet: a?.ret ?? null,
        callAgainPnl: b?.pnl ?? null, callAgainRet: b?.ret ?? null,
      });
    }
    results.push(row);
    console.log(JSON.stringify(row));
  }
}

const changed = results.filter(r => r.same === false && r.altStatus === 'closed' && r.callAgainPnl != null);
const sum = (k: string) => changed.reduce((s, r) => s + Number(r[k] ?? 0), 0);
const by = (model: string) => {
  const rs = results.filter(r => r.model === model);
  const ch = changed.filter(r => r.model === model);
  return {
    calls: rs.length, read: rs.filter(r => r.pick).length, same: rs.filter(r => r.same === true).length, different: rs.filter(r => r.same === false).length,
    settledBoth: ch.length,
    callPnl: Math.round(ch.reduce((s, r) => s + Number(r.callAgainPnl), 0) * 100) / 100,
    altPnl: Math.round(ch.reduce((s, r) => s + Number(r.altPnl), 0) * 100) / 100,
    callRetMean: ch.length ? ch.reduce((s, r) => s + Number(r.callAgainRet), 0) / ch.length : null,
    altRetMean: ch.length ? ch.reduce((s, r) => s + Number(r.altRet), 0) / ch.length : null,
    altWon: ch.filter(r => Number(r.altPnl) > 0).length, callWon: ch.filter(r => Number(r.callAgainPnl) > 0).length,
  };
}
const summary = { inSample: true, note: 'IN-SAMPLE on recorded quotes; no holdout; not evidence', calls: results.length, model1: by('Model 1'), model3: by('Model 3'), changedCallPnl: sum('callAgainPnl'), changedAltPnl: sum('altPnl'), terminalReads };
console.log(JSON.stringify(summary, null, 2));
const outAt = process.argv.indexOf('--out');
if (outAt > 0) writeFileSync(process.argv[outAt + 1], JSON.stringify({ summary, results }, null, 2));
process.exit(0);
