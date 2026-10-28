/*
==================================================
  SLAYER TERMINAL - THE CARRY SEAM (core/carry.ts)

  The risk-free rate and the dividend yield every
  greek is priced against — P-24A.
==================================================

  WHY THIS FILE EXISTS. `blackScholesGreeks` hardcoded `r = 0.05` and had no
  dividend yield AT ALL. Both are wrong in ways that matter and in ways that
  compound: 5% has not been the front-end rate for most of the terminal's
  life, and a q of zero prices SPY's ~1.2% yield as zero carry — which puts
  every index delta out by roughly q·t and every charm out by the whole
  q-term. The directive's P-24A is explicit that P-11 through P-14 cannot be
  built on that, because third-order greeks amplify first-order error.

  WHAT IS AND IS NOT SOURCED, stated plainly rather than implied.

  `r` IS THE FRONT-END BILL WHEN THETA ANSWERS. Pinpoint and Dossier call
  `/interest_rate/history/eod?symbol=treasury_m3` and pass the latest print
  through `setCarry`. Theta quotes the rate as a percent (4.2 means 4.2%);
  the caller divides by 100 before it gets here. If that call fails, or
  `setCarry` rejects the number, the previous rate stays and the feed row
  says so. `q` IS STILL AN ASSUMPTION — this account has no dividend feed.


  THE SEAM IS THE POINT. When the add-on lands, `setCarry` takes the live
  figures and nothing downstream changes: the greeks already read r and q
  through here, and the proof already pins the relationships (put-call
  parity, the q-effect on delta, charm's q-term) that a real feed has to
  keep satisfying.

  WHY THESE DEFAULTS. `DEFAULT_R` is the front-end Treasury yield's
  neighbourhood as of this file's writing, not a number chosen to be round;
  `DEFAULT_Q` is roughly the S&P 500's trailing yield, which is the right
  order for the index ETFs this desk trades and a deliberate OVERSTATEMENT
  for a zero-yield name — better to be explicit and wrong in a documented
  direction than silently zero.
*/

export interface Carry {
  /** Continuously-compounded risk-free rate, annualized (0.042 = 4.2%). */
  r: number;
  /** Continuous dividend yield, annualized (0.012 = 1.2%). */
  q: number;
}

export interface CarrySource {
  /** 'assumed' until a feed sets it — surfaces may print this. */
  kind: 'assumed' | 'feed';
  /** One line a surface can show a reader without lying. */
  note: string;
}

/* The neighbourhood of the front-end Treasury yield. Not live — see above. */
export const DEFAULT_R = 0.042;
/* Zero until a name's own yield is set. A stock that pays nothing stays at zero.
   1.2% is not applied to every name. */
export const DEFAULT_Q = 0;

let current: Carry = { r: DEFAULT_R, q: DEFAULT_Q };
let source: CarrySource = {
  kind: 'assumed',
  note: `r ${(DEFAULT_R * 100).toFixed(1)}% until the bill prints · q 0 until that name's yield is known`,
};

const yields = new Map<string, number>();

/** This name's carry. The rate is the bill. The yield is the name's, or zero. */
export function carryFor(ticker: string): Carry {
  const q = yields.get(ticker.trim().toUpperCase());
  return { r: current.r, q: q ?? 0 };
}

/** A real yield, as a fraction. A non-payer is 0. A missing yield is not stored. */
export function setDividend(ticker: string, q: number): void {
  if (!Number.isFinite(q) || q < 0 || q >= 0.25) return;
  yields.set(ticker.trim().toUpperCase(), q);
}

/** The rate and yield every greek is priced against. */
export function getCarry(): Carry {
  return current;
}

/** What the figures above are standing on — for surfaces that caveat. */
export function carrySource(): CarrySource {
  return source;
}

/**
 * Point the seam at real figures.
 *
 * Rejects a non-finite or absurd input rather than poisoning every greek on
 * the desk with it: a feed hiccup that hands back NaN must leave the last
 * good carry standing, and a "rate" of 40% is a units error (percent handed
 * over where a fraction was meant), not a market.
 */
export function setCarry(next: Partial<Carry>, note?: string): boolean {
  const ok = (v: number | undefined) => v === undefined || (Number.isFinite(v) && v > -0.05 && v < 0.25);
  if (!ok(next.r) || !ok(next.q)) return false;
  current = { r: next.r ?? current.r, q: next.q ?? current.q };
  source = {
    kind: 'feed',
    note: note ?? `feed r ${(current.r * 100).toFixed(2)}% · q ${(current.q * 100).toFixed(2)}%`,
  };
  return true;
}

/** Back to the documented assumptions — for tests and for a feed dropping. */
export function resetCarry(): void {
  current = { r: DEFAULT_R, q: DEFAULT_Q };
  source = {
    kind: 'assumed',
    note: `assumed r ${(DEFAULT_R * 100).toFixed(1)}% · q 0 until that name's yield is known`,
  };
}
