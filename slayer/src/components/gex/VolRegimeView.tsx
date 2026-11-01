/*
  THE RAIL'S REGIME TAB: the VIX term structure, live — VIX1D, VIX9D, VIX, VIX3M, VIX6M, with VVIX and SKEW — its
  shape (contango or backwardation), where every print sits in its past year of daily closes, and the two ratios that
  say where the curve bends (VIX/VIX3M at the 30-day point, VIX9D/VIX at the front) through the day.

  One answer for the whole desk (data/regimeFeed.ts useVolRegime → server/regimeApi.mjs): four panes showing this tab
  make one request between them. The prints follow the session rule: while the index feed moves (the VIX from about
  03:15 ET) the head says Live with the print's time; otherwise As of the last print.

  Drawn as the other rail tabs are (Calendar, Matrix, Surface): the head's fact chips, caps section heads, figures in
  the mono voice, a one-line foot; the charts are shadcn's (components/shadcn/chart.tsx) over recharts. The colours are
  the site's own (regimeInk.ts): the shape in the walls' inks — contango glacier, backwardation ember — on the curve, the
  chip and each ratio by its side of 1.00; each reading's place in its year on the desk's heat ramp, as the Calendar's
  cells; grey only for the axes, the grid, the prior close and the secondary words.
*/

import { useId, useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../shadcn/chart';
import { useVolRegime, regimeTrouble, type RegimeQuote, type RegimeRatio } from '../../data/regimeFeed';
import { TERM } from '../../../shared/volRegime.mjs';
import { REGULAR_OPEN_MIN } from '../../core/session';
import { fmtDay, fmtMinute, fmtStamp, ordinal, signed } from './regimeFmt';
import { FactChip, INK, RailFoot, SectionHead, TICK } from './railFacts';
import type { HeatMode } from './heatmap';
import { EMBER as EMBER_INK, GLACIER as GLACIER_INK, pctFill, regimeInk, sideInk } from './regimeInk';

interface Props {
  /** The desk's heat ramp (Terrain's Colours card): thermal, or the house ember and glacier */
  mode: HeatMode;
  paper: boolean;
}

const SHAPE = {
  contango: { word: 'Contango', hint: 'near-term vol under the 3-month' },
  backwardation: { word: 'Backwardation', hint: 'near-term vol over the 3-month' },
  flat: { word: 'Flat', hint: 'VIX and VIX3M within half a percent' },
} as const;

/* ---- the curve ---- */

const CurveChart = ({ quotes, day, prevDay, ink, mode, paper }: { quotes: RegimeQuote[]; day: string | undefined; prevDay: string | null; ink: string } & Props) => {
  const config = {
    now: { label: fmtDay(day, false), color: ink },
    prior: { label: prevDay ? `${fmtDay(prevDay, false)} close` : 'Prior close', color: INK.axis },
  } satisfies ChartConfig;
  const data = TERM.map(t => {
    const q = quotes.find(x => x.sym === t.sym);
    return { tenor: t.label, sym: t.sym, now: q?.price ?? null, prior: q?.prev ?? null, pct: q?.pct ?? null };
  });
  return (
    <ChartContainer config={config} className="aspect-auto h-[142px] w-full font-mono tnum" data-regime-curve>
      <LineChart data={data} margin={{ top: 16, right: 22, bottom: 0, left: 18 }} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="tenor" tickLine={false} axisLine={false} tickMargin={6} tick={TICK} />
        {/* the prints are named at their points: no figure axis to collide with them */}
        <YAxis hide domain={[(min: number) => Math.floor(min - 1), (max: number) => Math.ceil(max + 1)]} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(_, p) => `${p?.[0]?.payload?.sym ?? ''}`} />} />
        <Line dataKey="prior" type="linear" stroke="var(--color-prior)" strokeWidth={1.25} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
        {/* each point wears its reading's place in the year, on the desk's ramp */}
        <Line
          dataKey="now"
          type="linear"
          stroke="var(--color-now)"
          strokeWidth={2}
          dot={(d: { cx?: number; cy?: number; index?: number }) => (
            <circle key={d.index} cx={d.cx} cy={d.cy} r={3.5} fill={data[d.index ?? 0]?.pct != null ? pctFill(data[d.index ?? 0].pct as number, mode, paper) : 'var(--color-now)'} stroke="rgb(var(--panel))" strokeWidth={1.25} />
          )}
          isAnimationActive={false}
        >
          <LabelList dataKey="now" position="top" offset={7} className="fill-textPrimary" fontSize={10} formatter={(v: unknown) => (typeof v === 'number' ? v.toFixed(2) : '')} />
        </Line>
        <ChartLegend verticalAlign="top" align="right" height={18} content={<ChartLegendContent verticalAlign="top" className="justify-end gap-3 pb-1 pr-3 text-t10 text-textMuted" />} />
      </LineChart>
    </ChartContainer>
  );
};

/* ---- each print's year: one bar per index, the percentile; the row's figures in its axis ---- */

