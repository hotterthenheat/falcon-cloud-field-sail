/* The session's calls as a trader follows them: the underlying's one-minute line with each call marked at the minute it
   fired and its exit where it left, and under it every event (the call, the stop lifting, the take-profit, the exit),
   newest first, in New York time. Picking an event lights its mark here and its card on the board. Display only: the
   marks and events are the record's (data/compassCalls.ts). */

import { useEffect, useMemo, useRef, useState } from 'react';
import { LineSeries, LineStyle, createChart, type IChartApi, type ISeriesApi, type Time, type UTCTimestamp } from 'lightweight-charts';
import type { Signal } from '../../data/compassLedger';
import { BOOK_INK, eventClock, pctWord, sessionEvents, sideGlyph, type CallEvent } from '../../data/compassCalls';
import { BOOK_NAME, printOf } from '../../data/compassParams';
import { underCloses } from '../../data/compassModel';
import { nyClock, nyDay, nyWallTime } from '../../core/nyTime';
import { readToken, useResolvedTheme } from '../../theme/theme';
import { dayChartOptions, daySurface } from '../gex/dayChart';
import FilterTabs from '../ui/FilterTabs';
import { CallMarksPrimitive, type CallMark } from './callMarksPrimitive';

interface SessionCallsProps {
  /** The session's calls on the board, any name */
  calls: Signal[];
  /** The session, YYYY-MM-DD, and whether it is today's */
  day: string;
  live: boolean;
  /** The name on the chart (a root: SPXW and SPX draw the same line) */
  ticker: string;
  /** The picked event's key */
  hotKey: string | null;
  onPick: (e: CallEvent) => void;
}

/** The underlying a root draws on: SPXW and SPX are one line. */
export const lineOf = (ticker: string) => printOf(ticker);

const dayDate = (iso: string) => nyWallTime(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), Number(iso.slice(8, 10)), 12);

type Bars = { key: string; points: { time: number; value: number }[]; status: 'loading' | 'ready' | 'empty' };

