/*
  THE RAIL'S OI CHANGE TAB: where positions were opened and closed overnight, per strike, for the pane's name and its
  expiry cut (the head's Expiry card: one expiry, or every expiry still live).

  Open interest is stamped once a session, about 06:30 ET, for the PREVIOUS session's close; so the tab compares the
  last two reports and names both closes ("Oct 29 close vs Oct 28") and the mornings they were reported. One answer per
  name and cut for every pane and page (data/regimeFeed.ts useOiChange → server/regimeApi.mjs: two all-expiration
  reads a name a day, kept).

  The strike column is the ladder's: puts grow left of it, calls right, each bar the change's size against the largest
  change on screen, in the rail's ramp — warm where contracts were added (a build), cool where they were closed (an
  unwind). The five largest of each are named above the ladder and filled in it.
*/

import { useEffect, useMemo, useRef } from 'react';
import { heatCellStyle, heatLadderColor, type HeatMode } from './heatmap';
import { useOiChange, regimeTrouble } from '../../data/regimeFeed';
import type { OiMove } from '../../../shared/volRegime.mjs';
import { fmtDay, signed } from './regimeFmt';

interface Props {
  ticker: string;
  /** 'book' (every expiry still live) or one expiry, YYYY-MM-DD */
  expiry: string;
  /** The cut in the head card's words: "Whole book", "Nov 2" */
  scopeLabel: string;
  spot: number;
  mode: HeatMode;
  paper: boolean;
  focusPrice?: number | null;
  onSelect?: (strike: number) => void;
}

/** The ladder shows the strikes within this share of spot (the named moves are always listed above it) */
const WINDOW = 0.08;
const ROW_H = 18;
/** The share of a leg its bar may take; the figure keeps the rest */
const BAR_SHARE = 0.58;
/** The spot's own row between the strikes it falls between */
const SPOT_H = 15;
const SECTION = 'font-mono text-t10 uppercase tracking-widest text-textMuted';
const fmtStrike = (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));

const MoveChip = ({ m, mode, paper, onSelect }: { m: OiMove; mode: HeatMode; paper: boolean; onSelect?: (k: number) => void }) => {
  const style = heatCellStyle(m.d, Math.abs(m.d), mode, paper);
  return (
    <button
      type="button"
      onClick={() => onSelect?.(m.strike)}
      className="inline-flex items-baseline gap-1 h-5 px-1.5 rounded font-mono text-t11 tnum whitespace-nowrap"
      style={style}
      title={`${fmtStrike(m.strike)} ${m.right === 'C' ? 'call' : 'put'}: ${m.prior.toLocaleString('en-US')} → ${m.now.toLocaleString('en-US')}`}
      data-oi-move={`${m.strike}${m.right}`}
    >
      <span className="font-semibold">
        {fmtStrike(m.strike)}
        {m.right}
      </span>
      <span>{signed(m.d)}</span>
    </button>
  );
};

