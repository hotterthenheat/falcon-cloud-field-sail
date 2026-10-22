/* Money on the Dossier, said one way (the Dossier sweep, 2026-10-22): "$2096.11B", "+4,875M" and "$0M" read as raw
   counts. Every figure is in dollars at its own scale — $2.10T, $45.1B, $649M — signed with a true minus. */

/** Millions of dollars at their own scale */
export const moneyM = (absM: number): string =>
  absM <= 0
    ? '$0'
    : absM >= 1_000_000
      ? `$${(absM / 1_000_000).toFixed(2)}T`
      : absM >= 1000
        ? `$${(absM / 1000).toFixed(absM >= 100_000 ? 0 : absM >= 10_000 ? 1 : 2)}B`
        : absM >= 1
          ? `$${absM.toFixed(0)}M`
          : `$${(absM * 1000).toFixed(0)}K`;

/** Signed millions: +$4.9B, −$649M */
export const signedM = (n: number): string => `${n > 0 ? '+' : n < 0 ? '−' : ''}${moneyM(Math.abs(n))}`;

/** Billions of dollars at their own scale */
export const moneyB = (b: number): string => moneyM(b * 1000);
