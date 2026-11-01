/* The candlestick patterns the standard desks ship as built-ins, as read-only Pine sources (group 'Candlesticks'): one
   script a pattern. "All candlestick patterns" (a switch per pattern, the bullish / bearish filter, the trend rule) is
   the chart indicator in data/candlePatterns.ts, which reads these same conditions. The bar geometry and every threshold follow the published built-in definitions: a body is "long" or "small"
   against its own 14-bar EMA, a shadow counts once it passes 5% of the body, a doji's body is under 5% of its range, a
   hammer's shadow is twice its body, and the trend before a pattern is the close against the 50-bar SMA (or the 50
   against the 200, or no rule). The marks are the runtime's plotshape labels — bullish under the bar, bearish over it,
   neutral over it in the axis ink. Hand-checked on built candles in scripts/candle-patterns-proof.ts. */

interface CandleSource {
  slug: string;
  group: 'Candlesticks';
  title: string;
  description: string;
  source: string;
}

type Lean = 'bull' | 'bear' | 'neutral';

export interface CandlePattern {
  /** The `builtin:` slug's tail and the switch's input id stem */
  key: string;
  title: string;
  /** The mark's text on the bar */
  mark: string;
  lean: Lean;
  /** Bars the pattern spans, the last one marked */
  bars: number;
  /** The condition, in Pine, over the shared helpers below */
  when: string;
  description: string;
}

/* the house's two directions and the axis ink (the classic shelf's inks) */
const INK: Record<Lean, string> = { bull: '#30D158', bear: '#FF3B30', neutral: '#C7D3E8' };

/* The shared geometry, as Pine: the trend rule, the body and its 14-bar EMA, the shadows, the doji and marubozu tests */
const HELPERS = `inkBull = ${INK.bull}
inkBear = ${INK.bear}
inkFlat = ${INK.neutral}
var trendRule = input.string("SMA50", "Detect trend based on", options = ["SMA50", "SMA50, SMA200", "No detection"], tooltip = "The trend a pattern must follow: close against the 50-bar SMA, or that and the 50 against the 200, or none")
sma50  = ta.sma(close, 50)
sma200 = ta.sma(close, 200)
C_DownTrend = trendRule == "SMA50" ? close < sma50 : trendRule == "SMA50, SMA200" ? close < sma50 and sma50 < sma200 : true
C_UpTrend   = trendRule == "SMA50" ? close > sma50 : trendRule == "SMA50, SMA200" ? close > sma50 and sma50 > sma200 : true

C_Len = 14
C_ShadowPercent = 5.0
C_ShadowEqualsPercent = 100.0
C_DojiBodyPercent = 5.0
C_Factor = 2.0

C_BodyHi = math.max(close, open)
C_BodyLo = math.min(close, open)
C_Body = C_BodyHi - C_BodyLo
C_BodyAvg = ta.ema(C_Body, C_Len)
C_SmallBody = C_Body < C_BodyAvg
C_LongBody = C_Body > C_BodyAvg
C_UpShadow = high - C_BodyHi
C_DnShadow = C_BodyLo - low
C_HasUpShadow = C_UpShadow > C_ShadowPercent / 100 * C_Body
C_HasDnShadow = C_DnShadow > C_ShadowPercent / 100 * C_Body
C_WhiteBody = open < close
C_BlackBody = open > close
C_Range = high - low
C_BodyMiddle = C_Body / 2 + C_BodyLo
C_ShadowEquals = C_UpShadow == C_DnShadow or (math.abs(C_UpShadow - C_DnShadow) / C_DnShadow * 100 < C_ShadowEqualsPercent and math.abs(C_DnShadow - C_UpShadow) / C_UpShadow * 100 < C_ShadowEqualsPercent)
C_IsDojiBody = C_Range > 0 and C_Body <= C_Range * C_DojiBodyPercent / 100
C_Doji = C_IsDojiBody and C_ShadowEquals
C_Marubozu = C_LongBody and C_UpShadow <= 5.0 / 100 * C_Body and C_DnShadow <= 5.0 / 100 * C_Body
C_IsSpinningTop = C_DnShadow >= C_Range / 100 * 34.0 and C_UpShadow >= C_Range / 100 * 34.0 and not C_IsDojiBody
C_NoUpShadow3 = C_Range * 5.0 / 100 > C_UpShadow
C_NoDnShadow3 = C_Range * 5.0 / 100 > C_DnShadow
C_HammerShape = C_SmallBody and C_Body > 0 and C_BodyLo > hl2 and C_DnShadow >= C_Factor * C_Body and not C_HasUpShadow
C_StarShape = C_SmallBody and C_Body > 0 and C_BodyHi < hl2 and C_UpShadow >= C_Factor * C_Body and not C_HasDnShadow`;

