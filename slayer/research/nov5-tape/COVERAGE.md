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
| SPXW 0DTE 1-second NBBO (with displayed sizes) | 1 s | **262 contracts: every strike 7100-7750, calls and puts** (the day's whole range 7350-7681 +-3%), full session |
| SPXW 0DTE tick prints with the NBBO in force | tick | 1,745,365 prints, 4.53 M contracts, strikes 7100-7750 (96% of the day's 4.7 M volume) |

## What is missing / how it was handled (2026-11-05)
- **The 1-second and tick stores of 2026-11-05 were built late.** From 07:15 to ~09:30 UTC on 2026-11-06 the terminal
  answered "No data" to every sub-minute read of that day's options (1 s / tick quotes, `trade`, `trade_quote`), while
  1-minute aggregates answered. The first study pass (pre-registration, in-sample rule shaping) therefore used the
  **1-minute board** (the NBBO in force at each minute stamp). The store answered from ~09:33 UTC; the 1-second NBBO and
  ticks for 7100-7750 were then fetched and the ceiling, the timeline and the in-sample rule results were re-run on
  them (the rules themselves read only 1-minute inputs and were not changed). Contracts outside 7100-7750 (deep ITM /
  far OTM) stay on the 1-minute board in the ceiling (`res` column).
- Aggressor side: from the tick prints (print at/above the ask = bought, at/below the bid = sold) inside 7100-7750; the
  1-minute OHLC volume covers the rest of the chain unsigned.
- OI is a once-a-day report (the morning file = the prior close): intraday "OI change" is not observable; volume is.
- Futures (ES) overnight; dark pool; UW per-minute vendor GEX for SPX history (the app's own recorder has SPX vendor
  rows per minute, used only as a cross-check).
- Flow/headlines for 2026-11-04: the recorder started on 2026-11-05.
- 2026-11-04 (first out-of-sample day): 1-minute chain, OI, prior EOD, index 1 s; 1-second paths were fetched only for
  the contracts a rule picked (none: no rule triggered).

## Terminal behaviour worth knowing
- Wildcard (`strike=*`) chain reads are cut off after ~30 s and come back silently truncated (60 of 259 strikes): the
  fetcher reads one strike and right at a time and checks the row count (391 one-minute rows).
- Under load the terminal answers "No data" spuriously (seen: 1 in 3 reads of strikes that have data). The fetcher only
  believes "No data" on the last of 4 passes; 2026-11-05 needed 4 passes (295 -> 131 -> 100 -> 0 deferred).
