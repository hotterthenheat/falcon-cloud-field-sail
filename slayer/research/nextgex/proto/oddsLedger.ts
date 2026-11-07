/* THE ODDS LEDGER (research prototype, NEXTGEX; not wired into the app): what the same-day board charges for "the
   close finishes past this level", and how often a bet priced like that has come true.

   Priced odds, model-free (CALC from the board's NBBO): a vertical spread between two neighbouring strikes pays the
   strike gap if the close finishes past the upper one, so its price divided by the gap is the board's probability of
   that. Out-of-the-money legs only (puts below the forward, calls above; both averaged across the forward), the
   resulting distribution made monotone by pool-adjacent-violators and clipped to 0..1, read between strike
   midpoints by straight lines, never past the outermost quoted pair (NaN there, never extrapolated). No smile model
   and no dealer-side assumption: this is what the quotes say, nothing more.

   The forward is put-call parity on the five strikes nearest spot (median of C − P + K, discounting ignored inside
   one session); one priced move is the at-the-money straddle × √(π/2) (the normal approximation the house's
   expectedMove.ts states for the straddle).

   The track record (OBS outcomes, research/nextgex/proto/calibration.json): how often a tail the board priced at p
   finished in the money, by priced-probability bin and by distance in priced moves, 2020-02 .. 2024-12, outcome the
   16:00 close, with day-clustered 95% ranges. research/nextgex/results/RESULTS.md: on SPX the board's odds were close
   to honest (no correction is applied — the tested correction did not improve 2024); the ETF boards priced wider
   moves than happened (a replication result with a contract-design caveat). So this module SHOWS the record beside
   the price and never replaces the price with a "true" number.

   Field names follow data/weigherDesk.ts (DeskChain rows of { strike, call, put } with bid / ask), so a DeskChain
   passes as is. */

export interface LedgerQuote {
  bid: number;
  ask: number;
}

export interface LedgerRow {
  strike: number;
  call: LedgerQuote;
  put: LedgerQuote;
}

export interface LedgerChain {
  ticker: string;
  spot: number;
  rows: readonly LedgerRow[];
}

export type Side = 'down' | 'up';

export interface RecordCell {
  side: Side;
  n: number;
  days: number;
  priced: number;
  real: number;
  real_lo: number;
  real_hi: number;
  lo?: number;
  hi?: number;
  sigma?: number;
}

export interface CalibrationFile {
  period: string;
  roots: Record<string, { byBin: RecordCell[]; bySigma: RecordCell[] }>;
}

export interface PricedBoard {
  forward: number;
  /** One priced move to the close, in price */
  move: number;
  /** Strike midpoints and the board's P(close ≤ x) at each, monotone */
  xs: number[];
  cdf: number[];
}

/** 'honest': the record's range covers the price; 'rich': it happened less often than priced; 'cheap': more often */
export type Verdict = 'honest' | 'rich' | 'cheap' | 'thin';

export interface LedgerRung {
  level: number;
  /** Signed distance in priced moves, (ln level/F) / (move/F) */
  moves: number;
  side: Side;
  /** The board's probability that the close finishes past `level` on `side` (0..1), NaN outside the quoted strikes */
  priced: number;
  /** The record for bets priced like this one (same side, the bin the price falls in) */
  record: RecordCell | null;
  verdict: Verdict;
}

const SQRT_HALF_PI = Math.sqrt(Math.PI / 2);

/** House mid: both sides quoted → their average; a one-sided far-out market (bid 0) → half the ask; else NaN */
export function mid(q: LedgerQuote | undefined): number {
  if (!q || !(q.ask > 0) || !(q.bid >= 0) || q.ask < q.bid) return NaN;
  return q.bid > 0 ? (q.bid + q.ask) / 2 : q.ask / 2;
}

const strictMid = (q: LedgerQuote) => (q.bid > 0 && q.ask > q.bid ? (q.bid + q.ask) / 2 : NaN);

/** Pool-adjacent-violators: the closest non-decreasing sequence (equal weights) */
export function monotone(y: readonly number[]): number[] {
  const blocks: { v: number; n: number }[] = [];
  for (const v of y) {
    blocks.push({ v, n: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2].v > blocks[blocks.length - 1].v) {
      const b = blocks.pop()!;
      const a = blocks.pop()!;
      blocks.push({ v: (a.v * a.n + b.v * b.n) / (a.n + b.n), n: a.n + b.n });
    }
  }
  return blocks.flatMap(b => Array<number>(b.n).fill(b.v));
}

