/* shadcn's Tabs (Radix) as the house's child tab tier (ui/CardTabs.tsx): mono tracked capitals, the rest ink on the
   tabs at rest, the current one in the text ink over a hairline (thicker on paper: --tab-rule). Radix brings the
   tablist and tab roles, aria-selected, and the arrows, Home and End along the strip (a tab is chosen as it is reached). */

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from './utils';

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<React.ElementRef<typeof TabsPrimitive.List>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(
  ({ className, ...props }, ref) => <TabsPrimitive.List ref={ref} className={cn('inline-flex flex-wrap items-center gap-4', className)} {...props} />,
);
TabsList.displayName = 'TabsList';

export const TabsTrigger = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>>(
  ({ className, ...props }, ref) => (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'hit-24 relative py-1 font-mono text-t10 uppercase tracking-widest text-tabRest transition-colors hover:text-textPrimary disabled:cursor-not-allowed disabled:opacity-50',
        'after:absolute after:inset-x-0 after:bottom-0 after:h-[var(--tab-rule)] data-[state=active]:text-textPrimary data-[state=active]:after:bg-textPrimary',
        className,
      )}
      {...props}
    />
  ),
);
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Content>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>>(
  ({ className, ...props }, ref) => <TabsPrimitive.Content ref={ref} className={cn('focus-visible:outline-none', className)} {...props} />,
);
TabsContent.displayName = 'TabsContent';
