/* THE WIND FIELD — a MODEL FORECAST of the rest of today's session, drawn from the live dealer book (ported from Noah's
   fork, docs/wind-field.md there; the maths re-fed with our inputs).

   Thousands of possible rest-of-days are run forward one trading minute at a time from the last price. Each step is
   sized by the options' own at-the-money implied vol on the trading clock (the same σ the Terrain cone draws:
   data/terrainCone.ts forwardCone), blended toward what the tape has realised as the session goes on, a little more of
   it in the session's first and last half hours; it drifts at the name's carry (core/carry.ts: rate less yield); and it
   is BENT by the book: pushed along where dealers are short gamma, held back where they are long, pulled toward the
   heaviest same-day strike as the close nears. The picture is how many paths pass through each price at each minute.

   It is a model, not a market figure. The paths' random draws come from a seeded generator so the same book at the same
   minute draws the same field (the seed is (symbol, session date, minute) — windSeed below); the generator is private
   to this file and never produces a price, a level or anything printed as data. The bending weights are provisional
   (Noah's spec starting guesses, the pin lowered as his note asks) until a backtest fits them.

   Pure: no DOM, no store, no clock. The session's length, the minutes left and the minutes elapsed are handed in by
   the caller off the session module (core/session.ts). With every weight at zero and the flat shape the field IS the
   cone — a lognormal walk with one volatility — and scripts/wind-proof.ts holds it to that.

   Signs: netGex is the DEALER sign — positive means dealers long gamma (absorbs, holds a move back), negative short
   (amplifies, pushes a move along). The book keeps the opposite (core/dealerSign.ts): read it through dealerOf. */

export interface WindStrike {
  strike: number;
  /** Net dealer gamma at the strike, dealer sign (+ absorbs, − amplifies) */
  netGex: number;
  /** Open interest expiring this session at the strike, calls and puts together (0 when the book has no same-day date) */
  sameDayOI: number;
}

export interface WindLevel {
  key: string;
  price: number;
}

/** The book's weights on the cone's step. Zero everywhere is the cone itself. */
export interface WindKappa {
  /** How much local gamma scales the step: short gamma widens it, long gamma narrows it */
  sigma: number;
  /** How much local gamma leans the next move on the last: short gamma momentum, long gamma reversion */
  momentum: number;
  /** How hard the heaviest same-day strike pulls the paths in as the close nears */
  pin: number;
}
export const KAPPA_CONE: WindKappa = { sigma: 0, momentum: 0, pin: 0 };
/* PROVISIONAL, UNFITTED: the spec's starting guesses, the pin at 0.35 (Noah's note: 0.6 funnelled every path onto the
   pin by the bell, "a smaller rest (0.3 to 0.4) is the likely outcome"). The chart labels the field a model forecast. */
export const KAPPA_REST: WindKappa = { sigma: 0.35, momentum: 0.25, pin: 0.35 };

export interface WindInputs {
  /** The last price — where every path starts */
  spot: number;
  /** Trading minutes from now to today's regular close (early-close aware) — the paths' length */
  minutesLeft: number;
  /** Trading minutes since today's open (0 before it) — the implied-to-realised blend and the session's shape */
  elapsedMin: number;
  /** Today's regular session in minutes (shorter on an early close) */
  sessionLen: number;
  /** One standard deviation of the move from now to the close, as a fraction of spot — the at-the-money implied vol on
      the trading clock over minutesLeft (the cone's σ to today's close ÷ spot) */
  sigmaLeft: number;
  /** What the tape has realised today, one standard deviation over a whole session as a fraction of spot, or null */
  realisedSigmaDay?: number | null;
  /** The carry's drift per trading minute, a log rate (rate less yield over the trading year's minutes); 0 for none */
  driftPerMin?: number;
  strikes: WindStrike[];
  /** The pin. Left out: the heaviest same-day strike in reach (pinOf). Null: no pull */
  pin?: number | null;
  /** Named levels the field reports touch odds for (the proof reads them; the chart prints none) */
  levels: WindLevel[];
  /** How many paths, in antithetic pairs; 3,000 by rest */
  paths?: number;
  /** The draws' seed (windSeed) */
  seed?: number;
  kappa?: WindKappa;
  /** The density's price resolution; 160 bins by rest */
  priceBins?: number;
  /** The variance through the session: 'u' (more in the first and last half hours) or 'flat' (the cone's) */
  shape?: 'u' | 'flat';
  /** How many paths are kept whole for the streaks the paint draws; 96 by rest */
  streams?: number;
}

