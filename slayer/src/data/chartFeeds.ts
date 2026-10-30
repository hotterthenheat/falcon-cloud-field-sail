/* Real prints for the chart's overlays. Nothing here is synthesised: an empty
   answer stays empty, and the pane says so. Fetched only while the overlay is on. */

import { useEffect, useState } from 'react';
import type { DarkPoolPrint as ChartPrint } from '../types/gex';
import type { FlowPrint } from '../types/trace';
import { darkPrint } from './traceDark';
import { rowsOf, tradeToPrint } from './traceRows';
import { uwCall } from './whales';

/** SPX's listed tape is SPXW, and the same for NDX and RUT. The chart's symbol stays the underlying. */
const WEEKLY: Record<string, string> = { SPX: 'SPXW', NDX: 'NDXP', RUT: 'RUTW' };

export interface ChartFeed<T> {
  rows: T;
  /** The first answer has landed. Empty is an answer. */
  ready: boolean;
  fault: string | null;
}

const EMPTY_DARK: ChartPrint[] = [];
const QUIET = 20_000;

function rootsOf(ticker: string): string[] {
  const name = ticker.trim().toUpperCase();
  const weekly = WEEKLY[name];
  return weekly ? [weekly, name] : name ? [name] : [];
}

/** One line per price, the largest real print there. Dollars, not billions. */
function collapseDark(rows: ReturnType<typeof darkPrint>[]): ChartPrint[] {
  const byPx = new Map<number, ChartPrint>();
  for (const p of rows) {
    if (!(p.price > 0) || !(p.notional > 0)) continue;
    const price = Math.round(p.price * 100) / 100;
    const prev = byPx.get(price);
    if (prev && prev.notional >= p.notional) continue;
    byPx.set(price, {
      price,
      notional: p.notional,
      date: p.dateIso || '',
      size: p.size,
      time: p.time && p.time !== '—' ? p.time : '',
    });
  }
  return [...byPx.values()].sort((a, b) => b.notional - a.notional);
}

/** Off-exchange prints for this name. `rows` is empty until the feed answers, and stays empty when it has none. */
export function useChartDarkPrints(ticker: string, enabled: boolean): ChartFeed<ChartPrint[]> {
  const name = ticker.trim().toUpperCase();
  const [state, setState] = useState<{ name: string; rows: ChartPrint[]; ready: boolean; fault: string | null }>({
    name: '',
    rows: [],
    ready: false,
    fault: null,
  });
  useEffect(() => {
    if (!enabled || !name) return;
    let stop = false;
    const load = async () => {
      try {
        const got = await uwCall(`/darkpool/${encodeURIComponent(name)}?limit=200`, true);
        if (stop) return;
        if (got.error) {
          const empty = got.status === 422 || got.status === 403 || got.status === 404;
          setState({ name, rows: [], ready: true, fault: empty ? null : 'the feed did not answer' });
          return;
        }
        const mapped = rowsOf(got.data)
          .filter(r => !r.canceled)
          .map((r, i) => darkPrint(r, i));
        setState({ name, rows: collapseDark(mapped), ready: true, fault: null });
      } catch {
        if (!stop) setState({ name, rows: [], ready: true, fault: 'the feed did not answer' });
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), QUIET);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [name, enabled]);
  if (!enabled) return { rows: EMPTY_DARK, ready: true, fault: null };
  if (state.name !== name) return { rows: EMPTY_DARK, ready: false, fault: null };
  return state;
}

const EMPTY_FLOW: (FlowPrint & { at: number })[] = [];

/** This name's option prints, stamped with `at` in epoch ms. SPX reads SPXW as well as SPX. */
export function useChartFlowPrints(ticker: string, enabled: boolean): ChartFeed<(FlowPrint & { at: number })[]> {
  const name = ticker.trim().toUpperCase();
  const [state, setState] = useState<{ name: string; rows: (FlowPrint & { at: number })[]; ready: boolean; fault: string | null }>({
    name: '',
    rows: [],
    ready: false,
    fault: null,
  });
  useEffect(() => {
    if (!enabled || !name) return;
    let stop = false;
    const load = async () => {
      const roots = rootsOf(name);
      const seen = new Set<string>();
      const out: (FlowPrint & { at: number })[] = [];
      let answered = false;
      let failed = false;
      let i = 0;
      for (const root of roots) {
        try {
          const got = await uwCall(`/option-trades?ticker_symbol=${encodeURIComponent(root)}&limit=200`, true);
          if (stop) return;
          if (got.error) {
            if (got.status === 422 || got.status === 403 || got.status === 404) answered = true;
            else failed = true;
            continue;
          }
          answered = true;
          for (const row of rowsOf(got.data)) {
            const kind = String(row.option_type || row.type || '').toLowerCase();
            if (!kind.startsWith('c') && !kind.startsWith('p')) continue;
            const p = tradeToPrint(row, i++);
            const at = p.epochMs && p.epochMs > 0 ? p.epochMs : 0;
            if (!(at > 0) || !(p.premium > 0)) continue;
            const id = p.vendorId || String(p.id);
            if (seen.has(id)) continue;
            seen.add(id);
            /* The chart buckets by its own symbol. The premium and the time are the print's. */
            out.push({ ...p, ticker: name, at });
          }
        } catch {
          failed = true;
        }
      }
      if (stop) return;
      setState({ name, rows: out, ready: true, fault: !answered && failed ? 'the feed did not answer' : null });
    };
    void load();
    const timer = window.setInterval(() => void load(), QUIET);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [name, enabled]);
  if (!enabled) return { rows: EMPTY_FLOW, ready: true, fault: null };
  if (state.name !== name) return { rows: EMPTY_FLOW, ready: false, fault: null };
  return state;
}
