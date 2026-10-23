/*
==================================================
  SLAYER TERMINAL - THE CROSS CARD
  One dark-pool cross in the print card's grammar:
  the masthead, the money and where it sat in the
  quote, the sentence, the facts, the sequence,
  then the stock and the running dark dollars on
  one clock. A stock cross — no option fields.
==================================================
*/
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark, Check, ChevronDown, ChevronUp, Copy, Crosshair, Scale } from 'lucide-react';
import { AreaSeries, LineStyle, createChart, createSeriesMarkers, type IChartApi, type UTCTimestamp } from 'lightweight-charts';
import Modal from '../ui/Modal';
import Fact from '../ui/Fact';
import RichRead from '../ui/RichRead';
import GradeMeter from '../ui/GradeMeter';
import SlayerMark from '../../brand/SlayerMark';
import Wordmark from '../../brand/Wordmark';
import { nyClock } from '../../core/nyTime';
import { nyDateOf, postureOf, quotePlace, tapeSessionIso, useDarkDay, useStockLast, useStockMinutes } from '../../data/traceLive';
import { dayAdv } from './dayWords';
import { usd as fmtUsd } from '../../data/traceLive';
import { gradeOfConviction, gradeOfPosture, POSTURE_WORD } from '../../data/darkpool';
import { crossKey, useWatch, watchedCross } from '../../context/WatchContext';
import { readToken, useResolvedTheme } from '../../theme/theme';
import { dayChartOptions, syncDayScale, type DaySurface } from '../gex/dayChart';
import type { DarkPoolIntent, DarkPoolPrint, DarkPoolView, LevelRole } from '../../types/darkpool';

const num = (v: number) => v.toLocaleString('en-US');
const INTENT_INK: Record<DarkPoolIntent, string> = { ACCUMULATION: 'text-bull', DISTRIBUTION: 'text-bear', 'HEDGE FLOW': 'text-warn', ROTATION: 'text-textMuted' };
const INTENT_BAR: Record<DarkPoolIntent, string> = { ACCUMULATION: 'bg-bull/80', DISTRIBUTION: 'bg-bear/80', 'HEDGE FLOW': 'bg-warn/80', ROTATION: 'bg-ink/25' };
const ROLE_INK: Record<LevelRole, string> = { SUPPORT: 'text-bull', RESISTANCE: 'text-bear', PIVOT: 'text-textMuted' };
const ROLE_TOKEN: Record<LevelRole, string> = { SUPPORT: '--bull', RESISTANCE: '--bear', PIVOT: '--text-muted' };
const ROLE_WORD: Record<LevelRole, string> = { SUPPORT: 'support', RESISTANCE: 'resistance', PIVOT: 'pivot' };
const SEQ_SHOWN = 6;

const INTENT_TAG: Record<DarkPoolIntent, string> = { ACCUMULATION: 'ACCUMULATION', DISTRIBUTION: 'DISTRIBUTION', 'HEDGE FLOW': 'AT THE MID', ROTATION: 'NO READ' };
const IntentTag = ({ intent }: { intent: DarkPoolIntent }) => (
  <span className={`font-mono text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap ${INTENT_INK[intent]}`}>{INTENT_TAG[intent]}</span>
);
const noReadWord = (p: DarkPoolPrint) => (p.special ? (p.auction ? 'no read · auction' : 'no read · terms') : p.extended ? 'no read · after hours' : 'no read · small');

const shelfOf = (p: DarkPoolPrint, view: DarkPoolView | null) => {
  if (!view || !p.atLevel) return null;
  let best = null as DarkPoolView['levels'][number] | null;
  for (const l of view.levels) if (Math.abs(l.price - p.price) / p.price < 0.0015 && (!best || Math.abs(l.price - p.price) < Math.abs(best.price - p.price))) best = l;
  return best;
};

/** A one-letter market-center code is not a venue name. */
const venueWord = (v: string) => (v.trim().length > 2 && /[A-Za-z]/.test(v) ? v.trim() : 'off-exchange');

/* NO SIDE WHERE THERE IS NONE (audit round 4: crosses 3% over the quote read "inside quote" — the fallback for a print with
   no execution side): an own-terms print is priced by its terms; a print with no quote has no place in one */
