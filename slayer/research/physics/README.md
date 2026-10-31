# Physics-indicator study

Research only: nothing here is imported by the app. The findings are in `REPORT.md`; every number in it comes from
`results/`.

## Requirements

Python 3 with numpy (no scipy or pandas needed) and the ThetaData v3 terminal on `http://127.0.0.1:25503/v3`
(override with `THETA_URL`). Downloads are cached under `data/` (git-ignored); a re-run fetches only what is missing.
The fetcher never has more than two requests in flight. When two fetch jobs run side by side, start each with
`FETCH_WORKERS=1`.

## Commands (from `slayer/research/physics/scripts/`)

```sh
python3 fetch.py eod                       # VIX daily closes (seconds)
python3 fetch.py bars                      # 1-minute bars, SPY QQQ SPX NVDA AAPL, 2023-01 .. 2026-10 (about 1 hour)
python3 fetch.py gamma SPY                 # per-session OI + prior-session EOD greeks, 0-10 DTE (about 1 hour)
python3 fetch.py gamma QQQ 20240101        # the QQQ replication, from 2024 (about 30 min)

python3 build_features.py SPY QQQ SPX NVDA AAPL   # decision-point features + breakout events -> data/*.npz
python3 evaluate.py SPY QQQ SPX NVDA AAPL         # intraday tests -> results/intraday.json
python3 halflife.py SPY QQQ SPX NVDA AAPL         # daily vol half-life / HAR -> results/halflife.json
python3 gravity.py SPY                            # gamma reconstruction + gravity-well tests -> results/gravity_SPY.json
python3 gravity.py QQQ                            # the same for QQQ (2024 on)
python3 gravity.py SPY analyse                    # re-run the analysis only, from results/gravity_rows_SPY.json
python3 lyap_surrogate.py SPY                     # Lyapunov exponent: real vs shuffled returns
python3 summarize.py                              # Holm-adjusted table of every primary test -> results/summary.md
python3 triage.py                                 # the 200-indicator verdict table -> results/indicator_triage.csv
```

## Files

| file | what |
|---|---|
| `scripts/lib.py` | loading, every feature's equation, walk-forward OLS, day-block bootstrap, AUC, Holm |
| `scripts/build_features.py` | the feature table at 10:00-15:00 every 15 min, and the breakout events |
| `scripts/evaluate.py` | vol-forecast, continuation, early-warning, breakout and spillover tests |
| `scripts/halflife.py` | daily realised-vol forecasts (RW, 20-day, AR(1) half-life, HAR, HAR+VIX) |
| `scripts/gravity.py` | historical dealer-gamma book, the well / walls / flip / pull, and their tests |
| `results/indicator_triage.csv` | id, name, family, verdict, standard name, data, page for all 200 |
| `results/primary_tests.csv`, `results/summary.md` | every primary test with raw and Holm p-values |

## Protocol, in one paragraph

Windows, orders, thresholds and scales are constants at the top of each script, set before any result was seen and
never changed afterwards. Training block 2023-01 to 2024-06; test 2024-07 to 2026-10. Every fitted number (regression
weights, tercile cut points) is fitted only on data before the quarter (intraday) or month (daily) it predicts.
Features read only closed bars; the gamma book uses the 06:30 open-interest stamp and the previous evening's IVs.
Confidence intervals resample whole sessions (intraday) or 20-day blocks (daily). Each indicator is compared with
the plain measure a trader already has: an intraday HAR of realised vol plus time of day, a 20-day realised vol,
the breakout bar's own size, plain multi-timeframe sign agreement, the largest-OI strike or a round number.
