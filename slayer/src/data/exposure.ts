/* The exposure profile: the GEX/DEX/VEX strike matrix, levels, zones, regime and narrative for one lens of a book.
   The figures are the book's own chain. A missing wall, flip or supreme is left blank — never the spot. */

import { fmtUsd } from './gex';
import { higherForStrikes } from './liveHigher';
import { pickLegWalls } from '../core/walls';
import { levelFlip, regimeOfNet } from './flipLevel';
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

function scaleSplit(put: number, call: number, factor: number, jitter: number): GreekSplit {
  const P = put * factor;
  const C = call * factor;
  const shift = (jitter - 0.5) * 0.36 * Math.min(Math.abs(P), Math.abs(C));
  return { put: P + shift, call: C - shift, net: P + C };
}

/** Strikes shown each side of spot. 30 is the whole book, 25 the Map's; other cards keep their own (STRIKE_WINDOWS) */
export type StrikeWindow = 10 | 15 | 20 | 25 | 30;
export const STRIKE_WINDOWS: StrikeWindow[] = [10, 15, 20, 30];

/** How near price a long-gamma strike must sit to be called a pin, as a share of spot */
const PIN_NEAR = 0.01;

// ---- top-level build ----------------------------------------------------------
export function buildExposureProfile(
  snapshot: MarketSnapshot,
  expiry: ExposureExpiry,
  half: StrikeWindow
): ExposureProfileData {
  const { ticker, spot } = snapshot;
  const liveChain = snapshot.uwChains?.[expiry];
  const chain = liveChain && liveChain.length ? liveChain : snapshot.chain;
  const factor = 1;

  // Window around spot, descending strikes (highest first). Spot under every strike sits at the bottom of the list
  // (the lowest strikes are the nearest), not the top.
  const desc = [...chain].sort((a, b) => b.strike - a.strike);
  const below = desc.findIndex(n => n.strike <= spot);
  const spotIdx = below >= 0 ? below : Math.max(0, desc.length - 1);
  const start = Math.max(0, spotIdx - half);
  const window = desc.slice(start, start + half * 2 + 1);

  // Pin = max total OI strike inside the window. No open interest means no pin.
  let pinStrike = Number.NaN;
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
  for (const n of snapshot.uwChains?.ALL ?? snapshot.chain) {
    const v = (n.callVol ?? 0) + (n.putVol ?? 0);
    if (v > 0) flowVol.set(n.strike, v);
  }

  const higherAt = higherForStrikes(snapshot, expiry, window.map(n => n.strike));
  const zeroGreek = () => ({ put: 0, call: 0, net: 0 });

  const maxAbs = { gex: 1, dex: 1, vex: 1, vanna: 1, charm: 1 };
  const strikes: StrikeExposure[] = window.map((n: StrikeNode) => {
    const gex = scaleSplit(n.putGex, n.callGex, factor, 0.5);
    const dex = scaleSplit(n.putDex, n.callDex, factor, 0.5);
    const vex = scaleSplit(n.putVex, n.callVex, factor, 0.5);
    const vanna = scaleSplit(n.putVanna ?? 0, n.callVanna ?? 0, factor, 0.5);
    const charm = scaleSplit(n.putCharm ?? 0, n.callCharm ?? 0, factor, 0.5);
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
    const volume = traded != null ? traded : 0;
    return { strike: n.strike, pin: pinFound && n.strike === pinStrike, gex, dex, vex, vanna, charm, color, vomma, speed, veta, zomma, oi, volume };
  });

  // Aggregates
  const netGex = strikes.reduce((a, s) => a + s.gex.net, 0);
  const netDex = strikes.reduce((a, s) => a + s.dex.net, 0);
  const netVex = strikes.reduce((a, s) => a + s.vex.net, 0);

  /* the walls (core/walls.ts pickLegWalls): the most call gamma and the most put gamma on the full book, either side of spot */
  const picked = pickLegWalls(chain, n => n.callGex, n => n.putGex);
  /* no strike carries the leg: no wall (NaN), never spot standing in */
  const callWall = picked.callWall ?? Number.NaN;
  const putWall = picked.putWall ?? Number.NaN;
  /* The flip is where the book's net gamma, re-priced at each price, crosses zero (data/flipLevel.ts). None within
     ±10% is not a level — NaN, and `flipFound` false. The spot is not written in its place. */
  const flipRead = levelFlip(snapshot, chain);
  const flip = flipRead.flip ?? Number.NaN;

  // The supreme: argmax |net gamma| over the full chain. No gamma is no supreme.
  let supreme = Number.NaN;
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
  const hasCall = Number.isFinite(callWall);
  const hasPut = Number.isFinite(putWall);
  const levels: ExposureLevels = { spot, callWall, putWall, callWallFound: hasCall, putWallFound: hasPut, pin: pinStrike, pinFound, flip, flipFound: flipRead.flip != null, net: flipRead.netAtSpot, supreme, complete };

  // Zone bands (strikes descending: from ≥ to). One row of breathing room per wall.
  const strikeList = strikes.map(s => s.strike);
  const step = strikeList.length > 1 ? Math.abs(strikeList[0] - strikeList[1]) : 1;
  const zones: ZoneBand[] = [];
  if (hasCall) zones.push({ from: callWall + step, to: callWall - step, kind: 'call-wall', label: 'CALL WALL' });
  if (hasPut) zones.push({ from: putWall + step, to: putWall - step, kind: 'put-wall', label: 'PUT WALL' });
  if (hasCall && hasPut && callWall - putWall > 3 * step) {
    zones.push({ from: callWall - step * 2, to: putWall + step * 2, kind: 'friction', label: 'FRICTION' });
  }
  /* The empty runs between shelves over the same window, pushed after the walls so a pocket never displaces a wall's band. */
  zones.push(...airPocketZones(findAirPockets(strikes)));

  /* the gamma regime: the ONE rule (flipLevel.ts regimeOfNet) on the net re-priced at spot — the same sign the insight,
     the levels and the flip read; a volatility read, not a direction. Neutral only on an exact zero. */
  const regime = regimeOfNet(flipRead.netAtSpot);
  const bias: GammaBias = regime === 'SHORT' ? 'SHORT_GAMMA' : regime === 'LONG' ? 'LONG_GAMMA' : 'NEUTRAL';
  const biasNote = regime === 'SHORT' ? 'Net short gamma — moves amplified' : regime === 'LONG' ? 'Net long gamma — dips absorbed' : 'Balanced positioning';

  // Insight narrative — levels translated to English
  const fmtK = (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));
  const inFriction = spot > putWall && spot < callWall;
  /* every strike of the contracts, not the window — the one net the Board, Compare and the Map print */
  const retailNet = flipRead.netAtSpot === 0 ? 0 : -flipRead.netAtSpot;
  const insights = [
    /* the regime is the SIGN of net gamma, printed in the retail sign; the flip is where that sign changes */
    `Net GEX is ${retailNet > 0 ? '+' : retailNet < 0 ? '−' : ''}${fmtUsd(Math.abs(retailNet))} — dealers are ${retailNet > 0 ? 'long gamma, so their hedging absorbs moves' : 'short gamma, so their hedging amplifies moves'}. ${flipRead.flip != null ? `The flip is ${fmtK(flipRead.flip)}, where that changes.` : 'There is no flip within ±10%.'}`,
    !hasCall || !hasPut
      ? `No ${!hasCall && !hasPut ? 'call or put' : !hasCall ? 'call' : 'put'} gamma on these contracts, so no ${!hasCall && !hasPut ? 'walls' : !hasCall ? 'call wall' : 'put wall'}.`
      : inFriction
        ? `Price sits between key levels (${fmtK(putWall)} – ${fmtK(callWall)}) inside the friction zone.`
        : `Price is ${spot >= callWall ? 'above the call wall' : 'below the put wall'} — outside the friction zone.`,
    pinFound ? `Price is pinned toward ${fmtK(pinStrike)}: the most open interest, with dealers long gamma there.` : pinOI > 0 ? `The most open interest in the window sits at ${fmtK(pinStrike)}.` : 'No open interest in the window, so no pin.',
    ...(hasPut ? [`A break below ${fmtK(putWall)} shifts pressure toward ${fmtK(putWall - step * 2)}.`] : []),
    ...(hasCall ? [`A break above ${fmtK(callWall)} opens quick supply up to ${fmtK(callWall + step * 2)}.`] : []),
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
