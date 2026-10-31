/* "OPENING" beside a row's Vol/OI when the day's volume says new positions were opened (data/traceRows.ts
   likelyOpeningOf): a flag beside the row, never one of its classifications. Nothing when it cannot be told. */

import { likelyOpeningOf } from '../../data/traceRows';

const TIP =
  'Likely opening: the day traded more contracts than stood open at the start, so at least the difference was opened — or the next count rose by half the day’s volume or more';

/** `flag` when the row already carries one (the book's rows, paired with the next count); otherwise read off volume and OI */
const OpeningTag = ({ flag, volume, oi }: { flag?: boolean | null; volume: number; oi: number }) => {
  const opening = flag !== undefined ? flag : likelyOpeningOf({ volume, oi });
  if (opening !== true) return null;
  return (
    <span className="ml-1 inline-flex items-center h-[14px] px-1 rounded-[3px] border border-borderSubtle font-mono text-t75 font-bold uppercase tracking-[0.12em] leading-none text-textSecondary align-middle" title={TIP} data-likely-opening>
      opening
    </span>
  );
};

export default OpeningTag;
