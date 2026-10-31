/* Which expiry dates a chain is (one date, a sum of several via bookWindow.chainForDates, or the whole book via uwBook.chainsFor),
   by identity, so the flip can re-price each date's legs at its own time to expiry. */
import type { StrikeNode } from '../types/market';
import { thetaGet, type ThetaAnswer } from './thetaFeed';

const registry = new WeakMap<readonly StrikeNode[], string[] | 'ALL'>();

/** Mark a chain as the sum of these expiry dates, or as the whole live book */
export function registerChainDates(chain: readonly StrikeNode[], dates: string[] | 'ALL'): void {
  registry.set(chain, dates);
}

export const registeredDates = (chain: readonly StrikeNode[]): string[] | 'ALL' | undefined => registry.get(chain);

/* ONE STORE OF A ROOT'S LISTED EXPIRATIONS (audit D5): the cone (data/coneFeed.ts), the Weigher's expiry list
   (data/weigherDesk.ts listLiveExpiries, which the warm-up reads too) and Paper's (data/paper/thetaFeed.ts) each read
   /option/list/expirations on their own. The list changes once a day: one read a root, shared in flight, held five
   minutes; a failed read is not held. */
const LIST_HOLD_MS = 5 * 60_000;
const lists = new Map<string, { at: number; p: Promise<ThetaAnswer> }>();
export function listExpirations(root: string, jump = false): Promise<ThetaAnswer> {
  const r = root.trim().toUpperCase();
  const hit = lists.get(r);
  if (hit && (hit.at === 0 || Date.now() - hit.at < LIST_HOLD_MS)) return hit.p;
  const entry = { at: 0, p: thetaGet(`/option/list/expirations?symbol=${encodeURIComponent(r)}&format=json`, jump) };
  lists.set(r, entry);
  void entry.p.then(a => {
    if (a.error) {
      if (lists.get(r) === entry) lists.delete(r);
    } else entry.at = Date.now();
  });
  return entry.p;
}
