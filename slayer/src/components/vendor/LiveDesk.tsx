import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { createChart, LineSeries, LineStyle, type IChartApi, type ISeriesApi, type Time, type UTCTimestamp } from 'lightweight-charts';
import { BULL, PUT_WALL, SILVER_FILL, resolveInk } from '../gex/paletteInk';
import { dayChartOptions, daySurface } from '../gex/dayChart';
import { besideDot } from '../gex/besideDot';
import { hhmm } from '../../data/ahead';
import { nyIsoDate, nyMinutes } from '../../core/nyTime';
import { expirySpan } from '../../data/bookWindow';
import { bookToday, isoDate } from '../../core/calendar';
import { uwCall } from '../../data/whales';
import { useResolvedTheme } from '../../theme/theme';
import { useVendor, type VendorBook, type VendorRow } from '../../data/vendorFeed';
import { PageBar } from '../ui/PageBar';

/*
  Live readings, only where the page is already about them.
  Nothing is mounted on a route that does not ask the question.

    Map        under the book: max pain, the minute delta and vega,
               NOPE, volume by expiry. One name spans the page.
               Two or more, one column a name.
    Building   the contracts whose open interest changed today, under
               the ledger. FLEX only when a contract actually moved.
    Earnings   implied against realized, and the term — once it has
               arrived. Never a box that says it is still reading.
    Stocks     the last income figures, inside The numbers. Not a
               second head, not the street, not a seasonality chart.
    News       nothing drawn. FDA, the schedule and the posts are
               written onto the month.
    Shorts     interest across the reports, under the short file
    Houses     where the book sits by sector, weights from the values

  A chart, when one is earned, is the day's own library.
*/

const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
};

const compact = (v: number): string => {
  const a = Math.abs(v);
  const s = v < 0 ? '−' : '';
  if (a >= 1e12) return `${s}${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}k`;
  if (a >= 100) return `${s}${a.toFixed(0)}`;
  if (a >= 1) return `${s}${a.toFixed(2)}`;
  return `${s}${a.toFixed(3)}`;
};

const asPct = (v: number | null): number | null => (v == null ? null : Math.abs(v) <= 3 ? v * 100 : v);
const pct = (v: number): string => `${(asPct(v) ?? v).toFixed(1)}%`;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function taken(book: VendorBook, id: string): VendorRow | null {
  return book.rows.find(r => r.id === id) ?? null;
}

function series(row: VendorRow | null): Record<string, unknown>[] {
  if (!row || row.state !== 'live') return [];
  const data = row.data;
  if (Array.isArray(data)) return data.filter(isObj);
  if (isObj(data) && Array.isArray(data.history)) return data.history.filter(isObj);
  if (isObj(data)) {
    const lists = Object.values(data).filter((v): v is unknown[] => Array.isArray(v) && v.some(isObj));
    if (lists.length === 1) return lists[0].filter(isObj);
    return [data];
  }
  return [];
}

function latest(row: VendorRow | null): Record<string, unknown> | null {
  if (!row || row.state !== 'live' || !isObj(row.data)) {
    const list = series(row);
    return list[list.length - 1] ?? null;
  }
  if (isObj(row.data.latest)) return row.data.latest;
  const list = series(row);
  return list[list.length - 1] ?? row.data;
}

function thin<T>(rows: T[], max = 140): T[] {
  if (rows.length <= max) return rows;
  const step = Math.ceil(rows.length / max);
  return rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
}

function epoch(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v > 1e12 ? Math.floor(v / 1000) : Math.floor(v);
  if (typeof v === 'string' && v.trim()) {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return Math.floor(t / 1000);
  }
  return null;
}

function asSec(t: Time): number {
  if (typeof t === 'number') return t;
  if (typeof t === 'string') {
    const n = Date.parse(t);
    return Number.isFinite(n) ? Math.floor(n / 1000) : 0;
  }
  return Math.floor(Date.UTC(t.year, t.month - 1, t.day) / 1000);
}

interface Pt {
  t: number;
  v: number;
  label?: string;
}

interface LineSpec {
  name: string;
  ink: string;
  pts: Pt[];
}

/** One chart, the day's own options. Categorical prints (an expiry, a month) label the clock themselves.
    The glass card is the day's own — the minute or the expiry, and each line's figure — and it stays on THIS pane. */
