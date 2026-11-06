/* shadcn's Tooltip (Radix) as the house tip: a short line in 10px mono on the chip, 8×4 padding, 6px off the control,
   no arrow, kept on screen, z-[90]. ONE TooltipProvider sits at the app's root (App.tsx), so moving from tip to tip
   skips the delay as it should; a tip rendered outside it brings its own.

   Hint — the tip anyone can reach (it replaces a native `title`, which a keyboard and a finger never see):
   - the pointer: on hover, after the provider's delay;
   - the keyboard: on focus (`focusable` gives a span or a figure a tab stop, so it can be reached at all);
   - a finger: a long press (450 ms) on a control shows it, and the press does not also act; `touch="tap"` on a thing
     that does nothing else shows it on a plain tap. It goes after 3 s, on a press elsewhere, or on Escape. */

import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from './utils';
import { composeRefs, themeScopeRef } from './layer';
import { TIP } from './surface';

const HasProvider = React.createContext(false);

export const TooltipProvider = ({ delayDuration = 200, skipDelayDuration = 300, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) => (
  <HasProvider.Provider value>
    <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={skipDelayDuration} {...props} />
  </HasProvider.Provider>
);

/** A provider only where none is above (a tip in a tree the app's root does not reach) */
export const EnsureTooltipProvider = ({ children }: { children: React.ReactNode }) =>
  React.useContext(HasProvider) ? <>{children}</> : <TooltipProvider>{children}</TooltipProvider>;

export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<React.ElementRef<typeof TooltipPrimitive.Content>, React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>>(
  ({ className, sideOffset = 6, collisionPadding = 8, ...props }, ref) => (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content ref={composeRefs(ref, themeScopeRef)} sideOffset={sideOffset} collisionPadding={collisionPadding} className={cn(TIP, className)} {...props} />
    </TooltipPrimitive.Portal>
  ),
);
TooltipContent.displayName = 'TooltipContent';

const PRESS_MS = 450;
const SHOWN_MS = 3000;

export interface HintProps {
  label?: React.ReactNode;
  children: React.ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** Give the child a tab stop (a span, a figure) so the keyboard can reach its tip */
  focusable?: boolean;
  /** How a finger asks: a long press (a control that acts on a tap), or a tap (a thing that does nothing else) */
  touch?: 'press' | 'tap';
  className?: string;
}

export function Hint({ label, children, side = 'top', align, focusable = false, touch = 'press', className }: HintProps) {
  const [open, setOpen] = React.useState(false);
  const press = React.useRef<{ timer?: number; hide?: number; held: boolean; keep: number }>({ held: false, keep: 0 });
  React.useEffect(
    () => () => {
      window.clearTimeout(press.current.timer);
      window.clearTimeout(press.current.hide);
    },
    [],
  );
  if (label == null || label === '' || label === false) return children;

  const showByTouch = () => {
    const p = press.current;
    p.keep = Date.now() + 700;
    setOpen(true);
    window.clearTimeout(p.hide);
    p.hide = window.setTimeout(() => setOpen(false), SHOWN_MS);
  };
  /* the click that ends a long press is the press's, not the control's; a close Radix asks for in that moment is too */
  const onOpenChange = (next: boolean) => {
    if (!next && Date.now() < press.current.keep) return;
    setOpen(next);
  };
  const stop = () => window.clearTimeout(press.current.timer);

  return (
    <EnsureTooltipProvider>
      <Tooltip open={open} onOpenChange={onOpenChange}>
        <TooltipTrigger
          asChild
          tabIndex={focusable ? 0 : undefined}
          onPointerDown={e => {
            if (e.pointerType !== 'touch') return;
            const p = press.current;
            p.held = false;
            if (touch === 'tap') {
              if (open) setOpen(false);
              else showByTouch();
              return;
            }
            stop();
            p.timer = window.setTimeout(() => {
              p.held = true;
              showByTouch();
            }, PRESS_MS);
          }}
          onPointerUp={stop}
          onPointerCancel={stop}
          onPointerLeave={stop}
          onClickCapture={e => {
            if (!press.current.held) return;
            press.current.held = false;
            e.preventDefault();
            e.stopPropagation();
          }}
          onContextMenu={e => {
            if (press.current.held || open) e.preventDefault();
          }}
        >
          {children}
        </TooltipTrigger>
        <TooltipContent side={side} align={align} className={className}>
          {label}
        </TooltipContent>
      </Tooltip>
    </EnsureTooltipProvider>
  );
}
