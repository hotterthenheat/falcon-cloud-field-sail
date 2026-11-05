# EDGE-C pre-registration (written and committed before any DEV outcome was computed)

Worker EDGE-C, 2026-11-05. Protocol: /tmp/qa/V2_PROTOCOL.md incl. anti-bias 10–14. Base origin/main 63f2f60.
Purpose: K5 (SPXW overnight, 00:00–05:59 ET, 0.15Δ on the side of the overnight move, 1.50×/0.5322 hard bracket,
flat 09:20) passed one blind locked look and claims a mechanism: *index futures lead overnight; SPXW GTH quotes are
re-marked slowly by a few market makers with wide/sticky spreads, so an option on the side of the established move
keeps paying as dealers re-mark.* If that is real it must show in the siblings below (S1–S3) and in the direct quote
test (S4). If the siblings show nothing and S4 shows no lag, K5 is a selected cell. Plus one independent family (C1).

## Sets (V2_PROTOCOL 6, fixed)
DEV = sessions before 2025-01-01 outside H1 (2022-06, 2024-08, 2026-10-05..30) and H2 (2022-07..09, 2025-01..03).
For S1–S4 the data in hand (the challenger's raw 1-minute chain cache, read-only) covers DEV sessions 2020-02-18..
04-30, 2022-02-01..05-31, 2022-10, 2024-07 (158 sessions; the same regime samples K5 was developed on, so the
sibling comparison is like for like). VALIDATION = 2025-04-01..12-31 (the cache has 2025-11/12; 2025-04..10 is fetched
only for a DEV survivor). LOCKED (H1 ∪ H2 ∪ >= 2026-07-01) is never read: days are filtered before any file is opened.
C1 uses EDGE's 0DTE caches (v2data/edge): DEV 2020-02..04, 2022-02..05, 2022-10, 2023-01..2024-12 minus 2024-08;
VALIDATION 2025-04..12.

## Common overnight engine (S1–S3; `overnight.py`)
- Session D; the overnight window is calendar D−1 20:15 → D 09:15 ET. Marks every 5 minutes. Expiries: e0 = the
  first listed expiry >= D, e1 = the next one (both chains, as K5's rows carried both sleeves).
- Spot at a mark = the chain's put-call-parity spot from e0 (K + (C−P)e^{rT}, median of the 3 strikes with the
  smallest |C−P|, r = 4.2% — the challenger's `paritySpot`, i.e. K5's own underlying). Overnight move g = ln(S / prior
  close), prior close = the SPX 15:59 one-minute close of D−1 (XSP: /10). Side = sign(g) (call if g > 0); no
  threshold (K5 has none).
- Contract: on the move's side, over e0 ∪ e1, |Δ| in [0.10, 0.20] nearest 0.15 (Δ = Black-Scholes at the parity spot
  with the IV implied by the mid, T to the expiry's 16:00); bid > 0, ask > bid, spread <= 8% of mid, ask size >= 1.
  (K5's band, below the v2 floor of 0.15: stated as a deviation, kept because the siblings must be the *same rule*.)
- Entry at the first eligible mark of the family's window; one trade a session.
- Exploration path (minute data, K5-literal): fill = the ask one minute after the mark; exit = the first minute the
  bid >= 1.50 × fill (TP, +50%) or <= 0.4678 × fill (stop, −53.22%), else the bid at the last minute <= 09:20.
- Protocol path (reported for every variant): FOUNDATION sim (sim/engine.py, MemSession) on 1-second NBBO of the
  called contract: decision at the mark, order arrives +2 s, buys the ask then in force capped to displayed size,
  FixedBracket(1.50, 0.4678) on every quote change, exit orders +2 s at the bid in force, flat 09:20; fee $0.65
  per contract per side; gross and net. (A fixed bracket is K5's own exit; the siblings keep it by design — rule 5
  is noted, not waived: no sibling is a shipping candidate, they are evidence about K5.)
- Return = exit / fill − 1. Win = TP reached. Session-clustered bootstrap 95% CIs (eval.metrics.cluster_ci_mean).

## S1 EVENING (SPXW, the other half of the night; K5 excluded it)
Expected under K5's mechanism: positive, of K5's order (the same dealers re-mark all night). The challenger's own
descriptive scan reported the evening marks losing (recorded, not a new fit).
- S1a: marks 20:15–23:55 (first eligible), K5 contract rule, hard bracket, flat 09:20.
- S1b: marks 22:00–23:55 (after the Asia open has repriced).
- S1c: S1a with |g| >= 0.10% (a move already established).
- S1d: S1a with spread <= 4% of mid (tight-quote nights only).
4 variants.

## S2 XSP (same index at 1/10, different spreads)
Expected under K5's mechanism: positive (same index, same overnight makers); the challenger's scan called XSP flat.
- S2a: K5-literal on XSP, marks 00:00–05:55.
- S2b: S2a with the spread gate relaxed to <= 15% of mid (XSP quotes are wider; the 8% gate may empty it).
- S2c: XSP 00:00–05:55, |Δ| 0.15–0.30 nearest 0.225 (K2b's band, where premiums clear XSP's tick).
3 variants. NDXP: Cboe lists no GTH for NDX options and the terminal shows zero quotes overnight (checked 2024-04-17,
2025-07-16): not testable, 0 trials.

## S3 SIDE SOURCE (SPXW, K5's window 00:00–05:55, a different reference for the overnight move)
There is no futures feed: the terminal serves no futures (404 on /v3/future/*), the SPX index prints 0 overnight, and
K5's c33 is already the SPXW chain's parity spot vs the prior close. So the "parity-spot version" *is* K5; it is run
as the reproduction reference (not a trial). The trials use references independent of SPXW's own quotes:
- S3a: side from the XSP chain's parity spot vs the prior SPX/10 close (an independent GTH quote set on the same index).
- S3b: side from SPY's pre-market NBBO mid vs SPY's prior 15:59 close, marks 04:00–05:55 only (SPY quotes start 04:00).
- S3c: side from the prior regular session's close-to-close return (no overnight information at all: if this does as
  well as K5, the overnight move is not what pays).
3 variants (+ the K5 reference reproduction, 0 trials). Expected: S3a ≈ K5 if the move is in the index; S3b likewise
on its sub-window; S3c ≈ 0.

## S4 MECHANISM (not a trade; 0 trials) — "does the SPXW GTH ask lag the parity-implied fair value after a move?"
On DEV sessions, SPXW and XSP 1-minute overnight chains, windows 20:15–23:55 and 00:00–09:10 separately:
- S4a Lag regression. At every 5-minute mark t with a 0.15Δ contract on the side of the move g: y_h = ln(mid_{t+h} /
  mid_t), h ∈ {5, 15, 30} min, on x1 = signed parity-spot return over (t−5, t) (the move already made) and x2 = the
  signed parity-spot return over (t, t+h) (contemporaneous). Sticky re-marking ⇒ β1 > 0 (the option keeps catching up
  to a move already in the spot) — session-clustered SEs. Also the ask-based version (y on the ask, the price a buyer
  pays) and the same with the fair-value residual: y − |Δ|·S·x2/mid.
- S4b Quote staleness by hour: share of minutes with an unchanged NBBO, median spread/mid, and the time to the first
  re-quote of the 0.15Δ contract after a parity move >= 0.10% in 5 min.
- S4c Attribution of K5's DEV calls (the challenger rows' greeks attribution of the mid's gain to +50%: delta, gamma,
  vega, theta, residual; DEV rows only): the share of the win that is the index moving further (delta+gamma) vs
  re-marking (vega + residual).
- S4d The same S4a on XSP and on the evening window (if only SPXW-after-midnight shows lag, the mechanism is specific).
Reading: the mechanism is supported only if β1 is positive and material (>= ~0.1 of the contemporaneous β2 at h = 15
or 30) on SPXW after midnight AND S4c attributes a material share of the K5 wins to vega/residual.

## C1 CLOSE-FLOW (independent family; SPY, QQQ, SPXW 0DTE; decision 15:00:00 ET; flat 15:58)
Mechanism (who is forced): dealers carry the 0DTE book's hedge; as the book decays into the close its delta drifts
deterministically (charm) and with IV (vanna), and the hedge must be adjusted in the last hour. The required flow has
a sign that is computable at 15:00 from the live book: dealer net position per strike from the morning OI (dealers
long customer-sold calls, short customer-bought puts — the standard approximation, the same convention as EDGE's
E3), delta from BS at the 15:00 spot with each strike's 14:59 IV. Charm flow F_c = −[Δ_d(15:55) − Δ_d(15:00)] (S, σ
held) in shares/contract; vanna flow F_v = −(∂Δ_d/∂σ)·(σ_15:00 − σ_14:00) (IV momentum as the live proxy for the
last hour's IV change). Net dealer gamma Γ_d (same book) and the gamma flip S* (where Γ_d(S) crosses 0, within ±3%)
give the regime: short gamma (Γ_d < 0) ⇒ dealers' hedging amplifies the move the flow starts (momentum); long gamma
⇒ it damps it (reversion), so a long-gamma trade is only taken when the flow is large and spot is >= 0.5 expected
moves from the flip (the sign is then unambiguous for the rest of the day).
Distinct from E1 (day-return momentum at 15:25), E6 (pin toward the max-OI strike) and E3 (range break): the signal is
the *sign of the computed hedging flow*, not a price move or a strike.
- Stage A (gate, underlying only, no option fetch): for each root-session with a 0DTE chain, OI and bars: the
  signed 15:00→15:55 underlying return in the predicted direction. Looks: side ∈ {C: charm, CV: charm+vanna} ×
  gate ∈ {G0: all sessions, G1: |F| >= the trailing 20-session median |F| (past sessions only) and the gamma regime
  rule above}. Pass: mean signed drift > 0 with the clustered 95% CI excluding 0 and permutation p < 0.05 (Bonferroni
  over the 4 looks: 0.0125), and drift >= +3 bp (less cannot pay a 0.30Δ option's spread). 4 looks.
- Stage B (only for a Stage A passer; otherwise C1 fails at DEV with no option look): 0DTE on the predicted side,
  |Δ| nearest 0.30 in 0.20–0.40, spread <= 8%, ask size >= 1; FOUNDATION sim on 1-second NBBO 15:00–16:00, +2 s,
  ask in / bid out, displayed size, fee $0.65/side. Exits (FOUNDATION sim/exits.py): XA = AnyOf(VolBracket(k_tp 1.0,
  k_sl 1.0, horizon = time to 15:55, rv 15 min), TimeStop 15:58); XB = AnyOf(VolBracket(k_tp 2.0, k_sl 1.0),
  TrailingVol(k 1.5, arm 10%), TimeStop 15:58). Variants: {C, CV} × {G0, G1} × {XA, XB} = 8.
Expected sign: positive drift of a few bp; option expectancy positive only if the drift is >= ~5 bp.

## Nulls (anti-bias 11), selection, the bar
- Shuffled signal: the same sessions and marks, side by a fair coin (the opposite side's contract is simulated on the
  same quotes for every entry), 200 draws; synthetic zero drift: the overnight parity-spot path re-simulated at the
  real night's 5-minute realised vol with zero drift, the 0.15Δ contract priced by BS at its real IV with the real
  spread fraction and the same bracket, 200 runs (C1: EDGE's nullsyn design on the 15:00–16:00 window). For each
  variant: the share of null runs that "pass" (expectancy > 0, clustered CI excluding 0) = the pipeline's
  false-discovery rate (<= 5% or the pipeline is broken) and the candidate's percentile (must be >= 95%).
- Selection: per family, the variant with the highest DEV fee-included expectancy among variants with >= 150 DEV
  trades (fewer: the family fails DEV — stated; for the overnight siblings on 158 DEV sessions one trade a night cannot
  reach 150, so a sibling can at most be *evidence about K5*, never a candidate; it goes to VALIDATION once only if
  its DEV CI excludes 0 and it beats both nulls, to see whether the K5 effect replicates in its sibling).
- VALIDATION is scored once per surviving variant. A VALIDATION survivor (expectancy > 0, CI excluding 0) is frozen as
  a FOUNDATION frozen-spec file + commit hash for the blind scorer; EDGE-C never scores the locked test.
- PBO (CSCV, 16 session blocks) over each family's variants; DSR with the global ledger trial count. Every look is a
  ledger line.
