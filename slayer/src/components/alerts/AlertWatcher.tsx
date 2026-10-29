/* The shell's alert watcher: every armed alert, on every name that holds one, judged against the live feeds — the
   name's real-time price and today's minute bars off the ThetaData terminal (or both off Unusual Whales where the page
   may not ask the terminal: data/theta.ts, never one of each), its vendor dealer book (walls, flip, supreme, net
   exposure), the name's option prints and the wire. Nothing is judged on a kept price: with the terminal down the
   alerts wait. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { readExposureNow, type ExposureNow } from '../../data/gex';
import { bookCandles, bookHistory, ensureBook } from '../../data/uwBook';
import { ensureThetaBars, peekThetaBars, peekThetaPrice, useThetaPrices } from '../../data/thetaQuote';
import { ensureQuote, peekQuote, useDayMoves } from '../../data/liveQuote';
import { useUwOnlyRoute } from '../layout/NavQuote';
import { uwCall } from '../../data/whales';
import { newsPulse } from '../../data/news';
import { emaSeries, rsiSeries, vwapSeries } from '../../data/indicators';
import { aggregateCandles, tfMinutes, type Timeframe } from '../../data/timeframe';
import { run as runScript } from '../../core/pine';
import { compileOf } from './scriptCompiles';
import { SCRIPT_CAPS } from '../../types/scripts';
import { commitArm, evaluateAlert, markFired, scriptBarCounts, useAllAlerts, type Alert, type AlertContext, type IndicatorSource, type ScriptAlert } from '../gex/alertStore';

/** The last real value of a series, or null while it cannot be read */
const last = (pts: readonly (number | null)[]): number | null => {
  const p = pts[pts.length - 1];
  return typeof p === 'number' && Number.isFinite(p) ? p : null;
};

/** The name's live minute bars on a timeframe, from the same feed as its price (the terminal's, or the vendor's where
    the page may not ask the terminal); a seconds timeframe has no live bars, so its alerts wait */
const barsFor = (ticker: string, tf: string, uw: boolean) => {
  const mins = tfMinutes(tf as Timeframe);
  if (mins < 1) return [];
  if (!uw) ensureThetaBars(ticker);
  return aggregateCandles((uw ? bookCandles(ticker) : peekThetaBars(ticker)) ?? [], mins);
};

/** The live book as an alert reads it: the newest strike snapshot against the live price */
const exposureOf = (ticker: string, spot: number): ExposureNow | null => {
  const snaps = bookHistory(ticker);
  const latest = snaps?.[snaps.length - 1];
  return latest && latest.levels.length ? readExposureNow(latest.levels, spot) : null;
};

/* The option prints of the names with a flow alert, read from the vendor's tape every 30 seconds */
const PRINTS_MS = 30_000;
const prints = new Map<string, { at: number; rows: { at: number; premium: number }[] }>();
async function readPrints(ticker: string): Promise<void> {
  const hit = prints.get(ticker);
  if (hit && Date.now() - hit.at < PRINTS_MS) return;
  const got = await uwCall(`/option-trades?ticker_symbol=${encodeURIComponent(ticker)}&limit=200`, false, true);
  if (got.error || !Array.isArray(got.data)) return;
  const rows = (got.data as { executed_at?: string; premium?: string | number }[])
    .map(r => ({ at: Date.parse(String(r.executed_at ?? '')), premium: Number(r.premium) }))
    .filter(r => Number.isFinite(r.at) && r.premium > 0);
  prints.set(ticker, { at: Date.now(), rows });
}

/* How often the watcher looks again when nothing has landed */
const BEAT_MS = 15_000;

