/*
==================================================
  SLAYER TERMINAL - TRACE, ON ITS OWN PAGE
  (pages/landing/products/TracePage.tsx)

  The product page for the tape (Noah, 2026-10-02:
  "now do trace"). Eleven pages in the terminal,
  one page here: the live tape and a print's card,
  the ONE recording (the tour's own film of the
  tape — held, a row opened, let run), the dark
  pool, then the day's book read every way the
  room reads it — the screener, net flow, the
  same-day money, the footprints, the quarter
  hours, the watchers, the structures, two names
  side by side — and the tracker in a line. Every
  picture is the real page (scripts/
  make-product-shots.mjs, `trace`).
==================================================
*/

import { useGround } from '../ground';
import { Eyebrow } from '../pieces';
import TerminalWindow from '../TerminalWindow';
import ProductPage, { Aside, Head, Pair, Picture, Room } from './ProductPage';

const SHOTS = '/landing/products/trace';

/** the recording's three lines — what the tape's film shows */
const TAPE_FILM: { word: string; says: string }[] = [
  { word: 'Live', says: 'The tape runs on its own, newest print first. Press Live and it holds, so nothing moves under you while you read; press again and it catches up.' },
  { word: 'A print', says: 'Press a row and the print opens as a card over the tape: the money line, the read, the contract’s day, and the other legs of the same contract.' },
  { word: 'The cut', says: 'Cut the tape to sweeps, to blocks, to one side or one size, and let it go again. The head’s facts follow the cut.' },
];

