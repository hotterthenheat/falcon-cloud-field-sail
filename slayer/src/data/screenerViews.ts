import { createViewStore } from './savedViews';
import { DEFAULT_FILTERS, type BookFilters } from './flowBook';
import type { SleeveKey } from '../types/compass';

/* A screener filter as the address: the URL wins over the stored filter, and only fields that differ from the defaults are written. */

// ---- the codec ------------------------------------------------------------

const SIDES = new Set(['ALL', 'C', 'P']);

/** Only the fields that differ from the default are written. */
export function filtersToParams(f: BookFilters, screen?: string, query?: string, expiry?: string | null): URLSearchParams {
  const p = new URLSearchParams();
  if (screen) p.set('screen', screen);
  if (query) p.set('q', query);
  /* The expiry travels too. */
  if (expiry) p.set('exp', expiry);
  if (f.side !== DEFAULT_FILTERS.side) p.set('side', f.side);
  if (f.tenors.length) p.set('tenors', f.tenors.join(','));
  if (f.minVolume > 0) p.set('vol', String(f.minVolume));
  if (f.minPremium > 0) p.set('prem', String(f.minPremium));
  if (f.excludeItm) p.set('otm', '1');
  return p;
}

/** A filter read from a query string, every field validated (a URL is user input); a malformed value falls back to its default. */
export function paramsToFilters(
  p: URLSearchParams,
  validTenors: readonly string[]
): {
  filters: BookFilters;
  screen: string | null;
  query: string;
  expiry: string | null;
  any: boolean;
} {
  const num = (v: string | null): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const rawSide = p.get('side');
  const rawTenors = (p.get('tenors') ?? '').split(',').filter(t => validTenors.includes(t));
  const filters: BookFilters = {
    side: rawSide && SIDES.has(rawSide) ? (rawSide as BookFilters['side']) : DEFAULT_FILTERS.side,
    tenors: rawTenors as SleeveKey[],
    minVolume: num(p.get('vol')),
    minPremium: num(p.get('prem')),
    excludeItm: p.get('otm') === '1',
  };
  const any = ['side', 'tenors', 'vol', 'prem', 'otm', 'screen', 'q', 'exp'].some(k => p.has(k));
  const exp = p.get('exp');
  return { filters, screen: p.get('screen'), query: p.get('q') ?? '', expiry: exp && /^\d{4}-\d{2}-\d{2}$/.test(exp) ? exp : null, any };
}

// ---- the saved views ------------------------------------------------------
/* The store itself is shared (data/savedViews) — the screener keeps only its
   own key and its own codec. */
export const screenerCuts = createViewStore('slayer_screener_views_v1');