function HouseChart({ lines, height = 180, format = 'compact' }: { lines: LineSpec[]; height?: number; format?: 'compact' | 'pct' | 'num' }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const theme = useResolvedTheme();
  const sig = lines.map(l => `${l.name}:${l.ink}:${l.pts.map(p => `${p.t}=${p.v}`).join(',')}`).join('|') + format;
  const [hover, setHover] = useState<{ x: number; y: number; label: string; rows: { name: string; text: string; ink: string }[] } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const drawn = linesRef.current.filter(l => l.pts.length >= 2);
    if (!host || drawn.length === 0) return;
    const paper = theme === 'light';
    const s = daySurface(host, paper);
    const opts = dayChartOptions(s, { clock: true, logo: true });
    const labels = new Map<number, string>();
    for (const l of drawn) for (const p of l.pts) if (p.label) labels.set(p.t, p.label);
    if (labels.size) {
      const fmt = (t: Time) => {
        const s = asSec(t);
        const exact = labels.get(s);
        if (exact) return exact;
        let best = '';
        let dist = Infinity;
        for (const [k, v] of labels) {
          const d = Math.abs(k - s);
          if (d < dist) {
            dist = d;
            best = v;
          }
        }
        return best;
      };
      opts.localization = { timeFormatter: fmt };
      /* the chart spaces its ticks for its own short clock labels — a categorical label ("2021-06-15") is wider, so the
         first ticks ran into each other ("2021-06-152021-10-29"); tell it how wide ours are */
      const widest = Math.max(...[...labels.values()].map(v => v.length));
      opts.timeScale = { ...opts.timeScale, tickMarkFormatter: fmt, tickMarkMaxCharacterLength: widest + 1 };
    }
    const chart: IChartApi = createChart(host, opts);
    const formatter = (p: number) => (format === 'pct' ? `${p.toFixed(1)}%` : format === 'num' ? (Math.abs(p) >= 100 ? p.toFixed(0) : p.toFixed(2)) : compact(p));
    const series: ISeriesApi<'Line'>[] = [];
    let zero = false;
    drawn.forEach((l, i) => {
      const one = chart.addSeries(LineSeries, {
        color: resolveInk(l.ink, host),
        lineWidth: 2,
        priceLineVisible: false,
        /* ONE LINE: its last value on the axis. SEVERAL: their names and last values in a legend over the chart (the
           second re-audit, 2026-10-22: the axis tags stacked — "Vega" sat over the 0.000 tick, and "Puts" had a name and
           no value) */
        lastValueVisible: drawn.length === 1,
        crosshairMarkerRadius: 3,
        title: '',
        priceFormat: { type: 'custom', formatter, minMove: 0.01 },
      });
      one.setData(l.pts.map(p => ({ time: p.t as UTCTimestamp, value: p.v })));
      series.push(one);
      if (!zero && l.pts.some(p => p.v < 0) && l.pts.some(p => p.v > 0)) {
        one.createPriceLine({ price: 0, color: s.zero, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
        zero = true;
      }
    });
    chart.timeScale().fitContent();
    chart.subscribeCrosshairMove(param => {
      if (!param.sourceEvent || param.point == null || param.time == null) {
        setHover(null);
        return;
      }
      const t = asSec(param.time);
      const now = linesRef.current.filter(l => l.pts.length >= 2);
      const rows: { name: string; text: string; ink: string }[] = [];
      let y = param.point.y;
      now.forEach((l, i) => {
        const pt = l.pts.find(p => p.t === t);
        if (!pt) return;
        rows.push({ name: l.name, text: formatter(pt.v), ink: resolveInk(l.ink, host) });
        const cy = series[i]?.priceToCoordinate(pt.v);
        if (i === 0 && cy != null) y = cy;
      });
      if (!rows.length) {
        setHover(null);
        return;
      }
      const labelled = labels.get(t);
      setHover({ x: param.point.x, y, label: labelled || hhmm(nyMinutes(t * 1000)), rows });
    });
    return () => chart.remove();
  }, [sig, theme, format]);

  if (lines.every(l => l.pts.length < 2)) return null;
  const plotW = hostRef.current?.clientWidth ?? 0;
  const legend = lines.filter(l => l.pts.length >= 2);
  const fmtLast = (v: number) => (format === 'pct' ? `${v.toFixed(1)}%` : format === 'num' ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)) : compact(v));
  return (
    <>
    {legend.length > 1 && (
      <div className="px-5 pb-1 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[11px] tnum" data-house-legend>
        {legend.map(l => (
          <span key={l.name} className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
            <span aria-hidden className="inline-block w-2.5 h-[2px] rounded-full self-center" style={{ background: l.ink }} />
            <span className="text-textMuted">{l.name}</span>
            {/* a series by expiry is a set of dates, not a clock: its total; a series in time: its last print */}
            <span style={{ color: l.ink }}>{fmtLast(l.pts[0].label ? l.pts.reduce((a, p) => a + p.v, 0) : l.pts[l.pts.length - 1].v)}</span>
            <span className="text-textMuted">{l.pts[0].label ? 'total' : 'last'}</span>
          </span>
        ))}
      </div>
    )}
    <div className="relative w-full" style={{ height }} data-house-chart>
      <div ref={hostRef} className="absolute inset-0" />
      {hover && (
        <div
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md border border-borderSubtle px-2.5 py-1.5 font-mono text-[11px] text-textSecondary"
          style={{ ...besideDot(hover.x, hover.y, hover.x > plotW / 2), background: 'rgba(8,8,10,0.88)', backdropFilter: 'blur(3px)' }}
          data-theme="dark"
          data-chart-glass
          data-house-card={hover.label}
        >
          <span className="font-bold tnum text-textPrimary">{hover.label}</span>
          {hover.rows.map(r => (
            <span key={r.name} className="ml-2 tnum" style={{ color: r.ink }}>
              {hover.rows.length > 1 ? `${r.name} ` : ''}
              {r.text}
            </span>
          ))}
        </div>
      )}
    </div>
    </>
  );
}

interface Field {
  key: string;
  name: string;
  ink: string;
}

/** Rows into line specs. A real timestamp keeps the session clock; anything else is labelled on the axis. */
/** "2026-10-22" → "Oct 22", the date form every other Pinpoint label wears */
const shortDay = (iso: string): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : iso || '—';

