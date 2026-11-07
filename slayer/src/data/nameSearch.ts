/* THE NAME SEARCH'S LIST (components/ui/NameSearchSheet.tsx), with no React in it so the proof reads the same function
   the sheet does (scripts/name-search-proof.ts).

   Typed: every listing Terrain can serve (the symbol directory, data/symbolDirectory.ts — the stocks and funds the
   terminal quotes with bars and the indexes it prices, each with its name) by the desks' one rule (data/listedNames.ts searchListed): the exact symbol, then symbols that
   start with it, then names with a word that starts with it, then the rest — the most traded first inside each tier. A
   weekly index root (SPXW, NDXP, RUTW, VIXW) folds into its index. Before the directory's chunk lands the bundled
   listings answer (data/tickers.ts), so the first keystroke never waits on a download.

   At rest: the watchlist's own names first (data/nameWatch.ts), then the house's featured names and the directory by
   popularity, each name once. */

import { companyName, searchTickers, type TickerListing } from './tickers';
import { searchRoom } from './listedNames';

/** Rows a query shows (the list scrolls; a query narrows it long before forty) */
export const NAME_LIMIT = 40;

export function searchNames(query: string, watched: readonly string[] = [], limit = NAME_LIMIT): TickerListing[] {
  const q = query.trim();
  if (q) return searchRoom('terrain', q, limit, searchTickers(q, limit), companyName);
  const seen = new Set<string>();
  const out: TickerListing[] = [];
  for (const raw of watched) {
    const symbol = raw.trim().toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push({ symbol, name: companyName(symbol) });
  }
  const cap = limit + out.length;
  for (const t of searchRoom('terrain', '', cap, searchTickers('', cap), companyName)) {
    if (out.length >= cap) break;
    if (seen.has(t.symbol)) continue;
    seen.add(t.symbol);
    out.push(t);
  }
  return out;
}
