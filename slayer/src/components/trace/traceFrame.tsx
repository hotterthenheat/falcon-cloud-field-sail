/* The one box every Trace page stands in (title, facts, one line of cards, a plain lead, the body), without the grid:
   a page that wears the box, its facts or its cards line but shows no grid does not load AG Grid (TraceBox.tsx holds
   the grid and re-exports these, so either door works). */

import { useState, type ReactNode } from 'react';
import { useIsPhone } from '../ui/useMediaQuery';
import GuideFocus, { GuideDoor } from '../ui/GuideFocus';
/** The cards line: a wrapping row at a desk, a grid of two equal cells on a phone (Dossier wears it too) */
export const CONTROLS_LINE = 'flex items-center gap-2 flex-wrap max-sm:grid max-sm:grid-cols-2 max-sm:[&>*]:min-w-0 max-sm:[&>*]:w-full max-sm:[&>[data-dropdown]]:justify-between max-sm:[&>[data-span]]:col-span-2 max-sm:[&>[data-span]]:order-first max-sm:[&>[data-cut-doors]]:col-span-2 max-sm:[&>[data-cut-doors]>*]:flex-1 max-sm:[&>[data-cut-doors]>*]:justify-center max-sm:[&>.ml-auto]:col-span-1 max-sm:[&>.ml-auto>*]:w-full max-sm:[&>.ml-auto>*>button]:w-full max-sm:[&>.ml-auto>*>button]:justify-between max-sm:[&>[data-scope]]:col-span-2 max-sm:[&>[data-scope]]:h-auto max-sm:[&>[data-scope]]:min-h-6 max-sm:[&>[data-scope]_[data-scope-pick]]:flex-wrap max-sm:[&>[data-scope]_[data-scope-pick]]:py-1 max-sm:[&>[data-scope]_[data-scope-pick]]:gap-y-1 max-sm:[&>[data-live-hold]]:order-last max-sm:[&>[data-live-hold]]:col-span-2 max-sm:[&>[data-live-hold]>button]:flex-1 max-sm:[&>[data-live-hold]>button]:w-full max-sm:[&>[data-live-hold]>button]:justify-center max-sm:[&>.ml-2]:col-span-2 max-sm:[&>.ml-2]:order-last';

/* ---- the head's facts ------------------------------------------------------------ */

export const Fact = ({ label, children, testId, title, wrap = false }: { label: string; children: ReactNode; testId?: string; title?: string; wrap?: boolean }) => (
  /* `wrap`: a fact that is a sentence takes the line's width */
  <div className={wrap ? 'min-w-0 basis-full' : 'min-w-0'} title={title}>
    <dt className="text-t11 text-textMuted whitespace-nowrap max-sm:whitespace-normal">{label}</dt>
    <dd className={`mt-0.5 font-mono text-t12 tnum text-textPrimary ${wrap ? 'whitespace-normal break-words' : 'whitespace-nowrap max-sm:whitespace-normal max-sm:break-words'}`} data-trace-fact={testId}>
      {children}
    </dd>
  </div>
);

/* 'plain' for a champion with no direction (the busiest name): orange is the sweep's ink.
   Magenta across Trace marks one figure that earned it (a column's top value), never a label: the standout
   champion ('supreme' — the most premium, the largest cross) wears the neutral label, its value carries the weight. */
type Ink = 'supreme' | 'bull' | 'bear' | 'warn' | 'plain';
const INK: Record<Ink, string> = { supreme: 'text-textSecondary', bull: 'text-bull', bear: 'text-bear', warn: 'text-warn', plain: 'text-textSecondary' };

/** A champion: the label in its ink, the row's words as a door onto the row */
export const Champion = ({ label, ink, onOpen, children, testId, title = "Open the contract's card" }: { label: string; ink: Ink; onOpen: () => void; children: ReactNode; testId?: string; title?: string }) => (
  <div className="min-w-0">
    <dt className={`text-t11 whitespace-nowrap max-sm:whitespace-normal ${INK[ink]}`}>{label}</dt>
    <dd className="mt-0.5 whitespace-nowrap max-sm:whitespace-normal" data-trace-champion={testId}>
      {/* the padding is the hit area (24px at a desk, 44px on a phone); the negative margin keeps the line where it was */}
      <button type="button" onClick={onOpen} title={title} className="inline-block py-[3px] -my-[3px] max-sm:py-[13px] max-sm:-my-[13px] font-mono text-t12 tnum font-semibold text-textPrimary hover:text-silver transition-colors text-left max-sm:break-words">
        {children}
      </button>
    </dd>
  </div>
);

/* ---- the box ---------------------------------------------------------------------- */

interface TraceBoxProps {
  title: string;
  sub: ReactNode;
  /** The dl of facts and champions */
  facts: ReactNode;
  /** The one line of cards */
  controls: ReactNode;
  /** With `lead`, what stands above it (the saved cuts); without, the page's line */
  sentence: ReactNode;
  /** One plain line of what happened; the full read (`detail`) waits behind "more" */
  lead?: ReactNode;
  detail?: ReactNode;
  guide?: { title: string; door: string; body: ReactNode; testId: string; open: boolean; onOpen: (v: boolean) => void };
  children: ReactNode;
  testId: string;
  className?: string;
  /** Attributes for the probes */
  data?: Record<string, string | number | undefined>;
  /** On a phone: the cards fold behind one button, the sub hides and the facts wrap two to a line, so every figure
      shows and the first row still stands above the fold */
  foldOnPhone?: boolean;
}

