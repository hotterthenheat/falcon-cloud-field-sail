/*
  Compass Model 3 switch proof (COMPASS_M3_SHAPE, off by default; the lead, 2026-11-07): with the switch off the late
  sweep picks exactly what it picked before the limits work (cb58b60), and with it on it picks by shape.
  - the recorded sweeps (scripts/fixtures/compass-m3-sweeps.json: the chain of every recorded Model 3 call at its sweep
    minute, from the recorded quotes) run through the engine's own scoreLottery with the switch off and through the
    rule as it stood at cb58b60, copied here verbatim: the same contract on every one;
  - 400 random chains, the same comparison on the side-and-cost step;
  - the scan keeps every contract today's rule could take while the switch is off;
  - with the switch on, every pick is in its shape (|delta| ≤ 0.55) and validity only stands before it.
  Run:  npx tsx scripts/compass-m3-switch-proof.ts
*/
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setCompassHost } from '../src/data/compassHost';
import { blackScholesPrice } from '../src/core/greeks';
import { nyWallTime } from '../src/core/nyTime';
import { sessionCloseMinOn } from '../src/core/calendar';
import { LOTTERY_DELTA_MAX, Q, R, SESSION_MIN, YEAR_SESSIONS, m3ShapeOn, setM3Shape, strikeDistance, tradingMinutesTo } from '../src/data/compassParams';
import { atmIvOf, costPick, costRead, deltaOf, lotterySideNow, type CostQuote } from '../src/data/compassCost';
import { kept } from '../src/data/compassScan';
import { currentPicks, importModelState, scoreLottery } from '../src/data/compassModel';
import type { Setup } from '../src/types/compass';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0;
const check = (what: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `  (${detail})` : ''}`);
};
setCompassHost({ server: true, theta: async () => ({ status: 472, data: null, error: 'no_data' }), asset: async () => null, econ: () => [] });

/* ---- the rule as it stood at cb58b60, verbatim (compassParams lotteryEntry, spreadPass; compassModel scoreLottery) ---- */
const oldSpreadPass = (bid: number, ask: number) => {
  if (!(bid > 0.15) || !(bid >= 0 && ask > 0 && ask >= bid)) return false;
  const mid = (ask + bid) / 2;
  if (!(mid > 0)) return false;
  return (ask - bid) / mid <= 0.08 + 1e-9;
};
const oldLotteryEntry = (bid: number, ask: number) => bid > 0.15 && ask > 0 && ask <= 1.65 && ask >= bid && oldSpreadPass(bid, ask);
type Leg = CostQuote & { spot?: number };
/** cb58b60 scoreLottery, one root: filter, sort, the first's side, the smallest mu (else the nearest) */
function oldPick<T extends Leg>(all: readonly T[], spotOf: number, at: number, flatAt: number): T | null {
  const list = all.filter(s => oldLotteryEntry(s.bid, s.ask));
  const strikes = [...new Set(list.map(s => s.strike))];
  const spot = list.find(s => (s.spot ?? 0) > 0)?.spot ?? 0;
  if (!(spot > 0)) return null;
  list.sort((a, b) => {
    const da = strikeDistance(strikes, spot, a.strike);
    const db = strikeDistance(strikes, spot, b.strike);
    if (da !== db) return da - db;
    if (a.strike !== b.strike) return a.strike - b.strike;
    return a.right === b.right ? 0 : a.right === 'C' ? -1 : 1;
  });
  const first = list[0];
  if (!first) return null;
  const atm = atmIvOf(all, spot, at);
  const side = list.filter(s => s.right === first.right);
  const cheapest = atm ? costPick(side, c => costRead(c, { spot, atmIv: atm, at, flatAt })) : null;
  void spotOf;
  return cheapest ? cheapest.pick : side[0];
}

/* ---- the recorded sweeps through the engine ---- */
interface Sweep { day: string; ticker: string; expiry: string; mark: number; spot: number; recorded: string; quotes: { strike: number; right: 'C' | 'P'; bid: number; ask: number; bidSize?: number; askSize?: number; t: number }[] }
const { sweeps } = JSON.parse(readFileSync(join(root, 'scripts', 'fixtures', 'compass-m3-sweeps.json'), 'utf8')) as { sweeps: Sweep[] };
const word = (t: string, k: number, r: string) => `${t} ${k % 1 === 0 ? k.toFixed(0) : k.toFixed(2)}${r}`;
const setupsOf = (s: Sweep): Setup[] => s.quotes.map(q => ({
  id: `${s.ticker}-${q.strike}-${q.right}-m3proof`, ticker: s.ticker, contract: word(s.ticker, q.strike, q.right), strike: q.strike, right: q.right,
  expiryDate: s.expiry, expiry: '0DTE', bid: q.bid, ask: q.ask, mid: (q.bid + q.ask) / 2, spot: s.spot, quotedAt: q.t, sleeve: 'odte',
  ...(q.bidSize != null ? { bidSize: q.bidSize, askSize: q.askSize } : {}),
}) as unknown as Setup);
async function engineSweep(s: Sweep, shape: boolean): Promise<string | null> {
  setM3Shape(shape);
  importModelState({ day: s.day.replace(/-/g, '') } as never, null);
  await scoreLottery(setupsOf(s), s.mark + 15_000, false);
  return currentPicks().find(p => p.band === 'lottery' && p.ticker === s.ticker)?.contract ?? null;
}
check(`COMPASS_M3_SHAPE is off by default`, (setM3Shape(null), m3ShapeOn()) === (process.env.COMPASS_M3_SHAPE === '1') && process.env.COMPASS_M3_SHAPE !== '1');
const offPicks: string[] = [];
const onPicks: string[] = [];
let same = 0;
for (const s of sweeps) {
  const flatAt = nyWallTime(Number(s.day.slice(0, 4)), Number(s.day.slice(5, 7)), Number(s.day.slice(8, 10)), 0, sessionCloseMinOn(s.day) - 10);
  const legs = setupsOf(s).map(x => ({ ...x, expiryDate: s.expiry })) as unknown as (Leg & { contract: string })[];
  const before = oldPick(legs, s.spot, s.mark + 15_000, flatAt)?.contract ?? null;
  const off = await engineSweep(s, false);
  const on = await engineSweep(s, true);
  offPicks.push(off ?? '—');
  onPicks.push(on ?? '—');
  if (off === before) same += 1;
  else console.log(`     ${s.day} ${s.ticker}: cb58b60 ${before}, switch off ${off}`);
  const onQ = s.quotes.find(q => word(s.ticker, q.strike, q.right) === on);
  if (on && onQ) {
    const d = deltaOf({ strike: onQ.strike, right: onQ.right, bid: onQ.bid, ask: onQ.ask, expiryDate: s.expiry }, s.spot, s.mark + 15_000);
    if (!(d <= LOTTERY_DELTA_MAX + 1e-12)) check(`switch on: ${on} is in Model 3's shape`, false, d.toFixed(3));
  }
}
setM3Shape(null);
check(`switch off: the engine picks what cb58b60 picked on every recorded sweep (${same} of ${sweeps.length})`, same === sweeps.length && sweeps.length === 15, offPicks.join(', '));
check('switch on: every pick is at the money or out of it (|Δ| ≤ 0.55), and the shape moves some picks', onPicks.some((p, i) => p !== offPicks[i]), onPicks.join(', '));

