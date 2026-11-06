/* shadcn's Alert as the house's state line (ui/states.tsx ErrorBox / FailLine): a hairline box on the panel, the title
   in mono tracked capitals in the state's ink, the words in the secondary ink. `warn` is the house's failure ink (a
   fetch that failed is caution, not the market's red); `bear` is for what was refused; `info` the silver. A failure is
   announced (role alert); the rest are a status. */

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './utils';

const alertVariants = cva('relative flex w-full gap-2.5 rounded-md border px-3 py-2.5 text-t12 [&>svg]:mt-[1px] [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:shrink-0', {
  variants: {
    variant: {
      neutral: 'border-borderSubtle bg-panel text-textSecondary [&>svg]:text-textMuted',
      info: 'border-silver/30 bg-silver/[0.05] text-textSecondary [&>svg]:text-silver',
      warn: 'border-warn/30 bg-warn/[0.05] text-textSecondary [&>svg]:text-warn',
      bear: 'border-bear/30 bg-bear/[0.05] text-textSecondary [&>svg]:text-bear',
    },
  },
  defaultVariants: { variant: 'neutral' },
});

const TITLE_INK = { neutral: 'text-textMuted', info: 'text-silver', warn: 'text-warn', bear: 'text-bear' } as const;
const Tone = React.createContext<keyof typeof TITLE_INK>('neutral');

export const Alert = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>>(
  ({ className, variant, role, children, ...props }, ref) => {
    const tone = variant ?? 'neutral';
    return (
      <div ref={ref} role={role ?? (tone === 'warn' || tone === 'bear' ? 'alert' : 'status')} className={cn(alertVariants({ variant }), className)} {...props}>
        <Tone.Provider value={tone}>{children}</Tone.Provider>
      </div>
    );
  },
);
Alert.displayName = 'Alert';

export const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(({ className, ...props }, ref) => {
  const tone = React.useContext(Tone);
  return <p ref={ref} className={cn('font-mono text-t10 uppercase tracking-widest', TITLE_INK[tone], className)} {...props} />;
});
AlertTitle.displayName = 'AlertTitle';

export const AlertDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('text-t12 leading-relaxed text-textSecondary', className)} {...props} />
));
AlertDescription.displayName = 'AlertDescription';
