# Compass v2 — foundation (data, simulator, evaluation)

Everything a v2 hypothesis is tested on. Read `/tmp/qa/V2_PROTOCOL.md` first; this code implements its rules 2, 3,
6, 7, 11 and 12. Run everything from this directory (`slayer/research/compass-v2`), Python 3.13 + numpy/pandas/
pyarrow/scipy (no pytest: `python3 -m tests.run`).

```
data/      clients.py (terminal <=2 in flight, UW 1 in flight, keys from /tmp/qa/keys.env, never printed)
           fetch.py   (build the store)   store.py (read it)   splits.py (DEV / VALIDATION / LOCKED, fixed)
sim/       engine.py  (event-driven backtester)   exits.py (adaptive exits)   feeds.py (UW events at publication time)
           memsession.py (in-memory session: tests, synthetic data)   lint.py (refuses strategies that go around ctx)
eval/      metrics.py (expectancy, CIs, Sharpe, DD, PBO/CSCV, DSR, regimes, ledger count, the protocol bar)
           nulls.py   (shuffled-signal null, synthetic zero-drift sessions, null pass rates)
           score_frozen.py (blind scorer: one frozen spec file + its commit)   report.py (markdown tables)
frozen/    TEMPLATE.py (the frozen-spec format)
baselines/ strategies.py, run.py -> BASELINES.md (three dumb baselines + null calibration)
validation/ compass_replay.py -> COMPASS_REPLAY.md (simulator vs recorded Compass calls); interval_semantics.py
tests/     test_engine.py (latency, spread, size, exits, no look-ahead), test_lint.py, test_eval.py
```

## 1. Data

Store: `/home/user/falcon-cloud-field-sail/v2data/sessions/YYYYMMDD/` (override with `V2DATA=`). Build:

```
python3 -m data.fetch --sessions 20240417,20231027      # or --sessions @data/sessions_dev20.txt
python3 -m data.fetch --recompress --sessions 20240417  # re-apply thinning/encoding, no terminal reads
```

Per session, per root (SPXW, SPY, QQQ), for the first two expirations on/after the session (0DTE and the next —
where a root had no same-day expiry, e.g. QQQ on 2020 Mondays, these are later ones; check `s.expirations(root)`):

| file | what | resolution |
|---|---|---|
| `{R}_quotes` | NBBO (bid, ask, sizes) of every contract whose \|delta\| was in 0.10–0.60 at **any** minute of the session | 100 ms, state changes only: every price change kept, size-only changes at most one per second |
| `{R}_trades` | every OPRA print of the WHOLE chain of both expirations, with the NBBO in force (`trade_quote`) | tick |
| `{R}_greeks_1m` | delta, IV, underlying of the whole chain | 1 minute |
| `{R}_oi` | open interest (the morning report = prior close) | daily |
| `und_SPX_price` | SPX index | 1 s (its native print rate) |
| `und_{SPY,QQQ}_quotes`, `_trades` | stock NBBO / every trade | 100 ms changes / tick |
| `uw_alerts_{SPY,QQQ,SPX}`, `uw_gex_{SPY,QQQ,SPX}` | UW flow alerts; per-minute spot GEX | as sent (strings) |

Ints everywhere: option prices in cents, stock/index in 1/10000 $, `ms` = milliseconds since midnight ET.
**Timestamp semantics (verified, `validation/interval_semantics.py`):** a terminal interval row stamped T is the NBBO
in force at T (100% match against the tick tape, 3,601 1-s and 36,001 100-ms rows), so a quote change is seen at most
100 ms late and never early. Greeks rows: stamped at the minute; visible from the stamp (+`greeks_delay_ms`).
UW alerts: available at `created_at` (publication), NOT `start_time` (the first print inside, often hours earlier)
— `sim/feeds.py` stamps them correctly. UW history starts **2023-12-06** for this key (403 before); UW headlines
cannot be paged by date (EDGE-B: they start 2026-08-06, all inside LOCKED). Per-day GB: see the report table in
`BASELINES.md`/the hand-off; `_manifest.json` in each session has bytes, rows, contracts and timings.

Read:
```python
from data.store import Session, Contract, list_sessions
s = Session('20240417'); s.roots, s.expirations('SPXW')
c = s.contracts('SPXW', exp_index=0)[10]; q = s.quotes(c)      # numpy: ms, bid, ask, bs, as
s.greeks('SPXW'); s.trades('SPY'); s.underlying('SPX'); s.uw('alerts_SPY'); s.oi('QQQ')
```
Research code may read a Session directly (to describe data); **a strategy never does** — it gets only `ctx`.

