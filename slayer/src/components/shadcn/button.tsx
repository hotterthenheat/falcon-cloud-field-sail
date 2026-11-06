/* shadcn's Button (new-york, Tailwind 3), in the house's grammar. The variants are the buttons the terminal already
   draws, by name:
   - `chip`     the resting control (.slayer-chip): hairline, the chip's ground, mono 11px, silver edge while its card is open
   - `holo`     where-you-are as a fill: the moving holo foil with dark words on the dark terminal, the galaxy ink with
                light words on paper (.foil-pill, index.css) — the active pill and the one call to action
   - `ghost`    no edge, the ink wash under the pointer (the drawers' icon buttons, the sidebar's rows)
   - `flat`     ui/flatDoor.ts: tracked capitals, no edge, a wash under the pointer (ChartToolbar, Pulse's strips)
   - `outline`  the hairline door in tracked capitals (settings' Door)
   - `silver`   the armed door: a silver wash and silver words
   - `destructive` the bear door: a bear hairline and bear words
   - `link`     words with an underline
   - `bare`     nothing but the reset — a caller that draws its own (the sidebar's rows) keeps its classes, merged
   Sizes: `xs` 24 · `sm` 28 (the house's default control) · `md` 32 · `lg` 40 · `icon` 24 square · `iconSm` 20 ·
   `none` (the caller sizes it). On a phone a `sm` control grows to 40 (max-sm:h-10), as .slayer-chip does.
   `asChild` renders the child (a Link) with the button's classes. */

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './utils';

export const buttonVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap select-none transition-colors disabled:pointer-events-none disabled:opacity-40 aria-disabled:cursor-not-allowed [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        chip: 'justify-center rounded-md border border-borderSubtle bg-chip font-mono text-t11 text-textSecondary hover:border-borderMuted hover:text-textPrimary data-[state=open]:border-silver/50',
        holo: 'relative justify-center rounded-md foil-glide foil-pill font-mono text-t11 font-semibold shadow-sm shadow-black/40',
        ghost: 'justify-center rounded-md text-textMuted hover:bg-ink/[0.06] hover:text-textPrimary data-[state=open]:bg-ink/[0.06] data-[state=open]:text-textPrimary',
        flat: 'hit justify-center rounded font-mono text-t11 uppercase tracking-wider text-textMuted hover:bg-ink/[0.05] hover:text-textPrimary data-[state=open]:bg-ink/[0.06] data-[state=open]:text-textPrimary',
        outline: 'justify-center rounded-md border border-borderSubtle font-mono text-t10 uppercase tracking-wider text-textSecondary hover:border-borderMuted hover:text-textPrimary',
        silver: 'justify-center rounded-md border border-silver/50 bg-silver/[0.08] font-mono text-t10 uppercase tracking-wider text-silver hover:bg-silver/[0.14]',
        destructive: 'justify-center rounded-md border border-bear/40 font-mono text-t10 uppercase tracking-wider text-bear hover:bg-bear/10',
        link: 'justify-center text-textSecondary underline decoration-borderMuted underline-offset-2 hover:text-textPrimary',
        bare: '',
      },
      size: {
        xs: 'h-6 px-2',
        sm: 'h-7 max-sm:h-10 px-2.5',
        md: 'h-8 px-3',
        lg: 'h-10 px-4',
        icon: 'h-6 w-6 shrink-0 p-0',
        iconSm: 'h-5 w-5 shrink-0 p-0',
        none: '',
      },
    },
    defaultVariants: { variant: 'chip', size: 'sm' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, type, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return <Comp ref={ref} type={asChild ? undefined : (type ?? 'button')} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
Button.displayName = 'Button';
