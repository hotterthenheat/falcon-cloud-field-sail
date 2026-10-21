/*
==================================================
  SLAYER TERMINAL - NET FLOW PANE (Trace)
  One lens on the same-day money: cumulative net
  call premium (bull) against net put premium
  (bear), with the underlying's price as a quiet
  ribbon behind them and volume as a ridge along
  the floor. The 0DTE desk mounts one to four of
  these, Terrain-style.

  THE MONEY IS THE SUBJECT (Noah, 2026-08-30, from
  a progressive-line reference he liked "way more"
  than what we had). Everything here follows from
  that one ranking: the two figures the page is
  named for are crisp unfilled LINES; the price is
  dimmed AND amplitude-capped so the noisiest
  series stops out-shouting them; the floor is one
  neutral ink, because "how much" is its whole job.
  Nothing is filled edge-to-edge — an area fills to
  its scale's floor, which is how the old gradient
  washes came to flood the entire pane.

  House chart laws apply: no grid, one translucent
  strip, freeze-on-first-touch on BOTH price
  scales, reset via pill / right-click / Alt+R /
  double-click.
==================================================
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Maximize2, Minimize2 } from 'lucide-react';
import {
  createChart,
  HistogramSeries,
  LineSeries,
  LineType,
  type IChartApi,
  type ISeriesApi,
  type LineWidth,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
  LineStyle,
} from 'lightweight-charts';
import { bookCandles, dayBars, ensureBook, useBookRev } from '../../data/uwBook';
import { bookSession } from '../../data/flowBook';
import { nyClock, nyTickMarks, nyTimeFormatter, SESSION_OPEN_MIN } from '../../core/nyTime';
import { getResolvedTheme, readToken, useColourVision, useResolvedTheme } from '../../theme/theme';
import { earnMarks, weightInk, type InkMarks } from './earnedInk';
import ResetViewControl from '../gex/ResetViewControl';
import DropdownSelect, { type DropdownOption } from '../ui/DropdownSelect';
import {
  buildNetFlowView,
  MONEYNESS,
  NET_SEGMENTS,
  segmentLabel,
  type MoneynessKey,
  type NetFlowSegment,
} from '../../data/flowBook';
import { fmtUsd } from '../../data/gex';
import { SLEEVES, type SleeveKey } from '../../types/compass';
import CompanyLogo from '../ui/CompanyLogo';
import { roomBelow } from '../ui/menuRoom';
import FlowSearch, { type SearchDoor } from './FlowSearch';
import { SectorMark } from './SectorMark';
import type { BookContract } from '../../types/trace';

/* The pane's two cuts as cards (the walk, 2026-09-09): which strikes, and how far out */
/* "Moneyness" and "Tenor", each "Any" at rest (the partner's words, at Noah's word 2026-10-13) */
export const MONEY_OPTIONS: DropdownOption<MoneynessKey>[] = MONEYNESS.map(m => ({ value: m.key, label: m.label === 'All strikes' ? 'Any' : m.label, hint: m.hint }));
export const CLOCK_OPTIONS: DropdownOption<SleeveKey | 'all'>[] = [
  { value: 'all', label: 'Any', hint: 'Every tenor on the book' },
  ...SLEEVES.map(sl => ({ value: sl.key, label: sl.label, hint: sl.blurb })),
];

/** THE SPOT LINE IS WHITE, ALWAYS (Noah, 2026-08-30: "i want the middle line
    to be white at all times and have an even thicker white as the hover
    color"). It used to rest at a whisper and dim further when another line
    was picked; now it holds full white at 1px and answers a hover by getting
    heavier, never by changing colour. */
/* Hover emphasis (Noah, 2026-08-30): the picked money line steps forward, the
   other steps back — resting colours at a third of their voice, still
   legible, unmistakably not the subject. The spot line never dims. */
/** VOLUME WEARS THE INK CODE (Noah, 2026-08-30: "the volume legit has no way
    of being measured or quantified. i want the same thing we got going on for
    our ink code to be placed within our volume bars"). Three registers, the
    tables' own law: the bulk of bars rest quiet in the secondary ink, the
    loud quintile brightens, and the single biggest bar on screen wears the
    champion magenta. Grey on purpose, never bull/bear — the floor says
    how much, the two lines above already say which way. */

