/*
  Every page and tool in every room, one line each, each a link into the terminal.
*/

import { useCallback, useId, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { useIsBelowLg } from '../../components/ui/useMediaQuery';
import SlayerMark from '../../brand/SlayerMark';
import PageGlyph, { type GlyphName } from '../../components/ui/PageGlyph';
import { GEX_SUBPAGES } from '../pinpoint/subnav';
import { TRACE_SUBPAGES } from '../trace/subnav';
import { RECORD_SUBPAGES } from '../record/subnav';
import { PRACTICE_SUBPAGES } from '../practice/subnav';

interface Feature {
  title: string;
  says: string;
  /** where it opens in the terminal; none for what lives on every page */
  path?: string;
}

interface Room {
  id: string;
  name: string;
  /** the room's icon; none for "In every room", which wears the house mark */
  glyph?: GlyphName;
  /** the room in a few words — the tour's kind */
  kind: string;
  /** where "Open" takes the whole room */
  path?: string;
  features: Feature[];
}

const fromRegistry = (pages: { path: string; label: string; subtitle: string }[]): Feature[] => pages.map(p => ({ title: p.label, says: p.subtitle, path: p.path }));

/* THE ROOMS, in the tour's order. Pulse's tiles and desks are pages/workspace/registry.tsx's and desks.ts's (not
   imported: they bring every tile's code with them) — fourteen and five, counted there. */
const ROOMS: Room[] = [
  {
    id: 'pulse',
    name: 'Pulse',
    glyph: 'pulse',
    kind: 'The desk',
    path: '/pulse',
    features: [
      { title: 'The desk', says: 'Tiles you add, drag and size. Each holds one thing and one read, on the terminal’s name or a name of its own. It saves as you go.', path: '/pulse' },
      { title: 'Fourteen tiles', says: 'The chart, the book, key levels, targets, where the walls are heading, news, earnings, setups, a chain, your positions and more.', path: '/pulse' },
      { title: 'Five desks to start from', says: 'The session, The open, 0DTE, The close and My book. Or save one of your own.', path: '/pulse' },
    ],
  },
  {
    id: 'compass',
    name: 'Compass',
    glyph: 'compass',
    kind: 'The contracts',
    path: '/compass',
    features: [
      { title: 'The board', says: 'Contracts picked off today’s levels. Every card says where its setup stands, and it updates as price moves.', path: '/compass' },
      { title: 'A setup’s own page', says: 'A card opens on its chart, with the entry, the targets and the floor drawn on it, and why it was chosen beside them.', path: '/compass' },
      { title: 'Tracker', says: 'What you kept, followed to the close.', path: '/compass/tracker' },
    ],
  },
  {
    id: 'terrain',
    name: 'Terrain',
    glyph: 'terrain',
    kind: 'The chart',
    path: '/terrain',
    features: [
      { title: 'One to four charts', says: 'Side by side, each with its own name, timeframe, overlays and indicators.', path: '/terrain' },
      { title: 'The strike rail', says: 'The book beside the chart, strike by strike.', path: '/terrain' },
      { title: 'Levels on the candles', says: 'The walls, the flip and the supreme, with one switch.', path: '/terrain' },
      { title: 'Saved layouts', says: 'Name an arrangement and bring it back with one pick.', path: '/terrain' },
      { title: 'Your own scripts', says: 'Write an indicator in Pine and it draws on the chart.', path: '/terrain' },
      { title: 'Drawing tools', says: 'Lines, levels and notes that stay where you put them.', path: '/terrain' },
    ],
  },
  { id: 'pinpoint', name: 'Pinpoint', glyph: 'pinpoint', kind: 'The book', path: '/pinpoint/map', features: fromRegistry(GEX_SUBPAGES) },
  { id: 'trace', name: 'Trace', glyph: 'trace', kind: 'The tape', path: '/trace/live-tape', features: fromRegistry(TRACE_SUBPAGES) },
  {
    id: 'weigher',
    name: 'The Weigher',
    glyph: 'weigher',
    kind: 'The scale',
    path: '/weigher',
    features: [
      { title: 'The chain', says: 'Every strike and expiry for the name.', path: '/weigher' },
      { title: 'The book at a strike', says: 'What dealers hold at the strike you opened: the gamma, which way it leans, the odds price closes there.', path: '/weigher' },
      { title: 'Positions and a watchlist', says: 'What you hold and what you watch, each row marked from the moment it was added.', path: '/weigher' },
      { title: 'The position card', says: 'What a position would return at every price, on a ruler.', path: '/weigher' },
    ],
  },
  { id: 'dossier', name: 'Dossier', glyph: 'dossier', kind: 'The file on a name', path: '/dossier/news', features: fromRegistry(RECORD_SUBPAGES) },
  { id: 'practice', name: 'Practice', glyph: 'practice', kind: 'Paper trading and backtesting', path: '/practice/paper', features: fromRegistry(PRACTICE_SUBPAGES) },
  {
    id: 'every',
    name: 'In every room',
    kind: 'The small things',
    features: [
      /* Alerts is not listed */
      /* not every page has a guide (Pulse and the Tracker have none), so the line does not say "every" */
      { title: 'How to read', says: 'Look for How to read on a page. It explains what you are looking at in plain English.' },
      { title: 'Saved layouts', says: 'Your layouts, tickers and colours save on their own. The terminal opens the way you left it.' },
      { title: 'Keyboard shortcuts', says: 'There are shortcuts for search, charts, replay and drawing. The full list is in Settings.', path: '/settings/keyboard' },
      { title: 'Light and dark', says: 'Every page works in both. Pick one in Settings, or let it follow your computer.', path: '/settings/appearance' },
    ],
  },
];

/** How many rooms, how many pages and tools in them, and how many things every room shares — the head says them, off the
    list itself */
const OWN = ROOMS.filter(r => r.id !== 'every');
export const ROOM_COUNT = OWN.length;
export const FEATURE_COUNT = OWN.reduce((n, r) => n + r.features.length, 0);
export const SHARED_COUNT = ROOMS.find(r => r.id === 'every')?.features.length ?? 0;

/** "Open the Weigher", not "Open The Weigher" */
const doorName = (name: string) => name.replace(/^The /, 'the ');

/* One terminal, in place of… — what a trader would otherwise keep open beside it, each on the icon of the page
   that does it. Kinds of tool, never anybody's product. */
const IN_PLACE_OF: { glyph: GlyphName; text: string; room: string }[] = [
  { glyph: 'trace', text: 'a flow feed', room: 'trace' },
  { glyph: 'pinpoint', text: 'an exposure map', room: 'pinpoint' },
  { glyph: 'terrain', text: 'a charting subscription', room: 'terrain' },
  { glyph: 'trace', text: 'an options screener', room: 'trace' },
  { glyph: 'paper', text: 'a paper-trading account', room: 'practice' },
  { glyph: 'backtest', text: 'an options backtester', room: 'practice' },
  { glyph: 'journal', text: 'a trading journal', room: 'practice' },
  { glyph: 'dossier', text: 'an earnings calendar', room: 'dossier' },
  { glyph: 'dossier', text: 'an insider and Congress tracker', room: 'dossier' },
];

const RoomIcon = ({ room, size }: { room: Room; size: number }) => (room.glyph ? <PageGlyph name={room.glyph} size={size} className="shrink-0" /> : <SlayerMark size={size} bare label="" />);

const Everything = ({ onOpen }: { onOpen: (path: string) => void }) => {
  const [at, setAt] = useState(0);
  /* the rooms run in a row on a phone and a column from lg — the list says which, for a reader that hears it */
  const sideways = useIsBelowLg();
  const calm = useReducedMotion();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const root = useRef<HTMLDivElement | null>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const room = ROOMS[at];
  const rooms = ROOMS.length;

  /* on a phone the row scrolls sideways: bring the picked room in without moving the page */
  const bringIn = useCallback((i: number) => {
    const el = tabs.current[i];
    const row = el?.parentElement;
    if (el && row && row.scrollWidth > row.clientWidth) row.scrollTo({ left: Math.max(0, el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, []);

  /* a room is a tab: the arrows walk them, Home and End go to the ends */
  const key = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
      let next = at;
      if (step) next = (at + step + rooms) % rooms;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = rooms - 1;
      else return;
      e.preventDefault();
      setAt(next);
      tabs.current[next]?.focus();
      bringIn(next);
    },
    [at, rooms, bringIn]
  );

  /* A chip of "in place of" picks the room that does that job, and brings the list into view if it has left the
     screen */
  const pickRoom = useCallback(
    (id: string) => {
      const i = ROOMS.findIndex(r => r.id === id);
      if (i < 0) return;
      setAt(i);
      bringIn(i);
      const el = root.current;
      if (el && el.getBoundingClientRect().top < 72) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 96, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    },
    [bringIn]
  );

  return (
    <>
      <div ref={root} className="mt-12 lg:mt-14 grid grid-cols-1 lg:grid-cols-12 gap-x-12 xl:gap-x-16" data-landing-everything>
        {/* THE ROOMS */}
        <div
          role="tablist"
          aria-label="Rooms"
          aria-orientation={sideways ? 'horizontal' : 'vertical'}
          className="lg:col-span-4 xl:col-span-3 -mx-4 px-4 sm:mx-0 sm:px-0 flex lg:flex-col gap-5 lg:gap-0 overflow-x-auto lg:overflow-visible [scrollbar-width:none] max-lg:border-b max-lg:border-borderSubtle lg:border-t lg:border-borderSubtle lg:self-start"
        >
          {ROOMS.map((r, i) => {
            const on = i === at;
            return (
              <button
                key={r.id}
                ref={el => {
                  tabs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${uid}-tab-${r.id}`}
                aria-selected={on}
                aria-controls={`${uid}-panel`}
                tabIndex={on ? 0 : -1}
                onClick={() => setAt(i)}
                onKeyDown={key}
                className={`group relative shrink-0 flex items-center gap-2.5 text-left transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-silver
                  max-lg:h-10 max-lg:border-b-2
                  lg:w-full lg:h-11 lg:pl-4 lg:pr-3 lg:border-b lg:border-borderSubtle ${
                    on ? 'max-lg:border-silver text-textPrimary lg:bg-ink/[0.04]' : 'max-lg:border-transparent text-textSecondary hover:text-textPrimary lg:hover:bg-ink/[0.025]'
                  }`}
                data-everything-room={r.id}
              >
                {/* silver is where you are, as in the tour's rows */}
                <span aria-hidden="true" className={`max-lg:hidden absolute left-0 top-2.5 bottom-2.5 w-[2px] rounded-full transition-colors duration-200 ${on ? 'bg-silver' : 'bg-transparent'}`} />
                <RoomIcon room={r} size={16} />
                <span className="min-w-0 flex-1 text-t14 font-medium whitespace-nowrap">{r.name}</span>
                <span className={`max-lg:hidden font-mono text-t11 tnum transition-colors ${on ? 'text-textSecondary' : 'text-textMuted'}`}>{r.features.length}</span>
              </button>
            );
          })}
        </div>

        {/* The picked room's pages — the panel swaps softly: the old one out quickly, the new one in a little
            slower */}
        <div role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${room.id}`} className="lg:col-span-8 xl:col-span-9 mt-8 lg:mt-0 min-h-[420px] lg:min-h-[470px]" data-everything-panel={room.id}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={room.id}
              initial={calm ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] } }}
              exit={calm ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, transition: { duration: 0.14 } }}
            >
              <div className="flex items-end justify-between gap-6 pb-5 border-b border-borderSubtle">
                <div className="min-w-0">
                  <p className="font-mono text-t11 uppercase tracking-[0.22em] text-textMuted">{room.kind}</p>
                  <h3 className="mt-2.5 flex items-center gap-3 text-t26 sm:text-t30 font-light tracking-[-0.03em] leading-tight">
                    <RoomIcon room={room} size={22} />
                    <span>
                      {room.name} <span className="text-textMuted tnum">· {room.features.length}</span>
                    </span>
                  </h3>
                </div>
                {room.path && (
                  <button
                    type="button"
                    onClick={() => onOpen(room.path!)}
                    className="group/door shrink-0 inline-flex items-center gap-2 h-10 pl-4 pr-3.5 rounded-full border border-borderMuted text-t135 font-medium text-textPrimary hover:border-textPrimary/70 hover:bg-ink/[0.06] transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-silver"
                    data-everything-door={room.id}
                  >
                    Open {doorName(room.name)}
                    <ArrowRight className="w-3.5 h-3.5 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/door:translate-x-1 motion-reduce:transition-none motion-reduce:group-hover/door:translate-x-0" aria-hidden="true" />
                  </button>
                )}
              </div>
              {/* two columns on one grid: the cells of a row share its height, so their rules meet */}
              <ul className="grid grid-cols-1 md:grid-cols-2 md:gap-x-10">
                {room.features.map(f => (
                  <li key={f.title} className="border-b border-borderSubtle">
                    {f.path ? (
                      <button
                        type="button"
                        onClick={() => onOpen(f.path!)}
                        className="group relative w-full h-full flex flex-col items-start justify-start text-left py-4 pl-3 -ml-3 pr-9 rounded-sm transition-colors hover:bg-ink/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-silver"
                        data-everything-page={f.path}
                      >
                        <span className="block text-t15 font-medium text-textPrimary">{f.title}</span>
                        <span className="mt-1 block text-t135 leading-snug text-textSecondary">{f.says}</span>
                        <ArrowRight aria-hidden="true" className="absolute right-2 top-[19px] w-3.5 h-3.5 text-textMuted opacity-0 -translate-x-1 transition duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:opacity-100 group-hover:translate-x-0 group-focus-visible:opacity-100 group-focus-visible:translate-x-0 motion-reduce:transition-none" />
                      </button>
                    ) : (
                      <div className="py-4 pr-9">
                        <span className="block text-t15 font-medium text-textPrimary">{f.title}</span>
                        <span className="mt-1 block text-t135 leading-snug text-textSecondary">{f.says}</span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* One terminal, in place of */}
      <div className="mt-12 lg:mt-14 pt-7 border-t border-borderSubtle flex flex-col lg:flex-row lg:items-start gap-x-8 gap-y-4" data-landing-in-place-of>
        <p className="shrink-0 font-mono text-t11 uppercase tracking-[0.22em] text-textMuted lg:pt-[9px]">One terminal, in place of</p>
        <ul className="flex flex-wrap gap-2">
          {IN_PLACE_OF.map(t => (
            <li key={t.text}>
              <button
                type="button"
                onClick={() => pickRoom(t.room)}
                title={`${ROOMS.find(r => r.id === t.room)?.name} does this`}
                className="h-8 pl-2.5 pr-3.5 inline-flex items-center gap-2 rounded-full border border-borderSubtle text-t13 text-textSecondary hover:text-textPrimary hover:border-borderMuted hover:bg-ink/[0.04] transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-silver"
                data-in-place-of={t.room}
              >
                <PageGlyph name={t.glyph} size={13} />
                {t.text}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
};

export default Everything;