/* Every pattern of the built-in set, in the set's alphabetical order. The conditions are the definitions, term for term. */
export const CANDLE_PATTERNS: CandlePattern[] = [
  { key: 'abandoned-baby-bear', title: 'Abandoned Baby (bearish)', mark: 'AB', lean: 'bear', bars: 3, description: 'A white bar in an uptrend, a doji gapped clear above it, then a black bar gapped clear below the doji', when: 'C_UpTrend[2] and C_WhiteBody[2] and C_IsDojiBody[1] and high[2] < low[1] and C_BlackBody and low[1] > high' },
  { key: 'abandoned-baby-bull', title: 'Abandoned Baby (bullish)', mark: 'AB', lean: 'bull', bars: 3, description: 'A black bar in a downtrend, a doji gapped clear below it, then a white bar gapped clear above the doji', when: 'C_DownTrend[2] and C_BlackBody[2] and C_IsDojiBody[1] and low[2] > high[1] and C_WhiteBody and high[1] < low' },
  { key: 'dark-cloud-cover', title: 'Dark Cloud Cover', mark: 'DC', lean: 'bear', bars: 2, description: 'After a long white bar in an uptrend, a black bar opens at or over its high and closes below its middle, still inside its body', when: 'C_UpTrend[1] and C_WhiteBody[1] and C_LongBody[1] and C_BlackBody and open >= high[1] and close < C_BodyMiddle[1] and close > open[1]' },
  { key: 'doji', title: 'Doji', mark: 'D', lean: 'neutral', bars: 1, description: 'Open and close all but equal, with shadows of like length — the bar where neither side won', when: 'C_Doji and not (C_IsDojiBody and C_UpShadow <= C_Body) and not (C_IsDojiBody and C_DnShadow <= C_Body)' },
  { key: 'doji-star-bear', title: 'Doji Star (bearish)', mark: 'DS', lean: 'bear', bars: 2, description: 'A long white bar in an uptrend, then a doji whose body gaps above it', when: 'C_UpTrend and C_WhiteBody[1] and C_LongBody[1] and C_IsDojiBody and C_BodyLo > C_BodyHi[1]' },
  { key: 'doji-star-bull', title: 'Doji Star (bullish)', mark: 'DS', lean: 'bull', bars: 2, description: 'A long black bar in a downtrend, then a doji whose body gaps below it', when: 'C_DownTrend and C_BlackBody[1] and C_LongBody[1] and C_IsDojiBody and C_BodyHi < C_BodyLo[1]' },
  { key: 'downside-tasuki-gap', title: 'Downside Tasuki Gap', mark: 'DTG', lean: 'bear', bars: 3, description: 'Two black bars with a gap down between their bodies, then a white bar that rallies into the gap without closing it', when: 'C_LongBody[2] and C_SmallBody[1] and C_DownTrend and C_BlackBody[2] and C_BodyHi[1] < C_BodyLo[2] and C_BlackBody[1] and C_WhiteBody and C_BodyHi <= C_BodyLo[2] and C_BodyHi >= C_BodyHi[1]' },
  { key: 'dragonfly-doji', title: 'Dragonfly Doji', mark: 'DD', lean: 'bull', bars: 1, description: 'A doji at its high: a long lower shadow and next to no upper one', when: 'C_IsDojiBody and C_UpShadow <= C_Body' },
  { key: 'engulfing-bear', title: 'Engulfing (bearish)', mark: 'BE', lean: 'bear', bars: 2, description: 'In an uptrend, a long black body wraps the small white body before it', when: 'C_UpTrend and C_BlackBody and C_LongBody and C_WhiteBody[1] and C_SmallBody[1] and close <= open[1] and open >= close[1] and (close < open[1] or open > close[1])' },
  { key: 'engulfing-bull', title: 'Engulfing (bullish)', mark: 'BE', lean: 'bull', bars: 2, description: 'In a downtrend, a long white body wraps the small black body before it', when: 'C_DownTrend and C_WhiteBody and C_LongBody and C_BlackBody[1] and C_SmallBody[1] and close >= open[1] and open <= close[1] and (close > open[1] or open < close[1])' },
  { key: 'evening-doji-star', title: 'Evening Doji Star', mark: 'EDS', lean: 'bear', bars: 3, description: 'A long white bar, a doji gapped above it, then a long black bar closing into the first body’s lower half', when: 'C_LongBody[2] and C_IsDojiBody[1] and C_LongBody and C_UpTrend and C_WhiteBody[2] and C_BodyLo[1] > C_BodyHi[2] and C_BlackBody and C_BodyLo <= C_BodyMiddle[2] and C_BodyLo > C_BodyLo[2] and C_BodyLo[1] > C_BodyHi' },
  { key: 'evening-star', title: 'Evening Star', mark: 'ES', lean: 'bear', bars: 3, description: 'A long white bar, a small body gapped above it, then a long black bar closing into the first body’s lower half', when: 'C_LongBody[2] and C_SmallBody[1] and C_LongBody and C_UpTrend and C_WhiteBody[2] and C_BodyLo[1] > C_BodyHi[2] and C_BlackBody and C_BodyLo <= C_BodyMiddle[2] and C_BodyLo > C_BodyLo[2] and C_BodyLo[1] > C_BodyHi' },
  { key: 'falling-three-methods', title: 'Falling Three Methods', mark: 'F3M', lean: 'bear', bars: 5, description: 'A long black bar, three small white bars held inside its range, then a long black bar closing under the first', when: 'C_DownTrend[4] and C_LongBody[4] and C_BlackBody[4] and C_SmallBody[3] and C_WhiteBody[3] and open[3] > low[4] and close[3] < high[4] and C_SmallBody[2] and C_WhiteBody[2] and open[2] > low[4] and close[2] < high[4] and C_SmallBody[1] and C_WhiteBody[1] and open[1] > low[4] and close[1] < high[4] and C_LongBody and C_BlackBody and close < close[4]' },
  { key: 'falling-window', title: 'Falling Window', mark: 'FW', lean: 'bear', bars: 2, description: 'A gap down: the bar’s high under the previous bar’s low, in a downtrend', when: 'C_DownTrend[1] and C_Range != 0 and C_Range[1] != 0 and high < low[1]' },
  { key: 'gravestone-doji', title: 'Gravestone Doji', mark: 'GD', lean: 'bear', bars: 1, description: 'A doji at its low: a long upper shadow and next to no lower one', when: 'C_IsDojiBody and C_DnShadow <= C_Body' },
  { key: 'hammer', title: 'Hammer', mark: 'H', lean: 'bull', bars: 1, description: 'In a downtrend, a small body at the top of the range with a lower shadow at least twice the body and no upper shadow', when: 'C_HammerShape and C_DownTrend' },
  { key: 'hanging-man', title: 'Hanging Man', mark: 'HM', lean: 'bear', bars: 1, description: 'The hammer’s shape at the top of an uptrend', when: 'C_HammerShape and C_UpTrend' },
  { key: 'harami-cross-bear', title: 'Harami Cross (bearish)', mark: 'HC', lean: 'bear', bars: 2, description: 'A long white bar in an uptrend, then a doji held inside its body', when: 'C_LongBody[1] and C_WhiteBody[1] and C_UpTrend[1] and C_IsDojiBody and high <= C_BodyHi[1] and low >= C_BodyLo[1]' },
  { key: 'harami-cross-bull', title: 'Harami Cross (bullish)', mark: 'HC', lean: 'bull', bars: 2, description: 'A long black bar in a downtrend, then a doji held inside its body', when: 'C_LongBody[1] and C_BlackBody[1] and C_DownTrend[1] and C_IsDojiBody and high <= C_BodyHi[1] and low >= C_BodyLo[1]' },
  { key: 'harami-bear', title: 'Harami (bearish)', mark: 'BH', lean: 'bear', bars: 2, description: 'A long white bar in an uptrend, then a small black bar held inside its body', when: 'C_LongBody[1] and C_WhiteBody[1] and C_UpTrend[1] and C_BlackBody and C_SmallBody and high <= C_BodyHi[1] and low >= C_BodyLo[1]' },
  { key: 'harami-bull', title: 'Harami (bullish)', mark: 'BH', lean: 'bull', bars: 2, description: 'A long black bar in a downtrend, then a small white bar held inside its body', when: 'C_LongBody[1] and C_BlackBody[1] and C_DownTrend[1] and C_WhiteBody and C_SmallBody and high <= C_BodyHi[1] and low >= C_BodyLo[1]' },
  { key: 'inverted-hammer', title: 'Inverted Hammer', mark: 'IH', lean: 'bull', bars: 1, description: 'In a downtrend, a small body at the foot of the range with an upper shadow at least twice the body and no lower shadow', when: 'C_StarShape and C_DownTrend' },
  { key: 'kicking-bear', title: 'Kicking (bearish)', mark: 'K', lean: 'bear', bars: 2, description: 'A white marubozu, then a black marubozu gapped entirely below it', when: 'C_Marubozu[1] and C_WhiteBody[1] and C_Marubozu and C_BlackBody and low[1] > high' },
  { key: 'kicking-bull', title: 'Kicking (bullish)', mark: 'K', lean: 'bull', bars: 2, description: 'A black marubozu, then a white marubozu gapped entirely above it', when: 'C_Marubozu[1] and C_BlackBody[1] and C_Marubozu and C_WhiteBody and high[1] < low' },
  { key: 'long-lower-shadow', title: 'Long Lower Shadow', mark: 'LS', lean: 'bull', bars: 1, description: 'A lower shadow longer than three quarters of the bar’s range', when: 'C_DnShadow > C_Range / 100 * 75.0' },
  { key: 'long-upper-shadow', title: 'Long Upper Shadow', mark: 'LS', lean: 'bear', bars: 1, description: 'An upper shadow longer than three quarters of the bar’s range', when: 'C_UpShadow > C_Range / 100 * 75.0' },
  { key: 'marubozu-black', title: 'Marubozu Black', mark: 'MB', lean: 'bear', bars: 1, description: 'A long black body with no shadow to speak of either side — sellers from open to close', when: 'C_Marubozu and C_BlackBody' },
  { key: 'marubozu-white', title: 'Marubozu White', mark: 'MW', lean: 'bull', bars: 1, description: 'A long white body with no shadow to speak of either side — buyers from open to close', when: 'C_Marubozu and C_WhiteBody' },
  { key: 'morning-doji-star', title: 'Morning Doji Star', mark: 'MDS', lean: 'bull', bars: 3, description: 'A long black bar, a doji gapped below it, then a long white bar closing into the first body’s upper half', when: 'C_LongBody[2] and C_IsDojiBody[1] and C_LongBody and C_DownTrend and C_BlackBody[2] and C_BodyHi[1] < C_BodyLo[2] and C_WhiteBody and C_BodyHi >= C_BodyMiddle[2] and C_BodyHi < C_BodyHi[2] and C_BodyHi[1] < C_BodyLo' },
  { key: 'morning-star', title: 'Morning Star', mark: 'MS', lean: 'bull', bars: 3, description: 'A long black bar, a small body gapped below it, then a long white bar closing into the first body’s upper half', when: 'C_LongBody[2] and C_SmallBody[1] and C_LongBody and C_DownTrend and C_BlackBody[2] and C_BodyHi[1] < C_BodyLo[2] and C_WhiteBody and C_BodyHi >= C_BodyMiddle[2] and C_BodyHi < C_BodyHi[2] and C_BodyHi[1] < C_BodyLo' },
  { key: 'on-neck', title: 'On Neck', mark: 'ON', lean: 'bear', bars: 2, description: 'A long black bar in a downtrend, then a small white bar opening lower and closing right at the black bar’s low', when: 'C_DownTrend and C_BlackBody[1] and C_LongBody[1] and C_WhiteBody and open < close[1] and C_SmallBody and C_Range != 0 and math.abs(close - low[1]) <= C_BodyAvg * 0.05' },
  { key: 'piercing', title: 'Piercing', mark: 'P', lean: 'bull', bars: 2, description: 'After a long black bar in a downtrend, a white bar opens at or under its low and closes above its middle, still inside its body', when: 'C_DownTrend[1] and C_BlackBody[1] and C_LongBody[1] and C_WhiteBody and open <= low[1] and close > C_BodyMiddle[1] and close < open[1]' },
  { key: 'rising-three-methods', title: 'Rising Three Methods', mark: 'R3M', lean: 'bull', bars: 5, description: 'A long white bar, three small black bars held inside its range, then a long white bar closing over the first', when: 'C_UpTrend[4] and C_LongBody[4] and C_WhiteBody[4] and C_SmallBody[3] and C_BlackBody[3] and open[3] < high[4] and close[3] > low[4] and C_SmallBody[2] and C_BlackBody[2] and open[2] < high[4] and close[2] > low[4] and C_SmallBody[1] and C_BlackBody[1] and open[1] < high[4] and close[1] > low[4] and C_LongBody and C_WhiteBody and close > close[4]' },
  { key: 'rising-window', title: 'Rising Window', mark: 'RW', lean: 'bull', bars: 2, description: 'A gap up: the bar’s low over the previous bar’s high, in an uptrend', when: 'C_UpTrend[1] and C_Range != 0 and C_Range[1] != 0 and low > high[1]' },
  { key: 'shooting-star', title: 'Shooting Star', mark: 'SS', lean: 'bear', bars: 1, description: 'In an uptrend, a small body at the foot of the range with an upper shadow at least twice the body and no lower shadow', when: 'C_StarShape and C_UpTrend' },
  { key: 'spinning-top-black', title: 'Spinning Top Black', mark: 'STB', lean: 'neutral', bars: 1, description: 'A small black body with both shadows over a third of the range', when: 'C_IsSpinningTop and C_BlackBody' },
  { key: 'spinning-top-white', title: 'Spinning Top White', mark: 'STW', lean: 'neutral', bars: 1, description: 'A small white body with both shadows over a third of the range', when: 'C_IsSpinningTop and C_WhiteBody' },
  { key: 'three-black-crows', title: 'Three Black Crows', mark: '3BC', lean: 'bear', bars: 3, description: 'Three long black bars, each opening inside the last body and closing lower, with next to no lower shadows', when: 'C_LongBody and C_LongBody[1] and C_LongBody[2] and C_BlackBody and C_BlackBody[1] and C_BlackBody[2] and close < close[1] and close[1] < close[2] and open > close[1] and open < open[1] and open[1] > close[2] and open[1] < open[2] and C_NoDnShadow3 and C_NoDnShadow3[1] and C_NoDnShadow3[2]' },
  { key: 'three-white-soldiers', title: 'Three White Soldiers', mark: '3WS', lean: 'bull', bars: 3, description: 'Three long white bars, each opening inside the last body and closing higher, with next to no upper shadows', when: 'C_LongBody and C_LongBody[1] and C_LongBody[2] and C_WhiteBody and C_WhiteBody[1] and C_WhiteBody[2] and close > close[1] and close[1] > close[2] and open < close[1] and open > open[1] and open[1] < close[2] and open[1] > open[2] and C_NoUpShadow3 and C_NoUpShadow3[1] and C_NoUpShadow3[2]' },
  { key: 'tri-star-bear', title: 'Tri-Star (bearish)', mark: '3S', lean: 'bear', bars: 3, description: 'Three dojis in an uptrend, the middle one’s body gapped above the other two', when: 'C_Doji[2] and C_Doji[1] and C_Doji and C_UpTrend[2] and C_BodyHi[2] < C_BodyLo[1] and C_BodyLo[1] > C_BodyHi' },
  { key: 'tri-star-bull', title: 'Tri-Star (bullish)', mark: '3S', lean: 'bull', bars: 3, description: 'Three dojis in a downtrend, the middle one’s body gapped below the other two', when: 'C_Doji[2] and C_Doji[1] and C_Doji and C_DownTrend[2] and C_BodyLo[2] > C_BodyHi[1] and C_BodyHi[1] < C_BodyLo' },
  { key: 'tweezer-bottom', title: 'Tweezer Bottom', mark: 'TB', lean: 'bull', bars: 2, description: 'A long black bar then a white bar printing the same low, within 5% of the average body, in a downtrend', when: 'C_DownTrend[1] and (not C_IsDojiBody or (C_HasUpShadow and C_HasDnShadow)) and math.abs(low - low[1]) <= C_BodyAvg * 0.05 and C_BlackBody[1] and C_WhiteBody and C_LongBody[1]' },
  { key: 'tweezer-top', title: 'Tweezer Top', mark: 'TT', lean: 'bear', bars: 2, description: 'A long white bar then a black bar printing the same high, within 5% of the average body, in an uptrend', when: 'C_UpTrend[1] and (not C_IsDojiBody or (C_HasUpShadow and C_HasDnShadow)) and math.abs(high - high[1]) <= C_BodyAvg * 0.05 and C_WhiteBody[1] and C_BlackBody and C_LongBody[1]' },
  { key: 'upside-tasuki-gap', title: 'Upside Tasuki Gap', mark: 'UTG', lean: 'bull', bars: 3, description: 'Two white bars with a gap up between their bodies, then a black bar that dips into the gap without closing it', when: 'C_LongBody[2] and C_SmallBody[1] and C_UpTrend and C_WhiteBody[2] and C_BodyLo[1] > C_BodyHi[2] and C_WhiteBody[1] and C_BlackBody and C_BodyLo >= C_BodyHi[2] and C_BodyLo <= C_BodyLo[1]' },
];

