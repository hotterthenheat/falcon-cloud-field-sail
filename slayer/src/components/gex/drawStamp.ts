/* The stamp the Icons family has in hand — which mark the next press of the stamp tool places, and from which of the
   three sets (TradingView's Icons, Emojis and Stickers, ours drawn from plain Unicode). Its own tiny store (no React) so
   the drawings layer can read it when it makes a stamp whole, and the rail's list can set it. */

/** Our emoji: plain Unicode, drawn by the reader's own system font — no one's artwork */
export const STAMPS = ['⭐', '🚀', '🔥', '⚠️', '✅', '❌', '💰', '🎯', '📈', '📉', '🐂', '🐻', '⏰', '📌', '💡', '❓', '👀', '🧊', '⚡', '🏁'] as const;
/** Our icons: monochrome Unicode symbols, drawn in the mark's own ink */
export const ICONS = ['★', '✓', '✗', '⚑', '⚠', '▲', '▼', '◆', '●', '■', '♥', '☀', '☁', '☂', '⚙', '⌛', '✎', '♛', '☎', '✉'] as const;
/** Our stickers: emoji set on a round badge with a white rim */
export const STICKERS = ['🐂', '🐻', '🚀', '💎', '🔥', '🌙', '🎉', '💥', '🧠', '🦄', '🐋', '🍀'] as const;

export type StampSet = 'icon' | 'emoji' | 'sticker';
export const STAMP_SETS: { set: StampSet; label: string; marks: readonly string[] }[] = [
  { set: 'icon', label: 'Icons', marks: ICONS },
  { set: 'emoji', label: 'Emoji', marks: STAMPS },
  { set: 'sticker', label: 'Stickers', marks: STICKERS },
];

const KEY = 'slayer_draw_stamp_v1';
const SET_KEY = 'slayer_draw_stamp_set_v1';
const all = STAMP_SETS.flatMap(s => s.marks);
let current: string = (() => {
  try {
    const v = localStorage.getItem(KEY);
    return v && all.includes(v) ? v : STAMPS[0];
  } catch {
    return STAMPS[0];
  }
})();
let currentSet: StampSet = (() => {
  try {
    const v = localStorage.getItem(SET_KEY);
    return v === 'icon' || v === 'sticker' ? v : 'emoji';
  } catch {
    return 'emoji';
  }
})();
const listeners = new Set<() => void>();

export const getStamp = (): string => current;
export const getStampSet = (): StampSet => currentSet;
export function setStamp(s: string, set: StampSet = 'emoji'): void {
  current = s;
  currentSet = set;
  try {
    localStorage.setItem(KEY, s);
    localStorage.setItem(SET_KEY, set);
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
