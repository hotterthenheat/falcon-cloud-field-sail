/* A panel above the tape that folds to one slim line: its title, a summary that fits the line, and a More / Less door.
   The line keeps one height from the first frame, open or folded, so nothing below it moves while the panel reads.
   Each panel's choice is kept per viewer; with none kept, it starts folded so the tape stands high on the screen. */

import { useCallback, useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

const readOpen = (key: string): boolean => {
  try {
    return localStorage.getItem(key) === 'open';
  } catch {
    return false;
  }
};

/** A panel's open state, kept under `key` ('open' or 'folded'); a blocked store keeps it for the visit */
export function useTapeFold(key: string): [boolean, () => void] {
  const [open, setOpen] = useState(() => readOpen(key));
  const toggle = useCallback(() => {
    setOpen(was => {
      const next = !was;
      try {
        localStorage.setItem(key, next ? 'open' : 'folded');
      } catch {
        /* storage blocked — the choice lives for the visit */
      }
      return next;
    });
  }, [key]);
  return [open, toggle];
}

interface TapeFoldProps {
  /** The title as a desk reads it, and a shorter one for a phone */
  title: string;
  shortTitle?: string;
  /** One line: it truncates, its whole words in `summaryTitle` */
  summary: ReactNode;
  summaryTitle?: string;
  open: boolean;
  onToggle: () => void;
  /** What the panel names, for the door's label ("the whole day") */
  noun: string;
  children: ReactNode;
  /** The panel's own data attribute (data-tape-day, data-flow-structures) */
  testId: string;
}

const TapeFold = ({ title, shortTitle, summary, summaryTitle, open, onToggle, noun, children, testId }: TapeFoldProps) => {
  const bodyId = useId();
  return (
    <div className="px-5 border-t border-borderSubtle" {...{ [`data-${testId}`]: '' }} data-panel={testId} data-open={open || undefined}>
      {/* one height from the first frame, folded or open */}
      <div className="flex h-10 max-sm:h-11 items-center gap-2 min-w-0" data-panel-line>
        <span className="shrink-0 font-mono text-t11 uppercase tracking-widest text-textPrimary">
          {shortTitle ? (
            <>
              <span className="sm:hidden">{shortTitle}</span>
              <span className="max-sm:hidden">{title}</span>
            </>
          ) : (
            title
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-t11 text-textMuted" title={summaryTitle} data-panel-summary>
          {summary}
        </span>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={`${open ? 'Less of' : 'More of'} ${noun}`}
          className="shrink-0 -mr-2 h-full px-2 inline-flex items-center gap-1 font-mono text-t11 uppercase tracking-wider text-textMuted hover:text-textPrimary transition-colors"
          data-panel-toggle
        >
          {open ? 'Less' : 'More'}
          <ChevronDown className={`w-3 h-3 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} aria-hidden />
        </button>
      </div>
      {open && (
        <div id={bodyId} className="pb-3">
          {children}
        </div>
      )}
    </div>
  );
};

export default TapeFold;
