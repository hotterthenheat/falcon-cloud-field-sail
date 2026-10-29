/* Two stacked strips on one clock: the contract's ledger (paid the offer up, hit the bid down) and the underlying's
   net call and put premium, a marker at the opened print's minute. Plain SVG, sized by its box. */

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import Chip from '../ui/Chip';
import RichRead from '../ui/RichRead';
import { bucketMinutes, bucketTicks, flowClock, runningAvg, type ContractTape, type LedgerBin } from '../../data/contractflow';
import { sideShares, usd as fmtUsd } from '../../data/traceLive';
import { BULL, SUPREME } from '../gex/paletteInk';
import { useResolvedTheme } from '../../theme/theme';

const ASK = BULL; // lifted the offer: the market's bull colour
/* Every ink is a token, so the box's theme stamp (the page's, never the candle pick) re-inks the whole chart. */
const BID = 'rgb(var(--bear))';
const FENCE = 'rgb(var(--text-primary) / 0.3)'; // mid fills sit on the zero line
const PRICE_LINE = 'rgb(var(--text-primary))';
const IV_LINE = 'rgb(var(--cat-analyst))';
const AXIS = 'rgb(var(--text-muted))';
const GRID = 'rgb(var(--ink) / 0.05)';
const HOVER_WASH = 'rgb(var(--ink) / 0.04)';
const ZERO_LINE = 'rgb(var(--ink) / 0.2)';
const FONT = "'Inter', sans-serif";

/* Stacked strips read as one instrument only if their plots align to the pixel, so the right gutter is reserved even
   when its axis is off. */
const Y_LEFT_W = 56;
const Y_RIGHT_W = 44;
const RIGHT_PAD = 6;
const TOP_PAD = 6;
const X_AXIS_H = 18;

const Box = ({ children }: { children: ReactNode }) => (
  <div className="rounded border border-borderMuted bg-panel px-2.5 py-1.5 shadow-2xl shadow-black/60 font-mono text-t11 whitespace-nowrap">{children}</div>
);

/* ---- the strip: a sized SVG plot with a left axis, an optional right axis, a shared hover ---------------------- */

/* the two strips of one card share their hovered minute, so both crosshairs and readouts move together */
const hoverStores = new Map<string, { v: number | null; subs: Set<() => void> }>();
const storeOf = (id: string) => {
  let st = hoverStores.get(id);
  if (!st) {
    st = { v: null, subs: new Set() };
    hoverStores.set(id, st);
  }
  return st;
};
function useSyncHover(syncId: string | undefined): [number | null, (v: number | null) => void] {
  const own = useId();
  const id = syncId ?? own;
  const st = storeOf(id);
  const v = useSyncExternalStore(
    useCallback(cb => {
      st.subs.add(cb);
      return () => st.subs.delete(cb);
    }, [st]),
    () => st.v
  );
  const set = useCallback((next: number | null) => {
    if (st.v === next) return;
    st.v = next;
    st.subs.forEach(f => f());
  }, [st]);
  return [v, set];
}

function useWidth(): [React.MutableRefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const read = () => setW(prev => {
      const next = Math.floor(el.clientWidth);
      return Math.abs(next - prev) < 1 ? prev : next;
    });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Round ticks across a domain, about `n` of them */
function niceTicks(lo: number, hi: number, n = 5): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}
/** An auto domain with a little air */
const autoDomain = (vals: number[]): [number, number] => {
  const f = vals.filter(Number.isFinite);
  if (!f.length) return [0, 1];
  const lo = Math.min(...f);
  const hi = Math.max(...f);
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.02 || 1;
  return [lo - pad, hi + pad];
};

