/*
==================================================
  SLAYER TERMINAL - CONTRACT FLOW PANELS
  Two strips of ONE instrument — the drilldown stacks
  them on a shared clock:

    FlowPanel   — the flow of the CONTRACT itself as
                  THE LEDGER: every print is a brick,
                  stacked per bar interval — buyers
                  who paid the offer stack up, sellers
                  who hit the bid stack down, mid
                  fills straddle the zero line. Top
                  strip: its x-axis is present but
                  unlabelled, because the strip below
                  prints the clock once.
    NetPanel    — the UNDERLYING's cumulative net
                  call vs put premium with price on
                  top, and the four books that make
                  it up. Bottom strip: owns the axis.

  Both accept a printMin: the minute of the print the
  drilldown was opened from, drawn as one lime line
  through BOTH strips — the terminal pointing at the
  moment you clicked. Window controls (range, bars,
  single-leg) live in the drilldown's shared toolbar,
  not here. Every label is spelled out — the
  competition ships "NCP / NPP / RVOL" and expects
  you to already know.
==================================================
*/

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Customized,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  useXAxisScale,
  useYAxisScale,
} from 'recharts';
import Chip from '../ui/Chip';
import RichRead from '../ui/RichRead';
import { bucketMinutes, bucketTicks, flowClock, runningAvg, SESSION_MIN, type ContractTape, type LedgerBin } from '../../data/contractflow';
import { sideShares, usd as fmtUsd } from '../../data/traceLive';
import { BULL, SUPREME } from '../gex/paletteInk';
import { useResolvedTheme } from '../../theme/theme';

const ASK = BULL; // lifted the offer — the market's bull colour
/* EVERY INK A TOKEN (the light sweep, 2026-09-19 — Noah on Trace: "first thing i notice already is the background color of
   these 2 cards"). The two strips were black islands with typed whites, whatever the page wore. Each ink below is a
   token, so the box's own theme stamp re-inks the whole chart (a var() in an SVG fill or stroke is read like any CSS
   value) — and the stamp follows THE PAGE, never the candle pick: on the dark terminal it is the black island it always
   was; on the light page it is part of the page, and the grey box that holds it shows through ("i see a light gray
   holding a inner dark gray. make it all light gray"). It followed the candle store for an hour and turned grey on a
   dark page that held a Stone pick — a light-theme change must never move the dark theme. */
const BID = 'rgb(var(--bear))';
const FENCE = 'rgb(var(--text-primary) / 0.3)'; // mid fills — undecided, sits ON the zero line
const PRICE_LINE = 'rgb(var(--text-primary))'; // neutral "where the market is"
const IV_LINE = 'rgb(var(--cat-analyst))'; // a violet from the wire's categorical set — a different axis, a different family (the moon until 2026-10-13)
const AXIS = 'rgb(var(--text-muted))'; // axis labels were the squintiest gray on the page
const GRID = 'rgb(var(--ink) / 0.05)';
const HOVER_WASH = 'rgb(var(--ink) / 0.04)';
const ZERO_LINE = 'rgb(var(--ink) / 0.2)';

/* Stacked strips only read as one instrument if their plot areas align to the
   pixel. Same left axis width, and the right gutter is reserved even when the
   optional right axis is off — otherwise toggling IV or price shears the two
   clocks apart. */
const Y_LEFT_W = 56;
const Y_RIGHT_W = 44;
const RIGHT_PAD = 6;

/** The moment-marker — the print the drilldown was opened from. White, not
    lime (Noah, 2026-08-18): white = "where", the same voice as the spot rule. */
const printLine = (offset: number, yAxisId: string, withLabel: boolean, windowMin = Infinity, at = offset) => (
  <ReferenceLine
    x={at}
    yAxisId={yAxisId}
    stroke={PRICE_LINE}
    strokeOpacity={0.9}
    strokeDasharray="4 3"
    label={
      withLabel
        ? /* the label reads INTO the plot: right of a line in the window's first half, left of it after — at the right edge
             it ran under the price axis as "This prin" (the ship pass, 2026-10-22) */
          { value: 'This print', position: offset > windowMin * 0.5 ? 'insideTopRight' : 'insideTopLeft', fill: PRICE_LINE, fontSize: 11, fontFamily: "'Inter', sans-serif", offset: 8 }
        : undefined
    }
  />
);

