# Physics-inspired indicators: what is real, what is branding

*Research only — nothing in the app changed. Scripts and commands: `README.md`; raw numbers: `results/`.*

## The short answer

- **Most of the 200 are not new.** About 7 in 10 are either a measure Slayer already shows under a plain name (VWAP,
  open interest by strike, realised vol, the gamma flip, range compression) or a physics word with no equation
  behind it. Of the 200: **7 KEEP, 20 RESEARCH, 88 MERGE, 85 DROP** (`results/indicator_triage.csv`; the full list of
  200 was not in the repo, so the rows were rebuilt as 20 per family from the proposal's description).
- **Price-pattern "physics" does not predict anything here.** Entropy, Hurst/DFA, Lyapunov, phase synchronisation,
  escape velocity, critical slowing down and viscosity were tested on 1-minute bars for SPY, QQQ, SPX, NVDA and AAPL,
  out of sample over 2024-07 to 2026-10. None predicts direction; none adds anything worth showing to a plain
  volatility forecast. Where something did move the needle, a plainer measure (relative volume, the trend-to-noise
  ratio, the size of the breakout bar) did as well or better.
- **Three ideas earned a place, and all three are about volatility, two of them using the options book:**
  1. **Volatility half-life, built as a HAR vol forecast** — cuts the error of the next-day realised-vol forecast by
     about a third against the 20-day realised vol traders use (SPY, QQQ, SPX). The strongest, cleanest result.
  2. **The dealer-gamma regime ("Potential Energy Map").** Rebuilt for SPY (940 sessions) and QQQ (711) from open
     interest and the previous evening's IVs, the sign and size of net gamma at the open explain 3.7 (SPY) and 4.9
     (QQQ) more points of the day's realised vol than a HAR forecast plus VIX. On long-gamma days the market moved
     about 15% less than forecast, relative to short-gamma days.
  3. **Market-to-single-name vol spillover ("Gravitational Wave Scanner").** A vol shock in SPY or QQQ over the last
     15 minutes helps forecast AAPL's next-hour vol (+1.0 point of R² on top of AAPL's own history), NVDA's a
     little, and the index ETFs' almost not at all.
- **"Gravity well" pinning failed on both books.** The strike with the most gamma did not pull price in: on SPY the
  close ended slightly *farther* from it than from a mirror strike the same distance away; on QQQ no difference.
- **Do not market "200 indicators".** Market about five honest reads under plain names, each labelled with how it was
  made (CALCULATED / MODELED).

## What we did

**Data** (ThetaData, cached under `data/`): 1-minute regular-session bars 2023-01-03 to 2026-10-30 (961 sessions) for
SPY, QQQ, SPX, NVDA and AAPL; VIX daily closes; for SPY, every session's open interest (the 06:30 stamp: the prior
settle, known before the open) and the prior session's end-of-day greeks for every contract 0–10 DTE within 30
strikes of spot (940 sessions); QQQ the same from 2024 (711 sessions, 587 in the test window).

**Protocol.** Windows and thresholds fixed before seeing any result (entropy over 120 minutes, order 3; DFA over
240; phase over 256 minutes at scales 8/16/32/64; liquidity over 60; a 60-minute consolidation box). Decisions every
15 minutes from 10:00 to 15:00, closed bars only. Training 2023-01 to 2024-06, test 2024-07 to 2026-10; every weight
and tercile cut is refitted only on data before the quarter it predicts (the month, for daily tests). Confidence
intervals resample whole sessions (intraday) or 20-day blocks (daily). 77 primary tests, Holm–Bonferroni across all
(`results/summary.md`).

**Baselines** are what a desk already has. Next-hour vol: an intraday HAR (realised vol over the last 15, 60 and 390
minutes) plus time of day — it already explains 68–76% of next-hour log vol, so "adds 0.1 point" means "adds nothing
you would notice". Next-day vol: 20-day realised vol. Direction: plain momentum, the efficiency ratio, or
multi-timeframe sign agreement. Breakouts: the breakout bar's own size. Pinning: the largest-OI strike, a round $5
strike, or the flip.

## Ranked results

