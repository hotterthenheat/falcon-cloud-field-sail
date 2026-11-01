/* shadcn's Dialog (Radix), dressed as the house modal (ui/Modal.tsx): the page dimmed but still legible under a 2px
   blur, the card on the panel with the muted hairline and the deep shadow, the house's in and out (modal-card /
   modal-backdrop, index.css; off under reduced motion). Centred by a flex frame rather than a translate, so the card's
   own entrance transform never fights its position. z-[90], the overlays' step.
   Beside Radix (focus moves in and stays, Escape, outside press, aria-modal, the page inert and still):
   - focus goes back to whatever opened it, trigger or not (layer.ts useMountOpener);
   - the card wears the theme of the box it was opened from (layer.ts scopeTheme). */

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from './utils';
import { composeRefs, themeScopeRef, useMountOpener } from './layer';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

export const DialogOverlay = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Overlay>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>>(
  ({ className, ...props }, ref) => (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn('fixed inset-0 z-[90] bg-black/55 backdrop-blur-[2px] slayer-motion data-[state=open]:animate-ovl-backdrop-in data-[state=closed]:animate-ovl-backdrop-out', className)}
      {...props}
    />
  ),
);
DialogOverlay.displayName = 'DialogOverlay';

export interface DialogContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /** The corner X (on by default) */
  showClose?: boolean;
  /** Where the card stands: centred (default) or high, under the top fifth (the palette) */
  place?: 'center' | 'top';
  /** Classes for the frame that places the card */
  frameClassName?: string;
  /** Leave the backdrop out (a host that draws its own) */
  bare?: boolean;
}

export const DialogContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, DialogContentProps>(
  ({ className, children, showClose = true, place = 'center', frameClassName, bare = false, onCloseAutoFocus, ...props }, ref) => {
    const giveBack = useMountOpener();
    return (
      <DialogPortal>
        {!bare && <DialogOverlay />}
        <div className={cn('pointer-events-none fixed inset-0 z-[90] flex justify-center p-4', place === 'top' ? 'items-start pt-[18vh]' : 'items-center', frameClassName)}>
          <DialogPrimitive.Content
            ref={composeRefs(ref, themeScopeRef)}
            onCloseAutoFocus={e => {
              onCloseAutoFocus?.(e);
              if (!e.defaultPrevented) giveBack(e);
            }}
            className={cn(
              'pointer-events-auto relative flex w-full max-w-lg max-h-[86vh] flex-col overflow-hidden rounded-lg border border-borderMuted bg-panel text-textPrimary shadow-2xl shadow-black/70 focus:outline-none',
              'slayer-motion data-[state=open]:animate-ovl-card-in data-[state=closed]:animate-ovl-card-out',
              className,
            )}
            {...props}
          >
            {children}
            {showClose && (
              <DialogPrimitive.Close className="absolute right-3 top-3 rounded p-1 text-textMuted transition-colors hover:bg-ink/[0.05] hover:text-textPrimary" aria-label="Close">
                <X className="h-4 w-4" />
              </DialogPrimitive.Close>
            )}
          </DialogPrimitive.Content>
        </div>
      </DialogPortal>
    );
  },
);
DialogContent.displayName = 'DialogContent';

export const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex shrink-0 flex-col gap-1 border-b border-borderSubtle px-4 py-3', className)} {...props} />
);
DialogHeader.displayName = 'DialogHeader';

export const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex shrink-0 items-center justify-end gap-2 border-t border-borderSubtle px-4 py-3', className)} {...props} />
);
DialogFooter.displayName = 'DialogFooter';

/** The card's name: the house's section label (mono caps, tracked) */
export const DialogTitle = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Title>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>(
  ({ className, ...props }, ref) => (
    <DialogPrimitive.Title ref={ref} className={cn('font-mono text-t11 uppercase tracking-widest text-textSecondary', className)} {...props} />
  ),
);
DialogTitle.displayName = 'DialogTitle';

export const DialogDescription = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Description>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>>(
  ({ className, ...props }, ref) => <DialogPrimitive.Description ref={ref} className={cn('text-t12 text-textMuted', className)} {...props} />,
);
DialogDescription.displayName = 'DialogDescription';
