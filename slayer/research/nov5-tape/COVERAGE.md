# NOV5 data coverage: 2026-11-05 (and 2026-11-04)

Generated tables: `results/COVERAGE_20261105.md` (`coverage.py`). Raw data: `v2data/nov5-tape/<YYYYMMDD>/` (not committed).

## What is there
| item | resolution | coverage on 2026-11-05 |
|---|---|---|
| SPX index | 1 s | 09:30:01-16:00:00, 23,400 prints (open 7678.72, high 7681.29 at 09:30:17, low 7350.35 at 15:59:19, close 7354.64) |
| VIX | 1 s | 09:30-16:00 (17.07 -> 28.09 high -> 27.59) |
| VIX1D, VIX9D, VIX3M | 1 min | from 09:32 (the index prints start then) |
| SPY NBBO | 1 s | full session (the ES proxy; futures are not in the ThetaData feed) |
| SPXW 0DTE, the whole listed chain | 1 min NBBO (quote in force at each minute stamp) + delta, vega, theta, IV | **all 518 contracts** of the listed chain (259 strikes x 2; 3200-10000), 202,538 rows |
| SPXW 0DTE volume | 1 min OHLC, volume, trade count, VWAP | 423 contracts that traded; 4.7 million contracts on the day |
| SPXW next expiry (2026-11-06) | 1 min NBBO + greeks | strikes within the day's range +-1.5% (term structure, 1DTE ATM IV) |
| SPXW open interest | morning report (= the 2026-11-04 close), stamped 06:30 ET | every expiry (39), 19,232 rows; 0DTE 371,252 contracts |
| SPX AM monthlies OI + prior EOD greeks (SPXW, SPX) | daily | the gamma book's other expiries (IV, gamma) |
| Rebuilt gamma book (flip, net, walls, FRONT cut) | 1 min, 09:46-15:59 | `book_nov.py` (EDGE-G's audited port of core/gammaFlip.ts, flipLevel.ts, core/walls.ts, core/settle.ts; parity PASS in EDGE-G) |
| UW flow alerts | as published (`created_at`) | 67,035 alerts on the ET day; SPXW 1,448 in RTH. Recorder up from ~09:06 ET (its first poll back-filled 200) |
| UW headlines | as published | 1,026 unique; from 09:06 ET (Hormuz tankers on fire 09:09 and 09:23; "Nasdaq 100 extends decline to 3%" 09:48; Arm/Qualcomm chip sell-off; "risk of renewed war with Iran eased" 11:29; MOC imbalance +$508M 15:51) |
| Live scanner | ~1 min | 387 chain / ctx / under snapshots, movers.jsonl |
| Compass scored rows | every 5 min 09:45-16:10 | 9,332 SPXW rows, 74 marks, p1 per contract |

## What is missing (2026-11-05)
- **1-second NBBO and tick prints of the 2026-11-05 SPXW chain.** At study time (2026-11-06 07:15-…) the terminal answered
  "No data" to every sub-minute read of that day's options (1 s / 100 ms / tick quotes, `trade`, `trade_quote`; also for
  the 2026-11-06 expiry on 2026-11-05), while 1-minute aggregates (greeks, OHLC) and the index/stock 1-second data
  answered. 2026-11-04 (two days back) answers at 1 s and tick. So the 2026-11-05 store was not built yet; the fetcher
  probes and fills it when it is (`fetch_tape.py probe`, `drive_c.sh`). Until then every 2026-11-05 option number here is
  on the **1-minute board** (the NBBO in force at each minute stamp), labelled `1m`: it misses sub-minute extremes, so
  the ceiling is a lower bound of the true 1-second ceiling, and "+2 s" fills are the minute's quote.
- Aggressor side of prints (no `trade_quote`): option premium flow by strike is volume x VWAP from the 1-minute OHLC,
  not buy/sell-signed. UW alerts carry their own ask-side / bid-side premium.
- Futures (ES) overnight; dark pool; UW per-minute vendor GEX for SPX history (the app's own recorder has SPX vendor
  rows per minute, used only as a cross-check).
- Flow/headlines for 2026-11-04: the recorder started on 2026-11-05.

## Terminal behaviour worth knowing
- Wildcard (`strike=*`) chain reads are cut off after ~30 s and come back silently truncated (60 of 259 strikes): the
  fetcher reads one strike and right at a time and checks the row count (391 one-minute rows).
- Under load the terminal answers "No data" spuriously (seen: 1 in 3 reads of strikes that have data). The fetcher only
  believes "No data" on the last of 4 passes; 2026-11-05 needed 4 passes (295 -> 131 -> 100 -> 0 deferred).
