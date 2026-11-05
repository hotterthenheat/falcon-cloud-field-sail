/*
  Compass Group B (owner-approved model-input fixes, 2026-11-05; docs/compass-group-b.md):
    B1/B2/B5  feature version 2's trading-time clock (compassParams tradingMinutesTo): the regular-session minutes from
              the mark to the expiry's close, every session ahead with its own close; the same minutes as
              scripts/golden/compass-ref.py's calendar on five cases (overnight, a 13:00 close, a weekly, Thanksgiving,
              the curb), and version 2's row on the reference contract equal to the Python reference column by column.
              A full-day 0DTE mark reads the same T in both versions.
    B2b       the theta-burn gate: version 1 keeps its trained check on a full regular day (the same answer as before);
              off it the repriced decay to the session's own flat decides (a 13:00 close's 12:30 ATM burns, an
              overnight mark's decay to 09:20 is nil).
    B3        the live contract (scoreLiveContract, the Weigher) scores the scan's own row: a live scan pass and the
              live contract on the same contract and minute give the same Model 1 and Model 2, bit for bit, on a
              hand-built host (bars, SPY's price at the mark, the open interest, the quotes 5 and 15 minutes back).
    B4        the ATM pair reads only rows with a valid quote stamped inside 90 seconds.
    OI        research/groupb/localHost countDayAt: the open-interest count a read had at a mark (pinOf keys on it).
    v2 trees  when public/models/model_*_v2.txt ship: Slayer's walk of them on the version 2 reference row equals
              LightGBM's Booster.predict (compass-ref.json v2.entry / v2.runner).
  Run: npx tsx scripts/compass-groupb-proof.ts
*/
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nyWallTime } from '../src/core/nyTime';
import { REGULAR_OPEN_MIN } from '../src/core/session';
import { setupIdOf } from '../src/data/compass';
import { atmPair, atmRows, bsStates, curveFrom, decayOver, features, ivStates, tapeOf } from '../src/data/compassFeatures';
import { decayBurns, f32, minutesLeftCol, thetaBurns, tradingMinutesTo, yearFrac, yearFracV2 } from '../src/data/compassParams';
import { parseBoosters, predict } from '../src/data/lgbm';
import type { Setup } from '../src/types/compass';
import { CHAIN, CONTRACT, DAY, MINUTE, PRIOR, curveBars, pinBook, sessionBars } from './golden/compassScenario';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  if (!ok) failed += 1;
};
const ny = (y: number, m: number, d: number, h: number, mi: number) => nyWallTime(y, m, d, h, mi);
const ref = JSON.parse(readFileSync(join(here, 'golden', 'compass-ref.json'), 'utf8')) as {
  x: (number | null)[];
  v2: { expiry: string; tm: number; cases: Record<string, number>; x: (number | null)[]; entry?: number; runner?: number };
};

/* ---- B1 / B2 / B5: the trading-time clock against the Python reference's calendar ---- */
const mine: Record<string, number> = {
  'wed 10:30 -> fri weekly': tradingMinutesTo('2026-10-30', ny(2026, 10, 28, 10, 30)),
  'thu 21:00 -> fri 0dte (overnight)': tradingMinutesTo('2026-10-30', ny(2026, 10, 29, 21, 0)),
  'fri 2026-11-27 12:30, 13:00 close, 0dte': tradingMinutesTo('2026-11-27', ny(2026, 11, 27, 12, 30)),
  'wed 2026-11-25 10:00 -> fri 11-27 (thanksgiving skipped)': tradingMinutesTo('2026-11-27', ny(2026, 11, 25, 10, 0)),
  'fri 16:30 curb -> mon weekly': tradingMinutesTo('2026-11-02', ny(2026, 10, 30, 16, 30)),
};
for (const [k, v] of Object.entries(mine)) check(`trading minutes: ${k}`, v === ref.v2.cases[k], { ts: v, python: ref.v2.cases[k] });
check('trading minutes: an evening mark is a full session, not 0 (B1: version 1 read T = 1e-6 y)', mine['thu 21:00 -> fri 0dte (overnight)'] === 390 && yearFrac(21 * 60 - REGULAR_OPEN_MIN) < 2e-6);
check('trading minutes: 12:30 on a 13:00 close is 30, version 1 read 210 (B2)', mine['fri 2026-11-27 12:30, 13:00 close, 0dte'] === 30 && minutesLeftCol(12 * 60 + 30 - REGULAR_OPEN_MIN) === 210);
check('trading minutes: after the expiry\'s close nothing is left', tradingMinutesTo('2026-10-30', ny(2026, 10, 30, 16, 30)) === 0);
{
  /* a full-day 0DTE mark: the same T in both versions, every minute of the session */
  let same = true;
  for (let m = REGULAR_OPEN_MIN; m < REGULAR_OPEN_MIN + 390; m += 5) {
    const tm = tradingMinutesTo('2026-10-28', ny(2026, 10, 28, Math.floor(m / 60), m % 60));
    if (yearFracV2(tm) !== yearFrac(m - REGULAR_OPEN_MIN) || tm !== minutesLeftCol(m - REGULAR_OPEN_MIN)) same = false;
  }
  check('a full-day 0DTE mark reads the same T and column 15 in both versions (09:30–15:55, every 5 minutes)', same);
}

