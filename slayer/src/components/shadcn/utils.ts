/* shadcn's `cn`: clsx joins the class values, tailwind-merge drops the earlier of two classes that set one property, so a
   caller's className wins over a component's own.

   SLAYER'S SCALES ARE REGISTERED (tailwind.config.ts): tailwind-merge only knows Tailwind's default scales, and it reads
   any `text-<word>` it does not know as a COLOUR. Unregistered, `text-t10 text-textMuted` would be read as two colours
   and the size dropped without a word. Every named font size is listed here, so a size and a colour live side by side;
   scripts/cn-proof.ts holds that. A new step in tailwind.config.ts `fontSize` is added to FONT_SIZES too. */

import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/** tailwind.config.ts `theme.extend.fontSize`, every key */
export const FONT_SIZES = [
  'xxs', 'xxxs', 'meta', 'fine', 'ui', 'body',
  't7', 't75', 't8', 't85', 't9', 't95', 't10', 't105', 't11', 't115', 't12', 't125', 't13', 't135', 't14', 't145', 't15',
  't155', 't16', 't17', 't18', 't19', 't20', 't21', 't22', 't23', 't24', 't26', 't28', 't30', 't32', 't38', 't40', 't44',
  't46', 't50', 't52', 't54', 't56', 't64', 't72',
  'displaySm', 'displayLg', 'prompt',
] as const;

/** The house animations: index.css's own classes and the overlays' (tailwind.config.ts `animation`), so two on one
    element resolve to the later */
const ANIMATIONS = [
  'soft-in', 'soft-in-slow', 'slide-in', 'view-in', 'fade-in', 'grid-in', 'modal-backdrop', 'modal-backdrop-out', 'modal-card',
  'modal-card-out', 'drill-open', 'takeover-in', 'focus-flash',
  'ovl-backdrop-in', 'ovl-backdrop-out', 'ovl-card-in', 'ovl-card-out', 'ovl-pop-in', 'ovl-pop-out',
  'ovl-sheet-in-right', 'ovl-sheet-out-right', 'ovl-sheet-in-left', 'ovl-sheet-out-left', 'ovl-sheet-in-bottom', 'ovl-sheet-out-bottom',
] as const;

const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...FONT_SIZES] }],
      animate: [{ animate: [...ANIMATIONS] }],
      /* the radius step the config adds */
      rounded: [{ rounded: ['xs'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