interface Plot {
  x: (min: number) => number;
  y: (v: number) => number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface StripProps {
  height: number;
  from: number;
  to: number;
  yDomain: [number, number];
  yFmt: (v: number) => string;
  /** a right axis, drawn when given; its scale is handed to the layers */
  right?: { domain: [number, number]; fmt: (v: number) => string } | null;
  xLabels: boolean;
  syncId?: string;
  /** the minutes a hover can land on (the rows' own), and the readout for one */
  hoverMins: number[];
  tip: (min: number) => ReactNode;
  /** a band the width of one bucket under the pointer, else a hairline */
  band?: number;
  printMin: number | null;
  printLabel?: boolean;
  layers: (p: Plot, yRight: ((v: number) => number) | null) => ReactNode;
}

/** The strip's hour ticks across its window: 09:30, 10:30 … and the window's own ends */
const ticksFor = (from: number, to: number): number[] => {
  const out = new Set<number>([from, to]);
  for (let m = Math.ceil(from / 60) * 60; m <= to; m += 60) out.add(m);
  return [...out].sort((a, b) => a - b);
};

const Strip = ({ height, from, to, yDomain, yFmt, right, xLabels, syncId, hoverMins, tip, band, printMin, printLabel = false, layers }: StripProps) => {
  const [ref, width] = useWidth();
  const [hover, setHover] = useSyncHover(syncId);
  const left = Y_LEFT_W;
  const plotR = Math.max(left + 10, width - RIGHT_PAD - Y_RIGHT_W);
  const top = TOP_PAD;
  const bottom = height - (xLabels ? X_AXIS_H : 4);
  const span = to - from || 1;
  const x = (m: number) => left + ((m - from) / span) * (plotR - left);
  const [lo, hi] = yDomain;
  const y = (v: number) => bottom - ((v - lo) / (hi - lo || 1)) * (bottom - top);
  const yRight = right ? (v: number) => bottom - ((v - right.domain[0]) / (right.domain[1] - right.domain[0] || 1)) * (bottom - top) : null;
  const plot: Plot = { x, y, left, right: plotR, top, bottom };
  const yTicks = niceTicks(lo, hi);
  const rTicks = right ? niceTicks(right.domain[0], right.domain[1], 4) : [];
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (px < left || px > plotR || !hoverMins.length) return setHover(null);
    const m = from + ((px - left) / (plotR - left)) * span;
    let best = hoverMins[0];
    for (const h of hoverMins) if (Math.abs(h - m) < Math.abs(best - m)) best = h;
    setHover(best);
  };
  const hx = hover != null && hover >= from && hover <= to ? x(hover) : null;
  const readout = hx != null ? tip(hover as number) : null;
  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} className="block" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {yTicks.map(t => (
            <g key={`y${t}`}>
              <line x1={left} x2={plotR} y1={y(t)} y2={y(t)} stroke={GRID} />
              <text x={left - 6} y={y(t) + 3} textAnchor="end" fill={AXIS} fontSize={10} fontFamily={FONT}>
                {yFmt(t)}
              </text>
            </g>
          ))}
          {right &&
            rTicks.map(t => (
              <text key={`r${t}`} x={plotR + 6} y={yRight!(t) + 3} fill={AXIS} fontSize={10} fontFamily={FONT}>
                {right.fmt(t)}
              </text>
            ))}
          {xLabels &&
            ticksFor(from, to).map(t => (
              <text key={`x${t}`} x={x(t)} y={height - 4} textAnchor={t === from ? 'start' : t === to ? 'end' : 'middle'} fill={AXIS} fontSize={10} fontFamily={FONT}>
                {flowClock(t)}
              </text>
            ))}
          {hx != null && (band ? <rect x={x((hover as number) - band / 2)} y={top} width={Math.max(2, x(band) - x(0))} height={bottom - top} fill={HOVER_WASH} /> : <line x1={hx} x2={hx} y1={top} y2={bottom} stroke="rgb(var(--ink) / 0.15)" />)}
          {lo < 0 && hi > 0 && <line x1={left} x2={plotR} y1={y(0)} y2={y(0)} stroke={ZERO_LINE} />}
          {layers(plot, yRight)}
          {printMin != null && printMin >= from && printMin <= to && (
            <g>
              <line x1={x(printMin)} x2={x(printMin)} y1={top} y2={bottom} stroke={PRICE_LINE} strokeOpacity={0.9} strokeDasharray="4 3" />
              {printLabel && (
                /* the label reads into the plot: right of the line in the window's first half, left of it after */
                <text x={x(printMin) + (printMin - from > span / 2 ? -8 : 8)} y={top + 12} textAnchor={printMin - from > span / 2 ? 'end' : 'start'} fill={PRICE_LINE} fontSize={11} fontFamily={FONT}>
                  This print
                </text>
              )}
            </g>
          )}
        </svg>
      )}
      {readout && hx != null && (
        <div className="pointer-events-none absolute z-20" style={{ top: 4, left: hx > width / 2 ? undefined : hx + 12, right: hx > width / 2 ? width - hx + 12 : undefined }}>
          <Box>{readout}</Box>
        </div>
      )}
    </div>
  );
};