const YearTick = ({ x, y, payload, rows }: { x?: number; y?: number; payload?: { value: string }; rows: Map<string, RegimeQuote> }) => {
  const q = payload ? rows.get(payload.value) : undefined;
  if (!q || x == null || y == null) return null;
  const chg = q.price != null && q.prev != null ? q.price - q.prev : null;
  /* three columns inside the axis: the name, the print, its change from the last close */
  const left = x - 144;
  return (
    <g data-regime-row={q.sym}>
      <text x={left} y={y} dy={3.5} fontSize={11} fill="rgb(var(--text-secondary))">
        {q.sym}
      </text>
      <text x={left + 92} y={y} dy={3.5} fontSize={11} textAnchor="end" fontWeight={600} fill="rgb(var(--text-primary))">
        {q.price == null ? '—' : q.price.toFixed(2)}
      </text>
      <text x={x - 4} y={y} dy={3.5} fontSize={10} textAnchor="end" fill="rgb(var(--text-muted))">
        {chg == null ? '' : signed(chg, 2)}
      </text>
    </g>
  );
};

const YearChart = ({ quotes, pending, mode, paper }: { quotes: RegimeQuote[]; pending: boolean } & Props) => {
  const rows = useMemo(() => new Map(quotes.map(q => [q.sym, q])), [quotes]);
  const config = { pct: { label: '1y percentile', color: INK.secondary } } satisfies ChartConfig;
  const data = quotes.map(q => ({ sym: q.sym, pct: q.pct == null ? 0 : Math.round(q.pct * 10) / 10, lo: q.lo, hi: q.hi, n: q.n }));
  if (pending && quotes.every(q => q.pct == null)) return <p className="px-3 py-3 font-mono text-t11 text-textMuted">Reading the year of closes…</p>;
  return (
    <ChartContainer config={config} className="aspect-auto w-full font-mono tnum" style={{ height: quotes.length * 22 + 6 }} data-regime-year>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 34, bottom: 0, left: 12 }} barCategoryGap={7} accessibilityLayer>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" domain={[0, 100]} ticks={[0, 50, 100]} hide />
        <YAxis type="category" dataKey="sym" width={150} tickLine={false} axisLine={false} interval={0} tick={<YearTick rows={rows} />} />
        <ReferenceLine x={50} stroke={INK.grid} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              hideIndicator
              labelFormatter={(_, p) => {
                const r = p?.[0]?.payload as { sym: string; lo: number | null; hi: number | null; n: number } | undefined;
                return r ? `${r.sym} · ${r.n} closes · ${r.lo?.toFixed(2)}–${r.hi?.toFixed(2)}` : '';
              }}
            />
          }
        />
        <Bar dataKey="pct" radius={2} isAnimationActive={false} background={{ fill: 'rgb(var(--ink) / 0.05)', radius: 2 }}>
          {data.map(d => (
            <Cell key={d.sym} fill={pctFill(d.pct, mode, paper)} />
          ))}
          <LabelList dataKey="pct" position="right" offset={6} fontSize={10} className="fill-textSecondary" formatter={(v: unknown) => (typeof v === 'number' && v > 0 ? ordinal(v) : '')} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
};

/* ---- a ratio through the day ---- */

