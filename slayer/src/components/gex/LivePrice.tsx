/* Pinpoint's live price: ThetaData's print (data/thetaQuote.ts), the one price source on these pages. With the terminal
   down it says so over the last print it kept, stamped; with none kept it is a dash. The levels keep the price the vendor
   marked them at (`levelsAt`), named as such, never shown as the live price. */

import { useEffect, useSyncExternalStore } from 'react';
import { ensureThetaPrice, peekThetaPrice, subscribeTheta, thetaMove, thetaStatus, useThetaStatus, type Held, type ThetaPrice, type ThetaStatus } from '../../data/thetaQuote';
import { changeInk } from '../../data/uwBook';
import { nyStamp } from '../../core/nyTime';

/* One name's reading: asked every second while the terminal answers it, every fifteen seconds while it does not, every
   half minute while it is down — a list of prices must not ask once a second a name into a terminal that is not answering */
const askedAt = new Map<string, number>();
export function askThetaPrice(ticker: string): void {
  const now = Date.now();
  const gap = thetaStatus() === 'down' ? 30_000 : peekThetaPrice(ticker)?.live ? 1_000 : 15_000;
  if (now - (askedAt.get(ticker) ?? 0) < gap) return;
  askedAt.set(ticker, now);
  ensureThetaPrice(ticker);
}
function useHeldPrice(ticker: string): { held: Held<ThetaPrice> | null; status: ThetaStatus } {
  useEffect(() => {
    askThetaPrice(ticker);
    const id = window.setInterval(() => askThetaPrice(ticker), 1_000);
    return () => window.clearInterval(id);
  }, [ticker]);
  const sig = useSyncExternalStore(
    subscribeTheta,
    () => {
      const h = peekThetaPrice(ticker);
      return `${thetaStatus()}|${h ? `${h.live ? 1 : 0}|${h.value.price}|${h.value.prevClose}|${h.value.todayClose}|${h.value.at}` : ''}`;
    },
    () => '',
  );
  void sig;
  return { held: peekThetaPrice(ticker), status: thetaStatus() };
}

const pctWords = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`;

export function LivePrice({ ticker, levelsAt, compact = false }: { ticker: string; levelsAt?: number | null; compact?: boolean }) {
  const { held, status } = useHeldPrice(ticker);
  const move = held ? thetaMove(held.value) : null;
  const offline = status === 'down' || (held != null && !held.live);
  const levelsTitle = levelsAt != null && levelsAt > 0 ? `The levels are read at ${levelsAt.toFixed(2)}, the price the vendor marked its rows at.` : '';
  if (!held) {
    return (
      <span className="inline-flex items-baseline gap-1.5 font-mono tnum whitespace-nowrap" title={[offline ? 'ThetaData offline — reconnecting. No price kept on this browser yet.' : 'Reading the price…', levelsTitle].filter(Boolean).join(' ')} data-live-price={offline ? 'offline' : 'pending'}>
        <span className="text-textMuted">—</span>
        {offline && !compact && <span className="text-t9 uppercase tracking-widest text-warn">ThetaData offline</span>}
        {!compact && levelsAt != null && levelsAt > 0 && <span className="text-t10 text-textMuted">levels at {levelsAt.toFixed(2)}</span>}
      </span>
    );
  }
  const p = held.value;
  return (
    <span className="inline-flex items-baseline gap-1.5 font-mono tnum whitespace-nowrap" title={[held.live ? `ThetaData · printed ${nyStamp(p.at, { seconds: true, zone: true })}` : `ThetaData offline — reconnecting. Last print kept at ${nyStamp(p.read, { zone: true })}.`, levelsTitle].filter(Boolean).join(' ')} data-live-price={held.live ? 'live' : 'kept'}>
      <span className="text-textPrimary">{p.price.toFixed(2)}</span>
      {move && <span style={{ color: changeInk(move.pct) }}>{pctWords(move.pct)}</span>}
      {!held.live && <span className="text-t9 uppercase tracking-widest text-warn">{compact ? nyStamp(p.read, { zone: true }) : `offline · ${nyStamp(p.read, { zone: true })}`}</span>}
    </span>
  );
}

/** One note for a list of compact prices: the terminal is down, so the prices are the last ones kept (or dashes) */
export function ThetaOfflineNote() {
  const status = useThetaStatus();
  if (status !== 'down') return null;
  return (
    <span className="font-mono text-t9 uppercase tracking-widest text-warn" title="The prices come from ThetaData. With the terminal down each name shows its last kept print, stamped, or a dash." data-theta-offline>
      ThetaData offline · prices are the last kept
    </span>
  );
}
