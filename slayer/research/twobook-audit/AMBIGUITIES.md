# TWO_BOOK_SPEC_V2: ambiguities and the readings the audit chose

This audit implementation (`ref60.py`) was written from `slayer/docs/TWO_BOOK_SPEC_V2.md` alone.
Each item below marks a place where two correct implementations of that text could disagree.
Golden cases that depend on a reading list its id in their `ambiguity` field, so a mismatch on such
a case is a reading difference, not a bug.
Items A1–A20 are tagged in `golden_audit.json`. The later items are recorded here only.

## §1.2 Parity forward and implied spot

**A1. Median over an even count.**
The spec says "median over the 6 strikes", and 6 is even. If fewer strikes qualify, the count can also be 4 or 2.
*Chosen:* the mean of the two middle values (the standard median).
*Alternatives:* the lower median or the upper median, which would always return one strike's own forward.

**A2. Tie for the last of the 6 strikes nearest spot.**
Example: spot sits on a strike and the 6th and 7th candidates are equally far away.
*Chosen:* sort by (|K − S_ref|, K), so the lower strike wins.
Case: `pf_tie_6th`.

**A3. What "spot" means for strike selection, and what "two-sided" means.**
§1.2 says the index print is never a model input, yet choosing "strikes nearest spot" needs some reference price.
*Chosen:* a reference `S_ref` (the index print or the previous S*) used for strike selection only.
- "Two-sided" means both the call AND the put at that strike are finite with bid > 0 and ask > bid.
- Locked or crossed quotes do not count.
- The filter is applied first and then the 6 nearest are taken (filter-then-select), not the reverse.

Cases: `pf_even_count_4`, `pf_sref_offcenter`.

**A4. Minimum count for a "valid parity forward".**
*Chosen:* at least 1 eligible strike, and the median F must be finite and > 0.
*Alternative:* require all 6 strikes, or some other minimum.
Case: `pf_single`.

**A5. TL selection.**
*Chosen:*
- "Nearest OTHER expiry with T ≥ 7 calendar days" means the smallest T with minutes ≥ 7 × 1440. The bound is inclusive.
- TL is chosen only among valid forwards other than T1. T1 itself may be ≥ 7 days.
- If ≥ 2 valid forwards exist but none qualifies as TL, the fallback applies: S* = F_T1·e^{−r_T1·T1}, provenance APPROX. The spec names the fallback only for "only one valid forward".

Cases: `is_all_valid_TL_exactly_7d`, `is_no_TL_two_short_valid`.

**A6. Expiries shorter than T1 with no valid forward.**
"Between the nearest valid expiries on each side" has no left-hand neighbour here.
*Chosen:* use the node (0, ln S*). This gives b_T = b_T1, which is the same as holding T1's carry flat.
*Alternative:* extrapolate the T1→T2 segment backwards.
Interpolation uses ALL valid forwards as nodes, not only T1 and TL.
Cases: `is_0dte_invalid`, `is_direct_interp` (expiry `z`).

**A7. "Beyond the last valid expiry, the last segment's carry held flat".**
*Chosen:* extend the slope d(ln F)/dT of the last segment, i.e. the segment between the last two nodes, where node 0 is (0, ln S*).
*Alternative:* hold that expiry's own spot carry b_T(last) flat, i.e. ln F = ln S* + b_last·T. The two differ.

Hazard: when the last two valid expiries are close, the extrapolated carry is unstable.
- Case `is_two_last_invalid`: the last segment is 7d → 7d30m, only 30 minutes long.
- That segment's slope pushes b to 8.0% at 14d and 10.2% at 30d, against roughly 4% on the curve.
- The spec may want a minimum segment length.

In the fallback, the "last segment" is (0, ln S*) → T1, so every expiry gets b = r_T1.

**A29. SPX (AM) and SPXW (PM) on the same date.**
*Chosen:* each (root, expiration) pair is its own expiry in §1.2, with its own T and its own forward. There is one S* per underlying per timestamp, shared across roots.
Not tagged in the golden file.

