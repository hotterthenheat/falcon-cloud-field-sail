/*
==================================================
  SLAYER TERMINAL - COMPASS'S SHELL (pages/compass/CompassLayout.tsx)

  One head over the board and a setup's page (the
  walk, 2026-09-11): the page's icon and name over
  its one line — the house shell head, the way
  Trace's and the Record's read. A setup has a
  route of its own now (/compass/<id>) so the
  Tracker's door and the browser's Back work; only
  the body below the head cross-fades.
==================================================
*/

import { Suspense, useMemo } from 'react';
import { useLocation, useNavigate, useOutlet } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Compass as CompassIcon } from 'lucide-react';
import { CompassRouteSkeleton } from '../compassSkeleton';
import ScrollHome from '../../components/layout/ScrollHome';
import TapeRail from '../../components/compass/TapeRail';
import SessionBook from '../../components/ui/SessionBook';
import { useMarketData } from '../../context/MarketDataContext';
import { useCompassView } from '../../data/compassView';
import { parseSetupId, setupIdOf } from '../../data/compass';
import { COMPASS_SET } from '../../data/compassUniverse';
import { liveSetup, useThetaBook } from '../../data/thetaBook';

/* "graded and ranked" until 2026-09-19: we do not say we grade, anywhere a reader can see (Noah: "reword graded"; memory: no-public-grades) */
export const COMPASS_LINE = 'Calls and puts. 0DTE and 1–7 DTE.';
/** The Tracker's line under the same head. Last page of Compass. */
export const TRACKER_LINE = 'The contracts you keep. A row opens one.';
/** Blotter — every fill the desk recorded. Sits before the Tracker. */
export const BLOTTER_LINE = 'Every trade recorded, newest first — exit against what was paid';

const CompassLayout = () => {
  const location = useLocation();
  const outlet = useOutlet();
  const line = location.pathname.startsWith('/compass/blotter') ? BLOTTER_LINE : location.pathname.startsWith('/compass/tracker') ? TRACKER_LINE : COMPASS_LINE;
  const onBoard = location.pathname === '/compass' || location.pathname === '/compass/';
  const page = (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={location.pathname} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.08 } }} transition={{ duration: 0.14 }} className="flex flex-col gap-4 min-w-0">
        <ScrollHome />
        <Suspense fallback={<CompassRouteSkeleton pathname={location.pathname} />}>{outlet}</Suspense>
      </motion.div>
    </AnimatePresence>
  );
  return (
    <>
      <header className="flex items-start gap-6 flex-wrap pb-3 border-b border-borderSubtle" data-shell data-compass-shell>
        <div className="min-w-0 flex-1">
          <div className="h-6 flex items-center gap-2.5" data-shell-page>
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-borderSubtle text-textSecondary shrink-0" aria-hidden="true">
              <CompassIcon className="w-3.5 h-3.5" />
            </span>
            <h1 className="text-[15px] font-semibold leading-tight text-textPrimary">Compass</h1>
          </div>
          <p className="mt-0.5 text-[11px] text-textMuted whitespace-nowrap truncate">{line}</p>
        </div>
        <SessionBook />
      </header>
      {/* The tape is the scan's rail. A contract's page is the contract — the prints stay loaded for the way back. */}
      {onBoard ? (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start" data-compass-row>
          <div className="xl:col-span-8 min-w-0">{page}</div>
          <div className="xl:col-span-4 min-w-0 xl:sticky xl:top-4 xl:h-[calc(100vh-6rem)] xl:min-h-[480px]">
            <CompassTape pathname={location.pathname} />
          </div>
        </div>
      ) : (
        page
      )}
    </>
  );
};

/** The same tape the scan is reading. Stays mounted across the board and a contract. */
const CompassTape = ({ pathname }: { pathname: string }) => {
  const { activeTicker, changeTicker } = useMarketData();
  const { sleeve, selectedId } = useCompassView();
  const navigate = useNavigate();
  const offered = sleeve === 'weekly' ? 'weekly' : 'odte';
  const live = useThetaBook(offered);
  const focus = useMemo(() => {
    const fromPath = pathname.startsWith('/compass/') ? parseSetupId(decodeURIComponent(pathname.slice('/compass/'.length))) : null;
    const fromBoard = selectedId ? parseSetupId(selectedId) : null;
    const a = fromPath ?? fromBoard;
    return a ? { ticker: a.ticker, strike: a.strike, right: a.right } : null;
  }, [pathname, selectedId]);
  return (
    <TapeRail
      sleeve={offered}
      focus={focus}
      canOpen={hit => {
        const id = setupIdOf({ ticker: hit.ticker, strike: hit.strike, right: hit.right, scanner: 'top-setups', sleeve: offered });
        return live.setups.some(s => s.id === id) || liveSetup(id) != null;
      }}
      onOpen={hit => {
        if (!COMPASS_SET.has(hit.ticker)) return;
        if (hit.ticker !== activeTicker) changeTicker(hit.ticker);
        navigate(`/compass/${setupIdOf({ ticker: hit.ticker, strike: hit.strike, right: hit.right, scanner: 'top-setups', sleeve: offered })}`);
      }}
    />
  );
};

export default CompassLayout;
