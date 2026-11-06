/* shadcn's Command (cmdk): a search box over a list the arrows walk, with the combobox and listbox roles a screen
   reader needs (the input is a combobox that names the row the keyboard is on; each row an option). In the house's
   grammar: rows wash in the ink under the keyboard or pointer, group heads in mono tracked capitals, the search row on a
   hairline. The terminal's lists rank their own matches (the symbol directory, the palette's actions), so a caller
   passes shouldFilter={false} and hands the rows in order. CommandDialog is the palette's frame: the house Dialog, high. */

import * as React from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';
import { cn } from './utils';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';

export const Command = React.forwardRef<React.ElementRef<typeof CommandPrimitive>, React.ComponentPropsWithoutRef<typeof CommandPrimitive>>(
  /* vimBindings off: Ctrl+K is the palette's key and Ctrl+N/P/J are the browser's, never a row step */
  ({ className, vimBindings = false, ...props }, ref) => <CommandPrimitive ref={ref} vimBindings={vimBindings} className={cn('flex h-full w-full flex-col overflow-hidden text-textPrimary', className)} {...props} />,
);
Command.displayName = 'Command';

export interface CommandDialogProps extends React.ComponentPropsWithoutRef<typeof Dialog> {
  /** The dialog's name for assistive tech (shown to no one) */
  label: string;
  /** What the list holds, said once as it opens */
  description?: string;
  className?: string;
  /** Command's own props (shouldFilter, loop, value…) */
  commandProps?: React.ComponentPropsWithoutRef<typeof CommandPrimitive>;
  children: React.ReactNode;
}

export const CommandDialog = ({ label, description, className, commandProps, children, ...props }: CommandDialogProps) => (
  <Dialog {...props}>
    <DialogContent place="top" showClose={false} className={cn('max-w-lg shadow-black', className)}>
      <DialogTitle className="sr-only">{label}</DialogTitle>
      <DialogDescription className="sr-only">{description ?? label}</DialogDescription>
      <Command {...commandProps}>{children}</Command>
    </DialogContent>
  </Dialog>
);

export interface CommandInputProps extends React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input> {
  /** The magnifier before the words: on by default, 'sm' the 12px one of a card's search row */
  icon?: boolean | 'sm';
  /** Classes for the search row around the input */
  rowClassName?: string;
  /** Something at the row's end (a working mark) */
  trailing?: React.ReactNode;
}

export const CommandInput = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Input>, CommandInputProps>(
  ({ className, icon = true, rowClassName, trailing, ...props }, ref) => (
    <div className={cn('relative flex items-center gap-2 border-b border-borderSubtle px-3', rowClassName)} cmdk-input-wrapper="">
      {icon && <Search className={cn('shrink-0 text-textMuted', icon === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5')} aria-hidden="true" />}
      <CommandPrimitive.Input
        ref={ref}
        className={cn('w-full bg-transparent py-2.5 text-sm text-textPrimary placeholder:text-textMuted focus:outline-none disabled:cursor-not-allowed disabled:opacity-50', className)}
        {...props}
      />
      {trailing}
    </div>
  ),
);
CommandInput.displayName = 'CommandInput';

export const CommandList = React.forwardRef<React.ElementRef<typeof CommandPrimitive.List>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>>(
  ({ className, ...props }, ref) => <CommandPrimitive.List ref={ref} className={cn('max-h-72 overflow-y-auto overflow-x-hidden', className)} {...props} />,
);
CommandList.displayName = 'CommandList';

export const CommandEmpty = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Empty>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>>(
  ({ className, ...props }, ref) => <CommandPrimitive.Empty ref={ref} className={cn('px-4 py-6 text-center font-mono text-t11 text-textMuted', className)} {...props} />,
);
CommandEmpty.displayName = 'CommandEmpty';

export const CommandGroup = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Group>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>>(
  ({ className, ...props }, ref) => (
    <CommandPrimitive.Group
      ref={ref}
      className={cn('[&_[cmdk-group-heading]]:select-none [&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-t10 [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-textMuted', className)}
      {...props}
    />
  ),
);
CommandGroup.displayName = 'CommandGroup';

export const CommandSeparator = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Separator>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>>(
  ({ className, ...props }, ref) => <CommandPrimitive.Separator ref={ref} className={cn('my-1 h-px bg-borderSubtle', className)} {...props} />,
);
CommandSeparator.displayName = 'CommandSeparator';

export const CommandItem = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Item>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>>(
  ({ className, ...props }, ref) => (
    <CommandPrimitive.Item
      ref={ref}
      className={cn(
        'group relative flex w-full cursor-pointer select-none items-center gap-3 px-4 py-2 text-left outline-none transition-colors data-[selected=true]:bg-ink/[0.05] data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
CommandItem.displayName = 'CommandItem';

export const CommandShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span className={cn('ml-auto font-mono text-t10 tracking-wide text-textMuted', className)} {...props} />
);
CommandShortcut.displayName = 'CommandShortcut';