const SessionCalls = ({ calls, day, live, ticker, hotKey, onPick }: SessionCallsProps) => {
  const paper = useResolvedTheme() === 'light';
  const name = lineOf(ticker);
  const [scope, setScope] = useState<'all' | 'name'>('all');
  const events = useMemo(() => sessionEvents(calls), [calls]);
  const shown = scope === 'name' ? events.filter(e => lineOf(e.sig.ticker) === name) : events;
  const hot = hotKey ? events.find(e => e.key === hotKey) ?? null : null;
  const onLine = useMemo(() => calls.filter(c => lineOf(c.ticker) === name), [calls, name]);
  const books = useMemo(() => (['A', 'B', 'C'] as const).filter(b => calls.some(c => c.book === b)), [calls]);

  /* the underlying's minutes on the session */
  const barsKey = `${ticker}|${day}`;
  const [bars, setBars] = useState<Bars>({ key: '', points: [], status: 'loading' });
  useEffect(() => {
    let dead = false;
    setBars(b => (b.key === barsKey ? b : { key: barsKey, points: [], status: 'loading' }));
    const read = () =>
      underCloses(ticker, day.replace(/-/g, ''))
        .then(rows => {
          if (dead) return;
          const points = rows.filter(r => r.c > 0).map(r => ({ time: Math.floor(r.t / 1000), value: r.c }));
          setBars({ key: barsKey, points, status: points.length ? 'ready' : 'empty' });
        })
        .catch(() => {
          if (!dead) setBars({ key: barsKey, points: [], status: 'empty' });
        });
    void read();
    /* today's line grows: read again each minute */
    const id = live ? window.setInterval(read, 60_000) : 0;
    return () => {
      dead = true;
      if (id) window.clearInterval(id);
    };
  }, [barsKey, ticker, day, live]);
  const points = bars.key === barsKey ? bars.points : [];

  /* the chart, once per host and theme */
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const marksRef = useRef<CallMarksPrimitive | null>(null);
  const [made, setMade] = useState(0);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const s = daySurface(host, paper);
    const chart = createChart(host, dayChartOptions(s, { clock: true, logo: false }));
    chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.22, bottom: 0.18 } });
    const series = chart.addSeries(LineSeries, {
      color: readToken('--text-secondary', undefined, host),
      lineWidth: 2,
      priceLineVisible: true,
      priceLineStyle: LineStyle.Dotted,
      lastValueVisible: true,
      crosshairMarkerRadius: 3,
    });
    const marks = new CallMarksPrimitive();
    series.attachPrimitive(marks);
    chartRef.current = chart;
    seriesRef.current = series;
    marksRef.current = marks;
    setMade(n => n + 1);
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      marksRef.current = null;
    };
  }, [paper]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.setData(points.map(p => ({ time: p.time as UTCTimestamp, value: p.value })));
    chartRef.current?.timeScale().fitContent();
  }, [points, made]);

  /* the bar a minute sits on: the last at or before it */
  const barAt = useMemo(() => {
    const times = points.map(p => p.time);
    return (ms: number): { time: number; value: number } | null => {
      const t = Math.floor(ms / 60_000) * 60;
      let lo = 0;
      let hi = times.length - 1;
      let at = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (times[mid] <= t) {
          at = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      if (at < 0 || t - times[at] > 5 * 60) return null;
      return points[at];
    };
  }, [points]);

  const markList = useMemo<CallMark[]>(() => {
    const host = hostRef.current;
    return onLine.flatMap(sig => {
      const bar = barAt(sig.firedAt);
      if (!bar) return [];
      const exitAt = sig.outcome?.status === 'closed' ? sig.outcome.exit?.at ?? null : null;
      const out = exitAt != null ? barAt(exitAt) : null;
      return [{
        key: sig.key,
        time: bar.time,
        price: bar.value,
        text: `${nyClock(sig.firedAt)} ${sideGlyph(sig.right)}`,
        up: sig.right === 'C',
        ink: readToken(BOOK_INK[sig.book].token, undefined, host),
        exit: out && exitAt != null ? { time: out.time, price: out.value, text: `OUT ${nyClock(exitAt)}` } : null,
      }];
    });
  }, [onLine, barAt, made]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const marks = marksRef.current;
    const host = hostRef.current;
    if (!marks || !host) return;
    const step = hot && (hot.kind === 'breakeven' || hot.kind === 'ratchet') && lineOf(hot.sig.ticker) === name ? barAt(hot.at) : null;
    marks.setData({
      marks: markList,
      hot: hot && lineOf(hot.sig.ticker) === name ? hot.sig.key : null,
      rule: step && hot ? { time: step.time, text: `${hot.tag.toUpperCase()} ${eventClock(hot)}`, ink: readToken(BOOK_INK[hot.sig.book].token, undefined, host) } : null,
      bg: daySurface(host, paper).bg,
    });
  }, [markList, hot, name, barAt, paper, made]);

  /* a click on a chip picks its call (or its exit) */
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const lookRef = useRef({ markList, events });
  lookRef.current = { markList, events };
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    const onClick = (param: { point?: { x: number; y: number } }) => {
      if (!param.point) return;
      const { x, y } = param.point;
      let best: { key: string; d: number } | null = null;
      for (const m of lookRef.current.markList) {
        for (const [time, price, key] of [[m.time, m.price, `${m.key}|call`], ...(m.exit ? [[m.exit.time, m.exit.price, `${m.key}|exit`]] : [])] as [number, number, string][]) {
          const mx = chart.timeScale().timeToCoordinate(time as Time);
          const my = series.priceToCoordinate(price);
          if (mx == null || my == null) continue;
          /* the chip stands up to ~70px off its point: a click on its column counts */
          const dx = Math.abs(mx - x);
          const dy = Math.abs(my - y);
          if (dx > 34 || dy > 80) continue;
          const d = dx + dy / 4;
          if (!best || d < best.d) best = { key, d };
        }
      }
      const e = best ? lookRef.current.events.find(ev => ev.key === best!.key) : null;
      if (e) pickRef.current(e);
    };
    chart.subscribeClick(onClick);
    return () => {
      try {
        chart.unsubscribeClick(onClick);
      } catch {
        /* the chart is gone already */
      }
    };
  }, [made]);

  /* the picked event in view in its list */
  const listRef = useRef<HTMLUListElement | null>(null);
  useEffect(() => {
    if (!hotKey) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-call-event="${CSS.escape(hotKey)}"]`);
    const list = listRef.current;
    if (!row || !list) return;
    /* the list is the rows' offset parent */
    const top = row.offsetTop;
    if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = Math.max(0, top - 8);
  }, [hotKey]);

  const dayWord = nyDay(dayDate(day), { weekday: true });
  const none = !onLine.length;

  return (
    <section className="border-t border-borderSubtle" data-session-calls={day} data-session-live={live || undefined}>
      <div className="px-4 sm:px-5 pt-3 pb-2 flex items-baseline gap-x-3 gap-y-1 flex-wrap min-w-0">
        <span className="font-mono text-t10 uppercase tracking-widest text-textPrimary">Calls on the chart</span>
        <span className="min-w-0 font-mono text-t10 text-textMuted" data-calls-name={name}>
          {name} · {dayWord} · one-minute closes{live ? '' : ' · the last session with calls, not live'}
        </span>
        <span className="ml-auto flex items-center gap-3 flex-wrap" data-calls-legend>
          {books.map(b => (
            <span key={b} className="inline-flex items-center gap-1.5 font-mono text-t10 text-textSecondary">
              <span className={`w-2 h-2 rounded-full ${BOOK_INK[b].dot}`} aria-hidden />
              {BOOK_NAME[b]}
            </span>
          ))}
          <span className="font-mono text-t10 text-textMuted">▲ call · ▼ put · □ exit</span>
        </span>
      </div>
      <div className="px-4 sm:px-5">
        <div className="relative h-[240px] max-sm:h-[210px] rounded-md border border-borderSubtle overflow-hidden" data-calls-chart={name} data-calls-marks={markList.length}>
          <div ref={hostRef} className="absolute inset-0" />
          {bars.status !== 'ready' && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="font-mono text-t11 text-textMuted">{bars.status === 'loading' ? `Reading ${name}'s minutes` : `No minute bars for ${name} on ${dayWord}.`}</span>
            </div>
          )}
          {bars.status === 'ready' && none && (
            <div className="absolute left-3 top-2 pointer-events-none">
              <span className="font-mono text-t10 text-textMuted">No call on {name} this session.</span>
            </div>
          )}
        </div>
      </div>
      <div className="px-4 sm:px-5 pt-3 pb-2 flex items-center gap-3 flex-wrap">
        <span className="font-mono text-t10 uppercase tracking-widest text-textPrimary">Events</span>
        <span className="font-mono text-t10 text-textMuted">Newest first · New York time</span>
        <span className="ml-auto">
          <FilterTabs
            size="sm"
            ariaLabel="Which calls the events list"
            value={scope}
            onChange={setScope}
            options={[{ value: 'all', label: 'Every name' }, { value: 'name', label: name }]}
          />
        </span>
      </div>
      {shown.length ? (
        <ul ref={listRef} className="relative max-h-64 overflow-y-auto border-t border-borderSubtle/60" data-call-events={shown.length}>
          {shown.map(e => (
            <EventRow key={e.key} e={e} hot={e.key === hotKey} sameCall={!!hot && hot.sig.key === e.sig.key} onPick={onPick} />
          ))}
        </ul>
      ) : (
        <p className="px-4 sm:px-5 py-3 border-t border-borderSubtle/60 font-mono text-t11 text-textMuted">No call on {name} this session.</p>
      )}
    </section>
  );
};

