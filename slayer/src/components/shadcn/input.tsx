/* shadcn's Input, as the house field (.slayer-field): 28px (40 on a phone), the chip's ground, a hairline that turns
   silver under focus, mono 11px. `bare` drops the box for a field that sits inside one (a search row in a card).
   aria-invalid wears the bear hairline. */

import * as React from 'react';
import { cn } from './utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  bare?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, bare = false, ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      bare
        ? 'w-full bg-transparent font-mono text-t11 text-textPrimary placeholder:text-textMuted focus:outline-none'
        : 'h-7 max-sm:h-10 w-full rounded-md border border-borderSubtle bg-chip px-2 font-mono text-t11 text-textPrimary placeholder:text-textMuted transition-colors hover:border-borderMuted focus:outline-none focus:border-silver/50 aria-[invalid=true]:border-bear/60',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';
