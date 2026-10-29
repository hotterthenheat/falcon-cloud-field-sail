/* The rate and yield every greek is priced against: r is DEFAULT_R until a feed calls setCarry (Pinpoint and Dossier never do),
   q is 0 unless a name's own yield is set. */

interface Carry {
  /** Continuously-compounded risk-free rate, annualized (0.042 = 4.2%). */
  r: number;
  /** Continuous dividend yield, annualized (0 unless the name's own yield is known). */
  q: number;
}

/* The neighbourhood of the front-end Treasury yield. Not live — see above. */
export const DEFAULT_R = 0.042;
/* Zero until a name's own yield is set. A stock that pays nothing stays at zero.
   1.2% is not applied to every name. */
export const DEFAULT_Q = 0;

let current: Carry = { r: DEFAULT_R, q: DEFAULT_Q };

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

