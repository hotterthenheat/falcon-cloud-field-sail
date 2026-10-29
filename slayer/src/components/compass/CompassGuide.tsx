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
    <Section title="What it reads">
      <p>ThetaData: each contract's national bid and ask, its greeks and implied vol, open interest, and the underlying's one-minute bars. The scan runs once, on the server, for everyone: every browser shows the same board and the same record, and it runs whether or not anyone has Compass open. It reads the names on the strip: the roots that list a same-day contract (0DTE), and the twenty roots with the full feature row (1–7 DTE). Narrowing the board to a name narrows what you see, not what is scanned. With the terminal down the board says so and keeps the last scan, stamped.</p>
    </Section>
    <Section title="When it scores">
      <p>Book A and Book B score at every mark of every session a root trades, each name only while its own options are open: the overnight index session for SPX, XSP, VIX and RUT (20:15 to 09:25 ET, which takes in pre-market), the names with an options pre-market (SPY, QQQ, IWM, GLD and the large single names) from 07:30 ET, VIX at 09:29, every five minutes from 09:30, the 15:59 and 16:14 stops, and on to 17:00 ET where a root still trades. Outside 09:45–15:00 ET the model’s minute input is outside the minutes it was trained on; the row goes in as it is. Book C (no model) sweeps once from 15:20 ET. A call needs Model 1 at 70.67% or more, a bid over $0.15 and a spread at or under 8%. Book A is within four strikes of the money on the index roots and broad ETFs, or a 6% span on a single name; Book B is the far wing beyond that, at $1 or less and at most half its ask of 30 minutes earlier. Five roots a session.</p>
    </Section>
    <Section title="The record">
      <p>Every call is written to the blotter the moment it fires, with the quote it fired on. It fills at the ask of the first quote a full minute after the call. Then each minute's quote, in order: the stop (0.4678 × the fill, ratcheting up for a runner), a non-runner's take-profit at 1.50×, a 0.40% five-minute reversal of the underlying, and the 15:55 ET flat (15:50 for Book C, which sells 3× inside 120 seconds or 2× inside 30). On an early-close day the flats come five and ten minutes before the close. Nothing is filled from a quote that was not printed. P&amp;L is per contract, after an estimated $1.08 round trip and the SEC fee.</p>
    </Section>
    <Section title="A missed mark">
      <p>When the terminal could not answer at a mark, the mark is scored afterwards from the quotes ThetaData recorded at that exact instant, never later ones. A late mark is never a call and never takes a seat: what it would have called is kept as “would have called”, settled by the same rules, and shown in the session review and the study, not on the blotter. A name ThetaData had no quotes for at that minute is recorded as not scored.</p>
    </Section>
    <Section title="After the close">
      <p>Once the session settles, every trade it took, and every one a late mark would have taken, is reviewed: the entry (the inputs, Model 1 and Model 2, the inputs that pushed the score most), what happened after (the underlying, implied vol, the mid, the spread paid, the decay) and the cause. The study finds every contract in the scan’s band that made a 50%+ move, what the model read at that mark and what stopped it, labels every scored row with what actually happened, and suggests changes with their evidence. Nothing is applied without the owner.</p>
    </Section>
    <Section title="Unvalidated">
      <p>The two models are scored exactly as LightGBM scores them, and every live input is checked against its definition and against the range each tree was trained on. What cannot be checked here is that the live inputs match the rows the models were trained on: those rows, or the feature builder that made them, are not in this app. Until they are, every Book A and Book B call wears “Unvalidated”. One input is known to differ: range compression needs an hour of minutes, so before 10:30 ET it is missing, and the trees, which never saw it missing, read it as 0.</p>
    </Section>
  </div>
);
