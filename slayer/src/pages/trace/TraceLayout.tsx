/* Trace's shell: the page's icon, name and one line (the head every area wears — Dossier, Pinpoint) over the subpage,
   which alone cross-fades; the sidebar carries the pages. */

import { Suspense } from 'react';
import { useLocation, useOutlet } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { TracePageSkeleton } from './traceSkeletons';
import { useTicker } from '../../context/MarketDataContext';
import { sessionPhase } from '../../data/traceLive';
import TickerSearch from '../../components/ui/TickerSearch';
import BackToTop from '../../components/ui/BackToTop';
import ScrollHome from '../../components/layout/ScrollHome';
import { useGlideHold } from '../../components/ui/useGlideHold';
import { TraceSessionCard, useTraceSession } from '../../components/trace/traceSession';
import { TRACE_SUBPAGES } from './subnav';

/* The tape, the book pages and the Tracker each carry their own search, so a single-ticker picker would mislead
   there. */
const NO_PICKER = /^\/trace\/(live-tape|dark-pool|screener|net-flow|footprints|watchers|intervals|odte|multi-leg|compare|tracker)/;

/* The Session card shows only on pages whose figures it cuts; the whole-day pages carry no session split. */
const SESSION_PAGES = /^\/trace\/(live-tape|dark-pool|multi-leg|net-flow)/;
/* 0DTE has no session to pick: its contracts expire at the close (16:00 ET for a stock's, 16:15 for index and ETF
   options), so nothing of theirs trades after it. The head says so where the picker would stand. */
const REGULAR_ONLY = /^\/trace\/odte/;

/* The text floor: nothing a reader must read under 11px. Trace's own components carry text-t11 at the least; this lifts
   the shared controls drawn inside the shell (a dropdown's label, the guide's door) to the same floor. */
const TYPE_FLOOR = '[&_.text-t8]:!text-t11 [&_.text-t85]:!text-t11 [&_.text-t9]:!text-t11 [&_.text-t95]:!text-t11 [&_.text-t10]:!text-t11 [&_.text-t105]:!text-t11';

const TraceLayout = () => {
  const { activeTicker, changeTicker } = useTicker();
  const location = useLocation();
  const outlet = useOutlet();
  const active = TRACE_SUBPAGES.find(page => location.pathname.startsWith(page.path)) ?? TRACE_SUBPAGES[0];
  const PageIcon = active.icon;
  /* The viewport-fitted pages (Net Flow, 0DTE): the outlet wrapper absorbs the remaining height for them */
  const bleed = /^\/trace\/(net-flow|odte)/.test(location.pathname);
  const picker = !NO_PICKER.test(location.pathname);
  /* The column holds its width through the sidebar's glide: one layout at the end, not one per frame of every row. */
  const phase = sessionPhase();
  const picked = useTraceSession();
  const onTape = active.path === '/trace/live-tape';
  const shut = phase === 'closed' || phase === 'pre';
  /* the line follows the Session card: a shut tape is the last regular session only when that is what was picked */
  const subtitle = onTape && picked === 'extended'
    ? 'Prints outside the regular session — before the open and after the close, against thin quotes. Shown and labelled, never read as a side.'
    : onTape && shut
      ? 'The last regular session — the newest stretch before the close, not a live stream. Scroll or jump for the rest of the day.'
      : active.subtitle;
  const line = onTape && picked === 'extended'
    ? 'Prints outside the regular session, newest first — shown, not read'
    : onTape && shut
      ? 'The last regular session, newest first — not a live stream'
      : active.line;
  const holdRef = useGlideHold<HTMLDivElement>();

  return (
    <>
      <header className={`flex items-start gap-6 flex-wrap pb-3 max-sm:pb-2 border-b border-borderSubtle ${TYPE_FLOOR}`} data-shell data-trace-shell={active.label}>
        <div className="min-w-0 flex-1 basis-full sm:basis-auto">
          <div className="h-6 flex items-center gap-2.5" data-shell-page>
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-borderSubtle text-textSecondary shrink-0" aria-hidden="true">
              <PageIcon className="w-3.5 h-3.5" />
            </span>
            <h1 className="text-t15 font-semibold leading-tight text-textPrimary">{active.label}</h1>
          </div>
          {/* one short line, as Dossier and Pinpoint carry; the full description is its hover */}
          <p className="mt-0.5 text-t11 text-textMuted sm:whitespace-nowrap sm:truncate max-sm:hidden" title={subtitle} data-shell-line>
            {line}
          </p>
        </div>
        <div className="flex items-center gap-2 max-sm:w-full sm:shrink-0" data-trace-picker>
          {picker && <TickerSearch value={activeTicker} onChange={changeTicker} />}
          {SESSION_PAGES.test(location.pathname) && <TraceSessionCard />}
          {REGULAR_ONLY.test(location.pathname) && (
            <span
              className="inline-flex items-center gap-1.5 h-7 font-mono text-t11 uppercase tracking-widest text-textMuted whitespace-nowrap max-sm:hidden"
              title="Same-day contracts expire at the close — 16:00 ET for a stock’s, 16:15 for index and ETF options — so there is no extended session to pick"
              data-trace-session-fixed
            >
              Session <span className="normal-case tracking-normal text-textSecondary">Regular · expires at the close</span>
            </span>
          )}
        </div>
      </header>
      {/* Opacity is the only thing that moves, so tables never jump on open; the short exit keeps the wait a blink. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={location.pathname}
          ref={holdRef}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          transition={{ duration: 0.14 }}
          className={`flex flex-col gap-2.5 ${TYPE_FLOOR} ${bleed ? 'flex-1 min-h-0' : ''}`}
        >
          {/* A subpage opens at its head, not where the last one's scroll was */}
          <ScrollHome />
          {/* A page's code travels on its first visit; it stands in as ITS OWN
              shape under a head that stays put (traceSkeletons.tsx) */}
          <Suspense fallback={<TracePageSkeleton pathname={location.pathname} />}>{outlet}</Suspense>
        </motion.div>
      </AnimatePresence>
      {/* The page's door home once a grid runs past a screen */}
      <BackToTop testId="trace" />
    </>
  );
};

export default TraceLayout;
