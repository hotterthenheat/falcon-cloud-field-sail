/* shadcn's ContextMenu (Radix): the right-click (and long-press) menu, on the same surface and rows as DropdownMenu.
   New to the terminal — for grid rows (copy the contract, open it on Terrain, set an alert). */

import * as React from 'react';
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from './utils';
import { composeRefs, themeScopeRef } from './layer';
import { POPUP, POPUP_LABEL, POPUP_ROW } from './surface';

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
export const ContextMenuGroup = ContextMenuPrimitive.Group;
export const ContextMenuSub = ContextMenuPrimitive.Sub;
export const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;

export const ContextMenuContent = React.forwardRef<React.ElementRef<typeof ContextMenuPrimitive.Content>, React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>>(
  ({ className, collisionPadding = 12, ...props }, ref) => (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content ref={composeRefs(ref, themeScopeRef)} collisionPadding={collisionPadding} className={cn(POPUP, 'min-w-[180px] p-1.5', className)} {...props} />
    </ContextMenuPrimitive.Portal>
  ),
);
ContextMenuContent.displayName = 'ContextMenuContent';

export const ContextMenuItem = React.forwardRef<React.ElementRef<typeof ContextMenuPrimitive.Item>, React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & { inset?: boolean }>(
  ({ className, inset, ...props }, ref) => <ContextMenuPrimitive.Item ref={ref} className={cn(POPUP_ROW, inset && 'pl-7', className)} {...props} />,
);
ContextMenuItem.displayName = 'ContextMenuItem';

export const ContextMenuCheckboxItem = React.forwardRef<React.ElementRef<typeof ContextMenuPrimitive.CheckboxItem>, React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.CheckboxItem>>(
  ({ className, children, ...props }, ref) => (
    <ContextMenuPrimitive.CheckboxItem ref={ref} className={cn(POPUP_ROW, 'pl-7', className)} {...props}>
      <span className="absolute left-2 flex h-3 w-3 items-center justify-center">
        <ContextMenuPrimitive.ItemIndicator>
          <Check className="h-3 w-3 text-silver" />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  ),
);
ContextMenuCheckboxItem.displayName = 'ContextMenuCheckboxItem';

export const ContextMenuSubTrigger = React.forwardRef<React.ElementRef<typeof ContextMenuPrimitive.SubTrigger>, React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger>>(
  ({ className, children, ...props }, ref) => (
    <ContextMenuPrimitive.SubTrigger ref={ref} className={cn(POPUP_ROW, 'data-[state=open]:bg-ink/[0.06]', className)} {...props}>
      {children}
      <ChevronRight className="ml-auto h-3 w-3 text-textMuted" />
    </ContextMenuPrimitive.SubTrigger>
  ),
);
ContextMenuSubTrigger.displayName = 'ContextMenuSubTrigger';

export const ContextMenuSubContent = React.forwardRef<React.ElementRef<typeof ContextMenuPrimitive.SubContent>, React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>>(
  ({ className, ...props }, ref) => (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.SubContent ref={composeRefs(ref, themeScopeRef)} className={cn(POPUP, 'min-w-[160px] p-1.5', className)} {...props} />
    </ContextMenuPrimitive.Portal>
  ),
);
ContextMenuSubContent.displayName = 'ContextMenuSubContent';

export const ContextMenuLabel = React.forwardRef<React.ElementRef<typeof ContextMenuPrimitive.Label>, React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label>>(
  ({ className, ...props }, ref) => <ContextMenuPrimitive.Label ref={ref} className={cn(POPUP_LABEL, className)} {...props} />,
);
ContextMenuLabel.displayName = 'ContextMenuLabel';

export const ContextMenuSeparator = React.forwardRef<React.ElementRef<typeof ContextMenuPrimitive.Separator>, React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>>(
  ({ className, ...props }, ref) => <ContextMenuPrimitive.Separator ref={ref} className={cn('my-1 h-px bg-borderSubtle', className)} {...props} />,
);
ContextMenuSeparator.displayName = 'ContextMenuSeparator';

export const ContextMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span className={cn('ml-auto font-mono text-t10 tracking-wide text-textMuted', className)} {...props} />
);
ContextMenuShortcut.displayName = 'ContextMenuShortcut';
