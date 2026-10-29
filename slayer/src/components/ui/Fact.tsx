import React from 'react';

/**
 * Dot-leader evidence row — the vitals-strip grammar, used wherever a
 * paragraph used to narrate the same numbers (Mo, 2026-08-19: "show the
 * evidence... then a very small conclusion underneath"). Label whispers,
 * leader dots bridge, the value speaks in bright tabular figures. Pass a
 * <Term> as the label when the word needs explaining.
 */
const Fact = ({
  label,
  value,
  valueCls = 'text-textPrimary',
  big = false,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  valueCls?: string;
  /** A row sized for a card that is a reading surface on its own (the Weigher's case, 2026-10-10): a larger figure, a
      little more air — the same grammar */
  big?: boolean;
}) => (
  <span className={`flex items-baseline gap-2 min-w-0 font-mono ${big ? 'py-1' : ''}`}>
    <span className={`${big ? 'text-t105' : 'text-t10'} uppercase tracking-wider text-textSecondary shrink-0`}>{label}</span>
    <span className="flex-1 self-center border-b border-dotted border-ink/15" />
    {/* the big row's figure a notch larger than the house's, semibold not bold (Noah, 2026-10-10: "slightly too big and bold") */}
    <span className={`${big ? 'text-t14 font-semibold' : 'text-t13 font-bold'} tnum ${valueCls}`}>{value}</span>
  </span>
);

export default Fact;
