/* Pinpoint's two books in the browser: it asks the server only (one board per name there, shared by every viewer).
   The open-interest book: GET /api/twobook/oi (server/twoBookApi.mjs). The flow book: GET /api/tape/flowbook (the
   option tape's, src/data/tapeServer.ts). Never added together. */

import { useEffect, useState } from 'react';
import { feedHeaders } from '../feedGate';
import type { FlowBoardWire } from './flowBook';
import type { Model1Wire } from './model1';

export interface BookRead<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

const OI_EVERY_MS = 90_000;
const FLOW_EVERY_MS = 30_000;

function usePoll<T>(url: string | null, every: number): BookRead<T> {
  const [state, setState] = useState<BookRead<T>>({ data: null, error: null, loading: !!url });
  useEffect(() => {
    if (!url) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setState({ data: null, error: null, loading: true });
    const go = async () => {
      try {
        const auth = await feedHeaders();
        if (!auth.ok) throw new Error('not signed in for this data');
        const res = await fetch(url, { headers: auth.headers, signal: AbortSignal.timeout(180_000) });
        const body = await res.json().catch(() => null);
        if (!alive) return;
        if (!res.ok) setState(s => ({ data: s.data, error: (body && (body as { error?: string }).error) || `status ${res.status}`, loading: false }));
        else setState({ data: body as T, error: null, loading: false });
      } catch (e) {
        if (alive) setState(s => ({ data: s.data, error: e instanceof Error ? e.message : String(e), loading: false }));
      }
      if (alive) timer = setTimeout(go, every);
    };
    void go();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [url, every]);
  return state;
}

export function useTwoBooks(ticker: string): { oi: BookRead<Model1Wire>; flow: BookRead<FlowBoardWire> } {
  const t = ticker ? encodeURIComponent(ticker.toUpperCase()) : null;
  const oi = usePoll<Model1Wire>(t ? `/api/twobook/oi?ticker=${t}` : null, OI_EVERY_MS);
  const flow = usePoll<FlowBoardWire>(t ? `/api/tape/flowbook?ticker=${t}` : null, FLOW_EVERY_MS);
  return { oi, flow };
}
