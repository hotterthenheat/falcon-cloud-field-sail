# EMA-MTF strategy specification (Phase 1, EMA-1)

Every definition the Phase 2 grid runs on, fixed before any strategy outcome is seen. Code that implements each
item is named next to it; where code and this text disagree, this text wins and the code is a bug.
Coverage numbers referred to here are in `reports/DATA_COVERAGE.md`; the experiment plan is `specs/PREREG.md`.

Conventions: times are US/Eastern; RTH = 09:30–16:00; prices in dollars per share (option premium ×100 = $ per
contract); "long premium" = buy a call or buy a put and later sell it; no short options, no spreads.

---

## 1. Universe

| item | definition |
|---|---|
| roots | SPY, QQQ, IWM (ETF options, physically settled, PM), SPXW (SPX weekly/daily, cash-settled, PM). SPX (AM monthly root) is measured in the coverage study only: it has no 0–7 DTE contracts except the third-Friday week, its last trading day is the session before its date, and it settles at 09:30 off the opening prints — no intraday EMA strategy can hold it on its date. "Other liquid names" are not in Phase 1 (budget; see §16). |
| DTE | calendar days from the session date to the expiration date: buckets **0**, **1–7**, **8–30**, **31–90**, **91+** (the panel stores 91–200; see §16) |
| representative expiration (per session, root, bucket) | 0: the same-day expiration. 1–7: every listed expiration with 1–7 DTE. 8–30, 31–90, 91–200: the expiration with the largest total open interest on the session's morning report (prior close), ties to the nearer one. "Listed" = present with OI > 0 on that morning report (the calendar list also holds expirations created later, which a trader could not see). `edata/panel.py select_exps` |
| tradable contract (at a decision) | a call or put of a representative expiration whose 1-minute NBBO at the decision bar's end is two-sided, with \|delta\| in [0.30, 0.50] (§7), spread ≤ 8% of mid, displayed ask size ≥ 1, inside the stored strike band (SPY ±15 strikes, QQQ ±12, IWM ±8, SPXW ±30 around that session's spot) |

## 2. Bars

`engine/ema.py`

* **1-minute bar m** (m = 0..389) covers [09:30+m, 09:31+m). It is labelled by its END time 09:31+m. (TradingView
  labels a bar by its START: its "10:04" bar is our bar ending 10:05. The brief's "10:05 bar" — known at 10:05:00 — is
  our end-label convention.)
* **k-minute bar** (k = 5, 15, 30, 60): the union of the 1-minute bars of a k-minute window aligned at 09:30. The last
  60-minute bar of a session is 15:30–16:00 (30 minutes) — 7 hourly bars a session, as charting platforms print
  them for US options. 5m: 78 bars, 15m: 26, 30m: 13.
* **Known time**: a bar is known at its end E (`known_ms = E`). Anything computed from it may be used by a decision at
  time ≥ E and never by a decision < E.
* **Higher-timeframe value at a lower-timeframe decision**: the last COMPLETED higher-timeframe bar (end ≤ decision).
  The forming bar is never read (no repaint). Test: `etests/test_ema.py test_htf_asof_never_uses_the_forming_bar`,
  canary in `etests/test_lookahead.py`.
* **Sessions concatenate**: bars of consecutive stored sessions form one series; the EMA is not reset at the open
  (what a chart shows). Options print RTH only; extended-hours bars are not used for option charts.
* **No synthetic bars**: an interval with no data produces no bar (MID: no valid quote at its end; TRADE: no print).

## 3. The contract's own chart — which price series

`engine/chart.py`, `edata/sip.py`

Three series per contract, all from the stored panel (`edata/panel.py`):

| series | close of a 1-minute bar | high/low | empty interval |
|---|---|---|---|
| **MID** | NBBO mid in force at the bar's end (terminal 1-minute snapshot stamped at the end; verified semantics: a row stamped T is the NBBO in force at T) | none (close-only) | no bar if the quote is one-sided/crossed |
| **TRADE** | last SIP-eligible print in the minute (charting-app bar) | eligible prints' high/low | **no bar** — the EMA advances only on bars that exist (time-compressed) |
| **TRADE_FF** | TRADE close carried forward through empty minutes | — | carries the last print |

