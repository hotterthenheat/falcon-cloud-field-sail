# EDGE pre-registration (written and committed before any DEV outcome was computed)

Sets (V2_PROTOCOL 6, fixed): DEV = sessions before 2025-01-01 outside H1 (2022-06, 2024-08, 2026-10-05..30) and H2
(2022-07..09, 2025-01..03); here DEV = 2020-02..04, 2022-02..05, 2022-10, 2023-01..2024-12 minus 2024-08.
VALIDATION = 2025-04-01..2025-12-31. LOCKED TEST (not scored by EDGE) = H1 ∪ H2 ∪ sessions from 2026-07-01.
Roots: SPY, QQQ, IWM (ETFs, own 1-min bars), SPXW (SPX index 1-min bars), on sessions where the root has a same-day
expiry. One trade per root per session per hypothesis at most.

## Common execution (sim.py)
- Decision at event time t. Visible: underlying 1-minute bars with bar start <= t − 60 s (closed bars); option chain
  1-minute quotes stamped <= t − 60 s; 1-second NBBO stamped <= the decision second.
- Entry: buy the ask of the first 1-second quote stamped >= t + 2 s with bid > 0, ask > 0, ask size >= 1.
- Exit decision on each 1-second quote (or each closed bar for underlying-based rules); sell the bid of the first
  1-second quote stamped >= decision + 2 s (bid 0 → 0).
- Fee $0.65/contract/side; every table both ways. Return = exit / ask − 1.
- Contract gate on the selection board: |delta| (BS, IV solved at mid, spot from the underlying's last closed bar)
  in the hypothesis band; spread <= 8% of mid; ask <= 0.6 × S × σ_ATM × √T (ATM expected move to expiry).
- 20-day realised daily vol σ_d: stdev of the 20 prior regular close-to-close log returns (prior sessions only).

## E1 MOM-CLOSE (mechanism: MECHANISMS.md rank 1)
- t = 15:25:00. r = ln(S(15:24 bar close) / S(prior session's 15:59 bar close)). Trade if |r| >= z σ_d.
- Side = sign(r). 0DTE, |delta| nearest 0.35 within 0.25–0.50.
- Exits: X1 = bid <= 0.50 × fill stop; time stop decision 15:58:30. X2 = X1 + trail: once bid >= 1.25 × fill, exit
  when bid <= 0.75 × peak bid. X3 = X1 + vol-scaled take-profit: exit when bid >= fill + |delta| × S × σ_1m × √35
  (σ_1m = stdev of 1-min log returns 15:00–15:24).
- Variants: z ∈ {0.5, 1.0} × {X1, X2, X3} = 6; plus the GEX < 0 filter (prior-day OI dealer gamma, below) on the two
  best of those = 2. Total 8.
- Expected sign: positive; larger for larger |r| and on GEX < 0.

## E2 OPEN-REV (rank 2)
- t = 10:00:00. Open O = 09:30 bar open; m = ln(S(09:59 close)/O); extreme X = the high (m > 0) or low (m < 0) of
  bars 09:30–09:59. Trade if |m| >= a σ_d and (X − S)/(X − O) >= 0.25 (signed so the price is off its extreme).
- Side = −sign(m). 0DTE, |delta| nearest 0.30 within 0.20–0.45.
- Exits: Y1 = take when a closed bar crosses O + 0.5 (X − O) toward O; stop when a closed bar closes beyond X;
  bid <= 0.50 × fill; time stop 12:00. Y2 = Y1 + trail (once bid >= 1.25 × fill, exit at 0.75 × peak bid).
- Variants: a ∈ {0.35, 0.60} × {Y1, Y2} = 4. Expected sign positive, small; report calls and puts separately.

## E3 GAMMA-BREAK (rank 3)
- GEX for session D: OI stamped on D (the prior close's OI), all expiries 0–30 calendar days, strikes within ±10%
  of the 09:30 open; Γ from BS at the 09:59 spot with the 0DTE ATM IV (one IV for all strikes, a stated
  approximation); dealer GEX = Σ Γ·OI_call − Σ Γ·OI_put (dealers long customer-sold calls, short customer-bought puts).
- Opening range R = high/low of bars 09:30–09:59. Trigger: the first bar 10:00–12:59 whose close is outside R;
  t = that bar's end. Side = break direction. 0DTE, |delta| nearest 0.35 within 0.25–0.50.
- Exits: Z1 = stop when a closed bar closes back beyond the range midpoint; bid <= 0.50 × fill; time stop 15:30.
  Z2 = Z1 + trail (once bid >= 1.25 × fill, exit at 0.75 × peak bid).
- Variants: {Z1, Z2} on GEX < 0 days = 2 (the hypothesis); the same 2 on GEX >= 0 days as the pre-registered
  contrast (expected <= 0) = 2. Total 4.

## Selection, nulls and the bar
- Per hypothesis, freeze the variant with the highest DEV fee-included expectancy among variants with >= 150 DEV
  trades (fewer → the hypothesis fails DEV). It goes to VALIDATION only if its DEV expectancy CI (session-clustered
  bootstrap, 95%) excludes 0 AND it beats >= 95% of both nulls. VALIDATION is scored once; only a candidate whose
  VALIDATION expectancy is > 0 with CI excluding 0 is frozen for the blind locked-test scorer.
- Nulls (anti-bias 11), per variant: (a) shuffled signal — the same sessions, times and roots, side drawn by a fair
  coin (both sides' contracts are simulated for every trigger), 200 draws; (b) synthetic zero drift — the underlying
  re-simulated per session from its own 1-min realised vol with zero drift, the signal recomputed on it, option
  prices from BS at the real entry IV with the real entry spread fraction, 200 runs. Report the fraction of null runs
  that would "pass" (expectancy > 0 with CI excluding 0) = the pipeline's false-discovery rate (must be <= 5%).
- PBO by CSCV (16 session blocks) over each hypothesis's variants; DSR with the global trial count.

## E6 CHARM-PIN (rank 6; registered 2026-11-05 after E1 failed DEV, before any E6 computation)
- Mechanism: 0DTE open interest concentrated at one strike; as expiry nears, dealers' hedges of the 0DTE book
  (charm/gamma) pull the index toward the largest-OI strike (pin) in the last hour.
- t = 15:00:00. K* = the 0DTE strike with the largest call+put OI (OI stamped on the session = prior close)
  within ±3% of S. d = (K* − S) / (S σ_ATM √T) in expected moves to the close (σ_ATM from the 14:59 board).
  Trade if |d| >= 0.5 and |d| <= 2.0.
- Side = toward K* (call if K* > S). 0DTE, |delta| nearest 0.35 within 0.25–0.50.
- Exits: P1 = take when a closed bar crosses K* (the pin reached); bid <= 0.50 × fill; time stop 15:50.
  P2 = P1 + trail (once bid >= 1.25 × fill, exit at 0.75 × peak bid).
- Variants: {P1, P2} = 2. Expected sign positive; same nulls, same selection rule and bar.
