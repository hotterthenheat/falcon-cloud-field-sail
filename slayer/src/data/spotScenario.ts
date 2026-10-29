
/*
==================================================
  SLAYER TERMINAL - THE SPOT SCENARIO (data/spotScenario.ts)

  "If we get to 5,880, what does the book look
  like?" — P-17, and the dollars it forces — P-18.
==================================================

  VANNA & CHARM ALREADY DO TIME AND VOL. Nobody does SPOT, and it is the
  scenario traders actually run in their heads all day. The pipeline is the
  same shape as the other two: hold the book, move one input, re-read the
  levels that fall out.

  WHAT MOVES AND WHAT DOES NOT, because this is where a scenario engine
  either earns trust or quietly lies:

    THE BOOK IS HELD FIXED. Open interest, strikes, per-contract gamma —
    all as they are now. This is a "where would the LEVELS be if price were
    there" question, not a forecast of how the book would have re-formed on
    the way. Any pretence otherwise would be modelling dealer behaviour we
    have no data for, and the panel says so in as many words.

    THE LEVELS ARE RE-PICKED, not re-scaled. The walls and the flip are
    side-of-spot reads, so moving spot moves them by CHANGING WHICH STRIKE
    WINS — exactly the thing a reader cannot do in their head. Same
    pickWalls and pickFlip every other surface uses: a scenario that
    disagreed with the live map about what a wall is would be worse than no
    scenario at all.

  P-18 — THE DOLLARS, AND THE ASSUMPTION UNDER THEM.

  Net GEX at a strike is dollars of dealer gamma per 1% move. Walking spot
  from here to there, the hedging flow is the gamma crossed along the way:

      flow = Σ_K netGex(K) · (ΔS / S) · 100        [K between here and there]

  — dollars of stock dealers must trade to stay hedged. The SIGN is the
  house convention (positive net = put-dominant = dealers short gamma = they
  chase the move), and the whole figure rests on one load-bearing
  assumption: CONTINUOUS delta hedging at that modelled sign. Real desks
  hedge in bands, on their own schedule, and some do not hedge at all. The
  panel states it, because a figure this legible is exactly the one a reader
  will over-trust if it is not labelled.

  GEX IS AN ABSTRACTION; DOLLARS OF FORCED FLOW IS NOT. That is P-18's whole
  point — the translation layer that makes the page legible to someone who
  does not speak greek.
*/

/** The assumption the panel must carry — load-bearing, so it is words. */
export const HEDGING_ASSUMPTION =
  'Assumes dealers hedge continuously, at the modelled sign, on today’s open interest as it stands. Real dealers hedge in steps and on their own schedule.';