/** The board's distribution of the close; null without parity strikes, a straddle or four usable strike pairs */
export function pricedBoard(chain: LedgerChain): PricedBoard | null {
  const S = chain.spot;
  const rows = [...chain.rows].filter(r => r.strike > 0).sort((a, b) => a.strike - b.strike);
  if (!(S > 0) || rows.length < 5) return null;
  const parity = rows
    .map(r => ({ k: r.strike, c: strictMid(r.call), p: strictMid(r.put) }))
    .filter(r => Number.isFinite(r.c) && Number.isFinite(r.p))
    .sort((a, b) => Math.abs(a.k - S) - Math.abs(b.k - S))
    .slice(0, 5)
    .map(r => r.c - r.p + r.k)
    .sort((a, b) => a - b);
  if (parity.length < 3) return null;
  const n = parity.length;
  const F = n % 2 ? parity[(n - 1) / 2] : (parity[n / 2 - 1] + parity[n / 2]) / 2;
  const atm = rows.reduce((b, r) => (Math.abs(r.strike - F) < Math.abs(b.strike - F) ? r : b), rows[0]);
  const straddle = mid(atm.call) + mid(atm.put);
  if (!(straddle > 0)) return null;
  const xs: number[] = [];
  const raw: number[] = [];
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rows[i];
    const b = rows[i + 1];
    const w = b.strike - a.strike;
    const up = (mid(a.call) - mid(b.call)) / w;
    const dn = (mid(b.put) - mid(a.put)) / w;
    let v: number;
    if (a.strike >= F) v = 1 - up;
    else if (b.strike <= F) v = dn;
    else {
      const both = [1 - up, dn].filter(Number.isFinite);
      v = both.length ? both.reduce((s, x) => s + x, 0) / both.length : NaN;
    }
    if (Number.isFinite(v)) {
      xs.push((a.strike + b.strike) / 2);
      raw.push(v);
    }
  }
  if (xs.length < 4) return null;
  return { forward: F, move: straddle * SQRT_HALF_PI, xs, cdf: monotone(raw).map(v => Math.min(1, Math.max(0, v))) };
}

/** The board's P(close ≤ k); NaN outside the quoted strike midpoints */
export function cdfAt(b: PricedBoard, k: number): number {
  const { xs, cdf } = b;
  if (!(k >= xs[0] && k <= xs[xs.length - 1])) return NaN;
  let i = 1;
  while (i < xs.length - 1 && xs[i] < k) i++;
  const t = (k - xs[i - 1]) / (xs[i] - xs[i - 1] || 1);
  return cdf[i - 1] + t * (cdf[i] - cdf[i - 1]);
}

/** The research files use the option root: SPX quotes are the SPXW board */
export const rootOf = (ticker: string) => (ticker.toUpperCase() === 'SPX' ? 'SPXW' : ticker.toUpperCase());

/** The record for a bet the board prices at `p` on `side`: the bin `p` falls in; null when the root has no record */
export function recordFor(cal: CalibrationFile, ticker: string, side: Side, p: number): RecordCell | null {
  const r = cal.roots[rootOf(ticker)];
  if (!r || !Number.isFinite(p)) return null;
  return r.byBin.find(c => c.side === side && p > (c.lo ?? 0) && p <= (c.hi ?? 0)) ?? null;
}

/** The verdict is the record's, not this one price's: bets the board priced in this bin (on average `rec.priced`)
    came true `rec.real` of the time, within real_lo..real_hi. Fewer than `minN` past bets → 'thin', say nothing */
export function verdictOf(p: number, rec: RecordCell | null, minN = 300): Verdict {
  if (!rec || rec.n < minN || !Number.isFinite(p)) return 'thin';
  if (rec.priced > rec.real_hi) return 'rich';
  if (rec.priced < rec.real_lo) return 'cheap';
  return 'honest';
}

/** How much more (above 1) or less (below 1) often than priced such bets came true: the record's own ratio */
export const recordRatio = (rec: RecordCell | null) => (rec && rec.priced > 0 ? rec.real / rec.priced : NaN);

/** Priced odds and their record at fixed distances from the forward, in priced moves */
export function ledger(chain: LedgerChain, cal: CalibrationFile, moves: readonly number[] = [-2, -1.5, -1, -0.5, 0.5, 1, 1.5, 2]): { board: PricedBoard; rungs: LedgerRung[] } | null {
  const board = pricedBoard(chain);
  if (!board) return null;
  const F = board.forward;
  const rungs = moves.map(m => {
    const level = F * Math.exp((m * board.move) / F);
    const side: Side = m < 0 ? 'down' : 'up';
    const c = cdfAt(board, level);
    const priced = side === 'down' ? c : 1 - c;
    const record = recordFor(cal, chain.ticker, side, priced);
    return { level, moves: m, side, priced, record, verdict: verdictOf(priced, record) };
  });
  return { board, rungs };
}

/** One level the user points at (a strike, a wall, a target): the board's odds the close finishes past it, and the record */
export function oddsPast(chain: LedgerChain, cal: CalibrationFile, level: number): LedgerRung | null {
  const board = pricedBoard(chain);
  if (!board || !(level > 0)) return null;
  const side: Side = level < board.forward ? 'down' : 'up';
  const c = cdfAt(board, level);
  const priced = side === 'down' ? c : 1 - c;
  const record = recordFor(cal, chain.ticker, side, priced);
  return { level, moves: Math.log(level / board.forward) / (board.move / board.forward), side, priced, record, verdict: verdictOf(priced, record) };
}
