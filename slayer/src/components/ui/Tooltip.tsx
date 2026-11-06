/* The house tip — the shadcn Tooltip's Hint (shadcn/tooltip.tsx) since 2026-11-01: a short line on hover, on keyboard
   focus and on a long press of a finger, portalled and kept on screen; 10 px type, 8×4 px padding, 6 px off the
   control, no arrow. It shares the app's one TooltipProvider (App.tsx), so moving from tip to tip skips the delay.
   `focusable` gives a thing with no tab stop of its own (a figure, a word) one, so the keyboard reaches its tip;
   `touch="tap"` shows it on a plain tap where the thing does nothing else. This is what a native `title` becomes. */

import type { ReactElement, ReactNode } from 'react';
import { Hint } from '../shadcn/tooltip';

export function Tip({
  label,
  children,
  side = 'top',
  focusable,
  touch,
}: {
  label?: ReactNode;
  children: ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
  focusable?: boolean;
  touch?: 'press' | 'tap';
}) {
  return (
    <Hint label={label} side={side} focusable={focusable} touch={touch}>
      {children}
    </Hint>
  );
}
