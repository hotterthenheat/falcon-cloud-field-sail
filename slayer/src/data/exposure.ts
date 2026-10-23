/*
==================================================
  SLAYER TERMINAL - EXPOSURE PROFILE MODEL (exposure.ts)
  Builds the GEX/DEX/VEX strike matrix, dealer
  positioning map, zones, bias and insight narrative
  from the simulator chain. Placeholder data contract —
  swaps for the real dealer-flow engine later.
==================================================
*/

import { fmtUsd } from './gex';
import { pickLegWalls } from '../core/walls';
import { levelFlip } from './flipLevel';
import { airPocketZones, findAirPockets } from './airPockets';
import type { MarketSnapshot, StrikeNode } from '../types/market';
import type {
  DealerBias,
  ExposureExpiry,
  ExposureLevels,
  ExposureProfileData,
  GreekSplit,
  StrikeExposure,
  ZoneBand,
} from '../types/gex';

// ---- deterministic RNG ------------------------------------------------------
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function h01(seed: string): number {
  return (hash(seed) % 1000) / 1000;
}

// Farther expiries carry less gamma; ALL aggregates the pipeline.
const EXPIRY_DECAY: Record<ExposureExpiry, number> = {
  '0DTE': 1,
  '1D': 0.52,
  '2D': 0.38,
  '5D': 0.22,
  '7D': 0.16,
  // Monthly expiration carries the heavy structural weight (institutional books)
  OPEX: 0.85,
  ALL: 3.13,
};

/*
  THE SPLIT IS NET-PRESERVING, and that is P-24B's first half.

  This used to scale each leg by its own jittered multiplier —
  `put·f·(0.82+0.36j)` against `call·f·(1.18−0.36j)` — which changes the SUM
  by up to 18% of the gap between the legs. That sum is `gex.net`, and
  `gex.net` is what picks the call wall, the put wall and the flip on the
  flagship map. So an undocumented per-strike jitter was quietly relocating
  the levels: measured across eight names, six disagreed with the levels rail
  and three named a different SUPREME (META by 25 points, TSLA by 12.5).

  The jitter earns its keep as leg TEXTURE — a book where every strike splits
  identically looks synthetic — so it stays, moved to where it cannot lie: it
  shifts weight BETWEEN the legs, bounded by the smaller of the two, and the
  sum is exactly `(put + call) · factor`. A bounded transfer also cannot flip
  a leg's sign, so a put shelf never renders as a call one.

  The consequence the proof pins: because every strike's net is now the raw
  net times ONE POSITIVE constant, argmax|net| and the sign changes are the
  same strikes they are on the raw book. The expiry lens moves magnitudes and
  never levels.
*/
function scaleSplit(put: number, call: number, factor: number, jitter: number): GreekSplit {
  const P = put * factor;
  const C = call * factor;
  const shift = (jitter - 0.5) * 0.36 * Math.min(Math.abs(P), Math.abs(C));
  return { put: P + shift, call: C - shift, net: P + C };
}

/** Strikes shown each side of spot. 30 is the whole book. 25 is the Map's (2026-09-22); the other cards keep their
    own lists (STRIKE_WINDOWS) */
export type StrikeWindow = 10 | 15 | 20 | 25 | 30;
export const STRIKE_WINDOWS: StrikeWindow[] = [10, 15, 20, 30];

/** The leg texture's seed per strike and lens. Exported so the engine port's
    reference generator (scripts/exposure-ref.ts) can hand the Python the SAME
    jitter as an input — the live book has none, and the port's default shifts
    nothing. Never typed twice: this IS the seed the profile below uses. */
export function legJitter(ticker: string, strike: number, expiry: ExposureExpiry): number {
  return h01(`${ticker}-${strike}-${expiry}-exp`);
}

/** One volume per strike across the terminal — SAME seed and formula as
    rankedtargets.ts, until a real tape replaces both (placeholder, OI-anchored).
    Exported for the same reason as `legJitter`. */
export function strikeVolume(ticker: string, strike: number, oi: number): number {
  return Math.round(oi * (0.2 + h01(`${ticker}-${strike}-tvol`) * 0.7));
}