const sideWord = (p: DarkPoolPrint) =>
  p.special ? 'own terms' : p.exec === 'ASK' ? 'paid offer' : p.exec === 'BID' ? 'hit bid' : p.exec === 'MID' ? 'inside quote' : p.bid == null || p.ask == null ? 'no quote' : 'off the quote';
const sideLabel = (p: DarkPoolPrint) => (p.exec === 'ASK' ? 'BOUGHT' : p.exec === 'BID' ? 'SOLD' : p.exec === 'MID' ? 'MID' : '');

const fillFrac = (p: DarkPoolPrint): number | null => {
  if (p.bid != null && p.ask != null && p.ask > p.bid) return Math.min(1, Math.max(0, (p.price - p.bid) / (p.ask - p.bid)));
  if (p.exec === 'BID') return 0;
  if (p.exec === 'ASK') return 1;
  if (p.exec === 'MID') return 0.5;
  return null;
};

/* The card's own ground. The day chart's figure surface is a grey slab and
   does not belong in this sheet — the print card sits on the inset. */
const cardSurface = (host: HTMLElement, paper: boolean): DaySurface => {
  const bg = readToken('--inset', undefined, host);
  const ink = readToken('--text-primary', undefined, host);
  const text = readToken('--text-secondary', undefined, host);
  if (paper) return { bg, text, line: readToken('--ink', 0.16, host), crosshair: readToken('--ink', 0.45, host), label: ink, ink, zero: readToken('--ink', 0.28, host) };
  return { bg, text, line: readToken('--border-subtle', undefined, host), crosshair: readToken('--text-primary', 0.35, host), label: readToken('--chip', undefined, host), ink, zero: readToken('--border-muted', undefined, host) };
};

/** The New York day a cross printed on — its own date, never the clock's */
const crossIsoOf = (p: DarkPoolPrint): string => p.dateIso || (p.epochMs && p.epochMs > 0 ? nyDateOf(p.epochMs) : tapeSessionIso());

