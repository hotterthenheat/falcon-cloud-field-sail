/* The book is kept in the house sign (call-dominant gamma negative), which walls, flip and regime are picked from.
   Every gamma figure Pinpoint prints passes through here into the vendor's sign (net positive = dealers long = absorbs); inks follow the kept value. */

/** A kept gamma figure in the sign a reader knows */
export const shownGamma = (kept: number): number => (kept === 0 ? 0 : -kept);

/** A kept figure of any greek in the sign a reader sees — gamma flipped, the rest as kept */
export const shownGreek = (greek: string, kept: number): number => (greek === 'gex' ? shownGamma(kept) : kept);
