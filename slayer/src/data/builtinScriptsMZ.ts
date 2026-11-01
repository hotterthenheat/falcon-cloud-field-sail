/* TradingView's built-in indicators from M to Z that the terminal did not already ship (2026-11-01), as read-only Pine
   sources spread into builtinScripts.ts' list. Inputs and defaults follow TradingView's own; the maths follows the Pine
   reference and TradingView's help pages. Every one is checked by scripts/indicators-mz-proof.ts.
   What TradingView lists from M to Z and is not here, and why: docs/indicators-tv-MZ.md. */

type Group = 'Slayer' | 'Trend' | 'Bands' | 'Momentum' | 'Volume' | 'Volatility' | 'Statistics' | 'Candlesticks' | 'Breadth';

export interface BuiltinSourceMZ {
  slug: string;
  group: Group;
  title: string;
  description: string;
  source: string;
}

/* The averaging menu TradingView offers wherever an indicator lets you pick the average */
const MA_FN = `ma(source, length, kind) =>
    switch kind
        "SMA" => ta.sma(source, length)
        "EMA" => ta.ema(source, length)
        "SMMA (RMA)" => ta.rma(source, length)
        "WMA" => ta.wma(source, length)
        "VWMA" => ta.vwma(source, length)
        => ta.sma(source, length)`;
const MA_KINDS = '["SMA", "EMA", "SMMA (RMA)", "WMA", "VWMA"]';

const GUIDE = 'color.new(#C7D3E8, 70)';

