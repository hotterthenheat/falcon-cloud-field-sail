import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { readDeskPrefs } from '../data/deskPrefs';
import type { FlowPrint } from '../types/trace';
import type { MarketSnapshot, TickerSymbol } from '../types/market';

/*
  The name on the desk, and nothing else. Prices, books and prints come from the live feeds each page reads
  (liveQuote, uwBook, traceLive, ThetaData); this provider runs no market of its own and does not tick.
*/

export type StampedPrint = FlowPrint & { at: number };

interface TickerValue {
  activeTicker: TickerSymbol;
  /** The name that was on the desk before this one. Null until the first change. */
  previousTicker: TickerSymbol | null;
  changeTicker: (ticker: string) => void;
  revertTicker: () => void;
}

interface MarketDataContextValue extends TickerValue {
  /** Always null: there is no simulated snapshot. Kept so older readers compile while they move to live feeds. */
  marketData: MarketSnapshot | null;
  /** Always empty: the live tape is read per page (traceLive). */
  flowTape: StampedPrint[];
}

const TickerContext = createContext<TickerValue | null>(null);
const MarketDataContext = createContext<MarketDataContextValue | null>(null);

const NO_PRINTS: StampedPrint[] = [];
const DEFAULT_TICKER = 'SPY';

const clean = (ticker: string): TickerSymbol => ticker.trim().toUpperCase() || DEFAULT_TICKER;

export const MarketDataProvider = ({ children }: { children: ReactNode }) => {
  const [activeTicker, setActiveTicker] = useState<TickerSymbol>(() => clean(readDeskPrefs().opensOn.ticker || DEFAULT_TICKER));
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
  }, []);

  const revertTicker = useCallback(() => {
    const back = previousRef.current;
    if (back) changeTicker(back);
  }, [changeTicker]);

  const tickerValue = useMemo(() => ({ activeTicker, previousTicker, changeTicker, revertTicker }), [activeTicker, previousTicker, changeTicker, revertTicker]);
  const marketValue = useMemo<MarketDataContextValue>(() => ({ ...tickerValue, marketData: null, flowTape: NO_PRINTS }), [tickerValue]);

  return (
    <TickerContext.Provider value={tickerValue}>
      <MarketDataContext.Provider value={marketValue}>{children}</MarketDataContext.Provider>
    </TickerContext.Provider>
  );
};

export const useTicker = (): TickerValue => {
  const v = useContext(TickerContext);
  if (!v) throw new Error('useTicker must be used within a MarketDataProvider');
  return v;
};

/** The desk's name, plus the retired simulator fields (null / empty) for readers not yet moved off them. */
export const useMarketData = (): MarketDataContextValue => {
  const v = useContext(MarketDataContext);
  if (!v) throw new Error('useMarketData must be used within a MarketDataProvider');
  return v;
};