function stamps(rows: Record<string, unknown>[], timeKey: string, fields: Field[]): LineSpec[] {
  const base = Math.floor(Date.UTC(2024, 0, 2) / 1000);
  const pts: { t: number; label?: string; vals: Record<string, number> }[] = [];
  let fake = 0;
  for (const r of rows) {
    const vals: Record<string, number> = {};
    let ok = false;
    for (const f of fields) {
      const n = num(r[f.key]);
      if (n == null) continue;
      vals[f.key] = n;
      ok = true;
    }
    if (!ok) continue;
    const t0 = epoch(r[timeKey]);
    let label: string | undefined;
    let t = t0;
    if (t == null) {
      label = String(r[timeKey] ?? '').slice(0, 16) || String(fake + 1);
      t = base + fake * 86400;
      fake += 1;
    } else if (timeKey !== 'timestamp') {
      const day = String(r[timeKey] ?? '').slice(0, 10);
      /* an expiry is a near date — "Oct 22", the form every other label wears; long histories keep the year */
      label = timeKey === 'expiry' ? shortDay(day) : day;
    }
    pts.push({ t, label, vals });
  }
  /* Time series sort onto the clock. An expiry list sorts by date too, then
     each expiry takes one equal slot — a calendar axis crushes the dailies
     on the left and throws the far months across the plot, so the ticks
     look like a random sample of dates. */
  pts.sort((a, b) => a.t - b.t);
  const listed = pts.length > 0 && pts.every(p => p.label);
  if (listed) {
    pts.forEach((p, i) => {
      p.t = base + i * 86400;
    });
  } else {
    let lastT = 0;
    for (const p of pts) {
      if (p.t <= lastT) p.t = lastT + 60;
      lastT = p.t;
    }
  }
  return fields.map(f => ({
    name: f.name,
    ink: f.ink,
    pts: pts.filter(p => p.vals[f.key] != null).map(p => ({ t: p.t, v: p.vals[f.key], label: p.label })),
  }));
}

function show(v: unknown): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'string' && /T\d{2}:\d{2}/.test(v)) return v.replace('T', ' ').slice(0, 16);
  const n = num(v);
  if (n != null && typeof v === 'number' && Math.abs(n) >= 1000) return compact(n);
  if (n != null && typeof v === 'string' && v.length > 8) return compact(n);
  return String(v);
}

/** The file's section head: tracked capitals, a quieter rest, one line. */
function Head({ title, rest }: { title: string; rest?: string }) {
  return (
    <div className="px-5 border-t border-borderSubtle/60">
      <div className="h-[26px] flex items-center gap-3 text-[10px] font-semibold uppercase tracking-widest text-textPrimary min-w-0 max-sm:h-auto max-sm:flex-col max-sm:items-start max-sm:gap-0.5 max-sm:py-1.5">
        <span className="shrink-0">{title}</span>
        {rest ? <span className="normal-case tracking-normal font-normal text-[10px] text-textSecondary truncate">{rest}</span> : null}
      </div>
    </div>
  );
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="px-5 py-3 font-mono text-[10px] uppercase tracking-widest text-textMuted">{children}</p>;
}

