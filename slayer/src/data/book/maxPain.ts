/* ONE STORE OF A NAME'S MAX PAIN (audit D8): the vendor's max pain for every expiry, read once and shared by the chart's
   key levels (components/gex/levelExtras.ts) and Pinpoint's session readings (data/vendorFeed.ts), which each read
   /stock/{t}/max-pain on their own. A reader says how old a copy it takes; a read in flight answers everyone. */

import { uwCall, type UwAnswer } from '../whales';

const held = new Map<string, { at: number; p: Promise<UwAnswer> }>();

/** The name's max-pain rows: the copy held when it is younger than `maxAgeMs`, else read */
export function maxPainAnswer(ticker: string, maxAgeMs: number): Promise<UwAnswer> {
  const t = ticker.trim().toUpperCase();
  const hit = held.get(t);
  if (hit && (hit.at === 0 || Date.now() - hit.at < maxAgeMs)) return hit.p;
  const entry = { at: 0, p: uwCall(`/stock/${encodeURIComponent(t)}/max-pain`) };
  held.set(t, entry);
  void entry.p.then(a => {
    if (a.error) {
      if (held.get(t) === entry) held.delete(t);
    } else entry.at = Date.now();
  });
  if (held.size > 200) for (const [k, v] of held) if (v.at && Date.now() - v.at > 30 * 60_000) held.delete(k);
  return entry.p;
}