const LEAN_WORD: Record<Lean, string> = { bull: 'Bullish', bear: 'Bearish', neutral: 'Neutral' };

/** The mark for one pattern: a label under the bar for bullish, over it for bearish and neutral */
const markLine = (p: CandlePattern, cond: string) =>
  p.lean === 'bull'
    ? `plotshape(${cond}, "${p.title}", shape.labelup, location.belowbar, color = inkBull, text = "${p.mark}", size = size.small)`
    : `plotshape(${cond}, "${p.title}", shape.labeldown, location.abovebar, color = ${p.lean === 'bear' ? 'inkBear' : 'inkFlat'}, text = "${p.mark}", size = size.small)`;

function oneSource(p: CandlePattern): string {
  return `//@version=6
indicator("${p.title}", overlay = true)

${HELPERS}

pattern = ${p.when}
${markLine(p, 'pattern')}
alertcondition(pattern, "${p.title}", "{{ticker}}: ${p.title} on the last bar")`;
}

/** The shelf's scripts: "All candlestick patterns" first, then one a pattern */
/** The shelf's scripts, one a pattern. "All candlestick patterns" is the chart indicator in data/candlePatterns.ts — the
    same conditions, run natively, since all of them at once outran the runtime's budget. */
export const CANDLE_SOURCES: CandleSource[] = CANDLE_PATTERNS.map(p => ({
  slug: `candle-${p.key}`,
  group: 'Candlesticks' as const,
  title: p.title,
  description: `${LEAN_WORD[p.lean]} · ${p.bars} bar${p.bars === 1 ? '' : 's'}. ${p.description}`,
  source: oneSource(p),
}));
