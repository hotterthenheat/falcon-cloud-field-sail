/*
  THE RAIL'S REGIME TAB: the VIX term structure, live — VIX1D, VIX9D, VIX, VIX3M, VIX6M, with VVIX and SKEW — its
  shape (contango or backwardation), the two ratios that say where it bends (VIX/VIX3M at the 30-day point, VIX9D/VIX at
  the front) with their path through the day, and where every value sits in its past year of daily closes.

  One answer for the whole desk (data/regimeFeed.ts useVolRegime → server/regimeApi.mjs): four panes showing this tab
  make one request between them. The prints follow the session rule: while the index feed moves (the VIX from about
  03:15 ET) the head says Live with the print's time; otherwise it says As of the last print.

  The inks are the rail's own ramp (heatmap.ts), read as a sign: warm where vol is rich (high in its year, rising, the
  curve inverted), cool where it is cheap — the same two poles the ladder's legs wear beside it.
*/

import { useId, useMemo, useRef } from 'react';
import { heatLadderColor, type HeatMode } from './heatmap';
import { useVolRegime, regimeTrouble, type RegimeQuote, type RegimeRatio } from '../../data/regimeFeed';
import { TERM } from '../../../shared/volRegime.mjs';
import { fmtDay, fmtMinute, fmtStamp, ordinal, signed, useWidth } from './regimeFmt';

interface Props {
  mode: HeatMode;
  paper: boolean;
}

/** A sign's ink at strength t (0..1) on the rail's ramp: +1 warm, −1 cool */
const inkOf = (sign: number, t: number, mode: HeatMode, paper: boolean) => heatLadderColor(sign >= 0 ? Math.max(0.02, t) : -Math.max(0.02, t), 1, mode, paper);
/** A percentile's ink: warm above the median, cool below, deeper toward the ends */
const pctInk = (p: number, mode: HeatMode, paper: boolean) => inkOf(p >= 50 ? 1 : -1, Math.abs(p - 50) / 50, mode, paper);

const REGIME_WORDS = {
  contango: { label: 'Contango', hint: 'The curve slopes up: near-term vol under the 3-month' },
  backwardation: { label: 'Backwardation', hint: 'The curve is inverted: near-term vol over the 3-month' },
  flat: { label: 'Flat', hint: 'VIX and VIX3M within half a percent of each other' },
} as const;

const SECTION = 'font-mono text-t10 uppercase tracking-widest text-textMuted';

