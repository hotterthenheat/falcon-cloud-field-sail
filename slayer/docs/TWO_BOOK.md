# Pinpoint's two books — what was built, and every test result

Built 2026-11-07 against `docs/TWO_BOOK_SPEC_V2.md` (the owner's spec, commit 5dc317f). The gap list it closes is
`docs/TWO_BOOK_GAP.md`. In the owner's words: "pinpoint has 2 models, one is the spot that comes from the keys and then
another is thetadata math that we use to math dealer flow gex."

- **Model 1, the open-interest book**: the listing's spot-exposure rows (four fields, converted by §3.4 exactly) and six
  house metrics in UW_COMPAT mode on the same contracts.
- **Model 2, the flow book**: every option print on the server's tape classified by §4.1 into a signed inventory (prints
  only, never open interest), revalued in SLAYER mode at the spot implied by the parity forwards, with SOFR.
- The two are never added, and the old "Live = open interest + signed volume" book is retired everywhere.

On screen the sources are described, never named (standing owner rule; it overrides §8's wording).

## 1. What was built

| Piece | Where |
|---|---|
| Greek engine (pure) | `src/engine/twobook/` — `normal.ts` (Cody erfc), `bsm.ts` (price, ten Greeks, statuses, bounds, IV), `contracts.ts` (contract-spec table, per-root settlement, T, §3.4 row action), `forward.ts` (parity forward, S*, b_T), `exposures.ts` (§4.4, §3.4, §4.5, §5), `classify.ts` (§4.1, inventory with cancel linking), `board.ts` (flat wing, board sums), `model2.ts` (end-to-end SLAYER board) |
| Model 1 board | `src/data/twobook/model1.ts` (pure), `model1Server.ts` + `server/twoBookApi.mjs`: `GET /api/twobook/oi?ticker=` |
| Model 2 board | `src/data/tapeServer.ts` (every print → `FlowInventory`, kept with the day's tape), `src/data/twobook/flowBook.ts` (revaluation): `GET /api/tape/flowbook?ticker=` |
| Browser | `src/data/twobook/engineBook.ts` (asks the server only, one board per name), `legs.ts` (the boards' cells → the chains every page reads), `src/data/book/engineView.ts` (store.ts `peekEntry` hands every page the engine's chains), `src/data/bookMode.ts` (the Map's book switch), `src/components/gex/BookSources.tsx` (the switch and the Sources & units card) |
| Retired | the Books page (`/pinpoint/books` redirects to the Map); the old per-date chain reads in `src/data/book/load.ts` (`engineChains`); the old Live = OI + flow reading |
| Python reference | `research/twobook/ref/` — `slayer_ref.py` (mpmath, 60 digits), `test_ref.py`, `make_golden.py` → `golden_vectors.json` = `scripts/golden/twobook-vectors.json` |
| Proofs in CI | `scripts/twobook-proof.ts`, `scripts/twobook-mutation-proof.mjs`, `scripts/twobook-server-proof.ts`, `scripts/book-mode-proof.ts` (rewritten), listed in `scripts/run-proofs.mjs` |
| Real-data runs | `research/twobook/appendixb_fetch.sh` + `appendixb.ts` (Model 2), `model1_live.ts` (Model 1, Test 4 pieces), `test8.ts` (vendor Greeks), `carry_a7.ts` (A7), `aggressor_check.py` (A22), `audit/score-audit.ts` + `audit/score_audit.py` (the lead's audit file) |

### Engine choices the spec leaves open (each documented in code)

- **Status precedence**: S, K, T first; then T ≤ 0 → EXPIRED; then σ (an expired contract is excluded whatever its quote).
- **Flat wing**: nearest strike of the same root, expiry and right; a tie goes to the strike nearer spot, then the lower;
  only solved (or, in Model 1, listed) vols are sources; no cross-right fill — none on the strip is UNAVAILABLE.
- **S\***: TL is the nearest other valid expiry with T ≥ 7 days (inclusive). No TL (one forward, or none at 7 days) →
  `F_T1·e^{−r·T1}`, APPROX. Every valid forward is an interpolation node; T = 0 is the node ln S*. Beyond the last valid
  expiry the last segment's slope is held. The carry is computed relative to F_T1 (`ln(F/F_T1)` as a ratio), so a
  30-minute expiry's b_T keeps full precision (a direct `ln F − ln S*` keeps ten digits; the lead's audit flags this
  case as out of reach of doubles — this engine meets it).
- **Cancel linking**: the trade_quote rows carry `sequence` only, no reference field, so a cancel is linked to the latest
  earlier kept print of the same contract, price and size (a reference, when a feed gives one, takes precedence);
  unlinked cancels are counted and shown.
- **Contract-spec table and ticks** (audit A8): Cboe SPX/SPXW/XSP/NDX/NDXP/RUT/RUTW/VIX: $0.05 below $3.00, $0.10 at or
  above (Cboe SPX options product specification, "minimum price change"); SPY, QQQ, IWM: $0.01 at any price (penny
  interval program, all series); other names: the penny program's $0.01 below $3, $0.05 at or above. M = 100 for every
  root in the table; an adjusted series (OCC's `AAPL1` style roots) has no spec and is UNAVAILABLE. AM roots (09:30 ET
  settlement): SPX, NDX, RUT, VIX, VIXW; everything else PM (16:00 ET). Early-close days still run to 16:00 (the spec's
  wording); noted as open.
- **Rate**: SOFR of the tape's day from the terminal's rate history, `r = 365·ln(1 + SOFR/360)`, flat in T (no term
  SOFR on this key). Appendix B's numbers do not move between this and SOFR as quoted (table below).
- **Model 2 population**: the tape's — on a processed day every expiry, 30 strikes either side; on the current day the
  four nearest listed expiries within 14 days (the terminal serves the current day one expiry a read). The board says
  which. Quotes come from one snapshot read per root (every expiry the inventory holds, 30 strikes either side); the
  book is valued at the quotes' instant (now in session; their newest stamp after the close).
- **Model 1 IV order (§3.5)**: step 1 (NBBO-solved at the row timestamp) is not run — the listed rows carry no quote at
  their timestamp and this book reads no other feed; step 2 (listed IV, APPROX) and step 3 (flat wing, MODELED). The
  board shows both shares.

## 2. Tests

### Python reference (`python3 research/twobook/ref/test_ref.py`, 60 digits)

| Test | Result |
|---|---|
| Test 1 single-contract scaling | pass, four spots, exact |
| Test 2 signs | pass, the four rules |
| Test 3 finite differences | **1,568 contracts per Greek** (7 K/S × 7 σ × 4 T × 4 (r, b) × 2 rights), **18,246 checks**, 8,410 numerically-zero skips, worst err/tol 0.00106; plus the seven exposure-level calendar checks per contract |
| sympy | all ten Greeks derived symbolically from the §1.3 price (N kept as an unevaluated function whose derivative is φ: sympy rewrites `erfc(−z)` as `2 − erfc(z)`, which loses the lower tail at any precision) match §1.4 on 400 random points at 50 digits, **worst relative 6.7e-45** |
| Test 5 | 28 classifier cases (all 14 rows and edges), inventory with linked and unlinked cancels, ten exposures linear in C, zero at C = 0, moving with S, σ, T; GEX slope = total_gex_change_1pct (central difference, 1e-5) and +1% within second order |
| Test 7 | identities on 200 random points (worst 1.3e-58), v1 regression at r = b = 0, IV round trip, parity forward recovers S·e^{bT} to 1e-12, statuses, unidentifiable IV rejected |
| Golden vectors | **11,641 values**: 288 Greek/exposure/hedge cases (S = 37.5, 100, 752.1, 7566.48 × M = 10, 100 × K/S × (σ, T) × (r, b) × right; price, ten Greeks, ten exposures per day and per hour, §5 hedge, total GEX change, SPY/ES/MES), 3 UW conversion cases, 28 classifier cases, one inventory sequence, 3 S* cases, 9 IV cases |
| Mutation check | **12/12** of the spec's injected bugs fail the suite |

### TypeScript engine (CI: `node scripts/run-proofs.mjs twobook-proof twobook-mutation-proof.mjs twobook-server-proof`)

| Test | Result |
|---|---|
| Golden vectors (Test 6) | **11,636 values, 0 off** at 1e-10·\|e\| + 1e-14 (plus the 9 IV cases at 1e-9 relative on σ) |
| Test 3 | 1,568 contracts per Greek, **17,926 checks**, 8,730 skips, worst err/tol 0.64 (the exposure-level checks carry a stated rounding floor, 8·eps·\|f\|/h: in doubles the 4th-order difference of a large DEX/GEX/VEGA has noise above the spec's floor on 15-minute deep-wing points; the Greek-level checks use the spec's tolerance as written) |
| Tests 1, 2, 5, 7 | pass (Test 7 also checks the contract table: SPX AM vs SPXW PM on 2026-11-20 differ by 6.5 h; an adjusted root has no spec) |
| Mutation check | **16/16 caught**: the spec's 12 (color missing (b−r) 1,228 failures; veta (1−d1·d2) 2,816; charm sign 4,184; charm without carry 2,638; speed sign 4,662; zomma (d1·d2+1) 2,624; vanna with d1 2,624; COLOR without minus 1,440; CHARM extra minus 1,612; VANNA without S 1,424; Model 2 buy sign 10; UW DEX without put flip 9) and 4 scaling bugs (D = 365.25; GEX without 1%; SPEED with S²; per hour not ÷24) |
| Server path | `twobook-server-proof`: tape ingest → inventory (SPXW and SPX keyed apart, cancel linked, complex/stale/mid excluded) → SLAYER board (S* recovered, per-hour unit, sign) and the Model 1 builder (one timestamp, expired rows dropped, the four conversions, flat wing, unavailable name) |
| Old proof | `book-mode-proof` rewritten: every bookMode function is the identity; the walls and net never read flow legs |

### The lead's independent audit file (`research/twobook-audit/golden_audit.json`, 5,272 cases, 112,208 values)

| Engine | Values off | Every mismatch |
|---|---|---|
| TypeScript | **4 of 112,208** | `iv_exactly_lower_plus_half_tick` (2 values, A20): bid 20.00, ask 20.05, bound 20, tick 0.05 — in doubles the mid equals bound + ½ tick, so the engine says not identifiable; exact binary arithmetic says identifiable. The audit's own f64 twin agrees with the engine. A boundary of arithmetic, not a reading; the audit recommends integer-tick comparisons in production. `acc_cancel_no_ref` (2 values, A17): a cancel with no reference — the audit leaves it unlinked, the engine links it by contract, price and size because the vendor's rows carry no reference field (a deliberate reading; a referenced cancel is linked by reference only, and the audit's other six cancel cases agree). |
| Python reference (the groups it implements: 5,228 cases, 112,069 values) | **2** | `acc_cancel_no_ref` as above. (The Python reference decides the A20 boundary in exact arithmetic and agrees with the audit there.) |

Changes made from the audit, each a reading of the spec text: status precedence (T before σ, A15); flat-wing tie to the
inward strike (A10); a single forward's other expiries carry r_T1 by the general "last segment held" rule (A7 fallback);
the board's time unit counts only contracts with C ≠ 0 (A16); a referenced cancel must name a print of the same contract
(A17). The audit's provenance word for a two-forward S* is EXACT; the engine's is CALCULATED (§8's word for "formula on
known inputs"); mapped in the scorer.

**A22 (codes 145/146)** — ThetaData's own trade-condition table (http-docs.thetadata.us, Articles → Trade Conditions):
"145 BID_AGGRESSOR … Aggressor of the trade is on the buy side", "146 ASK_AGGRESSOR … Aggressor of the trade is on the
sell side". The spec's table (145 → BUY, dealer −size; 146 → SELL) agrees with the vendor; no change. In practice the
codes are dormant: 0 of 1,603,955 SPXW prints on 2026-11-02, 0 of 122,314 SPY and 73,599 SPXW prints on 2026-11-06
10:00–10:30 carry either (`research/twobook/aggressor_check.py`).

**A7 (carry past the last valid forward)** on real boards (`carry_a7.ts`, the terminal's quotes of 2026-11-06 after the
close, every expiry ≤ 60 days, 10 strikes either side): SPXW 29 expiries, SPY 17, QQQ 17 — **every one had a valid
parity forward**, so no carry was extrapolated. S*: SPX 7380.21, SPY 735.77, QQQ 656.38. b_T: SPX 2.0–3.2%, SPY 2.3–5.1%
(the Dec-18 ex-dividend shows as the step to 2.9% and below), QQQ 3.2–4.8%. The short expiries are noisy (SPY's 11-10
and 11-13 at 5.0–5.1% against ~4.0% around them: one tick of mid on a 3–7 day forward). The hazard the audit describes
only arises for inventory past the last quoted expiry; the server therefore reads quotes out to the furthest expiry the
inventory holds (`flowBook.ts`), so a held contract is never priced off an extrapolated slope. A minimum segment length
for the extrapolation is left to the owner.

## 3. Real data

### Model 2: Appendix B reproduced (`research/twobook/appendixb.ts`)

SPXW 2026-11-02 0DTE, prints 09:30:00–15:29:59.999 ET from `/option/history/trade_quote` (exclusive NBBO, six one-hour
reads), quotes in force at 15:30:00 for nine SPXW expiries (`/option/at_time/quote`), SPX 7565.88 at 15:30 (strike
selection only), SOFR 3.95% of 2026-11-02.

| | Spec | Ours | Difference |
|---|---|---|---|
| prints | 1,595,522 | 1,603,955 | +0.53% |
| S* | 7566.4816 | 7566.4816 | 0.00% |
| F_0DTE | 7566.50 | 7566.50 | 0.00% |
| F_7d (Nov-09) | 7572.69 | 7572.70 | 0.00% |
| b_0DTE | 4.27% | 4.274% | +0.08% |
| r | 3.95% | 4.005% (continuous) / 3.95% (quoted) | — |
| net \|C\| | 74,638 | 79,865 | +7.0% |
| contracts with C ≠ 0 | 141 | 223 | +58% (82 far-wing contracts with small \|C\|) |
| \|C\| on flat-wing IV | 40.9% | 50.6% | +9.7 pts |
| GEX | −1.4694e10 | −1.5018e10 | −2.2% |
| DEX | +1.7743e10 | +1.7694e10 | −0.3% |
| VEGA | −2.5630e5 | −2.6605e5 | −3.8% |
| VANNA | −3.6365e7 | −4.2126e7 | −15.8% |
| CHARM / h | +9.4844e8 | +1.2448e9 | +31.2% |
| COLOR / h | +1.8887e9 | +3.3672e9 | +78.3% |
| VETA / h | +5.5169e5 | +6.1326e5 | +11.2% |
| VOMMA | −9.4583e3 | −1.0487e4 | −10.9% |
| SPEED | −2.2922e10 | −2.5033e10 | −9.2% |
| ZOMMA | −5.1336e7 | −8.3045e7 | −61.8% |
| total_gex_change_1pct | −2.3216e10 | −2.5334e10 | −9.1% |
| hedge $ | −1.7743e10 | −1.7694e10 | +0.3% |
| ES-equivalent (S*·50) | −46,900 | −46,770 | +0.3% |

Classifier shares (spec / ours): complex 36.6% / 36.61%, customer buy 30.7% / 30.49%, customer sell 29.9% / 29.68%,
mid 2.0% / 1.96%, stale quote 0.7% / 1.12%, late 0.08% / 0.07%, cancel 0.06% / 0.06%. Cancels: 8 linked, 23 not.

**What the gaps are, before any code change.** The spot, the forwards, the carry, GEX, DEX and the hedge reproduce to
within 2.2%, so the engine, the inventory sign and the scaling agree with the spec's run. The gap sits in the
higher-order, wing-sensitive metrics (vanna, charm, color, zomma, speed), and three input differences explain where it
comes from; none is an engine formula (the engine matches 112,204 of the audit's 112,208 values and both goldens):
1. *Population*: 8,433 more prints and 82 more contracts than the spec's run (its count of 141 is matched by our 80
   strikes nearest spot, 139 contracts). Restricting the inventory to the 60/70/80 nearest strikes moves no metric by
   more than 0.4%: the far wings carry no exposure. So the population explains the counts, not the metrics.
2. *Stale-quote share* 1.12% vs 0.7%: 16k contracts more are excluded here than in the spec's run, so the per-contract
   C near the money differs. The spec's quote-age measurement (or its trade/quote timestamp source) is not stated
   beyond `trade_timestamp − quote_timestamp`; ours is the terminal's two millisecond stamps.
3. *Flat-wing share* 50.6% vs 40.9% of |C|: at T = 30 minutes the ATM gamma peak spans about ±8 index points (two
   strikes), and the near-the-money ITM contracts whose mid sits within half a tick of intrinsic are not identifiable
   (§1.5) and take the nearest valid strike's IV. Color, zomma and charm at 30 minutes are dominated by those few
   contracts, so a different IV assignment at one or two strikes (which strike wins a tie — audit A10) moves them by
   tens of percent while GEX and DEX barely move. The tick table (A8) is not it: a flat 0.05 or 0.01 tick leaves every
   figure unchanged. The same engine reproduces Model 1's six for the same day to ≤ 0.35% (below), so the flat-wing rule
   itself agrees with the spec's run; what differs here is which 0DTE contracts are identifiable at 15:30 and their C —
   i.e. the inventory (point 2) and the quote set.
Not changed in code: the spec's reference files are not available to settle (2) and (3). The run is reproducible:
`bash research/twobook/appendixb_fetch.sh && node --import tsx research/twobook/appendixb.ts`.

### Model 1 on 2026-11-02: Appendix B's open-interest book reproduced (`UW_DATE=2026-11-02 … model1_live.ts SPY`)

The listing serves the 11-02 rows with `date=` (rows stamped 16:15 ET, price 752.10, IV30 0.172). Board unit per hour
(the Nov-3 expiry has 23.75 h left), exactly as Appendix B.

| | Spec (Appendix B) | Ours | Difference |
|---|---|---|---|
| GEX | −1.3030e10 | −1.3030e10 | 0.00% |
| GEX incl. expired rows | −1.5652e10 | −1.5652e10 (−1.3030e10 − 2.6219e9) | 0.00% |
| DEX | +2.2866e11 | +2.2866e11 | 0.00% |
| DEX, the vendor's own put sign | −6.1177e10 | −6.1177e10 | 0.00% |
| VANNA | +5.5122e9 | +5.5122e9 | 0.00% |
| CHARM / h | −1.1800e8 | −1.1800e8 | 0.00% |
| CHARM / h incl. expired | −3.4638e9 | −3.4638e9 (−1.18e8 − 3.3458e9) | 0.00% |
| VEGA | −3.3082e8 | −3.3067e8 | −0.05% |
| VOMMA | +7.9615e6 | +7.9333e6 | −0.35% |
| COLOR / h | −1.2185e7 | −1.2178e7 | −0.06% |
| SPEED | +4.3370e9 | +4.3368e9 | −0.00% |
| VETA / h | +3.2833e5 | +3.2839e5 | +0.02% |
| ZOMMA | +7.1219e8 | +7.1202e8 | −0.02% |
| OI on listed IV / flat wing | 86.4% / 13.6% | 86.4% / 13.6% | — |

The four are exact (they are conversions). The six agree to ≤ 0.35%; the residual is in the wing-sensitive vomma and is
the flat-wing assignment (which neighbour fills a strike without a listed IV; the spec does not fix the tie-break, A10).
Same day: pagination 551 strike rows in 2 pages (the spec's 551) and the strike walk equals the expiry-strike walk to
≤ 2.3e-10 on every field; §3.3 formulas on Jan-15/Jan-29 2027 medians gamma 1.00019, delta 1.00043, vanna 1.00128,
charm 1.00116, every IQR inside ±1% (Test 4: within 2e-3 — **pass**); the shadow totals GEX +4.0%, DEX −0.8%,
VANNA −0.7%, CHARM +0.5% (the spec measured 4.0% / 0.8% / 7.9% / 2.0% with pulls 40 minutes apart; the Greek and OI
pulls here are the same day's, not the same minute).

### Model 1 on the latest snapshot (`research/twobook/model1_live.ts`; Friday 2026-11-06, rows stamped 16:15 ET)

| | SPY | SPX |
|---|---|---|
| expiry-strike rows / pages | 6,275 / 13 | 12,638 / 26 |
| strike walk vs expiry-strike walk (pagination) | same sums to ≤ 6e-10 relative on all eight fields | ≤ 2e-10 |
| one timestamp | 6,229 rows at 16:15; 46 rows (all today's expired 0DTE) stamped 15:08–16:14 | 30 stamps; the off-stamp rows are expired |
| option-contracts rows / pages | 12,952 / 26 | 31,306 / 63 (SPXW 21,284 + SPX 10,022: both roots summed) |
| row price | 735.29 | 7385 (index print 7376.86: the coarse row price) |
| unit | per day (after the close nothing has under a day) | per day |
| GEX (converted) | −1.4401e10 | −8.6777e10 |
| DEX (converted; vendor's own put sign) | +2.5097e11 (−1.0737e11) | +5.5403e12 (−4.1036e11) |
| VANNA (÷ IV30 0.204 / 0.203) | +4.2769e9 | +4.1661e10 |
| CHARM / day | −1.7136e9 | −1.1686e10 |
| VEGA, VOMMA | −3.9968e8, +9.3732e6 | −3.6436e9, +1.2444e8 |
| COLOR / day, SPEED | −4.0606e8, +2.4280e9 | −2.5608e9, +1.5680e10 |
| VETA / day, ZOMMA | +8.0047e6, +7.8961e8 | +6.1518e7, +7.1185e9 |
| expired rows dropped | 123 rows: GEX −1.16e9, CHARM −1.06e11 per day | 243 rows: GEX −2.04e10, CHARM −1.11e11 |
| OI on listed IV (APPROX) / flat wing (MODELED) | 89.5% / 10.5% | 83.0% / 17.0% |

**§3.3 formulas** against the vendor's per-contract Greeks (`/greeks?expiry=`, the two nearest expiries more than 60
days out, contracts with OI > 100), median published/formula and IQR:
SPY gamma 0.99928 [0.9928, 1.0026], delta 0.99747 [0.9921, 1.0006], vanna 0.99986 [0.9945, 1.0041], charm 0.99794
[0.9917, 1.0015]; SPX gamma 1.00086 [0.9989, 1.0021], delta 0.99949 [0.9961, 1.0007], vanna 1.00208 [0.9998, 1.0041],
charm 1.00033 [0.9987, 1.0017]. Inside ±1% everywhere; SPY delta (2.5e-3) and charm (2.1e-3) and SPX vanna (2.1e-3) sit
just outside Test 4's 2e-3 median band — the Greek pull is not same-minute with the exposure rows (Test 4 asks for both
within one minute during RTH; this is a post-close snapshot read the next day).

**Shadow** (Test 4: the converted four vs a recomputation on the same population, OI and listed IV; GEX/DEX in
UW_COMPAT, VANNA/CHARM in the vendor's carry model b = r = SOFR, no dividend escrow), totals:
SPY GEX +4.4%, DEX −1.6%, VANNA +2.0%, CHARM +3.2%; SPX GEX −9.1%, DEX +0.5%, VANNA −1.1%, CHARM +3.0%. Per-strike
medians of recomputed/converted: SPY 0.97 / 1.03 / 0.95 / 0.98, SPX 1.00 / 1.02 / 0.99 / 0.99. Of the order the spec
measured with misaligned pulls (GEX 4.0%, DEX 0.8%, VANNA 7.9%, CHARM 2.0%). The SPX GEX gap is the largest; the AM
SPX root's unpublished per-expiry adjustment (§3.3: SPX reproduces only to ~1e-3) and the 17% of OI without a listed
IV (filled flat-wing here, priced by the vendor's own model there) are the candidates. Production tolerance is to be set
from a week of same-minute pairs (Test 4); not done here.

**The coarse row price** (SPX 7385 vs the index's 7376.86, +0.11%): the six recomputed at the row price against the
index print move GEX +1.5%, VEGA +1.1%, VANNA +2.3%, CHARM −2.6%, VOMMA +1.3%, COLOR −2.0%, SPEED +5.7%, VETA −1.5%,
ZOMMA +1.1%, DEX −0.1%. The board uses the row price, as §3.5 says, and says so ("priced at the listed row price").

**The AM-settlement flag** did not fire (Friday 11-06 is not an AM-settlement day). The intraday Test 4 AM check needs a
third-Friday session.

### Test 8 (`research/twobook/test8.ts`): the terminal's published Greeks, SPXW Nov-09 at 15:30 on 11-02

The vendor's own inputs (its underlying 7565.88, its IV to 4 decimals, T to 16:00 ET over 365 days, b = r = 3.95%):
same sign in **100%** of pairs for every Greek, scale ×1. Median |engine/vendor − 1| over values ≥ 0.05: delta 2.7e-4,
vanna 1.0e-3, vomma 1.8e-3, veta 1.6e-3, color 3.0e-3, charm 3.2e-3, vega 3.4e-3. The vendor rounds its Greeks and IVs
to 4 decimals; vega, charm and color sit above the spec's 2e-3 median (T shifted ±15/60 minutes only makes them worse,
so the clock matches; the residual is the IV rounding on the wings). Gamma, speed and zomma round to 0.0000 at this
strike spacing and cannot be compared.

## 4. What the screen shows — §The Map

One engine behind every Pinpoint view, in the Map's own formatting (2026-11-07, after the owner: "in pinpoint the map i
have all the gex in those formatting").

- **The cells.** Both boards now carry every (expiry, strike) cell, both legs, all ten in house units
  (`src/data/twobook/legs.ts`): Model 1's four converted leg by leg exactly as §3.4 converts the board (GEX as listed;
  DEX call +delta·100/S, put −delta·100/S; VANNA ÷ IV30; CHARM ·100/(365·D), ÷24 per hour), its six from the engine's
  UW_COMPAT lines summed per cell (`sumBoard(…, withCells)`); Model 2's ten from its SLAYER lines. Σ cells = the board's
  totals. The open-interest board goes out in two phases: the four as soon as the rows and IV30 are in, the six once the
  contracts are walked (the Map paints off the first); a browser holding the server's version is answered "same".
- **Every page reads them.** `store.ts peekEntry` hands every reader the engine's view of a name (`engineView.ts`): the
  loaded entry's price, bars and vols, with `all` and `byDate` replaced by the chosen book's chains (house sign, so every
  reader that prints dealer figures is unchanged). The matrix and calendar, the strike chart and ladder, the walls, the
  flip, the regime, the hedge-flow ladder, Board, Compare, Agenda/Targets, Building (per-contract gamma and vol per cell
  from the engine), Pulse's tiles and Terrain's rail all add up these cells. The flip re-prices the engine's own legs
  (T on the 365 clock to each date's settlement, the board's IV per leg, r = b = 0 for Model 1, the board's r and the
  front date's carry for Model 2); the five higher greeks are the engine's, never re-priced on the page. CHARM, COLOR
  and VETA carry the board's one unit (per calendar day, or hour), shown in every header. The old per-date reads are not
  made (`load.ts engineChains`).
- **The switch.** The Map's toolbar holds "Open-interest book | Flow book" (`data/bookMode.ts`, kept per browser): the
  whole Map — matrix, chart, walls, flip, regime — and the names that follow it (the Map's names, Terrain's panes,
  Compare's pair; the six most recent) draw the book it names. The flow book is never added to open interest: its chains
  carry no open interest at all. Other names (a Board row) stay on the open-interest book.
- **Sources & units** (beside the switch, replacing the Books page): as-of time, priced-at, unit, model, position
  assumption, the share on modelled vol, the population (rows at one timestamp, rows of another left out, expired rows
  left out, the flagged AM line), the listing's own-sign DEX for reference, the carry-model note; for the flow book the
  valuation time and implied spot, rate and carry, the inventory, the prints and the classifier's shares, the cancels,
  the population, GEX change for +1% and the hedge. It changes with the switch.
- **The proof** (`scripts/twobook-map-proof.ts`, in CI, on recorded SPY and SPX books in `scripts/fixtures/twobook/`,
  written by `scripts/twobook-map-record.mjs`): each board rebuilt from its recorded inputs equals the server's answer;
  Σ cells, Σ per-date chains and Σ whole-book chain equal the board totals for all ten (1e-9 relative); every matrix cell
  the Map draws is the chain's figure; the walls are the cells' largest call and put GEX; the flip's legs add to the
  chain's net and, at the board's price, to the board's GEX, and the regime is its sign; the flow book's chains carry no
  open interest; the switch swaps every chain.
- The field-history toggle (the recorder's "traded today" gamma of the listing's rows, not the flow book) is renamed
  "Traded today" / "Open interest" so it is never read as the retired book.
- Pinpoint's name list now includes optionable names only the terminal lists (flow book only).
- No screen names a vendor.

## 5. Not done, and why

- **§3.5 step 1** (an IV solved from the NBBO at the UW row timestamp): the open-interest book reads the listing only and
  its rows carry no quote at their timestamp; listed IV (APPROX) and the flat wing are used and their shares shown.
- **Model 2 population on the current day** is the tape's four nearest expiries within 14 days, 30 strikes either side
  (the terminal serves the current day one expiry a read, about a minute each); a processed day is every expiry.
- **SPX on 11-02** for Model 1 (about 90 more pages on the shared key); SPY 11-02 and SPX 11-06 were run.
- **The exposure recorder** (Terrain's per-minute field history, `src/data/exposureRecorder.ts`) still records the
  listing's rows minute by minute: its GEX is the same figure as Model 1's (call + put gamma_oi), but it reads the
  whole-book route (no expiry on a row, so §3.4's expired-row rule cannot be applied after 16:00) and four pages; the
  field's newest column is aligned to the engine's chain (`exposureLog.ts alignLatestColumn`). Moving it onto the
  engine's walk would multiply its vendor calls per minute by the expiry count.
- **A week of same-minute Test 4 pairs** for the production shadow tolerance, and the intraday AM-settlement check.
- **Early-close days**: PM roots still run to 16:00 per the spec's wording.
- **The 15 terminal-only names**: listed on Pinpoint; on 2026-11-07 the terminal answered no expirations for the ones
  tried (KVUE, MGPI, SOXS, LXP, CBZ) and an error for RAMP, so their live flow books could not be shown today.
- **Live end-to-end of a flow book through the dev server**: the quote snapshot, S* and SOFR legs were exercised live
  (XSP: S* 738.13 from 2026-11-06 curb quotes); the day's trade_quote windows then answered HTTP 500 from the terminal
  for XSP and SPY, so a filled live board was not observed. The same path is covered offline by
  `twobook-server-proof` and on the full 11-02 SPXW day by `appendixb.ts`.
