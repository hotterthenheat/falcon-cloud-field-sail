/*
==================================================
  SLAYER TERMINAL - WHERE THE DOOR INTO THE TERMINAL LANDS (data/openDoor.ts)

  One answer for every door into the terminal —
  the landing's launch doors, the sign-in page
  once it is done (2026-10-03): the start page,
  every time (Noah: "make it be the first thing i
  see even right now when i click the launch
  button"), unless Settings › The desk › Opens on ›
  Page names another. Read at the click, never once
  at the render, so a change in Settings counts on
  the next press. Kept apart from the landing's
  pieces so the sign-in page does not carry the
  landing's chunk for one line.
==================================================
*/

import { readDeskPrefs } from './deskPrefs';

/** The terminal's front door of old — Pulse; still the tour's first window */
export const DOOR = '/pulse';
export const START = '/start';
export const doorTo = (): string => readDeskPrefs().opensOn.page ?? START;