/* THE CURVE: the five tenors on a log-days axis, today's prints solid, the year's last closes dashed behind them */
const Curve = ({ quotes, ink, mode, paper }: { quotes: RegimeQuote[]; ink: string; mode: HeatMode; paper: boolean }) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const w = useWidth(boxRef);
  const H = 104;
  const pad = { l: 14, r: 14, t: 18, b: 18 };
  const pts = TERM.map(t => ({ t, q: quotes.find(q => q.sym === t.sym) })).filter(x => x.q && x.q.price != null) as { t: (typeof TERM)[number]; q: RegimeQuote }[];
  const all = pts.flatMap(p => [p.q.price as number, ...(p.q.prev != null ? [p.q.prev] : [])]);
  if (!pts.length || w < 60) return <div ref={boxRef} style={{ height: H }} />;
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = Math.max(0.5, hi - lo);
  const lx = (d: number) => Math.log(d);
  const x0 = lx(TERM[0].days);
  const x1 = lx(TERM[TERM.length - 1].days);
  const X = (d: number) => pad.l + ((lx(d) - x0) / (x1 - x0)) * (w - pad.l - pad.r);
  const Y = (v: number) => pad.t + (1 - (v - (lo - span * 0.12)) / (span * 1.24)) * (H - pad.t - pad.b);
  const line = (vals: { d: number; v: number }[]) => vals.map((p, i) => `${i ? 'L' : 'M'}${X(p.d).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
  const prev = pts.filter(p => p.q.prev != null).map(p => ({ d: p.t.days, v: p.q.prev as number }));
  return (
    <div ref={boxRef} className="relative" style={{ height: H }} data-regime-curve>
      <svg width={w} height={H} className="block" aria-label="VIX term structure">
        {[0.25, 0.5, 0.75].map(f => (
          <line key={f} x1={pad.l} x2={w - pad.r} y1={pad.t + f * (H - pad.t - pad.b)} y2={pad.t + f * (H - pad.t - pad.b)} stroke="rgb(var(--ink) / 0.06)" />
        ))}
        {prev.length > 1 && <path d={line(prev)} fill="none" stroke="rgb(var(--text-muted))" strokeWidth={1} strokeDasharray="3 3" />}
        <path d={line(pts.map(p => ({ d: p.t.days, v: p.q.price as number })))} fill="none" stroke={ink} strokeWidth={1.75} strokeLinejoin="round" />
        {pts.map((p, i) => {
          const cx = X(p.t.days);
          const cy = Y(p.q.price as number);
          const anchor = i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle';
          /* two figures closer than a figure's width: the earlier one hangs under its point */
          const crowded = i < pts.length - 1 && X(pts[i + 1].t.days) - cx < 40;
          return (
            <g key={p.t.sym}>
              <circle cx={cx} cy={cy} r={3} fill={p.q.pct != null ? pctInk(p.q.pct, mode, paper) : ink} stroke="rgb(var(--panel))" strokeWidth={1.25} />
              <text x={cx} y={crowded ? cy + 14 : cy - 7} textAnchor={anchor} className="font-mono tnum" fontSize={10} fill="rgb(var(--text-primary))">
                {(p.q.price as number).toFixed(2)}
              </text>
              <text x={cx} y={H - 4} textAnchor={anchor} className="font-mono" fontSize={9} fill="rgb(var(--text-muted))">
                {p.t.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

/* ONE RATIO: its figure, its year's percentile, and its path through the regime day with 1.00 marked when in reach */
const RatioPath = ({ r, mode, paper, day }: { r: RegimeRatio; mode: HeatMode; paper: boolean; day: string | undefined }) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const w = useWidth(boxRef);
  const H = 46;
  const path = r.path;
  const vals = path.map(p => p[1]);
  const lo = vals.length ? Math.min(...vals) : 0;
  const hi = vals.length ? Math.max(...vals) : 0;
  const spread = Math.max(0.004, hi - lo);
  const yLo = lo - spread * 0.15;
  const yHi = hi + spread * 0.15;
  const m0 = Math.min(570, path[0]?.[0] ?? 570);
  const m1 = Math.max(975, path[path.length - 1]?.[0] ?? 975);
  const X = (m: number) => ((m - m0) / (m1 - m0)) * (w - 2) + 1;
  const Y = (v: number) => 3 + (1 - (v - yLo) / (yHi - yLo)) * (H - 6);
  const inverted = r.value != null && r.value > 1;
  const ink = r.value == null ? 'rgb(var(--text-muted))' : inkOf(inverted ? 1 : -1, Math.min(1, Math.abs(r.value - 1) * 6), mode, paper);
  const d = path.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
  const parity = 1 >= yLo && 1 <= yHi;
  const coolInk = inkOf(-1, 0.55, mode, paper);
  const warmInk = inkOf(1, 0.75, mode, paper);
  /* one clip per drawing: four panes may draw the same ratio at four widths */
  const clipId = `${r.key}${useId()}`.replace(/[^A-Za-z0-9]/g, '');
  const open = path[0]?.[1];
  return (
    <div className="py-2 border-t border-borderSubtle/60" data-regime-ratio={r.key}>
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="font-mono text-t11 text-textSecondary whitespace-nowrap">{r.key}</span>
        <span className="font-mono text-t12 tnum font-semibold whitespace-nowrap" style={{ color: ink }}>
          {r.value == null ? '—' : r.value.toFixed(3)}
        </span>
        {r.prev != null && r.value != null && (
          <span className="font-mono text-t10 tnum text-textMuted whitespace-nowrap" title={`The year's last close, ${r.prev.toFixed(3)}`}>
            {signed(r.value - r.prev, 3)}
          </span>
        )}
        <span className="ml-auto font-mono text-t10 tnum whitespace-nowrap" style={{ color: r.pct == null ? undefined : pctInk(r.pct, mode, paper) }} title={r.pct == null ? undefined : `Higher than ${Math.round(r.pct)}% of the past year's ${r.n} closes · range ${r.lo?.toFixed(3)}–${r.hi?.toFixed(3)}`}>
          {r.pct == null ? '' : `${ordinal(r.pct)} pct`}
        </span>
      </div>
      <div ref={boxRef} className="relative mt-1" style={{ height: H }}>
        {w > 40 && path.length > 1 ? (
          <svg width={w} height={H} className="block" aria-label={`${r.key} through ${fmtDay(day)}`}>
            {parity && <line x1={0} x2={w} y1={Y(1)} y2={Y(1)} stroke="rgb(var(--text-muted))" strokeDasharray="2 3" strokeWidth={1} />}
            {parity && (
              <text x={w - 1} y={Y(1) - 3} textAnchor="end" className="font-mono tnum" fontSize={9} fill="rgb(var(--text-muted))">
                1.000
              </text>
            )}
            {/* the minutes over 1.000 (the curve inverted at this point) wear the warm ink, the rest the cool */}
            <defs>
              <clipPath id={`over-${clipId}`}>
                <rect x={0} y={0} width={w} height={parity ? Y(1) : 0} />
              </clipPath>
            </defs>
            <path d={d} fill="none" stroke={coolInk} strokeWidth={1.25} strokeLinejoin="round" />
            {parity && <path d={d} fill="none" stroke={warmInk} strokeWidth={1.25} strokeLinejoin="round" clipPath={`url(#over-${clipId})`} />}
            <circle cx={X(path[path.length - 1][0])} cy={Y(path[path.length - 1][1])} r={2.25} fill={ink} />
          </svg>
        ) : (
          <p className="h-full flex items-center font-mono text-t10 text-textMuted">No minute prints for both indices on {fmtDay(day)} yet.</p>
        )}
      </div>
      {path.length > 1 && (
        <div className="mt-0.5 flex justify-between gap-2 font-mono text-t9 tnum text-textMuted whitespace-nowrap overflow-hidden">
          <span>
            {fmtMinute(path[0][0])} {open?.toFixed(3)}
          </span>
          <span className="truncate">
            lo {lo.toFixed(3)} · hi {hi.toFixed(3)}
          </span>
          <span>{fmtMinute(path[path.length - 1][0])}</span>
        </div>
      )}
    </div>
  );
};

