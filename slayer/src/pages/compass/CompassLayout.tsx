/* Compass's shell: one head over the board, the blotter, the tracker and a setup's page. The scan runs on the server
   for everyone (data/compassServer.ts); these pages read its board and record (useThetaBook, data/compassFeed.ts). */

import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Compass as CompassIcon } from 'lucide-react';
import { CompassRouteSkeleton } from '../compassSkeleton';
import TapeRail from '../../components/compass/TapeRail';
import NameDesks from '../../components/compass/NameDesks';
import SessionBook from '../../components/ui/SessionBook';
import { KeepOutlet } from '../../components/layout/DeskKeep';
import { useTicker } from '../../context/MarketDataContext';
import { useCompassView } from '../../data/compassView';
import { parseSetupId, setupIdOf } from '../../data/compass';
import { COMPASS_SET } from '../../data/compassUniverse';
import { useThetaBook } from '../../data/thetaBook';
import { useCompassPings } from '../../data/compassAlerts';
import { nyClock } from '../../core/nyTime';

export const COMPASS_LINE = 'Book A and Book B, 0 to 7 days. Book C is same-day only.';
/** The Tracker's line under the same head. Last page of Compass. */
export const TRACKER_LINE = 'The signals in play, each on its own quotes since the call.';
export const BLOTTER_LINE = 'The official record: every call the scan fired, the quote it fired on, the fill, the exit.';
export const REVIEW_LINE = 'Live. Every contract up 100% or more, on every open book.';
export const STUDY_LINE = 'Every call we took, and the closest we did not.';

const CompassLayout = () => {
  const location = useLocation();
  const line = location.pathname.startsWith('/compass/blotter') ? BLOTTER_LINE : location.pathname.startsWith('/compass/tracker') ? TRACKER_LINE : location.pathname.startsWith('/compass/review') ? REVIEW_LINE : location.pathname.startsWith('/compass/study') ? STUDY_LINE : COMPASS_LINE;
  const onBoard = location.pathname === '/compass' || location.pathname === '/compass/';
  const onContract = /^\/compass\/(?!tracker\/?$|blotter\/?$|review\/?$|study\/?$)[^/]+$/.test(location.pathname);
  return (
    <div className={`flex flex-col min-w-0 xl:flex-1 xl:min-h-0 ${onContract ? 'md:flex-1 md:min-h-0 md:h-full md:overflow-hidden' : ''}`}>
      <header className="flex items-start gap-6 flex-wrap pb-3 border-b border-borderSubtle shrink-0" data-shell data-compass-shell>
        <div className="min-w-0 flex-1">
          <div className="h-6 flex items-center gap-2.5" data-shell-page>
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-borderSubtle text-textSecondary shrink-0" aria-hidden="true">
              <CompassIcon className="w-3.5 h-3.5" />
            </span>
            <h1 className="text-t15 font-semibold leading-tight text-textPrimary">Compass</h1>
          </div>
          <p className="mt-0.5 text-t11 text-textMuted break-words sm:whitespace-nowrap sm:truncate">{line}</p>
        </div>
        <CallPing />
        <SessionBook />
      </header>
      <div className={onBoard ? 'mt-4 grid grid-cols-1 xl:grid-cols-12 gap-4 items-start xl:flex-1 xl:min-h-0 xl:items-stretch' : onContract ? 'mt-3 flex-1 min-h-0 flex flex-col md:overflow-hidden' : 'contents'} data-compass-row={onBoard ? '' : undefined}>
        <div className={onBoard ? 'xl:col-span-8 min-w-0 xl:min-h-0 xl:h-full' : onContract ? 'flex flex-col min-w-0 flex-1 min-h-0 md:overflow-hidden' : 'contents'}>
          <div className={`flex flex-col min-w-0 ${onBoard ? 'xl:h-full xl:min-h-0' : onContract ? 'flex-1 min-h-0 md:overflow-hidden' : 'gap-4 mt-4'}`}>
            <KeepOutlet fallback={<CompassRouteSkeleton pathname={location.pathname} />} />
          </div>
        </div>
        {onBoard && (
          <div className="xl:col-span-4 min-w-0 xl:sticky xl:top-0 xl:self-start xl:h-[calc(100dvh-6.5rem)] xl:max-h-[calc(100dvh-6.5rem)]">
            <div className="flex flex-col gap-3 h-[70vh] min-h-[520px] xl:h-full xl:min-h-0">
              <div className="min-h-0 flex-1 basis-0">
                <CompassTape pathname={location.pathname} />
              </div>
              <div className="min-h-0 flex-1 basis-0 min-w-0 overflow-y-auto">
                <CompassName />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/** A call the reader asked to hear, for a minute after this page heard it. The chime is the desk toast, not a second one. */
const CallPing = () => {
  const pings = useCompassPings();
  const navigate = useNavigate();
  const [, wake] = useState(0);
  const last = pings[0];
  const fresh = last && Date.now() - last.heardAt < 60_000 ? last : null;
  useEffect(() => {
    if (!fresh) return;
    const id = window.setTimeout(() => wake(n => n + 1), 60_000 - (Date.now() - fresh.heardAt));
    return () => window.clearTimeout(id);
  }, [fresh]);
  if (!fresh) return null;
  return (
    <button type="button" onClick={() => navigate(`/compass/${fresh.id}`)} className="slayer-chip normal-case" data-compass-ping={fresh.id}>
      Called {fresh.contract} · {fresh.sleeve} · {nyClock(fresh.at, { zone: true })}
    </button>
  );
};

/** The same tape the scan is reading. Stays mounted across the board and a contract. */
const CompassTape = ({ pathname }: { pathname: string }) => {
  const { activeTicker, changeTicker } = useTicker();
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
        if (live.status === 'loading') return false;
        return live.setups.some(s => s.ticker === hit.ticker && s.right === hit.right && Math.abs(s.strike - hit.strike) < 0.01 && (offered === 'odte' ? s.expiry === '0DTE' : s.expiry !== '0DTE' && s.band !== 'lottery') && (s.band === 'top' || s.band === 'wing' || (s.band === 'lottery' && offered === 'odte')));
      }}
      onOpen={hit => {
        if (!COMPASS_SET.has(hit.ticker)) return;
        if (hit.ticker !== activeTicker) changeTicker(hit.ticker);
        navigate(`/compass/${setupIdOf({ ticker: hit.ticker, strike: hit.strike, right: hit.right, scanner: 'top-setups', sleeve: offered })}`);
      }}
    />
  );
};

const CompassName = () => {
  const { sleeve, selectedId } = useCompassView();
  const offered = sleeve === 'weekly' ? 'weekly' : 'odte';
  const picked = selectedId ? parseSetupId(selectedId) : null;
  if (!picked) {
    return (
      <div className="h-full border border-borderSubtle rounded-md bg-panel flex items-center justify-center px-6" data-compass-name>
        <p className="font-mono text-t11 text-textMuted text-center">Select a name. The other desks and what it passed sit here.</p>
      </div>
    );
  }
  return (
    <div className="h-full min-h-0 overflow-y-auto" data-compass-name>
      <NameDesks ticker={picked.ticker} sleeve={offered} />
    </div>
  );
};

export default CompassLayout;
