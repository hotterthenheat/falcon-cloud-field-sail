# EDGE0DTE library (`lib/`)

Built by FOUNDATION for the family workers. Run everything from `slayer/research/edge0dte/` (`python3 -m ...`);
`lib` is a package. Data root: `v2data/edge0dte/` (new caches) with fallback to `v2data/edge/` (earlier caches,
read-only). Requires `exchange_calendars` (`pip install exchange_calendars`) for the session calendar.

## Time and visibility conventions (`config.py`)

* Decision time `t` = integer seconds after midnight ET of the session (09:45 = 35100). Decision grid `config.GRID`:
  every 5 min 09:45-15:30 (`panel.grid(day)` drops times later than close - 30 min on 13:00 early-close days).
* 1-minute bar `m` (minute of day, 570 = 09:30) covers `[60m, 60m+60)` and is usable at `t >= 60(m+1)`.
* Board snapshot stamped `m` = the NBBO in effect at exactly `60m` (verified against tick data: the 10:00:00 snapshot
  equals the last tick before 10:00:00.000). Usable at `t >= 60m`.
* 1-second quote stamped `s` = the NBBO in effect at `s`.
* Year fraction = trading minutes / (252 * 390), used both to invert IV and to scale horizons.
* 30-min time-of-day bucket: `config.bucket(t)` ('09:30' holds 09:45-09:55).

## Modules

| module | what | label |
|---|---|---|
| `cal` | NYSE sessions (`sessions`, `close_min`, `prev_sessions`), expirations (`expiries`), `expiry_sessions(root)` | - |
| `data` | loaders: `bars(root_or_sym, day)` (m,o,h,l,c[,v,n]), `chain(root, day)` (m,k,r,bid,ask,bs,as), `oi(root, day, max_dte)` (e,k,r,oi[,ts,td]), `vix(day, 'VIX'/'VIX1D')`, `daily_closes(root)` | OBS |
| `theta` | ThetaData fetchers (bars, board, OI, 1-second NBBO windows with a change-only store); `q1s(root, day, k, call, a, b)` | OBS |
| `bs` | Black-76 price, `implied_vol` (bisection), delta, gamma, vega, vanna, charm | CALC |
| `board` | `Session(root, day)`: `spot(t)`, `bars_upto(t)`, `board(t)`, `smile(t)`, `iv_atm(t)`, `sigma_h(t, h)`, `select_delta(t, call, 0.30)`, `select_atm(t)`, `truncated(t)` | OBS/CALC |
| `outcomes` | `zv(sess, t, h)` -> Z, V, ret, rv, sigma; `grid_outcomes(sess, times)`; `event_outcomes(root, day, t)` (HOLDOUT-guarded) | CALC |
| `dealer` | `exposures(sess, t, max_dte=0)`: GEX total/by strike, flip, flip distance, call/put walls, concentration, vanna/charm exposure, dealer gamma, charm/vanna/gamma hedge flows (E1-E3) | MODEL |
| `fills` | `simulate(root, day, legs, t, x_exit, fee, ticks)`, `exit_decision(day, t, h)`, `prefetch(root, day, plan)` (HOLDOUT-guarded) | OBS fills |
| `stats` | `boot_mean`, `boot_diff`, `boot_stat`, `ols_cluster` (day-clustered CR1), `spearman_ic` (day-cluster CI), `bh_fdr`, `pbo_cscv`, `deflated_sharpe`, `probabilistic_sharpe` | - |
| `panel` | feature registry (`@feature`), `build_day`, `build`, `add_features`, base features | - |
| `guard` | HOLDOUT guard | - |
| `tests/test_leakage.py` | leakage / OI date / expiry / guard / fill-timing tests | - |

## IV_atm(t) (CALC) - exact definition