SIP eligibility (`edata/sip.py`, ThetaData's Trade Conditions table): cancels 40–44 dropped; open/close from
LAST-eligible conditions (the '*' conditional codes excluded); high/low from HIGH/LOW-eligible; volume/count from
VOLUME-eligible. Multi-leg prints (130–144, 35–38) are SIP-eligible and kept (they are on every chart); a single-leg
variant exists for a sensitivity check. ThetaData's ±5% phantom-print filter is not replicated (measured: §DATA_COVERAGE).

**Trade-print vs NBBO-mid — what is used where (rationale).**
* Illiquid contracts have empty trade minutes (DATA_COVERAGE §3: the share of empty 1-minute trade bars by root and
  bucket). A TRADE-series EMA on such a contract spans hours or days of wall time per N bars, and its "close" can be
  minutes stale against a quote that has moved — the chart a trader sees, but not a price anyone can trade at.
* MID exists every minute a contract is quoted two-sided (≈ every minute of its listed life for these roots) and is
  the reference the fills are taken against, but it is a quote, not a transaction, and wide-spread mids can move
  without any trade.
* **Rule.** (1) All **predictive tests (PREREG Stage 1) and all executable strategy tests use MID as the primary
  chart**. (2) The **TRADE** series is run as the *replication arm* ("what the charting app showed") **only where it is
  dense**: a (contract, timeframe) is TRADE-eligible at a decision if ≥ 80% of the last 2N bars of that timeframe's
  wall-clock grid contained at least one eligible print (N = the longest EMA the model reads). Elsewhere a TRADE result
  is reported as "not testable (sparse prints)". (3) TRADE_FF is a sensitivity only.
* Exit triggers read the MID close; the fill is always the bid after the latency (§6).

## 4. EMAs, seeding and warm-up

`engine/ema.py ema / ema_fast`

* Lengths: 5, 9, 15, 20, 21, 50, 100, 200 on 1, 5, 15, 30, 60-minute bars of the series.
* α = 2/(N+1). Seed = arithmetic mean of the first N valid closes; the EMA is defined from the N-th valid bar
  (NaN before). Missing closes are skipped (the EMA neither advances nor decays).
* `seen_N` = number of valid bars so far. **Warm-up rule (primary): an EMA of length N may be read only when
  seen_N ≥ N** (SMA-seeded and defined). **Strict (sensitivity): seen_N ≥ 2N** (the seed's weight is then
  (1−α)^N ≤ e^−2 ≈ 13.5%). A contract whose EMA is not warm at a decision cannot take that decision — it is not
  replaced by a shorter EMA or by another contract's history.
* Hours needed (MID, primary rule): 1m EMA200 = 200 minutes; 5m EMA200 ≈ 2.6 sessions; 15m EMA200 ≈ 7.7 sessions;
  30m EMA200 ≈ 15.4; 60m EMA200 ≈ 28.6 sessions (7 hourly bars a session). TRADE needs 200 *non-empty* bars.
* Warm-up data come only from the same contract (strike, right, expiration). History that crosses a LOCKED session
  cannot be rebuilt and ends the chart (the store never fetches LOCKED; `edata/common.py sessions_back`).

### 4.1 The EMA-target feedback question

The brief's exits "next EMA" / "partials at successive EMAs" put targets at EMA levels **of the same premium whose
return is being measured**. Four consequences, and how the spec handles each:

1. **A dynamic EMA target is an oscillator, not a level.** EMA_k(t+1) = EMA_k(t) + α(p(t+1) − EMA_k(t)): as the premium
   rises toward a higher EMA, that EMA rises too, so "p ≥ EMA_k" is the condition "price above its own k-average" —
   a momentum state, which partly re-states the entry signal. **Primary: the target level is FROZEN at entry** (the
   EMA values known at the entry bar). The dynamic version is a registered variant labelled "oscillator exit".
2. **Premium has a deterministic drift (theta).** A short-dated OTM premium decays almost continuously; its long
   EMAs lag above it, so "below EMA200" is the normal state for both calls and puts at once and a reclaim of a long EMA
   is partly a statement about time decay pausing (or vega/gamma) rather than about the underlying. Long EMAs on 0–7 DTE
   premium are therefore expected to measure decay. Stage 1 (PREREG) includes a **theta/underlying-reprice control**:
   the same feature computed on a counterfactual premium path = Black–Scholes reprice of the contract along the
   *underlying's* path at the IV frozen at the start of the window. The option chart's incremental information is the
   feature on the real premium minus what that counterfactual already carries.
3. **The option chart is mostly a leveraged underlying chart.** A call's MID ≈ f(S, σ, t). An EMA cross on the call
   chart is close to an EMA cross on the underlying, plus IV and theta. Every option-chart feature is tested for
   **incremental** value over the same feature on the underlying (PREREG Stage 1), never on its own.
4. **Exits on the traded series shape the return distribution mechanically.** "Sell when MID closes below EMA9" cuts
   paths after a down-move of roughly one bar's noise and lets up-paths run, which manufactures positive skew and a
   low win rate from any entry. That is why every entry is compared with **random entries using the same exit**
   (baseline BL2 and the shuffled null), so exit mechanics are not credited to the entry.
5. There is no execution feedback: signals are on MID (or prints by others); our fills are price-taking at the
   ask/bid and never enter the series.

## 5. Decision timing and data availability

| step | time |
|---|---|
| bar m closes | E = 09:31 + m |
| features of every series/timeframe | as of E (bars with known_ms ≤ E); positioning snapshots visible from their stamp; UW alerts from `created_at` |
| decision | at E (entry decisions only for E ∈ [09:31, 15:50]) |
| order arrives | E + latency. **2 s (primary, "L2")**: the NBBO in force at E+2 s from the contract-day's 1-second quotes (`edata/fills.py`, fetched on demand; a 1-minute grid with start_time 09:30:02 is NOT a 2 s grid — it repeats the :00 NBBO, DATA_COVERAGE §6). Screening uses **L0c** (the bar-end NBBO moved by the measured mean 2 s drift, +0.17%/+0.05% of mid buy/sell) with **L60** (the next bar end) beside it; L0 (no latency) is reported as the optimistic bound only (PREREG A1) |
| exit decisions | at every later 1-minute bar close; filled the same way |
| flat | 15:55 bar close (decision 15:55:00, arrival 15:55:02) for every position unless the variant holds overnight (§6) |

The 2-second fill is not "the next bar's open": it is the quote in force 2 s after the close the signal used.
Higher-timeframe signals are still decided at a 1-minute close (the close of the HTF bar, which is also a 1-minute
close). Underlying 1-minute bars are labelled by start time in the vendor data; `engine/underlying.py` converts them
to the same end-time convention (`known_ms = (09:30 + m + 1)`).

## 6. Execution and costs

`engine/execution.py` (equality with compass-v2 `sim/engine.py` fills: `etests/test_exec.py test_matches_compass_engine_fills`)

* **Buy at the ask** in force at arrival, **sell at the bid** in force at arrival. Never at the mid.
* **Size**: capped at the displayed size. Entry remainder cancelled (recorded `partial_entry`); exit remainder sells
  at later bars' arrival bids (`exit_walk_bars`). Default 1 contract.
* **Rejections at arrival** (recorded, not traded): one-sided/crossed quote, ask size 0, spread > 8% of mid.
* **Slippage**: `slip_ticks` extra ticks against us on both sides (0 primary; 1 tick sensitivity). Tick: $0.01 for the
  ETFs (penny pilot), SPXW $0.05 under $3 and $0.10 above.
* **Fees** per contract per side: $0.65 (ETFs); **$1.15 for SPXW** ($0.65 broker + an assumed $0.50 Cboe index-option
  fee); sensitivity at $0.65 and at 0. Reported net and gross.
* **Mid reference**: every trade also carries the mid-to-mid return at the same instants (optimistic, never the result).
* **Intraday theta** is inside the quoted prices (no separate model); every trade logs bars held so decay can be
  attributed (PREREG reports P&L by holding time).
* **Expiry**: an expiring contract is always sold by its 15:55 bar on its expiration date. If no bid exists until the
  data ends, the position is marked at intrinsic value of the underlying's close and flagged `forced_intrinsic`.
* **Overnight**: off by default. The registered overnight variant (PREREG) applies only to 8+ DTE; the position is
  marked at each session's 15:55 bid for drawdown and continues the next session from the first bar.
* **Returns**: `ret_net = (proceeds − cost − fees) / (cost + entry fee)` — the compass-v2 definition.
* **Concurrency**: one open position per (strategy variant, root, bucket); a new entry signal while a position is open
  is ignored (recorded as `skipped_open`).

## 7. Contract selection and greeks at a decision

`engine/bs.py`

* Delta from the MID at the decision bar's end: IV solved by Black–Scholes (r = 0, q = 0) with the underlying's
  1-minute close of the same bar (SPX index for SPXW) and calendar time to 16:00 of the expiration date (60-minute
  floor). r = q = 0 moves deltas by < 0.02 at these maturities except 91+ (≤ 0.04); selection uses a band, not a point.
* Target |delta| **0.40**, band [0.30, 0.50]; nearest to target; ties to the cheaper contract.
* The chosen contract must be warm for every EMA the model reads on the chosen series (§4). A model whose trigger is
  on the option chart evaluates the trigger on **each** tradable contract's own chart (calls for bullish, puts for
  bearish premium setups) and takes the one closest to the delta target among those triggering.