/* ---- version 2's row on the reference contract (a Friday weekly at the scenario's Wednesday 10:30) ---- */
const stub = (strike: number, right: 'C' | 'P', bid: number, ask: number, spot: number, expiry: string): Setup => ({
  id: `SPY-${strike}-${right}`, ticker: 'SPY', contract: `SPY ${strike}${right}`, right, strike, expiry, expiryDate: expiry, sessionsLeft: 0,
  sigmaMovePct: 0, sleeve: 'weekly', score: 0, verdict: 'WATCH', topRated: false, topOpportunity: false, expectedMovePct: 0, swingTarget: { price: 0, pct: 0 },
  scalpExit: { price: 0, pct: 0 }, headline: '', whyChips: [], whyText: '', greeks: { delta: NaN, gamma: NaN, theta: NaN, vega: NaN, iv: NaN }, bid, ask,
  mid: (bid + ask) / 2, liveMid: (bid + ask) / 2, highWater: (bid + ask) / 2, confidence: 0, health: 0, momentum: 'NEUTRAL', takeProfits: [], priceTargets: [],
  liquidityLabel: 'Normal', liquiditySpread: '', invalidationPrice: 0, invalidationReason: '', spot,
} as Setup);
{
  const bars = sessionBars();
  const S = tapeOf(bars, false, MINUTE).S;
  const tm = tradingMinutesTo(ref.v2.expiry, ny(2026, 10, 28, 10, 30));
  const chain = CHAIN.map(c => stub(c.strike, c.right, c.bid, c.ask, S, ref.v2.expiry));
  const pair = atmPair(chain, S, yearFracV2(tm));
  const curve = curveFrom(curveBars());
  const raw = features(stub(CONTRACT.strike, CONTRACT.right, CONTRACT.bid, CONTRACT.ask, S, ref.v2.expiry), MINUTE, bars, bars, PRIOR, pair.iv, pair.skew, [], curve, pinBook(), { m5: CONTRACT.m5, m15: CONTRACT.m15 }, {}, { tradingMinutes: tm });
  const x = f32(raw ?? []);
  let worst = 0;
  let at = -1;
  ref.v2.x.forEach((v, i) => {
    const want = v == null ? NaN : Math.fround(v);
    const got = x[i];
    const err = Number.isNaN(want) && Number.isNaN(got) ? 0 : Math.abs(got - want) / Math.max(1e-12, Math.abs(want));
    if (!(err <= worst)) { worst = err; at = i; }
  });
  check('version 2 row = compass-ref.py v2, all 56 columns (relative 1e-6)', tm === ref.v2.tm && worst <= 1e-6, { tm, worst, at });
  const v1 = f32(features(stub(CONTRACT.strike, CONTRACT.right, CONTRACT.bid, CONTRACT.ask, S, ref.v2.expiry), MINUTE, bars, bars, PRIOR, atmPair(chain, S, yearFrac(MINUTE - REGULAR_OPEN_MIN)).iv, atmPair(chain, S, yearFrac(MINUTE - REGULAR_OPEN_MIN)).skew, [], curve, pinBook(), { m5: CONTRACT.m5, m15: CONTRACT.m15 }) ?? []);
  check('B5: the weekly\'s version 1 vol (today\'s minutes only) is about 1.8× version 2\'s (√(1110/330))', Math.abs(v1[36] / x[36] - Math.sqrt(1110 / 330)) < 0.1, { v1: v1[36], v2: x[36] });
  const tFile = (n: string) => join(root, 'public', 'models', n);
  if (existsSync(tFile('model_entry_v2.txt')) && ref.v2.entry != null && ref.v2.runner != null) {
    const e = parseBoosters(readFileSync(tFile('model_entry_v2.txt'), 'utf8'), 300);
    const r = parseBoosters(readFileSync(tFile('model_runner_v2.txt'), 'utf8'), 300);
    const refRow = ref.v2.x.map(v => (v == null ? NaN : Math.fround(v)));
    check('version 2 trees: Model 1 on the reference row = LightGBM', !!e && Math.abs(predict(e, refRow) - ref.v2.entry) < 1e-9, { slayer: e ? predict(e, refRow) : null, lightgbm: ref.v2.entry });
    check('version 2 trees: Model 2 on the reference row = LightGBM', !!r && Math.abs(predict(r, refRow) - ref.v2.runner) < 1e-9, { slayer: r ? predict(r, refRow) : null, lightgbm: ref.v2.runner });
    check('version 2 trees: the computed row scores as the reference row', !!e && Math.abs(predict(e, x) - ref.v2.entry) < 1e-6);
  } else console.log('note  no version 2 trees in public/models (shadow off): their parity is checked when they ship');
  void DAY;
}

