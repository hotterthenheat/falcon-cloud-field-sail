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
import { bsCharmSession, bsVanna, bsVega, byStrike, contractRow, contractOi, contractVols, exposureRows, impliedMove, levelsOfRows, oiChangeRows, phiCdf, pricedFlip, pricedFlowTo, pricedLegs, pricedNet, rawAnswers, straddleMid, terminalOiDiffs, termSigma, termVols, vendorOiDiffs, yearsTrading } from './pinpointRaw';

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
const { deskAgenda, buildBoardRow, netGexTitle } = await import('../../src/data/board');
const { buildCompareSide, regimeTag, regimeWord: compareRegimeWord } = await import('../../src/data/compare');
const { aheadClock, buildCloseOdds } = await import('../../src/data/ahead');
const { readSessionClock } = await import('../../src/data/moc');
const { scopeSigma } = await import('../../src/data/wall');
const { touchOdds } = await import('../../src/data/expectedMove');
const { higherForStrikes } = await import('../../src/data/liveHigher');
const { buildBuilding } = await import('../../src/data/building');
const { buildHedgeFlowLadder } = await import('../../src/data/hedgeFlow');
const { levelNetPath } = await import('../../src/data/flipLevel');
const { oiSourceWords, valueOiChange } = await import('../../src/data/building');

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
    /* the "all" flips moved by 2e-6 and 5e-5 when the holiday list grew past 2027 (2028 LEAPS count 2028's holidays).
       2026-11-06 (audit finding 2, every date on its own contracts' vols): NVDA All 209.013463 → 208.989522, nearer the
       independent re-pricing below (208.998894: 0.0146 → 0.0094 off) — its dates read but under 0.5% of the gamma now
       take their contracts' own vols, not the at-the-money vol. SPY's are unchanged. */
    all: { net: -3_576_479_393.82, flip: 775.549780158155, call: 800, put: 750, supreme: 750 },
    straddle: 5.09247441828498,
  },
  NVDA: {
    front: '2026-10-30',
    today: { net: 280_962_174.09, flip: 209.49980850770302, call: 217.5, put: 210, supreme: 217.5 },
    all: { net: 545_826_799.8, flip: 208.98952218276756, call: 220, put: 200, supreme: 220 },
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
    /* audit 2026-11-05: Compare's side tag and the Board's net-GEX hover read that regime, not the rows' sign — where the two
       disagree (SPY Today before the open) the tag once said "absorbs" beside "amplify" in the sentence, and the hover
       "long gamma overall" beside a short-gamma regime */
    {
      const side = buildCompareSide(snap, clock, name === 'today' ? '0DTE' : 'ALL');
      const tag = side ? regimeTag(side) : null;
      const word = side ? compareRegimeWord(side) : null;
      const wantTag = side && Math.abs(side.flipDistPct ?? 1) < 0.05 ? 'either way' : lv.regime === 'LONG' ? 'absorbs' : 'amplifies';
      expectEqual(`${t} ${name}: Compare's tag is the regime's (${tag}; rows net ${side ? (side.netGex / 1e6).toFixed(1) : '?'}M, the sentence "${word}")`, tag, wantTag);
      const title = netGexTitle(lv.netGex, lv.regime);
      const disagree = lv.netGex > 0 !== (lv.regime === 'LONG');
      expectEqual(`${t} ${name}: the net-GEX hover ${disagree ? 'names the regime it disagrees with' : 'reads the net alone'}`, disagree ? title.includes(`net ${lv.regime === 'SHORT' ? 'short' : 'long'} gamma — that is the regime`) : !title.includes('that is the regime'), true);
    }
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
  expectNear(`${t}: the vendor's implied move into ${gold.front}`, straddle, gold.straddle, 1e-12);
  const move = book.peekScopeMove(t)!;
  /* audit 2026-11-05: the vendor's implied move is k·S·σ·√(dte/365), k ≈ 0.68 — about 0.85 of the at-the-money straddle,
     not the straddle. 1σ is S·σ·√(dte/365) off the date's own row (it once read implied move × √(π/2), 0.85× the market's) */
  const sigmaHand = termSigma(raw, t, gold.front, spot)!;
  expectNear(`${t}: 1σ = S·σ·√(dte/365) off the ${gold.front} row (${sigmaHand.toFixed(3)}; the implied move × √(π/2) would be ${(gold.straddle * SQRT_PI_2).toFixed(3)})`, move.move, sigmaHand, 1e-9);
  /* …and the straddle that 1σ prices is the market's: the page's straddle into every expiry against the at-the-money
     call + put mid off the contracts (at the price the quotes stood at), within 7% (SPY 0.93–0.99, NVDA 1.00–1.03) — the
     implied move ran 0.82–0.89 of it on every one */
  {
    const dated = [...termVols(raw, t).keys()].filter(d => d > '2026-10-29' && termSigma(raw, t, d, spot) != null);
    const off: string[] = [];
    let n = 0;
    for (const d of dated) {
      const mid = straddleMid(raw, t, d, marked);
      const page = book.peekScopeMove(t, d)?.straddle;
      if (mid == null || page == null) continue;
      n++;
      const ratio = (page * (marked / spot)) / mid;
      if (process.env.GOLDEN_SHOW) console.log(`    ${t} ${d} page straddle ÷ mid ${ratio.toFixed(3)}, implied move ÷ mid ${(impliedMove(raw, t, d) / mid).toFixed(3)}`);
      if (Math.abs(ratio - 1) > 0.07) off.push(`${d} ${ratio.toFixed(3)} (implied ${(impliedMove(raw, t, d) / mid).toFixed(3)})`);
    }
    expectEqual(`${t}: the page's straddle is the market's on all ${n} quoted expiries (none over 7% off: ${off.slice(0, 3).join(', ') || 'none'})`, [n > 10, off.length], [true, 0]);
  }
  const iv = book.peekIv(t) ?? 0;
  const ss = scopeSigma(snap, clock.minutesLeft, iv);
  expectNear(`${t}: the odds' σ left is that 1σ (before the open, the whole horizon)`, ss.sigmaLeft, sigmaHand, 1e-9);
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
  /* the terminal is down in this pass (the oi-change route answers terminal_down): Building values the movers' list and says so */
  expectEqual(`${t}: with the terminal down Building names the movers' list as its source`, [building.oiSource, /^Source: the shorter list/.test(oiSourceWords(building))], ['movers', true]);

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
    /* the vendor's charm is per calendar year: per session it is × T_cal/T_trade (from its 16:15 pricing to the 4:00 close) */
    const tCal = (Date.parse(`${gold.front}T20:00:00Z`) - Date.parse(String(se.get(k)!.time))) / (365 * 86_400_000);
    const share = tCal / yearsTrading('2026-10-28', gold.front);
    const want = {
      dex: sideSign * Number(row.delta) * oi * 100 * spot,
      /* the vendor's vega is at its own price; the page prices vega at spot — the vendor's figure moved there by the ratio
         of Black-Scholes vegas at the contract's solved vol (sticky strike), never the app's vol */
      vex: sideSign * Number(row.vega) * oi * 100 * (bsVega(spot, k, yearsTrading('2026-10-28', gold.front), vols.get(`${gold.front}|${k}|${right}`) ?? NaN) / bsVega(marked, k, yearsTrading('2026-10-28', gold.front), vols.get(`${gold.front}|${k}|${right}`) ?? NaN)),
      /* corrected (audit T1): this once checked the page against the vendor's own vanna_oi × price × 1% — the very figure
         the page printed, so it could not fail, and that unit is not $Δ per vol point on every name (SPX ~11×, F
         ~0.04×). Now an independent Black-Scholes vanna at the contract's solved vol on the session clock, × S × OI, per
         point of the quoted vol (√(T_cal/T_trade)) */
      vanna: sideSign * bsVanna(spot, k, yearsTrading('2026-10-28', gold.front), vols.get(`${gold.front}|${k}|${right}`) ?? NaN) * spot * oi * Math.sqrt(((Date.parse(`${gold.front}T20:00:00Z`) - Date.parse(String(se.get(k)!.time))) / (365 * 86_400_000)) / yearsTrading('2026-10-28', gold.front)),
    };
    void share;
    const tol = { dex: 0.1, vex: 0.06, vanna: 0.01 } as const;
    for (const g of ['dex', 'vex', 'vanna'] as const) {
      const got = dealerOf(leg[g]);
      const ref = g === 'vanna' ? 'Black-Scholes off the contract' : 'vendor';
      expectEqual(`${t} ${k}${right} ${g}: the dealer sign is the ${ref}'s (${(got / 1e6).toFixed(3)}M, ${ref} ${(want[g] / 1e6).toFixed(3)}M)`, Math.sign(got), Math.sign(want[g]));
      expectNear(`${t} ${k}${right} ${g}: size against the ${ref}'s own figure`, got, want[g], tol[g]);
    }
    /* audit 2026-11-06: charm was checked against the vendor's charm_oi converted by the very constants the page used
       (CHARM_SESSION, T_cal/T_trade), so it could not fail. Now independently: Black-Scholes delta at the contract's
       own vol, solved here off its quote mid, re-priced a small step of the 252-session clock either way, per session,
       × OI × 100 × spot — at spot, as vanna and vega are (the page prices them where price is) */
    {
      const tt = yearsTrading('2026-10-28', gold.front);
      const iv = vols.get(`${gold.front}|${k}|${right}`) ?? NaN;
      const hand = sideSign * bsCharmSession(spot, k, tt, iv, right) * oi * 100 * spot;
      const got = dealerOf(leg.charm);
      if (process.env.GOLDEN_SHOW) console.log(`    ${t} ${k}${right} charm page ${(got / 1e6).toFixed(3)}M, independent ${(hand / 1e6).toFixed(3)}M (iv ${iv.toFixed(4)}, t ${(tt * 252).toFixed(2)} sessions)`);
      expectEqual(`${t} ${k}${right} charm: the sign is the independent re-pricing's`, Math.sign(got), Math.sign(hand));
      expectNear(`${t} ${k}${right} charm per session ${(got / 1e6).toFixed(3)}M against Δ(t−h)−Δ(t+h) at the contract's own vol (${(hand / 1e6).toFixed(3)}M)`, got, hand, 0.01);
    }
  }
  /* …and charm on every front leg near the money (|ln K/S| ≤ 3%, 200+ open interest, a vol of its own) against the
     independent re-pricing. Before this audit the page printed the vendor's charm_oi on the session clock: its median
     leg was 4.7% off this (SPY; 21 of 62 over 10%, the 772C −0.53M against +0.54M) and NVDA's 215C 14% — the vendor's
     own delta model, not Black-Scholes at the vol the contract quotes (book/scale.ts paintLegs) */
  {
    const tt = yearsTrading('2026-10-28', gold.front);
    const offs: number[] = [];
    const bad: string[] = [];
    let volApart = 0;
    for (const node of chain) {
      if (Math.abs(Math.log(node.strike / marked)) > 0.03) continue;
      for (const right of ['C', 'P'] as const) {
        const oi = right === 'C' ? node.callOI : node.putOI;
        const iv = vols.get(`${gold.front}|${node.strike}|${right}`);
        if (!(oi >= 200) || !iv) continue;
        /* a leg whose page vol is not the vol solved here (a quote the page held stale and read the vendor's vol for —
           0.5% apart on SPY's far 1-session calls, 3–4% of a wing's charm) tests the vol, not the charm: counted apart */
        const pageIv = (right === 'C' ? node.callIv : node.putIv) ?? 0;
        if (Math.abs(pageIv / iv - 1) > 0.002) {
          volApart++;
          continue;
        }
        const hand = (right === 'C' ? 1 : -1) * bsCharmSession(spot, node.strike, tt, iv, right) * oi * 100 * spot;
        const got = dealerOf(right === 'C' ? node.callCharm : node.putCharm);
        if (Math.abs(hand) < 1e5) continue;
        const off = got / hand - 1;
        offs.push(Math.abs(off));
        if (Math.abs(off) > 0.01 || Math.sign(got) !== Math.sign(hand)) bad.push(`${node.strike}${right} ${(got / 1e6).toFixed(2)}M vs ${(hand / 1e6).toFixed(2)}M (vol ${(right === 'C' ? node.callIv : node.putIv)?.toFixed(4)} vs ${iv.toFixed(4)})`);
      }
    }
    offs.sort((a, b) => a - b);
    const med = offs[Math.floor(offs.length / 2)] ?? NaN;
    expectEqual(`${t}: charm on ${offs.length} front legs near the money against the independent re-pricing — median off ${(med * 100).toFixed(3)}%, none over 1% or of the other sign (${bad.slice(0, 3).join('; ') || 'none'}; ${volApart} legs on another vol left out)`, [offs.length >= 8, med < 0.003, bad.length], [true, true, 0]);
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
/*
  THE COMPLETE CHANGE (the owner, 2026-11-01): Building on the terminal's all-expiration open interest for the two report
  dates, every listed contract, through the server's own reader (server/oiChangeApi.mjs) on the recorded terminal
  answers (the Oct 28 and Oct 27 reports, the same pair the vendor's list in this set compares: at 06:47 ET on Oct 29 it
  had not posted Oct 29's yet, so the reader is asked as of the same hour a day earlier). Checked against a hand sum
  straight off the raw reports, then against the vendor's whole list for the same date contract by contract.
*/
const { createOiChange } = await import('../../server/oiChangeApi.mjs');
const { dropOiChange } = await import('../../src/data/book/oiChange');
const LATER = '2026-10-28';
const EARLIER = '2026-10-27';
const reader = createOiChange({
  /* the terminal's answers through the fixture set, as the proxy serves them (theta:… recordings) */
  theta: async p => {
    const r = await fetch(`/api/theta${p}`);
    return { status: r.status, body: await r.text() };
  },
  dir: null,
  now: () => Date.now() - 86_400_000,
});
const fixtureFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const m = /^\/api\/oi-change\/([A-Z.]+)$/.exec(url);
  if (!m) return fixtureFetch(input, init);
  return new Response(JSON.stringify(await reader.change(m[1], { waitMs: 60_000 })), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;
/** The vendor's whole list for the report date, walked as Building's fallback walks it (book/oiChange.ts readMovers) */
async function vendorWalk(t: string): Promise<void> {
  for (const order of ['desc', 'asc'] as const) {
    for (let page = 0; page < 14; page++) {
      const res = await fetch(`/api/uw/stock/${t}/oi-change?limit=500&page=${page}&order=${order}&date=${LATER}`);
      const rows = ((await res.json()) as { data?: Record<string, unknown>[] }).data ?? [];
      const zero = rows.some(r => (order === 'desc' ? Number(r.oi_diff_plain) <= 0 : Number(r.oi_diff_plain) >= 0));
      if (rows.length < 500 || zero) break;
    }
  }
}
const coverage: string[] = [];
for (const t of NAMES) {
  dropOiChange(t);
  book.ensureOiChange(t, 'full');
  await settle(t, () => book.peekOiChange(t)?.source === 'terminal');
  await vendorWalk(t);
  const rawNow = rawAnswers(SET);
  const got = book.peekOiChange(t)!;
  const hand = terminalOiDiffs(rawNow, t, LATER, EARLIER);
  expectEqual(`${t}: the complete change compares report ${EARLIER} with report ${LATER}`, [got.source, got.lastDate, got.currDate], ['terminal', EARLIER, LATER]);
  const mine = new Map(got.rows.map(r => [`${r.expiry}|${r.strike}|${r.right}`, r.diff]));
  const differ = [...hand].filter(([k, d]) => mine.get(k) !== d).length + [...mine.keys()].filter(k => !hand.has(k)).length;
  expectEqual(`${t}: the complete change is the raw reports' difference, contract by contract (${hand.size.toLocaleString('en-US')} contracts moved)`, [mine.size, differ], [hand.size, 0]);
  const handSum = [...hand.values()].reduce((a, d) => a + d, 0);
  expectEqual(`${t}: net contracts added, by hand ${handSum}`, got.rows.reduce((a, r) => a + r.diff, 0), handSum);

  /* Building on it: the busiest front strikes against Σ (later − earlier) × row gamma ÷ OI, by hand */
  const gold = GOLD[t];
  const clock = aheadClock(readSessionClock());
  const snap = book.snapshotFor(t, '0DTE', 'full')!;
  const profile = buildExposureProfile(snap, '0DTE', LEVELS_WINDOW);
  const building = buildBuilding(snap, book.bookHistory(t) ?? [], book.bookCandles(t) ?? [], profile, clock, got);
  const front = byStrike(exposureRows(raw, t), new Set([gold.front]));
  const ois = contractOi(raw, t);
  const handChange = new Map<number, number>();
  for (const [k, d] of hand) {
    const [expiry, strikeS, right] = k.split('|');
    if (expiry !== gold.front) continue;
    const strike = Number(strikeS);
    const v = front.get(strike);
    const oi = ois.get(k) ?? 0;
    if (!v || !(oi > 0)) continue;
    handChange.set(strike, (handChange.get(strike) ?? 0) + d * ((right === 'C' ? v.c : v.p) / oi));
  }
  for (const [k, want] of [...handChange].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3)) {
    const brow = building.rows.find(r => r.strike === k);
    expectNear(`${t}: Building's change at ${k} on the complete count = Σ (later − earlier) × row gamma ÷ OI (${want.toFixed(0)})`, brow?.change ?? NaN, want, 1e-6);
  }
  expectEqual(`${t}: Building names every listed contract as its source, and the two report dates`, [building.oiSource, /^Source: every listed contract/.test(oiSourceWords(building)), /reports of Oct 27 and Oct 28/.test(oiSourceWords(building))], ['terminal', true, true]);

  /* the vendor's whole list for the same date: where both carry a contract they agree; what it leaves out */
  const vendor = vendorOiDiffs(rawNow, t, LATER);
  const live = (k: string) => k.split('|')[0] >= LATER;
  const overlap = [...vendor].filter(([k]) => live(k) && hand.has(k));
  const agree = overlap.filter(([k, d]) => hand.get(k) === d).length;
  const vendorOnly = [...vendor.keys()].filter(k => live(k) && !hand.has(k)).length;
  expectEqual(`${t}: on the overlap (${overlap.length.toLocaleString('en-US')} contracts) the two agree contract by contract`, [agree, vendorOnly], [overlap.length, 0]);
  const missed = [...hand].filter(([k]) => !vendor.has(k));
  /* the dollars of the missed change, valued as Building values it (every live expiry, each contract at its own gamma) */
  const all = book.snapshotFor(t, 'ALL', 'full')!;
  const chainAll = (all.uwChains?.ALL?.length ? all.uwChains.ALL : all.chain) ?? all.chain;
  const asChange = (list: [string, number][]) => ({ ...got, rows: list.map(([k, diff]) => { const [expiry, s, right] = k.split('|'); return { expiry, strike: Number(s), right: right as 'C' | 'P', diff, currDate: LATER, lastDate: EARLIER }; }) });
  const gross = (list: [string, number][]) => [...valueOiChange(all, chainAll, asChange(list)).values()].reduce((a, v) => a + Math.abs(v.call) + Math.abs(v.put), 0);
  const net = (list: [string, number][]) => [...valueOiChange(all, chainAll, asChange(list)).values()].reduce((a, v) => a + v.call + v.put, 0);
  const grossAll = gross([...hand]);
  const grossMissed = gross(missed);
  const contractsMissedLive = missed.filter(([k]) => k.split('|')[0] >= '2026-10-29');
  const pct = (a: number, b: number) => `${b ? ((100 * a) / b).toFixed(2) : '0'}%`;
  const fmt = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v) >= 1e6 ? `${(Math.abs(v) / 1e6).toFixed(1)}M` : `${(Math.abs(v) / 1e3).toFixed(0)}K`}`;
  const line = `${t} ${EARLIER} → ${LATER}: the terminal counts ${hand.size.toLocaleString('en-US')} contracts that moved; the vendor's whole list carries ${vendor.size.toLocaleString('en-US')} (walked as Building walks it); it missed ${missed.length.toLocaleString('en-US')} (${pct(missed.length, hand.size)}; ${contractsMissedLive.length.toLocaleString('en-US')} still live on Oct 29), ${Math.abs(missed.reduce((a, [, d]) => a + d, 0)).toLocaleString('en-US')} net contracts, ${missed.reduce((a, [, d]) => a + Math.abs(d), 0).toLocaleString('en-US')} gross — ${fmt(grossMissed)} of ${fmt(grossAll)} gross dollar gamma of change (${pct(grossMissed, grossAll)}), net ${fmt(net(missed))}`;
  coverage.push(line);
  /* …and the first page each way alone (the largest 500 increases and 500 decreases: the Board's and the Agenda's read) */
  const top = new Set(oiChangeRows(rawNow, t).map(r => `${r.expiry}|${r.strike}|${r.right}`));
  const topMissed = [...hand].filter(([k]) => !top.has(k));
  const topGross = gross(topMissed);
  coverage.push(`${t}   the first page each way alone (${top.size.toLocaleString('en-US')} contracts) misses ${topMissed.length.toLocaleString('en-US')} (${pct(topMissed.length, hand.size)}), ${topMissed.reduce((a, [, d]) => a + Math.abs(d), 0).toLocaleString('en-US')} gross contracts — ${fmt(topGross)} of ${fmt(grossAll)} gross dollar gamma of change (${pct(topGross, grossAll)})`);
}
console.log('\nCOVERAGE (the complete change against the vendor\'s list)');
for (const l of coverage) console.log(`  ${l}`);

console.log(`asked ${asked.length} paths`);
/* GOLDEN_PRUNE=1 after a re-record: drop answers no read asks for, and the spot-exposure columns nothing reads (the
   volume and bid/ask gamma, delta, vanna and charm), keeping the set small */
if (process.env.GOLDEN_PRUNE === '1') pruneSet(SET, asked);
done();
