export function isoOf(raw: unknown): string;
export function expirationsIn(body: unknown): Set<string>;
export interface VerifiedExpirations {
  /** The dates to offer: every listed date before today, then every live date with a contract behind it */
  dates: string[];
  /** Live dates the list carries with no contract behind them */
  phantom: string[];
  /** Live dates with contracts that the list does not carry yet */
  added: string[];
  /** false: no evidence could be read, the list was passed on with the last build's verdict */
  verified: boolean;
}
export function verifyExpirations(o: {
  listed: Iterable<string>;
  evidence: Array<Iterable<string> | null>;
  today: string;
  fallback?: { drop?: Iterable<string>; add?: Iterable<string> };
}): VerifiedExpirations;
export function expirationsBody(root: string, dates: readonly string[], csv: boolean): string;
