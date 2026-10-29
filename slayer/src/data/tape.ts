/* The tape's print rules: what a print is (its kind), which way it reads (sentiment), what is never a bet, the Notable
   order, and the summary a view's head reads. */

import type { BookContract, FlowPrint, PrintSentiment, TapeSummary } from '../types/trace';
import { dayLean, hashId } from './traceLive';

/** A day-book row as a print for the contract card. The anchor is the clip the caller hands in (a flow alert's print, or
    the contract's real last trade); without one the card speaks for the day — never an invented print. */
export function bookRowToPrint(
  row: BookContract,
  clip?: { size: number; fill: number; side: 'ASK' | 'BID' | 'MID'; time: string; bid?: number; ask?: number; premium?: number; multi?: boolean; sweep?: boolean; extended?: boolean; theta?: number }
): FlowPrint {
  const fill = clip?.fill ?? row.last;
  const dl = dayLean(row);
  const side: FlowPrint['side'] = clip?.side ?? (dl.lean === 'ASK' ? 'ASK' : dl.lean === 'BID' ? 'BID' : 'MID');
  const bidQ = clip?.bid != null && clip.bid > 0 ? clip.bid : fill;
  const askQ = clip?.ask != null && clip.ask > 0 ? clip.ask : fill;
  const fillPos = askQ > bidQ ? Math.min(1, Math.max(0, (fill - bidQ) / (askQ - bidQ))) : 0.5;
  const size = clip?.size ?? row.volume;
  const bidPct = Number.isFinite(dl.bid) && row.sideVol ? Math.round((row.sideVol.bid / Math.max(1, row.sideVol.ask + row.sideVol.bid)) * 100) : 100 - row.askPct;
  /* a real clip says what it was; the day's multi-leg or sweep share speaks only when the card stands for the day */
  const multi = clip ? !!clip.multi : row.multiPct >= 30;
  const sweep = clip ? !!clip.sweep : row.sweepPct >= 40;

  return {
    id: hashId(`${row.key}-anchor`),
    time: clip?.time ?? row.lastAt,
    ticker: row.ticker,
    legs: multi ? 2 : 1,
    strike: row.strike,
    right: row.right,
    otmPct: row.otmPct,
    expiry: row.expiry,
    dte: row.dte,
    fill,
    bid: Number(bidQ.toFixed(2)),
    ask: Number(askQ.toFixed(2)),
    fillPos: Number(fillPos.toFixed(2)),
    side,
    ratioBidPct: bidPct,
    size,
    premium: clip ? Math.round(clip.premium ?? fill * size * 100) : Math.round(row.premium),
    volume: row.volume,
    oi: row.oi,
    deltaOI: row.deltaOI,
    spot: row.spot,
    iv: row.iv,
    volOverOI: row.volOverOI,
    strat: multi ? 'Custom' : '—',
    sweep,
    extended: clip?.extended || undefined,
    theta: clip?.theta ?? row.theta,
  };
}

/** A leg of a multi-leg order (its OPRA condition says so) is half of a structure, not a bet; Multi-Leg reads it */
export const isSpreadLeg = (p: Pick<FlowPrint, 'legs'> & Partial<Pick<FlowPrint, 'compression'>>): boolean => p.legs > 1 && !p.compression;

/** Never the largest print, the top bull or the top bear: compression, a floor package's leg, a cross, a spread leg */
export const notCrownable = (p: Pick<FlowPrint, 'legs'> & Partial<Pick<FlowPrint, 'compression' | 'floorPackage' | 'cross'>>): boolean =>
  !!p.compression || !!p.floorPackage || !!p.cross || isSpreadLeg(p);

/** At the ask was bought, on the bid sold: calls bought and puts sold read bullish. A mid print, an after-hours print,
    compression and a spread leg read neither. */
export function sentimentOf(p: FlowPrint): PrintSentiment {
  if (p.side === 'MID' || p.extended || p.compression || isSpreadLeg(p)) return 'NEUTRAL';
  return (p.right === 'C' && p.side === 'ASK') || (p.right === 'P' && p.side === 'BID') ? 'BULLISH' : 'BEARISH';
}

/** The Notable order: premium, aggression, size and how far out of the money, each against the buffer's own largest.
    The score orders the list and is never shown. */