## 8. Entry models A–H

`engine/signals.py`. Notation on one (series, timeframe) table: c = close, E_N = EMA_N, all values of the bar that
just closed; "prior" = the previous bar of the same table. Each model fires on a bar close; all EMAs used must be warm.
Defaults below are the **primary parameters**; PREREG lists the only alternatives that may be tried.

| model | fires when (premium chart of the contract being bought) | primary parameters |
|---|---|---|
| **A EMA reclaim** | prior c < prior E_N and c > E_N | N = 9 |
| **B crossover** | prior E_f ≤ prior E_s and E_f > E_s | (f, s) = (9, 21) |
| **C alignment continuation** | c > E9 > E21 > E50 for ≥ 3 consecutive bars and c > max(c of the prior 5 bars) | hold 3, high 5 |
| **D compression breakout** | prior bar's EMA width (max−min of E9, E21, E50)/c ≤ the 20th percentile of the width over the prior 100 bars (≥ 50 needed), and c > max(E9, E21, E50) and c > max(c of the prior 10 bars) | q 0.2, look 100, break 10 |
| **E MTF pullback** | higher-TF state = +1 (c > E9 > E21 on the last completed HTF bar); on the LTF a low ≤ E21 (MID: close ≤ E21) within the last 3 bars, prior c ≤ prior E9 and c > E9 | HTF = 3–6× LTF (5→15/30, 1→5, 15→60) |
| **F EMA + VWAP confluence** | A or B fires on the option chart AND the underlying's close is on the trade's side of its session VWAP (above for calls, below for puts) AND the underlying's close is on the same side of its EMA21 (same TF) | trigger B |
| **G EMA + GEX confluence** | A or B fires AND the latest positioning snapshot shows dealer net GEX < 0 (inferred) AND no wall against the trade within 0.3% (call: call wall above spot by > 0.3%; put: put wall below by > 0.3%) | trigger B |
| **H early momentum transition** | E5 slope turns > 0 after ≥ 3 bars of E5 slope < 0, c > E5, c < E21, E9 slope ≥ 0 | decl 3 |

