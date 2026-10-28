import React, { createContext, memo, startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Simulator from '../core/simulator';
import { readDeskPrefs } from '../data/deskPrefs';
import Ledger from '../core/ledger';
import { enrichPrint } from '../data/tape';
import { announceFeedTick } from '../data/feedTicks';
import type { FlowPrint } from '../types/trace';
import type { ExecuteResult, LedgerStats, MarketSnapshot, TickerSymbol, TradeRecord } from '../types/market';

/* THE LIVE TAPE, kept for the desk (ported 2026-08-27).

   Prints arrive a handful per tick and several surfaces want the same
   unfiltered stream — the chart's event markers read the biggest of them,
   the flow overlays bucket them to bars. Holding it here means one tape,
   stamped once, rather than every pane growing its own.

   Aged FIRST, then capped: age alone lets a busy session run unbounded, and
   the count alone keeps yesterday's prints alive on a tab left open. */
export type StampedPrint = FlowPrint & { at: number };
const TAPE_CAP = 240;
const TAPE_MAX_AGE_MS = 4 * 60 * 60 * 1000;

interface LedgerState {
  activeTrades: TradeRecord[];
  closedTrades: TradeRecord[];
  stats: LedgerStats;
}

interface MarketDataContextValue {
  activeTicker: TickerSymbol;
  marketData: MarketSnapshot | null;
  /** The session's option prints, newest first — aged and capped. */
  flowTape: StampedPrint[];
  ledgerState: LedgerState;
  changeTicker: (ticker: string) => void;
  executeTrade: () => ExecuteResult;
  clearLedger: () => void;
}

const MarketDataContext = createContext<MarketDataContextValue | null>(null);

/** The name on the desk. A price tick does not change it, so a page that only
    needs the ticker does not rebuild its charts every second and a half. */
interface TickerValue {
  activeTicker: TickerSymbol;
  /** The name that was on the desk before this one. Null until the first change. */
  previousTicker: TickerSymbol | null;
  changeTicker: (ticker: string) => void;
  revertTicker: () => void;
}
const TickerContext = createContext<TickerValue | null>(null);

/* A tick used to set state on this provider, and the provider wraps the whole
   terminal, so every price rebuilt every page. The children stay as they were
   handed in; only a hook that reads the tape re-renders. */
const Quiet = memo(function Quiet({ children }: { children: ReactNode }) {
  return children;
});

export const MarketDataProvider = ({ children }: { children: React.ReactNode }) => {
  /* THE NAME THE TERMINAL OPENS ON (Settings › The desk › Opens on, 2026-09-12):
     the reader's pick when they made one, else where the simulator left off */
  const [activeTicker, setActiveTickerState] = useState<TickerSymbol>(() => {
    const pick = readDeskPrefs().opensOn.ticker;
    return pick ? Simulator.setActiveTicker(pick) : Simulator.getActiveTicker();
  });
  const [previousTicker, setPreviousTicker] = useState<TickerSymbol | null>(null);
  const previousRef = useRef<TickerSymbol | null>(null);
  const activeRef = useRef(activeTicker);
  activeRef.current = activeTicker;
  const [marketData, setMarketData] = useState<MarketSnapshot | null>(null);
  const [flowTape, setFlowTape] = useState<StampedPrint[]>([]);
  /* The print id counter lives in a ref, not in state: it must never reset on
     a re-render, and a duplicate id would collapse two prints into one row. */
  const printIdRef = useRef(0);
  const [ledgerState, setLedgerState] = useState<LedgerState>({
    activeTrades: [],
    closedTrades: [],
    stats: { winRate: 0, profitFactor: 0, avgAccuracy: 0, totalPnL: 0, count: 0 }
  });

  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /* The feed's first tick: the active name seeds in slices at boot (the
     simulator's pump), and the tick emits nothing until it is whole — so the
     provider asks again every 80ms until the first snapshot lands, instead
     of waiting out a whole interval with the desk on "Awaiting feed". */
  const readyRef = useRef(false);
  const warmRef = useRef<number | null>(null);

  // Initialize Ledger on Mount
  useEffect(() => {
    Ledger.loadFromStorage();
    updateLedgerState();

    // Start Ticking
    startSimulator();

    return () => {
      stopSimulator();
    };
  }, []);

  const updateLedgerState = () => {
    setLedgerState({
      activeTrades: [...Ledger.getActiveTrades()],
      closedTrades: [...Ledger.getClosedTrades()],
      stats: Ledger.getStats()
    });
  };

  const absorbTape = (data: MarketSnapshot) => {
    if (!data.tape || data.tape.length === 0) return;
    const now = Date.now();
    const fresh: StampedPrint[] = data.tape.map(o => ({ ...enrichPrint(o, ++printIdRef.current), at: now }));
    setFlowTape(prev => {
      const next = [...fresh, ...prev];
      const cutoff = now - TAPE_MAX_AGE_MS;
      const aged =
        next.length > TAPE_CAP || (next[next.length - 1]?.at ?? now) < cutoff
          ? next.filter(p => p.at >= cutoff)
          : next;
      return aged.length > TAPE_CAP ? aged.slice(0, TAPE_CAP) : aged;
    });
  };

  const pendingTick = useRef<MarketSnapshot | null>(null);
  const tickScheduled = useRef(false);

  const processTick = () => {
    Simulator.tick((data) => {
      readyRef.current = true;
      // 1. Evaluate open trades — a side effect on the ledger, not a render.
      const currentActiveTicker = Simulator.getActiveTicker();
      Ledger.updateOpenTrades(currentActiveTicker, data.spot);

      /* 2. ONE PUBLISH PER FRAME. The simulator can hand a tick faster than
         the desk draws. Coalesce onto the next frame, then let React render
         the snapshot as a transition so a tick never freezes the page.
         Ticker changes stay urgent (changeTicker below). */
      pendingTick.current = data;
      if (tickScheduled.current) return;
      tickScheduled.current = true;
      requestAnimationFrame(() => {
        tickScheduled.current = false;
        const next = pendingTick.current;
        if (!next) return;
        startTransition(() => {
          setMarketData(next);
          absorbTape(next);
          updateLedgerState();
        });
      });
      /* 3. What acts on every tick wherever the reader is — a paper account's working orders (data/feedTicks.ts) */
      announceFeedTick();
    });
  };

  const startSimulator = () => {
    /* A shared read is a picture of levels. It does not start the tape. */
    if (typeof window !== 'undefined' && window.location.pathname.replace(/\/$/, '').endsWith('/terrain/s')) return;
    if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
    processTick();
    tickIntervalRef.current = setInterval(processTick, 1500);
    const warm = () => {
      warmRef.current = null;
      if (readyRef.current) return;
      processTick();
      if (!readyRef.current) warmRef.current = window.setTimeout(warm, 80);
    };
    if (!readyRef.current) warmRef.current = window.setTimeout(warm, 80);
  };

  const stopSimulator = () => {
    if (tickIntervalRef.current) {
      clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = null;
    }
    if (warmRef.current !== null) {
      window.clearTimeout(warmRef.current);
      warmRef.current = null;
    }
  };

  const marketRef = useRef(marketData);
  marketRef.current = marketData;
  const absorbRef = useRef(absorbTape);
  absorbRef.current = absorbTape;
  const ledgerRef = useRef(updateLedgerState);
  ledgerRef.current = updateLedgerState;

  const changeTicker = useCallback((ticker: string) => {
    const sym = Simulator.setActiveTicker(ticker);
    const prev = activeRef.current;
    if (prev !== sym) {
      previousRef.current = prev;
      setPreviousTicker(prev);
    }
    setActiveTickerState(sym);
    Simulator.tick(data => {
      setMarketData(data);
      absorbRef.current(data);
      ledgerRef.current();
    });
  }, []);

  const revertTicker = useCallback(() => {
    const back = previousRef.current;
    if (back) changeTicker(back);
  }, [changeTicker]);

  const executeTrade = useCallback((): ExecuteResult => {
    const book = marketRef.current;
    if (!book || !book.plan) return { success: false, message: 'No active plan' };
    const res = Ledger.executePlan(book.plan);
    ledgerRef.current();
    return res;
  }, []);

  const clearLedger = useCallback(() => {
    Ledger.clearHistory();
    ledgerRef.current();
  }, []);

  const tickerValue = useMemo(
    () => ({ activeTicker, previousTicker, changeTicker, revertTicker }),
    [activeTicker, previousTicker, changeTicker, revertTicker],
  );
  const marketValue = useMemo<MarketDataContextValue>(
    () => ({ activeTicker, marketData, flowTape, ledgerState, changeTicker, executeTrade, clearLedger }),
    [activeTicker, marketData, flowTape, ledgerState, changeTicker, executeTrade, clearLedger],
  );

  return (
    <TickerContext.Provider value={tickerValue}>
      <MarketDataContext.Provider value={marketValue}>
        <Quiet>{children}</Quiet>
      </MarketDataContext.Provider>
    </TickerContext.Provider>
  );
};

export const useTicker = (): TickerValue => {
  const v = useContext(TickerContext);
  if (!v) throw new Error('useTicker must be used within a MarketDataProvider');
  return v;
};

export const useMarketData = (): MarketDataContextValue => {
  const context = useContext(MarketDataContext);
  if (!context) {
    throw new Error('useMarketData must be used within a MarketDataProvider');
  }
  return context;
};
