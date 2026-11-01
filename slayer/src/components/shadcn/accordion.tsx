/* shadcn's Accordion (Radix) as the house fold (ui/Fold.tsx): a hairline under each head, the head in the primary ink
   with a muted chevron that turns, the body opening without a jolt (no height animation: the house's rule for anything
   that holds a table). Radix brings the button and region roles, aria-expanded and the arrows between heads. */

import * as React from 'react';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDown } from 'lucide-react';
import { cn } from './utils';

export const Accordion = AccordionPrimitive.Root;

export const AccordionItem = React.forwardRef<React.ElementRef<typeof AccordionPrimitive.Item>, React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>>(
  ({ className, ...props }, ref) => <AccordionPrimitive.Item ref={ref} className={cn('border-b border-borderSubtle', className)} {...props} />,
);
AccordionItem.displayName = 'AccordionItem';

export const AccordionTrigger = React.forwardRef<React.ElementRef<typeof AccordionPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger>>(
  ({ className, children, ...props }, ref) => (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        ref={ref}
        className={cn('group flex flex-1 items-center justify-between gap-2 py-2.5 text-left text-t13 font-medium text-textPrimary transition-colors hover:text-textPrimary [&[data-state=open]>svg]:rotate-180', className)}
        {...props}
      >
        {children}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-textMuted transition-transform duration-200 motion-reduce:transition-none" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  ),
);
AccordionTrigger.displayName = 'AccordionTrigger';

export const AccordionContent = React.forwardRef<React.ElementRef<typeof AccordionPrimitive.Content>, React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>>(
  ({ className, children, ...props }, ref) => (
    <AccordionPrimitive.Content ref={ref} className="overflow-hidden text-t12 text-textSecondary" {...props}>
      <div className={cn('pb-3', className)}>{children}</div>
    </AccordionPrimitive.Content>
  ),
);
AccordionContent.displayName = 'AccordionContent';
