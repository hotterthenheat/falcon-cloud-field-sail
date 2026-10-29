import React from 'react';

/** A dot-leader evidence row: a quiet label, leader dots, and the value in bright tabular figures. Pass a <Term> as
    the label when the word needs explaining. */
const Fact = ({
  label,
  value,
  valueCls = 'text-textPrimary',
  big = false,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  valueCls?: string;
  /** A larger row for a card that is a reading surface on its own */
  big?: boolean;
}) => (
  <span className={`flex items-baseline gap-2 min-w-0 font-mono ${big ? 'py-1' : ''}`}>
    <span className={`${big ? 'text-t105' : 'text-t10'} uppercase tracking-wider text-textSecondary shrink-0`}>{label}</span>
    <span className="flex-1 self-center border-b border-dotted border-ink/15" />
    {/* the large row's figure is a notch above the house size, semibold */}
    <span className={`${big ? 'text-t14 font-semibold' : 'text-t13 font-bold'} tnum ${valueCls}`}>{value}</span>
  </span>
);

export default Fact;
