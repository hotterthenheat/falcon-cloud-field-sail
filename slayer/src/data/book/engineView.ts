/*
  A name's book as every page reads it (store.ts peekEntry): the loaded entry — price, bars, vols, the expiry listing —
  with its exposure chains replaced by the two-book engine's (docs/TWO_BOOK.md §The Map). `all` and `byDate` are the
  chosen book's cells (twobook/legs.ts chainsOfLegs): the open-interest book's (Model 1) or, for a name that follows the
  Map's toggle while it is set so, the flow book's (Model 2). Nothing the old per-date reads computed is drawn: the
  matrix, the strike chart and ladder, the walls, the flip, the regime, the Board, Compare, the Agenda, Building and
  Terrain's rail all add up these cells, so the Map's totals are the engine's board totals.

  Until the chosen book's board is in, the view holds no chains (the pages show their loading state, never the old
  figures). One view per (entry state, board, book), so a page that asks twice gets the same arrays.
*/

import { bookToday, isoDate } from '../../core/calendar';
import type { GexSnapshot, StrikeNode, Candle } from '../../types/market';
import type { BookMode } from '../bookMode';
import { bookFor, engineKnows, peekBook } from '../twobook/engineBook';
import { chainsOfLegs, type BookChains } from '../twobook/legs';
import type { FlowBoardWire } from '../twobook/flowBook';
import type { Model1Wire } from '../twobook/model1';
import type { Entry } from './store';

/** What a view carries about the board it was built from */
export interface EngineFacts {
  mode: BookMode;
  wire: Model1Wire | FlowBoardWire | null;
  /** why there are no chains (the board failed or is not in yet) */
  why: string | null;
  /** the board's instant and the price it is priced at (Model 1: the row price; Model 2: the implied spot S*) */
  at: number | null;
  price: number | null;
  /** CHARM, COLOR and VETA per calendar day or hour (§4.5) */
  unit: 'day' | 'hour';
  /** T (years, at the board's instant) per date */
  T: Record<string, number>;
  /** the rate and the carry the board priced at: Model 1 r = b = 0 (UW_COMPAT); Model 2 r and each date's b */
  r: number;
  b: Record<string, number>;
  /** false while the open-interest board waits on its contracts (the six, the open interest, the vols) */
  sixIn: boolean;
}

/* the replay's per-minute book is built off the view's own whole book (book/levels.ts historyFrom, registered there) */
let historyMaker: ((chain: StrikeNode[], candles: Candle[], ticker: string) => GexSnapshot[]) | null = null;
export function setHistoryMaker(fn: typeof historyMaker): void {
  historyMaker = fn;
}

const histMemo = new WeakMap<StrikeNode[], { candles: Candle[]; out: GexSnapshot[] }>();
function historyOf(all: StrikeNode[], candles: Candle[], ticker: string): GexSnapshot[] {
  if (!historyMaker || !candles.length) return [];
  const hit = histMemo.get(all);
  if (hit && hit.candles === candles) return hit.out;
  const out = historyMaker(all, candles, ticker);
  histMemo.set(all, { candles, out });
  return out;
}

const chainMemo = new WeakMap<object, BookChains>();
function chainsOf(wire: Model1Wire | FlowBoardWire): BookChains | null {
  if (!wire.legs) return null;
  const hit = chainMemo.get(wire);
  if (hit) return hit;
  const price = wire.model === 1 ? wire.price : wire.spot?.S ?? null;
  const at = wire.model === 1 ? wire.at : wire.valuedAt;
  const got = chainsOfLegs(wire.legs, price ?? NaN, at ?? NaN);
  chainMemo.set(wire, got);
  return got;
}

const DAY_MS = 86_400_000;
const calDays = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

interface Memo {
  src: unknown[];
  mode: BookMode;
  wire: unknown;
  error: string | null;
  view: Entry;
}
const memo = new WeakMap<Entry, Memo>();
/* every own field of the loaded entry, by reference: a loader that sets one in place makes a new view */
const sourceOf = (e: Entry): unknown[] => {
  const out: unknown[] = [];
  for (const k of Object.keys(e)) out.push(k, (e as unknown as Record<string, unknown>)[k]);
  return out;
};
const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export function engineView(e: Entry): Entry {
  if (e.engine) return e;
  /* an entry no loader asked the engine for (a recorded book a proof lays in the store) is read as it is */
  if (!engineKnows(e.ticker)) return e;
  const mode = bookFor(e.ticker);
  const got = peekBook(e.ticker, mode);
  const src = sourceOf(e);
  const hit = memo.get(e);
  if (hit && hit.mode === mode && hit.wire === got.wire && hit.error === got.error && same(hit.src, src)) return hit.view;
  const view = build(e, mode, got.wire, got.error, got.loading);
  memo.set(e, { src, mode, wire: got.wire, error: got.error, view });
  return view;
}

function build(e: Entry, mode: BookMode, wire: Model1Wire | FlowBoardWire | null, error: string | null, loading: boolean): Entry {
  const unavailable = wire && wire.model === 1 && !wire.available ? wire.why : null;
  const chains = wire && !unavailable ? chainsOf(wire) : null;
  const why = chains ? null : unavailable ?? error ?? (loading ? null : wire ? 'the board holds no contracts' : null);
  const engine: EngineFacts = {
    mode,
    wire,
    why,
    at: wire ? (wire.model === 1 ? wire.at : wire.valuedAt) : null,
    price: wire ? (wire.model === 1 ? wire.price : wire.spot?.S ?? null) : null,
    unit: wire?.unit ?? 'day',
    T: chains?.T ?? {},
    r: wire && wire.model === 2 ? wire.rate?.r ?? 0 : 0,
    b: wire && wire.model === 2 ? Object.fromEntries(wire.expiries.map(x => [x.id.slice(x.id.lastIndexOf('|') + 1), x.b])) : {},
    sixIn: !!chains?.sixIn,
  };
  if (!chains) return { ...e, all: [], byDate: {}, history: [], engine, factsDates: new Set(), frontFacts: false };
  const floor = isoDate(bookToday());
  const listed = new Map(e.expiries.map(x => [x.date, x.dte]));
  const dates = Object.keys(chains.byDate).sort();
  /* the listing is the board's own dates (a listed date the board has no cell on holds no contracts in this book) */
  const expiries = dates.map(d => ({ date: d, dte: listed.get(d) ?? Math.max(0, calDays(floor, d)) }));
  const totals = dates.map(d => ({ date: d, gross: chains.byDate[d].reduce((a, n) => a + Math.abs(n.callGex) + Math.abs(n.putGex), 0) }));
  const candles = e.tape?.length >= 2 ? e.tape : e.candles;
  const history = historyOf(chains.all, candles, e.ticker);
  return {
    ...e,
    all: chains.all,
    byDate: chains.byDate,
    expiries,
    totals,
    totalsAt: engine.at ?? e.totalsAt,
    factsDates: chains.sixIn ? new Set(dates) : new Set(),
    frontFacts: chains.sixIn,
    everFull: true,
    gammaLive: true,
    history,
    history0: undefined,
    historyRest: undefined,
    engine,
  };
}
