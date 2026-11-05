# K5 red team — the look-ahead, traced line by line

Candidate: `research/challenger/candidates.py::k5_overnight_spx_hard` on the rows `build.ts` writes; locked result
`blind/results/K5-LOCKED.json` (n=59, 88.1%, +41.7%) and `K5-LOCKED-exec.json` (76.3%, +34.4% net).

## Where the future enters

1. `build.ts` keeps a row only if `r.gates.entryOk && (r.gates.aGate || r.gates.bGate)` (line 71). So the candidate
   universe K5 scores is **the engine's Book A/B gate output**, not the chain.
2. `compassModel.scoreBook` (lines ~1259-1272): `day = sessionYmd(now)`; `book.set(name, await loadBars(name, day, true, need))`
   with `need = undefined` on the replay's late path. `loadBars` asks the host for `/index/history/ohlc?...start_date=day&end_date=day`.
   In the replay the host is `research/challenger/localHost.ts`, which answers from the bulk cache with **every 1-minute
   bar of day D**, including the 09:30 open, for a mark at 03:00 of day D.
3. `compassFeatures.tapeOf(rows, index, minute, spot)` (lines 141-165): for a pre-open mark `tt = minute - 570 < 0`, so
   `last = 0` and `S = o[0]` = **the 09:30 open of day D** (the fallback to `spot` is reached only when `o[0]` is
   missing). `op = o[0]` too, hence `retOpen = S/op - 1 = 0` — **every overnight row in the cache has `retOpen == 0`
   exactly** (59/59 locked calls; all 252 locked sessions; 25/25 development sessions checked).
4. `scoreBook` line ~1424-1430: `distRow = strikeDistance(strikes, tape.S, s.strike)`; `aGate = bookAPass(..., distRow, spanRow=4 for an index, ...)`
   → `dist <= span` keeps only strikes within **4 strikes (20 SPX points) of the ATM strike at the next morning's open**.
   `bGate` (Book B) uses the same `dist`. Nothing else about the row is wrong: `c33` (the overnight move vs the prior
   close) and `c14` (|delta|) are computed by `challengerFeatures` from the put-call-parity spot at the mark; the fill is
   the ask one minute later; the exit path is after the fill.
5. Consequence for K5: a contract at |delta| 0.10-0.20 against the 03:00 spot is 30-80 SPX points out of the money.
   It is in the universe only if its strike is within 20 points of where SPX will open at 09:30. So a K5 call exists
   only on nights where the index travels ~45 points toward the strike before the open, i.e. the option is about to
   become near-ATM. Measured on the 59 locked calls: median |strike - spot at the mark| 43.8 pts, median |strike - open|
   17.6 pts, and in **59/59** the open lies on the strike's side of the mark spot (`a1_lookahead_calls.csv`).
6. ThetaData's `strike_range=16` in `fetch.ts` is also centred on the day's open (checked: 2022-06-03 band 4060-4215,
   open 4137.57; 2026-10-07 band 7595-7990, open 7792.98), a second, weaker leak of the same sign.

## Results of the nine attacks (numbers; scripts beside this file, logs `k5_honest.log`, `k5_honest_report.log`)

| # | Attack | Result |
|---|---|---|
| 1 | Look-ahead | BROKEN. Rebuilt from a ±40-strike chain (253 nights, `v2data/redteam/chain1m`, 87 MB): future-open gate n=64, 82.8%, +36.3% (same 59 days as the locked set); gate from the spot at the mark n=2, both stopped; no gate (the spec's rule on the real chain) n=252, win 40.1% [34.1, 46.4], −7.7%/trade [−13.7, −1.5]. |
| 2 | Fill realism | Survived. Spread at fill median $0.20 (4.1% of fill), 95th $0.50 (7.6%); displayed ask size median 29 (min 1); 0 locked / 0 crossed in 649k state changes; ask stale > 60 s at entry 5/59; min of next 5 asks ≤ fill on 58/59. |
| 3 | Survivorship | BROKEN. Called nights: \|open − S(00:00)\| median 25.7 pts vs 9.1 uncalled; gap vs prior close 32 vs 14; 64/64 the open moved toward the strike; no post-open trend difference (27.6 vs 31.6 pts). |
| 4 | Regime luck (exec net) | Weakened: drop top 3 → +32.2%; 2024+2025 only (n=14) +22.5% [−0.2, +42.9]; high-IV tercile +20.7% [−1.3, +40.0]; 2024 n=5 −17.8%; 00:xx marks +21.4% [−0.2, +41.1]. |
| 5 | Multiple testing | As scored DSR 0.995 at N=156. CSCV over the 27-config neighbourhood with the leak: PBO 0.055, 27/27 positive (no cliff; the neighbourhood inherits the leak). Honest universe: 0/27 positive (−4.4 … −9.2%/session). |
| 6 | Data errors | Survived. Exchange code 5 on every overnight row, identical to 09:00–09:29 (Cboe-only product); 359/359 night minutes quoted; 00:00 row is a date-boundary ask=0 artefact; ≤15% frozen contracts (deep wings); 09:20 flat untouched by early closes. |
| 7 | Capacity | Weakened. One user: 5 contracts at the displayed ask on 57/59 nights, 10 on 54/59; 200 users × 1 contract exceeds displayed size on 59/59 nights. |
| 8 | Nulls | Leaked calls vs side-shuffle null: null 48.2% [37, 58] vs 83% (p < 0.001 — the leak). Honest rule vs its shuffle null: 41.8% vs 39.2%, p = 0.23; anti-signal −12.7%; both sides every night (n=441) −9.9% [−14.5, −5.3]; synthetic zero-drift: expected win 21%, ret −29%. |
| 9 | Theory | Not supported: on the honest universe the side of the move loses (−7.7%), the other side loses more (−12.7%), both lose (−9.9%); a 0.15Δ 0DTE bought after midnight is a net theta/spread payer. The 88% is explained entirely by a universe limited to strikes within 20 pts of where SPX will open. |

**Verdict: KILL.** The DEV 86% and the F2 family's PBO/DSR rest on the same rows. Pipeline fix (not a candidate):
`tapeOf` must not see day D's bars at a pre-open mark in the replay (truncate `loadBars` to bars ≤ now or use the parity
spot overnight), then rebuild the rows; every overnight-row result in `deliverables/compass-model4` (K2b, K4, K5, F2, M5)
is suspect until then.

## What a live engine would do

A live engine at 03:00 has no bars for day D: `tapeOf` falls back to `spot` (the quoted/parity spot). The row universe
the shadow would see is "within 4 strikes of the current ATM", which a 0.15-delta contract almost never satisfies
(`gate='spot'` in `k5_honest.py`): the live rule would make almost no calls, and the ones it made would not carry the
future open.