export interface WindQuantiles {
  /** Trading minutes ahead of now (1 = the first step) */
  ahead: number;
  lo2: number;
  lo1: number;
  mid: number;
  hi1: number;
  hi2: number;
}

export interface WindDensity {
  /** Columns, one a minute ahead (1..minutesLeft) */
  cols: number;
  /** The lowest bin's floor price and a bin's height in dollars */
  lo: number;
  step: number;
  bins: number;
  /** cols × bins, row-major by minute, each column scaled to its own peak (0..1) */
  cells: Float32Array;
}

export interface WindField {
  quantiles: WindQuantiles[];
  density: WindDensity;
  /** A handful of paths kept whole: n × cols, the price each minute */
  streams: { n: number; cells: Float32Array };
  /** The share of paths (0..1) that touched each level by the close, by key */
  touch: Record<string, number>;
  /** The share of paths within half a strike step of each level at the close */
  closeAt: Record<string, number>;
  pin: number | null;
  spot: number;
  /** The per-minute σ the walk ran at before the session's shape and the book */
  sigmaMin: number;
  paths: number;
  kappa: WindKappa;
}

/* ---- the draws: seeded, private to this file (a model's noise, never a market value) ---------------------------- */
const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
/** A standard normal by Box–Muller, two at a time */
const gaussian = (rand: () => number) => {
  let spare: number | null = null;
  return (): number => {
    if (spare != null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    while (u <= 1e-12) u = rand();
    const v = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    const a = 2 * Math.PI * v;
    spare = r * Math.sin(a);
    return r * Math.cos(a);
  };
};

/** The draws' seed: a hash of (symbol, session date YYYY-MM-DD, minute of the day) — stable within the minute, so a
    repaint on the same book draws the same field. A hash, not a generator: it yields one integer for runWind. */
export function windSeed(symbol: string, isoDate: string, minute: number): number {
  let h = 2166136261 >>> 0;
  const s = `${symbol.trim().toUpperCase()}|${isoDate}|${Math.floor(minute)}`;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h || 1;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/* THE SESSION'S SHAPE: the first and last half hours carry more of the day's variance than the middle */
const U_FIRST = 1.25;
const U_MID = 0.9;
const U_LAST = 1.2;
const U_EDGE = 30;
const uRaw = (sessionMin: number, sessionLen: number): number => (sessionMin < U_EDGE ? U_FIRST : sessionMin >= sessionLen - U_EDGE ? U_LAST : U_MID);

/** The day's realised volatility so far, one σ over a session of `sessionLen` minutes as a fraction of spot, off the
    session's one-minute closes; null before thirty returns have printed */
export function realisedSigmaDay(closes: readonly number[], sessionLen: number): number | null {
  let n = 0;
  let sum = 0;
  let sq = 0;
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1];
    const b = closes[i];
    if (!(a > 0) || !(b > 0)) continue;
    const r = Math.log(b / a);
    n++;
    sum += r;
    sq += r * r;
  }
  if (n < 30 || !(sessionLen > 0)) return null;
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sq / n - mean * mean) * sessionLen);
}

/** The strike step: the most common gap between neighbours */
const strikeStep = (strikes: readonly WindStrike[]): number => {
  const ks = [...new Set(strikes.map(s => s.strike))].sort((a, b) => a - b);
  if (ks.length < 2) return 1;
  const gaps = new Map<number, number>();
  for (let i = 1; i < ks.length; i++) {
    const g = Math.round((ks[i] - ks[i - 1]) * 1000) / 1000;
    if (g > 0) gaps.set(g, (gaps.get(g) ?? 0) + 1);
  }
  let best = 1;
  let n = 0;
  for (const [g, c] of gaps) if (c > n) (best = g), (n = c);
  return best;
};

