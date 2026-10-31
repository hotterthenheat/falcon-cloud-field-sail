/*
  THE RAIL'S OI CHANGE TAB: where positions were opened and closed overnight, per strike, for the pane's name and its
  expiry cut (the head's Expiry card: one expiry, or every expiry still live).

  Open interest is stamped once a session, about 06:30 ET, for the PREVIOUS session's close; so the tab compares the
  last two reports and names both closes and the mornings they were reported. One answer per name and cut for every
  pane and page (data/regimeFeed.ts useOiChange → server/regimeApi.mjs: two all-expiration reads a name a day, kept).

  Drawn as the other rail tabs are: the head's fact chips, caps section heads, mono figures, a one-line foot. The
  ladder is shadcn's chart (components/shadcn/chart.tsx) over a horizontal diverging recharts BarChart: contracts
  added to the right of zero, closed to the left, calls in glacier and puts in ember — the walls' inks everywhere — the
  five largest builds and unwinds at full strength with the select's edge, the rest at seven tenths.
*/

import { useEffect, useMemo, useRef } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../shadcn/chart';
import { useOiChange, regimeTrouble } from '../../data/regimeFeed';
import type { OiMove } from '../../../shared/volRegime.mjs';
import { fmtDay, signed } from './regimeFmt';
import { FactChip, INK, RailFoot, SectionHead, TICK } from './railFacts';

interface Props {
  ticker: string;
  /** 'book' (every expiry still live) or one expiry, YYYY-MM-DD */
  expiry: string;
  /** The cut in the head card's words: "Whole book", "Nov 2" */
  scopeLabel: string;
  spot: number;
  focusPrice?: number | null;
  onSelect?: (strike: number) => void;
}

/** The ladder shows the strikes within this share of spot (the named moves are always listed above it) */
const WINDOW = 0.08;
/** One strike's row in the ladder */
const ROW_H = 15;
const fmtStrike = (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));
const sideInk = (right: 'C' | 'P') => (right === 'C' ? INK.call : INK.put);

const CONFIG = {
  call: { label: 'Calls Δ', color: INK.call },
  put: { label: 'Puts Δ', color: INK.put },
} satisfies ChartConfig;

/** One named move: the strike, its side in the walls' ink, the change */
const MoveRow = ({ m, onSelect }: { m: OiMove; onSelect?: (k: number) => void }) => (
  <button
    type="button"
    onClick={() => onSelect?.(m.strike)}
    className="w-full flex items-baseline gap-1.5 h-[18px] px-1 -mx-1 rounded font-mono text-t11 tnum hover:bg-ink/[0.05] text-left"
    title={`${fmtStrike(m.strike)} ${m.right === 'C' ? 'call' : 'put'}: ${m.prior.toLocaleString('en-US')} → ${m.now.toLocaleString('en-US')}`}
    data-oi-move={`${m.strike}${m.right}`}
  >
    <span className="w-11 text-right text-textSecondary">{fmtStrike(m.strike)}</span>
    <span className="w-2.5 font-semibold" style={{ color: sideInk(m.right) }}>
      {m.right}
    </span>
    <span className="ml-auto font-semibold text-textPrimary">{signed(m.d)}</span>
  </button>
);

