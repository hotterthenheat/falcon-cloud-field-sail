# EDGE0DTE registry addendum 3 (2026-11-07): hypotheses suggested by DISCOVERY, testable only out of sample

Written after the four Stage-1 DISCOVERY families reported and BEFORE any CALIBRATION (2024) or HOLDOUT (2025) outcome
exists for any test. These rows were SUGGESTED by DISCOVERY data (they are the opposite sign of registered rows), so
their DISCOVERY results are contaminated and are NEVER used as evidence for them. They are judged only on CALIBRATION
(2024) and then, if they pass every criterion there, on one blind HOLDOUT look (2025). Their trial count is added to
the deflated-Sharpe total.

| id | feature | mechanism (post hoc, stated before the out-of-sample test) | outcome, sign | parameters |
|---|---|---|---|---|
| B8R | one-hour shock: last 60-min Z beyond 2 (B8's exact trigger, P) | short-horizon momentum from forced, one-sided flow (stops, hedges) that is not finished in an hour; the opposite of B8's temporary-pressure reversal | Z in the direction of the shock > 0 at h = 30 and 60 | P exactly B8's P (|Z60| > 2); no grid is used for the decision |
| X12R | 30-min opening-range breakout continuation in the LOW VIX tercile minus the HIGH tercile (B1 trigger, X12 terciles) | in calm markets breakouts are informed; in high VIX the range is noise and breakouts fail | difference > 0 at h = 60 and close | B1 P, X12's tercile rule (prior 252 sessions) |

Pass rule for B8R / X12R (CALIBRATION, U1, SPXW primary): effect CI excludes 0 with the stated sign AND the effect
clears the HURDLE.md hurdle at that horizon AND same sign on at least 2 of SPY/QQQ/IWM. Two horizons each are one
family of 4 tests, Holm-corrected at 0.05. Passing CALIBRATION only earns a Stage-2 executable test and the single
blind HOLDOUT look; it is not an edge.
