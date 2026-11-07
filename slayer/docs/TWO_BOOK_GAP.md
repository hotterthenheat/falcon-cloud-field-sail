# Two-book gap list — today's code against TWO_BOOK_SPEC_V2

Written 2026-11-07 against commit 5dc317f (the spec's commit). Every line below names where the code before this work
differs from `docs/TWO_BOOK_SPEC_V2.md`, and the fix. "Engine" means the new two-book engine in `src/engine/twobook/`
(this branch); the old code stays for the pages that do not show the two books (Terrain's chart heat, the Weigher,
Paper, Trace), and is marked below where the two-book pages stop reading it.

Status column: **FIXED** (done on this branch), **ROUTED** (the two-book boards no longer read it; the old path is left
for other pages), **OPEN** (not done, with the reason).

## A. The shared Greek engine (§1)

| # | Where | What the code does | What the spec says | Fix | Status |
|---|---|---|---|---|---|
| A1 | `src/core/math.ts:5-10` `normCdf` | Abramowitz–Stegun 26.2.17, abs error ~7.5e-8, and `1 − d·p` in the upper tail (cancellation) | N(x) = ½·erfc(−x/√2) with a full-precision erfc, both tails (§1.3) | `src/engine/twobook/normal.ts`: W. J. Cody's rational erfc (relative error < 1e-15 across the line) | FIXED (engine) |
| A2 | `src/core/greeks.ts:33` | put delta `dfQ·(Nd1 − 1)` (cancels for deep ITM) | code `−ec·N(−d1)` (§1.4) | engine `greeks()` | FIXED (engine) |
| A3 | `src/core/greeks.ts:18-19,71-72` | `t ≤ 0 → 0.0001`, `v ≤ 0 → 0.01/0.0001`: an expired or volless contract is priced as a live one | T ≤ 0 → EXPIRED, excluded; σ ≤ 0 → UNAVAILABLE (§1.5) | engine `contractStatus()`; every board filters on it | FIXED (engine) |
| A4 | `src/core/greeks.ts:14-55`, `higherGreeks.ts:23-63` | parametrised by (r, q); vanna/charm carry the q terms; no single `b` | generalized BSM in (r, b) with `ec = e^{(b−r)T}` and ten Greeks exactly as §1.4 | engine `greeks()` (all ten, one d1/d2) | FIXED (engine) |
| A5 | `src/core/higherGreeks.ts:6,72-74` `perDay` | per-year ÷ **252** trading days | D = 365 calendar days for T and every per-day conversion; per hour when any contract in the board has T < 1 day (§1.1, §4.5) | engine `D = 365`, `boardTimeUnit()` | FIXED (engine) |
| A6 | `src/core/greeks.ts:109-110`, `scale.ts:59,596,628,635,827,829,841,847`, `scale.ts:244` `CHARM_SESSION = 0.01·365·252`, `scale.ts:247` `sessionShare` | charm put on a 252-session clock and scaled by a trading/calendar vol ratio | CHARM = charm·C·M·S / D, D = 365 (§4.4) | engine `exposures()` | ROUTED (two-book boards read the engine) |
| A7 | `src/data/book/scale.ts:672,740`, `src/core/tradingYear.ts:5,110` | T on the 252-session trading clock (`tradingYears`), IVs moved onto that clock (`ivOnTradingClock`) | T = calendar minutes / (365·1440) to the root's settlement instant (§1.1); IV solved under the same T (Rule 0) | engine `yearsTo()` + `settlementMs()` | ROUTED |
| A8 | `src/core/greeks.ts:83-107` `impliedVolFromPrice` | bisection on [1e-4, 5], stops on vol width 1e-8; no no-arbitrage bound test, no tick, accepts bid = 0 | bracket [1e-4, 10], converge to \|price error\| ≤ 1e-10·S; reject bid = 0, bid ≥ ask, mid ≤ lower bound + ½ tick, mid ≥ upper bound (§1.5) | engine `impliedVol()` + `ivFromQuote()` | FIXED (engine) |
| A9 | `src/core/higherGreeks.ts:43-63` | colour and veta are calendar-forward partials (−∂/∂T) with q terms; no `color_T`/`veta_T` | `color_T = +∂Γ/∂T`, `veta_T = +∂vega/∂T` (time remaining); COLOR and VETA exposures carry the minus (§1.4, §4.4) | engine `greeks()` returns `colorT`, `vetaT`; `exposures()` applies −/D | FIXED (engine) |
| A10 | `src/core/greeks.ts:39,42` | vega and rho per vol POINT (÷100) inside the Greek | raw Greeks per 1.00; the 0.01 lives in the exposure (§1.4, §4.4) | engine keeps raw Greeks | FIXED (engine) |
| A11 | everywhere (`scale.ts:601,623`, `liveHigher.ts`, `exposure.ts`) | M = 100 hard-coded | M from a contract-spec table (§2) | `src/engine/twobook/contracts.ts` (root → M, settlement, exercise style, tick) | FIXED (engine) |
| A12 | `src/core/settle.ts:24-100` | AM/PM is per root (good), but AM time is on the trading clock and "the previous session's close" | AM roots run to 09:30 ET on the expiration date in calendar time (§1.1) | engine `settlementMs(root, expiry)` | FIXED (engine) |
| A13 | none | no contract status (§1.5), no UNAVAILABLE/EXPIRED flags | statuses OK / EXPIRED / UNAVAILABLE / MODELED_FLAT_WING_IV | engine `contractStatus()`; boards carry them | FIXED (engine) |
| A14 | `src/core/volClock.ts:105` `smoothSmile` | a missing vol is filled from a smoothed smile line, or the contract carries the at-the-money stand-in (`gammaFlip.ts` `ownIv`) | flat-wing IV: the valid IV of the nearest strike, same expiry and right, provenance MODELED; report the share (§1.5) | engine `fillFlatWing()` | FIXED (engine) |

## B. Spot, carry, forwards (§1.2)

| # | Where | What the code does | What the spec says | Fix | Status |
|---|---|---|---|---|---|
| B1 | `src/core/parity.ts:47` `count = 4`, `:37` spread ≤ 25% of mid, `:61` ±10% check | median of the 4 nearest strikes, filtered on spread | median of the **6** strikes nearest spot with two-sided quotes (§1.2) | engine `parityForward()` | FIXED (engine) |
| B2 | `src/core/parity.ts:68-83` `impliedBookSpot` | S* only for index roots under 7 days, from ONE forward: `S* = F·e^{−rT}`; equities and longer stay on the cash print | ONE S* per timestamp from T1 and TL (≥ 7 days) by log-linear extrapolation; every expiry `b_T = ln(F_T/S*)/T`; `F·e^{−rT}` only as the APPROX fallback | engine `impliedSpot()`, `carryFor()` | FIXED (engine) |
| B3 | `src/core/carry.ts` (r from SOFR, q = 0 or a set yield) | carry b = r − q with q assumed | b_T measured from the parity forward per expiry, never assumed (§1.2) | engine SLAYER mode | FIXED (engine; Model 2) |
| B4 | `src/core/parity.ts:62` | b = ln(F/S_cash)/T against the cash print (the basis goes into carry) | carry measured against S*, never the stale index (§1.2 "Why") | engine | FIXED (engine) |
| B5 | none | expiry without a valid forward has no rule | ln F linear in T between neighbours; last segment's carry flat beyond (§1.2) | engine `forwardCurve()` | FIXED (engine) |

## C. Model 1 — the open-interest book (§3)

| # | Where | What the code does | What the spec says | Fix | Status |
|---|---|---|---|---|---|
| C1 | `src/data/book/load.ts:37` | one date's `spot-exposures/expiry-strike` read is ONE call of `limit=500`, never paged | page until a page returns < 500 rows (§3.1) | `src/data/twobook/model1.ts` walks `page` | FIXED |
| C2 | `src/data/book/load.ts:42-47` | the whole-book walk stops at 6 pages and keeps a partial book when a later page fails (`if (out.size) break`) | paginate to the end; a failed page fails the board (no partial population) | `model1.ts` | FIXED |
| C3 | `src/data/book/scale.ts:176-184,229-232` `liveGammaRows` | each strike keeps its own row `time`/`price`; one book mixes timestamps | a board is built from rows with ONE timestamp (§3.1); rows of other timestamps are reported, not summed | `model1.ts` keeps the modal timestamp, reports the rest | FIXED |
| C4 | `src/data/book/scale.ts:236-243` | GEX = call_gamma_oi + put_gamma_oi, stored negated ("house sign") | GEX = call + put, Slayer sign (+ = dealer long gamma) | `model1.ts` §3.4 conversions | FIXED |
| C5 | `src/data/book/scale.ts:291-299` | DEX = delta_oi ÷ (price·1%), put leg flipped by `keptVendorLeg('P', …, false)` — numerically the §3.4 form, but only on strikes whose contracts were not "painted"; painted strikes use Black–Scholes delta at r = SOFR, q | DEX = (call_delta_oi − put_delta_oi)·100/S for every row (§3.4) | `model1.ts` | FIXED |
| C6 | `src/data/book/scale.ts:279-288` | VANNA from the UW rows is **zeroed**, then replaced by Black–Scholes vanna·S·volPt priced off option-contracts | VANNA = (call_vanna_oi + put_vanna_oi)/IV30, IV30 = `volatility/stats.iv` at the same timestamp (§3.4) | `model1.ts` | FIXED |
| C7 | `src/data/book/scale.ts:300-306`, `:244` | CHARM = charm_oi ÷ (0.01·365·252) × sessionShare (per trading session) | CHARM = (call + put)·100/(365·D), D = 365, then ÷ 24 when the board is per hour (§3.4, §4.5) | `model1.ts` | FIXED |
| C8 | `src/data/book/scale.ts:258-276` (`amGone`, `cutGex`) | settled AM contracts are cut by share from the vendor rows after 09:30 | on an AM-settlement day from 09:30 ET show the expiry as ONE flagged line outside the four totals, and the same population cut from the six (§3.4 step 2, §3.5 population rule) | `model1.ts amFlag` | FIXED |
| C9 | `src/data/book/load.ts` (no expired-row filter on the spot-exposures read) | after 16:00 the vendor's rows still carry today's expiry (measured 16.8% of GEX, 96.6% of charm, §3.3) and they reach the book | drop rows with expiry < snapshot date, and today's expiry at/after 16:00 ET; keep them raw (§3.4 step 2) | `model1.ts` | FIXED |
| C10 | `src/data/book/scale.ts:593-612`, `liveHigher.ts` | vega, vomma, colour, speed, veta, zomma priced at r = SOFR, q, on the trading clock, with the vendor IV or a smile fill | the six in UW_COMPAT: r = b = 0, D = 365, S = row `price`, T to the root's settlement; IV order NBBO-solved → UW IV (APPROX) → flat wing (§3.5) | `model1.ts` + engine `UW_COMPAT` | FIXED (NBBO step: see C13) |
| C11 | the ticker audit (2026-11-07) | UW's open-interest-by-expiry route answers the AM root only for SPX/NDX/RUT | Model 1's population is SPX + SPXW (§3.3) | Model 1 reads per-contract OI from `option-contracts`, which lists both roots; the by-expiry route is not used for the population | FIXED |
| C12 | the ticker audit | index rows carry a coarse `price` (SPX 7385 vs 7376.86; VIX 24.00 vs 25.64) | UW_COMPAT uses the row `price` (§3.5) | used as the spec says; the effect is measured in `docs/TWO_BOOK.md` §Model 1 and labelled on the board ("priced at the listed row price") | FIXED (labelled) |
| C13 | none | no NBBO at the UW row timestamp | §3.5 step 1: IV solved from the NBBO mid at the row timestamp | needs a quote read the open-interest book may not make (Pinpoint reads the vendor's rows only for this book); the six use step 2 (UW IV, APPROX) and step 3, and the board reports the share | OPEN (by the data rule) |
| C14 | `src/data/book/load.ts`, Pinpoint lists | a name only ThetaData lists options on is not offered on Pinpoint | Model 1 "unavailable", Model 2 served | `model1.ts` answers UNAVAILABLE; the Pinpoint list adds the 15 names | FIXED |

## D. Model 2 — the flow book (§4)

| # | Where | What the code does | What the spec says | Fix | Status |
|---|---|---|---|---|---|
| D1 | `src/data/bookMode.ts:91-147` `flowGaps`/`flowChainOf`, `src/core/volClock.ts:151-156` `dealerInventory = oi − ask + bid`, `scale.ts:586-587` | "Live" = **open interest plus signed volume** | never add OI to flow inventory (§6); C = Σ dealer-signed sizes only (§4.2) | Live toggle removed; Model 2 is `src/engine/twobook/classify.ts` + `src/data/twobook/flowBookServer.ts`, inventory from prints only | FIXED |
| D2 | `src/data/book/scale.ts:591-592` | the flow book's gamma/delta come from the vendor's `_ask`/`_bid` columns (UW volume × UW Greeks) | Model 2 uses no `_oi` fields and no vendor exposure; Greeks from Slayer SLAYER mode (§4, §6) | server flow book | FIXED |
| D3 | `src/data/printTags.ts:103-111` `sideAtQuote` | a print within 20% of the spread from a side counts as that side (`NEAR_SIDE = 0.8`); stale only past 5 minutes (`STALE_QUOTE_MS`, `:98`); no aggressor flags; no extended-hours, complex, cross, late handling | §4.1's 14 rows in order: inside the spread is MID (0); stale is quote age < 0 or > 1,000 ms; 145/146 aggressor flags; 1/65/118/148 extended hours; complex 35-38,124,130-144,147; cross 45,127,128; late 2,5,6,13,15 | engine `classify()` | FIXED (Model 2); `sideAtQuote` kept for Terrain's flow pane |
| D4 | `src/data/tapeServer.ts:329-331` (`optionTagsOf` returns null on a cancel) | a cancel print is dropped; the trade it cancels stays | CANCEL removes the trade it cancels, linked through the vendor's sequence/reference; log any cancel that cannot be linked | engine `accumulate()`: the trade_quote rows carry only `sequence` (no reference field), so a cancel is linked to the latest earlier print of the same contract, price and size; unlinked cancels are counted and logged | FIXED |
| D5 | `src/data/tapeServer.ts:616,684` `strike_range=30`, `:93-95` `DAY_EXPIRIES = 4`, `DAY_MAX_DTE = 14` | the tape reads 30 strikes either side and, on the current day, the 4 nearest expiries within 14 days | Model 2 from all of the session's prints | the flow book reads the tape's population; the board states it ("nearest four expiries, 30 strikes either side, today's prints") | OPEN (terminal cost; labelled) |
| D6 | `src/data/book/scale.ts:593-594` | the flow book's Greeks priced at the cash spot (or a one-forward S*), r = SOFR, q | revalue at every update from the current NBBO mids in SLAYER mode: S* from parity forwards, b_T per expiry, IV solved under (S*, K, T, r_T, b_T) (§4.3) | server flow book revalues on each tape pass from `/option/snapshot/quote` | FIXED |
| D7 | `src/components/gex/ExposureField.tsx:1314-1316`, `src/data/levelsFor.ts:133-134,200,224`, `src/pages/terrain/Terrain.tsx:235,257,937` | one Settled/Live toggle switches the walls, flip, regime and strike rail between the OI book and OI+flow | the books are never mixed; Live = OI + flow removed | the toggle is gone; the levels, flip, regime and rail read the open-interest book; the flow book is its own board | FIXED |
| D8 | none | the flow book lives in each browser | the server keeps one book per name, shared by every viewer; the browser asks the server | `/api/flowbook/<T>` | FIXED |
| D9 | none | no hedge figures (§5) | dealer delta units, hedge dollars, hedge in SPY/ES/MES, total_gex_change_1pct | engine `hedge()`, `totalGexChange1pct()`; Model 2 board | FIXED |

## E. Display and provenance (§4.5, §8)

| # | Where | What the code does | What the spec says | Fix | Status |
|---|---|---|---|---|---|
| E1 | `src/core/readGreek.ts:85-91,282-285` | charm and theta per trading session (÷252) | per calendar day, or per calendar hour when any contract has T < 1 day; one unit per board, labelled; "rate" when T < 1 h | engine `boardTimeUnit()`; both boards | FIXED (two-book boards) |
| E2 | `src/data/bookMode.ts:22-25` | "Live — the book as the session trades" / "Settled" | "Open-interest book" and "Flow book", each with provenance, unit, mode, timestamp, share on modelled IV; never shown as verified dealer inventory | `src/pages/pinpoint/TwoBooks.tsx` | FIXED |
| E3 | everywhere | no per-metric provenance (OBSERVED / CALCULATED / MODELED / APPROX / EXPIRED / UNAVAILABLE) | per metric (§3.6, §8) | both boards | FIXED |

## F. The owner's earlier notes (`/home/user/revamp/docs/signed-book-spec.md`, `engine/slayer_core/*`)

They predate v2: the signing ladder there grades a print by quote position (near-side counts) and rolls flow onto open
interest, both of which v2 forbids (§4.1 row 14, §6). `engine/slayer_core/greeks.py` uses the 252 clock for per-day
figures. Nothing from them is carried into the engine.
