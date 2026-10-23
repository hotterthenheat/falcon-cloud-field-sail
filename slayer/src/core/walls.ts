/*
==================================================
  SLAYER TERMINAL - NAMING THE WALLS (core/walls.ts)

  Which strike is THE call wall, and which is THE
  put wall. One rule, in one place, because it was
  written twice and the two copies disagreed.
==================================================
*/

/** Anything carrying a strike. The exposure is read through an accessor
    because the two callers spell the SAME NUMBER differently: the GEX
    snapshot's levels call it `value`, the option chain's nodes call it
    `netGex`, and `computeGexSnapshot` is literally
    `chain.map(n => ({ strike: n.strike, value: n.netGex }))` (simulator.ts).
    An accessor makes that identity visible at each call site and costs no
    per-tick array to convert between the two spellings. */
export interface Struck {
  readonly strike: number;
}

/**
 * The heaviest CALL-dominant shelf above spot, and the heaviest PUT-dominant
 * shelf below it.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SIGN IS CHECKED, AND WHY THIS FILE EXISTS AT ALL
 * ---------------------------------------------------------------------------
 * The original rule was |value| plus SIDE OF SPOT. Side of spot is only a
 * PROXY for option side. It holds for a fresh OI profile (simulator.ts seeds
 * calls above spot, puts below) and deliberately does NOT hold for the live
 * book, which is sticky by design (BOOK_BLEND, ~1h half-life: "walls persist,
 * get tested, and fade for real instead of shadowing price"). So a shelf keeps
 * its option side while price walks past it and its side of spot flips.
 *
 * Measured on SPY at spot 505.17: strike 505 carried -$436.8M — CALL-dominant
 * — and was named the PUT wall, so the strike rail printed a red PW tag on a
 * row sitting ABOVE its own flip rule at 504.50. A put wall on the call side
 * of the flip is not a thing that can exist.
 *
 * The sign IS the measured option side. `netGex = callGex + putGex` with
 * `dealerCallDirection = -0.55` and `dealerPutDirection = -0.53 * -1`
 * (simulator.ts), so NEGATIVE is call-dominant and POSITIVE is put-dominant.
 * Every other surface already reads it that way: the heat ramps, the strike
 * field's `put: l.value >= 0`, and the rail's own bar colour.
 *
 * ---------------------------------------------------------------------------
 * AND WHY IT IS SHARED RATHER THAN FIXED TWICE
 * ---------------------------------------------------------------------------
 * This rule existed in two places — `buildLevelsFor` (data/gex.ts) and
 * `generateTradePlan` (core/simulator.ts) — over the same numbers. Only the
 * first was fixed. The second kept feeding `plan.resistanceWall` /
 * `plan.supportWall` into three more surfaces: the GEX matrix's highlighted
 * wall rows, `readHeatPattern`'s prose, and the Pulse board. Terrain read the
 * corrected rule while the GEX page read the broken one, off one book.
 *
 * The FLIP had already been noticed and hand-synced across the same two
 * functions ("Matches data/gex.ts buildLevelsFor", simulator.ts) — a comment
 * asking the next reader to keep two copies in step. The walls are the case
 * where that did not survive. So the rule moved here instead.
 *
 * @param points  strikes to consider; order does not matter
 * @param spot    the price the sides are measured from
 * @param valueOf net dealer exposure at a strike — negative call-dominant,
 *                positive put-dominant
 * @returns each wall, or `null` where NOTHING on that side qualifies —
 *          "no call wall overhead" is a real state of the book, and callers
 *          disagree about how to render it, so the choice of fallback stays
 *          with them rather than being invented here.
 */
export function pickWalls<T extends Struck>(
  points: readonly T[],
  spot: number,
  valueOf: (p: T) => number
): { callWall: number | null; putWall: number | null } {
  let callWall: number | null = null;
  let cwAbs = 0;
  let putWall: number | null = null;
  let pwAbs = 0;

  for (const p of points) {
    const v = valueOf(p);
    const a = Math.abs(v);
    // Same magnitude comparison as before, restricted to the half of the book
    // the name actually claims. No new arithmetic.
    if (p.strike > spot && v < 0 && a > cwAbs) {
      cwAbs = a;
      callWall = p.strike;
    }
    if (p.strike < spot && v > 0 && a > pwAbs) {
      pwAbs = a;
      putWall = p.strike;
    }
  }

  return { callWall, putWall };
}

