import { useEffect, useState } from 'react';
import { pageHidden, thetaGet } from './thetaFeed';
import { thetaUseHere } from './theta';
import type { DeskSession } from './deskSession';

const INDEX = new Set(['SPX', 'RUT', 'NDX', 'VIX', 'XSP']);

interface SessionQuote {
  bid: number;
  ask: number;
}

/** ThetaData's live bid and ask, every 15 s while the tab is in view. Used when a session has no prints, so the cash
    close is not shown in its place. With the terminal down the last quote stays. */
export function useSessionQuote(ticker: string, session: DeskSession, needed: boolean): SessionQuote | null {
  const [quote, setQuote] = useState<SessionQuote | null>(null);
  useEffect(() => {
    if (!needed || session === 'rth') {
      setQuote(null);
      return;
    }
    const t = ticker.trim().toUpperCase();
    /* an index has a price, not a bid and an ask */
    if (!t || INDEX.has(t)) return;
    let dead = false;
    const pull = () => {
      if (pageHidden() || thetaUseHere() === 'none') return;
      void thetaGet(`/stock/snapshot/quote?symbol=${encodeURIComponent(t)}&format=json`, true).then(res => {
        if (dead) return;
        const row = Array.isArray(res.data) ? (res.data[0] as Record<string, unknown> | undefined) : undefined;
        const bid = Number(row?.bid);
        const ask = Number(row?.ask);
        if (bid > 0 && ask >= bid) setQuote({ bid, ask });
        else if (!res.error) setQuote(null);
      });
    };
    pull();
    const id = window.setInterval(pull, 15000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [ticker, session, needed]);
  return needed && session !== 'rth' ? quote : null;
}
