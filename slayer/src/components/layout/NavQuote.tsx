/* The rail's live quote of the name on the desk: ThetaData's last trade and the move from the last regular close, or
   on a page that may not ask the terminal for prices (Trace, the Dossier: data/theta.ts) the vendor's quote. Its own
   component, re-rendering only when that name's reading changes, so nothing else on the rail moves with the tape. With
   the terminal down it shows the last reading, stamped with when it was taken. */

import { memo } from 'react';
import { useLocation } from 'react-router-dom';
import { asOfText } from '../ui/states';
import { thetaMove, useThetaPrice } from '../../data/thetaQuote';
import { thetaAllowedHere } from '../../data/theta';
import { extendedLine, useLiveQuote } from '../../data/liveQuote';
import { changeInk } from '../../data/uwBook';

/** The page in view may not ask the terminal for prices: it reads Unusual Whales (re-read on every navigation) */
export function useUwOnlyRoute(): boolean {
  useLocation();
  return !thetaAllowedHere('/stock/snapshot/trade');
}

/** A weekly root has no stock print: the rail quotes the index it tracks */
export const quoteSymbolOf = (t: string): string => (t === 'SPXW' || t === 'XSP' ? 'SPX' : t === 'NDXP' ? 'NDX' : t === 'RUTW' ? 'RUT' : t);

const money = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`;

export interface NavQuoteRead {
  priceText: string;
  changeText: string;
  change: number | null;
  /** The extended-hours move, when the print is past today's close */
  extText: string | null;
  /** The reading is this session's */
  live: boolean;
  /** The terminal did not answer */
  offline: boolean;
  /** When the shown reading was taken, while it is not live */
  asOf: number | null;
  /** Which feed the price is from */
  source: 'theta' | 'uw';
}

export function useNavQuote(ticker: string): NavQuoteRead {
  const uwOnly = useUwOnlyRoute();
  const sym = quoteSymbolOf(ticker);
  const { held, status } = useThetaPrice(uwOnly ? null : sym);
  const uw = useLiveQuote(uwOnly ? sym : null);
  if (uwOnly) {
    /* before the open the lead is the last session's change; the extended move rides beside it */
    const change = uw ? (uw.phase === 'pre' ? uw.lastSessionPct : uw.changePct) : null;
    return {
      priceText: uw && uw.regularPrice > 0 ? money(uw.regularPrice) : '—',
      changeText: change != null && Number.isFinite(change) ? signed(change) : '',
      change: change != null && Number.isFinite(change) ? change : null,
      extText: extendedLine(uw),
      live: !!uw,
      offline: false,
      asOf: null,
      source: 'uw',
    };
  }
  const v = held?.value ?? null;
  const move = thetaMove(v);
  return {
    priceText: v ? money(v.price) : '—',
    changeText: move ? signed(move.pct) : '',
    change: move ? move.pct : null,
    extText: move?.ext != null ? `after hours ${signed(move.ext)}` : null,
    live: !!held?.live,
    offline: status === 'down',
    asOf: held && !held.live ? held.value.at : null,
    source: 'theta',
  };
}

/** The offline line under the subject: which feed is down, and how old the price beside it is */
export const OfflineLine = memo(({ asOf, className = '' }: { asOf: number | null; className?: string }) => (
  <span className={`flex items-center gap-1.5 font-mono text-t9 uppercase tracking-widest text-warn ${className}`} title="The ThetaData terminal is not answering. The price is the last one it gave." data-theta-offline>
    <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
    <span className="truncate">ThetaData offline{asOf ? ` · ${asOfText(asOf)}` : ''}</span>
  </span>
));
OfflineLine.displayName = 'OfflineLine';

/** Price and change, inline (the rail's subject and the phone strip) */
export const NavPrice = memo(({ ticker, compact = false }: { ticker: string; compact?: boolean }) => {
  const q = useNavQuote(ticker);
  return (
    <>
      <span className={`shrink-0 font-mono text-t11 tnum ${q.live ? 'text-textPrimary' : 'text-textSecondary'}`} data-subject-price title={q.asOf ? `ThetaData · ${asOfText(q.asOf)}` : q.source === 'uw' ? 'Unusual Whales · last regular price' : 'ThetaData · last trade'}>
        {q.priceText}
      </span>
      {q.change != null && (
        <span className="min-w-0 truncate font-mono text-t10 tnum" style={{ color: changeInk(q.change) }} title={`From the last regular close${q.extText ? ` · ${q.extText}` : ''}`} data-subject-change>
          {q.changeText}
          {compact && q.extText ? <span className="text-textMuted"> · {q.extText.replace('after hours', 'AH')}</span> : null}
        </span>
      )}
      {compact && q.offline && <span aria-label="ThetaData offline" title={`ThetaData offline${q.asOf ? ` · ${asOfText(q.asOf)}` : ''}`} className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warn" data-theta-offline />}
    </>
  );
});
NavPrice.displayName = 'NavPrice';

/** The offline line, only while the terminal is down */
export const NavOffline = memo(({ ticker }: { ticker: string }) => {
  const q = useNavQuote(ticker);
  if (!q.offline) return null;
  return <OfflineLine asOf={q.asOf} className="px-1 h-4" />;
});
NavOffline.displayName = 'NavOffline';
