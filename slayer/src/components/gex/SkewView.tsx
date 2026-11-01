/*
  THE SURFACE TAB'S SKEW LENS: the vol smile of one expiry (by delta or by strike) against the prior session's close,
  the at-the-money term structure, and the surface itself — each expiry's vol at the 10/25/40-delta puts, the forward
  and the 40/25/10-delta calls, with its 25-delta risk reversal and butterfly — every cell washed by its change since
  the prior close.

  One answer for the desk (data/chainFeed.ts useChain → server/terrainApi.mjs, one all-expiry snapshot per name), the
  prior close read once a session (usePriorClose); the math is data/skew.ts on the site's own parity forward and rate.

  Drawn as the Regime tab is (VolRegimeView): the head's fact chips, caps section heads, figures in the mono voice, a
  one-line foot, the charts shadcn's over recharts. Colours are the site's own: the put wing ember and the call wing
  glacier (the walls' inks, chart-5 and chart-4), a change on the desk's heat ramp (heatmap.ts) as the Calendar's cells,
  grey only for the axes, the grid and the prior close.
*/

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CartesianGrid, LabelList, Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../shadcn/chart';
import DropdownSelect, { type DropdownOption } from '../ui/DropdownSelect';
import { useChain, usePriorClose } from '../../data/chainFeed';
import { BUCKETS, chainSkew, closeMsOf, gridExpiries, wallMs, type BucketKey, type ExpirySkew } from '../../data/skew';
import { ensureDayRates, useRate } from '../../data/rateFeed';
import { rateOn } from '../../core/carry';
import { regimeTrouble } from '../../data/regimeFeed';
import { fmtDay, fmtStamp, signed } from './regimeFmt';
import { FactChip, INK, RailFoot, SectionHead, Seg, TICK } from './railFacts';
import { heatCellStyle, type HeatMode } from './heatmap';
import { EMBER, GLACIER } from './regimeInk';

interface Props {
  ticker: string;
  mode: HeatMode;
  paper: boolean;
}

type Axis = 'delta' | 'strike';
const AXES = [
  { value: 'delta', label: 'Delta', hint: 'Vol by delta: the puts on the left, the calls on the right' },
  { value: 'strike', label: 'Strike', hint: 'Vol by strike' },
] as const;

