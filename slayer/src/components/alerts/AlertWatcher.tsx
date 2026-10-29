/*
  The shell's alert watcher: every armed alert, on every name that holds one, judged against the live feeds — the
  name's price, its vendor dealer book (walls, flip, supreme, net exposure), today's minute bars for the indicator
  and script kinds, the name's option prints and the wire. The store's firing is idempotent, so a chart that also
  watches a name changes nothing. A name whose live read has not landed waits. Renders nothing.
*/

import { useEffect, useRef, useState } from 'react';
import { readExposureNow, type ExposureNow } from '../../data/gex';
import { bookCandles, bookHistory, ensureBook, useBookRev } from '../../data/uwBook';
import { liveSpotOf } from '../../data/weigherChain';
import { uwCall } from '../../data/whales';
import { newsPulse } from '../../data/news';
import { emaSeries, rsiSeries, vwapSeries } from '../../data/indicators';
import { aggregateCandles, tfMinutes, type Timeframe } from '../../data/timeframe';
import { builtinScripts } from '../../data/builtinScripts';
import { scriptStore } from '../../data/scriptStore';
import { compile, run as runScript, type Compiled } from '../../core/pine';
import { SCRIPT_CAPS } from '../../types/scripts';
import { commitArm, evaluateAlert, markFired, scriptBarCounts, useAllAlerts, type Alert, type AlertContext, type IndicatorSource, type ScriptAlert } from '../gex/alertStore';

/* A script alert runs the script the way its pane does — over the name's bars on its timeframe, with the
   placement's inputs and the book in `slayer.*` — and reads the condition's flag on the last bar. Compiles are
   cached by id; a script that does not compile is remembered as null and left alone. */
const compiledById = new Map<string, Compiled | null>();
const fetching = new Set<string>();
const compileOf = (scriptId: string, poke: () => void): Compiled | null | undefined => {
  if (compiledById.has(scriptId)) return compiledById.get(scriptId);
  const builtin = builtinScripts().find(s => s.id === scriptId);
  if (builtin) {
    try {
      compiledById.set(scriptId, compile(builtin.source));
    } catch {
      compiledById.set(scriptId, null);
    }
    return compiledById.get(scriptId);
  }
  if (!fetching.has(scriptId)) {
    fetching.add(scriptId);
    void scriptStore.get(scriptId).then(s => {
      try {
        compiledById.set(scriptId, s ? compile(s.source) : null);
      } catch {
        compiledById.set(scriptId, null);
      }
      fetching.delete(scriptId);
      poke();
    });
  }
  return undefined;
};

/** A saved script changed under an alert — forget its compile so the next tick re-reads it */
export const forgetCompiled = (scriptId: string): void => {
  compiledById.delete(scriptId);
};

/** The last real value of a series, or null while it cannot be read */
const last = (pts: readonly (number | null)[]): number | null => {
  const p = pts[pts.length - 1];
  return typeof p === 'number' && Number.isFinite(p) ? p : null;
};

/** The name's live minute bars on a timeframe; a seconds timeframe has no live bars, so its alerts wait */
const barsFor = (ticker: string, tf: string) => {
  const mins = tfMinutes(tf as Timeframe);
  return mins < 1 ? [] : aggregateCandles(bookCandles(ticker) ?? [], mins);
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
  const bookRev = useBookRev();
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
      ensureBook(sym);
      const close = liveSpotOf(sym);
      if (close == null || !(close > 0)) continue;

      const needsBook = waiting.some(a => a.kind === 'level' || a.kind === 'gexflip' || a.kind === 'newsupreme' || a.kind === 'wallmove' || a.kind === 'script');
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
        const bars = barsFor(sym, head.tf);
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
        const bars = barsFor(sym, tf);
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
  }, [names, bookRev, beat]);

  return null;
};

export default AlertWatcher;
