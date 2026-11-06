/* shadcn's DropdownMenu (Radix) on the house popup surface (surface.ts): rows in mono 11px with the ink wash, a silver
   check on the chosen row, section labels in tracked capitals. Radix brings the keyboard (arrows, typeahead, Home/End),
   focus in and back to the trigger, Escape and outside press. The card wears the theme of its trigger's box. */

import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight, Circle } from 'lucide-react';
import { cn } from './utils';
import { composeRefs, themeScopeRef } from './layer';
import { POPUP, POPUP_LABEL, POPUP_ROW } from './surface';

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;
export const DropdownMenuItemIndicator = DropdownMenuPrimitive.ItemIndicator;

export const DropdownMenuSubTrigger = React.forwardRef<React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>, React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & { inset?: boolean }>(
  ({ className, inset, children, ...props }, ref) => (
    <DropdownMenuPrimitive.SubTrigger ref={ref} className={cn(POPUP_ROW, 'data-[state=open]:bg-ink/[0.06]', inset && 'pl-7', className)} {...props}>
      {children}
      <ChevronRight className="ml-auto h-3 w-3 text-textMuted" />
    </DropdownMenuPrimitive.SubTrigger>
  ),
);
DropdownMenuSubTrigger.displayName = 'DropdownMenuSubTrigger';

export const DropdownMenuSubContent = React.forwardRef<React.ElementRef<typeof DropdownMenuPrimitive.SubContent>, React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>>(
  ({ className, ...props }, ref) => (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.SubContent ref={composeRefs(ref, themeScopeRef)} className={cn(POPUP, 'min-w-[160px] p-1.5', className)} {...props} />
    </DropdownMenuPrimitive.Portal>
  ),
);
DropdownMenuSubContent.displayName = 'DropdownMenuSubContent';

export const DropdownMenuContent = React.forwardRef<React.ElementRef<typeof DropdownMenuPrimitive.Content>, React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>>(
  ({ className, sideOffset = 6, collisionPadding = 12, ...props }, ref) => (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={composeRefs(ref, themeScopeRef)}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(POPUP, 'min-w-[180px] p-1.5', className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  ),
);
DropdownMenuContent.displayName = 'DropdownMenuContent';

export const DropdownMenuItem = React.forwardRef<React.ElementRef<typeof DropdownMenuPrimitive.Item>, React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & { inset?: boolean }>(
  ({ className, inset, ...props }, ref) => <DropdownMenuPrimitive.Item ref={ref} className={cn(POPUP_ROW, inset && 'pl-7', className)} {...props} />,
);
DropdownMenuItem.displayName = 'DropdownMenuItem';

/** A tick box row: the silver square with the dark tick (where-you-are) */
export const DropdownMenuCheckboxItem = React.forwardRef<React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>, React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>>(
  ({ className, children, checked, ...props }, ref) => (
    <DropdownMenuPrimitive.CheckboxItem ref={ref} checked={checked} className={cn(POPUP_ROW, 'items-start gap-2.5', className)} {...props}>
      <span className={cn('mt-px inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border', checked === true ? 'border-silverFill bg-silverFill' : 'border-borderMuted')}>
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="h-2.5 w-2.5 text-onfoil" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  ),
);
DropdownMenuCheckboxItem.displayName = 'DropdownMenuCheckboxItem';

/** One of a set: a silver check beside the chosen row */
export const DropdownMenuRadioItem = React.forwardRef<React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>, React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem> & { mark?: 'check' | 'dot' }>(
  ({ className, children, mark = 'check', ...props }, ref) => (
    <DropdownMenuPrimitive.RadioItem ref={ref} className={cn(POPUP_ROW, 'items-start data-[state=checked]:text-textPrimary', className)} {...props}>
      <span className="mt-[2px] flex h-3 w-3 shrink-0 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          {mark === 'dot' ? <Circle className="h-1.5 w-1.5 fill-current text-silver" /> : <Check className="h-3 w-3 text-silver" />}
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  ),
);
DropdownMenuRadioItem.displayName = 'DropdownMenuRadioItem';

export const DropdownMenuLabel = React.forwardRef<React.ElementRef<typeof DropdownMenuPrimitive.Label>, React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & { inset?: boolean }>(
  ({ className, inset, ...props }, ref) => <DropdownMenuPrimitive.Label ref={ref} className={cn(POPUP_LABEL, inset && 'pl-7', className)} {...props} />,
);
DropdownMenuLabel.displayName = 'DropdownMenuLabel';

export const DropdownMenuSeparator = React.forwardRef<React.ElementRef<typeof DropdownMenuPrimitive.Separator>, React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>>(
  ({ className, ...props }, ref) => <DropdownMenuPrimitive.Separator ref={ref} className={cn('my-1 h-px bg-borderSubtle', className)} {...props} />,
);
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator';

export const DropdownMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span className={cn('ml-auto font-mono text-t10 tracking-wide text-textMuted', className)} {...props} />
);
DropdownMenuShortcut.displayName = 'DropdownMenuShortcut';
