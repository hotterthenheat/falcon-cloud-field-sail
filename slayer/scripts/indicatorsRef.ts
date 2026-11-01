/* The indicator math the engine's snapshot is checked against (engine/tests/test_snapshot.py via
   engine/tests/fixtures/indicators_ref.json), kept here verbatim from the retired src/core/simulator.ts (2026-10-31):
   the app no longer has a simulator, and this reference is all that was still read from it. */

import type { Indicators } from '../src/types/market';

export function getIndicators(prices: number[]): Indicators {
  const len = prices.length;
  if (len < 50) return { rsi: 50, ema9: prices[len - 1], ema21: prices[len - 1], ema50: prices[len - 1], squeeze: false };

  // EMA
  const calcEMA = (period: number, prevEMA: number, curPrice: number): number => {
    const k = 2 / (period + 1);
    return curPrice * k + prevEMA * (1 - k);
  };

  let ema9 = prices[0];
  let ema21 = prices[0];
  let ema50 = prices[0];

  for (let i = 1; i < len; i++) {
    ema9 = calcEMA(9, ema9, prices[i]);
    ema21 = calcEMA(21, ema21, prices[i]);
    ema50 = calcEMA(50, ema50, prices[i]);
  }

  // RSI (14)
  let gains = 0;
  let losses = 0;
  for (let i = len - 14; i < len; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  let rsi = 50;
  if (losses === 0) rsi = 100;
  else if (gains !== 0) {
    const rs = (gains / 14) / (losses / 14);
    rsi = 100 - (100 / (1 + rs));
  }

  // TTM Squeeze Approximation: Bollinger Bands inside Keltner Channel
  const slice = prices.slice(-20);
  const sma20 = slice.reduce((a, b) => a + b, 0) / 20;
  const variance = slice.reduce((a, b) => a + Math.pow(b - sma20, 2), 0) / 20;
  const stdDev = Math.sqrt(variance);
  const atrProxy = stdDev * 0.9; // Simplified range proxy

  const bbUpper = sma20 + 2 * stdDev;
  const bbLower = sma20 - 2 * stdDev;
  const kUpper = sma20 + 1.5 * atrProxy;
  const kLower = sma20 - 1.5 * atrProxy;

  const squeeze = (bbUpper < kUpper) && (bbLower > kLower);

  return { rsi, ema9, ema21, ema50, squeeze };
}
