/* The landing page: the wall of tools, the tour with its window, the tape of names, every room, pricing and
   questions. Every picture is the terminal itself; the recordings run on simulated data and say so. */

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, ChevronDown } from 'lucide-react';
import { BILLING_ON, PLANS, fmtDollars, makeCheckoutAhead, priceOf, type Period, type PlanKey } from '../../data/billing';
import { stripeLoader } from '../../data/stripeLoader';
import AnimatedNumber from '../../components/ui/AnimatedNumber';
import { useAccount } from '../../data/account';
import { useNavigate } from 'react-router-dom';
import { useLaunch } from '../../components/layout/LaunchTransition';
import SiteFooter from '../../components/layout/SiteFooter';
import { Block, GroundProvider, useBlockGround, useGround, type Ground } from './ground';
import { Arrive, DOOR, Eyebrow, LitLines, MAIL, Nav, Pill, TwoTone, Wrap, doorTo, useDoorSeen } from './pieces';
import Tour, { type TourStep } from './Tour';
import Tape from './Tape';
import Wall from './Wall';
import { wallStill } from './films';
import Everything, { FEATURE_COUNT, ROOM_COUNT, SHARED_COUNT } from './Everything';
import PageGlyph, { type GlyphName } from '../../components/ui/PageGlyph';

/** where a letter goes */
/** The plan doors go to Stripe's checkout when billing is on (data/billing.ts: the accounts and the publishable
    key); off, they open the terminal. — the doors say Choose. */
const CHECKOUT_OPEN = BILLING_ON;

/* THE TOUR. Every name, page and row here is a real one — the window opens it as the words arrive. The codes are
   numbered off the order here, so moving a step is moving its block. */
