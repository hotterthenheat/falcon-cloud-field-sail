# The signed book — the dealer's sign per contract, read off the tape

**Written 2026-10-03, before the code and before the data.** Noah, after a tweet ("if your 'Gex' service can't display
levels with the 4 different ways customers/MMs hold options, ITS SLOP"): "this will be the first thing we commit to once
we buy the massive keys" — and, of the method, "i would like to leave that up to you". So this page is the method as
proposed, in plain words, to be built the week the Massive keys arrive and **tested on the first two years of tape before
it is believed**. When a rule changes, it changes here first; `engine/slayer_core/signs.py` will implement exactly this.

The engine is pinned until Noah says otherwise (`engine/README.md`); nothing below has been started.

---

## 1. The problem in one table

Behind the open interest at a strike the customer holds one of four positions, and the market maker holds the other side.
Gamma is positive for whoever is long an option, call or put, and negative for whoever is short one — so the dealer's
gamma at a strike depends on **who holds which side**, not on whether the contract is a call or a put.

| The customer is | So the dealer is | The dealer's gamma | How the dealer hedges |
| --- | --- | --- | --- |
| long calls | short calls | negative | buys as price rises, sells as it falls — moves get pushed along |
| short calls | long calls | positive | sells as price rises, buys as it falls — moves get leaned on |
| long puts | short puts | negative | pushed along |
| short puts | long puts | positive | leaned on |

The OCC's daily open interest is **unsigned**: it says how many contracts exist, not who is long them. The common shortcut
assumes dealers are long every call and short every put (the textbook customer sells covered calls and buys protective
puts), signs the gamma by option side, and reads "levels" off the result. That is an assumption presented as a
measurement. It is wrong wherever customers bought calls (most 0DTE and meme-name call volume) and wherever they sold puts
(every premium seller), and the call wall, the put wall and the flip inherit the error.

## 2. Where our engine stands today (honest)

- `engine/slayer_core/exposure.py` `chain_exposures` signs by **side with a dealer prior** as a parameter: `DEALER_CALL =
  -0.55`, `DEALER_PUT = -0.53` (the dealer net short 55% of call interest and 53% of put interest). That is a softened form
  of the same shortcut, and it runs on simulated data. The browser's twin (`src/data/exposure.ts`) is the same convention.
- `walls.py` reads the walls off that sign ("the sign IS the option side").
- The prior stays after this spec lands — as the **fallback where the tape has not seen a contract's life**, and as the
  sensitivity band (`prior ± band`), never as the answer.

## 3. The signing ladder — one print at a time

Every option print on the tape gets a **buy weight** `w` in `[0, 1]`: the probability that the customer was the buyer.
Let `p` be the print's price and `b`, `a` the national best bid and offer **at the print's own instant** (the last NBBO at
or before the trade's SIP timestamp — never the exchange's own quote, never a later one).

1. **Not a trade, not counted.** OPRA's sale conditions mark cancelled, late and out-of-sequence prints; they never enter
   the estimate. (The condition code set is read off Massive's docs on day one, not from memory.)
2. **At or through the quote.** `p ≥ a` → `w = 1` (the customer bought; the dealer is short). `p ≤ b` → `w = 0` (the
   customer sold; the dealer is long). Above the ask and below the bid are the strongest prints there are.
3. **Inside the spread, graded, not guessed.** `w = (p − b) / (a − b)`. A print a third of the way up from the bid counts
   as one third buy, two thirds sell. A print exactly at the midpoint is `w = 0.5`: it carries **no sign**. A strike whose
   volume is mostly midpoint prints comes out *weakly* signed rather than *wrongly* signed, and the screen says so (§6).
4. **Spread legs at half weight.** The conditions mark multi-leg prints. Their legs fill at prices the package set, not
   the market, so each leg is graded the same way and then pulled half-way back to no-sign: `w' = 0.5 + (w − 0.5) / 2`.
5. **A locked or crossed quote (`a ≤ b`) is no quote.** The print takes `w = 0.5`.

The print's **signed size** is `(2w − 1) × size`: positive when customers bought, negative when they sold. The dealer's
side is the negative of it.

## 4. From prints to a position

Per contract, over every print the tape holds since the contract listed (or since the tape began, whichever is later):

- **The signed share** `s = Σ (2w − 1) × size / Σ size`, in `[−1, +1]`. It is the sign the tape has seen, volume-weighted.
  Churn cancels: a contract bought in the morning and sold in the afternoon contributes nothing net, which is right.
- **Coverage** `c` = the share of the contract's listed life the tape covers (sessions covered / sessions since listing),
  in `[0, 1]`. A weekly listed last Thursday has `c = 1`; a LEAPS listed before the tape began does not.
- **The blended share** `s* = c × s + (1 − c) × s_prior`, where `s_prior` is the old prior in the customer's sign
  (`+0.55` calls, `+0.53` puts). Where the tape has seen the whole life, the prior is gone.
- **The dealer's position** in the contract, in contracts:

  `dealer = −( s* × OI_prev + net_today )`

  `OI_prev` is the OCC's open interest as of the prior close (the level is always the official number). `net_today` is
  today's signed size summed since the open — it is what the overnight number cannot see, and on a 0DTE strike it is most
  of the position. Overnight the OCC publishes the new open interest, the day's prints fold into `s`, and `net_today`
  starts again at zero. OPRA carries no open/close flag, so no rule here pretends to know whether a print opened or closed
  a position; the net handles it.

- **The exposures** follow as they do today: dealer gamma at the contract = `dealer × gamma × 100 × spot` (and the same
  for delta, vanna, charm and vega), summed to the strike. `chain_exposures` takes the per-contract `dealer` in place of
  the side prior; nothing downstream changes shape.

## 5. What the sign now means — and what the Map's words become

Today a negative strike means *call-dominant*. After this lands the sign means **which way dealers hedge**: negative =
dealers short gamma there (moves pushed along), positive = dealers long gamma (moves leaned on). The words keep their
names and are picked off the signed total:

- **the call wall** — the strike above spot with the largest *positive* dealer gamma (dealers long: they sell into a rally
  towards it);
- **the put wall** — the strike below spot with the largest *positive* dealer gamma (dealers long: they buy the dip into
  it);
- **the flip** — where the cumulative dealer gamma, summed from the bottom of the chain, changes sign;
- **the supreme** — the largest magnitude either way, as now.

This is a change to what the colours on the Map and the Weigher say. Noah picks the day it lands; the display is not
changed until the engine's number is the measured one.

## 6. What the screen says, and never says

- Each strike carries the four buckets — customer long calls, short calls, long puts, short puts — as *shares of the open
  interest*, from `s*` and the side totals. That is the display the tweet asks for; where it goes (the Map's matrix cell,
  the Weigher's "The book at N", the Pulse book tile) is Noah's pick.
- **The quality of the sign** is the share of a strike's volume that carried one: `q = Σ |2w − 1| × size / Σ size`.
  Midpoint prints pull it down. It is said in the house's four words — strong · good · caution · poor — on thresholds
  that are a first cut (`0.7 / 0.5 / 0.3`) to be set on the data, and **never as a digit in public** (the no-public-grades
  rule). The matrix's cell and the pointer card say "the sign here is poor" and nothing more precise.
- Every figure built on it is labelled an **estimate** on screen. It is one: spreads, midpoint prints and auctions blur
  it, and there is no ground truth to calibrate against (§8).

## 7. What the tape must carry

`engine/slayer_core/tape.py`'s layout gains one file per name per session:

```
tape/<version>/<SYMBOL>/<YYYY>/<YYYY-MM-DD>/trades.parquet
  one row per option print: contract, sip_ts (UTC), price, size, exchange, conditions,
  bid, ask, bid_size, ask_size (the NBBO at sip_ts), w (the buy weight, §3), signed_size
```

The NBBO at the print's instant is joined from the quote stream at tick level (the last quote at or before `sip_ts`),
written once with the print so a replay never re-derives it. `quotes.parquet` (the five-minute frames), `open_interest`
and `underlying` stay as they are. The depth columns (`bid_size`, `ask_size`) are carried from day one so the second
version (§9) can be tested without a second pull. Massive's Options Business plan sells ten years of trades and two and a
half years of quotes; the signed book reaches back as far as the **quotes** do, since a print without its NBBO cannot be
signed. The vendor seam (`theta.py` → the Massive seam) is the one file that changes for the pull; the field names are
read off Massive's docs on day one.

## 8. How we know it works — without ground truth

We do not have exchange open/close data, so the estimate is checked by what it predicts, and the checks are written down
**before** the first run (the backtest spec's own rule against shortcuts applies to us):

1. **Consistency with the OCC.** On a contract where the day's volume was signed mostly one way and was mostly new (volume
   large against open interest), the next day's official open interest change should move the same way. A day where the
   two disagree across the board is a day the classification is wrong, and the day is examined by hand.
2. **The behavioural test — the one that matters.** Where dealers are long gamma, price should mean-revert and the
   realised range should shrink; where they are short, moves should extend. Over the first two years of tape, for every
   session and every strike within 2% of spot at 10:00 New York: the signed dealer gamma (§4) against the side prior (§2),
   each scored on the next thirty minutes' realised range relative to the day's expected move. **The signed book must rank
   the ranges better than the prior does, by a margin agreed before the run; if it does not, it has not earned its place
   and the prior stays.** The margin and the exact scoring are the one thing to settle with the partner before the run.
3. **Known days by hand.** Monthly expirations, the biggest 0DTE sessions, and a handful of single-name events, read
   strike by strike against the tape.

## 9. The second version — tested, not assumed

The academic work on option trade classification, which had exchange open/close data as its ground truth, found that the
stock-market algorithms (Lee–Ready, the tick test) do poorly on options, that the plain quote rule is the best single
rule, and that trade size against the quoted depth adds a little (Savickas & Wilson, 2003; Grauer, Schuster &
Uhrig-Homburg, "Option Trade Classification"). None of that ships on faith. Candidates for the second version, each run
through §8 against the first:

- **the depth rule** for midpoint prints (the side with the larger quoted size as the likelier passive side);
- **the trade-size rule** (a print whose size equals one side's quoted size most likely hit that side);
- **package reconstruction** for multi-leg prints (legs at the same instant and exchange grouped, the package signed as
  one, the legs' roles inferred from the structure) in place of the half weight;
- **a recency weight** on `s`, if the behavioural test prefers it to the life-long average;
- **exchange-specific rules** for price-improvement auctions.

## 10. What it is not

- Not open/close. OPRA has no flag; the net over the day is the honest substitute.
- Not a certainty, and never shown as one. The four words, an "estimate" label, no public digit.
- Not the partner's math to approve — he has no rule for it (Noah, 2026-10-03), so the method is this page's; the one
  thing to settle with him is the pre-agreed margin in §8.2.

## 11. Where it lands in code

| Piece | Where | What changes |
| --- | --- | --- |
| the ladder (§3) | `engine/slayer_core/signs.py` (new) | `buy_weight(print, nbbo)`, `signed_size`, vectorised over a day |
| the position (§4) | `signs.py` + `exposure.py` | `signed_share`, `coverage`, `dealer_position`; `chain_exposures` takes a per-contract `dealer` array, the prior kept as fallback and band |
| the words (§5) | `walls.py` | the walls and the flip picked off signed dealer gamma |
| the photograph | `snapshot.py` | the four buckets per strike and `q` in `DataQuality` |
| the tape (§7) | `tape.py` + the Massive seam | `trades.parquet` with the NBBO at the print |
| the checks (§8) | `engine/tests/` + a backtest script | the consistency test, the behavioural test, the hand days |
| the browser | `src/data/exposure.ts` and the Map / Weigher / Pulse displays | displays the box's number; the four buckets and the quality word; the TS twin retired when the box serves the book |

Parity fixtures are generated by calling the engine, never typed (the engine's rule). The TypeScript copy of the
exposure math is a reference only until the box serves the signed book, then it goes.
