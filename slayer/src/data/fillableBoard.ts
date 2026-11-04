/* The fillable review for one session. Paper only. No orders.
   A row is an ask that could have been bought: bid at least $0.40, ask at least $0.50, size on both sides,
   spread at or under 8% of the mid. The move is the best sized bid in the next 20 minutes, divided by that ask, minus one.
   A one-cent prior mark is not an entry. */

import board from './fillableBoard.json';

export type FillSleeve = '0' | '1-7' | '8-30';

export interface FillableRow {
  sleeve: FillSleeve;
  contract: string;
  root: string;
  right: 'C' | 'P';
  when: string;
  ask: number;
  size: number;
  spread: number;
  later: number;
  move: number;
}

export interface FillableBoard {
  day: string;
  names: number;
  rows: FillableRow[];
}

const DAY = board as FillableBoard;

export function fillableBoard(day: string | null): FillableBoard | null {
  if (!day || day !== DAY.day) return null;
  return DAY;
}

export const FILL_LINE = 'Each book uses the same gate: bid at least $0.40, ask at least $0.50, size on both sides, spread at or under 8% of the mid. The percent is the best sized bid in the next 20 minutes divided by that ask. A one-cent contract is not on this board.';
