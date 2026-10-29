/*
  One strike held by the whole terminal, so every page and the chart agree on the strike in focus.
*/

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTicker } from './MarketDataContext';

export interface StrikeFocus {
  ticker: string;
  /** The strike — a price on the name's ladder */
  price: number;
  /** A one-shot arrival token: changes on every focusOn, so a chart can lift itself for a NEW arrival only */
  token: number;
}

interface FocusValue {
  focus: StrikeFocus | null;
  /** Focus this strike on this name (a fresh token each call) */
  focusOn: (price: number, ticker: string) => void;
  /** The same strike again lets go; another strike takes over */
  toggleFocus: (price: number, ticker: string) => void;
  clearFocus: () => void;
}

const FocusCtx = createContext<FocusValue | null>(null);

export const FocusProvider = ({ children }: { children: ReactNode }) => {
  const { activeTicker } = useTicker();
  const [focus, setFocus] = useState<StrikeFocus | null>(null);
  const focusOn = useCallback((price: number, ticker: string) => setFocus({ price, ticker, token: Date.now() }), []);
  const toggleFocus = useCallback(
    (price: number, ticker: string) => setFocus(prev => (prev && prev.ticker === ticker && prev.price === price ? null : { price, ticker, token: Date.now() })),
    []
  );
  const clearFocus = useCallback(() => setFocus(null), []);

  const prevTickerRef = useRef(activeTicker);
  useEffect(() => {
    const prev = prevTickerRef.current;
    prevTickerRef.current = activeTicker;
    if (focus && prev === focus.ticker && activeTicker !== focus.ticker) setFocus(null);
  }, [activeTicker, focus]);

  const value = useMemo<FocusValue>(() => ({ focus, focusOn, toggleFocus, clearFocus }), [focus, focusOn, toggleFocus, clearFocus]);
  return <FocusCtx.Provider value={value}>{children}</FocusCtx.Provider>;
};

export const useFocus = (): FocusValue => {
  const v = useContext(FocusCtx);
  if (!v) throw new Error('useFocus must be used inside FocusProvider');
  return v;
};

/** The focused strike if it belongs to this name, else null — the read every surface wants */
export const useFocusedStrike = (ticker: string | null | undefined): number | null => {
  const { focus } = useFocus();
  return focus && ticker && focus.ticker === ticker ? focus.price : null;
};
