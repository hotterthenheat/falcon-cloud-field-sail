/* shadcn's Popover (Radix) on the house popup surface: focus moves in and back to the trigger, Escape and outside press
   close it, aria-expanded and aria-controls on the trigger. The card wears its trigger's theme. */

import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from './utils';
import { composeRefs, themeScopeRef } from './layer';
import { POPUP } from './surface';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export const PopoverContent = React.forwardRef<React.ElementRef<typeof PopoverPrimitive.Content>, React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>>(
  ({ className, align = 'start', sideOffset = 6, collisionPadding = 12, ...props }, ref) => (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={composeRefs(ref, themeScopeRef)}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(POPUP, 'w-72 p-3 focus:outline-none', className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  ),
);
PopoverContent.displayName = 'PopoverContent';