/* ---- B2b: the theta-burn gate ---- */
{
  /* a 13:00 close at 12:30: an ATM 0DTE at 15% with 30 trading minutes left loses most of its value by the 12:55 flat */
  const S = 600;
  const tNow = yearFracV2(30);
  const px = bsStates(S, 600, tNow, 0.15, true).px;
  const decay = decayOver(S, 600, 0.15, true, tNow, yearFracV2(5));
  check('half day 12:30, ATM 0DTE ask 1.02× mid: the repriced decay to 12:55 burns the stop', decayBurns(decay, px * 1.02), { px: px.toFixed(4), decay: decay.toFixed(4) });
  /* version 1 read 210 minutes there: its 16:00 theta over 24 minutes did not burn */
  const t1 = yearFrac(12 * 60 + 30 - REGULAR_OPEN_MIN);
  const iv1 = ivStates(px, S, 600, t1, true);
  const g1 = bsStates(S, 600, t1, iv1, true);
  check('…where version 1\'s 16:00 theta said it would not (the inverted gate)', !thetaBurns(g1.th, g1.ga, px * 1.02, 24 / (390 * 252)));
  /* overnight 21:00 → the 09:20 flat: no trading minute passes, so no decay */
  const tm = tradingMinutesTo('2026-10-30', ny(2026, 10, 29, 21, 0));
  const tmFlat = tradingMinutesTo('2026-10-30', ny(2026, 10, 30, 9, 20));
  check('overnight 21:00 to the 09:20 flat: decay 0, no burn', decayOver(6800, 6800, 0.15, true, yearFracV2(tm), yearFracV2(tmFlat)) === 0 && tm === tmFlat);
}

/* ---- B4: the ATM pair skips a stale or crossed row ---- */
{
  const now = ny(2026, 10, 28, 10, 30);
  const fresh = (s: Setup) => ({ ...s, quotedAt: now - 5_000 });
  const rows = CHAIN.map(c => fresh(stub(c.strike, c.right, c.bid, c.ask, 502.9, '2026-10-28')));
  const stale = rows.map(r => (r.strike === 503 && r.right === 'C' ? { ...r, bid: 5, ask: 5.2, quotedAt: now - 10 * 60_000 } : r));
  const crossed = rows.map(r => (r.strike === 503 && r.right === 'P' ? { ...r, bid: 2.5, ask: 2.4 } : r));
  const T = yearFrac(60);
  const base = atmPair(atmRows(rows, now), 502.9, T);
  check('B4: every row fresh — the pair is the same with or without the filter', atmPair(rows, 502.9, T).iv === base.iv && atmRows(rows, now).length === rows.length);
  const s = atmPair(atmRows(stale, now), 502.9, T);
  check('B4: a 10-minute-old ATM call is not read (the pair falls back to the put)', s.iv !== atmPair(stale, 502.9, T).iv && Number.isNaN(s.skew));
  check('B4: a crossed ATM put is not read', atmRows(crossed, now).length === rows.length - 1);
}

/* ---- the open interest a mark reads (research host; compassModel pinOf keys on the same day) ---- */
{
  const { countDayAt } = await import('../research/groupb/localHost');
  check('OI: Wed 21:00 reads Wednesday\'s count, Thu 03:00 still Wednesday\'s, Thu 08:00 Thursday\'s', [countDayAt(ny(2026, 10, 28, 21, 0)), countDayAt(ny(2026, 10, 29, 3, 0)), countDayAt(ny(2026, 10, 29, 8, 0))].join() === '2026-10-28,2026-10-28,2026-10-29');
  check('OI: Monday 03:00 reads Friday\'s count', countDayAt(ny(2026, 11, 2, 3, 0)) === '2026-10-30');
}