/** A signed change that rounds to nothing reads 0, never −0.00 */
const chgWord = (v: number, d = 2) => (Math.abs(v) < 0.5 * 10 ** -d ? (0).toFixed(d) : signed(v, d));
const pct = (v: number | null | undefined, d = 1) => (v == null ? '—' : (v * 100).toFixed(d));
const pts = (v: number | null | undefined, d = 2) => (v == null ? '—' : chgWord(v * 100, d));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const expWord = (iso: string) => `${MON[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const dteWord = (dte: number) => (dte < 1 ? `${Math.max(1, Math.round(dte * 24))}h` : `${Math.round(dte)}d`);
/** A risk reversal's ink: puts bid over calls (negative) ember, calls over puts glacier */
const rrInk = (v: number | null | undefined) => (v == null ? 'rgb(var(--text-secondary))' : v < 0 ? EMBER : GLACIER);

/* ---- one expiry's smile ---- */

const SmileChart = ({ now, prior, axis, priorDay }: { now: ExpirySkew; prior: ExpirySkew | null; axis: Axis; priorDay: string | null }) => {
  const gradId = `smile-${useId().replace(/[^A-Za-z0-9]/g, '')}`;
  const xOf = (p: { nd1: number; strike: number }) => (axis === 'delta' ? 1 - p.nd1 : p.strike);
  const keep = (p: { nd1: number }) => p.nd1 > 0.03 && p.nd1 < 0.97;
  const today = now.points.filter(keep).map(p => ({ x: xOf(p), now: p.iv * 100, strike: p.strike, d: Math.round((p.side === 'P' ? p.nd1 - 1 : p.nd1) * 100) }));
  const before = (prior?.points ?? []).filter(keep).map(p => ({ x: xOf(p), prior: p.iv * 100, strike: p.strike, d: Math.round((p.side === 'P' ? p.nd1 - 1 : p.nd1) * 100) }));
  if (today.length < 3) return <p className="px-3 pb-2 font-mono text-t11 text-textMuted">Too few two-sided quotes on this expiry.</p>;
  const xs = today.map(p => p.x);
  const lo = Math.min(...xs, ...before.map(p => p.x));
  const hi = Math.max(...xs, ...before.map(p => p.x));
  const atmX = axis === 'delta' ? 0.5 : now.F;
  /* THE WINGS IN THE WALLS' INKS: a hard stop at the forward — the put wing ember, the call wing glacier */
  const tMin = Math.min(...xs);
  const tMax = Math.max(...xs);
  const cross = tMax > tMin ? Math.min(1, Math.max(0, (atmX - tMin) / (tMax - tMin))) : 0.5;
  const ys = [...today.map(p => p.now), ...before.map(p => p.prior)];
  const yLo = Math.floor(Math.min(...ys) - 0.5);
  const yHi = Math.ceil(Math.max(...ys) + 0.5);
  const config = {
    now: { label: 'Now', color: INK.ink },
    prior: { label: priorDay ? `${fmtDay(priorDay, false)} close` : 'Prior close', color: INK.axis },
  } satisfies ChartConfig;
  const ticks = axis === 'delta' ? [0.1, 0.25, 0.5, 0.75, 0.9].filter(t => t >= lo && t <= hi) : undefined;
  const tickWord = (v: number) => (axis === 'delta' ? (v === 0.5 ? 'ATM' : v < 0.5 ? `${Math.round(v * 100)}P` : `${Math.round((1 - v) * 100)}C`) : v.toFixed(0));
  return (
    <ChartContainer config={config} className="aspect-auto h-[168px] w-full font-mono tnum" data-skew-smile={now.exp}>
      <LineChart margin={{ top: 4, right: 14, bottom: 0, left: 0 }} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="x" type="number" domain={[lo, hi]} ticks={ticks} tickCount={5} tickFormatter={tickWord} tickLine={false} axisLine={false} tick={TICK} tickMargin={4} allowDuplicatedCategory={false} />
        <YAxis width={34} tickLine={false} axisLine={false} tick={TICK} domain={[yLo, yHi]} tickCount={4} tickFormatter={(v: number) => `${v.toFixed(0)}`} />
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
            <stop offset={0} stopColor={EMBER} />
            <stop offset={cross} stopColor={EMBER} />
            <stop offset={cross} stopColor={GLACIER} />
            <stop offset={1} stopColor={GLACIER} />
          </linearGradient>
        </defs>
        <ReferenceLine x={atmX} stroke={INK.axis} strokeDasharray="3 3" />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(_, p) => {
                const r = p?.[0]?.payload as { strike: number; d: number } | undefined;
                return r ? `${r.strike} · ${Math.abs(r.d)}Δ ${r.d < 0 ? 'put' : 'call'}` : '';
              }}
              formatter={(v, name) => (
                <span className="flex w-full justify-between gap-3">
                  <span className="text-textMuted">{config[name as 'now' | 'prior']?.label}</span>
                  <span className="font-semibold text-textPrimary">{Number(v).toFixed(2)}%</span>
                </span>
              )}
            />
          }
        />
        {before.length > 2 && <Line data={before} dataKey="prior" type="monotone" stroke="var(--color-prior)" strokeWidth={1.25} strokeDasharray="3 3" dot={false} isAnimationActive={false} />}
        <Line data={today} dataKey="now" type="monotone" stroke={`url(#${gradId})`} strokeWidth={2} dot={false} isAnimationActive={false} />
        <ChartLegend verticalAlign="top" align="right" height={18} content={<ChartLegendContent verticalAlign="top" className="justify-end gap-3 pb-1 pr-3 text-t10 text-textMuted" />} />
      </LineChart>
    </ChartContainer>
  );
};

/* ---- the at-the-money term structure ---- */

