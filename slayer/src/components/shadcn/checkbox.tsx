/* shadcn's Checkbox (Radix): the house tick box — a 14px square on the muted hairline; ticked, the silver square with
   the dark tick (a tick means where-you-are). Role checkbox, aria-checked (and "mixed"), Space toggles. */

import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import { cn } from './utils';

export const Checkbox = React.forwardRef<React.ElementRef<typeof CheckboxPrimitive.Root>, React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>>(
  ({ className, ...props }, ref) => (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        'peer inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border border-borderMuted transition-colors hover:border-textMuted disabled:cursor-not-allowed disabled:opacity-40 data-[state=checked]:border-silverFill data-[state=checked]:bg-silverFill data-[state=indeterminate]:border-silverFill data-[state=indeterminate]:bg-silverFill',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-onfoil">
        {props.checked === 'indeterminate' ? <Minus className="h-2.5 w-2.5" /> : <Check className="h-2.5 w-2.5" />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  ),
);
Checkbox.displayName = 'Checkbox';