const CrossTape = ({ print, view }: { print: DarkPoolPrint; view: DarkPoolView | null }) => {
  const priceRef = useRef<HTMLDivElement | null>(null);
  const darkRef = useRef<HTMLDivElement | null>(null);
  const paper = useResolvedTheme() === 'light';
  /* THE STOCK'S WHOLE DAY, EXTENDED HOURS IN (the re-audit, 2026-10-22: the stock line ended at the 16:00 close while
     the cross was at 17:04): the name's own one-minute bars for the session's date, pre-market to after hours */
  const bars = useStockMinutes(print.ticker, crossIsoOf(print)).rows;
  const crosses = useMemo(() => (view?.prints?.length ? view.prints : [print]), [view, print]);
  /* THE STOCK'S OWN LAST TRADE (audit round 4: "THE STOCK · QQQ $725.39" was a stale contingent cross; QQQ was $703.29) */
  const last = useStockLast(print.ticker).rows;
  const stockPx = last?.price ?? (view && view.spot > 0 ? view.spot : null);
  /* AFTER HOURS IS NOT A SIDE (the third audit, 2026-10-22: an after-hours tape wore "UNDER THE MID 64%" in red): where
     the crosses in view are all extended-hours prints, the split is drawn in plain ink */
  const allAfter = crosses.length > 0 && crosses.every(p => p.extended);
  /* THE SPLIT READS PRINTS PRICED AT THE QUOTE (audit round 4: QQQ's "UNDER 2% · OVER 98%" counted the no-read contingent
     prints at $725.39, 3% over the quote): own-terms prints are priced by their terms and are left out; so are after-hours
     prints beside regular ones */
  const placed = crosses.filter(p => !p.special && (allAfter || !p.extended));
  const underDol = placed.reduce((a, p) => a + (quotePlace(p.vsSpotPct, p.price).cents < 0 ? p.notional : 0), 0);
  const overDol = placed.reduce((a, p) => a + (quotePlace(p.vsSpotPct, p.price).cents > 0 ? p.notional : 0), 0);
  const midN = placed.filter(p => quotePlace(p.vsSpotPct, p.price).cents === 0).length;
  const leftOut = crosses.length - placed.length;
  const sided = underDol + overDol;
  const underPct = sided > 0 ? (underDol / sided) * 100 : 0;
  const hasDay = bars.length > 0;
  const extendedBars = bars.some(b => b.extended);

  useEffect(() => {
    const priceHost = priceRef.current;
    const darkHost = darkRef.current;
    if (!priceHost || !darkHost) return;
    const day = bars;
    if (day.length === 0) return;
    /* the price strip carries its own clock now — the cross is read against a time */
    const priceChart: IChartApi = createChart(priceHost, { ...dayChartOptions(cardSurface(priceHost, paper), { clock: true, logo: false }), autoSize: true });
    const darkChart: IChartApi = createChart(darkHost, { ...dayChartOptions(cardSurface(darkHost, paper), { clock: true, logo: false }), autoSize: true });
    const dropPrice = syncDayScale(priceChart, `cross-${print.ticker}`, 'price');
    const dropDark = syncDayScale(darkChart, `cross-${print.ticker}`, 'dark');
    const sInk = readToken('--text-primary', undefined, priceHost);
    const series = priceChart.addSeries(AreaSeries, {
      lineColor: sInk,
      topColor: readToken('--text-primary', paper ? 0.12 : 0.16, priceHost),
      bottomColor: readToken('--text-primary', 0.01, priceHost),
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });
    series.setData(day.map(c => ({ time: c.time as UTCTimestamp, value: c.close })));
    const ordered: { clock: string; time: number }[] = [];
    const atClock = new Map<string, number>();
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of day) {
      const clock = nyClock(c.time * 1000);
      atClock.set(clock, c.time);
      ordered.push({ clock, time: c.time });
      if (c.close < lo) lo = c.close;
      if (c.close > hi) hi = c.close;
    }
    const place = (hhmm: string): number => {
      const exact = atClock.get(hhmm);
      if (exact != null) return exact;
      let best = ordered[0]?.time ?? day[0].time;
      for (const o of ordered) if (o.clock <= hhmm) best = o.time;
      return best;
    };
    const pad = Math.max((hi - lo) * 0.15, print.price * 0.004);
    for (const l of view?.levels ?? []) {
      if (l.price < lo - pad || l.price > hi + pad) continue;
      series.createPriceLine({ price: l.price, color: readToken(ROLE_TOKEN[l.role], 0.75, priceHost), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: ROLE_WORD[l.role] });
    }
    series.createPriceLine({ price: print.price, color: readToken('--silver', 0.95, priceHost), lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: 'this cross' });
    const at = place(print.time);
    const added = new Map<number, number>();
    for (const p of crosses) {
      if (!p.time || p.time === '—') continue;
      const t = place(p.time);
      added.set(t, (added.get(t) ?? 0) + p.notional);
    }
    let cum = 0;
    const run = day.map(c => {
      cum += added.get(c.time) ?? 0;
      return { time: c.time as UTCTimestamp, value: cum };
    });
    const flow = darkChart.addSeries(AreaSeries, {
      lineColor: readToken('--text-primary', 0.9, darkHost),
      topColor: readToken('--text-primary', paper ? 0.1 : 0.14, darkHost),
      bottomColor: readToken('--text-primary', 0.01, darkHost),
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
      priceFormat: { type: 'custom', formatter: (v: number) => fmtUsd(Math.abs(v)), minMove: 1 },
    });
    flow.setData(run);
    createSeriesMarkers(flow, [{ time: at as UTCTimestamp, position: 'inBar', color: readToken('--silver', 1, darkHost), shape: 'circle' }]);
    let lock = false;
    const link = (from: IChartApi, to: IChartApi) => {
      from.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (!range || lock) return;
        lock = true;
        to.timeScale().setVisibleLogicalRange(range);
        lock = false;
      });
    };
    link(priceChart, darkChart);
    link(darkChart, priceChart);
    priceChart.timeScale().fitContent();
    return () => {
      dropPrice();
      dropDark();
      priceChart.remove();
      darkChart.remove();
    };
  }, [print, view, paper, bars, crosses]);

  return (
    <div className="border border-borderSubtle bg-inset rounded-md overflow-hidden" data-cross-tape={print.ticker}>
      <div className="px-3 py-2 border-b border-borderSubtle/60 flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[11px] uppercase tracking-widest text-textSecondary">The tape</span>
        <span className="font-mono text-[11px] text-textMuted">the stock and its {print.lit ? 'lit prints' : 'dark crosses'} on one clock · New York · {extendedBars ? 'pre-market and after hours included' : 'the regular session'}</span>
      </div>
      <div className="px-3 pt-2.5 pb-1">
        <div className="flex items-baseline gap-2.5 flex-wrap">
          <span className="font-mono text-[11px] uppercase tracking-widest text-textSecondary">The stock</span>
          <span className="font-mono text-[11px] text-textMuted tnum">
            <RichRead text={`${print.ticker}${stockPx ? ` $${stockPx.toFixed(2)}${last?.at ? ` (last trade ${nyClock(last.at)} ET)` : ''}` : ''}${view ? ` · ${fmtUsd(view.totalNotional)} dark · ${crosses.length} crosses in hand` : ''}`} />
          </span>
        </div>
        {sided > 0 ? (
          <div className="mt-2 flex flex-col gap-1 max-w-[460px]">
            <div className="flex items-baseline justify-between gap-3 font-mono text-[11px] uppercase tracking-wider">
              <span className={allAfter ? 'text-textSecondary' : underPct >= 50 ? 'text-bear font-semibold' : 'text-textSecondary'}>Under the mid {Math.round(underPct)}%</span>
              <span className="text-textMuted normal-case tracking-normal">{midN} at the mid{allAfter ? ' · after hours, no read' : ''}{leftOut ? ` · ${leftOut} own-terms or after-hours left out` : ''}</span>
              <span className={allAfter ? 'text-textSecondary' : underPct < 50 ? 'text-bull font-semibold' : 'text-textSecondary'}>Over the mid {100 - Math.round(underPct)}%</span>
            </div>
            <span className="flex h-1.5 rounded-full overflow-hidden bg-ink/[0.06]">
              <span className={`h-full ${allAfter ? 'bg-ink/30' : 'bg-bear/80'}`} style={{ width: `${underPct}%` }} />
              <span className={`h-full ${allAfter ? 'bg-ink/50' : 'bg-bull'}`} style={{ width: `${100 - underPct}%` }} />
            </span>
          </div>
        ) : (
          <p className="mt-2 font-mono text-[11px] text-textMuted">{placed.length ? 'Every cross priced at the quote printed at the mid.' : 'No cross in view is priced at the quote — nothing to split.'}</p>
        )}
        {hasDay ? <div ref={priceRef} className="h-[220px] w-full" data-cross-price /> : <div className="h-[120px] flex items-center justify-center font-mono text-[11px] uppercase tracking-widest text-textMuted">No session bars for {print.ticker} yet</div>}
      </div>
      {hasDay && (
        <>
          <div className="mx-3 my-1.5 h-px bg-borderSubtle/60" />
          <div className="px-3 pt-1 pb-2.5">
            <div className="flex items-baseline gap-2.5 flex-wrap">
              <span className="font-mono text-[11px] uppercase tracking-widest text-textSecondary">Dark dollars</span>
              <span className="font-mono text-[11px] text-textMuted">running off-exchange dollars · this cross marked</span>
            </div>
            <div ref={darkRef} className="h-[210px] w-full" />
          </div>
        </>
      )}
      <div className="px-3 pb-2.5 flex items-center gap-3 flex-wrap">
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-textSecondary"><span className="w-3 h-[2px] bg-textPrimary" /> Running dark dollars · prints in hand</span>
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-textSecondary"><span className="w-3 h-[2px] bg-silver" /> This cross</span>
      </div>
    </div>
  );
};

