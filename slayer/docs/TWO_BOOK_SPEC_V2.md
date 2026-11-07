# SLAYER TERMINAL — TWO-BOOK GREEK EXPOSURE ENGINE — SPEC v2 (VERIFIED)

> Committed from the owner's message of 2026-11-07, verbatim. This is the binding spec for Pinpoint's two books.
> Note (lead, 2026-11-07): the reference files it names (`slayer_ref.py`, `test_slayer_ref.py`, `test_live_data.py`,
> `golden_vectors.json`, `run_model1.py`, `run_model2.py`) are NOT in this repository or on this machine; until the owner
> supplies them, the implementation rebuilds an independent high-precision reference from this text. The owner's
> statement of the two models (2026-11-07): "pinpoint has 2 models, one is the spot that comes from the keys [Model 1,
> Unusual Whales OI book] and then another is thetadata math that we use to math dealer flow gex [Model 2, flow book]".

Status of this document
- Every formula below is implemented in `slayer_ref.py` and proven by `test_slayer_ref.py`
  (41 tests: 4th-order finite differences on 1,568 contracts per Greek, 15-minute 0DTE
  through 3-year, calls and puts, zero and non-zero rate/carry; 792 golden vectors;
  12/12 injected formula bugs and 9/9 injected scaling bugs caught).
- Independently audited three times: a separate implementation written from this text alone
  matched all 22,968 golden values; the golden values agree with a 60-digit evaluation; a
  symbolic (sympy) derivation of all ten Greeks from §1.3 matched §1.4 exactly (difference
  0; 400 random points at 50 digits, worst 4e-44); the §4.1 classifier matched in 200,000
  fuzzed prints. Third-audit findings (forward-roll stability of §1.2, SPX r = b = 0 claim,
  AM-settlement evidence wording, S_index fallback) are fixed here and covered by tests,
  but were not audited a fourth time.
- `slayer_ref.py` implements §1.2 (implied_spot, carry_for_expiry, interpolate_forward,
  parity_forward), §1.3–1.5 (price, greeks, contract_status, implied_vol, iv_from_quote),
  §3.4 (uw_to_slayer), §4 (classify, accumulate), §4.4–5 (exposures, total_gex_change_1pct,
  hedge, hedge_in_instrument). Board assembly, flat-wing fill and the §4.5 unit rule are
  shown in run_model1.py / run_model2.py.
- Every vendor convention below was MEASURED from live Unusual Whales and ThetaData data
  (SPY and SPX, 2026-11-02; SPX AM settlement 2026-10-15/16) and is asserted by
  `test_live_data.py` (9 tests). Nothing about a vendor is assumed. Re-run Test 4 on a
  schedule; vendor methodology can change.
- Appendix C lists what changed from v1 and why.

## Objective

Build two independent options exposure models on one Greek engine and one unit system,
with completely separate inventory sources.

MODEL 1 — UW OI BOOK
Unusual Whales supplies four exposures (GEX, DEX, Vanna, Charm). Slayer stores them
unchanged, converts them into Slayer units with the exact conversions in §3.4 (no
recomputation, no extra multiplier), and calculates the remaining six internally under the
same OI positioning assumption and UW's delta/gamma/vega pricing model (§3.5). (UW prices
vanna and charm with a separate carry model; §3.3.)

MODEL 2 — SLAYER FLOW BOOK
Slayer calculates all ten exposures from today's option trade prints, the inferred customer
aggressor side, and the assumed dealer opposite side, revalued continuously at current spot,
IV and time.

The two models are never mixed or added.

---

# 1. SHARED GREEK ENGINE

## 1.1 Inputs

- `S`  = underlying price used by the model (see §1.2 for which price)
- `K`  = strike
- `σ`  = implied volatility, decimal (25% = 0.25)
- `T`  = calendar time to the contract's expiration/settlement time, in years
- `r`  = continuously compounded discount rate
- `b`  = cost of carry (b = r − q). Baseline r = b = 0 is a special case, not the default.
- `M`  = contract multiplier (deliverable units per contract)
- `C`  = signed contract quantity of the modeled dealer book
- `D`  = 365 calendar days per year

```text
T = calendar_minutes_remaining / (D × 1440),   D = 365
```

