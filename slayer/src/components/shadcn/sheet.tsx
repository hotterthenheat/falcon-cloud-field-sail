/* shadcn's Sheet (Radix Dialog from an edge), dressed as the house drawer (the alerts and the watchlist): 400px of
   translucent glass (the panel at 75% over a 12px blur, the draw rail's), the muted hairline on its inner edge, a deep
   shadow, sliding 48px in over 0.5s and back out over 0.36s on the standard curve (sheet-* in index.css); under reduced
   motion it appears and goes. The scrim is clear, as the drawers' was: the page stays in view, a press on it closes.
   A modal dialog: focus moves in and stays, Escape closes, focus goes back to the opener (layer.ts). */

import * as React from 'react';
import * as SheetPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from './utils';
import { composeRefs, themeScopeRef, useFocusReturn } from './layer';

export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;
export const SheetPortal = SheetPrimitive.Portal;

export const SheetOverlay = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Overlay>, React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>>(
  ({ className, ...props }, ref) => <SheetPrimitive.Overlay ref={ref} className={cn('fixed inset-0 z-[87]', className)} {...props} />,
);
SheetOverlay.displayName = 'SheetOverlay';

const sheetVariants = cva(
  'slayer-motion fixed z-[88] flex flex-col border-borderMuted bg-panel/75 backdrop-blur-md backdrop-saturate-150 text-textPrimary focus:outline-none',
  {
    variants: {
      side: {
        right: 'inset-y-0 right-0 w-[400px] max-w-[92vw] border-l shadow-[-16px_0_48px_rgba(0,0,0,0.45)] data-[state=open]:animate-ovl-sheet-in-right data-[state=closed]:animate-ovl-sheet-out-right',
        left: 'inset-y-0 left-0 w-[320px] max-w-[88vw] border-r shadow-[16px_0_48px_rgba(0,0,0,0.45)] data-[state=open]:animate-ovl-sheet-in-left data-[state=closed]:animate-ovl-sheet-out-left',
        bottom: 'inset-x-0 bottom-0 max-h-[86vh] rounded-t-lg border-t shadow-[0_-16px_48px_rgba(0,0,0,0.45)] data-[state=open]:animate-ovl-sheet-in-bottom data-[state=closed]:animate-ovl-sheet-out-bottom',
      },
    },
    defaultVariants: { side: 'right' },
  },
);

export interface SheetContentProps extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>, VariantProps<typeof sheetVariants> {
  /** The corner X; the drawers draw their own in their head, so it is off by default */
  showClose?: boolean;
}

export const SheetContent = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Content>, SheetContentProps>(
  ({ side = 'right', className, children, showClose = false, onOpenAutoFocus, onCloseAutoFocus, ...props }, ref) => {
    const giveBack = useFocusReturn();
    return (
      <SheetPortal>
        <SheetOverlay />
        <SheetPrimitive.Content
          ref={composeRefs(ref, themeScopeRef)}
          aria-modal
          onOpenAutoFocus={e => {
            giveBack.onOpenAutoFocus(e);
            onOpenAutoFocus?.(e);
          }}
          onCloseAutoFocus={e => {
            onCloseAutoFocus?.(e);
            if (!e.defaultPrevented) giveBack.onCloseAutoFocus(e);
          }}
          className={cn(sheetVariants({ side }), className)}
          {...props}
        >
          {children}
          {showClose && (
            <SheetPrimitive.Close className="absolute right-3 top-3 rounded-md p-1 text-textMuted transition-colors hover:bg-ink/[0.06] hover:text-textPrimary" aria-label="Close">
              <X className="h-3.5 w-3.5" />
            </SheetPrimitive.Close>
          )}
        </SheetPrimitive.Content>
      </SheetPortal>
    );
  },
);
SheetContent.displayName = 'SheetContent';

export const SheetTitle = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Title>, React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>>(
  ({ className, ...props }, ref) => <SheetPrimitive.Title ref={ref} className={cn('text-t14 font-semibold text-textPrimary', className)} {...props} />,
);
SheetTitle.displayName = 'SheetTitle';

export const SheetDescription = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Description>, React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>>(
  ({ className, ...props }, ref) => <SheetPrimitive.Description ref={ref} className={cn('font-mono text-t10 text-textMuted', className)} {...props} />,
);
SheetDescription.displayName = 'SheetDescription';
