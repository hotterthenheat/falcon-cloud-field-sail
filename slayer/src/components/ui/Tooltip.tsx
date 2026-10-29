/*
  The house tip. Same job as the shadcn tooltip: a short line on hover
  and keyboard focus, portaled, placed so it stays on screen.
  Sized to the desk, not the library default. 10px, the chip's type.
  8px by 4px of padding. 6px off the control, the same gap as a dropdown.
  No arrow. The cards on this desk do not wear one.
*/

import * as Tooltip from '@radix-ui/react-tooltip';
import type { ReactElement } from 'react';

export function Tip({
  label,
  children,
  side = 'top',
}: {
  label?: string | null;
  children: ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
}) {
  if (!label) return children;
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side={side}
            sideOffset={6}
            collisionPadding={8}
            className="z-[90] max-w-[280px] rounded-md border border-borderSubtle bg-chip px-2 py-1 font-mono text-t10 leading-snug text-textPrimary shadow-[0_8px_24px_rgba(0,0,0,0.55)] animate-soft-in"
          >
            {label}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