D = 365 is used for BOTH T and every per-day conversion. (Measured: UW's and ThetaData's
Greeks both use a 365-day calendar year. v1 used 365.25; that makes Slayer's T disagree with
both vendors' IVs.)

Expiration/settlement timestamp is stored PER ROOT, never per ticker:
- PM-settled (SPY, equities, ETFs, SPXW, and other PM index roots): 16:00 ET on expiration date.
- AM-settled index roots (e.g. SPX standard monthlies): settle to an opening value on
  expiration day. T runs to 09:30 ET on expiration date. Confirm each root's settlement
  rule against the listing exchange's contract specification and store it in the
  contract-spec table.
- SPX and SPXW with the same expiration date and strike are DIFFERENT contracts with
  different T. Key every contract by (root, expiration, strike, right).

## 1.2 Model parameters — one model per calculation, IV and Greeks from the same model

Rule 0 (non-negotiable): an IV is only valid with the (S, T, r, b, D) it was solved under.
Never take an IV produced under one set of inputs and compute Greeks under another.

Two engine modes, same code:

UW_COMPAT mode (Model 1 six calculated metrics and UW reconciliation only)
```text
r = 0, b = 0, D = 365, S = UW row `price`,
T to the root's settlement time (16:00 ET PM roots, 09:30 ET AM roots — UW's measured
convention, §3.3)
σ = IV per §3.5
```
(Measured: UW's per-contract delta, gamma and vega are exactly this model — §3.3.)

SLAYER mode (Model 2)
```text
r_T  = risk-free rate (SOFR curve) at T
F_T  = parity forward of expiry T:
       F_T = median over the 6 strikes nearest spot with two-sided quotes of
             K + e^{r_T·T} × (C_mid − P_mid)
T1 = nearest unexpired expiry with a valid parity forward
TL = nearest OTHER expiry with T ≥ 7 calendar days and a valid parity forward

S*  = exp( (TL·ln F_T1 − T1·ln F_TL) / (TL − T1) )    ONE implied spot per timestamp
                                                     (ln F extrapolated linearly to T = 0)
Every expiry:  S_T = S*,   b_T = ln(F_T / S*) / T      (each expiry priced off its OWN forward)
Expiry without a valid forward: ln F_T linear in T between the nearest valid expiries on each
side; beyond the last valid expiry, the last segment's carry held flat.
Fallback, only one valid forward: S* = F_T1·e^{−r_T1·T1}, provenance APPROX.

σ  = IV solved by Slayer from the current NBBO mid under (S*, K, T, r_T, b_T)
```
All Greeks and exposures use S*; "spot held fixed" in every Greek means S* held fixed.
The index print is never an input. Properties (tested):
- every expiry's model forward S*·e^{b_T·T} equals its parity forward exactly, so call and
  put IVs at a strike are consistent even when a forward sits off the smooth curve;
- rolling TL (the 7-day expiry ageing out) moves S* by only (slope change) × T1: measured
  ≤ 0.29% change in 3-day ATM charm, against 17% under a single short-end carry;
- discrete dividends stay inside each b_T (no dividend yield is dropped).

Why: the stale-index basis belongs in spot, never in carry. Measured on SPXW 0DTE at
15:30 ET (T = 30 min): F − S_index = +0.62 index points. Put into carry, b = ln(F/S_index)/T
= 143.6%, which contaminates charm, color and veta through their b terms; at T = 7 days the
same basis would still bias b by 0.43%. Deriving S* from forwards only removes it. Measured
on 2026-11-02 15:30 ET: S* = 7566.4816; the 0DTE carry b_T1 = 4.27% (the parity forward
carries the market's financing rate net of dividends — measure it, do not assume r − q).

Parity is exact for European options (SPX, SPXW, XSP, NDX). For American options (SPY,
equities) it is an approximation that ignores the early-exercise premium; record this.

## 1.3 Pricing (generalized Black-Scholes-Merton)

```text
sqrtT = sqrt(T)
d1 = (ln(S/K) + (b + 0.5·σ²)·T) / (σ·sqrtT)
d2 = d1 − σ·sqrtT
φ  = standard normal pdf at d1
N  = standard normal cdf, full double precision in both tails:
     N(x) = 0.5 × erfc(−x / √2) with a full-precision erfc (e.g. W. J. Cody's rational
     approximations). Do NOT use 0.5 × (1 + erf(x/√2)): it returns 0 in the lower tail.
ec = e^{(b−r)·T}

call = S·ec·N(d1) − K·e^{−rT}·N(d2)
put  = K·e^{−rT}·N(−d2) − S·ec·N(−d1)
```

## 1.4 Ten raw Greeks

All time derivatives hold S, σ, r and b fixed.

```text
∂d1/∂T = b/(σ·sqrtT) − d2/(2T)

DELTA      call: ec·N(d1)            put: −ec·N(−d1)
           (put form = ec·(N(d1) − 1) algebraically; code −ec·N(−d1) to avoid cancellation)
GAMMA      ec·φ / (S·σ·sqrtT)
VEGA       S·ec·φ·sqrtT                                   (per 1.00 vol)
VANNA      −ec·φ·d2 / σ                                   (= ∂delta/∂σ)
VOMMA      vega·d1·d2 / σ                                 (= ∂vega/∂σ)
CHARM      call: −ec·[φ·(∂d1/∂T) + (b−r)·N(d1)]
           put:  −ec·[φ·(∂d1/∂T) − (b−r)·N(−d1)]          (= −∂delta/∂T, calendar time passing)
COLOR_T    gamma·[(b−r) + (d1·d2 − 1)/(2T) − b·d1/(σ·sqrtT)]   (= +∂gamma/∂T, time remaining)
SPEED      −gamma/S × (1 + d1/(σ·sqrtT))                  (= ∂gamma/∂S)
VETA_T     vega·[(b−r) + (1 + d1·d2)/(2T) − b·d1/(σ·sqrtT)]    (= +∂vega/∂T, time remaining)
ZOMMA      gamma·(d1·d2 − 1)/σ                            (= ∂gamma/∂σ)
```

Baseline r = b = 0 reduces exactly to the v1 formulas (regression-tested to 1e-12):
charm = φ·d2/(2T), color_T = −φ·(1 − d1·d2)/(2·S·T·σ·sqrtT), veta_T = vega·(1 + d1·d2)/(2T).

Conventions match ThetaData's published Greeks (measured, scale ×1, same sign): vega per
1.00 vol; charm = −∂Δ/∂T; color = +∂Γ/∂T; veta = +∂vega/∂T; all per year.

These are European BSM Greeks. For American-style equity/ETF options they are model
approximations; label them so unless an American model is implemented.

Identities (tested; use them as runtime self-checks):
```text
Δcall − Δput = ec
gamma, vega, vanna, vomma, speed, zomma, color_T, veta_T: identical for call and put
charm_call − charm_put = −(b − r)·ec
speed·S + 2·gamma = gamma·(1 − d1/(σ·sqrtT))
```

## 1.5 Invalid, expired and unidentifiable contracts

- Missing or non-finite S, K, σ or T; S, K or σ ≤ 0; invalid contract spec → UNAVAILABLE.
- T ≤ 0 (at or past the settlement time used by the engine mode) → EXPIRED: excluded from
  every Slayer calculation and flagged. Never let it reach a division.
- IV not identifiable → do NOT drop the contract. Not identifiable means any of: bid = 0;
  bid ≥ ask; mid ≤ lower no-arbitrage bound + half a tick; mid ≥ upper bound; the solver
  cannot bracket a root in σ ∈ [1e-4, 10] or does not converge to |price error| ≤ 1e-10 × S.
  Tick = the contract's minimum price increment at that price, from the contract-spec table. Use flat-wing IV: the valid IV of the
  nearest strike with the same expiration and right. Provenance = MODELED_FLAT_WING_IV.
  Report the share of |C| (Model 2) or of OI (Model 1) on modeled IV on the board.
  Measured error from silently dropping instead (SPXW 0DTE, 15:30 ET, 41% of |C| affected),
  relative to the all-contracts board: DEX magnitude −13%, CHARM +17%, COLOR +53%,
  ZOMMA +46%. Measured UW gap: UW's option-contracts
  IV field is null for 13.6% of SPY OI (deep wings), so Model 1 needs this rule too.

---

# 2. CONTRACT MULTIPLIER

`M` is contract-specific and comes from the contract-spec table. Never hardcode 100.
- Standard equity/ETF options: generally 100.
- SPX/SPXW: $100 per index point.
- Adjusted options: actual adjusted deliverable and multiplier.

All internal exposure calculations use M. UW's published exposures embed M = 100 (their
S² factor equals 100·S²·0.01, measured on SPY and SPX). UW conversions are therefore only
valid for standard 100-multiplier contracts; flag any adjusted contract in a UW row.

---

# 3. MODEL 1 — UW OPEN-INTEREST BOOK

## 3.1 Sources

```http
GET /api/stock/{ticker}/spot-exposures/strike           (board; or /expiry-strike for per-expiry rows)
GET /api/stock/{ticker}/spot-exposures                  (per-minute aggregate, reconciliation only)
GET /api/stock/{ticker}/volatility/stats                (field `iv`: UW ticker IV, same timestamp)
GET /api/stock/{ticker}/option-contracts                (per-contract OI, IV; paginated)
GET /api/stock/{ticker}/greeks?expiry=...               (per-contract greeks incl. vanna, charm)
```

Pagination is mandatory: `limit` max 500, walk `page` until a page returns fewer than 500
rows. Measured: SPY strike endpoint = 551 rows; a single call returned 500 and silently
dropped strikes 1070–1480.

Every pull carries the row `time` and `price`. A Model 1 board is built from rows with ONE
timestamp. Measured: UW's endpoints are NOT time-aligned with each other (the exposure
snapshot, the delta/gamma snapshot and the vanna/charm snapshot used three different
underlying prices: 752.10, 753.05, 753.22).

## 3.2 Inventory assumption

```text
Call: C = +open_interest
Put:  C = −open_interest
```
OI = OCC open interest published pre-market. Measured: UW `open_interest` equals ThetaData's
OCC OI on 1,774/1,774 contracts; UW `prev_oi` does not (33–67% match). Use `open_interest`.

This is a positioning convention, not an observation of dealer positions.

## 3.3 What UW's four fields actually are (MEASURED 2026-11-02, SPY + SPX)

Per contract, S = UW row `price`, IV30 = UW ticker 30-day IV, OI as above:

```text
call_gamma_oi = +gamma × OI × S²          put_gamma_oi = −gamma × OI × S²
call_delta_oi = +delta × OI × S²          put_delta_oi = +delta × OI × S²   (puts NOT negated; delta < 0)
call_vanna_oi = +vanna × OI × S × IV30    put_vanna_oi = −vanna × OI × S × IV30
call_charm_oi = +charm × OI × S × 365     put_charm_oi = −charm × OI × S × 365   (charm per year)
```

Evidence: median ratio of published value to formula on long-dated SPY contracts =
1.0000 (gamma), 1.0001 (delta), 0.99994 (vanna; implied IV30 = 0.17199 vs UW's published
0.172), 1.0002 (charm); interquartile range inside ±1%.

UW's per-contract Greek models:
- SPY delta, gamma, vega: BSM with r = 0, b = 0, T = calendar/365 to 16:00 ET (reproduced
  by the engine to ≤ 1e-8 relative).
- SPX delta, gamma, vega: NOT r = b = 0. Deep in-the-money call delta, which must be exactly
  1 under r = b = 0, is 0.99905 (Oct-16), 1.00057 (Nov-20), 0.99992 (Dec-18), and vega/gamma
  shows the same factor. UW applies an unidentified per-expiry adjustment (consistent with a
  forward or adjusted spot). UW_COMPAT reproduces SPX only to ~1e-3; label SPX UW_COMPAT
  values APPROX until the adjustment is identified.
- vanna, charm: BSM with carry b = r (4.06% → 4.65% across the term structure) and spot
  reduced by the PV of discrete dividends (0 for Nov; 2.27 for Dec-18; 20.42 for Jan-2029).
So UW's vanna and charm are not derivatives of UW's own delta. Record this model difference.

Structural facts:
- SPX rows sum the SPX (AM) and SPXW (PM) roots at the same expiration and strike
  (ratio 1.0000 at p10 and p90 only when both roots are summed).
- UW prices AM-settled SPX to the 09:30 ET settlement (strong evidence, not proof: UW does
  not publish snapshot times, and T only fixes settlement time minus snapshot time).
  (a) SPX-root Greeks for Thu 2026-10-15 (expiry Fri 2026-10-16) imply T = 17.25 h (rho:
  17.24 h), which is 16:15 Thu → 09:30 Fri. (b) On 11-02, with the snapshot placed at ~15:59 ET
  by SPY, SPX-root rho implies T = 17.670 d for Nov-20 (09:30 predicts 17.69; 16:00 predicts
  17.96) and 45.452 d for Dec-18 (09:30: 45.46–45.50; 16:00: 45.73–45.77). (c) On expiration
  day UW's /greeks returned no AM-root rows (end of day 2026-10-16). Test 4's intraday AM
  check is the decisive test.
- After 16:00 ET, UW's snapshot still includes contracts that expired that day.
  Measured at 16:15 ET: expired rows = 16.8% of GEX, 6.0% of DEX, 96.6% of charm.
- The per-minute aggregate has gamma, vanna and charm fields only (no delta). DEX cannot
  be reconciled against it. UW's own documentation states strike sums only approximately
  equal the minute aggregate.

## 3.4 Consuming the four UW fields

1. Store every raw UW value unchanged, with timestamp and price. Provenance OBSERVED,
   unit tag UW.
2. Drop rows whose expiration date is before the snapshot date, and rows whose expiration is
   today when the snapshot is at or after 16:00 ET. Keep them in raw storage for
   reconciliation.
   AM-settlement days: UW rows sum the AM and PM roots and cannot be split. UW drops the AM
   root once settled (measured end of day), but its intraday behavior between 09:30 and
   16:00 is not yet verified. Until Test 4's AM check passes intraday, from 09:30 ET on an
   AM-settlement day show that expiration's UW rows as one separate flagged line ("may
   contain settled AM contracts"), outside the four totals. Once the check passes (rows
   match SPXW-only OI), include them normally and delete this rule.
