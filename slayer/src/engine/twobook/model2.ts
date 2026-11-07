/* Model 2 end to end, from quotes and signed inventory to the board (TWO_BOOK_SPEC_V2 §1.2, §1.5, §4.3–§4.5, §5).
   Pure: the server's flow book (src/data/twobook/flowBook.ts) and the proofs call the same function.

   chain      every expiry of the underlying at one timestamp: its T, its r_T (SOFR curve), a reference price for
              picking the strikes nearest spot (S_ref: the index print or the last S* — strike selection only), and the
              two-sided quotes for the parity forward
   contracts  the strip to price: each (expiry, strike, right) with its current NBBO, its tick, M and accumulated C.
              The whole listed strip is solved (also C = 0) so the flat wing has neighbours (§4.3 revalues C ≠ 0; §1.5
              fills from the nearest valid strike). */

import { ivFromQuote, type Right } from './bsm';
import { sumBoard, type BoardLine, type BoardTotals } from './board';
import { parityForward, spotAndCarry, type ParityQuote, type SpotAndCarry } from './forward';

export interface ChainExpiry {
  /** The expiry's id (root|expiration on the server) */
  id: string;
  T: number;
  r: number;
  Sref: number;
  quotes: readonly ParityQuote[];
}
export interface FlowContract {
  expiry: string;
  root?: string;
  strike: number;
  right: Right;
  bid: number;
  ask: number;
  tick: number;
  M: number;
  C: number;
}
export interface SlayerBoard {
  spot: SpotAndCarry | null;
  /** Per expiry id: T, r, F (model forward), b, and where F came from */
  expiries: Map<string, { T: number; r: number; F: number; b: number; source: 'PARITY' | 'INTERPOLATED' | 'EXTRAPOLATED' }>;
  lines: BoardLine[];
  board: BoardTotals | null;
}

/** r_T on the chain's own (T, r) points: linear in T, flat beyond the ends */
export function rateCurve(points: readonly { T: number; r: number }[]): (T: number) => number {
  const pts = points.filter(p => Number.isFinite(p.T) && Number.isFinite(p.r)).slice().sort((a, b) => a.T - b.T);
  return (T: number) => {
    if (!pts.length) return 0;
    if (T <= pts[0].T) return pts[0].r;
    for (let i = 1; i < pts.length; i++) if (T <= pts[i].T) return pts[i - 1].r + ((pts[i].r - pts[i - 1].r) * (T - pts[i - 1].T)) / (pts[i].T - pts[i - 1].T);
    return pts[pts.length - 1].r;
  };
}

export function slayerBoard(chain: readonly ChainExpiry[], contracts: readonly FlowContract[]): SlayerBoard {
  const live = chain.filter(e => e.T > 0);
  const rOf = rateCurve(live);
  const fwds = live.map(e => ({ T: e.T, F: parityForward(e.quotes, e.Sref, e.r, e.T)?.F ?? null }));
  const spot = spotAndCarry(fwds, rOf);
  const expiries: SlayerBoard['expiries'] = new Map();
  if (spot) live.forEach((e, i) => expiries.set(e.id, { T: e.T, r: e.r, F: spot.expiries[i].F, b: spot.expiries[i].b, source: spot.expiries[i].source }));
  const byId = new Map(chain.map(e => [e.id, e]));
  const lines: BoardLine[] = contracts.map(c => {
    const e = byId.get(c.expiry);
    const x = expiries.get(c.expiry);
    const T = e?.T ?? NaN;
    const S = spot?.S ?? NaN;
    const iv = x && T > 0 ? ivFromQuote(c.bid, c.ask, S, c.strike, T, x.r, x.b, c.right, c.tick) : null;
    return { root: c.root ?? '', expiry: c.expiry, strike: c.strike, right: c.right, C: c.C, M: c.M, T, S, r: x?.r ?? NaN, b: x?.b ?? NaN, iv, ivProv: iv != null ? 'SOLVED' : 'UNAVAILABLE' };
  });
  return { spot, expiries, lines, board: spot ? sumBoard(lines) : null };
}
