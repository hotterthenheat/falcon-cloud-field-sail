/* Pinpoint's live price: ThetaData's print (data/thetaQuote.ts), the one price source on these pages. With the terminal
   down it says so over the last print it kept, stamped; with none kept it is a dash. The levels keep the price the vendor
   marked them at (`levelsAt`), named as such, never shown as the live price. */

import { thetaMove, useThetaPrice } from '../../data/thetaQuote';
import { changeInk } from '../../data/uwBook';
import { nyStamp } from '../../core/nyTime';

const pctWords = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`;

export function LivePrice({ ticker, levelsAt, compact = false }: { ticker: string; levelsAt?: number | null; compact?: boolean }) {
  const { held, status } = useThetaPrice(ticker);
  const move = held ? thetaMove(held.value) : null;
  const offline = status === 'down' || (held != null && !held.live);
  const levelsTitle = levelsAt != null && levelsAt > 0 ? `The levels are read at ${levelsAt.toFixed(2)}, the price the vendor marked its rows at.` : '';
  if (!held) {
    return (
      <span className="inline-flex items-baseline gap-1.5 font-mono tnum whitespace-nowrap" title={[offline ? 'ThetaData offline — reconnecting. No price kept on this browser yet.' : 'Reading the price…', levelsTitle].filter(Boolean).join(' ')} data-live-price={offline ? 'offline' : 'pending'}>
        <span className="text-textMuted">—</span>
        {offline && <span className="text-t9 uppercase tracking-widest text-warn">ThetaData offline</span>}
        {!compact && levelsAt != null && levelsAt > 0 && <span className="text-t10 text-textMuted">levels at {levelsAt.toFixed(2)}</span>}
      </span>
    );
  }
  const p = held.value;
  return (
    <span className="inline-flex items-baseline gap-1.5 font-mono tnum whitespace-nowrap" title={[held.live ? `ThetaData · printed ${nyStamp(p.at, { seconds: true, zone: true })}` : `ThetaData offline — reconnecting. Last print kept at ${nyStamp(p.read, { zone: true })}.`, levelsTitle].filter(Boolean).join(' ')} data-live-price={held.live ? 'live' : 'kept'}>
      <span className="text-textPrimary">{p.price.toFixed(2)}</span>
      {move && <span style={{ color: changeInk(move.pct) }}>{pctWords(move.pct)}</span>}
      {!held.live && <span className="text-t9 uppercase tracking-widest text-warn">offline · {nyStamp(p.read, { zone: true })}</span>}
    </span>
  );
}