/* THE PANE FOLLOWS THE PAGE, AND ONLY THE PAGE (the light sweep, 2026-09-19). On the dark terminal it is the black island
   it always was, inks untouched — whatever candle theme is picked: for an hour that night it followed the candle store,
   and Noah's dark page, holding a Stone pick, turned its charts grey ("the changes you are making to the light theme seem
   to be bleeding into the dark theme… should not be the case at all"). A light-theme change is never allowed to move the
   dark theme. On the LIGHT page it is part of the page: the soft inset grey, ONE grey with no second grey inside it ("i
   see a light gray holding a inner dark gray. make it all light gray"), the page's own inks — the price line is the
   neutral ink at full voice (his "white, always" on black; near-black on paper), the pair the page's green and red. */
interface PaneInks { spot: string; calls: string; puts: string; callsDim: string; putsDim: string; volQuiet: string; volLoud: string; volTop: string; axis: string; cross: string; label: string }
/* EVERY INK A TOKEN (2026-10-13, the partner's rule at Noah's word — two hand-written sets, one a theme, lived here):
   the spot is the primary ink, the pair the page's green and red, the volume floor the secondary ink at two
   strengths with the champion magenta, the axis the muted ink, the crosshair the ink at a quarter — read off the
   page's own tokens (theme.ts readToken, cached until the theme turns), so paper and the dark terminal each answer
   with their own set and the colour-vision pair reaches the pane too. */
const paneInks = (): PaneInks => ({
  spot: readToken('--text-primary'),
  calls: readToken('--bull'),
  puts: readToken('--bear'),
  callsDim: readToken('--bull', 0.3),
  putsDim: readToken('--bear', 0.3),
  volQuiet: readToken('--text-secondary', 0.3),
  volLoud: readToken('--text-secondary', 0.9),
  volTop: readToken('--supreme'),
  axis: readToken('--text-muted'),
  cross: readToken('--ink', 0.25),
  label: readToken('--border-muted'),
});
/** The plot's ground: the page's inset on paper (read off the box, which wears the page's tokens there), the panel showing through on the dark terminal */
const paneGround = (host: Element | null): string => (getResolvedTheme() === 'light' ? readToken('--inset', undefined, host) : 'transparent');
const volInk = (v: number, m: InkMarks, k: PaneInks) => (v >= m.top ? k.volTop : v >= m.bar ? k.volLoud : k.volQuiet);
const TIP_VOL_BASE = 'ml-auto font-mono text-[11px] tnum';

/** Today's bars for the pane's reference name — falls back to the last 240
    when the session is young, so the pane never opens empty. */
/** THE SESSION'S MINUTES, ONE A POINT (the partner's pane, at Noah's word 2026-10-13): 09:30 New York to the book's
    minute — now, or the close — whatever bars the simulator holds. The money lines are the book's at each minute, so
    the pane always spans the session and its volume bars are hairlines, not blocks; the spot line is laid over the same
    minutes (see the draw). It drew only the candles that fell inside the session before — a stretch of an hour or two
    — and after the close a dead-flat tail. */
export function paneTimes(_ref?: string): number[] {
  const s = bookSession();
  const first = Math.floor(s.open / 1000);
  const n = Math.max(1, s.minute - SESSION_OPEN_MIN + 1);
  return Array.from({ length: n }, (_, i) => first + i * 60);
}

