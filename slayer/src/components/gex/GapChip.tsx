/* A chart's "not in yet" notes as one small chip — the first note, and how many more, the full lines on hover. It sits
   in a corner chip row (Terrain's, beside the field key) or the plot's top-right corner, never across the candles. */

import { memo } from 'react';

/** How long a note must stand before it shows: a feed that lands inside this never says it is late. */
export const GAP_GRACE_MS = 3000;

function GapChip({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  const [first, ...rest] = lines;
  return (
    <span
      className="inline-flex min-w-0 max-w-full items-center gap-1 whitespace-nowrap rounded-md border border-ink/[0.08] bg-canvas/80 px-1.5 py-0.5 font-mono text-t9 text-textMuted select-none"
      title={lines.join('\n')}
      role="status"
      data-gap-chip
    >
      <span aria-hidden className="inline-block h-1 w-1 shrink-0 rounded-full bg-warn/70" />
      <span className="min-w-0 truncate">{first}</span>
      {rest.length > 0 && <span className="shrink-0 tnum text-textSecondary">+{rest.length}</span>}
    </span>
  );
}

export default memo(GapChip);
