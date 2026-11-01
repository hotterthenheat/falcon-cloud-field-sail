/* The house's popup surface, one string for every card a control opens (menus, selects, popovers, hover cards): the
   chip's ground, the subtle hairline, the 8px radius, the deep drop shadow, the soft rise in. z-[90], above the
   fullscreen takeovers (z-[80]). ui/DropdownSelect's CARD is this. */
export const POPUP = 'z-[90] rounded-lg border border-borderSubtle bg-chip text-textPrimary shadow-[0_16px_48px_rgba(0,0,0,0.65)] animate-soft-in';

/** A row in a popup list: the ink wash under the keyboard or pointer, mono 11px */
export const POPUP_ROW =
  'relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 font-mono text-t11 text-textSecondary outline-none transition-colors data-[highlighted]:bg-ink/[0.06] data-[highlighted]:text-textPrimary data-[disabled]:pointer-events-none data-[disabled]:cursor-default data-[disabled]:text-textMuted';

/** A popup's section label: mono caps, tracked, muted */
export const POPUP_LABEL = 'px-2 pt-1 pb-1.5 font-mono text-t9 uppercase tracking-widest text-textMuted';

/** The short line a tip carries: 10px mono on the chip, 8×4 padding */
export const TIP = 'z-[90] max-w-[280px] rounded-md border border-borderSubtle bg-chip px-2 py-1 font-mono text-t10 leading-snug text-textPrimary shadow-[0_8px_24px_rgba(0,0,0,0.55)] animate-soft-in';
