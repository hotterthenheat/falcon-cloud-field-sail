/*
  Terrain's Net flow room (src/pages/terrain/dock/flowRoomSeries.ts): the call and put lines are the chart's own flow
  arithmetic (data/flowBuckets.ts signedFlowBars) split by the contract's side, held to the recorded tape.

  Fixture: scripts/fixtures/tape/spx-options-2026-10-30-1500.csv (the terminal's /option/history/trade_quote, SPX,
  15:00–15:14:59 on Fri 2026-10-30, recorded 2026-10-31) — the same window scripts/flow-tags-proof.ts recounts.
  Checks:
    1. call line − put line at the window's end equals the Net drift's sum (signedFlowBars over every print) — legs out
       and legs in;
    2. each line equals a by-hand recount off the wire rows (a call bought at the ask or sold at the bid, opening only;
       a put bought counts UP on the put line);
    3. the volume floor is every passing print's contracts in its minute, leaning or not;
    4. one point a minute, the price off the closes given, nothing drawn before the window.
  Run:  npx tsx scripts/flow-room-proof.ts
*/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ingestOptions, ingestSpot, newOptionTape, readOi } from '../src/data/tapeServer';
import { rowOfCell, rowOfPrint, type TapeRow } from '../src/data/tapeRows';
import { legsInNet, passesFlow, signedFlowBars } from '../src/data/flowBuckets';
import { tagsOfBits } from '../src/data/printTags';
import type { FlowFilters } from '../src/data/deskPrefs';
import { flowRoomSeries, lastPrintMinute } from '../src/pages/terrain/dock/flowRoomSeries';
import { nyInstant } from '../shared/marketSession.mjs';
import { REGULAR_CLOSE_MIN, REGULAR_OPEN_MIN } from '../src/core/session';

let fail = 0;
const check = (what: string, ok: boolean) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};
const FIX = join(import.meta.dirname, 'fixtures', 'tape');
const read = (f: string) => readFileSync(join(FIX, f), 'utf8');

const DAY = '2026-10-30';
const open = nyInstant(DAY, REGULAR_OPEN_MIN);
/* SPX's options trade to 16:15 */
const close = nyInstant(DAY, REGULAR_CLOSE_MIN + 15);
const spx = newOptionTape('SPX', DAY, open, close);
const root = spx.roots.findIndex(r => r.root === 'SPX');
spx.roots[root].oi = readOi(read('spx-oi-2026-10-30.csv'));
ingestSpot(spx, read('spx-1m-2026-10-30-1500.csv'));
ingestOptions(spx, root, read('spx-options-2026-10-30-1500.csv'));
const rows: TapeRow[] = [...spx.prints.map(p => rowOfPrint('SPX', p)), ...spx.cellList.map((c, i) => rowOfCell('SPX', c, i))];

const from = nyInstant(DAY, 900) / 1000;
const to = nyInstant(DAY, 915) / 1000;
const ANY: FlowFilters = { leg: 'single', mny: 'all', side: 'all', kind: 'all', dte: 'all', prem: 'all' };

/* by hand off the wire rows: [3] the right's side code, [8] the side, [12] opened, [9] the type bits; cells [2] side, [3] right, [8] premium */
const isCall = (r: number) => r === 1;
const handLine = (call: boolean, keep: (bits: number) => boolean) => {
  let sum = 0;
  for (const p of spx.prints) {
    if (p[8] === 0 || p[12] !== 1 || !keep(p[9]) || isCall(p[3]) !== call) continue;
    const prem = p[4] * p[5] * 100;
    /* sign on the tape: the side code equals the right's for a call at the ask or a put at the bid */
    const tape = p[3] === p[8] ? 1 : -1;
    sum += call ? tape * prem : -tape * prem;
  }
  for (const c of spx.cellList) {
    if (!keep(c[1]) || isCall(c[3]) !== call) continue;
    const tape = c[3] === c[2] ? 1 : -1;
    sum += call ? tape * c[8] : -tape * c[8];
  }
  return sum;
};
const isLeg = (b: number) => tagsOfBits(b).leg;

for (const [label, f, keep] of [
  ['legs out', ANY, (b: number) => !isLeg(b)],
  ['legs in', { ...ANY, leg: 'all' } as FlowFilters, () => true],
] as const) {
  const pass = rows.filter(p => passesFlow(p, f));
  const legs = legsInNet(f);
  const pts = flowRoomSeries(pass, from, to, legs);
  const end = pts[pts.length - 1];
  const drift = signedFlowBars(pass, pts.map(p => p.time), 60, legs).reduce((a, b) => a + b.net, 0);
  check(`${label}: call line − put line ($${Math.round(end.callPrem - end.putPrem).toLocaleString()}) is the Net drift's sum ($${Math.round(drift).toLocaleString()})`, Math.abs(end.callPrem - end.putPrem - drift) < 1);
  const hc = handLine(true, keep);
  const hp = handLine(false, keep);
  check(`${label}: net calls $${Math.round(end.callPrem).toLocaleString()} vs by hand $${Math.round(hc).toLocaleString()}`, Math.abs(end.callPrem - hc) < 1);
  check(`${label}: net puts $${Math.round(end.putPrem).toLocaleString()} vs by hand $${Math.round(hp).toLocaleString()}`, Math.abs(end.putPrem - hp) < 1);
  /* legs out, no single put in this window leaned (opened at a side): the put line stays at zero, the call line moves */
  check(`${label}: the lines move in the window (not a flat zero)`, label === 'legs out' ? Math.abs(end.callPrem) > 1000 : Math.abs(end.callPrem) > 1000 && Math.abs(end.putPrem) > 1000);
  const contracts = pass.reduce((a, p) => a + (p.size > 0 ? p.size : 0), 0);
  const floor = pts.reduce((a, p) => a + p.vol, 0);
  check(`${label}: the volume floor holds every passing print's contracts (${floor.toLocaleString()} of ${contracts.toLocaleString()})`, floor === contracts);
}

{
  const closes = new Map<number, number>([[from, 6800.5], [from + 60, 6801.25]]);
  const pts = flowRoomSeries(rows, from, to, false, closes);
  check(`one point a minute: ${pts.length} for 15 minutes, from 15:00`, pts.length === 15 && pts[0].time === from && pts[14].time === to - 60);
  check('the price is the close given for its minute, 0 where the chart holds none', pts[0].price === 6800.5 && pts[1].price === 6801.25 && pts[2].price === 0);
  check('an empty window draws nothing', flowRoomSeries(rows, to, from, false).length === 0);
  const last = lastPrintMinute(rows);
  check(`the last print's minute is inside the window (${new Date(last * 1000).toISOString().slice(11, 16)} UTC)`, last >= from && last < to);
  check('no prints: no last minute', lastPrintMinute([]) === 0);
}

console.log(fail ? `\n${fail} FAILED` : '\nflow room: every check holds');
process.exit(fail ? 1 : 0);
