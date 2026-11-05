# Nov 4 research log (worker RS, 2026-11-05)

Question (owner): Wed 2026-11-04's blotter was horrible while the review showed many amazing trades. How do we find them?

## Data and code
- `fetch.py`: ThetaData terminal, per session and root: 0DTE chain (strike_range 16) and the nearest 1-7 weekday expiry
  (strike_range 17) for Compass's two sleeves (0DTE book of that weekday: 11 daily roots, + the MWF stocks/ETFs, + USO/UNG
  W/F; weekly: the 20 GEX_CORE roots), 1-minute NBBO + 1-minute OHLC/volume 09:30-16:00, open interest on the date
  and the session before, the underlying's 1-minute bars. One request in flight (the replay held two). Cache:
  the session scratchpad (`NOV4_DATA`), not committed.
- `features.py`: every enterable contract-mark (5-minute marks 09:35-15:00; spread gate bid > 0.15 and spread/mid
  <= 8%; fill = the ask at the next minute), its outcome, and its pre-entry signature (only data stamped <= the mark).
- `study.py` (describe / auc / rules), `variants.py` (dev-only variants), `signature.py` (amazing vs all vs Compass).
- `replay/2026-11-04.json`: `scripts/compass-replay.ts 2026-11-04` with the current code (REPLAY_CONC=2), from
  20:15 ET on Nov 3 to 15:05 plus the 15:20 Late sweep. `replay/table.txt`: the replay's own table and checks.

## Outcome definition (all tests)
Win = the bid reaches 1.5x the fill (ask at mark+1 minute) before it falls to 0.4678x; return +50% on a win, the bid
at the stop minute / fill - 1 on a stop, the 15:55 bid / fill - 1 otherwise. One-minute NBBO only (no 1-second
refinement: a stop or target touched and reversed inside a minute is missed both ways). No fees.

## Overfitting control: every look counted
Development = Nov 4, Nov 3, Nov 2 only. Holdout = Oct 15, 16, 19-23, 26-30 (12 sessions), never looked at before
the rules were frozen.
1. 50: quintile scans of 25 features x 2 sleeves (0DTE, weekly), |delta| 0.10-0.50, dev only.
2. 50: within (day, right) AUC of the same 25 features x 2 sleeves, dev only (to strip the put/call direction of
   the dev week out: contract IV / ATM IV looked strong only because it is the put side).
3. 4: first rule set R1-R4 on dev.
4. 8: variants (`variants.py`) on dev. Frozen: R1 = R1b, R2 = R2b, R3 = original, R4 = R4b.
Total before the holdout: 112 looks. Holdout: 4 frozen rules, scored once (+ the baselines, which choose nothing).

## Results

### The replay (current code) and a terminal outage
The replay ran 20:15 Nov 3 -> 15:05 (227 marks, 8,364 reads). From about 05:15 UTC on Nov 5 the terminal stopped
answering any Nov 4 option read (`/option/at_time/quote` and `/option/history/quote` both 472 "No data found"; Oct
sessions still answer): ThetaData's overnight rebuild of the prior session, it seems. So every mark from 10:25 read
"none", the 15:20 Late sweep read nothing, and 3 calls fired at 10:05 (GLD 370C 11-05, RUTW 2850C 11-05, TSLA 380C
11-06) could not settle. `replay/2026-11-04.partial.json` keeps that run; `blotter_partial.txt` is its table.
32 calls, all Model 1 (Hit, Book A), all fired 09:45-10:05; 29 settled: 10 won, 19 lost, +$8,942 total, of which one
NDXP 28440C made +$12,020 (without it: -$3,078). No Model 2 (Book B) or Model 3 (Late sweep) call in what ran.

### Amazing trades, Nov 4 (`amazing_2026-11-04.txt`, `signature_2026-11-04.txt`)
93,204 enterable contract-marks on 2,190 contracts (0DTE + weekly, both sleeves' strike bands). Base: 14% of
contract-marks win (1.5x before the stop), mean -8.7%. Contracts that ran from some enterable ask: >= 1.5x 1,222;
>= 2x 805; >= 5x 98 (all 0DTE). 88% of the >= 1.5x first entries were 09:35-10:30. Signature of the >= 2x entries
against Compass's 32 calls (medians, side-signed, data <= the mark): |delta| 0.29 vs 0.67; ask $2.28 vs $5.77;
premium / expected move 0.19 vs 0.68; underlying since the open -0.62% (against the contract) vs +1.08% (with it);
position in the day's range 0.12 vs 0.79; vs VWAP -0.31% vs +0.78%; chain net aggressive premium +0.04 vs -0.09;
RV/IV 1.7 vs 2.1. Compass bought the extended side near the top of the opening move; the runners were the cheap
beaten side near the low, after a violent open, as the tape turned.

### Development (Nov 2-4, `dev.txt`)
Per contract-mark AUCs within (day, right): the only features above 0.5 on all six day-right cells for 0DTE were the
chain's net aggressive premium on the contract's side (0.53-0.62) and, weakly, the contract's prints vs the mid.
Weekly: realised/implied (0.48-0.90), early marks. Frozen rules, dev: R1 63% (n 43), R2 48% (31), R3 43% (44),
R4 62% (21).

### Holdout (12 sessions Oct 15-30, scored once, `holdout.txt`)
| rule | n | win [Wilson 95%] | win [session bootstrap] | return/call [session bootstrap] |
|---|---|---|---|---|
| random 0.20-0.45 delta 0DTE, one a root a day | ~198 | 40% (draws 34-46%) | | -14.0% |
| random weekly, one a root a day | ~235 | 26% (21-31%) | | -7.5% |
| R1 flow-aligned 0DTE | 181 | 45% [38, 52] | [39, 52] | -9.2% [-15.1, -0.9] |
| R2 hot-tape weekly | 147 | 37% [29, 45] | [24, 49] | -10.2% [-22.2, +1.2] |
| R3 gamma-flip side 0DTE | 170 | 40% [33, 48] | [29, 49] | -14.2% [-25.9, -3.9] |
| R4 opening reversal 0DTE | 70 | 59% [47, 69] | [37, 77] | +6.2% [-15.8, +25.3] |

R4's calls won 75% (n 40) and its puts 37% (n 30): October drifted up, so most of R4's edge here is "buy calls on an
opening dip in an up-trending month". Not shown to be an edge; R1-R3 add nothing over a random pick.

### To finish the blotter (once the terminal serves Nov 4 again; still 472 at 06:12 UTC Nov 5)
No call fired before 09:45 in the full run, so the regular session alone gives the same seats:
`REPLAY_OUT=<abs>/research/nov4/replay REPLAY_CONC=3 REPLAY_FROM=09:30 npx tsx scripts/compass-replay.ts 2026-11-04`
(~70 min). Check its calls up to 10:20 equal the partial file's 32, then read the 10:25-15:05 calls and the Late sweep.
By 10:20 the partial run held 19 of 29 0DTE seats and 13 of 20 weekly seats; 29 of the 32 calls were calls (C).
