/* Practice: trading with pretend money. Paper trades today's live ThetaData quotes, Backtest replays ThetaData's
   recorded ones, and the Journal holds every trade of either — two books, never mixed. The head says where each page's
   prices come from, and whether the terminal is answering. */

import { useLocation } from 'react-router-dom';
import { PRACTICE_SUBPAGES } from './subnav';
import { PracticePageSkeleton } from './practiceSkeletons';
import BackToTop from '../../components/ui/BackToTop';
import ScrollHome from '../../components/layout/ScrollHome';
import { KeepOutlet } from '../../components/layout/DeskKeep';
import { useGlideHold } from '../../components/ui/useGlideHold';
import { useSyncExternalStore } from 'react';
import { feedOffline, feedRev, subscribeFeed } from '../../data/paper/thetaFeed';
import { historyOffline, historyRev, subscribeHistory } from '../../data/review/history';

const Fact = ({ label, children, testId, title, className = '', wrap = false }: { label: string; children: React.ReactNode; testId?: string; title?: string; className?: string; wrap?: boolean }) => (
  <div className={`min-w-0 ${className}`}>
    <dt className="text-t10 text-textMuted whitespace-nowrap">{label}</dt>
    <dd className={`mt-0.5 font-mono text-t12 tnum text-textPrimary ${wrap ? 'whitespace-normal' : 'whitespace-nowrap'}`} data-practice-fact={testId} title={title}>
      {children}
    </dd>
  </div>
);

const PracticeLayout = () => {
  const location = useLocation();
  const page = PRACTICE_SUBPAGES.find(p => location.pathname.startsWith(p.path)) ?? PRACTICE_SUBPAGES[0];
  const PageIcon = page.icon;
  const holdRef = useGlideHold<HTMLDivElement>();
  const which = page.path.endsWith('/paper') ? 'paper' : page.path.endsWith('/backtest') ? 'backtest' : 'journal';
  useSyncExternalStore(subscribeFeed, feedRev, feedRev);
  useSyncExternalStore(subscribeHistory, historyRev, historyRev);
  const away = which === 'paper' ? feedOffline() : which === 'backtest' ? historyOffline() : 0;

  return (
    <>
      <header className="flex items-start gap-6 flex-wrap pb-3 border-b border-borderSubtle" data-shell data-practice-shell={page.label}>
        <div className="min-w-0 flex-1">
          <div className="h-6 flex items-center gap-2.5" data-shell-page>
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-borderSubtle text-textSecondary shrink-0" aria-hidden="true">
              <PageIcon className="w-3.5 h-3.5" />
            </span>
            <h1 className="text-t15 font-semibold leading-tight text-textPrimary">{page.label}</h1>
          </div>
          <p className="mt-0.5 text-t11 text-textMuted whitespace-nowrap truncate">{page.subtitle}</p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2" data-shell-facts>
          {which === 'paper' && (
            <>
              <Fact label="Prices" testId="source" title="Each contract’s live NBBO; orders fill only on a fresh two-sided quote in the options session">
                {away ? <span className="text-warn">Live data offline</span> : 'Live quotes'}
              </Fact>
              <Fact label="Clock">Today · ET</Fact>
            </>
          )}
          {which === 'backtest' && (
            <>
              <Fact label="Prices" testId="source" title="The recorded NBBO, minute by minute: buys at the ask, sells at the bid">
                {away ? <span className="text-warn">Live data offline</span> : 'Recorded quotes'}
              </Fact>
              <Fact label="Clock">A past day · ET</Fact>
            </>
          )}
          {which === 'journal' && (
            <>
              <Fact label="Prices" testId="source" wrap>Paper: live NBBO · Backtest: recorded NBBO</Fact>
              <Fact label="Clock">ET</Fact>
            </>
          )}
          <Fact label="Money" className="max-sm:hidden">Pretend — nothing reaches a broker</Fact>
        </dl>
      </header>
      <div ref={holdRef} className="flex flex-col gap-4 flex-grow min-h-[calc(100vh-174px)]">
          <ScrollHome />
          <KeepOutlet fallback={<PracticePageSkeleton pathname={location.pathname} />} />
      </div>
      <BackToTop testId="practice" />
    </>
  );
};

export default PracticeLayout;
