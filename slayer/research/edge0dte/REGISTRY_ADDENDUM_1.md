# EDGE0DTE registry addendum 1 (2026-11-07): the universe widens to every root with a same-day expiry

Written and committed BEFORE any Stage-1 outcome exists for any universe. REGISTRY.md and PROTOCOL.md are unchanged;
this file adds a universe and its rules. Reason (owner, 2026-11-07): 0DTE trading is not limited to SPX/SPY/QQQ/IWM.
Thousands of optionable roots have a same-day expiry on some sessions (daily listings, Mon/Wed/Fri listings, weekly
Friday listings, holiday-shifted Thursdays, end-of-month and quarterly dates).

## 1. Same-day expiry: defined by the record, never by a pattern

A root R has a 0DTE session on date D if and only if an option series of R with expiration date D was listed AND traded
on D (at least one regular-hours print in the OPRA record). This is determined per (root, date) from the listed
expirations and the day's trade/EOD record, not from a rule such as "daily" or "Mon/Wed/Fri". Listing patterns change
over time and are reported as a description of the table, never used to fill it. Every pattern change, holiday shift
and anomaly is listed in `universe/ANOMALIES.md`.

Root symbols are the OPRA option roots (e.g. SPXW, not SPX, for the PM-settled weekly/daily series; NDXP, XSP, RUTW,
VIXW and others where they exist). AM-settled series expiring D are recorded but excluded from Stage 1 (they settle
at the open of D, so they are not 0DTE intraday instruments).

## 2. Universes

| universe | members | role |
|---|---|---|
| U1 | SPXW (primary), SPY, QQQ, IWM | unchanged: the primary FDR family of REGISTRY.md |
| U2-T1 | point-in-time Tier 1: the 50 roots (excluding U1) with the largest trailing same-day-expiry volume | a second, separate FDR family |
| U2-T2 | point-in-time Tier 2: the next 200 roots | replication only (reported, not in any FDR family) |
| U2-T3 | every other root with a 0DTE session | coverage statistics only |

Tiers are POINT-IN-TIME. For each session D, a root's tier uses only the 20 prior sessions on which it had a same-day
expiry: total same-day-expiry contract volume, and the median near-ATM (|delta| 0.20-0.50) quoted spread / mid at 10:00
ET. A root is tier-eligible only if that median spread is <= 15% and it had >= 8 such sessions in the window. No future
liquidity, listing or survival information is used. Roots that later delisted, merged or changed ticker keep their
sessions; the root list comes from the historical record of each date, not from today's list.

## 3. Rules for U2 (in addition to PROTOCOL.md)

* Same hypotheses (REGISTRY rows A-F and X), same outcomes Z and V, same horizons, same primary parameters, using each
  root's own board, OI, bars and (where built) flow. A row whose required data does not exist for a root is N/A for
  that root and is reported as such; it is never imputed.
* Earnings: sessions within one trading day before or after the root's earnings date are EXCLUDED from the U2 primary
  tests (event variance dominates) and reported as a separate stratum. Earnings dates are taken from the record
  available before D.
* Inference: U2 observations on the same day are correlated. Primary CIs cluster by day; two-way clustering
  (day and root) is also reported. A U2 result counts only if it holds under both.
* FDR: BH at q = 0.10 within U2-T1 separately from U1. A finding in U2-T1 that does not replicate in U2-T2 with the same
  sign does not pass.
* Hurdle: computed per tier (and per root for U2-T1) from executable fills, as in PROTOCOL.md section 5; single-name
  spreads are expected to be wider, so the hurdle will be higher.
* Splits are unchanged: DISCOVERY <= 2023, CALIBRATION 2024, HOLDOUT 2025 (one look, blind), LOCKED 2026 never opened.
  Many single names had no same-day expiry in 2020-2022; a root enters only from its first real 0DTE session.
* Data budget: U2 history is fetched for U2-T1 first, then U2-T2 as disk and terminal time allow; coverage is reported
  per root and year, with every missing session and its reason.

## 4. The universe table (the "never wrong" check)

`universe/` (built by the UNIVERSE worker) holds, for every optionable root and every session 2020-02-18..2026-11-06:
listed expirations, whether D was an expiration date for R, whether that series traded on D (prints, volume), its
settlement style, and the derived pattern label. Every row is cross-checked three ways:
(1) listed expirations vs (2) the day's actual prints for that expiration vs (3) the exchanges' published product
lists where they exist (Cboe / Nasdaq / NYSE daily- and weekly-expiration product lists). Disagreements are listed
and resolved by the trade record (the record wins). A random sample of 200 (root, date) cells is re-verified by
direct quote/trade queries, and the error rate is reported.