| # | Idea (their name → standard name) | Verdict | Out-of-sample result vs baseline | Page | Effort |
|---|---|---|---|---|---|
| 1 | Volatility Half-Life → HAR realised-vol forecast (Corsi) | **BUILD** | Next-day log-RV error **−36% SPY, −32% QQQ, −35% SPX, −21% NVDA, −25% AAPL** vs 20-day RV; all intervals exclude 0, the index products survive Holm. Bare AR(1) "half-life": −28 to −33% on the index products, n.s. on NVDA. A vol shock halves in 1.0–2.0 sessions. VIX adds nothing on top of HAR (p 0.64–0.81). | Pulse tile; Weigher; Compass retrain | S |
| 2 | Potential Energy Map → net dealer gamma at the open | **BUILD** (validates an existing read) | Day-RV R² **+3.7 pts SPY** (CI +2.2 to +5.2) and **+4.9 QQQ** (+3.4 to +6.3) over HAR + VIX. Sign alone +2.8 / +2.6; distance to flip +3.1 / +4.2. Long-gamma days (63% / 61%) realised ~15% less vol than forecast vs short-gamma days. | Terrain/Pinpoint regime label; Compass retrain | S |
| 3 | Gravitational Wave Scanner → market→single-name vol spillover | **BUILD for single names** | Next-hour log-RV R²: SPY→AAPL **+1.04** (+0.71 to +1.38), QQQ→AAPL +0.87, NVDA→AAPL +0.62, SPY→NVDA +0.17, between ETFs +0.05 to +0.11 | Compass retrain; Pulse | M |
| 4 | Viscosity → Amihud illiquidity / Kyle's λ | display only | Beyond relative volume: SPY ±0.0, QQQ +0.10/+0.13, NVDA +0.05/+0.03, AAPL ~0; none survive Holm; no direction claim | Weigher (cost of size) | S |
| 5 | Critical Transition Detector → critical slowing down | MERGE into #1 | Predicting a >2.5σ next-hour move: rising-AR(1) alone AUC **0.49–0.53** (a coin flip); plain vol ratio 0.69–0.76; added to HAR ΔAUC −0.001 to 0.000 | — | — |
| 6 | Escape Velocity → compression-breakout strength | DROP | 80–83% of breakouts from a tight 60-min box close back inside within 30 min; mean continuation −0.24 to +0.10σ; strength terciles show no continuation difference; bigger later moves are predicted as well by the breakout bar alone | (Compass has range compression + OR break) | — |
| 7 | Gravity Well → pin to the max-gamma strike | DROP | SPY close ends **0.07% of spot farther** from the well than from the mirror strike (CI +0.01 to +0.14), closer on 47% of days; QQQ +0.04% (CI −0.05 to +0.13), 50%. Largest-OI strike, flip, round $5: all n.s. "Pull" direction −14.5 / −12.3 bps/day, n.s., wrong sign | — | — |
| 8 | Market Entropy → permutation / sample entropy | DROP | Next-hour vol ΔR² −0.02 to +0.05 on SPY, QQQ, NVDA, AAPL; SPX +0.14 (likely stale index prints); low entropy ≠ trend (±1 bp, n.s.) | — | — |
| 9 | Hurst / DFA persistence (+ Market Diffusion) | DROP | Continuation top−bottom tercile −2.0 to +0.7 bps/30 min, n.s., mostly wrong sign; vol ΔR² ~0 | — | — |
| 10 | Phase Synchronization / Wave Interference → Hilbert phase locking | DROP | Next-30-min direction spread −0.8 to +0.3 bps, n.s.; in-phase cycles bring no bigger moves | — | — |
| 11 | Market Lyapunov → Rosenstein largest exponent | DROP | Same as shuffled returns (SPY 0.0996 vs 0.1017; NVDA 0.098 vs 0.102); pure white noise gives 0.098 | — | — |

**Plain measures did better.** The trend-to-noise (efficiency) ratio added +0.12 to +0.25 points to next-hour vol on
all five names; relative volume +0.45 (NVDA) and +0.43 (AAPL). Both beat every physics feature — and Compass already
has relative volume ("volume vs curve").

## Family by family (KEEP / RESEARCH / MERGE / DROP)

