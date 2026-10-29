/* The book is kept in the house sign (core/dealerSign.ts: the negative of the dealer figure, one model for every greek).
   Every figure Pinpoint prints passes through here into the dealer sign (gamma positive = dealers long = absorbs); inks
   follow the kept value. */
import { dealerOf } from '../../core/dealerSign';

/** A kept gamma figure in the sign a reader knows */
export const shownGamma = (kept: number): number => dealerOf(kept);

/** A kept figure of any greek in the sign a reader sees: every greek is kept the same way, so every greek turns the same way */
export const shownGreek = (_greek: string, kept: number): number => dealerOf(kept);