"State" of a table = +1 if c > E9 > E21, −1 if c < E9 < E21, else 0 (used by E and the MTF models).
Directional meaning: a model fires on the CALL's chart → buy that call; on the PUT's chart → buy that put. Bullish
premium on a put = bearish underlying; the underlying confirmation (F) is read in the trade's direction.

## 9. MTF models A–F

`engine/signals.py mtf_combine`. A model combines an LTF trigger (one of A–H on the LTF) with the states of higher
timeframes, each read at its last completed bar.

| model | rule (with LTF trigger at the decision) | primary TF sets |
|---|---|---|
| **A sequential** | a trigger of the same model fired on the next-higher TF within the last 3 LTF bars | (1,5), (5,15), (15,60) |
| **B HTF-first** | the highest TF's state = +1 | (5,15), (5,60), (15,60) |
| **C full alignment** | every listed TF's state = +1 | (1,5,15), (5,15,60) |
| **D weighted** | Σ w·state / Σ w ≥ 0.6, w = 1,2,3,4,5 for 1m,5m,15m,30m,1h | (1,5,15,30,60) |
| **E partial alignment** | ≥ majority (⌊n/2⌋+1) of listed TFs at +1 | (1,5,15,30,60) |
| **F momentum transition** | LTF trigger is H; every HTF state ≤ 0; every HTF E5 slope > 0 | (5,15), (5,15,60) |

The timeframes overlap (a 5m bar contains five 1m bars; their EMAs are correlated by construction): PREREG Stage 1
measures each timeframe's **incremental** information conditional on the others, and an MTF model is credited only
with the information the extra timeframes add (§PREREG 4.3). Five aligned timeframes are not five confirmations.

## 10. Exit methods 1–10

