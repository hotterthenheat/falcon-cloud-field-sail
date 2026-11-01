# TradingView built-in indicators, A to L

The list is TradingView's Help Center folder "Built-in indicators"
(tradingview.com/support/folders/43000587405), read on 2026-11-01. It runs from "1 year active supply %" to
"Linear Regression" for A to L. Each indicator's inputs, defaults and maths come from its help page and the Pine
reference for the `ta.*` it uses. We copied the behaviour only. No text, colours or artwork came from TradingView.

The new sources are in `src/data/builtinScriptsAL.ts`, and one line spreads them into `SOURCES`. The new `ta.*` calls
(`ta.cmo`, `ta.kc`, `ta.kcw`) are in `src/core/pine/taMoreAL.ts`, with two lines of wiring in `builtins.ts`. The proof
is `scripts/indicators-al-proof.ts` (in `npm test`). It has hand-worked values on a six-bar fixture, and checks every
series against an independent array version of the formula on a fixed 780-bar fixture.

The shelf groups use the shared union: Trend, Bands, Momentum, Volume, Volatility, Statistics. The library search
reads the title, the description and the group. The script legend (`ScriptLegend.tsx`, fed one ref from `StrikeChart.tsx`)
prints each drawn plot's value in its own ink, at the bar under the crosshair or else the last bar, the way the
built-ins' legend does.

## Added (35)

| TradingView name | Ours (slug) | Group | Defaults |
|---|---|---|---|
| 24-hour Volume | `volume-24h` | Volume | none. Sums the volume of chart bars that opened in the last 24 clock hours. TradingView sums 1-minute bars intraday, so the edge of the window is as fine as the chart's bars. |
| Accumulation Distribution (ADL) | `accumulation-distribution` | Volume | none |
| Advance/Decline Ratio (Bars) | `advance-decline-bars` | Statistics | length 9. A bar counts as up when close ≥ open. The ratio is up bars ÷ down bars, or the up count when there are no down bars. |
| Arnaud Legoux Moving Average | `alma` | Trend | window 9, offset 0.85, sigma 6, close |
| Aroon Indicator | `aroon` | Momentum | length 14 |
| Aroon Oscillator | `aroon-oscillator` | Momentum | length 14 |
| Average Daily Range (ADR) | `average-daily-range` | Volatility | length 14. On intraday charts it averages the ranges of the last N **finished** sessions. On daily and longer charts it is SMA(high − low). |
| Awesome Oscillator (AO) | `awesome-oscillator` | Momentum | 5 / 34 on hl2 |
| Balance of Power (BOP) | `balance-of-power` | Momentum | none |
| BBTrend | `bbtrend` | Bands | short 20, long 50, StdDev 2 |
| Bollinger Bands %b | `bb-percent-b` | Bands | 20, close, 2 |
| Bollinger BandWidth (BBW) | `bb-width` | Volatility | 20, close, 2. Shown ×100. Highest expansion and lowest contraction both look back 125 bars. |
| Bull Bear Power | `bull-bear-power` | Momentum | length 13 |
| Chaikin Money Flow (CMF) | `cmf` | Volume | length 20 |
| Chaikin Oscillator | `chaikin-oscillator` | Volume | fast 3, slow 10 |
| Chande Kroll Stop | `chande-kroll-stop` | Trend | p 10, x 1, q 9 |
| Chande Momentum Oscillator (CMO) | `chande-momentum` | Momentum | length 9, close |
| Chandelier Exit | `chandelier-exit` | Trend | length 22, ATR 22, multiplier 3 |
| Chop Zone | `chop-zone` | Momentum | none (34 EMA angle, 30-bar range) |
| Choppiness Index (CHOP) | `choppiness` | Volatility | length 14, offset 0, bands at 61.8 and 38.2 |
| Connors RSI (CRSI) | `connors-rsi` | Momentum | RSI 3, up/down 2, ROC rank 100 |
| Coppock Curve | `coppock-curve` | Momentum | WMA 10, long ROC 14, short ROC 11 |
| Detrended Price Oscillator (DPO) | `dpo` | Momentum | length 21, not centred (back-shift 11) |
| Double Exponential Moving Average | `dema` | Trend | length 9 |
| Ease of Movement (EOM) | `ease-of-movement` | Volume | length 14, divisor 10000 |
| Elder's Force Index (EFI) | `elder-force-index` | Volume | length 13 |
| Envelope (ENV) | `envelope` | Bands | length 20, 10 %, close, simple |
| Exponential Moving Average | `ema` | Trend | length 9, close, offset 0. Smoothing is off by default and can be SMA, SMA + BB, EMA, RMA, WMA or VWMA, length 14, BB 2. |
| Fisher Transform | `fisher-transform` | Momentum | length 9. Lines at ±1.5, ±0.75 and 0. |
| Historical Volatility | `historical-volatility` | Volatility | length 10. Annualised by √365 intraday and daily, √(365/7) otherwise, as TradingView does. |
| Hull Moving Average | `hull-ma` | Trend | length 9 |
| Kaufman's Adaptive Moving Average (KAMA) | `kama` | Trend | length 14, fast 2, slow 30 |
| Klinger Oscillator | `klinger` | Volume | 34 / 55, signal 13 |
| Know Sure Thing (KST) | `kst` | Momentum | ROC 10/15/20/30, SMA 10/10/10/15, signal 9 |
| Least Squares Moving Average | `lsma` | Trend | length 25, offset 0 |

