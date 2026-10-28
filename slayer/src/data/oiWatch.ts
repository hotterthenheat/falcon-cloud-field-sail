/** Strikes whose open interest at least doubled against the previous chain read. */
const slots = new Map<string, { at: number; oi: Map<number, number>; jumped: number[] }>();

export function oiDoubled(ticker: string, at: number, chain: readonly { strike: number; callOI?: number; putOI?: number }[]): number[] {
  const key = ticker.toUpperCase();
  const slot = slots.get(key);
  if (slot && slot.at === at) return slot.jumped;
  const oi = new Map<number, number>();
  for (const n of chain) oi.set(n.strike, (n.callOI ?? 0) + (n.putOI ?? 0));
  const jumped: number[] = [];
  if (slot) {
    for (const [strike, v] of oi) {
      const was = slot.oi.get(strike) ?? 0;
      if (was > 0 && v >= was * 2) jumped.push(strike);
    }
  }
  slots.set(key, { at, oi, jumped });
  return jumped;
}
