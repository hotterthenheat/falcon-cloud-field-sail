# EDGE-T pre-registration (written and committed before any EDGE-T fetch or outcome)

Source: the live session of Thu 2026-11-05 (SPX opened 7678.72, about −3.5% by 11:00 ET). Lessons seen live:
(1) most of the move came 09:30–09:45, before Compass Model 1 can score (minutes 15..330); (2) a fixed 1.5x take-profit
cut calls that ran to +120..+195%; (3) a "stock reversed over the last 5 minutes" exit (compassParams REVERSAL 0.40%)
cut puts that later paid; (4) a stop fired on a one-lot bid inside a 51%-wide quote; (5) EDGE-M: 10:00:00–10:00:06
quote blowouts. The question is whether rules that would have caught this day make money across many days or only
on days like it. Owner constraint: long calls/puts only. Protocol: /tmp/qa/V2_PROTOCOL.md (incl. 10–14).

## Data and execution (common to H1–H3)
- Sessions: DEV = edge/fetch.want_days('DEV') (656 sessions, pre-2025, locked H1/H2 excluded); roots SPXW (SPX index),
  SPY, QQQ on root-sessions with a same-day expiry in EDGE's chain store (`v2data/edge/chain`, read only). Sessions
  are processed in a seeded random order (seed 20261105); if fetch time forces a cut, the cut is on time, not outcome,
  and is reported. VALIDATION (2025) is fetched/opened only if a variant passes the DEV bar below. LOCKED never.
