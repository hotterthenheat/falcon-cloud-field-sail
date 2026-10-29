/*
==================================================
  SLAYER TERMINAL - THE START PAGE'S SKELETON
  (pages/start/startSkeleton.tsx)

  The start page standing in as itself while its
  code travels: the head, then the ten cards — a
  picture's box over three lines each. Imports
  nothing heavy; the page reads the grid from here
  so the two never drift.
==================================================
*/

import { Block, Line } from '../../components/ui/skeletonKit';

/* THE CARDS' GRID — two on a phone turned sideways, three beside the rail on a laptop, four at a desk, five on a wide
   screen (ten cards: two rows of five at 1905) */
export const START_GRID = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4';
/* THE PICTURE'S BOX — the still's own shape (the landing's desk stills are 1800 × 1250) */
export const START_PICTURE = 'relative aspect-[1800/1250] bg-canvas overflow-hidden';

export const StartRouteSkeleton = () => (
  <>
    <header className="flex items-start gap-6 flex-wrap pb-3 border-b border-borderSubtle" aria-hidden data-skeleton="start-head">
      <div className="min-w-0 flex-1">
        <div className="h-6 flex items-center gap-2.5">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-borderSubtle shrink-0" />
          <span className="text-t15 font-semibold leading-tight text-textPrimary">Start</span>
          <span className="font-mono text-t9 uppercase tracking-widest text-textMuted">· where to begin</span>
        </div>
        <div className="h-[17px] flex items-center">
          <Line w={420} h={10} />
        </div>
      </div>
    </header>
    <ul className={START_GRID} aria-hidden data-skeleton="start">
      {Array.from({ length: 10 }, (_, i) => (
        <li key={i} className="min-w-0 rounded-lg border border-borderSubtle bg-panel overflow-hidden">
          <div className={START_PICTURE}>
            <Block w="100%" h="100%" className="absolute inset-0 rounded-none" />
          </div>
          <div className="px-3.5 pt-3 pb-3.5 border-t border-borderSubtle/60 flex flex-col gap-2">
            <Line w={44} h={8} />
            <Line w={[72, 84, 68, 80, 92, 88, 84, 64, 86, 76][i]} h={12} />
            <Line w="94%" h={10} />
            <Line w={`${[62, 78, 70, 84, 66, 74, 80, 58, 72, 68][i]}%`} h={10} />
          </div>
        </li>
      ))}
    </ul>
  </>
);
