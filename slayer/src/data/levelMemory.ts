/*
  Yesterday's levels, as a list. The feed does not keep yesterday's book.
  What this desk has already read is stored by New York day. The next day
  the previous read is the list. Nothing is invented.
*/

interface LevelSnap {
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

export function yesterdayLevel(ticker: string, key: keyof LevelSnap): number | null {
  const v = read()[ticker]?.previous?.levels[key];
  return v != null && v > 0 ? v : null;
}

