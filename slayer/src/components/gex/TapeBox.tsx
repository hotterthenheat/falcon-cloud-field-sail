/* Today's price with the book's levels on it, drawn by the chart library (dayChart.ts): the session's close line, the
   levels ladder at the right edge (a kept strike, a bell that arms the level's alert), and ahead of now 1σ to the close
   and the corridor's field. The replay rewinds it with the page; hover for the minute, arrow keys walk the bars. */

import { sigmaFracOver, sigmaOverMinutes } from '../../data/expectedMove';
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DayHeadSlot } from './DayBox';
import { AreaSeries, createChart, createSeriesMarkers, LineSeries, LineStyle, type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi, type LineData, type SeriesMarker, type Time, type UTCTimestamp } from 'lightweight-charts';
import { Bell, BellRing, ChevronDown } from 'lucide-react';
import { roomLevels } from '../../data/roomLevels';
import { peekDaySigma, peekIv, peekMoveToClose, peekScopeMove, useBookRev, useResolvedSession } from '../../data/uwBook';
import { thetaChartBars, thetaChartNote, wantChartTape } from '../../data/thetaCandles';
import { usePrintRev, useTapeRev } from '../../data/thetaTape';
import { sessionOfMinute } from '../../data/deskSession';
import { scopeDateOf } from '../../data/wall';
import { readSessionClock } from '../../data/moc';
import { CLOSE_MIN, aheadClock, buildCorridor, hhmm, type AheadClock } from '../../data/ahead';
import { buildExposureProfile } from '../../data/exposure';
import { ThermalFieldPrimitive, type FieldPoint, type Rgb } from './thermalFieldPrimitive';
import { dayAxisFrom, dayAxisTo } from '../../data/dayAxis';
import { besideDot } from './besideDot';
import { nyIsoDate, nyMinutes } from '../../core/nyTime';
import { dayRef, longDay, todayScopeLabel } from '../../data/bookWindow';
import { armLevel, removeAlert, useAlerts, type LevelName } from './alertStore';
import { setDayHover, useDayHover } from '../../data/dayHover';
import { useResolvedTheme } from '../../theme/theme';
import { useRoomSpot } from '../../pages/pinpoint/useRoomSpot';
import { undoable } from '../ui/undo';
import { CALL_WALL, FLIP, PUT_WALL, SUPREME, THERMAL_COOL, THERMAL_WARM, alpha, resolveInk } from './paletteInk';
import { CLOCK_SCALE, DAY_SCALE_W, dayChartOptions, dayClock, daySurface, dayStartOf, feedSeries, syncDayScale } from './dayChart';
import { biggestSwings, publishSwings, useChartFocus } from '../../data/chartMoves';
import { KeyLevelsPrimitive, KEY_LEVEL_WORDS, type KeyLevelRung } from './keyLevelsPrimitive';
import type { Candle, MarketSnapshot } from '../../types/market';
import { fmtStrikeOrDash as fmtStrike } from '../../core/format';

const SILVER = 'rgb(var(--silver))';
const INK_3 = 'rgb(var(--text-muted))';
const TAPE_KEY = 'slayer_map_tape';
/* The key levels as the ladder's rungs at the tape's right edge (keyLevelsPrimitive.ts); the rung under the pointer
   brightens with a card that keeps the strike or sets its bell. The band the pointer finds a rung in, media px. */
const LADDER_HIT_W = 56;
const LADDER_NEAR = 7;
/** How long the rung's card takes to go (index.css chart-card-out) */
const CARD_OUT_MS = 160;
/** A fact on a part's one line: the name in tracked capitals, the figure beside it, so the chart keeps the height */
const PartFact = ({ label, children, title }: { label: string; children: ReactNode; title?: string }) => (
  <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap font-mono" title={title}>
    <span className="text-t11 uppercase tracking-wider text-textMuted">{label}</span>
    <span className="text-t12 font-semibold tnum text-textPrimary">{children}</span>
  </span>
);
/** The thermal ramp's yellow halfway out (heatmap.ts 'thermal-yellow' at 0.2) — the one ink the tokens do not carry */
const THERMAL_YELLOW: Rgb = [254, 224, 144];
/** A resolved ink's channels, for the canvas */
const rgbOf = (s: string): Rgb => {
  const m = s.match(/\d+(?:\.\d+)?/g) ?? [];
  return [Number(m[0]) || 0, Number(m[1]) || 0, Number(m[2]) || 0];
};

interface Level {
  key: LevelName | 'pin';
  word: string;
  ink: string;
  price: number;
}

interface Props {
  snapshot: MarketSnapshot;
  /** The day so far, handed in — the Map's replay reads the bars up to its position */
  bars?: readonly Candle[];
  focus: number | null;
  onPick: (price: number) => void;
  scope?: ReactNode;
  /** Minutes from midnight ET the replay stands at — the cone starts there */
  at?: number | null;
  /** A part of the day box (DayBox.tsx): no head of its own, the facts in a row, the clock shared with the plot under it */
  part?: boolean;
}

/** The box's fold, remembered on this machine */
const readOpen = (): boolean => {
  try {
    return localStorage.getItem(TAPE_KEY) !== 'shut';
  } catch {
    return true;
  }
};

/** Levels on one price share one line and one chip — the highest of them names its ink (the strike column's rule) */
const PRIORITY: Level['key'][] = ['supreme', 'callWall', 'putWall', 'flip', 'pin'];
interface Group {
  key: string;
  price: number;
  levels: Level[];
  ink: string;
}