`engine/signals.py` (all ten implemented; each is look-ahead-tested with noise after the exit and fires by its own
rule in `etests/test_lookahead.py`). Every exit also has the universal stops: flat at 15:55
(or overnight variant), expiry, data end. Triggers read the trigger-TF MID close at a 1-minute bar close (for a
higher-TF exit, at the HTF bar's close); fills at the bid after the latency.

| exit | rule |
|---|---|
| **1 next EMA** | target = the nearest EMA (9, 15, 20, 21, 50, 100, 200) above the entry mid at entry, FROZEN; stop = nearest EMA below, frozen (none: target +50%, stop −30%). Variant: dynamic levels (oscillator) |
| **2 partials at successive EMAs** | three 1/3 units: sell one unit at each of the next three frozen EMA levels above entry; after the first, the stop of the rest moves to the entry price; initial stop as exit 1. Accounted as three 1-contract sub-trades averaged |
| **3 hold above 9 EMA** | exit at the first trigger-TF close < E9 after the entry bar |
| **4 9/20 bearish cross** | exit when E9 < E20 on the trigger TF (after the entry bar) |
| **5 1-minute structure break** | exit when a 1-minute MID close is below the last confirmed 1-minute swing low (pivot k = 2, confirmed 2 bars later) formed after entry; before one exists, exit 7's stop |
| **6 HTF alignment loss** | exit when the state of the highest TF used at entry is no longer +1 |
| **7 ATR** | bracket at entry mid − 1.5 ATR / + 3.0 ATR, frozen; ATR = Wilder(14) true range of TRADE bars where dense, else 1.25 × Wilder mean \|Δc\| of MID |
| **8 fixed R:R** | −20% / +40% of the entry fill on the mid (comparison only, protocol rule 5) |
| **9 dynamic trail** | stop = running peak MID − 2.0 × current ATR (updated each bar), active from entry |
| **10 combination** | initial stop 1.5 ATR; once MID ≥ entry + 1 ATR, switch to exit 3; exit 6 always active |

## 11. Underlying confirmation

`engine/underlying.py` (look-ahead test: `etests/test_lookahead.py`)

| feature | definition |
|---|---|
| EMAs | as §4 on the underlying's 1-minute RTH closes (SPY/QQQ/IWM stock consolidated bars; SPX index) |
| VWAP | from 09:30, typical price × volume; SPX: SPY's VWAP × (SPX close / SPY close of the same minute) |
| RVOL | bar volume / mean volume of the same minute over the prior 20 sessions; cumulative RVOL likewise (SPX: SPY volume) |
| RSI | Wilder 14 on each TF's closes |
| structure | swing high/low = 2-bar pivot confirmed 2 bars later; BOS = close beyond the last confirmed swing; MSS = BOS against the previous BOS's direction |
| opening range | high/low of the first 5/15/30 RTH minutes, known at 09:35/09:45/10:00 |
| PDH/PDL/PDC | prior RTH session high/low/close |
| premarket H/L | 04:00–09:29 stock bars; SPX: SPY premarket × (prior SPX close / prior SPY close) |

## 12. Positioning (GEX / DEX / vanna / charm)

`engine/positioning.py` — Pinpoint's definitions (slayer/src/data/book/scale.ts, core/dealerSign.ts, data/liveHigher.ts,
core/settle.ts), dealer sign = dealers long calls, short puts:
GEX ($/1%) = side·Γ·OI·100·S²·0.01; DEX = side·Δ·OI·100·S; vanna ($Δ per vol pt) = side·vanna·S·OI;
charm ($Δ per session) = side·(charm/252)·100·S·OI. SPXW books add the SPX AM root until 09:30 of its date.
Inputs: the morning OI report (all expirations) × the vendor's IV of every contract every 30 minutes
(greeks/first_order, expiration=*), spot = the vendor's underlying price at the snapshot.

* **Observed** (no model): OI by strike/right/expiry, near-spot call/put OI, put/call OI ratio, ATM IV.
* **Inferred** (requires the dealer-side assumption): net/call/put GEX (all, 0DTE, ≤7DTE), DEX, vanna, charm, gamma
  flip (re-priced net GEX sign change nearest spot within ±5%), call wall (max call GEX strike ≥ spot), put wall
  (min put GEX strike ≤ spot), hedge per +1% (−net GEX), charm flow to the close.
* Snapshot stamped T (10:00, 10:30, … 16:00) is visible from T + 60 s (compute delay). OI is the prior close: intraday
  OI changes are unknown in real time and are not inferred.
* PREREG tests observed and inferred features as separate feature groups.

## 13. Options-market data

