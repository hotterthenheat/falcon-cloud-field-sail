/* A backtest's report figures off its own equity (engine sessionStatsOf), with the recorded quotes that curve reads
   loaded first. The minute curve marks every contract held at its mid each minute; a minute whose leg's day is not in
   hand keeps the last price it had, so before those days load the drawdown would read shallow — and differ from page
   to page. Here every (leg, day) the account held a contract on is asked for, and the figure says it is still reading
   until they answer. */

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { sessionStatsOf, statsOf, stampOf, type Session } from './engine';
import { daysBetween, ensureLeg, historyRev, legKnown, legNeed, subscribeHistory, type Leg } from './history';
import { contractKey, longLeg } from './quotes';

type Stats = ReturnType<typeof statsOf>;

/** Every leg the account held, on every day it held it — from the fill that opened it to the one that closed it, or the
    clock's day while it is still open; never past its expiry */
export function curveLegs(s: Session): { leg: Leg; day: string }[] {
  const fills = [...s.fills].sort((a, b) => stampOf(a.at) - stampOf(b.at));
  const open = new Map<string, { qty: number; from: string }>();
  const spans: { c: (typeof fills)[number]['contract']; from: string; to: string }[] = [];
  for (const f of fills) {
    const k = contractKey(f.contract);
    const h = open.get(k) ?? { qty: 0, from: f.at.day };
    if (h.qty === 0) h.from = f.at.day;
    h.qty += (f.side === 'buy' ? 1 : -1) * f.qty;
    if (h.qty === 0) {
      spans.push({ c: f.contract, from: h.from, to: f.at.day });
      open.delete(k);
    } else open.set(k, h);
  }
  for (const [k, h] of open) {
    const c = fills.find(f => contractKey(f.contract) === k)!.contract;
    spans.push({ c, from: h.from, to: s.cursor.day });
  }
  const out = new Map<string, { leg: Leg; day: string }>();
  for (const sp of spans) {
    const l = longLeg(sp.c);
    const legs: Leg[] = [l, ...(sp.c.short != null ? [{ ...l, strike: sp.c.short }] : [])];
    const last = sp.to < sp.c.expiry ? sp.to : sp.c.expiry;
    for (const day of daysBetween(sp.from, last)) for (const leg of legs) out.set(`${contractKey(leg)}|${day}`, { leg, day });
  }
  return [...out.values()];
}

/** Still waiting on a leg's day the curve reads (an offline or empty answer is not waited on) */
const waiting = (n: { leg: Leg; day: string }) => !legKnown(n.leg, n.day) && legNeed(n.leg, n.day) !== 'offline';

/** Ask for every leg's day the curve reads that is not in hand; true when none is still awaited */
export function ensureCurve(s: Session): boolean {
  let ready = true;
  for (const n of curveLegs(s)) {
    if (legKnown(n.leg, n.day)) continue;
    if (legNeed(n.leg, n.day) === 'offline') continue;
    ready = false;
    void ensureLeg(n.leg, n.day);
  }
  return ready;
}

/** The session's figures off its equity; `reading` while the quotes its curve needs are still loading */
export function useSessionStats(s: Session | null | undefined): { stats: Stats | null; reading: boolean } {
  const hrev = useSyncExternalStore(subscribeHistory, historyRev, historyRev);
  const needs = useMemo(() => (s ? curveLegs(s) : []), [s]);
  useEffect(() => {
    if (s) ensureCurve(s);
  }, [s, hrev]);
  const reading = needs.some(waiting);
  const stats = useMemo(() => (s ? sessionStatsOf(s) : null), [s, hrev, reading]); // eslint-disable-line react-hooks/exhaustive-deps
  return { stats, reading };
}

/** The same for a list of sessions — one hook, the first `cap` of them asked for */
export function useSessionsStats(list: Session[], cap = 30): { stats: Map<string, Stats>; reading: Set<string> } {
  const hrev = useSyncExternalStore(subscribeHistory, historyRev, historyRev);
  useEffect(() => {
    for (const s of list.slice(0, cap)) ensureCurve(s);
  }, [list, hrev, cap]);
  return useMemo(() => {
    const stats = new Map<string, Stats>();
    const reading = new Set<string>();
    for (const s of list) {
      stats.set(s.id, sessionStatsOf(s));
      if (curveLegs(s).some(waiting)) reading.add(s.id);
    }
    return { stats, reading };
  }, [list, hrev]); // eslint-disable-line react-hooks/exhaustive-deps
}
