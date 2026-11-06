/* shadcn's HoverCard (Radix): a richer card under the pointer (a glossary term, a name's facts) on the house popup
   surface, opening after 300 ms and staying while the pointer travels into it. Keyboard focus opens it too. */

import * as React from 'react';
import * as HoverCardPrimitive from '@radix-ui/react-hover-card';
import { cn } from './utils';
import { composeRefs, themeScopeRef } from './layer';
import { POPUP } from './surface';

export const HoverCard = ({ openDelay = 300, closeDelay = 120, ...props }: React.ComponentProps<typeof HoverCardPrimitive.Root>) => (
  <HoverCardPrimitive.Root openDelay={openDelay} closeDelay={closeDelay} {...props} />
);
export const HoverCardTrigger = HoverCardPrimitive.Trigger;

export const HoverCardContent = React.forwardRef<React.ElementRef<typeof HoverCardPrimitive.Content>, React.ComponentPropsWithoutRef<typeof HoverCardPrimitive.Content>>(
  ({ className, align = 'center', sideOffset = 6, collisionPadding = 12, ...props }, ref) => (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        ref={composeRefs(ref, themeScopeRef)}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(POPUP, 'w-64 p-3 text-t12 leading-snug', className)}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  ),
);
HoverCardContent.displayName = 'HoverCardContent';
