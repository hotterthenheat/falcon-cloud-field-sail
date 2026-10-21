/*
==================================================
  SLAYER TERMINAL - PRACTICE, PAPER, BACKTEST AND
  THE JOURNAL, EACH ON ITS OWN PAGE
  (pages/landing/products/PracticePages.tsx)

  Four product pages in one file (Noah, 2026-10-02:
  "next do the individual pages of practice, paper,
  backtest and journal. make sure to include every
  section for each page including the actual journal
  for each trade for the journal section. follow the
  rules we established"). The rules: the landing's
  clothes (ProductPage), one recording a page — the
  tour's own film of that page, since each of those
  already shows the thing he asked for — pictures for
  every section, not too long, and words a working
  trader in their twenties would write.

  The four recordings, one each: Practice plays the
  futures film (two ES long, the brackets pulled off
  the chip, the day played); Paper its own; Backtest
  its own; the Journal its own. Every picture is the
  real page (scripts/make-product-shots.mjs,
  `practice`); every section named here is one the
  page has.
==================================================
*/

import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useGround } from '../ground';
import { DOOR_ARROW, DOOR_GROUP, Eyebrow } from '../pieces';
import TerminalWindow from '../TerminalWindow';
import ProductPage, { Aside, Head, Picture } from './ProductPage';

const SHOTS = '/landing/products/practice';
const PLAN = 'It comes with Desk.';

/** THE RECORDING on a practice page: the page's own tour film, with three lines under it */
const Film = ({ path, eyebrow, first, second, lines }: { path: string; eyebrow: string; first: string; second: string; lines: { word: string; says: string }[] }) => {
  const { a } = useGround();
  return (
    <div data-product-film={path}>
      <div className="max-w-[72ch]">
        <Eyebrow>{eyebrow}</Eyebrow>
        <Head className="mt-5" first={first} second={second} />
      </div>
      <TerminalWindow path={path} theme={a} desk natural className="mt-8" />
      <ul className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-x-10 gap-y-5 border-t border-borderSubtle">
        {lines.map(l => (
          <li key={l.word} className="pt-4 max-w-[40ch]">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-textMuted">{l.word}</p>
            <p className="mt-2 text-[14.5px] leading-relaxed text-textSecondary">{l.says}</p>
          </li>
        ))}
      </ul>
    </div>
  );
};

/** a door from one practice page to another's */
const To = ({ to, children }: { to: string; children: string }) => (
  <Link to={to} className={`${DOOR_GROUP} inline-flex items-center gap-1.5 text-[14.5px] text-textPrimary hover:text-textSecondary transition-colors`} data-product-door={to}>
    {children}
    <ArrowRight className={`w-3.5 h-3.5 ${DOOR_ARROW}`} aria-hidden="true" />
  </Link>
);

/* ================================================================ PRACTICE — the three rooms */

