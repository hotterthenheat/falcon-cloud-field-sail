/*
  The product pages for Practice, Paper Trade, Backtest and the Journal, in one file.
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
            <p className="font-mono text-t11 uppercase tracking-[0.2em] text-textMuted">{l.word}</p>
            <p className="mt-2 text-t145 leading-relaxed text-textSecondary">{l.says}</p>
          </li>
        ))}
      </ul>
    </div>
  );
};

/** a door from one practice page to another's */
const To = ({ to, children }: { to: string; children: string }) => (
  <Link to={to} className={`${DOOR_GROUP} inline-flex items-center gap-1.5 text-t145 text-textPrimary hover:text-textSecondary transition-colors`} data-product-door={to}>
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
    head={['Practice on live option quotes.', 'With pretend money and nothing at stake.']}
    intro={
      <>
        Practice is three rooms. Paper trades options with pretend money, filled at each contract’s live bid and ask during the options session. Backtest replays a recorded ThetaData session, and fills at the bid and ask
        each contract had that minute. The Journal is where every closed trade ends up, on its day, with your words next to it. Options only: neither data feed carries futures.
      </>
    }
    path="/practice/paper"
    plan={PLAN}
  >
    <Aside eyebrow="Paper Trade" first="Paper trading on live quotes." second="Options, nothing at stake." picture={<Picture src={`${SHOTS}/paper-desk`} alt="The paper desk: the chart with a bracketed position, the account card and the chain" ratio="1440 / 1000" />}>
      <p>
        The live desk, with a practice account behind it. Pick a strike off the chain and the order opens inside it; buy at the contract’s live ask, and the position stands on the chart with its targets and its stop. The
        account carries from day to day.
      </p>
      <To to="/products/paper">Read about Paper</To>
    </Aside>

    <Aside eyebrow="Backtest" first="Replay a past session." second="At the bid and ask it really had." flip picture={<Picture src={`${SHOTS}/backtest-desk`} alt="The backtest desk on a played day: the chart with a position and its brackets, the chain as it stood, the order" ratio="1440 / 1000" />}>
      <p>
        A replay trades the bid and ask every contract had each minute of a past day, read from ThetaData’s recorded history. Pick the name and the day, set your rules, and play the clock; every fill is a quote that
        printed that minute.
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
          { word: 'The order', says: 'An option’s order lives inside its strike in the chain, at the contract’s live bid and ask.' },
          { word: 'The ladder', says: 'Up to three targets and two stops on a position, breakeven after the first target, a trailing stop, and a count of contracts at each level. Pulled off the chart or typed.' },
          { word: 'The journal', says: 'Every closed trade from either book lands in the same journal, with the account it came from on the row.' },
        ].map(l => (
          <li key={l.word} className="pt-4 max-w-[40ch]">
            <p className="font-mono text-t11 uppercase tracking-[0.2em] text-textMuted">{l.word}</p>
            <p className="mt-2 text-t145 leading-relaxed text-textSecondary">{l.says}</p>
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
    head={['Paper trading on live quotes.', 'A real desk with pretend money.']}
    intro={
      <>
        Paper is the live desk with nothing at stake. Start a practice account at the size you want and trade options off the chain at each contract’s live bid and ask, during the options session. Orders wait when there is
        no two-sided quote. The account carries from day to day, and every closed trade goes to the journal. Options only: neither data feed carries futures.
      </>
    }
    path="/practice/paper"
    plan={PLAN}
  >
    <Aside eyebrow="Starting out" first="Start with a practice account." second="Your size, your rules." picture={<Picture src={`${SHOTS}/paper-start`} alt="The paper desk's start page: a practice account at four sizes" ratio="1440 / 1000" />}>
      <p>
        A practice account is pretend money with no rules but your own: $10,000 to $100,000, options, a fee an option each way.
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
        and a new account are a press away.
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
    head={['Replay a past day.', 'At the bid and ask it really had.']}
    intro={
      <>
        Backtest replays a recorded ThetaData session minute by minute. Every order fills at the bid or ask the contract really had that minute, the chain stands as it stood, and the day runs at the pace you set.
      </>
    }
    path="/practice/backtest"
    plan={PLAN}
  >
    <Aside eyebrow="A session" first="A session starts from one line of cards." second="The name, the day, the rules, then the clock." picture={<Picture src={`${SHOTS}/backtest-sessions`} alt="The sessions page: the cards that make a session, and the list of sessions kept on this machine" ratio="1440 / 1000" />}>
      <p>
        The name, and a second one if you want two on the desk. What you start with, the day the clock starts on, the fee. Then your rules: how many positions may be open at once, what one trade may cost and the loss
        on the day that stops you. Every session you’ve run stays in the list under it with where its clock stands and what it’s worth, with doors to its desk
        and its report.
      </p>
    </Aside>

    <Film
      path="/practice/backtest"
      eyebrow="In use"
      first="A trade in the backtest."
      second="You buy two, set the brackets, and press play."
      lines={[
        { word: 'The chain', says: 'The chain at the replay’s minute: bid and ask, delta, the decay a day. Open a strike and the order is inside it.' },
        { word: 'The chart', says: 'Two targets and a stop pulled off the position’s chip. When a line is hit the engine fills it at that minute’s replay quote.' },
        { word: 'The clock', says: 'Play, and the day runs at the pace you set. The chip’s dollars move with every candle.' },
      ]}
    />

    <Aside eyebrow="The clock" first="The clock at any pace." second="One bar at a time, or straight to a time of day." narrow flip picture={<Picture src={`${SHOTS}/backtest-replay`} alt="The replay bar: the day's track, the pace, step back and forward, play, to the end, and the way to your sessions" ratio="1256 / 212" />}>
      <p>
        The bar floats at the foot of the chart and folds to a pill when you want the tape. The track is the whole day; press anywhere on it to jump there. The pace is a multiple — one candle a second at 1× — and the steps
        move the clock a minute back or forward, so you can walk a decision candle by candle. Nothing happens on the desk unless the clock moves.
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
        <p className="mt-6 text-t155 leading-relaxed text-textSecondary">
          Press a trade and it opens as a page, not a pop-up. The chart it was on with the way in and the way out marked, what it was worth each minute it was open, the trade’s facts, and the two things a journal is for: the
          shape of it, and your words. The arrows walk the trades of the cut you came from.
        </p>
      </div>
      <Picture src={`${SHOTS}/journal-trade`} alt="A trade's own page: the chart it was on, the shape of it, the trade's facts, your tags and your words" ratio="1440 / 1000" className="mt-10" />
      <div className="mt-10 grid grid-cols-1 lg:grid-cols-12 gap-x-10 gap-y-10 items-start">
        <div className="lg:col-span-7">
          <Picture src={`${SHOTS}/journal-shape`} alt="The shape of it: six reads of the trade drawn as a hexagon over your usual shape" ratio="908 / 425" />
          <p className="mt-4 text-t15 font-medium text-textPrimary">The shape of it</p>
          <p className="mt-1.5 max-w-[60ch] text-t14 leading-relaxed text-textSecondary">
            Six reads of the trade, drawn as one shape: how much of the best it kept, the heat it took, the result, where the entry sat in its run, whether there was a plan, and how many of the three questions you answered.
            Your usual shape stands behind it in grey, so a trade that looks nothing like your others shows it at a glance. One line under it says the same in words.
          </p>
        </div>
        <div className="lg:col-span-5">
          <Picture src={`${SHOTS}/journal-words`} alt="Your tags and your words: the setup, the mistakes, whether you followed the plan, and the three questions" ratio="426 / 556" />
          <p className="mt-4 text-t15 font-medium text-textPrimary">Your tags, your words</p>
          <p className="mt-1.5 max-w-[60ch] text-t14 leading-relaxed text-textSecondary">
            The setup, the mistakes and whether you followed the plan come from your own lists, so the words are yours. Then three questions instead of one blank box: why I took it, what I saw while in it, and what I would do
            again. What you type is kept exactly as typed, marked Kept, and counted — the page says how many of the three you’ve answered.
          </p>
        </div>
      </div>
    </div>
  </ProductPage>
);