**A30. r_T, the SOFR curve at T.**
The spec does not give the interpolation method or the compounding conversion. The golden cases supply r per expiry.

## §1.5 IV, bounds, ticks and flat wing

**A8. Tick table, and the price at which the tick is read.**
The spec only says "from the contract-spec table" and gives no table.
*Chosen:* the tick is read at the mid. Default table in `ref60.default_tick`:

| Roots | Tick |
|---|---|
| SPX, SPXW, NDX(P), RUT(W) | 0.05 below 3.00, 0.10 from 3.00 |
| SPY, QQQ, IWM, XSP | 0.01 everywhere |
| Other roots (penny-program default) | 0.01 below 3, 0.05 from 3 |

Every golden IV case carries its `tick` explicitly.

**A9. "Lower/upper no-arbitrage bound".**
*Chosen:* the European bounds of the generalized-BSM price under the same (S, T, r, b) as the solve, i.e. the limits σ → 0 and σ → ∞:
- call: [max(0, S·ec − K·e^{−rT}), S·ec]
- put: [max(0, K·e^{−rT} − S·ec), K·e^{−rT}]

American intrinsic value (S − K for SPY) is NOT used.
*Alternatives:* intrinsic, or undiscounted forward bounds.
Cases: `iv_below_lower_half_tick`, `iv_put_deep_itm_r`.

**A10. Flat-wing "nearest strike", when two strikes are equidistant.**
*Chosen:* nearest by |ΔK|.
- Tie-break: the strike nearer to S_ref (inward) wins, then the lower strike.
- Only directly solved IVs are sources, never another flat-wing value. No chaining.
- No cross-right fallback. If the expiry/right strip has no valid IV, the contract is UNAVAILABLE.

Cases: `fw_tie_equidistant`, `fw_tie_wing_both_sides`, `fw_none_valid`.

For Model 1, a UW IV (APPROX, §3.5 step 2) also counts as a valid source. This is not in the golden file.

**A15. Status precedence.**
§1.5 lists σ ≤ 0 under UNAVAILABLE before T ≤ 0 under EXPIRED.
*Chosen:*
1. S, K or T missing, non-finite or ≤ 0 (S and K only) → UNAVAILABLE.
2. Otherwise T ≤ 0 → EXPIRED. This is decided before σ, because σ is unknown until it is solved.
3. Otherwise σ invalid → UNAVAILABLE.

So T ≤ 0 with σ = NaN is EXPIRED.
Cases: `st13`, `st14`, `st15`.

**A20. Comparisons at exact boundaries.**
Applies to: mid ≤ lower + tick/2; price ≥ ask; price ≤ bid; quote_age > 1000; T < 1 day.
*Chosen:* exact arithmetic on the IEEE-double inputs as given.

A double implementation, or one comparing decimal cents, can decide an exact boundary differently.
Case `iv_exactly_lower_plus_half_tick` (bid 20.00, ask 20.05, lower bound 20, tick 0.05):
- in exact binary arithmetic the mid is above the bound, so the IV is identifiable;
- in decimal the mid equals the bound, so it is not identifiable;
- the f64 twin agrees with decimal.

Recommendation: do these comparisons in integer ticks or cents in production.

**A24. IV solver stopping rule versus golden IVs.**
- The spec's convergence criterion is |price error| ≤ 1e-10·S.
- Golden IVs are the exact root to 60 digits.
- A solver that stops at the spec's criterion can be off in σ by up to 1e-10·S/vega.

Score IV cases either at the default tolerance, which a solver polished to machine precision meets, or by |price(iv_got) − mid| ≤ 1e-10·S. `info.vega` is given for that check.
The order of the non-identifiable checks only changes the (unscored) reason code.