export const SOURCES_MZ: BuiltinSourceMZ[] = [
  /* ---- Trend: the averages ------------------------------------------------------ */
  {
    slug: 'sma',
    group: 'Trend',
    title: 'Simple Moving Average',
    description: 'The plain mean of the last N closes — every bar counts the same',
    source: `//@version=6
indicator("Simple Moving Average", overlay = true)

len = input.int(9, "Length", minval = 1)
src = input.source(close, "Source")
off = input.int(0, "Offset", minval = -500, maxval = 500)

plot(ta.sma(src, len), "MA", color = #5B9CF6, linewidth = 2, offset = off)`,
  },
  {
    slug: 'wma',
    group: 'Trend',
    title: 'Weighted Moving Average',
    description: 'An average that weights the newest bar most, falling off in a straight line',
    source: `//@version=6
indicator("Weighted Moving Average", overlay = true)

len = input.int(9, "Length", minval = 1)
src = input.source(close, "Source")
off = input.int(0, "Offset", minval = -500, maxval = 500)

plot(ta.wma(src, len), "WMA", color = #6BD3C7, linewidth = 2, offset = off)`,
  },
  {
    slug: 'vwma',
    group: 'Trend',
    title: 'Volume-Weighted Moving Average',
    description: 'An average of price where heavy bars count for more than light ones',
    source: `//@version=6
indicator("Volume-Weighted Moving Average", overlay = true)

len = input.int(20, "Length", minval = 1)
src = input.source(close, "Source")
off = input.int(0, "Offset", minval = -500, maxval = 500)

plot(ta.vwma(src, len), "VWMA", color = #BBB2E8, linewidth = 2, offset = off)`,
  },
  {
    slug: 'smma',
    group: 'Trend',
    title: 'Smoothed Moving Average',
    description: "Wilder's smoothing as a line on price — slow to turn, seeded from a simple average",
    source: `//@version=6
indicator("Smoothed Moving Average", overlay = true)

len = input.int(7, "Length", minval = 1)
src = input.source(close, "Source")

smma = 0.0
smma := na(smma[1]) ? ta.sma(src, len) : (smma[1] * (len - 1) + src) / len
plot(smma, "SMMA", color = #D8BC8F, linewidth = 2)`,
  },
  {
    slug: 'tema',
    group: 'Trend',
    title: 'Triple EMA',
    description: 'Three exponential averages folded together to cut the lag of one',
    source: `//@version=6
indicator("Triple EMA", overlay = true)

len = input.int(9, "Length", minval = 1)
src = input.source(close, "Source")

e1 = ta.ema(src, len)
e2 = ta.ema(e1, len)
e3 = ta.ema(e2, len)
plot(3 * (e1 - e2) + e3, "TEMA", color = #FF9500, linewidth = 2)`,
  },
  {
    slug: 'mcginley',
    group: 'Trend',
    title: 'McGinley Dynamic',
    description: 'An average that speeds up when price runs away from it and slows when price comes back',
    source: `//@version=6
indicator("McGinley Dynamic", overlay = true)

len = input.int(14, "Length", minval = 1)
src = input.source(close, "Source")

mg = 0.0
mg := na(mg[1]) ? ta.ema(src, len) : mg[1] + (src - mg[1]) / (len * math.pow(src / mg[1], 4))
plot(mg, "McGinley", color = #6BD3C7, linewidth = 2)`,
  },
  {
    slug: 'ma-hamming',
    group: 'Trend',
    title: 'Moving Average Hamming',
    description: 'An average weighted by a Hamming window — heaviest in the middle of the window, light at both ends',
    source: `//@version=6
indicator("Moving Average Hamming", overlay = true)

len = input.int(10, "Length", minval = 2)
src = input.source(close, "Source")

hamming(s, n) =>
    num = 0.0
    den = 0.0
    for i = 0 to n - 1
        w = 0.54 - 0.46 * math.cos(2 * math.pi * i / (n - 1))
        num += w * s[i]
        den += w
    num / den

plot(hamming(src, len), "Hamming MA", color = #C7A9CF, linewidth = 2)`,
  },
  {
    slug: 'ma-ribbon',
    group: 'Trend',
    title: 'Moving Average Ribbon',
    description: 'Four averages at 20, 50, 100 and 200 bars, each its own kind — the ribbon fans out in a trend',
    source: `//@version=6
indicator("Moving Average Ribbon", overlay = true)

${MA_FN}

src = input.source(close, "Source")
k1 = input.string("SMA", "MA #1", options = ${MA_KINDS})
l1 = input.int(20, "MA #1 length", minval = 1)
k2 = input.string("SMA", "MA #2", options = ${MA_KINDS})
l2 = input.int(50, "MA #2 length", minval = 1)
k3 = input.string("SMA", "MA #3", options = ${MA_KINDS})
l3 = input.int(100, "MA #3 length", minval = 1)
k4 = input.string("SMA", "MA #4", options = ${MA_KINDS})
l4 = input.int(200, "MA #4 length", minval = 1)

plot(ma(src, l1, k1), "MA #1", color = #F5D76E)
plot(ma(src, l2, k2), "MA #2", color = #FF9500)
plot(ma(src, l3, k3), "MA #3", color = #FF6A3D)
plot(ma(src, l4, k4), "MA #4", color = #FF3B30)`,
  },
  {
    slug: 'ma-cross',
    group: 'Trend',
    title: 'MA Cross',
    description: 'A 9-bar and a 21-bar simple average, with a mark wherever they cross',
    source: `//@version=6
indicator("MA Cross", overlay = true)

shortLen = input.int(9, "Short", minval = 1)
longLen  = input.int(21, "Long", minval = 1)

short = ta.sma(close, shortLen)
long  = ta.sma(close, longLen)
crossed = ta.cross(short, long)
plot(short, "Short", color = #FF6D6D)
plot(long,  "Long",  color = #30D158)
plot(crossed ? short : na, "Cross", color = #C7D3E8, style = plot.style_cross, linewidth = 4)
alertcondition(ta.crossover(short, long),  "Short crossed above long", "{{ticker}} short MA crossed above the long MA")
alertcondition(ta.crossunder(short, long), "Short crossed below long", "{{ticker}} short MA crossed below the long MA")`,
  },
  {
    slug: 'ma-ema-cross',
    group: 'Trend',
    title: 'MA with EMA Cross',
    description: 'A simple and an exponential average of the same length, marked where they cross',
    source: `//@version=6
indicator("MA with EMA Cross", overlay = true)

maLen  = input.int(10, "MA length", minval = 1)
emaLen = input.int(10, "EMA length", minval = 1)
src = input.source(close, "Source")

m = ta.sma(src, maLen)
e = ta.ema(src, emaLen)
crossed = ta.cross(m, e)
plot(m, "MA",  color = #FF6D6D)
plot(e, "EMA", color = #5B9CF6)
plot(crossed ? m : na, "Cross", color = #C7D3E8, style = plot.style_cross, linewidth = 4)`,
  },
  {
    slug: 'movingavg-cross',
    group: 'Trend',
    title: 'MovingAvg Cross',
    description: "TradingView's moving-average strategy as marks — long once price has closed above the 9-bar average for the confirm bars, short below",
    source: `//@version=6
indicator("MovingAvg Cross", overlay = true)

len = input.int(9, "Length", minval = 1)
confirmBars = input.int(1, "Confirm bars", minval = 1)
src = input.source(close, "Source")

ma = ta.sma(src, len)
bcount = 0
bcount := src > ma ? nz(bcount[1]) + 1 : 0
scount = 0
scount := src < ma ? nz(scount[1]) + 1 : 0

plot(ma, "MA", color = #5B9CF6)
plotshape(bcount == confirmBars, "Long entry",  shape.triangleup,   location.belowbar, #30D158, size = size.tiny)
plotshape(scount == confirmBars, "Short entry", shape.triangledown, location.abovebar, #FF3B30, size = size.tiny)`,
  },
  {
    slug: 'movingavg2line-cross',
    group: 'Trend',
    title: 'MovingAvg2Line Cross',
    description: "TradingView's two-average strategy as marks — long where the 9 crosses over the 18, short where it crosses under",
    source: `//@version=6
indicator("MovingAvg2Line Cross", overlay = true)

fastLen = input.int(9, "Fast", minval = 1)
slowLen = input.int(18, "Slow", minval = 1)

fast = ta.sma(close, fastLen)
slow = ta.sma(close, slowLen)
plot(fast, "Fast MA", color = #5B9CF6)
plot(slow, "Slow MA", color = #FF9500)
plotshape(ta.crossover(fast, slow),  "Long entry",  shape.triangleup,   location.belowbar, #30D158, size = size.tiny)
plotshape(ta.crossunder(fast, slow), "Short entry", shape.triangledown, location.abovebar, #FF3B30, size = size.tiny)`,
  },
  {
    slug: 'williams-alligator',
    group: 'Trend',
    title: 'Williams Alligator',
    description: "Bill Williams' jaw, teeth and lips — three smoothed averages of the midpoint, each pushed forward",
    source: `//@version=6
indicator("Williams Alligator", overlay = true)

jawLen   = input.int(13, "Jaw length", minval = 1)
teethLen = input.int(8,  "Teeth length", minval = 1)
lipsLen  = input.int(5,  "Lips length", minval = 1)
jawOff   = input.int(8,  "Jaw offset")
teethOff = input.int(5,  "Teeth offset")
lipsOff  = input.int(3,  "Lips offset")

smma(src, len) =>
    s = 0.0
    s := na(s[1]) ? ta.sma(src, len) : (s[1] * (len - 1) + src) / len
    s

plot(smma(hl2, jawLen),   "Jaw",   color = #5B9CF6, offset = jawOff)
plot(smma(hl2, teethLen), "Teeth", color = #FF3B30, offset = teethOff)
plot(smma(hl2, lipsLen),  "Lips",  color = #30D158, offset = lipsOff)`,
  },
  {
    slug: 'williams-fractals',
    group: 'Trend',
    title: 'Williams Fractals',
    description: 'A mark over a high with lower highs either side, and under a low with higher lows — drawn on that bar once the bars after it have closed',
    source: `//@version=6
indicator("Williams Fractals", overlay = true)

n = input.int(2, "Periods", minval = 2)

// the candidate is n bars back: the n bars since strictly lower, and n strictly lower before it,
// allowing up to four bars level with it right before (window maxima stand in for the bar-by-bar loop)
hc = high[n]
hN = ta.highest(high, n)
h2 = ta.highest(high, 2)
h3 = ta.highest(high, 3)
h4 = ta.highest(high, 4)
upFractal = hN < hc and (hN[n + 1] < hc or (high[n + 1] <= hc and hN[n + 2] < hc) or (h2[n + 1] <= hc and hN[n + 3] < hc) or (h3[n + 1] <= hc and hN[n + 4] < hc) or (h4[n + 1] <= hc and hN[n + 5] < hc))
lc = low[n]
lN = ta.lowest(low, n)
l2 = ta.lowest(low, 2)
l3 = ta.lowest(low, 3)
l4 = ta.lowest(low, 4)
downFractal = lN > lc and (lN[n + 1] > lc or (low[n + 1] >= lc and lN[n + 2] > lc) or (l2[n + 1] >= lc and lN[n + 3] > lc) or (l3[n + 1] >= lc and lN[n + 4] > lc) or (l4[n + 1] >= lc and lN[n + 5] > lc))
plotshape(downFractal, "Down fractal", shape.triangledown, location.belowbar, #FF3B30, offset = -n, size = size.tiny)
plotshape(upFractal,   "Up fractal",   shape.triangleup,   location.abovebar, #30D158, offset = -n, size = size.tiny)`,
  },
  {
    slug: 'volatility-stop',
    group: 'Trend',
    title: 'Volatility Stop',
    description: "An ATR stop that trails the run's extreme and flips side when price closes through it",
    source: `//@version=6
indicator("Volatility Stop", overlay = true)

len  = input.int(20, "Length", minval = 2)
src  = input.source(close, "Source")
mult = input.float(2.0, "Multiplier", minval = 0.1, step = 0.1)

vstop(s, atrlen, atrfactor) =>
    var hi = s
    var lo = s
    var uptrend = true
    var stop = 0.0
    atrM = nz(ta.atr(atrlen) * atrfactor, ta.tr(false))
    hi := math.max(hi, s)
    lo := math.min(lo, s)
    stop := nz(uptrend ? math.max(stop, hi - atrM) : math.min(stop, lo + atrM), s)
    uptrend := s - stop >= 0.0
    if uptrend != nz(uptrend[1], true)
        hi := s
        lo := s
        stop := uptrend ? hi - atrM : lo + atrM
    [stop, uptrend]

[vs, up] = vstop(src, len, mult)
plot(vs, "Volatility Stop", color = up ? #30D158 : #FF3B30, style = plot.style_cross)`,
  },
  {
    slug: 'twap',
    group: 'Trend',
    title: 'Time Weighted Average Price',
    description: "The plain mean of each bar's price since the session opened — every minute counts the same, whatever traded",
    source: `//@version=6
indicator("Time Weighted Average Price", overlay = true)

src = input.source(ohlc4, "Source")
off = input.int(0, "Offset", minval = -500, maxval = 500)

var total = 0.0
var count = 0
if session.isfirstbar
    total := 0.0
    count := 0
total += src
count += 1
plot(total / count, "TWAP", color = #F5D76E, linewidth = 2, offset = off)`,
  },
  {
    slug: 'technical-ratings',
    group: 'Trend',
    title: 'Technical Ratings',
    description: 'Fifteen averages and eleven oscillators each vote buy, neutral or sell; the bars are the mean of the two camps, −1 to 1',
    source: `//@version=6
indicator("Technical Ratings")

basedOn = input.string("All", "Rating is based on", options = ["All", "MAs", "Oscillators"])

// the 26 votes run natively (core/pine/taMoreMZ.ts technicalRating), by the rules on TradingView's help page
[allRating, maRating, oscRating] = ta.technicalRating()
rating = basedOn == "MAs" ? maRating : basedOn == "Oscillators" ? oscRating : allRating
plot(rating, "Rating", color = rating > 0.5 ? #30D158 : rating > 0.1 ? color.new(#30D158, 45) : rating < -0.5 ? #FF3B30 : rating < -0.1 ? color.new(#FF3B30, 45) : #C7D3E8, style = plot.style_columns)
plot(maRating, "MA rating", color = #5B9CF6, display = display.none)
plot(oscRating, "Oscillator rating", color = #FF9500, display = display.none)
hline(0.5,  "Strong buy",  color = ${GUIDE}, linestyle = hline.style_dotted)
hline(0.1,  "Buy",         color = ${GUIDE}, linestyle = hline.style_dotted)
hline(-0.1, "Sell",        color = ${GUIDE}, linestyle = hline.style_dotted)
hline(-0.5, "Strong sell", color = ${GUIDE}, linestyle = hline.style_dotted)`,
  },

  /* ---- Bands --------------------------------------------------------------------- */
  {
    slug: 'median',
    group: 'Bands',
    title: 'Median',
    description: 'The median of the bar midpoints, its own EMA, and ATR bands either side — the cloud greens over its EMA',
    source: `//@version=6
indicator("Median", overlay = true)

src    = input.source(hl2, "Median source")
medLen = input.int(3, "Median length", minval = 1)
atrLen = input.int(14, "ATR length", minval = 1)
atrMul = input.float(2.0, "ATR multiplier", minval = 0, step = 0.1)

med  = ta.percentile_nearest_rank(src, medLen, 50)
band = atrMul * ta.atr(atrLen)
medEma = ta.ema(med, medLen)
m = plot(med, "Median", color = #FF9500, linewidth = 2)
e = plot(medEma, "Median EMA", color = #C7A9CF)
fill(m, e, color = med > medEma ? color.new(#30D158, 85) : color.new(#BB86FC, 85), title = "Trend cloud")
plot(med + band, "Upper band", color = color.new(#30D158, 30))
plot(med - band, "Lower band", color = color.new(#BB86FC, 30))`,
  },
  {
    slug: 'ma-channel',
    group: 'Bands',
    title: 'Moving Average Channel',
    description: 'An average of the highs over the bars and an average of the lows under them',
    source: `//@version=6
indicator("Moving Average Channel", overlay = true)

upLen = input.int(20, "Upper length", minval = 1)
loLen = input.int(20, "Lower length", minval = 1)
upOff = input.int(0, "Upper offset")
loOff = input.int(0, "Lower offset")

u = plot(ta.sma(high, upLen), "Upper", color = #5B9CF6, offset = upOff)
l = plot(ta.sma(low, loLen),  "Lower", color = #FF9500, offset = loOff)
fill(u, l, color = color.new(#5B9CF6, 94), title = "Channel")`,
  },
  {
    slug: 'price-channel',
    group: 'Bands',
    title: 'Price Channel',
    description: 'The highest high and lowest low over the bars, with the midline between them',
    source: `//@version=6
indicator("Price Channel", overlay = true)

len = input.int(20, "Length", minval = 1)
off = input.int(0, "Offset")

hh = ta.highest(high, len)
ll = ta.lowest(low, len)
plot(hh, "Upper", color = #FF3B30, offset = off)
plot(ll, "Lower", color = #30D158, offset = off)
plot(math.avg(hh, ll), "Center", color = #5B9CF6, offset = off)`,
  },
  {
    slug: 'standard-error-bands',
    group: 'Bands',
    title: 'Standard Error Bands',
    description: 'A regression line with bands two standard errors either side, both lightly smoothed — tight while price hugs its trend',
    source: `//@version=6
indicator("Standard Error Bands", overlay = true)

len  = input.int(21, "Length", minval = 3)
mult = input.float(2.0, "Standard errors", minval = 0.1, step = 0.1)
smo  = input.int(3, "Smoothing", minval = 1)
src  = input.source(close, "Source")

// the residuals' sum of squares is the spread about the mean less what the slope explains
stdErr(s, n) =>
    slope = ta.linreg(s, n, 0) - ta.linreg(s, n, 1)
    math.sqrt(math.max(0, n * ta.variance(s, n) - slope * slope * n * (n * n - 1) / 12.0) / (n - 2))

mid = ta.sma(ta.linreg(src, len, 0), smo)
se  = ta.sma(stdErr(src, len), smo)
plot(mid, "Middle", color = #5B9CF6)
u = plot(mid + mult * se, "Upper", color = color.new(#5B9CF6, 40))
l = plot(mid - mult * se, "Lower", color = color.new(#5B9CF6, 40))
fill(u, l, color = color.new(#5B9CF6, 94), title = "Band")`,
  },

  /* ---- Momentum ----------------------------------------------------------------- */
  {
    slug: 'momentum',
    group: 'Momentum',
    title: 'Momentum',
    description: 'This close less the close N bars ago, in price',
    source: `//@version=6
indicator("Momentum")

len = input.int(10, "Length", minval = 1)
src = input.source(close, "Source")
plot(src - src[len], "Momentum", color = #5B9CF6, linewidth = 2)
hline(0, "Zero", color = ${GUIDE})`,
  },
  {
    slug: 'roc',
    group: 'Momentum',
    title: 'Rate of Change',
    description: 'How far price has come over N bars, in percent',
    source: `//@version=6
indicator("Rate of Change")

len = input.int(9, "Length", minval = 1)
src = input.source(close, "Source")
plot(100 * (src - src[len]) / src[len], "ROC", color = #5B9CF6, linewidth = 2)
hline(0, "Zero", color = ${GUIDE})`,
  },
  {
    slug: 'ppo',
    group: 'Momentum',
    title: 'Percentage Price Oscillator',
    description: 'MACD in percent of the slow average, so it reads the same at any price',
    source: `//@version=6
indicator("Percentage Price Oscillator")

shortLen = input.int(12, "Short length", minval = 1)
longLen  = input.int(26, "Long length", minval = 1)
sigLen   = input.int(9, "Signal length", minval = 1)
src      = input.source(close, "Source")

short = ta.ema(src, shortLen)
long  = ta.ema(src, longLen)
ppo = (short - long) / long * 100
sig = ta.ema(ppo, sigLen)
hist = ppo - sig
plot(hist, "Histogram", color = hist >= 0 ? color.new(#30D158, 40) : color.new(#FF3B30, 40), style = plot.style_histogram)
plot(ppo, "PPO", color = #5B9CF6)
plot(sig, "Signal", color = #FF9500)
hline(0, "Zero", color = ${GUIDE})`,
  },
  {
    slug: 'price-oscillator',
    group: 'Momentum',
    title: 'Price Oscillator',
    description: 'The gap between a 10 and a 21-bar average, in percent of the slower one',
    source: `//@version=6
indicator("Price Oscillator")

shortLen = input.int(10, "Short length", minval = 1)
longLen  = input.int(21, "Long length", minval = 1)
useEma   = input.bool(false, "Exponential averages")
src      = input.source(close, "Source")

short = useEma ? ta.ema(src, shortLen) : ta.sma(src, shortLen)
long  = useEma ? ta.ema(src, longLen) : ta.sma(src, longLen)
plot((short - long) / long * 100, "Oscillator", color = #6BD3C7, linewidth = 2)
hline(0, "Zero", color = ${GUIDE})`,
  },
  {
    slug: 'pmo',
    group: 'Momentum',
    title: 'Price Momentum Oscillator',
    description: "DecisionPoint's one-bar rate of change smoothed twice with 2/length averages, and its signal line",
    source: `//@version=6
indicator("Price Momentum Oscillator")

src  = input.source(close, "Source")
len1 = input.int(35, "Length 1", minval = 1)
len2 = input.int(20, "Length 2", minval = 1)
sigL = input.int(10, "Signal length", minval = 1)

csf(s, n) =>
    sm = 0.0
    sm := na(sm[1]) ? ta.sma(s, n) : (s - sm[1]) * (2.0 / n) + sm[1]
    sm

roc = 100 * (src - src[1]) / src[1]
pmo = csf(10 * csf(roc, len1), len2)
plot(pmo, "PMO", color = #5B9CF6, linewidth = 2)
plot(ta.ema(pmo, sigL), "Signal", color = #FF9500)
hline(0, "Zero", color = ${GUIDE})`,
  },
  {
    slug: 'special-k',
    group: 'Momentum',
    title: "Pring's Special K",
    description: 'Twelve smoothed rates of change from 10 to 530 bars, weighted 1 to 4 and summed — short, middle and long cycles in one line',
    source: `//@version=6
indicator("Pring's Special K")

src  = input.source(close, "Source")
sig1 = input.int(100, "Signal length 1", minval = 1)
sig2 = input.int(100, "Signal length 2", minval = 1)

r(n) => 100 * (src - src[n]) / src[n]
sk = ta.sma(r(10), 10) * 1 + ta.sma(r(15), 10) * 2 + ta.sma(r(20), 10) * 3 + ta.sma(r(30), 15) * 4 + ta.sma(r(40), 50) * 1 + ta.sma(r(65), 65) * 2 + ta.sma(r(75), 75) * 3 + ta.sma(r(100), 100) * 4 + ta.sma(r(195), 130) * 1 + ta.sma(r(265), 130) * 2 + ta.sma(r(390), 130) * 3 + ta.sma(r(530), 195) * 4
plot(sk, "Special K", color = #5B9CF6, linewidth = 2)
plot(ta.sma(ta.sma(sk, sig1), sig2), "Signal", color = #FF9500)
hline(0, "Zero", color = ${GUIDE})`,
  },
  {
    slug: 'trix',
    group: 'Momentum',
    title: 'TRIX',
    description: 'The one-bar change of a triple-smoothed log price, ×10000 — slow cycles with the noise taken out',
    source: `//@version=6
indicator("TRIX")

len = input.int(18, "Length", minval = 1)
t = ta.ema(ta.ema(ta.ema(math.log(close), len), len), len)
plot(10000 * (t - t[1]), "TRIX", color = #F06292, linewidth = 2)
hline(0, "Zero", color = ${GUIDE})`,
  },
  {
    slug: 'tsi',
    group: 'Momentum',
    title: 'True Strength Index',
    description: 'Double-smoothed momentum over double-smoothed absolute momentum, in percent, with its signal',
    source: `//@version=6
indicator("True Strength Index")

longLen  = input.int(25, "Long length", minval = 1)
shortLen = input.int(13, "Short length", minval = 1)
sigLen   = input.int(13, "Signal length", minval = 1)

t = 100 * ta.tsi(close, shortLen, longLen)
plot(t, "True Strength Index", color = #5B9CF6, linewidth = 2)
plot(ta.ema(t, sigLen), "Signal", color = #FF6D6D)
hline(0, "Zero", color = ${GUIDE})`,
  },
  {
    slug: 'smi-ergodic',
    group: 'Momentum',
    title: 'SMI Ergodic Indicator',
    description: "Blau's ergodic: the true strength index on 5 and 20 bars, unscaled, with a 5-bar signal",
    source: `//@version=6
indicator("SMI Ergodic Indicator")

longLen  = input.int(20, "Long length", minval = 1)
shortLen = input.int(5, "Short length", minval = 1)
sigLen   = input.int(5, "Signal line length", minval = 1)

erg = ta.tsi(close, shortLen, longLen)
plot(erg, "SMI", color = #5B9CF6, linewidth = 2)
plot(ta.ema(erg, sigLen), "Signal", color = #FF9500)
hline(0, "Zero", color = ${GUIDE})`,
  },
  {
    slug: 'smi-ergodic-osc',
    group: 'Momentum',
    title: 'SMI Ergodic Oscillator',
    description: 'The ergodic less its signal, as a histogram — the turns of the ergodic, earlier',
    source: `//@version=6
indicator("SMI Ergodic Oscillator")

longLen  = input.int(20, "Long length", minval = 1)
shortLen = input.int(5, "Short length", minval = 1)
sigLen   = input.int(5, "Signal line length", minval = 1)

erg = ta.tsi(close, shortLen, longLen)
osc = erg - ta.ema(erg, sigLen)
plot(osc, "SMI Ergodic Oscillator", color = osc >= 0 ? color.new(#30D158, 40) : color.new(#FF3B30, 40), style = plot.style_histogram)
hline(0, "Zero", color = ${GUIDE})`,
  },
  {
    slug: 'smi',
    group: 'Momentum',
    title: 'Stochastic Momentum Index',
    description: "Blau's stochastic: the close against the middle of the range, double-smoothed, ±100",
    source: `//@version=6
indicator("Stochastic Momentum Index")

lenK = input.int(10, "%K length", minval = 1)
lenD = input.int(3, "%D length", minval = 1)
lenE = input.int(10, "EMA length", minval = 1)

emaEma(s, n) => ta.ema(ta.ema(s, n), n)
hh = ta.highest(lenK)
ll = ta.lowest(lenK)
smi = 200 * (emaEma(close - (hh + ll) / 2, lenD) / emaEma(hh - ll, lenD))
plot(smi, "SMI", color = #5B9CF6, linewidth = 2)
plot(ta.ema(smi, lenE), "SMI-based EMA", color = #FF9500)
hline(40,  "Overbought", color = ${GUIDE}, linestyle = hline.style_dotted)
hline(0,   "Middle",     color = ${GUIDE})
hline(-40, "Oversold",   color = ${GUIDE}, linestyle = hline.style_dotted)`,
  },
  {
    slug: 'stoch-rsi',
    group: 'Momentum',
    title: 'Stochastic RSI',
    description: 'The stochastic run on RSI instead of price — where RSI sits in its own recent range',
    source: `//@version=6
indicator("Stochastic RSI")

smoothK = input.int(3, "K", minval = 1)
smoothD = input.int(3, "D", minval = 1)
rsiLen  = input.int(14, "RSI length", minval = 1)
stLen   = input.int(14, "Stochastic length", minval = 1)
src     = input.source(close, "RSI source")

r = ta.rsi(src, rsiLen)
k = ta.sma(ta.stoch(r, r, r, stLen), smoothK)
d = ta.sma(k, smoothD)
plot(k, "K", color = #5B9CF6)
plot(d, "D", color = #FF9500)
hline(80, "Upper",  color = ${GUIDE}, linestyle = hline.style_dotted)
hline(50, "Middle", color = color.new(#C7D3E8, 85), linestyle = hline.style_dotted)
hline(20, "Lower",  color = ${GUIDE}, linestyle = hline.style_dotted)`,
  },
  {
    slug: 'rvgi',
    group: 'Momentum',
    title: 'Relative Vigor Index',
    description: 'Where bars close inside their range, summed — a market with vigour closes near its highs',
    source: `//@version=6
indicator("Relative Vigor Index")

len = input.int(10, "Length", minval = 1)
rvi = math.sum(ta.swma(close - open), len) / math.sum(ta.swma(high - low), len)
plot(rvi, "RVGI", color = #30D158)
plot(ta.swma(rvi), "Signal", color = #FF3B30)`,
  },
  {
    slug: 'rci',
    group: 'Momentum',
    title: 'Rank Correlation Index',
    description: "Spearman's rank correlation of price against time, ±100 — +100 when every bar of the window topped the last",
    source: `//@version=6
indicator("Rank Correlation Index")

len = input.int(10, "Length", minval = 2)
src = input.source(close, "Source")
plot(ta.rci(src, len), "RCI", color = #5B9CF6, linewidth = 2)
hline(80,  "Upper", color = ${GUIDE}, linestyle = hline.style_dotted)
hline(-80, "Lower", color = ${GUIDE}, linestyle = hline.style_dotted)`,
  },
  {
    slug: 'rci-ribbon',
    group: 'Momentum',
    title: 'RCI Ribbon',
    description: 'Three rank correlation indexes, 10, 30 and 50 bars — short, middle and long trend agreement',
    source: `//@version=6
indicator("RCI Ribbon")

src = input.source(close, "Source")
s = input.int(10, "Short length", minval = 2)
m = input.int(30, "Middle length", minval = 2)
l = input.int(50, "Long length", minval = 2)

plot(ta.rci(src, s), "Short RCI",  color = #FF3B30)
plot(ta.rci(src, m), "Middle RCI", color = #30D158)
plot(ta.rci(src, l), "Long RCI",   color = #5B9CF6)
hline(80,  "Upper", color = ${GUIDE}, linestyle = hline.style_dotted)
hline(-80, "Lower", color = ${GUIDE}, linestyle = hline.style_dotted)`,
  },
  {
    slug: 'ultimate-oscillator',
    group: 'Momentum',
    title: 'Ultimate Oscillator',
    description: "Williams' buying pressure over true range on 7, 14 and 28 bars, weighted 4, 2 and 1",
    source: `//@version=6
indicator("Ultimate Oscillator")

f = input.int(7, "Fast length", minval = 1)
m = input.int(14, "Middle length", minval = 1)
s = input.int(28, "Slow length", minval = 1)

bp = close - math.min(low, close[1])
trr = math.max(high, close[1]) - math.min(low, close[1])
avgOf(n) => math.sum(bp, n) / math.sum(trr, n)
plot(100 * (4 * avgOf(f) + 2 * avgOf(m) + avgOf(s)) / 7, "UO", color = #F06292, linewidth = 2)
hline(70, "Upper", color = ${GUIDE}, linestyle = hline.style_dotted)
hline(30, "Lower", color = ${GUIDE}, linestyle = hline.style_dotted)`,
  },
  {
    slug: 'vortex',
    group: 'Momentum',
    title: 'Vortex Indicator',
    description: 'Upward and downward movement over the true range — +VI over −VI is a trend up',
    source: `//@version=6
indicator("Vortex Indicator")

len = input.int(14, "Length", minval = 2)
vmp = math.sum(math.abs(high - low[1]), len)
vmm = math.sum(math.abs(low - high[1]), len)
trs = math.sum(ta.atr(1), len)
plot(vmp / trs, "VI +", color = #5B9CF6)
plot(vmm / trs, "VI -", color = #FF3B30)`,
  },
  {
    slug: 'woodies-cci',
    group: 'Momentum',
    title: 'Woodies CCI',
    description: 'A 14-bar CCI as a histogram coloured by its run, with a 6-bar turbo CCI over it',
    source: `//@version=6
indicator("Woodies CCI")

turboLen = input.int(6, "CCI turbo length", minval = 3, maxval = 14)
cciLen   = input.int(14, "CCI 14 length", minval = 7, maxval = 20)

turbo = ta.cci(close, turboLen)
c14 = ta.cci(close, cciLen)
last5Down = c14[5] < 0 and c14[4] < 0 and c14[3] < 0 and c14[2] < 0 and c14[1] < 0
last5Up   = c14[5] > 0 and c14[4] > 0 and c14[3] > 0 and c14[2] > 0 and c14[1] > 0
histInk = last5Up ? color.new(#30D158, 50) : last5Down ? color.new(#FF3B30, 50) : c14 < 0 ? color.new(#30D158, 50) : color.new(#FF3B30, 50)
plot(c14, "CCI histogram", color = histInk, style = plot.style_columns)
plot(turbo, "CCI turbo", color = #30D158, linewidth = 2)
plot(c14, "CCI 14", color = #BBB2E8, linewidth = 2)
hline(0,    "Zero", color = ${GUIDE})
hline(100,  "+100", color = ${GUIDE}, linestyle = hline.style_dotted)
hline(200,  "+200", color = ${GUIDE}, linestyle = hline.style_dotted)
hline(-100, "-100", color = ${GUIDE}, linestyle = hline.style_dotted)
hline(-200, "-200", color = ${GUIDE}, linestyle = hline.style_dotted)`,
  },
  {
    slug: 'rsi-divergence',
    group: 'Momentum',
    title: 'RSI Divergence Indicator',
    description: 'RSI with its pivots: regular divergence where price makes a lower low and RSI a higher one (and the mirror), drawn on the pivot bar',
    source: `//@version=6
indicator("RSI Divergence Indicator")

len   = input.int(14, "RSI period", minval = 1)
src   = input.source(close, "Source")
lbR   = input.int(5, "Pivot lookback right", minval = 1)
lbL   = input.int(5, "Pivot lookback left", minval = 1)
rngHi = input.int(60, "Max of lookback range", minval = 1)
rngLo = input.int(5, "Min of lookback range", minval = 0)
plotBull = input.bool(true, "Plot bullish")
plotHiddenBull = input.bool(false, "Plot hidden bullish")
plotBear = input.bool(true, "Plot bearish")
plotHiddenBear = input.bool(false, "Plot hidden bearish")

osc = ta.rsi(src, len)
plot(osc, "RSI", color = #BBB2E8, linewidth = 2)
hline(70, "Upper", color = ${GUIDE}, linestyle = hline.style_dotted)
hline(50, "Middle", color = color.new(#C7D3E8, 85), linestyle = hline.style_dotted)
hline(30, "Lower", color = ${GUIDE}, linestyle = hline.style_dotted)

plFound = not na(ta.pivotlow(osc, lbL, lbR))
phFound = not na(ta.pivothigh(osc, lbL, lbR))
barsPl = ta.barssince(plFound[1])
barsPh = ta.barssince(phFound[1])
inRangePl = rngLo <= barsPl and barsPl <= rngHi
inRangePh = rngLo <= barsPh and barsPh <= rngHi
prevOscPl = ta.valuewhen(plFound, osc[lbR], 1)
prevLowPl = ta.valuewhen(plFound, low[lbR], 1)
prevOscPh = ta.valuewhen(phFound, osc[lbR], 1)
prevHighPh = ta.valuewhen(phFound, high[lbR], 1)

bullCond = plotBull and plFound and low[lbR] < prevLowPl and osc[lbR] > prevOscPl and inRangePl
hiddenBullCond = plotHiddenBull and plFound and low[lbR] > prevLowPl and osc[lbR] < prevOscPl and inRangePl
bearCond = plotBear and phFound and high[lbR] > prevHighPh and osc[lbR] < prevOscPh and inRangePh
hiddenBearCond = plotHiddenBear and phFound and high[lbR] < prevHighPh and osc[lbR] > prevOscPh and inRangePh

plotshape(bullCond ? osc[lbR] : na, "Bullish", shape.labelup, location.absolute, #30D158, offset = -lbR, text = "Bull", size = size.tiny)
plotshape(hiddenBullCond ? osc[lbR] : na, "Hidden bullish", shape.labelup, location.absolute, color.new(#30D158, 40), offset = -lbR, text = "H Bull", size = size.tiny)
plotshape(bearCond ? osc[lbR] : na, "Bearish", shape.labeldown, location.absolute, #FF3B30, offset = -lbR, text = "Bear", size = size.tiny)
plotshape(hiddenBearCond ? osc[lbR] : na, "Hidden bearish", shape.labeldown, location.absolute, color.new(#FF3B30, 40), offset = -lbR, text = "H Bear", size = size.tiny)
alertcondition(bullCond, "Bullish divergence", "{{ticker}} regular bullish RSI divergence")
alertcondition(bearCond, "Bearish divergence", "{{ticker}} regular bearish RSI divergence")`,
  },
  {
    slug: 'rob-booker-reversal',
    group: 'Momentum',
    title: 'Rob Booker Reversal',
    description: 'A mark where MACD crosses zero while the 70-bar stochastic is stretched the other way',
    source: `//@version=6
indicator("Rob Booker Reversal", overlay = true)

fastLen = input.int(12, "Fast MA period", minval = 1)
slowLen = input.int(26, "Slow MA period", minval = 1)
kLen    = input.int(70, "KPeriod", minval = 1)
slowing = input.int(3, "Slowing", minval = 1)
upper   = input.int(70, "Stochastic upper")
lower   = input.int(30, "Stochastic lower")

macd = ta.ema(close, fastLen) - ta.ema(close, slowLen)
k = ta.sma(ta.stoch(close, high, low, kLen), slowing)
bear = ta.crossunder(macd, 0) and k > upper
bull = ta.crossover(macd, 0) and k < lower
plotshape(bear, "Bearish reversal", shape.triangledown, location.abovebar, #FF3B30, size = size.tiny)
plotshape(bull, "Bullish reversal", shape.triangleup,   location.belowbar, #30D158, size = size.tiny)
alertcondition(bear, "Bearish reversal", "{{ticker}} MACD crossed under zero with the stochastic overbought")
alertcondition(bull, "Bullish reversal", "{{ticker}} MACD crossed over zero with the stochastic oversold")`,
  },
  {
    slug: 'rob-booker-adx-breakout',
    group: 'Trend',
    title: 'Rob Booker - ADX Breakout',
    description: 'While ADX sits under 18 the last 20 bars draw a box; a close out of the box is the breakout',
    source: `//@version=6
indicator("Rob Booker - ADX Breakout", overlay = true)

adxLen = input.int(14, "ADX smoothing", minval = 1)
diLen  = input.int(14, "DI length", minval = 1)
look   = input.int(20, "Box lookback", minval = 1)
thresh = input.float(18, "ADX threshold", minval = 0)

[dip, dim, adx] = ta.dmi(diLen, adxLen)
boxTop = ta.highest(high, look)[1]
boxBot = ta.lowest(low, look)[1]
quiet = adx < thresh
t = plot(quiet ? boxTop : na, "Box top",    color = #5B9CF6, style = plot.style_linebr)
b = plot(quiet ? boxBot : na, "Box bottom", color = #5B9CF6, style = plot.style_linebr)
fill(t, b, color = color.new(#5B9CF6, 90), title = "Box")
upOut = quiet[1] and close > boxTop and close[1] <= boxTop[1]
dnOut = quiet[1] and close < boxBot and close[1] >= boxBot[1]
plotshape(upOut, "Breakout up",   shape.triangleup,   location.belowbar, #30D158, size = size.tiny)
plotshape(dnOut, "Breakout down", shape.triangledown, location.abovebar, #FF3B30, size = size.tiny)`,
  },

  /* ---- Volume ------------------------------------------------------------------- */
  {
    slug: 'volume',
    group: 'Volume',
    title: 'Volume',
    description: 'Each bar’s volume as a column — green on an up bar, red on a down bar — with its 20-bar average',
    source: `//@version=6
indicator("Volume")

maLen = input.int(20, "MA length", minval = 1)
prevClose = input.bool(false, "Colour by the previous close")

up = prevClose ? close >= close[1] : close >= open
plot(volume, "Volume", color = up ? color.new(#30D158, 45) : color.new(#FF3B30, 45), style = plot.style_columns)
plot(ta.sma(volume, maLen), "Volume MA", color = #5B9CF6)`,
  },
  {
    slug: 'net-volume',
    group: 'Volume',
    title: 'Net Volume',
    description: 'Volume counted positive on a bar that closed up and negative on one that closed down',
    source: `//@version=6
indicator("Net Volume")

ch = close - close[1]
nv = ch > 0 ? volume : ch < 0 ? -volume : 0 * volume
plot(nv, "Net volume", color = #5B9CF6)
hline(0, "Zero", color = ${GUIDE})`,
  },
  {
    slug: 'pvt',
    group: 'Volume',
    title: 'Price Volume Trend',
    description: "A running total of each bar's volume times its percent change — OBV that weighs how far price moved",
    source: `//@version=6
indicator("Price Volume Trend")

src = input.source(close, "Source")
pvt = ta.cum((src - src[1]) / src[1] * volume)
plot(pvt, "PVT", color = #5B9CF6, linewidth = 2)`,
  },
  {
    slug: 'nvi',
    group: 'Volume',
    title: 'Negative Volume Index',
    description: "Fosback's index that only moves on bars quieter than the last — what the quiet money did — from 1000, with its 255-bar EMA",
    source: `//@version=6
indicator("Negative Volume Index")

emaLen = input.int(255, "EMA length", minval = 1)

var nvi = 1000.0
if not na(close[1]) and close[1] != 0 and volume < volume[1]
    nvi := nvi + (close - close[1]) / close[1] * nvi
plot(nvi, "NVI", color = #5B9CF6, linewidth = 2)
plot(ta.ema(nvi, emaLen), "NVI-based EMA", color = #FF9500)`,
  },
  {
    slug: 'pvi',
    group: 'Volume',
    title: 'Positive Volume Index',
    description: 'The mirror of the negative index — it only moves on bars busier than the last — from 1000, with its 255-bar EMA',
    source: `//@version=6
indicator("Positive Volume Index")

emaLen = input.int(255, "EMA length", minval = 1)

var pvi = 1000.0
if not na(close[1]) and close[1] != 0 and volume > volume[1]
    pvi := pvi + (close - close[1]) / close[1] * pvi
plot(pvi, "PVI", color = #5B9CF6, linewidth = 2)
plot(ta.ema(pvi, emaLen), "PVI-based EMA", color = #FF9500)`,
  },
  {
    slug: 'pvo',
    group: 'Volume',
    title: 'Percentage Volume Oscillator',
    description: 'The percentage price oscillator run on volume — whether participation is building or draining',
    source: `//@version=6
indicator("Percentage Volume Oscillator")

shortLen = input.int(12, "Short length", minval = 1)
longLen  = input.int(26, "Long length", minval = 1)
sigLen   = input.int(9, "Signal length", minval = 1)

short = ta.ema(volume, shortLen)
long  = ta.ema(volume, longLen)
pvo = (short - long) / long * 100
sig = ta.ema(pvo, sigLen)
hist = pvo - sig
plot(hist, "Histogram", color = hist >= 0 ? color.new(#30D158, 40) : color.new(#FF3B30, 40), style = plot.style_histogram)
plot(pvo, "PVO", color = #5B9CF6)
plot(sig, "Signal", color = #FF9500)
hline(0, "Zero", color = ${GUIDE})`,
  },
  {
    slug: 'volume-oscillator',
    group: 'Volume',
    title: 'Volume Oscillator',
    description: 'A 5-bar against a 10-bar exponential average of volume, in percent',
    source: `//@version=6
indicator("Volume Oscillator")

shortLen = input.int(5, "Short length", minval = 1)
longLen  = input.int(10, "Long length", minval = 1)

short = ta.ema(volume, shortLen)
long  = ta.ema(volume, longLen)
plot(100 * (short - long) / long, "Volume oscillator", color = #6BD3C7, linewidth = 2)
hline(0, "Zero", color = ${GUIDE})`,
  },
  {
    slug: 'relative-volume-at-time',
    group: 'Volume',
    title: 'Relative Volume at Time',
    description: 'Volume so far this session against the same time of day over the last 10 sessions — 1 is a normal day; blank until 10 sessions are loaded',
    source: `//@version=6
indicator("Relative Volume at Time")

len  = input.int(10, "Length", minval = 1)
mode = input.string("Cumulative", "Calculation mode", options = ["Cumulative", "Regular"])

[nowVol, pastVol, rel] = ta.relativeVolume(len, mode == "Cumulative")
plot(rel, "Relative volume", color = rel >= 1 ? color.new(#30D158, 40) : color.new(#FF3B30, 40), style = plot.style_columns)
plot(nowVol, "Current volume", color = #C7D3E8, display = display.none)
plot(pastVol, "Past volume", color = #C7D3E8, display = display.none)
hline(1, "Normal", color = ${GUIDE}, linestyle = hline.style_dotted)`,
  },

  /* ---- Volatility --------------------------------------------------------------- */
  {
    slug: 'mass-index',
    group: 'Volatility',
    title: 'Mass Index',
    description: "Dorsey's range expansion: a 9-bar EMA of the range over its own EMA, summed over 10 bars — a bulge past 27 warns of a turn",
    source: `//@version=6
indicator("Mass Index")

len = input.int(10, "Length", minval = 1)
span = high - low
e1 = ta.ema(span, 9)
plot(math.sum(e1 / ta.ema(e1, 9), len), "Mass index", color = #5B9CF6, linewidth = 2)`,
  },
  {
    slug: 'relative-volatility-index',
    group: 'Volatility',
    title: 'Relative Volatility Index',
    description: "Dorsey's RSI built from the standard deviation on up and on down bars — which side the volatility is on, 0 to 100",
    source: `//@version=6
indicator("Relative Volatility Index")

len = input.int(10, "Length", minval = 1)
src = input.source(close, "Source")
off = input.int(0, "Offset", minval = -500, maxval = 500)

sd = ta.stdev(src, len)
ch = src - src[1]
upper = ta.ema(ch <= 0 ? 0 : sd, 14)
lower = ta.ema(ch > 0 ? 0 : sd, 14)
plot(upper / (upper + lower) * 100, "RVI", color = #BBB2E8, linewidth = 2, offset = off)
hline(80, "Upper",  color = ${GUIDE}, linestyle = hline.style_dotted)
hline(50, "Middle", color = color.new(#C7D3E8, 85), linestyle = hline.style_dotted)
hline(20, "Lower",  color = ${GUIDE}, linestyle = hline.style_dotted)`,
  },
  {
    slug: 'ulcer-index',
    group: 'Volatility',
    title: 'Ulcer Index',
    description: 'The root-mean-square drawdown from the running 14-bar high, in percent — the pain of holding',
    source: `//@version=6
indicator("Ulcer Index")

src = input.source(close, "Source")
len = input.int(14, "Length", minval = 1)

hh = ta.highest(src, len)
dd = 100 * (src - hh) / hh
plot(math.sqrt(ta.sma(math.pow(dd, 2), len)), "Ulcer index", color = #FF6D6D, linewidth = 2)`,
  },
  {
    slug: 'volatility-close-to-close',
    group: 'Volatility',
    title: 'Volatility Close-to-Close',
    description: 'The sample deviation of log returns, annualised, in percent',
    source: `//@version=6
indicator("Volatility Close-to-Close")

len  = input.int(10, "Length", minval = 2)
year = input.int(252, "Periods per year", minval = 1)

r = math.log(close / close[1])
plot(ta.stdev(r, len, false) * math.sqrt(year) * 100, "Volatility", color = #D8BC8F, linewidth = 2)`,
  },
  {
    slug: 'volatility-zero-trend',
    group: 'Volatility',
    title: 'Volatility Zero Trend Close-to-Close',
    description: 'Close-to-close volatility taken about zero rather than the mean return — drift counts as volatility',
    source: `//@version=6
indicator("Volatility Zero Trend Close-to-Close")

len  = input.int(10, "Length", minval = 1)
year = input.int(252, "Periods per year", minval = 1)

r = math.log(close / close[1])
plot(math.sqrt(math.sum(r * r, len) / len) * math.sqrt(year) * 100, "Volatility", color = #D8BC8F, linewidth = 2)`,
  },
  {
    slug: 'volatility-ohlc',
    group: 'Volatility',
    title: 'Volatility O-H-L-C',
    description: "Garman and Klass' estimator from each bar's open, high, low and close, annualised, in percent",
    source: `//@version=6
indicator("Volatility O-H-L-C")

len  = input.int(10, "Length", minval = 1)
year = input.int(252, "Periods per year", minval = 1)

hl = math.log(high / low)
co = math.log(close / open)
v = 0.5 * hl * hl - (2 * math.log(2) - 1) * co * co
plot(math.sqrt(ta.sma(v, len)) * math.sqrt(year) * 100, "Volatility", color = #D8BC8F, linewidth = 2)`,
  },

  /* ---- Statistics ---------------------------------------------------------------- */
  {
    slug: 'standard-deviation',
    group: 'Statistics',
    title: 'Standard Deviation',
    description: 'How far the closes spread about their mean over the window, in price',
    source: `//@version=6
indicator("Standard Deviation")

len = input.int(20, "Length", minval = 1)
src = input.source(close, "Source")
plot(ta.stdev(src, len), "StdDev", color = #6BD3C7, linewidth = 2)`,
  },
  {
    slug: 'standard-error',
    group: 'Statistics',
    title: 'Standard Error',
    description: 'How far the closes sit from their own regression line over the window — small while price keeps to a trend',
    source: `//@version=6
indicator("Standard Error")

len = input.int(14, "Length", minval = 3)
src = input.source(close, "Source")

// the residuals' sum of squares is the spread about the mean less what the slope explains
slope = ta.linreg(src, len, 0) - ta.linreg(src, len, 1)
ss = math.max(0, len * ta.variance(src, len) - slope * slope * len * (len * len - 1) / 12.0)
plot(math.sqrt(ss / (len - 2)), "Standard error", color = #6BD3C7, linewidth = 2)`,
  },
  {
    slug: 'trend-strength-index',
    group: 'Statistics',
    title: 'Trend Strength Index',
    description: 'The correlation of the close with time over the window, −1 to 1 — near 1 is a clean climb',
    source: `//@version=6
indicator("Trend Strength Index")

len = input.int(14, "Length", minval = 2)
tsi = ta.correlation(close, bar_index, len)
t = plot(tsi, "Trend Strength Index", color = tsi >= 0 ? #30D158 : #FF3B30, linewidth = 2)
z = plot(0, "Zero", color = ${GUIDE}, display = display.none)
fill(t, z, color = tsi >= 0 ? color.new(#30D158, 85) : color.new(#FF3B30, 85), title = "To zero")`,
  },
  {
    slug: 'majority-rule',
    group: 'Statistics',
    title: 'Majority Rule',
    description: 'The share of the last 14 bars that closed up, in percent',
    source: `//@version=6
indicator("Majority Rule")

len = input.int(14, "Length", minval = 1)
plot(ta.sma(close > close[1] ? 1 : 0, len) * 100, "Majority rule", color = #5B9CF6, linewidth = 2)
hline(50, "Even", color = ${GUIDE}, linestyle = hline.style_dotted)`,
  },
  {
    slug: 'median-price',
    group: 'Statistics',
    title: 'Median Price',
    description: "Each bar's midpoint, (high + low) / 2, as a line",
    source: `//@version=6
indicator("Median Price", overlay = true)

plot(hl2, "Median price", color = #FF9500)`,
  },
  {
    slug: 'typical-price',
    group: 'Statistics',
    title: 'Typical Price',
    description: "Each bar's (high + low + close) / 3, as a line",
    source: `//@version=6
indicator("Typical Price", overlay = true)

plot(hlc3, "Typical price", color = #6BD3C7)`,
  },
  {
    slug: 'moon-phases',
    group: 'Statistics',
    title: 'Moon Phases',
    description: 'A mark on the bar where each new and full moon falls, from the mean lunar month — within about half a day of the true instant',
    source: `//@version=6
indicator("Moon Phases", overlay = true)

// days since the new moon of 6 January 2000, 18:14 UTC, in mean lunar months
age = ((time / 86400000.0 + 2440587.5) - 2451550.25972) / 29.530588853
phase = age - math.floor(age)
newMoon  = phase < phase[1]
fullMoon = phase >= 0.5 and phase[1] < 0.5
plotshape(newMoon,  "New moon",  shape.circle, location.abovebar, #6E7681, size = size.small)
plotshape(fullMoon, "Full moon", shape.circle, location.belowbar, #F5F5DC, size = size.small)`,
  },
];
