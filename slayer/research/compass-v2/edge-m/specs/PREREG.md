# EDGE-M pre-registration (written and committed before any 1–3 DTE quote was fetched or any outcome computed)

Owner constraint: long calls and long puts only (buy to open, sell to close; single legs).

## Hypothesis and mechanism
EDGE (edge/LOG.md) found that two triggers carry some direction: E1 MOM-CLOSE (intraday momentum into the close:
short-gamma dealer hedging, leveraged-ETF rebalancing and MOC flow that follow the day's move; Gao-Han-Li-Zhou 2018,
Baltussen et al. 2021) — momentum side beats a coin in 86–96% of shuffles — and E2 OPEN-REV (opening-auction
overshoot absorbed by liquidity providers, paid by a partial reversion) — 88%. Worth ~2–4% a trade, against a 0DTE
round trip of ~5–15% of premium. Hypothesis M: the SAME triggers expressed through options with 1–3 trading days to
expiry turn the edge positive, because (a) the bid–ask spread is a smaller share of a larger premium, (b) theta per
hour as a share of premium is far lower, while (c) delta (exposure to the same underlying move) is the same 0.30–0.45.
The price paid: a smaller % payoff per 1% underlying move (lower gamma, more premium). Expected sign: positive for
M2/M3/M5/M6; the 0DTE control M1 <= 0 (EDGE's result); M4 (overnight hold) uncertain.

## Triggers (unchanged code: edge/hyp.py trig_e1, trig_e2)
- E1 z0.5: t = 15:25:00, r = ln(S(15:24 bar close)/prior close), |r| >= 0.5 σ_d (20-day), side = sign(r).
- E2 a0.35: t = 10:00:00, |m| >= 0.35 σ_d, price off its 09:30–09:59 extreme by >= 25%, side = −sign(m).
- Same marks: underlying 1-min bars (closed), boards stamped <= t − 60 (minute (t−60)//60), 1-second NBBO.

## Contract (per DTE bucket)
- 0DTE (control): the same-day expiry (EDGE's chain store). 1DTE: the root's expiry on the next trading session.
  2–3DTE: the root's expiry on the 2nd trading session after D, else the 3rd. No contract in a bucket -> no trade.
- T = (960 − t/60 + 390·n) / (252·390) with n = trading sessions after D up to the expiry (trading-minute clock).
- |delta| in 0.30–0.45 (BS, IV solved at mid, spot = last closed bar), nearest 0.35 (E1) / 0.30 (E2);
  spread <= 5% of mid; displayed bid size >= 1 and ask size >= 1 on the board; ask <= 0.6 × S σ_ATM √T.
- Fill: ask of the first 1-second quote >= t + 2 s with bid > 0, ask > 0, ask size >= 1 (sim.run_trade, unchanged).
  Exit at the bid of the first 1-second quote >= decision + 2 s. Fee $0.65/contract/side, reported both ways.

## Exits: EDGE's X2/Y2 logic re-scaled to the option's own vol
- Option vol over the hold: σ_opt = |Δ| · S · σ_1m · √H / ask_board, σ_1m = stdev of 1-min log returns
  (E1: 15:00–15:24 closes, EDGE's s1m; E2: 09:30–09:59 closes), H = 33.5 min (E1) / 120 min (E2).
- ρ = σ_opt / σ_ref, clipped to [0.1, 1.5]; σ_ref = the median σ_opt of EDGE's 0DTE real-side DEV selections of the
  same hypothesis (entry marks only; computed by the code, value logged).
- Rules: bid stop at fill × (1 − 0.5ρ); trail armed once bid >= fill × (1 + 0.25ρ), exit when bid <= peak × (1 − 0.25ρ);
  (ρ = 1 is exactly EDGE's X2/Y2). E1 time stop 15:58:30; E2 keeps Y1's underlying exits (50% retrace / close beyond
  the extreme) and time stop 12:00. Flat at the same intraday time: no overnight hold except M4.
- M4 overnight hold (2–3DTE only): same entry; only the re-scaled bid stop is active (15:25–16:00 and 09:30–09:45 next
  session); exit at the bid of the first quote >= 09:45:02 of the next session. Trades whose next session is a
  LOCKED-TEST day are dropped (never read).

## Variants (6; all logged in the global ledger)
| id | trigger | DTE | exit |
|---|---|---|---|
| M1 | E1 z0.5 | 0DTE (control, same gate) | X2s |
| M2 | E1 z0.5 | 1DTE | X2s intraday |
| M3 | E1 z0.5 | 2–3DTE | X2s intraday |
| M4 | E1 z0.5 | 2–3DTE | overnight hold, stop only, exit 09:45 next session |
| M5 | E2 a0.35 | 1DTE | Y2s intraday |
| M6 | E2 a0.35 | 2–3DTE | Y2s intraday |

## Sets
- DEV-M: E1 on every 2nd DEV session (fetch.want_days('DEV')[::2], 328 sessions of EDGE's 656; fetch time at one
  request in flight forces the subset — the choice is by index, before any outcome). E2 on all 656 DEV sessions (its
  131 triggers; it cannot reach 150 trades, so E2 fails the n bar by construction; reported anyway).
- VALIDATION 2025-04..12 once, only if a variant passes DEV. LOCKED TEST never touched by EDGE-M.

## Selection, nulls, bar
- Candidate = the M2–M6 variant with the highest DEV fee-included expectancy among those with >= 150 trades. It goes
  to VALIDATION only if its DEV CI (session-clustered bootstrap, 95%) excludes 0 AND it beats >= 95% of both nulls.
- Nulls: (a) shuffled side: both sides simulated on the same marks for every trigger, side by fair coin, 200 draws;
  (b) synthetic zero drift: edge/nullsyn.py's generator (10-s path from the day's real 1-min vol, zero drift,
  overnight gap N(0, 0.4σ_d)) on the trigger root-sessions, trigger recomputed, strike nearest target delta at the real
  ATM IV of that DTE board (flat smile), BS prices with that DTE's T, the variant's real median entry spread, same
  re-scaled rules; 100 runs. Report the null pass rate (FDR, must be <= 5%).
- PBO (CSCV 16 blocks) over M2–M6; DSR at N = 306 (≈300 global trials + these 6).
- Cost side reported directly: at entry, on the same root-day-minute boards, median spread % of mid and BS theta per
  trading hour % of mid for 0DTE / 1DTE / 2–3DTE; payoff per unit underlying move = OLS slope of option return on the
  signed underlying return over the hold (and the median per-trade ratio).

## AMENDMENT A1 (2026-11-05, after the E2 DEV look M5/M6 and 9 E1 triggers; before any M7/M8 computation)
Finding while reading M6's stop exits: at 10:00:00–10:00:06 ET (macro releases: ISM, JOLTS, sentiment) market makers
widen the 1–3 DTE quotes for a few seconds (e.g. IWM 184P 2023-12-08: 0.94/0.98 at 10:00:07, but 0.21/1.75 at
10:00:03). E2's protocol fill (first quote >= 10:00:02) buys that blown-out ask and the stop reads that blown-out bid.
This is an execution artefact, not the signal. Two post-hoc variants, counted (total 8; DSR N = 308):
- M7 = M6 (E2 a0.35, 2–3DTE, Y2s) and M8 = M3 (E1 z0.5, 2–3DTE, X2s) with a QUOTE GUARD: the simulator only acts on
  1-second quotes whose spread <= 10% of mid (entry: first such quote >= t + 2 s with ask size >= 1, within 60 s;
  stop/trail decisions and the exit fill use only such quotes). Causal: a quote's spread is known when it prints.
- 2–3DTE chosen for both because its entry cost (spread + theta × hold) is lower than 1DTE's in the cost table
  (E1: 4.8% vs 7.7%; E2: 10% vs 15%), not by outcome.
- Synthetic null: the BS null has constant spreads, so the guard never binds there; M7/M8 synthetic null = M6/M3's.
- Also the synthetic null runs on every root-session of the set (nullsyn_m.infos docstring), not only trigger days.
