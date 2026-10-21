/*
==================================================
  SLAYER TERMINAL - A STRIKE'S LEVEL, IN ITS INK (components/gex/strikeRole.ts)

  The matrix and the calendar print a strike's level in the strike's own
  ink rather than in words after it (the owner, 2026-10-13: "close this
  gap … i dont want any empty or unutilized spacing" — the column was as
  wide as its widest label, "455 PUT WALL PIN", so every plain strike
  carried ~75px of empty column before its first cell). The inks are the
  ones the tape, the profile and the report already print the levels in:
  the supreme magenta, the call wall green, the put wall red, the flip
  its own; the gamma pin a dotted underline, a strike you own a silver
  one. The words stay on the strike's title and in the cards.
==================================================
*/

import { CALL_WALL, FLIP, PUT_WALL, SUPREME } from './paletteInk';

export interface StrikeRole {
  /** Every level the strike is, in words — for the title, the label and the cards */
  words: string[];
  /** The ink the strike is printed in: the first of supreme, call wall, put wall, flip it is */
  ink?: string;
  /** The underline: a strike you own (silver), else the gamma pin (dotted) */
  underline?: 'yours' | 'pin';
}

export function strikeRole(strike: number, at: { supreme?: number; callWall?: number; putWall?: number; flip?: number; pin?: number; owned?: boolean }): StrikeRole {
  const is = (v?: number) => v != null && Number.isFinite(v) && Math.abs(v - strike) < 1e-9;
  const words: string[] = [];
  let ink: string | undefined;
  if (is(at.supreme)) {
    words.push('supreme');
    ink ??= SUPREME;
  }
  if (is(at.callWall)) {
    words.push('call wall');
    ink ??= CALL_WALL;
  }
  if (is(at.putWall)) {
    words.push('put wall');
    ink ??= PUT_WALL;
  }
  if (is(at.flip)) {
    words.push('flip');
    ink ??= FLIP;
  }
  if (is(at.pin)) words.push('pin');
  if (at.owned) words.push('you own');
  return { words, ink, underline: at.owned ? 'yours' : is(at.pin) ? 'pin' : undefined };
}

/** The underline's classes — under the figures, clear of the descenders */
export const underlineClass = (u?: StrikeRole['underline']): string =>
  u === 'yours' ? 'underline decoration-silver underline-offset-[3px]' : u === 'pin' ? 'underline decoration-dotted decoration-[rgb(var(--text-muted))] underline-offset-[3px]' : '';