/** The local gamma at a price, as a share of the book's heaviest strike in reach: + absorbs, − amplifies */
function gammaReader(strikes: readonly WindStrike[], spot: number, reach: number): (price: number) => number {
  const sorted = strikes.filter(s => Number.isFinite(s.strike) && Number.isFinite(s.netGex)).sort((a, b) => a.strike - b.strike);
  if (!sorted.length) return () => 0;
  let scale = 0;
  for (const s of sorted) if (Math.abs(s.strike - spot) <= reach) scale = Math.max(scale, Math.abs(s.netGex));
  if (!(scale > 0)) for (const s of sorted) scale = Math.max(scale, Math.abs(s.netGex));
  if (!(scale > 0)) return () => 0;
  const ks = sorted.map(s => s.strike);
  const gs = sorted.map(s => s.netGex / scale);
  return (price: number): number => {
    if (price <= ks[0]) return gs[0];
    if (price >= ks[ks.length - 1]) return gs[gs.length - 1];
    let lo = 0;
    let hi = ks.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (ks[m] <= price) lo = m;
      else hi = m;
    }
    const u = (price - ks[lo]) / (ks[hi] - ks[lo] || 1);
    return gs[lo] + (gs[hi] - gs[lo]) * u;
  };
}

/** The pin: the heaviest same-day strike within one move of spot; two near-equal (within 70% of the heaviest) average */
export function pinOf(strikes: readonly WindStrike[], spot: number, reach: number): number | null {
  const near = strikes.filter(s => s.sameDayOI > 0 && Math.abs(s.strike - spot) <= Math.max(reach, 1e-9));
  if (!near.length) return null;
  const top = Math.max(...near.map(s => s.sameDayOI));
  let sum = 0;
  let mass = 0;
  for (const s of near) {
    if (s.sameDayOI < 0.7 * top) continue;
    sum += s.strike * s.sameDayOI;
    mass += s.sameDayOI;
  }
  return mass > 0 ? sum / mass : null;
}

function quantileOf(column: Float64Array, lo: number, step: number, total: number, q: number): number {
  const target = q * total;
  let acc = 0;
  for (let b = 0; b < column.length; b++) {
    const next = acc + column[b];
    if (next >= target) {
      const inside = column[b] > 0 ? (target - acc) / column[b] : 0;
      return lo + (b + inside) * step;
    }
    acc = next;
  }
  return lo + column.length * step;
}

const EMPTY = (spot: number, kappa: WindKappa, sigmaMin: number): WindField => ({
  quantiles: [],
  density: { cols: 0, lo: spot, step: 1, bins: 0, cells: new Float32Array(0) },
  streams: { n: 0, cells: new Float32Array(0) },
  touch: {},
  closeAt: {},
  pin: null,
  spot,
  sigmaMin,
  paths: 0,
  kappa,
});

