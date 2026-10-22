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

  THE INPUTS ARE THE VENDOR'S. Each expiry's strikes
  (greek-exposure/strike-expiry) carry the dollar gamma
  at spot; each leg's implied vol is its own contract's
  (option-contracts) where those rows are in — the
  front expiry on every name, every expiry for the name
  on the Map — else that expiry's at-the-money vol off
  the vendor's term structure. Time to expiry runs to
  4:00 ET on the date. Whatever of the whole book's
  per-strike total is not on a loaded date (the rare
  far listing) is carried flat. No vol at all on a book
  falls back to the running-net crossing.

  THE REGIME IS THE SIGN OF NET GAMMA AT SPOT, never the
  side of the flip: long gamma (absorbing) when net is
  positive in the retail sign, short (amplifying) when it
  is negative. The flip is where that changes, so the
  word, the net figure and the flip cannot disagree.
==================================================
*/

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

const legsOfDate = (chain: readonly StrikeNode[], date: string, atmIv: number, now: number): GammaLeg[] => {
  const t = yearsTo(date, now);
  const out: GammaLeg[] = [];
  for (const n of chain) {
    if (n.callGex) out.push({ strike: n.strike, g0: n.callGex, iv: n.callIv && n.callIv > 0 ? n.callIv : atmIv, t, oi: n.callIv && n.callOI > 0 ? n.callOI : undefined, side: 1 });
    if (n.putGex) out.push({ strike: n.strike, g0: n.putGex, iv: n.putIv && n.putIv > 0 ? n.putIv : atmIv, t, oi: n.putIv && n.putOI > 0 ? n.putOI : undefined, side: -1 });
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
  const now = Date.now();
  const minute = Math.floor(now / 60_000);
  const key = `${snapshot.ticker}|${dates === 'ALL' ? 'ALL' : dates.join(',')}|${want.length}|${spot}|${entry.at}|${minute}|${chain.length}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const term = entry.termIv ?? {};
  const legs: GammaLeg[] = [];
  let withVol = 0;
  for (const d of want) {
    const atm = term[d] ?? (entry.iv > 0 ? entry.iv : 0);
    const ls = legsOfDate(by[d], d, atm, now);
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
export const BELL_NONE_TITLE = (ticker: string): string => `Nothing on ${ticker} expires today — its nearest contracts expire on a later date`;

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
  const cwPct = ((callWall - spot) / Math.max(spot, 1)) * 100;
  const pwPct = ((spot - putWall) / Math.max(spot, 1)) * 100;
  const flipClause =
    flip == null
      ? ` No flip within ±10% — dealers stay ${long ? 'long' : 'short'} gamma across the whole range.`
      : ` A move ${flip > spot ? 'above' : 'below'} the ${px(flip)} flip turns them ${long ? 'short gamma, and their hedging starts to amplify moves' : 'long gamma, and their hedging starts to absorb moves'}.`;
  if (flip != null && (Math.abs(spot - flip) / Math.max(spot, 1)) * 100 < 0.05)
    return { key: 'ON THE FLIP', read: `Sitting on the ${px(flip)} flip — net gamma is near zero, so the hedging can tip either way; the ${px(callWall)} call wall overhead and the ${px(putWall)} put wall below are the levels that decide it.` };
  if (long && cwPct <= 1.2 && pwPct <= 1.2)
    return { key: 'PINNED', read: `Dealers are long gamma, so their hedging absorbs moves between the ${px(putWall)} put wall and the ${px(callWall)} call wall — dips get bought, rallies get sold, drift beats trend until one side gives.${flipClause}` };
  if (long)
    return { key: 'ABSORBING', read: `Dealers are long gamma, so their hedging absorbs moves; the ${px(callWall)} call wall overhead is the lid, and the ${px(putWall)} put wall below holds the most put hedging.${flipClause}` };
  if (pwPct >= 2.6)
    return { key: 'WHIPSAW', read: `Dealers are short gamma, so their hedging speeds a move up whichever way it goes, and the nearest put wall is all the way down at ${px(putWall)}.${flipClause}` };
  return {
    key: 'AMPLIFYING',
    read: `Dealers are short gamma, so their hedging amplifies moves. The ${px(putWall)} put wall below has the most put hedging: dealers buy dips into it while it holds, but they are short gamma there too, so a break can accelerate; the ${px(callWall)} call wall is the level overhead.${flipClause}`,
  };
}
