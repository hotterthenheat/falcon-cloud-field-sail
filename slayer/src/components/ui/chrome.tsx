import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { cva, cn } from './cn';

/**
 * The only chrome the desks use. Variants sit on the token file
 * (theme/tokens.css, tailwind.config.ts). Bull and bear are data.
 * Silver is selection. No raw hex, no arbitrary type size, no gradient.
 */

const button = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors duration-200 ease-out disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-borderFocus motion-reduce:transition-none',
  {
    variants: {
      tone: {
        quiet: 'border-borderSubtle bg-transparent text-textPrimary hover:bg-ink/5',
        solid: 'border-silver bg-silverFill text-night hover:bg-silver/90',
        ghost: 'border-transparent bg-transparent text-textSecondary hover:bg-ink/5 hover:text-textPrimary',
      },
      size: {
        sm: 'h-8 px-2.5 text-meta',
        md: 'h-9 px-3 text-ui',
      },
    },
    defaultVariants: { tone: 'quiet', size: 'md' },
  },
);

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'quiet' | 'solid' | 'ghost'; size?: 'sm' | 'md' }>(
  function Button({ className, tone, size, type = 'button', ...rest }, ref) {
    return <button ref={ref} type={type} className={cn(button({ tone, size }), className)} {...rest} />;
  },
);

const card = cva('rounded-md border border-borderSubtle bg-panel text-textPrimary', {
  variants: {
    pad: {
      none: '',
      sm: 'p-3',
      md: 'p-4',
    },
  },
  defaultVariants: { pad: 'md' },
});

export function Card({ className, pad, ...rest }: HTMLAttributes<HTMLDivElement> & { pad?: 'none' | 'sm' | 'md' }) {
  return <div className={cn(card({ pad }), className)} {...rest} />;
}

export function Toolbar({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-wrap items-center gap-2 min-h-9', className)} {...rest} />;
}

export function Menu({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button tone="quiet" size="sm">{label}</Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="z-50 min-w-40 rounded-md border border-borderMuted bg-panel p-1 text-ui text-textPrimary shadow-none" sideOffset={4}>
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function MenuItem({ children, onSelect }: { children: ReactNode; onSelect?: () => void }) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center rounded-sm px-2 py-1.5 outline-none data-[highlighted]:bg-ink/5"
    >
      {children}
    </DropdownMenu.Item>
  );
}

/** Loading, empty, error, and stale. The box keeps its footprint. */
export function DeskState({
  kind,
  children,
  className,
}: {
  kind: 'loading' | 'empty' | 'error' | 'stale';
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={cn('flex min-h-16 items-center justify-center px-4 py-6 text-center text-ui text-textMuted', className)} data-desk-state={kind}>
      {children}
    </div>
  );
}
