/* shadcn's Badge as the house tag (ui/Chip, SignalBadge, SessionTag): mono 10px on a 4px radius. The inks keep their
   one meaning each — bull/bear the market's sign, warn caution, supreme the engine's standout, silver the terminal's
   own "where you are / live", moon after hours — always beside a word, never colour alone. `holo` is the filled pill. */

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './utils';

export const badgeVariants = cva('inline-flex items-center gap-1 whitespace-nowrap rounded font-mono text-t10 leading-none transition-colors', {
  variants: {
    variant: {
      neutral: 'border border-borderSubtle bg-ink/[0.03] text-textSecondary',
      silver: 'border border-silver/40 bg-silver/[0.08] text-silver',
      live: 'tone-live border',
      bull: 'border border-bull/40 bg-bull/[0.08] text-bull',
      bear: 'border border-bear/40 bg-bear/[0.08] text-bear',
      warn: 'border border-warn/40 bg-warn/[0.08] text-warn',
      supreme: 'border border-supreme/40 bg-supreme/[0.08] text-supreme',
      moon: 'border border-moon/40 bg-moon/[0.08] text-moon',
      holo: 'relative foil-glide foil-pill font-semibold',
      ghost: 'text-textMuted',
    },
    size: { sm: 'h-4 px-1 text-t9', md: 'h-5 px-1.5', lg: 'h-6 px-2 text-t11' },
    caps: { true: 'uppercase tracking-wider', false: '' },
  },
  defaultVariants: { variant: 'neutral', size: 'md', caps: false },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(({ className, variant, size, caps, ...props }, ref) => (
  <span ref={ref} className={cn(badgeVariants({ variant, size, caps }), className)} {...props} />
));
Badge.displayName = 'Badge';
