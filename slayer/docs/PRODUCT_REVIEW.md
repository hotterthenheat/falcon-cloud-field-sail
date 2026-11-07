# Product review: making Slayer stop looking like finance software

Written 2026-11-07, Friday evening ET, against the live app at `localhost:8080`. Every page in the router was browsed
read-only with Playwright at 1440×900 in the dark theme, the main pages again in the light theme, and nine pages at a
390×844 phone width. That makes 65 screenshots, kept outside the repo in the session scratchpad
(`.../scratchpad/review/<name>.png`). Each page section below names its files.

**About the data.** The captures were taken after Friday's close. Quotes are "as of 19:59 ET", the Compass scan is
"the last session's scan, not live", the Weigher chain has rolled to Monday with no greeks yet, and several boxes
were still loading or empty (Terrain panes 2–4, the Pinpoint Board past SPY, the Backtest and Journal with no
sessions). This review judges the design, not the numbers. The quiet state still matters, though. It is what a
weekend or evening visitor sees, and the product has nothing designed for it (see "After-hours" in Part 2).

**About the figures in the wireframes.** Numbers quoted as "today" or "before" are copied from the screenshots. The
figures inside the "after" wireframes (comparisons with Thursday, calibration dots, ledger counts, autopsy splits,
equity lines) are illustrative and show the shape of the answer, not measured results. The one exception is the
autopsy example, which uses the real fill and exit of a Nov 6 Blotter row (SPY 736C) with an invented split.

**The owner's constraints this review respects.** Vendors are never named on screen. Compass shows no model
probability %, no fees, and labels its models Model 1/2/3. Compass stays focused on long calls and puts. Nothing here
proposes an ask cap, or any price cap, in the scanner logic: a contract's cost is something to show, never a filter.
Part 3 lists where the current build breaks the Compass rules.

---

## Contents