const RatioChart = ({ r, mode, paper }: { r: RegimeRatio } & Props) => {
  const config = { ratio: { label: r.key, color: sideInk(r.value) } } satisfies ChartConfig;
  const gradId = `side-${r.key.replace(/[^A-Za-z0-9]/g, '')}-${useId().replace(/[^A-Za-z0-9]/g, '')}`;
  const data = r.path.map(([m, v]) => ({ m, ratio: v }));
  const vals = r.path.map(p => p[1]);
  const lo = vals.length ? Math.min(...vals) : 0;
  const hi = vals.length ? Math.max(...vals) : 0;
  const pad = Math.max(0.003, (hi - lo) * 0.12);
  const parity = 1 >= lo - pad && 1 <= hi + pad;
  /* the low, 1.00 when the path reaches it, the high — an end too near 1.00 to print beside it is left out */
  const near1 = (v: number) => parity && Math.abs(v - 1) < (hi - lo + 2 * pad) * 0.22;
  const ticks = [lo, ...(parity ? [1] : []), hi].filter((v, i, a) => (v === 1 || !near1(v)) && a.indexOf(v) === i);
  /* THE LINE BY ITS SIDE OF 1.00: a hard stop where 1.00 crosses the path's own box (the gradient's frame) — over it the
     curve is inverted at this point (ember), under it in contango (glacier) */
  const cross = hi > lo ? Math.min(1, Math.max(0, (hi - 1) / (hi - lo))) : hi > 1 ? 1 : 0;
  return (
    <div className="pb-1" data-regime-ratio={r.key}>
      <SectionHead
        name={r.key}
        gloss={
          r.pct == null ? undefined : (
            <>
              <span style={{ color: pctFill(r.pct, mode, paper) }}>{ordinal(r.pct)}</span> pct of the year
            </>
          )
        }
        aside={
          <>
            <span className="font-semibold" style={{ color: sideInk(r.value) }}>
              {r.value == null ? '—' : r.value.toFixed(3)}
            </span>
            {r.prev != null && r.value != null && <span className="ml-1.5 text-textMuted">{signed(r.value - r.prev, 3)}</span>}
          </>
        }
      />
      {data.length > 1 ? (
        <ChartContainer config={config} className="aspect-auto h-[116px] w-full font-mono tnum">
          <LineChart data={data} margin={{ top: 4, right: 14, bottom: 0, left: 0 }} accessibilityLayer>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="m" type="number" domain={[REGULAR_OPEN_MIN, REGULAR_OPEN_MIN + 405]} ticks={[REGULAR_OPEN_MIN, REGULAR_OPEN_MIN + 150, REGULAR_OPEN_MIN + 300]} tickFormatter={(m: number) => fmtMinute(m).replace(':00', '').replace(' ', '')} tickLine={false} axisLine={false} tick={TICK} tickMargin={4} />
            <YAxis width={40} tickLine={false} axisLine={false} tick={TICK} domain={[lo - pad, hi + pad]} ticks={ticks} tickCount={3} interval={0} tickFormatter={(v: number) => v.toFixed(2)} />
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset={0} stopColor={EMBER_INK} />
                <stop offset={cross} stopColor={EMBER_INK} />
                <stop offset={cross} stopColor={GLACIER_INK} />
                <stop offset={1} stopColor={GLACIER_INK} />
              </linearGradient>
            </defs>
            {parity && <ReferenceLine y={1} stroke={INK.axis} strokeDasharray="3 3" />}
            <ChartTooltip cursor={false} content={<ChartTooltipContent hideIndicator labelFormatter={(_, p) => fmtMinute(Number(p?.[0]?.payload?.m ?? 0))} />} />
            <Line dataKey="ratio" type="linear" stroke={`url(#${gradId})`} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ChartContainer>
      ) : (
        <p className="px-3 pb-2 font-mono text-t11 text-textMuted">No minute prints for both indices yet.</p>
      )}
    </div>
  );
};

const VolRegimeView = ({ mode, paper }: Props) => {
  const { data, error, loading } = useVolRegime();
  const trouble = regimeTrouble(error);
  const quotes = data?.quotes ?? [];
  const term = useMemo(() => TERM.map(t => quotes.find(q => q.sym === t.sym)).filter(Boolean) as RegimeQuote[], [quotes]);
  const all = useMemo(() => [...term, ...quotes.filter(q => !TERM.some(t => t.sym === q.sym))], [term, quotes]);

  if (!data) {
    return (
      <div className="h-full flex items-center justify-center px-6 text-center font-mono text-t11 uppercase tracking-widest text-textMuted" data-regime-empty>
        {loading ? 'Reading the VIX term structure…' : trouble ?? 'No VIX prints on file'}
      </div>
    );
  }
  const shape = data.regime ? SHAPE[data.regime] : null;
  const main = data.ratios?.[0];
  const prevDay = quotes.find(q => q.sym === 'VIX')?.prevDay ?? data.yearEnd ?? null;
  return (
    <div className="h-full flex flex-col min-h-0" data-regime-view data-regime={data.regime ?? ''}>
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        {/* THE HEAD: the shape and when the prints are from, as the head's cards */}
        <div className="flex flex-wrap items-center gap-1.5 px-2 pt-1.5" data-regime-head>
          {shape && main?.value != null && (
            <FactChip label="Curve" title={shape.hint} testId="shape">
              <span style={{ color: regimeInk(data.regime) }}>{shape.word}</span> <span className="font-normal text-textSecondary">{main.value.toFixed(3)}</span>
            </FactChip>
          )}
          <FactChip label={data.live ? 'Live' : 'As of'} testId={data.live ? 'live' : 'asof'}>
            {data.live ? fmtStamp(data.asOf).split(', ')[1] : fmtStamp(data.asOf).replace(',', '').replace(' ET', '')}
          </FactChip>
        </div>

        <SectionHead name="Term structure" gloss="VIX by tenor" />
        <CurveChart quotes={term} day={data.day} prevDay={prevDay} ink={regimeInk(data.regime)} mode={mode} paper={paper} />

        <SectionHead name="1y percentile" gloss={data.yearEnd ? `daily closes to ${fmtDay(data.yearEnd, false)}` : 'daily closes'} aside={<span className="text-textMuted">last · chg</span>} />
        <YearChart quotes={all} pending={!!data.pending?.year} mode={mode} paper={paper} />

        <div className="mt-1 border-t border-borderSubtle/60">
          {(data.ratios ?? []).map(r => (
            <RatioChart key={r.key} r={r} mode={mode} paper={paper} />
          ))}
        </div>
        {trouble && <p className="px-3 py-1 font-mono text-t11 text-warn">{trouble}</p>}
      </div>
      <RailFoot>Ratios through {fmtDay(data.day)} · chg from the {fmtDay(prevDay, false)} close</RailFoot>
    </div>
  );
};

export default VolRegimeView;
