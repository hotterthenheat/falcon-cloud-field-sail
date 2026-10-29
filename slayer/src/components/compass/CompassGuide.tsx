/*
  How to read the Compass board: the rules of the scan and the books, one short paragraph each.
*/

import type { ReactNode } from 'react';

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="px-5 py-4 border-b border-borderSubtle/60 last:border-b-0">
    <h4 className="text-t13 font-semibold text-textPrimary">{title}</h4>
    <div className="mt-2 text-t12 leading-relaxed text-textSecondary">{children}</div>
  </section>
);

export const CompassGuide = () => (
  <div data-compass-guide>
    <Section title="The book">
      <p>Calls and puts, two across. 0DTE carries the stop and the targets, and it stays up until that contract's own close, not 15:00. 1–7 DTE is the same book one week out. Nothing further out. The session card is the hours on the chart: regular, pre-market, after hours, overnight.</p>
    </Section>
    <Section title="The window">
      <p>The scan follows each root’s own option session, overnight and pre-market included where the root trades; outside it the board names the next open. Bid over $0.15, spread at or under 8%, ATM ± 4. One name a session, five open. The fill is the ask on the first quote a full minute after the call. The 0DTE stop is that ask times (1 − 0.5322). A stop, a target, the close, a broken level, or a failed check leaves the board and lands on the blotter as a win or a loss. If the book flips to the other side, even at +20%, it leaves as a caution. That is the choice, not an order, and it is not a loss. SPX and RUT are on 0DTE every session. VIX is on 0DTE only on Tuesday. Nasdaq is not on this book.</p>
    </Section>
  </div>
);

export default CompassGuide;
