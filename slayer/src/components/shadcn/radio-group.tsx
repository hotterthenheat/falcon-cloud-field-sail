/* shadcn's RadioGroup (Radix): one of a set, the arrows moving the choice. A 14px ring on the muted hairline; chosen,
   a silver ring with a silver dot. */

import * as React from 'react';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { cn } from './utils';

export const RadioGroup = React.forwardRef<React.ElementRef<typeof RadioGroupPrimitive.Root>, React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>>(
  ({ className, ...props }, ref) => <RadioGroupPrimitive.Root ref={ref} className={cn('grid gap-2', className)} {...props} />,
);
RadioGroup.displayName = 'RadioGroup';

export const RadioGroupItem = React.forwardRef<React.ElementRef<typeof RadioGroupPrimitive.Item>, React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>>(
  ({ className, ...props }, ref) => (
    <RadioGroupPrimitive.Item
      ref={ref}
      className={cn('peer inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-borderMuted transition-colors hover:border-textMuted disabled:cursor-not-allowed disabled:opacity-40 data-[state=checked]:border-silver', className)}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="block h-1.5 w-1.5 rounded-full bg-silver" />
    </RadioGroupPrimitive.Item>
  ),
);
RadioGroupItem.displayName = 'RadioGroupItem';
