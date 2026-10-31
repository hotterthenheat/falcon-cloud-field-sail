# Paper — the rules of the live paper account

> **Updated 2026-10-29.** Paper is options only. Futures and the futures-style evaluations (50K/100K/150K, "ten micros
> are one") are gone, and every part of this page about futures or those plans is superseded. Accounts now live on an
> Accounts page (`/practice/paper`) with one desk per account (`/practice/paper/:accountId`). Prop-firm accounts and
> "your own rules" accounts are judged by the rule engine in `src/data/paper/rules.ts`, on the firms' published rules in
> `src/data/paper/propFirms.ts` (each with its source and "rules as of" date; the firm's own site governs).
> `scripts/paper-proof.ts` and `scripts/golden/paper-golden.ts` check the engine. Fills, fees, the clock and the
> carry-over below still hold for options. **Since 2026-10-29 options are also sold** — "Selling, margin and what each
> plan allows" at the foot of this page is current and supersedes "What can be traded: long calls and puts, and
> vertical spreads bought for a debit" below.

Written 2026-09-22, **before the code** (Noah, on the partner's paper page: "he is basically making a 'propfirm' type
field for users to trade paper money on instead of wasting their money buying a propfirm when they are not ready for
it", and then: "this is meant to be live data like how propfirms work. so this is different then backtesting because you
only backtest on past data"). One page, plain words. `src/data/paper/engine.ts` implements exactly this, `feed.ts` is
its seam onto the live prices, and `scripts/paper-proof.ts` checks one against the other (`npm run review:proof`). When
a rule changes, it changes here first.

## What it is

A **paper account** trades the terminal's **live prices** with pretend money. Nothing reaches a broker. It is not the
backtest: a backtest replays a stretch of the past on a clock the reader moves; a paper account lives on **today's
clock**, and its orders fill when the live market reaches them — whether the reader is looking at the chart or not.

## The page

**Since 2026-09-26 Paper is a page of ONE section, Practice** — Practice › Paper (`/practice/paper`) · Backtest
(`/practice/backtest`) · Journal (`/practice/journal`) — with the backtest (Noah: "should paper trading and backtesting
be in the same section and should they also carry the same journal"; "the live chart should be called paper and the overhead
can be called practice"). The old addresses (`/paper/*`, `/review/*`) land where their pages went.

Paper is **the Live Chart** (2026-09-22 — Noah: "i think we got too carried away and lost focus"; the first
Evaluation and Journal pages were taken out the same evening) **and, since 2026-09-25, its Journal** (below). The chart — one to four panes — fills the left; the right
column holds **the account** (the card that says which account is in hand and where it stands) and, under it, **the Order
card** on a future or **the chain** on a stock or an index; under the chart are its **positions, orders and trades**.
Nothing stands over the chart, so it starts at the top of the page. Its top left says **whose it is and at what interval —
"ES · 1m", no box round it** — then its **RP&L and UP&L**. Its **full screen fills the screen edge to edge** (the chart and
the right column's cards on hairlines, no padding round them), and there the RP&L and UP&L ride **the top strip, between
the intervals and the indicators**. The account card keeps its own height and the Order card or the chain fills the rest
of the column; the column is **440px on a future and 560px on a chain** ("build it with the wider column").

**What is on the chart** is picked at the head of the chart from one list, in the partner's order: the futures by their
front month, each with the exchange's name for it and where it trades, then the index options (SPX, NDX, RUT), then the
stocks and funds — with one search over all of it (a ticker, a company, a future's name). An evaluation lists the futures
only.

**The Order card** (a future's) is laid out the way a prop firm's platform lays it (TopstepX): the contract, where the position stands
and the last price on one line; **Market · Limit · Stop** (a price box that steps a tick for the last two); **the size**
(− n + and 1 · 3 · 5 · 10 · 15 — one size for the whole desk: the chart's right-click card uses it too); **Buy +n and
Sell −n** side by side, one press each; **Join bid · Join ask**, **Close position · Reverse · Cancel orders**, **Flatten
all · Cancel all**; and **the brackets**, always in sight. On a future the brackets are **distances in points from the
fill** — above a buy's, below a sell's — so either button carries them, and they are kept for the next order; a market
order's fill is a tick against the press, so that is what they are measured from. At the foot: what a press sets aside
and costs, or the engine's own words for why it would be refused.

**The ladder** (a future's, 2026-09-22 — Noah: "show me ours on the live chart for futures but it should be something that
you can exit out of with ease"): a price a row, opened from the chart head's **Ladder** door and standing **beside the
chart** — the chart gives it the room and takes it back when it goes. A press in **Buy** or **Sell** places the desk's size
at that row: at the price, the market; under it, a limit to buy and a stop to sell; over it, a stop to buy and a limit to
sell — carrying **the Order card's brackets**, the same as its own buttons. The reader's working orders sit on their rows
(a stop marked "s"); a press on one cancels it. **Volume** is what traded at each price this session (a bar's volume spread
over its range), and with a position open, **P&L** is what it would be up or down with the price at that row, the entry
underlined. There is no book to show: the simulated feed has none, so no column pretends to. A press the engine would
refuse says why at its foot. **It closes three ways**: its X, Esc inside it (never the full screen's Esc, a menu's or a
drawing's), or the door again; it stays as it was left. On a phone or a narrow screen there is no room for it beside the
chart, and neither it nor its door shows.

**Orders on the chart.** A position and its ways out are solid chips on their lines (on a LIGHT tape — Stone — the
solid goes soft: the direction's ink on a tint of it, the way-out's count and the ✕ black, the axis labels the same; on a
dark tape nothing moved — Noah, 2026-09-26: "too dark/thick/solid" · "should be black not a navy blue" · "the gray x
should also become black"; index.css `.fill-bull` / `.fill-bear` / `.fill-count`). **The three chips read apart** (his
"these cards need to look unique"): a way out says its word before its money — **TP** on a target, **SL** on a stop, TP2 /
SL2 on a second rung — and **the position's chip alone wears the silver ring** (where you are; black on a light tape), a
future's saying its side ("1 long"), an option's its contract ("1 × 194C"); **an order waiting to open a
position** (or add to one) is its own chip — **Buy limit · Buy stop · Sell limit · Sell stop**, in its side's colour on an
outline, its contracts and a × that cancels it — on a dotted line, and it drags to a new price (a stop is never let
through the market). An option's buy waits where the name would have to stand for the contract's ask to come down to it.

**A stock's or an index's options are ordered from the chain** (2026-09-22 — Noah: "obviously the order is not a buy
limit or a sell limit but rather a put or call and you would need the actual options chain to see the vol, decay etc like
we have for the dropdown of the weigher options chain"). It is **the Weigher's own chain** on the Live Chart's quotes, so
the price in the chain is the price a press gets:

- At its head, **Calls | Puts** — the direction, filled green or red the way Buy and Sell are — then the expiry, the
  Columns card (the Weigher's catalog, with **Decay a day** in dollars a contract), and the move the chain is charging
  for by that expiry.
- The strikes run high to low with **the market's line** between the two that bracket it; the chain opens centred on it.
- One press on a strike **opens its dropdown** — the Stats and the Greeks, as on the Weigher — and a second folds it. The
  order is **inside the dropdown**, under them: the desk's one size, **Buy +n @ the ask** or **@ a limit** (the middle
  unless another price is typed), a **Spread** that sells a strike further out against it (a debit spread, as the
  backtest trades), and a folded **+ Target / Stop** (the backtest's ladder, on the contract's price or the name's). The
  dropdown brings its order into view inside the chain.
- A strike the account holds says **HELD** on its row, and its dropdown turns to the position: what it is up or down,
  **what it loses a day**, **Sell −n @ the bid** or **@ a limit**, **All n**, and **Buy n more @ the ask**.
- With no Order card beside a chain, **Cancel all** (while an order is working) and **Flatten** sit on the account card.

Two kinds of account:

- **Practice** — the reader's own. It starts with the money they choose ($10,000 · $25,000 · $50,000 · $100,000),
  carries from day to day, and trades options and futures. A new one can be started at any time; the old one is closed at
  the market first and stays in the account list, with its trades.
- **An evaluation** — a prop firm's test. Futures only, a set of rules that end the day or end the test, and a target
  that passes it. One can run at a time. A finished one — passed, failed, or ended by the reader — is kept with its
  record.

The Live Chart trades **the account in hand**: the practice account, or the evaluation that is running. The account card
at the head of the right column says which and switches, and its **New** starts one — a practice account of a size, or
an evaluation on a plan — and ends the evaluation that is running. Before there is an account, the page offers the same
two starts.

## The prices

**Today the feed is the terminal's simulator.** It trades round the clock, and it is a new market on every page load —
so the rules below say what happens at the page's edges (below, "When the page closes"). When the real feed is wired in,
`src/data/paper/feed.ts` is the one file that changes, and the market's hours become the exchange's: options 09:30 to
16:00 New York, futures 18:00 to 17:00. Until then the page says "Simulated feed" wherever a figure is shown.

### Options

- The chain beside the chart is quoted by **the backtest's own pricer** (`src/data/review/quotes.ts`): Black-Scholes on the
  name's live vol, with a smile and the skew puts pay, inside a spread that widens away from the money. A quote is a
  **bid**, an **ask**, and the **mark** between them, with delta, theta a day and implied vol worked out from it.
- **Time left is counted by the real clock**: the sessions after today up to the expiry, plus what is left of today's
  09:30–16:00. A same-day contract loses its time value through the day, the way a real one does.
- **Decay is not charged — it is in the price.**
- Listed expiries: the funds' dailies (SPY, QQQ, IWM), six weeklies, three monthlies — the backtest's list, from today.
  Today's expiry leaves the list at 16:00.
- What can be traded: **long calls and puts**, and **vertical spreads bought for a debit** (a bull call spread, a bear put
  spread) — the backtest's contracts, paid in cash. Spreads sold for a credit are the third round's (below).
- **Index options** (2026-09-22 — Noah: "we will have index options so make our price feed carry that"): **SPX, NDX and
  RUT**, each made from its fund at the ratio its futures use and no carry — SPX is SPY × 10, NDX is QQQ × 41, RUT is
  IWM × 10 — so ES trades over SPX by exactly its 12 points of carry. Strikes every 5 points (SPX, RUT) and 25 (NDX); a
  contract every session, as the funds list; the same pricer on the index's level and its fund's vol; a hundred to the
  point; settled in cash at the bell. An index is never asked of the simulator by its own name: its level and its candles
  are its fund's, turned. Only the Live Chart offers them; an evaluation does not (futures only).

### Futures

| Product | What it is | Priced off | A point is worth | Tick | A tick is worth | Day margin |
| --- | --- | --- | --- | --- | --- | --- |
| ES | S&P 500 futures | SPY × 10, plus 12 points | $50 | 0.25 | $12.50 | $1,500 |
| MES | the micro | the same | $5 | 0.25 | $1.25 | $150 |
| NQ | Nasdaq 100 futures | QQQ × 41, plus 45 points | $20 | 0.25 | $5.00 | $2,200 |
| MNQ | the micro | the same | $2 | 0.25 | $0.50 | $220 |
| RTY | Russell 2000 futures | IWM × 10, plus 6 points | $50 | 0.10 | $5.00 | $1,000 |
| M2K | the micro | the same | $5 | 0.10 | $0.50 | $100 |

- The price is the fund's live price times the index's ratio, plus a **fixed carry** (the house's index lens uses the same
  ratios; its carry drifts a little, this one does not, so a futures chart never jumps when the fund crosses a dollar).
  On the product's tick. The chart of a future is the fund's own candles, turned into the future's price.
- Oil, gold and silver are on the backtest, not here: the live feed has nothing to price them off.

## Orders and fills

Orders are checked **on every tick of the feed** (today, every second and a half).

**Options** — the backtest's table, on the live quote:

| Order | Fills when | At |
| --- | --- | --- |
| Market buy · sell | at once | the ask · the bid |
| Limit buy at L | the ask is at or under L | the ask, never above L |
| Limit sell at L | the bid is at or over L | the bid, never under L |
| Stop sell at S | the bid is at or under S | the bid |
| Target · stop **on the name** at N | the name is at or past N (the backtest's two sides) | the bid |

A **dead quote gives no fill** (a zero bid, or a spread wider than 60% of the mark). The order waits.

**Futures** — the backtest's rules, leaning against the reader the same way:

| Order | Fills when | At |
| --- | --- | --- |
| Market | at once | the price, **one tick against you** |
| Limit buy at L (sell: the mirror) | the price trades **through** L, a tick under it — a touch is not a fill | L |
| Stop at S (a way out, or a way in: a buy stop above the price buys the break) | the price reaches S | S, one tick against you — or the price, if it jumped past S |

- **The ladder of ways out** is the backtest's, unchanged (`review-backtest-rules.md`, `review-futures-rules.md`): up to
  three targets and two stops a position, as one group; a fill on one side makes the other side give up that many
  contracts, the furthest first; flat, everything goes; a market order out by hand is never spoken for. **Breakeven** and
  **trailing** ride a stop as they do there — a trailing stop is checked where it stands on a tick, and only then moved by
  it.
- **A reversal** (futures): an order past flat closes the position and opens the rest the other way, as on the backtest.
- **Fees**: options $0.65 a contract each way (both legs of a spread); futures $2.00 ($0.50 for a micro).
- **A day order** is cancelled at the end of the trading day (17:00 New York). A GTC order waits until it fills or is
  cancelled — and, on the simulated feed, until the page closes.
- **Expiry**: at 16:00 New York on its expiry date, a held option settles at what it is worth in the money, at the name's
  price then; what was working on it is cancelled.

## Money

- **Cash** — what the account started with, plus everything closed, less every fee. Buying an option spends cash.
- **Worth** — cash, plus what the options held would sell for at the bid, plus what the futures held are up or down.
- **Margin** — a future sets its day margin aside (the table above). It is not spent; it is held.
- **Free** — cash, plus what the futures are up or down, less the margin held: what can pay for an option or margin a
  new future. A way in that needs more than is free is refused, in words.
- **Today** — what the account is up or down since this trading day began. **All time** — since the account began.

## The day

- A **trading day** runs from **17:00 New York to 17:00 the next day** (the futures day, and the one every prop firm
  counts by). A moment belongs to the trading day that ends after it: 10:00 Tuesday is Tuesday's; 20:00 Tuesday is
  Wednesday's; the weekend belongs to Monday's; a market holiday to the next session's.
- At 17:00 the day **rolls**: day orders are cancelled, the day's closing figures are written down, the next day begins
  from what the account is worth then.

## An evaluation

An evaluation is a practice run at a prop firm's test. **Its rules are hard blocks and hard stops**, and none of them ever
refuses a way **out** of a position.

| Plan | Starts at | Target | Most it may lose (trailing) | Most a day may lose | Contracts at once |
| --- | --- | --- | --- | --- | --- |
| 50K | $50,000 | +$3,000 | $2,000 | $1,000 | 5 |
| 100K | $100,000 | +$6,000 | $3,000 | $2,000 | 10 |
| 150K | $150,000 | +$9,000 | $4,500 | $3,000 | 15 |

On the page the plans are this same small table — a head row of **Target · Loss limit · Daily limit · Contracts** over a
plan a row (`components/paper/PlanRows.tsx`), on the start page and behind the account card's New door; a phone lays each
plan as its own block, the four figures under their own labels. It replaced a run-on line ("target +$3,000 · may lose
$2,000 · a day $1,000 · 5 at once") that Noah read and could not follow (2026-09-26).

And on every plan:

- **Futures only.** An option is refused, in words.
- **Contracts at once** counts the big contracts: ten micros are one. A way in that would carry the count over the plan's
  is refused.
- **The floor** — the most it may lose is measured from the account's high mark, and follows it up: the floor is the
  high mark less the allowance. **End of day** (how the plans start): the high mark is the best closing balance of a day.
  **Intraday** (the engine's other setting, which no page offers since the Evaluation page went): the high mark is the
  most the account was ever worth, open trades included, so a trade given back counts. Either way, **the floor stops rising once it reaches the starting balance**, and stays there.
  The floor is enforced **as it happens**: worth at or under the floor, and the evaluation is **failed** — everything is
  closed at the market, what was working is cancelled, and the account is shut.
- **The day's limit** — worth at or under the day's start less the plan's day allowance, and **the day is over**:
  everything is closed at the market, what was working is cancelled, and no way in is taken until the next trading day.
  It is not a fail.
- **Flat by 16:59 New York.** At 16:59 everything open is closed at the market and what is working is cancelled; from
  16:59 to the roll at 17:00, no way in is taken. Nothing is carried into the next day.
- **Minimum days**: the target counts once the account has traded on at least **2 trading days** (a day counts when a
  trade closed on it).
- **One day may not be most of it**: when the target is reached, the best day's profit has to be at most **half** of the
  whole profit. Until it is, the evaluation runs on — the target, in effect, is further off, and the account card's bar
  says so ("raised").
- **Passed** is written at the roll that closes a day on or over the target, with the minimum days traded and the best-day
  rule met. A passed evaluation is shut; its record stays.
- The reader may **end** an evaluation at any time. It is written down as ended — not passed, not failed.
- **The liquidation line**: with a future open, the chart draws the price at which the account would reach the nearer of
  the floor and the day's limit, if nothing else moved — exact with one position open, and labelled that way with more.

## Tilt watch (round 3)

The rules above stop a trader when the number is hit. Tilt watch looks at what they **do** — on by default, a switch on
the account:

- **A stop moved further off** while the position is losing.
- **Back in the same way within 10 seconds** of being stopped out, at more than one and a half times the size.
- **A way in at more than twice the day's usual size** within a minute of a losing trade.

Three of these inside ten minutes, and **no new way in is taken for fifteen minutes**. A way out is never refused. The
reader can end the pause early; the account says it was ended early.

## Realistic fills and the sandbox (round 3)

- **Queued limits** (a switch, on by default in an evaluation): a resting futures limit joins the back of the line at its
  price — the contracts showing there when it was placed — and fills only once enough has traded at that price to clear
  them. The feed publishes a bar's volume, not every print, so the line is **an estimate**, and the order says so.
- **The sandbox** (practice only): fees off, and futures fill at the price with no tick against you. The account says so
  in its head.

## When the page closes (the simulated feed)

The simulator makes a **new market on every page load**, so nothing open can honestly be carried across one:

- When the page closes or reloads, **everything open is closed at the last price the page saw** and everything working is
  cancelled. The fills say so ("the page closed").
- If the page did not get the chance (a crash, a killed tab), the next load closes what was left open at the last price
  that page wrote down, and says so.
- The account itself — its cash, its trades, its days, an evaluation's record — carries across reloads.

With the real feed this section goes away and positions stay open across a reload. Orders are still **watched only while
the terminal is open in a browser**: a prop firm's server watches round the clock, and that needs the backend. The
account lives in this browser until accounts move to the server.

## One tab at a time

The account is **held by one tab**. A second tab opens the Live Chart read-only, says the account is open elsewhere, and can
take it over — the first tab then goes read-only. Two tabs trading one account against two different simulated markets
would write nonsense into it.

## Fill alerts

A fill, a stop, a target, an expiry, a day that ended, a failed or passed evaluation — each is said **where the reader is,
on any page**: a chip at the window's top right beside the alerts' own, for a few seconds, that opens the Live Chart. A chime
rings where Settings says alerts are heard out loud.

## The journal

Paper has **its own journal** again, calendar first (2026-09-25 — Noah, on the partner's: "i love the calendar view as
the first thing that greets you … i want cool but not over the top charts or graphs or any visual thing that can
showcase the users pnl in many formats, alltime, this month, etc. when clicking on a certain calendar date you should be
able to see all of the trades you took with accounts etc."; the first paper journal was taken out on 2026-09-22), and
**redrawn on 2026-09-26** after his look at the first cut ("the charts are very ugly, spacing is horrible, the calendar
should be the nice curved corners … i want a complete redesign"). Practice › Journal (`/practice/journal`) reads every
paper account's closed trades in its **Paper** book; its **Backtest** book reads the backtest sessions' on the same page —
one journal, two books, never mixed (the book rides the address, `?book=backtest`).

- **The period** — Today · This week · This month · This year · All time — and **the account** (every one, or one) set
  what the page shows. The head carries four figures (made or lost, trades, won, the profit factor) and a sentence in
  plain words (the best day and the worst).
- **A change is a soft swap, never a cut** (Noah, 2026-09-26: the switch from Paper to Backtest "changes the page really
  quickly and it should be smooth"): switching the book, the period, the account or the open day fades out only the parts
  the change touches (160ms) and fades the new in (320ms) — a period switch leaves the calendar standing; the pills, the
  account card and the calendar's ring move at once. The Map's own swap, on the same clock.
- **The month comes first**, the way the partner laid his and Noah asked for: **a rounded card a day, air between them,
  Sunday to Saturday**, and a card for each week's total. A day that closed something wears what it made — its figure in
  its ink, its ground and its edge washed in that ink, deeper the bigger the day — with how many closed and won; today's
  edge is silver, the open day wears a silver ring, a small pen marks a day with words (it was a dot; "why do some of
  these have a little circle on them" — a mark that is not a figure has to say what it is). **A day is the calendar day the trade
  closed on, New York's** — the desk's RP&L counts a trading day that turns at 17:00, but a journal's calendar is a
  calendar: a Friday-night future is Friday's here (the first cut called Monday "today" on a Friday night).
- **Beside the month, the period's figures** (side by side only from 1400px wide — narrower, the figures go under the
  month, because a four-figure day needs 60px of card and at 1280 a card beside the figures had 69 with its padding; under
  1024 the board scrolls inside its box at 760px): won · lost, what the winners made and the losers lost, the profit factor,
  the average win and loss, what a trade was worth, the best and worst trade and day, the longest run of wins and of
  losses and the run you stand in, the worst drop from a high, what you kept of the best, how long you held on average.
- **A day opens under the month, across the page**: its total and counts, **every trade with the account it was on** in
  the house's grid (when it closed, the account, the contract, size, in → out, held, how far it went against and for you,
  how it ended, what it made — a row opens the trade's own page), how the day went once there are two trades, and the
  day's words — the plan before, the review after, a pair per account traded that day (a tab each), kept as they are
  typed.
- **The period, drawn**: the running total as a curve through a point a trade on the chart library, and **what each day
  made as slim rounded bars** drawn by the page — a bar a day, green up and red down from a baseline, the scale's ceiling
  and floor at the right, a few days named underneath, and **a card beside the bar under the pointer — never over it**
  (to the right of a bar in the left half, to the left in the right half, its head at an up bar's tip and its foot at a
  down bar's; the first cut's card sat on the bar: "the hover effect on this is covering the actual section that is being
  hovered over"). The library's histogram had painted two days as two slabs: "this looks old school". A press on a point or a bar opens that day; the pressed bar
  wears no ring or border — the day open under the calendar says which it is.
- **The month and the figures beside it end level**: the calendar's weeks grow to the figures' height, or the figures'
  groups spread to the calendar's.
- **Five cuts** of the period (the hour you got in, the weekday, the name, long or short, the sizes of wins and losses),
  then **every trade in the period**, and the period as a CSV.
- The period, the account, the open day and the month ride the address, so Back from a trade comes home as it was left.
- **The sample accounts (for now).** Until launch the journal carries two sample accounts — a practice account and a 50K
  evaluation — with a September of trades made by the engine itself on a made-up market (`src/data/paper/sample.ts`),
  so a first look at the journal is a full month, not a blank one (Noah, 2026-09-26, before showing his partner).
  Every sample trade has what a real one has: its candles, its ticks, its day, a few with words. The head offers
  **Hide the sample**, kept on this machine; `SAMPLE_JOURNAL` in that file is the switch, and it comes out before launch
  — nobody's journal ships with trades they did not make. The sample never appears on the Live Chart.
- **A trade's own page** draws a target or a stop on the "while you held it" figure only when it lies within reach of
  what the trade actually did — a way out far off the path is named in the facts above it, not drawn (it pressed the
  whole figure into a flat line).

## Selling, margin and what each plan allows (2026-10-29 — current)

The owner, verbatim: "allow everything on paper trading, but on the free reign mode, but if people are using accounts
that we have up for props only offer what the prop offers". Code: `src/data/paper/engine.ts` (the book, orders, expiry),
`margin.ts` (what shorts hold), `rules.ts` (`allowSell`, `longOnlyOn`, the whitelist, the 16:10 close), `propFirms.ts`
and `whitelists.ts` (the firms' data). Checked by `scripts/paper-proof.ts` (hand-worked numbers on a fixed-quote market)
and `scripts/golden/paper-golden.ts` §6–11 (SPY's recorded 0DTE chain of 2026-10-29, 09:30–16:15).

**Selling.** A sell with nothing held opens a short; a buy of a contract held short closes it. A way out never goes past
flat (refused in words: "You hold 2 short — buy back no more than that"). Fills are the NBBO's: **a sale at the bid, a
buy at the ask** (a limit never worse than its price). Fees as before, a contract a leg each way.

- **Short calls and puts**, naked included (practice only — see the plans below).
- **Credit spreads**: a vertical sold — the near strike sold, the far one bought, as one order (`{ strike, short }`
  sold: its bid is the near leg's bid less the far leg's ask). Debit spreads as before.
- **Iron condors and iron butterflies**: two spreads sold as **one order** (`optPlaceCombo`): at the market every leg fills
  at once at its own bid or ask; a limit waits until the legs bring in its net credit, then all fill together, or none.
  Cancelling one leg cancels the order. A spread can also be put on in two orders ("legged"): a call sold against a long
  call held on the same expiry is margined as the pair.
- **Cash-secured puts**: a put sold with its strike × 100 held.
- **Covered calls are not offered**: they need 100 shares a contract and this desk holds no stock. The Strategies card
  says so and points to a call spread.
- Targets and stops (the ladder) ride longs only; a short's way out is a buy back — at the ask, a limit (fills when the
  ask comes down to it, at the ask), or a buy stop (fills when the ask rises to it).
- **Fills only in the options session.** After the bell the feed's last quotes still read as new, so a resting order
  does not fill on them (this held for buys too and was not enforced before); the minutes it missed are replayed from the
  history as before.

**Margin and buying power** (`margin.ts`, re-marked on every tick). Free = cash − what the open shorts hold:

| Position | Holds (the premium it took in is in cash, so the net is its whole loss) |
| --- | --- |
| A long, a debit spread | nothing more — paid in full |
| A credit spread | width × 100 (net: width − credit) |
| An iron condor / butterfly | the most the two spreads can lose at expiry, once (net: the wider side − both credits) |
| A cash-secured put | strike × 100 (net: strike − premium) |
| A single sold against a long of the same kind, same expiry or later (a calendar, a diagonal) | the distance between the strikes where the long is further out, else nothing |
| A naked call and a naked put on one name (a short straddle or strangle) | **once** (CBOE): the greater of the two sides' Reg T estimates plus the other side's premium now — 510C and 490P sold at 2.00 with SPY at 500: 9,200 + 200 = **9,400**, not 18,400 |
| A naked short (practice) | **Reg T estimate**: the greater of 20% × the name − out of the money + the premium now, or 10% × the name (a call) / the strike (a put) + the premium — 15% / 10% on a broad-based index (SPX, NDX, RUT, XSP, VIX …). An estimate: a broker's own figure can differ |

The account card shows **Free** and **Margin held**. **A margin call** is free under zero — cash under what the open
shorts hold. A long option held is not counted toward it: under Reg T a listed option has no loan value (2026-10-31; it
was free plus the longs at their bid): every new way in is refused with the call in words, ways out are not, and
nothing is sold off by itself (no plan here says otherwise).

**Expiry and assignment.** At 16:00 a short settles at what it is worth in the money on the 16:00 print, bought back in
cash with no fee: an index is cash-settled; a stock or fund in the money is **assigned and settled in cash at intrinsic**
(the desk holds no stock, so no shares change hands — the trade says so); out of the money it expires worthless. A spread
sold settles inside its width. Shorts obey each plan's flat-by and expiry-close rules like longs (bought back at the ask).

**The 16:10 close** (Options Funding, Strix): an expiring SPY, QQQ, IWM or DIA contract trades on to 16:15. It is not
settled at the bell; at 16:10 the rules close it at that minute's live bid (a short at the ask); in that window it may
still be closed by hand. With no quote standing at 16:10 it settles at the 16:00 close and says so.

**What each plan allows** (`allowSell` in `rules.ts`, refused in `ruleRefusal` in words):

| Account | Allows | Data |
| --- | --- | --- |
| Practice ("free reign") | everything, naked shorts on the Reg T estimate | no plan |
| Your own rules | chosen: everything (default), capped loss only, or buys only | `CustomRules.selling` |
| Vanquish Basic, Rapid Express, Rapid Elite | buy only, single legs | `allowSell: 'none'`, `spreads: false` |
| Vanquish Advanced | **Level 4**: spreads bought and sold, condors, butterflies, puts cash-secured; a call sold only as a spread or against a long call (no margin) | `allowSell: 'level4'` |
| every Vanquish plan | SPX, XSP, VIX: single calls and puts bought only | `longOnlyOn: ['SPX','XSP','VIX']` |
| Strix Pro | **defined risk**: credit and debit spreads, condors, puts held at their whole loss, a call only with a long call over it | `allowSell: 'definedRisk'` |
| Strix, Strix Express, Options Funding Growth and Express, TradeFundrr | buy only | `allowSell: 'none'` |

Options Funding trades only the **275 names of its whitelist** (`whitelists.ts`: optionsfunding.co/ticker-whitelist,
read 2026-10-29; a name compares without dots, so BRK.B is the list's BRKB). Strix names a 275-symbol list of its own
that was not read here, so Strix plans do not check names and say so. A plan saved before these fields is read with the
firm's current permissions when it loads (`store.ts migrate`).

## Practice math (2026-10-31 audit — current)

Every rule below has a known-number check in `scripts/paper-proof.ts` (paper) and `scripts/review-engine-proof.ts`
(backtest) under "the Practice math audit".

- **Average cost is a running average.** Each way in adds its premium (and its fee) to what is held; each way out takes
  its share — the average × the contracts sold — back out, and what it made against that average is banked. A buy after
  a partial sale averages with what is left, not with what was sold. Buy 2 @ 1.00, sell 1 @ 2.00, buy 1 @ 3.00, marked
  at 3.00: average **2.00**, banked **$100**, open **$200** (equity +$300 either way; the old lifetime average said 1.67,
  $33.33 and $266.67, and the balance a firm's target and drawdown read was $66.67 short). A closed trade's `avgIn` is
  still the average of every way in (what the trade paid), and its P&L is its cash, unchanged.
- **Early closes** (`core/calendar` EARLY_CLOSES: the day after Thanksgiving, July 3, December 24). The options session
  ends at **13:00**: the bell (`clock.ts bellOf`) is 13:00, a contract expiring that day settles then, the session stops
  taking fills (`feed.ts optionsOpen`), and a late name's window runs to 13:15 (catch-up replays to there, not 16:15).
  **Time to expiry** is the trading clock's: session minutes left today plus each later session's own minutes (210 on an
  early close) over 390 × 252 — no five-minute floor, 0 at the close. A contract expiring 2026-11-27 has 210/390 of a
  session before that open; from the Wednesday before, 390 + 210 = 600 minutes.
  **A quote is fresh** when it was read in the last 8 seconds, is not a kept one, carries today's stamp, and — past the
  day's close — changed after the close. A snapshot read at 13:30 that answers with the 12:59 quote is frozen and fills
  nothing. **A plan's times** written against the 16:00 bell keep their distance from the real close: flat by 15:55 →
  12:55, 15:59 → 12:59, the 16:10 close → 13:10; a time between 13:00 and 15:00 is 12:59; a time before 13:00 stands.
  The words on the page still say the plan's own time (a UI follow-up).
- **The drawdown is the equity curve's** — its worst fall from a high, open trades in. A backtest reads it off its
  minute curve (`review/engine.ts equityCurveOf`: cash and every contract held at its mid, each minute from the first
  fill to the clock; `sessionStatsOf`); a paper account off its ticks (`PaperAccount.curve`, kept from 2026-10-31; an
  older account reads its days' highs and lows, worst order first: `paperCurveOf`). Two trades down $300 each in the
  same minute and closed +$50 each: **$600**, where the closed trades and each trade's own low said $300. Given no curve
  (an imported journal) `statsOf` still reads the trades, and says so (`drawdownFrom: 'trades'`).
- **A $0 trade is a scratch** — not a win, not a loss, out of the win rate (wins ÷ wins and losses), and it neither
  starts nor breaks a losing run.
- **Sharpe and Sortino** are on the daily equity returns (the start, then each day's close: a backtest's bells, a paper
  account's ledger), annualised by √252, no risk-free rate taken off: mean ÷ sample standard deviation; mean ÷ downside
  deviation (√ of the mean squared negative return over every day). +1%, −1%, +1%: Sharpe 4.58, Sortino 9.17. Fewer
  than three points: none said.
- **A fill takes at most the size the quote shows** (paper and backtest, one model: `review/quotes.ts fillableQty`). A
  buy takes the ask's size, a sell the bid's; a spread the fewer its legs show on that side (bought: the long leg's ask
  and the short leg's bid). What the quote cannot fill stays working: a limit at its price, a market order as a market
  order that fills on the following quotes (the next live quote, the next recorded minute) — each quote's size is taken
  once (the order keeps the quote's stamp and what it took of it). A bracket goes on once all of the buy has filled, for
  all of it. Not capped: a leg of an order of several (the legs fill together or not at all), the rules' and the page's
  closes, a settlement — and any quote that carries no size (an old saved backtest day). Market buy 5 against an ask
  showing 3: 3 now, 2 on the next quote.
- **VIX options** (`clock.ts vixSchedule`): the listed expiration is the Wednesday they settle; they **last trade on the
  Tuesday before** (its close ends trading, and their time to expiry is counted to it). They settle on **the VIX index's
  opening print of the settlement day** (the first real bar's open) — the best stand-in for the special opening quotation
  (SOQ), which the feed does not carry, and the trade says so. Never on the 16:00 close. Held into Wednesday: it waits
  for that print (asked from 09:32:30).