const TermChart = ({ rows, mode, paper, priorDay }: { rows: { exp: string; dte: number; now: number | null; prior: number | null }[]; mode: HeatMode; paper: boolean; priorDay: string | null }) => {
  const data = rows.map(r => ({ tenor: dteWord(r.dte), exp: r.exp, now: r.now == null ? null : r.now * 100, prior: r.prior == null ? null : r.prior * 100, chg: r.now != null && r.prior != null ? (r.now - r.prior) * 100 : null }));
  const maxChg = Math.max(0.25, ...data.map(d => Math.abs(d.chg ?? 0)));
  /* the curve's shape in the walls' inks, as the Regime tab's: the front over the back is inverted (ember) */
  const front = data[0]?.now;
  const back = data[data.length - 1]?.now;
  const ink = front != null && back != null ? (front > back ? EMBER : GLACIER) : INK.ink;
  const config = {
    now: { label: 'Now', color: ink },
    prior: { label: priorDay ? `${fmtDay(priorDay, false)} close` : 'Prior close', color: INK.axis },
  } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="aspect-auto h-[142px] w-full font-mono tnum" data-skew-term>
      <LineChart data={data} margin={{ top: 16, right: 22, bottom: 0, left: 18 }} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="tenor" tickLine={false} axisLine={false} tickMargin={6} tick={TICK} interval={0} />
        <YAxis hide domain={[(min: number) => Math.floor(min - 0.5), (max: number) => Math.ceil(max + 0.5)]} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(_, p) => { const e = p?.[0]?.payload?.exp as string | undefined; return e ? `${expWord(e)} · ATM IV` : ''; }} formatter={(v, name) => <span className="flex w-full justify-between gap-3"><span className="text-textMuted">{config[name as 'now' | 'prior']?.label}</span><span className="font-semibold text-textPrimary">{Number(v).toFixed(2)}%</span></span>} />} />
        <Line dataKey="prior" type="linear" stroke="var(--color-prior)" strokeWidth={1.25} strokeDasharray="3 3" dot={false} isAnimationActive={false} connectNulls />
        {/* each point wears its change since the prior close, on the desk's ramp */}
        <Line
          dataKey="now"
          type="linear"
          stroke="var(--color-now)"
          strokeWidth={2}
          connectNulls
          dot={(d: { cx?: number; cy?: number; index?: number }) => {
            const c = data[d.index ?? 0]?.chg;
            return <circle key={d.index} cx={d.cx} cy={d.cy} r={3.5} fill={c != null ? String(heatCellStyle(c, maxChg, mode, paper).backgroundColor) : 'var(--color-now)'} stroke="rgb(var(--panel))" strokeWidth={1.25} />;
          }}
          isAnimationActive={false}
        >
          <LabelList dataKey="now" position="top" offset={7} className="fill-textPrimary" fontSize={10} formatter={(v: unknown) => (typeof v === 'number' ? v.toFixed(1) : '')} />
        </Line>
        <ChartLegend verticalAlign="top" align="right" height={18} content={<ChartLegendContent verticalAlign="top" className="justify-end gap-3 pb-1 pr-3 text-t10 text-textMuted" />} />
      </LineChart>
    </ChartContainer>
  );
};

/* ---- the surface: an expiry a row, a delta a column ---- */

const head = 'font-mono text-t10 font-semibold uppercase tracking-widest text-textMuted';

