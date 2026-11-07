/*
  A book's cells — every (expiry, strike) of one board, both legs — on the wire and as the chains the pages draw
  (docs/TWO_BOOK_SPEC_V2.md; what was built: docs/TWO_BOOK.md §The Map). Both books send the same shape:
    - the open-interest book (Model 1, /api/twobook/oi): the four from the listed rows converted per §3.4, the six from
      the engine in UW_COMPAT mode on the same contracts;
    - the flow book (Model 2, /api/tape/flowbook): all ten from the engine in SLAYER mode on the signed prints.
  One unit system (§4.4), the board's one time unit for CHARM, COLOR and VETA (§4.5). Σ over the cells is the board's
  totals: the Map, its walls, flip and regime, and every page that reads a name's book read these and nothing else.

  On the wire a cell is a flat row (LEG_AT names the slots); null is a figure not in yet (the six while the contracts are
  read). As a chain each figure is KEPT in the house sign (core/dealerSign.ts: the negative of the dealer figure, which is
  what the engine's Slayer sign is), so every reader that turns kept figures into what a page prints keeps working.
  Pure: no fetch, no clock.
*/

import { EXPOSURE_NAMES, type ExposureName } from '../../engine/twobook/exposures';
import type { StrikeNode } from '../../types/market';

export interface BookLegs {
  /** The cells' expiry dates, nearest first, each with T in years at the board's instant (its nearest-settling root) */
  dates: { date: string; T: number }[];
  /** One row a cell: see LEG_AT */
  cells: (number | null)[][];
}

const N = EXPOSURE_NAMES.length;
/** The slots of a cell row */
export const LEG_AT = {
  date: 0,
  strike: 1,
  /** the ten, call leg then put leg, in EXPOSURE_NAMES order */
  call: 2,
  put: 2 + N,
  callOI: 2 + 2 * N,
  putOI: 3 + 2 * N,
  callIv: 4 + 2 * N,
  putIv: 5 + 2 * N,
  callGamma: 6 + 2 * N,
  putGamma: 7 + 2 * N,
} as const;
export const LEG_WIDTH = 8 + 2 * N;

/** One figure of a cell, Slayer sign (+ = modelled dealer long), NaN when not in */
export const legValue = (row: readonly (number | null)[], right: 'C' | 'P', name: ExposureName): number => {
  const v = row[(right === 'C' ? LEG_AT.call : LEG_AT.put) + EXPOSURE_NAMES.indexOf(name)];
  return v == null ? NaN : v;
};

/** The higher greeks a strike carries straight from the engine (house sign), call and put */
export type EngineHigher = Record<'color' | 'vomma' | 'speed' | 'veta' | 'zomma', { call: number; put: number }>;
const HIGHER_OF: Record<keyof EngineHigher, ExposureName> = { color: 'COLOR', vomma: 'VOMMA', speed: 'SPEED', veta: 'VETA', zomma: 'ZOMMA' };

/** House sign: the kept figure is the negative of the dealer (Slayer) figure; 0 stays 0 */
const kept = (v: number | null | undefined): number => (v == null || !Number.isFinite(v) || v === 0 ? 0 : -v);
const num = (v: number | null | undefined): number => (v == null || !Number.isFinite(v) ? 0 : v);

export interface BookChains {
  /** Per expiry date, strikes ascending */
  byDate: Record<string, StrikeNode[]>;
  /** Every date added, strike by strike */
  all: StrikeNode[];
  /** Per date, T in years at the board's instant */
  T: Record<string, number>;
  /** False while the six (and the open interest) are not in */
  sixIn: boolean;
}

