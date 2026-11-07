# Two-book engine: independent audit implementation

This is a second implementation of `slayer/docs/TWO_BOOK_SPEC_V2.md`, written from the spec text alone.
- No code under `slayer/src`, `slayer/server` or `slayer/research/twobook` was read.
- No other worker's branch or worktree was read.

Its purpose is to let another implementation be scored value by value.

| File | What |
|---|---|
| `ref60.py` | Engine covering §1.1–§1.5, §3.3–§3.5, §4.1–§4.5 and §5. It runs on two backends: mpmath at 60 digits (`MP`, the reference) and an IEEE-double twin with `math.erfc` (`F64`). |
| `symbolic_check.py` | Derives the ten Greeks from the §1.3 price with sympy and compares them with the §1.4 formulas, which are transcribed separately. `python3 symbolic_check.py 400` runs 400 random points at 50 digits. `python3 symbolic_check.py exact` simplifies each difference to an exact 0. |
| `fd_check.py` | Test 3 exactly as specified. `python3 fd_check.py f64` or `python3 fd_check.py mp`. |
| `golden.py` | Builds, evaluates and scores the golden vectors. `python3 golden.py gen` writes `golden_audit.json`; `python3 golden.py score` scores it. |
| `golden_audit.json` | 5,272 cases and 112,208 expected values. The schema is embedded under `_schema`. Tolerance: \|got − e\| ≤ 1e-10·\|e\| + 1e-14. |
| `run_tests.py` | The audit suite: Tests 1, 2, 3 (f64), 5, 6 (golden), 7, and a UW §3.3↔§3.4↔§4.4 consistency check. |
| `mutation_check.py` | Injects each Test 6 bug into a copy of `ref60.py` and confirms the suite fails. |
| `AMBIGUITIES.md` | Every reading choice. Golden cases cite these ids in their `ambiguity` field. |
| `results_*.json` | The recorded outputs of the checks above. |

## Scoring another implementation

For each group in `golden_audit.json["groups"]`:
1. Feed `inputs` to the other engine.
2. Compare its outputs with `expected`. Only `expected` is scored.
3. Compare numbers at 1e-10·|e| + 1e-14; compare strings, booleans and null exactly.

Read the result in this order:
- **Cases tagged with `ambiguity`:** a failure there is a reading difference. Resolve it with `AMBIGUITIES.md`.
- **Cases with `info.f64_twin_out_of_tol`:** a correct IEEE-double implementation cannot reach 1e-10 here (A20, A21). There are 9 such cases.
- **All other cases:** a mismatch is a bug in one of the two engines.

`golden.bad_fields(got, expected)` is a ready-made comparator.

## Results (2026-11-07)

- **Symbolic check:** all 20 differences (10 Greeks × call/put) simplify to exactly 0. Numerically, on 400 points at 50 digits, the worst absolute difference is 3.0e-44 and the worst relative difference is 2.4e-40 (50-digit evaluation noise in deep tails).
- **Test 3:** 0 failures on 1,568 contracts per check, in both f64 and 60 digits. Counts are in `results_fd_*.json`.
- **Golden scores:**
  - The MP engine passes every case.
  - The f64 twin fails only the 9 conditioning-limited cases.
- **Mutations:** 12 of 12 caught. An unmodified control copy passes.
