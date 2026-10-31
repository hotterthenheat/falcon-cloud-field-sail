/* The rail's live quote of the name on the desk: ThetaData's last trade and the move from the last regular close, or
   on a page that may not ask the terminal for prices (Trace, the Dossier: data/theta.ts) the vendor's quote. Its own
   component, re-rendering only when that name's reading changes, so nothing else on the rail moves with the tape. With
   the terminal down it shows the last reading, stamped with when it was taken. */

import { LIVE_OFFLINE, LIVE_OFFLINE_KEPT, marketStamp, quoteStamp } from '../../copy/feeds';
import { memo, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AsOf, asOfText } from '../ui/states';
import { thetaMove, useThetaPrice } from '../../data/thetaQuote';
import { thetaAllowedHere } from '../../data/theta';
import { extendedLine, sessionPrice, useLiveQuote } from '../../data/liveQuote';
import { changeInk } from '../../data/uwBook';
import { uwKept } from '../../data/whales';

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

/** The vendor's state this browser kept for a name (data/uwStore.ts), until the fresh quote lands: its last print and
    the print's instant */
function useKeptState(sym: string | null): { price: number; at: number } | null {
  const [kept, setKept] = useState<{ sym: string; price: number; at: number } | null>(null);
  useEffect(() => {
    if (!sym) return;
    let live = true;
    void uwKept(`/stock/${encodeURIComponent(sym)}/stock-state`).then(k => {
      const d = k?.data as { data?: { close?: string; tape_time?: string } } | { close?: string; tape_time?: string } | null;
      const row = d && 'data' in d ? d.data : (d as { close?: string; tape_time?: string } | null);
      const price = Number(row?.close);
      const at = Date.parse(String(row?.tape_time ?? '')) || k?.at || 0;
      if (live && price > 0 && at > 0) setKept({ sym, price, at });
    });
    return () => {
      live = false;
    };
  }, [sym]);
  return kept && kept.sym === sym ? kept : null;
}

export function useNavQuote(ticker: string): NavQuoteRead {
  const uwOnly = useUwOnlyRoute();
  const sym = quoteSymbolOf(ticker);
  const { held, status } = useThetaPrice(uwOnly ? null : sym);
  const uw = useLiveQuote(uwOnly ? sym : null);
  const keptUw = useKeptState(uwOnly && !uw ? sym : null);
  if (uwOnly && !uw && keptUw) {
    /* the vendor's quote is on its way: the last one this browser kept, stamped, never as live */
    return { priceText: money(keptUw.price), changeText: '', change: null, extText: null, live: false, offline: false, asOf: keptUw.at, source: 'uw' };
  }
  if (uwOnly) {
    /* before the open the lead is the last session's change; the extended move rides beside it */
    const px = sessionPrice(uw);
    const change = uw ? (uw.phase === 'regular' ? uw.changePct : uw.extPct) : null;
    return {
      priceText: px != null && px > 0 ? money(px) : '—',
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
  <span className={`flex items-center gap-1.5 font-mono text-t9 uppercase tracking-widest text-warn ${className}`} title={LIVE_OFFLINE_KEPT} data-theta-offline>
    <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
    <span className="truncate">{LIVE_OFFLINE}{asOf ? ` · ${asOfText(asOf)}` : ''}</span>
  </span>
));
OfflineLine.displayName = 'OfflineLine';

/** Price and change, inline (the rail's subject and the phone strip) */
export const NavPrice = memo(({ ticker, compact = false }: { ticker: string; compact?: boolean }) => {
  const q = useNavQuote(ticker);
  return (
    <>
      <span className={`shrink-0 font-mono text-t11 tnum ${q.live ? 'text-textPrimary' : 'text-textSecondary'}`} data-subject-price title={q.asOf ? quoteStamp(asOfText(q.asOf)) : q.source === 'uw' ? marketStamp('this session') : quoteStamp('last trade')}>
        {q.priceText}
      </span>
      {q.change != null && (
        <span className="min-w-0 truncate font-mono text-t10 tnum" style={{ color: changeInk(q.change) }} title={`From the last regular close${q.extText ? ` · ${q.extText}` : ''}`} data-subject-change>
          {q.changeText}
          {compact && q.extText ? <span className="text-textMuted"> · {q.extText.replace('after hours', 'AH')}</span> : null}
        </span>
      )}
      {compact && q.offline && <span aria-label={LIVE_OFFLINE} title={`${LIVE_OFFLINE}${q.asOf ? ` · ${asOfText(q.asOf)}` : ''}`} className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warn" data-theta-offline />}
    </>
  );
});
NavPrice.displayName = 'NavPrice';

/** The offline line while the terminal is down; a kept vendor price says how old it is */
export const NavOffline = memo(({ ticker }: { ticker: string }) => {
  const q = useNavQuote(ticker);
  if (q.offline) return <OfflineLine asOf={q.asOf} className="px-1 h-4" />;
  if (q.source === 'uw' && q.asOf) return <AsOf at={q.asOf} className="px-1 h-4" title="Kept from the last visit. The fresh quote replaces it when it lands." />;
  return null;
});
NavOffline.displayName = 'NavOffline';