const axisTick = { fill: AXIS, fontSize: 10, fontFamily: "'Inter', sans-serif" };

const Box = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded border border-borderMuted bg-panel px-2.5 py-1.5 shadow-2xl shadow-black/60 font-mono text-[11px]">
    {children}
  </div>
);

/** Bid / mid / ask as three named parts of one bar — never a two-way split that folds the mid into a side (the audit,
    2026-10-22: "HIT THE BID 51%" counted the mid volume as hit) */
export const SideSplit = ({ bid, mid, ask, unit, caption, className = '' }: { bid: number; mid: number; ask: number; unit: string; caption?: string; className?: string }) => {
  /* ONE ROUNDING with the card's own side figure (traceLive sideShares — the third audit: "bid 44%" beside "BID 43%") */
  const sh = sideShares(bid, mid, ask);

  const fmt = (v: number) => (unit === '$' ? fmtUsd(v) : v.toLocaleString('en-US'));
  return (
    <div className={`flex flex-col gap-1 ${className}`} title={`${fmt(bid)} on the bid · ${fmt(mid)} at the mid or no side · ${fmt(ask)} at the ask${unit === '$' ? '' : ` ${unit}`}`}>
      <div className="flex items-baseline justify-between gap-3 font-mono text-[11px] uppercase tracking-wider">
        <span className="text-textSecondary">Bid {sh.bid}%</span>
        <span className="text-textMuted">Mid {sh.mid}%</span>
        <span className="text-textSecondary">Ask {sh.ask}%</span>
      </div>
      <span className="flex h-1.5 rounded-full overflow-hidden bg-ink/[0.06]">
        <span className="h-full bg-bear/80" style={{ width: `${sh.bid}%` }} />
        <span className="h-full bg-ink/25" style={{ width: `${sh.mid}%` }} />
        <span className="h-full bg-bull" style={{ width: `${sh.ask}%` }} />
      </span>
      {caption && <span className="font-mono text-[11px] text-textMuted normal-case">{caption}</span>}
    </div>
  );
};

// Moved to ui/Chip so light callers don't pull recharts; re-exported for compat.
export { default as Chip } from '../ui/Chip';

/** One figure in a panel's stat strip. */
const Stat = ({ label, value, tone = 'text-textPrimary' }: { label: string; value: string; tone?: string }) => (
  <span className="flex flex-col gap-0.5 min-w-0">
    <span className="font-mono text-[11px] uppercase tracking-wider text-textMuted truncate">{label}</span>
    <span className={`font-mono text-[12px] font-semibold tnum ${tone} truncate`}>{value}</span>
  </span>
);

/**
 * A two-sided share bar with both ends named. Same tug grammar as the earnings
 * slate and the news tape — the label says which side is which, so the colour
 * never has to be decoded.
 */
const TugBar = ({
  leftLabel,
  rightLabel,
  leftPct,
  caption,
  className = '',
}: {
  leftLabel: string;
  rightLabel: string;
  leftPct: number;
  caption?: string;
  /** Width restraint — at full modal width an unconstrained bar becomes a
      1600px colour band that shouts over the chart it annotates. */
  className?: string;
}) => (
  <div className={`flex flex-col gap-1 ${className}`}>
    <div className="flex items-baseline justify-between gap-3 font-mono text-[11px] uppercase tracking-wider">
      <span className={leftPct >= 50 ? 'text-bear font-semibold' : 'text-textSecondary'}>
        {leftLabel} {Math.round(leftPct)}%
      </span>
      {caption && <span className="text-textMuted normal-case tracking-normal">{caption}</span>}
      <span className={leftPct < 50 ? 'text-bull font-semibold' : 'text-textSecondary'}>
        {rightLabel} {100 - Math.round(leftPct)}%
      </span>
    </div>
    <span className="flex h-1.5 rounded-full overflow-hidden bg-ink/[0.06]">
      <span className="h-full bg-bear/80 transition-[width] duration-500" style={{ width: `${leftPct}%` }} />
      <span className="h-full bg-bull transition-[width] duration-500" style={{ width: `${100 - leftPct}%` }} />
    </span>
  </div>
);