const STEPS: TourStep[] = [
  {
    id: 'pulse',
    glyph: 'pulse',
    code: '01',
    kind: 'The desk',
    name: 'Pulse',
    lead: 'Your own desk of live panels.',
    rest: 'Add them, drag them, link them to one name or let each hold its own. It is kept the way you left it.',
    path: '/pulse',
    sweep: 'deal',
    rows: [
      { title: 'The desk', says: 'The chart, the hedging at every strike and the book across the calendar, side by side.', path: '/pulse' },
      /* the four-chart board left the tour's Pulse rows */
    ],
  },
  {
    id: 'compass',
    glyph: 'compass',
    code: '02',
    kind: 'The contracts',
    name: 'Compass',
    lead: 'Option contracts picked off today’s levels.',
    rest: 'Every card is marked active, watch or fading, and the mark updates as price moves.',
    path: '/compass',
    sweep: 'down',
    rows: [
      { title: 'The board', says: 'What cleared the bar on this sweep.', path: '/compass' },
      /* its picture was held back for an evening: the Tracker's cards printed "Confidence 92%", a score of ours,
         and none goes on a public page. They say the four words now, so the row has its picture again. */
      { title: 'Tracker', says: 'What you kept, followed to the close.', path: '/compass/tracker' },
    ],
  },
  {
    id: 'terrain',
    glyph: 'terrain',
    code: '03',
    kind: 'The chart',
    name: 'Terrain',
    lead: 'Charts, and nothing in the way.',
    rest: 'One to four side by side on one set of controls. The walls, the flip and the supreme go on the candles with one switch.',
    path: '/terrain',
    sweep: 'right',
    rows: [
      { title: 'The strike rail', says: 'The book beside the chart, strike by strike.' },
      { title: 'Your own scripts', says: 'Write an indicator in Pine and it draws on the chart.' },
      { title: 'Drawing tools', says: 'Lines, levels and notes that stay where you put them.' },
    ],
  },
  {
    id: 'pinpoint',
    glyph: 'pinpoint',
    code: '04',
    kind: 'The book',
    name: 'Pinpoint',
    lead: 'The whole book, by strike and by date.',
    rest: 'Where dealer hedging is heaviest, where it flips, and how each level has held today.',
    path: '/pinpoint/map',
    sweep: 'out',
    rows: [
      { title: 'The Map', says: 'Every strike and expiry, as a matrix or as a calendar.', path: '/pinpoint/map' },
      { title: 'Building', says: 'What was added to the book today, strike by strike.', path: '/pinpoint/building' },
      { title: 'Compare', says: 'Two names, side by side on one ruler.', path: '/pinpoint/compare' },
    ],
  },
  {
    id: 'themes',
    kind: 'Light and dark',
    name: 'Two themes',
    lead: 'Light mode too.',
    /* the room stands on the ground the page turned into: a visitor who came in on light is now reading on dark */
    leadFor: { dark: 'Dark mode too.', light: 'Light mode too.' },
    rest: 'Every page in the terminal works in both.',
    path: '/pinpoint/map',
    sweep: 'all',
    turn: true,
    turnSays: { dark: 'Dark for the night session.', light: 'Paper for a bright room.' },
    rows: [
      { title: 'Your choice', says: 'Pick dark or light in Settings, or let it follow your computer.' },
      { title: 'Same colours on every page', says: 'Green is up, red is down, magenta is the biggest strike.' },
    ],
  },
  {
    id: 'trace',
    glyph: 'trace',
    code: '05',
    kind: 'The tape',
    name: 'Trace',
    lead: 'Every print, as it happens.',
    rest: 'Options sweeps and blocks and dark-pool crosses, with the heaviest names and contracts kept at the side.',
    path: '/trace/live-tape',
    sweep: 'down',
    rows: [
      { title: 'Live tape', says: 'The stream, newest first.', path: '/trace/live-tape' },
      { title: 'Net flow', says: 'Calls against puts, through the day.', path: '/trace/net-flow' },
      { title: 'Dark pool', says: 'Off-exchange crosses, largest first.', path: '/trace/dark-pool' },
      { title: 'Screener', says: 'Every contract, filtered your way.', path: '/trace/screener' },
    ],
  },
  {
    id: 'weigher',
    glyph: 'weigher',
    code: '06',
    kind: 'The scale',
    name: 'The Weigher',
    lead: 'Weigh any contract before you take it.',
    rest: 'The chart, the chain and your watchlist on one desk.',
    path: '/weigher',
    sweep: 'right',
    rows: [
      { title: 'The chain', says: 'Every strike and expiry for the name.' },
      { title: 'One list', says: 'The contracts you watch and the positions you hold, together.' },
      { title: 'The position card', says: 'What a position would return at every price, on a ruler.' },
    ],
  },
  {
    id: 'dossier',
    glyph: 'dossier',
    code: '07',
    kind: 'The file on a name',
    name: 'Dossier',
    lead: 'Everything on file about a name.',
    rest: 'The news, the earnings, the filings, and every stock on one screen.',
    path: '/dossier/news',
    sweep: 'out',
    rows: [
      { title: 'News', says: 'The wire, on a map.', path: '/dossier/news' },
      { title: 'Earnings', says: 'The calendar, and a page for each name.', path: '/dossier/earnings' },
      { title: 'Insiders', says: 'Who filed, what, and when.', path: '/dossier/insiders' },
      { title: 'Congress', says: 'Trades disclosed by members of Congress.', path: '/dossier/congress' },
      { title: 'Stocks', says: 'A plain read of any name: strong, good, caution or poor.', path: '/dossier/stocks' },
    ],
  },
  /* PRACTICE, the eighth room. Paper trading leads; until then OPTIONS BACKTESTING led, and it still stands
     second, with FUTURES beside it (the same night: "i also want to have backtesting/paper trading for regular
     futures"). The brand above stays market-wide. */
  {
    id: 'practice',
    glyph: 'practice',
    code: '08',
    kind: 'Paper trading and backtesting',
    name: 'Practice',
    /* the headline leads with paper trading, as the room's first row does */
    lead: 'Paper trade today’s live option quotes.',
    rest: 'A practice account on each contract’s live bid and ask — options off the chain, the same order card and chart as the desk, and nothing reaches a broker. Backtest and futures are paused until real history and a futures feed are wired in. One journal keeps every closed trade.',
    /* paper trading leads the room — its still is the options desk in use, not the start page (the photographer's
       `photo=1` window, embed.ts) */
    path: '/practice/paper',
    sweep: 'deal',
    rows: [
      { title: 'Paper trading, live', says: 'A practice account filled at each contract’s live bid and ask during the options session — the same order card and chain as the desk.', path: '/practice/paper' },
      { title: 'Options, off the live chain', says: 'Pick any listed contract at its live quote. A same-day one loses value while you watch.', path: '/practice/paper' },
      { title: 'Targets and stops that know decay', says: 'Set them on the contract’s price, or pin them to the stock’s. The chart shows where each one sits right now.' },
      { title: 'Your own rules', says: 'How many positions, what a trade may risk, where the day stops. A trade that breaks one is refused.' },
      { title: 'The journal', says: 'Every closed trade on its chart: what it did while you held it, your tags, your words.', path: '/practice/journal' },
    ],
  },
];

/** The rooms on the first screen's wall — the tour's tools, in the tour's order (the turn is not a room) */
const WALL_ROOMS = STEPS.filter(s => s.code).map(s => ({ id: s.id, code: s.code, name: s.name, glyph: s.glyph, path: s.path }));

/** The tour's last words count its tools — "Seven rooms. One terminal." — off the list itself, so they cannot disagree with it */
const ROOMS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'][STEPS.filter(s => s.code).length] ?? String(STEPS.filter(s => s.code).length);

const IT_DOES = [
  'Shows where dealer hedging sits, and redraws it as the day moves',
  'Reads a contract against that and says it in a word: strong, good, caution or poor',
  'Keeps a setup current: active while it holds, watch while it forms, fading when it breaks',
  'Explains every page in plain English',
];
const IT_NEVER = ['Tells you what to buy or sell', 'Places an order. It is not a broker', 'Boils a trade down to one number', 'Gives financial advice'];

/* The prices come from data/billing.ts. A line marked `soon` is sold with the plan but not open yet, and says so:
   Community is one room behind the terminal's "coming soon" wall. Practice is on the second plan. The plans are
   book · DESK · SEAT. */
