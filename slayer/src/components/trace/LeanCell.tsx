/*
  THE bid/ask cell — the Live Tape's RatioCell grammar, shared (Noah,
  2026-08-30: "our bid ask should be the one we have for options tape...
  make that the same ui"). Label over the bar: the ask share in the primary
  ink from the right, the bid's share the quiet track left of it. Near-even
  splits read MID, the tape's own rule.
*/

/* THE SIDE IN ONE INK (2026-10-13, the partner's rule at Noah's word): the ask share was green and the bid share red —
   direction inks on a fact about SIDE, the reading the tape's own quote cell refuses: a put bought at the ask is not
   bullish. The label and the bar's reach carry the side; the bar is the ask share in the primary ink over the bid's
   quiet track. */
const LeanCell = ({ askPct: raw }: { askPct: number }) => {
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
  /* near-even is EVEN, not "MID": the mid volume is not in this split at all */
  const even = Math.abs(askPct - 50) < 6;
  const label = even ? 'EVEN' : bidPct >= 50 ? `BID ${bidPct}%` : `ASK ${askPct}%`;
  const tone = even ? 'text-textMuted' : 'text-textPrimary';
  return (
    <span className="inline-flex flex-col items-end gap-[3px] w-16" title={`Of the volume that traded at the bid or the ask: ${askPct}% at the ask, ${bidPct}% on the bid (mid prints are not in this split)`}>
      <span className={`font-mono text-[11px] font-semibold uppercase tnum leading-[14px] ${tone}`}>{label}</span>
      <span className="flex w-16 h-[3px] rounded-full overflow-hidden bg-ink/[0.14]">
        <span className="h-full bg-textPrimary/80 ml-auto" style={{ width: `${askPct}%` }} />
      </span>
    </span>
  );
};

export default LeanCell;