const AlertWatcher = () => {
  const names = useAllAlerts();
  /* the names with an alert still waiting: their prices are polled on the session's clock, and each landing judges */
  const watched = useMemo(() => names.filter(n => n.alerts.some(a => !a.firedAt)).map(n => n.ticker.toUpperCase()), [names]);
  /* on the Unusual Whales rooms (Trace, Pinpoint, the Dossier) the price is the vendor's quote; elsewhere the terminal's */
  const uwOnly = useUwOnlyRoute();
  const priceRev = useThetaPrices(uwOnly ? [] : watched);
  const uwMoves = useDayMoves(uwOnly ? watched : []);
  /* bumped by the beat, a landed script compile or a landed tape read */
  const [beat, setBeat] = useState(0);
  const ranOn = useRef(new Map<string, number>());
  useEffect(() => {
    const id = window.setInterval(() => setBeat(b => b + 1), BEAT_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const now = Date.now();
    const poke = () => setBeat(b => b + 1);
    for (const { ticker, alerts } of names) {
      const waiting = alerts.filter(a => !a.firedAt);
      if (waiting.length === 0) continue;
      const sym = ticker.toUpperCase();
      const needsBook = waiting.some(a => a.kind === 'level' || a.kind === 'gexflip' || a.kind === 'newsupreme' || a.kind === 'wallmove' || a.kind === 'script' || a.kind === 'indicator');
      if (needsBook) ensureBook(sym);
      let close: number;
      if (uwOnly) {
        ensureQuote(sym);
        const q = peekQuote(sym);
        if (!q || !(q.spot > 0)) continue;
        close = q.spot;
      } else {
        const held = peekThetaPrice(sym);
        if (!held?.live) continue;
        close = held.value.price;
      }
      if (!(close > 0)) continue;

      const exp = needsBook ? exposureOf(sym, close) : null;
      if (waiting.some(a => a.kind === 'flow')) void readPrints(sym).then(poke);

      const scripts = waiting.filter((a): a is ScriptAlert => a.kind === 'script');
      const runs = new Map<string, ScriptAlert[]>();
      for (const a of scripts) {
        const key = `${a.scriptId}|${a.tf}|${JSON.stringify(a.inputs)}`;
        (runs.get(key) ?? runs.set(key, []).get(key)!).push(a);
      }
      for (const [key, group] of runs) {
        const head = group[0];
        const compiled = compileOf(head.scriptId, poke);
        if (!compiled) continue;
        const bars = barsFor(sym, head.tf, uwOnly);
        if (bars.length === 0) continue;
        /* a script is run once per new bar, not on every beat */
        const runKey = `${sym}|${key}`;
        const lastTime = bars[bars.length - 1].time;
        if (ranOn.current.get(runKey) === lastTime) continue;
        ranOn.current.set(runKey, lastTime);
        let result;
        try {
          result = runScript(compiled, bars, {
            inputs: head.inputs,
            ticker: sym,
            timeframe: head.tf,
            budgetMs: SCRIPT_CAPS.budgetMs,
            slayer: exp ? { callWall: exp.callWall ?? undefined, putWall: exp.putWall ?? undefined, flip: exp.flip ?? undefined, supreme: exp.supreme ?? undefined } : undefined,
          });
        } catch {
          continue;
        }
        const i = bars.length - 1;
        for (const a of group) {
          const out = result.alerts.find(x => x.id === a.conditionId);
          if (!out || out.fired[i] !== 1 || !scriptBarCounts(a, bars[i].time)) continue;
          /* the bar it fired on is remembered before the firing, so a re-arm on the same bar does not ring twice */
          commitArm(sym, { ...a, lastBar: bars[i].time });
          markFired(sym, a.id, now);
        }
      }
      const base: Omit<AlertContext, 'tf' | 'values'> = {
        close,
        levels: {
          callWall: exp?.callWall ?? null,
          putWall: exp?.putWall ?? null,
          flip: exp?.flip ?? null,
          supreme: exp?.supreme ?? null,
          coneHigh: null,
          coneLow: null,
        },
        netGex: exp ? exp.netGex : null,
        step: exp?.step ?? 0,
        prints: prints.get(sym)?.rows ?? [],
        news: waiting.some(a => a.kind === 'news') ? newsPulse(sym) : [],
      };

      const judge = (a: Alert, ctx: AlertContext) => {
        const verdict = evaluateAlert(a, ctx);
        if (verdict.fire) markFired(sym, a.id, now);
        else if (verdict.armed) commitArm(sym, verdict.armed);
      };

      /* A book alert waits for the book; everything else but the indicator and script kinds reads one context */
      const plain: AlertContext = { ...base, tf: '', values: {} };
      for (const a of waiting) {
        if (a.kind === 'indicator' || a.kind === 'script') continue;
        if (needsBook && !exp && (a.kind === 'level' || a.kind === 'gexflip' || a.kind === 'newsupreme' || a.kind === 'wallmove')) continue;
        judge(a, plain);
      }

      /* The indicator kinds read the bars of their own timeframe, each value computed once */
      const byTf = new Map<string, Alert[]>();
      for (const a of waiting) if (a.kind === 'indicator') (byTf.get(a.tf) ?? byTf.set(a.tf, []).get(a.tf)!).push(a);
      for (const [tf, group] of byTf) {
        const bars = barsFor(sym, tf, uwOnly);
        if (bars.length === 0) continue;
        const mins = tfMinutes(tf as Timeframe);
        const values: Partial<Record<IndicatorSource, number | null>> = {};
        for (const a of group) {
          if (a.kind !== 'indicator' || a.source in values) continue;
          values[a.source] =
            a.source === 'vwap' ? last(vwapSeries(bars, mins))
            : a.source === 'rsi' ? last(rsiSeries(bars, 14))
            : last(emaSeries(bars, a.source === 'ema9' ? 9 : a.source === 'ema21' ? 21 : 50));
        }
        const ctx: AlertContext = { ...base, tf, values };
        for (const a of group) judge(a, ctx);
      }
    }
  }, [names, priceRev, uwMoves, uwOnly, beat]);

  return null;
};

export default AlertWatcher;