/** The engine's figures as the chains every page reads. `price`/`at`: what the board is priced at and when. */
export function chainsOfLegs(legs: BookLegs, price: number, at: number): BookChains {
  const byDate: Record<string, StrikeNode[]> = {};
  const T: Record<string, number> = {};
  for (const d of legs.dates) {
    byDate[d.date] = [];
    T[d.date] = d.T;
  }
  let sixIn = legs.cells.length > 0;
  const allBy = new Map<number, StrikeNode>();
  const higherKeys = Object.keys(HIGHER_OF) as (keyof EngineHigher)[];
  for (const row of legs.cells) {
    const date = legs.dates[row[LEG_AT.date] as number]?.date;
    if (!date) continue;
    const k = row[LEG_AT.strike] as number;
    const c = (n: ExposureName) => row[LEG_AT.call + EXPOSURE_NAMES.indexOf(n)];
    const p = (n: ExposureName) => row[LEG_AT.put + EXPOSURE_NAMES.indexOf(n)];
    const six = c('VEGA') != null;
    if (!six) sixIn = false;
    const higher: EngineHigher | undefined = six
      ? (Object.fromEntries(higherKeys.map(h => [h, { call: kept(c(HIGHER_OF[h])), put: kept(p(HIGHER_OF[h])) }])) as EngineHigher)
      : undefined;
    const callOI = num(row[LEG_AT.callOI]);
    const putOI = num(row[LEG_AT.putOI]);
    const node: StrikeNode = {
      strike: k,
      gexPx: price,
      gexAt: at,
      bookPx: price,
      callOI,
      putOI,
      gamma: 0,
      callGex: kept(c('GEX')),
      putGex: kept(p('GEX')),
      netGex: kept(c('GEX')) + kept(p('GEX')),
      callDex: kept(c('DEX')),
      putDex: kept(p('DEX')),
      netDex: kept(c('DEX')) + kept(p('DEX')),
      callVex: kept(c('VEGA')),
      putVex: kept(p('VEGA')),
      netVex: kept(c('VEGA')) + kept(p('VEGA')),
      vanna: 0,
      charm: 0,
      callVanna: kept(c('VANNA')),
      putVanna: kept(p('VANNA')),
      netVanna: kept(c('VANNA')) + kept(p('VANNA')),
      callCharm: kept(c('CHARM')),
      putCharm: kept(p('CHARM')),
      netCharm: kept(c('CHARM')) + kept(p('CHARM')),
      callIv: num(row[LEG_AT.callIv]) || undefined,
      putIv: num(row[LEG_AT.putIv]) || undefined,
      callGamma: num(row[LEG_AT.callGamma]) || undefined,
      putGamma: num(row[LEG_AT.putGamma]) || undefined,
      callBook: six ? callOI : undefined,
      putBook: six ? putOI : undefined,
      higher,
    };
    byDate[date].push(node);
    const a = allBy.get(k);
    if (!a) allBy.set(k, { ...node, callIv: undefined, putIv: undefined, callGamma: undefined, putGamma: undefined, higher: higher ? cloneHigher(higher) : undefined });
    else {
      a.callOI += node.callOI;
      a.putOI += node.putOI;
      if (a.callBook != null || node.callBook != null) a.callBook = (a.callBook ?? 0) + (node.callBook ?? 0);
      if (a.putBook != null || node.putBook != null) a.putBook = (a.putBook ?? 0) + (node.putBook ?? 0);
      for (const g of ['Gex', 'Dex', 'Vex', 'Vanna', 'Charm'] as const) {
        a[`call${g}`] += node[`call${g}`];
        a[`put${g}`] += node[`put${g}`];
        a[`net${g}`] = a[`call${g}`] + a[`put${g}`];
      }
      if (higher) {
        if (!a.higher) a.higher = cloneHigher(higher);
        else
          for (const h of higherKeys) {
            a.higher[h].call += higher[h].call;
            a.higher[h].put += higher[h].put;
          }
      }
    }
  }
  for (const d of Object.keys(byDate)) {
    byDate[d].sort((x, y) => x.strike - y.strike);
    if (!byDate[d].length) delete byDate[d];
  }
  const all = [...allBy.values()].sort((x, y) => x.strike - y.strike);
  return { byDate, all, T, sixIn };
}

const cloneHigher = (h: EngineHigher): EngineHigher => ({
  color: { ...h.color },
  vomma: { ...h.vomma },
  speed: { ...h.speed },
  veta: { ...h.veta },
  zomma: { ...h.zomma },
});

/** Σ of one figure over every cell, Slayer sign — what the board's total must equal (the consistency proof) */
export function legsTotal(legs: BookLegs, name: ExposureName): number {
  let s = 0;
  const ci = LEG_AT.call + EXPOSURE_NAMES.indexOf(name);
  const pi = LEG_AT.put + EXPOSURE_NAMES.indexOf(name);
  for (const row of legs.cells) s += num(row[ci]) + num(row[pi]);
  return s;
}
