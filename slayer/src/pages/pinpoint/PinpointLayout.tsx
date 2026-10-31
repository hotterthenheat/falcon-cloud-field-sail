import { Suspense, useState } from 'react';
import { useLocation, useNavigate, useOutlet } from 'react-router-dom';
import { PinpointPageSkeleton } from './pinpointSkeletons';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUpRight, X } from 'lucide-react';
import { useTicker } from '../../context/MarketDataContext';
import { usePinpointFeed, useResolvedSession } from '../../data/book/feed';
import { useFocus } from '../../context/FocusContext';
import { AGENDA_LINES, agendaFaceOf } from './Agenda';
import ScrollHome from '../../components/layout/ScrollHome';
import { bellDay } from '../../data/bookWindow';
import { GLOSSARY } from '../../components/gex/glossary';
import { GEX_SUBPAGES } from './subnav';
import { useReplayLabel } from './replayState';
import SessionBook from '../../components/ui/SessionBook';
import RegimeLine from '../../components/gex/RegimeLine';
import { SayPage } from '../../components/layout/PageMeta';
import { fmtStrike } from '../../core/format';

/* Pinpoint's shell: one head (the page's icon, name and line, the focus chip, the Ruler and Levels cards, a REPLAYING tag while
   the Map is rewound), and the page under it. The Map draws its band into #pinpoint-head-band when the row has room. */

const NOTE_KEY = 'pinpoint.sessionNoteSeen';

