/* The row's watch star: its own control (a click never opens the row's card), reading the store itself so only the
   stars redraw when a mark flips. */

import { Bookmark } from 'lucide-react';
import { useWatch, type WatchedItem } from '../../context/WatchContext';

const WatchStar = ({
  k,
  make,
  noun = 'contract',
  className = '',
}: {
  /** The item's key — what the store is asked about */
  k: string;
  /** Builds the item on demand, so an unwatched row never allocates one */
  make: () => WatchedItem;
  noun?: 'print' | 'contract' | 'structure';
  className?: string;
}) => {
  const { isWatched, toggle } = useWatch();
  const on = isWatched(k);
  return (
    <button
      type="button"
      onClick={e => {
        e.stopPropagation();
        toggle(make());
      }}
      aria-pressed={on}
      aria-label={on ? `Untrack this ${noun}` : `Track this ${noun}`}
      title={on ? `Tracking this ${noun} — click to untrack` : `Track this ${noun} in the Tracker`}
      className={`shrink-0 transition-colors ${on ? 'text-select' : 'text-textMuted/40 hover:text-textSecondary'} ${className}`}
    >
      <Bookmark className="w-3 h-3" fill={on ? 'currentColor' : 'none'} />
    </button>
  );
};

export default WatchStar;