const OiChangeView = ({ ticker, expiry, scopeLabel, spot, focusPrice = null, onSelect }: Props) => {
  const { data, error, loading } = useOiChange(ticker, expiry);
  const listRef = useRef<HTMLDivElement>(null);
  const named = useMemo(() => new Set([...(data?.builds ?? []), ...(data?.unwinds ?? [])].map(m => `${m.strike}${m.right}`)), [data]);
  /* high strikes on top, as the chart's price axis reads */
  const shown = useMemo(() => {
    const lo = spot > 0 ? spot * (1 - WINDOW) : -Infinity;
    const hi = spot > 0 ? spot * (1 + WINDOW) : Infinity;
    return (data?.rows ?? [])
      .filter(r => r[0] >= lo && r[0] <= hi && (r[1] || r[2] || r[3] || r[4]))
      .reverse()
      .map(([k, c, c0, p, p0]) => ({ strike: fmtStrike(k), k, call: c - c0, put: p - p0, c, c0, p, p0 }));
  }, [data, spot]);
  /* zero where the window's changes put it: as far left as the largest unwind, as far right as the largest build */
  const [lo, hi] = useMemo(() => {
    let a = 0;
    let b = 0;
    for (const r of shown) {
      a = Math.min(a, r.call, r.put);
      b = Math.max(b, r.call, r.put);
    }
    const span = Math.max(1, b - a);
    return [a - span * 0.04, b + span * 0.04];
  }, [shown]);
  /* the spot sits at the first strike under it */
  const spotRow = spot > 0 ? shown.find(r => r.k <= spot) : undefined;
  const spotAt = spotRow ? shown.indexOf(spotRow) : -1;
  useEffect(() => {
    const el = listRef.current;
    if (!el || spotAt < 0) return;
    el.scrollTop = Math.max(0, spotAt * ROW_H - el.clientHeight / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.day, data?.expiry, ticker, shown.length > 0]);

  const trouble = regimeTrouble(error);
  if (!data) {
    return (
      <div className="h-full flex items-center justify-center px-6 text-center font-mono text-t11 uppercase tracking-widest text-textMuted" data-oi-empty>
        {loading ? `Reading ${ticker}'s open interest…` : trouble ?? `No open interest on file for ${ticker}`}
      </div>
    );
  }
  const t = data.totals ?? { call: 0, callPrior: 0, put: 0, putPrior: 0 };
  const pct = (a: number, b: number) => (b > 0 ? ` ${signed(((a - b) / b) * 100, 1)}%` : '');
  const exps = data.expiries ?? [];
  const scopeWords = expiry === 'book' ? `${scopeLabel.toLowerCase()} · ${exps.length} expir${exps.length === 1 ? 'y' : 'ies'}` : scopeLabel;
  const root = data.root !== ticker ? `${ticker} (${data.root})` : ticker;

  return (
    <div className="h-full flex flex-col min-h-0" data-oi-view data-oi-day={data.day}>
      {/* THE HEAD: the two closes compared, as the head's cards, and when they were reported */}
      <div className="shrink-0">
        <div className="flex flex-wrap items-center gap-1.5 px-2 pt-1.5" data-oi-dates>
          <FactChip label="Close" testId="close" title={`Open interest at the ${fmtDay(data.close)} close, reported 6:30 AM ET ${fmtDay(data.day)}`}>
            {fmtDay(data.close)}
          </FactChip>
          <span className="font-mono text-t9 uppercase tracking-widest text-textMuted">vs</span>
          <FactChip label="Close" testId="prior" title={`Open interest at the ${fmtDay(data.priorClose)} close, reported 6:30 AM ET ${fmtDay(data.prior)}`}>
            {fmtDay(data.priorClose)}
          </FactChip>
        </div>
        <p className="px-3 pt-1.5 text-t11 text-textMuted">
          Reported 6:30 AM ET {fmtDay(data.day, false)} and {fmtDay(data.prior, false)}
        </p>

        <SectionHead name="Open interest Δ" gloss={`${root} · ${scopeWords}`} />
        {data.rows && (
          <div className="grid grid-cols-1 gap-y-0.5 px-3 pb-1 font-mono text-t11 tnum" data-oi-totals>
            {(
              [
                ['Calls', t.call, t.callPrior, INK.call],
                ['Puts', t.put, t.putPrior, INK.put],
              ] as const
            ).map(([word, now, prior, ink]) => (
              <span key={word} className="flex items-baseline gap-1.5 whitespace-nowrap" title={`${prior.toLocaleString('en-US')} → ${now.toLocaleString('en-US')}`}>
                <span className="w-2 h-2 rounded-[2px] self-center shrink-0" style={{ background: ink }} aria-hidden />
                <span className="text-t9 uppercase tracking-widest text-textMuted">{word}</span>
                <span className="ml-auto font-semibold text-textPrimary">{signed(now - prior)}</span>
                <span className="w-14 text-right text-textMuted">{pct(now, prior)}</span>
              </span>
            ))}
          </div>
        )}

        {/* THE NAMED MOVES, two columns */}
        {((data.builds?.length ?? 0) > 0 || (data.unwinds?.length ?? 0) > 0) && (
          <div className="grid grid-cols-2 gap-x-4 px-3 pt-1.5 pb-2" data-oi-named>
            <div data-oi-builds>
              <div className="font-mono text-t9 uppercase tracking-widest text-textMuted pb-0.5">Largest builds</div>
              {(data.builds ?? []).map(m => <MoveRow key={`${m.strike}${m.right}`} m={m} onSelect={onSelect} />)}
            </div>
            <div data-oi-unwinds>
              <div className="font-mono text-t9 uppercase tracking-widest text-textMuted pb-0.5">Largest unwinds</div>
              {(data.unwinds ?? []).map(m => <MoveRow key={`${m.strike}${m.right}`} m={m} onSelect={onSelect} />)}
              {(data.unwinds?.length ?? 0) === 0 && <div className="font-mono text-t11 text-textMuted">none</div>}
            </div>
          </div>
        )}
        {trouble && <p className="px-3 pb-1 font-mono text-t11 text-warn">{trouble}</p>}
      </div>

      {exps.length === 0 ? (
        <p className="flex-1 flex items-center justify-center px-6 text-center font-mono text-t11 uppercase tracking-widest text-textMuted" data-oi-none>
          No {data.root} contracts expire {expiry === 'book' ? 'after' : 'on'} {expiry === 'book' ? fmtDay(data.close, false) : fmtDay(expiry, false)} in the {fmtDay(data.day, false)} report
        </p>
      ) : (
        <>
          {/* the ladder's column heads: closed to the left of zero, added to the right; the legend in the series' inks */}
          <div className="shrink-0 flex items-center gap-3 h-6 px-3 border-y border-borderSubtle/60 font-mono text-t9 uppercase tracking-widest text-textMuted">
            <span>◂ Closed</span>
            <span className="mx-auto flex items-center gap-3 normal-case tracking-normal text-t10">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-[2px]" style={{ background: INK.call }} aria-hidden />
                Calls Δ
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-[2px]" style={{ background: INK.put }} aria-hidden />
                Puts Δ
              </span>
            </span>
            <span>Added ▸</span>
          </div>
          <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden" data-oi-ladder>
            {shown.length > 0 ? (
              <ChartContainer config={CONFIG} className="aspect-auto w-full font-mono tnum" style={{ height: shown.length * ROW_H + 8 }}>
                <BarChart
                  data={shown}
                  layout="vertical"
                  margin={{ top: 4, right: 12, bottom: 4, left: 0 }}
                  barCategoryGap={2}
                  barGap={0}
                  onClick={(s: { activeLabel?: string | number } | null) => {
                    const r = shown.find(x => x.strike === String(s?.activeLabel ?? ''));
                    if (r) onSelect?.(r.k);
                  }}
                  accessibilityLayer
                >
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" domain={[lo, hi]} hide />
                  <YAxis
                    type="category"
                    dataKey="strike"
                    width={46}
                    interval={0}
                    tickLine={false}
                    axisLine={false}
                    tick={(p: { x?: number | string; y?: number | string; payload?: { value?: unknown } }) => {
                      const on = focusPrice != null && String(p.payload?.value) === fmtStrike(focusPrice);
                      return (
                        <text x={Number(p.x ?? 0) - 4} y={Number(p.y ?? 0)} dy={3.5} textAnchor="end" fontSize={TICK.fontSize} fontWeight={on ? 700 : 400} fill={on ? 'rgb(var(--text-primary))' : INK.axis}>
                          {String(p.payload?.value ?? '')}
                        </text>
                      );
                    }}
                  />
                  <ReferenceLine x={0} stroke={INK.grid} />
                  {spotRow && (
                    <ReferenceLine
                      y={spotRow.strike}
                      stroke="rgb(var(--text-secondary))"
                      strokeDasharray="3 3"
                      label={{ value: `${ticker} ${spot.toFixed(2)}`, position: 'insideTopLeft', fontSize: 10, fontWeight: 700, fill: 'rgb(var(--text-primary))' }}
                      data-oi-spot
                    />
                  )}
                  <ChartTooltip
                    cursor={{ fill: 'rgb(var(--ink) / 0.05)' }}
                    content={
                      <ChartTooltipContent
                        labelFormatter={(_, p) => `Strike ${p?.[0]?.payload?.strike ?? ''}`}
                        formatter={(value, name, item) => {
                          const r = item.payload as (typeof shown)[number];
                          const call = name === 'call';
                          return (
                            <div className="flex w-full items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-[2px] shrink-0" style={{ background: call ? INK.call : INK.put }} />
                              <span className="text-textMuted">{call ? 'Calls' : 'Puts'}</span>
                              <span className="ml-auto font-mono tabular-nums text-textSecondary">
                                {(call ? r.c0 : r.p0).toLocaleString('en-US')} → {(call ? r.c : r.p).toLocaleString('en-US')}
                              </span>
                              <span className="font-mono font-semibold tabular-nums text-textPrimary">{signed(Number(value))}</span>
                            </div>
                          );
                        }}
                      />
                    }
                  />
                  {(['call', 'put'] as const).map(side => (
                    <Bar key={side} dataKey={side} fill={`var(--color-${side})`} isAnimationActive={false} radius={1}>
                      {shown.map(r => {
                        const top = named.has(`${r.k}${side === 'call' ? 'C' : 'P'}`);
                        return <Cell key={r.k} fillOpacity={top ? 1 : 0.7} stroke={top ? INK.select : undefined} strokeWidth={top ? 1 : 0} data-oi-cell={`${r.k}${side === 'call' ? 'C' : 'P'}`} data-oi-top={top || undefined} />;
                      })}
                    </Bar>
                  ))}
                </BarChart>
              </ChartContainer>
            ) : (
              <p className="py-6 text-center font-mono text-t11 text-textMuted">No open interest within {Math.round(WINDOW * 100)}% of spot.</p>
            )}
          </div>
          <RailFoot>Strikes ±{Math.round(WINDOW * 100)}% of spot · the five largest outlined</RailFoot>
        </>
      )}
    </div>
  );
};

export default OiChangeView;
