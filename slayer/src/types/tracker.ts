/* Bookmarked setups for live monitoring on the Tracker page. */

import type { OptionRight, ScannerKey, SleeveKey, Verdict } from './compass';

/** A setup the user has bookmarked for ongoing tracking. */
export interface TrackedSetup {
  id: string;                // reuse Setup.id
  contract: string;          // e.g. "SPY 515C"
  ticker: string;
  strike: number;
  right: OptionRight;
  scanner: ScannerKey;       // which scanner found it (the thesis lens)
  /** Which tenor it was found on; older rows carry none, read as 'odte'. */
  sleeve?: SleeveKey;
  /** The contract's own expiration, YYYY-MM-DD. Absent on rows kept before this field. */
  expiry?: string;
  trackedAt: number;         // Date.now() timestamp
  scoreAtTrack: number;      // score when user clicked "Track"
  verdictAtTrack: Verdict;   // verdict when tracked
  /** The mark on the card at the click. Absent on rows kept before this field. */
  markAtTrack?: number;
  /** The option-price stop on the card at the click. */
  stopAtTrack?: number;
  /** The ask paid, if this were a paper fill. Absent on older rows. */
  askAtTrack?: number;
  /** Bid, ask and mid at the signal. The fill is a later quote. */
  signalBid?: number;
  signalAsk?: number;
  signalMid?: number;
}
