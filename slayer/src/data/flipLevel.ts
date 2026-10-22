/*
==================================================
  SLAYER TERMINAL - ONE FLIP FOR EVERY PAGE
  (data/flipLevel.ts)

  The flip every Pinpoint surface prints — the Map's
  levels card and ruler, the Agenda, the Board's
  "Flip · how far" and "Flip crossed today", Compare —
  is read here, off the same contracts the levels are
  read from (the LEVELS scope: today's own expiry, or
  every listed one), with core/gammaFlip.ts's rule: the
  price where the book's net gamma, re-priced at that
  price, crosses zero.

  THE INPUTS ARE THE VENDOR'S, AND THE SAME ON EVERY
  PAGE. Each expiry's strikes carry the vendor's live
  open-interest gamma at spot (spot-exposures — each
  contract's OI × Γ × 100 × S² × 1%, data/uwBook.ts), so
  re-pricing a leg is pricing those contracts outright:
  G(S) = G₀ · Γ(S)S² / Γ(S₀)S₀², exact at spot, with no
  constant carried. The vol a leg is re-priced with: the
  FRONT expiry's legs use their own contract's implied
  vol (option-contracts — loaded for every name, Board
  or Map); every later expiry uses that date's
  at-the-money vol off the term structure. The Map holds
  later dates' contract vols too, but a Board-only name
  does not, and the same ticker and scope must give the
  same flip whichever page loaded it first (the second
  re-audit, 2026-10-22: NVDA All expiries read 205.38 on
  the Board and 201.70 on the Map). Time to expiry runs
  to 4:00 ET on the date. Whatever of the whole book's
  per-strike total is not on a loaded date (a listing
  past the fortieth, or a date still loading — the flip
  is then marked provisional) is carried flat. No vol at
  all on a book falls back to the running-net crossing.

  THE REGIME IS THE SIGN OF NET GAMMA AT SPOT, never the
  side of the flip: long gamma (absorbing) when net is
  positive in the retail sign, short (amplifying) when it
  is negative. The flip is where that changes, so the
  word, the net figure and the flip cannot disagree.
==================================================
*/

import { todayScopeLabel } from './bookWindow';
import { DEFAULT_R } from '../core/carry';
import { cumulativeFlip, repricedFlip, type FlipRead, type GammaLeg } from '../core/gammaFlip';
import { nyIsoDate, nyMinutes } from '../core/nyTime';
import { bookToday, isoDate } from '../core/calendar';
import { peekEntry } from './uwBook';
import { registeredDates } from './chainDates';
import type { MarketSnapshot, StrikeNode } from '../types/market';

/* ---- which dates a chain is ---------------------------------------------------------------------------------- */

/** Which expiry dates a chain is: one date's own strikes, a registered sum of dates, or the whole live book */
export function datesOf(snapshot: MarketSnapshot, chain: readonly StrikeNode[]): string[] | 'ALL' | null {
  const reg = registeredDates(chain);
  if (reg) return reg;
  const by = snapshot.uwByDate;
  if (by) for (const d of Object.keys(by)) if (by[d] === chain) return [d];
  if (snapshot.uwChains?.ALL === chain) return 'ALL';
  return null;
}

/* ---- the clock and the vol ----------------------------------------------------------------------------------- */

const YEAR_MIN = 365 * 24 * 60;
/** Years from now to 4:00 ET on the expiry date — five minutes at the least, so a leg at the bell stays finite */
export function yearsTo(expiry: string, now: number = Date.now()): number {
  const today = nyIsoDate(now);
  const days = Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const mins = days * 1440 + (16 * 60 - nyMinutes(now));
  return Math.max(5, mins) / YEAR_MIN;
}

/** One date's legs. `own`: re-price with each contract's own vol where it is in (the front date) — else the date's ATM vol */
const legsOfDate = (chain: readonly StrikeNode[], date: string, atmIv: number, now: number, own: boolean): GammaLeg[] => {
  const t = yearsTo(date, now);
  const out: GammaLeg[] = [];
  for (const n of chain) {
    if (n.callGex) out.push({ strike: n.strike, g0: n.callGex, iv: own && n.callIv && n.callIv > 0 ? n.callIv : atmIv, t });
    if (n.putGex) out.push({ strike: n.strike, g0: n.putGex, iv: own && n.putIv && n.putIv > 0 ? n.putIv : atmIv, t });
  }
  return out;
};

export interface LevelFlip extends FlipRead {
  /** False while some of the scope's expiries have not landed — the flip is then provisional */
  complete: boolean;
}

const cache = new Map<string, LevelFlip>();

