/* The house tip (Radix): a short line on hover and focus, portalled and kept on screen; 10 px type, 8×4 px padding,
   6 px off the control, no arrow. */

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
