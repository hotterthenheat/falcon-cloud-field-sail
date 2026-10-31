/* The hedge-flow ladder: dollars of stock dealers must trade to stay hedged if price walks from spot to each strike,
   flow(K) = ∫ G(x)·dx/(0.01·x) from S to K with G the book's net gamma per 1% re-priced at x. Positive = dealers buy. */

import type { ExposureProfileData } from '../types/gex';
import { fmtStrike } from '../core/format';

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

/** The ladder over a profile's strikes: each rung integrates the re-priced profile from spot to the rung. A book that
    cannot be re-priced draws NO rung — the net at spot carried flat (G₀ × the move) is not the flow even at 1%: a book
    whose gamma changes sign within 2% (scripts/gamma-sign-proof.ts §12) reads +$1.34M to 101 flat against +$0.71M
    re-priced, and the wrong sign by 102. */
export function buildHedgeFlowLadder(profile: ExposureProfileData, repriced?: RepricedNet): FlowLadder {
  return flowLadder(profile.strikes.map(s => s.strike), profile.levels.spot, repriced);
}

function flowLadder(strikes: readonly number[], spot: number, repriced?: RepricedNet): FlowLadder {
  const flows = repriced ? integratedFlows(strikes, spot, repriced) : null;
  if (!flows) return { spot, rungs: [], maxAbs: 0 };
  return ladderOf(strikes, spot, K => flows.get(K) ?? 0);
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

/** The ladder over bare rows (Terrain's panes): the same integral as Pinpoint's walls, ∫ G(x)·dx/(0.01·x) of the rows'
    book re-priced at x (`repriced`, flipLevel.ts levelNetPath) — without it, no rungs.
    The old arithmetic here — the net of the strikes a path crosses × the move — is not a flow: a strike's gamma is
    felt across the whole walk, not where its strike is passed (spot 100, 20 sessions, 25%, 1,000 calls a strike
    100–115 and 1,500 puts 85–100: it read dealers selling $1.68M to 102; the integral says buying $0.21M). */
export function buildFlowFromRows(rows: readonly { strike: number; value: number }[], spot: number, repriced?: RepricedNet): FlowLadder {
  return flowLadder(rows.map(r => r.strike), spot, repriced);
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