const SegPick = ({ seg, onSeg }: { seg: NetFlowSegment; onSeg: (s: NetFlowSegment) => void }) => {
  const [open, setOpen] = useState(false);
  /* The room the pane leaves below the pill — the menu scrolls inside it
     rather than being sliced at the pane's floor (see ui/menuRoom). */
  const [menuMax, setMenuMax] = useState<number>();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const toggle = () => {
    setMenuMax(roomBelow(wrapRef.current));
    setOpen(o => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const label = segmentLabel(seg);
  const groups = ['The book', 'Sectors'] as const;
  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        onClick={toggle}
        title="Which cut of the book this pane watches — by family, or by sector"
        className="inline-flex items-center gap-1 h-6 px-2 rounded-xs border border-borderSubtle bg-chip hover:bg-ink/[0.06] font-mono text-[11px] font-bold text-textPrimary transition-colors"
      >
        {label}
        <ChevronDown className={`w-3 h-3 text-textSecondary transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        /* Two groups, the way the cut is two kinds of thing (see NET_SEGMENTS):
           the book by family, then the book by sector — each sector with its
           glyph, the Screener's own mark, so the shapes carry across pages. */
        <div
          style={{ maxHeight: menuMax }}
          className="absolute left-0 top-full mt-1 z-[70] w-[196px] overflow-y-auto overscroll-contain border border-borderMuted bg-panel rounded-xs shadow-2xl shadow-black/60 p-1 animate-slide-in"
        >
          {groups.map((g, gi) => (
            <div key={g} className={gi > 0 ? 'mt-1 pt-1 border-t border-borderSubtle' : ''}>
              <div className="px-2 pt-1 pb-0.5 font-mono text-[11px] font-bold uppercase tracking-widest text-textMuted">{g}</div>
              {NET_SEGMENTS.filter(s => s.group === g).map(s => (
                <button
                  key={s.key}
                  onClick={() => {
                    setOpen(false);
                    onSeg(s.key);
                  }}
                  className={`w-full flex items-center gap-2 text-left px-2 py-1 rounded font-mono text-[11px] transition-colors ${
                    s.key === seg ? 'bg-ink/[0.06] text-textPrimary font-bold' : 'text-textSecondary hover:bg-ink/[0.04]'
                  }`}
                >
                  {s.group === 'Sectors' && <SectorMark sector={s.label} />}
                  {s.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

interface NetFlowPaneProps {
  book: BookContract[];
  seg: NetFlowSegment;
  mny: MoneynessKey;
  onSeg: (s: NetFlowSegment) => void;
  onMny: (m: MoneynessKey) => void;
  /** Changes every simulator tick */
  tick: unknown;
  onExpand?: () => void;
  expanded?: boolean;
  /** TICKER MODE (the Net Flow page, and a 0DTE pane with a name picked):
      one name across the cut — the spot line is the name's OWN candles, the
      cut picker hides, and (Net Flow only) a tenor cut joins moneyness. */
  ticker?: string;
  /** THE NAME SEARCH (Noah, 2026-09-03: "shouldn't they be giving the user
      the ability to search any single name?"). Given, the head carries a
      names-only search over the pane's own book: a pick puts that name on
      the pane (ticker mode), clearing it hands the pane back to its cut. */
  onTicker?: (t: string | null) => void;
  /** Which names the search may offer (the 0DTE desk: the index complex). */
  searchNames?: (ticker: string) => boolean;
  /** The search menu's way out to the page that carries the other names. */
  searchDoor?: SearchDoor;
  tenor?: SleeveKey | 'all';
  onTenor?: (t: SleeveKey | 'all') => void;
  /** DTE ceiling for the cut — the 0DTE desk's default 1; ticker mode passes Infinity */
  dteMax?: number;
  /** Live tide points, epoch seconds. When set, the pane draws these and does not read the simulator. */
  live?: { time: number; callPrem: number; putPrem: number; vol: number; price: number }[] | null;
  /** The Money and Clock cards in the head — off when the host's own line carries the cut
      for more than one pane (Compare, 2026-09-13: two panes on ONE cut, one pair of cards) */
  cutCards?: boolean;
  /** A word after the cards' titles when the host's cut reaches more than this pane ("sets both panes") */
  sharedNote?: string;
}

const NetFlowPane = ({
  book,
  seg,
  mny,
  onSeg,
  onMny,
  tick,
  onExpand,
  expanded,
  ticker,
  onTicker,
  searchNames,
  searchDoor,
  tenor = 'all',
  onTenor,
  dteMax = 1,
  live = null,
  cutCards = true,
  sharedNote,
}: NetFlowPaneProps) => {
  /* the page's theme, and the inks cut for it (see paneInks) — read again when the page flips */
  const appTheme = useResolvedTheme();
  /* UNDER EITHER COLOUR-VISION CHOICE THE PUTS ARE DASHED (2026-10-13): the two lines never differ by ink alone — the
     calls solid, the puts dashed, their key's dot a ring (cvd-hollow) */
  const vision = useColourVision();
  const paper = appTheme === 'light';
  const inksNow = paneInks();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const spotRef = useRef<ISeriesApi<'Line'> | null>(null);
  const callRef = useRef<ISeriesApi<'Line'> | null>(null);
  const putRef = useRef<ISeriesApi<'Line'> | null>(null);
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const loadedRef = useRef<{ id: string; length: number }>({ id: '', length: 0 });
  /** The volume floor's ink marks (80th percentile, max) for what is on screen —
      the glide card inks its VOLUME figure from the same bars. */
  const volMarksRef = useRef<InkMarks>({ bar: Infinity, top: Infinity });

  // The glide card — written straight to the DOM per crosshair move; React
  // state per mousemove would re-render the whole pane for a tooltip.
  const tipRef = useRef<HTMLDivElement | null>(null);
  const tipTimeRef = useRef<HTMLSpanElement | null>(null);
  const tipSpotLabelRef = useRef<HTMLSpanElement | null>(null);
  const tipSpotRef = useRef<HTMLSpanElement | null>(null);
  const tipCallRef = useRef<HTMLSpanElement | null>(null);
  const tipPutRef = useRef<HTMLSpanElement | null>(null);
  const tipVolRef = useRef<HTMLSpanElement | null>(null);
  const refNameRef = useRef('SPY');
  /** The volume series' own points, for the glide card: when the crosshair
      lands between stamps the exact-time lookup misses, so the card falls back
      to the last value at or before the hovered minute. */
  const volChunksRef = useRef<{ time: number; value: number }[]>([]);

  /* The spot ribbon: the picked name's own tape, or SPY's under a cut of the book. */
  const ref = ticker ?? 'SPY';
  const bookRev = useBookRev();
  ensureBook(ref, 'board');
  const times = useMemo(() => paneTimes(ref), [ref, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const view = useMemo(
    () => buildNetFlowView(book, seg, mny, times, dteMax, ticker ?? null, tenor),
    [book, seg, mny, times, dteMax, ticker, tenor]
  );
  /* The names the search can offer: only those with contracts inside the
     pane's own DTE ceiling — a 0DTE pane lists same-day names alone. */
  const searchRows = useMemo(
    () => (onTicker ? book.filter(r => r.dte <= dteMax && (!searchNames || searchNames(r.ticker))) : []),
    [book, dteMax, onTicker, searchNames]
  );

  useEffect(() => {
    refNameRef.current = ref;
  }, [ref]);

  const resetView = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.priceScale('right').applyOptions({ autoScale: true });
    chart.priceScale('left').applyOptions({ autoScale: true });
    chart.timeScale().fitContent();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const k0 = paneInks();
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { color: paneGround(container) },
        textColor: k0.axis,
        fontFamily: "'Inter', sans-serif",
        fontSize: 10,
        attributionLogo: false,
      },
      // One session per pane, so the crosshair wears New York's bare clock — the market's day (core/nyTime); the date
      // is already in the header.
      localization: { timeFormatter: (t: Time) => (typeof t === 'number' ? nyClock(t * 1000) : nyTimeFormatter(t)) },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      /* Data as ink — no axis borders, the numbers float on the canvas.
         minimumWidth is load-bearing (Noah, 2026-08-30, the open-time hop):
         without it the plot mounts at the full pane width and SHRINKS ~100px
         one frame later, when the axes measure their labels and take their
         columns — every line redrawn narrower in front of the reader. The
         axes now own their width from the first frame ("540.00" left,
         "$47.5M" right), so the plot lays out once. */
      rightPriceScale: { borderVisible: false, minimumWidth: 60 },
      leftPriceScale: { visible: true, borderVisible: false, minimumWidth: 52 },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 3,
        tickMarkFormatter: nyTickMarks,
      },
      crosshair: {
        vertLine: { color: k0.cross, labelBackgroundColor: k0.label },
        horzLine: { color: k0.cross, labelBackgroundColor: k0.label },
      },
    });

    /* THE PRICE IS CONTEXT, NOT THE SUBJECT — but Noah wants it WHITE (2026-08-
       30). The earlier build dimmed it to a whisper because full white at
       high frequency out-shouted the money; the amplitude band (below) is what
       actually keeps it in its place now, so it can wear its true ink at 1px. */
    const spot = chart.addSeries(LineSeries, {
      priceScaleId: 'left',
      color: k0.spot,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    /* THE NET LINES ARE LINES (Noah, 2026-08-30: he showed a progressive-line
       reference and said he likes it "way more"). They were AREAS: a curved
       stroke over a gradient wash. Because an area fills from the line to the
       floor of its scale, a line sitting high flooded the ENTIRE pane green —
       the wash stopped being data and became background, and the stroke that
       carried the actual number was just its edge.
         Simple (not Curved) segments as well: the fine step-by-step shape IS
       the tape's texture, and curving smooths it into blobs. The axis speaks
       money, not raw digits — $85.8M, never 85819238.00. */
    const premFormat = { type: 'custom' as const, formatter: (v: number) => fmtUsd(v), minMove: 1 };
    const calls = chart.addSeries(LineSeries, {
      color: k0.calls,
      lineWidth: 2,
      lineType: LineType.Simple,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: premFormat,
    });
    const puts = chart.addSeries(LineSeries, {
      color: k0.puts,
      lineWidth: 2,
      lineType: LineType.Simple,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: premFormat,
    });
    /* VOLUME: BARS AGAIN, EACH WEARING ITS OWN INK (Noah, 2026-08-30). The
       first bars here were chunky five-minute blocks in bull/bear — a second
       chart coloured by a lean the lines above already told — and Noah killed
       them for a one-ink silhouette. The silhouette had the opposite problem:
       "the volume legit has no way of being measured or quantified." A ridge
       in one alpha cannot say which minute mattered.
         Two things changed underneath. The view now lands REAL PRINTS minute
       by minute (see flowBook), so the floor has genuine spikes to show instead
       of interpolated plateaus. And the ink code needs a colour PER BAR, which
       an area series cannot carry — a histogram can. Hairline bars, cool grey,
       and the three registers do the measuring: quiet, loud, one champion. */
    const vol = chart.addSeries(HistogramSeries, {
      priceScaleId: 'vol',
      color: k0.volQuiet,
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.87, bottom: 0 } });
    /* Room to breathe above and below — the reference's lines never touch an
       edge — and the money owns the full height. */
    /* 0.12 at the top: at 0.08 the right axis's highest label was clipped at the pane's head */
    chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.12, bottom: 0.2 } });
    /* THE PRICE GETS A BAND, NOT THE PANE. Left to autoscale across the whole
       height, a 3% intraday move becomes a full-height mountain range: the
       price line then carries more ink than both money lines together, purely
       because it is the noisiest series here. Dimming alone could not fix that
       — AMPLITUDE was the weight. Squeezed into a middle band it keeps every
       wiggle and its own axis, and reads as what it is: context. */
    chart.priceScale('left').applyOptions({ scaleMargins: { top: 0.4, bottom: 0.3 } });

    chartRef.current = chart;
    spotRef.current = spot;
    callRef.current = calls;
    putRef.current = puts;
    volRef.current = vol;

    // The frame belongs to the user — both scales freeze on first touch.
    const freezeScale = () => {
      chart.priceScale('right').applyOptions({ autoScale: false });
      chart.priceScale('left').applyOptions({ autoScale: false });
    };
    container.addEventListener('wheel', freezeScale, { passive: true });
    container.addEventListener('pointerdown', freezeScale);

    /* The glide card: all three dots in tune — the crosshair's time, and
       every line's value at that instant, riding beside the cursor. */
    const setInk = (el: HTMLElement, bull: boolean) => {
      el.classList.remove('text-bull', 'text-bear');
      el.classList.add(bull ? 'text-bull' : 'text-bear');
    };
    /* HOVER PICKS A LINE (Noah, 2026-08-30: "a hover over any of the lines
       should highlight that line a bit more than the other 2"). The line
       nearest the cursor — within reach — takes the ink: a touch wider, full
       voice, while the other two drop to a third of theirs. Drift away from
       all three and everything returns to rest. Options are applied only when
       the pick CHANGES, never per mousemove; the glide card bolds the same
       row, so the hand and the readout agree about what is being read. */
    type LinePick = 'spot' | 'calls' | 'puts' | null;
    let picked: LinePick = null;
    const REACH = 14; // px — close enough to mean the line, forgiving enough to be lazy
    const applyPick = (next: LinePick) => {
      if (next === picked) return;
      picked = next;
      const k = paneInks();
      calls.applyOptions({
        color: next === null || next === 'calls' ? k.calls : k.callsDim,
        lineWidth: (next === 'calls' ? 3 : 2) as LineWidth,
      });
      puts.applyOptions({
        color: next === null || next === 'puts' ? k.puts : k.putsDim,
        lineWidth: (next === 'puts' ? 3 : 2) as LineWidth,
      });
      // White at rest, heavier white under the hand — never a different colour.
      spot.applyOptions({ color: k.spot, lineWidth: (next === 'spot' ? 3 : 1) as LineWidth });
      (
        [
          ['spot', tipSpotRef.current],
          ['calls', tipCallRef.current],
          ['puts', tipPutRef.current],
        ] as [LinePick, HTMLElement | null][]
      ).forEach(([key, el]) => el?.classList.toggle('font-bold', key === next));
    };

    const onMove = (param: MouseEventParams) => {
      const card = tipRef.current;
      if (!card) return;
      if (!param.time || !param.point) {
        card.style.opacity = '0';
        applyPick(null);
        return;
      }
      if (tipTimeRef.current) tipTimeRef.current.textContent = typeof param.time === 'number' ? nyClock(param.time * 1000) : nyTimeFormatter(param.time);

      const val = (s: ISeriesApi<'Line'> | ISeriesApi<'Histogram'> | null) =>
        s ? (param.seriesData.get(s) as { value?: number } | undefined)?.value : undefined;
      const sp = val(spotRef.current);
      const c = val(callRef.current);
      const p = val(putRef.current);
      /* The volume figure comes from the view's own points, never the drawn
         series — the bars are drawn on a compressed height (see the data
         effect), and the card must say the true count. Last value at or
         before the hovered minute, so a crosshair between stamps still reads. */
      let v: number | undefined;
      {
        const t = param.time as number;
        const chunks = volChunksRef.current;
        for (let i = chunks.length - 1; i >= 0; i--) {
          if (chunks[i].time <= t) {
            v = chunks[i].value;
            break;
          }
        }
      }

      /* Which line is under the hand? Pixel distance from the cursor to each
         line's y at this bar — each series answers through its OWN price
         scale, which is exactly why this cannot be done with the raw values. */
      const y = param.point.y;
      const distTo = (srs: ISeriesApi<'Line'> | null, value: number | undefined) => {
        if (!srs || value == null) return Infinity;
        const coord = srs.priceToCoordinate(value);
        return coord == null ? Infinity : Math.abs(coord - y);
      };
      const nearest: [LinePick, number][] = [
        ['calls', distTo(callRef.current, c)],
        ['puts', distTo(putRef.current, p)],
        ['spot', distTo(spotRef.current, sp)],
      ];
      nearest.sort((a, b) => a[1] - b[1]);
      applyPick(nearest[0][1] <= REACH ? nearest[0][0] : null);

      if (tipSpotLabelRef.current) tipSpotLabelRef.current.textContent = refNameRef.current;
      if (tipSpotRef.current) tipSpotRef.current.textContent = sp != null ? `$${sp.toFixed(2)}` : '—';
      if (tipCallRef.current) {
        tipCallRef.current.textContent = c != null ? fmtUsd(c) : '—';
        if (c != null) setInk(tipCallRef.current, c >= 0);
      }
      if (tipPutRef.current) {
        tipPutRef.current.textContent = p != null ? fmtUsd(p) : '—';
        if (p != null) setInk(tipPutRef.current, p < 0); // puts bought = bearish ink
      }
      if (tipVolRef.current) {
        tipVolRef.current.textContent = v != null ? v.toLocaleString('en-US') : '—';
        // The figure wears the same register as its bar — quiet, loud, champion.
        tipVolRef.current.className = `${TIP_VOL_BASE} ${v != null ? weightInk(v, volMarksRef.current) : 'text-textSecondary'}`;
      }

      // PINNED, not chasing (Noah: "this card is blocking the view") — the
      // readout lives in the pane's quietest corner and updates as the
      // crosshair glides, so it never covers what the eye is reading.
      card.style.opacity = '1';
    };
    chart.subscribeCrosshairMove(onMove);

    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      container.removeEventListener('wheel', freezeScale);
      container.removeEventListener('pointerdown', freezeScale);
      chart.remove();
      chartRef.current = null;
      spotRef.current = null;
      callRef.current = null;
      putRef.current = null;
      volRef.current = null;
      loadedRef.current = { id: '', length: 0 };
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const spot = spotRef.current;
    const calls = callRef.current;
    const puts = putRef.current;
    const vol = volRef.current;
    if (!chart || !spot || !calls || !puts || !vol || (times.length === 0 && !(live && live.length))) return;

    const bars = live ? [] : (bookCandles(ref) ?? dayBars(ref) ?? []);
    const byTime = new Map<number, number>();
    for (const b of bars) byTime.set(b.time as number, b.close);

    const id = `${seg}-${mny}-${ref}-${tenor}-${dteMax}`;
    const loaded = loadedRef.current;
    let spotData = times.map(t => ({ time: t as UTCTimestamp, value: byTime.get(t) ?? 0 })).filter(p => p.value > 0);
    /* THE SIMULATOR'S CLOCK RUNS AHEAD OF THE WALL'S (~15×, one bar per four ticks), so its bars rarely sit on the
       session's minutes: its last session (SESSION_BARS of them, one simulated day) is laid over the session's minutes
       by index — bar k at 09:30 + k. Real one-minute bars land on the minutes themselves and take the first path. */
    if (spotData.length < times.length / 2 && bars.length > 0) {
      const tail = bars.slice(-390);
      const at = (i: number) => tail[Math.min(i, tail.length - 1)]?.close ?? 0;
      spotData = times.map((t, i) => ({ time: t as UTCTimestamp, value: at(i) })).filter(p => p.value > 0);
    }
    const drawn = live && live.length
      ? live.map(p => ({ time: p.time, callPrem: p.callPrem, putPrem: p.putPrem, vol: p.vol }))
      : view.points;
    const callData = drawn.map(p => ({ time: p.time as UTCTimestamp, value: p.callPrem }));
    const putData = drawn.map(p => ({ time: p.time as UTCTimestamp, value: p.putPrem }));
    if (live && live.length) {
      spotData = live.filter(p => p.price > 0).map(p => ({ time: p.time as UTCTimestamp, value: p.price }));
    }

    /* The volume floor — one bar per minute, each in its EARNED ink: the marks
       are measured over exactly the bars on screen, the tables' own rule.
       Rebuilt whole every pass; ~420 points. */
    const marks = earnMarks(drawn, p => p.vol);
    volMarksRef.current = marks;
    /* DRAWN ON A SQUARE-ROOT HEIGHT. Real print volume is heavy-tailed — the
       loudest minute on a name can be 40× its median — and a linear floor 13%
       of the pane tall renders the median bar at a pixel and the rest as air.
       Root-compressed, the quiet bars stay readable and the champion still
       towers; the INK carries the exact ranking (marks are measured on the
       true counts) and the glide card says the true number. The height is a
       drawing, the colour and the figure are the facts. */
    const inks = paneInks();
    vol.setData(drawn.map(p => ({ time: p.time as UTCTimestamp, value: Math.sqrt(Math.abs(p.vol)), color: volInk(Math.abs(p.vol), marks, inks) })));
    /* Every bar carries its own value, so the glide card's old containing-
       chunk search has nothing left to search for — it keeps the same shape
       purely as the lookup's fallback path. */
    volChunksRef.current = drawn.map(p => ({ time: p.time, value: p.vol }));

    /* WHOLE SERIES, EVERY PASS (Noah, 2026-08-30: "do they even match their
       cards"). The old fast path updated only the LAST point between full
       loads — but the curve is a share of the book's running total, so when
       the total moves every earlier point moves with it. Refreshing one point
       left the history drawn against a stale total: a visible hook at the
       right edge, and a line that no longer ended where its card said. Three
       setData calls of ~420 points are nothing; a lying line is not. */
    spot.setData(spotData);
    calls.setData(callData);
    puts.setData(putData);
    if (loaded.id !== id) {
      chart.priceScale('right').applyOptions({ autoScale: true });
      chart.priceScale('left').applyOptions({ autoScale: true });
      chart.timeScale().fitContent();
    }
    loadedRef.current = { id, length: drawn.length };
  }, [view, times, seg, mny, ref, tenor, dteMax, appTheme, live, bookRev]);

  /* THE PAGE FLIPPED: the chart that is up is re-inked in place */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const k = paneInks();
    chart.applyOptions({
      layout: { background: { color: paneGround(containerRef.current) }, textColor: k.axis },
      crosshair: { vertLine: { color: k.cross, labelBackgroundColor: k.label }, horzLine: { color: k.cross, labelBackgroundColor: k.label } },
    });
    spotRef.current?.applyOptions({ color: k.spot });
    callRef.current?.applyOptions({ color: k.calls });
    putRef.current?.applyOptions({ color: k.puts, lineStyle: vision === 'standard' ? LineStyle.Solid : LineStyle.Dashed });
  }, [appTheme, vision]);

  /* data-menu-clip: this box clips its overflow, so the menus in its head
     size themselves to the room it leaves (ui/menuRoom). */
  return (
    <div data-menu-clip data-theme={paper ? 'light' : 'dark'} className={`border border-borderSubtle rounded-xs overflow-hidden flex flex-col h-full ${paper ? 'bg-inset' : 'bg-panel'}`}>
      {/* min-h, not h (the Weigher's card-head law, 2026-09-03): a 2×2 pane
          at a laptop width cannot seat the cut, the search, four chips and
          three figures on one 32px line — the strip WRAPS and grows rather
          than clipping the figures off its right edge. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-1 min-h-8 shrink-0 select-none">
        {ticker ? (
          <span className="flex items-center gap-1.5 shrink-0">
            <CompanyLogo ticker={ticker} size={16} />
            {/* With a search in the head, the field already holds the name —
                the mark alone stands beside it; the label would say it twice. */}
            {!onTicker && <span className="font-mono text-[11px] font-bold text-textPrimary">{ticker}</span>}
          </span>
        ) : (
          <SegPick seg={seg} onSeg={onSeg} />
        )}
        {/* The two controls are two questions: the cut asks WHICH PART of the
            book, the search asks WHICH NAME. A picked name replaces the cut
            (its field stays, holding the name, its × the way back). */}
        {onTicker && (
          <FlowSearch
            value={ticker ?? ''}
            onChange={v => onTicker(v ? v : null)}
            rows={searchRows}
            countNoun="contracts"
            tickersOnly
            compact
            door={searchDoor}
          />
        )}
        {/* The two cuts as labelled cards (the walk, 2026-09-09 — never chip rows) */}
        {cutCards && <DropdownSelect label="Moneyness" value={mny} options={MONEY_OPTIONS} onChange={onMny} title={sharedNote ? `Which strikes against the stock — ${sharedNote}` : 'Which strikes against the stock'} testId="pane-money" />}
        {cutCards && ticker && onTenor && <DropdownSelect label="Tenor" value={tenor} options={CLOCK_OPTIONS} onChange={onTenor} title={sharedNote ? `How far out the contracts run — ${sharedNote}` : 'How far out the contracts run'} testId="pane-clock" />}
        {/* the figures wrap on a phone rather than run off the pane (the device sweep, 2026-10-18: the volume cut at 360) */}
        <span className="ml-auto min-w-0 flex items-center justify-end gap-2.5 flex-wrap font-mono text-[11px] tnum [&>span]:whitespace-nowrap">
          <span style={{ color: inksNow.spot }}>{ref}</span>
          <span>
            <span className="text-textMuted uppercase text-[11px] tracking-wider mr-1">net calls</span>
            <span className={view.ncp >= 0 ? 'text-bull' : 'text-bear'}>{fmtUsd(view.ncp)}</span>
          </span>
          <span>
            <span className="text-textMuted uppercase text-[11px] tracking-wider mr-1">net puts</span>
            <span className={view.npp >= 0 ? 'text-bear' : 'text-bull'}>{fmtUsd(view.npp)}</span>
          </span>
          <span className="text-textSecondary">{view.vol.toLocaleString('en-US')} vol</span>
        </span>
        {onExpand && (
          <button
            onClick={onExpand}
            title={expanded ? 'Leave full screen' : 'Full screen'}
            aria-label={expanded ? 'Leave full screen' : 'Show this pane full screen'}
            className="p-1 -mr-1 rounded text-textSecondary hover:text-textPrimary hover:bg-ink/[0.04] transition-colors"
          >
            {expanded ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
          </button>
        )}
      </div>
      <div className="relative flex-1 min-h-0" onDoubleClick={resetView}>
        <div ref={containerRef} className="absolute inset-0" />
        {/* The glide readout — pinned top-left past the price axis, glass
            enough to whisper over the lines it summarizes */}
        <div
          ref={tipRef}
          aria-hidden
          className="pointer-events-none absolute top-2 left-14 z-20 w-[168px] opacity-0 transition-opacity duration-100 border border-borderSubtle bg-panel/60 backdrop-blur-md rounded-md shadow-lg shadow-black/30 px-2.5 py-2"
        >
          <span ref={tipTimeRef} className="block font-mono text-[11px] uppercase tracking-widest text-textMuted mb-1">
            --:--
          </span>
          <span className="flex items-center gap-1.5 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: inksNow.spot }} />
            <span ref={tipSpotLabelRef} className="font-mono text-[11px] uppercase tracking-wider text-textMuted">
              SPY
            </span>
            <span ref={tipSpotRef} className="ml-auto font-mono text-[11px] tnum text-textPrimary">
              —
            </span>
          </span>
          <span className="flex items-center gap-1.5 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: inksNow.calls }} />
            <span className="font-mono text-[11px] uppercase tracking-wider text-textMuted">Net calls</span>
            <span ref={tipCallRef} className="ml-auto font-mono text-[11px] tnum text-bull">
              —
            </span>
          </span>
          <span className="flex items-center gap-1.5 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full shrink-0 cvd-hollow" style={{ background: inksNow.puts, color: inksNow.puts }} />
            <span className="font-mono text-[11px] uppercase tracking-wider text-textMuted">Net puts</span>
            <span ref={tipPutRef} className="ml-auto font-mono text-[11px] tnum text-bear">
              —
            </span>
          </span>
          <span className="flex items-center gap-1.5 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: inksNow.volLoud }} />
            <span className="font-mono text-[11px] uppercase tracking-wider text-textMuted">Volume</span>
            <span ref={tipVolRef} className={`${TIP_VOL_BASE} text-textSecondary`}>
              —
            </span>
          </span>
        </div>
        <ResetViewControl onReset={resetView} />
      </div>
    </div>
  );
};

export default NetFlowPane;