- Underlying: EDGE's 1-minute bars (`v2data/edge/bars`). A decision at t sees only bars that closed (start <= t − 60).
  O = open of the 09:30 bar. Day guard: >= 300 bars (EDGE's; removes scheduled half-days).
- Contract: 0DTE, from the chain board stamped minute (t − 60)//60; contracts with bid > 0 and ask > bid; IV solved at
  mid (BS, T = (960 − t/60)/(252·390)), |delta| at S(t) = last closed bar close; the side's contract nearest the target
  |delta| inside [0.15, 0.50] with ask <= 0.6 × EM (EDGE's select cap; EM = S·IV_ATM·√T). No contract -> no trade.
- 1-second NBBO for the chosen contract (terminal, 1 request in flight before 16:05 ET, <= 2 after), from the decision
  to 15:51:00, cached under `v2data/edge-t/` (budget 1 GB; stop fetching if disk free < 1.5 GB).
- Entry (RULES.md): the quote in force at t + 2 s. It must be SANE: bid > 0, spread <= 12% of mid, bid size >= 2,
  ask size >= 2. Otherwise skip (logged). Buy 1 at that ask.
- Exits "RT" (RULES.md, exactly): checked every 10 s from the fill second, on sane quotes only: stop when bid <= 0.65 ×
  fill; peak = the fill quote's bid, updated on each sane check; once peak >= 1.50 × fill, exit when bid <= 0.75 × peak;
  flat decision at 15:50:00. No fixed take-profit. Exit fill = the bid in force at decision + 2 s (whatever it is).
- Costs: fee $0.65/contract/side; every number reported net and with no fee (RULES.md is a no-fee paper list).
- Deviation from protocol rule 4 (spread <= 8%): the RULES.md sanity line (12%, sizes >= 2) is used, as written live.
  Exits are fixed-% (RULES.md), not vol-scaled: they are the rule under test.

## H1 OPENING DRIVE
Mechanism: the opening auction releases overnight information and imbalances; when the first minutes move hard,
the remaining imbalance keeps being worked (sliced institutional orders), dealers who end up short gamma hedge in the
direction of the move, and stops cascade, so the drive continues (intraday momentum: Gao-Han-Li-Zhou 2018; opening-
range breakouts). Counter-evidence: EDGE's E2 found partial reversal by 10:00. Expected sign: positive gross; net
uncertain against the 0DTE round trip.
- σ_prev: realised vol of the root's own underlying over the immediately prior trading session = sqrt(Σ ln(c_i/c_i−1)²)
  over its 1-minute closes 09:30–15:59 (>= 300 bars). If the prior session is LOCKED (2022-10-03, 2024-09-03) or has no
  bars, the root-session is skipped and the locked day is never read.
- Decision times t = 09:31:00, 09:32, ..., 09:35:00 (bars 09:30..09:34 closed). Trigger at the first t with
  |S(t)/O − 1| >= k σ_prev; side = the sign (up -> calls, down -> puts). One trade per root-session per variant.
- Variants (4): H1-k0.30-d0.20, H1-k0.30-d0.35, H1-k0.60-d0.20, H1-k0.60-d0.35 (k = threshold, d = target |delta|).
  Exits RT.

## H2 TREND DAY (v2data/live/trendday/RULES.md, exactly, with one substitution)
- Marks t = 09:45:00, 09:50, ..., 15:25:00 (Compass's 5-minute marks; no new entries at/after 15:30).
- At t: spot = close of the SPX bar that started at t − 60; lo/hi = min/max of SPX bar lows/highs from 09:30 through
  that bar and spot. Puts if spot/O − 1 <= −1.5% and spot <= lo × 1.0035; calls if >= +1.5% and spot >= hi × (1 − 0.0035).
- Every root (SPXW, SPY, QQQ) trades on SPX's trigger. At a trigger mark, a root with no open position (its last exit
  fill second <= t) enters; re-entry allowed at a later mark after an exit. One contract.
- SUBSTITUTION: RULES.md takes "the root's 0DTE contract on the trend side with the highest Compass Model 1 score".
  Model 1 scores do not exist on history, so the contract is the fixed-delta pick above. Variants (2): H2-d0.35, H2-d0.20.
- Fill, sanity, exits RT, flat 15:50: identical to RULES.md (as above).

## H3 EXIT RULES (entry set: the H1-k0.30-d0.35 entries, rebuilt causally above, both sides)
A 2 × 2 × 2 factorial on the same entries and paths; stop −35% and flat 15:50 in every cell; checks every 10 s:
- profit: TR = RULES.md trail (arm +50%, exit at 0.75 × peak) vs TP = a resting limit sell at ceil(1.50 × fill, cent)
  placed at the fill, filled at its price at the first 1-second quote whose bid >= it (no polling);
- reversal: off vs on = at each minute boundary after the fill, r5 = c(m−1)/c(m−6) − 1 of the root's underlying closed
  bars; exit if r5 <= −0.40% (calls) / >= +0.40% (puts) (compassParams.ts REVERSAL = 0.004);
- quote: sane (RULES.md filter on the stop/trail checks) vs raw (any quote with bid > 0).
Cell (TR, off, sane) is H1-k0.30-d0.35 itself; 7 new variants: H3-TR-rev-sane, H3-TR-off-raw, H3-TR-rev-raw,
H3-TP-off-sane, H3-TP-rev-sane, H3-TP-off-raw, H3-TP-rev-raw. Reported as levels and as paired per-trade differences vs
the base cell (session-clustered bootstrap). Expected: TR >= TP only on trend days; sane >= raw; reversal-exit sign
unknown. H3b (optional, counted only if run): the same 8 cells on EDGE's E3 real-side entries (SPXW/SPY/QQQ).

## Trend-day dependence (pre-registered breakdown, every variant)
- SPX day move |C/O − 1| (C = the 15:59 bar close): < 0.5%, 0.5–1.5%, > 1.5%; and "first 15 minutes held":
  sign(c(09:44 bar) − O) == sign(C − O). Per bucket: n, expectancy, total P&L share. Question: do the losses on
  reversal / range days eat the trend-day wins? (Outcome-defined buckets: descriptive only, never a trading filter.)

## Nulls, overfit control, bar
- Shuffled side: both sides simulated at the same entry times (opposite-side contract by the same rule), side by fair
  coin per trade, 200 draws; real-beats rate and null CI-pass rate (FDR).
- Synthetic zero drift: EDGE's nullsyn generator (10-s path at the real day's 1-min vol, zero drift, gap N(0, 0.4σ_d));
  trigger recomputed on synthetic bars; strike nearest target delta at the real ATM IV (flat smile), BS prices, the
  variant's real median entry spread; RT exits on the 10-s grid; 100 runs; real-beats rate and FDR (must be <= 5%).
- PBO (CSCV, 16 blocks) over H1's 4 variants and over H3's 8 cells; DSR at N = ledger trials incl. these.
- Look-ahead test with canaries (triggers/selections with later bars/boards hidden; exits on paths cut at the exit fill;
  a canary that reads the forming bar and one that peeks 60 s ahead must be caught).
- A variant goes to VALIDATION only if on DEV: n >= 150, expectancy net CI excludes 0 (> 0), and it beats >= 95% of
  both nulls. Otherwise nothing is fetched for 2025 and nothing is frozen.