/** The flip of the contracts in `chain` (defaults to the snapshot's levels chain) — see the head of this file */
export function levelFlip(snapshot: MarketSnapshot, chain: readonly StrikeNode[] = snapshot.chain): LevelFlip {
  const spot = snapshot.spot;
  const dates = snapshot.liveBook ? datesOf(snapshot, chain) : null;
  const entry = snapshot.liveBook ? peekEntry(snapshot.ticker) : undefined;
  const fallback = (): LevelFlip => ({ ...cumulativeFlip(chain.map(n => ({ strike: n.strike, net: n.netGex })), spot), complete: true });
  if (!dates || !entry || !snapshot.uwByDate) return fallback();
  const by = snapshot.uwByDate;
  const floor = isoDate(bookToday());
  const want = dates === 'ALL' ? Object.keys(by).filter(d => d >= floor && by[d]?.length) : dates.filter(d => by[d]?.length);
  if (!want.length) return fallback();
  const listed = (snapshot.uwExpiries ?? []).map(e => e.date).filter(d => d >= floor);
  const complete = dates === 'ALL' ? listed.length === 0 || listed.every(d => want.includes(d)) : true;
  const now = snapshot.asOf ?? Date.now();
  const minute = Math.floor(now / 60_000);
  const key = `${snapshot.ticker}|${dates === 'ALL' ? 'ALL' : dates.join(',')}|${want.length}|${spot}|${entry.at}|${minute}|${chain.length}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const term = entry.termIv ?? {};
  const legs: GammaLeg[] = [];
  let withVol = 0;
  /* the front date: the first live listing that holds strikes — the one date every page loads contracts for */
  const front = Object.keys(by).filter(d => d >= floor && by[d]?.length).sort()[0];
  for (const d of want) {
    const atm = term[d] ?? (entry.iv > 0 ? entry.iv : 0);
    const ls = legsOfDate(by[d], d, atm, now, d === front || snapshot.asOf != null);
    for (const l of ls) if (l.iv > 0) withVol++;
    legs.push(...ls);
  }
  if (!withVol) return fallback();
  if (dates === 'ALL') {
    /* the whole book's per-strike total less what the loaded dates hold, carried flat — G(spot) is the book's own net */
    const onDates = new Map<number, number>();
    for (const l of legs) onDates.set(l.strike, (onDates.get(l.strike) ?? 0) + l.g0);
    for (const n of chain) {
      const rest = n.netGex - (onDates.get(n.strike) ?? 0);
      if (rest) legs.push({ strike: n.strike, g0: rest, iv: 0, t: 0 });
    }
    for (const [k, v] of onDates) if (!chain.some(n => n.strike === k)) legs.push({ strike: k, g0: -v, iv: 0, t: 0 });
  }
  const read: LevelFlip = { ...repricedFlip(legs, spot, DEFAULT_R), complete };
  if (cache.size > 400) cache.clear();
  cache.set(key, read);
  return read;
}

/* ---- the words ----------------------------------------------------------------------------------------------- */

/** Long (absorbing) or short (amplifying) gamma at spot, off the house-signed net — the ONE regime rule */
export const regimeOfNet = (houseNet: number): 'LONG' | 'SHORT' | null => (houseNet < 0 ? 'LONG' : houseNet > 0 ? 'SHORT' : null);

const fmtK = (v: number) => (Math.abs(v - Math.round(v)) < 1e-9 ? v.toFixed(0) : v.toFixed(2));

/** The flip in a reader's words: "766.10" — or "no flip nearby" with what the book is across the whole range */
export function flipWords(read: Pick<FlipRead, 'flip' | 'netAtSpot' | 'range'>): string {
  if (read.flip != null) return fmtK(read.flip);
  const pct = Math.round(read.range * 100);
  return read.netAtSpot < 0 ? `no flip within ±${pct}% — dealers are long gamma across the whole range` : read.netAtSpot > 0 ? `no flip within ±${pct}% — dealers are short gamma across the whole range` : 'no flip nearby';
}

/** The short form for a cell: the flip, or "none nearby" */
export const flipShort = (read: Pick<FlipRead, 'flip'>): string => (read.flip != null ? fmtK(read.flip) : 'none nearby');

/** What the flip means here, one sentence: which side is which on THIS book */
export function flipMeaning(read: Pick<FlipRead, 'flip' | 'netAtSpot' | 'range'>, spot: number): string {
  if (read.flip == null) return flipWords(read);
  const long = read.netAtSpot < 0;
  const dir = read.flip > spot ? 'above' : 'below';
  return long
    ? `Dealers are long gamma here (their hedging absorbs moves); a move ${dir} ${fmtK(read.flip)} turns them short gamma, and their hedging starts to amplify moves.`
    : `Dealers are short gamma here (their hedging amplifies moves); a move ${dir} ${fmtK(read.flip)} turns them long gamma, and their hedging starts to absorb moves.`;
}

/* ---- "expires today", one wording for every page (the Map's clock, the Board, Compare, the Agenda) -------------- */

/** What "Expires today" prints when nothing on the name expires today */
export const BELL_NONE = '— none today';
export const BELL_NONE_TITLE = (ticker: string): string => `Nothing on ${ticker} expires ${todayScopeLabel() === 'Today' ? 'today' : 'in the next session'} — its nearest contracts expire on a later date`;

/* ---- the book in one sentence, on the one regime rule ----------------------------------------------------------- */

export interface RegimeRead {
  key: 'ON THE FLIP' | 'PINNED' | 'ABSORBING' | 'WHIPSAW' | 'AMPLIFYING';
  read: string;
}

/**
 * THE BOOK READ AS ONE SENTENCE — PINPOINT'S (replacing data/gex.ts readHeatPattern on these pages, which named the
 * regime by the side of the flip: "below the flip the hedging amplifies moves, whatever the book nets to"). The regime
 * is the sign of net gamma at spot; the flip is where it changes; the levels are named as the Agenda names them — the
 * call wall (the most call hedging, a lid while dealers are long gamma there) and the put wall (the most put hedging:
 * dealers buy dips into it while it holds, but they are short gamma there, so a break can accelerate).
 */
export function readRegime(levels: { spot: number; flip: number; flipFound?: boolean; callWall: number; putWall: number; net?: number }): RegimeRead {
  const { spot, callWall, putWall } = levels;
  const flip = levels.flipFound === false ? null : levels.flip;
  const px = (v: number) => v.toFixed(2);
  const long = levels.net != null ? levels.net < 0 : flip != null && spot >= flip;
  /* THE WALLS ARE THE MOST CALL AND THE MOST PUT GAMMA, EITHER SIDE OF PRICE (core/walls.ts pickLegWalls, the second
     re-audit 2026-10-22) — so each is placed in words by where it actually is */
  const side = (k: number) => (Math.abs(k - spot) < 1e-9 ? 'at price' : k > spot ? 'above' : 'below');
  const cw = `the ${px(callWall)} call wall ${side(callWall)}`;
  const pw = `the ${px(putWall)} put wall ${side(putWall)}`;
  const cwPct = (Math.abs(callWall - spot) / Math.max(spot, 1)) * 100;
  const pwPct = (Math.abs(spot - putWall) / Math.max(spot, 1)) * 100;
  const between = putWall < spot && spot < callWall;
  const flipClause =
    flip == null
      ? ` No flip within ±10% — dealers stay ${long ? 'long' : 'short'} gamma across the whole range.`
      : ` A move ${flip > spot ? 'above' : 'below'} the ${px(flip)} flip turns them ${long ? 'short gamma, and their hedging starts to amplify moves' : 'long gamma, and their hedging starts to absorb moves'}.`;
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  if (flip != null && (Math.abs(spot - flip) / Math.max(spot, 1)) * 100 < 0.05)
    return { key: 'ON THE FLIP', read: `Sitting on the ${px(flip)} flip — net gamma is near zero, so the hedging can tip either way; ${cw} and ${pw} are the levels that decide it.` };
  if (long && between && cwPct <= 1.2 && pwPct <= 1.2)
    return { key: 'PINNED', read: `Dealers are long gamma, so their hedging absorbs moves between the ${px(putWall)} put wall and the ${px(callWall)} call wall — dips get bought, rallies get sold, drift beats trend until one side gives.${flipClause}` };
  if (long)
    return { key: 'ABSORBING', read: `Dealers are long gamma, so their hedging absorbs moves. ${cap(cw)} has the most call hedging${callWall > spot ? ' — the lid' : callWall < spot ? ' — price is through it, so it can act as support' : ''}; ${pw} has the most put hedging.${flipClause}` };
  if (putWall < spot && pwPct >= 2.6)
    return { key: 'WHIPSAW', read: `Dealers are short gamma, so their hedging speeds a move up whichever way it goes, and the put wall is all the way down at ${px(putWall)}.${flipClause}` };
  return {
    key: 'AMPLIFYING',
    read: `Dealers are short gamma, so their hedging amplifies moves. ${cap(pw)} has the most put hedging: dealers buy dips into it while it holds, but they are short gamma there too, so a break can accelerate; ${cw} has the most call hedging.${flipClause}`,
  };
}
