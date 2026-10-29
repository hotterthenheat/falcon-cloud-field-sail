/* The shared box states: the "as of 10:42 ET" stamp a kept answer wears, and one loading / empty / error look for every
   box. A box keeps its final size in every state, so nothing shifts when the data lands. */

import type { CSSProperties, ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { ChartSkeleton, Skeleton, TableSkeleton } from './Skeleton';
import { nyClock, nyDay, nyIsoDate } from '../../core/nyTime';

/** "as of 10:42 ET" for today's New York date, "as of Oct 28, 15:59 ET" for an earlier one */
export function asOfText(at: number, prefix = 'as of', now = Date.now()): string {
  const day = nyIsoDate(at) === nyIsoDate(now) ? '' : `${nyDay(at)}, `;
  return `${prefix ? `${prefix} ` : ''}${day}${nyClock(at)} ET`;
}

interface AsOfProps {
  /** The instant the shown answer was taken (ms). Nothing renders while it is null: the data is live. */
  at: number | null | undefined;
  /** The word before the time (default "as of") */
  prefix?: string;
  className?: string;
  /** The hover line; defaults to saying the fresh answer is on its way */
  title?: string;
}

/** The stamp a kept (not live) answer wears until the fresh one lands. */
export const AsOf = ({ at, prefix = 'as of', className = '', title }: AsOfProps) => {
  if (at == null || !(at > 0)) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 font-mono text-t10 uppercase tracking-widest text-warn whitespace-nowrap ${className}`}
      title={title ?? 'Kept from the last visit. The fresh answer replaces it when it lands.'}
      data-as-of={at}
    >
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-warn" />
      {asOfText(at, prefix)}
    </span>
  );
};

type Shape = 'table' | 'chart' | 'block' | 'lines';

interface LoadingBoxProps {
  /** What is coming: a table's rows, a chart's ground, one block, or a few lines of text */
  shape?: Shape;
  /** Rows for 'table', lines for 'lines' */
  rows?: number;
  /** One short line for a screen reader (default "Loading") */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/** A box's loading state: a skeleton the shape of what is coming. Size it from the host. */
export const LoadingBox = ({ shape = 'table', rows = 6, label = 'Loading', className = '', style }: LoadingBoxProps) => (
  <div role="status" aria-busy="true" aria-label={label} className={`relative min-w-0 ${className}`} style={style} data-state="loading">
    {shape === 'table' ? (
      <TableSkeleton rows={rows} className="h-full overflow-hidden" />
    ) : shape === 'chart' ? (
      <ChartSkeleton className="h-full" />
    ) : shape === 'block' ? (
      <Skeleton className="h-full w-full min-h-[48px]" />
    ) : (
      <div className="flex flex-col gap-2 p-3">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-3" line style={{ width: `${92 - ((i * 17) % 40)}%` }} />
        ))}
      </div>
    )}
  </div>
);

interface EmptyBoxProps {
  /** What is missing, in a few words ("No flow alerts today") */
  title: string;
  /** Why, in one line ("The market is closed; the first alerts land after 09:30 ET") */
  reason?: ReactNode;
  /** One way forward (a link or a button) */
  action?: ReactNode;
  /** A one-line row instead of a centred block */
  compact?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** A box with nothing to show, and the reason. */
export const EmptyBox = ({ title, reason, action, compact = false, className = '', style }: EmptyBoxProps) => (
  <div
    role="status"
    className={`${compact ? 'flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left' : 'flex h-full min-h-[96px] flex-col items-center justify-center gap-1.5 px-5 py-6 text-center'} ${className}`}
    style={style}
    data-state="empty"
  >
    <p className="font-mono text-t10 uppercase tracking-widest text-textMuted">{title}</p>
    {reason ? <p className={`text-t12 leading-relaxed text-textSecondary ${compact ? '' : 'max-w-[440px]'}`}>{reason}</p> : null}
    {action ? <div className={compact ? '' : 'mt-1.5'}>{action}</div> : null}
  </div>
);

const RetryButton = ({ onRetry }: { onRetry: () => void }) => (
  <button
    type="button"
    onClick={onRetry}
    className="inline-flex items-center gap-1.5 h-10 sm:h-7 px-3 rounded-md border border-borderMuted text-t12 font-medium text-textPrimary hover:bg-ink/[0.05] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-borderFocus"
    data-state-retry
  >
    <RotateCcw className="w-3.5 h-3.5" aria-hidden /> Retry
  </button>
);

interface ErrorBoxProps {
  /** What failed, in a few words ("The flow did not load") */
  what: string;
  /** One line of why, safe to show (never a vendor sentence or a key) */
  detail?: ReactNode;
  onRetry?: () => void;
  compact?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** A box whose data failed and has nothing kept to show. */
export const ErrorBox = ({ what, detail, onRetry, compact = false, className = '', style }: ErrorBoxProps) => (
  <div
    role="alert"
    className={`${compact ? 'flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left' : 'flex h-full min-h-[96px] flex-col items-center justify-center gap-1.5 px-5 py-6 text-center'} ${className}`}
    style={style}
    data-state="error"
  >
    <p className="font-mono text-t10 uppercase tracking-widest text-warn">{what}</p>
    {detail ? <p className={`text-t12 leading-relaxed text-textSecondary ${compact ? '' : 'max-w-[440px]'}`}>{detail}</p> : null}
    {onRetry ? <div className={compact ? '' : 'mt-1.5'}><RetryButton onRetry={onRetry} /></div> : null}
  </div>
);

interface FailLineProps {
  /** What failed ("The refresh failed", "Flow did not refresh") */
  what?: string;
  /** The instant of the data still on screen */
  at?: number | null;
  onRetry?: () => void;
  className?: string;
}

/** One line over data that is still on screen after a refresh failed: what failed, and how old the data is. */
export const FailLine = ({ what = 'The refresh failed', at, onRetry, className = '' }: FailLineProps) => (
  <div role="status" className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-t11 text-textSecondary ${className}`} data-state="fail-line">
    <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-warn" />
    <span>
      {what}
      {at ? <span className="text-textMuted"> · showing {asOfText(at)}</span> : null}
    </span>
    {onRetry ? (
      <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 min-h-[40px] sm:min-h-0 text-textPrimary underline decoration-borderMuted underline-offset-4 hover:decoration-textPrimary" data-state-retry>
        Retry
      </button>
    ) : null}
  </div>
);

interface BoxStateProps {
  /** Nothing to show yet and a request is out */
  loading?: boolean;
  /** The request failed (with nothing to show) */
  error?: string | null;
  /** The request answered with nothing */
  empty?: boolean;
  /** LoadingBox's shape and rows */
  shape?: Shape;
  rows?: number;
  /** EmptyBox's words */
  emptyTitle?: string;
  emptyReason?: ReactNode;
  /** ErrorBox's words; `error` is used as the detail when it is a plain line */
  errorWhat?: string;
  onRetry?: () => void;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/** Picks the state: children once there is data, else loading, error or empty, in that order. */
export const BoxState = ({ loading, error, empty, shape, rows, emptyTitle = 'Nothing to show', emptyReason, errorWhat = 'This did not load', onRetry, className, style, children }: BoxStateProps) => {
  if (!loading && !error && !empty) return <>{children}</>;
  if (error) return <ErrorBox what={errorWhat} detail={error} onRetry={onRetry} className={className} style={style} />;
  if (loading) return <LoadingBox shape={shape} rows={rows} className={className} style={style} />;
  return <EmptyBox title={emptyTitle} reason={emptyReason} className={className} style={style} />;
};
