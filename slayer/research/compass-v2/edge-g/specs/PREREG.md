# EDGE-G pre-registration: the three leads of the 2026-11-05 live scan (R1 flip, R2 wall room, R3 realised > implied)

Written and committed before any book, trigger or outcome is computed. The only terminal reads before this commit were
two format probes (one SPY EOD-greeks day, one SPX OI day; no strategy quantity computed; logged in LOG.md).
Protocol: /tmp/qa/V2_PROTOCOL.md incl. anti-bias 10-14. Long calls and puts only, 1 contract, buy to open / sell to
close. Source of the leads: live/REPORT-2026-11-05.md (one crash day, contract-minute AUCs; 2026-11-05 is never a test
day). R4 (Compass p1 as side selector) is NOT testable on history: the engine's score history starts 2026-10-29 (inside
LOCKED) and Model 1's live inputs were never recorded -> 0 trials. R5 (pullback inside the trend) is the dead VWAP-pullback
family -> not re-run, 0 trials.

## Splits (data/splits.py, never edited)
DEV = EDGE's DEV sessions (2020-02..04, 2022-01..05, 2022-10, 2023-01..2024-12 minus 2024-08) where the root has a
same-day expiry (edge/chain present), split_of(day) == 'DEV' asserted on every read. Sessions whose PRIOR session is
LOCKED are dropped (their prior-close IVs would be a LOCKED read): 2022-10-03, 2024-09-03 (and 2025-04-01 for VAL).
Half days (< 300 one-minute bars) dropped (exchange calendar, known in advance). VALIDATION = 2025 (EDGE's 2025-04..12
sessions) scored once, only for a variant that passes DEV by the bar below. LOCKED (H1, H2, >= 2026-07-01) never fetched
or opened.

## Roots
SPY, QQQ, IWM, SPXW (traded). SPXW's book also counts the SPX AM monthly root (core/settle.ts: an AM contract dated E is
priced to the close of the session before E and is gone from 09:30 ET on E).

## The book (point in time; Pinpoint's audited definitions)
- OBSERVED positioning: open interest from the morning report of session D (= the prior close; EDGE's cache
  v2data/edge/oi, plus the SPX root fetched here), every expiry D..D+31 calendar days (the "ALL" cut; LEAPS beyond 31 days
  are left out: their gamma is small and was never cached), strikes within +-12% of the 09:30 open.
- Vols: 0DTE contracts: IV solved at the mid of the 1-minute chain quote stamped (t-60)//60 (EDGE's convention), spot = the
  last closed 1-minute bar's close; a 0DTE contract without a usable quote takes its expiry's smile at that strike
  (flipLevel.ts smileOf: OTM side, linear, flat past the last strike), else the ATM vol. Other expiries: the PRIOR session's
  EOD implied vol (ThetaData /option/history/greeks/eod, fetched here; known at the prior close), moved onto the trading
  clock sigma_tr = sigma_cal * sqrt(T_cal/T_tr) at its EOD stamp; missing -> that expiry's EOD smile, else ATM.
- Clock: trading years = trading minutes to 16:00 ET of the expiry / (390*252), five minutes at least (tradingYear.ts);
  AM contracts to the close of the session before their date. r = q = 0 in the history book (2020-2024 rates; a stated
  approximation; the parity test runs the TS defaults).
