# NOV6 / nov5-broad data coverage

Raw data: `/home/user/falcon-cloud-field-sail/v2data/nov5-broad/<YYYYMMDD>/<ROOT>/` (not committed; SPXW of
2026-11-04/05 is read from nov5-tape's store `v2data/nov5-tape/<D>/`). Fetcher: `fetch_broad.py` (resumable, atomic,
one request in flight per process). Validation: `quality.py` -> `results/QUALITY_<D>.md`.

## Study day 2026-11-05 (Thursday, SPX -4.2%)

Roots: the index roots SPXW, SPY, QQQ, IWM (0DTE + the 11-06 weekly) and the five single names among Compass's 20 roots
with the largest option volume that day by the terminal's EOD report summed over every expiry (`roots_volume.py`,
`results/ROOTS_20261105.md`): **NVDA 5.34M, TSLA 2.32M, AAPL 1.48M, AMZN 0.95M, META 0.67M** contracts (then GOOGL 0.66M,
MSFT 0.57M, AVGO 0.53M). Names have no 11-05 expiry: their nearest weekly (2026-11-06, 1DTE) is the traded expiry.

| item | resolution | coverage |
|---|---|---|
| SPX index, VIX | 1 s | full session (nov5-tape) |
| VIX1D/VIX9D/VIX3M, VXN, RVX | 1 min | from 09:30-09:32 |
| SPY / QQQ / IWM / names underlying | 1-second NBBO | full session |
| 1-minute board (NBBO in force at the stamp + delta, vega, theta, IV) | 1 min | every listed contract of the first expiry (SPY 402, QQQ 220, IWM 90 contracts 0DTE; NVDA 178, TSLA 290, AAPL 158, AMZN 134, META 448 weekly); next expiry for SPY/QQQ/IWM; SPXW 518 (nov5-tape) |
| 1-minute OHLC volume | 1 min | the same contracts |
| open interest | morning report (= prior close) | every expiry |
| 1-second NBBO with displayed sizes | 1 s | every traded first-expiry contract within the day's range +-3% (names +-4%): SPXW 262, SPY 156, QQQ 118, IWM 56, NVDA 22, TSLA 52, AAPL 32, AMZN 34, META 80 |
| tick prints with the NBBO in force | tick | the same contracts: SPXW 1.75M prints, SPY 1.86M, QQQ 1.25M, IWM 0.22M, NVDA 0.19M, TSLA 0.24M, AAPL 0.15M, AMZN 0.09M, META 0.06M |
| gamma book (flip, walls) | 1 min | SPXW only, nov5-tape's `book_nov.py` (EDGE-G parity); not rebuilt for the other roots (dead family, used as description only) |
| UW flow alerts | as published (`created_at`) | v2data/live/flow-2026-11-05.jsonl.gz: SPY 20,022, QQQ 12,871, NVDA 2,766, IWM 1,505, TSLA 1,502, SPXW 1,495, AAPL 1,094, AMZN 659 alerts |
| UW headlines | as published | 1,026 unique (recorder from 09:06 ET); UW tags every one "neutral": the sentiment field is useless |
| Compass rows | every 5 min | 78,852 scored rows over 23 roots (description only) |

## Validation (results/QUALITY_20261105.md)
- **1-minute vs 1-second parity: 0 mismatches** in 298,000 board rows (the board row stamped m equals the 1-second
  NBBO in force at 60 m, every root). The vendor lag seen on Friday 09:35-10:15 does not appear in Thursday's store.
- **Prints vs the 1-second NBBO**: outside the band of the quotes in force at seconds s-1..s+1 by more than $0.05:
  SPY 0.13%, QQQ 0.27%, IWM 0.01%, names 0.01-0.07%, SPXW 3.0% (SPX complex/multi-leg prints; the 1-second snapshot
  cannot resolve SPXW's sub-second quote changes). Against the single second in force: SPY 4.1%, QQQ 6.8%: the 1-second
  grid, not stale data.
- **Frozen 1-minute rows** (same bid/ask on >= 5 stamps while |delta| x |S move| > spread + 2 ticks): SPXW 10,928 rows
  (170 contracts, far wings), SPY 1,219, QQQ 1,300, IWM 146, names 5-734. Dropped from every 1-minute read.
- **Stale 1-second stretches** (NBBO unchanged >= 30 s while |delta| x the underlying's excursion > spread + 2 ticks;
  every second after the first 10 dropped from fills): SPXW 502,915 contract-seconds (147 contracts), SPY 270,008 (74),
  QQQ 125,970 (50), IWM 27,224, names 2,813-22,944. Mostly far-OTM $0.01-0.05 quotes pinned at the minimum tick
  (conservative: they are excluded even where the pin is legitimate).

## Out-of-sample days (fetched after PREREG.md was committed, same code, same checks)
| day | roots | 1-second contracts | prints | parity | prints outside the 1-s band | notes |
|---|---|---|---|---|---|---|
| Wed 2026-11-04 | SPY, QQQ, IWM (0DTE), names (11-06 weekly, 2DTE); SPXW 1-minute board from nov5-tape, 1-second paths fetched per pick | SPY 106, QQQ 110, IWM 47, names 20-56 | 3.1M | 0 mismatches | 0.00-0.15% | no flow / headline recorder yet (R4, R5 untestable) |
| Fri 2026-11-06 | all 9 (SPXW 0DTE board read strike by strike within +-8% of the open: the wildcard read truncates) | SPXW 206, SPY 100, QQQ 100, IWM 48, names 20-54 | 4.7M | 0 mismatches | 0.00-0.15% (SPXW 2.1%) | the terminal refuses expiration=* OI on its current day: OI read expiry by expiry |

**The Friday vendor lag is not in the history store.** `lagcheck.py` (results/LAG_20261106.md) cross-correlates
10-second changes of the ATM option mid with the underlying at lags -60..+600 s: the best lag is 0 s on SPXW, SPY,
QQQ and NVDA in 09:35-10:15, 11:00-12:00 and 14:00-15:00 (|corr| 0.91-0.98). Frozen 1-minute rows on 11-06 (SPY
1,219 rows / 68 contracts, SPXW 5,615 / 152) are no more frequent than on 11-05 and are dropped the same way.

Disk: v2data/nov5-broad holds the three days, the DEV path cache (q1s_dev), the vol-index minutes and the results
(see the final report for the size); free space never went below 3.5 GB.