/**
 * PINPOINT'S WALLS — THE RETAIL DEFINITION (the second re-audit, 2026-10-22). The call wall is the strike with the most
 * CALL gamma (the call leg's GEX), the put wall the strike with the most PUT gamma (the put leg's), anywhere on the
 * book: the definition most GEX tools print, and what the copy has always said ("call wall = most call gamma"). The
 * net-dominant pick above spot (pickWalls) named SPY 780 the call wall while 770 held the most call gamma, and 760 the
 * put wall while 769 held the most put gamma. No side-of-spot rule: a call wall below price is a real state (price has
 * gone through resistance and it may now act as support), and the pages say so.
 *
 * @param callOf the strike's call-leg gamma, either sign (its magnitude is read)
 * @param putOf  the strike's put-leg gamma, either sign
 * @returns each wall, or null when no strike carries that leg
 */
export function pickLegWalls<T extends Struck>(
  points: readonly T[],
  callOf: (p: T) => number,
  putOf: (p: T) => number
): { callWall: number | null; putWall: number | null } {
  let callWall: number | null = null;
  let cwAbs = 0;
  let putWall: number | null = null;
  let pwAbs = 0;
  for (const p of points) {
    const c = Math.abs(callOf(p));
    const q = Math.abs(putOf(p));
    if (c > cwAbs) {
      cwAbs = c;
      callWall = p.strike;
    }
    if (q > pwAbs) {
      pwAbs = q;
      putWall = p.strike;
    }
  }
  return { callWall, putWall };
}

/**
 * The gamma flip: the sign-change midpoint NEAREST SPOT.
 *
 * ---------------------------------------------------------------------------
 * THE WALLS' STORY, A SECOND TIME — caught before it finished happening
 * ---------------------------------------------------------------------------
 * This rule was written four times: `buildExposureProfile` (data/exposure.ts),
 * `buildLevelsFor` (data/gex.ts), `generateTradePlan` (core/simulator.ts) —
 * all three nearest-to-spot, hand-synced by comments asking the next reader to
 * keep them in step — and `levelsFrom` (data/vannacharm.ts), which walked up
 * the chain and BROKE ON THE FIRST crossing it met.
 *
 * First-from-the-bottom is the exact bug the other three were unified to fix
 * (2026-08-18): a noisy book can carry a jitter crossing deep in the put tail,
 * and breaking on the first hit names THAT the regime border while the
 * structural flip sits at spot. Every migration map, level-shift row and wall
 * drift timeline read the divergent copy, so the flip the Vanna & Charm page
 * projected could disagree with the flip the Exposure page drew, off one book.
 *
 * The fourth copy was found when P-4 needed a FIFTH reader of the rule. Same
 * decision as the walls above: the rule moves here, every caller points at it,
 * and the next surface that needs a flip cannot write its own.
 *
 * @returns the crossing nearest spot, or `null` when the field never changes
 *          sign — a one-sided book has no flip, and "no flip" is a real state
 *          the caller has to render deliberately rather than inherit as spot.
 */
export function pickFlip<T extends Struck>(
  points: readonly T[],
  spot: number,
  valueOf: (p: T) => number
): number | null {
  const asc = [...points].sort((a, b) => a.strike - b.strike);
  let flip: number | null = null;
  let flipDist = Infinity;
  for (let i = 1; i < asc.length; i++) {
    if (Math.sign(valueOf(asc[i - 1])) !== Math.sign(valueOf(asc[i]))) {
      const mid = (asc[i - 1].strike + asc[i].strike) / 2;
      const d = Math.abs(mid - spot);
      if (d < flipDist) {
        flipDist = d;
        flip = mid;
      }
    }
  }
  return flip;
}

/* ---- ONE NAME PER STRIKE, EVERY PAGE (the retail test, 2026-10-23) --------------------------------------------------
   SPY's 769 read "PUT WALL" on the Agenda's row and the Board, "supreme" on the Map, and the Agenda's head said the only
   wall in reach was 770. A strike that is several levels is all of them, said in one order everywhere:
   supreme · call wall · put wall. */
