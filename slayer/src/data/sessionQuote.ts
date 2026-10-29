import { useEffect, useState } from 'react';
import { thetaCall } from './theta';
import type { DeskSession } from './deskSession';

const INDEX = new Set(['SPX', 'RUT', 'NDX', 'VIX', 'XSP']);

interface SessionQuote {
  bid: number;
  ask: number;
}

/** The live stock quote. Used when a session has no prints, so the cash close is not shown in its place. */
export function useSessionQuote(ticker: string, session: DeskSession, needed: boolean): SessionQuote | null {
  const [quote, setQuote] = useState<SessionQuote | null>(null);
  useEffect(() => {
    if (!needed || session === 'rth') {
      setQuote(null);
      return;
    }
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    let dead = false;
    const pull = () => {
      const root = INDEX.has(t) ? 'index' : 'stock';
      void thetaCall(`/${root}/snapshot/quote?symbol=${encodeURIComponent(t)}&format=json`, true).then(res => {
        if (dead) return;
        const row = Array.isArray(res.data) ? (res.data[0] as Record<string, unknown> | undefined) : undefined;
        const bid = Number(row?.bid);
        const ask = Number(row?.ask);
        if (bid > 0 && ask >= bid) setQuote({ bid, ask });
        else setQuote(null);
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