## 2. Simulator

```python
from sim.engine import Engine, SimConfig, Strategy, clock
from sim.exits import VolBracket, TrailingVol, TimeStop, SignalDecay, FnExit, AnyOf

class MyIdea(Strategy):
    timer_ms = 1000                 # a 'timer' event each second (None = none)
    trade_roots = ('SPY',)          # every SPY option print as a 'trade' event (ev.data: contract, px, size, bid, ask, cond, exch)
    und_syms = ()                   # every underlying update as an 'und' event
    def on_event(self, ctx, ev):
        if ev.kind == 'trade' and ev.data['size'] >= 500 and ev.data['px'] >= ev.data['ask']:
            c = ctx.pick('SPY', 0, ev.data['contract'].right, 0.30)     # |delta| 0.15-0.50, spread <= 8% mid, size >= 1
            if c and not ctx.open_positions:
                ctx.buy(c, 1, exit=AnyOf(VolBracket(1.2, 0.8), TrailingVol(2.0), TimeStop(max_hold_s=1800)),
                        meta={'abs_delta': 0.30})
trades = Engine(Session('20240417'), MyIdea(), SimConfig(latency_ms=2000)).run()
```

Execution (protocol rule 2): decision at `ctx.now` -> order arrives `latency_ms` later (default 2000) -> buys at the
**ask in force at arrival**, sells at the **bid in force at arrival** (`fill_rule='next_change'` waits for the first
new quote instead); never a mid. Quantity capped at the displayed size (entry remainder cancelled unless
`entry_chase_ms`; exit remainder walks later quotes' bids). Fees `fee_per_contract` (0.65) per contract per side;
every trade has `pnl_gross`/`pnl_net`/`ret_gross`/`ret_net`. Optional `max_entry_spread_frac` rejects at arrival.
Exits run in event time: at every quote change of a held leg and every driving event; a triggered exit is an order
with the same latency. The session flat (`flat_ms`, 15:55) closes leftovers. Multi-leg packages: `ctx.buy([(c,1),(p,1)])`.

`ctx` (all reads are as of `ctx.now`; anything later raises `LookAheadError`): `quote(c)`, `quote_at(c, t<=now)`,
`quote_history(c, since)`, `chain(root, exp_index)` (latest greeks minute: contract, delta, iv, und), `delta(c)`,
`pick(...)`, `und(sym)`, `und_series(sym, window_s)`, `realized_vol(sym, window_s)` (per-second), `ext_history(kind)`,
`buy`, `close`, `open_positions`, `closed_trades`, `day`, `expirations(root)`.

External events (UW): `Engine(s, strat, cfg, ext_events=feeds.build(s, ['uw_alerts:SPY', 'uw_gex:SPX']))`.

Speed: exits whose components all have `scan()` (every built-in except `SignalDecay`/`FnExit`) are tested on whole
runs of quote changes with numpy (`tests/test_vector.py` proves the decisions, fills and MAE/MFE are identical to the
change-by-change path); a one-trade-per-root session runs in well under a second once loaded (~2–5 s to load a
session's quotes). Custom exits work everywhere, just change by change.

Exits (`sim/exits.py`): `VolBracket` (TP/SL = entry ± k × expected package move from realized vol and delta),
`TrailingVol` (peak − k × current vol-scaled move), `TimeStop` (hold or clock), `SignalDecay(fn, threshold)`,
`FnExit(fn)` (anything), `AnyOf(...)`, and `FixedBracket` (comparison only — not allowed as the sole exit).

Trade log fields: decision/entry/exit ms, entry bid/ask/size, prices, qty, reason, MAE/MFE (on the sellable bid
value, with times), hold_s, fees, gross/net P&L and returns, meta.

No look-ahead: the API clamps every read at now (tests: a peeking strategy never sees a stamp > now, `quote_at` the
future raises, greeks invisible before stamp+delay, an "insider" who fires 1 s before a jump fills after it).
The only way around is to bypass ctx; `python3 -m sim.lint file.py` refuses that (store/file/network imports,
private attributes, getattr/open/eval) and the blind scorer runs it on every frozen spec.

## 3. Evaluation

```python
from eval.metrics import summarize, passes_bar, pbo_cscv, deflated_sharpe, classify_session, ledger_trials, fmt_report
rep = summarize(trades_df, sessions=days, ret='ret_net', regimes=pd.DataFrame([classify_session(Session(d)) for d in days]))
print(fmt_report(rep)); passes_bar(rep, pbo=pbo_cscv(M)['pbo'])
```
- `summarize`: expectancy, median, win rate, payoff, session-clustered bootstrap 95% CIs (expectancy, win, $), Sharpe
  per trade and per day (zero-trade sessions count as 0), max drawdown ($ by day, return units by trade), DSR with the
  ledger's trial count (`ledger_trials()` parses `research-v2-ledger.md`: prior 155 + registered variants), by year
  and by day label (`classify_session`: high_vol if RV >= 25%, trend if |o→c| >= 0.6% closing in the outer quarter, else flat).
- `pbo_cscv(M)`: M = sessions × configurations (e.g. per-session mean return of every variant of a family).
- `passes_bar`: protocol rule 7 (CI>0, win >= 55% or expectancy >= 10%, DSR >= 0.95, PBO < 0.3, >= 150 trades, >= 2
  positive regimes).
- Nulls (`eval/nulls.py`, rule 11): `shuffled_runs` (same entry count and times — or resampled times — random side,
  same contract rule and exit), `synthetic_runs` on `synthetic_session(real, seed, iv_mode)` (zero-drift martingale at the
  real 5-minute RV profile, real contract set/spreads/sizes, BS prices at fair or real IV), and `pass_rates` (share of
  null runs passing; candidate's percentile; `valid_pipeline` requires <= 5%). Synthetic sessions carry no option
  prints/UW events: flow strategies use the shuffled null.

## 4. Frozen specs and the blind scorer (rule 12)
Copy `frozen/TEMPLATE.py` to `frozen/<ID>.py` (SPEC dict + `make_strategy(day)`), commit, then:
`python3 -m eval.score_frozen --spec frozen/<ID>.py --commit <hash> --split LOCKED`. It scores the file from the
commit (refuses if the working copy differs), lints it, runs every stored session of the split, prints numbers only
(net and gross), and appends the look to `v2data/locked_looks.jsonl`; a second LOCKED look is refused.

## 5. Validation and baselines
`python3 -m validation.compass_replay --fetch` -> `validation/COMPASS_REPLAY.md`;
`python3 -m baselines.run` -> `baselines/BASELINES.md`. `python3 -m tests.run` -> all tests (29).

- Replay of 39 recorded Compass calls (2026-10-29 live record, 2026-11-04 replay): recorded fill bid/ask = the store's
  NBBO in force at the fill instant 39/39; recorded exits = the bid in force 35/39, the other 4 are take-profits
  booked at their resting 1.50x limit with the bid at/through it; the engine reproduces 35/39 exactly (the 4 again).
  A 2-second order at the mark pays a median +0.96% more than Compass's paper fill (range −19% to +29%).
- Baselines (20 DEV sessions, net of costs): B1 random side −15.9%/trade, B2 open straddle +10.6% [−9, +30] (event-
  rich sample), B3 first-15-min side +1.0%; 245 null runs, 0 pass the bar. Details in `baselines/BASELINES.md`.

## 6. Data available (measured: `data/DEPTH.md`, `data/SIZES.md`)
- Option NBBO tick + OPRA trades: SPY/QQQ from 2012-06, SPXW from 2014 (none in 2012). 1-minute greeks: QQQ from
  2012, SPXW ~2018, SPY ~2020 (compute your own before). Stock NBBO/trades: QQQ 2012-06, SPY 2017-01. SPX index 2017.
  Daily same-day expiries: SPXW from 2022 (M/W/F before), SPY/QQQ late 2022 — the store's "0DTE" is the first
  expiry on/after the session (`s.expirations(root)` says which).
- UW: flow alerts and per-minute spot GEX from 2023-12-06 (so only DEV 2023-12..2024-12 has them); daily greek
  exposure: last ~250 days only; headlines: no date paging (from 2026-08-06, all LOCKED). No SPX/SPXW alerts under
  those tickers.
- Store: 20 sessions = 1.84 GB, mean 92 MB/session (median 86, max 195 on 2022-01-24), ~7 min a session to fetch at
  2 requests in flight; same-day option quotes are ~25 MB of it. Full tick NBBO would be ~10x the quote bytes.
