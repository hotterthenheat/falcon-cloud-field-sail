/* Every lean and posture threshold on Trace. Pages and data modules import these; none restates a number. */

/** Volume at least this many times its open interest reads as positions built in the session — Trace's "fresh" and
    Dossier's "unusual" alike. 1.5×: at least a third of the day's contracts ((vol − OI) / vol) cannot be closing ones,
    since no more than the open interest can close; 2× (Dossier's old cut) asked for half */
export const FRESH_VOL_OI = 1.5;
/** A contract's day is spread legs at this share (%) of its volume in multi-leg orders — half */
export const SPREAD_LEG_PCT = 50;
/** A contract's day is swept at this share (%) of its volume in sweeps — a quarter, on every screen, reason and card */
export const SWEEP_DAY_PCT = 25;

/** A side leans when it holds this share (%) of the sided volume or premium */
export const LEAN_EDGE = 55;
/** …and at least this share (%) of the whole traded on a side at all */
const LEAN_SIDED_MIN = 50;
/** A dark posture leans past this net (%) of sized dollars; under it is Balanced, and the grade is "poor" */
const POSTURE_EDGE = 18;
const POSTURE_GOOD = 50;
const POSTURE_STRONG = 80;

interface DayLean {
  /** Shares of the whole, 0–100 */
  ask: number;
  bid: number;
  mid: number;
  /** Shares of the sided part (ask + bid), 0–100 — the figure a lean is called on and printed with */
  askSided: number;
  bidSided: number;
  lean: 'ASK' | 'BID' | 'EVEN' | 'UNSIDED';
}

const NONE: DayLean = { ask: NaN, bid: NaN, mid: NaN, askSided: NaN, bidSided: NaN, lean: 'UNSIDED' };

/** The one lean rule over a three-way split (contracts or dollars): mid includes no-side */
export function leanOfSides(sv: { ask: number; bid: number; mid: number }): DayLean {
  const total = sv.ask + sv.bid + sv.mid;
  if (!(total > 0)) return NONE;
  const pc = (v: number) => (v / total) * 100;
  const sided = sv.ask + sv.bid;
  const askOfSided = sided > 0 ? sv.ask / sided : 0.5;
  const lean: DayLean['lean'] = sided < total * (LEAN_SIDED_MIN / 100) ? 'UNSIDED' : askOfSided >= LEAN_EDGE / 100 ? 'ASK' : askOfSided <= 1 - LEAN_EDGE / 100 ? 'BID' : 'EVEN';
  return { ask: pc(sv.ask), bid: pc(sv.bid), mid: pc(sv.mid), askSided: askOfSided * 100, bidSided: sided > 0 ? 100 - askOfSided * 100 : 50, lean };
}

/** A row's day lean: its side split when it carries one, else its two-way ask share (no mid known) */
export function dayLean(r: { askPct: number; volume: number; sideVol?: { ask: number; bid: number; mid: number } }): DayLean {
  if (r.sideVol) return leanOfSides(r.sideVol);
  const a = r.askPct;
  if (!Number.isFinite(a)) return NONE;
  return { ask: a, bid: 100 - a, mid: 0, askSided: a, bidSided: 100 - a, lean: a >= LEAN_EDGE ? 'ASK' : a <= 100 - LEAN_EDGE ? 'BID' : 'EVEN' };
}

/** A dark posture from its net (%) of sized dollars over the mid less under it */
export const postureOfNet = (net: number): 'ACCUMULATING' | 'DISTRIBUTING' | 'BALANCED' => (net >= POSTURE_EDGE ? 'ACCUMULATING' : net <= -POSTURE_EDGE ? 'DISTRIBUTING' : 'BALANCED');

/** How far a posture leans, in the four grade words; "poor" is exactly the Balanced band */
export const postureGrade = (net: number): 'strong' | 'good' | 'caution' | 'poor' => {
  const lean = Math.abs(net);
  return lean >= POSTURE_STRONG ? 'strong' : lean >= POSTURE_GOOD ? 'good' : lean >= POSTURE_EDGE ? 'caution' : 'poor';
};

/** Whole-percent shares of a three-way split that always sum to 100 (largest remainder) */
export function sideShares(bid: number, mid: number, ask: number): { bid: number; mid: number; ask: number } {
  const total = bid + mid + ask;
  if (!(total > 0)) return { bid: 0, mid: 0, ask: 0 };
  const raw = [bid, mid, ask].map(v => (v / total) * 100);
  const fl = raw.map(Math.floor);
  let left = 100 - fl.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => ({ i, r: v - Math.floor(v) })).sort((a, b) => b.r - a.r);
  for (const o of order) {
    if (left <= 0) break;
    fl[o.i]++;
    left--;
  }
  return { bid: fl[0], mid: fl[1], ask: fl[2] };
}

/** An even day's share, never rounded up onto the edge it fell short of ("54.6", not "55") */
export const shyPct = (v: number) => (Math.round(v) >= LEAN_EDGE ? (Math.floor(v * 10) / 10).toFixed(1) : String(Math.round(v)));

/** A lean in words with the share it is called on: "ask 61%", "even · bid 52%", "mid 70%" */
export function leanWords(l: DayLean): string {
  if (l.lean === 'ASK') return `ask ${Math.round(l.askSided)}%`;
  if (l.lean === 'BID') return `bid ${Math.round(l.bidSided)}%`;
  if (l.lean === 'UNSIDED') return Number.isFinite(l.mid) ? `mid ${Math.round(l.mid)}%` : '—';
  return `even · ${l.askSided >= 50 ? `ask ${shyPct(l.askSided)}%` : `bid ${shyPct(l.bidSided)}%`}`;
}