/* ---- the run ------------------------------------------------------------------------------------------------------ */
export function runWind(inputs: WindInputs): WindField {
  const kappa = inputs.kappa ?? KAPPA_REST;
  const shape = inputs.shape ?? 'u';
  const T = Math.max(0, Math.round(inputs.minutesLeft));
  const spot = inputs.spot;
  const L = Math.max(1, inputs.sessionLen);
  const elapsed = Math.max(0, inputs.elapsedMin);
  if (!(spot > 0) || !(inputs.sigmaLeft > 0) || T <= 0) return EMPTY(spot, kappa, 0);

  /* THE STEP'S VARIANCE: the implied per-minute variance (σ_left² over the minutes left — the cone's own), blended toward
     the realised one as the session goes (all implied at the open, two-thirds realised by the close) */
  const varImplied = (inputs.sigmaLeft * inputs.sigmaLeft) / T;
  const rs = inputs.realisedSigmaDay;
  const w = rs != null && rs > 0 && elapsed >= 30 ? clamp(1 - elapsed / L, 0.35, 1) : 1;
  const varMin = w * varImplied + (1 - w) * (rs != null && rs > 0 ? (rs * rs) / L : 0);
  const sigmaMin = Math.sqrt(varMin);
  /* the shape's weights over the minutes LEFT, scaled so they carry the same variance as the flat walk: the band at the
     close is the cone's whatever the shape */
  const u = new Float64Array(T);
  if (shape === 'flat') u.fill(1);
  else {
    let s2 = 0;
    for (let k = 0; k < T; k++) {
      u[k] = uRaw(clamp(elapsed + k, 0, L - 1), L);
      s2 += u[k] * u[k];
    }
    const scale = Math.sqrt(T / s2);
    for (let k = 0; k < T; k++) u[k] *= scale;
  }

  const nPairs = Math.max(50, Math.floor((inputs.paths ?? 3000) / 2));
  const N = nPairs * 2;
  const bins = Math.max(32, inputs.priceBins ?? 160);
  const moveLeft = spot * sigmaMin * Math.sqrt(T);
  const strikes = inputs.strikes.filter(s => Number.isFinite(s.strike) && s.strike > 0);
  const step = strikeStep(strikes);
  /* the pin's reach is one whole session's move at this vol, as the spec's "within a day's move" */
  const pin = inputs.pin === undefined ? pinOf(strikes, spot, spot * sigmaMin * Math.sqrt(L)) : inputs.pin;
  let gridLo = spot - 3.2 * moveLeft;
  let gridHi = spot + 3.2 * moveLeft;
  if (pin != null) (gridLo = Math.min(gridLo, pin - step)), (gridHi = Math.max(gridHi, pin + step));
  gridLo = Math.max(gridLo, spot * 0.5);
  const binStep = (gridHi - gridLo) / bins;

  const gamma = gammaReader(strikes, spot, 2.5 * moveLeft);
  const normal = gaussian(mulberry32(inputs.seed ?? 1));
  const drift = Number.isFinite(inputs.driftPerMin) ? (inputs.driftPerMin as number) : 0;
  /* the walk's own convexity: a lognormal step drifts −σ²/2 so the MEAN price grows at the carry, not faster */
  const counts = new Float64Array(T * bins);
  const S = new Float64Array(N).fill(spot);
  const rPrev = new Float64Array(N);
  const runHi = new Float64Array(N).fill(spot);
  const runLo = new Float64Array(N).fill(spot);
  const kSig = clamp(kappa.sigma, 0, 1);
  const kMom = clamp(kappa.momentum, 0, 1);
  const kPin = clamp(kappa.pin, 0, 2);
  const eps = new Float64Array(nPairs);
  const nStreams = Math.max(0, Math.min(N, inputs.streams ?? 96));
  const streamCells = new Float32Array(nStreams * T);
  const streamOf = new Int32Array(nStreams);
  /* every (N / n)-th path, so half the streaks come from each antithetic side and they are not all mirrors */
  for (let j = 0; j < nStreams; j++) streamOf[j] = Math.floor((j * N) / Math.max(1, nStreams));
  for (let k = 0; k < T; k++) {
    const left = T - k;
    /* the pull grows from a third at the open to all of it at the bell (the Ahead model's gravity curve) */
    const gravity = 0.35 + 0.65 * clamp((elapsed + k) / L, 0, 1);
    const base = sigmaMin * u[k];
    for (let p = 0; p < nPairs; p++) eps[p] = normal();
    const rowAt = k * bins;
    for (let i = 0; i < N; i++) {
      const e = i < nPairs ? eps[i] : -eps[i - nPairs];
      const s = S[i];
      const g = kSig > 0 || kMom > 0 ? gamma(s) : 0;
      const sig = base * clamp(1 - kSig * g, 0.6, 1.6);
      let r = drift - 0.5 * sig * sig + sig * e;
      if (kMom > 0) r += clamp(kMom * -g, -0.35, 0.35) * rPrev[i];
      /* the pull closes a share of the log gap over the minutes left — at kPin × gravity of one the median reaches the
         pin at the bell; never more than one σ a minute so it bends, never drags */
      if (kPin > 0 && pin != null) r += clamp((kPin * gravity * Math.log(pin / s)) / left, -sigmaMin, sigmaMin);
      const next = s * Math.exp(r);
      S[i] = next;
      rPrev[i] = r;
      if (next > runHi[i]) runHi[i] = next;
      if (next < runLo[i]) runLo[i] = next;
      let b = Math.floor((next - gridLo) / binStep);
      if (b < 0) b = 0;
      else if (b >= bins) b = bins - 1;
      counts[rowAt + b] += 1;
    }
    for (let j = 0; j < nStreams; j++) streamCells[j * T + k] = S[streamOf[j]];
  }

  /* the quantiles off the raw columns; the density smoothed across price (five bins) and time (three minutes), then
     each column scaled to its own peak so a wide late column reads as a tight early one */
  const quantiles: WindQuantiles[] = [];
  const cells = new Float32Array(T * bins);
  const col = new Float64Array(bins);
  for (let k = 0; k < T; k++) {
    const rowAt = k * bins;
    for (let b = 0; b < bins; b++) col[b] = counts[rowAt + b];
    quantiles.push({
      ahead: k + 1,
      lo2: quantileOf(col, gridLo, binStep, N, 0.025),
      lo1: quantileOf(col, gridLo, binStep, N, 0.16),
      mid: quantileOf(col, gridLo, binStep, N, 0.5),
      hi1: quantileOf(col, gridLo, binStep, N, 0.84),
      hi2: quantileOf(col, gridLo, binStep, N, 0.975),
    });
    for (let b = 0; b < bins; b++) {
      cells[rowAt + b] = 0.1 * (b > 1 ? col[b - 2] : 0) + 0.2 * (b > 0 ? col[b - 1] : 0) + 0.4 * col[b] + 0.2 * (b + 1 < bins ? col[b + 1] : 0) + 0.1 * (b + 2 < bins ? col[b + 2] : 0);
    }
  }
  const smoothed = new Float32Array(T * bins);
  for (let k = 0; k < T; k++) {
    const a = (k > 0 ? k - 1 : k) * bins;
    const c = (k + 1 < T ? k + 1 : k) * bins;
    const m = k * bins;
    let max = 0;
    for (let b = 0; b < bins; b++) {
      const v = 0.25 * cells[a + b] + 0.5 * cells[m + b] + 0.25 * cells[c + b];
      smoothed[m + b] = v;
      if (v > max) max = v;
    }
    if (max > 0) for (let b = 0; b < bins; b++) smoothed[m + b] /= max;
  }

  const touch: Record<string, number> = {};
  const closeAt: Record<string, number> = {};
  for (const l of inputs.levels) {
    if (!Number.isFinite(l.price)) continue;
    let touched = 0;
    let near = 0;
    const above = l.price >= spot;
    for (let i = 0; i < N; i++) {
      if (above ? runHi[i] >= l.price : runLo[i] <= l.price) touched++;
      if (Math.abs(S[i] - l.price) <= step / 2) near++;
    }
    touch[l.key] = touched / N;
    closeAt[l.key] = near / N;
  }

  return {
    quantiles,
    density: { cols: T, lo: gridLo, step: binStep, bins, cells: smoothed },
    streams: { n: nStreams, cells: streamCells },
    touch,
    closeAt,
    pin,
    spot,
    sigmaMin,
    paths: N,
    kappa,
  };
}

/** The cone's own band over `ahead` minutes at the per-minute σ — the baseline every bending is measured against */
export function coneBand(spot: number, sigmaMin: number, ahead: number): { lo2: number; lo1: number; mid: number; hi1: number; hi2: number } {
  const s = sigmaMin * Math.sqrt(Math.max(0, ahead));
  const m = -0.5 * s * s;
  return { lo2: spot * Math.exp(m - 1.96 * s), lo1: spot * Math.exp(m - s), mid: spot * Math.exp(m), hi1: spot * Math.exp(m + s), hi2: spot * Math.exp(m + 1.96 * s) };
}

/** The cone's touch odds for a level over `ahead` minutes — the reflection principle on a driftless walk */
export function coneTouch(spot: number, sigmaMin: number, ahead: number, level: number): number {
  const s = sigmaMin * Math.sqrt(Math.max(1e-9, ahead));
  return 2 * (1 - normalCdf(Math.abs(Math.log(level / spot)) / s));
}

export function normalCdf(z: number): number {
  /* Abramowitz–Stegun 7.1.26, good to 1.5e-7 */
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}