export const PracticePage = () => (
  <ProductPage
    name="Practice"
    glyph="practice"
    group="Practice"
    head={['Practice on real prices.', 'With pretend money and nothing at stake.']}
    intro={
      <>
        Practice is three rooms on one feed. Paper trades today’s prices with pretend money, on a practice account or a prop firm’s evaluation. Backtest replays a past day a minute at a time and lets you trade it — options off
        the chain as it stood, or futures long and short. The Journal is where every closed trade from either book ends up, on its day, with your words next to it. It’s the same order card, the same chart and the same brackets
        in all three, so what you learn in one carries straight into the next.
      </>
    }
    path="/practice/paper"
    plan={PLAN}
  >
    <Aside eyebrow="Paper Trade" first="Paper trading on today’s prices." second="Options and futures, nothing at stake." picture={<Picture src={`${SHOTS}/paper-desk`} alt="The paper desk: the chart with a bracketed position, the account card and the chain" ratio="1440 / 1000" />}>
      <p>
        The live desk, with a practice account or an evaluation behind it. Pick a strike off the chain and the order opens inside it; buy, and the position stands on the chart with its targets and its stop. Futures get a ladder
        beside the chart. The account carries from day to day.
      </p>
      <To to="/products/paper">Read about Paper</To>
    </Aside>

    <Film
      path="/practice/futures"
      eyebrow="In use"
      first="A futures trade, start to finish."
      second="You buy two ES, set the brackets, and let the day run."
      lines={[
        { word: 'The order', says: 'Market, limit or stop; join the bid or the ask; close, reverse or flatten. Two contracts bought at market here.' },
        { word: 'The brackets', says: 'Two targets pulled up off the position’s chip on the chart, a stop pulled down. The chip shows the dollars as the line moves.' },
        { word: 'The day', says: 'Play, and the candles print at the pace you set. Pause whenever you want to think.' },
      ]}
    />

    <Aside eyebrow="Backtest" first="A past day replayed minute by minute." second="Traded as it happened." flip picture={<Picture src={`${SHOTS}/backtest-desk`} alt="The backtest desk on a played day: the chart with a position and its brackets, the chain as it stood, the order" ratio="1440 / 1000" />}>
      <p>
        Pick a day and a name, set your rules, and the session starts at the open. The candles print and the chain reprices as the clock moves; the quotes are the ones that stood that minute. When you’re done, the report says
        what the trades added up to.
      </p>
      <To to="/products/backtest">Read about Backtest</To>
    </Aside>

    <Aside eyebrow="The journal" first="Every closed trade on its day." second="With your own words beside it." picture={<Picture src={`${SHOTS}/journal-month`} alt="The journal: the month as days with what each made, the figures beside it, a day open under it" ratio="1440 / 1000" />}>
      <p>
        One journal, two books. The month is laid out as days with what each one made; open a day and its trades, its curve and your note on it sit under the month. Open a trade and it gets a page of its own — the chart, the
        shape of it, and three questions worth answering while you still remember.
      </p>
      <To to="/products/journal">Read about the Journal</To>
    </Aside>

    {/* what the three share — three lines, not three cards */}
    <div data-product-shared>
      <div className="max-w-[72ch]">
        <Eyebrow>In all three</Eyebrow>
        <Head className="mt-5" first="The same order card everywhere." second="The same brackets, and one journal." />
      </div>
      <ul className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-x-10 gap-y-5 border-t border-borderSubtle">
        {[
          { word: 'The order', says: 'The same card on the paper desk and in the backtest. An option’s order lives inside its strike in the chain; a future’s stands beside the chart with market, limit and stop.' },
          { word: 'The ladder', says: 'Up to three targets and two stops on a position, breakeven after the first target, a trailing stop, and a count of contracts at each level. Pulled off the chart or typed.' },
          { word: 'The journal', says: 'Every closed trade from either book lands in the same journal, with the account it came from on the row.' },
        ].map(l => (
          <li key={l.word} className="pt-4 max-w-[40ch]">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-textMuted">{l.word}</p>
            <p className="mt-2 text-[14.5px] leading-relaxed text-textSecondary">{l.says}</p>
          </li>
        ))}
      </ul>
    </div>
  </ProductPage>
);

/* ================================================================ PAPER */