type Holds = boolean | 'soon';
interface PlanRow {
  /** the line whole — the table's */
  text: string;
  /** the line as a card says it: the name, and what it is */
  card: [string, string];
  glyph?: GlyphName;
  in: Record<PlanKey, Holds>;
}
const PLAN_ROWS: PlanRow[] = [
  { text: 'Pulse, your desk of live panels', card: ['Pulse', 'your desk of live panels'], glyph: 'pulse', in: { book: true, tape: true, desk: true, seat: true } },
  { text: 'Terrain, the levels on the chart', card: ['Terrain', 'the levels on the chart'], glyph: 'terrain', in: { book: true, tape: true, desk: true, seat: true } },
  { text: 'Pinpoint, the book by strike and by date', card: ['Pinpoint', 'the book by strike and by date'], glyph: 'pinpoint', in: { book: true, tape: true, desk: true, seat: true } },
  { text: 'Trace, the tape and the dark pool', card: ['Trace', 'the tape and the dark pool'], glyph: 'trace', in: { book: false, tape: true, desk: true, seat: true } },
  { text: 'Dossier: news, earnings, insiders, Congress, stocks', card: ['Dossier', 'news, earnings, insiders, Congress, stocks'], glyph: 'dossier', in: { book: false, tape: true, desk: true, seat: true } },
  { text: 'Your own scripts on the charts', card: ['Scripts', 'your own, on the charts'], in: { book: false, tape: true, desk: true, seat: true } },
  { text: 'Compass, contracts that fit the levels', card: ['Compass', 'contracts that fit the levels'], glyph: 'compass', in: { book: false, tape: false, desk: true, seat: true } },
  { text: 'The Weigher, for any contract you name', card: ['The Weigher', 'for any contract you name'], glyph: 'weigher', in: { book: false, tape: false, desk: true, seat: true } },
  /* Practice is desk's */
  { text: 'Practice: paper trading, backtesting and the journal', card: ['Practice', 'paper trading, backtesting and the journal'], glyph: 'practice', in: { book: false, tape: false, desk: true, seat: true } },
  { text: "Community, the traders' room", card: ['Community', 'the traders’ room'], glyph: 'community', in: { book: false, tape: false, desk: 'soon', seat: 'soon' } },
  /* The seat's own three lines, kept for the day it returns to the page: { text: 'One payment, nothing recurring',
     card: ['One payment', 'nothing recurring'], in: { book: false, tape: false, desk: false, seat: true } }, {
     text: 'A one-to-one session to set up your desk', card: ['A session', 'one to one, to set up your desk'], in:
     { book: false, tape: false, desk: false, seat: true } }, { text: 'New tools before anyone else', card: ['New
     tools', 'before anyone else'], in: { book: false, tape: false, desk: false, seat: true } }, */
];
/** the plans on the page, in order — what billing SELLS (the Seat is off the page for now) */
const PLAN_ORDER: PlanKey[] = PLANS.map(p => p.key);
/** the plan a card leads with — the one that holds every room */
const FEATURED: PlanKey = 'desk';
/** what a card's list is headed: the plan before it, in a word */
const LIST_HEAD: Record<PlanKey, string> = { book: 'Includes', tape: 'Everything in Book, plus', desk: 'Everything in Tape, plus', seat: 'Everything in Desk, plus' };
/** A card's lines: what this plan adds to the one before it */
const addsOf = (key: PlanKey): PlanRow[] => {
  const before = PLAN_ORDER[PLAN_ORDER.indexOf(key) - 1];
  return PLAN_ROWS.filter(r => r.in[key] && !(before && r.in[before]));
};
/* WHO IT IS FOR — one line a plan, said from the trader's side: what they do, not what we sell */
const PLAN_FOR: Record<PlanKey, string> = {
  book: 'For traders who read the levels and make their own calls.',
  tape: 'For traders who also read the tape and the record.',
  desk: 'For traders who also want contracts picked off the levels, and rooms to practise in.',
  seat: 'For traders who want all of it for good, paid once.',
};
/** the first plan that holds a line — the table's rows stand in three groups by it */
const firstPlanOf = (r: PlanRow): PlanKey => PLAN_ORDER.find(k => r.in[k]) ?? FEATURED;
const PLAN_GROUPS: { key: PlanKey; says: string }[] = [
  { key: 'book', says: 'In every plan' },
  { key: 'tape', says: 'From Tape' },
  { key: 'desk', says: 'From Desk' },
];

const FAQ: { q: string; a: string }[] = [
  { q: 'Are the pictures on this page real?', a: 'Yes. Every picture and every recording is the terminal itself, taken from the real page, not a mock-up. The recordings run a little faster than real time, and the numbers in them are simulated data.' },
  { q: 'Does it tell me what to trade?', a: 'No. It shows where dealer hedging sits, and it reads a contract against that in a plain word: strong, good, caution or poor. What you do with that is yours. It is not a broker and it is not financial advice.' },
  { q: 'Do I need to be an expert?', a: 'No. Every page explains itself in plain English: what a wall is, why the flip matters, what dealers are forced to do at each level.' },
  { q: 'Can I get a refund?', a: 'We do not offer refunds, so please take your time and be sure before you subscribe. You can cancel whenever you like, and you keep your access until the end of the period you paid for. If a charge ever looks wrong, write to info@slayerterminal.com and a person will look into it.' },
];