const VolRegimeView = ({ mode, paper }: Props) => {
  const { data, error, loading } = useVolRegime();
  const quotes = data?.quotes ?? [];
  const regime = data?.regime ? REGIME_WORDS[data.regime] : null;
  const main = data?.ratios?.[0];
  const regimeInk = main?.value == null ? 'rgb(var(--text-secondary))' : inkOf(main.value > 1 ? 1 : -1, Math.min(1, Math.abs(main.value - 1) * 6), mode, paper);
  const rows = useMemo(() => {
    const term = TERM.map(t => quotes.find(q => q.sym === t.sym)).filter(Boolean) as RegimeQuote[];
    const gauges = quotes.filter(q => !TERM.some(t => t.sym === q.sym));
    return { term, gauges };
  }, [quotes]);
  const trouble = regimeTrouble(error);

  if (!data) {
    return (
      <div className="h-full flex items-center justify-center px-6 text-center font-mono text-t12 text-textSecondary" data-regime-empty>
        {loading ? 'Reading the VIX term structure…' : trouble ?? 'No VIX prints on file.'}
      </div>
    );
  }
  const stale = (q: RegimeQuote) => !!q.at && !!data.asOf && q.at.slice(0, 10) !== data.asOf.slice(0, 10);
  const year = data.yearEnd ? `the past year's daily closes to ${fmtDay(data.yearEnd, false)}` : "the past year's daily closes";
  const row = (q: RegimeQuote) => {
    const chg = q.price != null && q.prev != null ? q.price - q.prev : null;
    return (
      <tr key={q.sym} className="border-t border-borderSubtle/40" data-regime-row={q.sym} title={q.at ? `${q.sym} ${fmtStamp(q.at)}${q.prevDay ? ` · change from the ${fmtDay(q.prevDay, false)} close` : ''}` : undefined}>
        <td className="py-[3px] pr-2 font-mono text-t11 text-textSecondary whitespace-nowrap">{q.sym}</td>
        <td className={`py-[3px] pr-2 text-right font-mono text-t12 tnum whitespace-nowrap ${stale(q) ? 'text-textMuted' : 'text-textPrimary font-semibold'}`}>
          {q.price == null ? '—' : q.price.toFixed(2)}
          {stale(q) && <span className="ml-1 text-t9 font-normal">{fmtDay(q.at, false)}</span>}
        </td>
        <td className="py-[3px] pr-2 text-right font-mono text-t11 tnum whitespace-nowrap" style={{ color: chg == null || chg === 0 ? 'rgb(var(--text-muted))' : inkOf(chg > 0 ? 1 : -1, Math.min(1, Math.abs(chg) / Math.max(0.01, q.prev ?? 1) * 8), mode, paper) }}>
          {chg == null ? '—' : signed(chg, 2)}
        </td>
        <td className="py-[3px] w-[42%]">
          {q.pct == null ? (
            <span className="font-mono text-t10 text-textMuted">{data.pending?.year ? 'reading…' : '—'}</span>
          ) : (
            <span className="flex items-center gap-1.5" title={`Higher than ${Math.round(q.pct)}% of ${year} (${q.n}) · range ${q.lo?.toFixed(2)}–${q.hi?.toFixed(2)}`}>
              <span className="relative flex-1 h-[5px] rounded-full bg-ink/[0.08] overflow-hidden" data-regime-pct>
                <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(2, q.pct)}%`, background: pctInk(q.pct, mode, paper) }} />
              </span>
              <span className="w-8 text-right font-mono text-t10 tnum text-textSecondary">{ordinal(q.pct)}</span>
            </span>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden px-3 pb-3" data-regime-view data-regime={data.regime ?? ''}>
      {/* THE HEAD: the shape in words and its ratio, and when the prints are from */}
      <div className="pt-2 pb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className={SECTION}>VIX term structure</span>
        <span className="ml-auto font-mono text-t10 tnum whitespace-nowrap" data-regime-asof={data.live ? 'live' : 'asof'}>
          {data.live ? (
            <span className="text-textSecondary">
              <span className="inline-block w-1.5 h-1.5 mr-1 rounded-full align-middle bg-bull" aria-hidden />
              Live · {fmtStamp(data.asOf).split(', ')[1]}
            </span>
          ) : (
            <span className="text-warn">As of {fmtStamp(data.asOf)}</span>
          )}
        </span>
      </div>
      {regime && main?.value != null && (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5" title={regime.hint}>
          <span className="text-t125 font-semibold" style={{ color: regimeInk }} data-regime-shape>
            {regime.label}
          </span>
          <span className="font-mono text-t11 tnum text-textSecondary">
            VIX/VIX3M {main.value.toFixed(3)}
          </span>
          <span className="font-mono text-t10 text-textMuted">{regime.hint.split(': ')[1]}</span>
        </div>
      )}
      <Curve quotes={rows.term} ink={regimeInk} mode={mode} paper={paper} />
      <div className="flex items-center gap-3 font-mono text-t9 text-textMuted -mt-0.5 mb-1">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-3 h-[2px]" style={{ background: regimeInk }} aria-hidden />
          {fmtDay(data.day, false)}
        </span>
        {data.yearEnd && (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-3 border-t border-dashed border-textMuted" aria-hidden />
            {fmtDay(data.yearEnd, false)} close
          </span>
        )}
      </div>

      {/* THE PRINTS, each against its year */}
      <table className="w-full border-collapse" data-regime-table>
        <thead>
          <tr className="font-mono text-t9 uppercase tracking-wider text-textMuted">
            <th className="pb-1 text-left font-normal">Index</th>
            <th className="pb-1 pr-2 text-right font-normal">Last</th>
            <th className="pb-1 pr-2 text-right font-normal">Chg</th>
            <th className="pb-1 text-left font-normal">1y pct</th>
          </tr>
        </thead>
        <tbody>
          {rows.term.map(row)}
          {rows.gauges.length > 0 && (
            <tr>
              <td colSpan={4} className="pt-2 pb-0.5 font-mono text-t9 uppercase tracking-wider text-textMuted">
                Vol of vol · tail
              </td>
            </tr>
          )}
          {rows.gauges.map(row)}
        </tbody>
      </table>

      {/* THE RATIOS through the day */}
      <div className="mt-2">
        <div className={`${SECTION} pb-1`}>Ratios · {fmtDay(data.day)}</div>
        {(data.ratios ?? []).map(r => (
          <RatioPath key={r.key} r={r} mode={mode} paper={paper} day={data.day} />
        ))}
      </div>
      <p className="mt-1 font-mono text-t9 leading-snug text-textMuted" data-regime-foot>
        Percentiles rank each print against {year}. Chg is from that close.
        {trouble ? <span className="block text-warn">{trouble}</span> : null}
      </p>
    </div>
  );
};

export default VolRegimeView;