export const PaperPage = () => (
  <ProductPage
    name="Paper Trade"
    glyph="paper"
    group="Practice"
    head={['Paper trading on today’s prices.', 'A real desk with pretend money.']}
    intro={
      <>
        Paper is the live desk with nothing at stake. Start a practice account at the size you want, or take a prop firm’s evaluation with its profit target, loss limit and trading days as the rules. Then trade the day as it
        happens — options off the chain, futures long or short — on the same order card and chart you’d use for real. The account carries from day to day, and every closed trade goes to the journal.
      </>
    }
    path="/practice/paper"
    plan={PLAN}
  >
    <Aside eyebrow="Starting out" first="Start with a practice account." second="Or a prop firm’s evaluation." picture={<Picture src={`${SHOTS}/paper-start`} alt="The paper desk's start page: a practice account at four sizes, or a prop firm's evaluation with its plans" ratio="1440 / 1000" />}>
      <p>
        A practice account is pretend money with no rules but your own: $10,000 to $100,000, options and futures, a fee an option each way. An evaluation is a prop firm’s test — a profit target, a loss limit that follows your
        best close, a limit on contracts, a number of trading days — and the desk holds you to it, with the account’s status in its head.
      </p>
    </Aside>

    <Film
      path="/practice/paper"
      eyebrow="In use"
      first="A trade on the paper desk."
      second="You open a strike, buy two, and set the brackets."
      lines={[
        { word: 'The strike', says: 'Press a row of the chain and it opens on its stats, its greeks and the order — buy at the ask or at a limit, with the cost and what is free after.' },
        { word: 'The chart', says: 'The position stands on the chart as a chip with its live P&L. Pull a line up off it for a target, down for a stop; pull again for another target.' },
        { word: 'The desk', says: 'The account card above the chain says what the account is worth, what is free, the day and the whole run; the blotter below the chart lists positions, orders and trades.' },
      ]}
    />

    <Aside eyebrow="The order" first="The order sits inside the strike." second="There is no separate ticket." narrow flip picture={<Picture src={`${SHOTS}/paper-order`} alt="The order inside a held strike: the position, the sizes, sell at the bid or at a limit, the cost line" ratio="813 / 335" />}>
      <p>
        An option’s order lives inside its strike in the chain, where the quote is. Size it with the pills or type it; buy at the ask or set a limit; add a target and a stop before you’re in, on the contract’s price or on the
        stock’s. Once you hold it, the same block shows your position and the ways out — sell at the bid, sell at a limit, or buy more — with the cost of what you’re about to do under it in plain words.
      </p>
    </Aside>

    <Aside eyebrow="The account" first="The account on one card." second="Worth, free, today and all time." narrow picture={<Picture src={`${SHOTS}/paper-account`} alt="The account card: worth, today, all time, what is free, what is open, what is tied up, and the counts" ratio="870 / 375" />}>
      <p>
        The account card sits above the chain and stays put. What the account is worth, what it made today and over its whole run, what is free to trade with and what is open, and a bar for what is tied up. Cancel all, flatten
        and a new account are a press away. On an evaluation the same card carries the status and how far you are from the target and the floor.
      </p>
    </Aside>

    <Aside eyebrow="Futures" first="Futures on the same desk." second="A ladder beside the chart, long or short." flip picture={<Picture src={`${SHOTS}/paper-futures`} alt="The paper desk on a future: the ladder beside the chart, the order card with market, limit and stop" ratio="1440 / 1000" />}>
      <p>
        Put a future on the chart and the desk changes shape: a price ladder stands beside it, so you buy and sell at a price on the ladder itself, and the order card turns to market, limit and stop with join-the-bid and
        join-the-ask. ES, NQ, oil, gold and silver, nearly round the clock, with the margin a contract holds shown on the position.
      </p>
    </Aside>
  </ProductPage>
);

/* ================================================================ BACKTEST */