| feature | source / definition |
|---|---|
| IV | the contract's MID-implied vol (§7); ATM IV from the positioning snapshot; ΔIV over the last 15/60 min |
| OI | morning report (prior close) |
| volume | the contract's eligible print volume (TRADE bars); contract RVOL = today's cumulative volume / mean of its prior 5 sessions to the same minute (where history exists) |
| spread | (ask − bid)/mid at the decision |
| flow | Unusual Whales flow alerts (2023-12-06 on; block A only), available at `created_at`, never `start_time`; per root: count and premium of ask-side alerts in the trade's direction over the last 15 minutes |

## 14. Baselines (pre-registered; run in Phase 1 on DEV; `ema_baselines/run.py`)

Common: roots SPY/QQQ/IWM/SPXW; buckets 0, 1–7, 8–30, 31–90, 91–200; contract per §7 (|delta| nearest 0.40 in
[0.30, 0.50]); execution §6 (2 s, ask in/bid out, fees); one position at a time per (baseline, root, bucket); entries
09:45–15:00 decision closes; **exit for all = hold 30 minutes (XT30) or the 15:55 flat**, so only the entry differs
across baselines; a second table uses exit 3 on the 5m MID chart (+ −30% premium stop) to show how much the exit alone
moves results. The 30-minute hold is a convention fixed before any data was looked at (not measured, not tuned).

| id | entry |
|---|---|
| **BL1 buy-and-hold** | every 30 minutes on the grid 10:00, 10:30, …, 15:00: buy the 0.40-delta call AND the 0.40-delta put (two trades), hold 30 min — the unconditional return of holding premium over the same holding period |
| **BL2 random entries** | 6 decision times a session drawn uniformly from the 09:45–15:00 closes (seeded by session×root), side by coin flip |
| **BL3 underlying-only EMA** | underlying 5m E9 crosses E21: up → call, down → put |
| **BL4 option-only EMA** | the contract's own 5m MID E9 crosses above E21 (model B), on the 0.40-delta call or put chart (whichever fires; both may) |
| **BL5 combined** | BL4 AND the underlying's 5m E9 > E21 in the trade's direction at the same close |
| **BL6 plain directional (no EMA)** | at each BL3 decision time, the side of the underlying's last-30-minute return (up → call); same times as BL3 so only the EMA filter differs |

Baselines are references: none is a candidate, none is tuned, their numbers set the bar Phase 2 must clear.

## 15. Data blocks and splits

`data/splits.py` (compass-v2, fixed): DEV < 2025-01-01 (excl. H1/H2), VALIDATION = 2025 (excl. H2),
LOCKED = H1 ∪ H2 ∪ ≥ 2026-07-01, 2026-H1 unassigned. **LOCKED is never fetched** (`edata/common.py guard`).

| block | eval sessions | warm-up history | why |
|---|---|---|---|
| A | 2024-03-01 .. 2024-05-31 (64) | 62 sessions before (from 2023-11-29) | daily SPY/QQQ/IWM/SPXW expirations, UW flow available |
| B | 2022-03-01 .. 2022-05-31 (≈64) | 62 sessions before (from 2021-12) | bear/high-vol regime; SPY/QQQ M/W/F dailies only, SPXW adds Tue/Thu from 2022-04/05 |

Panel tiers per (session, expiration): USE (1-minute q0; fills from on-demand 1-second quotes, edata/fills.py), FULL (1-minute q0, the 6 sessions before first use),
COARSE (15-minute q0: feeds 15/30/60-minute MID EMAs only). Trade bars are 1-minute everywhere.
VALIDATION (2025) blocks are fetched by Phase 2 with the same code after PREREG is frozen.

## 16. Known limitations (stated before any result)

* 91+ is stored as 91–200 DTE; LEAPs > 200 DTE untested.
* Strike bands: long-dated contracts in the band are mostly |delta| ≥ 0.30 (fine for the [0.30, 0.50] rule);
  0.15–0.30 delta contracts of 31+ DTE are mostly outside the stored band — untested.
* Intrabar MID high/low unknown (1-minute snapshots): MID exits trigger on closes only; a stop between two
  closes fills at the next close's bid + latency (a realistic stop-market on a bar-close system, not a resting stop).
* Displayed sizes at 1-minute snapshots; queue position and hidden liquidity unknown.
* SPX fee assumption; SPX VWAP/RVOL/premarket are SPY proxies.
* Greeks for selection use r = q = 0 (bias ≤ 0.04 delta at 91+ DTE).
* Two DEV blocks (≈128 sessions); other liquid single names are not in Phase 1.
