/* What a net-premium figure covers, in the reader's words (data/traceRows.ts NetCovers): the stretch beside the
   figure, and what it is summed from and leaves out on hover. Two figures from different starts are said apart. */

import type { NetCovers } from '../../data/traceRows';

const SOURCE_WORDS: Record<string, string> = {
  'net-prem-ticks': "the name's minute ticks, every expiry",
  'market tide': 'the market tide, every name',
  'sector tide': "the sector's tide",
  'net flow by expiry': 'net flow by expiry, every name',
  'flow by expiry': "the name's flow by expiry",
  "the book's contracts": "the cut's own contracts on the book",
  'the prints in hand': 'the prints in hand',
};

/** "07:30–10:42 ET" — empty until the figure has a first minute */
export function coversSpan(c: NetCovers | null | undefined): string {
  if (!c || !c.since || c.since === '—') return '';
  const until = !c.until || c.until === '—' ? 'now' : c.until;
  return /^\d/.test(until) ? `${c.since}–${until} ET` : `from ${c.since} ET to ${until}`;
}

/** "From 07:30 to 10:42 ET · net flow by expiry, every name · leaves out strikes not OTM" (≈ when an estimate) */
export function coversTip(c: NetCovers | null | undefined): string {
  if (!c) return '';
  const span = coversSpan(c);
  const parts = [
    span ? `Covers ${span}` : '',
    `summed from ${SOURCE_WORDS[c.source] ?? c.source}`,
    c.leaves.length ? `leaves out ${c.leaves.join(', ')}` : '',
    c.approx ? 'an estimate (≈), not a summed total' : '',
  ].filter(Boolean);
  return parts.join(' · ');
}
