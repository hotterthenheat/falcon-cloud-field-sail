import { createContext, useState, type ReactNode } from 'react';

/*
==================================================
  SLAYER TERMINAL - THE DAY (components/gex/DayBox.tsx)

  The tape and the book's net gamma on one clock (idea 1, 2026-10-13):
  both ran 09:30 to 16:00, 340px tall, 350px apart, and the reader hovered
  twice to read one minute. One head, the two plots under it with the same
  left edge and the same right lane, the minute under the pointer marked
  on both (data/dayHover.ts).

  TWO CHARTS, NOT ONE (Noah, 2026-10-15: "the book and the day
  should be 2 separate tradingview charts not one big one"): the
  two parts are two charts, each with its own clock along its
  foot and its own mark — the shared axis under the book, which
  read the box as one tall chart, is gone. The minute under the
  pointer is still marked on both.

  EDGE TO EDGE (Noah, the same day: "the day and the book should
  not have any padding, their respected charts should fill the
  entire container"): the two charts fill the box's width and
  height, one rule between them — no inset, no gap, no frames of
  their own (the first cut stood them as two framed islands).

  ONE LINE, NO FOLD (Noah, the same day: "everything should fit
  on one line, no fold should be shown"): the box's name, the
  name chip, the stage's note and the upper chart's own name and
  facts share one head line — the chart hands its head through
  the slot below (a portal) — and the fold door is gone; the box
  always stands open.
==================================================
*/

/** Where the upper chart (TapeBox, as a part) puts its name and facts: the head row's own flex items, through a portal */
export const DayHeadSlot = createContext<HTMLElement | null>(null);

const DayBox = ({ scope, note, children }: { scope?: ReactNode; /** a quiet word after the name — the stage's (MapDesk) */ note?: ReactNode; children: ReactNode }) => {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  /* min-h-0: the box is handed the row's height (MapDesk bookH) and must shrink its plots to it — without it the plots
     kept their flex basis and the box ran 80px into the clock card at 1440×900 (2026-10-14) */
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
