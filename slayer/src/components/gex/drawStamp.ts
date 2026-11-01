/* The stamp the Icons family has in hand — which emoji the next press of the stamp tool places. Its own tiny store (no
   React) so the drawings layer can read it when it makes a stamp whole, and the rail's list can set it. */

/** Our stamps: plain Unicode, drawn by the reader's own system font — no one's artwork */
export const STAMPS = ['⭐', '🚀', '🔥', '⚠️', '✅', '❌', '💰', '🎯', '📈', '📉', '🐂', '🐻', '⏰', '📌', '💡', '❓', '👀', '🧊', '⚡', '🏁'] as const;

const KEY = 'slayer_draw_stamp_v1';
let current: string = (() => {
  try {
    const v = localStorage.getItem(KEY);
    return v && (STAMPS as readonly string[]).includes(v) ? v : STAMPS[0];
  } catch {
    return STAMPS[0];
  }
})();
const listeners = new Set<() => void>();

export const getStamp = (): string => current;
export function setStamp(s: string): void {
  current = s;
  try {
    localStorage.setItem(KEY, s);
  } catch {
    /* storage off — the choice lives for the session */
  }
  listeners.forEach(fn => fn());
}
export function subscribeStamp(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