- INFERRED dealer hedging (a model, not an observation): dealers long the calls and short the puts (core/dealerSign.ts,
  the vendor's convention). Dealer dollar gamma per leg = side * OI * 100 * Gamma(S) * S^2 * 1% (side +1 calls, -1 puts);
  the house sign is its negative.
- Flip: core/gammaFlip.ts repricedFlip, ported to Python (sticky-strike re-pricing of each leg, +-10%, the 240-step broad
  grid + exact narrow legs, OUTRIGHT_D1 = 6, the OI cap, quietLegs, bisection), with flipLevel.ts stickFlip hysteresis
  (STICK_FRAC 0.4% of spot, a kept crossing given up after 3 missing reads over >= 120 s) on one read per minute from 09:46.
  Regime = sign of the net at spot. FRONT cut = the 0DTE legs only (reported, not traded on).
- Walls: core/walls.ts pickLegWalls (call wall = max |call-leg gamma|, put wall = max |put-leg gamma|), supreme = max
  |call + put| per strike (pinpointRaw levelsOfRows); all re-priced at S_t.
- PARITY TEST before any trigger is computed (parity/): (A) the Python port vs the TS functions themselves (tsx, same
  legs: repricedFlip flip/netAtSpot/crossings, netGammaAt, pickLegWalls) on the recorded pinpoint-2026-10-29 legs, on
  synthetic legs (narrow, outright, capped, s0 != spot) and on DEV books -> must agree to 1e-9 relative; (B) the
  recorded book (pinpoint-2026-10-29 SPY, NVDA; today and all scopes): net, call wall, put wall, supreme read by Python
  straight off the raw rows must equal pinpoint-golden.ts GOLD exactly; the Python flip on those rows' legs must land within
  0.02% of spot of GOLD (the golden's own independent-repricing tolerance). If (A) fails, nothing is run until fixed.

## Execution (protocol rule 2; 1-second NBBO, fetched per contract; EDGE sim conventions)
- Decision at a minute boundary t. Visible: 1-minute bars with start <= t - 60; chain/board stamp (t-60)//60; 1-second
  quotes stamped <= the decision second. EM_h = S * IV_atm * sqrt(h / (390*252)), IV_atm = mean of the 0DTE call and
  put IV at the strike nearest S (trading clock).
- Contract pick on the board at t-60: same-side contracts of the expiry, bid > 0, ask > bid, IV solvable, spread <= 8% of
  mid, ask <= 0.6 * S * sigma_atm * sqrt(T_exp) (EDGE's gate), |delta| nearest the target within +-0.08. No pick -> no
  trade (counted). Cells (fixed): 0DTE delta 0.30, 0DTE delta 0.45, 1-7 DTE delta 0.45 (1-7 DTE = the first expiry after
  the session if <= 7 calendar days out: edge-r's boards for SPY/QQQ/SPXW, a 1-minute snapshot fetched here for IWM).
  Far-OTM cheapest contracts are never picked (prior workers: -11% to -74% a trade).
- Entry: buy 1 at the ask of the first 1-second quote >= t + 2 s with bid > 0, ask > bid, ask size >= 1, within 60 s.
- Exits: decided on 1-second quotes; stops/trails act only on a sane quote (bid > 0, spread <= 25% of mid); an exit
  decision at second s fills at the bid of the first 1-second quote >= s + 2 (as is, 0 if 0). Flat decision 15:50:00.
  X-A (R1a, R1b, R2): a resting sell limit at 1.50 x the fill, live from fill + 2 s, filled at the limit when a quote's
  bid >= limit; stop when bid <= fill - D_A, D_A = clamp(1.0 * |delta| * S * IV_atm * sqrt(30/(390*252)), 0.20 fill,
  0.50 fill); time stop decision at t + 60 min. R1a adds the signal-decay exit: a closed bar closes back across the held
  flip by >= b (below).
  X-B (R3): vol-scaled trail: exit when bid <= peak - D_B, peak = max(fill, max sane bid since fill),
  D_B = clamp(1.5 * |delta| * S * sigma_rv * sqrt(15/(390*252)), 0.15 fill, 0.50 fill), sigma_rv = RV_so_far at t;
  time stop decision at t + 90 min.
- Costs: $0.65 per contract per side; ret_gross = exit/ask - 1; ret_net = (100(exit-ask) - 1.30) / (100 ask + 0.65)
  (sim/engine.py's formula); both reported. $ per $ risked = sum net P&L / sum (100 ask + 0.65).

## Leads and variants (mechanism first)
Common: marks M = {11:00, 12:30, 14:00}. r30 = ln(S_t / S_{t-30}) on closed bars. RV_so_far = sample stdev of the
1-minute log returns between consecutive closed-bar closes from the 09:30 bar to t-60 (>= 5 returns) * sqrt(390*252)
(live/scan_build.py realized()), the underlying's own prints (SPX index for SPXW).

**R1 short-gamma flip.** Mechanism: on the dealer-short side of the flip dealers hedge WITH the move (buy rallies, sell
dips), so a move that crosses into it accelerates. Observed: OI; inferred: dealer sign and BS gamma.
- R1a FLIP-CROSS (the scan's proposed rule): reads 09:46-15:00 each minute; b = 0.10 * EM_1h; pos_t = sign(S_t - F_t)
  when |S_t - F_t| >= b (else the last nonzero pos). Trigger at the first t where pos flips sign with the SAME held
  crossing (|F_t - F_prev| <= 0.4% S) and the ALL book's net at S_t is dealer-short (house > 0). Side = the crossing
  direction (up -> call, down -> put). One trade per root-session. Exit X-A + re-cross. Expected sign: positive; larger
  when the FRONT book is also dealer-short at entry (reported split).
- R1b FLIP-AHEAD (the measured feature dir_all_flip_pct > 0, AUC 0.85): at the first mark of M where the held flip lies
  0.25..1.50 EM_1h from S; side = toward the flip (call if F > S). No regime condition. One trade per root-session.
  Exit X-A. Expected sign: positive; puts (moving into the usual short side below the flip) >= calls.

**R2 clear path to the wall.** Mechanism: large gamma strikes hold price (dealers long gamma there absorb, short gamma
there are the level the move stalls at before it breaks); an option with a long path to the next big strike can travel.
Base events B: every mark of M with |r30| >= 1.0 * EM_30m (as a log move), side = sign(r30) (the trend side; Compass's
side is not available on history). W = the strike with the largest |net dealer gamma| among strikes beyond S in the side's
direction within 10%; d_W = |W - S| (none -> clear).
- R2-CLEAR: B with d_W >= 1.0 * EM_1h. Exit X-A. Expected: positive and > R2-BLOCKED.
- R2-BLOCKED (pre-registered contrast): B with d_W < 0.5 * EM_1h. Exit X-A. Expected <= R2-CLEAR.

**R3 realised outrunning implied.** Mechanism: intraday vol clusters; when realised since the open runs above the ATM
implied, the market under-prices the rest of the day and short-option dealers must chase. Goes at the long-option cost
(0DTE realised/implied ~0.91 on DEV).
- R3: B with RV_so_far / IV_atm >= 1.25. Exit X-B. Expected positive.
- BASE (reference, counted): all of B with X-A and with X-B (the trend-only entries the R2/R3 filters are drawn from).

Trials (ledger): R1a, R1b, R2-CLEAR, R2-BLOCKED, R3, BASE-XA, BASE-XB = 7 rules x 3 cells = **21 variants**.

## Nulls (anti-bias 11) and statistics
- N1 side-shuffle: same triggers/times/cells, side by fair coin, 200 draws (needs the opposite-side contract's path;
  fetched for 0DTE cells first, 1-7 DTE if time allows; a cell without it reports N1 as not run).
- N2 filter-shuffle (R2, R3; the scan's "ratio shuffled across names"): random subsets of B of the same size and the same
  per-mark count, 1,000 draws, real outcomes; report the variant's percentile.
- N3 synthetic zero drift: 100 runs per variant; the underlying re-simulated per root-session at the real day's 5-minute
  RMS profile with zero drift (1-minute steps, 10-second sub-steps); triggers recomputed on it (R1: the real book's
  crossings at each minute, held/nearest at the synthetic spot; R2: the walls re-priced at the synthetic spot; R3: the
  synthetic RV vs the real IV); options priced Black-Scholes at the entry IV on the trading clock, bid/ask = model mid -+
  the real entry half-spread; same exits. Report the share of runs passing (CI > 0) = FDR (must be <= 5%) and the real
  result's percentile.
- Per variant: n, skips, win rate (net > 0), expectancy net and gross with a session-clustered bootstrap 95% CI (4,000),
  median, payoff, $ per $ risked, by year, by DTE cell, call vs put, by day type (|SPX 09:30 open to 15:59 close| <
  0.5%, 0.5-1.5%, > 1.5%: ex-post strata, never an input), R1a by front-book sign. PBO (CSCV, 16 blocks) over all 21
  variants' per-session means; DSR at the ledger's total trial count.
- PASS DEV iff n >= 150, net expectancy CI > 0, win >= 55% or expectancy >= +10%, beats >= 95% of N1 (where run) and N2
  (R2/R3) and of N3, N3 FDR <= 5%. R2 additionally needs R2-CLEAR - R2-BLOCKED > 0 (CI on the per-session difference).
  Only a passing variant is fetched and scored once on VALIDATION; nothing else touches 2025; nothing is frozen unless
  VALIDATION's CI excludes 0.

## Fetching and resumability
F1 prior-session EOD greeks per root (SPY, QQQ, IWM, SPXW, SPX) per session, max_dte 35, cached compact
(v2data/edge-g/eod). F2 SPX-root OI per SPXW session (v2data/edge-g/oi_spx). F3 IWM next-expiry 1-minute board
snapshots at the decision minutes. F4 1-second NBBO per picked contract, window [t, min(t + 92 min, 15:52)], change rows
(v2data/edge-g/q1s; reuses edge, edge-t, edge-r, edge-k caches when they cover the window). One request in flight. Phases:
P1 0DTE cells, P2 1-7 DTE cell, P3 opposite side 0DTE (N1), P4 opposite side 1-7 DTE; each phase in one seeded random
session order (seed 20261106); a cut is on time or disk (stop if free < 3 GB; budget 1 GB), never on outcome, and is
reported. Every per-session file is written atomically (tmp + rename).
Look-ahead test with canaries (tests_lookahead_g.py) before any outcome is read: triggers and picks identical with every
later bar and later board replaced by noise; canaries that read the forming bar / the next board must be caught.
