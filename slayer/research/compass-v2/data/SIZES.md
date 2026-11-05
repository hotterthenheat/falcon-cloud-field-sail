# Store size per session

4 sessions, total 0.42 GB; per session median 99 MB, mean 106 MB, max 166 MB (fetch 425 s median at 2 requests in flight).
Projection: all ~1,000 DEV sessions 2020-2024 x 3 roots at the mean = 106 GB; Of which same-day (0DTE) option quotes: mean 27 MB/session (the 1DTE/next-expiry quotes, the whole-chain prints, greeks, underlying and UW are the rest).
Full tick NBBO instead of the 100 ms rule is ~10x the quote bytes (busy ATM SPXW contract, 2024-08-05: 4.29 MB vs 0.44 MB, both delta-encoded zstd).

| session | MB | fetch s | SPXW contracts | SPXW MB | SPXW exps | SPY contracts | SPY MB | SPY exps | QQQ contracts | QQQ MB | QQQ exps | 0DTE quote MB | und MB | uw MB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 20200224 | 60.4 | 322.5 | 109 | 20.7 | 0224,0226 | 56 | 14.1 | 0224,0226 | 99 | 20.6 | 0228,0306 | 9.6 | 5.1 | 0.0 |
| 20200316 | 166.2 | 623.6 | 274 | 65.7 | 0316,0318 | 187 | 57.4 | 0316,0318 | 167 | 33.3 | 0320,0327 | 41.8 | 9.8 | 0.0 |
| 20200612 | 117.8 | 477.1 | 174 | 50.0 | 0612,0615 | 104 | 36.3 | 0612,0615 | 125 | 25.2 | 0612,0619 | 32.7 | 6.3 | 0.0 |
| 20240417 | 80.1 | 372.0 | 115 | 37.5 | 0417,0418 | 58 | 20.2 | 0417,0418 | 62 | 16.9 | 0417,0418 | 22.3 | 9.2 | 0.2 |
