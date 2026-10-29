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
import { Maximize2, Minimize2 } from 'lucide-react';
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
  type TickMarkType,
  type UTCTimestamp,
  LineStyle,
} from 'lightweight-charts';
import { bookCandles, dayBars, ensureBook, useBookRev } from '../../data/uwBook';
import { bookSession, VENDOR_TOTAL_NOTE } from '../../data/flowBook';
import { indexRoot, sessionEndLabel, sessionEndMin, tapeSessionIso, usePaneFlow } from '../../data/traceLive';
import { isLiveDay, shortDay } from './dayWords';
import { nyClock, nyParts, nyTickMarks, nyTimeFormatter, SESSION_OPEN_MIN } from '../../core/nyTime';
import { getResolvedTheme, readToken, useColourVision, useResolvedTheme } from '../../theme/theme';
import { earnMarks, weightInk, type InkMarks } from './earnedInk';
import ResetViewControl from '../gex/ResetViewControl';
import DropdownSelect, { type DropdownOption } from '../ui/DropdownSelect';
import {
  MONEYNESS,
  NET_SEGMENTS,
  type MoneynessKey,
  type NetFlowSegment,
} from '../../data/flowBook';
import { usd as fmtUsd } from '../../data/traceLive';
import { SLEEVES, type SleeveKey } from '../../types/compass';
import CompanyLogo from '../ui/CompanyLogo';
import FlowSearch, { type SearchDoor } from './FlowSearch';
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
/* ONE COLOUR RULE ON THE LINES (the retail pass, 2026-10-22: BAC ranked most bullish, its pane drew a RED line down to
   −$20M under a green "NET PUTS −$20.3M"): net calls above zero were bought (bullish, green) and below it sold (bearish,
   red); net puts above zero were bought (bearish, red) and below it sold (bullish, green). Each point wears its meaning. */
function inkLine(pts: { time: UTCTimestamp; value: number }[], line: 'calls' | 'puts', full: boolean, k: PaneInks) {
  const up = full ? k.calls : k.callsDim;
  const down = full ? k.puts : k.putsDim;
  return pts.map(p => ({ ...p, color: line === 'calls' ? (p.value >= 0 ? up : down) : p.value > 0 ? down : up }));
}
const TIP_VOL_BASE = 'ml-auto font-mono text-t11 tnum';

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