3. Convert to Slayer units with these exact conversions (provenance CALCULATED, source UW):

```text
GEX   = call_gamma_oi + put_gamma_oi                         (already Slayer units)
DEX   = (call_delta_oi − put_delta_oi) × 100 / S             (restores C = −OI for puts)
VANNA = (call_vanna_oi + put_vanna_oi) / IV30                (IV30 from the same timestamp)
CHARM = (call_charm_oi + put_charm_oi) × 100 / (365 × D)     ($ delta per calendar day)
```

These divide out UW's scale factors; they are the only transformations allowed. Never
multiply by 100, S, or a sign again.

Why DEX must be converted: UW's published delta does not use the positioning convention
UW's own gamma uses. Measured on SPY at 16:15 ET (expired rows excluded): UW sign gives
−6.12e10 in Slayer units; the consistent C = −OI put convention gives +2.29e11. The sign of
the board flips. Show UW's own-sign DEX only as an OBSERVED secondary value.

IV30 is published to 3 decimals, so VANNA conversion error ≤ 0.0005 / (IV30 − 0.0005)
(0.29% at IV30 = 0.172; 0.50% at 0.10). Measured on 2026-11-02: 0.006%.

## 3.5 Six exposures calculated by Slayer

Inputs: same contracts, same OI, same timestamp as the UW rows. Engine in UW_COMPAT mode
(r = 0, b = 0, D = 365, S = UW row price, T to each root's settlement time).
Population rule: the six use exactly the contract population of the four. Whatever §3.4
step 2 removes or flags in the four (expired rows; on AM-settlement days from 09:30 ET the
whole flagged expiration, AM and PM roots alike) is removed or flagged in the six too.
IV source, in order:
1. Slayer-solved IV from the NBBO mid at the row timestamp under exactly these UW_COMPAT
   inputs (satisfies Rule 0).
2. UW's IV for the contract — labeled APPROX: UW solved it at an unpublished spot and time
   (measured 0.13% spot offset on SPY), so it only approximately satisfies Rule 0.
3. Flat-wing IV (MODELED, §1.5).

```text
VEGA    = vega   × C × M × 0.01                    $ per +1 vol point
VOMMA   = vomma  × C × M × 0.0001                  $ vega change per +1 vol point
COLOR   = −color_T × C × M × S² × 0.01 / D          GEX change per calendar day
SPEED   = speed  × C × M × S³ × 0.0001             speed-only part of GEX change per +1% spot
VETA    = −veta_T × C × M × 0.01 / D                $ vega change per calendar day
ZOMMA   = zomma  × C × M × S² × 0.0001             GEX change per +1 vol point
```

UW_COMPAT is chosen because UW's gamma and vega are exactly that model, so color, speed and
zomma are derivatives of the same pricing model as the board's GEX, and vega/vomma/veta match
UW's vega (measured: UW vega = engine vega / 100 to 1e-8). Residual difference: UW does not
publish the spot or time its Greeks were computed at; measured on SPY the Greek snapshot spot
(753.05) differed from the row `price` (752.10) by 0.13%. Use the row `price`, and record it. The board must state that UW's vanna and
charm come from a carry model.

These six are Slayer's modeled extensions. Do not claim they replicate undisclosed UW
calculations.

## 3.6 Model 1 board

```text
GEX    UW → converted (§3.4)       DEX    UW → converted (§3.4)
VANNA  UW → converted (§3.4)       CHARM  UW → converted (§3.4)
VEGA, VOMMA, COLOR, SPEED, VETA, ZOMMA   Slayer, UW_COMPAT (§3.5)
```
Per metric: provenance, unit, model mode, timestamp, share of OI on MODELED IV.

---

# 4. MODEL 2 — SLAYER DIRECTIONAL FLOW BOOK

Calculated entirely by Slayer. No OI. No `_oi` fields. Engine in SLAYER mode.

## 4.1 Classify each print (ThetaData/OPRA condition codes)

Evaluate top to bottom; the first matching row decides. Bucket names are normative.

| # | Condition | Test | Bucket | Dealer C |
|---|---|---|---|---|
| 1 | Cancel | condition ∈ {40,41,42,43,44} | CANCEL | 0; remove the trade it cancels, linked through the vendor's sequence/reference fields; log any cancel that cannot be linked |
| 2 | Extended hours | condition ∈ {1,65,118,148} | EXCLUDED_EXT_HOURS | 0 |
| 3 | Complex / multi-leg / stock-option | condition ∈ {35,36,37,38,124,130–144,147} | EXCLUDED_COMPLEX | 0 (single-leg NBBO cannot sign a package leg; show volume share) |
| 4 | Cross | condition ∈ {45,127,128} | EXCLUDED_CROSS | 0 |
| 5 | Invalid print | size ≤ 0, or price not finite, or price ≤ 0 | EXCLUDED_INVALID | 0 |
| 6 | Exchange flag: buy-side aggressor | condition = 145 (BID_AGGRESSOR) | BUY | −size |
| 7 | Exchange flag: sell-side aggressor | condition = 146 (ASK_AGGRESSOR) | SELL | +size |
| 8 | Late / out of sequence | condition ∈ {2,5,6,13,15} | EXCLUDED_LATE | 0 (unless the NBBO at the true execution time is available) |
| 9 | No quote | bid or ask not finite, ask ≤ 0, or bid < 0 | EXCLUDED_NO_QUOTE | 0 |
| 10 | Locked / crossed | bid ≥ ask | EXCLUDED_LOCKED_CROSSED | 0 |
| 11 | Stale quote | quote_age < 0 ms or > 1,000 ms | EXCLUDED_STALE_QUOTE | 0 |
| 12 | Customer lifted the ask | price ≥ ask | BUY | −size (dealer short) |
| 13 | Customer hit the bid | price ≤ bid | SELL | +size (dealer long) |
| 14 | Inside the spread | otherwise | MID | 0 (volume shown) |

quote_age = trade_timestamp − quote_timestamp.

The NBBO is the last quote at or before the trade timestamp (ThetaData trade_quote with
exclusive = true). Signs apply to calls and puts alike.

Measured, SPXW 0DTE 2026-11-02 09:30–15:30 ET, 1,595,522 prints, share of contracts:
complex 36.6%, customer buy 30.7%, customer sell 29.9%, mid 2.0%, stale quote 0.7%,
late 0.08%, cancel 0.06%.

## 4.2 Signed flow inventory

```text
C(root, expiration, strike, right) = Σ dealer-signed sizes
```
Cumulative intraday estimate. Volume ≠ inventory. Prints cannot show opening vs closing or
whether a dealer was the counterparty. Label: MODELED dealer-side flow.

## 4.3 Continuous revaluation

At each update, for every contract with C ≠ 0: current S_T (§1.2), current IV solved from
the current NBBO mid under the same (S_T, T, r_T, b_T), current T, M, accumulated C.
Greeks are never frozen at trade time. Missing IV → flat-wing (§1.5).

## 4.4 Ten exposures

```text
GEX     = gamma   × C × M × S² × 0.01              see GEX unit note below
DEX     = delta   × C × M × S                      $ delta
VEGA    = vega    × C × M × 0.01                   $ per +1 vol point
VANNA   = vanna   × C × M × S × 0.01               $ delta change per +1 vol point
CHARM   = charm   × C × M × S / D                  $ delta change per calendar day
VOMMA   = vomma   × C × M × 0.0001                 $ vega change per +1 vol point
COLOR   = −color_T × C × M × S² × 0.01 / D          GEX change per calendar day
SPEED   = speed   × C × M × S³ × 0.0001            speed-only part of GEX change per +1%
VETA    = −veta_T × C × M × 0.01 / D                $ vega change per calendar day
ZOMMA   = zomma   × C × M × S² × 0.0001            GEX change per +1 vol point
```
S here is S_T of the contract's expiry (§1.2). Sum across eligible contracts for the board.

GEX unit note: GEX = (gamma × C × M × 0.01 × S) × S = the change in dealer delta, in
underlying units, for a +1% spot move, valued at the current S — i.e. the dollar value of the
hedge adjustment. It is NOT the change in DEX for +1%, which is GEX + 0.01 × DEX (because DEX
also scales with S). COLOR, SPEED, ZOMMA and total_gex_change_1pct are changes of this GEX.
VANNA and CHARM are exact changes of DEX (S held fixed).

Sign rules: CHARM has no extra minus (charm is already −∂Δ/∂T). COLOR and VETA carry the
minus because color_T and veta_T are derivatives with respect to time remaining.

## 4.5 Time units for 0DTE

CHARM, COLOR and VETA are instantaneous rates; the time unit is only a display scaling.
"Per calendar day" reads as a one-day forecast and is misleading when T < 1 day.

```text
per_hour = per_day_value / 24          (equivalently: derivative / (D × 24))
```
Board rule (both models): one time unit per board. If any contract in the board's current
filter has T < 1 calendar day, the whole board shows CHARM, COLOR and VETA per calendar hour
(every contract converted by /24); otherwise per calendar day. Label the unit on screen and
never sum per-day with per-hour values. For T < 1 hour the per-hour figure is still an
instantaneous rate, not a forecast of the next hour; label it "rate".

---

# 5. HEDGE DEMAND

For internal inventory C:

```text
dealer_delta_units      = delta × C × M          (shares for equity/ETF; index-point units for SPX)
hedge_units             = −dealer_delta_units
dealer_dex              = delta × C × M × S
hedge_dollars           = −dealer_dex
hedge_units_change_1pct = −gamma × C × M × 0.01 × S
```

Hedge in a specific instrument:
```text
contracts_or_shares = hedge_dollars / (instrument_price × instrument_multiplier)
                      SPY: multiplier 1   ES: 50   MES: 5   (beta/tracking assumed 1; record it)
```

Complete first-order change of GEX for a +1% spot move:
```text
total_gex_change_1pct = C × M × 0.0001 × (speed × S³ + 2 × gamma × S²)
                      = C × M × 0.0001 × gamma × S² × (1 − d1/(σ·sqrtT))
speed_gex_component   = speed × C × M × S³ × 0.0001   (never label it the total)
```

Positive GEX = modeled dealer long gamma: hedging sells rallies and buys dips. Negative GEX =
short gamma: hedging buys rallies and sells dips. Book exposure and required hedge have
opposite signs. These are modeled hedging responses, not forecast orders.

---

# 6. MODEL SEPARATION

```text
MODEL 1:  UW OI rows (one timestamp) → raw store → §3.4 conversions          ┐
          OCC OI + IV per §3.5 (NBBO-solved → UW IV APPROX → flat wing)
          → engine (UW_COMPAT) → six metrics, same population as the four    ┴→ MODEL 1 BOARD

MODEL 2:  trade prints → §4.1 classification → signed inventory
          → current NBBO IV (SLAYER mode) → ten exposures → MODEL 2 BOARD
```

Never:
- add OI to flow inventory, or add Model 1 and Model 2 totals;
- use `_oi` fields in Model 2;
- apply a UW scale factor twice, or display UW raw units next to Slayer units without a tag;
- combine rows from different timestamps or different engine modes in one sum;
- treat an ask-side print as proof a market maker was the counterparty;
- treat volume as outstanding inventory, or either book as observed positioning.

Opposite signs between the books are meaningful; preserve them.

---

# 7. VALIDATION AND TESTING

The engine is not complete until all of these pass. Reference: `test_slayer_ref.py`,
`test_live_data.py`, `golden_vectors.json`.

Test 1 — Single-contract scaling: C = +1, M = 100 → GEX = gamma × 100 × S² × 0.01,
DEX = delta × 100 × S, exact to floating point.

Test 2 — Signs: short put → GEX < 0 and DEX > 0. Customer buys call at ask → C < 0 → GEX < 0.
Customer sells call at bid → GEX > 0. Customer buys put at ask → GEX < 0.

Test 3 — Finite differences. Each check is ONE level deep: differentiate the ANALYTIC
lower-order quantity, never nest numerical differences (nested differences of the price
fail correct code: measured 2,983 of 7,840 speed points).
```text
4th-order central difference: f'(x) ≈ [−f(x+2h) + 8f(x+h) − 8f(x−h) + f(x−2h)] / (12h)
h_S = 1e-3 × S × σ × sqrtT     h_σ = 1e-3 × σ     h_T = 1e-3 × T

delta   = d price / dS        vega    = d price / dσ          (analytic price)
gamma   = d delta / dS        vanna   = d delta / dσ       vomma = d vega / dσ
speed   = d gamma / dS        zomma   = d gamma / dσ          (analytic lower Greek)
charm   = −d delta / dT       (compare to charm)
color_T = +d gamma / dT       (compare to color_T, NOT to −color_T)
veta_T  = +d vega / dT        (compare to veta_T)

Exposure level (calendar convention):
CHARM = −d(DEX)/dT / D     COLOR = −d(GEX)/dT / D     VETA = −d(VEGA)/dT / D
VANNA = d(DEX)/dσ × 0.01   VOMMA = d(VEGA)/dσ × 0.01   ZOMMA = d(GEX)/dσ × 0.01
total_gex_change_1pct = d(GEX)/dS × 0.01 × S

Tolerance: |analytic − fd| ≤ 2e-6 × |fd| + 1e-9 × ref
ref = max |greek| across strikes 0.6S–1.6S for that (σ, T, r, b, right)
Skip a point only when both |analytic| and |fd| < 1e-12 × ref (numerically zero tails).
Grid: K/S 0.70–1.35; σ 8%–150%; T 15 min–3 y; (r, b) ∈ {(0,0), (4.5%,4.5%), (4.5%,3.2%), (2%,−1%)}; calls and puts
```
Do not use one-sided time differences (measured: 19% error on a 20-minute 0DTE contract).

Test 4 — UW conventions (live; pull all endpoints within the same minute during RTH):
- Pagination: total rows > 500 for SPY; strike sum equals expiry-strike sum to 1e-9.
- OI: UW `open_interest` equals ThetaData OCC OI on every matched contract.
- UW per-contract delta/gamma/vega reproduced by the UW_COMPAT engine with the Greek
  snapshot's spot and time fitted (UW does not publish them): SPY delta ≤ 1e-9 abs, gamma
  and vega ≤ 1e-8 rel; SPX ≤ 1e-3 until UW's SPX adjustment (§3.3) is identified; vanna/charm
  reproduced by the carry model per expiry (≤ 1e-9).
- Exposure formulas (§3.3) hold: median ratio within 2e-3 of 1, IQR inside ±1%,
  long-dated expiries.
- SPX rows equal SPX + SPXW roots.
- AM settlement: UW SPX-root Greeks on the eve of an AM expiration imply T to 09:30 ET.
  Intraday on the AM-settlement day (after 09:30): that expiration's UW rows must match an
  SPXW-only shadow per strike; when they do, retire the §3.4 AM flag rule.
- Shadow test: §3.4-converted UW totals vs Slayer UW_COMPAT recomputation from the same
  OI/IV/timestamp, per strike. GEX and DEX shadows use UW_COMPAT. VANNA and CHARM shadows
  must use UW's carry model (b = r_T, spot reduced by PV of dividends), because a r = b = 0
  recomputation differs from UW by model alone (measured on single contracts: charm +19%,
  and vanna changes sign near the money). Investigate any strike outside tolerance
  (pagination, missing expiries, timing, expired rows, AM-settlement rows, IV source, model)
  before touching any multiplier.
  Measured with misaligned pulls (40 min apart): GEX 4.0%, DEX 0.8%, VANNA 7.9%, CHARM 2.0%.
  Set the production tolerance from one week of same-minute pairs; do not hard-code it.
- Minute aggregate: compare only rows with equal timestamps; gamma/vanna/charm only.
- Never fix a mismatch by adding a multiplier or by adding directional exposure to OI exposure.

Test 5 — Model 2: controlled trades covering every row of the §4.1 table; inventory
verified before any Greeks; each of the ten exposures is linear in C, zero at C = 0, and
changes when S, σ or T change; GEX after +1% ≈ GEX + total_gex_change_1pct.
Production classifier output equals the reference `classify()` on a random sample of
≥20,000 real prints (measured: 0 mismatches).

Test 6 — Regression: port `golden_vectors.json` (792 Greek/exposure/hedge cases at
S = 37.5, 100, 752.1 and 7566.48 with M = 10 and 100; 3 UW conversion cases; 23 Model 2
classification cases) into `web/lib/greeks/ladder.test.ts`.
Tolerance: |got − expected| ≤ 1e-10 × |expected| + 1e-14. Requires the full-precision N(x)
of §1.3. Run
`cd web && npm test`. Keep all existing passing tests; separate suites for both models.
Mutation check: each of these injected bugs must fail the suite — color missing (b−r);
veta (1 − d1·d2); charm sign; charm without carry term; speed sign; zomma (d1·d2 + 1);
vanna with d1; COLOR without minus; CHARM with extra minus; VANNA without S; Model 2 buy
sign; UW DEX without put flip.

Test 7 — Identities (§1.4), IV round trip (price → IV → price, rel 1e-8), parity forward
recovers S·e^{bT} to 1e-12, invalid inputs rejected, unidentifiable IV rejected.

Test 8 — Vendor Greek conventions: ThetaData vega/vanna/vomma/zomma/charm/color/veta equal
engine values at scale ×1 and same sign (median rel < 2e-3 given 4-decimal rounding).

---

# 8. PROVENANCE AND DISPLAY

```text
OBSERVED     raw source data (an option print, a UW field)
CALCULATED   formula on known inputs (incl. §3.4 conversions of UW fields)
MODELED      inferred dealer position, hedge requirement, or flat-wing IV
APPROX       input used outside the exact conditions it was produced under (UW IV, §3.5)
EXPIRED      contract at/after its settlement time (excluded)
UNAVAILABLE  insufficient data
```
Every metric also carries: unit tag (UW / SLAYER), engine mode (UW_COMPAT / SLAYER),
timestamp, underlying price used, share on MODELED IV.

Model 1: four UW metrics — source Unusual Whales, converted; six — Slayer UW_COMPAT;
position assumption — OI convention; model note — UW vanna/charm use a carry model.
Model 2: source — option prints; position — opposite of inferred customer aggressor;
ten metrics — Slayer SLAYER mode; inventory — modeled intraday net flow.
Never display either book as verified market-maker inventory.

---

# FINAL ACCEPTANCE CRITERIA

1. Model 1: four UW metrics stored raw and converted per §3.4; six Slayer metrics in
   UW_COMPAT mode; one OI convention; one timestamp; expired rows excluded.
2. Model 2: ten Slayer metrics from §4.1-classified signed flow, revalued at every update in
   SLAYER mode with IV solved under the same inputs.
3. One unit system (§4.4) across both boards, D = 365 everywhere, per-root settlement times
   in both modes, contract-specific M, flat-wing IV
   instead of silent drops, one time unit per board (§4.5).
4. Tests 1–8 pass, including golden vectors and the mutation check.

---

# APPENDIX A — MEASURED VENDOR FACTS (2026-11-02)

Unusual Whales (SPY snapshot 16:15 ET, price 752.10; SPX price 7555)
- spot-exposures/strike: 551 SPY rows; limit 500 per page.
- open_interest = OCC OI (06:30 ET), 1,774/1,774 contracts vs ThetaData.
- Exposure formulas: §3.3 (gamma/delta × S²; vanna × S × IV30; charm × S × 365; puts negated
  except delta).
- SPY delta/gamma/vega: BSM r = b = 0, T = calendar/365 to 16:00 ET (exact to 1e-14 at spot
  753.05). SPX delta/gamma/vega carry an unidentified per-expiry factor (deep-ITM delta ≠ 1).
- vanna/charm: carry b = 4.06%–4.65%, escrowed dividends (exact to ~1e-12 at spot 753.22).
- IV30 used for vanna = ticker 30-day IV (`volatility/stats.iv` = 0.172).
- SPX rows = SPX + SPXW. AM root priced to the 09:30 settlement (three consistent measurements,
  §3.3; snapshot times unpublished); no AM-root Greeks published on expiration day (end of day).
- Post-close snapshot includes expired same-day contracts.
- Per-minute aggregate: gamma, vanna, charm (oi / vol / dir); no delta.
- option-contracts `implied_volatility` null for 13.6% of SPY OI.

ThetaData
- API key works through the ThetaData client (auth service, then gRPC data service).
- Greeks: vega per 1.00 vol; charm −∂Δ/∂T; color +∂Γ/∂T; veta +∂vega/∂T; per year; values
  rounded to 4 decimals; rate ≈ 3.95% (SOFR) in their Greeks on this date.
- trade_quote returns the NBBO at or before each trade, with OPRA condition codes (§4.1).

# APPENDIX B — REAL-DATA RUNS (reference engine)

Model 1 — SPY, UW 16:15 ET, expired rows excluded, Slayer units. Board unit = per HOUR
(§4.5: the Nov-3 expiry has 23.75 h left). Six metrics used UW IV (APPROX) for 86.4% of OI
and flat-wing IV for 13.6%; NBBO-solved IV (§3.5 step 1) was not run on this after-close
snapshot.
```text
GEX   −1.3030e10   (§4.4 note)           (all rows incl. expired: −1.5652e10)
DEX   +2.2866e11   $Δ                    (UW's own put sign: −6.1177e10)
VANNA +5.5122e9    $Δ per +1 vol pt
CHARM −1.1800e8    $Δ per hour           (incl. expired: −3.4638e9 per hour)
VEGA  −3.3082e8    VOMMA +7.9615e6   COLOR −1.2185e7 per hour   SPEED +4.3370e9
VETA  +3.2833e5 per hour    ZOMMA +7.1219e8
```

Model 2 — SPXW 2026-11-02 0DTE, flow 09:30–15:30 ET, revalued 15:30 ET (T = 30 min)
```text
SPX 7565.88, F_0DTE 7566.50, F_7d(Nov-09) 7572.69, implied spot S* 7566.4816 (full §1.2 rule),
b_0DTE 4.27%, r 3.95%
net |C| 74,638 across 141 contracts; |C| on flat-wing IV 40.9%
GEX −1.4694e10   DEX +1.7743e10   VEGA −2.5630e5   VANNA −3.6365e7
CHARM +9.4844e8 per hour    COLOR +1.8887e9 per hour    VETA +5.5169e5 per hour
VOMMA −9.4583e3  SPEED −2.2922e10  ZOMMA −5.1336e7
total_gex_change_1pct −2.3216e10   hedge −1.7743e10 $ ≈ −46,900 ES-equivalent
```

# APPENDIX C — CHANGES FROM v1

1. Test 3: color/veta finite differences now compare to +color_T/+veta_T with time-remaining
   differences; v1's calendar differences equal −color_T/−veta_T and would fail correct code.
2. Test 3: 4th-order central differences with σ√T-scaled steps; v1's one-sided time differences
   were 19% off on 0DTE.
3. r and b: full generalized formulas; v1's formulas were valid only at r = q = 0 while saying
   "configurable".
4. D = 365 for T and per-day conversions (both vendors use 365; v1 used 365.25).
5. IV/model consistency rule (Rule 0), parity forward, one shared implied spot S* from
   log-linear extrapolation of forwards, every expiry priced off its own forward with carry
   measured against S* (never against the stale index).
6. UW's four fields: measured formulas; DEX, VANNA, CHARM are NOT in Slayer units and UW's
   DEX does not use the put convention; exact conversions added (v1 consumed them as-is while
   requiring consistent units).
7. UW reconciliation: pagination, expired rows, no minute delta, root summing, timestamp
   alignment, OI field choice.
8. Per-root settlement times (SPX AM vs SPXW PM).
9. Flat-wing IV instead of silently dropping contracts.
10. Model 2 classifier fully specified with condition codes, aggressor flags, stale/locked quotes.
11. One time unit per board; per-hour whenever any contract has T < 1 day.
12. Hedge conversion into SPY/ES/MES; total GEX change closed form; GEX unit stated exactly
    (it is not the change in DEX).
13. Numerics: put delta coded as −ec·N(−d1); N(x) via full-precision erfc; golden vectors at
    four spots and two multipliers so S- and M-scaling bugs cannot pass.
14. Test 3 is one level deep (nested numerical differences fail correct code); explicit
    skip rule for numerically zero tails; explicit IV-unidentifiable conditions.
15. Per-root settlement times in both modes (UW measured to use 09:30 for AM SPX); on
    AM-settlement days the combined UW rows are flagged until the intraday Test 4 check passes.
16. UW shadow test for vanna/charm must use UW's carry model.
