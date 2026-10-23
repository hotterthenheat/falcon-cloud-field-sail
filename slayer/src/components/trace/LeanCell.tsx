/*
  THE bid/ask cell — the Live Tape's RatioCell grammar, shared (Noah,
  2026-08-30: "our bid ask should be the one we have for options tape...
  make that the same ui"). Label over the bar: the ask share in the primary
  ink from the right, the bid's share the quiet track left of it.
*/

import { dayLean, LEAN_EDGE, sideShares } from '../../data/traceLive';
import { shyPct } from './dayWords';

/* THE SIDE IN ONE INK (2026-10-13, the partner's rule at Noah's word): the ask share was green and the bid share red —
   direction inks on a fact about SIDE, the reading the tape's own quote cell refuses: a put bought at the ask is not
   bullish. The label and the bar's reach carry the side; the bar is the ask share in the primary ink over the bid's
   quiet track.

   ALL THREE SIDES (the re-audit, 2026-10-22: QQQ 725C read "ASK 56%" on 166 at the ask against 128 on the bid, while
   38,000 of its 38,304 contracts were a no-side cross): given the day's contracts by side, the bar is ask · mid · bid
   over the WHOLE volume, and a lean is called only when it is real — at least half the day on a side, and that side
   LEAN_EDGE (55%) or more of it — the one rule (traceLive dayLean) every lean on Trace reads. A day that was mostly mid or
   no side says MID. */

const LeanCell = ({ askPct: raw, split, unit = 'contracts' }: { askPct: number; split?: { ask: number; bid: number; mid: number }; unit?: 'contracts' | 'premium' }) => {
  if (split) {
    const l = dayLean({ askPct: raw, volume: split.ask + split.bid + split.mid, sideVol: split });
    if (!Number.isFinite(l.ask)) {
      return (
        <span className="inline-flex flex-col items-end gap-[3px] w-16" title="No side volume on this row">
          <span className="font-mono text-[11px] uppercase tnum leading-[14px] text-textMuted">—</span>
        </span>
      );
    }
    const sh = sideShares(split.bid, split.mid, split.ask);
    const a = sh.ask;
    const b = sh.bid;
    const m = sh.mid;
    /* THE LABEL PRINTS THE NUMBER THE RULE USES (audit round 4: SPXW 7600P read "BID 47%" — the bid's share of ALL its
       contracts — while the lean was called on the bid's 59.9% of the SIDED ones): a side's lean is its share of the sided
       volume; a mostly-mid day prints the mid's share of the whole. The hover gives all three shares of the whole. */
    const askS = Math.round(l.askSided);
    /* AN EVEN DAY STILL SAYS WHICH WAY IT TIPPED (retail, 2026-10-23: NVDA's Screener read "EVEN" on nearly every row and
       answered nothing) — the larger side's share of the sided volume, lower-case and quiet: short of the 55% call */
    const label = l.lean === 'ASK' ? `ASK ${askS}%` : l.lean === 'BID' ? `BID ${100 - askS}%` : l.lean === 'UNSIDED' ? `MID ${m}%` : l.askSided >= 50 ? `ask ${shyPct(l.askSided)}%` : `bid ${shyPct(l.bidSided)}%`;
    const tone = l.lean === 'ASK' || l.lean === 'BID' ? 'text-textPrimary' : 'text-textSecondary';
    const total = split.ask + split.bid + split.mid;
    const noun = unit === 'premium' ? 'premium' : `${total.toLocaleString('en-US')} contracts`;
    return (
      <span
        className="inline-flex flex-col items-end gap-[3px] w-16"
        title={`${l.lean === 'ASK' || l.lean === 'BID' ? `${l.lean === 'ASK' ? 'At the ask' : 'On the bid'}: ${l.lean === 'ASK' ? askS : 100 - askS}% of the ${unit === 'premium' ? 'premium' : 'contracts'} that traded on a side — the share the lean is called on (${LEAN_EDGE}% or more, with at least half the ${unit === 'premium' ? 'premium' : 'day'} on a side). ` : l.lean === 'EVEN' ? `Even — ${askS >= 50 ? `${askS}% at the ask` : `${100 - askS}% on the bid`} of the ${unit === 'premium' ? 'premium' : 'contracts'} that traded on a side, short of the ${LEAN_EDGE}% a lean is called on. ` : ''}Of the ${unit === 'premium' ? "alert's whole" : "day's"} ${noun}: ${a}% at the ask, ${b}% on the bid, ${m}% at the mid or with no side${l.lean === 'UNSIDED' ? ' — under half traded on a side, so no lean is called' : ''}`}
      >
        <span className={`font-mono text-[11px] font-semibold ${l.lean === 'EVEN' ? '' : 'uppercase'} tnum leading-[14px] ${tone}`}>{label}</span>
        <span className="flex w-16 h-[3px] rounded-full overflow-hidden bg-ink/[0.14]">
          <span className="h-full bg-ink/[0.0]" style={{ width: `${b}%` }} />
          <span className="h-full bg-ink/30" style={{ width: `${m}%` }} />
          <span className="h-full bg-textPrimary/80" style={{ width: `${a}%` }} />
        </span>
      </span>
    );
  }
  /* no side figure (a flow alert, a row the vendor sent no side volume for): a dash, never "ASK 100%" */
  if (!Number.isFinite(raw)) {
    return (
      <span className="inline-flex flex-col items-end gap-[3px] w-16" title="No side volume on this row">
        <span className="font-mono text-[11px] uppercase tnum leading-[14px] text-textMuted">—</span>
      </span>
    );
  }
  /* whole percents — a raw share printed "ASK 98.97826700536268%" */
  const askPct = Math.round(Math.max(0, Math.min(100, raw)));
  const bidPct = 100 - askPct;
  /* near-even is EVEN, not "MID": the mid volume is not in this split at all — the same edge as the split's (dayLean) */
  const l = dayLean({ askPct, volume: 0 }).lean;
  const even = l === 'EVEN';
  const label = even ? (askPct >= 50 ? `ask ${askPct}%` : `bid ${bidPct}%`) : l === 'BID' ? `BID ${bidPct}%` : `ASK ${askPct}%`;
  const tone = even ? 'text-textSecondary' : 'text-textPrimary';
  return (
    <span className="inline-flex flex-col items-end gap-[3px] w-16" title={`Of the premium or volume that traded at the bid or the ask: ${askPct}% at the ask, ${bidPct}% on the bid (mid and no-side not in this split) — a lean from ${LEAN_EDGE}% on a side`}>
      <span className={`font-mono text-[11px] font-semibold ${even ? '' : 'uppercase'} tnum leading-[14px] ${tone}`}>{label}</span>
      <span className="flex w-16 h-[3px] rounded-full overflow-hidden bg-ink/[0.14]">
        <span className="h-full bg-textPrimary/80 ml-auto" style={{ width: `${askPct}%` }} />
      </span>
    </span>
  );
};

export default LeanCell;