export type LevelRole = 'supreme' | 'call wall' | 'put wall' | 'flip';
/** THE CANONICAL ORDER, every page (the sixth audit, 2026-10-23): supreme · call wall · put wall · flip */
export const LEVEL_ORDER: readonly LevelRole[] = ['supreme', 'call wall', 'put wall', 'flip'];
export interface NamedLevels {
  supreme?: number | null;
  callWall?: number | null;
  putWall?: number | null;
  /** The flip — named only when the caller hands it (a strike is rarely exactly the flip) */
  flip?: number | null;
}
const same = (a: number | null | undefined, b: number) => a != null && Math.abs(a - b) < 1e-9;
/** Every level a strike is, in the one order: supreme, call wall, put wall, flip */
export function levelRoles(strike: number, levels: NamedLevels): LevelRole[] {
  const out: LevelRole[] = [];
  if (same(levels.supreme, strike)) out.push('supreme');
  if (same(levels.callWall, strike)) out.push('call wall');
  if (same(levels.putWall, strike)) out.push('put wall');
  if (same(levels.flip, strike)) out.push('flip');
  return out;
}
/** "769 · supreme · put wall" — the strike and every level it is (the strike alone when it is none) */
export function strikeWithRoles(strike: number, levels: NamedLevels, fmt: (k: number) => string = k => String(k)): string {
  const roles = levelRoles(strike, levels);
  return roles.length ? `${fmt(strike)} · ${roles.join(' · ')}` : fmt(strike);
}

/* ---- A WALL IN WORDS, BY WHERE IT SITS (the retail test, 2026-10-23: "the 769.00 put wall above … dealers buy dips
   into it" — a level above price cannot be bought into on a dip). The description is written from the wall's side of
   price. */
export type WallPlace = 'above' | 'below' | 'at';
export const wallPlace = (strike: number, spot: number): WallPlace => (Math.abs(strike - spot) < spot * 0.0005 ? 'at' : strike > spot ? 'above' : 'below');
/* THE BEHAVIOUR WORDS FOLLOW THE STRIKE'S NET SIGN (the ninth audit, 2026-10-23: Compare called SPY's 762 call wall "a
   lid: dealers long gamma there sell into rallies" and, a line later, "its puts are heavier still, so its net is
   negative" — the same strike explained two opposite ways). A call wall is the most CALL gamma, but where its puts
   outweigh it the dealers are short gamma there: it is not a lid. A put wall whose calls outweigh it is long gamma: it
   absorbs rather than accelerates. `net` is the strike's net gamma in the RETAIL sign (+ dealers long, absorbs); without
   it the words are the leg's alone, as before. */
export function putWallWordsAt(place: WallPlace, net?: number | null): string {
  if (net != null && net > 0)
    return place === 'at'
      ? 'the most put gamma, right at price, but its calls outweigh it — dealers are long gamma there, so it tends to absorb a move either way'
      : place === 'above'
        ? 'the most put gamma, sitting above price, but its calls outweigh it — dealers are long gamma there, so a rally into it tends to be absorbed'
        : 'the most put gamma, below price, but its calls outweigh it — dealers are long gamma there, so a dip into it tends to be absorbed rather than accelerate';
  if (place === 'at') return 'the most put hedging, right at price — dealers are short gamma there, so a break below can accelerate';
  return place === 'above'
    ? 'the most put hedging, sitting above price — overhead put hedging, not a floor: if price rallies into it, dealers short gamma there can speed up selling, or it can act as a magnet'
    : 'the most put hedging, below price — support while it holds; dealers are short gamma there, so a break below can accelerate';
}
export function callWallWordsAt(place: WallPlace, net?: number | null): string {
  if (net != null && net < 0)
    return place === 'at'
      ? 'the most call gamma, right at price, but its puts outweigh it — not a lid: dealers are short gamma there, so a move through it can run'
      : place === 'above'
        ? 'the most call gamma, above price, but its puts outweigh it — not a lid: dealers are short gamma there, so a rally into it can run'
        : 'the most call gamma, sitting below price, but its puts outweigh it — dealers are short gamma there, so a drop into it can run';
  if (place === 'at') return 'the most call hedging, right at price — dealers long gamma there lean against a move either way';
  return place === 'above'
    ? 'the most call hedging, above price — a lid: dealers long gamma there sell into rallies'
    : 'the most call hedging, sitting below price — price is through it, so it can act as support on a pullback while it holds';
}
export const putWallWords = (strike: number, spot: number, net?: number | null): string => putWallWordsAt(wallPlace(strike, spot), net);
export const callWallWords = (strike: number, spot: number, net?: number | null): string => callWallWordsAt(wallPlace(strike, spot), net);
