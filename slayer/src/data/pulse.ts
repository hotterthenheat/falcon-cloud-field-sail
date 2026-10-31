/* The key-levels rail Pulse draws: the walls, spot, the pin, the flip and the supreme, one row each, with the
   dealer gamma at the nearest strike. */

import type { MarketSnapshot } from '../types/market';
import type { KeyLevelRow, KeyLevels } from '../types/gex';

function pressureAt(snapshot: MarketSnapshot, price: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (const n of snapshot.chain) {
    const d = Math.abs(n.strike - price);
    if (d < bestDist) {
      bestDist = d;
      best = Math.abs(n.netGex);
    }
  }
  return best;
}

/** The rail's rows, highest price first */
export function buildKeyLevels(snapshot: MarketSnapshot, levels: KeyLevels, pin: number): KeyLevelRow[] {
  const { spot } = snapshot;
  const dist = (price: number) => ((price - spot) / spot) * 100;
  const all: KeyLevelRow[] = [
    { kind: 'call-wall', label: 'Call Wall', price: levels.callWall, distPct: dist(levels.callWall), pressure: pressureAt(snapshot, levels.callWall) },
    { kind: 'spot', label: 'Spot', price: spot, distPct: 0, pressure: 0 },
    { kind: 'put-wall', label: 'Put Wall', price: levels.putWall, distPct: dist(levels.putWall), pressure: pressureAt(snapshot, levels.putWall) },
    { kind: 'pin', label: 'Pin Level', price: pin, distPct: dist(pin), pressure: pressureAt(snapshot, pin) },
    { kind: 'flip', label: 'Flip Level', price: levels.flip, distPct: dist(levels.flip), pressure: pressureAt(snapshot, levels.flip) },
    { kind: 'supreme', label: 'Supreme Node', price: levels.supreme, distPct: dist(levels.supreme), pressure: pressureAt(snapshot, levels.supreme) },
  ];
  const rows = all.filter(r => r.kind === 'spot' || Number.isFinite(r.price));
  // Price-descending like a ladder, spot embedded naturally
  return rows.sort((a, b) => b.price - a.price);
}
