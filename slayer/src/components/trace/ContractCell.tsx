/* The contract cell: strike, "call"/"put" and expiry, right-aligned so every cell ends on one edge; the silver hover is
   the door to the card (door.ts). With a spot it adds a sub-line: days left, the spot at the print, the OTM distance. */

import type { ReactNode } from 'react';
import { DOOR, DOOR_GROUP_TEXT } from './door';
import { expiryLabel, pctSigned } from '../../core/format';
import { indexRoot } from '../../data/traceLive';

const COARSE_TITLE = 'The index level comes in whole points — too coarse for a distance on a small index (XSP, VIX)';
const OTM_TITLE = 'Out of the money by this much of the spot, calls and puts alike; negative is in the money';
const INDEX_OTM_TITLE = "Against the feed's whole-point index level — approximate";

/** "+2.1%" out of the money, "−3.0%" in it; "≈" against an index level; "—" when no distance can be stated */
export const OtmCell = ({ otmPct, ticker, spot, className = 'text-textPrimary' }: { otmPct: number; ticker: string; spot?: number; className?: string }) =>
  Number.isFinite(otmPct) && (spot === undefined || spot > 0) ? (
    <span className={className} title={indexRoot(ticker) ? INDEX_OTM_TITLE : OTM_TITLE}>
      {indexRoot(ticker) ? '≈' : ''}
      {pctSigned(otmPct, 1)}
    </span>
  ) : (
    <span className="text-textMuted" title={spot === 0 ? 'No underlying price on this print' : COARSE_TITLE}>
      —
    </span>
  );

/** Sorts an unknown distance last */
export const otmSortValue = (otmPct: number) => (Number.isFinite(otmPct) ? otmPct : Number.NEGATIVE_INFINITY);

const ContractCell = ({
  strike,
  right,
  expiry,
  dte,
  spot,
  otmPct,
  ticker,
  stack = false,
  spotAside = false,
  stackTail,
  stackDte = false,
}: {
  /** Stacked: what stands after the expiry on its line (the distance) */
  stackTail?: ReactNode;
  /** Stacked: the days left beside the side, on the strike's line */
  stackDte?: boolean;
  ticker?: string;
  /** The spot stands elsewhere on the row (under the ticker): the sub-line keeps the days left and the distance */
  spotAside?: boolean;
  /** The expiry stands under the strike and side, so a grid's contract column is half as wide (stackDte and
      stackTail add the days left and the distance; the spot sub-line is not drawn) */
  stack?: boolean;
  strike: number;
  right: 'C' | 'P';
  expiry: string;
  /** Days to expiry, beside the date */
  dte?: number;
  /** The underlying at the print */
  spot?: number;
  /** Distance past the spot, % (positive out of the money for calls and puts) */
  otmPct?: number;
}) => {
  /* no underlying on the print (index options carry none): no sub-line at all, never "spot $0.00 · 0.0%" */
  if (spot !== undefined && !(spot > 0)) {
    spot = undefined;
    otmPct = undefined;
    dte = undefined;
  }
  const shownSpot = spotAside ? undefined : spot;
  const context = dte !== undefined || shownSpot !== undefined || otmPct !== undefined;
  if (stack)
    return (
      <span className={`group/door inline-flex flex-col items-end gap-[3px] align-middle ${DOOR}`}>
        <span className="inline-flex items-baseline gap-1.5 leading-none">
          <span className={`font-mono text-xs font-bold text-textPrimary tnum ${DOOR_GROUP_TEXT}`}>{strike}</span>
          <span className={`font-mono text-t11 font-semibold ${right === 'C' ? 'text-bull' : 'text-bear'} ${DOOR_GROUP_TEXT}`}>{right === 'C' ? 'call' : 'put'}</span>
          {stackDte && dte !== undefined && <span className={`font-mono text-t11 tnum text-textSecondary ${DOOR_GROUP_TEXT}`}>{dte}d</span>}
        </span>
        <span className={`font-mono text-t11 leading-none text-textMuted tnum whitespace-nowrap ${DOOR_GROUP_TEXT}`}>
          {expiryLabel(expiry)}
          {stackTail != null && <span className="text-textSecondary"> · {stackTail}</span>}
        </span>
      </span>
    );
  /* leading-none + align-middle: a grid cell hands its children a 36px line, which would push the door out of a 39px row */
  const head = (
    <span className={`group/door inline-flex items-baseline gap-1.5 pb-[2px] leading-none align-middle ${DOOR}`}>
      <span className={`font-mono text-xs font-bold text-textPrimary tnum ${DOOR_GROUP_TEXT}`}>{strike}</span>
      <span className={`font-mono text-t11 font-semibold ${right === 'C' ? 'text-bull' : 'text-bear'} ${DOOR_GROUP_TEXT}`}>{right === 'C' ? 'call' : 'put'}</span>
      <span className={`font-mono text-t11 text-textMuted tnum ${DOOR_GROUP_TEXT}`}>{expiryLabel(expiry)}</span>
    </span>
  );
  if (!context) return head;
  return (
    <span className="inline-flex flex-col items-end gap-[3px] leading-none align-middle">
      {head}
      <span className="inline-flex items-baseline gap-1 font-mono text-t11 leading-none tnum text-textSecondary whitespace-nowrap">
        {dte !== undefined && <span>{dte}d</span>}
        {dte !== undefined && (shownSpot !== undefined || otmPct !== undefined) && <span aria-hidden>·</span>}
        {shownSpot !== undefined && <span title={ticker && indexRoot(ticker) ? 'The index level, whole points' : 'The stock at the moment of this print'}>{ticker && indexRoot(ticker) ? `@${Math.round(shownSpot).toLocaleString('en-US')}` : `@$${shownSpot.toFixed(2)}`}</span>}
        {shownSpot !== undefined && otmPct !== undefined && <span aria-hidden>·</span>}
        {otmPct !== undefined && <OtmCell otmPct={otmPct} ticker={ticker ?? ''} className="" />}
      </span>
    </span>
  );
};

export default ContractCell;