/* ---- 400 random chains: the side-and-cost step, off vs cb58b60 ---- */
{
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const day = '2026-11-09';
  const at = nyWallTime(2026, 11, 9, 15, 25);
  const flatAt = nyWallTime(2026, 11, 9, 15, 50);
  const t = tradingMinutesTo(day, at) / (SESSION_MIN * YEAR_SESSIONS) + 1e-6;
  let agree = 0;
  for (let n = 0; n < 400; n++) {
    const S = [12, 40, 95, 280, 700, 7400][n % 6] * (0.98 + 0.04 * rnd());
    const step = S * [0.0014, 0.0025, 0.005, 0.01][Math.floor(rnd() * 4)];
    const vol = 0.1 + 0.6 * rnd();
    const legs: (Leg & { k: string })[] = [];
    for (let i = -16; i <= 16; i++) {
      const K = Number((Math.round(S / step) * step + i * step).toFixed(4));
      for (const right of ['C', 'P'] as const) {
        const mid = blackScholesPrice(S, K, t, vol, right, R, Q);
        if (rnd() < 0.08 || !(mid > 0.005)) continue;
        const half = Math.max(0.005, mid * (0.005 + 0.08 * rnd()));
        legs.push({ k: `${K}${right}`, strike: K, right, bid: Number(Math.max(0, mid - half).toFixed(2)), ask: Number((mid + half).toFixed(2)), expiryDate: day, spot: S });
      }
    }
    const before = oldPick(legs, S, at, flatAt);
    const list = legs.filter(s => oldLotteryEntry(s.bid, s.ask));
    const side = lotterySideNow(list, S);
    const atm = atmIvOf(legs, S, at);
    const now = side.length ? (atm ? costPick(side, c => costRead(c, { spot: S, atmIv: atm, at, flatAt }))?.pick ?? side[0] : side[0]) : null;
    if ((before?.k ?? null) === (now?.k ?? null)) agree += 1;
  }
  check('400 random chains: today\'s side-and-cost step (lotterySideNow + costPick) picks what cb58b60 picked', agree === 400, `${agree} of 400`);
}

/* ---- the scan keeps every contract today's rule could take while the switch is off ---- */
{
  const list = Array.from({ length: 121 }, (_, i) => ({ strike: 6000 + i * 25, ask: i === 3 ? 1.2 : i === 118 ? 0.9 : 30, under: 7500 }));
  const offKept = (setM3Shape(false), kept(list)).map(d => d.strike);
  const onKept = (setM3Shape(true), kept(list)).map(d => d.strike);
  setM3Shape(null);
  check('switch off: the scan keeps the far contracts asking $1.65 or less, as before', offKept.includes(6075) && offKept.includes(8950));
  check('switch on: the scan keeps strikes by distance only (17 either side)', !onKept.includes(6075) && !onKept.includes(8950) && onKept.length === 35, String(onKept.length));
}

if (fail) {
  console.error(`\n${fail} check(s) failed`);
  process.exit(1);
}
console.log('\ncompass Model 3 switch proof: every check passed');
