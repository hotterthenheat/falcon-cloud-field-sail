/* shadcn's AlertDialog (Radix): the house modal's card for a question that must be answered — a press outside does not
   close it, Escape and the cancel do, and focus starts on the cancel. The answers are house doors (Button `outline`
   to keep, `destructive` for the bear act). Focus goes back to the opener; the card wears its opener's theme. */

import * as React from 'react';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import { cn } from './utils';
import { buttonVariants } from './button';
import { composeRefs, themeScopeRef, useMountOpener } from './layer';

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
export const AlertDialogPortal = AlertDialogPrimitive.Portal;

export const AlertDialogOverlay = React.forwardRef<React.ElementRef<typeof AlertDialogPrimitive.Overlay>, React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>>(
  ({ className, ...props }, ref) => (
    <AlertDialogPrimitive.Overlay
      ref={ref}
      className={cn('slayer-motion fixed inset-0 z-[90] bg-black/55 backdrop-blur-[2px] data-[state=open]:animate-ovl-backdrop-in data-[state=closed]:animate-ovl-backdrop-out', className)}
      {...props}
    />
  ),
);
AlertDialogOverlay.displayName = 'AlertDialogOverlay';

export const AlertDialogContent = React.forwardRef<React.ElementRef<typeof AlertDialogPrimitive.Content>, React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>>(
  ({ className, onCloseAutoFocus, ...props }, ref) => {
    const giveBack = useMountOpener();
    return (
      <AlertDialogPortal>
        <AlertDialogOverlay />
        <div className="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center p-4">
          <AlertDialogPrimitive.Content
            ref={composeRefs(ref, themeScopeRef)}
            onCloseAutoFocus={e => {
              onCloseAutoFocus?.(e);
              if (!e.defaultPrevented) giveBack(e);
            }}
            className={cn(
              'slayer-motion pointer-events-auto flex w-full max-w-[460px] flex-col gap-4 rounded-lg border border-borderMuted bg-panel p-4 text-textPrimary shadow-2xl shadow-black/70 focus:outline-none data-[state=open]:animate-ovl-card-in data-[state=closed]:animate-ovl-card-out',
              className,
            )}
            {...props}
          />
        </div>
      </AlertDialogPortal>
    );
  },
);
AlertDialogContent.displayName = 'AlertDialogContent';

export const AlertDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('flex flex-col gap-2', className)} {...props} />;
AlertDialogHeader.displayName = 'AlertDialogHeader';

export const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('flex items-center justify-end gap-2', className)} {...props} />;
AlertDialogFooter.displayName = 'AlertDialogFooter';

export const AlertDialogTitle = React.forwardRef<React.ElementRef<typeof AlertDialogPrimitive.Title>, React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>>(
  ({ className, ...props }, ref) => <AlertDialogPrimitive.Title ref={ref} className={cn('font-mono text-t11 uppercase tracking-widest text-textSecondary', className)} {...props} />,
);
AlertDialogTitle.displayName = 'AlertDialogTitle';

export const AlertDialogDescription = React.forwardRef<React.ElementRef<typeof AlertDialogPrimitive.Description>, React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>>(
  ({ className, ...props }, ref) => <AlertDialogPrimitive.Description ref={ref} className={cn('text-t12 text-textPrimary', className)} {...props} />,
);
AlertDialogDescription.displayName = 'AlertDialogDescription';

export const AlertDialogAction = React.forwardRef<React.ElementRef<typeof AlertDialogPrimitive.Action>, React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>>(
  ({ className, ...props }, ref) => <AlertDialogPrimitive.Action ref={ref} className={cn(buttonVariants({ variant: 'destructive' }), className)} {...props} />,
);
AlertDialogAction.displayName = 'AlertDialogAction';

export const AlertDialogCancel = React.forwardRef<React.ElementRef<typeof AlertDialogPrimitive.Cancel>, React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>>(
  ({ className, ...props }, ref) => <AlertDialogPrimitive.Cancel ref={ref} className={cn(buttonVariants({ variant: 'outline' }), className)} {...props} />,
);
AlertDialogCancel.displayName = 'AlertDialogCancel';
