# EDGE-L pre-registration (long calls/puts only) — written and committed BEFORE any outcome is computed

Owner constraint: buy to open, sell to close; no spreads, no selling. A straddle = two separately bought long legs.

Why long options lose on average: buyers pay the variance risk premium (implied > realized). A long-only edge must
come from days on which the market under-prices the coming move and that are knowable in advance.

Data (read-only reuse; nothing outcome-bearing is read at a decision):
- 0DTE 1-minute NBBO chains SPY/QQQ (±14 $1 strikes) and SPXW (±24 strikes), 1-minute bars SPY/QQQ/SPX, from
  `v2data/edge/` (EDGE worker; audited). Chain row stamped m = NBBO in force at m:00 (FOUNDATION interval semantics).
- Opening dealer-gamma book per session from `slayer/research/physics/results/gravity_rows_{SPY,QQQ}.json`
  (OI stamped 06:30 = prior settle; prior-evening per-contract IVs; gamma re-priced at the 09:30 open; 0–10 DTE
  within ±30 strikes; "dealers long calls, short puts"). Known by 09:31. SPY from 2023-02, QQQ from 2024-01.
  SPXW has no own book here: SPXW uses SPY's book as a stated proxy (same index exposure).
- 1-second NBBO for the traded contracts, fetched by EDGE-L (`v2data/edge-l/q1s/`), one request in flight.
Splits: protocol rule 6 (`data/splits.py`). DEV = 2023-2024 sessions (ex 2024-08 H1); VALIDATION = 2025-04..12.

## L1 CHEAP VOL (8 variants)
Mechanism: (i) realized vol is forecastable (HAR, −1/3 error vs 20-day RV); (ii) on short-gamma days dealers hedge
pro-cyclically (buy rallies / sell drops) and the day realizes ~15% more vol than a HAR+VIX forecast relative to
long-gamma days; a 0DTE price set largely off backward-looking vol does not fully price that. When our forecast of
the REMAINING session's move exceeds the move the ATM straddle implies, buying the move has positive expectancy.

Decision times T ∈ {09:45:00, 10:30:00}. Every input is stamped strictly before T (asserted in code; a peek raises):
1-minute bars with bar start ≤ T−60 s (closed), the chain snapshot stamped T−60 s, the gamma row (09:30 open).
- RV: sum of squared 1-minute log returns (first return from the 09:30 bar open). RV_day(d), RV_sofar(T) =
  09:30→T, RV_rem(T) = T→16:00 (target).
- Forecast (per root, OLS in logs): log RV_rem(T) ~ 1 + log RV_day(d−1) + log mean RV_day(d−5..d−1)
  + log mean RV_day(d−22..d−1) + log RV_sofar(T) + 1[net<0] + clip(net / median|net| over the prior ≤60 book rows
  (≥20 required), −5, 5). DEV: expanding window, refit on the first session of each month on prior DEV sessions only
  (≥60 required; earlier sessions are not traded). VALIDATION / frozen: fit once on all DEV sessions.
  Forecast variance F = exp(ŷ + s²/2) (s² = fit residual variance).