const PinpointLayout = () => {
  const { activeTicker } = useTicker();
  const marketData = usePinpointFeed(activeTicker);
  const sessionRead = useResolvedSession(activeTicker);
  const { focus, clearFocus } = useFocus();
  /* Alerts are watched by the shell on every page (components/alerts/AlertWatcher.tsx). */
  const location = useLocation();
  const navigate = useNavigate();
  const outlet = useOutlet();
  /* the session note is said until the reader hides it; a different note shows again */
  const [noteSeen, setNoteSeen] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(NOTE_KEY);
    } catch {
      return null;
    }
  });
  const seeNote = (note: string | null) => {
    setNoteSeen(note);
    try {
      if (note) sessionStorage.setItem(NOTE_KEY, note);
    } catch {
      /* no storage: hidden for this page */
    }
  };

  /* A kept strike is the one the reader pinned, on whichever name. The distance is the frame's, because that is the spot on hand. */
  const focusTicker = focus?.ticker ?? null;
  const focused = focusTicker ? focus?.price ?? null : null;
  const spot = focusTicker === activeTicker ? marketData?.spot : undefined;
  const dist = focused != null && spot ? ((focused - spot) / spot) * 100 : null;

  /* The replay, said here too: the Map's boxes are rewound, the head is not. */
  const replaying = useReplayLabel();
  /* Which page this is — its name, its icon and one line, from the registry the sidebar reads */
  const page = GEX_SUBPAGES.find(p => location.pathname.startsWith(p.path)) ?? GEX_SUBPAGES[0];
  const PageIcon = page.icon;
  /* The Agenda's line under the name is the face's own; the switch is in the first box's head (Agenda.tsx). */
  /* The session words follow the clock. */
  const bell = bellDay();
  const expiresWords = bell.head === 'Expires today' ? 'what expires today' : `what expires ${bell.head.slice('Expires '.length)}, the next session`;
  const line = page.path === '/pinpoint/agenda' ? AGENDA_LINES[agendaFaceOf(location.search)] : page.subtitle.replace('what expires today', expiresWords);

  return (
    <>
      {/* THE HEAD. The page on the left, the ruler on the right; `flex-wrap`
          so a narrow window stacks the two instead of pushing the ruler off
          the edge — at desk width it is one band. */}
      {/* The rail carries the ticker and the subpages, so this head only names the page. */}
      <header className="flex items-start gap-6 flex-wrap pb-3 border-b border-borderSubtle" data-shell>
        {/* the title block is its words' width, so the side (the Map's band, the cards) takes the row's room */}
        <div className="min-w-0 flex-none max-w-full" data-shell-title>
          <div className="h-6 flex items-center gap-2.5 flex-wrap" data-shell-page>
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-borderSubtle text-textSecondary shrink-0" aria-hidden="true">
              <PageIcon className="w-3.5 h-3.5" />
            </span>
            <h1 className="text-t15 font-semibold leading-tight text-textPrimary">
              {page.label}
              {page.path === '/pinpoint/agenda' && agendaFaceOf(location.search) === 'building' && <span className="text-textMuted font-normal"> · Building</span>}
            </h1>
            {focused != null && (
              <span data-focus-chip className="inline-flex items-center gap-2 rounded-md border border-silver/40 bg-silver/[0.06] pl-2.5 pr-1 py-0.5 font-mono">
                <span className="text-t9 font-bold uppercase tracking-widest text-silver">Focus</span>
                {focusTicker && focusTicker !== activeTicker && <span className="text-t11 font-semibold text-textPrimary">{focusTicker}</span>}
                <span className="text-t12 font-semibold tnum text-textPrimary">{fmtStrike(focused)}</span>
                {dist != null && (
                  <span className={`text-t9 tnum ${dist > 0 ? 'text-bull' : dist < 0 ? 'text-bear' : 'text-textMuted'}`}>
                    {dist > 0 ? '+' : ''}
                    {dist.toFixed(2)}%
                  </span>
                )}
                <button
                  /* The chart is Terrain; the way back returns here. */
                  onClick={() => navigate('/terrain', { state: { chart: { ticker: focusTicker ?? activeTicker, focus: focused }, wayBack: location.pathname } })}
                  title="See this strike on the chart"
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-t9 font-semibold uppercase tracking-wider text-textSecondary hover:text-textPrimary hover:bg-ink/[0.06] transition-colors"
                >
                  Chart <ArrowUpRight className="w-3 h-3" />
                </button>
                <button onClick={clearFocus} aria-label="Let go of the strike" className="p-0.5 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {replaying && (
              <span data-replay-tag className="inline-flex items-center gap-1.5 h-6 rounded-md px-2 font-mono text-t9 uppercase tracking-widest bg-silver/[0.12] text-silver" title="The boxes below are rewound to this minute; the head is live">
                <span className="font-bold">Replaying</span>
                <span className="text-t11 tnum text-textPrimary normal-case tracking-normal">{replaying}</span>
              </span>
            )}
          </div>
          <p className="mt-0.5 text-t11 text-textMuted sm:whitespace-nowrap sm:truncate" title={[line, /\bbook\b/i.test(line) ? GLOSSARY.book : '', /supreme/i.test(line) ? GLOSSARY.supreme : ''].filter(Boolean).join('\n')}>{line}</p>
        </div>

        {/* THE SIDE: the Map's band where the row has its room (#pinpoint-head-band — the Map measures the room against
            the band's named row and draws it here, else in its own strip under the head), then the two cards */}
        {/* The side wraps under the title when the row is short: a floor of the cards' own width lets flex-wrap move it instead of overflowing. */}
        <div className="flex-[3_1_0%] min-w-0 max-sm:basis-full flex items-center gap-x-4 gap-y-2 flex-wrap" data-shell-side>
          <div id="pinpoint-head-band" className="empty:hidden min-w-0 flex-1 [&>[data-ledger-toolbar]]:border-0 [&>[data-ledger-toolbar]]:bg-transparent [&>[data-ledger-toolbar]]:p-0" data-shell-band />
          <div className="ml-auto flex max-w-full min-w-0 flex-wrap items-center justify-end gap-2 max-sm:ml-0 max-sm:w-full max-sm:justify-start max-sm:gap-1.5 [&_:where(button)]:hit" data-shell-cards>
            <SessionBook />
          </div>
        </div>
      </header>
      {sessionRead.note && noteSeen !== sessionRead.note && (
        <p className="mt-2 flex items-center gap-2 font-mono text-t10 text-textMuted" data-session-note>
          <span className="min-w-0">{sessionRead.note}</span>
          <button type="button" onClick={() => seeNote(sessionRead.note)} className="hit-24 shrink-0 inline-flex items-center rounded p-0.5 hover:text-textPrimary hover:bg-ink/[0.06] transition-colors" aria-label="Hide this note" title="Hide this note">
            <X className="w-3 h-3" />
          </button>
        </p>
      )}
      {/* the Board stamps its own rows once; the strip's stamp would be a second "as of" over it */}
      <RegimeLine ticker={activeTicker} stamp={!location.pathname.startsWith('/pinpoint/board')} />
      {/* The Agenda's Building face names itself in the tab. */}
      <SayPage words={page.path === '/pinpoint/agenda' && agendaFaceOf(location.search) === 'building' ? 'Building · Agenda' : null} />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          /* The desk owns its first screen (top bar 56 + the head ≈ 164); short pages stretch, the footer starts below the fold. */
          /* A finger's hit area on every control: `.hit` (index.css) adds an invisible 44 px box on a coarse pointer only. */
          className="flex flex-col gap-4 flex-grow min-h-[calc(100vh-174px)] [&_:where(button)]:hit [&_:where(a)]:hit"
        >
          {/* A subpage opens at its head. */}
          <ScrollHome />
          {/* A page's code travels on its first visit; it stands in as ITS OWN
              shape under a shell head that stays put (pinpointSkeletons.tsx) */}
          <Suspense fallback={<PinpointPageSkeleton pathname={location.pathname} />}>{outlet}</Suspense>
        </motion.div>
      </AnimatePresence>
    </>
  );
};

export default PinpointLayout;
