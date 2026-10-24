import { Suspense } from 'react';
import { useLocation, useNavigate, useOutlet } from 'react-router-dom';
import { PinpointPageSkeleton } from './pinpointSkeletons';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUpRight, Layers, X } from 'lucide-react';
import { useTicker } from '../../context/MarketDataContext';
import { usePinpointFeed } from '../../data/uwBook';
import { useFocus } from '../../context/FocusContext';
import DropdownSelect, { type DropdownOption } from '../../components/ui/DropdownSelect';
import { AGENDA_LINES, agendaFaceOf } from './Agenda';
import ScrollHome from '../../components/layout/ScrollHome';
import type { DistanceUnit } from '../../data/atr';
import { setDistanceUnit, useDistanceUnit } from '../../data/distanceUnits';
import { LEVELS_OPTIONS, LEVELS_TITLE, setLevelsScope, useLevelsScope } from '../../data/levelsScope';
import { bellDay, todayScopeLabel } from '../../data/bookWindow';
import { GLOSSARY } from '../../components/gex/glossary';

/** The pages whose named levels follow the Levels card */
const LEVELS_PAGES = new Set(['/pinpoint/map', '/pinpoint/agenda', '/pinpoint/board', '/pinpoint/compare']);
import { GEX_SUBPAGES } from './subnav';
import { useReplayLabel } from './replayState';
import SessionBook from '../../components/ui/SessionBook';
import RegimeLine from '../../components/gex/RegimeLine';
import { SayPage } from '../../components/layout/PageMeta';

/*
==================================================
  SLAYER TERMINAL - PINPOINT SHELL (PinpointLayout)

  Band 1 of the roadmap (2026-09-05, the blank
  canvas): ONE HEAD of chrome, and nothing under it
  but the page. Where am I — the page's name and its
  one line — then what the market is doing, read
  the way every box on Pinpoint reads its facts:
  a label over a value.

  THE LOCK WALK (Noah, 2026-09-09: "this header has
  really been bothering me the entire time for the
  whole pinpoint page. doesnt even look like a header
  and the info in it makes me go '???'"): the row of
  loose words — "SHORT GAMMA · flip 494.50 · $1.25
  overhead · crossed 32× · 2h 19m to the close ·
  $ % ATR σ" — became the house head. The page's
  icon and name over its line on the left; on the
  right the same facts LABELLED so each says what it
  is (Dealers · amplifying moves; Flip · 494.50,
  $1.25 above spot; Flip crossed today · 32 times;
  To the close · 2h 19m), and the ruler as a labelled
  card like every other control on Pinpoint. The
  focus chip stays on the title row.

  THE CLOCK IS THE REAL ONE — New York time, the
  same clock the top bar shows — because "to the
  close" is a promise about the exchange, not about
  the simulator's replayed day.

  THE FACTS ARE GONE (Noah, 2026-10-14, with their
  picture: "remove this from the pinpoint top
  section"): Dealers · Flip · Flip crossed today ·
  Market no longer stand in the head — the Map's
  own sentence and the Board say them. The head is
  the page's name and line, the focus chip, and the
  Ruler card.

  WITH THE PARTNER'S MAP (2026-10-14): the LEVELS
  card beside the Ruler (data/levelsScope.ts — the
  walls, the flip and the supreme read off today's
  contracts or every listed date, one choice for the
  whole desk), a REPLAYING tag beside the name while
  the Map's boxes are rewound (replayState.ts — the
  head stays live, and says so), and a slot in the
  head's row (#pinpoint-head-band) the Map draws its
  band into when the row has the room, so a wide
  screen's head is not left empty beside its name.
==================================================
*/

const fmtStrike = (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));

/** The desk's ruler: the unit every distance on Pinpoint is read in */
const RULER_OPTIONS: DropdownOption<DistanceUnit>[] = [
  { value: '$', label: '$', hint: 'Dollars from spot' },
  { value: '%', label: '%', hint: 'Percent of spot' },
  { value: 'ATR', label: 'ATR', hint: 'Average true ranges — the same distance on SPY and on NVDA' },
  { value: 'σ', label: 'σ', hint: 'Expected one-day moves — how many the options price in' },
];

