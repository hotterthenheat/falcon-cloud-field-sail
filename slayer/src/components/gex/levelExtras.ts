/* The key levels beside the book's walls, flip and supreme: max pain (the vendor's, per expiry), today's expected move and
   the 1σ to the close (the cone's numbers, data/terrainCone.ts) — and each wall's size against the cut's largest strike. */
import { useEffect, useSyncExternalStore } from 'react';
import { uwCall } from '../../data/whales';
import type { ForwardCone } from '../../data/terrainCone';
import type { StrikeNode } from '../../types/market';
import type { KeyLevelRung } from './keyLevelsPrimitive';

/** The extra rungs' inks: literals, the chart is its own island */
export const EXTRA_INK = {
  maxPain: '#B79CFF',
  move: '#F5C542',
  sigma: '#C7D3E8',
  cone: '#EDEDED',
  cone2: '#8F96A3',
} as const;

const pain = new Map<string, { at: number; byExpiry: Map<string, number> }>();
const asked = new Map<string, number>();
const listeners = new Set<() => void>();
const PAIN_MS = 10 * 60_000;

function ensurePain(ticker: string): void {
  const t = ticker.toUpperCase();
  const last = asked.get(t) ?? 0;
  if (Date.now() - last < PAIN_MS) return;
  asked.set(t, Date.now());
  void uwCall(`/stock/${encodeURIComponent(t)}/max-pain`).then(res => {
    if (res.error || !Array.isArray(res.data)) return;
    const byExpiry = new Map<string, number>();
    for (const r of res.data as Record<string, unknown>[]) {
      const e = String(r?.expiry ?? '').slice(0, 10);
      const v = parseFloat(String(r?.max_pain ?? ''));
      if (/^\d{4}-\d{2}-\d{2}$/.test(e) && v > 0) byExpiry.set(e, v);
    }
    if (!byExpiry.size) return;
    pain.set(t, { at: Date.now(), byExpiry });
    listeners.forEach(fn => fn());
  });
}

/** The vendor's max pain for one expiry of a name (YYYY-MM-DD) — null until it is read or when it has none */
export function maxPainFor(ticker: string, expiry: string | null | undefined): number | null {
  if (!expiry) return null;
  return pain.get(ticker.toUpperCase())?.byExpiry.get(expiry) ?? null;
}

/** The hook: max pain for an expiry, read once every ten minutes */
export function useMaxPain(ticker: string, expiry: string | null | undefined, on = true): number | null {
  useEffect(() => {
    if (on && ticker) ensurePain(ticker);
  }, [ticker, on]);
  return useSyncExternalStore(
    fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => maxPainFor(ticker, expiry),
    () => maxPainFor(ticker, expiry),
  );
}

/** The cone's levels at the edge: today's expected move from the open, and the last price ±1σ to the close */
export function coneRungs(fc: ForwardCone | null): KeyLevelRung[] {
  if (!fc) return [];
  const out: KeyLevelRung[] = [];
  if (fc.move) {
    out.push({ key: 'moveHigh', price: fc.move.high, ink: EXTRA_INK.move, dash: true });
    out.push({ key: 'moveLow', price: fc.move.low, ink: EXTRA_INK.move, dash: true });
  }
  /* 1σ to today's close while the session runs; once it has rung, the next close is the cone's end below */
  if (fc.sigmaToday != null && fc.sigmaToday > 0) {
    out.push({ key: 'sigmaHigh', price: fc.spot + fc.sigmaToday, ink: EXTRA_INK.sigma, dash: true });
    out.push({ key: 'sigmaLow', price: fc.spot - fc.sigmaToday, ink: EXTRA_INK.sigma, dash: true });
  }
  if (fc.sigmaNext > 0) {
    out.push({ key: 'nextHigh', price: fc.spot + fc.sigmaNext, ink: EXTRA_INK.cone, dash: true });
    out.push({ key: 'nextLow', price: fc.spot - fc.sigmaNext, ink: EXTRA_INK.cone, dash: true });
    out.push({ key: 'twoHigh', price: fc.spot + 2 * fc.sigmaNext, ink: EXTRA_INK.cone2, dash: true });
    out.push({ key: 'twoLow', price: fc.spot - 2 * fc.sigmaNext, ink: EXTRA_INK.cone2, dash: true });
  }
  return out;
}

/** Each wall's and the supreme's size: the strike's |net GEX| against the cut's largest strike's (house rows) */
export function withShares(rungs: KeyLevelRung[], chain: readonly StrikeNode[] | null | undefined): KeyLevelRung[] {
  if (!chain?.length) return rungs;
  let top = 0;
  for (const n of chain) top = Math.max(top, Math.abs(n.netGex));
  if (!(top > 0)) return rungs;
  return rungs.map(r => {
    if (r.key !== 'callWall' && r.key !== 'putWall' && r.key !== 'supreme') return r;
    const n = chain.find(x => Math.abs(x.strike - r.price) < 1e-9);
    return n ? { ...r, share: Math.abs(n.netGex) / top } : r;
  });
}
