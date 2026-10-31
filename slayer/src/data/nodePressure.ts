/* Node pressure: price within a reader's distance of one of the heaviest exposure nodes or the flip says so through the
   app's own alert channel — the same chip, chime, bell count and drawer log every alert fires into (alertStore's
   armed-then-fired record, the kind a script's condition uses), never a second channel. Once a level a session, for
   every pane on the name: the first pane that sees it fires it, the rest find it already said. */

import { armScript, markFired } from '../components/gex/alertStore';
import { nyIsoDate } from '../core/nyTime';

export interface PressureLevel {
  /** the level's price (a node's strike, the flip) */
  price: number;
  /** "Supreme", "Call wall", "Node", "Flip" */
  name: string;
  /** the node's dealer gamma, dollars per 1%; null for the flip */
  value: number | null;
}

/** Levels already said, by name, session day and level */
const said = new Set<string>();

const dollars = (v: number): string => {
  const a = Math.abs(v);
  const s = v < 0 ? '−' : '+';
  return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(1)}M` : `${s}$${(a / 1e3).toFixed(0)}K`;
};
const px = (p: number): string => (Math.abs(p - Math.round(p)) < 1e-9 ? p.toFixed(0) : p.toFixed(2));

/** The level price is near: within `pct` percent of `price` */
export const withinPct = (price: number, level: number, pct: number): boolean => price > 0 && level > 0 && (Math.abs(price - level) / price) * 100 <= pct;

/** The alert's words: "within 0.15% of 760 · Supreme · +$26.5M" */
export function pressureWords(price: number, l: PressureLevel, pct: number): string {
  const size = l.value != null ? ` · ${dollars(l.value)}` : '';
  return `${px(price)} within ${pct}% of ${px(l.price)} · ${l.name}${size}`;
}

/**
 * Check the levels against the price and fire the first one not yet said this session. Returns the level fired, or
 * null. `now` is the wall clock (the session day it keys on); `bar` the live bar's time, seconds.
 */
export function checkPressure(ticker: string, price: number, levels: readonly PressureLevel[], pct: number, paneId: string, tf: string, bar: number, now = Date.now()): PressureLevel | null {
  if (!(price > 0) || !(pct > 0)) return null;
  const day = nyIsoDate(now);
  for (const l of levels) {
    if (!withinPct(price, l.price, pct)) continue;
    const key = `${ticker}|${day}|${l.name === 'Flip' ? 'flip' : px(l.price)}`;
    if (said.has(key)) continue;
    said.add(key);
    const armed = armScript(
      ticker,
      { scriptId: 'slayer:node-pressure', scriptTitle: 'Node pressure', conditionId: key, title: `Near ${px(l.price)}`, message: pressureWords(price, l, pct), paneId, tf, inputs: { pct }, armedBar: bar },
      now
    );
    /* the cap full (eight waiting alerts): said all the same — the next session asks again */
    if (armed) markFired(ticker, armed.id, now);
    return l;
  }
  return null;
}