// ---- the contract's minutes -----------------------------------------------------------------------------------

export interface FlowPanelProps {
  tape: ContractTape;
  intervalMin: number;
  showAvg: boolean;
  onShowAvg: (v: boolean) => void;
  showIv: boolean;
  onShowIv: (v: boolean) => void;
  /** Minute of the clicked print since the bell — null hides the marker */
  printMin: number | null;
  syncId?: string;
}

/*
  THE LEDGER, ON THE VENDOR'S MINUTES: each bar is one bucket of the contract's session (the toolbar's interval), its
  money that paid the offer stacked up, its money that hit the bid stacked down, and the mid / no-side money as one
  grey block on the zero line. Every figure is /option-contract/{occ}/intraday — the whole session, by side — so the
  strip can never disagree with the day's totals above it. The heaviest bucket is named on the canvas.
*/
const LedgerLayer = ({ bins, intervalMin, heaviest, from = 0, to = SESSION_MIN }: { bins: LedgerBin[]; intervalMin: number; heaviest: LedgerBin | null; from?: number; to?: number }) => {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale('prem');
  if (!xScale || !yScale || bins.length === 0) return null;
  const x = (v: number) => xScale(v) ?? 0;
  const y = (v: number) => yScale(v) ?? 0;
  const binPx = Math.abs(x(intervalMin) - x(0));
  const w = Math.max(2, Math.min(16, binPx * 0.7));
  const rects: React.ReactNode[] = [];
  for (const b of bins) {
    const cx = x(b.min + intervalMin / 2);
    const left = cx - w / 2;
    const half = b.midPrem / 2;
    const top = b === heaviest;
    if (b.midPrem > 0) {
      const t = y(half);
      rects.push(<rect key={`m${b.min}`} x={left + w * 0.15} y={t} width={w * 0.7} height={Math.max(1, y(-half) - t)} fill={FENCE} />);
    }
    if (b.askPrem > 0) {
      const t = y(half + b.askPrem);
      rects.push(<rect key={`u${b.min}`} x={left} y={t} width={w} height={Math.max(1, y(half) - t)} fill={top ? SUPREME : ASK} fillOpacity={top ? 0.95 : 0.85} />);
    }
    if (b.bidPrem > 0) {
      const t = y(-half);
      rects.push(<rect key={`d${b.min}`} x={left} y={t} width={w} height={Math.max(1, y(-half - b.bidPrem) - t)} fill={top ? SUPREME : BID} fillOpacity={top ? 0.95 : 0.8} />);
    }
  }
  let label: React.ReactNode = null;
  if (heaviest) {
    const half = heaviest.midPrem / 2;
    const up = heaviest.askPrem >= heaviest.bidPrem;
    const edge = up ? y(half + heaviest.askPrem) : y(-half - heaviest.bidPrem);
    const first = x(from);
    const last = x(to);
    const tx = Math.min(Math.max(x(heaviest.min + intervalMin / 2), first + 70), last - 70);
    label = (
      <text x={tx} y={up ? edge - 5 : edge + 11} textAnchor="middle" fill={SUPREME} fontSize={9} fontWeight={600} fontFamily="'Inter', sans-serif">
        HEAVIEST {intervalMin === 1 ? 'MINUTE' : `${intervalMin}-MIN BAR`} · {fmtUsd(heaviest.askPrem + heaviest.bidPrem + heaviest.midPrem)}
      </text>
    );
  }
  return (
    <g>
      {rects}
      {label}
    </g>
  );
};

