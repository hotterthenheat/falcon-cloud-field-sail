/*
  Canonical GEX chart colors — single source for JS-API consumers
  (lightweight-charts price lines, canvas primitives). The same values live in
  tailwind.config.ts as `flip` / `supreme` / `darkpool` tokens for class usage.
  Change here + there together, never one alone.
*/

/** Apple system green — the market's bullish voice (matches the `bull`
    tailwind token). JS-side chart code imports THIS; class-side uses `bull`. */
export const BULL = '#30D158';
/** Soft mint — the Neon candle theme's up-color, and nothing else. It used to
    ink the call-wall line too (Noah's call, 2026-07-24), reversed 2026-08-18:
    the wall line now reads in the same BULL green as every other bullish
    surface. */
export const CHART_MINT = '#CFFFB1';
/** Neon lime — the interface's voice (matches `select`). Selection, brand,
    extreme importance. Never market direction. */
/* THE ACCENT (2026-10-13): the holo silver — the lime it was is gone from the desk (tokens.css --select) */
export const LIME = '#C7D3E8';

export const CALL_WALL = '#9ED4EA'; // glacier, heavier so a 1px rung holds contrast. Green is the long-gamma sign, not the wall.
export const PUT_WALL = '#F5C542'; // ember. Red is the short-gamma sign, not the wall.
/* The flip is a dashed rule. A light grey holds on #050505; it is not a side. */
export const FLIP = '#E4E7EE';
export const SUPREME = '#FF5AF1';
export const DARK_POOL = '#2dd4bf'; // teal — institutional reference prints
export const SPOT = '#ededed'; // white — where the market is
export const FOCUS = LIME; // the silver accent — what the user clicked (selection language)

// Dealer-gamma sign, for the exposure surfaces. The partner's redesign wears
// gold = SHORT gamma / blue = LONG gamma; Noah's call (2026-08-18) keeps his
// geometry and swaps the ink to the house market pair: red = SHORT gamma
// (dealer hedging amplifies the move), green = LONG gamma (dips absorbed).
// Same values as bull/bear — named by regime so a dealer-inventory surface
// doesn't import "BULL" to paint an absorbing book.
export const SHORT_GAMMA = '#FF6B63'; // amplifying regime. Not the put wall.
export const LONG_GAMMA = BULL; // green — absorbing regime

// The alert ink — the one ORANGE on the desk, reserved for "something you
// asked to be told about". Direction pair, dealer golds, supreme magenta and
// flip blue are all spoken for; a fired alert must not impersonate any of
// them. (Arrived with the alert system, 2026-08-28.)
export const ALERT = '#FF9500';

/* The per-side inks (his Greek Surfaces / Compare pages) — decoration-tier
   categorical pair, deliberately outside the bull/bear semantic family. */
/* the two sides AS TOKENS (2026-09-16): on black the dark set is #7ABDD7 / #F5C542 exactly; on paper the
   light set cuts them (the attribution panel printed the dark inks on white). Inline styles only —
   a canvas cannot read a var(). */
export const CALL_SIDE = 'rgb(var(--glacier))'; // glacier — the call side (followed the ember/glacier ramp, 2026-08-29)
export const PUT_SIDE = 'rgb(var(--ember))'; // honey gold — the put side