1. Board snapshot at t (stamped t//60); a quote is valid when bid > 0 and ask > bid.
2. Parity forward: for strikes with a valid call and put, `F_K = K + Cmid - Pmid`; `F` = median of `F_K` over the 3 such
   strikes nearest spot(t).
3. Per strike with both quotes: call-equivalent price `C*(K) = (Cmid + Pmid + F - K) / 2` (call mid and parity-converted
   put mid averaged), inverted with Black-76 (forward F, T = (close - t) in trading-years) -> `iv(K)`.
4. `K1` = largest strike <= F with finite iv, `K2` = smallest strike > F with finite iv, each within 2 listed strikes of F;
   `IV_atm^2 = iv(K1)^2 + (iv(K2)^2 - iv(K1)^2) (F - K1)/(K2 - K1)` (total variance linear in strike; T cancels).
   Missing either side -> NaN.
5. `sigma_h(t) = IV_atm(t) sqrt(h_min / (252*390))`, `h_min` = h or minutes from t to the close.

## Outcomes (PROTOCOL section 4)

`Z(t,h) = ln(S(t+h)/S(t)) / sigma_h(t)`, `V(t,h) = RV(t,t+h) / (IV_atm(t)^2 h_years)`; S(x) = close of the bar that
closed at x; RV = sum of squared 1-minute log returns between the closes at t, t+1, ..., t+h. A missing endpoint bar ->
NaN; > 10% interior bars missing -> NaN; a horizon past the close -> NaN. h = 'close' ends at the session close.

## Fills (`fills.simulate`)

Ask in / bid out at the first valid 1-second NBBO at or after decision + 2 s; invalid quotes (zero bid on entry, locked,
crossed, zero size, missing second) are skipped forward up to 60 s, after which the trade is SKIPPED (reason returned).
A zero bid on exit is a valid quote of zero value (left to expire, no exit fee). Fees $0.65/contract/side/leg;
`fee=1.30` and `ticks=1` for the sensitivities. Time-stop exit decision `exit_decision(day, t, h) = min(t + h, close - 2 min)`.
The 1-second windows must be fetched first (`fills.prefetch` or `simulate(..., fetch=True)`, one request per contract
window; keep <= 2 ThetaData requests in flight across all your processes).

## HOLDOUT guard

`outcomes.*` and `fills.simulate` call `guard.check(day)`: days >= 2025-01-01 raise `HoldoutError` unless
`EDGE0DTE_HOLDOUT` equals a sha256 present in `v2data/locked_looks.jsonl`; 2026 is always refused. Features are not
guarded (they only use data <= t). Panels are written for 2020-02-18..2024-12-31 only.

## Adding a feature (one function)

```python
# families/b_price.py
from lib.panel import feature, add_features
import numpy as np, pandas as pd

@feature('or30_break', 'CALC')
def or30_break(sess, t):
    b = sess.bars_upto(t)                       # bars that closed by t -- never sess.bars directly
    orb = b[b.m < 600]
    if len(orb) < 30 or t < 600 * 60:
        return np.nan
    s = sess.spot(t)
    return 1.0 if s > orb.h.max() else (-1.0 if s < orb.l.min() else 0.0)

panel = pd.read_parquet('/home/user/falcon-cloud-field-sail/v2data/edge0dte/panel/SPXW.parquet')
panel = add_features(panel, ['or30_break'])
```

A feature may return a dict (columns `name_key`). Available inside a feature: `sess.spot(t)`, `sess.bars_upto(t)`,
`sess.board(t)`, `sess.smile(t)`, `sess.iv_atm(t)`, `sess.sigma_h(t, h)`, `sess.select_delta(t, call)`,
`sess.aux('SPY'|'VIX'|'VIX1D')` (full-day series: slice with `m + 1 <= t // 60`), `lib.dealer.exposures(sess, t)`,
loaders for PRIOR sessions (`cal.prev_sessions(day, n)`). Then add the name to the leakage test run:
`python3 -m lib.tests.test_leakage` (every registered feature is tested automatically once its module is imported;
import your module at the top of the test or run the test from a script that imports it first).

Event times: `outcomes.event_outcomes(root, day, t)` for any t (e.g. the first minute boundary after the event bar
closes), or `panel.build_day(root, day, times=[...])`.

## Statistics

Every inference clusters by trading day. `boot_mean(x, day)` -> (mean, lo, hi, p); `ols_cluster(y, X, day, names=...)`
-> beta/se/t/p with CR1 day-clustered errors; `spearman_ic(x, y, day)`; `bh_fdr(pvals, q=0.10)`;
`pbo_cscv(M)` with M = days x variants; `deflated_sharpe(sr, n, n_trials, sr_var, skew, kurt)`.

## Panels

`v2data/edge0dte/panel/{ROOT}.parquet` (+ `.labels.json` with OBS/CALC/MODEL per column), DISCOVERY + CALIBRATION
only. Columns: root, day, t, split, bucket, S, iv_atm, sig_{15,30,60,close}, Z_*, V_*, vix, vix1d, gex_total (MODEL),
z_prev30, rv_ratio30, etf_vol_ratio30.