interface LedgerTipProps {
  active?: boolean;
  step: number;
  payload?: { payload?: { min?: number; up?: number; down?: number; mid?: number; vol?: number } }[];
}
const LedgerTooltip = ({ active, payload, step }: LedgerTipProps) => {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p || !Number.isFinite(p.min)) return null;
  const from = (p.min as number) - step / 2;
  return (
    <Box>
      <div className="text-textMuted">
        {flowClock(from)}
        {step > 1 ? `–${flowClock(from + step)}` : ''} CT · {(p.vol ?? 0).toLocaleString('en-US')} contracts
      </div>
      {(p.up ?? 0) > 0 && <div style={{ color: ASK }}>paid the offer {fmtUsd(p.up as number)}</div>}
      {(p.down ?? 0) > 0 && <div style={{ color: BID }}>hit the bid {fmtUsd(p.down as number)}</div>}
      {(p.mid ?? 0) > 0 && <div className="text-textMuted">mid or no side {fmtUsd(p.mid as number)}</div>}
    </Box>
  );
};

/** The strip's hour ticks across its window — 09:30, 10:30 … and the window's own ends */
const ticksFor = (from: number, to: number): number[] => {
  const out = new Set<number>([from, to]);
  for (let m = Math.ceil(from / 60) * 60; m <= to; m += 60) out.add(m);
  return [...out].sort((a, b) => a - b);
};

