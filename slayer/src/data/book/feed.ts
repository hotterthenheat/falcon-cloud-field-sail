/* The book's readers: a name's snapshot for a scope, and the hooks a page mounts to keep its name's book loaded. */

import { useEffect, useMemo } from 'react';
import { startPinpoint } from '../vendorFeed';
import { nyMinutes } from '../../core/nyTime';
import { type Candle, type MarketSnapshot } from '../../types/market';
import { useDeskSession } from '../deskSession';
import { resolveDeskSession, type SessionRead } from '../compassSession';
import { levelsForName, useNameLevels, type LevelsScope } from '../levelsScope';
import { sameName } from '../spotGexBook';
import { PRICES_MS, refreshBoardPrices } from './day';
import { bookCandles, dayBars, materialize } from './levels';
import { ensureBook } from './load';
import { flowFocus } from '../twobook/engineBook';
import { markHotName, peekEntry, type BookMode, useBookRev } from './store';


/** Session bars once the book is live. Empty until then — never a made-up chain. */
export function liveBars(ticker: string): Candle[] {
  const t = ticker?.toUpperCase();
  if (!t) return [];
  ensureBook(t, 'board');
  return bookCandles(t) ?? dayBars(t) ?? [];
}

export function snapshotOf(ticker: string, mode: BookMode = 'board'): MarketSnapshot | null {
  const name = sameName(ticker);
  ensureBook(name, mode);
  const e = peekEntry(name);
  if (!e || e.status !== 'live' || !e.all.length || !(e.spot > 0)) return null;
  return materialize(e, levelsForName(ticker));
}

/** The session the charts should draw for this name. The clock still moves. A name that does not trade that window stays on the cash session. */
export function useResolvedSession(ticker: string): SessionRead {
  const asked = useDeskSession();
  const rev = useBookRev();
  return useMemo(() => {
    const bars = dayBars(ticker);
    const mins = bars ? bars.map(b => nyMinutes(b.time * 1000)) : null;
    return resolveDeskSession(ticker, mins, asked);
  }, [ticker, asked, rev]);
}

/** The name on screen. Full book: every expiry column, the session's minutes. Null until the first live print — never the simulator's price. */
export function usePinpointFeed(ticker: string | null | undefined): MarketSnapshot | null {
  const name = ticker ? sameName(ticker) : ticker;
  const scope = useNameLevels(name);
  const version = useBookRev();
  useEffect(() => {
    if (!name) return;
    markHotName(name);
    /* the Map's name follows its book switch (twobook/engineBook.ts) */
    flowFocus(name);
    const had = peekEntry(name);
    ensureBook(name, 'full', had?.status === 'error');
    startPinpoint(name);
    const id = window.setInterval(() => ensureBook(name, 'full'), 30_000);
    const px = window.setInterval(() => refreshBoardPrices([name]), PRICES_MS);
    return () => {
      window.clearInterval(id);
      window.clearInterval(px);
    };
  }, [name]);
  return useMemo(() => {
    if (!name) return null;
    const e = peekEntry(name);
    if (!e || e.status !== 'live' || !e.all.length) return null;
    return materialize(e, scope);
    // version bumps when a book lands or refreshes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, scope, version]);
}

/** A name's live snapshot read for a scope you name (not the desk's Levels card) — null until the book is live */
export function snapshotFor(ticker: string, scope: LevelsScope, mode: BookMode = 'board'): MarketSnapshot | null {
  ensureBook(ticker, mode);
  const e = peekEntry(ticker);
  if (!e || e.status !== 'live' || !e.all.length || !(e.spot > 0)) return null;
  return materialize(e, scope);
}