export function rankNotable(prints: FlowPrint[]): FlowPrint[] {
  /* an unknown distance (a small index's whole-point level, no spot) scores 0, never NaN — NaN would leave the sort a no-op */
  const otmOf = (p: FlowPrint) => (Number.isFinite(p.otmPct) ? Math.max(0, p.otmPct) : 0);
  let maxPrem = 1;
  let maxSize = 1;
  let maxOtm = 1;
  for (const p of prints) {
    maxPrem = Math.max(maxPrem, p.premium);
    maxSize = Math.max(maxSize, p.size);
    maxOtm = Math.max(maxOtm, otmOf(p));
  }
  const score = (p: FlowPrint) => {
    const aggression = p.sweep ? 1 : p.side !== 'MID' ? 0.55 : 0.15;
    return 0.35 * (p.premium / maxPrem) + 0.25 * aggression + 0.2 * (p.size / maxSize) + 0.2 * (otmOf(p) / maxOtm);
  };
  return prints
    .map(p => [score(p), p] as const)
    .sort((a, b) => b[0] - a[0])
    .map(([, p]) => p);
}

/* A block is size in one print: one leg, BLOCK_MIN_SIZE contracts or BLOCK_MIN_PREMIUM dollars. A flow alert of several
   prints is a burst unless its largest single trade is known to clear that line. */
export type PrintKind = 'SWEEP' | 'BLOCK' | 'MULTI' | 'SINGLE' | 'COMPRESSION' | 'BURST';
export const BLOCK_MIN_SIZE = 100;
export const BLOCK_MIN_PREMIUM = 250_000;
export function printKind(p: Pick<FlowPrint, 'sweep' | 'legs' | 'strat' | 'size' | 'premium'> & Partial<Pick<FlowPrint, 'compression' | 'trades' | 'largestTrade' | 'floorPackage'>>): PrintKind {
  if (p.compression) return 'COMPRESSION';
  if (p.floorPackage) return 'MULTI';
  if (p.sweep) return 'SWEEP';
  if (p.legs > 1 || p.strat !== '—') return 'MULTI';
  if (p.trades != null && p.trades > 1) {
    const L = p.largestTrade;
    return L && (L.size >= BLOCK_MIN_SIZE || L.premium >= BLOCK_MIN_PREMIUM) ? 'BLOCK' : 'BURST';
  }
  if (p.size >= BLOCK_MIN_SIZE || p.premium >= BLOCK_MIN_PREMIUM) return 'BLOCK';
  return 'SINGLE';
}

export function summarizeTape(prints: FlowPrint[]): TapeSummary {
  let bull = 0;
  let bear = 0;
  let callCount = 0;
  let callPremium = 0;
  let putCount = 0;
  let putPremium = 0;
  let sweeps = 0;
  let blocks = 0;
  let multi = 0;
  let compCount = 0;
  let compPremium = 0;
  let legCount = 0;
  let legPremium = 0;
  let crossCount = 0;
  let crossPremium = 0;
  let largest: FlowPrint | null = null;

  for (const p of prints) {
    /* compression is in no other figure */
    if (p.compression) {
      compCount++;
      compPremium += p.premium;
      continue;
    }
    if (p.right === 'C') {
      callCount++;
      callPremium += p.premium;
    } else {
      putCount++;
      putPremium += p.premium;
    }
    /* a cross is in the call/put money, never a block, a side or the largest */
    if (p.cross) {
      crossCount++;
      crossPremium += p.premium;
      continue;
    }
    const kind = printKind(p);
    if (kind === 'SWEEP') sweeps++;
    else if (kind === 'BLOCK') blocks++;
    else if (kind === 'MULTI') multi++;
    if (isSpreadLeg(p)) {
      legCount++;
      legPremium += p.premium;
      continue;
    }
    if (!notCrownable(p) && (!largest || p.premium > largest.premium)) largest = p;
    const s = sentimentOf(p);
    if (s === 'BULLISH') bull += p.premium;
    else if (s === 'BEARISH') bear += p.premium;
  }

  const netPremium = bull - bear;
  return {
    totalPremium: callPremium + putPremium,
    netPremium,
    bullish: netPremium >= 0,
    bullPremium: bull,
    bearPremium: bear,
    callCount,
    callPremium,
    putCount,
    putPremium,
    pcRatio: callPremium > 0 ? Number((putPremium / callPremium).toFixed(2)) : 0,
    sweeps,
    blocks,
    multi,
    other: prints.length - compCount - crossCount - sweeps - blocks - multi,
    compression: { count: compCount, premium: compPremium },
    crosses: { count: crossCount, premium: crossPremium },
    spreadLegs: { count: legCount, premium: legPremium },
    largest: largest ? { ticker: largest.ticker, strike: largest.strike, right: largest.right, premium: largest.premium } : null,
  };
}