const TracePage = () => (
  <ProductPage
    name="Trace"
    glyph="trace"
    group="Market"
    head={['The options tape.', 'And the pages that read it.']}
    intro={
      <>
        Trace is where the day’s options flow lands. The live tape streams the rich prints as they happen — sweeps, blocks, the side they were paid on — with the dark pool beside it. The other pages read the same book from
        different angles: which way each name’s money leans, what was built overnight and still stands, which quarter hour a contract’s whole day happened in, the spreads reconstructed out of their legs, and two names
        side by side. A press on any row opens the contract’s card, where the one engine reads it.
      </>
    }
    path="/trace/live-tape"
    plan="It comes with Tape."
  >
    {/* ── THE TAPE ── */}
    <Aside eyebrow="The tape" first="The big prints, as they happen." second="Each with what it says." picture={<Picture src={`${SHOTS}/tape`} alt="The live tape: the head's facts and whales, the cards, the sentence, the prints in the grid with the top names and the dark pool beside them" ratio="1440 / 1000" />}>
      <p>
        The head says what the tape is doing: how many prints, the premium by side, sweeps against blocks, the put-call, how much of it is same-day — and the three whales of the session as doors. One line of cards cuts
        it: the order, the kind, the lean, the premium. Then the prints, newest first, each with its time, the contract, the fill against the spread, the size and the money. The rail beside it carries the top names and
        the dark pool, and folds away when you want the room.
      </p>
    </Aside>

    <Aside eyebrow="A print" first="A print’s card." second="The money, the read, and the day it printed on." flip picture={<Picture src={`${SHOTS}/print`} alt="A print's card over the tape: the masthead, the money line, the read in words, the facts, the contract's day and the other legs" ratio="1440 / 1000" />}>
      <p>
        Press a row and the print opens as a card over the tape, so the rows you were comparing stay behind it. The money line first — what was paid, on which side, against what the contract usually trades. The read in
        words. The facts under it, with the Compass scale folded in. Then the contract’s day as a chart, the session that drives it in the card’s own head, and every other print on the same contract, so one sweep is never
        read on its own.
      </p>
    </Aside>

    {/* ── THE ONE RECORDING ── */}
    <TapeFilm />

    {/* ── THE DARK POOL ── */}
    <Room eyebrow="The dark pool" first="Trades done off the exchange." second="Each with its read." pictures={<Pair items={[
      { src: `${SHOTS}/dark-pool`, ratio: '1800 / 1196', name: 'The shelves and the crosses', says: 'The shelves at the top: the prices where the dark dollars rested, each a pivot, a support or a resistance, with how many prints defended it. Under them, every cross with its venue, which shelf it sits on, and the read — accumulation, distribution, rotation, a hedge — with how sure it is.' },
      { src: `${SHOTS}/dark-leaders`, ratio: '1800 / 957', name: 'Where the dark money went', says: 'The market’s dark tape by sector and by name, heaviest first. Press a name and the box above turns to it.' },
    ]} />}>
      <p>
        Dark-pool prints come with no side and no story. This page gives them one: who is likely behind each cross, the shelves they left on price, and whether the day’s dark money reads as building a position or leaving
        one. The head says the posture for the whole name in a word.
      </p>
    </Room>

    {/* ── THE BOOK, READ FOUR WAYS ── */}
    <Room eyebrow="The book" first="The whole day’s flow." second="Read four ways." pictures={<Pair items={[
      { src: `${SHOTS}/screener`, ratio: '1440 / 1000', name: 'The screener', says: 'Every contract that traded today, in one grid a screen tall. The screens are questions — most active, biggest premium, open interest built today — and the cards narrow by side, tenor, volume, premium and money. A row opens the contract’s card.' },
      { src: `${SHOTS}/net-flow`, ratio: '1440 / 1000', name: 'Net flow', says: 'Every name ranked from most bullish to most bearish by net premium — calls bought and puts sold against the reverse — and the picked name through the session on the pane beside it: its own candles, net calls and net puts, cut by money and by clock.' },
      { src: `${SHOTS}/odte`, ratio: '1440 / 1000', name: 'The same-day money', says: 'The 0DTE flow on up to four panes, each with its own cut of the book — everything, stocks, the index funds, a sector — or one name. Same clock as net flow, so the two agree.' },
      { src: `${SHOTS}/footprints`, ratio: '1800 / 1117', name: 'The footprints', says: 'Volume is loud and gone by the close; open interest is what stayed. Positions built and unwound overnight, contract by contract, who built them — on the ask or on the bid — and whether the build has run for days.' },
    ]} />}>
      <p>The same day book, from four angles. Each one is a question the tape raises, and each row anywhere is a door to the contract’s card.</p>
    </Room>

    {/* ── WHEN, WHY, AND IN WHAT SHAPE ── */}
    <Room eyebrow="When, why, what shape" first="Three more cuts of the tape." second="By the quarter hour, by reason and by structure." pictures={<Pair items={[
      { src: `${SHOTS}/intervals`, ratio: '1800 / 1117', name: 'A quarter hour of the day', says: 'Most contracts dribble all session; a few burst — the whole day in one window, somebody acting all at once. The strip at the top walks the session window by window; the share of the day is the tell.' },
      { src: `${SHOTS}/watchers`, ratio: '1800 / 1117', name: 'The desk watching the tape', says: 'Not your alerts — the desk’s own watchers over the day book, and what they caught, newest first, each with the reason it is in front of you: a sweep against the trend, open interest built from nothing, a print that is the whole day’s volume.' },
      { src: `${SHOTS}/multi-leg`, ratio: '1800 / 1117', name: 'The tape as structures', says: 'The tape reconstructed into spreads: the shape, its legs, what was paid or collected, the most it can lose and the most it can make, with “uncapped” said loudest. Each structure says in plain words what it does — never what to do with it.' },
      { src: `${SHOTS}/compare`, ratio: '1440 / 1000', name: 'Two names, side by side', says: 'Both names’ sessions on a net-flow pane each, the fight card under them — the first name’s figure left, the fact in the middle with what the two say against each other, the second name’s right, the lead lit — then each one’s six heaviest contracts and its structures.' },
    ]} />}>
      <p>Three more ways the room reads the day — by the clock, by the reason, by the shape — and one that reads two names at once.</p>
    </Room>

    {/* ── THE TRACKER, IN A LINE ── */}
    <div className="max-w-[72ch]" data-product-tracker>
      <Eyebrow>Under watch</Eyebrow>
      <Head className="mt-5" first="Mark a print." second="And see what it has done since." />
      <p className="mt-6 max-w-[64ch] text-[15.5px] leading-relaxed text-textSecondary">
        Any print or contract on any Trace page can be marked. The tracker is one grid of everything you marked — the name, the contract, when and where you marked it, its price then and now — so the one question a mark
        raises, what has it done since, is answered on one line.
      </p>
    </div>
  </ProductPage>
);

/** THE RECORDING: the tape in use — the tour's own film, with three lines under it */
const TapeFilm = () => {
  const { a } = useGround();
  return (
    <div data-product-film="trace-live-tape">
      <div className="max-w-[72ch]">
        <Eyebrow>In use</Eyebrow>
        <Head className="mt-5" first="Holding the tape." second="You hold the tape, open a print, and let it run." />
      </div>
      <TerminalWindow path="/trace/live-tape" theme={a} desk natural className="mt-8" />
      <ul className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-x-10 gap-y-5 border-t border-borderSubtle">
        {TAPE_FILM.map(l => (
          <li key={l.word} className="pt-4 max-w-[40ch]">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-textMuted">{l.word}</p>
            <p className="mt-2 text-[14.5px] leading-relaxed text-textSecondary">{l.says}</p>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default TracePage;
