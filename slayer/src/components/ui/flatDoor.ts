/*
==================================================
  SLAYER TERMINAL - THE FLAT CONTROL (ui/flatDoor.ts)

  The house's control grammar — the chart strip's
  (ChartToolbar), Pulse's widget strips': mono,
  tracked capitals at the 11px floor, no edge, a
  wash under the pointer, the silver wash when armed.
  The Pinpoint head and the Map's band wear it (the
  owner, 2026-10-14, of the bordered label-and-value
  pills in two rows under five stat cards: "this is
  AI slop and i thought we dont allow that anymore").
==================================================
*/

/** A door: the words in tracked capitals, the figure beside them in the page's ink */
export const FLAT_DOOR = 'hit inline-flex items-center gap-1.5 h-7 px-2 rounded font-mono text-[11px] uppercase tracking-wider text-textMuted hover:text-textPrimary hover:bg-ink/[0.05] transition-colors select-none whitespace-nowrap';
/** …while its card is open (a Radix trigger) */
export const FLAT_OPEN = 'data-[state=open]:bg-ink/[0.06] data-[state=open]:text-textPrimary';
/** …while it is armed: the replay running, the read up */
export const FLAT_ON = 'bg-silver/[0.12] text-silver hover:text-silver';
/** The figure on a door */
export const FLAT_VALUE = 'text-[11px] font-semibold text-textPrimary';
