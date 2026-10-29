/*
  Skeleton: a box in the shape of what is coming, with a slow passing light on the house surface.
  Deferred: paints the skeleton first and mounts the real thing a frame or two later, staggered by index, so a route
  opens with every box in place and costly charts arrive one per frame. Changes when a surface first draws, not what.
*/

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
  /** Rounded like a box (default) or like a line of text */
  line?: boolean;
}

/** One shimmering block — size it from the host */
export const Skeleton = ({ className = '', style, line = false }: SkeletonProps) => (
  <div aria-hidden className={`skeleton ${line ? 'rounded' : 'rounded-md'} ${className}`} style={style} />
);

/** A box the shape of a chart: a thin head line, a tall body, a foot line */
export const ChartSkeleton = ({ className = '', style }: SkeletonProps) => (
  <div role="status" aria-label="Chart" className={`flex flex-col gap-2 p-3 ${className}`} style={style} data-skeleton="chart">
    <span className="sr-only">The chart holds this space.</span>
    <div className="flex items-center gap-2">
      <Skeleton className="h-4 w-20" line />
      <Skeleton className="h-4 w-12" line />
      <Skeleton className="h-4 w-12" line />
      <Skeleton className="ml-auto h-4 w-24" line />
    </div>
    <Skeleton className="flex-1 min-h-[120px] w-full" />
    <div className="flex items-center justify-between">
      <Skeleton className="h-3 w-12" line />
      <Skeleton className="h-3 w-12" line />
      <Skeleton className="h-3 w-12" line />
      <Skeleton className="h-3 w-12" line />
    </div>
  </div>
);

/** A box the shape of a table: a head row and a few rows of cells */
export const TableSkeleton = ({ rows = 8, className = '', style }: SkeletonProps & { rows?: number }) => (
  <div aria-hidden className={`flex flex-col gap-1.5 p-3 ${className}`} style={style} data-skeleton="table">
    <div className="flex gap-3 pb-1">
      {[64, 48, 80, 56, 48, 72].map((w, i) => (
        <Skeleton key={i} className="h-3" style={{ width: w }} line />
      ))}
    </div>
    {Array.from({ length: rows }, (_, r) => (
      <div key={r} className="flex gap-3">
        {[64, 48, 80, 56, 48, 72].map((w, i) => (
          <Skeleton key={i} className="h-3.5" style={{ width: w, opacity: 1 - r * 0.08 }} line />
        ))}
      </div>
    ))}
  </div>
);

/** A whole page's first frame: the shell row, a wide box, two boxes under it */
export const PageSkeleton = () => (
  <div className="flex flex-col gap-4 animate-fade-in" data-skeleton="page" aria-busy="true" aria-label="Loading">
    <div className="flex items-center gap-4">
      <Skeleton className="h-5 w-28" line />
      <Skeleton className="h-4 w-64" line />
      <Skeleton className="ml-auto h-6 w-24" />
    </div>
    <div className="border border-borderSubtle rounded-md overflow-hidden" style={{ height: 'min(56vh, 560px)' }}>
      <ChartSkeleton className="h-full" />
    </div>
    <div className="grid grid-cols-2 gap-4">
      <div className="border border-borderSubtle rounded-md h-[240px]">
        <TableSkeleton rows={5} />
      </div>
      <div className="border border-borderSubtle rounded-md h-[240px]">
        <ChartSkeleton className="h-full" />
      </div>
    </div>
  </div>
);

interface DeferredProps {
  children: ReactNode;
  /** What stands in — a skeleton the size of the thing */
  fallback: ReactNode;
  /** Which of its siblings this is: each waits one more frame than the last */
  index?: number;
  /** Extra frames to wait before the first mount */
  frames?: number;
  className?: string;
}

/** Mounts its children a frame or two after first paint — the skeleton holds the box meanwhile */
export const Deferred = ({ children, fallback, index = 0, frames = 1, className }: DeferredProps) => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let raf = 0;
    let n = frames + index;
    const step = () => {
      if (n-- <= 0) {
        setReady(true);
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!ready) return <>{fallback}</>;
  return className ? <div className={className}>{children}</div> : <>{children}</>;
};

export default Skeleton;
