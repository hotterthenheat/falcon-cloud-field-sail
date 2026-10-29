/* Where every door into the terminal lands: the start page unless Settings › The desk › Opens on names another, read at the click.
   Kept apart from the landing's pieces so sign-in does not load the landing's chunk. */

import { readDeskPrefs } from './deskPrefs';

/** The terminal's front door of old — Pulse; still the tour's first window */
export const DOOR = '/pulse';
const START = '/start';
export const doorTo = (): string => readDeskPrefs().opensOn.page ?? START;