**A21. Conditioning of the carry b_T = ln(F_T/S*)/T for T < 1 day.**
This is a numerical limit rather than a textual ambiguity.
- In IEEE double, b at T = 30 min is accurate to only about 2e-10 relative (measured on the f64 twin).
- So golden `per_expiry.<0DTE>.b` cannot be met at 1e-10 by a correct double implementation.
- The 9 golden cases flagged `info.f64_twin_out_of_tol` are exactly these, plus A20.
- Compare F_T, or b_T·T, instead. Both are well-conditioned and both are in the golden file.

## §1.1 / §3 Time, settlement and the UW population

**A11. Settlement for roots the spec does not name.**
*Chosen AM set (T to 09:30 ET):* {SPX, NDX, RUT, XEO, OEX, DJX, VIX}.
*Everything else is PM (16:00 ET):* SPXW, XSP, NDXP, RUTW, ETFs, equities.

Not specified:
- early-close days (13:00 ET); 16:00 is always used;
- VIX's Wednesday SOQ timing.

Cases: `tts02`–`tts05`, `tts10`–`tts12`.

**A12. "calendar_minutes_remaining" across a DST change.**
*Chosen:* real elapsed minutes between UTC instants. Across a DST change the wall-clock difference is 60 minutes different.
Cases:
- `tts07` crosses the DST end on 2026-11-01 and gives 10,200 minutes, not 10,140.
- `tts08` crosses the DST start and gives 10,080 minutes, not 10,140.

Snapshot times are converted to ET before the §3.4 clock tests.

**A13. §3.4 step 2 precedence.**
*Chosen:*
1. Expiration before the snapshot date (in ET) → DROP.
2. Expiring today and the snapshot is at or after 16:00:00 ET → DROP. This includes AM-settlement days, so the drop wins over the AM flag.
3. AM-settlement day for that expiration and the snapshot is in [09:30:00, 16:00) ET → FLAG_AM.
4. Otherwise INCLUDE.

"AM-settlement day" is supplied per row as an input.
Cases: `pop06`–`pop08`.

**A14. Time unit of the UW four.**
UW CHARM converted by §3.4 is "per calendar day". Under the §4.5 hour unit it is divided by 24 like the other three time-rate metrics.
- VANNA, GEX and DEX are never time-scaled.
- The flagged AM line is shown in the board's unit.

## §4.1 / §4.2 Classifier and inventory

**A17. Cancel linking.** The spec says "linked through the vendor's sequence/reference fields" but names no fields.
*Chosen:*
- Every print has `seq` and belongs to a contract. A cancel carries `ref_seq`, the seq of the print it cancels on the SAME contract.
- Codes 40–44 are all treated as reference-linked. There are no positional "cancel last / cancel first" semantics.

Effects:
- A linked cancel removes that print's dealer contribution: 0 for MID or excluded prints, so the cancel is linked but C does not change.
- These cancels are logged as unlinked and change nothing:
  - a missing ref;
  - a ref to an unknown or already-cancelled print;
  - a ref to a cancel;
  - a ref to another contract;
  - a ref to a print that arrives later.

Cases: `acc_*`.

**A18. Non-finite size.**
The literal test "size ≤ 0" lets NaN through.
*Chosen:* a size that is not finite, or ≤ 0, is EXCLUDED_INVALID. Non-integer sizes are accepted.
Case: `cl_size_nan`.

**A19. Missing trade or quote timestamp.**
*Chosen:* EXCLUDED_STALE_QUOTE, because the age is unknown.
Case: `cl_missing_quote_ts`.

**A22. Codes 145 and 146.**
"145 (BID_AGGRESSOR)" is labelled "buy-side aggressor" → BUY, dealer −size. In common usage a bid aggressor is a seller hitting the bid.
- *Chosen:* follow the table literally: 145 → BUY, 146 → SELL.
- Worth confirming against ThetaData's code list. If the label is right and the sign is wrong, every flagged print flips.

Also, the spec assumes one integer `condition` per print. If a feed carries several codes, which one applies is undefined.