- **Electromagnetism (0/3/11/6).** "Flux Field" and "Current" are signed-volume / order-flow imbalance; "Field
  Gradient", "Charge Density", "Equilibrium" are the per-strike gamma profile, OI by strike and the flip/VWAP —
  Terrain draws all of them. "Magnetic Pull" is pinning (failed, #7). Worth researching: net/gross gamma
  ("Shielding"), the call-wall–put-wall span against the implied move ("Dipole"), charm roll-off into expiry.
- **Fluid dynamics (0/4/13/3).** "Viscosity" is Amihud/Kyle λ — real, but ~nothing beyond relative volume (#4).
  "Reynolds regime" is Kaufman's efficiency ratio; "Vortex" the existing Vortex Indicator. "Liquidity Vortex" and
  "Boundary Layer" are level tests (the wall back-test already showed little). "Pressure gradient" needs depth
  (UNAVAILABLE); NBBO size imbalance is the stand-in.
- **Thermodynamics (3/2/8/7).** "Volatility Half-Life" is #1. "Thermal Equilibrium" = implied minus realised (the
  variance risk premium) — a useful Weigher read. "Market Entropy" (#8) failed; "free energy", "enthalpy",
  "heat capacity" have no market definition. "Potential Energy Map" is the dealer gamma profile (#2).
- **Wave physics (0/3/8/9).** Returns have no stable spectrum beyond the intraday volume/vol cycle. Phase
  synchronisation was tested properly and failed (#10). Wavelets are a denoising tool, not a signal; wavelet
  coherence between assets is RESEARCH.
- **Classical mechanics (0/0/11/9).** Inertia, impulse, momentum, work, centre of mass, friction are momentum,
  volume × return, VWAP and the spread. Escape velocity failed (#6). Acceleration/jerk/torque are derivatives of noise.
- **Chaos (0/2/8/10).** Hurst, DFA, fractal dimension and the variance ratio all measure persistence, which does not
  forecast here (#9). Lyapunov = shuffled data (#11). Critical transition: AR(1) half is a coin flip, variance half is
  the vol ratio (#5). Multifractal width and recurrence analysis: RESEARCH, daily scale only.
- **Quantum-inspired (2/0/9/9).** Two excellent standard option reads hide here, both for Weigher: "scenario
  distributions" = the risk-neutral density from the chain (Breeden–Litzenberger); "tunnelling probability" = the
  chance of touching a level before expiry (≈ 2 × the barrier's delta), shown beside measured wall-break rates.
  "Superposition bias" is skew (already a Compass input). The rest are words.
- **Optics (0/1/6/13).** "Signal polarisation" only means something if signals are independent; ours are not, and
  plain agreement did not predict. "Opacity", "prism", "optical depth", "shadow" need dark-pool tags, participant IDs
  or depth: UNAVAILABLE. Gamma concentration (a Herfindahl index, "Lens focus") is RESEARCH.
- **Statistical mechanics (0/4/7/9).** "Diffusion coefficient" is realised variance per unit time; "magnetization" is
  breadth; "correlation decomposition"/"systemic stress" is the PCA absorption ratio. RESEARCH at daily scale on
  Pulse with sector ETFs.
- **Astrophysics (2/1/7/10).** "Market clock" = intrinsic time (volume or directional-change bars): a real charting
  mode. "Gravitational Wave Scanner" is #3; "Gravity Well" failed (#7). "Supernova" = jump detection (bipower
  variation, Lee–Mykland): RESEARCH. Black holes, dark matter, event horizons have no definition.

## Details worth knowing

**Volatility half-life (#1).** Daily realised vol (from 5-minute returns) mean-reverts fast: a shock loses half its
excess in 1–2 sessions (AR(1) on log RV), but some lingers for weeks — why the three-horizon HAR beats the
single-exponent model, most clearly on NVDA (−21% vs −9%). Ship the HAR number; show the half-life as context
("vol shocks are fading with a ~1.5-session half-life").

**Dealer gamma (#2).** The rebuild is cruder than the live app's book (OI 0–10 DTE only within ±30 strikes; each
contract's prior-evening IV re-priced at the open; the naive "dealers long calls, short puts" sign). It still carries
day-vol information neither HAR nor VIX has, and it replicates on QQQ. It does **not** carry information about where
price goes (#7).

**Spillover (#3).** Index ETFs share one vol factor, so each one's own history already holds the other's shock; a
single stock's history misses the market's shock until it arrives.

## Recommendations

1. **Pulse "Vol outlook" tile** (MODELED): HAR forecast of tomorrow's and the next hour's realised vol, the current
   shock half-life, and the forecast against ATM implied vol. Effort S.
2. **Terrain / Pinpoint: label the gamma regime as a vol regime, not a magnet** (CALCULATED): "Long gamma: moves tend
   to be damped" / "Short gamma: moves tend to extend"; drop pinning or "pull" language. Effort S.
3. **Weigher: three standard option reads** (CALCULATED / MODELED): the risk-neutral distribution of the expiry
   price; each wall's touch probability beside its measured break rate; implied vol minus the forecast. Effort M.
4. **Candidate inputs for a future Compass retrain** (current models untouched): the HAR next-hour vol forecast; the
   market vol shock (SPY/QQQ 15-minute vs day RV) for single-name rows; net dealer gamma scaled by its 60-day median;
   the efficiency ratio. The physics features add nothing that would earn a column.
5. **Brand honestly.** Physics names can live in copy, but each read carries its plain name and status. Lead with
   "five tested reads", never "200 indicators".

**Other ideas:** intrinsic-time bars as a Terrain chart mode; a daily regime label from HAR vol × gamma sign × trend;
jump flags from the bipower-variation ratio; breadth and the absorption ratio from sector ETFs on Pulse; the
variance risk premium (30-day IV minus the HAR forecast) as a daily read.

## Status and caveats

- CALCULATED: every intraday feature and the gamma book. MODELED: HAR forecasts shown as forecasts; the risk-neutral
  density. UNAVAILABLE: order-book depth, participant IDs, dark-pool tags.
- The rebuilt gamma book is a proxy from ThetaData, not the vendor exposure the live app reads.
- The test window holds one large vol shock (April 2025) and a long calm uptrend; the pinning test removes the
  window's mean drift.
- Five names, so "single names" means NVDA and AAPL; options history covers SPY (2023–) and QQQ (2024–).
- Surviving Holm across all 77 tests: HAR and AR(1) forecasts on SPY, QQQ, SPX; net dealer gamma → day vol on SPY and
  QQQ; spillover into AAPL from SPY, QQQ and NVDA; a +0.14-point SPX entropy result (too small to use, probably a
  data artefact).

## Data and API usage

**What this research pulled:** about **3,550 ThetaData requests**, never more than 2 in flight — 230 monthly 1-minute
bar requests (5 names × 46 months, plus 1 retry), 5 VIX EOD requests, 1,882 SPY options requests (941 sessions × open
interest + previous-day greeks), 1,422 QQQ options requests (711 × 2), ~10 probes. Roughly 1 GB uncompressed, cached
in the git-ignored `data/`, so a re-run asks for nothing new.

**Live cost of each recommended feature** (estimates from `shared/thetaPaths.mjs` caching rules; computed once per
name on the server, like the Compass engine and exposure recorder, so viewers add nothing):

- **Vol outlook tile:** 22 closed sessions of 1-minute bars per name (1–2 `/stock/history/ohlc` requests per name per
  day; closed days cache 6 h); today's bars are the series the charts and Compass already poll; the ATM IV reuses the
  greeks snapshot Weigher and Compass read. **Extra ≈ 0 per viewer per minute.**
- **Gamma regime label:** net gamma at spot is already computed (`gammaFlip` `netAtSpot`); on Pinpoint it must come
  from the vendor book (Pinpoint reads that vendor only). The 60-day median needs one stored value per name per
  session (the exposure recorder can write it; a one-time backfill ≈ 120 options-history requests per name).
  **Extra 0 per viewer per minute.**
- **Weigher distribution and touch odds:** from the chain Weigher already loads; wall-break rates are static numbers
  from the existing back-test. **Extra 0 requests**; one pass over ~40–80 strikes of browser CPU per refresh.
- **Spillover:** SPY/QQQ 15-minute and day realised vol from 1-minute bars Compass already reads. **Extra ≈ 0 per
  viewer per minute.**

**New vendor endpoints: none.** Everything fits shapes already on the allowlist (`/stock/history/ohlc`,
`/option/snapshot/greeks/first_order`, `/option/snapshot/quote`, and for backfill only
`/option/history/open_interest`, `/option/history/greeks/eod`). The only new pieces are server-side state (a daily
net-gamma history per name) and where the HAR forecast runs (server engine or browser).