export const BacktestPage = () => (
  <ProductPage
    name="Backtest"
    glyph="backtest"
    group="Practice"
    head={['Replay a past day.', 'And trade it as it happened.']}
    intro={
      <>
        Backtest replays a past session a minute at a time — the candles print, the chain reprices, the quotes are the ones that stood that minute — and you trade it with pretend money. Options or futures, one name or two,
        your own rules on how many positions you may hold, how much a trade may cost or risk, and where the day stops. Play it at any pace, step a minute, or jump to a time. When you’re done, the report says what the session’s
        trades added up to.
      </>
    }
    path="/practice/backtest"
    plan={PLAN}
  >
    <Aside eyebrow="A session" first="A session starts from one line of cards." second="The name, the day, the rules, then the clock." picture={<Picture src={`${SHOTS}/backtest-sessions`} alt="The sessions page: the cards that make a session, and the list of sessions kept on this machine" ratio="1440 / 1000" />}>
      <p>
        Options or futures. The name, and a second one if you want two on the desk. What you start with, the day the clock starts on, the fee. Then your rules: how many positions may be open at once, what one trade may cost
        — or, on futures, risk between the fill and the stop — and the loss on the day that stops you. Every session you’ve run stays in the list under it with where its clock stands and what it’s worth, with doors to its desk
        and its report.
      </p>
    </Aside>

    <Film
      path="/practice/backtest"
      eyebrow="In use"
      first="A trade in the backtest."
      second="You buy two, set the brackets, and press play."
      lines={[
        { word: 'The chain', says: 'The chain as it stood that minute, bid and ask, delta, the decay a day. Open a strike and the order is inside it.' },
        { word: 'The chart', says: 'Two targets and a stop pulled off the position’s chip. When a line is hit the engine fills it at the quote that stood then.' },
        { word: 'The clock', says: 'Play, and the day runs at the pace you set. The chip’s dollars move with every candle.' },
      ]}
    />

    <Aside eyebrow="The clock" first="The clock at any pace." second="One bar at a time, or straight to a time of day." narrow flip picture={<Picture src={`${SHOTS}/backtest-replay`} alt="The replay bar: the day's track, the pace, step back and forward, play, to the end, and the way to your sessions" ratio="1256 / 212" />}>
      <p>
        The bar floats at the foot of the chart and folds to a pill when you want the tape. The track is the whole day; press anywhere on it to jump there. The pace is a multiple — one candle a second at 1× — and the steps
        move the clock a minute back or forward, so you can walk a decision candle by candle. Nothing happens on the desk unless the clock moves.
      </p>
    </Aside>

    <Aside eyebrow="Futures" first="Futures in the backtest." second="Brackets in points from the fill." picture={<Picture src={`${SHOTS}/backtest-futures`} alt="A futures session: the contract card, the order card with market, limit and stop, the brackets in points" ratio="1440 / 1000" />}>
      <p>
        A futures session puts the contract’s card where the chain would be: a point, a tick, the margin a contract holds, the fee each way, and the day so far by its sessions — overnight, the day session, the last hour.
        The order card is market, limit or stop; join the bid or the ask; close, reverse, flatten. The brackets are distances in points from the fill, and a press sizes the position to a share of the account at risk.
      </p>
    </Aside>

    <Aside eyebrow="The report" first="What the session added up to." second="With the cuts an options trader needs." flip picture={<Picture src={`${SHOTS}/backtest-report`} alt="A session's report: the figures, the running total, calls against puts, days to expiry, delta, how each trade ended, and every trade" ratio="1440 / 1000" />}>
      <p>
        The usual figures — win rate, profit factor, the average win against the average loss, the biggest of each — and the running total on the chart. Then the cuts: calls against puts, days to expiry at entry, delta at
        entry, how each trade ended (sold, target, stopped, held to the bell) and the hour it was entered. Every trade is listed under it, and each is a door to its page in the journal.
      </p>
    </Aside>
  </ProductPage>
);

/* ================================================================ THE JOURNAL */