**A23. Table order is followed literally, with these consequences:**
- Codes in rows 1–4 beat an invalid print (row 5). Example: cancel with size 0.
- Aggressor flags (rows 6–7) are signed even when the print is late, has no quote or has a stale quote.
- Row 9 "ask ≤ 0" catches bid = ask = 0 before row 10, locked/crossed.

Cases: `cl_cancel_beats_invalid`, `cl_aggr_*`, `cl_ask0`.

## §4.3–§4.5 Boards

**A16. Which contracts drive the §4.5 unit rule ("any contract in the board's current filter").**
*Chosen:* only contracts that enter the sums. Contracts with any of the following do NOT switch the board to hours:
- C = 0 (Model 2);
- EXPIRED;
- UNAVAILABLE;
- excluded by §3.4 (Model 1);
- in the flagged AM line.

Other rules:
- The test is strict: T < 1/365. Exactly 1 day is per day.
- The rule is re-evaluated whenever the filter changes, e.g. filtering out 0DTE returns the board to per day.

Cases: `tu_0dte_C0`, `tu_expired_only_short`, `tu_exactly_1d`.

**A42. IV solving with C ≠ 0 versus the flat-wing strip.**
§4.3 revalues "every contract with C ≠ 0", but flat-wing needs valid IVs at neighbouring strikes that may have C = 0.
*Chosen:* solve IV for the whole listed strip of the (expiry, right), then fill.
Case: `board_model2`.

**A43. Denominator of "share of |C| on modeled IV".**
*Chosen:* |C| of the contracts that enter the sums (non-expired, IV available).
For Model 1, APPROX (UW IV) is NOT counted as modeled. Only the flat wing is.

**A35. Which price converts the hedge into ES/MES.**
`instrument_price` is ambiguous between the ES futures price and S*.
- Appendix B's "−46,900 ES-equivalent" equals −1.7743e10 / (7566.48 × 50), so it was computed with S*, not an ES quote.
- The golden cases take the instrument price as an explicit input.

## Test 3 reproduction details

**A39. ref = "max |greek| across strikes 0.6S–1.6S".**
The spec does not say how this maximum is sampled.
*Chosen:* the union of:
- a 401-point linear grid;
- 961 points uniform in standardized moneyness z ∈ [−12, 12] around the forward, clipped to [0.6S, 1.6S];
- the grid strikes.

A coarse grid misses the short-dated gamma peak (width about S·σ·√T), which shrinks ref and tightens the tolerance.

Skip counts also depend on arithmetic precision: vega checked 1,064 times in f64 and 952 times at 60 digits, because f64 noise in the finite difference of the price pushes some tail points above the 1e-12·ref skip floor.

**A40. Grid spacing for "K/S 0.70–1.35; σ 8%–150%; T 15 min–3 y".**
The spec gives ranges, not points.
*Chosen reading of "1,568 contracts per Greek":* 7 K/S × 4 σ × 7 T × 4 (r, b) × 2 rights, at S = 100:
- K/S: evenly spaced from 0.70 to 1.35;
- σ: {8%, 25%, 60%, 150%};
- T: {15 min, 1 h, 1 d, 7 d, 30 d, 1 y, 3 y}.

## Other notes on the spec text

- The status header cites `slayer_ref.py`, `golden_vectors.json` and the 792-vector, 3 UW-case and 23 classifier-case counts. Those files are not in the repo, so this audit's golden set is independent and larger. See README.md.
- UW_COMPAT T is measured to "each root's settlement time" from the row `time`. UW does not publish its Greek snapshot time (§3.3), so a Model 1 shadow comparison inherits that offset. Not testable here.
- §3.4 VANNA divides by the published 3-decimal IV30. UW's own vanna uses a carry model, so the converted VANNA is in Slayer units but is not a derivative of Slayer's UW_COMPAT delta (§3.3 says so). No ambiguity, but worth stating on the board.
