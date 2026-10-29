/* The bid/ask cell, shared with the tape: the label over a bar of the ask share against the bid's quiet track. */

import { dayLean, LEAN_EDGE, sideShares } from '../../data/traceLive';
import { shyPct } from '../../data/traceLean';
import { CROSS_PCT, SPREAD_LEG_PCT } from '../../data/flowBook';

/* The side in one ink (a put bought at the ask is not bullish). Given the day by side, the bar is ask · mid · bid
   over the whole volume and the lean is traceLean's one rule. */

/* Every label is lower-case: a called lean bold in the primary ink ("bid 60%"), a day short of the call quiet ("even
   · bid 51%"). */
const LeanCell = ({ askPct: raw, split, unit = 'contracts', legsPct, crossPct }: { askPct: number; split?: { ask: number; bid: number; mid: number }; unit?: 'contracts' | 'premium'; legsPct?: number; crossPct?: number }) => {
  /* A day of crosses has no lean: pre-arranged, no side taken */
  if (crossPct != null && Number.isFinite(crossPct) && crossPct >= CROSS_PCT && !(legsPct != null && legsPct >= SPREAD_LEG_PCT)) {
    return (
      <span className="inline-flex flex-col items-end gap-[3px] min-w-20" title={`${Math.round(crossPct)}% of the day in pre-arranged cross trades, no side taken, so no lean (${CROSS_PCT}% or more)`}>
        <span className="font-mono text-t11 tnum leading-[14px] text-textSecondary whitespace-nowrap">cross {Math.round(crossPct)}%</span>
        <span className="flex w-20 h-[3px] rounded-full overflow-hidden bg-ink/[0.14]" />
      </span>
    );
  }
  /* A day of spread legs has no lean: the share in legs, quiet, and why on the hover */
  if (legsPct != null && Number.isFinite(legsPct) && legsPct >= SPREAD_LEG_PCT) {
    return (
      <span
        className="inline-flex flex-col items-end gap-[3px] min-w-20"
        title={`${Math.round(legsPct)}% of the day in multi-leg orders: a leg's side says how a package filled, not a lean (${SPREAD_LEG_PCT}% or more)`}
      >
        <span className="font-mono text-t11 tnum leading-[14px] text-textSecondary">legs {Math.round(legsPct)}%</span>
        <span className="flex w-20 h-[3px] rounded-full overflow-hidden bg-ink/[0.14]" />
      </span>
    );
  }
  if (split) {
    const l = dayLean({ askPct: raw, volume: split.ask + split.bid + split.mid, sideVol: split });
    if (!Number.isFinite(l.ask)) {
      return (
        <span className="inline-flex flex-col items-end gap-[3px] min-w-20" title="No side volume on this row">
          <span className="font-mono text-t11 tnum leading-[14px] text-textMuted">—</span>
        </span>
      );
    }
    const sh = sideShares(split.bid, split.mid, split.ask);
    const a = sh.ask;
    const b = sh.bid;
    const m = sh.mid;
    /* The label prints the number the rule uses: a side's share of the sided volume, or the mid's share of the whole
       on a mostly-mid day. */
    const askS = Math.round(l.askSided);
    /* An even day still says which way it tipped: the larger side's sided share, quiet, short of the call */
    const label = l.lean === 'ASK' ? `ask ${askS}%` : l.lean === 'BID' ? `bid ${100 - askS}%` : l.lean === 'UNSIDED' ? `mid ${m}%` : l.askSided >= 50 ? `even · ask ${shyPct(l.askSided)}%` : `even · bid ${shyPct(l.bidSided)}%`;
    const tone = l.lean === 'ASK' || l.lean === 'BID' ? 'text-textPrimary' : 'text-textSecondary';
    const total = split.ask + split.bid + split.mid;
    const noun = unit === 'premium' ? 'premium' : `${total.toLocaleString('en-US')} contracts`;
    return (
      <span
        className="inline-flex flex-col items-end gap-[3px] min-w-20"
        title={`${l.lean === 'ASK' || l.lean === 'BID' ? `${l.lean === 'ASK' ? 'At the ask' : 'On the bid'}: ${l.lean === 'ASK' ? askS : 100 - askS}% of the ${unit === 'premium' ? 'premium' : 'contracts'} that traded on a side — the share the lean is called on (${LEAN_EDGE}% or more, with at least half the ${unit === 'premium' ? 'premium' : 'day'} on a side). ` : l.lean === 'EVEN' ? `Even — ${askS >= 50 ? `${askS}% at the ask` : `${100 - askS}% on the bid`} of the ${unit === 'premium' ? 'premium' : 'contracts'} that traded on a side, short of the ${LEAN_EDGE}% a lean is called on. ` : ''}Of the ${unit === 'premium' ? "alert's whole" : "day's"} ${noun}: ${a}% at the ask, ${b}% on the bid, ${m}% at the mid or with no side${l.lean === 'UNSIDED' ? ' — under half traded on a side, so no lean is called' : ''}`}
      >
        <span className={`font-mono text-t11 ${l.lean === 'ASK' || l.lean === 'BID' ? 'font-semibold' : ''} tnum leading-[14px] whitespace-nowrap ${tone}`}>{label}</span>
        <span className="flex w-20 h-[3px] rounded-full overflow-hidden bg-ink/[0.14]">
          <span className="h-full bg-ink/[0.0]" style={{ width: `${b}%` }} />
          <span className="h-full bg-ink/30" style={{ width: `${m}%` }} />
          <span className="h-full bg-textPrimary/80" style={{ width: `${a}%` }} />
        </span>
      </span>
    );
  }
  /* no side figure (a flow alert, a row the feed sent no side volume for): a dash, never "ASK 100%" */
  if (!Number.isFinite(raw)) {
    return (
      <span className="inline-flex flex-col items-end gap-[3px] min-w-20" title="No side volume on this row">
        <span className="font-mono text-t11 tnum leading-[14px] text-textMuted">—</span>
      </span>
    );
  }
  /* whole percents — a raw share printed "ASK 98.97826700536268%" */
  const askPct = Math.round(Math.max(0, Math.min(100, raw)));
  const bidPct = 100 - askPct;
  /* near-even is EVEN, not "MID": the mid volume is not in this split at all — the same edge as the split's (dayLean) */
  const l = dayLean({ askPct, volume: 0 }).lean;
  const even = l === 'EVEN';
  const label = even ? (askPct >= 50 ? `even · ask ${askPct}%` : `even · bid ${bidPct}%`) : l === 'BID' ? `bid ${bidPct}%` : `ask ${askPct}%`;
  const tone = even ? 'text-textSecondary' : 'text-textPrimary';
  return (
    <span className="inline-flex flex-col items-end gap-[3px] min-w-20" title={`Of what traded at the bid or ask: ${askPct}% at the ask, ${bidPct}% on the bid. A lean from ${LEAN_EDGE}% on a side`}>
      <span className={`font-mono text-t11 ${even ? '' : 'font-semibold'} tnum leading-[14px] whitespace-nowrap ${tone}`}>{label}</span>
      <span className="flex w-20 h-[3px] rounded-full overflow-hidden bg-ink/[0.14]">
        <span className="h-full bg-textPrimary/80 ml-auto" style={{ width: `${askPct}%` }} />
      </span>
    </span>
  );
};

export default LeanCell;
