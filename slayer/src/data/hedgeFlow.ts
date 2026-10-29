/*
  The hedge-flow ladder: the dollars of stock dealers must trade to stay hedged if price walks from spot to each
  strike — the change in their net delta, flow(K) = ∫ G(x)·dx/(0.01·x) from S to K, with G the book's net gamma per 1%
  re-priced at each price x (the flip's re-pricing). Positive = dealers buy. Continuous hedging at the modelled sign.
*/

import type { ExposureProfileData } from '../types/gex';

export interface FlowRung {
  strike: number;
  /** Signed dollars: positive = dealers must buy, negative = sell */
  flow: number;
  /** The move from spot to the strike, percent, signed */
  movePct: number;
  /** True when the forced flow points the way the move does — it speeds the move up */
  amplifies: boolean;
  /** "up to 485: about $210M of dealer selling — slows the move" */
  words: string;
}

export interface FlowLadder {
  spot: number;
  rungs: FlowRung[];
  /** The largest |flow| on the ladder — the bar scale */
  maxAbs: number;
}

const fmtStrike = (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));

/** "$1.4B" · "$180M" · "$40K" — the flow's own rounding, coarser than fmtUsd's */
export function fmtFlow(mag: number): string {
  const a = Math.abs(mag);
  if (a >= 1e9) return `$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(a / 1e6).toFixed(0)}M`;
  if (a >= 1e3) return `$${(a / 1e3).toFixed(0)}K`;
  return `$${a.toFixed(0)}`;
}

/** House net gamma per 1% at each price — the book re-priced there (data/flipLevel.ts levelNetPath), null when the
    book cannot be re-priced */
type RepricedNet = (prices: readonly number[]) => number[] | null;

/** The ladder over a profile's strikes. With `repriced` each rung integrates the re-priced profile from spot to the
    rung; without it the book's net at spot is carried along the path (the first-order flow). */
export function buildHedgeFlowLadder(profile: ExposureProfileData, repriced?: RepricedNet): FlowLadder {
  const rows = profile.strikes.map(s => ({ strike: s.strike, value: s.gex.net }));
  const spot = profile.levels.spot;
  const flows = repriced ? integratedFlows(rows.map(r => r.strike), spot, repriced) : null;
  const net0 = rows.reduce((a, r) => a + r.value, 0);
  return ladderOf(rows.map(r => r.strike), spot, K => flows?.get(K) ?? net0 * ((K - spot) / spot) * 100);
}

/** Points per side of spot the path is integrated on (each rung's strike is one of them). */
const PATH_POINTS = 160;

/** Dealer flow to each target: trapezoids of G(x)·Δx/x·100 from spot out, each side on its own grid. */
function integratedFlows(targets: readonly number[], spot: number, repriced: RepricedNet): Map<number, number> | null {
  if (!(spot > 0)) return null;
  const up = targets.filter(k => k > spot);
  const dn = targets.filter(k => k < spot);
  const grid = (to: number, keys: readonly number[]) => {
    if (!keys.length) return [] as number[];
    const pts = new Set<number>(keys);
    for (let i = 1; i <= PATH_POINTS; i++) pts.add(spot + ((to - spot) * i) / PATH_POINTS);
    return [...pts].sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot));
  };
  const upPts = grid(Math.max(spot, ...up), up);
  const dnPts = grid(Math.min(spot, ...dn), dn);
  const g = repriced([spot, ...upPts, ...dnPts]);
  if (!g || g.length !== 1 + upPts.length + dnPts.length || !g.every(Number.isFinite)) return null;
  const out = new Map<number, number>();
  const walk = (pts: number[], vals: number[]) => {
    let x0 = spot;
    let g0 = g[0];
    let flow = 0;
    pts.forEach((x, i) => {
      const g1 = vals[i];
      flow += ((g0 / x0 + g1 / x) / 2) * (x - x0) * 100;
      out.set(x, flow);
      x0 = x;
      g0 = g1;
    });
  };
  walk(upPts, g.slice(1, 1 + upPts.length));
  walk(dnPts, g.slice(1 + upPts.length));
  return out;
}

/** The old arithmetic off bare rows — each strike's net gamma counted once a path crosses it — kept for a host that
    holds only the rows (Terrain's panes). Pinpoint's walls read the re-priced ladder above. */
export function buildFlowFromRows(rows: readonly { strike: number; value: number }[], spot: number): FlowLadder {
  return ladderOf(rows.map(r => r.strike), spot, K => {
    const lo = Math.min(spot, K);
    const hi = Math.max(spot, K);
    let crossed = 0;
    for (const t of rows) if (t.strike >= lo && t.strike <= hi) crossed += t.value;
    return crossed * ((K - spot) / spot) * 100;
  });
}

function ladderOf(strikes: readonly number[], spot: number, flowTo: (K: number) => number): FlowLadder {
  const rungs: FlowRung[] = [];
  let maxAbs = 0;
  for (const K of strikes) {
    if (Math.abs(K - spot) < 1e-9) continue;
    const movePct = ((K - spot) / spot) * 100;
    const flow = flowTo(K);
    const up = K > spot;
    const amplifies = flow !== 0 && (flow > 0) === up;
    const side = flow >= 0 ? 'buying' : 'selling';
    const words = flow === 0 ? `${up ? 'up' : 'down'} to ${fmtStrike(K)}: no forced flow` : `${up ? 'up' : 'down'} to ${fmtStrike(K)}: about ${fmtFlow(flow)} of dealer ${side} — ${amplifies ? 'speeds the move up' : 'slows the move'}`;
    rungs.push({ strike: K, flow, movePct, amplifies, words });
    maxAbs = Math.max(maxAbs, Math.abs(flow));
  }
  rungs.sort((a, b) => b.strike - a.strike);
  return { spot, rungs, maxAbs };
}