## Already had, inputs brought to TradingView's

| TradingView name | Ours | What changed |
|---|---|---|
| Average Directional Index (ADX) | ADX and DI | nothing. DI 14 and ADX smoothing 14 already matched. One script draws ADX together with the DI lines. |
| Average True Range (ATR) | ATR | added smoothing (RMA default, SMA, EMA, WMA) and moved it to the Volatility shelf |
| Bollinger Bands (BB) | Bollinger Bands | added basis MA type (SMA, EMA, SMMA (RMA), WMA, VWMA), source and offset |
| Commodity Channel Index (CCI) | CCI | added source (hlc3) and a smoothing line (SMA 5, hidden by default), plus a 0 line and the ±100 fill |
| Directional Movement (DMI) | ADX and DI | nothing. This script is the DMI. |
| Donchian Channels (DC) | Donchian Channels | added offset |
| Ichimoku Cloud | Ichimoku Cloud | nothing. 9 / 26 / 52 / 26 already matched. |
| Keltner Channels (KC) | Keltner Channels | added source, the use-EMA toggle and bands style (ATR, True Range, Range) |
| Exponential / Hull MA | Moving average (kind) | the standalone EMA and HMA above now carry TradingView's length-9 defaults |

## Skipped: needs data or drawing we don't have

Per the owner's rule, these aren't built at all. Nothing on the shelf is a placeholder.

| TradingView name | Skipped because it needs |
|---|---|
| Advance/Decline Line, Advance/Decline Ratio | Needs market breadth (advancing and declining issues), which we don't load. |
| Cumulative Volume Index (CVI) | Needs breadth (exchange-wide advancing and declining volume). |
| Cumulative Volume Delta | Needs intrabar up and down volume (lower-timeframe requests). Our bars carry only total volume. |
| Correlation Coefficient (CC) | Needs a second symbol's bars. The Pine runtime has no `request.security`, and there is no shared bar store for another symbol that a script can read. |
| Analyst price forecast, Dividend Yield | Needs fundamentals. |
| Basis, Index price, Funding rate, Liquidation data, Long/Short Ratio Accounts, Long Short Accounts % | Needs futures or crypto derivatives data. |
| 1 year active supply %, Active addresses with contracts, Addresses with balance ≥ X (×2), Average transaction volume, Block height, Blocks mined, Created UTXOs, Difficulty, El Salvador Government balance, ETF balances, ETF flows, Ethereum (six deposit and staking series), Hash Rate, Held tokens in addresses ≥ X (×3), Large transaction volume | Needs on-chain or crypto fund data. |
| Bollinger Bars | Draws its own candles (`plotcandle`), which the runtime doesn't draw yet. |
| Linear Regression (channel) | Draws one fitted segment over the last N bars (`line.new`). The runtime draws per-bar series only. The LSMA above is the same fit's end point, bar by bar. |
| Auto fib extension, Auto Fib Retracement, Auto Pitchfork, Auto trendlines | Auto-drawing family. Worker O owns it (zigzag, auto fib). It needs drawing objects. |
| Auto key levels | Built from volume profiles (POC, VAH, VAL). Worker O owns it. |
| Learn using seasonals | A help article, not an indicator. |

Not on TradingView's current list, so not added: Chaikin Volatility, Accumulative Swing Index, Average Price.