const OiChangeView = ({ ticker, expiry, scopeLabel, spot, mode, paper, focusPrice = null, onSelect }: Props) => {
  const { data, error, loading } = useOiChange(ticker, expiry);
  const listRef = useRef<HTMLDivElement>(null);
  const named = useMemo(() => {
    const s = new Map<string, OiMove>();
    for (const m of [...(data?.builds ?? []), ...(data?.unwinds ?? [])]) s.set(`${m.strike}${m.right}`, m);
    return s;
  }, [data]);
  const shown = useMemo(() => {
    const rows = data?.rows ?? [];
    const lo = spot > 0 ? spot * (1 - WINDOW) : -Infinity;
    const hi = spot > 0 ? spot * (1 + WINDOW) : Infinity;
    /* high strikes on top, as the chart's axis reads */
    return rows.filter(r => r[0] >= lo && r[0] <= hi && (r[1] || r[2] || r[3] || r[4])).reverse();
  }, [data, spot]);
  const maxAbs = useMemo(() => shown.reduce((m, r) => Math.max(m, Math.abs(r[1] - r[2]), Math.abs(r[3] - r[4])), 0) || 1, [shown]);
  /* the spot's place among the rows (descending): the first strike under it */
  const spotAt = spot > 0 ? shown.findIndex(r => r[0] <= spot) : -1;
  /* open on the spot */
  useEffect(() => {
    const el = listRef.current;
    if (!el || spotAt < 0) return;
    el.scrollTop = Math.max(0, spotAt * ROW_H - el.clientHeight / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.day, data?.expiry, ticker, shown.length > 0]);

  const trouble = regimeTrouble(error);
  if (!data) {
    return (
      <div className="h-full flex items-center justify-center px-6 text-center font-mono text-t12 text-textSecondary" data-oi-empty>
        {loading ? `Reading ${ticker}'s open interest…` : trouble ?? `No open interest on file for ${ticker}.`}
      </div>
    );
  }
  const t = data.totals ?? { call: 0, callPrior: 0, put: 0, putPrior: 0 };
  const pct = (a: number, b: number) => (b > 0 ? ` (${signed(((a - b) / b) * 100, 1)}%)` : '');
  const exps = data.expiries ?? [];
  const scopeWords = expiry === 'book' ? `${scopeLabel} · ${exps.length} expir${exps.length === 1 ? 'y' : 'ies'}` : scopeLabel;
  const rootNote = data.root !== ticker ? ` (${data.root} contracts)` : '';
  /* a square-root length: the largest change fills the leg, and a tenth of it still reads as a third */
  const bar = (d: number) => `${Math.max(d === 0 ? 0 : 2, Math.sqrt(Math.abs(d) / maxAbs) * BAR_SHARE * 100)}%`;
  const ink = (d: number) => heatLadderColor(d, maxAbs, mode, paper);

  const cell = (d: number, now: number, prior: number, strike: number, right: 'C' | 'P') => {
    const key = `${strike}${right}`;
    const top = named.get(key);
    const fill = top ? heatCellStyle(d, maxAbs, mode, paper) : null;
    const left = right === 'P';
    /* the bar grows out of the strike column through at most BAR_SHARE of the leg, and its figure sits just past its
       tip — the ladder's reading — so a bar never runs under its own figure */
    const track = d !== 0 && (
      <span
        className={`h-[10px] shrink-0 ${left ? 'rounded-l-sm' : 'rounded-r-sm'}`}
        style={{ width: bar(d), background: fill ? String(fill.backgroundColor) : ink(d), opacity: fill ? 1 : 0.8 }}
        aria-hidden
      />
    );
    const figure = (
      <span className={`shrink-0 font-mono text-t10 tnum whitespace-nowrap rounded-sm ${top ? 'font-bold px-[3px]' : ''}`} style={fill ? { background: String(fill.backgroundColor), color: String(fill.color) } : { color: d === 0 ? 'rgb(var(--text-muted))' : 'rgb(var(--text-primary))' }}>
        {d === 0 ? '·' : signed(d)}
      </span>
    );
    return (
      <div
        className={`h-full flex items-center gap-1 min-w-0 overflow-hidden ${left ? 'justify-end' : 'justify-start'}`}
        title={`${fmtStrike(strike)} ${left ? 'put' : 'call'}: ${prior.toLocaleString('en-US')} → ${now.toLocaleString('en-US')} (${signed(d)})`}
        data-oi-cell={key}
        data-oi-top={top ? (d > 0 ? 'build' : 'unwind') : undefined}
      >
        {left ? figure : track}
        {left ? track : figure}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col min-h-0" data-oi-view data-oi-day={data.day}>
      <div className="shrink-0 px-3 pt-2 pb-2 border-b border-borderSubtle/60">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={SECTION}>Open interest change</span>
          <span className="ml-auto font-mono text-t10 text-textSecondary whitespace-nowrap" data-oi-scope>
            {ticker}
            {rootNote} · {scopeWords}
          </span>
        </div>
        <p className="mt-1 text-t12 text-textPrimary" data-oi-dates>
          <span className="font-semibold">{fmtDay(data.close)} close</span>
          <span className="text-textMuted"> vs </span>
          <span className="font-semibold">{fmtDay(data.priorClose)} close</span>
        </p>
        <p className="font-mono text-t10 text-textMuted">
          Reported 6:30 AM ET {fmtDay(data.day, false)} and {fmtDay(data.prior, false)}
        </p>
        {data.rows && (
          <div className="mt-1.5 grid grid-cols-2 gap-2 font-mono text-t11 tnum" data-oi-totals>
            <span className="whitespace-nowrap" title={`${t.callPrior.toLocaleString('en-US')} → ${t.call.toLocaleString('en-US')}`}>
              <span className="text-textMuted">Calls </span>
              <span style={{ color: ink(t.call - t.callPrior) }}>{signed(t.call - t.callPrior)}</span>
              <span className="text-textMuted">{pct(t.call, t.callPrior)}</span>
            </span>
            <span className="whitespace-nowrap" title={`${t.putPrior.toLocaleString('en-US')} → ${t.put.toLocaleString('en-US')}`}>
              <span className="text-textMuted">Puts </span>
              <span style={{ color: ink(t.put - t.putPrior) }}>{signed(t.put - t.putPrior)}</span>
              <span className="text-textMuted">{pct(t.put, t.putPrior)}</span>
            </span>
          </div>
        )}
        {(data.builds?.length ?? 0) > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1" data-oi-builds>
            <span className="w-16 shrink-0 font-mono text-t9 uppercase tracking-wider text-textMuted">Builds</span>
            {data.builds!.map(m => <MoveChip key={`${m.strike}${m.right}`} m={m} mode={mode} paper={paper} onSelect={onSelect} />)}
          </div>
        )}
        {(data.unwinds?.length ?? 0) > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1" data-oi-unwinds>
            <span className="w-16 shrink-0 font-mono text-t9 uppercase tracking-wider text-textMuted">Unwinds</span>
            {data.unwinds!.map(m => <MoveChip key={`${m.strike}${m.right}`} m={m} mode={mode} paper={paper} onSelect={onSelect} />)}
          </div>
        )}
        {trouble && <p className="mt-1 font-mono text-t10 text-warn">{trouble}</p>}
      </div>
      {exps.length === 0 ? (
        <p className="flex-1 flex items-center justify-center px-6 text-center font-mono text-t12 text-textSecondary" data-oi-none>
          No {data.root} contracts expire {expiry === 'book' ? 'after' : 'on'} {expiry === 'book' ? fmtDay(data.close, false) : fmtDay(expiry, false)} in the {fmtDay(data.day, false)} report.
        </p>
      ) : (
        <>
          <div className="shrink-0 grid grid-cols-[1fr_64px_1fr] items-center h-6 px-1 font-mono text-t9 uppercase tracking-wider text-textMuted border-b border-borderSubtle/60">
            <span className="text-right pr-1">◂ Puts Δ</span>
            <span className="text-center">Strike</span>
            <span className="pl-1">Calls Δ ▸</span>
          </div>
          <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-1 scroll-fade" data-oi-ladder>
            {shown.map(([k, c, c0, p, p0], i) => {
              const on = focusPrice != null && Math.abs(focusPrice - k) < 1e-9;
              return (
                <div key={k}>
                  {i === spotAt && (
                    <div className="relative flex items-center justify-center" style={{ height: SPOT_H }} data-oi-spot>
                      <span className="absolute inset-x-0 top-1/2 border-t border-textSecondary/60" aria-hidden />
                      <span className="relative px-1.5 rounded-sm bg-textPrimary text-panel font-mono text-t9 tnum font-semibold leading-[13px]">{ticker} {spot.toFixed(2)}</span>
                    </div>
                  )}
                  <div
                    className={`grid grid-cols-[1fr_64px_1fr] items-stretch ${onSelect ? 'cursor-pointer' : ''} ${on ? 'bg-ink/[0.07]' : 'hover:bg-ink/[0.04]'}`}
                    style={{ height: ROW_H }}
                    onClick={() => onSelect?.(k)}
                    data-oi-row={k}
                  >
                    {cell(p - p0, p, p0, k, 'P')}
                    <span className={`flex items-center justify-center bg-inset font-mono text-t11 tnum ${on ? 'text-textPrimary font-bold' : 'text-textSecondary'}`}>{fmtStrike(k)}</span>
                    {cell(c - c0, c, c0, k, 'C')}
                  </div>
                </div>
              );
            })}
            {shown.length === 0 && <p className="py-6 text-center font-mono text-t11 text-textMuted">No open interest within {Math.round(WINDOW * 100)}% of spot.</p>}
          </div>
          <p className="shrink-0 flex items-center gap-3 px-3 py-1 border-t border-borderSubtle/60 font-mono text-t9 text-textMuted whitespace-nowrap overflow-hidden" data-oi-key>
            <span>Strikes ±{Math.round(WINDOW * 100)}% of spot</span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: ink(maxAbs) }} aria-hidden />
              added
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: ink(-maxAbs) }} aria-hidden />
              closed
            </span>
          </p>
        </>
      )}
    </div>
  );
};

export default OiChangeView;