const SegPick = ({ seg, onSeg, allowed }: { seg: NetFlowSegment; onSeg: (s: NetFlowSegment) => void; allowed?: (s: NetFlowSegment) => boolean }) => (
  <DropdownSelect
    label="Cut"
    value={seg}
    options={NET_SEGMENTS.filter(s => !allowed || allowed(s.key)).map(s => ({ value: s.key, label: s.label, group: s.group }))}
    onChange={onSeg}
    title="Which cut of the book this pane watches — by family, or by sector"
    testId="net-flow-cut"
  />
);

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
  /** Which cuts the pane's picker offers — the same-day desk offers only those the vendor has same-day minutes for */
  segments?: (s: NetFlowSegment) => boolean;
  /** The Money and Clock cards in the head — off when the host's own line carries the cut
      for more than one pane (Compare, 2026-09-13: two panes on ONE cut, one pair of cards) */
  cutCards?: boolean;
  /** A word after the cards' titles when the host's cut reaches more than this pane ("sets both panes") */
  sharedNote?: string;
  /** Said on the head when the host's cut does not reach this pane's series (Compare under a clock: the name's ticks span
      every expiry — audit round 7: the panes drew −$53.6M under a 0DTE headline of −$12.8M) */
  uncutNote?: string;
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
  segments,
  uncutNote,
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
  /* the money lines' own points, kept so a hover's dim can re-ink them (each point wears its meaning's ink) */
  const lineDataRef = useRef<{ calls: { time: UTCTimestamp; value: number }[]; puts: { time: UTCTimestamp; value: number }[] }>({ calls: [], puts: [] });

  /* The spot ribbon: the picked name's own tape, or SPY's under a cut of the book. */
  const ref = ticker ?? 'SPY';
  const bookRev = useBookRev();
  const times = useMemo(() => paneTimes(ref), [ref, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  /* THE VENDOR'S MINUTES (traceLive's usePaneFlow): the lines and the head's figures read the same series — a host that
     hands its own `live` keeps that path */
  const own = usePaneFlow({ ticker: ticker ?? null, seg, mny, zeroDte: dteMax <= 1, enabled: live == null });
  const series = live ?? own.rows;
  /* THE NAME'S BOOK ONLY WHEN IT IS DRAWN (audit round 11, minor 5: Net Flow read the leader's whole Pinpoint book — ~16
     calls — on open, though its candles are drawn only when the name's own minutes are empty) */
  if (!indexRoot(ref) && !series.length && (live != null || !own.waiting)) ensureBook(ref, 'board');
  const tail = series.length ? series[series.length - 1] : null;
  /* a name's minutes carry gross contracts; a cut's only the net, so a cut prints no volume figure */
  const headVol = ticker ? series.reduce((a, p) => a + p.vol, 0) : null;
  const ncp = tail ? tail.callPrem : 0;
  const npp = tail ? tail.putPrem : 0;
  /* THE WINDOW RUNS TO NOW WHILE THE SESSION DOES (retail, round 8: "09:30–16:15 ET" at 10:05) — "09:30–now (10:05)",
     the close only once it has rung */
  const endMin = sessionEndMin(ticker ?? ref);
  const nowP = nyParts(new Date());
  const runningNow = isLiveDay() && nowP.hour * 60 + nowP.minute < endMin;
  const windowWords = runningNow ? `8:30 AM–now (${tail ? nyClock(tail.time * 1000, { zone: true }) : nyClock(undefined, { zone: true })})` : `8:30 AM–${sessionEndLabel(ticker ?? ref)}`;
  /* THE READOUT AT REST IS THE LATEST MINUTE (retail, round 8: "--:-- SPY — NET CALLS —" before any hover) — the hover
     writes over it, and leaving the chart puts the latest back */
  const restTip = useCallback(() => {
    const card = tipRef.current;
    if (!card || card.style.opacity === '1' || !tail) return;
    if (tipTimeRef.current) tipTimeRef.current.textContent = `${nyClock(tail.time * 1000)} · latest`;
    if (tipSpotLabelRef.current) tipSpotLabelRef.current.textContent = ref;
    if (tipSpotRef.current) tipSpotRef.current.textContent = tail.price > 0 ? `$${tail.price.toFixed(2)}` : '—';
    if (tipCallRef.current) tipCallRef.current.textContent = fmtUsd(tail.callPrem);
    if (tipPutRef.current) tipPutRef.current.textContent = fmtUsd(tail.putPrem);
    if (tipVolRef.current) tipVolRef.current.textContent = tail.vol.toLocaleString('en-US');
  }, [tail, ref]);
  useEffect(() => {
    restTip();
  }, [restTip]);
  const restTipRef = useRef(restTip);
  restTipRef.current = restTip;
  const emptyNote = series.length ? null : own.waiting ? 'Reading the minutes…' : own.fault ? 'This read did not land — the line fills when the feed answers' : 'No flow on this cut yet';
  /* The names the search can offer: only those with contracts inside the
     pane's own DTE ceiling — a 0DTE pane lists same-day names alone. */
  const searchRows = useMemo(
    () => (onTicker ? book.filter(r => r.dte <= dteMax && (!searchNames || searchNames(r.ticker))) : []),
    [book, dteMax, onTicker, searchNames]
  );

  /* the readout names THIS pane's name (retail, 2026-10-23: Compare's QQQ pane read "SPY" on hover) — set as it renders,
     so a hover before the effect lands never wears the default */
  refNameRef.current = ref;

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
      /* entireTextOnly: a label the pane's edge would cut ("$6.0M" half off the head) is not drawn at all */
      rightPriceScale: { borderVisible: false, minimumWidth: 60, entireTextOnly: true },
      leftPriceScale: { visible: true, borderVisible: false, minimumWidth: 52, entireTextOnly: true },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 14,
        /* the twenty lead minutes before the bell carry no label — at the pane's edge "09:10" was cut to ":10" (the audit,
           2026-10-22) */
        tickMarkFormatter: (t: Time, type: TickMarkType) => {
          const p = nyParts((t as number) * 1000);
          return typeof t === 'number' && p.hour * 60 + p.minute < SESSION_OPEN_MIN ? '' : nyTickMarks(t, type, 'en-US');
        },
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
      lineStyle: LineStyle.Dashed,
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
    chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.16, bottom: 0.2 } });
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
      /* each point keeps its MEANING's ink — calls bought green, sold red; puts bought red, sold green — dimmed whole when
         the other line is the one under the hand */
      const d = lineDataRef.current;
      calls.setData(inkLine(d.calls, 'calls', next === null || next === 'calls', k));
      puts.setData(inkLine(d.puts, 'puts', next === null || next === 'puts', k));
      calls.applyOptions({ lineWidth: (next === 'calls' ? 3 : 2) as LineWidth });
      puts.applyOptions({ lineWidth: (next === 'puts' ? 3 : 2) as LineWidth });
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
        card.style.visibility = 'hidden';
        applyPick(null);
        restTipRef.current();
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
      card.style.visibility = 'visible';
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
    if (!chart || !spot || !calls || !puts || !vol) return;
    if (!series.length) {
      spot.setData([]);
      calls.setData([]);
      puts.setData([]);
      vol.setData([]);
      return;
    }

    const bars = series.length ? [] : (bookCandles(ref) ?? dayBars(ref) ?? []);
    const byTime = new Map<number, number>();
    for (const b of bars) byTime.set(b.time as number, b.close);

    const id = `${seg}-${mny}-${ref}-${tenor}-${dteMax}`;
    const loaded = loadedRef.current;
    let spotData = times.map(t => ({ time: t as UTCTimestamp, value: byTime.get(t) ?? 0 })).filter(p => p.value > 0);
    /* REAL BARS OFF THE MINUTE GRID (Trace › Compare, 2026-10-22): the vendor's candles do not always sit on the pane's
       minutes (five-minute bars, or a stamp a few seconds in), and the index fallback below then laid ~80 bars over 390
       minutes and repeated the last close — the price drew FLAT from mid-morning. Read each minute AS OF the latest bar
       at or before it, whenever the bars cover the session's own minutes. */
    if (spotData.length < times.length / 2 && bars.length > 0 && times.length > 0) {
      const sorted = [...bars].sort((x, y) => (x.time as number) - (y.time as number));
      const first = sorted[0].time as number;
      const last = sorted[sorted.length - 1].time as number;
      if (first <= times[times.length - 1] && last >= times[0]) {
        let j = -1;
        spotData = times
          .map(t => {
            while (j + 1 < sorted.length && (sorted[j + 1].time as number) <= t) j += 1;
            /* nothing after the last bar: the price is not drawn past the data */
            return { time: t as UTCTimestamp, value: j >= 0 && t <= last + 300 ? sorted[j].close : 0 };
          })
          .filter(p => p.value > 0);
      }
    }
    /* THE SIMULATOR'S CLOCK RUNS AHEAD OF THE WALL'S (~15×, one bar per four ticks), so its bars rarely sit on the
       session's minutes: its last session (SESSION_BARS of them, one simulated day) is laid over the session's minutes
       by index — bar k at 09:30 + k. Real one-minute bars land on the minutes themselves and take the first path. */
    if (spotData.length < times.length / 2 && bars.length > 0) {
      const tail = bars.slice(-390);
      const at = (i: number) => tail[Math.min(i, tail.length - 1)]?.close ?? 0;
      spotData = times.map((t, i) => ({ time: t as UTCTimestamp, value: at(i) })).filter(p => p.value > 0);
    }
    const drawn = series.map(p => ({ time: p.time, callPrem: p.callPrem, putPrem: p.putPrem, vol: p.vol }));
    const callData = drawn.map(p => ({ time: p.time as UTCTimestamp, value: p.callPrem }));
    const putData = drawn.map(p => ({ time: p.time as UTCTimestamp, value: p.putPrem }));
    if (series.length) {
      spotData = series.filter(p => p.price > 0).map(p => ({ time: p.time as UTCTimestamp, value: p.price }));
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
    /* Twenty empty minutes ahead of the first bar: the axis's first label (09:30) was clipped to "30" against the
       left price scale — the lead room seats it whole, the right offset does the same for 16:00 */
    const lead: { time: UTCTimestamp }[] = drawn.length
      ? Array.from({ length: 20 }, (_, i) => ({ time: (drawn[0].time - (20 - i) * 60) as UTCTimestamp }))
      : [];
    vol.setData([...lead, ...drawn.map(p => ({ time: p.time as UTCTimestamp, value: Math.sqrt(Math.abs(p.vol)), color: volInk(Math.abs(p.vol), marks, inks) }))]);
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
    lineDataRef.current = { calls: callData, puts: putData };
    calls.setData(inkLine(callData, 'calls', true, inks));
    puts.setData(inkLine(putData, 'puts', true, inks));
    if (loaded.id !== id) {
      chart.priceScale('right').applyOptions({ autoScale: true });
      chart.priceScale('left').applyOptions({ autoScale: true });
      chart.timeScale().fitContent();
    }
    loadedRef.current = { id, length: drawn.length };
  }, [times, seg, mny, ref, tenor, dteMax, appTheme, series, bookRev]);

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
    /* the puts are always dashed: the two lines now share inks (each by its meaning), so the style tells them apart */
    putRef.current?.applyOptions({ color: k.puts, lineStyle: LineStyle.Dashed });
    const d = lineDataRef.current;
    callRef.current?.setData(inkLine(d.calls, 'calls', true, k));
    putRef.current?.setData(inkLine(d.puts, 'puts', true, k));
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
            {!onTicker && <span className="font-mono text-t11 font-bold text-textPrimary">{ticker}</span>}
          </span>
        ) : (
          <SegPick seg={seg} onSeg={onSeg} allowed={segments} />
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
        {/* the cards show only where the feed's minutes can be cut by them: moneyness on a market cut (net-flow/expiry
            takes it), never on a name's ticks or a sector's tide, and no tenor — a name's ticks span every expiry */}
        {cutCards && (live != null || (!ticker && !seg.startsWith('sector:'))) && <DropdownSelect label="Moneyness" value={mny} options={MONEY_OPTIONS} onChange={onMny} title={sharedNote ? `Which strikes against the stock — ${sharedNote}` : 'Which strikes against the stock'} testId="pane-money" />}
        {cutCards && live != null && ticker && onTenor && <DropdownSelect label="Tenor" value={tenor} options={CLOCK_OPTIONS} onChange={onTenor} title={sharedNote ? `How far out the contracts run — ${sharedNote}` : 'How far out the contracts run'} testId="pane-clock" />}
        {/* the figures wrap on a phone rather than run off the pane (the device sweep, 2026-10-18: the volume cut at 360) */}
        <span className="ml-auto min-w-0 flex items-center justify-end gap-2.5 flex-wrap font-mono text-t11 tnum [&>span]:whitespace-nowrap">
          {/* on a cut (Everything, Stocks only…) the white line is the reference name's price, not the pane's subject */}
          {/* AN INDEX-ONLY PANE SAYS ITS LINE IS NOT AN INDEX (audit round 4: "Index options only" over a line labelled "SPY
              price"): the feed's minutes carry SPY's price on every cut, so the line is SPY's, said as a reference */}
          {/* THE LINES' KEY (retail, round 8: the chart had no legend for its lines) — each label wears its line's stroke */}
          <span style={{ color: inksNow.spot }} data-pane-legend="spot" title={ticker ? `The thin solid line — ${ref}'s price, its own scale on the left` : `The white line is ${ref}'s price — the reference line on every cut, not ${seg === 'indexes' ? 'an index level' : "the cut's own price"}; the cut's money is every name in it`}>
            <span aria-hidden className="inline-block align-middle w-3.5 mr-1 border-t" style={{ borderColor: inksNow.spot }} />
            {ticker ? `${ref} price` : seg === 'indexes' ? `${ref} price for reference, not an index` : `${ref} price for reference`}
          </span>
          {/* WHOSE MONEY (audit round 9: "SPY … net calls −$2.0M, net puts −$5.8M" read as SPY's own 0DTE flow — Compare showed
              SPY's −$3.7M / −$0.1M): on a cut the figures are every name in the cut, said beside them */}
          {!ticker && (
            <span className="text-textSecondary uppercase text-t11 tracking-wider" data-pane-scope title="The net call and put premium below are every name in this cut — not the reference name's own; the price line is only a clock to read them against">
              {seg === 'all' ? "all names'" : "the cut's names'"} {dteMax <= 1 ? '0DTE flow' : 'flow'}
            </span>
          )}
          {/* a picked name on the same-day desk draws its money across EVERY expiry — the vendor has no same-day-only
              series per name per minute (the ship pass, 2026-10-22); the cut panes are exact, this one says what it is */}
          {ticker && uncutNote && live == null && (
            <span className="text-warn uppercase text-t11 tracking-wider" title={`This pane is the name's money across ${uncutNote}`} data-pane-uncut>
              every expiry · not cut
            </span>
          )}
          {ticker && dteMax <= 1 && live == null && (
            <span className="text-textMuted uppercase text-t11 tracking-wider" title="The feed has no same-day-only series for one name minute by minute — this pane is the name's money across every expiry, from the bell">
              every expiry
            </span>
          )}
          <span title={`${ticker ? "The minute ticks for the name (/stock/{t}/net-prem-ticks), 09:30 to the close" : "The net flow by expiry (/net-flow/expiry)"}. ${VENDOR_TOTAL_NOTE}`}>
            <span aria-hidden data-pane-legend="calls" className="inline-block align-middle w-3.5 mr-1 border-t-2" style={{ borderColor: inksNow.calls }} title="The solid line — net call premium, running from the bell" />
            <span className="text-textMuted uppercase text-t11 tracking-wider mr-1">net calls</span>
            <span className={ncp >= 0 ? 'text-bull' : 'text-bear'}>{tail ? fmtUsd(ncp) : '—'}</span>
          </span>
          <span title={VENDOR_TOTAL_NOTE}>
            <span aria-hidden data-pane-legend="puts" className="inline-block align-middle w-3.5 mr-1 border-t-2 border-dashed" style={{ borderColor: inksNow.puts }} title="The dashed line — net put premium, running from the bell" />
            <span className="text-textMuted uppercase text-t11 tracking-wider mr-1">net puts</span>
            <span className={npp >= 0 ? 'text-bear' : 'text-bull'}>{tail ? fmtUsd(npp) : '—'}</span>
          </span>
          {/* THE NET, SAID (audit round 5): the figure Compare's headline and Intervals print for the same name and window */}
          {ticker && tail && (
            <span title="Net calls less net puts, 09:30 to the close — the feed's minute ticks; the same figure as Compare's net and Intervals' lean">
              <span className="text-textMuted uppercase text-t11 tracking-wider mr-1">net</span>
              <span className={ncp - npp >= 0 ? 'text-bull' : 'text-bear'}>{ncp - npp < 0 ? '−' : '+'}{fmtUsd(Math.abs(ncp - npp))}</span>
              {/* THE WINDOW UNDER THE FIGURE (audit round 6: BAC +$19.8M here beside +$19.7M on the board, the windows said only
                  on a hover) */}
              <span className="text-textSecondary text-t11 ml-1" data-pane-window>· {windowWords}{isLiveDay() ? '' : `, ${shortDay(tapeSessionIso())}`}</span>
            </span>
          )}
          {headVol != null && tail && <span className="text-textSecondary">{headVol.toLocaleString('en-US')} vol</span>}
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
        {emptyNote && (
          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
            <span className="font-mono text-t11 uppercase tracking-widest text-textMuted" data-pane-empty>{emptyNote}</span>
          </div>
        )}
        {/* The glide readout — pinned top-left past the price axis, glass
            enough to whisper over the lines it summarizes */}
        <div
          ref={tipRef}
          aria-hidden
          /* hidden, not only faded, at rest (audit round 9: the resting readout read as a second "NET PUTS" beside the
             head's — the head carries the latest figures; the card is the hover's) */
          style={{ visibility: 'hidden' }}
          className="pointer-events-none absolute top-2 left-14 z-20 w-[168px] opacity-0 transition-opacity duration-100 border border-borderSubtle bg-panel/60 backdrop-blur-md rounded-md shadow-lg shadow-black/30 px-2.5 py-2"
        >
          <span ref={tipTimeRef} className="block font-mono text-t11 uppercase tracking-widest text-textMuted mb-1">
            --:--
          </span>
          <span className="flex items-center gap-1.5 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: inksNow.spot }} />
            <span ref={tipSpotLabelRef} className="font-mono text-t11 uppercase tracking-wider text-textMuted">
              {ref}
            </span>
            <span ref={tipSpotRef} className="ml-auto font-mono text-t11 tnum text-textPrimary">
              —
            </span>
          </span>
          <span className="flex items-center gap-1.5 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: inksNow.calls }} />
            <span className="font-mono text-t11 uppercase tracking-wider text-textMuted">Net calls</span>
            <span ref={tipCallRef} className="ml-auto font-mono text-t11 tnum text-bull">
              —
            </span>
          </span>
          <span className="flex items-center gap-1.5 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full shrink-0 cvd-hollow" style={{ background: inksNow.puts, color: inksNow.puts }} />
            <span className="font-mono text-t11 uppercase tracking-wider text-textMuted">Net puts</span>
            <span ref={tipPutRef} className="ml-auto font-mono text-t11 tnum text-bear">
              —
            </span>
          </span>
          <span className="flex items-center gap-1.5 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: inksNow.volLoud }} />
            {/* A CUT'S BAR IS THE CHANGE IN NET VOLUME (audit round 9, minor 4): the net-flow and sector-tide minutes
                carry a running net volume, not contracts traded — the bar is |Δ net volume| that minute, named so */}
            <span className="font-mono text-t11 uppercase tracking-wider text-textMuted" title={ticker ? "Contracts traded that minute — the name's calls and puts" : "The change in the feed's running net volume that minute (calls less puts), sign dropped — not contracts traded"}>{ticker ? 'Volume' : 'Net vol chg'}</span>
            <span ref={tipVolRef} className={`${TIP_VOL_BASE} text-textSecondary`}>
              —
            </span>
          </span>
        </div>
        {/* up top, clear of the volume floor it used to sit on */}
        <ResetViewControl onReset={resetView} pillClass="right-16 top-2" />
      </div>
    </div>
  );
};

export default NetFlowPane;
