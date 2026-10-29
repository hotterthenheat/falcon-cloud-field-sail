import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { readDeskPrefs } from '../data/deskPrefs';
import type { TickerSymbol } from '../types/market';

/* The name on the desk, and nothing else. Prices, books and prints come from the live feeds each page reads
   (liveQuote, uwBook, traceLive, ThetaData); this provider runs no market of its own and does not tick. */

interface TickerValue {
  activeTicker: TickerSymbol;
  /** The name that was on the desk before this one. Null until the first change. */
  previousTicker: TickerSymbol | null;
  changeTicker: (ticker: string) => void;
  revertTicker: () => void;
}

const TickerContext = createContext<TickerValue | null>(null);

const DEFAULT_TICKER = 'SPY';

const clean = (ticker: string): TickerSymbol => ticker.trim().toUpperCase() || DEFAULT_TICKER;
/* Where the reader left off, for Settings' "Where you left off" */
const LAST_KEY = 'slayer_active_ticker';
const lastTicker = (): string => {
  try {
    return localStorage.getItem(LAST_KEY) ?? '';
  } catch {
    return '';
  }
};

export const MarketDataProvider = ({ children }: { children: ReactNode }) => {
  const [activeTicker, setActiveTicker] = useState<TickerSymbol>(() => clean(readDeskPrefs().opensOn.ticker || lastTicker() || DEFAULT_TICKER));
  const [previousTicker, setPreviousTicker] = useState<TickerSymbol | null>(null);
  const activeRef = useRef(activeTicker);
  activeRef.current = activeTicker;
  const previousRef = useRef<TickerSymbol | null>(null);

  const changeTicker = useCallback((ticker: string) => {
    const next = clean(ticker);
    const prev = activeRef.current;
    if (prev === next) return;
    previousRef.current = prev;
    setPreviousTicker(prev);
    activeRef.current = next;
    setActiveTicker(next);
    try {
      localStorage.setItem(LAST_KEY, next);
    } catch {
      /* a private window keeps it for the page */
    }
  }, []);

  const revertTicker = useCallback(() => {
    const back = previousRef.current;
    if (back) changeTicker(back);
  }, [changeTicker]);

  const tickerValue = useMemo(() => ({ activeTicker, previousTicker, changeTicker, revertTicker }), [activeTicker, previousTicker, changeTicker, revertTicker]);

  return <TickerContext.Provider value={tickerValue}>{children}</TickerContext.Provider>;
};

export const useTicker = (): TickerValue => {
  const v = useContext(TickerContext);
  if (!v) throw new Error('useTicker must be used within a MarketDataProvider');
  return v;
};

/** Older name for useTicker. */
export const useMarketData = useTicker;
