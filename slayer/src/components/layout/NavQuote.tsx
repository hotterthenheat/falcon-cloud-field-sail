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
import { changeInk } from '../../data/book/day';
import { uwKept } from '../../data/whales';
import { sessionWhen } from '../../data/dayChange';

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
  /** The day's change (data/dayChange.ts moveOffCloses): the last regular session's close, or the live price in the
      session, against the regular close before it */
  changeText: string;
  change: number | null;
  /** The extended-hours move of the last trade from the last regular close, labelled ("after hours +0.19%") */
  extText: string | null;
  /** The headline price is an extended-hours print: which */
  priceWord: 'after hours' | 'pre-market' | null;
  /** The session the day's change belongs to when it is not today's ("Fri Oct 30"), else null */
  dayWhen: string | null;
  /** The regular close the extended move is measured from, when outside the session */
  regClose: number | null;
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
    return { priceText: money(keptUw.price), changeText: '', change: null, extText: null, priceWord: null, dayWhen: null, regClose: null, live: false, offline: false, asOf: keptUw.at, source: 'uw' };
  }
  if (uwOnly) {
    /* the day's change is the regular session's (before the open: the last session's); the extended move rides beside it */
    const px = sessionPrice(uw);
    const change = uw && Number.isFinite(uw.changePct) ? uw.changePct : null;
    const ext = uw && uw.phase !== 'regular' ? extendedLine(uw) : null;
    return {
      priceText: px != null && px > 0 ? money(px) : '—',
      changeText: change != null ? signed(change) : '',
      change,
      extText: ext,
      priceWord: uw && uw.extPrice != null && uw.phase !== 'regular' ? (uw.phase === 'pre' ? 'pre-market' : 'after hours') : null,
      dayWhen: uw && uw.phase !== 'regular' ? sessionWhen(uw.regDate) : null,
      regClose: uw?.regClose ?? null,
      live: !!uw,
      offline: false,
      asOf: null,
      source: 'uw',
    };
  }
  const v = held?.value ?? null;
  const move = thetaMove(v);
  const pct = move?.pct ?? null;
  return {
    priceText: v ? money(v.price) : '—',
    changeText: pct != null ? signed(pct) : '',
    change: pct,
    extText: move?.ext != null ? `${move.extWord ?? 'after hours'} ${signed(move.ext)}` : null,
    priceWord: move?.ext != null ? move.extWord : null,
    dayWhen: sessionWhen(move?.regDate),
    regClose: move?.regClose ?? null,
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

/** Price and change, inline (the rail's subject and the phone strip): the last trade, the day's change, and outside
    the session the extended move, short ("AH +0.19%") */
export const NavPrice = memo(({ ticker, compact = false }: { ticker: string; compact?: boolean }) => {
  const q = useNavQuote(ticker);
  const priceTitle = q.asOf
    ? quoteStamp(asOfText(q.asOf))
    : q.priceWord
      ? `Last trade, ${q.priceWord}${q.regClose != null ? ` · regular close ${q.regClose.toFixed(2)}` : ''}`
      : q.source === 'uw'
        ? marketStamp('this session')
        : q.dayWhen
          ? `Last trade · ${q.dayWhen}`
          : quoteStamp('last trade');
  const changeTitle = `${q.dayWhen ? `${q.dayWhen}’s regular-session change` : 'The day’s change'} (the regular close, or the live price in the session, against the regular close before it)${q.extText ? ` · ${q.extText} since the close` : ''}`;
  const tag = q.priceWord === 'pre-market' ? 'PM' : q.priceWord ? 'AH' : null;
  const extShort = q.extText ? q.extText.replace('after hours ', 'AH ').replace('pre-market ', 'PM ') : null;
  return (
    <>
      <span className={`shrink-0 font-mono text-t11 tnum ${q.live ? 'text-textPrimary' : 'text-textSecondary'}`} data-subject-price title={priceTitle}>
        {q.priceText}
        {/* the rail has no room for the extended move: the price says which session it is, the hover gives the move */}
        {tag && !compact && <sup className="ml-0.5 text-t8 text-textMuted" data-subject-price-tag>{tag}</sup>}
      </span>
      {q.change != null && (
        <span className="shrink-0 font-mono text-t10 tnum" style={{ color: changeInk(q.change) }} title={changeTitle} data-subject-change>
          {q.changeText}
        </span>
      )}
      {compact && extShort && (
        <span className="min-w-0 truncate font-mono text-t9 tnum text-textMuted" title={changeTitle} data-subject-ext>
          {extShort}
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