/** How near price a long-gamma strike must sit to be called a pin, as a share of spot */
const PIN_NEAR = 0.01;

// ---- top-level build ----------------------------------------------------------
export function buildExposureProfile(
  snapshot: MarketSnapshot,
  expiry: ExposureExpiry,
  half: StrikeWindow
): ExposureProfileData {
  const { ticker, spot } = snapshot;
  /* A live book is already the expiry it claims (uwChains). The decay table
     was only how the simulator faked a term structure off one chain. */
  const liveChain = snapshot.liveBook ? snapshot.uwChains?.[expiry] : undefined;
  const chain = liveChain && liveChain.length ? liveChain : snapshot.chain;
  const factor = snapshot.liveBook ? 1 : EXPIRY_DECAY[expiry];

  // Window around spot, descending strikes (highest first)
  const desc = [...chain].sort((a, b) => b.strike - a.strike);
  const spotIdx = Math.max(0, desc.findIndex(n => n.strike <= spot));
  const start = Math.max(0, spotIdx - half);
  const window = desc.slice(start, start + half * 2 + 1);

  // Pin = max total OI strike inside the window. No open interest (a per-expiry
  // column the feed does not split) means no pin — never the top strike by default.
  let pinStrike = window[0]?.strike ?? spot;
  let pinOI = 0;
  for (const n of window) {
    const oi = n.callOI + n.putOI;
    if (oi > pinOI) {
      pinOI = oi;
      pinStrike = n.strike;
    }
  }

  /* A PIN IS A LONG-GAMMA STRIKE NEAR PRICE (the retail test, 2026-10-22: "CALL WALL · GAMMA PIN 776" on a book that
     amplified, 2% away): dealers long gamma there pull price back to it, and only within reach. The most open interest
     elsewhere is just that — no surface names it a pin. */
  const pinNode = chain.find(n => n.strike === pinStrike);
  const pinFound = pinOI > 0 && !!pinNode && pinNode.netGex < 0 && Math.abs(pinStrike - spot) <= spot * PIN_NEAR;

  const flowVol = new Map<number, number>();
  if (snapshot.liveBook) {
    for (const n of snapshot.uwChains?.ALL ?? snapshot.chain) {
      const v = (n.callVol ?? 0) + (n.putVol ?? 0);
      if (v > 0) flowVol.set(n.strike, v);
    }
  }

  const maxAbs = { gex: 1, dex: 1, vex: 1, vanna: 1, charm: 1 };
  const strikes: StrikeExposure[] = window.map((n: StrikeNode) => {
    const jitter = snapshot.liveBook ? 0.5 : legJitter(ticker, n.strike, expiry);
    const gex = scaleSplit(n.putGex, n.callGex, factor, jitter);
    const dex = scaleSplit(n.putDex, n.callDex, factor, jitter);
    /* The simulator's vega is a small unit and the ladder scales it up so a
       vega column can sit beside gamma. A live book is already dollar vega
       (open interest × vega × 100 × the dealer side) — scaling it again
       made the ladder forty times the calendar. */
    const vexScale = snapshot.liveBook ? 1 : 40;
    const vex = scaleSplit(n.putVex * vexScale, n.callVex * vexScale, factor, jitter);
    /* Vanna and charm ride the same expiry lens (2026-09-09) */
    const vanna = scaleSplit(n.putVanna ?? 0, n.callVanna ?? 0, factor, jitter);
    const charm = scaleSplit(n.putCharm ?? 0, n.callCharm ?? 0, factor, jitter);
    maxAbs.gex = Math.max(maxAbs.gex, Math.abs(gex.put), Math.abs(gex.call), Math.abs(gex.net));
    maxAbs.dex = Math.max(maxAbs.dex, Math.abs(dex.put), Math.abs(dex.call), Math.abs(dex.net));
    maxAbs.vex = Math.max(maxAbs.vex, Math.abs(vex.put), Math.abs(vex.call), Math.abs(vex.net));
    maxAbs.vanna = Math.max(maxAbs.vanna, Math.abs(vanna.put), Math.abs(vanna.call), Math.abs(vanna.net));
    maxAbs.charm = Math.max(maxAbs.charm, Math.abs(charm.put), Math.abs(charm.call), Math.abs(charm.net));
    const oi = n.callOI + n.putOI;
    const traded = flowVol.get(n.strike);
    const volume = traded != null ? traded : snapshot.liveBook ? 0 : strikeVolume(ticker, n.strike, oi);
    return { strike: n.strike, pin: pinFound && n.strike === pinStrike, gex, dex, vex, vanna, charm, oi, volume };
  });

  // Aggregates
  const netGex = strikes.reduce((a, s) => a + s.gex.net, 0);
  const netDex = strikes.reduce((a, s) => a + s.dex.net, 0);
  const netVex = strikes.reduce((a, s) => a + s.vex.net, 0);

  /* Walls come from core/walls.ts, the ONE copy of this rule — the third
     place it was written. This picked by |net GEX| plus side of spot, which
     names a shelf by which side of price it sits on rather than by what it is
     made of; the sticky book (BOOK_BLEND) strands shelves on the far side
     routinely, so it labelled put shelves CALL WALL. That matters here more
     than most: these two prices draw the 'CALL WALL' / 'PUT WALL' zone bands
     below, the friction test, and the narrative that tells the reader "a break
     above X opens quick supply".

     The flip immediately below already carries a note that it was unified
     across this file, the trade plan and buildLevelsFor. The walls were
     unified in none of the three. Now they are.

     Unnamed stays at SPOT, which is what this function already did when a side
     held nothing — measured 0 times in 6480 sampled states, so it stays a
     defensive floor rather than a branch anything renders today.

     AND THE PICK READS THE FULL BOOK, not the drawn window — P-24B's second
     half, and the same argument the SUPREME below has always carried. A windowed
     pick answers "the heaviest bar currently drawn", which changes when the
     reader resizes the window: SPY's call wall moved 4 strikes and META's 5
     between this surface and the levels rail purely because they looked at
     different slices. The window is a drawing choice; it must not be an
     answer. When a wall lands outside the slice its band simply is not on
     screen, exactly as an off-window supreme crowns no row. */
  /* THE RETAIL WALLS (core/walls.ts pickLegWalls, the second re-audit 2026-10-22): the most call gamma and the most put
     gamma on the full book, either side of spot */
  const picked = pickLegWalls(chain, n => n.callGex, n => n.putGex);
  const callWall = picked.callWall ?? spot;
  const putWall = picked.putWall ?? spot;
  /* The flip from core/walls.ts, the ONE copy — this was one of three
     hand-synced nearest-to-spot transcriptions (unified 2026-08-18), which is
     the arrangement whose walls equivalent failed. `?? spot` keeps this
     function's own no-crossing fallback exactly as it was. */
  /* THE FLIP IS WHERE THE BOOK'S NET GAMMA CROSSES ZERO (the Pinpoint audit, 2026-10-22) — re-priced at each
     hypothetical spot off these same contracts (data/flipLevel.ts), not the per-strike sign change nearest spot. None
     within ±10% is carried as `flipFound: false`; the number then holds spot only as a placeholder. */
  const flipRead = levelFlip(snapshot, chain);
  const flip = flipRead.flip ?? spot;

  // The book's supreme — argmax |net gamma| over the FULL chain, not the window.
  // A windowed argmax answers "the biggest bar currently drawn", which moves
  // when the panel resizes and can disagree with the levels rail; when the
  // real supreme sits outside the window, no row is crowned.
  let supreme = spot;
  let supremeAbs = 0;
  for (const n of chain) {
    const a = Math.abs(n.putGex + n.callGex);
    if (a > supremeAbs) {
      supremeAbs = a;
      supreme = n.strike;
    }
  }

  /* "Today" without its own date's strikes is the whole book standing in — never final (the fourth audit's M1) */
  const complete = flipRead.complete && !(snapshot.liveBook && expiry === '0DTE' && !(liveChain && liveChain.length));
  const levels: ExposureLevels = { spot, callWall, putWall, pin: pinStrike, pinFound, flip, flipFound: flipRead.flip != null, net: flipRead.netAtSpot, supreme, complete };

  // Zone bands (strikes descending: from ≥ to). One row of breathing room per wall.
  const strikeList = strikes.map(s => s.strike);
  const step = strikeList.length > 1 ? Math.abs(strikeList[0] - strikeList[1]) : 1;
  const zones: ZoneBand[] = [
    { from: callWall + step, to: callWall - step, kind: 'call-wall', label: 'CALL WALL' },
    { from: putWall + step, to: putWall - step, kind: 'put-wall', label: 'PUT WALL' },
  ];
  if (callWall - putWall > 3 * step) {
    zones.push({ from: callWall - step * 2, to: putWall + step * 2, kind: 'friction', label: 'FRICTION' });
  }
  /* P-5. The empty runs between shelves, found over the SAME window these
     zones annotate — pushed after the walls so a pocket never displaces a
     wall's band in a renderer that takes the first match. */
  zones.push(...airPocketZones(findAirPockets(strikes)));

  // Dealer bias from net gamma positioning.
  // SIGN NOTE: the sim codes the call side NEGATIVE and the put side POSITIVE
  // (the heatmap's steel/gold split and the positioning map read the same
  // way), so a NEGATIVE aggregate = call-dominant book = dealers long gamma =
  // absorbing = supportive, and a POSITIVE aggregate = put-dominant = short
  // gamma = amplifying. This used to read the classic street convention
  // (negative = amplified), which contradicted every field surface
  // (unified 2026-08-18). Live ingestion must re-verify which convention the
  // feed carries — and the feed is UW's spot-exposures / greek-exposure now,
  // not ThetaData, which is out (re-pointed 2026-08-26). UW publishes the
  // dealer-signed answer directly, so this is a convention to CHECK AGAINST
  // rather than one to keep applying.
  const biasThreshold = maxAbs.gex * 0.6;
  let bias: DealerBias = 'NEUTRAL';
  let biasNote = 'Balanced positioning';
  if (netGex > biasThreshold) {
    bias = 'BEARISH';
    biasNote = 'Net short gamma — moves amplified';
  } else if (netGex < -biasThreshold) {
    bias = 'BULLISH';
    biasNote = 'Net long gamma — dips absorbed';
  }

  // Insight narrative — levels translated to English
  const fmtK = (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));
  const inFriction = spot > putWall && spot < callWall;
  /* every strike of the contracts, not the window — the one net the Board, Compare and the Map print */
  const retailNet = flipRead.netAtSpot === 0 ? 0 : -flipRead.netAtSpot;
  const insights = [
    /* the regime is the SIGN of net gamma, printed in the retail sign; the flip is where that sign changes */
    `Net GEX is ${retailNet > 0 ? '+' : retailNet < 0 ? '−' : ''}${fmtUsd(Math.abs(retailNet))} — dealers are ${retailNet > 0 ? 'long gamma, so their hedging absorbs moves' : 'short gamma, so their hedging amplifies moves'}. ${flipRead.flip != null ? `The flip is ${fmtK(flipRead.flip)}, where that changes.` : 'There is no flip within ±10%.'}`,
    inFriction
      ? `Price sits between key levels (${fmtK(putWall)} – ${fmtK(callWall)}) inside the friction zone.`
      : `Price is ${spot >= callWall ? 'above the call wall' : 'below the put wall'} — outside the friction zone.`,
    pinFound ? `Price is pinned toward ${fmtK(pinStrike)}: the most open interest, with dealers long gamma there.` : `The most open interest in the window sits at ${fmtK(pinStrike)}.`,
    `A break below ${fmtK(putWall)} shifts pressure toward ${fmtK(putWall - step * 2)}.`,
    `A break above ${fmtK(callWall)} opens quick supply up to ${fmtK(callWall + step * 2)}.`,
  ];

  // Spot marker slot (strikes descending)
  let spotAfterIndex = strikes.findIndex(
    (row, i) => row.strike >= spot && (strikes[i + 1]?.strike ?? -Infinity) < spot
  );
  if (spotAfterIndex === -1) spotAfterIndex = spot > (strikes[0]?.strike ?? 0) ? -0.5 : strikes.length - 1;

  return {
    ticker,
    expiry,
    strikes,
    maxAbs,
    netGex,
    netDex,
    netVex,
    levels,
    zones,
    bias,
    biasNote,
    insights,
    spotAfterIndex,
  };
}
