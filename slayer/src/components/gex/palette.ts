/* Canonical GEX chart colours for JS consumers (lightweight-charts options, canvas primitives).
   The same values are tailwind.config.ts's `flip` / `supreme` / `darkpool`; change both together. */

/** Apple system green — the market's bullish voice (matches the `bull`
    tailwind token). JS-side chart code imports THIS; class-side uses `bull`. */
export const BULL = '#30D158';
/** Neon lime — the interface's voice (matches `select`). Selection, brand,
    extreme importance. Never market direction. */
/* The accent: holo silver (tokens.css --select). */
const LIME = '#C7D3E8';

export const CALL_WALL = '#9ED4EA'; // glacier, heavier so a 1px rung holds contrast. Green is the long-gamma sign, not the wall.
export const PUT_WALL = '#F5C542'; // ember. Red is the short-gamma sign, not the wall.
/* The flip is a dashed rule. A light grey holds on #050505; it is not a side. */
export const FLIP = '#E4E7EE';
export const SUPREME = '#FF5AF1';
export const DARK_POOL = '#2dd4bf'; // teal — institutional reference prints
export const FOCUS = LIME; // the silver accent — what the user clicked (selection language)

// The alert ink, the one orange on the desk, reserved for "something you asked to be told about".
export const ALERT = '#FF9500';

