/* The rate and yield every greek is priced against.

   THE RATE is the market's overnight rate (SOFR), read once a New York day on the server through the data hub
   (data/rateFeed.ts → setRate). Until it lands the last good read this browser kept is used ('held'), and with none ever
   read the fixed DEFAULT_R ('fixed'); `rateNow()` says which, for the hovers. A past day (the backtest, a replayed paper
   minute) is priced at that day's own rate (`rateOn`, filled by setDayRates). The vendor's own greeks are solved at SOFR
   too, so our solved IVs and theirs now share the rate.
   THE YIELD is the name's: 0 unless its own yield is set (setDividend). Server-side readers and the proofs never load a
   rate, so they price at DEFAULT_R and q = 0, exactly as before. */

interface Carry {
  /** Continuously-compounded risk-free rate, annualized (0.042 = 4.2%). */
  r: number;
  /** Continuous dividend yield, annualized (0 unless the name's own yield is known). */
  q: number;
}

/** The fixed rate used when no market rate has ever loaded: the neighbourhood of the front-end Treasury bill. */
export const DEFAULT_R = 0.042;
/* Zero until a name's own yield is set. A stock that pays nothing stays at zero.
   1.2% is not applied to every name. */
export const DEFAULT_Q = 0;

/** Where the rate in use came from: today's read, the last good read kept from before, or the fixed fallback */
export type RateSource = 'live' | 'held' | 'fixed';
export interface RateRead {
  /** A fraction (0.0394 = 3.94%) */
  r: number;
  source: RateSource;
  /** The date the rate is for, YYYY-MM-DD (null for the fixed fallback) */
  asOf: string | null;
}

const FIXED: RateRead = { r: DEFAULT_R, source: 'fixed', asOf: null };
let rate: RateRead = FIXED;
/** Each calendar day's rate, YYYY-MM-DD → fraction (the rate history publishes every day, weekends carried forward) */
const byDay = new Map<string, number>();
/** A past day takes the newest published rate at most this many days before it (a holiday, a gap in the history) */
const DAY_REACH = 7;

let rev = 0;
const listeners = new Set<() => void>();
const emit = () => {
  rev += 1;
  listeners.forEach(fn => fn());
};
/** Called when the rate, a day's rate or a name's yield changes */
export function subscribeCarry(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const carryRev = (): number => rev;

/** A believable short rate, as a fraction */
const goodRate = (r: number): boolean => Number.isFinite(r) && r > -0.01 && r < 0.25;

/** The rate in use from now on: today's read ('live') or the last good one kept ('held'). A bad number is refused. */
export function setRate(r: number, source: 'live' | 'held', asOf: string | null): boolean {
  if (!goodRate(r)) return false;
  /* a held copy never replaces a live read */
  if (source === 'held' && rate.source === 'live') return false;
  rate = { r, source, asOf };
  emit();
  return true;
}

/** The rate in use now, and where it came from */
export const rateNow = (): RateRead => rate;

/** Calendar days' rates (YYYY-MM-DD, fraction), as the rate history publishes them */
export function setDayRates(rows: readonly { day: string; r: number }[]): void {
  let n = 0;
  for (const row of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.day) || !goodRate(row.r) || byDay.get(row.day) === row.r) continue;
    byDay.set(row.day, row.r);
    n += 1;
  }
  if (n) emit();
}

const isoMinus = (iso: string, days: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
};

/** A day's own rate: that day's published row, else the newest one up to DAY_REACH days before it; with neither loaded,
    the rate in use now (and it says so: `asOf` is not the day). */
export function rateOn(day: string): RateRead {
  for (let i = 0; i <= DAY_REACH; i++) {
    const d = i ? isoMinus(day, i) : day;
    const r = byDay.get(d);
    if (r != null) return { r, source: 'live', asOf: d };
  }
  return rate;
}
/** Is a day's own rate loaded (the backtest asks for the month when it is not) */
export const dayRateKnown = (day: string): boolean => rateOn(day) !== rate;

const yields = new Map<string, number>();

/** The name a carry is kept under: the weekly roots price off their index */
export function carryName(ticker: string): string {
  const u = ticker.trim().toUpperCase();
  return u === 'SPXW' || u === 'XSP' ? 'SPX' : u === 'NDXP' ? 'NDX' : u === 'RUTW' ? 'RUT' : u;
}

/** Which day a carry is for: `on` is a past session's date (YYYY-MM-DD) — its own rate; absent, now */
export interface CarryWhen {
  on?: string;
}

/** This name's carry: the rate (today's, or `on`'s), and the name's yield or zero. */
export function carryFor(ticker: string, when?: CarryWhen): Carry {
  const q = yields.get(ticker.trim().toUpperCase());
  return { r: when?.on ? rateOn(when.on).r : rate.r, q: q ?? 0 };
}

/** A real yield, as a fraction. A non-payer is 0. A missing yield is not stored. */
export function setDividend(ticker: string, q: number): void {
  if (!Number.isFinite(q) || q < 0 || q >= 0.25) return;
  const key = ticker.trim().toUpperCase();
  if (yields.get(key) === q) return;
  yields.set(key, q);
  emit();
}

/** The rate and yield every greek is priced against when no name is given. */
export function getCarry(): Carry {
  return { r: rate.r, q: DEFAULT_Q };
}

/** Back to the start: no rate read, no day's rates, no yields (the proofs) */
export function resetCarry(): void {
  rate = FIXED;
  byDay.clear();
  yields.clear();
  emit();
}