const PinpointLayout = () => {
  const { activeTicker } = useTicker();
  const marketData = usePinpointFeed(activeTicker);
  const { focus, clearFocus } = useFocus();
  /* Alerts are watched by the app shell on every page now (components/alerts/AlertWatcher.tsx, 2026-09-10) */
  const location = useLocation();
  const navigate = useNavigate();
  const outlet = useOutlet();

  /* A kept strike is the one the reader pinned, on whichever name. The distance is the frame's, because that is the spot on hand. */
  const focusTicker = focus?.ticker ?? null;
  const focused = focusTicker ? focus?.price ?? null : null;
  const spot = focusTicker === activeTicker ? marketData?.spot : undefined;
  const dist = focused != null && spot ? ((focused - spot) / spot) * 100 : null;

  /* THE RULER: the unit every distance on Pinpoint is read in */
  const unit = useDistanceUnit();
  /* WHICH CONTRACTS THE LEVELS ARE READ OFF (data/levelsScope.ts): today's alone, or every listed date */
  const levelsScope = useLevelsScope();
  /* THE REPLAY, SAID HERE TOO: the Map's boxes are rewound, the head is not */
  const replaying = useReplayLabel();
  /* Which page this is — its name, its icon and one line, from the registry the sidebar reads */
  const page = GEX_SUBPAGES.find(p => location.pathname.startsWith(p.path)) ?? GEX_SUBPAGES[0];
  const PageIcon = page.icon;
  /* THE AGENDA'S TWO FACES (Noah, 2026-10-14): the line under the name is the face's own; the switch itself stands in
     the first box's head (Agenda.tsx AgendaSwitch), where Noah wanted it */
  /* the session words follow the clock (the eleventh audit's m3: the Board's line said "what expires today" on Saturday) */
  const bell = bellDay();
  const expiresWords = bell.head === 'Expires today' ? 'what expires today' : `what expires ${bell.head.slice('Expires '.length)}, the next session`;
  const line = page.path === '/pinpoint/agenda' ? AGENDA_LINES[agendaFaceOf(location.search)] : page.subtitle.replace('what expires today', expiresWords);

  return (
    <>
      {/* THE HEAD. The page on the left, the ruler on the right; `flex-wrap`
          so a narrow window stacks the two instead of pushing the ruler off
          the edge — at desk width it is one band. */}
      {/* THE FRAME OWNS THE SUBJECT AND THE PAGES (direction B, 2026-09-05): the
          sidebar carries the ticker and the Map · Building · … choice, so this head
          no longer repeats them. It names the page. */}
      <header className="flex items-start gap-6 flex-wrap pb-3 border-b border-borderSubtle" data-shell>
        {/* the title block is its words' width, so the side (the Map's band, the cards) takes the row's room */}
        <div className="min-w-0 flex-none max-w-full" data-shell-title>
          <div className="h-6 flex items-center gap-2.5 flex-wrap" data-shell-page>
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-borderSubtle text-textSecondary shrink-0" aria-hidden="true">
              <PageIcon className="w-3.5 h-3.5" />
            </span>
            <h1 className="text-[15px] font-semibold leading-tight text-textPrimary">
              {page.label}
              {page.path === '/pinpoint/agenda' && agendaFaceOf(location.search) === 'building' && <span className="text-textMuted font-normal"> · Building</span>}
            </h1>
            {focused != null && (
              <span data-focus-chip className="inline-flex items-center gap-2 rounded-md border border-silver/40 bg-silver/[0.06] pl-2.5 pr-1 py-0.5 font-mono">
                <span className="text-[9px] font-bold uppercase tracking-widest text-silver">Focus</span>
                {focusTicker && focusTicker !== activeTicker && <span className="text-[11px] font-semibold text-textPrimary">{focusTicker}</span>}
                <span className="text-[12px] font-semibold tnum text-textPrimary">{fmtStrike(focused)}</span>
                {dist != null && (
                  <span className={`text-[9px] tnum ${dist > 0 ? 'text-bull' : dist < 0 ? 'text-bear' : 'text-textMuted'}`}>
                    {dist > 0 ? '+' : ''}
                    {dist.toFixed(2)}%
                  </span>
                )}
                <button
                  /* the chart is Terrain (2026-09-30: Pulse's chart tile has no fullscreen of its own any more); the way back
                     brings the reader here again (Noah, 2026-09-09) */
                  onClick={() => navigate('/terrain', { state: { chart: { ticker: focusTicker ?? activeTicker, focus: focused }, wayBack: location.pathname } })}
                  title="See this strike on the chart"
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider text-textSecondary hover:text-textPrimary hover:bg-ink/[0.06] transition-colors"
                >
                  Chart <ArrowUpRight className="w-3 h-3" />
                </button>
                <button onClick={clearFocus} aria-label="Let go of the strike" className="p-0.5 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {replaying && (
              <span data-replay-tag className="inline-flex items-center gap-1.5 h-6 rounded-md px-2 font-mono text-[9px] uppercase tracking-widest bg-silver/[0.12] text-silver" title="The boxes below are rewound to this minute; the head is live">
                <span className="font-bold">Replaying</span>
                <span className="text-[11px] tnum text-textPrimary normal-case tracking-normal">{replaying}</span>
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-textMuted sm:whitespace-nowrap sm:truncate" title={[line, /\bbook\b/i.test(line) ? GLOSSARY.book : '', /supreme/i.test(line) ? GLOSSARY.supreme : ''].filter(Boolean).join('\n')}>{line}</p>
        </div>

        {/* THE SIDE: the Map's band where the row has its room (#pinpoint-head-band — the Map measures the room against
            the band's named row and draws it here, else in its own strip under the head), then the two cards */}
        {/* THE SIDE WRAPS UNDER THE TITLE WHEN THE ROW IS SHORT (the device sweep, 2026-10-18): with a basis of 0 it
            never asked for room, so on a phone held sideways, a small laptop or a portrait monitor it was handed 10 to
            165px and the two cards ran off the screen's edge — the only sideways scroll on the site. A floor of the
            cards' own width makes `flex-wrap` carry the side to its own line instead. */}
        <div className="flex-[3_1_0%] min-w-[400px] max-sm:min-w-0 max-sm:basis-full flex items-center gap-x-4 gap-y-2 flex-wrap" data-shell-side>
          <div id="pinpoint-head-band" className="empty:hidden min-w-0 flex-1 [&>[data-ledger-toolbar]]:border-0 [&>[data-ledger-toolbar]]:bg-transparent [&>[data-ledger-toolbar]]:p-0" data-shell-band />
          <div className="ml-auto flex max-w-full min-w-0 flex-wrap items-center justify-end gap-2 max-sm:ml-0 max-sm:w-full max-sm:justify-start max-sm:gap-1.5 [&_:where(button)]:hit" data-shell-cards>
            <SessionBook />
            {/* ONE LEVELS CARD FOR THE WHOLE DESK (the ship pass, 2026-10-22): the Map, the Agenda, the Board and Compare all
                read their supreme, walls, flip and net GEX off the contracts it picks, so one ticker shows one set of
                levels on every page. A page's own Expiry card can still look at other dates, and says so when it does. */}
            {LEVELS_PAGES.has(page.path) && <DropdownSelect label="Levels" icon={Layers} value={levelsScope} options={LEVELS_OPTIONS.map(o => (o.value === '0DTE' && todayScopeLabel() !== 'Today' ? { ...o, label: todayScopeLabel(), hint: "Today's contracts expired at the close — the next session's contracts (the next expiry if none expire then): the next day's walls and flip" } : o))} onChange={setLevelsScope} title={LEVELS_TITLE} testId="levels-scope" align="end" />}
            <DropdownSelect label="Ruler" value={unit} options={RULER_OPTIONS} onChange={setDistanceUnit} title="The unit every distance on Pinpoint is read in" testId="ruler" align="end" />
          </div>
        </div>
      </header>
      {/* PINNED OR TRENDING, IN ONE SENTENCE (the eighth audit's retail finding) — the Levels pages, for the desk's name */}
      {LEVELS_PAGES.has(page.path) && <RegimeLine ticker={activeTicker} />}
      {/* the Agenda's Building face names itself in the tab (the eighth audit: /pinpoint/building read "Agenda") */}
      <SayPage words={page.path === '/pinpoint/agenda' && agendaFaceOf(location.search) === 'building' ? 'Building · Agenda' : null} />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          /* THE DESK OWNS ITS FIRST SCREEN: top bar 56 + the shell's padding
             and its head ≈ 164. Short pages stretch to a full first screen;
             the footer starts below the fold. */
          /* A FINGER'S HIT AREA ON EVERY PINPOINT CONTROL (the ship pass, 2026-10-22, at 390 wide: the window rails, the
             strike doors, the row actions were 12–28px tall). `.hit` (index.css) adds an invisible 44px box on a coarse
             pointer only; nothing a mouse sees changes. */
          className="flex flex-col gap-4 flex-grow min-h-[calc(100vh-174px)] [&_:where(button)]:hit [&_:where(a)]:hit"
        >
          {/* A subpage opens at its head, not where the last one's scroll was (2026-09-11) */}
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
