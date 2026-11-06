/* shadcn's Switch (Radix), as the terminal's switches already are (Settings, WatchMenu, BellNotice): 32×18 on a faint
   wash, on in solid silver with the panel's dot. Role switch, aria-checked, Space toggles. */

import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from './utils';

export const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>>(
  ({ className, ...props }, ref) => (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'relative h-[18px] w-8 shrink-0 rounded-full border border-borderSubtle bg-ink/[0.06] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-silver/60 disabled:opacity-40 data-[state=checked]:border-silver data-[state=checked]:bg-silver',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block h-3 w-3 translate-x-[2px] rounded-full bg-textPrimary transition-transform data-[state=checked]:translate-x-[16px] data-[state=checked]:bg-panel motion-reduce:transition-none" />
    </SwitchPrimitive.Root>
  ),
);
Switch.displayName = 'Switch';