/* ---- the pieces ---------------------------------------------------------------------------- */

/* The headline is ours. The first one — "Dealers have to hedge. See where." — turned out to sit a breath from a
   competitor's own hero ("Dealers have to hedge… exactly where they'll be forced to"): both were the first line
   anyone would write about this category. So the headline stopped leading with the dealers' obligation. */
const Hero = ({ onLaunch, onPick }: { onLaunch: () => void; onPick: (id: string) => void }) => {
  const ground = useBlockGround();
  return (
    <Wrap className="pt-[92px] sm:pt-[104px] pb-6 sm:pb-10">
      <div className="flex flex-col">
        <div className="order-1">
          <Eyebrow>For traders</Eyebrow>
          <h1 className="mt-5 font-light tracking-[-0.045em] leading-[0.98] text-displaySm [text-wrap:balance]" data-landing-headline>
            Trade what you can{' '}
            <span className="relative inline-block whitespace-nowrap">
              <span className={`inline-block px-[0.07em] -mx-[0.07em] ${ground === 'dark' ? 'holo-text' : 'galaxy-text'}`}>see.</span>
              <span aria-hidden="true" className={`absolute left-0 right-0 bottom-[0.05em] h-[0.13em] rounded-full ${ground === 'dark' ? 'bg-silver/25' : 'galaxy-bar foil-glide [--foil-ink:var(--galaxy-gradient)]'}`} />
            </span>
          </h1>
        </div>
        {/* the paragraph at the left, the door at the right, on one line from `lg` */}
        <div className="order-3 lg:order-2 mt-8 lg:mt-6 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-x-12 gap-y-6">
          <p className="max-w-[35rem] lg:max-w-[52rem] text-t16 sm:text-t17 leading-[1.55] text-textSecondary">
            Most of what moves a price is public, just scattered. Slayer gathers it into one terminal: the prints, the positions, the levels, the filings. Every page explains itself in plain English.
          </p>
          {/* the door alone. A line stood beside it ("No sign-up. It opens on simulated data."). It went from
              every door it stood by. */}
          <div className="shrink-0">
            <Pill href={doorTo()} onClick={onLaunch} testId="hero">
              Launch the terminal
            </Pill>
          </div>
        </div>
        {/* THE WALL. From `lg` it is only as wide as lets both its rows stand on the first screen: 2.88 = the four screens'
            1.44 shape over two rows; 440px is the bar, the words and the margins above it and a breath under it (measured). */}
        <div className="order-2 lg:order-3 mt-7 lg:mt-8 lg:max-w-[max(760px,calc((100svh_-_440px)*2.88_+_36px))]">
          <Wall rooms={WALL_ROOMS} onPick={onPick} />
        </div>
      </div>
    </Wrap>
  );
};

/* The plan's own wall: the eight rooms as small screens, the ones this plan opens LIT with a picture of the real
   page and the rest left as empty outlines. It is the hero's wall again, with a plan's lights on — so a buyer sees
   what the money opens, and what it does not, before reading a line. */
