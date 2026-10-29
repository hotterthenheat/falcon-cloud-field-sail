/* The exposure profile: the GEX/DEX/VEX strike matrix, levels, zones, regime and narrative for one lens of a book
   (a live book's own chain, or the simulator's with its expiry decay). */

import { fmtUsd } from './gex';
import { higherForStrikes } from './liveHigher';
import { pickLegWalls } from '../core/walls';
import { levelFlip } from './flipLevel';
import { airPocketZones, findAirPockets } from './airPockets';
import type { MarketSnapshot, StrikeNode } from '../types/market';
import type {
  GammaBias,
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

/* The leg split is net-preserving: the jitter (simulator texture only) shifts weight between the legs, bounded by the
   smaller, so every strike's net is the raw net times one positive constant — the lens never moves a level. */
function scaleSplit(put: number, call: number, factor: number, jitter: number): GreekSplit {
  const P = put * factor;
  const C = call * factor;
  const shift = (jitter - 0.5) * 0.36 * Math.min(Math.abs(P), Math.abs(C));
  return { put: P + shift, call: C - shift, net: P + C };
}

/** Strikes shown each side of spot. 30 is the whole book, 25 the Map's; other cards keep their own (STRIKE_WINDOWS) */
export type StrikeWindow = 10 | 15 | 20 | 25 | 30;
export const STRIKE_WINDOWS: StrikeWindow[] = [10, 15, 20, 30];

/** The leg texture's seed per strike and lens, exported so scripts/exposure-ref.ts hands the Python port the same jitter. */
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

  /* A pin is a long-gamma strike near price: dealers long gamma there pull price back to it, only within reach. */
  const pinNode = chain.find(n => n.strike === pinStrike);
  const pinFound = pinOI > 0 && !!pinNode && pinNode.netGex < 0 && Math.abs(pinStrike - spot) <= spot * PIN_NEAR;

  const flowVol = new Map<number, number>();
  if (snapshot.liveBook) {
    for (const n of snapshot.uwChains?.ALL ?? snapshot.chain) {
      const v = (n.callVol ?? 0) + (n.putVol ?? 0);
      if (v > 0) flowVol.set(n.strike, v);
    }
  }

  const higherAt = higherForStrikes(snapshot, expiry, window.map(n => n.strike));
  const zeroGreek = () => ({ put: 0, call: 0, net: 0 });

  const maxAbs = { gex: 1, dex: 1, vex: 1, vanna: 1, charm: 1 };
  const strikes: StrikeExposure[] = window.map((n: StrikeNode) => {
    const jitter = snapshot.liveBook ? 0.5 : legJitter(ticker, n.strike, expiry);
    const gex = scaleSplit(n.putGex, n.callGex, factor, jitter);
    const dex = scaleSplit(n.putDex, n.callDex, factor, jitter);
    /* a live book is already dollar vega; only the simulator's small unit is scaled up beside gamma */
    const vexScale = snapshot.liveBook ? 1 : 40;
    const vex = scaleSplit(n.putVex * vexScale, n.callVex * vexScale, factor, jitter);
    /* vanna and charm ride the same expiry lens */
    const vanna = scaleSplit(n.putVanna ?? 0, n.callVanna ?? 0, factor, jitter);
    const charm = scaleSplit(n.putCharm ?? 0, n.callCharm ?? 0, factor, jitter);
    const h = higherAt.get(n.strike);
    const color = h?.color ?? zeroGreek();
    const vomma = h?.vomma ?? zeroGreek();
    const speed = h?.speed ?? zeroGreek();
    const veta = h?.veta ?? zeroGreek();
    const zomma = h?.zomma ?? zeroGreek();
    maxAbs.gex = Math.max(maxAbs.gex, Math.abs(gex.put), Math.abs(gex.call), Math.abs(gex.net));
    maxAbs.dex = Math.max(maxAbs.dex, Math.abs(dex.put), Math.abs(dex.call), Math.abs(dex.net));
    maxAbs.vex = Math.max(maxAbs.vex, Math.abs(vex.put), Math.abs(vex.call), Math.abs(vex.net));
    maxAbs.vanna = Math.max(maxAbs.vanna, Math.abs(vanna.put), Math.abs(vanna.call), Math.abs(vanna.net));
    maxAbs.charm = Math.max(maxAbs.charm, Math.abs(charm.put), Math.abs(charm.call), Math.abs(charm.net));
    const oi = n.callOI + n.putOI;
    const traded = flowVol.get(n.strike);
    const volume = traded != null ? traded : snapshot.liveBook ? 0 : strikeVolume(ticker, n.strike, oi);
    return { strike: n.strike, pin: pinFound && n.strike === pinStrike, gex, dex, vex, vanna, charm, color, vomma, speed, veta, zomma, oi, volume };
  });

  // Aggregates
  const netGex = strikes.reduce((a, s) => a + s.gex.net, 0);
  const netDex = strikes.reduce((a, s) => a + s.dex.net, 0);
  const netVex = strikes.reduce((a, s) => a + s.vex.net, 0);

  /* the walls (core/walls.ts pickLegWalls): the most call gamma and the most put gamma on the full book, either side of spot */
  const picked = pickLegWalls(chain, n => n.callGex, n => n.putGex);
  const callWall = picked.callWall ?? spot;
  const putWall = picked.putWall ?? spot;
  /* The flip is where the book's net gamma, re-priced at each price, crosses zero (data/flipLevel.ts); none within ±10%
     is `flipFound: false`, the number then holding spot only as a placeholder. */
  const flipRead = levelFlip(snapshot, chain);
  const flip = flipRead.flip ?? spot;

  // The supreme: argmax |net gamma| over the full chain, not the window.
  let supreme = spot;
  let supremeAbs = 0;
  for (const n of chain) {
    const a = Math.abs(n.putGex + n.callGex);
    if (a > supremeAbs) {
      supremeAbs = a;
      supreme = n.strike;
    }
  }

  /* "Today" without its own date's strikes is the whole book standing in — never final */
  const complete = flipRead.complete && !snapshot.levelsPending && !(snapshot.liveBook && expiry === '0DTE' && !(liveChain && liveChain.length));
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
  /* The empty runs between shelves over the same window, pushed after the walls so a pocket never displaces a wall's band. */
  zones.push(...airPocketZones(findAirPockets(strikes)));

  /* the window's gamma regime, house sign (negative = dealers long gamma, absorbs): a volatility read, not a direction */
  const biasThreshold = maxAbs.gex * 0.6;
  let bias: GammaBias = 'NEUTRAL';
  let biasNote = 'Balanced positioning';
  if (netGex > biasThreshold) {
    bias = 'SHORT_GAMMA';
    biasNote = 'Net short gamma — moves amplified';
  } else if (netGex < -biasThreshold) {
    bias = 'LONG_GAMMA';
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