const TAG_INK: Record<CallEvent['kind'], string> = {
  call: 'text-textPrimary border-borderMuted',
  breakeven: 'text-textSecondary border-borderSubtle',
  ratchet: 'text-textSecondary border-borderSubtle',
  exit: 'text-textPrimary border-borderMuted',
};

const EventRow = ({ e, hot, sameCall, onPick }: { e: CallEvent; hot: boolean; sameCall: boolean; onPick: (e: CallEvent) => void }) => {
  const ink = BOOK_INK[e.sig.book];
  const tp = e.kind === 'exit' && e.tag === 'Take profit';
  return (
    <li
      role="button"
      tabIndex={0}
      aria-pressed={hot}
      onClick={() => onPick(e)}
      onKeyDown={k => {
        if (k.key === 'Enter' || k.key === ' ') {
          k.preventDefault();
          onPick(e);
        }
      }}
      className={`px-4 sm:px-5 py-1.5 border-b border-borderSubtle/40 flex items-start gap-3 max-sm:gap-2 min-w-0 cursor-pointer transition-colors outline-none focus-visible:bg-ink/[0.05] ${
        hot ? 'bg-ink/[0.06] shadow-[inset_2px_0_0_rgb(var(--silver))]' : sameCall ? 'bg-ink/[0.025] hover:bg-ink/[0.04]' : 'hover:bg-ink/[0.03]'
      }`}
      data-call-event={e.key}
      data-call-kind={e.kind}
      data-hot={hot || undefined}
    >
      <span className="w-11 shrink-0 font-mono text-t11 tnum text-textPrimary" title={e.inMinute ? 'Read at this minute: the step came on a one-second quote inside it.' : undefined}>{eventClock(e)}</span>
      <span className={`shrink-0 w-[96px] max-sm:w-[80px] truncate font-mono text-t9 uppercase tracking-wider border rounded px-1.5 py-px text-center ${tp ? 'text-bull border-bull/40' : TAG_INK[e.kind]}`}>{e.tag}</span>
      <span className="min-w-0 flex-1 flex items-start gap-1.5">
        <span className={`mt-[5px] w-2 h-2 shrink-0 rounded-full ${ink.dot}`} aria-hidden />
        <span className="min-w-0 font-mono text-t11 text-textSecondary whitespace-normal break-words">
          {e.kind !== 'call' && <span className="text-textPrimary">{lineOf(e.sig.ticker)} {e.sig.contract.replace(/^\S+\s*/, '')} · </span>}
          {e.text}
          {e.ret != null && <span className={`tnum font-semibold ${e.ret > 0 ? 'text-bull' : e.ret < 0 ? 'text-bear' : 'text-textPrimary'}`}> · {pctWord(e.ret)}</span>}
        </span>
      </span>
    </li>
  );
};

export default SessionCalls;