/** Hairline rows — the name file and the news wire, not a second table. */
function Rows({ cols, rows, max = 8 }: { cols: { key: string; label: string; right?: boolean; w?: string }[]; rows: Record<string, unknown>[]; max?: number }) {
  const body = rows.slice(0, max);
  const template = cols.map(c => c.w ?? (c.right ? '72px' : 'minmax(0,1fr)')).join(' ');
  if (body.length === 0) return <Quiet>Nothing to list</Quiet>;
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[360px]">
        <div className="px-5 h-[20px] grid items-center gap-x-3 font-mono text-[9px] uppercase tracking-widest text-textMuted" style={{ gridTemplateColumns: template }}>
          {cols.map(c => (
            <span key={c.key} className={c.right ? 'text-right truncate' : 'truncate'}>
              {c.label}
            </span>
          ))}
        </div>
        {body.map((r, i) => (
          <div key={i} className="px-5 h-[34px] grid items-center gap-x-3 border-t border-borderSubtle/40" style={{ gridTemplateColumns: template }}>
            {cols.map(c => {
              const text = show(r[c.key]);
              return (
                <span key={c.key} title={text} className={`min-w-0 truncate ${c.right ? 'text-right font-mono text-[11px] tnum text-textSecondary' : 'font-mono text-[12px] text-textPrimary'}`}>
                  {text}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

const dayOf = (r: Record<string, unknown>): string => String(r.expiry ?? r.expires ?? '').slice(0, 10);

/** A replay stands at one minute. Charts of the session stop there; an expiry list does not. */
function cutAt(rows: Record<string, unknown>[], at: number | null | undefined): Record<string, unknown>[] {
  if (at == null) return rows;
  return rows.filter(r => {
    const t = epoch(r.timestamp ?? r.time);
    if (t == null) return true;
    return nyMinutes(t * 1000) <= at;
  });
}

/* Delta and vega for the expiries in the window, summed by minute. The
   vendor's greek-flow row is the whole book; one expiry is its own call. */
const flowCache = new Map<string, Record<string, unknown>[]>();
const flowWait = new Map<string, Promise<void>>();
const flowSubs = new Set<() => void>();

function useWindowFlow(ticker: string, key: string): Record<string, unknown>[] | null {
  const t = ticker.toUpperCase();
  const cacheKey = key ? `${t}|vol|${key}` : '';
  useEffect(() => {
    if (!cacheKey || flowCache.has(cacheKey) || flowWait.has(cacheKey)) return;
    const dates = key.split(',').filter(Boolean);
    const job = (async () => {
      let out: Record<string, unknown>[] = [];
      try {
        const parts = await Promise.all(
          dates.map(async d => {
            const res = await uwCall(`/stock/${encodeURIComponent(t)}/greek-flow/${encodeURIComponent(d)}`);
            return Array.isArray(res.data) ? res.data.filter(isObj) : [];
          })
        );
        const acc = new Map<string, { dir_delta_flow: number; dir_vega_flow: number; volume: number }>();
        for (const rows of parts) {
          for (const r of rows) {
            const ts = String(r.timestamp ?? '');
            if (!ts) continue;
            const cur = acc.get(ts) ?? { dir_delta_flow: 0, dir_vega_flow: 0, volume: 0 };
            const dd = num(r.dir_delta_flow);
            const dv = num(r.dir_vega_flow);
            const vol = num(r.volume);
            if (dd != null) cur.dir_delta_flow += dd;
            if (dv != null) cur.dir_vega_flow += dv;
            if (vol != null) cur.volume += vol;
            acc.set(ts, cur);
          }
        }
        out = [...acc.entries()]
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([timestamp, v]) => ({ timestamp, dir_delta_flow: v.dir_delta_flow, dir_vega_flow: v.dir_vega_flow, volume: v.volume }));
      } catch {
        out = [];
      }
      flowCache.set(cacheKey, out);
      flowSubs.forEach(fn => fn());
    })().finally(() => {
      flowWait.delete(cacheKey);
    });
    flowWait.set(cacheKey, job);
  }, [cacheKey, key, t]);
  return useSyncExternalStore(
    fn => {
      flowSubs.add(fn);
      return () => {
        flowSubs.delete(fn);
      };
    },
    () => (cacheKey ? (flowCache.get(cacheKey) ?? null) : null),
    () => null
  );
}

/** The book's NOPE, given to the expiries in the window by their share of the
    option volume. The feed publishes one NOPE for the whole book — net delta
    over the stock's volume — and does not split it. Delta flow cancels across
    expiries, so the share is the volume, which stays inside the book. The whole
    listed set is the published series unchanged. */
function nopeForWindow(rows: Record<string, unknown>[], bookFlow: Record<string, unknown>[], windowFlow: Record<string, unknown>[]): Record<string, unknown>[] {
  const add = (into: Map<string, number>, list: Record<string, unknown>[]) => {
    for (const r of list) {
      const ts = String(r.timestamp ?? '');
      const v = num(r.volume);
      if (!ts || v == null) continue;
      into.set(ts, (into.get(ts) ?? 0) + v);
    }
  };
  const book = new Map<string, number>();
  const win = new Map<string, number>();
  add(book, bookFlow);
  add(win, windowFlow);
  const times = [...new Set([...book.keys(), ...win.keys()])].sort();
  let cumB = 0;
  let cumW = 0;
  const share = new Map<string, number>();
  for (const ts of times) {
    cumB += book.get(ts) ?? 0;
    cumW += win.get(ts) ?? 0;
    if (cumB > 0) share.set(ts, cumW / cumB);
  }
  const flowTimes = [...share.keys()];
  let i = 0;
  let last = 0;
  return [...rows]
    .sort((a, b) => String(a.timestamp ?? '').localeCompare(String(b.timestamp ?? '')))
    .map(r => {
      const ts = String(r.timestamp ?? '');
      while (i < flowTimes.length && flowTimes[i] <= ts) {
        last = share.get(flowTimes[i]) ?? last;
        i += 1;
      }
      const n = num(r.nope);
      return n == null ? { ...r } : { ...r, nope: n * last };
    });
}

/** The session the matrix does not draw. One column, the book's width. Every name on the map gets its own.
    `dates` is the book's expiry window — max pain, volume, NOPE and the minute's delta and vega read those dates. */
export function MapReadings({ ticker, dates, at }: { ticker: string; dates?: readonly string[] | null; at?: number | null }) {
  const book = useVendor('pinpoint', ticker, '/pinpoint/map');
  const today = nyIsoDate();
  const listedDays = stillListed(series(taken(book, 'flow-expiry')), today).map(dayOf);
  const wantList = (dates ?? []).map(d => d.slice(0, 10)).filter(Boolean);
  const want = new Set(wantList);
  const coversAll = listedDays.length > 0 && listedDays.every(d => want.has(d));
  const windowed = want.size > 0 && !coversAll;
  const summed = useWindowFlow(ticker, windowed ? wantList.join(',') : '');
  if (!ticker) return null;
  const still = (rows: Record<string, unknown>[]) => stillListed(rows, today).filter(r => !windowed || want.has(dayOf(r)));
  const painRows = still(series(taken(book, 'max-pain'))).sort((a, b) => dayOf(a).localeCompare(dayOf(b)));
  const pain = painRows[0];
  const painLine = stamps(painRows, 'expiry', [{ key: 'max_pain', name: 'Max pain', ink: SILVER_FILL }]);
  const bookFlow = series(taken(book, 'greek-flow'));
  /* THE VENDOR'S NOPE, AS PRINTED (the retail test, 2026-10-22: the Map read "NOPE −2.81" against the vendor's last
     −3.00 — it was scaled by the window's share of the volume, a figure the vendor never printed). NOPE is the whole
     name's; the head says so rather than deriving a per-window one. */
  void nopeForWindow;
  const nopeWaiting = false;
  const nopeSrc = series(taken(book, 'nope'));
  const nopeLine = stamps(thin(cutAt(nopeSrc, at)), 'timestamp', [{ key: 'nope', name: 'NOPE', ink: BULL }]);
  const nopePts = nopeLine[0]?.pts ?? [];
  const lastNope = nopePts.length ? nopePts[nopePts.length - 1].v : null;
  if (nopeLine[0]) nopeLine[0].ink = lastNope != null && lastNope < 0 ? PUT_WALL : BULL;
  const flowWaiting = windowed && summed == null;
  const flowSource = windowed ? (summed ?? []) : series(taken(book, 'greek-flow'));
  const flow = stamps(thin(cutAt(flowSource, at)), 'timestamp', [
    { key: 'dir_delta_flow', name: 'Delta', ink: BULL },
    { key: 'dir_vega_flow', name: 'Vega', ink: SILVER_FILL },
  ]);
  const expiryFlow = still(series(taken(book, 'flow-expiry')));
  const byExpiry = stamps(expiryFlow, 'expiry', [
    { key: 'call_volume', name: 'Calls', ink: BULL },
    { key: 'put_volume', name: 'Puts', ink: PUT_WALL },
  ]);
  const span = expirySpan(windowed ? wantList : null);
  const chartable = (ls: LineSpec[]) => ls.some(l => l.pts.length >= 2);
  const flowRow = taken(book, 'greek-flow');
  const nopeRow = taken(book, 'nope');
  const waiting = !flowRow || flowRow.state === 'loading';
  if (!pain && lastNope == null && !chartable(flow) && !chartable(nopeLine) && !chartable(byExpiry) && expiryFlow.length !== 1 && !chartable(painLine) && !waiting && !flowWaiting && !nopeWaiting) return null;
  return (
    <div className="min-w-0 border border-borderSubtle rounded-md bg-panel overflow-hidden" data-reading="session" data-scope-ticker={ticker} data-reading-window={span ?? 'all'}>
      <div className="px-4 min-h-9 py-1 flex items-center gap-x-4 gap-y-1 flex-wrap">
        <h3 className="text-[16px] font-semibold leading-tight text-textPrimary">{ticker}</h3>
        {/* MAX PAIN IS ONE EXPIRY'S — named for the date it is (it read "Window Oct 22" as if it were the window's) */}
        <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap font-mono" title={pain ? `Max pain for the ${shortDay(String(pain.expiry ?? '').slice(0, 10))} expiry — the nearest one in the window; each expiry has its own (the chart below)` : undefined}>
          <span className="text-[11px] uppercase tracking-wider text-textMuted">Max pain{pain ? ` · ${shortDay(String(pain.expiry ?? '').slice(0, 10))} expiry` : ''}</span>
          <span className="text-[12px] font-semibold tnum text-textPrimary">{pain ? String(pain.max_pain ?? '—') : waiting ? '…' : '—'}</span>
        </span>
        <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap font-mono" title="The vendor's NOPE for the whole name (every expiry), as printed — not split by the window">
          <span className="text-[11px] uppercase tracking-wider text-textMuted">NOPE · whole name</span>
          <span className="text-[12px] font-semibold tnum" style={{ color: lastNope != null && lastNope < 0 ? PUT_WALL : lastNope != null ? BULL : undefined }}>{lastNope != null ? compact(lastNope) : nopeWaiting || waiting ? '…' : '—'}</span>
        </span>
      </div>
      {flowWaiting ? <Quiet>Reading this window.</Quiet> : chartable(flow) ? (
        <>
          {/* THE CLOCK IT STARTS AT, SAID (the second re-audit, 2026-10-22: the axis began at 08:02 with no word that the
              first ninety minutes are pre-market) */}
          <Head title="Delta and vega" rest={`${span ?? 'All expiries'} · ${flowSpanWords(flow)}`} />
          <HouseChart lines={flow} />
        </>
      ) : windowed ? <Quiet>No flow for this window.</Quiet> : waiting ? <Quiet>Reading the session.</Quiet> : null}
      {chartable(painLine) ? (
        <>
          <Head title="Max pain" rest={windowed ? (span ?? 'This window') : 'Where the book loses the least, by expiry'} />
          <HouseChart lines={painLine} format="num" />
        </>
      ) : null}
      {chartable(nopeLine) ? (
        <>
          <Head title="NOPE" rest="Net options pricing effect · the vendor's, whole name" />
          <HouseChart lines={nopeLine} />
        </>
      ) : null}
      {expiryFlow.length === 1 ? (
        <>
          <Head title="Volume by expiry" rest={dayOf(expiryFlow[0])} />
          <p className="px-5 pb-3 font-mono text-[12px] tnum text-textSecondary">
            Calls {compact(num(expiryFlow[0].call_volume) ?? 0)} · Puts {compact(num(expiryFlow[0].put_volume) ?? 0)}
          </p>
        </>
      ) : chartable(byExpiry) ? (
        <>
          <Head title="Volume by expiry" rest={expiryFlow.length ? (windowed ? `${expiryFlow.length} in this window` : `All ${expiryFlow.length} still listed`) : 'Calls against puts'} />
          <HouseChart lines={byExpiry} />
        </>
      ) : null}
    </div>
  );
}

/** "pre-market 08:02 → 16:00" / "09:30 → 15:12" — the span a minute series covers, with the hours outside the session named */
function flowSpanWords(lines: LineSpec[]): string {
  const pts = lines.find(l => l.pts.length >= 2)?.pts ?? [];
  if (pts.length < 2) return 'the session';
  const a = nyMinutes(pts[0].t * 1000);
  const b = nyMinutes(pts[pts.length - 1].t * 1000);
  const from = a < 9 * 60 + 30 ? `pre-market ${hhmm(a)}` : hhmm(a);
  const to = b >= 16 * 60 ? `${hhmm(b)} after hours` : hhmm(b);
  return `${from} → ${to}`;
}

function stillListed(rows: Record<string, unknown>[], today: string): Record<string, unknown>[] {
  return rows.filter(r => dayOf(r) >= today);
}

const CONTRACT_PAGE = 12;
const OCC = /([A-Z]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;

function parseOcc(symbol: string): { root: string; when: string; right: 'Call' | 'Put'; strike: string } | null {
  const m = symbol.toUpperCase().match(OCC);
  if (!m) return null;
  const n = Number(m[6]) / 1000;
  const strike = Math.abs(n - Math.round(n)) < 1e-6 ? String(Math.round(n)) : String(Math.round(n * 100) / 100);
  return { root: m[1], when: `${m[3]}/${m[4]}`, right: m[5] === 'C' ? 'Call' : 'Put', strike };
}

function ContractName({ symbol }: { symbol: string }) {
  const parsed = parseOcc(symbol);
  if (!parsed) return <span className="font-mono text-[12px] text-textPrimary truncate">{symbol}</span>;
  return (
    <span className="min-w-0 truncate font-mono text-[12px]">
      <span className="font-semibold text-textPrimary">{parsed.root}</span>
      <span className="tnum text-textPrimary"> {parsed.strike}</span>
      <span className={parsed.right === 'Call' ? 'text-bull' : 'text-bear'}> {parsed.right}</span>
      <span className="text-textMuted"> · {parsed.when}</span>
    </span>
  );
}

const figureOf = (v: unknown): string => {
  const n = num(v);
  if (n == null) return '—';
  return Math.abs(n) >= 1000 ? compact(n) : String(Math.round(n * 100) / 100);
};

function ContractBoard({ title, rest, rows, testId, volume }: { title: string; rest: string; rows: { symbol: string; change: string; volume: unknown; oi: unknown }[]; testId: string; volume?: boolean }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / CONTRACT_PAGE));
  const at = Math.min(page, pages - 1);
  const body = rows.slice(at * CONTRACT_PAGE, (at + 1) * CONTRACT_PAGE);
  const template = volume ? 'minmax(0,1.6fr) 88px 72px 72px' : 'minmax(0,1.6fr) 72px 88px';
  return (
    <div data-contracts={testId}>
      <Head title={title} rest={rest} />
      <div className="overflow-x-auto">
        <div className="min-w-[360px]">
          <div className="px-5 h-[20px] grid items-center gap-x-3 font-mono text-[9px] uppercase tracking-widest text-textMuted" style={{ gridTemplateColumns: template }}>
            <span>Contract</span>
            {volume ? <span className="text-right">Volume</span> : null}
            <span className="text-right">OI</span>
            <span className="text-right">Change</span>
          </div>
          {body.map((r, i) => (
            <div key={`${r.symbol}-${i}`} className="px-5 h-[34px] grid items-center gap-x-3 border-t border-borderSubtle/40" style={{ gridTemplateColumns: template }}>
              <ContractName symbol={r.symbol} />
              {volume ? <span className="text-right font-mono text-[11px] tnum text-textSecondary">{figureOf(r.volume)}</span> : null}
              <span className="text-right font-mono text-[11px] tnum text-textSecondary">{figureOf(r.oi)}</span>
              <span className={`text-right font-mono text-[11px] tnum ${r.change.startsWith('+') ? 'text-bull' : r.change.startsWith('−') || r.change.startsWith('-') ? 'text-bear' : 'text-textSecondary'}`}>{r.change}</span>
            </div>
          ))}
        </div>
      </div>
      <PageBar page={at} pages={pages} onPage={setPage} testId={testId} />
    </div>
  );
}

/** Contracts whose open interest changed. Under the ledger, in its rows. A FLEX line only when that contract moved. */
export function BuildingArrived({ ticker }: { ticker: string }) {
  const book = useVendor('pinpoint', ticker, '/pinpoint/agenda');
  if (!ticker) return null;
  /* NOT THE CONTRACTS THAT HAVE EXPIRED, AND NOT "TODAY" (the second re-audit, 2026-10-22: "the contracts that changed
     today" listed SPY 776 Call · 10/22 after it settled, and the change is the overnight count, 10/21 → 10/22) */
  const floor = isoDate(bookToday());
  const rawOi = series(taken(book, 'oi-change'));
  const dates = rawOi.reduce<{ from: string; to: string }>((d, r) => ({ from: String(r.last_date ?? '') > d.from ? String(r.last_date) : d.from, to: String(r.curr_date ?? '') > d.to ? String(r.curr_date) : d.to }), { from: '', to: '' });
  const oi = rawOi
    .map(r => {
      const diff = num(r.oi_diff_plain) ?? num(r.oi_change);
      const symbol = String(r.option_symbol ?? '');
      if (diff == null || diff === 0 || !symbol) return null;
      const m = symbol.toUpperCase().match(OCC);
      if (m && `20${m[2]}-${m[3]}-${m[4]}` < floor) return null;
      return { symbol, change: signed(diff), volume: r.volume, oi: r.curr_oi, _abs: Math.abs(diff) };
    })
    .filter((r): r is NonNullable<typeof r> => !!r)
    .sort((a, b) => b._abs - a._abs);
  const flex = series(taken(book, 'flex-list'))
    .map(r => {
      const oiN = num(r.open_interest);
      const prev = num(r.prev_oi);
      const symbol = String(r.option_symbol ?? '');
      if (oiN == null || prev == null || oiN === prev || !symbol) return null;
      return { symbol, change: signed(oiN - prev), volume: r.volume, oi: oiN, _abs: Math.abs(oiN - prev) };
    })
    .filter((r): r is NonNullable<typeof r> => !!r)
    .sort((a, b) => b._abs - a._abs);
  if (oi.length === 0 && flex.length === 0) return null;
  return (
    <div data-reading="arrived">
      {oi.length > 0 ? <ContractBoard title="Open interest" rest={`${ticker} · the overnight count${dates.from && dates.to ? `, ${dates.from.slice(5).replace('-', '/')} → ${dates.to.slice(5).replace('-', '/')}` : ''} · contracts still live`} rows={oi} testId="oi" volume /> : null}
      {flex.length > 0 ? <ContractBoard title="FLEX" rest="Open interest that moved against the prior print" rows={flex} testId="flex" /> : null}
    </div>
  );
}

/** "Against each expiry's median · 8–35 samples since 09-03" — the span the vendor's medians really cover */
function medianSpan(rows: Record<string, unknown>[]): string {
  const n = rows.map(r => Number(r.samples)).filter(x => Number.isFinite(x) && x > 0);
  const firsts = rows.map(r => String(r.first_date ?? '')).filter(d => /^\d{4}-\d{2}-\d{2}/.test(d)).sort();
  if (!n.length) return "Against each expiry's own median";
  const lo = Math.min(...n);
  const hi = Math.max(...n);
  const since = firsts[0] ? ` since ${firsts[0].slice(5, 10)}` : '';
  return `Against each expiry's median · ${lo === hi ? lo : `${lo}–${hi}`} daily samples${since}`;
}

/** Implied against what the name has done, and the term the print sits on. Nothing until a figure has arrived. */
export function EarningsVol({ ticker }: { ticker: string }) {
  const book = useVendor('dossier', ticker, `/dossier/earnings/${ticker}`);
  const stats = latest(taken(book, 'vstats'));
  const iv = num(stats?.iv);
  const rv = num(stats?.rv);
  const ratio = iv != null && rv ? iv / rv : null;
  const termRows = series(taken(book, 'term-dist')).map(r => {
    const vol = asPct(num(r.volatility));
    const mid = asPct(num(r.median));
    return { ...r, ...(vol == null ? {} : { vol }), ...(mid == null ? {} : { mid }), dte: `${r.dte ?? ''}d` };
  });
  const term = stamps(termRows, 'dte', [
    { key: 'vol', name: 'IV', ink: BULL },
    { key: 'mid', name: 'Median', ink: SILVER_FILL },
  ]);
  const chart = term.some(l => l.pts.length >= 2);
  const facts = [
    iv != null ? { label: 'Implied', value: pct(iv) } : null,
    /* no IV rank here: the page head already carries it, read once, so the two never disagree by a point */
    rv != null ? { label: 'Realized', value: pct(rv) } : null,
    ratio != null ? { label: 'IV / RV', value: ratio.toFixed(2) } : null,
  ].filter((f): f is { label: string; value: string } => !!f);
  if (facts.length === 0 && !chart) return null;
  return (
    <section className="border border-borderSubtle rounded-md bg-panel flex flex-col min-w-0 overflow-hidden" data-earnings-box="vol">
      <div className="px-5 pt-4 pb-3">
        <h3 className="text-[15px] font-semibold leading-tight text-textPrimary">The volatility</h3>
        <p className="mt-0.5 text-[11px] text-textMuted whitespace-nowrap truncate">{ticker} · implied against what the name has done, and the term</p>
      </div>
      {facts.length > 0 ? (
        <dl className="px-5 pb-4 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
          {facts.map(f => (
            <FactDl key={f.label} label={f.label}>{f.value}</FactDl>
          ))}
        </dl>
      ) : null}
      {chart ? (
        <>
          {/* NOT A ONE-YEAR MEDIAN (the re-audit, 2026-10-22): each expiry's median is over the samples the vendor has for
              it — 9 since 10-12 on one, 35 since 09-03 on another. The label says the real span */}
          <Head title="Term structure" rest={medianSpan(termRows)} />
          <HouseChart lines={term} format="pct" />
        </>
      ) : null}
    </section>
  );
}

function FactDl({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] text-textMuted whitespace-nowrap truncate">{label}</dt>
      <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary whitespace-nowrap truncate">{children}</dd>
    </div>
  );
}

/** The last income figures, in The numbers' own grid. No second title, no street, no chart. */
export function StockFacts({ ticker }: { ticker: string }) {
  const book = useVendor('dossier', ticker, `/dossier/stocks/${ticker}`);
  const income = series(taken(book, 'is'));
  const last = income.slice().sort((a, b) => {
    const byDate = String(b.fiscal_date_ending ?? '').localeCompare(String(a.fiscal_date_ending ?? ''));
    if (byDate) return byDate;
    return String(a.report_type) === 'quarterly' ? -1 : 1;
  })[0] ?? null;
  if (!last) return null;
  const money = ['total_revenue', 'gross_profit', 'net_income']
    .filter(k => last[k] != null && last[k] !== '')
    .map(k => ({ label: k === 'total_revenue' ? 'Revenue' : k === 'gross_profit' ? 'Gross profit' : 'Net income', value: num(last[k]) != null ? `${num(last[k])! < 0 ? '−' : ''}$${compact(Math.abs(num(last[k])!))}` : String(last[k]) }));
  if (money.length === 0) return null;
  return (
    <>
      {money.map(m => (
        <FactDl key={m.label} label={m.label}>{m.value}</FactDl>
      ))}
    </>
  );
}

/** The short file already states the latest print. This is the run of prints, when there is more than one. */
export function ShortHistory({ ticker }: { ticker: string }) {
  const book = useVendor('dossier', ticker, `/dossier/shorts/${ticker}`);
  const row = taken(book, 'si');
  const raw = series(row);
  const line = stamps(
    thin(raw).map(r => {
      const si = asPct(num(r.si_float));
      return si == null ? r : { ...r, si };
    }),
    'market_date',
    [{ key: 'si', name: '% of float', ink: PUT_WALL }],
  );
  const reports = raw
    .map(r => {
      const si = asPct(num(r.si_float));
      const days = num(r.days_to_cover);
      const shares = num(r.short_interest);
      const date = String(r.market_date ?? '').slice(0, 10);
      if (!date) return null;
      return {
        market_date: date,
        si: si == null ? '—' : `${si.toFixed(2)}%`,
        days: days == null ? '—' : days.toFixed(1),
        shares: shares == null ? '—' : compact(shares),
      };
    })
    .filter((r): r is NonNullable<typeof r> => !!r)
    /* sorted, not reversed: the vendor's order is not fixed, and the head promises newest first */
    .sort((a, b) => b.market_date.localeCompare(a.market_date));
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [ticker]);
  const pages = Math.max(1, Math.ceil(reports.length / CONTRACT_PAGE));
  const at = Math.min(page, pages - 1);
  const body = reports.slice(at * CONTRACT_PAGE, (at + 1) * CONTRACT_PAGE);
  if (!line.some(l => l.pts.length >= 2) && reports.length === 0) return null;
  return (
    <div data-short-history={ticker}>
      {line.some(l => l.pts.length >= 2) ? (
        <>
          <Head title="Interest across the reports" rest="Percent of the float" />
          <HouseChart lines={line} format="pct" />
        </>
      ) : null}
      {reports.length > 0 ? (
        <>
          <Head title="The reports" rest={`${reports.length} prints · newest first`} />
          <Rows
            max={body.length}
            rows={body}
            cols={[
              /* the date keeps its width — on a phone the share columns took it and every row read "2026…" (the Dossier sweep, 2026-10-22) */
              { key: 'market_date', label: 'Report', w: '86px' },
              { key: 'si', label: '% of float', right: true, w: 'minmax(0,1fr)' },
              { key: 'days', label: 'Days to cover', right: true, w: 'minmax(0,96px)' },
              { key: 'shares', label: 'Shares', right: true, w: 'minmax(0,1fr)' },
            ]}
          />
          <PageBar page={at} pages={pages} onPage={setPage} testId="short-reports" />
        </>
      ) : null}
    </div>
  );
}

/** Sector exposure, on the house file. Weight is the share of the reported value — the feed does not send one. */
export function HouseSectors() {
  const { pathname } = useLocation();
  const book = useVendor('dossier', '', pathname);
  if (!pathname.includes('/dossier/institutions/')) return null;
  const all = series(taken(book, 'sectors'));
  const latestDate = all.reduce((best, r) => {
    const d = String(r.report_date ?? '');
    return d > best ? d : best;
  }, '');
  const valued = all
    .filter(r => !latestDate || String(r.report_date ?? '') === latestDate)
    .map(r => {
      const sector = String(r.sector ?? r.sector_name ?? r.name ?? '').trim();
      const value = num(r.value) ?? num(r.market_value);
      const positions = num(r.positions);
      return sector && value != null ? { sector, value, positions } : null;
    })
    .filter((r): r is { sector: string; value: number; positions: number | null } => !!r)
    .sort((a, b) => b.value - a.value);
  if (valued.length === 0) return null;
  const total = valued.reduce((a, r) => a + r.value, 0);
  const rows = valued.map(r => ({
    sector: r.sector,
    value: compact(r.value),
    weight: total > 0 ? `${((r.value / total) * 100).toFixed(1)}%` : '',
    positions: r.positions != null ? Math.round(r.positions).toLocaleString('en-US') : '',
  }));
  return (
    <div data-house-sectors>
      <Head title="By sector" rest={latestDate ? `The ${latestDate} filing` : 'Where the house’s book sits'} />
      <Rows max={16} rows={rows} cols={[{ key: 'sector', label: 'Sector', w: 'minmax(0,1.4fr)' }, { key: 'value', label: 'Value', right: true }, { key: 'weight', label: 'Weight', right: true, w: '72px' }, { key: 'positions', label: 'Lines', right: true, w: '64px' }]} />
    </div>
  );
}
