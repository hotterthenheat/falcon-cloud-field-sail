# EDGE0DTE registry addendum 2 (2026-11-07): structure concepts, market-maker logic, and Compass itself

Written and committed BEFORE any Stage-1 outcome exists. REGISTRY.md, ADDENDUM 1 and PROTOCOL.md are unchanged. Owner
(2026-11-07): "before we forward test I need you to ensure it works on backtested models and it needs to win and be
proved to be an edge … you can add concepts like liquidity sweeps, order blocks, fair value gaps, market structure
(BOS/CHoCH), GEX and dealer hedging concentration; think like a market maker … do what's best and makes us money."

Already registered (no duplicates added): liquidity sweep = F5; break of structure (BOS) = F2; change of character
(CHoCH) = F3 (structure shift); market structure = F1; GEX = A1-A7; dealer hedging = E1-E4; gamma concentration = A5.

All rows use the conventions of REGISTRY.md (5-minute bars, swing definition of section F, sigma_h, Z, V, horizons
15/30/60/close, one primary parameter set P, grid G for sensitivity only) and run on U1 and U2 per ADDENDUM 1.

## F (continued): price-delivery concepts

| id | feature | mechanism | outcome, sign | P / G |
|---|---|---|---|---|
| F7 | order block: the last opposite-colour 5-min bar before a displacement (F4) that breaks structure (F2); event = first return of price into that bar's body | resting institutional orders left at the origin of a forced move are filled on the retest | Z away from the block (in the displacement's direction) > 0 at h = 15, 30 | P body, first retest only; G wick range, first two retests |
| F8 | fair value gap: 3 consecutive 5-min bars where bar1.high < bar3.low (bullish) or bar1.low > bar3.high (bearish), gap >= 0.25 sigma_15; event = first trade back into the gap | one-sided delivery leaves unfilled liquidity; a return is either a rebalance (continuation) or a failure | Z in the gap's original direction > 0 at h = 15, 30 | P 0.25 sigma_15; G 0.1, 0.5 |
| F9 | inverse FVG: price closes through an F8 gap against its direction | the gap failed: trapped participants exit | Z in the closing direction > 0 at h = 15, 30 | P 5-min close through; G wick through |

## M: market-maker logic (earn the spread and the premium; do not pay them)

A market maker's edge is structural: they collect the bid-ask spread and the variance premium and hedge the rest. A
member pays the spread on every market order. These rows test whether a member can capture part of that structure with
passive orders, under a fill model that cannot flatter itself.

FILL MODEL for every M row (fixed now): a resting limit order at price p is filled only when a later print on that
contract trades at or through p (strictly through for a sell at the ask side, i.e. a print >= p for a sell, <= p for a
buy) AND the cumulative printed size at or through p since the order was placed exceeds the displayed size ahead of it
at placement (queue position = displayed size at that price when placed). Unfilled orders are cancelled at the time
stop; an unfilled leg of a package means the package is not opened (no legging risk assumed away). Exits use the same
passive model first, then cross the spread at the time stop. Fees $0.65 per contract per side per leg.

| id | trade | mechanism | outcome, sign | P / G |
|---|---|---|---|---|
| M1 | sell a defined-risk iron fly (ATM short straddle + wings at +/- 1 sigma_close) at 10:00 using passive limits at mid, hold to 15:50 or a stop at 2x credit | variance premium (realized/implied ~0.91 measured) plus capturing half the spread instead of paying it | net P&L per trade > 0 | P 0DTE; G 1DTE, 7DTE |
| M2 | M1 only when the D4/A5 state predicts V < 1 (IV/RV top tercile AND gamma concentration top tercile) | sell premium only when it is richest and pinning is strongest | net P&L > M1's unconditional net P&L | P as stated; G each condition alone |
| M3 | passive long option entries: Compass/registry long signals executed with a resting bid at mid instead of lifting the ask (same fill model; unfilled = no trade) | stop paying half the spread on entry; the cost of missed fills is measured, not assumed away | net expectancy of the same signal: passive vs aggressive, difference > 0 | P mid; G mid - 1 tick, bid |

## C: Compass's own models (backtest before any forward test)

| id | test | note |
|---|---|---|
| CMP1 | Compass Model 1 (book A, the shipped trees and their call rule) replayed on DISCOVERY and CALIBRATION with the app's own feature builder on historical bars and quotes, real 1-second fills, Compass's exits | the trees were trained on 2026-06-29..2026-10-02 (LOCKED period), so 2020-2025 is out of sample in time; any feature that cannot be rebuilt from history is listed and the test is reported as partial |
| CMP2 | Compass Model 3 (late sweep) replayed the same way | |
| CMP3 | CMP1 and CMP2 with the cost-aware contract choice (compassCost.ts) instead of the score rule | |
| CMP4 | CMP1-CMP3 with the fixed price/spread limits removed (per the owner's 2026-11-07 decision) | |
Each CMP row is judged by PROTOCOL.md section 7 (all eight criteria) against the section 6 baselines, with its trades
added to the deflated-Sharpe trial count. A Compass model that fails is reported as failed; the forward test then runs
as a labelled measurement, not as a recommendation.

## Counting
F7-F9 join the Stage-1 FDR family of their universe. M1-M3 and CMP1-CMP4 are Stage-2 executable tests (they are trades,
not information signals) and add to the trial count; their grids are sensitivity only.