const linePath = (pts: [number, number][]) => pts.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)},${b.toFixed(1)}`).join('');

/** Bid, mid and ask as three named parts of one bar, never a two-way split that folds the mid into a side */
export const SideSplit = ({ bid, mid, ask, unit, caption, className = '' }: { bid: number; mid: number; ask: number; unit: string; caption?: string; className?: string }) => {
  /* one rounding with the card's own side figure (traceLive sideShares) */
  const sh = sideShares(bid, mid, ask);

  const fmt = (v: number) => (unit === '$' ? fmtUsd(v) : v.toLocaleString('en-US'));
  return (
    <div className={`flex flex-col gap-1 ${className}`} title={`${fmt(bid)} on the bid · ${fmt(mid)} at the mid or no side · ${fmt(ask)} at the ask${unit === '$' ? '' : ` ${unit}`}`}>
      <div className="flex items-baseline justify-between gap-3 font-mono text-t11 uppercase tracking-wider">
        <span className="text-textSecondary">Bid {sh.bid}%</span>
        <span className="text-textMuted">Mid {sh.mid}%</span>
        <span className="text-textSecondary">Ask {sh.ask}%</span>
      </div>
      <span className="flex h-1.5 rounded-full overflow-hidden bg-ink/[0.06]">
        <span className="h-full bg-bear/80" style={{ width: `${sh.bid}%` }} />
        <span className="h-full bg-ink/25" style={{ width: `${sh.mid}%` }} />
        <span className="h-full bg-bull" style={{ width: `${sh.ask}%` }} />
      </span>
      {caption && <span className="font-mono text-t11 text-textMuted normal-case">{caption}</span>}
    </div>
  );
};


/** One figure in a panel's stat strip. */
const Stat = ({ label, value, tone = 'text-textPrimary' }: { label: string; value: string; tone?: string }) => (
  <span className="flex flex-col gap-0.5 min-w-0">
    <span className="font-mono text-t11 uppercase tracking-wider text-textMuted truncate">{label}</span>
    <span className={`font-mono text-t12 font-semibold tnum ${tone} truncate`}>{value}</span>
  </span>
);

// ---- the contract's minutes -----------------------------------------------------------------------------------

export interface FlowPanelProps {
  tape: ContractTape;
  intervalMin: number;
  showAvg: boolean;
  onShowAvg: (v: boolean) => void;
  showIv: boolean;
  onShowIv: (v: boolean) => void;
  /** Minute of the clicked print since the bell; null hides the marker */
  printMin: number | null;
  syncId?: string;
}

/* Each bar is one bucket of the contract's session from its intraday route, by side, so the strip never disagrees
   with the day's totals; the heaviest bucket is named. */
const ledgerLayer = (p: Plot, bins: LedgerBin[], intervalMin: number, heaviest: LedgerBin | null, from: number, to: number): ReactNode => {
  const binPx = Math.abs(p.x(intervalMin) - p.x(0));
  const w = Math.max(2, Math.min(16, binPx * 0.7));
  const rects: ReactNode[] = [];
  for (const b of bins) {
    const cx = p.x(b.min + intervalMin / 2);
    const left = cx - w / 2;
    const half = b.midPrem / 2;
    const top = b === heaviest;
    if (b.midPrem > 0) {
      const t = p.y(half);
      rects.push(<rect key={`m${b.min}`} x={left + w * 0.15} y={t} width={w * 0.7} height={Math.max(1, p.y(-half) - t)} fill={FENCE} />);
    }
    if (b.askPrem > 0) {
      const t = p.y(half + b.askPrem);
      rects.push(<rect key={`u${b.min}`} x={left} y={t} width={w} height={Math.max(1, p.y(half) - t)} fill={top ? SUPREME : ASK} fillOpacity={top ? 0.95 : 0.85} />);
    }
    if (b.bidPrem > 0) {
      const t = p.y(-half);
      rects.push(<rect key={`d${b.min}`} x={left} y={t} width={w} height={Math.max(1, p.y(-half - b.bidPrem) - t)} fill={top ? SUPREME : BID} fillOpacity={top ? 0.95 : 0.8} />);
    }
  }
  let label: ReactNode = null;
  if (heaviest) {
    const half = heaviest.midPrem / 2;
    const up = heaviest.askPrem >= heaviest.bidPrem;
    const edge = up ? p.y(half + heaviest.askPrem) : p.y(-half - heaviest.bidPrem);
    const tx = Math.min(Math.max(p.x(heaviest.min + intervalMin / 2), p.x(from) + 70), p.x(to) - 70);
    label = (
      <text x={tx} y={up ? Math.max(p.top + 9, edge - 5) : Math.min(p.bottom - 2, edge + 11)} textAnchor="middle" fill={SUPREME} fontSize={9} fontWeight={600} fontFamily={FONT}>
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

export const FlowPanel = ({ tape, intervalMin, showAvg, onShowAvg, showIv, onShowIv, printMin, syncId }: FlowPanelProps) => {
  const paper = useResolvedTheme() === 'light';
  const bins = useMemo(() => bucketMinutes(tape.minutes, intervalMin), [tape.minutes, intervalMin]);
  const avg = useMemo(() => runningAvg(tape.minutes), [tape.minutes]);
  const heaviest = useMemo(() => bins.reduce<LedgerBin | null>((a, b) => (!a || b.askPrem + b.bidPrem + b.midPrem > a.askPrem + a.bidPrem + a.midPrem ? b : a), null), [bins]);
  const maxSide = useMemo(() => Math.max(1, ...bins.map(b => Math.max(b.midPrem / 2 + b.askPrem, b.midPrem / 2 + b.bidPrem))), [bins]);
  const byMin = useMemo(() => new Map(bins.map(b => [b.min + intervalMin / 2, b])), [bins, intervalMin]);
  const hoverMins = useMemo(() => [...byMin.keys()], [byMin]);
  const totals = useMemo(() => tape.minutes.reduce((a, m) => ({ ask: a.ask + m.askVol, bid: a.bid + m.bidVol, mid: a.mid + m.midVol, prem: a.prem + m.askPrem + m.bidPrem + m.midPrem }), { ask: 0, bid: 0, mid: 0, prem: 0 }), [tape.minutes]);
  /* One window: every figure here is the strip's own minutes, and the label says which */
  const w = tape.window;
  const vwap = avg.length ? avg[avg.length - 1].price : 0;
  const summary = [
    vwap > 0 ? `avg paid $${vwap.toFixed(2)}` : null,
    `${fmtUsd(totals.prem)} traded`,
    w.source === 'prints' ? `${tape.prints.length.toLocaleString('en-US')} prints` : `${(totals.ask + totals.bid + totals.mid).toLocaleString('en-US')} contracts`,
    `· ${w.label}`,
  ].filter(Boolean).join(' · ').replace(' · · ', ' · ');
  const pxDomain = useMemo(() => autoDomain(avg.map(a => a.price)), [avg]);
  const ivDomain = useMemo(() => autoDomain(avg.map(a => a.iv)), [avg]);
  const tip = (m: number) => {
    const b = byMin.get(m);
    if (!b) return null;
    const from = m - intervalMin / 2;
    return (
      <>
        <div className="text-textMuted">
          {flowClock(from)}
          {intervalMin > 1 ? `–${flowClock(from + intervalMin)}` : ''} ET · {b.vol.toLocaleString('en-US')} contracts
        </div>
        {b.askPrem > 0 && <div style={{ color: ASK }}>paid the offer {fmtUsd(b.askPrem)}</div>}
        {b.bidPrem > 0 && <div style={{ color: BID }}>hit the bid {fmtUsd(b.bidPrem)}</div>}
        {b.midPrem > 0 && <div className="text-textMuted">mid or no side {fmtUsd(b.midPrem)}</div>}
      </>
    );
  };

  return (
    <div className={`flex flex-col gap-2 min-w-0 rounded-md px-2 py-1.5 ${paper ? '' : 'bg-panel'}`} data-theme={paper ? 'light' : 'dark'} data-flow-strip>
      <div className="flex items-baseline gap-2.5 flex-wrap">
        <span className="font-mono text-t11 uppercase tracking-widest text-textSecondary">The contract's session</span>
        <span className="font-mono text-t11 text-textMuted tnum" data-flow-summary>
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
          <div className="h-full flex items-center justify-center font-mono text-t11 uppercase tracking-widest text-textMuted">{w.source === 'prints' ? 'No prints this session' : 'No prints in the regular session'}</div>
        ) : (
          <Strip
            height={200}
            from={w.from}
            to={w.to}
            yDomain={[-maxSide * 1.08, maxSide * 1.08]}
            yFmt={v => `${v < 0 ? '−' : ''}${fmtUsd(Math.abs(v))}`}
            right={showAvg ? { domain: pxDomain, fmt: v => `$${v.toFixed(2)}` } : null}
            xLabels={false}
            syncId={syncId}
            hoverMins={hoverMins}
            tip={tip}
            band={intervalMin}
            printMin={printMin}
            printLabel
            layers={(p, yRight) => {
              const ivY = (v: number) => p.bottom - ((v - ivDomain[0]) / (ivDomain[1] - ivDomain[0] || 1)) * (p.bottom - p.top);
              return (
                <>
                  {ledgerLayer(p, bins, intervalMin, heaviest, w.from, w.to)}
                  {showAvg && yRight && <path d={linePath(avg.map(a => [p.x(a.min), yRight(a.price)]))} fill="none" stroke={PRICE_LINE} strokeWidth={1} strokeDasharray="3 3" />}
                  {showIv && <path d={linePath(avg.filter(a => a.iv > 0).map(a => [p.x(a.min), ivY(a.iv)]))} fill="none" stroke={IV_LINE} strokeWidth={1} />}
                </>
              );
            }}
          />
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <span className="inline-flex items-center gap-1.5 font-mono text-t11 uppercase tracking-wider text-textSecondary">
          <span className="w-2 h-2" style={{ background: ASK }} /> Paid the offer · stacks up
        </span>
        <span className="inline-flex items-center gap-1.5 font-mono text-t11 uppercase tracking-wider text-textSecondary">
          <span className="w-2 h-2" style={{ background: BID }} /> Hit the bid · stacks down
        </span>
        <span className="inline-flex items-center gap-1.5 font-mono text-t11 uppercase tracking-wider text-textSecondary">
          <span className="w-2 h-2" style={{ background: FENCE }} /> Mid or no side · on the line
        </span>
        <span className="inline-flex items-center gap-1.5 font-mono text-t11 uppercase tracking-wider text-textSecondary">
          <span className="w-2 h-2" style={{ background: SUPREME }} /> Heaviest bar
        </span>
        {printMin !== null && (
          <span className="inline-flex items-center gap-1.5 font-mono text-t11 uppercase tracking-wider text-textSecondary">
            <span className="w-3 h-[2px]" style={{ background: PRICE_LINE }} /> This print
          </span>
        )}
      </div>
    </div>
  );
};

// ---- the underlying's net premium ---------------------------------------------------------------------------

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
                <span className={`font-mono text-t11 ${m.value === value ? 'text-textPrimary font-semibold' : 'text-textSecondary'}`}>{m.label}</span>
                <span className="font-mono text-t11 text-textMuted">{m.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
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

const signedUsd = (v: number) => `${v >= 0 ? '+' : '−'}${fmtUsd(Math.abs(v))}`;
const countFmt = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(v) >= 1000 ? `${Math.round(Math.abs(v) / 1000)}k` : String(Math.abs(v))}`;

