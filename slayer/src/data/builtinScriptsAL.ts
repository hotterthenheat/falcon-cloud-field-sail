/* The classic technicals A to L (2026-11-01): every indicator on TradingView's built-in list from "24-hour Volume" to
   "Least Squares Moving Average" that reads only the chart's own bars, as read-only Pine sources with TradingView's inputs,
   defaults and maths (their Pine reference and help pages). Spread into SOURCES by builtinScripts.ts. What the list has that
   needs data we do not hold (breadth, on-chain, fundamentals, a second symbol, intrabar volume) is in docs/indicators-tv-AL.md. */

export interface BuiltinSourceAL {
  slug: string;
  group: 'Slayer' | 'Trend' | 'Bands' | 'Momentum' | 'Volume' | 'Volatility' | 'Statistics' | 'Candlesticks' | 'Breadth';
  title: string;
  description: string;
  source: string;
}

/* the close-location value TradingView's A/D, CMF and Chaikin oscillator share: 0 on a bar with no range */
const CLV = `clv = (close == high and close == low) or high == low ? 0.0 : (2 * close - low - high) / (high - low)`;

/* the smoothing line TradingView's moving averages carry, off by default */
const SMOOTHING = `smoothing = input.string("None", "Smoothing", options = ["None", "SMA", "SMA + Bollinger Bands", "EMA", "SMMA (RMA)", "WMA", "VWMA"])
smoothLen = input.int(14, "Smoothing length", minval = 1)
bbMult    = input.float(2.0, "BB StdDev", minval = 0.001, maxval = 50, step = 0.5)

smooth = switch smoothing
    "SMA"                   => ta.sma(out, smoothLen)
    "SMA + Bollinger Bands" => ta.sma(out, smoothLen)
    "EMA"                   => ta.ema(out, smoothLen)
    "SMMA (RMA)"            => ta.rma(out, smoothLen)
    "WMA"                   => ta.wma(out, smoothLen)
    "VWMA"                  => ta.vwma(out, smoothLen)
    => na
band = smoothing == "SMA + Bollinger Bands" ? bbMult * ta.stdev(out, smoothLen) : na
showSmooth = smoothing == "None" ? display.none : display.all
showBands  = smoothing == "SMA + Bollinger Bands" ? display.all : display.none
plot(smooth, "Smoothing", color = #FFD60A, offset = offset, display = showSmooth)
bu = plot(smooth + band, "Upper BB", color = color.new(#30D158, 40), offset = offset, display = showBands)
bl = plot(smooth - band, "Lower BB", color = color.new(#30D158, 40), offset = offset, display = showBands)
fill(bu, bl, color = color.new(#30D158, 92), title = "BB background")`;

