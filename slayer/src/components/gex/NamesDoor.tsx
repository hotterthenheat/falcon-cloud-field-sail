/*
==================================================
  SLAYER TERMINAL - THE NAMES DOOR (components/gex/NamesDoor.tsx)

  "+ Names N" — the Map's door, a name picked from
  the whole listing, four at most. Building's since
  2026-10-14, and Targets' since 2026-10-15 (Noah:
  "can we add exp and different tickers to the
  targets page as well?") — one door, so the two
  faces of the Agenda open the same way.
==================================================
*/

import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Plus } from 'lucide-react';
import { CARD } from '../ui/DropdownSelect';
import TickerLookup from '../ui/TickerLookup';
import { MAX_PANES } from '../../data/panes';

const WORDS: Record<number, string> = { 2: 'Two', 3: 'Three', 4: 'Four' };

interface Props {
  /** How many names stand now */
  count: number;
  max?: number;
  onPick: (ticker: string) => void;
  /** What the door says it does, for the pointer */
  title?: string;
  /** The page, for the probes — data-names-door / data-names-menu carry it */
  testId: string;
}

const NamesDoor = ({ count, max = MAX_PANES, onPick, title, testId }: Props) => {
  const [open, setOpen] = useState(false);
  const full = count >= max;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={full}
          title={full ? `${WORDS[max] ?? max} names at most — take one off to add another` : (title ?? 'Show another name beside this one — up to four side by side, each on its own expiry')}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-borderSubtle bg-chip hover:border-borderMuted data-[state=open]:border-silver/50 transition-colors font-mono select-none disabled:opacity-50"
          data-names-door={testId}
        >
          <Plus className="w-3 h-3 text-textMuted" />
          <span className="text-t9 uppercase tracking-widest text-textMuted">Names</span>
          <span className="text-t11 font-semibold text-textPrimary tnum">{count}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className={`${CARD} w-[272px] p-0 overflow-hidden`} data-names-menu={testId}>
          <div className="px-3.5 pt-2.5 pb-1 font-mono text-t9 uppercase tracking-widest text-textMuted">Another name beside these</div>
          <TickerLookup
            onPick={t => {
              onPick(t);
              setOpen(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default NamesDoor;
