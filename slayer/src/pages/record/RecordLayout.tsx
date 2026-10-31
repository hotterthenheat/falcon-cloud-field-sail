/* The Dossier's shell: the page's name and one line over it, the source on the right (hidden on a phone). */

import { Suspense } from 'react';
import { useLocation, useOutlet } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { RECORD_SUBPAGES } from './subnav';
import { RecordPageSkeleton } from './recordSkeletons';
import BackToTop from '../../components/ui/BackToTop';
import ScrollHome from '../../components/layout/ScrollHome';
import { useGlideHold } from '../../components/ui/useGlideHold';
import { statHelp } from '../../components/record/statHelp';

/* On a phone every Dossier control is at least 40px each way; map pins, calendar pills and data-touch-skip are not. */
const DOSSIER_TOUCH = `@media (max-width: 640px) {
  [data-dossier-touch] :is(button, a[href], [role="button"]):not([data-touch-skip]):not([data-touch-skip] *):not([data-news-pin]):not([data-cal-pill]):not(svg *):not(.ag-root-wrapper *) {
    min-height: 40px;
    min-width: 40px;
  }
}`;

const RecordLayout = () => {
  const location = useLocation();
  const outlet = useOutlet();
  const page = RECORD_SUBPAGES.find(p => location.pathname.startsWith(p.path)) ?? RECORD_SUBPAGES[0];
  const PageIcon = page.icon;
  /* the column holds its width through the sidebar's glide: one layout at the end, not one per frame */
  const holdRef = useGlideHold<HTMLDivElement>();

  return (
    <>
      <header className="flex items-start gap-6 flex-wrap pb-3 max-sm:pb-2 border-b border-borderSubtle" data-shell data-record-shell={page.label}>
        <div className="min-w-0 flex-1 basis-full sm:basis-0">
          <div className="h-6 flex items-center gap-2.5" data-shell-page>
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-borderSubtle text-textSecondary shrink-0" aria-hidden="true">
              <PageIcon className="w-3.5 h-3.5" />
            </span>
            <h1 className="text-t15 font-semibold leading-tight text-textPrimary">{page.label}</h1>
          </div>
          <p className="mt-0.5 text-t11 text-textMuted max-sm:hidden">{page.subtitle}</p>
        </div>
        <div className="flex items-center gap-x-4 gap-y-2 flex-wrap min-w-0 max-w-full max-sm:hidden">
          <dl className="flex flex-wrap gap-x-6 gap-y-2 min-w-0 max-w-full" data-shell-facts>
          <div className="min-w-0 max-w-full">
            <dt className="text-t10 text-textMuted whitespace-nowrap cursor-help" title={statHelp("Source")}>Source</dt>
            <dd className="mt-0.5 font-mono text-t12 tnum text-textPrimary max-w-full whitespace-normal" data-record-source>
              {page.source}
            </dd>
          </div>
        </dl>
        </div>
      </header>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={location.pathname}
          ref={holdRef}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col gap-4 flex-grow min-h-[calc(100vh-174px)] min-w-0 max-w-full"
          data-dossier-touch
        >
          <style>{DOSSIER_TOUCH}</style>
          {/* a subpage opens at its head, not where the last one's scroll was */}
          <ScrollHome />
          <Suspense fallback={<RecordPageSkeleton pathname={location.pathname} />}>{outlet}</Suspense>
        </motion.div>
      </AnimatePresence>
      {/* the way back to the top once a grid runs past a screen */}
      <BackToTop testId="record" />
    </>
  );
};

export default RecordLayout;
