/* Which strike is the call wall and which the put wall: one rule in one place. */

/** Anything with a strike; the exposure is read through an accessor because callers spell it differently (`value`, `netGex`). */
interface Struck {
  readonly strike: number;
}

/** The walls, the one rule: the strike with the most call-leg gamma and the one with the most put-leg gamma, anywhere on the book
    (what most GEX tools print). No side-of-spot rule: a call wall below price is a real state. Null when no strike carries the leg. */
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

/* ---- One name per strike on every page: a strike that is several levels is all of them, in one order (supreme · call wall · put wall) ---- */
export type LevelRole = 'supreme' | 'call wall' | 'put wall' | 'flip';
/** The canonical order on every page: supreme · call wall · put wall · flip. */
export const LEVEL_ORDER: readonly LevelRole[] = ['supreme', 'call wall', 'put wall', 'flip'];
interface NamedLevels {
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

/* ---- A wall in words by where it sits: descriptions are written from the wall's side of price ---- */
type WallPlace = 'above' | 'below' | 'at';
export const wallPlace = (strike: number, spot: number): WallPlace => (Math.abs(strike - spot) < spot * 0.0005 ? 'at' : strike > spot ? 'above' : 'below');
/* The behaviour words follow the strike's net sign: a call wall whose puts outweigh it is short gamma, not a lid; a put wall whose calls outweigh
   it absorbs. `net` is the strike's net in the retail sign (+ dealers long); without it the words are the leg's. */
export function putWallWordsAt(place: WallPlace, net?: number | null): string {
  if (net != null && net > 0)
    return place === 'at'
      ? 'the most put gamma, right at price, but its calls outweigh it — dealers are long gamma there, so it tends to absorb a move either way'
      : place === 'above'
        ? 'the most put gamma, sitting above price, but its calls outweigh it — dealers are long gamma there, so a rally into it tends to be absorbed'
        : 'the most put gamma, below price, but its calls outweigh it — dealers are long gamma there, so a dip into it tends to be absorbed rather than accelerate';
  if (place === 'at') return 'the most put hedging, right at price — dealers are short gamma there, so a break below can accelerate';
  return place === 'above'
    ? 'the most put hedging, sitting above price — overhead put hedging, not a floor: if price rallies into it, dealers short gamma there can speed up selling'
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
