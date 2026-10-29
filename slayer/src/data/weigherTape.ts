/* The Weigher's tape: one timeframe, one session, ThetaData's own bars (data/thetaTape.ts); an empty session stays
   empty, and with the terminal down the last bars stay on screen stamped with when they were taken. A contract's
   premium bars are read here too. */

import { useEffect, useState } from 'react';
import type { Candle } from '../types/market';
import type { Timeframe } from './timeframe';
import type { OptionRight } from '../types/compass';
import { nyMinutes } from '../core/nyTime';
import { nyYmd } from '../core/calendar';
import { sessionMeta, sessionOfMinute, type DeskSession } from './deskSession';
import { noData, offlineWords, pageHidden, thetaGet } from './thetaFeed';
import { dayClose, foldTo, grainStep, paintPrint, readEod, readOhlc, useThetaPrint, useThetaTape, tapeWords, weekClose, type TapeGrain } from './thetaTape';

const GRAIN: Record<Timeframe, TapeGrain> = { '15s': '15s', '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '1D': 'day', '1W': 'week' };

/** The live print joins the bar it belongs to. It never opens a bar in another session. */
export function paintLive(bars: Candle[], price: number, atSec: number, tf: Timeframe, session: DeskSession): Candle[] {
  return paintPrint(bars, price, atSec, grainStep(GRAIN[tf]), session);
}

/** The name's last print and the prior session's close, from ThetaData. Null until the first print lands. */
export function useWeigherSpot(ticker: string): { spot: number; prev: number } | null {
  const print = useThetaPrint(ticker);
  return print ? { spot: print.price, prev: print.prev } : null;
}

interface WeigherTape {
  bars: Candle[];
  /** false while the first answer is still out */
  ready: boolean;
  /** Why the frame is empty, or that the bars on it are kept and not live */
  note: string | null;
}

export function useWeigherTape(ticker: string, tf: Timeframe, session: DeskSession): WeigherTape {
  const t = useThetaTape(ticker, GRAIN[tf], session);
  const ready = t.state !== 'loading' || t.bars.length > 0;
  return { bars: t.bars, ready, note: ready ? tapeWords(t, session) : null };
}

/* ---- one contract's premium bars ---- */

const ymd = (at = Date.now()): string => nyYmd(at);
const DAYS: Partial<Record<Timeframe, number>> = { '15s': 0, '1m': 5, '5m': 12, '15m': 25, '30m': 40, '1h': 60 };
const WINDOWS: Record<DeskSession, { start: string; end: string }[]> = {
  rth: [{ start: '09:30:00', end: '15:59:59' }],
  pre: [{ start: '04:00:00', end: '09:29:59' }],
  post: [{ start: '16:00:00', end: '19:59:59' }],
  overnight: [
    { start: '20:00:00', end: '23:59:59' },
    { start: '00:00:00', end: '03:59:59' },
  ],
};

async function contractBars(symbol: string, exp: string, strike: number, right: OptionRight, tf: Timeframe, session: DeskSession): Promise<{ bars: Candle[]; offline: boolean }> {
  const leg = `symbol=${encodeURIComponent(symbol)}&expiration=${exp}&strike=${strike}&right=${right === 'C' ? 'call' : 'put'}`;
  const end = ymd();
  if (tf === '1D' || tf === '1W') {
    const got = await thetaGet(`/option/history/eod?${leg}&start_date=${ymd(Date.now() - 200 * 86_400_000)}&end_date=${end}&format=json`);
    if (got.error) return { bars: [], offline: !noData(got) };
    const days = readEod(got.data);
    return { bars: tf === '1W' ? foldTo(days, weekClose) : days, offline: false };
  }
  const days = tf === '15s' ? [ymd(Date.now() - 86_400_000), end].map(d => [d, d]) : [[ymd(Date.now() - (DAYS[tf] ?? 5) * 86_400_000), end]];
  const got = await Promise.all(
    days.flatMap(([from, to]) =>
      WINDOWS[session].map(w => thetaGet(`/option/history/ohlc?${leg}&start_date=${from}&end_date=${to}&interval=${tf}&start_time=${w.start}&end_time=${w.end}&format=json`)),
    ),
  );
  const offline = got.some(g => g.error != null && !noData(g));
  const bars = got.flatMap(g => (g.error ? [] : readOhlc(g.data, session))).sort((a, b) => a.time - b.time);
  return { bars: foldTo(bars, b => b), offline };
}

const contracts = new Map<string, { at: number; bars: Candle[] }>();

/** A contract's own bars in the timeframe and session on screen, re-read every 20 s while that session trades. */
export function useWeigherContract(
  symbol: string,
  expiryIso: string,
  strike: number,
  right: OptionRight,
  tf: Timeframe,
  session: DeskSession,
  on: boolean,
): { bars: Candle[] | null; note: string | null } {
  const root = symbol.trim().toUpperCase();
  const exp = expiryIso.replace(/-/g, '');
  const key = `${root}|${exp}|${strike}|${right}|${tf}|${session}`;
  const [state, setState] = useState<{ key: string; bars: Candle[] | null; note: string | null }>({ key: '', bars: null, note: null });
  useEffect(() => {
    if (!on || !root || exp.length !== 8 || !(strike > 0)) return;
    let dead = false;
    const run = () => {
      const hit = contracts.get(key);
      const live = sessionOfMinute(nyMinutes()) === session;
      if (hit && Date.now() - hit.at < (live ? 20_000 : 5 * 60_000)) {
        if (!dead) setState({ key, bars: hit.bars, note: hit.bars.length ? null : `${sessionMeta(session).label} has no prints on this contract.` });
        return;
      }
      if (pageHidden()) return;
      void contractBars(root, exp, Number(strike.toFixed(4)), right, tf, session).then(got => {
        if (dead) return;
        if (got.offline && !got.bars.length) {
          setState({ key, bars: hit?.bars ?? [], note: offlineWords(hit?.at ?? 0) });
          return;
        }
        contracts.set(key, { at: Date.now(), bars: got.bars });
        setState({ key, bars: got.bars, note: got.bars.length ? null : `${sessionMeta(session).label} has no prints on this contract.` });
      });
    };
    run();
    const id = window.setInterval(run, 20_000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [on, key, root, exp, strike, right, tf, session]);
  if (!on) return { bars: null, note: null };
  return state.key === key ? { bars: state.bars, note: state.note } : { bars: null, note: null };
}