const PlanRooms = ({ planKey, onPick }: { planKey: PlanKey; onPick: (id: string) => void }) => {
  const theme = useBlockGround();
  const lit = (id: string) => PLAN_ROWS.some(r => r.glyph === id && r.in[planKey] === true);
  const n = WALL_ROOMS.filter(r => lit(r.id)).length;
  return (
    <div data-plan-rooms={planKey}>
      <p className="font-mono text-t10 uppercase tracking-[0.2em] text-textMuted">{n === WALL_ROOMS.length ? `All ${n} rooms` : `${n} of the ${WALL_ROOMS.length} rooms`}</p>
      <ul className="mt-3 grid grid-cols-4 gap-x-2 gap-y-2.5">
        {WALL_ROOMS.map(r => {
          const name = r.name.replace(/^The /, '');
          return (
            <li key={r.id} className="min-w-0" data-plan-room={r.id} data-lit={lit(r.id) || undefined}>
              {lit(r.id) ? (
                <button type="button" onClick={() => onPick(r.id)} title={`${r.name} — see it in the tour`} className="group block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-silver rounded-[6px]">
                  <span className="block aspect-[1440/1000] overflow-hidden rounded-[5px] border border-borderMuted bg-canvas transition-[transform,border-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-y-0.5 group-hover:border-textPrimary/40 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
                    <img src={wallStill(r.path, theme)} alt="" aria-hidden="true" loading="lazy" decoding="async" draggable={false} className="w-full h-full object-cover object-left-top select-none" />
                  </span>
                  <span className="mt-1.5 block truncate text-t105 leading-none text-textSecondary group-hover:text-textPrimary transition-colors">{name}</span>
                </button>
              ) : (
                <div aria-label={`${r.name}: not in this plan`}>
                  <span className="block aspect-[1440/1000] rounded-[5px] border border-dashed border-borderMuted/70" />
                  <span className="mt-1.5 block truncate text-t105 leading-none text-textMuted/70">{name}</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

/* The plan's card, redrawn so a buyer can picture what they are buying. What their cards do that ours did not: say
   WHO a plan is for, put the door right under the price, and name each thing with what it does. Read beside
   Linear's ("All Basic features +", a line under each plan's name) and TradingView's (a concrete line a feature). */
const Plan = ({ planKey, period, onChoose, onPick }: { planKey: PlanKey; period: Period; onChoose: (key: PlanKey) => void; onPick: (id: string) => void }) => {
  const plan = PLANS.find(p => p.key === planKey)!;
  const adds = addsOf(planKey);
  const featured = planKey === FEATURED;
  const custom = plan.monthly == null;
  const priced = priceOf(planKey, period);
  /* the first card sits flush with the section's left edge, like the head over it; the LAST keeps its right
     padding — flush right, its wall and its Soon chip touched the edge */
  return (
    <div className={`flex flex-col lg:grid lg:row-span-7 lg:grid-rows-subgrid py-7 lg:py-8 lg:px-8 first:lg:pl-0 ${featured ? 'max-lg:-mx-4 max-lg:px-4 sm:max-lg:-mx-6 sm:max-lg:px-6 bg-ink/[0.025]' : ''}`} data-landing-plan={planKey}>
      <div className="flex items-center gap-2.5">
        <h3 className="text-t19 font-medium tracking-tight">{plan.name}</h3>
        {featured && <span className="h-5 px-2 inline-flex items-center rounded-full bg-textPrimary text-canvas font-mono text-t9 font-bold uppercase tracking-widest">All of it</span>}
      </div>
      <p className="mt-2 max-w-[34ch] text-t14 leading-snug text-textSecondary" data-plan-for>
        {PLAN_FOR[planKey]}
      </p>
      {/* the page's big numbers are its prices — the only figures of ours it shows */}
      {/* the price for the period the toggle is on (the yearly one is ten months); under a yearly price, what it
          is a month. The number rolls from one period's price to the other's — the house's AnimatedNumber; the
          period word crossfades beside it; the month line fades in */}
      <p className="mt-6 flex items-baseline gap-2" data-plan-price={period}>
        <span className="text-t44 sm:text-t52 font-light leading-none tracking-[-0.045em] tnum" data-plan-amount={priced.amount ?? undefined}>
          {priced.amount != null ? <AnimatedNumber value={priced.amount} format={fmtDollars} /> : priced.price}
        </span>
        <span className="font-mono text-t11 text-textMuted">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span key={priced.period} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
              {priced.period}
            </motion.span>
          </AnimatePresence>
        </span>
      </p>
      <p className={`mt-1.5 h-4 font-mono text-t11 tnum text-textMuted transition-opacity duration-300 ${priced.aMonth ? 'opacity-100' : 'opacity-0'}`} aria-hidden={!priced.aMonth}>
        {priced.aMonth ?? ' '}
      </p>
      <div className="mt-5">
        {custom ? (
          <Pill href={`mailto:${MAIL}`} kind="ghost">
            Talk to us
          </Pill>
        ) : (
          <Pill href={CHECKOUT_OPEN ? `/checkout?plan=${planKey}&period=${period}` : doorTo()} onClick={() => onChoose(planKey)} kind={featured ? 'solid' : 'ghost'} testId={`plan-${planKey}`}>
            Choose {plan.name}
          </Pill>
        )}
      </div>
      <div className="mt-8 pt-6 border-t border-borderSubtle">
        <PlanRooms planKey={planKey} onPick={onPick} />
      </div>
      <div className="mt-7">
        <p className="font-mono text-t10 uppercase tracking-[0.2em] text-textMuted">{LIST_HEAD[planKey]}</p>
        <ul className="mt-3 border-t border-borderSubtle">
          {adds.map(r => {
            const soon = r.in[planKey] === 'soon';
            return (
              <li key={r.text} className="py-2.5 border-b border-borderSubtle grid grid-cols-[6.25rem_minmax(0,1fr)_auto] items-baseline gap-x-3 text-t135 leading-snug" data-plan-soon={soon || undefined}>
                <span className="font-medium text-textPrimary">{r.card[0]}</span>
                <span className="text-textSecondary">{r.card[1]}</span>
                {/* an ORANGE CAPSULE: a solid pill, the Map's capsules' shape, in the house's orange — `warn`
                    follows the ground, so it is a visible orange on paper too; the dark word on it is the same on
                    both (4.6:1 on paper, 9:1 on black) */}
                {soon && <span className="self-center h-[20px] px-2 inline-flex items-center rounded-full bg-warn font-mono text-t9 font-bold uppercase tracking-[0.14em] text-onfoil">Soon</span>}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};

/** Every plan, side by side. PLAN_ROWS read whole: a line on each row, a mark under each plan that holds it. Folded
    under its own door, so the prices stay the end of the section for anyone who has seen enough. */
const PlansSideBySide = () => {
  const [open, setOpen] = useState(false);
  const calm = useReducedMotion();
  const wash = (k: PlanKey) => (k === FEATURED ? 'bg-ink/[0.035]' : '');
  /* a reader that hears the table hears the words */
  const mark = (h: Holds) =>
    h === 'soon' ? (
      <span className="h-[20px] px-2 inline-flex items-center rounded-full bg-warn font-mono text-t9 font-bold uppercase tracking-[0.14em] text-onfoil">Soon</span>
    ) : h ? (
      <>
        <Check className="w-4 h-4 text-silver" strokeWidth={2.25} aria-hidden="true" />
        <span className="sr-only">Included</span>
      </>
    ) : (
      <>
        <span className="w-2.5 h-px bg-textMuted/50" aria-hidden="true" />
        <span className="sr-only">Not included</span>
      </>
    );
  return (
    <div className="mt-10" data-landing-side-by-side={open || undefined}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls="landing-plans-table"
        className="inline-flex items-center gap-2 h-10 pl-4 pr-3.5 rounded-full border border-borderMuted text-t135 font-medium text-textPrimary hover:border-textPrimary/70 hover:bg-ink/[0.06] transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-silver"
        data-landing-side-by-side-door
      >
        {open ? 'Fold the plans away' : 'See the plans side by side'}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id="landing-plans-table"
            initial={calm ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={calm ? { opacity: 0, transition: { duration: 0 } } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            {/* all three plans side by side on a phone too: narrow mark columns, and the lines wrap */}
            <table className="mt-7 w-full min-w-[330px] border-collapse text-left">
              <caption className="sr-only">What each plan holds</caption>
              <thead>
                <tr className="border-b border-borderSubtle">
                  <th scope="col" className="py-3.5 pr-3 sm:pr-4 align-bottom font-mono text-t11 font-normal uppercase tracking-[0.22em] text-textMuted">
                    What it holds
                  </th>
                  {PLANS.map(p => (
                    <th key={p.key} scope="col" className={`py-3.5 px-1 sm:px-3 w-[62px] sm:w-[17%] text-center align-bottom rounded-t-lg ${wash(p.key)}`}>
                      <span className="block text-t13 sm:text-t15 font-medium text-textPrimary">{p.name}</span>
                      <span className="block mt-0.5 font-mono text-t10 sm:text-t11 font-normal text-textMuted tnum">
                        {p.price}
                        {p.monthly != null && <span className="max-sm:hidden"> {p.period}</span>}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              {PLAN_GROUPS.map(g => (
                <tbody key={g.key} data-plan-group={g.key}>
                  <tr>
                    <th scope="colgroup" className="pt-5 pb-2 font-mono text-t10 font-normal uppercase tracking-[0.2em] text-textMuted">
                      {g.says}
                    </th>
                    {PLAN_ORDER.map(k => (
                      <td key={k} className={wash(k)} aria-hidden="true" />
                    ))}
                  </tr>
                  {PLAN_ROWS.filter(r => firstPlanOf(r) === g.key).map(r => (
                    <tr key={r.text} className="border-t border-borderSubtle transition-colors hover:bg-ink/[0.025]">
                      <th scope="row" className="py-3 pr-3 sm:pr-4 font-normal">
                        <span className="flex items-center gap-2.5 text-t13 sm:text-t14 leading-snug text-textSecondary">
                          {r.glyph ? <PageGlyph name={r.glyph} size={15} className="shrink-0" /> : <span className="w-[15px] shrink-0" aria-hidden="true" />}
                          {r.text}
                        </span>
                      </th>
                      {PLAN_ORDER.map(k => (
                        <td key={k} className={`py-3 px-1 sm:px-3 text-center ${wash(k)}`}>
                          <span className="inline-flex items-center justify-center align-middle">{mark(r.in[k])}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}
              <tfoot>
                <tr className="border-t border-borderSubtle">
                  <td />
                  {PLAN_ORDER.map(k => (
                    <td key={k} className={`h-3 rounded-b-lg ${wash(k)}`} />
                  ))}
                </tr>
              </tfoot>
            </table>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* ---- the page ------------------------------------------------------------------------------ */

const Page = () => {
  const { a } = useGround();
  const { launch } = useLaunch();
  const [barGround, setBarGround] = useState<Ground>(a);
  /* Is another door in view? The hero's and the closing one are watched; the bar's own door stands only while
     neither is on the screen (under the bar counts as off it) — pieces.tsx */
  const doorSeen = useDoorSeen();
  const open = useCallback((path: string) => launch(path), [launch]);
  /* the door lands on the start page the first time, then on Pulse or the page Settings names (pieces.tsx doorTo) */
  const door = useCallback(() => launch(doorTo()), [launch]);
  /* A plan chosen: billing on → our own checkout page for it (/checkout — Stripe's framed fields inside our
     layout; the card never reaches us), signed out by way of the sign-in page first; billing off → the terminal,
     as the door always did. The period is the toggle's. */
  const [period, setPeriod] = useState<Period>('month');
  const account = useAccount();
  const navigate = useNavigate();
  const choose = useCallback(
    (key: PlanKey) => {
      if (!CHECKOUT_OPEN) return door();
      const checkout = `/checkout?plan=${key}&period=${period}`;
      if (account.status === 'out') return navigate(`/signin?face=up&next=${encodeURIComponent(checkout)}`);
      /* signed in: the session is asked for NOW, and the page takes the answer when it opens */
      if (account.status === 'in') makeCheckoutAhead(key, period);
      navigate(checkout);
    },
    [account.status, period, navigate, door]
  );
  /* Stripe's script, fetched while the reader is still on the prices — the checkout page then mounts its fields
     without waiting for it */
  useEffect(() => {
    if (!CHECKOUT_OPEN) return;
    const el = document.getElementById('pricing');
    if (!el) return;
    const io = new IntersectionObserver(
      entries => {
        if (!entries.some(e => e.isIntersecting)) return;
        void stripeLoader();
        io.disconnect();
      },
      { rootMargin: '600px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  /* A screen of the wall: its room's words in the tour, the window beside them showing it. On a desk the room's
     name stands a third of the way down, beside the window; in one column the window is pinned over the top of the
     screen, so the name stands just under it. */
  const toRoom = useCallback((id: string) => {
    const el = document.querySelector<HTMLElement>(`[data-tour-step="${id}"] [data-tour-head]`);
    if (!el) return;
    const win = document.querySelector<HTMLElement>('[data-tour-window]');
    const oneColumn = !window.matchMedia('(min-width: 1024px)').matches;
    const under = win && oneColumn ? (parseFloat(getComputedStyle(win).top) || 0) + win.offsetHeight + 56 : window.innerHeight * 0.3;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - under, behavior: calm ? 'auto' : 'smooth' });
  }, []);

  /* a footer link from inside the terminal lands on /#pricing or /#faq — go there once the page stands */
  useEffect(() => {
    if (!location.hash) return;
    const t = window.setTimeout(() => document.querySelector(location.hash)?.scrollIntoView({ block: 'start' }), 80);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="relative isolate min-h-screen overflow-x-clip font-sans" data-landing="v3">
      <a href="#tools" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-3 focus:py-2 focus:rounded-md focus:bg-panel focus:text-textPrimary">
        Skip to the tools
      </a>
      <Nav ground={barGround} door={!doorSeen} />

      {/* ── the hero and the tour: one ground — the wall of tools, then each tool beside the window ───────── */}
      <Tour head={<Hero onLaunch={door} onPick={toRoom} />} steps={STEPS} first={DOOR} onOpen={open} onBarGround={setBarGround} endSays={[`${ROOMS} rooms.`, 'One terminal.']} />

      {/* ── the names, and what is paid for ──────────────────────────────────────────────── */}
      {/* "In every room" stood here — four small windows over four lines. The four lines live on as the last room
          of "Everything in it". */}
      <Block on="a" id="more" label="Everything in it, and what you are paying for" className="pt-[2vh] pb-[12vh]">
        {/* THE TAPE: the names the terminal covers, across the whole page, in the room between the tour's last
            words and this block's head */}
        <Tape />
        {/* Everything in it: every page of every room, each a door (Everything.tsx) */}
        <Wrap className="mt-[13vh] scroll-mt-10" >
          <Arrive id="everything" className="flex flex-col lg:flex-row lg:items-end gap-x-16 gap-y-6 scroll-mt-24">
            <div>
              <Eyebrow>Everything in it</Eyebrow>
              <TwoTone className="mt-6" first="Every page, by room." second="Open any of them." />
            </div>
            <p className="arrive-line [--i:2] lg:ml-auto max-w-[30rem] text-t16 leading-relaxed text-textSecondary lg:pb-2" data-everything-count>
              {FEATURE_COUNT} pages and tools in {ROOM_COUNT} rooms, and {SHARED_COUNT} things every room shares. Pick a room to see its pages. Each one opens in the terminal.
            </p>
          </Arrive>
          <Everything onOpen={open} />

          <div className="mt-[12vh] grid grid-cols-1 lg:grid-cols-12 gap-x-16 gap-y-12">
            <Arrive className="lg:col-span-5">
              <Eyebrow>What you are paying for</Eyebrow>
              <TwoTone className="mt-6" first="A read." second="Never an instruction." />
            </Arrive>
            {/* One table, two columns. The two lists stood side by side, each setting its own row heights — a line
                of "It does" that wrapped pushed its rule down, and the rules of the two columns fell out of step. */}
            <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 sm:grid-rows-[repeat(5,auto)] gap-x-12 gap-y-10 sm:gap-y-0" data-landing-does>
              {[
                { head: 'It does', rows: IT_DOES, ink: 'text-textPrimary', headInk: 'text-textPrimary' },
                { head: 'It never', rows: IT_NEVER, ink: 'text-textSecondary', headInk: 'text-textMuted' },
              ].map(col => (
                <div key={col.head} className="sm:row-span-5 sm:grid sm:grid-rows-subgrid">
                  <h3 className={`pb-4 border-b border-borderSubtle font-mono text-t11 uppercase tracking-[0.22em] ${col.headInk}`}>{col.head}</h3>
                  <ul className="sm:row-span-4 sm:grid sm:grid-rows-subgrid">
                    {col.rows.map(t => (
                      <li key={t} className={`py-3.5 border-b border-borderSubtle text-t15 leading-snug ${col.ink}`}>
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </Wrap>
      </Block>

      {/* ── PRICING ──────────────────────────────────────────────────────────────────────── */}
      <Block on="a" id="pricing" label="Pricing" className="py-[12vh] scroll-mt-10">
        <Wrap>
          <Arrive>
          <Eyebrow>Pricing</Eyebrow>
          <div className="mt-6 flex flex-col lg:flex-row lg:items-end gap-x-16 gap-y-6">
            {/* the refund policy left this headline for the Questions, said kindly */}
            <TwoTone first="Pick your plan." second="Cancel any time." />
            <p className="arrive-line [--i:2] lg:ml-auto max-w-[30rem] text-t16 leading-relaxed text-textSecondary lg:pb-2">
              Book is the charts and the book. Tape adds the tape and the record. Desk is everything. Cancel whenever you like and you keep your access until the period you paid for ends.
              {!CHECKOUT_OPEN && ' Payments open at launch.'}
            </p>
          </div>
          </Arrive>
          {/* MONTHLY · YEARLY: one capsule, the period the cards price by; a year is ten months */}
          <div className="mt-8 flex items-center gap-4 flex-wrap" data-landing-period={period}>
            <div role="group" aria-label="Billed" className="inline-flex items-center rounded-full border border-borderMuted p-1">
              {(['month', 'year'] as Period[]).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  aria-pressed={period === p}
                  className={`h-8 px-4 rounded-full text-t13 font-medium transition-colors duration-200 ${period === p ? 'bg-textPrimary text-canvas' : 'text-textSecondary hover:text-textPrimary'}`}
                  data-landing-period-pick={p}
                >
                  {p === 'month' ? 'Monthly' : 'Yearly'}
                </button>
              ))}
            </div>
            <span className="font-mono text-t11 text-textMuted">Yearly: two months free</span>
          </div>
          {/* as many columns as plans on the page — two while the Seat is off it */}
          <div className={`mt-8 grid grid-cols-1 ${PLANS.length >= 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'} lg:grid-rows-[repeat(6,auto)_1fr] border-y border-borderSubtle divide-y lg:divide-y-0 lg:divide-x divide-borderSubtle`}>
            {PLANS.map(p => (
              <Plan key={p.key} planKey={p.key} period={period} onChoose={choose} onPick={toRoom} />
            ))}
          </div>
          <p className="mt-5 font-mono text-t10 uppercase tracking-[0.2em] text-textMuted">Prices in US dollars</p>
          <PlansSideBySide />
        </Wrap>
      </Block>

      {/* ── the questions, the last door, the footer ─────────────────────────────────────── */}
      <Block on="a" id="faq" label="Questions" className="pt-[12vh] scroll-mt-10">
        <Wrap>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-x-16 gap-y-10">
            <Arrive className="lg:col-span-5 lg:sticky lg:top-28 lg:self-start">
              <Eyebrow>Questions</Eyebrow>
              <TwoTone className="mt-6" first="Asked" second="before you buy." />
              {/* anything else goes to a person. "How do I reach you?" left the list: the address stands here as a
                  door, with the same words. */}
              <div className="arrive-line [--i:2] mt-8 flex flex-wrap items-center gap-x-4 gap-y-2.5" data-landing-write>
                <Pill href={`mailto:${MAIL}`} kind="ghost" size="sm" testId="write">
                  {MAIL}
                </Pill>
                <span className="text-t13 text-textMuted">Anything else, ask. A person reads it.</span>
              </div>
            </Arrive>
            <dl className="lg:col-span-7 border-t border-borderSubtle">
              {FAQ.map(f => (
                <div key={f.q} className="py-7 border-b border-borderSubtle" data-landing-faq>
                  <dt className="text-t19 font-medium tracking-tight">{f.q}</dt>
                  <dd className="mt-2.5 max-w-[62ch] text-t155 leading-relaxed text-textSecondary">{f.a}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="py-[18vh] text-center">
            {/* The rooms, once more: the eight icons in a row over the last line, each a door into its room —
                small, as everywhere on this page */}
            <ul className="mb-10 flex flex-wrap justify-center gap-x-5 gap-y-3 sm:gap-x-6" aria-label="The rooms" data-landing-close-rooms>
              {WALL_ROOMS.map(r => (
                <li key={r.id}>
                  <a
                    href={r.path}
                    onClick={e => {
                      e.preventDefault();
                      open(r.path);
                    }}
                    aria-label={`Open ${r.name.replace(/^The /, 'the ')}`}
                    title={r.name}
                    className="block rounded-lg p-1 opacity-90 transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:opacity-100 hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-silver"
                    data-landing-close-room={r.id}
                  >
                    {r.glyph && <PageGlyph name={r.glyph} size={26} />}
                  </a>
                </li>
              ))}
            </ul>
            {/* Read in by the scroll: the letters light one after another as the lines come up. */}
            <LitLines
              lines={[
                { text: 'Seen enough?', ink: 'text-textPrimary' },
                { text: 'Step inside.', ink: 'text-textMuted' },
              ]}
              className="mx-auto font-light tracking-[-0.045em] leading-[0.96] text-displayLg [text-wrap:balance]"
            />
            <div className="mt-10 flex justify-center">
              <Pill href={doorTo()} onClick={door} testId="close">
                Launch the terminal
              </Pill>
            </div>
          </div>
        </Wrap>
        <SiteFooter home />
      </Block>
    </div>
  );
};

const Landing = () => (
  <GroundProvider>
    <Page />
  </GroundProvider>
);

export default Landing;
