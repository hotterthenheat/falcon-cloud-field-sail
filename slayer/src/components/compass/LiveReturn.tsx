/* A Compass call's return from its fill, as it stands now ("+5.2% · $1.87 bid"), or what it captured at its exit
   ("Captured +31.0% · +$52.00"), with the reading behind it on hover. One quote per contract feeds it everywhere
   (data/compassReturn.ts). No fees, no score. */

import type { Signal } from '../../data/compassLedger';
import { pnlWord, returnTip, returnWords, useCallReturn, type CallReturn } from '../../data/compassReturn';
import { nyClock } from '../../core/nyTime';
import { Tip } from '../ui/Tooltip';

/** What follows the main figure: 'full' the bid (or the P&L once captured) and an "as of" time; 'short' only the bid
    while live or the time while not (a table row, whose P&L has its own column); 'none' nothing. */
type Detail = 'full' | 'short' | 'none';

interface FigureProps {
  r: CallReturn;
  /** The call's key, for the page's tests */
  id: string;
  /** 'lg' on a card or a page head; 'sm' in a row */
  size?: 'lg' | 'sm';
  detail?: Detail;
  className?: string;
}

function restOf(r: CallReturn, detail: Detail, full: string): string {
  if (detail === 'none') return '';
  if (detail === 'full') return full;
  if (r.state === 'live') return r.px != null ? `$${r.px.toFixed(2)} bid` : '';
  if (r.state === 'asof') return `as of ${nyClock(r.at)}`;
  return '';
}

/** The figure for a return already read (one read can feed several figures on one card). */
export const ReturnFigure = ({ r, id, size = 'sm', detail = 'full', className = '' }: FigureProps) => {
  const w = returnWords(r);
  const rest = restOf(r, detail, w.rest);
  const big = size === 'lg';
  const dot = r.pct != null && r.pct < -0.05 ? 'bg-bear' : r.pct != null && r.pct > 0.05 ? 'bg-bull' : 'bg-textPrimary';
  return (
    <Tip label={returnTip(r)}>
      <span className={`inline-flex items-baseline gap-1.5 min-w-0 font-mono tnum whitespace-nowrap ${className}`} data-live-return={id} data-live-state={r.state}>
        {r.state === 'live' ? <span className={`self-center w-1.5 h-1.5 rounded-full shrink-0 animate-pulse ${dot}`} aria-hidden /> : null}
        <span className={`${big ? 'text-t15' : 'text-t12'} font-semibold ${w.ink}`}>{w.main}</span>
        {rest ? <span className={`text-t11 truncate ${r.state === 'captured' ? w.ink : 'text-textSecondary'}`}>· {rest}</span> : null}
      </span>
    </Tip>
  );
};

/** A call's return, reading its contract's live quote while it is open. */
const LiveReturn = ({ signal, size = 'sm', detail = 'full', className = '' }: { signal: Signal; size?: 'lg' | 'sm'; detail?: Detail; className?: string }) => {
  const r = useCallReturn(signal);
  return <ReturnFigure r={r} id={signal.key} size={size} detail={detail} className={className} />;
};

/** A call's P&L per contract from the fill, (bid or exit − fill) × 100, on the same read. No fees. */
export const LivePnl = ({ signal }: { signal: Signal }) => {
  const r = useCallReturn(signal);
  if (r.pnl == null) return <span className="text-textMuted">—</span>;
  const v = r.pnl;
  const ink = r.state === 'asof' ? 'text-textSecondary' : Math.abs(v) < 0.005 ? 'text-textSecondary' : v > 0 ? 'text-bull' : 'text-bear';
  return (
    <Tip label={returnTip(r)}>
      <span className={`tnum ${ink}`} data-live-pnl={signal.key}>{pnlWord(v)}</span>
    </Tip>
  );
};

export default LiveReturn;