export const FlowPanel = ({ tape, intervalMin, showAvg, onShowAvg, showIv, onShowIv, printMin, syncId }: FlowPanelProps) => {
  const paper = useResolvedTheme() === 'light';
  const bins = useMemo(() => bucketMinutes(tape.minutes, intervalMin), [tape.minutes, intervalMin]);
  const avg = useMemo(() => runningAvg(tape.minutes), [tape.minutes]);
  const heaviest = useMemo(() => bins.reduce<LedgerBin | null>((a, b) => (!a || b.askPrem + b.bidPrem + b.midPrem > a.askPrem + a.bidPrem + a.midPrem ? b : a), null), [bins]);
  const maxSide = useMemo(() => Math.max(1, ...bins.map(b => Math.max(b.midPrem / 2 + b.askPrem, b.midPrem / 2 + b.bidPrem))), [bins]);
  const binRows = useMemo(() => bins.map(b => ({ min: b.min + intervalMin / 2, up: b.askPrem, down: b.bidPrem, mid: b.midPrem, vol: b.vol, hover: b.midPrem / 2 + b.askPrem })), [bins, intervalMin]);
  const premDomain = useMemo(() => [-maxSide * 1.08, maxSide * 1.08], [maxSide]);
  const totals = useMemo(() => tape.minutes.reduce((a, m) => ({ ask: a.ask + m.askVol, bid: a.bid + m.bidVol, mid: a.mid + m.midVol, prem: a.prem + m.askPrem + m.bidPrem + m.midPrem }), { ask: 0, bid: 0, mid: 0, prem: 0 }), [tape.minutes]);
  /* ONE WINDOW (the re-audit, 2026-10-22: the avg paid and the side bar were the regular session's while the dollars and
     the print count were the whole day's) — every figure here is the strip's own minutes, and the label says which */
  const w = tape.window;
  const vwap = avg.length ? avg[avg.length - 1].price : 0;
  const summary = [
    vwap > 0 ? `avg paid $${vwap.toFixed(2)}` : null,
    `${fmtUsd(totals.prem)} traded`,
    w.source === 'prints' ? `${tape.prints.length.toLocaleString('en-US')} prints` : `${(totals.ask + totals.bid + totals.mid).toLocaleString('en-US')} contracts`,
    `· ${w.label}`,
  ].filter(Boolean).join(' · ').replace(' · · ', ' · ');
  const domain = useMemo(() => [w.from, w.to] as [number, number], [w.from, w.to]);
  const ticks = useMemo(() => ticksFor(w.from, w.to), [w.from, w.to]);

  return (
    <div className={`flex flex-col gap-2 min-w-0 rounded-md px-2 py-1.5 ${paper ? '' : 'bg-panel'}`} data-theme={paper ? 'light' : 'dark'} data-flow-strip>
      <div className="flex items-baseline gap-2.5 flex-wrap">
        <span className="font-mono text-[11px] uppercase tracking-widest text-textSecondary">The contract's session</span>
        <span className="font-mono text-[11px] text-textMuted tnum" data-flow-summary>
          <RichRead text={summary} />
        </span>
        <span className="ml-auto flex items-center gap-0.5">
          <Chip active={showAvg} onClick={() => onShowAvg(!showAvg)} title="The running volume-weighted fill">
            Avg paid
          </Chip>
          <Chip active={showIv} onClick={() => onShowIv(!showIv)} title="Implied volatility, each minute">
            Implied vol
          </Chip>
        </span>
      </div>

      <SideSplit className="max-w-[460px]" bid={totals.bid} mid={totals.mid} ask={totals.ask} unit="contracts" caption={`${totals.bid.toLocaleString('en-US')} on the bid · ${totals.mid.toLocaleString('en-US')} mid or no side · ${totals.ask.toLocaleString('en-US')} at the ask — the same window's contracts`} />

      <div className="h-[200px] -ml-2">
        {bins.length === 0 ? (
          <div className="h-full flex items-center justify-center font-mono text-[11px] uppercase tracking-widest text-textMuted">{w.source === 'prints' ? 'No prints this session' : 'No prints in the regular session'}</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={binRows} syncId={syncId} syncMethod="value" margin={{ top: 6, right: showAvg ? RIGHT_PAD : RIGHT_PAD + Y_RIGHT_W, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis type="number" dataKey="min" domain={domain} ticks={ticks} tick={false} height={4} stroke={AXIS} tickLine={false} axisLine={false} allowDataOverflow />
              <YAxis yAxisId="prem" type="number" tick={axisTick} stroke={AXIS} tickLine={false} width={Y_LEFT_W} domain={premDomain} tickFormatter={(v: number) => `${v < 0 ? '−' : ''}${fmtUsd(Math.abs(v))}`} />
              {showAvg && <YAxis yAxisId="px" orientation="right" tick={axisTick} stroke={AXIS} tickLine={false} width={Y_RIGHT_W} domain={['auto', 'auto']} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />}
              {showIv && <YAxis yAxisId="iv" hide domain={['auto', 'auto']} />}
              <Tooltip content={<LedgerTooltip step={intervalMin} />} isAnimationActive={false} cursor={{ fill: HOVER_WASH }} />
              <ReferenceLine yAxisId="prem" y={0} stroke={ZERO_LINE} />
              <Bar yAxisId="prem" dataKey="hover" barSize={8} fillOpacity={0} isAnimationActive={false} />
              <Customized component={<LedgerLayer bins={bins} intervalMin={intervalMin} heaviest={heaviest} from={w.from} to={w.to} />} />
              {showAvg && <Line yAxisId="px" data={avg} type="monotone" dataKey="price" stroke={PRICE_LINE} strokeWidth={1} strokeDasharray="3 3" dot={false} activeDot={false} isAnimationActive={false} />}
              {showIv && <Line yAxisId="iv" data={avg} type="monotone" dataKey="iv" stroke={IV_LINE} strokeWidth={1} dot={false} activeDot={false} isAnimationActive={false} />}
              {printMin !== null && printLine(printMin - w.from, 'prem', true, w.to - w.from, printMin)}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-textSecondary">
          <span className="w-2 h-2" style={{ background: ASK }} /> Paid the offer · stacks up
        </span>
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-textSecondary">
          <span className="w-2 h-2" style={{ background: BID }} /> Hit the bid · stacks down
        </span>
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-textSecondary">
          <span className="w-2 h-2" style={{ background: FENCE }} /> Mid or no side · on the line
        </span>
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-textSecondary">
          <span className="w-2 h-2" style={{ background: SUPREME }} /> Heaviest bar
        </span>
        {printMin !== null && (
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-textSecondary">
            <span className="w-3 h-[2px]" style={{ background: PRICE_LINE }} /> This print
          </span>
        )}
      </div>
    </div>
  );
};

// ---- the underlying's net premium ---------------------------------------------------------------------------

interface NetTipProps {
  active?: boolean;
  payload?: { payload?: { min?: number; netCall?: number; netPut?: number } }[];
}
const NetTooltip = ({ active, payload }: NetTipProps) => {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <Box>
      <div className="text-textMuted">{Number.isFinite(p.min) ? `${flowClock(p.min as number)} CT` : ''}</div>
      {Number.isFinite(p.netCall) && <div style={{ color: (p.netCall as number) >= 0 ? ASK : BID }}>net calls {fmtUsd(p.netCall as number)}</div>}
      {Number.isFinite(p.netPut) && <div style={{ color: (p.netPut as number) > 0 ? BID : ASK }}>net puts {fmtUsd(p.netPut as number)} {(p.netPut as number) > 0 ? '· bought, bearish' : (p.netPut as number) < 0 ? '· sold, bullish' : ''}</div>}
    </Box>
  );
};

/* Two ways to read the underlying's session — both straight off /stock/{t}/net-prem-ticks */
export type NetMetric = 'netPremium' | 'contracts';

export const NET_METRICS: { value: NetMetric; label: string; hint: string }[] = [
  { value: 'netPremium', label: 'Net premium', hint: 'running net call and net put premium — at the ask less at the bid' },
  { value: 'contracts', label: 'Contracts traded', hint: 'calls against puts, by count' },
];

/** Small anchored dropdown — the house pattern from the chart toolbar. */
const MetricPicker = ({ value, onChange }: { value: NetMetric; onChange: (v: NetMetric) => void }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);
  const active = NET_METRICS.find(m => m.value === value) ?? NET_METRICS[0];
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`slayer-chip uppercase tracking-wider ${open ? 'border-borderMuted text-textPrimary' : ''}`}
      >
        {active.label}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-40 min-w-[220px] border border-borderMuted bg-panel rounded-md shadow-2xl shadow-black/60 overflow-hidden animate-slide-in">
          {NET_METRICS.map(m => (
            <button
              key={m.value}
              onClick={() => {
                onChange(m.value);
                setOpen(false);
              }}
              className="w-full flex items-start gap-2 px-2.5 py-2 text-left hover:bg-ink/[0.04] transition-colors"
            >
              <span className="w-3.5 pt-0.5 shrink-0">{m.value === value && <Check className="w-3 h-3 text-select" />}</span>
              <span className="flex flex-col min-w-0">
                <span className={`font-mono text-[11px] ${m.value === value ? 'text-textPrimary font-semibold' : 'text-textSecondary'}`}>{m.label}</span>
                <span className="font-mono text-[11px] text-textMuted">{m.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

interface BarTipProps {
  active?: boolean;
  step: number;
  payload?: { payload?: { min?: number; callVol?: number; putVol?: number } }[];
}
const BarTooltip = ({ active, payload, step }: BarTipProps) => {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  const from = (p.min as number) - step / 2;
  return (
    <Box>
      <div className="text-textMuted">
        {flowClock(from)}
        {step > 1 ? `–${flowClock(from + step)}` : ''} CT
      </div>
      {Number.isFinite(p.callVol) && <div style={{ color: ASK }}>calls {Math.abs(p.callVol as number).toLocaleString('en-US')} contracts</div>}
      {Number.isFinite(p.putVol) && <div style={{ color: BID }}>puts {Math.abs(p.putVol as number).toLocaleString('en-US')} contracts</div>}
    </Box>
  );
};

export interface NetPanelProps {
  tape: ContractTape;
  ticker: string;
  intervalMin: number;
  metric: NetMetric;
  onMetric: (m: NetMetric) => void;
  showCalls: boolean;
  onShowCalls: (v: boolean) => void;
  showPuts: boolean;
  onShowPuts: (v: boolean) => void;
  printMin: number | null;
  syncId?: string;
}

const xFmt = (v: number) => flowClock(v);
const signedUsd = (v: number) => `${v >= 0 ? '+' : '−'}${fmtUsd(Math.abs(v))}`;

export const NetPanel = ({ tape, ticker, intervalMin, metric, onMetric, showCalls, onShowCalls, showPuts, onShowPuts, printMin, syncId }: NetPanelProps) => {
  const paper = useResolvedTheme() === 'light';
  const n = tape.net;
  const bars = useMemo(() => (n ? bucketTicks(n.series, intervalMin).map(b => ({ ...b, min: b.min + intervalMin / 2 })) : []), [n, intervalMin]);
  const premAbs = useMemo(() => (n ? Math.max(1, ...n.series.map(t => Math.max(Math.abs(t.netCall), Math.abs(t.netPut)))) : 1), [n]);
  if (!n) {
    return (
      <div className={`flex flex-col gap-2 min-w-0 rounded-md px-2 py-1.5 ${paper ? '' : 'bg-panel'}`} data-theme={paper ? 'light' : 'dark'} data-flow-strip>
        <span className="font-mono text-[11px] uppercase tracking-widest text-textSecondary">{ticker} net premium</span>
        <div className="h-[120px] flex items-center justify-center font-mono text-[11px] uppercase tracking-widest text-textMuted">No minutes for {ticker} in this session</div>
      </div>
    );
  }
  const net = n.netCall - n.netPut;
  return (
    <div className={`flex flex-col gap-2 min-w-0 rounded-md px-2 py-1.5 ${paper ? '' : 'bg-panel'}`} data-theme={paper ? 'light' : 'dark'} data-flow-strip>
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className="font-mono text-[11px] uppercase tracking-widest text-textSecondary">{ticker} net premium · every expiry · the same window</span>
        <MetricPicker value={metric} onChange={onMetric} />
        {metric === 'netPremium' ? (
          <span className="font-mono text-[11px] text-textMuted tnum" data-net-summary title="Net premium is premium at the ask less premium at the bid. Net calls bought lean bullish; net puts bought lean bearish. The net is net calls less net puts.">
            net <span className={net >= 0 ? 'text-bull font-semibold' : 'text-bear font-semibold'}>{signedUsd(net)}</span> · net calls{' '}
            <span className={n.netCall >= 0 ? 'text-bull font-semibold' : 'text-bear font-semibold'}>{signedUsd(n.netCall)}</span> · net puts{' '}
            <span className={n.netPut >= 0 ? 'text-bear font-semibold' : 'text-bull font-semibold'}>{signedUsd(n.netPut)}</span>
          </span>
        ) : (
          <span className="font-mono text-[11px] text-textMuted tnum">
            {(n.callVol + n.putVol).toLocaleString('en-US')} contracts · calls {n.callVol.toLocaleString('en-US')} · puts {n.putVol.toLocaleString('en-US')}
          </span>
        )}
      </div>

      <div className="h-[210px] -ml-2">
        <ResponsiveContainer width="100%" height="100%">
          {metric === 'contracts' ? (
            <ComposedChart data={bars} syncId={syncId} syncMethod="value" margin={{ top: 6, right: RIGHT_PAD + Y_RIGHT_W, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="min" type="number" domain={[tape.window.from, tape.window.to]} ticks={ticksFor(tape.window.from, tape.window.to)} tickFormatter={xFmt} tick={axisTick} stroke={AXIS} tickLine={false} allowDataOverflow />
              <YAxis yAxisId="v" tick={axisTick} stroke={AXIS} tickLine={false} width={Y_LEFT_W} tickFormatter={(v: number) => `${v < 0 ? '−' : ''}${Math.abs(v) >= 1000 ? `${Math.round(Math.abs(v) / 1000)}k` : String(Math.abs(v))}`} />
              <Tooltip content={<BarTooltip step={intervalMin} />} isAnimationActive={false} cursor={{ fill: HOVER_WASH }} />
              <ReferenceLine yAxisId="v" y={0} stroke={ZERO_LINE} />
              {showCalls && <Bar yAxisId="v" dataKey="callVol" stackId="u" fill={ASK} fillOpacity={0.75} isAnimationActive={false} />}
              {showPuts && <Bar yAxisId="v" dataKey="putVol" stackId="u" fill={BID} fillOpacity={0.7} isAnimationActive={false} />}
              {printMin !== null && printLine(printMin, 'v', false)}
            </ComposedChart>
          ) : (
            <ComposedChart data={n.series} syncId={syncId} syncMethod="value" margin={{ top: 6, right: RIGHT_PAD + Y_RIGHT_W, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="min" type="number" domain={[tape.window.from, tape.window.to]} ticks={ticksFor(tape.window.from, tape.window.to)} tickFormatter={xFmt} tick={axisTick} stroke={AXIS} tickLine={false} allowDataOverflow />
              <YAxis yAxisId="prem" tick={axisTick} stroke={AXIS} tickLine={false} width={Y_LEFT_W} domain={[-premAbs, premAbs]} tickFormatter={(v: number) => `${v < 0 ? '−' : ''}${fmtUsd(Math.abs(v))}`} />
              <Tooltip content={<NetTooltip />} isAnimationActive={false} cursor={{ stroke: 'rgb(var(--ink) / 0.15)' }} />
              {/* EACH LINE WEARS ITS MEANING (the retail pass, 2026-10-22: a put line below zero — puts sold, bullish — drew red):
                  the axis is symmetric about zero, so a gradient split at the middle inks calls green above and red below,
                  puts red above (bought, bearish) and green below (sold, bullish); the puts are dashed */}
              <defs>
                <linearGradient id="cf-calls" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="50%" stopColor={ASK} />
                  <stop offset="50%" stopColor={BID} />
                </linearGradient>
                <linearGradient id="cf-puts" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="50%" stopColor={BID} />
                  <stop offset="50%" stopColor={ASK} />
                </linearGradient>
              </defs>
              <ReferenceLine yAxisId="prem" y={0} stroke={ZERO_LINE} />
              {showCalls && <Area yAxisId="prem" type="monotone" dataKey="netCall" stroke="url(#cf-calls)" strokeWidth={1.25} fill="url(#cf-calls)" fillOpacity={0.12} isAnimationActive={false} baseValue={0} />}
              {showPuts && <Area yAxisId="prem" type="monotone" dataKey="netPut" stroke="url(#cf-puts)" strokeWidth={1.25} strokeDasharray="4 2" fill="url(#cf-puts)" fillOpacity={0.12} isAnimationActive={false} baseValue={0} />}
              {printMin !== null && printLine(printMin, 'prem', false)}
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* the session's contracts by side — the feed's own split of the same minutes */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5">
        <Stat label="Calls at the ask" value={n.callAsk.toLocaleString('en-US')} tone="text-bull" />
        <Stat label="Calls on the bid" value={n.callBid.toLocaleString('en-US')} tone="text-bear" />
        <Stat label="Puts at the ask" value={n.putAsk.toLocaleString('en-US')} tone="text-bear" />
        <Stat label="Puts on the bid" value={n.putBid.toLocaleString('en-US')} tone="text-bull" />
      </div>

      <div className="flex items-center gap-0.5 flex-wrap">
        <Chip active={showCalls} onClick={() => onShowCalls(!showCalls)}>
          {metric === 'netPremium' ? 'Net calls' : 'Calls'}
        </Chip>
        <Chip active={showPuts} onClick={() => onShowPuts(!showPuts)}>
          {metric === 'netPremium' ? 'Net puts' : 'Puts'}
        </Chip>
      </div>
    </div>
  );
};
