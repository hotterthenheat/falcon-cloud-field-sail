/* shadcn's ToggleGroup (Radix) as the house's soft tab strip (ui/FilterTabs.tsx): sentence-case words in a faint
   grouped rail, the chosen one on the moving holo foil with dark words (the galaxy ink with light words on paper:
   .foil-pill). One focus stop for the strip; the arrows walk it (roving focus), Space or Enter chooses. A single
   choice is a radio set (role radio, aria-checked); `type="multiple"` is a row of pressed toggles. */

import * as React from 'react';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './utils';

export const toggleItemVariants = cva(
  'group relative inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium text-textSecondary transition-colors hover:text-textPrimary disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      size: { md: 'px-3 py-1 text-xs', sm: 'px-2 py-1 text-xs' },
    },
    defaultVariants: { size: 'md' },
  },
);

const SizeContext = React.createContext<VariantProps<typeof toggleItemVariants>>({ size: 'md' });

export const ToggleGroup = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> & VariantProps<typeof toggleItemVariants>
>(({ className, size, children, ...props }, ref) => (
  <ToggleGroupPrimitive.Root ref={ref} className={cn('inline-flex items-center gap-0.5 rounded-lg bg-ink/[0.04] p-0.5', className)} {...props}>
    <SizeContext.Provider value={{ size }}>{children}</SizeContext.Provider>
  </ToggleGroupPrimitive.Root>
));
ToggleGroup.displayName = 'ToggleGroup';

export interface ToggleGroupItemProps extends React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>, VariantProps<typeof toggleItemVariants> {
  /** Leave the foil pill out (a host that draws its own, gliding — FilterTabs) */
  bare?: boolean;
}

export const ToggleGroupItem = React.forwardRef<React.ElementRef<typeof ToggleGroupPrimitive.Item>, ToggleGroupItemProps>(
  ({ className, children, size, bare = false, ...props }, ref) => {
    const ctx = React.useContext(SizeContext);
    return (
      <ToggleGroupPrimitive.Item ref={ref} className={cn(toggleItemVariants({ size: size ?? ctx.size }), className)} {...props}>
        {!bare && <span aria-hidden className="pointer-events-none absolute inset-0 hidden rounded-md shadow-sm shadow-black/40 foil-glide foil-pill group-data-[state=on]:block" />}
        <span className="relative z-10 group-data-[state=on]:font-semibold group-data-[state=on]:text-primary-foreground">{children}</span>
      </ToggleGroupPrimitive.Item>
    );
  },
);
ToggleGroupItem.displayName = 'ToggleGroupItem';