const CrossSequence = ({ print, sequence, onOpen }: { print: DarkPoolPrint; sequence: DarkPoolPrint[]; onOpen?: (p: DarkPoolPrint) => void }) => {
  const n = sequence.length;
  const read = useMemo(() => {
    if (n <= 1) return `The only cross on ${print.ticker} among the prints in hand.`;
    const total = sequence.reduce((a, p) => a + p.notional, 0);
    const bought = sequence.filter(p => !p.special && p.exec === 'ASK').length;
    const sold = sequence.filter(p => !p.special && p.exec === 'BID').length;
    const mid = sequence.filter(p => !p.special && p.exec === 'MID').length;
    const own = sequence.filter(p => p.special).length;
    const oldest = sequence[n - 1]?.time ?? print.time;
    const newest = sequence[0]?.time ?? print.time;
    return `${n} crosses on ${print.ticker} among the prints in hand · ${fmtUsd(total)} total · ${bought} paid the offer / ${sold} hit the bid${mid ? ` / ${mid} inside the quote` : ''}${own ? ` / ${own} own terms` : ''} · ${oldest} → ${newest}.`;
  }, [sequence, n, print.ticker, print.time]);
  const shown = sequence.slice(0, SEQ_SHOWN);
  return (
    <div className="border border-borderSubtle bg-inset rounded-md overflow-hidden" data-cross-sequence>
      <div className="px-3 py-2 border-b border-borderSubtle/60 flex items-baseline gap-2 flex-wrap">
        <span className="font-mono text-[11px] uppercase tracking-widest text-textSecondary">The sequence</span>
        <span className="font-mono text-[11px] text-textMuted">{print.ticker}'s crosses among the prints in hand — not the whole day</span>
      </div>
      <p className="px-3 pt-2 text-[11px] text-textSecondary leading-snug tnum">
        <RichRead text={read} />
      </p>
      {n > 1 && (
        <div className="px-1.5 py-1.5 flex flex-col">
          {shown.map(p => {
            const self = p.id === print.id;
            const ink = p.exec === 'ASK' || p.exec === 'BID' ? 'text-textPrimary' : 'text-textMuted';
            const row = (
              <>
                <span className="w-[86px] shrink-0 font-mono text-[11px] tnum text-textMuted">{p.time}</span>
                <span className={`w-[88px] shrink-0 font-mono text-[11px] font-semibold uppercase tracking-wider ${ink}`}>{sideWord(p)}</span>
                <span className="font-mono text-[11px] tnum text-textSecondary">{num(p.size)} × ${p.price.toFixed(2)}</span>
                <span className="font-mono text-[11px] font-bold tnum text-textPrimary">{fmtUsd(p.notional)}</span>
                {p.sized && <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-textPrimary">Sized</span>}
                {self && <span className="ml-auto font-mono text-[11px] font-semibold uppercase tracking-wider text-silver">Viewing</span>}
              </>
            );
            return self || !onOpen ? (
              <div key={p.id} className={`flex items-baseline gap-2.5 px-1.5 py-1 rounded ${self ? 'bg-silver/[0.05] shadow-[inset_2px_0_0_0_rgb(var(--silver)/0.7)]' : ''}`}>{row}</div>
            ) : (
              <button key={p.id} type="button" onClick={() => onOpen(p)} title="Open this cross" className="flex items-baseline gap-2.5 px-1.5 py-1 rounded text-left hover:bg-ink/[0.04] transition-colors">{row}</button>
            );
          })}
          {n > SEQ_SHOWN && <span className="px-1.5 py-1 font-mono text-[11px] text-textMuted tnum">…and {n - SEQ_SHOWN} more on the tape</span>}
        </div>
      )}
    </div>
  );
};

interface CrossDrilldownProps {
  print: DarkPoolPrint | null;
  view: DarkPoolView | null;
  onClose: () => void;
  onStep?: (dir: -1 | 1) => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  onOpen?: (p: DarkPoolPrint) => void;
}

const th = 'px-2 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-widest text-textMuted border-b border-borderSubtle';
const td = 'px-2 py-1.5 font-mono text-[11px] tnum';
const linkBtn =
  'inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded border border-borderSubtle bg-ink/[0.02] font-mono text-[11px] uppercase tracking-wider text-textSecondary hover:text-textPrimary hover:border-borderMuted transition-colors';

const CrossDrilldown = ({ print, view, onClose, onStep, hasPrev = false, hasNext = false, onOpen }: CrossDrilldownProps) => {
  const navigate = useNavigate();
  const { isWatched, toggle } = useWatch();
  const [copied, setCopied] = useState(false);
  const key = print ? crossKey(print) : '';
  const marked = !!print && isWatched(key);
  const shelf = useMemo(() => (print ? shelfOf(print, view) : null), [print, view]);
  const sequence = useMemo(() => (view ? [...view.prints].sort((a, b) => (a.time === b.time ? b.notional - a.notional : a.time < b.time ? 1 : -1)) : []), [view]);
  /* the cross's own session's figures, named by its date (audit round 6) */
  const crossIso = print ? crossIsoOf(print) : null;
  const day = useDarkDay(print?.ticker ?? null, crossIso);
  const frac = print ? fillFrac(print) : null;
  const jump = (fn: () => void) => {
    onClose();
    fn();
  };
  const copySummary = () => {
    if (!print) return;
    const txt = `${print.ticker} dark cross ${fmtUsd(print.notional)} · ${num(print.size)} @ $${print.price.toFixed(2)} · ${print.time} · ${print.read}`;
    navigator.clipboard?.writeText(txt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  return (
    <Modal
      open={!!print}
      onClose={onClose}
      widthClass="max-w-[1680px]"
      ariaLabel={print ? `${print.ticker} dark pool cross at ${print.time}` : 'dark pool cross'}
      header={
        print && (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-2 pr-3 border-r border-borderSubtle shrink-0" role="img" aria-label="Slayer Terminal" data-print-masthead>
              <SlayerMark size={18} bare label="" />
              <Wordmark height={11} label="" />
            </span>
            <span className="inline-flex items-center rounded-full border border-borderMuted bg-ink/[0.04] px-2.5 py-0.5 font-mono text-[13px] font-semibold text-textPrimary">{print.ticker}</span>
            <span className="font-mono text-[11px] text-textSecondary tnum">{print.lit ? `lit print · ${print.venue}` : `cross · reported to ${print.facility ?? venueWord(print.venue)}`}</span>
            {print.sized && !print.extended && !print.special ? <IntentTag intent={print.intent} /> : <span className="font-mono text-[11px] uppercase text-textMuted">{noReadWord(print)}</span>}
            <span className="font-mono text-[11px] text-textSecondary tnum">{print.time}</span>
            {print.sized && <span className="font-mono text-[11px] uppercase font-semibold text-textPrimary">Sized</span>}
          </div>
        )
      }
      headerActions={
        print && (
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={() => toggle(watchedCross(print, view && view.spot > 0 ? view.spot : print.price, 'dark-pool'))}
              aria-pressed={marked}
              title={marked ? 'Tracking this cross' : 'Track this cross'}
              className={`p-1 rounded transition-colors ${marked ? 'text-select' : 'text-textMuted hover:text-textPrimary hover:bg-ink/[0.05]'}`}
              data-cross-mark={marked || undefined}
            >
              <Bookmark className="w-3.5 h-3.5" fill={marked ? 'currentColor' : 'none'} />
            </button>
            <button onClick={copySummary} title="Copy a one-line summary of this cross" className={`p-1 rounded transition-colors ${copied ? 'text-select' : 'text-textMuted hover:text-textPrimary hover:bg-ink/[0.05]'}`}>
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <span className="w-px h-3.5 bg-borderSubtle mx-0.5" />
            <button onClick={() => onStep?.(-1)} disabled={!hasPrev} title="Previous cross (↑)" className="p-1 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.05] disabled:opacity-25 transition-colors" data-cross-prev>
              <ChevronUp className="w-4 h-4" />
            </button>
            <button onClick={() => onStep?.(1)} disabled={!hasNext} title="Next cross (↓)" className="p-1 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.05] disabled:opacity-25 transition-colors" data-cross-next>
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
        )
      }
    >
      {print && (
        <>
          <div className="flex flex-col border border-borderSubtle rounded-md bg-inset overflow-hidden" data-cross-card={key} data-print-head>
            <div className="flex items-center gap-x-5 gap-y-2 flex-wrap px-4 py-3" data-print-money>
              <span className="flex items-baseline gap-2.5">
                <span className={`font-mono text-[22px] font-bold tnum leading-none ${print.notional >= 1_000_000 ? 'text-supreme' : 'text-textPrimary'}`}>{fmtUsd(print.notional)}</span>
                {sideLabel(print) && <span className={`font-mono text-[13px] font-bold ${print.exec === 'MID' ? 'text-textMuted' : 'text-textPrimary'}`}>{sideLabel(print)}</span>}
                {print.sized && <span className="font-mono text-[11px] uppercase font-semibold text-textPrimary">Sized</span>}
              </span>
              {frac != null && (
                <span className="flex items-center gap-2 w-[220px] max-w-full" title="Where between the bid and the ask it filled">
                  <span className="font-mono text-[11px] tnum text-textMuted">{print.bid != null ? print.bid.toFixed(2) : 'bid'}</span>
                  <span className="relative flex-1 h-[3px] rounded-full bg-ink/[0.08]">
                    <span className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[8px] h-[8px] rounded-full ${print.exec === 'MID' ? 'bg-ink/60' : 'bg-textPrimary'}`} style={{ left: `${frac * 100}%` }} />
                  </span>
                  <span className="font-mono text-[11px] tnum text-textMuted">{print.ask != null ? print.ask.toFixed(2) : 'ask'}</span>
                </span>
              )}
              <span className="font-mono text-[11px] text-textSecondary tnum whitespace-nowrap">
                <RichRead text={`${num(print.size)} shares @ $${print.price.toFixed(2)} · ${print.time}`} />
              </span>
            </div>
            <p className="px-4 py-2.5 border-t border-borderSubtle/60 text-[12px] leading-relaxed text-textSecondary" data-cross-read>
              <RichRead text={print.read} />
            </p>
            <div className="px-4 pt-2.5 pb-3 border-t border-borderSubtle/60 grid gap-x-8 gap-y-1.5 md:grid-cols-2 xl:grid-cols-3" data-cross-facts>
              <Fact label="Vs the quote" value={`${quotePlace(print.vsSpotPct, print.price).text}${print.extended ? ' · after hours' : ''}`} valueCls={quotePlace(print.vsSpotPct, print.price).cents === 0 || print.extended ? 'text-textMuted' : quotePlace(print.vsSpotPct, print.price).cents > 0 ? 'text-bull' : 'text-bear'} />
              <Fact label={print.lit ? 'Printed on' : 'Reported to'} value={print.lit ? print.venue : print.facility ?? venueWord(print.venue)} />
              {print.special && <Fact label="Trade kind" value={print.special} valueCls="text-warn" />}
              <Fact label="Shelf" value={shelf ? <span className={ROLE_INK[shelf.role]}>${shelf.price.toFixed(2)} · {ROLE_WORD[shelf.role]} · {shelf.sharePct.toFixed(0)}% of the day's dark dollars</span> : <span className="text-textMuted">between shelves</span>} />
              <Fact
                label={`${print.ticker}, prints in hand`}
                value={
                  view ? (
                    (() => {
                      /* the posture is computed here from the prints, by the SidesRule (postureOf) — never a view's stored
                         field (audit round 5: USHY read Balanced beside 70/30) */
                      const pv = postureOf(view.prints);
                      return pv.read === 0 ? (
                        <span className="text-textMuted" title="No sized regular-session cross at the quote — nothing to read">nothing to read</span>
                      ) : (
                        <span className={pv.posture === 'ACCUMULATING' ? 'text-bull' : pv.posture === 'DISTRIBUTING' ? 'text-bear' : 'text-textSecondary'} title={`Net ${pv.net > 0 ? '+' : pv.net < 0 ? '−' : ''}${Math.abs(pv.net)}% of the sized dollars over the mid less under it, across ${pv.read} sized cross${pv.read === 1 ? '' : 'es'} in hand. ${pv.note}`}>
                          {POSTURE_WORD[pv.posture]}
                          {pv.posture !== 'BALANCED' ? ` · ${gradeOfPosture(pv.net)}` : ''}
                        </span>
                      );
                    })()
                  ) : '—'
                }
              />
              {/* THE DAY IS THE NAME'S OWN DAY (the audit, 2026-10-22: "Dark dollars today" was the buffer's few prints) —
                  /darkpool/{t}/price-levels, every dark and lit share by price */}
              <Fact label={`Off-exchange ${dayAdv(crossIso ?? undefined)}`} value={day.rows && Number.isFinite(day.rows.sharePct) ? `${day.rows.sharePct.toFixed(0)}% of the day's shares` : day.waiting ? '…' : '—'} />
              <Fact label={`Dark dollars ${dayAdv(crossIso ?? undefined)}`} value={day.rows ? `≈${fmtUsd(day.rows.darkDollars)} · ${num(day.rows.darkShares)} sh${day.rows.offShares > 0 ? ` · ≈${fmtUsd(day.rows.offDollars)} own terms apart` : ''}` : day.waiting ? '…' : '—'} />
              <Fact label="Crosses in hand" value={view ? `${view.prints.length} · ${view.prints.filter(p => p.sized).length} sized` : '—'} />
              <Fact label="This cross" value={print.sized ? 'Sized' : 'Ordinary'} valueCls={print.sized ? 'text-textPrimary' : 'text-textMuted'} />
            </div>
          </div>

          <CrossSequence print={print} sequence={sequence} onOpen={onOpen} />
          <CrossTape print={print} view={view} />

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-mono text-[11px] uppercase tracking-widest text-textSecondary">The crosses</span>
              <span className="font-mono text-[11px] uppercase tracking-wider text-textMuted">{sequence.length} in hand{sequence.length ? ` · ${sequence[sequence.length - 1].time}–${sequence[0].time} ET` : ''}</span>
            </div>
            <div className="border border-borderSubtle bg-inset rounded-md overflow-hidden max-h-[240px] overflow-y-auto" data-cross-orders>
              <table className="w-full border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-inset">
                    <th className={`${th} text-left`}>Time</th>
                    <th className={`${th} text-right`}>Price</th>
                    <th className={`${th} text-right`}>Shares</th>
                    <th className={`${th} text-right`}>Dollars</th>
                    <th className={`${th} text-left`}>Who</th>
                    <th className={`${th} text-right`}>Vs quote</th>
                    <th className={`${th} text-left`}>Read</th>
                  </tr>
                </thead>
                <tbody>
                  {sequence.map(p => {
                    const here = p.id === print.id;
                    const place = quotePlace(p.vsSpotPct, p.price);
                    return (
                      <tr
                        key={p.id}
                        onClick={() => onOpen?.(p)}
                        aria-current={here || undefined}
                        className={`border-b border-borderSubtle/30 last:border-0 cursor-pointer hover:bg-ink/[0.02] ${here ? 'shadow-[inset_2px_0_0_0_rgb(var(--silver)/0.7)]' : ''}`}
                        data-cross-seq={p.id}
                      >
                        <td className={`${td} text-textPrimary`}>
                          {p.time}
                          {here && <span className="ml-1.5 text-silver">this cross</span>}
                        </td>
                        <td className={`${td} text-right text-textPrimary`}>${p.price.toFixed(2)}</td>
                        <td className={`${td} text-right text-textPrimary`}>{num(p.size)}</td>
                        <td className={`${td} text-right ${p.notional >= 1_000_000 ? 'text-textPrimary font-semibold' : 'text-textPrimary'}`}>{fmtUsd(p.notional)}</td>
                        <td className={`${td} ${p.exec === 'MID' || !p.exec || p.extended ? 'text-textMuted' : 'text-textPrimary'}`}>{sideWord(p)}</td>
                        <td className={`${td} text-right ${p.extended ? 'text-textSecondary' : place.cents > 0 ? 'text-bull' : place.cents < 0 ? 'text-bear' : 'text-textMuted'}`}>{place.text}</td>
                        <td className={td}>{p.sized && !p.extended && !p.special ? <IntentTag intent={p.intent} /> : <span className="text-textMuted uppercase text-[10px]">{noReadWord(p)}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-[11px] uppercase tracking-widest text-textSecondary mr-1">Open in</span>
            <button type="button" onClick={() => jump(() => navigate('/pinpoint', { state: { ticker: print.ticker } }))} className={linkBtn}>
              <Crosshair className="w-3.5 h-3.5" /> Dealer map
            </button>
            <button
              type="button"
              onClick={() => jump(() => navigate('/terrain', { state: { chart: { ticker: print.ticker, focus: shelf?.price ?? print.price }, wayBack: '/trace/dark-pool' } }))}
              className={linkBtn}
              data-cross-chart
            >
              <Crosshair className="w-3.5 h-3.5" /> Chart
            </button>
            <button type="button" onClick={() => jump(() => navigate('/weigher', { state: { ticker: print.ticker } }))} className={linkBtn} data-cross-weigh>
              <Scale className="w-3.5 h-3.5" /> Weigh it
            </button>
            <button
              type="button"
              onClick={() => toggle(watchedCross(print, view && view.spot > 0 ? view.spot : print.price, 'dark-pool'))}
              aria-pressed={marked}
              className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded border font-mono text-[11px] uppercase tracking-wider transition-colors ${
                marked ? 'border-select/40 bg-select/[0.08] text-select' : 'border-borderSubtle bg-ink/[0.02] text-textSecondary hover:text-textPrimary hover:border-borderMuted'
              }`}
            >
              <Bookmark className="w-3.5 h-3.5" fill={marked ? 'currentColor' : 'none'} />
              {marked ? 'Tracking' : 'Track cross'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
};

export default CrossDrilldown;