const TraceBox = ({ title, sub, facts, controls, sentence, lead, detail, guide, children, testId, className = '', data, foldOnPhone = false }: TraceBoxProps) => {
  const attrs = Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v]));
  const phone = useIsPhone();
  const [unfolded, setUnfolded] = useState(false);
  const [more, setMore] = useState(false);
  const folded = foldOnPhone && phone && !unfolded;
  const tight = foldOnPhone && phone;
  return (
    /* overflow-clip, not hidden: hidden makes the box a scroll container and a sticky rail would stick to it */
    <div className={`relative border border-borderSubtle rounded-xs overflow-clip bg-panel flex flex-col ${className}`} {...attrs} data-trace-box={testId}>
      {guide && (
        <GuideFocus open={guide.open} onClose={() => guide.onOpen(false)} title={guide.title} testId={guide.testId} viewport>
          {guide.body}
        </GuideFocus>
      )}
      <div className={`px-5 flex items-start flex-wrap ${tight ? 'pt-3 pb-2 gap-2' : 'pt-4 pb-3 gap-6'}`}>
        {/* the title keeps a floor so the facts wrap under it rather than squeeze it */}
        <div className="min-w-[min(18rem,100%)] flex-1">
          <div className="h-6 flex items-center gap-3">
            <h3 className="text-t15 font-semibold leading-tight text-textPrimary whitespace-nowrap">{title}</h3>
            {guide && <GuideDoor open={guide.open} onClick={() => guide.onOpen(!guide.open)} title={guide.door} testId={guide.testId} />}
          </div>
          {!tight && <p className="mt-0.5 text-t11 text-textMuted break-words sm:whitespace-nowrap sm:truncate">{sub}</p>}
        </div>
        {/* tight: two to a line, every figure whole — nothing runs off the right edge */}
        <dl className={tight ? 'w-full grid grid-cols-2 gap-x-4 gap-y-3' : 'flex flex-wrap gap-x-6 gap-y-2'} data-trace-facts>
          {facts}
        </dl>
      </div>
      {controls != null && controls !== false && foldOnPhone && phone && (
        <div className="px-5 pb-2">
          <button
            type="button"
            onClick={() => setUnfolded(v => !v)}
            aria-expanded={!folded}
            className="w-full h-8 rounded-md border border-borderSubtle bg-chip font-mono text-t11 uppercase tracking-widest text-textSecondary hover:text-textPrimary"
            data-trace-fold
          >
            {folded ? 'Filters & cards ▾' : 'Hide filters ▴'}
          </button>
        </div>
      )}
      {controls != null && controls !== false && !folded && (
        <div className={`px-5 pb-2 ${CONTROLS_LINE}`} data-trace-controls>
          {controls}
        </div>
      )}
      {/* a div, not a p: the saved cuts' chips stand inside the sentence */}
      {lead != null ? (
        <div className={`px-5 text-t12 leading-relaxed text-textSecondary ${tight ? 'pb-2' : 'pb-3'}`} data-trace-sentence>
          {sentence}
          <p className="text-t13 leading-snug text-textPrimary" data-trace-lead>
            {lead}
            {detail != null && detail !== false && (
              <>
                {' '}
                <button type="button" onClick={() => setMore(v => !v)} aria-expanded={more} className="inline-block px-1 -mx-1 py-[5px] -my-[5px] max-sm:py-[15px] max-sm:-my-[15px] font-mono text-t11 text-textSecondary underline decoration-dotted underline-offset-2 hover:text-textPrimary" data-trace-more>
                  {more ? 'less' : 'more'}
                </button>
              </>
            )}
          </p>
          {more && detail != null && detail !== false && (
            <div className="mt-1.5" data-trace-detail>
              {detail}
            </div>
          )}
        </div>
      ) : (
        sentence != null &&
        sentence !== false && (
          <div className="px-5 pb-3 text-t12 leading-relaxed text-textSecondary" data-trace-sentence>
            {sentence}
          </div>
        )
      )}
      {children}
    </div>
  );
};

/** A phone's row: who and what on top, the figures that matter under it, so nothing needs a sideways swipe */
export const PhoneRow = ({ lead, title, aside, figures }: { lead?: ReactNode; title: ReactNode; aside?: ReactNode; figures: ReactNode[] }) => (
  <span className="flex flex-col gap-1 py-1.5 w-full leading-none">
    <span className="flex items-center gap-2 min-w-0">
      {lead}
      {/* the title gives way to the time at its right — it clips, never runs under it */}
      <span className="min-w-0 flex-1 overflow-hidden flex items-center gap-1.5 font-mono text-t12 text-textPrimary whitespace-nowrap [&>*:first-child]:shrink-0">{title}</span>
      {aside && <span className="ml-auto shrink-0 font-mono text-t11 tnum text-textSecondary">{aside}</span>}
    </span>
    <span className="flex items-center gap-x-3 gap-y-0.5 flex-wrap font-mono text-t11 tnum text-textSecondary pl-5">
      {figures.map((f, i) => (
        <span key={i} className="whitespace-nowrap">
          {f}
        </span>
      ))}
    </span>
  </span>
);

export default TraceBox;