export const JournalPage = () => (
  <ProductPage
    name="Journal"
    glyph="journal"
    group="Practice"
    head={['Every trade you closed, on its day.', 'With your own words beside it.']}
    intro={
      <>
        The Journal is where closed trades go — from the paper book or the backtest’s, one journal with two books. The month is laid out as days, each with what it made; the period’s figures sit beside it; pick a day and its
        trades, its curve and your note on the day open under the month. Open a trade and it gets a page of its own: the chart it was on, the shape of it in six reads, your tags, and three questions worth answering while you
        still remember what you were thinking.
      </>
    }
    path="/practice/journal"
    plan={PLAN}
  >
    <Aside eyebrow="The month" first="The month, a card a day." second="Each day with what it made." picture={<Picture src={`${SHOTS}/journal-month`} alt="The journal's month: each day with what it made and how many trades, the week's sums, and the period's figures beside it" ratio="1440 / 1000" />}>
      <p>
        Calendar days, Sunday to Saturday, each carrying what it made and how many trades; the weeks summed at the right. Beside the month, the period’s figures: won against lost, win rate, profit factor, the average win and
        loss, the best and worst trade, how long you held, how much of the best was kept, the drawdown. Cut it to today, this week, this month, this year or all time; switch between the paper book and the backtest’s; search
        a name; take it out as CSV.
      </p>
    </Aside>

    <Film
      path="/practice/journal"
      eyebrow="In use"
      first="Opening a day."
      second="You press a day and its trades open under it."
      lines={[
        { word: 'The day', says: 'Press a day and it opens under the month with its trades, newest first, and how the day went as a curve.' },
        { word: 'The rows', says: 'Each row is a trade: the contract, the size, in and out, how long it was held, what it made, and the account it came from. Press one and it opens as a page.' },
        { word: 'Back', says: 'The day you were on comes back when you return; the cut you had rides the address.' },
      ]}
    />

    <Aside eyebrow="The day" first="How the day went." second="And what you wrote on it." flip picture={<Picture src={`${SHOTS}/journal-day`} alt="A day open under the month: its trades, how the day went, the running total, what each day made, and the words on the day" ratio="1440 / 1000" />}>
      <p>
        Under the month: the day’s trades as rows, how the day went as a curve, and two boxes for your own words — the plan before, the review after. A day with words on it carries a pen on the month, so you can see at a glance
        which days you actually sat down with. Below that, the running total across the period, and what each day made as bars; hover a bar and its card tells you the day.
      </p>
    </Aside>

    {/* the trade's own page */}
    <div data-product-trade>
      <div className="max-w-[62ch]">
        <Eyebrow>A trade’s own page</Eyebrow>
        <Head className="mt-5" first="A trade’s own page." second="Look at it again and write what you see." />
        <p className="mt-6 text-[15.5px] leading-relaxed text-textSecondary">
          Press a trade and it opens as a page, not a pop-up. The chart it was on with the way in and the way out marked, what it was worth each minute it was open, the trade’s facts, and the two things a journal is for: the
          shape of it, and your words. The arrows walk the trades of the cut you came from.
        </p>
      </div>
      <Picture src={`${SHOTS}/journal-trade`} alt="A trade's own page: the chart it was on, the shape of it, the trade's facts, your tags and your words" ratio="1440 / 1000" className="mt-10" />
      <div className="mt-10 grid grid-cols-1 lg:grid-cols-12 gap-x-10 gap-y-10 items-start">
        <div className="lg:col-span-7">
          <Picture src={`${SHOTS}/journal-shape`} alt="The shape of it: six reads of the trade drawn as a hexagon over your usual shape" ratio="908 / 425" />
          <p className="mt-4 text-[15px] font-medium text-textPrimary">The shape of it</p>
          <p className="mt-1.5 max-w-[60ch] text-[14px] leading-relaxed text-textSecondary">
            Six reads of the trade, drawn as one shape: how much of the best it kept, the heat it took, the result, where the entry sat in its run, whether there was a plan, and how many of the three questions you answered.
            Your usual shape stands behind it in grey, so a trade that looks nothing like your others shows it at a glance. One line under it says the same in words.
          </p>
        </div>
        <div className="lg:col-span-5">
          <Picture src={`${SHOTS}/journal-words`} alt="Your tags and your words: the setup, the mistakes, whether you followed the plan, and the three questions" ratio="426 / 556" />
          <p className="mt-4 text-[15px] font-medium text-textPrimary">Your tags, your words</p>
          <p className="mt-1.5 max-w-[60ch] text-[14px] leading-relaxed text-textSecondary">
            The setup, the mistakes and whether you followed the plan come from your own lists, so the words are yours. Then three questions instead of one blank box: why I took it, what I saw while in it, and what I would do
            again. What you type is kept exactly as typed, marked Kept, and counted — the page says how many of the three you’ve answered.
          </p>
        </div>
      </div>
    </div>
  </ProductPage>
);

export default PracticePage;