- Implied: ATM strike = strike nearest the spot (last closed bar's close; SPX for SPXW); IV of call and put from
  the chain mids at T−60 s (Black–Scholes, r = 0, τ = time to 16:00 in calendar years); σ_imp = mean of the two;
  implied sd of the remaining log move I = σ_imp·√τ. Ratio R = √F / I.
- Trigger: R ≥ k. Contract rules at the T−60 s snapshot: bid > 0, spread ≤ 8% of mid, ask size ≥ 1; straddle legs
  = the ATM call and put, each |Δ| in 0.35–0.65 (owner: ~0.50 legs allowed); directional leg |Δ| in 0.30–0.40,
  nearest 0.35, on the side of the move so far (sign of last closed bar close − 09:30 open; for 10:30 this is the
  first hour). One trade per root per session per variant, quantity 1 per leg.
- Execution (rule 2): buy each leg at the ask of the first 1-s quote stamped ≥ T + 2 s; exit decisions on closed
  1-minute bars (decision = bar end); sell at the bid of the first 1-s quote ≥ decision + 2 s; fee $0.65/contract/
  side (report with and without). Package return = Σ(exit bid − entry ask)/Σ entry ask.
- Exits (fit nowhere: fixed here):
  XA "catch-up": exit when realized variance since T ≥ F (the forecast move has happened); directional legs also
  stop when the underlying is 0.75·√F against the entry spot (log); flat 15:50.
  XB straddle: exit when |ln(S/K)| ≥ 1.0·√F (one forecast sd from the strike) or XA's condition; time stop 13:30 if
  the package bid value < entry cost; flat 15:50. XB directional: underlying bracket TP +1.0·√F / SL −0.6·√F from
  the entry spot, stop raised to the entry spot once +0.5·√F has been touched; flat 15:50.
- Variants (8): V1 S0945 k1.10 XA; V2 S0945 k1.25 XA; V3 S0945 k1.40 XA; V4 S0945 k1.25 XB; V5 S1030 k1.25 XA;
  V6 D0945 k1.25 XA; V7 D1030 k1.25 XA; V8 D1030 k1.25 XB  (S = straddle, D = directional). Roots pooled
  (SPY, QQQ, SPXW). Expected sign: positive; expectancy should rise with k.
- Selection: the variant with the highest DEV fee-included expectancy among variants with ≥ 100 DEV trades goes to
  VALIDATION only if its DEV CI (session-clustered bootstrap 95%) excludes 0 AND it beats ≥ 95% of every null.
  VALIDATION scored once; a candidate is frozen for the blind scorer only if VALIDATION expectancy > 0 with CI > 0.
- Nulls (rule 11), 200 draws each, on the same execution path:
  (a) KEY: the same trade (time, structure, exit) on random sessions of the same root with R < k, matched count;
  (b) shuffled signal: the same count per root on random eligible sessions (any R), same times;
  (c) synthetic no-edge: underlying re-simulated with zero drift at the session's IMPLIED vol (path vol = σ_imp, the
      pricing-consistent no-edge world for a long-vol trade; a path at the real vol would carry the very vol edge
      being tested), options priced by BS at the entry IV with the real entry spread fraction, same exits.
  Report the null pass rate (share of null runs with expectancy > 0 and CI excluding 0) = pipeline FDR (≤ 5%).
  Report realized/implied (√RV_rem / I) on traded sessions vs all sessions.
- PBO (CSCV, 16 blocks) over the 8 variants (per-session mean return); DSR with the ledger's trial count.

## L2 SHORT-GAMMA BREAK — DROPPED (duplicate of EDGE E3), 0 trials
EDGE's E3 (edge/specs/PREREG.md @ c45a7d2) already tests: net GEX < 0 at the open, the first close outside the
09:30–09:59 range, 0DTE ~0.35Δ long option on the break side, SPY/QQQ/IWM/SPXW. L2 differs only in its exit (trail by
realized vol) and Δ band (0.30–0.45): that is an exit variant of E3, not a new hypothesis. Dropped; not run.

## L3 VOL-SHOCK SPILLOVER (2 variants) — run only if time remains after L1
Mechanism: index ETFs share one vol factor; a single name's own history misses a market vol shock until it
arrives (SPY 15-min shock → AAPL next-hour vol +1.0 R² point). If the name's options have not re-priced (its ATM IV
barely moved), its next-hour move is under-priced.
- Decision at each closed 1-minute bar 10:00–15:00 (T = bar end). SPY shock: per-minute RV over the last 15 bars /
  per-minute RV since 09:30 ≥ 2, and SPY's 0DTE ATM IV change over the last 15 minutes ΔIV_SPY > 0 (chain T−60 s vs
  T−16 min). Names AAPL, NVDA, MSFT: nearest expiry with 1–7 DTE, ATM IV change over the same window
  ΔIV_name < 0.5·ΔIV_SPY. Side = sign of SPY's last-15-bar move. Contract |Δ| 0.30–0.40 nearest 0.35, spread ≤ 8%,
  ask size ≥ 1. At most one trigger per name per 60 minutes, two per session.
- Exits: M1 = flat 60 min after entry; M2 = underlying bracket TP +1.0 / SL −0.75 × the name's 60-minute forecast sd
  (per-minute RV over the last 60 bars × √60), time stop 60 min. Execution and nulls (b, c) as L1.
- Expected sign positive.