export const NetPanel = ({ tape, ticker, intervalMin, metric, onMetric, showCalls, onShowCalls, showPuts, onShowPuts, printMin, syncId }: NetPanelProps) => {
  const paper = useResolvedTheme() === 'light';
  const gid = useId().replace(/:/g, '');
  const n = tape.net;
  const bars = useMemo(() => (n ? bucketTicks(n.series, intervalMin).map(b => ({ ...b, min: b.min + intervalMin / 2 })) : []), [n, intervalMin]);
  const premAbs = useMemo(() => (n ? Math.max(1, ...n.series.map(t => Math.max(Math.abs(t.netCall), Math.abs(t.netPut)))) : 1), [n]);
  const volAbs = useMemo(() => Math.max(1, ...bars.map(b => Math.max(showCalls ? b.callVol : 0, showPuts ? -b.putVol : 0))), [bars, showCalls, showPuts]);
  const barBy = useMemo(() => new Map(bars.map(b => [b.min, b])), [bars]);
  const tickBy = useMemo(() => new Map((n?.series ?? []).map(t => [t.min, t])), [n]);
  if (!n) {
    return (
      <div className={`flex flex-col gap-2 min-w-0 rounded-md px-2 py-1.5 ${paper ? '' : 'bg-panel'}`} data-theme={paper ? 'light' : 'dark'} data-flow-strip>
        <span className="font-mono text-t11 uppercase tracking-widest text-textSecondary">{ticker} net premium</span>
        <div className="h-[120px] flex items-center justify-center font-mono text-t11 uppercase tracking-widest text-textMuted">No minutes for {ticker} in this session</div>
      </div>
    );
  }
  const net = n.netCall - n.netPut;
  const w = tape.window;
  const contracts = metric === 'contracts';
  const tip = (m: number) => {
    if (contracts) {
      const b = barBy.get(m);
      if (!b) return null;
      const from = m - intervalMin / 2;
      return (
        <>
          <div className="text-textMuted">
            {flowClock(from)}
            {intervalMin > 1 ? `–${flowClock(from + intervalMin)}` : ''} ET
          </div>
          <div style={{ color: ASK }}>calls {b.callVol.toLocaleString('en-US')} contracts</div>
          <div style={{ color: BID }}>puts {Math.abs(b.putVol).toLocaleString('en-US')} contracts</div>
        </>
      );
    }
    const t = tickBy.get(m);
    if (!t) return null;
    return (
      <>
        <div className="text-textMuted">{flowClock(m)} ET</div>
        <div style={{ color: t.netCall >= 0 ? ASK : BID }}>net calls {fmtUsd(t.netCall)}</div>
        <div style={{ color: t.netPut > 0 ? BID : ASK }}>
          net puts {fmtUsd(t.netPut)} {t.netPut > 0 ? '· bought, bearish' : t.netPut < 0 ? '· sold, bullish' : ''}
        </div>
      </>
    );
  };
  return (
    <div className={`flex flex-col gap-2 min-w-0 rounded-md px-2 py-1.5 ${paper ? '' : 'bg-panel'}`} data-theme={paper ? 'light' : 'dark'} data-flow-strip>
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className="font-mono text-t11 uppercase tracking-widest text-textSecondary">{ticker} net premium · every expiry · the same window</span>
        <MetricPicker value={metric} onChange={onMetric} />
        {metric === 'netPremium' ? (
          <span className="font-mono text-t11 text-textMuted tnum" data-net-summary title="Premium at the ask less at the bid. Net calls bought lean bullish, net puts bought bearish; the net is calls less puts">
            net <span className={net >= 0 ? 'text-bull font-semibold' : 'text-bear font-semibold'}>{signedUsd(net)}</span> · net calls{' '}
            <span className={n.netCall >= 0 ? 'text-bull font-semibold' : 'text-bear font-semibold'}>{signedUsd(n.netCall)}</span> · net puts{' '}
            <span className={n.netPut >= 0 ? 'text-bear font-semibold' : 'text-bull font-semibold'}>{signedUsd(n.netPut)}</span>
          </span>
        ) : (
          <span className="font-mono text-t11 text-textMuted tnum">
            {(n.callVol + n.putVol).toLocaleString('en-US')} contracts · calls {n.callVol.toLocaleString('en-US')} · puts {n.putVol.toLocaleString('en-US')}
          </span>
        )}
      </div>

      <div className="h-[210px] -ml-2">
        <Strip
          height={210}
          from={w.from}
          to={w.to}
          yDomain={contracts ? [-volAbs * 1.08, volAbs * 1.08] : [-premAbs, premAbs]}
          yFmt={contracts ? countFmt : v => `${v < 0 ? '−' : ''}${fmtUsd(Math.abs(v))}`}
          xLabels
          syncId={syncId}
          hoverMins={contracts ? bars.map(b => b.min) : n.series.map(t => t.min)}
          tip={tip}
          band={contracts ? intervalMin : undefined}
          printMin={printMin}
          layers={p => {
            if (contracts) {
              const bw = Math.max(2, Math.min(16, Math.abs(p.x(intervalMin) - p.x(0)) * 0.7));
              return (
                <g>
                  {bars.map(b => (
                    <g key={b.min}>
                      {showCalls && b.callVol > 0 && <rect x={p.x(b.min) - bw / 2} y={p.y(b.callVol)} width={bw} height={Math.max(1, p.y(0) - p.y(b.callVol))} fill={ASK} fillOpacity={0.75} />}
                      {showPuts && b.putVol < 0 && <rect x={p.x(b.min) - bw / 2} y={p.y(0)} width={bw} height={Math.max(1, p.y(b.putVol) - p.y(0))} fill={BID} fillOpacity={0.7} />}
                    </g>
                  ))}
                </g>
              );
            }
            /* Each line wears its meaning: split at the zero line, calls green above and red below, puts red above
               (bought) and green below; puts are dashed. */
            const zero = (p.y(0) - p.top) / (p.bottom - p.top || 1);
            const line = (pick: (t: { netCall: number; netPut: number }) => number) => n.series.map(t => [p.x(t.min), p.y(pick(t))] as [number, number]);
            const area = (pts: [number, number][]) => (pts.length ? `${linePath(pts)}L${pts[pts.length - 1][0].toFixed(1)},${p.y(0).toFixed(1)}L${pts[0][0].toFixed(1)},${p.y(0).toFixed(1)}Z` : '');
            const calls = line(t => t.netCall);
            const puts = line(t => t.netPut);
            return (
              <g>
                <defs>
                  <linearGradient id={`${gid}c`} gradientUnits="userSpaceOnUse" x1="0" y1={p.top} x2="0" y2={p.bottom}>
                    <stop offset={zero} stopColor={ASK} />
                    <stop offset={zero} stopColor={BID} />
                  </linearGradient>
                  <linearGradient id={`${gid}p`} gradientUnits="userSpaceOnUse" x1="0" y1={p.top} x2="0" y2={p.bottom}>
                    <stop offset={zero} stopColor={BID} />
                    <stop offset={zero} stopColor={ASK} />
                  </linearGradient>
                </defs>
                {showCalls && (
                  <>
                    <path d={area(calls)} fill={`url(#${gid}c)`} fillOpacity={0.12} />
                    <path d={linePath(calls)} fill="none" stroke={`url(#${gid}c)`} strokeWidth={1.25} />
                  </>
                )}
                {showPuts && (
                  <>
                    <path d={area(puts)} fill={`url(#${gid}p)`} fillOpacity={0.12} />
                    <path d={linePath(puts)} fill="none" stroke={`url(#${gid}p)`} strokeWidth={1.25} strokeDasharray="4 2" />
                  </>
                )}
              </g>
            );
          }}
        />
      </div>

      {/* the session's contracts by side: the feed's own split of the same minutes */}
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