export const SOURCES_AL: BuiltinSourceAL[] = [
  /* ---- Trend ------------------------------------------------------------------- */
  {
    slug: 'alma',
    group: 'Trend',
    title: 'Arnaud Legoux Moving Average',
    description: 'ALMA — a Gaussian-weighted average leaning toward the newest bars: smooth, with little lag',
    source: `//@version=6
indicator("Arnaud Legoux Moving Average", "ALMA", overlay = true)

len    = input.int(9, "Window size", minval = 1)
offset = input.float(0.85, "Offset", step = 0.05)
sigma  = input.float(6.0, "Sigma", step = 0.5)
src    = input.source(close, "Source")

plot(ta.alma(src, len, offset, sigma), "ALMA", color = #7DE3FF, linewidth = 2)`,
  },
  {
    slug: 'dema',
    group: 'Trend',
    title: 'Double EMA',
    description: 'DEMA — twice the EMA less the EMA of the EMA, so the average keeps up with price',
    source: `//@version=6
indicator("Double EMA", "DEMA", overlay = true)

len = input.int(9, "Length", minval = 1)
src = input.source(close, "Source")

e1 = ta.ema(src, len)
e2 = ta.ema(e1, len)
plot(2 * e1 - e2, "DEMA", color = #BBB2E8, linewidth = 2)`,
  },
  {
    slug: 'ema',
    group: 'Trend',
    title: 'Exponential Moving Average',
    description: 'EMA — one exponential average on 9 bars by default, with an optional smoothing line and bands',
    source: `//@version=6
indicator("Exponential Moving Average", "EMA", overlay = true)

len    = input.int(9, "Length", minval = 1)
src    = input.source(close, "Source")
offset = input.int(0, "Offset", minval = -500, maxval = 500)

out = ta.ema(src, len)
plot(out, "EMA", color = #5B9CF6, linewidth = 2, offset = offset)

${SMOOTHING}`,
  },
  {
    slug: 'hull-ma',
    group: 'Trend',
    title: 'Hull Moving Average',
    description: 'HMA — weighted averages of half and full length, smoothed over the root of the length',
    source: `//@version=6
indicator("Hull Moving Average", "HMA", overlay = true)

len = input.int(9, "Length", minval = 1)
src = input.source(close, "Source")

plot(ta.hma(src, len), "HMA", color = #EDE4CD, linewidth = 2)`,
  },
  {
    slug: 'kama',
    group: 'Trend',
    title: "Kaufman's Adaptive Moving Average",
    description: 'KAMA — fast while price runs in one direction, nearly still while it chops',
    source: `//@version=6
indicator("Kaufman's Adaptive Moving Average", "KAMA", overlay = true)

len     = input.int(14, "Length", minval = 1)
fastLen = input.int(2, "Fast EMA length", minval = 1)
slowLen = input.int(30, "Slow EMA length", minval = 1)
src     = input.source(close, "Source")

mom   = math.abs(ta.change(src, len))
noise = math.sum(math.abs(ta.change(src)), len)
er    = noise != 0 ? mom / noise : 0.0
fastA = 2.0 / (fastLen + 1)
slowA = 2.0 / (slowLen + 1)
alpha = math.pow(er * (fastA - slowA) + slowA, 2)
kama = 0.0
kama := alpha * src + (1 - alpha) * nz(kama[1], src)
plot(kama, "KAMA", color = kama >= nz(kama[1], kama) ? #30D158 : #FF3B30, linewidth = 2)`,
  },
  {
    slug: 'lsma',
    group: 'Trend',
    title: 'Least Squares Moving Average',
    description: 'LSMA — the end of a least-squares line fitted through the last 25 bars',
    source: `//@version=6
indicator("Least Squares Moving Average", "LSMA", overlay = true)

len    = input.int(25, "Length", minval = 1)
offset = input.int(0, "Offset")
src    = input.source(close, "Source")

plot(ta.linreg(src, len, offset), "LSMA", color = #6BD3C7, linewidth = 2)`,
  },
  {
    slug: 'chande-kroll-stop',
    group: 'Trend',
    title: 'Chande Kroll Stop',
    description: 'Two ATR stops built from the recent extremes — the long stop under price, the short stop over it',
    source: `//@version=6
indicator("Chande Kroll Stop", "CKS", overlay = true)

p = input.int(10, "ATR length", minval = 1)
x = input.int(1, "ATR coefficient", minval = 1)
q = input.int(9, "Stop length", minval = 1)

firstHigh = ta.highest(high, p) - x * ta.atr(p)
firstLow  = ta.lowest(low, p) + x * ta.atr(p)
stopShort = ta.highest(firstHigh, q)
stopLong  = ta.lowest(firstLow, q)
plot(stopLong,  "Stop long",  color = #5B9CF6)
plot(stopShort, "Stop short", color = #FF9500)`,
  },
  {
    slug: 'chandelier-exit',
    group: 'Trend',
    title: 'Chandelier Exit',
    description: 'The trailing exits hung an ATR multiple off the highest high and the lowest low',
    source: `//@version=6
indicator("Chandelier Exit", "CE", overlay = true)

len    = input.int(22, "Length", minval = 1)
atrLen = input.int(22, "ATR length", minval = 1)
mult   = input.float(3.0, "ATR multiplier", minval = 0.1, step = 0.5)

a = ta.atr(atrLen) * mult
plot(ta.highest(high, len) - a, "Long exit",  color = #30D158)
plot(ta.lowest(low, len) + a,   "Short exit", color = #FF3B30)`,
  },

  /* ---- Bands ------------------------------------------------------------------- */
  {
    slug: 'envelope',
    group: 'Bands',
    title: 'Envelope',
    description: 'A 20-bar average with fixed percent shoulders — 10% either side by default',
    source: `//@version=6
indicator("Envelope", "Env", overlay = true)

len         = input.int(20, "Length", minval = 1)
percent     = input.float(10.0, "Percent", step = 0.1)
src         = input.source(close, "Source")
exponential = input.bool(false, "Exponential")

basis = exponential ? ta.ema(src, len) : ta.sma(src, len)
k     = percent / 100.0
plot(basis, "Basis", color = #FF9500)
u = plot(basis * (1 + k), "Upper", color = #5B9CF6)
l = plot(basis * (1 - k), "Lower", color = #5B9CF6)
fill(u, l, color = color.new(#5B9CF6, 94), title = "Background")`,
  },
  {
    slug: 'bb-percent-b',
    group: 'Bands',
    title: 'Bollinger Bands %b',
    description: '%b — where price sits inside the Bollinger Bands: 1 on the upper band, 0 on the lower',
    source: `//@version=6
indicator("Bollinger Bands %b", "%b")

len  = input.int(20, "Length", minval = 1)
src  = input.source(close, "Source")
mult = input.float(2.0, "StdDev", minval = 0.001, maxval = 50, step = 0.25)

[basis, upper, lower] = ta.bb(src, len, mult)
plot((src - lower) / (upper - lower), "%b", color = #C7A9CF, linewidth = 2)
a = hline(1, "Overbought", color = color.new(#C7D3E8, 60), linestyle = hline.style_dashed)
hline(0.5, "Middle", color = color.new(#C7D3E8, 80), linestyle = hline.style_dotted)
b = hline(0, "Oversold", color = color.new(#C7D3E8, 60), linestyle = hline.style_dashed)
fill(a, b, color = color.new(#C7A9CF, 94), title = "Background")`,
  },
  {
    slug: 'bbtrend',
    group: 'Bands',
    title: 'BBTrend',
    description: 'A short and a long Bollinger Band compared — above zero the lower bands part (up), below it the upper bands do',
    source: `//@version=6
indicator("BBTrend")

shortLen = input.int(20, "Short BB length", minval = 1)
longLen  = input.int(50, "Long BB length", minval = 1)
mult     = input.float(2.0, "StdDev", minval = 0.001, maxval = 50, step = 0.25)

[sMid, sUp, sLo] = ta.bb(close, shortLen, mult)
[lMid, lUp, lLo] = ta.bb(close, longLen, mult)
bbt = (math.abs(sLo - lLo) - math.abs(sUp - lUp)) / sMid * 100
rising = bbt > nz(bbt[1])
plot(bbt, "BBTrend", color = bbt >= 0 ? (rising ? #30D158 : color.new(#30D158, 55)) : (rising ? color.new(#FF3B30, 55) : #FF3B30), style = plot.style_columns)
hline(0, "Zero", color = color.new(#C7D3E8, 70))`,
  },

  /* ---- Momentum ----------------------------------------------------------------- */
  {
    slug: 'aroon',
    group: 'Momentum',
    title: 'Aroon',
    description: 'How many bars since the highest high and the lowest low of the last 14, as 0 to 100',
    source: `//@version=6
indicator("Aroon")

len = input.int(14, "Length", minval = 1)

upper = 100.0 * (ta.highestbars(high, len + 1) + len) / len
lower = 100.0 * (ta.lowestbars(low, len + 1) + len) / len
plot(upper, "Aroon Up",   color = #FF9500)
plot(lower, "Aroon Down", color = #5B9CF6)`,
  },
  {
    slug: 'aroon-oscillator',
    group: 'Momentum',
    title: 'Aroon Oscillator',
    description: 'Aroon Up less Aroon Down — above zero the highs are fresher than the lows',
    source: `//@version=6
indicator("Aroon Oscillator")

len = input.int(14, "Length", minval = 1)

upper = 100.0 * (ta.highestbars(high, len + 1) + len) / len
lower = 100.0 * (ta.lowestbars(low, len + 1) + len) / len
osc = upper - lower
plot(osc, "Aroon Oscillator", color = osc >= 0 ? #30D158 : #FF3B30, linewidth = 2)
hline(0, "Zero", color = color.new(#C7D3E8, 70))`,
  },
  {
    slug: 'awesome-oscillator',
    group: 'Momentum',
    title: 'Awesome Oscillator',
    description: 'AO — the 5-bar average of the midpoint less the 34-bar one, green while it rises',
    source: `//@version=6
indicator("Awesome Oscillator", "AO")

ao   = ta.sma(hl2, 5) - ta.sma(hl2, 34)
diff = ao - ao[1]
plot(ao, "AO", color = diff <= 0 ? #FF3B30 : #30D158, style = plot.style_columns)
hline(0, "Zero", color = color.new(#C7D3E8, 80))`,
  },
  {
    slug: 'balance-of-power',
    group: 'Momentum',
    title: 'Balance of Power',
    description: "BOP — the bar's body over its range: +1 buyers owned it, −1 sellers did",
    source: `//@version=6
indicator("Balance of Power", "BOP", precision = 2)

plot((close - open) / (high - low), "BOP", color = #D8A6A6)
hline(0, "Zero", color = color.new(#C7D3E8, 80))`,
  },
  {
    slug: 'bull-bear-power',
    group: 'Momentum',
    title: 'Bull Bear Power',
    description: 'The high above the 13 EMA plus the low against it — who is pushing the bar away from the average',
    source: `//@version=6
indicator("Bull Bear Power", "BBPower")

len = input.int(13, "Length", minval = 1)

bull = high - ta.ema(close, len)
bear = low - ta.ema(close, len)
power = bull + bear
plot(power, "BBPower", color = power >= 0 ? #30D158 : #FF3B30, style = plot.style_columns)`,
  },
  {
    slug: 'chande-momentum',
    group: 'Momentum',
    title: 'Chande Momentum Oscillator',
    description: 'The up moves less the down moves over their total, −100 to 100',
    source: `//@version=6
indicator("Chande Momentum Oscillator", "ChandeMO")

len = input.int(9, "Length", minval = 1)
src = input.source(close, "Source")

plot(ta.cmo(src, len), "ChandeMO", color = #5B9CF6)
hline(0, "Zero", color = color.new(#C7D3E8, 70), linestyle = hline.style_dashed)`,
  },
  {
    slug: 'chop-zone',
    group: 'Momentum',
    title: 'Chop Zone',
    description: "The angle of the 34 EMA, as coloured columns — blues and greens climbing, reds falling, yellow flat",
    source: `//@version=6
indicator("Chop Zone")

periods = 30
pi      = math.atan(1) * 4
hh      = ta.highest(periods)
ll      = ta.lowest(periods)
span    = 25 / (hh - ll) * ll
ema34   = ta.ema(close, 34)
y2      = (ema34[1] - ema34) / hlc3 * span
c       = math.sqrt(1 + y2 * y2)
angle1  = math.round(180 * math.acos(1 / c) / pi)
angle   = y2 > 0 ? -angle1 : angle1

zone = angle >= 5 ? #26C6DA : angle >= 3.57 ? #43A047 : angle >= 2.14 ? #A5D6A7 : angle >= 0.71 ? #009688 : angle <= -5 ? #D50000 : angle <= -3.57 ? #E91E63 : angle <= -2.14 ? #FF6D00 : angle <= -0.71 ? #FFB74D : #FDD835
plot(1, "Chop Zone", color = zone, style = plot.style_columns)`,
  },
  {
    slug: 'connors-rsi',
    group: 'Momentum',
    title: 'Connors RSI',
    description: 'CRSI — the average of a 3-bar RSI, an RSI of the up/down streak, and the percent rank of the day’s change',
    source: `//@version=6
indicator("Connors RSI", "CRSI")

src       = input.source(close, "Source")
lenRsi    = input.int(3, "RSI length", minval = 1)
lenUpDown = input.int(2, "Up/down length", minval = 1)
lenRoc    = input.int(100, "ROC length", minval = 1)

updown(float s) =>
    isEqual   = s == s[1]
    isGrowing = s > s[1]
    ud = 0.0
    ud := isEqual ? 0 : isGrowing ? (nz(ud[1]) <= 0 ? 1 : nz(ud[1]) + 1) : (nz(ud[1]) >= 0 ? -1 : nz(ud[1]) - 1)
    ud

rsi   = ta.rsi(src, lenRsi)
udRsi = ta.rsi(updown(src), lenUpDown)
rank  = ta.percentrank(ta.roc(src, 1), lenRoc)
crsi  = math.avg(rsi, udRsi, rank)
plot(crsi, "CRSI", color = #A9C77F, linewidth = 2)
a = hline(70, "Upper band", color = color.new(#C7D3E8, 70), linestyle = hline.style_dotted)
b = hline(30, "Lower band", color = color.new(#C7D3E8, 70), linestyle = hline.style_dotted)
fill(a, b, color = color.new(#A9C77F, 94), title = "Background")`,
  },
  {
    slug: 'coppock-curve',
    group: 'Momentum',
    title: 'Coppock Curve',
    description: 'A 10-bar weighted average of the 14- and 11-bar rates of change — the long-cycle turn',
    source: `//@version=6
indicator("Coppock Curve")

wmaLen   = input.int(10, "WMA length", minval = 1)
longRoc  = input.int(14, "Long RoC length", minval = 1)
shortRoc = input.int(11, "Short RoC length", minval = 1)
src      = input.source(close, "Source")

curve = ta.wma(ta.roc(src, longRoc) + ta.roc(src, shortRoc), wmaLen)
plot(curve, "Coppock Curve", color = #5B9CF6, linewidth = 2)
hline(0, "Zero", color = color.new(#C7D3E8, 80))`,
  },
  {
    slug: 'dpo',
    group: 'Momentum',
    title: 'Detrended Price Oscillator',
    description: 'DPO — the close against a displaced 21-bar average, the trend taken out to show the cycle',
    source: `//@version=6
indicator("Detrended Price Oscillator", "DPO")

period   = input.int(21, "Length", minval = 1)
centered = input.bool(false, "Centered")

barsback = period / 2 + 1
ma  = ta.sma(close, period)
dpo = centered ? close[barsback] - ma : close - ma[barsback]
plot(dpo, "DPO", color = #A9C77F, offset = centered ? -barsback : 0)
hline(0, "Zero", color = color.new(#C7D3E8, 80))`,
  },
  {
    slug: 'fisher-transform',
    group: 'Momentum',
    title: 'Fisher Transform',
    description: 'The midpoint’s place in its 9-bar range, stretched so turns stand out sharply',
    source: `//@version=6
indicator("Fisher Transform")

len = input.int(9, "Length", minval = 1)

hi = ta.highest(hl2, len)
lo = ta.lowest(hl2, len)
clamp(float v) => v > 0.99 ? 0.999 : v < -0.99 ? -0.999 : v
value = 0.0
value := clamp(0.66 * ((hl2 - lo) / (hi - lo) - 0.5) + 0.67 * nz(value[1]))
fish = 0.0
fish := 0.5 * math.log((1 + value) / (1 - value)) + 0.5 * nz(fish[1])
plot(fish,    "Fisher",  color = #5B9CF6, linewidth = 2)
plot(fish[1], "Trigger", color = #FF9500)
hline(1.5,   "1.5",   color = color.new(#FF3B30, 60), linestyle = hline.style_dotted)
hline(0.75,  "0.75",  color = color.new(#C7D3E8, 75), linestyle = hline.style_dotted)
hline(0,     "0",     color = color.new(#C7D3E8, 75), linestyle = hline.style_dotted)
hline(-0.75, "-0.75", color = color.new(#C7D3E8, 75), linestyle = hline.style_dotted)
hline(-1.5,  "-1.5",  color = color.new(#30D158, 60), linestyle = hline.style_dotted)`,
  },
  {
    slug: 'kst',
    group: 'Momentum',
    title: 'Know Sure Thing',
    description: 'KST — four smoothed rates of change weighted 1 to 4, and their 9-bar signal',
    source: `//@version=6
indicator("Know Sure Thing", "KST")

roc1 = input.int(10, "RoC length #1", minval = 1)
roc2 = input.int(15, "RoC length #2", minval = 1)
roc3 = input.int(20, "RoC length #3", minval = 1)
roc4 = input.int(30, "RoC length #4", minval = 1)
sma1 = input.int(10, "SMA length #1", minval = 1)
sma2 = input.int(10, "SMA length #2", minval = 1)
sma3 = input.int(10, "SMA length #3", minval = 1)
sma4 = input.int(15, "SMA length #4", minval = 1)
sigLen = input.int(9, "Signal line length", minval = 1)

smaroc(int rl, int sl) => ta.sma(ta.roc(close, rl), sl)
kst = smaroc(roc1, sma1) + 2 * smaroc(roc2, sma2) + 3 * smaroc(roc3, sma3) + 4 * smaroc(roc4, sma4)
plot(kst, "KST", color = #30D158)
plot(ta.sma(kst, sigLen), "Signal", color = #FF3B30)
hline(0, "Zero", color = color.new(#C7D3E8, 80))`,
  },

  /* ---- Volume ------------------------------------------------------------------- */
  {
    slug: 'volume-24h',
    group: 'Volume',
    title: '24-hour Volume',
    description: 'The volume of every bar that opened in the last 24 clock hours, summed — counted on the chart’s own bars',
    source: `//@version=6
indicator("24-hour Volume", format = format.volume)

var int first = 0
cv = ta.cum(volume)
while first < bar_index and time[bar_index - first] <= time - 86400000
    first := first + 1
before = first > 0 ? cv[bar_index - first + 1] : 0.0
plot(cv - before, "24h volume", color = color.new(#6BD3C7, 30), style = plot.style_columns)`,
  },
  {
    slug: 'accumulation-distribution',
    group: 'Volume',
    title: 'Accumulation/Distribution',
    description: 'A/D — each bar’s volume, weighted by where it closed in its range, added up',
    source: `//@version=6
indicator("Accumulation/Distribution", "Accum/Dist", format = format.volume)

${CLV}
plot(ta.cum(clv * volume), "Accumulation/Distribution", color = #EDE4CD)`,
  },
  {
    slug: 'cmf',
    group: 'Volume',
    title: 'Chaikin Money Flow',
    description: 'CMF — the A/D flow of the last 20 bars over their volume, −1 to 1',
    source: `//@version=6
indicator("Chaikin Money Flow", "CMF", precision = 2)

len = input.int(20, "Length", minval = 1)

${CLV}
mf = math.sum(clv * volume, len) / math.sum(volume, len)
plot(mf, "CMF", color = mf >= 0 ? #30D158 : #FF3B30)
hline(0, "Zero", color = color.new(#C7D3E8, 70))`,
  },
  {
    slug: 'chaikin-oscillator',
    group: 'Volume',
    title: 'Chaikin Oscillator',
    description: 'The 3-bar EMA of the A/D line less its 10-bar EMA — accumulation gathering or fading',
    source: `//@version=6
indicator("Chaikin Oscillator", format = format.volume)

fast = input.int(3, "Fast length", minval = 1)
slow = input.int(10, "Slow length", minval = 1)

${CLV}
ad  = ta.cum(clv * volume)
osc = ta.ema(ad, fast) - ta.ema(ad, slow)
plot(osc, "Chaikin Oscillator", color = #D8A6A6)
hline(0, "Zero", color = color.new(#C7D3E8, 70))`,
  },
  {
    slug: 'ease-of-movement',
    group: 'Volume',
    title: 'Ease of Movement',
    description: 'EOM — how far the midpoint moved per unit of volume, over 14 bars',
    source: `//@version=6
indicator("Ease of Movement", "EOM", format = format.volume)

len = input.int(14, "Length", minval = 1)
div = input.int(10000, "Divisor", minval = 1)

eom = ta.sma(div * ta.change(hl2) * (high - low) / volume, len)
plot(eom, "EOM", color = #30D158)
hline(0, "Zero", color = color.new(#C7D3E8, 70))`,
  },
  {
    slug: 'elder-force-index',
    group: 'Volume',
    title: "Elder's Force Index",
    description: 'EFI — the change in the close times volume, averaged over 13 bars',
    source: `//@version=6
indicator("Elder Force Index", "EFI", format = format.volume)

len = input.int(13, "Length", minval = 1)

efi = ta.ema(ta.change(close) * volume, len)
plot(efi, "EFI", color = #D8A6A6)
hline(0, "Zero", color = color.new(#C7D3E8, 70))`,
  },
  {
    slug: 'klinger',
    group: 'Volume',
    title: 'Klinger Oscillator',
    description: 'Volume signed by the typical price’s direction, the 34 EMA less the 55, with a 13 signal',
    source: `//@version=6
indicator("Klinger Oscillator", format = format.volume)

sv  = ta.change(hlc3) >= 0 ? volume : -volume
kvo = ta.ema(sv, 34) - ta.ema(sv, 55)
sig = ta.ema(kvo, 13)
plot(kvo, "Klinger Oscillator", color = #5B9CF6)
plot(sig, "Signal", color = #30D158)
hline(0, "Zero", color = color.new(#C7D3E8, 80))`,
  },

  /* ---- Volatility --------------------------------------------------------------- */
  {
    slug: 'average-daily-range',
    group: 'Volatility',
    title: 'Average Daily Range',
    description: 'ADR — the average high-to-low range of the last 14 completed sessions, in price',
    source: `//@version=6
indicator("Average Daily Range", "ADR")

len = input.int(14, "Length", minval = 1)

var float dayHigh = na
var float dayLow  = na
var float adr     = na
if timeframe.isintraday
    if ta.change(dayofmonth) != 0
        if not na(dayHigh)
            adr := ta.sma(dayHigh - dayLow, len)
        dayHigh := high
        dayLow  := low
    else
        dayHigh := math.max(dayHigh, high)
        dayLow  := math.min(dayLow, low)
else
    adr := ta.sma(high - low, len)
plot(adr, "ADR", color = #D8BC8F, linewidth = 2)`,
  },
  {
    slug: 'bb-width',
    group: 'Volatility',
    title: 'Bollinger BandWidth',
    description: 'BBW — the band’s width as a percent of its basis, with the widest and narrowest of the last 125 bars',
    source: `//@version=6
indicator("Bollinger BandWidth", "BBW", precision = 2)

len    = input.int(20, "Length", minval = 1)
src    = input.source(close, "Source")
mult   = input.float(2.0, "StdDev", minval = 0.001, maxval = 50, step = 0.25)
expLen = input.int(125, "Highest expansion length", minval = 1)
conLen = input.int(125, "Lowest contraction length", minval = 1)

[basis, upper, lower] = ta.bb(src, len, mult)
bbw = (upper - lower) / basis * 100
plot(bbw, "BBW", color = #5B9CF6, linewidth = 2)
plot(ta.highest(bbw, expLen), "Highest expansion",  color = color.new(#FF3B30, 30))
plot(ta.lowest(bbw, conLen),  "Lowest contraction", color = color.new(#30D158, 30))`,
  },
  {
    slug: 'choppiness',
    group: 'Volatility',
    title: 'Choppiness Index',
    description: 'CHOP — the path the bars travelled against the range they covered: high is a chop, low a trend',
    source: `//@version=6
indicator("Choppiness Index", "CHOP", precision = 2)

len    = input.int(14, "Length", minval = 1)
offset = input.int(0, "Offset", minval = -500, maxval = 500)

ci = 100 * math.log10(math.sum(ta.atr(1), len) / (ta.highest(len) - ta.lowest(len))) / math.log10(len)
plot(ci, "CHOP", color = #5B9CF6, offset = offset)
a = hline(61.8, "Upper band", color = color.new(#C7D3E8, 60), linestyle = hline.style_dashed)
hline(50, "Middle band", color = color.new(#C7D3E8, 80), linestyle = hline.style_dotted)
b = hline(38.2, "Lower band", color = color.new(#C7D3E8, 60), linestyle = hline.style_dashed)
fill(a, b, color = color.new(#5B9CF6, 94), title = "Background")`,
  },
  {
    slug: 'historical-volatility',
    group: 'Volatility',
    title: 'Historical Volatility',
    description: 'HV — the deviation of the log returns over 10 bars, annualised, in percent',
    source: `//@version=6
indicator("Historical Volatility", "HV")

len = input.int(10, "Length", minval = 1)

annual = 365.0
per    = timeframe.isintraday or (timeframe.isdaily and timeframe.multiplier == 1) ? 1 : 7
hv     = 100 * ta.stdev(math.log(close / close[1]), len) * math.sqrt(annual / per)
plot(hv, "HV", color = #5B9CF6, linewidth = 2)`,
  },

  /* ---- Statistics --------------------------------------------------------------- */
  {
    slug: 'advance-decline-bars',
    group: 'Statistics',
    title: 'Advance/Decline Ratio (Bars)',
    description: 'Of the last 9 bars, how many closed up for each that closed down — on this chart’s own bars',
    source: `//@version=6
indicator("Advance/Decline Ratio (Bars)", "ADR_B", precision = 2)

len = input.int(9, "Length", minval = 1)

isUp     = close - open >= 0
upBars   = math.sum(isUp ? 1.0 : 0.0, len)
downBars = math.sum(isUp ? 0.0 : 1.0, len)
ratio    = downBars == 0 ? upBars : upBars / downBars
plot(ratio, "A/D ratio", color = #EDE4CD, linewidth = 2)
hline(1, "Even", color = color.new(#C7D3E8, 60), linestyle = hline.style_dashed)`,
  },
];
