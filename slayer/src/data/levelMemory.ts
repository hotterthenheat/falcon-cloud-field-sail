/*
  Yesterday's levels, as a list. The feed does not keep yesterday's book.
  What this desk has already read is stored by New York day. The next day
  the previous read is the list. Nothing is invented.
*/

export interface LevelSnap {
  callWall: number | null;
  putWall: number | null;
  flip: number | null;
  supreme: number | null;
}

interface Held {
  day: string;
  levels: LevelSnap;
  previous: { day: string; levels: LevelSnap } | null;
}

const KEY = 'slayer_level_yest_v1';

function read(): Record<string, Held> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Held>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function rememberLevels(ticker: string, day: string, levels: LevelSnap): void {
  if (!day) return;
  const all = read();
  const cur = all[ticker];
  if (cur && cur.day === day) all[ticker] = { ...cur, levels };
  else all[ticker] = { day, levels, previous: cur ? { day: cur.day, levels: cur.levels } : null };
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* full disk is the desk's own warning */
  }
}

export function yesterdayLevel(ticker: string, key: keyof LevelSnap): number | null {
  const v = read()[ticker]?.previous?.levels[key];
  return v != null && v > 0 ? v : null;
}

export function yesterdayRows(ticker: string): { key: string; from: number; to: number; pct: number }[] {
  const held = read()[ticker];
  const prev = held?.previous?.levels;
  const now = held?.levels;
  if (!prev || !now) return [];
  const keys = ['callWall', 'putWall', 'flip', 'supreme'] as const;
  const words = { callWall: 'call wall', putWall: 'put wall', flip: 'flip', supreme: 'supreme' };
  const out: { key: string; from: number; to: number; pct: number }[] = [];
  for (const k of keys) {
    const from = prev[k];
    const to = now[k];
    if (from == null || to == null || from === to || !(from > 0)) continue;
    out.push({ key: words[k], from, to, pct: (to - from) / from });
  }
  return out;
}
