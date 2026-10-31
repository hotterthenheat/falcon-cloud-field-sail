/*
  Pinpoint's book against recorded Unusual Whales answers (SPY and NVDA, the Oct 28 close read before the Oct 29 open).
  The app's own loader (data/uwBook.ts) reads the fixtures exactly as the browser reads the proxy; every expected value
  below is recomputed in this file straight from the raw vendor rows (rawSpy/rawNvda), never from the app's code.

  Replay: npx tsx scripts/golden/pinpoint-golden.ts
  Record: GOLDEN_RECORD=1 npx tsx scripts/golden/pinpoint-golden.ts   (then: npx tsx scripts/golden/slimFixtures.ts pinpoint-2026-10-29)
*/
import { done, expectEqual, expectNear, freezeClock, installUwFixtures, recordedAt, settleOn } from './uwFixtures';
import { pruneSet } from './pinpointRaw';
import { dealerOf } from '../../src/core/dealerSign';
import { bsVega, byStrike, contractRow, contractOi, contractVols, exposureRows, impliedMove, levelsOfRows, oiChangeRows, phiCdf, pricedFlip, pricedFlowTo, pricedLegs, pricedNet, rawAnswers, termVols, yearsTrading } from './pinpointRaw';

const SET = 'pinpoint-2026-10-29';
const NAMES = ['SPY', 'NVDA'] as const;

/* the browser bits the loader touches: a window, local storage, and the levels scope */
const mem = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.window = globalThis;
g.location = { search: '', pathname: '/pinpoint/map', href: 'http://127.0.0.1/pinpoint/map', hostname: '127.0.0.1', origin: 'http://127.0.0.1' };
g.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
};

const fx = installUwFixtures(SET);
const { asked } = fx;
freezeClock(recordedAt(SET, new Date().toISOString()));

const book = await import('../../src/data/uwBook');
const { openFeeds } = await import('../../src/data/feedGate');
openFeeds();

/* settled: nothing in flight and nothing new asked for a count of event-loop turns (uwFixtures settleOn), not a
   stretch of quiet wall-clock time */
const settle = (ticker: string, ok: () => boolean) => settleOn(fx, ok, ticker);

for (const t of NAMES) {
  book.ensureBook(t, 'full');
  await settle(t, () => {
    const e = book.peekEntry(t);
    return !!e && e.status === 'live' && !!e.everFull;
  });
  book.ensureOiChange(t, 'top');
  await settle(t, () => book.peekOiChange(t) != null);
}

const { levelsFor } = await import('../../src/data/levelsFor');
const { buildExposureProfile } = await import('../../src/data/exposure');
const { LEVELS_WINDOW } = await import('../../src/data/roomLevels');
const { deskAgenda, buildBoardRow } = await import('../../src/data/board');
const { aheadClock, buildCloseOdds } = await import('../../src/data/ahead');
const { readSessionClock } = await import('../../src/data/moc');
const { scopeSigma } = await import('../../src/data/wall');
const { touchOdds } = await import('../../src/data/expectedMove');
const { higherForStrikes } = await import('../../src/data/liveHigher');
const { buildBuilding } = await import('../../src/data/building');
const { buildHedgeFlowLadder } = await import('../../src/data/hedgeFlow');
const { levelNetPath } = await import('../../src/data/flipLevel');

const raw = rawAnswers(SET);
const SQRT_PI_2 = Math.sqrt(Math.PI / 2);

/* Golden values, each read off the raw rows (pinpointRaw.ts) and checked again below on every run:
   net/walls/supreme = sums of spot-exposures/expiry-strike call_gamma_oi + put_gamma_oi over the scope's live dates;
   flip = the app's re-priced crossing, and an independent sticky-strike re-pricing of the same rows (each contract's
   vol solved off its quote mid on the session clock) must land within 0.02% of spot of it; move = term-structure implied_move × √(π/2). */
