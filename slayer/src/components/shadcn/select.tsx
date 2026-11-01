/* shadcn's Select (Radix) — the native <select> replaced (Paper's new account, the script library, the manual journal
   entry): the trigger is the house chip, the list the house popup surface with a silver check on the chosen row.
   Radix brings the listbox roles, typeahead, the arrows, and focus back to the trigger. */

import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from './utils';
import { composeRefs, themeScopeRef } from './layer';
import { POPUP, POPUP_LABEL, POPUP_ROW } from './surface';

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>>(
  ({ className, children, ...props }, ref) => (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(
        'inline-flex h-7 max-sm:h-10 w-full items-center justify-between gap-1.5 rounded-md border border-borderSubtle bg-chip px-2.5 font-mono text-t11 text-textPrimary transition-colors hover:border-borderMuted focus:outline-none data-[state=open]:border-silver/50 data-[placeholder]:text-textMuted disabled:cursor-not-allowed disabled:opacity-50 [&>span]:truncate',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="h-3 w-3 shrink-0 text-textMuted" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  ),
);
SelectTrigger.displayName = 'SelectTrigger';

export const SelectContent = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Content>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>>(
  ({ className, children, position = 'popper', sideOffset = 6, ...props }, ref) => (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={composeRefs(ref, themeScopeRef)}
        position={position}
        sideOffset={sideOffset}
        className={cn(POPUP, 'relative max-h-[min(var(--radix-select-content-available-height),360px)] min-w-[8rem] overflow-hidden', position === 'popper' && 'w-full min-w-[var(--radix-select-trigger-width)]', className)}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="flex h-5 cursor-default items-center justify-center text-textMuted">
          <ChevronUp className="h-3 w-3" />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="p-1.5">{children}</SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex h-5 cursor-default items-center justify-center text-textMuted">
          <ChevronDown className="h-3 w-3" />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  ),
);
SelectContent.displayName = 'SelectContent';

export const SelectLabel = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Label>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>>(
  ({ className, ...props }, ref) => <SelectPrimitive.Label ref={ref} className={cn(POPUP_LABEL, className)} {...props} />,
);
SelectLabel.displayName = 'SelectLabel';

export const SelectItem = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Item>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>>(
  ({ className, children, ...props }, ref) => (
    <SelectPrimitive.Item ref={ref} className={cn(POPUP_ROW, 'pl-7 data-[state=checked]:font-semibold data-[state=checked]:text-textPrimary', className)} {...props}>
      <span className="absolute left-2 flex h-3 w-3 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-3 w-3 text-silver" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  ),
);
SelectItem.displayName = 'SelectItem';

export const SelectSeparator = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Separator>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>>(
  ({ className, ...props }, ref) => <SelectPrimitive.Separator ref={ref} className={cn('my-1 h-px bg-borderSubtle', className)} {...props} />,
);
SelectSeparator.displayName = 'SelectSeparator';
