/*
==================================================
  SLAYER TERMINAL - THE SIGN A READER SEES
  (components/gex/retailSign.ts)

  The book is KEPT in the house sign (core/walls.ts, data/uwBook.ts): call-dominant gamma NEGATIVE, put-dominant
  POSITIVE — the walls, the flip and the regime are picked off it and must stay so. A reader knows the vendor's sign:
  call gamma +, put gamma −, net positive = dealers long gamma = hedging absorbs moves. Every gamma figure Pinpoint
  PRINTS goes through here (the ship pass, 2026-10-22: the Board said SPY −$1.5B while the matrix printed put-heavy
  strikes as positive). Only gamma: the other greeks keep their own words and signs. Inks are chosen off the KEPT value
  (warm = amplifies, cool = absorbs), so colour and words never change with this — only the printed sign.
==================================================
*/

/** A kept gamma figure in the sign a reader knows */
export const shownGamma = (kept: number): number => (kept === 0 ? 0 : -kept);

/** A kept figure of any greek in the sign a reader sees — gamma flipped, the rest as kept */
export const shownGreek = (greek: string, kept: number): number => (greek === 'gex' ? shownGamma(kept) : kept);