const TapeBox = ({ snapshot, bars: barsProp, focus, onPick, scope, at, part = false }: Props) => {
  const paper = useResolvedTheme() === 'light';
  const [openOwn, setOpen] = useState(readOpen);
  const open = part || openOwn;
  const toggle = () => {
    setOpen(v => {
      try {
        localStorage.setItem(TAPE_KEY, v ? 'shut' : 'open');
      } catch {
        /* storage off */
      }
      return !v;
    });
  };
  /* the room's price (useRoomSpot): one price on the page, the line ending on the head's figure; a replay's bars stand */
  const roomSpot = useRoomSpot(snapshot.ticker);
  useBookRev();
  const markMoves = useChartFocus(snapshot.ticker);
  const read = useResolvedSession(snapshot.ticker);
  /* the price drawn is ThetaData's one-minute tape (data/thetaTape.ts), never the book's bars; a replay cuts it to the
     replayed window, in that window's session */
  const tapeSession = barsProp?.length ? sessionOfMinute(nyMinutes(barsProp[0].time * 1000)) : read.session;
  useEffect(() => {
    const offs = wantChartTape(snapshot.ticker, '1m', tapeSession);
    return () => offs.forEach(off => off());
  }, [snapshot.ticker, tapeSession]);
  const tapeRev = useTapeRev();
  const printRev = usePrintRev(barsProp == null);
  /* kept or offline: the bars stay, stamped as of when they were read */
  const tapeNote = thetaChartNote(snapshot.ticker, 1, tapeSession);
  const bars = useMemo(() => {
    const all = thetaChartBars(snapshot.ticker, 1, tapeSession);
    if (!barsProp) return all;
    if (!barsProp.length) return [];
    const from = barsProp[0].time;
    const to = barsProp[barsProp.length - 1].time;
    return all.filter(b => b.time >= from && b.time <= to);
  }, [snapshot.ticker, barsProp, tapeSession, tapeRev, printRev]);
  /* the book handed in is already the Map's window, read as it stands (a dated book is read '0DTE') */
  const levelsScope = '0DTE' as const;
  const levels = useMemo<Level[]>(() => {
    try {
      /* the room's one reading of the levels (data/roomLevels.ts), so the tags here are the band's */
      const l = roomLevels(snapshot, levelsScope);
      /* nothing drawn off a provisional book: no line or chip until the scope's levels are final */
      if (!l || (snapshot.liveBook && (l.complete === false || snapshot.levelsPending))) return [];
      const all: Level[] = [
        { key: 'callWall', word: 'Call wall', ink: CALL_WALL, price: l.callWall },
        /* no crossing within ±10% is no flip — no line is drawn at a placeholder */
        { key: 'flip', word: 'Flip', ink: FLIP, price: l.flipFound === false ? Number.NaN : l.flip },
        { key: 'putWall', word: 'Put wall', ink: PUT_WALL, price: l.putWall },
        /* a pin only where dealers are long gamma and price is near (data/exposure.ts) */
        { key: 'pin', word: 'Pin', ink: INK_3, price: l.pinFound === false ? Number.NaN : l.pin },
        { key: 'supreme', word: 'Supreme', ink: SUPREME, price: l.supreme },
      ];
      return all.filter(x => Number.isFinite(x.price));
    } catch {
      return [];
    }
  }, [snapshot, levelsScope]);
  /* one line and one chip where levels coincide */
  const groups = useMemo<Group[]>(() => {
    const out: Group[] = [];
    for (const l of levels) {
      const g = out.find(x => Math.abs(x.price - l.price) < 1e-9);
      if (g) {
        g.levels.push(l);
        g.key = `${g.key}+${l.key}`;
      } else out.push({ key: l.key, price: l.price, levels: [l], ink: l.ink });
    }
    for (const g of out) {
      g.levels.sort((a, b) => PRIORITY.indexOf(a.key) - PRIORITY.indexOf(b.key));
      g.ink = g.levels[0].ink;
    }
    return out.sort((a, b) => b.price - a.price);
  }, [levels]);
  /* the lines are drawn again only when a level moves — the levels are read afresh every tick, the same prices */
  const groupsKey = groups.map(g => `${g.key}@${g.price}`).join('|');
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const alerts = useAlerts(snapshot.ticker);
  const watched = (key: Level['key']) => alerts.find(a => a.kind === 'level' && a.level === key && !a.firedAt);

  /* the clock: now, in session minutes — the replay's minute when rewound */
  const clock = readSessionClock();
  const [h, m] = clock.etTime.split(':').map(Number);
  const liveMin = h * 60 + m;
  const inSession = at != null ? true : clock.phase === 'OPEN' || clock.phase === 'AUCTION';
  /* the clock starts where the day's bars do (data/dayAxis.ts) — the book under it reads the same bars, so the same minute */
  const FROM = dayAxisFrom(bars[0]?.time);
  /* live, the axis is the session so far (dayAxis.ts); a replay and a closed day keep the whole session */
  const TO = dayAxisTo(bars[bars.length - 1]?.time, at == null && inSession);
  const nowMin = at != null ? Math.max(FROM, Math.min(TO, at)) : inSession ? Math.max(FROM, liveMin) : TO;
  const spot = bars.length ? bars[bars.length - 1].close : snapshot.spot;
  /* what "Last" prints: the room's price — the replay's last bar when rewound */
  const last = barsProp != null ? spot : roomSpot ?? spot;
  /* one 1σ on every page: the levels' expiry's (uwBook peekDaySigma), the name's vol only when the feed has none */
  const iv = peekIv(snapshot.ticker) ?? 0.2;
  const minLeft = Math.max(0, CLOSE_MIN - nowMin);
  /* …and no expected move off it either (the same blocker: "ONE MOVE today ±4.12" read off the 30-day vol, later ±4.74 —
     the feed's own implied move): "…" until the levels' scope is final and the feed's term structure is in */
  const movePending = !!snapshot.liveBook && (!!snapshot.levelsPending || roomLevels(snapshot, '0DTE')?.complete === false || peekScopeMove(snapshot.ticker, scopeDateOf(snapshot))?.source === 'iv30');
  const daySigma = snapshot.liveBook && !movePending ? peekDaySigma(snapshot.ticker, scopeDateOf(snapshot)) : null;
  /* scaled to the minutes left exactly once; a replay's minute keeps the full-session figure's scaling */
  const left = daySigma != null && at == null ? peekMoveToClose(snapshot.ticker, scopeDateOf(snapshot), minLeft) : null;
  const w1 = left ?? (daySigma != null ? sigmaOverMinutes(daySigma, minLeft) : spot * sigmaFracOver(iv, minLeft));
  /* one phase vocabulary: outside the session the move is the coming session's — "today" before a trading day's open,
     "next session" after its close (bookWindow todayScopeLabel) */
  const aheadWord = todayScopeLabel() === 'Today' ? 'today' : 'next session';
  const shutBand = !movePending && daySigma != null && spot > 0 ? `${(spot - daySigma).toFixed(2)}–${(spot + daySigma).toFixed(2)}` : null;
  const shutMove = movePending ? `${aheadWord} …` : shutBand ? `${aheadWord} ${shutBand}` : aheadWord;
  const dayStart = bars.length ? dayStartOf(bars[0].time, nyMinutes(bars[0].time * 1000)) : 0;
  /* The field: where price is likelier to be from now to the close, by the corridor (data/ahead.ts), read a point a minute
     and cut at the axis' end while the session runs. Nothing after the close; in a replay, from the replayed minute. */
  const profile = useMemo(() => {
    try {
      return buildExposureProfile(snapshot, '0DTE', 30);
    } catch {
      return null;
    }
  }, [snapshot]);
  const fieldEnd = Math.min(CLOSE_MIN, TO);
  const fieldPoints = useMemo<FieldPoint[]>(() => {
    if (!profile || movePending || minLeft <= 0 || !bars.length || fieldEnd <= nowMin) return [];
    const clock: AheadClock = { ...aheadClock(readSessionClock()), nowMin, inSession: true, minutesLeft: Math.max(1, CLOSE_MIN - nowMin) };
    /* the corridor runs from the tape's own last close, the figure the line ends on */
    const cone = buildCorridor({ ...snapshot, spot }, profile, iv, clock).cone;
    if (cone.length < 2) return [];
    const out: FieldPoint[] = [];
    let k = 0;
    for (let m = nowMin; m <= fieldEnd; m++) {
      while (k + 1 < cone.length - 1 && cone[k + 1].min <= m) k++;
      const a = cone[k];
      const b = cone[Math.min(cone.length - 1, k + 1)];
      const u = b.min > a.min ? Math.max(0, Math.min(1, (m - a.min) / (b.min - a.min))) : 0;
      const lerp = (p: number, q: number) => p + (q - p) * u;
      out.push({ min: m, lo2: lerp(a.lo2, b.lo2), lo1: lerp(a.lo1, b.lo1), mid: lerp(a.mid, b.mid), hi1: lerp(a.hi1, b.hi1), hi2: lerp(a.hi2, b.hi2) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, snapshot, spot, iv, nowMin, fieldEnd, minLeft > 0, bars.length > 0]);

  /* ---- the chart ---- */
  const hostRef = useRef<HTMLDivElement | null>(null);
  /* the axis's width as measured — the chips at the plot's right edge stand off it (dayChart.ts syncDayScale) */
  const [scaleW, setScaleW] = useState(DAY_SCALE_W);
  const chartRef = useRef<IChartApi | null>(null);
  const priceRef = useRef<ISeriesApi<'Area'> | null>(null);
  const fieldRef = useRef<ThermalFieldPrimitive | null>(null);
  const clockRef = useRef<ISeriesApi<'Line'> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const fedPrice = useRef<readonly LineData<Time>[] | null>(null);
  /* what the scale must hold beyond the bars: the levels within reach and the field's one-move band at its end (read by the
     autoscale at draw time) */
  const fieldLast = fieldPoints[fieldPoints.length - 1];
  const swings = useMemo(() => biggestSwings(bars), [bars]);
  const swingsRef = useRef(swings);
  swingsRef.current = swings;
  const markMovesRef = useRef(markMoves);
  markMovesRef.current = markMoves;
  useLayoutEffect(() => {
    publishSwings(snapshot.ticker, swings);
  }, [snapshot.ticker, swings]);
  const reachRef = useRef<{ levels: number[]; cone: [number, number] | null; spot: number }>({ levels: [], cone: null, spot });
  reachRef.current = { levels: [...levels.map(l => l.price), ...(focus != null ? [focus] : [])], cone: fieldLast ? [fieldLast.lo1, fieldLast.hi1] : null, spot };
  const barsRef = useRef(bars);
  barsRef.current = bars;
  const indexOf = useMemo(() => new Map(bars.map((b, i) => [b.time, i] as const)), [bars]);
  const indexRef = useRef(indexOf);
  indexRef.current = indexOf;

  /* the hovered bar — the pointer's, or the keys' — and where its dot is on the chart */
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const hoverRef = useRef(hover);
  hoverRef.current = hover;
  /* the rung under the pointer and its card; the card stays a beat after the pointer leaves the rung, so it can be reached */
  const [levelHot, setLevelHot] = useState<{ key: KeyLevelRung['key']; price: number; y: number } | null>(null);
  /** The day box's head line, when this is its upper chart (DayBox DayHeadSlot) */
  const headSlot = useContext(DayHeadSlot);
  /* the card fades in on the house's soft fade and out on a short one (held CARD_OUT_MS, then unmounted by a timer) */
  const [levelClosing, setLevelClosing] = useState(false);
  const levelLeave = useRef(0);
  const levelHotRef = useRef(levelHot);
  levelHotRef.current = levelHot;
  /* and when the card goes, nothing is over it — a card unmounted under the pointer fires no pointer-leave */
  useEffect(() => {
    if (!levelHot) overCard.current = false;
  }, [levelHot]);
  /** The card's way out: a beat for the pointer to reach it, then the fade, then gone */
  const leaveLevel = useCallback((beatMs: number) => {
    window.clearTimeout(levelLeave.current);
    levelLeave.current = window.setTimeout(() => {
      if (overCard.current) return;
      setLevelClosing(true);
      levelLeave.current = window.setTimeout(() => {
        setLevelHot(null);
        setLevelClosing(false);
      }, CARD_OUT_MS);
    }, beatMs);
  }, []);
  const overCard = useRef(false);
  const ladderRef = useRef<KeyLevelsPrimitive | null>(null);
  const marksRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const paintMoves = useCallback(() => {
    const api = marksRef.current;
    const host = hostRef.current;
    if (!api) return;
    const list = swingsRef.current;
    if (!markMovesRef.current || !list.length || !host) {
      api.setMarkers([]);
      return;
    }
    const ink = (name: string, fallback: string) => {
      const v = getComputedStyle(host).getPropertyValue(name).trim();
      return v ? `rgb(${v})` : fallback;
    };
    api.setMarkers(list.map(s => ({
      time: s.time as UTCTimestamp,
      position: s.delta >= 0 ? 'aboveBar' : 'belowBar',
      color: s.delta >= 0 ? ink('--bull', '#3DDC97') : ink('--bear', '#FF5C7A'),
      shape: s.delta >= 0 ? 'arrowUp' : 'arrowDown',
      text: `${s.delta >= 0 ? '+' : '−'}$${Math.abs(s.delta).toFixed(2)}`,
    } satisfies SeriesMarker<Time>)));
  }, []);
  useEffect(() => () => window.clearTimeout(levelLeave.current), []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !open) return;
    const s = daySurface(host, paper);
    /* two charts, the tape above the book, each with its own clock along its foot and its own mark */
    const chart = createChart(host, dayChartOptions(s, { clock: true, logo: true }));
    /* the scale holds the bars, the levels within reach of them, the cone and the kept strike — a level a day's range
       away would flatten the tape to a line, so it waits in the chips instead */
    /* the tape like the book under it: the library's area, the line in the page's ink with its ground fading under it */
    const price = chart.addSeries(AreaSeries, {
      lineColor: s.ink,
      topColor: alpha(s.ink, paper ? 0.16 : 0.22),
      bottomColor: alpha(s.ink, 0.01),
      lineWidth: 2,
      priceLineVisible: false,
      /* one price: the scale's tag is the price the box prints, drawn below as its own line */
      lastValueVisible: false,
      crosshairMarkerRadius: 3,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      autoscaleInfoProvider: (original: () => { priceRange: { minValue: number; maxValue: number } | null } | null) => {
        const r = original();
        /* a view holding no bars has no range */
        if (!r || !r.priceRange) return r;
        let lo = r.priceRange.minValue;
        let hi = r.priceRange.maxValue;
        const { levels: lv, cone, spot: sp } = reachRef.current;
        const reach = Math.max(hi - lo, sp * 0.004);
        for (const p of lv) if (p >= lo - reach && p <= hi + reach) {
          lo = Math.min(lo, p);
          hi = Math.max(hi, p);
        }
        if (cone) {
          lo = Math.min(lo, cone[0]);
          hi = Math.max(hi, cone[1]);
        }
        return { priceRange: { minValue: lo, maxValue: hi } };
      },
    });
    /* the thermal field ahead of now, under the line (thermalFieldPrimitive.ts) */
    const field = new ThermalFieldPrimitive();
    price.attachPrimitive(field);
    /* the levels' ladder over it (keyLevelsPrimitive.ts) */
    const ladder = new KeyLevelsPrimitive();
    price.attachPrimitive(ladder);
    ladderRef.current = ladder;
    marksRef.current = createSeriesMarkers(price, []);
    paintMoves();
    /* the clock: whitespace on every minute of the session, so the axis is the day and holds still as bars come */
    /* the clock (dayChart.ts dayClock): every minute of the session, hidden, on a scale of its own */
    const clockS = chart.addSeries(LineSeries, { visible: false, priceScaleId: CLOCK_SCALE, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    chart.subscribeCrosshairMove(param => {
      /* The pointer on a rung, within the ladder's band near a rule: the rung brightens, its card opens, the minute's card stands aside. */
      /* only a pointer moves the rung's state: the chart calls this on every data tick too, with no pointer behind it */
      /* the pointer leaving the chart comes as a move with no point behind it (and no source event) — that, too, is
         the pointer off the rungs; a tick while the pointer is away looks the same, and says the same */
      if (param.sourceEvent || param.point === undefined) {
        /* a pointer on the chart is a pointer off the card, so the card's own hover flag can never wedge the leave */
        if (param.sourceEvent) overCard.current = false;
        let rung: KeyLevelRung | null = null;
        if (param.sourceEvent && param.point && ladder.data && param.point.x >= chart.timeScale().width() - LADDER_HIT_W) {
          let best = LADDER_NEAR;
          for (const r of ladder.visible()) {
            const y = price.priceToCoordinate(r.price);
            if (y == null) continue;
            const gap = Math.abs(y - param.point.y);
            if (gap <= best) {
              best = gap;
              rung = r;
            }
          }
        }
        ladder.setHot(rung?.key ?? null);
        if (rung && param.point) {
          window.clearTimeout(levelLeave.current);
          setLevelClosing(false);
          const hit = rung;
          const y = price.priceToCoordinate(hit.price) ?? param.point.y;
          setLevelHot(prev => (prev && prev.key === hit.key && prev.price === hit.price ? prev : { key: hit.key, price: hit.price, y }));
          setHover(null);
          return;
        }
        /* off the rungs: the card stays a beat, so the pointer can reach it — then fades, then goes */
        if (levelHotRef.current) leaveLevel(140);
      }
      /* the other plot's minute is set on this one from code — no pointer behind it, nothing to answer */
      if (!param.sourceEvent) {
        if (param.point === undefined && hoverRef.current) setHover(null);
        return;
      }
      if (param.point === undefined || param.time === undefined) {
        setHover(null);
        return;
      }
      const i = indexRef.current.get(param.time as number);
      const b = i != null ? barsRef.current[i] : null;
      if (i == null || !b) {
        setHover(null);
        return;
      }
      const x = chart.timeScale().timeToCoordinate(param.time) ?? param.point.x;
      const y = price.priceToCoordinate(b.close) ?? param.point.y;
      setHover({ i, x, y });
    });
    chartRef.current = chart;
    /* the axis as wide as its figures, shared with the hedging chart under it */
    const unsync = syncDayScale(chart, snapshot.ticker, 'tape', setScaleW);
    priceRef.current = price;
    fieldRef.current = field;
    clockRef.current = clockS;
    fedPrice.current = null;
    linesRef.current = [];
    return () => {
      unsync();
      chart.remove();
      chartRef.current = null;
      priceRef.current = null;
      fieldRef.current = null;
      ladderRef.current = null;
      marksRef.current = null;
    };
  }, [paper, part, open, paintMoves]);

  useEffect(() => {
    paintMoves();
  }, [paintMoves, markMoves, swings, open]);

  /* the clock, when the day's span moves */
  useEffect(() => {
    const chart = chartRef.current;
    const c = clockRef.current;
    if (!chart || !c || !bars.length) return;
    c.setData(dayClock(dayStart, FROM, TO));
    chart.timeScale().fitContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayStart, FROM, TO, paper, part, open, bars.length > 0]);

  /* the price — the newest minute only, unless the day itself changed */
  const pricePoints = useMemo<LineData<Time>[]>(() => bars.map(b => ({ time: b.time as UTCTimestamp, value: b.close })), [bars]);
  useEffect(() => {
    if (priceRef.current) feedSeries(priceRef.current, pricePoints, fedPrice);
  }, [pricePoints, paper, part, open]);

  /* the field, handed to its primitive: the thermal inks off the page, the points a minute */
  useEffect(() => {
    const field = fieldRef.current;
    const host = hostRef.current;
    if (!field || !host) return;
    if (!fieldPoints.length || !dayStart) {
      field.setData(null);
      return;
    }
    field.setData({ dayStart, points: fieldPoints, warm: rgbOf(resolveInk(THERMAL_WARM, host)), yellow: THERMAL_YELLOW, cool: rgbOf(resolveInk(THERMAL_COOL, host)), strength: paper ? 0.42 : 0.5 });
  }, [fieldPoints, dayStart, paper, part, open]);

  /* the walls, the flip and the supreme as the ladder's rungs (the inks literal — the chart is its own island); the
     pin keeps a quiet dotted line (it is no rung), the kept strike its silver one */
  useEffect(() => {
    const ladder = ladderRef.current;
    const host = hostRef.current;
    if (!ladder || !host) return;
    const at = (k: Level['key']) => levels.find(l => l.key === k)?.price ?? Number.NaN;
    const rungs = (
      [
        { key: 'callWall', price: at('callWall'), ink: resolveInk(CALL_WALL, host) },
        { key: 'putWall', price: at('putWall'), ink: resolveInk(PUT_WALL, host) },
        { key: 'flip', price: at('flip'), ink: resolveInk(SILVER, host), dash: true },
        { key: 'supreme', price: at('supreme'), ink: resolveInk(SUPREME, host), weight: 2 },
      ] as KeyLevelRung[]
    ).filter(r => Number.isFinite(r.price) && r.price > 0);
    ladder.setData({ rungs, hot: ladder.data?.hot ?? null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupsKey, paper, part, open]);
  useEffect(() => {
    const series = priceRef.current;
    const host = hostRef.current;
    if (!series || !host) return;
    for (const l of linesRef.current) series.removePriceLine(l);
    linesRef.current = [];
    const pin = levels.find(l => l.key === 'pin');
    if (pin && Number.isFinite(pin.price)) linesRef.current.push(series.createPriceLine({ price: pin.price, color: alpha(resolveInk(pin.ink, host), 0.7), lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: 'Pin' }));
    if (focus != null) linesRef.current.push(series.createPriceLine({ price: focus, color: resolveInk(SILVER, host), lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: 'Kept' }));
    if (Number.isFinite(last) && last > 0) linesRef.current.push(series.createPriceLine({ price: last, color: resolveInk(INK_3, host), lineWidth: 1, lineStyle: LineStyle.Solid, lineVisible: false, axisLabelVisible: true, title: '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupsKey, focus, paper, part, open, last]);

  /* A kept strike off the scale stays off (it would flatten the tape), but a chip in the row and a tag at the plot's edge
     say so and which way — read off the drawn chart after every render. */
  const [keptOff, setKeptOff] = useState<'up' | 'down' | null>(null);
  useEffect(() => {
    const series = priceRef.current;
    const chart = chartRef.current;
    if (!series || !chart || focus == null || !open || !bars.length) {
      setKeptOff(k => (k === null ? k : null));
      return;
    }
    const id = requestAnimationFrame(() => {
      const y = series.priceToCoordinate(focus);
      const h = chart.paneSize().height;
      const next: 'up' | 'down' | null = y == null ? (focus > spot ? 'up' : 'down') : y < 0 ? 'up' : y > h ? 'down' : null;
      setKeptOff(k => (k === next ? k : next));
    });
    return () => cancelAnimationFrame(id);
  });

  /* THE MINUTE, SHARED (idea 1): the pointer's minute is told to the plot under it, and its pointer's minute is set here
     as this chart's own crosshair — one clock, one rule across both */
  const hb = hover != null ? bars[hover.i] : null;
  const shared = useDayHover();
  useEffect(() => {
    if (!part) return;
    setDayHover(hb ? { min: nyMinutes(hb.time * 1000), from: 'tape', ticker: snapshot.ticker } : null);
  }, [part, hb, snapshot.ticker]);
  useEffect(() => () => setDayHover(null), []);
  useEffect(() => {
    const chart = chartRef.current;
    const series = priceRef.current;
    if (!chart || !series || hover) return;
    if (part && shared?.from === 'through' && bars.length) {
      const t = dayStart + shared.min * 60;
      const i = indexOf.get(t);
      if (i != null) {
        chart.setCrosshairPosition(bars[i].close, t as UTCTimestamp, series);
        return;
      }
    }
    chart.clearCrosshairPosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared, hover == null, part]);

  /* the keys walk the bars: the crosshair and the card go with them */
  const walk = (i: number) => {
    const chart = chartRef.current;
    const series = priceRef.current;
    const b = bars[i];
    if (!chart || !series || !b) return;
    chart.setCrosshairPosition(b.close, b.time as UTCTimestamp, series);
    setHover({ i, x: chart.timeScale().timeToCoordinate(b.time as UTCTimestamp) ?? 0, y: series.priceToCoordinate(b.close) ?? 0 });
  };
  const onKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || !bars.length) return;
    const cur = hover?.i ?? bars.length - 1;
    if (e.key === 'ArrowLeft') walk(Math.max(0, cur - 1));
    else if (e.key === 'ArrowRight') walk(Math.min(bars.length - 1, cur + 1));
    else if (e.key === 'Home') walk(0);
    else if (e.key === 'End') walk(bars.length - 1);
    else if (e.key === 'Escape') {
      setHover(null);
      chartRef.current?.clearCrosshairPosition();
    } else return;
    e.preventDefault();
  };
  useEffect(() => setHover(h => (h && h.i < bars.length ? h : null)), [bars]);

  /* the nearest level to the hovered close, in words */
  const nearLevel = (price: number) => {
    let best: Level | null = null;
    for (const l of levels) if (!best || Math.abs(l.price - price) < Math.abs(best.price - price)) best = l;
    if (!best) return '';
    const d = price - best.price;
    return `${Math.abs(d) < 0.005 ? 'on' : `${Math.abs(d).toFixed(2)} ${d > 0 ? 'over' : 'under'}`} the ${best.word.toLowerCase()}`;
  };
  /* "the put wall, the pin and the supreme" — a group's levels in one breath */
  const say = (ws: string[]) => (ws.length <= 1 ? ws[0] ?? '' : `${ws.slice(0, -1).join(', ')} and ${ws[ws.length - 1]}`);
  const plotW = hostRef.current?.clientWidth ?? 0;
  const session = useMemo(() => (bars.length ? { lo: Math.min(...bars.map(b => b.low)), hi: Math.max(...bars.map(b => b.high)) } : null), [bars]);
  /* the bars' own day: "today" only when the bars are New York's today, else the day by name */
  const barDay = bars.length ? nyIsoDate(bars[bars.length - 1].time * 1000) : null;
  const priceWord = !barDay || dayRef(barDay) === 'today' ? 'Price today' : `Price · ${longDay(barDay)}`;

  /* the chart is named for what it shows — today's price, the facts beside it, on the day box's head line when it has one */
  const partHead = part ? (
    <>
      {headSlot && <span className="h-4 w-px bg-borderSubtle shrink-0" aria-hidden />}
      <span className="text-t12 font-semibold text-textPrimary whitespace-nowrap" data-tape-part-word data-tape-day={barDay ?? undefined}>
        {priceWord}
      </span>
      {bars.length > 0 && session && (
        <>
          <PartFact label="Last">
            <span data-tape-last={last.toFixed(2)}>{last.toFixed(2)}</span>
          </PartFact>
          <PartFact label="Session">
            {session.lo.toFixed(2)} – {session.hi.toFixed(2)}
          </PartFact>
          <PartFact label="One move" title={fieldLast ? `By the close, one move is ${fieldLast.lo1.toFixed(2)} to ${fieldLast.hi1.toFixed(2)}. Two moves is ${fieldLast.lo2.toFixed(2)} to ${fieldLast.hi2.toFixed(2)}.` : 'One expected move from here to the close'}>
            <span data-tape-move={movePending ? undefined : w1.toFixed(2)} data-tape-ahead={fieldLast ? `${fieldLast.lo1.toFixed(2)}-${fieldLast.hi1.toFixed(2)}` : undefined}>
              {movePending ? '…' : minLeft > 0 && fieldLast ? `${fieldLast.lo1.toFixed(2)}–${fieldLast.hi1.toFixed(2)} · ${spot >= fieldLast.lo1 && spot <= fieldLast.hi1 ? 'inside' : spot > fieldLast.hi1 ? 'through the high' : 'through the low'} · ${minLeft}m` : shutMove}
            </span>
          </PartFact>
        </>
      )}
    </>
  ) : null;
  return (
    /* as a part: the upper of the day box's two charts, edge to edge — the head row, the plot with its own clock */
    <section className={`relative flex flex-col min-w-0 ${part ? 'flex-1 min-h-0' : ''}`} data-tape-box data-tape-open={open || undefined} data-tape-part={part || undefined}>
      {/* AS A PART the head goes up to the day box's line (DayBox's slot); the box's own line is the standalone tape's */}
      {part ? (
        headSlot && createPortal(partHead, headSlot)
      ) : (
      <div className="px-5 pt-4 pb-3 flex items-start gap-6 flex-wrap">
        {(
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h3 className="text-t16 font-semibold leading-tight text-textPrimary">The tape</h3>
              {scope}
              <button
                type="button"
                onClick={toggle}
                aria-expanded={open}
                title={open ? 'Fold the tape away' : 'Show the tape'}
                className="hit inline-flex items-center gap-1 h-6 px-1.5 rounded-md text-t11 text-textMuted hover:text-textPrimary hover:bg-ink/[0.05] transition-colors"
                data-tape-fold
              >
                <ChevronDown className={`w-3 h-3 transition-transform ${open ? '' : '-rotate-90'}`} />
                {open ? 'Fold' : 'Unfold'}
              </button>
            </div>
            <p className="mt-0.5 text-t11 text-textMuted">{priceWord === 'Price today' ? "Today's price" : `${longDay(barDay!)}'s price`} with the book's levels on it</p>
          </div>
        )}
        {bars.length > 0 && session && (
          <dl className="grid grid-cols-3 gap-x-6">
            <div>
              <dt className="text-t11 text-textMuted">Last</dt>
              <dd className="mt-0.5 font-mono text-t14 tnum text-textPrimary whitespace-nowrap" data-tape-last={last.toFixed(2)}>
                {last.toFixed(2)}
              </dd>
            </div>
            <div>
              <dt className="text-t11 text-textMuted">Session</dt>
              <dd className="mt-0.5 font-mono text-t14 tnum text-textPrimary whitespace-nowrap">
                {session.lo.toFixed(2)} – {session.hi.toFixed(2)}
              </dd>
            </div>
            <div>
              <dt className="text-t11 text-textMuted">One move to the close</dt>
              <dd className="mt-0.5 font-mono text-t14 tnum text-textPrimary whitespace-nowrap" data-tape-move={movePending ? undefined : w1.toFixed(2)}>
                {movePending ? '…' : minLeft > 0 && fieldLast ? `${fieldLast.lo1.toFixed(2)}–${fieldLast.hi1.toFixed(2)}` : shutMove}
              </dd>
            </div>
          </dl>
        )}
      </div>
      )}
      {open && (
        /* as a part of the day box the plot takes its share of the height — 240 at least */
        <div className={part ? 'flex-1 min-h-0 flex flex-col border-t border-borderSubtle/60' : 'border-t border-borderSubtle/60'}>
          <div
            className={`relative ${part ? 'flex-[1_1_280px] min-h-[240px]' : 'h-[260px]'} outline-none`}
            tabIndex={0}
            role="group"
            aria-label={`${snapshot.ticker}'s tape with the book's levels — the arrow keys walk the bars`}
            onKeyDown={onKeys}
            onClick={() => {
              if (levelHot && !overCard.current) onPick(levelHot.price);
            }}
            data-tape-plot
            data-tape-levels={groupsKey || undefined}
          >
            <div ref={hostRef} className="absolute inset-0" data-tape-chart />
            {fieldLast && minLeft > 0 && !movePending && (
              <div className="pointer-events-none absolute left-2 top-2 z-10 max-w-[280px] rounded-md border border-borderSubtle px-2.5 py-1.5 font-mono text-t11 leading-snug text-textSecondary" style={{ background: 'rgba(8,8,10,0.88)' }} data-ahead-read>
                <span className="block text-t10 uppercase tracking-wider text-textMuted">Ahead to the close</span>
                <span className="block tnum text-textPrimary">One move {fieldLast.lo1.toFixed(2)} – {fieldLast.hi1.toFixed(2)}</span>
                <span className="block tnum">Two moves {fieldLast.lo2.toFixed(2)} – {fieldLast.hi2.toFixed(2)}</span>
                <span className="block tnum">
                  {minLeft} min left · {spot >= fieldLast.lo1 && spot <= fieldLast.hi1 ? 'price is inside one move' : spot > fieldLast.hi1 ? `price is $${(spot - fieldLast.hi1).toFixed(2)} through the high` : `price is $${(fieldLast.lo1 - spot).toFixed(2)} through the low`}
                </span>
              </div>
            )}
            {!fieldLast && shutBand && (
              <div className="pointer-events-none absolute left-2 top-2 z-10 max-w-[260px] rounded-md border border-borderSubtle px-2.5 py-1.5 font-mono text-t11 leading-snug text-textSecondary" style={{ background: 'rgba(8,8,10,0.88)' }} data-ahead-read>
                <span className="block text-t10 uppercase tracking-wider text-textMuted">{aheadWord === 'today' ? 'Today' : 'Next session'}</span>
                <span className="block tnum text-textPrimary">One move {shutBand.replace('–', ' – ')}</span>
                <span className="block tnum">Nothing left in this session. This is the whole move around the close.</span>
              </div>
            )}
            {markMoves && swings.length > 0 && (
              <div className="pointer-events-none absolute right-14 top-2 z-10 rounded-md border border-borderSubtle px-2.5 py-1.5 font-mono text-t11 leading-snug text-textSecondary" style={{ background: 'rgba(8,8,10,0.88)' }} data-chart-moves={swings.length}>
                <span className="block text-t10 uppercase tracking-wider text-textMuted">Biggest moves</span>
                {swings.map(s => (
                  <span key={s.time} className="block tnum text-textPrimary">
                    {hhmm(nyMinutes(s.time * 1000))} {s.delta >= 0 ? '+' : '−'}${Math.abs(s.delta).toFixed(2)} to {s.to.toFixed(2)}
                  </span>
                ))}
              </div>
            )}
            {/* the pointer's minute — Compare's glass, beside the point it reads */}
            {hb && hover && (
              <div
                className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md border border-borderSubtle px-2.5 py-1.5 font-mono text-t11 text-textSecondary"
                style={{ ...besideDot(hover.x, hover.y, hover.x > plotW / 2), background: 'rgba(8,8,10,0.88)', backdropFilter: 'blur(3px)' }}
                data-theme="dark"
                data-chart-glass
                data-tape-card={hhmm(nyMinutes(hb.time * 1000))}
              >
                <span className="font-bold tnum text-textPrimary">{hhmm(nyMinutes(hb.time * 1000))}</span>
                <span className="ml-2 tnum text-textPrimary">{hb.close.toFixed(2)}</span>
                <span className="ml-2 text-textMuted">{nearLevel(hb.close)}</span>
              </div>
            )}
            {/* The card on a rung: the level's name, price, distance from spot, what it does to price, and keep/bell chips; it stays while hovered. */}
            {levelHot &&
              (() => {
                const w = KEY_LEVEL_WORDS[levelHot.key];
                const lad = ladderRef.current;
                const ink = lad?.data?.rungs.find(r => r.key === levelHot.key)?.ink;
                const shared = lad?.sharedWith(levelHot.key) ?? [];
                const aside = shared.length ? `on the ${shared.map(k => KEY_LEVEL_WORDS[k].name.toLowerCase()).join(' and the ')}` : w.aside;
                const dist = spot > 0 ? ((levelHot.price - spot) / spot) * 100 : null;
                const kept = focus != null && Math.abs(focus - levelHot.price) < 1e-9;
                const keys: LevelName[] = [levelHot.key, ...shared].filter((k): k is LevelName => k !== 'pin' && k !== 'maxPain');
                const armed = keys.map(k => watched(k)).filter((a): a is NonNullable<typeof a> => !!a);
                const words = say(keys.map(k => KEY_LEVEL_WORDS[k].name.toLowerCase()));
                const toggleBell = () => {
                  const t = snapshot.ticker;
                  if (armed.length) {
                    const gone = armed;
                    gone.forEach(a => removeAlert(t, a.id));
                    undoable({ label: `Bell off the ${words} ${fmtStrike(levelHot.price)}`, undo: () => gone.forEach(a => a.kind === 'level' && armLevel(t, a.level)), key: `tape-bell-${levelHot.key}` });
                  } else {
                    const set = keys.map(k => armLevel(t, k)).filter((a): a is NonNullable<typeof a> => !!a);
                    undoable({ label: `Bell set on the ${words} ${fmtStrike(levelHot.price)}`, undo: () => set.forEach(a => removeAlert(t, a.id)), key: `tape-bell-${levelHot.key}` });
                  }
                };
                /* the centring on a wrapper of its own: the soft-in's travel is a transform, and on the card itself it
                   would run the half-height centring too — a slide of half the card instead of three pixels */
                return (
                  <div key={levelHot.key} className="absolute z-20" style={{ right: scaleW + LADDER_HIT_W + 6, top: levelHot.y, transform: 'translateY(-50%)' }}>
                  <div
                    className={`w-[224px] rounded-md border border-borderSubtle px-2.5 py-2 font-mono text-t11 text-textSecondary ${levelClosing ? 'animate-chart-card-out' : 'animate-soft-in'}`}
                    style={{ background: 'rgba(8,8,10,0.92)', backdropFilter: 'blur(3px)' }}
                    data-theme="dark"
                    data-chart-glass
                    data-key-level-card={levelHot.key}
                    onPointerEnter={() => {
                      overCard.current = true;
                      window.clearTimeout(levelLeave.current);
                      setLevelClosing(false);
                    }}
                    onPointerLeave={() => {
                      overCard.current = false;
                      leaveLevel(120);
                    }}
                    onClick={e => e.stopPropagation()}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold" style={{ color: ink }}>
                        {w.name}
                      </span>
                      <span className="tnum font-semibold text-textPrimary">{fmtStrike(levelHot.price)}</span>
                    </div>
                    <div className="text-textMuted">
                      {aside}
                      {dist != null ? ` · ${dist >= 0 ? '+' : '−'}${Math.abs(dist).toFixed(2)}% ${dist >= 0 ? 'above' : 'below'} spot` : ''}
                    </div>
                    <p className="mt-1 leading-snug text-textSecondary">{w.line}</p>
                    <div className="mt-1.5 flex items-center gap-1">
                      <button type="button" onClick={() => onPick(levelHot.price)} aria-pressed={kept} className={`hit h-6 px-2 rounded-md text-t11 transition-colors ${kept ? 'bg-silver/[0.12] text-silver' : 'text-textPrimary hover:bg-ink/[0.06]'}`} data-tape-tag={levelHot.key}>
                        {kept ? 'Kept · let go' : 'Keep the strike'}
                      </button>
                      <button
                        type="button"
                        onClick={toggleBell}
                        aria-pressed={armed.length > 0}
                        title={armed.length ? `Watching the ${words} — click to stop` : `Tell me when price crosses the ${words}`}
                        className={`hit ml-auto inline-flex h-6 items-center gap-1 px-2 rounded-md text-t11 transition-colors ${armed.length ? 'bg-silver/[0.1] text-silver' : 'text-textMuted hover:bg-ink/[0.06] hover:text-textPrimary'}`}
                        data-tape-alert={keys.join('+')}
                        data-watching={armed.length ? '' : undefined}
                      >
                        {armed.length ? <BellRing className="w-3 h-3" /> : <Bell className="w-3 h-3" />}
                        {armed.length ? 'Watching' : 'Bell'}
                      </button>
                    </div>
                  </div>
                  </div>
                );
              })()}
            {/* the kept strike's tag at the edge it lies beyond, beside the scale — silver, the line's own ink */}
            {focus != null && keptOff && (
              <div
                className="pointer-events-none absolute z-10 whitespace-nowrap rounded-sm border border-silver/50 bg-panel/90 px-1.5 py-0.5 font-mono text-t11 text-silver"
                style={{ right: scaleW + 8, ...(keptOff === 'up' ? { top: 4 } : { bottom: 4 }) }}
                data-tape-kept-edge={keptOff}
              >
                {keptOff === 'up' ? '▲' : '▼'} Kept {fmtStrike(focus)} · {Math.abs(focus - spot).toFixed(2)} {keptOff === 'up' ? 'above' : 'below'}
              </div>
            )}
            {bars.length > 0 && tapeNote && (
              <div className={`pointer-events-none absolute left-2 bottom-9 z-10 rounded-md border border-borderSubtle bg-panel/90 px-2 py-0.5 font-mono text-t11 ${/offline/i.test(tapeNote) ? 'text-warn' : 'text-textMuted'}`} data-tape-note>
                {tapeNote}
              </div>
            )}
            {bars.length === 0 && (
              <div className="absolute inset-0 grid place-items-center px-4 text-center font-mono text-t11 uppercase tracking-widest text-textMuted" data-tape-note={tapeNote ? '' : undefined}>
                {tapeNote ?? 'No bars yet this session'}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

export default TapeBox;
