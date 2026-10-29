import * as React from 'react';
import { cn, cva } from './cn';

const alertVariants = cva(
  'group/alert relative grid w-full items-start gap-0.5 rounded-lg border px-2.5 py-2 text-left text-t12 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:mt-0.5 *:[svg]:text-current',
  {
    variants: {
      variant: {
        default: 'border-borderSubtle bg-panel text-textPrimary',
        destructive: 'border-bear/40 bg-panel text-bear',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Alert({ className, variant, ...props }: React.ComponentProps<'div'> & { variant?: 'default' | 'destructive' }) {
  return <div data-slot="alert" role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="alert-title" className={cn('font-medium text-textPrimary group-has-[>svg]/alert:col-start-2', className)} {...props} />;
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn('font-mono text-t11 text-textSecondary group-has-[>svg]/alert:col-start-2', className)}
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="alert-action" className={cn('absolute top-2 right-2', className)} {...props} />;
}

export { Alert, AlertTitle, AlertDescription, AlertAction };
