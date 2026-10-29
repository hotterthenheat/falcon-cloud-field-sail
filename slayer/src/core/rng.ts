/* One deterministic hash family, so the same seed always paints the same tape. */

import { now } from './clock';

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Uniform [0, 1) */
function h01(seed: string): number {
  return (hash(seed) % 10000) / 10000;
}

/** Approximate standard normal (Irwin–Hall over 4 draws) */
export function hGauss(seed: string): number {
  const s = h01(`${seed}-g1`) + h01(`${seed}-g2`) + h01(`${seed}-g3`) + h01(`${seed}-g4`);
  return (s - 2) * Math.sqrt(3);
}

/** Session day key — research data re-rolls once per calendar day, not per
    tick. Reads the ENGINE clock, not the wall clock, so a replay pinned to a
    historical date re-rolls exactly what that day rolled. */
export function dayKey(): string {
  const d = now();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