- [The verdict](#the-verdict)
- [Scorecard: nine questions, every page](#scorecard)
- [Benchmarks in brief](#benchmarks)
- Part 1, page by page
  - [Pulse](#pulse) · [Terrain](#terrain) · [Trace](#trace) · [Dossier](#dossier) · [Pinpoint](#pinpoint)
    · [Compass](#compass) · [Weigher](#weigher) · [Practice: Paper, Backtest, Journal](#practice)
    · [Start, Community, Status and the shell](#shell-pages)
- Part 2, across the product
  - [A design language that is unmistakably Slayer](#design-language)
  - [Consistency problems between pages](#consistency)
  - [Navigation](#navigation)
  - [Onboarding and the after-hours state](#onboarding)
  - [Connecting every page to the user's own trades](#your-trades)
  - [The ten highest-impact changes, ranked](#top-ten)
- [Part 3: Compass rule compliance, as built today](#compliance)
- [Screenshot index](#screenshots)

---

<a id="the-verdict"></a>
## The verdict

Slayer is already more honest than its competitors. It stamps kept data "as of", refuses stand-in numbers, writes a
plain-English sentence over most grids, keeps an official Compass record that shows its losses (15 won, 51 lost on
the Blotter), and has a voice that says "floor packages, not a bet". Almost no product in the category does any of
that.

The **form** is still standard finance software. Almost every page uses the same frame:

```
Title · subtitle
┌ Box title · How to read ─────────────────────── KPI · KPI · KPI · KPI · KPI ┐
│ [FILTER ▾] [FILTER ▾] [FILTER ▾] [FILTER ▾] [FILTER ▾] [COLUMNS 9/14 ▾]     │
│ One sentence at 14 px that ends in "more"                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│ a 9–14 column grid, every cell the same size and weight                     │
```

That frame appears on about 25 of the ~35 pages. The answer (the sentence) is the smallest text in the box and sits
under the controls. The most important number shares one type size with forty others. The time dimension exists
(Pinpoint's Replay, Earnings' "today's price, replayed", the Compass record), but only as a feature on a few pages,
never as the grammar of the product. The user's own trades are read on three pages (Weigher, Pinpoint, Pulse's
"My book"), kept in a separate store from the watchlist drawer, Trace's marks and the paper accounts, and absent
from Trace, Dossier, Terrain and Compass.

The redesign comes down to four moves:

1. **Answer first.** Every page opens with its answer as a headline, with the one number that matters set large.
   The grid becomes the evidence behind a "Show the rows" door, not the page.
2. **Show where every number came from and how sure it is.** Printed, computed or modelled, plus a range wherever a
   model is involved.
3. **Make time the default axis.** "Since you last looked", "how we got here", and a scrubber on every page that has
   a session.
4. **Put the user's own book on every page.** One store for what you hold, watch and followed. Every page draws your
   contracts on its strike axis and adds one line on what this page means for them.

Done together, those four moves make Slayer the product that "sells the receipt, not the signal", the direction
`docs/product-research/Retail options product opportunities.md` and `docs/KEYS_AUDIT.md` §5 already argue for, and
something no competitor's screenshot looks like.

---

<a id="scorecard"></a>
## Scorecard: nine questions, every page

✓ does it well · ~ partly · ✗ does not. Judged from the screenshots and the code.

| Page | 3-second question | Dominant number | What changed | Uncertainty / source | Explains itself | Your trades | Time | Motion for meaning | Unlike competitors |
|---|---|---|---|---|---|---|---|---|---|
| Pulse | ✗ | ✗ | ✗ | ✗ | ~ | ~ (My book desk) | ✗ | ✗ | ✗ |
| Terrain | ~ (a chart) | ✗ | ✗ | ~ (cone) | ✗ | ✗ | ~ (replay) | ~ | ~ (cone, field) |
| Trace (11 pages) | ~ (sentence) | ✗ | ~ | ✗ | ~ | ✗ (marks only) | ~ (Intervals) | ✗ | ✗ |
| Dossier lists | ~ | ✗ | ~ ("lag", "vs last filing") | ~ (source line) | ✓ | ✗ | ✗ | ✗ | ✗ |
| Dossier name files | ✓ (Earnings name) | ✓ (Earnings name) | ~ | ✓ (covered/fell short) | ✓ | ✗ | ✓ (replayed) | ✗ | ✓ |
| Pinpoint Map | ✗ | ✗ | ~ (flip today) | ✗ (sign assumed) | ~ (first-time banner) | ~ (positions) | ~ (Replay) | ✗ | ✗ |
| Pinpoint Agenda | ✓ ("Watch 736 first") | ✓ | ~ (built/drained) | ✗ (model odds read as history) | ✓ | ~ | ~ | ✗ | ~ |
| Pinpoint Board / Compare | ✗ | ✗ | ✗ | ✗ | ✗ (third-order greeks) | ✗ | ✗ | ✗ | ✗ |
| Compass scan | ~ | ✗ (a model % dominates) | ~ | ✗ (and against the rule) | ~ | ✗ | ~ | ✗ | ~ |
| Compass contract page | ✓ | ~ | ✓ (from the call) | ~ (spread cost shown) | ✓ | ✗ | ✓ (track) | ~ | ✓ |
| Compass Blotter / Tracker / Study | ~ | ✗ | ✗ | ✗ | ~ | ✗ | ✗ | ✗ | ~ (honest record) |
| Weigher | ✗ | ✗ | ✗ | ~ ("ITM · model" column) | ~ | ✓ (positions) | ✗ | ✗ | ✗ |
| Paper / Backtest / Journal | ~ | ✗ | ✗ | ~ (95% range in Report) | ✓ | ✓ | ~ (calendar) | ✗ | ~ |

The only page that answers yes to most of the nine questions is the **Earnings name file**
(`dossier-earnings-nvda-dark.png`): "Options price ±9.0% · usually moves ±4.0% · 2.25× rich", then "Today's price,
replayed: covered it 0 of 8 times". It is the template for the rest of the product.

---

<a id="benchmarks"></a>
## Benchmarks in brief

**The standard look, and where Slayer sits inside it.**

- **Bloomberg Launchpad, thinkorswim.** Dense grids, user-built panels, every number at one weight, colour for up and
  down. Pulse (tiles), Terrain (1–6 panes) and the Map (a 9-column matrix) are this shape.
- **Unusual Whales.** A flow tape of 12+ columns, chip filters, "bullish/bearish" sentiment tags, a dark-pool grid,
  congress and insider lists. Trace and the Dossier lists follow this model closely: same objects, same columns, same
  filter-chip row. That is the main reason the product reads as "standard".
- **SpotGamma** (HIRO, TRACE, Equity Hub). GEX by strike as horizontal bars, heatmap over time, key levels in a side
  table. Pinpoint's Map, the Pulse book tile and Terrain's strike rail are this shape. The owner's brief rules out
  "one more GEX bar chart".
- **TradingView.** Chart-first, indicator legend, drawing rail. Terrain is a faithful port (`docs/terrain-ui-port.md`).

**Products that broke from the conventions, and what to take from each.**

- **Robinhood (2014–2017).** One number per screen, huge (the portfolio value). One line chart you scrub with a
  finger, the value following the finger. Green or red applied to the whole screen as the day's verdict. Nothing else
  above the fold. *Take:* one hero number per page, scrub-to-read, and a whole-page verdict tint instead of colouring
  every cell.
- **Linear.** Calm density, keyboard first, opinionated defaults, a command bar that does things as well as finding
  them, almost no chrome. *Take:* fewer controls on screen; filters live in the command bar and in the URL, not as
  ten dropdowns per box.
- **Stripe dashboard.** Each metric is a headline number, a comparison ("+12% vs last week"), a sparkline with the
  comparison period ghosted behind it, and annotations on the line where something happened. *Take:* "vs when"
  stated on every number, the ghost line, and annotated events.
- **Our World in Data.** Every chart has a source tab ("Sources & processing"), a time slider, a "change over time"
  mode and a plain-English title that is a claim ("Life expectancy has doubled"). *Take:* claim-titles, a provenance
  tab on every figure, a time slider as standard furniture.
- **FiveThirtyEight forecasts.** Uncertainty drawn, not footnoted: fan charts, dot-plots of simulated outcomes, "how
  our forecast works" one click from every number, and model probabilities kept visually apart from results.
  *Take:* ranges and calibration ("of the levels we gave 90%+, how many were touched") as first-class visuals.
- **Apple Stocks.** One line, scrub for values, the news under the chart for the same name, nothing else. *Take:* the
  phone version of every page: one chart, one answer, the story below it.

---

# Part 1: page by page

Each page gets: what it is today, what is standard about it, the 3–6 highest-impact changes (before → after, with
layouts and copy), and an effort size. **S** is up to 3 days, **M** 1–2 weeks, **L** more than 2 weeks.

---

<a id="pulse"></a>
## Pulse (`/pulse`)

**Screenshots:** `pulse-dark.png`, `pulse-light.png`, `pulse-dark-full.png`, `pulse-phone.png`

### What it is today

The landing desk inside the terminal. A react-grid-layout board (12 columns, rows of 88 px) of tiles the reader adds,
drags and resizes, saved as named desks: five presets ("The session", "The open", "0DTE", "The close", "My book")
plus the reader's own. The 13 widgets include Live chart, The book (GEX by strike, ladder or matrix), Key levels,
Where the walls are heading, Targets, Head to head, Compass setups, The chain, Positions & watchlist, Vol outlook
(the only tile that tags its figures "modelled"), News, Earnings, Stocks, Insiders & Congress, and Session clock.
Each tile links out to its full page. The default desk shows a chart, a GEX-by-strike list (−$1.8B at 735, −$1.4B at
740), a dot plot of where the call wall, supreme, flip and put wall sit, and a key-levels table. On a phone, Pulse is
one chart and nothing else.

### What's standard about it

It is a Bloomberg Launchpad / thinkorswim workspace: a blank grid you are expected to build. Every tile has the same
chrome (drag dots, title, ticker chip, link icon, kebab menu) and the same weight, so nothing on the desk is the
headline. No tile says what changed since you last looked, and no tile answers "what should I pay attention to right
now?". The book tile is a GEX bar list, the exact chart the brief rules out. The phone view drops everything that
makes Pulse Pulse.

### Changes

**1. Replace the default desk with a "Brief" column; keep the grid for builders.** (M)

Before: four equal tiles, a chart top left.
After: the first visit and the "The session" preset open on a fixed two-column page. The left column is a written
brief, generated from data the page already reads. The right column is the chart. The grid desks stay one tab away
for people who build their own.

```
┌ Pulse · Fri Nov 6 close → Mon Nov 9 ─────────────────────────────────────────────┐
│                                                                                  │
│  SPY is pinned between 735 and 740,            ┌──────────── chart ────────────┐ │
│  and dealers will push, not absorb.            │  candles · levels on the axis │ │
│  ─────────────────────────────────             │  ghost of yesterday's path    │ │
│  −$797M  net gamma at spot  (was −$412M Thu)   │                               │ │
│                                                │                               │ │
│  1  Watch 736 first: priced 97% to touch*      └───────────────────────────────┘ │
│  2  Below 725 the selling accelerates ($1.6B)                                    │
│  3  CPI Tue 08:30: options price ±1.1% for SPY                                   │
│  ─────────────────────────────────                                               │
│  Your book · 2 positions                                                         │
│  SPY 740C Nov 13   needs +0.5% · sits on the call wall                           │
│  QQQ 650P Nov 9    expires Monday · 1.2% out of the money                        │
│  ─────────────────────────────────                                               │
│  Since you last looked (Thu 15:40)                                               │
│  · flip moved 744 → 747.20  · 14 Compass calls, 2 won · 3 insider buys >$1M      │
│                                                          * modelled, see Map     │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Copy rules for the headline: a claim, under 12 words, present tense, naming the name and a level ("SPY is pinned
between 735 and 740"). The secondary line is the hero number with its comparison ("−$797M net gamma at spot, was
−$412M Thursday"). Sources: `levelsForName`, `data/agenda.ts`, the flip from the book, and the economic calendar the
News page already reads.

**2. A "since you last looked" strip on Pulse, and the same strip on every page.** (M)

Before: no memory of the reader's last visit.
After: Pulse keeps `lastSeenAt` per page (localStorage now, account later) and diffs the keyed figures it already
reads: walls, flip, net GEX, Compass calls and outcomes, new filings for watched names, earnings dates moved. It
renders at most five chips, newest first. Clicking a chip scrubs the chart to that moment (see the time ribbon in
Part 2). Interaction: a chip that names a level makes that level pulse once on the chart axis. That is motion that
means "this is the thing that moved".

**3. Retire the GEX bar tile as a default; replace it with "the spine".** (M)

Before: "The book" tile, a vertical list of strikes with a dollar figure and a red or green bar each.
After: a slim vertical strike axis (one shared component, described in Part 2) showing only the 5–7 strikes that
matter: supreme (magenta), call wall, put wall, flip, spot plate, and your positions as lime tabs. Each mark has one
word ("pin", "trapdoor", "lid", "floor"). The full ladder opens on hover, or by going to the Map. One idea per tile,
not 40 rows.

**4. Make the phone version a Robinhood-style screen, not a bare chart.** (S)

Before: `pulse-phone.png` is a candlestick chart and a ticker chip. There is no level, no answer and no position.
After: from top to bottom, the headline sentence; the hero number; a line chart you scrub with a finger (the value
and the time follow the finger, levels drawn as labelled hairlines); "Your book" rows; then the "since you looked"
chips. Candles stay one tap away.

**5. Give the presets jobs, not times.** (S)

Before: "The session / The open / 0DTE / The close / My book" are layouts.
After: each preset is a question, and its headline answers it. "The open" asks "What is set up for the first hour?",
"0DTE" asks "Where does today's expiry pin?", "The close" asks "What has to happen by 16:00?", "My book" asks "Is
anything I hold in trouble?". The preset chip shows the question as its hover text, and the brief rewrites its
first line to answer it.

**Effort overall:** M (the brief and the strip reuse data the page already reads; the spine component is shared with
Pinpoint, Terrain and the Weigher).

---

<a id="terrain"></a>
## Terrain (`/terrain`)

**Screenshots:** `terrain-dark.png`, `terrain-dark-loaded.png`, `terrain-light.png`, `terrain-phone.png`

### What it is today

A TradingView-grade chart desk ported from the partner tree (`docs/terrain-ui-port.md`). It runs 1 to 6 panes in 15
layouts, each pane with its own name, timeframe and search; a tab strip; indicator, alert, theme, snapshot and replay
doors; and, per pane, a strike rail (Ladder / Matrix / Calendar / Surface / Regime) that renders GEX, DEX "+8" more
greeks per strike as heat-coloured bars. On the chart there is an implied-move cone (1σ dashed parabola), wall labels
on the axis ("740 CW −1.4B", "735 Top −1.8B"), an events lane, a dark-pool overlay, and the option prints from the
server's tape. Building (overnight OI change) is a rail tab. In our captures the side rail sat over the left edge of
pane 1. That is probably the stand-alone "slide over at the edge" behaviour firing on the headless pointer, but
worth a check.

### What's standard about it

It is TradingView with a SpotGamma ladder beside each chart. The ladder uses a yellow-to-green "thermal" ramp where
every strike is equally loud. That is a third colour grammar for the same quantity (see Consistency). The four-pane
default puts four equal charts on screen with nothing to compare across them. The cone is the one non-standard,
genuinely explanatory element, and it is drawn as a thin dashed line that reads as decoration.

### Changes

**1. Make the cone the hero and label it in words.** (S)

Before: a thin dashed parabola and a "1σ↑ 346.94" tag in the corner.
After: a filled band (10% opacity) for 1σ and a fainter one for 2σ, both clipped to the session's flat. A right-edge
label in words: "68% of Monday's closes land between 732 and 741, priced from 14.8% IV (modelled)". When price exits
the band, the band edge flashes once and the events lane gets a tick: "left the priced range 14:12". After the
close, the band of the day just ended stays, with the actual close marked inside or outside it. That builds the
"implied vs realised" scorecard from `KEYS_AUDIT.md` §5.6 directly on the chart.

**2. Collapse the strike rail to the spine by default; the ladder becomes a hover reveal.** (M)

Before: a 4-column-wide rail of colour bars on every pane, permanently open (`terrain-dark-loaded.png`: three rails
on three panes).
After: each pane carries the shared spine: 5–7 named levels, gold for put-dominant (amplify) and steel for
call-dominant (absorb), magenta for the supreme, lime tabs for your positions. Hovering the spine opens the full
ladder as an overlay for that pane only. The Matrix/Calendar/Surface/Regime views move to a single "Book" sheet
(shift+B). The chart gets roughly 30% more width.

**3. Replace "four charts" with "one chart and a question".** (M)

Before: the default desk is SPY, QQQ, AAPL and a fourth pane, all equal.
After: the default is one pane plus a "Compare" control that overlays a second name as a percentage line on the
same axis. The ink is the same pair Pinpoint Compare already uses. Multi-pane layouts stay in the Layout door for
people who want them, but the first view tells one story.

**4. Explain the field and the prints on the chart itself.** (S)

Before: wall labels like "738 −586M" and print marks with no legend on the chart.
After: the first time a session draws, a single dismissible annotation sits next to the largest wall: "Dealers hold
−$1.8B of gamma at 735. If price drops through it, their hedging sells more (amplify)". Print marks get a hover card
that says the same thing in the same words as the Trace row ("Bought at the ask, opening, 4.55× vol/OI").

**5. Your positions on the price axis.** (S)

Before: Terrain does not read `data/positions.ts`.
After: each held strike is a lime tab on the price axis with its breakeven as a dotted line, labelled "SPY 740C
breakeven 745.09". At most 3 tabs are drawn; the rest roll into a "+2" chip.

**Effort overall:** M.

---

<a id="trace"></a>
## Trace (`/trace/*`, 11 pages)

**Screenshots:** `trace-livetape-dark.png`, `trace-livetape-light.png`, `trace-livetape-phone.png`,
`trace-screener-dark.png`, `trace-netflow-dark.png`, `trace-odte-dark.png`, `trace-multileg-dark.png`,
`trace-intervals-dark.png`, `trace-footprints-dark.png`, `trace-watchers-dark.png`, `trace-darkpool-dark.png`,
`trace-compare-dark.png`, `trace-tracker-dark.png`

### What it is today

The options-flow and dark-pool room, on one vendor only. Eleven sub-pages:

- **Live Tape:** every print, with 7 filter dropdowns, a column picker, Pause and Save.
- **Dark Pool:** off-exchange crosses with an "accumulation/distribution" read.
- **Screener:** the day's contracts by activity.
- **Net Flow:** names ranked by net premium, with a price-and-flow chart.
- **0DTE:** four panes of same-day net call and put premium.
- **Multi-Leg:** prints rebuilt into spreads.
- **Intervals:** quarter-hour volume buckets.
- **Footprints:** overnight OI change by contract.
- **Watchers:** contracts flagged by rules, with a reason sentence.
- **Compare:** two names' flow.
- **Tracker:** your bookmarked prints.

Every page has the same frame: title, "How to read", a 4–6 figure KPI strip, a filter row, a one-sentence read
("The market leaned bullish today: $310.2M more net into calls. *more*"), and a grid.

### What's standard about it

This is the most "standard finance software" part of the product. Nearly every page is a 9–14 column grid with the
same objects and filter chips as the flow-tape products it competes with. The reads are good but small and
truncated. "Bullish/Bearish" tags in green and red repeat the industry's least trustworthy idea: direction inferred
from a print's side, which the literature puts at 59–83% accuracy (research doc). Eleven tabs for one dataset is a
navigation tax. The 0DTE page shows "Net puts −$20.5M" in red in its header and the same −$20.5M in green inside the
panes, because a negative put premium is bullish. The same number wears two inks on one screen.

### Changes

**1. Lead every Trace page with "The story of the tape", not the tape.** (M)

Before: KPI strip, then filters, then the sentence, then 2,446 rows.
After: a headline and a single explanatory chart; the rows sit behind a "Show the 2,446 prints" door.

```
┌ Live Tape · Fri Nov 6 ───────────────────────────────────────────────────────┐
│  Money leaned into calls by $310M, almost all of it before 11:00.            │
│  ────────────────────────────────────────────────────                        │
│   +$310M  net to calls     ▁▃▆█▇▅▃▂▁▁▁▂▁▁▁▂▃▂▁  (cumulative, 09:30 → 16:00)   │
│   three prints made a third of it:                                           │
│   ● SPXW 7400P  $159M  floor package, not a bet                              │
│   ● MU 700P     $34.8M bought at the ask, opening                            │
│   ● TSLA 360C   $42.5M swept across 4 venues                                 │
│  ────────────────────────────────────────────────────                        │
│  [ Show the 2,446 prints ]   [ Only names I hold ]   ⌘K to filter            │
└──────────────────────────────────────────────────────────────────────────────┘
```

The three named prints come from the existing "Most premium" and "Largest alert" KPIs plus the Watchers rules. The
cumulative line is the Net Flow chart's net series for the whole market.

**2. Merge 11 pages into 6, by the question they answer.** (M)

| New page | Question | Absorbs today's |
|---|---|---|
| The tape | What traded, and what mattered? | Live Tape, Watchers (as the "flagged" lens), Multi-Leg (as a "structures" lens) |
| Who's leaning | Which names is money leaning into? | Net Flow, Compare, Intervals (as a time zoom) |
| Same day | What does 0DTE money say about today's close? | 0DTE |
| Off exchange | Where did size cross away from the lit market? | Dark Pool |
| What stuck | What did yesterday's flow leave in open interest? | Footprints, Screener (as its "today's book" lens) |
| (moves to Your book) | What am I watching? | Tracker |

Lenses are a segmented control under the headline, not separate routes. Old routes redirect with the lens set, the
same pattern `App.tsx` already uses for `/flow-alerts` and `/windows`.

**3. Replace "BULLISH/BEARISH" with what was observed, and show the confidence.** (S)

Before: a green "BULLISH" or red "BEARISH" tag on a print, with "bid 60%" under it.
After: two observed facts and one inference, kept visibly apart. "Bought at the ask" (observed, solid ink).
"Opening: volume 4.6× open interest" (observed). "Reads as a bet on up" (inferred, hatched chip, hover: "Side
inferred from where it traded against the quote; right about 6 to 8 times in 10 on studies of this rule"). Floor
packages and spread legs get no direction chip at all, matching the Watchers copy "not a bet".

**4. A follow-through ledger: did flow like this work before?** (M)

Before: Watchers flags a contract when a rule fires and never returns to it.
After: each Watchers reason gets a small, honest record built from the server's record of past flags: "Fresh size
on single names, last 60 sessions: 412 flags · the contract was higher at the next close 46% of the time ·
median −12%". It is drawn as a dot strip (one dot per flag, coloured by outcome), not a percentage alone. This is
`KEYS_AUDIT.md` idea #8. It turns Trace from "what happened" into "what that has meant", which no flow product shows.

**5. Fix the sign/ink rule for put premium.** (S)

Before: `trace-odte-dark.png` shows "NET PUTS −$20.5M" in red in the KPI strip and green in the pane legend.
After: one rule everywhere. Ink follows the meaning for price ("puts sold reads as bullish": green), and the number
is restated as a positive in words: "Puts: $20.5M sold". The KPI strip and the panes use the same component.

**6. Give the phone a feed, not a shrunken grid.** (S)

Before: `trace-livetape-phone.png` stacks the KPIs, a filter door, and two-line rows.
After: the headline and the three named prints as cards first, then a single-column feed of only the flagged
prints. The full tape is a "Show every print" door.

**Effort overall:** M–L (the page merge is routing and shared state; the ledger needs a server-side record of past
flags).

---

<a id="dossier"></a>
## Dossier (`/dossier/*`: News, Earnings, Stocks, Insiders, Shorts, Congress, Institutions, ETFs, plus a file per name)

**Screenshots:** `dossier-news-dark.png`, `dossier-news-light.png`, `dossier-news-phone.png`,
`dossier-earnings-dark.png`, `dossier-earnings-nvda-dark.png`, `dossier-stocks-dark.png`,
`dossier-stock-nvda-dark.png`, `dossier-insiders-dark.png`, `dossier-congress-dark.png`,
`dossier-institutions-dark.png`, `dossier-shorts-dark.png`, `dossier-etfs-dark.png`

### What it is today

The record of a name and of the market. **News** opens on a world map of where stories came from (170 of 446
placed), a ticker crawl, and a list. **Earnings** is a two-week board of logo cards, each with the options-priced
move (±5.9%) and "CONFIRMED". The name file (`/dossier/earnings/NVDA`) is the best page in the product: options
price ±9.0% against a usual ±4.0%, "2.25× rich", and a bar chart of whether today's price would have covered each of
the last 8 reports ("0 of 8"). **Stocks** is a graded screen (trend / numbers / money), with a sector "rotation"
card row and a name file that reads "NVIDIA reads poor, leaning bearish", three pillar meters, and a "Why now"
paragraph. **Insiders, Congress, Institutions, Shorts, ETFs** each use the same template: header with source line,
KPI strip, filters, sentence, six "names to know" cards, and a grid.

### What's standard about it

The lists are the Unusual Whales / Quiver layout: a filing table with six cards on top. The news map is decoration:
a story's dateline city tells a trader nothing, and on the phone the map is the first full screen. The earnings
board gives "CONFIRMED" the same weight as the priced move, though the move is the insight. On Shorts the grid runs
past the box at 1440 px (the "Avail" column is cut off), which breaks the page contract.

### Changes

**1. Promote the Earnings name file's grammar to every Dossier page: "priced vs happened".** (M)

The Earnings file works because it sets a claim (the options price ±9.0%) against what happened (8 past moves).
Apply the same frame elsewhere:

- **Earnings board.** Each card becomes a tiny priced-vs-usual bar: a grey bar for the usual move, an outlined bar
  for the priced move, and the gap coloured (rich in amber, cheap in steel). "CONFIRMED" shrinks to a dot with a
  hover. The week's headline: "10 of the 17 priced names are charging more than they usually move. NVDA is the
  richest at 2.25×."
- **Insiders.** For each "chosen buy" card, add the name's move since the filing date as a small slope line, and a
  page-level ledger: "Chosen buys over $1M in the last year: 61 · the stock was higher 90 days later in 38". Counts
  and a dot strip, no single percentage.
- **Congress.** The page's best fact is the reporting lag (median 22 days, 4 past the deadline). Make the lag the
  visual: a horizontal line per trade from "traded" to "filed", with the price path between, so you can see what
  moved before the public knew. Headline: "4 reports came in past the 45-day deadline this quarter."
- **Shorts.** Replace the "% of float" bar with a two-axis dot field (short % of float × days to cover), the
  "squeeze strong" zone shaded, and the name's own last 3 reports as a trail. Fix the overflow.

**2. Retire the News world map; lead with "what moved because of the news".** (M)

Before: `dossier-news-dark.png` is a full-width world map with arcs and city pins.
After: a "moved on the wire" strip. For each of the 10 biggest movers with a story, show the story headline, the
minute it hit, and a 30-minute price sparkline centred on that minute, with the move after publication highlighted.
Headline: "69 names moved on a story today. The biggest: KOP −24.4% at 09:41 on a guidance cut." The map can stay as
an optional "where" lens, never the default, and never first on the phone.

**3. Turn the Stocks name file into the name hub.** (L, shared with Navigation)

Before: the file links out with five chips (THE MAP, WEIGH IT, COMPASS, EARNINGS, THE WIRE). That is the product
admitting one name's story is spread across five pages.
After: `/n/NVDA` (Part 2, Navigation) with sections in story order: the verdict line, the price with the session
ribbon, the dealer spine, the flow headline for this name, the next report (priced vs usual), filings, your
positions in it. The Dossier's "Reads poor · leans bearish" verdict is the hero, with its three pillars beside it
and a "1 of 3 agree" consensus meter. That is already computed.

**4. Make the verdict honest about what it is.** (S)

Before: "NVIDIA reads poor, leaning bearish" in red, at the same visual authority as a price.
After: the verdict wears the "computed from screens" mark (Part 2), with a hover: "Our screens: trend (20/50/200-day
averages, RSI), numbers (growth, margins), money (flow and positioning). Not a forecast." It gets a track line too:
"Names this screen read 'poor' 90 days ago: 46% were down since." The record already exists as the screen history.

**5. Cut the template's six cards to three and make them claims.** (S)

Before: six equal "names to know" cards on every list page.
After: three cards, each with a claim title: "Biggest chosen buy: GME $99.2M by 5 insiders". The others go into the
grid's first rows, highlighted.

**Effort overall:** M (each list page is a change to one shared template plus a per-page chart).

---

<a id="pinpoint"></a>
## Pinpoint (`/pinpoint/map`, `/agenda`, `/board`, `/compare`)

**Screenshots:** `pinpoint-map-dark.png`, `pinpoint-map-dark-loaded.png`, `pinpoint-map-light.png`,
`pinpoint-map-phone.png`, `pinpoint-agenda-dark.png`, `pinpoint-board-dark.png`, `pinpoint-compare-dark.png`

### What it is today

The dealer-positioning system. The **Map** shows the "Exposure Ledger" as a matrix: put / call / net for GEX, DEX
and CHARM over ±20 strikes, so 360 dollar figures, each with a red or green bar. It also has a day box (the tape with
levels over the book's net), the Trader's Clock, a levels report, and a Replay on a minute grid. A "First time here?"
banner explains the colours. The **Agenda** ranks every strike by "matters = reach × stake / what moves the name
1%". It opens with a Watch sentence ("736 first: reached 97% of the time by the next close, too thin to be a
trapdoor…"), three hero cards, then a ranked grid. The **Board** is one row per name (net GEX, flip, nearest wall,
supreme, watch first, expiring %). **Compare** sets two names' books on one percent ruler and lists, per name, DEX,
Vanna, Charm, Color, Speed, Zomma, Vomma and Veta at the supreme strike.

### What's standard about it

The Map is a SpotGamma or Bloomberg grid, with every figure the same size. "First time here?" has to explain the ink
because the grid cannot speak for itself. Compare lists third-order greeks (Color, Speed, Zomma, Vomma, Veta) at
equal weight to net GEX, which is jargon with no stated use. Above all, GEX is presented as observed fact when it
rests on an assumed dealer sign. The product's own research doc notes no competitor shows error bars on it, and
neither does Pinpoint.

The Agenda is the strongest page in Pinpoint because it answers a question ("which strike do I watch first?"). But
"reached 97% of the time by the next close" reads as a historical frequency. The code (`data/agenda.ts`) computes
it as barrier-pricing odds from implied vol, which is a model.

### Changes

**1. Make the Agenda the front door of Pinpoint, and the Map its evidence.** (S)

Before: `/pinpoint` redirects to the Map grid.
After: `/pinpoint` opens the Agenda. The Map becomes "Show the book", one click from any Agenda row, landing on that
strike with it focused (FocusContext already exists).

**2. Fix the odds wording, then show calibration.** (M)

Before: "reached 97% of the time by the next close".
After: "Priced 97% to touch by Monday's close (modelled from 14.8% IV)". Under the three hero cards, add a
calibration strip built from the levels record the Map's report already keeps (`levelRecord`):

```
How our touch odds have held up · last 40 sessions · SPY
 we said 90–100%   ●●●●●●●●●●●●●●●●●●●○○   18 of 20 touched
 we said 60–90%    ●●●●●●●●●●○○○○○          10 of 15
 we said 30–60%    ●●●●○○○○○○○○             4 of 12
 ● touched  ○ not touched
```

This is the FiveThirtyEight move: a probability you can audit. No competitor shows it.

**3. Show the dealer-sign uncertainty on the Map.** (M)

Before: one net GEX figure per strike, stated as fact.
After: each strike's net is drawn as a bar with a range. One end uses the convention (dealers short puts, long
calls). The other end uses the flow-signed estimate the book already reads (`flow-per-strike`). Where the two
disagree on sign, the strike gets a hatched "sign uncertain" mark and the word "contested". The header states the
spread: "Net at spot −$797M by the usual convention; −$310M to −$797M across the two methods." The Map stops being
one more GEX chart and becomes the only one that admits what it does not know.

**4. Replace the 360-number matrix with "Read" and "Rows" modes.** (M)

Before: `pinpoint-map-dark-loaded.png`, nine columns of dollars.
After: the default "Read" mode is the spine at full height (one row per strike, but only net GEX as a gold/steel bar
with the range from change 3, and the named levels labelled in words), with a right column of "what happens here"
sentences for the 5 named strikes only. "Rows" mode (key `R`) is today's matrix, unchanged, for the people who want
it. Put/call splits, DEX and CHARM live in Rows.

```
 READ                                   ROWS
 747.20 ── flip ───────── ▸ above here dealers buy dips
 740    ▓▓▓▓▓▓ steel  lid   ▸ call wall: rallies stall
 736    ·      ← SPY 736.42 · your 740C ▮
 735    ▓▓▓▓▓▓▓▓▓▓ gold  ◆ supreme: the pin
 725    ▓▓▓▓▓▓▓▓ gold  trapdoor ▸ below, $1.6B forced selling
```

**5. Compare: one question, two answers.** (S)

Before: two full books plus 11 greeks per side.
After: the headline "SPY's dealers amplify moves; QQQ's absorb them". The shared ruler stays as the hero chart (it
is good). Each side keeps only net GEX, the three walls and the flip. Higher-order greeks move into a "Sensitivities"
disclosure, each with a one-line meaning ("Charm: how much hedging the clock alone forces by the close").

**6. Board: sort by "needs your attention", and say why.** (S)

Before: sorted "closest to its flip first", and every column equally weighted.
After: the first column is a one-line reason ("Crossed its flip at 14:10", "Supreme moved 725 → 720"). The sort
order is "changed most since you last looked". Names you hold carry a lime edge.

**Effort overall:** M (the calibration and sign range need new arithmetic over data the book already reads).

---

<a id="compass"></a>
## Compass (`/compass`, `/compass/:id`, `/blotter`, `/tracker`, `/review`, `/study`)

**Screenshots:** `compass-board-dark.png`, `compass-board-light.png`, `compass-phone.png`, `compass-setup-dark.png`,
`compass-setup-full-dark.png`, `compass-blotter-dark.png`, `compass-tracker-dark.png`, `compass-review-dark.png`,
`compass-study-dark.png`

### What it is today

The server-side scanner's record, shown to every viewer. **The scan** (`compass-board-dark.png`) has a KPI strip
(Calls today 14 · Won·lost·open 2·12·0 · Net today −$703 · Best Model 1 — · Roots called 0), filters, a Model Risk
line, and ranked cards two across. Each card carries a contract pill, an expiry chip, a band tag ("CLOSEST", "Book A
· Unvalidated"), a 4-stat grid ("MODEL 1 80.2% · ASK · BID · P&L"), the quote, the stop and target with distance,
and an amber warning. A right rail holds the name's tape, Pinpoint and Terrain summaries. **The contract page**
(`compass-setup-dark.png`) is excellent: the contract's derived premium chart with entry, stop, TP1–TP3 drawn as
labelled levels, and a right panel with "SPREAD COST −$388 (53.4% of the mid)", "EST. DECAY −$30", "TP1 PROFIT
+$267, +$237 after decay", and greeks. **Blotter** is the official record as a 13-column grid. **Tracker** shows open
and today's closed calls as stat cards. **Review** lists live runs of 100%+. **Study** gives the calls taken, the
movers missed, suggested threshold changes, and a table of Model 1 score bands against outcomes.

### What's standard about it

It is a signal scanner's card grid with a performance table. The card's most visually dominant number is a model
score ("MODEL 1 80.2%" in green), which is exactly what the owner said must never appear. On the board the #1 card
is a "CLOSEST · NOT A CALL" row whose green 80.2% is the loudest thing on screen. Calls and puts wear green and red
pills, so a put looks like a loss before it has traded. The record that makes Compass trustworthy (15 won, 51 lost)
is a grid with no picture of how the money moved over time.

### Changes

**0. Bring the pages into line with the owner's rules first.** (S, before anything else; detail in Part 3)

Remove every Model 1 percentage (card stat, card hover, Blotter column, the "Best Model 1" KPI). Remove every "Book
A/B/C" on screen (page subtitle, card tag, table column and its tooltip, the Study table title). Use "Model 1",
"Model 2 riding" and "Model 3" as `compassParams.ts` `MODEL_WORD` already defines. The Tracker already does this
correctly, so it is the reference.

**1. Redesign the card around "what has to happen" for a long option.** (M)

The honest framing for a long call or put is not a score. It is the move the stock needs, by when, against what the
option market expects. The contract page already inverts premium targets into underlying levels (ContractTrack's
bisection), so the card can say it in stock terms.

```
Before                                      After
┌ #1 GLD 373P  0DTE · 11/06  CLOSEST ┐     ┌ GLD 373 PUT · expires today 16:00 ──── Model 1 ┐
│ MODEL 1   ASK    BID    P&L        │     │  Long put. Pays if GLD falls.                  │
│ 80.2%     $0.53  $0.42  —          │     │                                                │
│ Quote 0.42×0.53 Stop $0.25 −40%    │     │  GLD needs 372.10 by 15:55    (−0.3%)          │
│ Target $0.80 +90%                  │     │  ├────────●──────────────┤                     │
│ ⚠ Not a call. Same ask, same stop  │     │  stop    now 373.40    target                  │
│                          OPEN ↗    │     │  The options market expects ±0.4% today.       │
└────────────────────────────────────┘     │                                                │
                                           │  Costs $53 a contract · most you can lose $53  │
                                           │  Spread $11 (21% of the price)    ◐ printed    │
                                           │                         Called 15:20 · Open ↗  │
                                           └────────────────────────────────────────────────┘
```

Rules for the new card:

- **The hero** is the underlying level and the time ("GLD needs 372.10 by 15:55"), set large.
- **One horizontal track** shows stop, now and target in underlying price, with today's priced range as a grey band
  behind it. This is a move-vs-expected comparison, not a probability.
- **Cost** is per contract in dollars (ask × 100), shown as information. It is never a filter.
- **No fees and no score.** The model appears only as its label, "Model 1" (or "Model 2 riding", "Model 3").
- **Calls and puts** are named in words ("Long call", "Long put"), in neutral ink. Red and green stay for price and
  P&L only.
- **Closest** cards are visually demoted: no fill, a dashed border, and the label "Not a call: watched, not taken".
  They are never ranked above a real call.

**2. Lead the scan with the honest record as a picture.** (M)

Before: "Won · lost · open 2·12·0" and "Net today −$703" as small KPIs.
After: a headline and an equity line.

```
┌ Compass · Model 1 and Model 3, last 20 sessions ─────────────────────────────┐
│  Down $2,140 a contract over 20 sessions. Today: 2 won, 12 lost.             │
│   $0 ┤╲__  _/╲__                                                              │
│      ┤     ╲/    ╲___/╲___  ← Model 1                                         │
│      ┤                    ╲__/╲___  ← Model 3                                 │
│      ┤ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ coin-flip baseline (same entries, random side)│
│  Every call, fills at the ask a minute later, exits at the bid. No fees.     │
└──────────────────────────────────────────────────────────────────────────────┘
```

The coin-flip baseline is `KEYS_AUDIT.md` idea #5. It is the strongest trust signal the product can show, and it
uses outcomes, not scores. Wins and losses are counts, never a hit-rate percentage next to a model name.

**3. Put the receipt on the contract page above the fold.** (S)

Before: "SPREAD COST −$388 · 53.4% of the mid" sits in the right panel's second row, at the same size as "VEGA 0.03".
After: a receipt block heads the panel, ordered as the money moves.

```
 RECEIPT · QQQ 664 PUT · 1 contract              printed ●  computed ◐
 You pay the ask        $920    ●
 Worth at the mid       $726    ◐
 Spread you give up    −$194    ◐   ← 21% of what you paid
 Clock until 15:55      −$30    ◐   est. decay
 Needs QQQ at 661.40 to break even at the bid   ◐
```

The QQQ 664P example on screen has a $5.32 × $9.20 quote. A 53% spread is the single most important fact about
that contract, and it should be impossible to miss.

**4. Merge Blotter and Tracker into one "Record" page with the time axis.** (M)

Before: Tracker (open and today's closed, as cards) and Blotter (everything, as a grid) are two pages with near-
identical KPI strips.
After: one page. At the top, the equity line from change 2 with a range selector (today / 5 days / 20 / all). Under
it, a day-by-day strip: one column per session, one dot per call, the dot's height its return. Click a day to list
that day's calls as compact receipts. The grid stays behind "Show as rows".

**5. Review and Study: put the finding first and the explanation in the guide.** (S)

Before: `compass-review-dark.png` opens with a 6-line paragraph defining "a turn", "a run" and "fillable" before any
data. `compass-study-dark.png` is a stack of empty sections and a 9-row band table.
After: each opens with its finding in one line ("3 contracts ran 100%+ today; Model 1 had scored 1 of them, at the
13:05 mark"). Definitions move to "How to read". Study's band table becomes a dot plot: bands on the x axis, each
dot a call, coloured won or lost. It is labelled by band number only, with no percentages.

**6. A phone layout that starts with a card.** (S)

Before: `compass-phone.png` spends the first screen on the header, five KPIs, five filters and a sentence. The first
card is below the fold, which breaks the page contract's "first row of data above the fold".
After: the headline line, then cards. Filters collapse into one "Filters" chip.

**Effort overall:** M (the card and record are UI over the existing record; the baseline needs a server pass over
recorded quotes).

---

<a id="weigher"></a>
## Weigher (`/weigher`)

**Screenshots:** `weigher-dark.png`, `weigher-dark-loaded.png`, `weigher-light.png`, `weigher-phone.png`

### What it is today

One desk for one contract: a chart (stock or the picked contract's modelled premium), the live chain (strike with a
book shape tag such as "VOID", mark, delta, IV, "ITM · model", volume, a + to watch), "Your positions" (add a
position you own or sold), and a card with two faces: "Our read" (the case for the contract) and "Simulated
returns" (return by date and by price, a draggable price ruler with the put wall, flip and call wall on it, P&L at
expiry and today). After the close the chain shows marks but dashes for greeks, and almost every strike reads
"VOID".

### What's standard about it

The layout is thinkorswim's Trade tab: chart left, chain right, positions below. The chain is a standard grid. The
best part, Simulated returns with a draggable price ruler, is hidden in the second face of a card at the bottom of
the page, below the fold at 1440×900. "VOID" on 14 of 15 rows is a label that tells the reader nothing.

### Changes

**1. Make the simulator the page.** (M)

Before: chart, chain, then positions and a two-face card under the fold.
After: three columns. Left, the chain, narrowed to strike, mark, and one bar showing the price you would pay
relative to the stock. Centre, the payoff canvas: P&L across stock price, with "today", "at expiry" and the selected
date as three lines, the stock's priced range as a band, and the dealer walls as vertical hairlines labelled in
words. Right, the receipt and "what has to happen". Picking a strike on the chain redraws the canvas. Dragging the
stock price on the canvas moves every figure. That is the core interaction, and it is what the page's name promises.

```
┌ chain ──────┐┌ What SPY 745C needs ─────────────────────────────┐┌ receipt ───────┐
│ 742  $1.92 ▏││   P&L                                            ││ Pay      $107  │
│ 743  $1.60 ▏││    +$400┤                     ╱ at expiry        ││ Spread    −$4  │
│ 744  $1.32 ▏││         ┤             ╱─────╱  today             ││ Decay/day −$31 │
│▶745  $1.07 ▏││      $0 ┼──────●─────╱───────────                ││ Breakeven      │
│ 746  $0.86 ▏││    −$107┤━━━━━━┛     ┊call wall 740 ┊            ││ 746.07 (+1.3%) │
│ 747  $0.69 ▏││          730   736.42    745     750             ││ Priced ±1.1%   │
│             ││   ◀━━━━━ drag the price ━━━━━▶ priced range ░░░   ││ by Nov 13      │
└─────────────┘└──────────────────────────────────────────────────┘└────────────────┘
```

**2. Replace the shape tags with one word that means something, or nothing.** (S)

Before: "VOID" on almost every strike.
After: tag only the 3–5 strikes the book makes special ("wall", "pin", "trapdoor"), using the same words as the
spine. Leave the rest blank. Explain each tag on hover.

**3. Mark modelled numbers and say which model.** (S)

Before: "ITM · model" is a column header, and the premium chart is "modeled premium" in the guide only.
After: each modelled figure wears the hatched "modelled" mark from Part 2, with a hover naming the input ("from
Black-Scholes at 14.8% IV, rate 4.2%"). The premium chart draws its forward half dashed. ContractTrack already does
this on Compass, so reuse it.

**4. Positions first when you have them.** (S)

Before: "No positions yet" occupies a third of the screen for new users, and positions sit below the fold for
existing ones.
After: with positions, the page opens on your first position in the simulator, and a lime row at the top of the
chain marks every strike you hold. With none, a single line under the chain reads "Holding something? Add it and
every page will read against it." No empty box.

**Effort overall:** M.

---

<a id="practice"></a>
## Practice: Paper, Backtest, Journal (`/practice/*`)

**Screenshots:** `practice-paper-dark.png`, `practice-paper-light.png`, `practice-backtest-dark.png`,
`practice-journal-dark.png`, `practice-journal-phone.png`

### What it is today

**Paper** creates an account ($10K–$100K) or a "prop firm" evaluation with that firm's rules modelled and the
unmodelled ones listed in amber. It then gives a desk with charts, the chain and an order card at live bid and ask.
**Backtest** starts a session on a past day (name, cash, date, fee, max open, max a trade, day stop). It replays
minute by minute on recorded NBBO and ends in a Report with the figures and a 95% range. **Journal** is a month
calendar of closed trades from paper, backtest, or "your own" (CSV import), with a 20-line stats column (profit
factor, Sharpe, Sortino, kept of the best…), plus a trade page with "three questions worth answering".

### What's standard about it

It is TraderSync or Edgewonk: a calendar heatmap and a column of ratios. The Paper start page is a long text form
with no picture of what you will get. Backtest opens on a 9-column empty grid. None of the three pages answers "where
did my money go?", which is the question the product's own research says retail traders need answered: spread, not
direction.

### Changes

**1. The trade autopsy: break every closed trade into where the money went.** (L)

Before: a trade shows entry, exit and P&L.
After: every closed trade, whether paper, backtest or imported, gets a waterfall from entry to exit, computed from
recorded quotes and greeks at entry.

```
 SPY 736C · bought 10:25 at $6.24 · sold 12:36 at $2.84 · −$340
   Spread paid (ask vs mid at entry and exit)   −$ 6   ▇
   Time decay while held (2h 11m)               −$41   ▇▇▇▇
   Volatility fell (IV 15.1% → 13.9%)           −$58   ▇▇▇▇▇
   Direction (SPY −0.4%)                        −$235  ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇
   ───────────────────────────────────────────────────
   You were wrong on direction. The spread was a small cost here.
```

The headline is a verdict sentence. The bars sum to the P&L. This is `KEYS_AUDIT.md` ideas #1–#2 and the research
doc's flagship, applied to the user's own trades. Fill quality (your fill against the NBBO at that second) is a fifth
bar whenever an imported trade carries a timestamp.

**2. The Journal headline: one sentence about your month.** (S)

Before: "Made or lost — · Trades — · Won — · Profit factor —" and a 20-row stat column.
After: "November: −$420 on 18 trades. Spread and decay cost you $310 of it, more than the losses on direction." Under
it, the four autopsy categories summed for the period as one stacked bar. The 20 ratios move into a "Statistics"
disclosure, with Sharpe and Sortino hidden when there are fewer than 20 trades. Under 30 trades they mean nothing,
and the Report's 95% range already says so.

**3. Backtest with the baseline always on.** (M)

Before: the Report shows your figures and a 95% range.
After: every Report draws your equity line against two ghosts. One is the same entries with random direction. The
other is buying the same contracts at the same minutes and holding to the close. The headline says which you beat:
"You beat random direction by $380 (95% range −$120 to +$880): not yet distinguishable from luck."

**4. Paper: show the account before the form.** (S)

Before: a wall of text and $10K–$100K buttons, then prop-firm rules in paragraphs.
After: a preview of the desk (a static image of the Paper desk with your chosen balance written into it) and three
starting choices as cards ("Practice freely · $25K", "Practice a prop evaluation", "Replay a past day"). The prop
rules become a checklist the desk ticks as you trade ("Drawdown 5%: used 1.2%").

**Effort overall:** L (the autopsy needs greek attribution over recorded quotes; the rest is S–M).

---

<a id="shell-pages"></a>
## Start, Community, Status, Changelog and the shell

**Screenshots:** `start-dark.png`, `community-dark.png`, `status-dark.png`, `changelog-dark.png`,
`settings-dark.png`, `landing-dark.png`

- **Start** is a grid of 10 page screenshots with one line each. It teaches the product's map, not its use. Change:
  turn it into the onboarding flow described in Part 2 (S–M).
- **Community** is a "Coming soon" spotlight over a blurred mock. Fine as a placeholder. Remove it from the rail
  until it exists: a dead door in the main navigation costs trust (S).
- **Status** is a model page: one answer ("Every path is answering"), then five rows in plain words. It is the
  template the data pages should copy. No change.
- **The "What changed" banner** takes a full row on every page in every capture. Show it once per release and then
  fold it into the bell (S).
- **The landing page** promises "every page tells you what you are looking at". The redesign in this review is what
  makes that true. Its product tiles show dense grids; once the redesign lands, re-shoot them on the headline layer.

---

# Part 2: across the product

<a id="design-language"></a>
## A design language that is unmistakably Slayer

The brand line is "Where the market shows its hand". The language should make every screen look like a hand being
shown, which means laid out, explained and accounted for, never a wall of quotes. Eight rules, each concrete enough
to build into `components/ui`.

### 1. The Read: every page opens with a headline answer

- **Component:** `<PageRead claim hero heroWhy because? />`, replacing the current small `RichRead` sentence under
  the filters.
- **Type:** the claim at 26–30 px (the sans already used for page titles, weight 600), one line, under 12 words. The
  hero number at 40–48 px mono with its comparison beside it at 14 px ("−$797M · was −$412M Thu"). An optional
  "because" line at 15 px.
- **Copy rules:** a claim, not a label ("Money leaned into calls by $310M", not "Net Flow"). Present tense, a name and
  a number in every claim, no adjectives that grade without saying against what.
- **Placement:** above every control. Filters sit under the Read and are collapsed into one row or the command bar.

### 2. Three type tiers, enforced

- **Hero:** one per page. 40–48 px.
- **Supporting:** 3–5 per page. 18–20 px, with a label above at 11 px.
- **Detail:** everything else. 12–13 px mono, inside "Rows" mode or a disclosure.

A lint rule over `text-t*` classes, or a short review checklist, keeps a page from having two heroes.

### 3. Provenance marks on every number

Three marks with one meaning everywhere, in text and in charts:

| Mark | Meaning | Number style | Chart style | Hover says |
|---|---|---|---|---|
| ● printed | Seen on the tape or in a filing | Normal ink | Solid line | "Printed 15:59:58 · options tape" |
| ◐ computed | Arithmetic over printed values | Normal ink with a dotted underline | Solid line, lighter | "Sum of 412 contracts' open interest × gamma" |
| ○ modelled | Depends on a model's assumption | Ink at 70%, italic numerals | Dashed line, hatched fill | "Barrier odds from 14.8% IV · see how these have held up" |

Sources are described generically ("options tape", "quote history", "filings"). Vendors are never named, per the
owner's rule. The Vol outlook tile's `ModeledTag` is the seed; generalise it into `components/ui/Provenance.tsx`.

### 4. Ranges, not points, wherever a model is involved

- Odds get a calibration link (Pinpoint).
- GEX gets a sign range (Pinpoint).
- Backtests show a 95% range and the baseline (Practice).
- The implied move is a band (Terrain).
- Compass shows no model probability at all; its uncertainty is the outcome record and the baseline, as counts.

### 5. One colour law

| Ink | Meaning, and only this |
|---|---|
| Green / red | Price direction and P&L |
| Gold / steel | Dealer side: amplify (put-dominant) and absorb (call-dominant). Finishes the `docs/dealer-ink-pass.md` rule, which the Map, Pulse book, Terrain rail and Compare still break |
| Magenta | The one thing on the page: the supreme, the #1, the watch-first strike. One per screen |
| Lime | Yours: your positions, your selection, your marks |
| Grey hatch | Modelled |
| Neutral ink | Calls and puts as words. Today calls wear green and puts red, so a put looks like a loss before it trades |

Whole-page verdict tint, after Robinhood: a 2% green or red wash on the Read block only, for the day's verdict.
Cells stay neutral.

### 6. The spine: one strike axis for the whole product

One vertical component, `<Spine name expiry levels positions />`, used by the Pulse book tile, Terrain's rail, the
Map's Read mode, the Weigher chain's left edge, and Compare. It always draws the same things the same way: spot as a
white plate, flip as a blue rule, walls in gold/steel with one word each, supreme in magenta, your positions as lime
tabs, and the priced range as a grey band. Hover opens the full ladder. This is the visual signature: a reader who
sees a Slayer screenshot recognises the spine before the logo.

### 7. The time ribbon: "how we got here" under every page head

A 24 px strip under the Read covering the session (and the overnight when relevant). Event ticks sit on it: "CPI
08:30", "flip crossed 14:10", "Compass call 10:25", "your fill 11:02". Dragging the playhead replays the page's
state. Pinpoint's Replay and `replayState.ts` are the engine; generalise them. The right end always reads "Live",
"As of 19:59 ET" or "Closed · opens Sun 20:00". This replaces the scattered "CLOSED · OVERNIGHT OPENS…" badges.

### 8. Motion only for meaning

- **Allowed:** a number that changed since your last look ticks from old to new once, with its delta shown for 3
  seconds. A wall that moved slides on the spine rather than redrawing. Replay. Hover causality (hovering a print
  lights its strike on the spine).
- **Removed:** the news world map's arcs, the Community spotlight, and the glitch footer art inside the terminal.
  Keep that art on the landing page, where it sells the brand.

### Voice

Keep the house voice: "floor packages, not a bet", "pushes a move along", "You decide". It is the most distinctive
thing Slayer has. Tighten it by putting the plain sentence first and the jargon in the hover, never the reverse
("dealers will push, not absorb", hover: "net short gamma at spot").

---

<a id="consistency"></a>
## Consistency problems between pages

1. **Three colour grammars for dealer gamma.** The Pulse book tile and the Map use red/orange against green ("Red
   and orange mean dealer hedging pushes a move along, green means it holds one back"). Terrain's rail and Pinpoint
   Compare use a yellow-to-green "thermal" ramp. `docs/dealer-ink-pass.md` set gold/steel as the rule. Pick
   gold/steel everywhere (rule 5).
2. **Red and green mean four things.** Price direction, P&L, dealer side (above), and call vs put (contract pills:
   "GLD 373P" in red, "SPY 738C" in green). On the 0DTE page a negative put figure is red in the header and green in
   the pane.
3. **The same word names different things.** "Tracker" is Compass's open calls and also Trace's bookmarks (and
   `/tracker` redirects to Compass). "Compare" is both a Pinpoint and a Trace page. "Board" is Pinpoint's name grid
   and the file behind Compass's scan. "Watchlist" is a shell drawer (37 names), the Weigher's watched contracts, and
   (in effect) Trace's marks.
4. **Five stores for "things I care about".** The watchlist drawer, Weigher watched contracts plus positions
   (`data/positions.ts`), Trace's marks, paper accounts, and the Journal's imported trades. Each page reads a
   different subset.
5. **Compass contradicts itself.** The Tracker uses "Model 3" correctly. The scan, Blotter, contract page and Study
   still show "Book A/B/C" and Model 1 percentages (Part 3).
6. **Explanation lives in four places.** "How to read" sheets on boxes, a "First time here?" banner (Pinpoint only),
   "Every word Pinpoint uses" (Pinpoint only), and paragraphs above data (Compass Review, Paper). Make one pattern:
   the Read on the page, the definitions in a single glossary sheet reachable from any underlined term, product-wide.
7. **Session state is said four ways.** "CLOSED · OVERNIGHT OPENS SUN 8:00 PM ET" in a header, "AS OF 19:59 ET" in
   the rail, "Options are shut" in Compass, "CLOSED" plus "PAUSE" chips on every Trace page. The time ribbon (rule 7)
   says it once.
8. **Filters are drawn three ways.** "LABEL Value ▾" bordered chips (Trace, Dossier), segmented pills (Pulse presets,
   Journal ranges), and plain words (Stocks name tabs). Pick two: segmented controls for lenses, and the command bar
   for everything else.
9. **The KPI strip changes position.** It sits top-right on Trace, Dossier and Compass Blotter, inline under the box
   title on Live Tape and Screener, and nowhere on Pulse. The Read replaces all of these.
10. **Overflow breaks the page contract.** Shorts' grid runs off the right edge at 1440 px. Compass's phone view puts
    the first card below the fold.

---

<a id="navigation"></a>
## Navigation

**Today.** The rail has 13 entries in 6 groups, with sub-navs of 11 (Trace), 8 (Dossier), 6 (Compass), 4 (Pinpoint)
and 3 (Practice). That is about 35 destinations. One name's story is spread over the Dossier file, the Pinpoint Map,
Trace filtered to the name, the Weigher chain, Terrain and Earnings. The Dossier file's five "jump" chips admit it.

**Proposal: organise around three nouns (today, a name, your book) and keep the instruments as tools.**

```
TODAY        Pulse                    the brief, the desk
NAMES        ⌘K → /n/NVDA             one page per name (below)
MARKET       Flow                     Trace, 6 pages (see Trace)
             Record                   Dossier lists: News, Earnings, Insiders, Congress,
                                      Institutions, Shorts, ETFs, Stocks screen
             Dealers                  Pinpoint: Agenda (front), Map, Board, Compare
SIGNALS      Compass                  Scan, Record, Review & Study
YOUR BOOK    Positions · Watching · Marked · Journal
PRACTICE     Paper · Backtest
TOOLS        Terrain · Weigher
```

- **The name hub, `/n/:ticker`.** A single scrolling page in story order: the Read for the name, the price with its
  time ribbon, the spine, "Flow today" (the Trace headline for this name), "Next report" (priced vs usual),
  "Filings" (insiders and Congress in one timeline), "Your positions", and doors into the Map, Weigher and Terrain
  with the name set. Every ticker pill in the product links here. (L)
- **⌘K becomes the main navigation.** It is a command bar, not only a search: "NVDA" opens the hub, "NVDA 190C"
  opens the Weigher on that contract, "flow 0dte" opens Same day, "my book" opens Your book. Filters can be typed
  ("tape premium > 1m calls"), which is what lets the ten-dropdown filter rows go. (M)
- **Your book** gets one place in the rail, with a lime count badge of open positions.
- **Community** leaves the rail until it opens.

---

<a id="onboarding"></a>
## Onboarding and the after-hours state

**Today.** There is a Start page of screenshots, a "First time here?" banner on Pinpoint, and per-box "How to read"
sheets. Nothing asks who the reader is, and nothing is designed for the evening or weekend visitor, who meets
"Loading bars…", "No 0DTE call on this sleeve", "Options are shut" and empty grids.

**Proposal.**

1. **A three-question first session, about 30 seconds.** (M)
   - "What do you trade?" Same-day index options / weekly single names / longer swings / I'm learning.
   - "Anything open right now?" Add up to 3 positions with a ticker-aware form, or import a CSV (the Journal's
     importer).
   - "Which names?" Pre-filled from the answers, editable.

   The answers set the Pulse preset, the Compass sleeve (0DTE vs 1–7 DTE), the watched names, and the glossary level.
   The first Pulse view then shows the Read with their positions in it.
2. **Explain mode.** (M) A toggle in the shell ("?" already opens help) that overlays numbered annotations on the
   current page: the hero number, the spine, one row. Each annotation is one sentence and links to the glossary.
   This replaces the per-page "First time here?" banners with one product-wide pattern.
3. **A designed after-hours state, "Monday's setup".** (M) When no session is open, each page's Read switches tense
   and job. Pulse: "Friday closed at 736.42, inside the 732–741 range options had priced. Monday's book: the supreme
   sits at 725." Compass: "Last session: 2 won, 12 lost. Next scan 09:45 ET Monday." Pinpoint: "Next session's
   targets, from Friday's close." Trace: "The week's tape in one line", with a five-day lens. The time ribbon shows
   the gap and the countdown. Empty states always say what will fill them and when.
4. **Glossary as a product.** (S) One sheet, every underlined term in the product (supreme, flip, trapdoor, charm,
   floor package, Model 1/2/3, closest), each with a one-line meaning, a one-paragraph explanation, and a tiny
   example figure. The Weigher guide's example figures are the house style.

---

<a id="your-trades"></a>
## Connecting every page to the user's own trades

**Today.** `data/positions.ts` (manually entered, kept in the browser) is read by the Weigher, Pinpoint's Map,
Targets and Building, and Pulse's "My book". Paper and Backtest keep their own books, the Journal imports CSVs, Trace
keeps marks, and the shell keeps a watchlist. Terrain, Trace, the Dossier and Compass do not know what you hold.

**Proposal: one store, "Your book", and one line per page.**

- **The store.** `data/yourBook.ts`, one record per item, typed `held | sold | watching | marked | followed` (a
  followed Compass call). Paper positions appear as `held` with an account tag. One importer (CSV now, broker links
  later). This merges the five stores in Consistency #4.
- **What each page adds.** One "for you" line under the Read, and lime marks on its chart or axis:

| Page | What it adds for your book |
|---|---|
| Pulse | "Your book" rows in the brief: each position's needed move vs the priced range, and anything near a wall |
| Terrain | Lime tabs on the price axis at each strike, breakevens as dotted lines |
| Trace | A lens "Only names I hold": prints in your contracts or strikes are highlighted. "A $2.1M block traded in the 740C you hold, 14:02, opening" |
| Dossier | On Earnings: "You hold NVDA 190C through Nov 17. Options price ±9%; your breakeven needs +6.3%." On Insiders and Congress: filings in names you hold first |
| Pinpoint | Your strikes on the spine; Agenda flags "your 740C sits on the call wall: rallies tend to stall here" |
| Compass | "Follow" a call adds it to Your book. Your own fill, if entered, is compared with the official fill (fill-quality audit) |
| Weigher | Opens on your first position in the simulator |
| Journal | Every closed item from Your book gets the autopsy waterfall |

- **Notifications follow the book.** Alerts fire for events that touch your positions: a wall moved through your
  strike, a print in your contract, an earnings date inside your expiry, a Compass call you followed hit its stop.

---

<a id="top-ten"></a>
## The ten highest-impact changes across the product, ranked

Ranked by how much each changes the answer to the nine questions, weighted by reach (how many pages and visits) and
divided by effort. The Compass rule fixes in Part 3 come before this list: they are a defect, not a design choice.

| # | Change | What it fixes | Pages | Effort |
|---|---|---|---|---|
| 1 | **The Read: a headline answer and one hero number on every page**, with the grid moved behind "Show the rows" | 3-second question, dominant number, explains itself, not a wall of tables | All ~35 | M (shared header plus a sentence per page; most sentences already exist as `RichRead`) |
| 2 | **Your book: one store and one "for you" line plus lime marks on every page** | Built around your trades | All | L |
| 3 | **Compass card and record redesign**: "what has to happen" in stock terms for long calls and puts, the receipt, an equity line with a coin-flip baseline, counts not scores | Dominant number, uncertainty (as outcomes), unlike competitors; enforces the owner's rules | Compass ×6, Pulse tile | M |
| 4 | **Provenance marks (printed / computed / modelled) and ranges**: Pinpoint touch-odds relabelled with a calibration strip, a GEX sign range, the Terrain cone as a band | Uncertainty and source; differentiator no competitor has | Pinpoint, Terrain, Weigher, Dossier, Pulse | M–L |
| 5 | **The time ribbon and "since you last looked"** on every page, generalised from Pinpoint's Replay | What changed, time dimension, motion for meaning | All | L |
| 6 | **The trade autopsy** (spread, decay, vol, direction, fill quality) in the Journal and on every closed trade | Built around your trades; "sell the receipt" | Journal, Paper, Backtest, Compass | L |
| 7 | **The spine and one colour law** (gold/steel dealers, green/red price only, magenta one thing, lime yours) replacing the GEX bar lists and thermal ladders | Not another GEX chart; consistency | Pulse, Terrain, Pinpoint, Weigher | M |
| 8 | **The name hub `/n/:ticker` and ⌘K as the navigation** | Navigation; one story per name | Dossier, Pinpoint, Trace, Weigher | L |
| 9 | **Trace from 11 grids to 6 story pages**, BULLISH/BEARISH replaced by observed facts plus an inference chip, and a follow-through ledger | Wall of tables, unexplained inference | Trace | M–L |
| 10 | **First session and the after-hours "Monday's setup" state**, with explain mode and one glossary | Onboarding, the weekend visitor, jargon | Shell, all Reads | M |

**Suggested order of work.** First the Part 3 fixes (S). Then #1 and #7 together, since they share the header and
the spine and change every page's look in one pass. Then #3 and #4, which make the product's honesty visible. Then
#2 and #6 (the book and the autopsy). Last, #5, #8, #9 and #10.

---

<a id="compliance"></a>
# Part 3: Compass rule compliance, as built today

The owner's rules: no model probability %, no fees, labels Model 1/2/3, and never "Book A/B/C" on a page
(`compassParams.ts` says so too). The engine words are rewritten by `viewerWords`, but several UI strings and
numeric fields bypass it. Found in the code and confirmed on screen:

| Where | What shows | File |
|---|---|---|
| Scan card, stat grid | "MODEL 1 80.2%" (and 77.9%, 76.5%…) in green on every priced card, including "Not a call" rows | `src/components/compass/SetupScanCard.tsx` (`Stat label="Model 1"` with `setup.p1 * 100`) |
| Scan card, tag hover | "… Model 1 74.6%. Model 2 41%." via `model` | same file, `const model = …` |
| Scan card, tag | "Book A · Unvalidated", "Book B", "Book C" | same file, `tagOf` |
| Scan card, hold copy | "Book C. No model. No stop…", "Book B. Model 2 exit, even under 50%." | same file, `holdOf` |
| Scan table view | "Book" column with A/B/C, tooltips "Book A is the near book…", "Book A and Book B: 0.4678 times the ask" | `src/components/compass/SetupScanBoard.tsx` (`WIDTHS`, `TOOLTIPS`, `book` column) |
| Page subtitle (every Compass page) | "Book A and Book B, 0 to 7 days. Book C is same-day only." | `src/pages/compass/CompassLayout.tsx` (`COMPASS_LINE`) |
| How to read (guide) | "A call needs Model 1 at 70.67% or more", "Book A is within four strikes…", "every Book A and Book B call wears Unvalidated" | `src/components/compass/CompassGuide.tsx` |
| Board KPI hover | "The highest Model 1 read on this sleeve today. A call needs 70.67%." | `src/pages/compass/Board.tsx` (`Fact label="Best Model 1"`) |
| Blotter | "Book" column (A/C) and "Model 1" column with percentages (72.8%, 74.6%…) | `src/pages/compass/Blotter.tsx` |
| Study | Section title "Model 1 against what happened (Book A rules from each mark)" | `src/pages/compass/SessionStudy.tsx` |
| Pulse "Compass setups" tile | Renders `SetupScanCard`, so it inherits the card's % and Book tags | `src/pages/workspace/tiles/trade.tsx` |

Fees: none found on screen. The record states "No fees" in hover text, which is consistent with the rule.

Vendor names: none found in the captured page text. Source lines read "Wire", "Earnings calendar", "SEC Form 4" and
"Live data". `userWords` already rewrites the engine's vendor mentions.

**Fix (S).** Delete the percentage stat and the Blotter column. Map `band` to `modelOfBand` and `book` to
`modelOfBook` for every label and tooltip. Reword the subtitle to "Model 1 calls, 0 to 7 days. Model 3 is same-day
only." Add a golden or DOM test that fails if a Compass route renders `/\d+(\.\d+)?%/` next to "Model", or the words
"Book A", "Book B" or "Book C".

---

<a id="screenshots"></a>
## Screenshot index

All files are in the session scratchpad's `review/` folder and are not committed. Desktop captures are 1440×900 and
phone captures 390×844, all at deviceScaleFactor 1.

- **Pulse:** `pulse-dark`, `pulse-light`, `pulse-dark-full`, `pulse-phone`
- **Terrain:** `terrain-dark`, `terrain-dark-loaded`, `terrain-light`, `terrain-phone`
- **Trace:** `trace-livetape-dark`, `trace-livetape-light`, `trace-livetape-phone`, `trace-screener-dark`,
  `trace-netflow-dark`, `trace-odte-dark`, `trace-multileg-dark`, `trace-intervals-dark`, `trace-footprints-dark`,
  `trace-watchers-dark`, `trace-darkpool-dark`, `trace-compare-dark`, `trace-tracker-dark`
- **Dossier:** `dossier-news-dark`, `dossier-news-light`, `dossier-news-phone`, `dossier-earnings-dark`,
  `dossier-earnings-nvda-dark`, `dossier-stocks-dark`, `dossier-stock-nvda-dark`, `dossier-stock-nvda-full`,
  `dossier-insiders-dark`, `dossier-congress-dark`, `dossier-institutions-dark`, `dossier-shorts-dark`,
  `dossier-etfs-dark`
- **Pinpoint:** `pinpoint-map-dark`, `pinpoint-map-dark-loaded`, `pinpoint-map-light`, `pinpoint-map-phone`,
  `pinpoint-agenda-dark`, `pinpoint-board-dark`, `pinpoint-compare-dark`
- **Compass:** `compass-board-dark`, `compass-board-light`, `compass-phone`, `compass-setup-dark`,
  `compass-setup-full-dark`, `compass-blotter-dark`, `compass-tracker-dark`, `compass-review-dark`,
  `compass-study-dark`
- **Weigher:** `weigher-dark`, `weigher-dark-loaded`, `weigher-light`, `weigher-phone`
- **Practice:** `practice-paper-dark`, `practice-paper-light`, `practice-backtest-dark`, `practice-journal-dark`,
  `practice-journal-phone`
- **Shell:** `start-dark`, `landing-dark`, `community-dark`, `settings-dark`, `status-dark`, `changelog-dark`
