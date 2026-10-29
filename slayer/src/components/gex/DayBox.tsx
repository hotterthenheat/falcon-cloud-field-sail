import { createContext, useState, type ReactNode } from 'react';

/* The day box: the tape and the book's net gamma as two charts on one clock, edge to edge under one rule,
   the minute under the pointer marked on both (data/dayHover.ts). The upper chart's head is portalled into the box's one head line. */

/** Where the upper chart (TapeBox, as a part) puts its name and facts: the head row's own flex items, through a portal */
export const DayHeadSlot = createContext<HTMLElement | null>(null);

const DayBox = ({ scope, note, children }: { scope?: ReactNode; /** a quiet word after the name — the stage's (MapDesk) */ note?: ReactNode; children: ReactNode }) => {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  /* min-h-0: the box takes the row's height (MapDesk bookH); without it the plots kept their flex basis and overflowed. */
  return (
    <section className="relative flex-1 flex flex-col min-w-0 min-h-0" data-day-box data-day-open="">
      <div className="px-4 min-h-9 py-1 flex items-center gap-x-4 gap-y-1 flex-wrap">
        <h3 className="text-t16 font-semibold leading-tight text-textPrimary">The day</h3>
        {scope}
        {note && (
          <span className="font-mono text-t11 text-textMuted" data-day-note>
            {note}
          </span>
        )}
        {/* display: contents — what the chart portals in lays out as this row's own items */}
        <div ref={setSlot} className="contents" data-day-head-slot />
      </div>
      <DayHeadSlot.Provider value={slot}>
        <div className="flex-1 min-h-0 flex flex-col" data-day-charts>
          {children}
        </div>
      </DayHeadSlot.Provider>
    </section>
  );
};

export default DayBox;