const SurfaceGrid = ({ rows, prior, mode, paper, pick, onPick, narrow }: { rows: ExpirySkew[]; prior: Map<string, ExpirySkew>; mode: HeatMode; paper: boolean; pick: string | null; onPick: (exp: string) => void; narrow: boolean }) => {
  const cols = BUCKETS.filter(b => !narrow || b.key === 'p25' || b.key === 'atm' || b.key === 'c25');
  const chg = (s: ExpirySkew, k: BucketKey) => {
    const p = prior.get(s.exp);
    const a = s.at[k];
    const b = p?.at[k];
    return a != null && b != null ? (a - b) * 100 : null;
  };
  const maxChg = Math.max(0.25, ...rows.flatMap(s => cols.map(c => Math.abs(chg(s, c.key) ?? 0))));
  return (
    <div className="px-2 pb-1 overflow-x-auto" data-skew-grid>
      <table className="w-full border-collapse font-mono tnum">
        <thead>
          <tr>
            <th className={`${head} text-left pl-1 pb-1`}>Exp</th>
            {cols.map(c => (
              <th key={c.key} className={`${head} pb-1 text-center`}>
                {c.label}
              </th>
            ))}
            <th className={`${head} pb-1 pl-2 text-right`}>RR</th>
            <th className={`${head} pb-1 pl-2 pr-1 text-right`}>Fly</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(s => (
            <tr key={s.exp} onClick={() => onPick(s.exp)} className={`cursor-pointer ${pick === s.exp ? 'outline outline-1 outline-silver/60 -outline-offset-1' : ''}`} data-skew-row={s.exp}>
              <td className="pl-1 pr-2 py-[3px] text-t11 text-textSecondary whitespace-nowrap">
                {expWord(s.exp)} <span className="text-textMuted">{dteWord(s.dte)}</span>
              </td>
              {cols.map(c => {
                const v = s.at[c.key];
                const d = chg(s, c.key);
                const skin = d != null ? heatCellStyle(d, maxChg, mode, paper) : undefined;
                return (
                  <td key={c.key} className="p-[1px]" title={d != null ? `${pct(v, 2)}% · ${chgWord(d)} pts since the prior close` : v != null ? `${pct(v, 2)}%` : 'No quote'}>
                    <span className={`block rounded-[3px] px-1 py-[3px] text-center text-t11 ${skin ? 'font-semibold' : 'bg-ink/[0.045] text-textPrimary'}`} style={skin}>
                      {pct(v)}
                    </span>
                  </td>
                );
              })}
              <td className="pl-2 py-[3px] text-right text-t11 font-semibold" style={{ color: rrInk(s.rr25) }}>
                {pts(s.rr25, 1)}
              </td>
              <td className="pl-2 pr-1 py-[3px] text-right text-t11 text-textSecondary">{pts(s.fly25, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const SkewView = ({ ticker, mode, paper }: Props) => {
  const chain = useChain(ticker);
  const priorRead = usePriorClose(ticker);
  const rate = useRate();
  const data = chain.data;
  const prior = priorRead.data;
  const priorDay = prior?.day ?? null;
  useEffect(() => {
    if (priorDay) ensureDayRates(priorDay);
  }, [priorDay]);
  const priorR = priorDay ? rateOn(priorDay).r : rate.r;

  const live = useMemo(() => (data?.expiries && data.spot ? chainSkew(data.expiries, data.spot, rate.r, wallMs(data.asOf ?? data.spotAt ?? '')) : []), [data, rate.r]);
  const before = useMemo(() => (prior?.expiries?.length && prior.spot && priorDay ? chainSkew(prior.expiries, prior.spot, priorR, closeMsOf(priorDay)) : []), [prior, priorR, priorDay]);
  const beforeBy = useMemo(() => new Map(before.map(s => [s.exp, s])), [before]);
  const grid = useMemo(() => gridExpiries(live), [live]);

  const [pick, setPick] = useState<string | null>(null);
  const [axis, setAxis] = useState<Axis>('delta');
  /* the front week by default: the expiry nearest seven days out that reads both 25-delta wings */
  const weekly = live.filter(s => s.rr25 != null).reduce<ExpirySkew | null>((b, s) => (!b || Math.abs(s.dte - 7) < Math.abs(b.dte - 7) ? s : b), null);
  const chosen = live.find(s => s.exp === pick) ?? weekly ?? live[0] ?? null;
  const chosenPrior = chosen ? (beforeBy.get(chosen.exp) ?? null) : null;

  const boxRef = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(e => setW(e[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [data != null]);

  const trouble = regimeTrouble(chain.error);
  if (!data || !live.length) {
    return (
      <div className="h-full flex items-center justify-center px-6 text-center font-mono text-t11 uppercase tracking-widest text-textMuted" data-skew-empty>
        {chain.loading ? `Reading the ${ticker} chain…` : (trouble ?? (data ? `No two-sided quotes on the ${ticker} chain` : `No option chain for ${ticker}`))}
      </div>
    );
  }

  const options: DropdownOption<string>[] = live.map(s => ({ value: s.exp, label: `${fmtDay(s.exp)} · ${dteWord(s.dte)}`, short: `${expWord(s.exp)} · ${dteWord(s.dte)}`, hint: `ATM ${pct(s.atm, 2)}% · RR ${pts(s.rr25)} · fly ${pts(s.fly25)}` }));
  const atmChg = chosen && chosenPrior && chosen.atm != null && chosenPrior.atm != null ? (chosen.atm - chosenPrior.atm) * 100 : null;
  const rrChg = chosen && chosenPrior && chosen.rr25 != null && chosenPrior.rr25 != null ? (chosen.rr25 - chosenPrior.rr25) * 100 : null;
  const term = grid.map(s => ({ exp: s.exp, dte: s.dte, now: s.atm, prior: beforeBy.get(s.exp)?.atm ?? null }));
  const priorWords = prior?.pending ? `reading the ${fmtDay(priorDay, false)} close…` : before.length ? `chg from the ${fmtDay(priorDay, false)} close` : priorDay ? `the ${fmtDay(priorDay, false)} close is not on file` : 'no prior close on file';

  return (
    <div ref={boxRef} className="h-full flex flex-col min-h-0" data-skew-view={data.root}>
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        {/* THE HEAD: the expiry in hand and its three numbers, when the quotes are from */}
        <div className="flex flex-wrap items-center gap-1.5 px-2 pt-1.5" data-skew-head>
          <DropdownSelect label="Expiry" value={chosen?.exp ?? ''} options={options} onChange={setPick} title="The expiry the smile draws" testId="skew-expiry" size="sm" bare />
          {chosen && (
            <FactChip label="ATM" testId="atm" title="At-the-money implied vol, and its change since the prior close">
              {pct(chosen.atm, 2)}
              {atmChg != null && <span className="ml-1 font-normal text-textSecondary">{chgWord(atmChg)}</span>}
            </FactChip>
          )}
          {chosen && (
            <FactChip label="RR25" testId="rr" title="25-delta risk reversal: the call's vol less the put's, in vol points">
              <span style={{ color: rrInk(chosen.rr25) }}>{pts(chosen.rr25)}</span>
              {rrChg != null && <span className="ml-1 font-normal text-textSecondary">{chgWord(rrChg)}</span>}
            </FactChip>
          )}
          {chosen && (
            <FactChip label="Fly25" testId="fly" title="25-delta butterfly: the wings' average vol over the at-the-money vol, in vol points">
              {pts(chosen.fly25)}
            </FactChip>
          )}
          <FactChip label={data.live ? 'Live' : 'As of'} testId={data.live ? 'live' : 'asof'}>
            {data.live ? fmtStamp(data.asOf).split(', ')[1] : fmtStamp(data.asOf).replace(',', '').replace(' ET', '')}
          </FactChip>
        </div>

        {chosen && (
          <>
            <SectionHead name="Skew" gloss={`${expWord(chosen.exp)} · IV by ${axis}`} aside={<Seg options={AXES} value={axis} onChange={setAxis} testId="skew-axis" />} />
            <SmileChart now={chosen} prior={chosenPrior} axis={axis} priorDay={priorDay} />
          </>
        )}

        <SectionHead name="Term structure" gloss="ATM IV by expiry" />
        <TermChart rows={term} mode={mode} paper={paper} priorDay={priorDay} />

        <SectionHead name="Surface" gloss="IV by delta" aside={<span className="text-textMuted">25Δ RR · fly</span>} />
        <SurfaceGrid rows={grid} prior={beforeBy} mode={mode} paper={paper} pick={chosen?.exp ?? null} onPick={setPick} narrow={w > 0 && w < 440} />
        {trouble && <p className="px-3 py-1 font-mono text-t11 text-warn">{trouble}</p>}
      </div>
      <RailFoot>
        {data.root} vols · {priorWords}
      </RailFoot>
    </div>
  );
};

export default SkewView;