/* ---- B3: the live contract scores the scan's own row ---- */
{
  const now = ny(2026, 10, 28, 10, 30) + 20_000;
  const realNow = Date.now;
  Date.now = () => now;
  const stamp = (ms: number) => new Date(ms - 4 * 3_600_000).toISOString().slice(0, 19);
  const day = '2026-10-28';
  const today = sessionBars().filter(b => b.m < MINUTE);
  const barsAnswer = (d: string) => {
    if (d === '20261028') return today.map(b => ({ timestamp: `${day}T${String(Math.floor(b.m / 60)).padStart(2, '0')}:${String(b.m % 60).padStart(2, '0')}:00.000`, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }));
    const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    return Array.from({ length: 390 }, (_, k) => {
      const m = REGULAR_OPEN_MIN + k;
      return { timestamp: `${iso}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00.000`, open: 500, high: 500.5 + (k % 3) * 0.1, low: 499.5, close: 500 + (k % 5) * 0.05, volume: 900 + 10 * k };
    });
  };
  const S = tapeOf(sessionBars(), false, MINUTE).S;
  const seed = (strike: number, right: string) => [30, 15, 5, 0].map(back => {
    const m = MINUTE - back;
    const c = CHAIN.find(r => r.strike === strike && r.right === right);
    const adj = 1 - back * 0.004;
    return { timestamp: `${day}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00.000`, bid: (c?.bid ?? 1) * adj, ask: (c?.ask ?? 1.05) * adj };
  });
  const { setCompassHost } = await import('../src/data/compassHost');
  setCompassHost({
    server: true,
    theta: async p => {
      const [route, qs] = p.split('?');
      const q = new URLSearchParams(qs ?? '');
      if (route === '/stock/history/ohlc') return { status: 200, data: barsAnswer(q.get('start_date') ?? ''), error: null };
      if (route === '/stock/snapshot/trade') return { status: 200, data: [{ price: q.get('symbol') === 'SPY' ? S + 0.07 : 0, timestamp: stamp(now - 3_000) }], error: null };
      if (route === '/option/snapshot/open_interest') return { status: 200, data: pinBook().nodes.flatMap(n => [{ strike: n.strike, right: 'CALL', open_interest: n.call }, { strike: n.strike, right: 'PUT', open_interest: n.put }]), error: null };
      if (route === '/option/history/quote') return { status: 200, data: CHAIN.map(c => ({ contract: { symbol: 'SPY', strike: c.strike, right: c.right === 'C' ? 'CALL' : 'PUT', expiration: day }, data: seed(c.strike, c.right) })), error: null };
      return { status: 472, data: null, error: 'no_data' };
    },
    asset: async p => {
      const b = readFileSync(join(root, 'public', p.replace(/^\/+/, '')));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    },
    econ: () => [],
  });
  const model = await import('../src/data/compassModel');
  model.rollModelDay('20261028');
  const setups = CHAIN.map(c => ({ ...stub(c.strike, c.right, c.bid, c.ask, S, day), id: setupIdOf({ ticker: 'SPY', strike: c.strike, right: c.right, scanner: 'top-setups', sleeve: 'odte' }), sleeve: 'odte' as const, quotedAt: now - 2_000 }));
  const scanned: { p1: number; prun: number | null; x: number[] }[] = [];
  const off = model.onScoredRow(r => { if (r.setup.strike === CONTRACT.strike && r.setup.right === CONTRACT.right) scanned.push({ p1: r.p1, prun: r.prun, x: r.x }); });
  await model.scoreBook(setups, now, false, false);
  off();
  const live = await model.scoreLiveContract({ ticker: 'SPY', strike: CONTRACT.strike, right: CONTRACT.right, expiryIso: day, bid: CONTRACT.bid, ask: CONTRACT.ask, spot: S, rows: CHAIN, now });
  const a = scanned[0];
  check('B3: the scan scored SPY 505C at the live mark, with the mids 5 and 15 minutes back and SPY\'s price at the mark', !!a && Number.isFinite(a.x[34]) && Number.isFinite(a.x[35]) && Number.isFinite(a.x[19]), a ? { m5: a.x[34], m15: a.x[35], spy5: a.x[19] } : null);
  check('B3: the live contract gives the scan\'s Model 1 and Model 2, bit for bit', !!a && live.p1 === a.p1 && live.prun === a.prun, { scan: a ? [a.p1, a.prun] : null, live: [live.p1, live.prun] });
  Date.now = realNow;
}

if (failed) {
  console.error(`FAIL: ${failed} check(s)`);
  process.exit(1);
}
console.log('compass group B: pass');