const GOLD = {
  SPY: {
    front: '2026-10-29',
    today: { net: 107_689_622.85, flip: 771.1081929770314, call: 775, put: 758, supreme: 758 },
    /* the "all" flips moved by 2e-6 and 5e-5 when the holiday list grew past 2027 (2028 LEAPS count 2028's holidays) */
    all: { net: -3_576_479_393.82, flip: 775.549780158155, call: 800, put: 750, supreme: 750 },
    straddle: 5.09247441828498,
  },
  NVDA: {
    front: '2026-10-30',
    today: { net: 280_962_174.09, flip: 209.49980850770302, call: 217.5, put: 210, supreme: 217.5 },
    all: { net: 545_826_799.8, flip: 209.01346307467432, call: 220, put: 200, supreme: 220 },
    straddle: 4.72607032383704,
  },
} as const;

for (const t of NAMES) {
  const gold = GOLD[t];
  const clock = aheadClock(readSessionClock());
  const lv0 = levelsFor(t, '0DTE')!;
  const lvA = levelsFor(t, 'ALL')!;
  const snap = book.snapshotFor(t, '0DTE', 'full')!;
  const spot = snap.spot;
  const rows = exposureRows(raw, t);
  const ois = contractOi(raw, t);
  /* the price the rows (and the close quotes) were marked at: the latest row's — the pre-market spot is a different price */
  const marked = Number([...rows].sort((a, b) => String(b.time).localeCompare(String(a.time)))[0].price);
  expectEqual(`${t}: before the open the page prices at the pre-market print (${spot}), not the rows' close (${marked})`, spot !== marked && spot === (book.peekEntry(t) as { last?: number }).last, true);
  const vols = contractVols(raw, t, marked, '2026-10-28');
  const liveDates = new Set(rows.map(r => String(r.expiry)).filter(d => d >= '2026-10-29'));
  const scopes = [
    ['today', lv0, new Set([gold.front])],
    ['all', lvA, liveDates],
  ] as const;
  for (const [name, lv, dates] of scopes) {
    const want = gold[name];
    const hand = levelsOfRows(byStrike(rows, dates));
    expectNear(`${t} ${name}: hand net off the raw rows`, hand.net, want.net, 1e-9);
    expectNear(`${t} ${name}: net GEX`, lv.netGex, want.net, 1e-9);
    expectEqual(`${t} ${name}: call · put wall · supreme (raw ${hand.callWall} · ${hand.putWall} · ${hand.supreme})`, [lv.callWall, lv.putWall, lv.supreme], [want.call, want.put, want.supreme]);
    expectEqual(`${t} ${name}: raw rows name the same levels`, [hand.callWall, hand.putWall, hand.supreme], [want.call, want.put, want.supreme]);
    expectNear(`${t} ${name}: flip`, lv.flip ?? NaN, want.flip, 1e-9);
    const priced = pricedLegs(rows, dates, vols, ois, termVols(raw, t));
    const rf = pricedFlip(priced, spot);
    expectNear(`${t} ${name}: independent re-pricing of the rows puts the flip at ${rf?.toFixed(2)}`, rf ?? NaN, want.flip, (0.0002 * spot) / want.flip);
    expectEqual(`${t} ${name}: final`, lv.complete, true);
    /* the regime is the sign of the net RE-PRICED AT SPOT — the curve the flip is the zero of. Before the open the rows'
       net (at the close) and the net where price is now can differ in sign: SPY Today's rows net +107.7M at 772.31, but
       at the 770.06 pre-market print, below the 771.11 flip, the same contracts net −99M — short gamma. */
    const atSpot = pricedNet(priced, spot);
    expectNear(`${t} ${name}: the net re-priced at spot ${(atSpot / 1e6).toFixed(1)}M (rows ${(want.net / 1e6).toFixed(1)}M)`, lv.netAtSpot, atSpot, 0.02);
    expectEqual(`${t} ${name}: regime is the sign of the net at spot`, lv.regime, atSpot > 0 ? 'LONG' : 'SHORT');
  }
  expectEqual(`${t}: Today reads the front expiry`, lv0.date, gold.front);
  /* the flip gauge counts crossings against the flip as it stood at each bar (the book re-priced at each minute's own
     clock): ten one-minute closes alternating 0.5% either side of the printed flip cross it nine times; ten closes 2%
     on spot's side, never */
  {
    const { flipCrossingsAsOf } = await import('../../src/data/flipGauge');
    const chain0 = snap.uwChains?.['0DTE'] ?? snap.chain;
    /* at the rows' own minute (after the bell no trading time passes, so each bar's flip is the printed one) */
    const t0 = Date.parse('2026-10-28T20:16:00Z') / 1000;
    const f = lv0.flip!;
    const alt = Array.from({ length: 10 }, (_, i) => ({ time: t0 + i * 60, open: f, high: f, low: f, close: f * (i % 2 ? 1.005 : 0.995), volume: 0 }));
    const away = alt.map(b => ({ ...b, close: f * (spot > f ? 1.02 : 0.98) }));
    expectEqual(`${t}: crossings as of each bar — alternating ±0.5% of ${f.toFixed(2)}: 9, held 2% off: 0`, [flipCrossingsAsOf(snap, chain0, alt), flipCrossingsAsOf(snap, chain0, away)], [9, 0]);
  }
  /* the watchlist's nearest wall reads the walls Pinpoint prints for the scope (it read the raw whole book) */
  {
    const { scopeWalls } = await import('../../src/data/book/levels');
    const { pickLegWalls } = await import('../../src/core/walls');
    const raw0 = pickLegWalls(book.peekEntry(t)!.all, x => x.callGex, x => x.putGex);
    const w0 = scopeWalls(t, '0DTE');
    const wA = scopeWalls(t, 'ALL');
    expectEqual(`${t}: watchlist walls = the levels' walls, Today ${lv0.callWall}/${lv0.putWall} and All ${lvA.callWall}/${lvA.putWall} (the raw book read ${raw0.callWall}/${raw0.putWall})`, [w0?.callWall, w0?.putWall, wA?.callWall, wA?.putWall], [lv0.callWall, lv0.putWall, lvA.callWall, lvA.putWall]);
  }
  /* the profile's dealer-gamma curve prints the one flip and the one regime (it once read its own zero off its grid) */
  {
    const { buildExposureSurface } = await import('../../src/data/exposureSurface');
    const { buildExposureCurve } = await import('../../src/data/exposureCurve');
    const surface = buildExposureSurface(snap, 20);
    const front = surface.expiries.findIndex(e => e.iso === gold.front);
    const curve = buildExposureCurve(surface, [front]);
    expectNear(`${t}: the curve's flip over the front date is the printed flip (${lv0.flip?.toFixed(2)})`, curve.flip ?? NaN, lv0.flip ?? NaN, 1e-12);
    expectEqual(`${t}: the curve's net at spot carries the printed regime`, curve.atSpot < 0 ? 'LONG' : 'SHORT', lv0.regime);
    const profile0 = buildExposureProfile(snap, '0DTE', LEVELS_WINDOW);
    expectEqual(`${t}: the profile's bias is the same regime`, profile0.bias, lv0.regime === 'LONG' ? 'LONG_GAMMA' : 'SHORT_GAMMA');
  }

  /* the expected move, and the odds read off it */
  const straddle = impliedMove(raw, t, gold.front);
  expectNear(`${t}: the vendor's straddle into ${gold.front}`, straddle, gold.straddle, 1e-12);
  const move = book.peekScopeMove(t)!;
  expectNear(`${t}: 1σ = straddle × √(π/2)`, move.move, gold.straddle * SQRT_PI_2, 1e-9);
  const iv = book.peekIv(t) ?? 0;
  const ss = scopeSigma(snap, clock.minutesLeft, iv);
  expectNear(`${t}: the odds' σ left is that 1σ (before the open, the whole horizon)`, ss.sigmaLeft, gold.straddle * SQRT_PI_2, 1e-9);
  const reach = (k: number) => 2 * (1 - phiCdf(Math.abs(Math.log(k / spot)) / (ss.sigmaLeft / spot)));
  for (const k of [lv0.callWall!, lv0.putWall!]) expectNear(`${t}: reach odds to ${k} = 2(1 − Φ(|ln K/S| ÷ σ/S))`, touchOdds(spot, k, ss.sigmaLeft), reach(k), 1e-6);
  const agenda = deskAgenda(snap, '0DTE', clock)!;
  for (const x of agenda.first) expectNear(`${t}: Agenda reach at ${x.strike}`, x.reach, reach(x.strike), 1e-6);

  /* the close odds' lead row: its plain normal share of the strike's half-step band */
  const profile = buildExposureProfile(snap, '0DTE', LEVELS_WINDOW);
  const close = buildCloseOdds(profile, spot, ss.sigmaLeft, clock);
  const lead = close.top[0];
  const ks = profile.strikes.map(x => x.strike).sort((a, b) => a - b);
  const li = ks.indexOf(lead.strike);
  const plain = (phiCdf(((lead.strike + ks[li + 1]) / 2 - spot) / ss.sigmaLeft) - phiCdf(((lead.strike + ks[li - 1]) / 2 - spot) / ss.sigmaLeft)) * 100;
  expectNear(`${t}: close-odds lead ${lead.strike} plain share ${plain.toFixed(2)}% (nearer it than either neighbour)`, lead.plain, Math.round(plain * 10) / 10, 1e-9);

  /* Building: the overnight open-interest change at the busiest front strike, valued at each contract's own row gamma */
  const building = buildBuilding(snap, book.bookHistory(t) ?? [], book.bookCandles(t) ?? [], profile, clock, book.peekOiChange(t));
  const front = byStrike(rows, new Set([gold.front]));
    const changes = oiChangeRows(raw, t).filter(r => r.expiry === gold.front);
  const handChange = new Map<number, number>();
  for (const r of changes) {
    const v = front.get(r.strike);
    const oi = ois.get(`${r.expiry}|${r.strike}|${r.right}`) ?? 0;
    if (!v || !(oi > 0)) continue;
    const per = (r.right === 'C' ? v.c : v.p) / oi;
    handChange.set(r.strike, (handChange.get(r.strike) ?? 0) + r.diff * per);
  }
  const busiest = [...handChange].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  const brow = building.rows.find(r => r.strike === busiest?.[0]);
  expectNear(`${t}: Building's change at ${busiest?.[0]} = Σ oi_diff × row gamma ÷ OI (${(busiest?.[1] ?? 0).toFixed(0)})`, brow?.change ?? NaN, busiest?.[1] ?? NaN, 1e-6);

  /* the hedge-flow ladder against a fine integral of the independently re-priced rows */
  const legsFront = pricedLegs(rows, new Set([gold.front]), vols, ois);
  const chain = snap.uwChains?.['0DTE'] ?? [];
  const ladder = buildHedgeFlowLadder(profile, prices => levelNetPath(snap, chain, prices)?.path.map(v => -v) ?? null);
  for (const k of [lv0.callWall!, lv0.putWall!]) {
    const got = ladder.rungs.find(r => r.strike === k)?.flow ?? NaN;
    const hand = -pricedFlowTo(legsFront, spot, k);
    expectNear(`${t}: dealer flow to ${k} ${(got / 1e6).toFixed(1)}M against the raw integral ${(hand / 1e6).toFixed(1)}M`, got, hand, 0.01);
  }
  /* the one dealer model on every greek: each leg against the vendor's own figures for the same contract */
  const se = new Map((raw.get(`/stock/${t}/spot-exposures/expiry-strike?expirations[]=${gold.front}&limit=500`) as Record<string, string>[]).map(r => [Number(r.strike), r]));
  for (const [k, right] of [[lv0.callWall!, 'C'], [lv0.putWall!, 'P']] as const) {
    const node = chain.find(x => x.strike === k)!;
    const row = contractRow(raw, t, `${gold.front}|${k}|${right}`)!;
    const sideSign = right === 'C' ? 1 : -1;
    const oi = Number(row.open_interest);
    const leg = right === 'C' ? { dex: node.callDex, vex: node.callVex, vanna: node.callVanna, charm: node.callCharm } : { dex: node.putDex, vex: node.putVex, vanna: node.putVanna, charm: node.putCharm };
    const px = Number(se.get(k)!.price);
    /* the vendor's charm is per calendar year: per session it is × T_cal/T_trade (from its 16:15 pricing to the 4:00 close) */
    const tCal = (Date.parse(`${gold.front}T20:00:00Z`) - Date.parse(String(se.get(k)!.time))) / (365 * 86_400_000);
    const share = tCal / yearsTrading('2026-10-28', gold.front);
    const want = {
      dex: sideSign * Number(row.delta) * oi * 100 * spot,
      /* the vendor's vega is at its own price; the page prices vega at spot — the vendor's figure moved there by the ratio
         of Black-Scholes vegas at the contract's solved vol (sticky strike), never the app's vol */
      vex: sideSign * Number(row.vega) * oi * 100 * (bsVega(spot, k, yearsTrading('2026-10-28', gold.front), vols.get(`${gold.front}|${k}|${right}`) ?? NaN) / bsVega(marked, k, yearsTrading('2026-10-28', gold.front), vols.get(`${gold.front}|${k}|${right}`) ?? NaN)),
      vanna: Number(se.get(k)![right === 'C' ? 'call_vanna_oi' : 'put_vanna_oi']) * px * 0.01,
      charm: (Number(se.get(k)![right === 'C' ? 'call_charm_oi' : 'put_charm_oi']) / (0.01 * 365 * 252)) * share,
    };
    const tol = { dex: 0.1, vex: 0.06, vanna: 0.2, charm: 0.05 } as const;
    for (const g of ['dex', 'vex', 'vanna', 'charm'] as const) {
      const got = dealerOf(leg[g]);
      expectEqual(`${t} ${k}${right} ${g}: the dealer sign is the vendor's (${(got / 1e6).toFixed(3)}M, vendor ${(want[g] / 1e6).toFixed(3)}M)`, Math.sign(got), Math.sign(want[g]));
      expectNear(`${t} ${k}${right} ${g}: size against the vendor's own figure`, got, want[g], tol[g]);
    }
  }
  /* the higher greeks of the same legs: vomma and veta as finite differences of an independent dealer vega (Black-Scholes at
     the leg's vol on the session clock, per point of the quoted vol), and their sign by the model */
  const higher = higherForStrikes(snap, '0DTE', [lv0.callWall!, lv0.putWall!]);
  for (const [k, right] of [[lv0.callWall!, 'C'], [lv0.putWall!, 'P']] as const) {
    const node = chain.find(x => x.strike === k)!;
    const iv = (right === 'C' ? node.callIv : node.putIv)!;
    const count = right === 'C' ? node.callOI : node.putOI;
    const tt = yearsTrading('2026-10-28', gold.front);
    const tc = (Date.parse(`${gold.front}T20:00:00Z`) - Date.parse(String(se.get(k)!.time))) / (365 * 86_400_000);
    const volPt = Math.sqrt(tc / tt);
    const vega = (sig: number, t0: number) => (right === 'C' ? 1 : -1) * count * 100 * bsVega(spot, k, t0, sig) * volPt;
    const vommaFd = (vega(iv + 1e-4 * volPt, tt) - vega(iv - 1e-4 * volPt, tt)) / 0.02;
    const day = 1 / 252;
    const vetaFd = (vega(iv, tt - day / 100) - vega(iv, tt + day / 100)) / 0.02;
    const h = higher.get(k)!;
    const leg = right === 'C' ? 'call' : 'put';
    expectNear(`${t} ${k}${right} vomma: $vega per quoted vol point per point (fd ${vommaFd.toFixed(2)})`, dealerOf(h.vomma[leg]), vommaFd, 0.02);
    expectNear(`${t} ${k}${right} veta: $vega per session (fd ${vetaFd.toFixed(0)})`, dealerOf(h.veta[leg]), vetaFd, 0.02);
  }
}
console.log(`asked ${asked.length} paths`);
/* GOLDEN_PRUNE=1 after a re-record: drop answers no read asks for, and the spot-exposure columns nothing reads (the
   volume and bid/ask gamma, delta, vanna and charm), keeping the set small */
if (process.env.GOLDEN_PRUNE === '1') pruneSet(SET, asked);
done();
