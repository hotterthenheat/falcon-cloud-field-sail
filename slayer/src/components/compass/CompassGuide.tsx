/*
  How to read the Compass board: the rules of the scan and its models, one short paragraph each. Model 1/2/3 by name
  only: no book letter and no model score (owner's rule).
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
      <p>Live quotes: each contract's national bid and ask, its greeks and implied vol, open interest, and the underlying's one-minute bars. The scan runs once, on the server, for everyone: every browser shows the same board and the same record, and it runs whether or not anyone has Compass open. It reads the names on the strip: the roots that list a same-day contract (0DTE), and the twenty roots with the full feature row (1–7 DTE). Narrowing the board to a name narrows what you see, not what is scanned. With the quotes feed down the board says so and keeps the last scan, stamped.</p>
    </Section>
    <Section title="When it scores">
      <p>Model 1 scores at every mark of every session a root trades, each name only while its own options are open: the overnight index session for SPX, XSP, VIX and RUT (20:15 to 09:25 ET, which takes in pre-market), the names with an options pre-market (SPY, QQQ, IWM, GLD and the large single names) from 07:30 ET, VIX at 09:29, every five minutes from 09:30, the 15:59 and 16:14 stops, and on to 17:00 ET where a root still trades. A call can fire on any of those marks, from the open of that session until its flat, on 0DTE and on 1–7 DTE. Outside 09:45–15:00 ET the model’s minute input is outside the minutes it was trained on; the row goes in as it is and the call says so. Model 3, the late sweep (no model score), sweeps once from 15:20 ET. A call needs Model 1 to clear its line, a bid over $0.15 and a spread at or under 8%. Model 1 calls near the money (within four strikes on the index roots and broad ETFs, or a 6% span on a single name), or on the far wing beyond that, at $1 or less and at most half its ask of 30 minutes earlier; a far-wing call always rides Model 2's exit (Model 2 riding). Each root is called once on a sleeve, on its best contract, whenever that contract clears. There is no daily cap.</p>
    </Section>
    <Section title="The record">
      <p>Every call is written to the blotter the moment it fires, with the quote it fired on. It fills at the ask of the first quote a full minute after the call. Then each minute's quote, in order: the stop (0.4678 × the fill, ratcheting up for a runner), a non-runner's take-profit at 1.50×, a 0.40% five-minute reversal of the underlying, and the 15:55 ET flat (15:50 for Model 3, which sells 3× inside 120 seconds or 2× inside 30). On an early-close day the flats come five and ten minutes before the close. Nothing is filled from a quote that was not printed. P&L is (exit − fill) × 100 per contract. No fees. Model Risk fills at the ask of the minute it fires, not a minute later, and it does not use this stop or this target.</p>
    </Section>
    <Section title="Model Risk">
      <p>Not a seat on this board. The strip above the scan is its book. It runs all day, with no session window. The range is the high and low of the last 30 minute-closes before this minute, whenever those closes printed. A close above that high buys the put, and a close under that low buys the call. One contract a book, same-day and one to seven days, five open on each book. It fills at that minute’s ask and leaves on the bid the first time the close comes back through the line it broke. It does not flatten on a clock. No stop and no 1.50× target. On the blotter it is Model Risk. The return and the P&L are the same rule as every other call.</p>
    </Section>
    <Section title="Not in the scan">
      <p>Model 4, the event 0DTE definition, is not fitted and is not called. It has no score and no seat. Nothing on this page is a Model 4 call.</p>
    </Section>
    <Section title="A missed mark">
      <p>When the quotes feed could not answer at a mark, the mark is scored afterwards from the recorded quotes at that exact instant, never later ones. A late mark is never a call and never takes a seat: what it would have called is kept as “would have called”, settled by the same rules, and shown in the study, not on the blotter. A name with no quotes at that minute is recorded as not scored.</p>
    </Section>
    <Section title="Review">
      <p>Review is a live scan, not a write-up after the close. It walks all 458 names whenever that name's own option book is open: the overnight index session, pre-market, the regular session, and the curb. A contract is saved each time a print runs 100% or more off an earlier print. The open is not the base. The low of the day is not the base. A surge of 300%, a drop of 50% from that peak, and a 100% rally off the drop are two runs, and both are kept. The bands are 100–300%, 301–800%, and 801% and up. The books are 0DTE, 1–7 DTE, and 8–30 DTE. The row keeps the quote, the sizes, IV, delta, gamma, theta, vega, the underlying, volume, and open interest when the snapshot carries them. A missing greek stays missing. It is not a model call.</p>
    </Section>
    <Section title="Study">
      <p>Study is our book. Every call Models 1, 2, 3, and Risk took, on every session, and the closest contracts the scan scored and did not take. The result is (exit − fill) × 100. The line under a call says what would have improved it. Nothing is applied without the owner.</p>
    </Section>
    <Section title="Unvalidated">
      <p>The two models are scored exactly as LightGBM scores them, and every live input is checked against its definition and against the range each tree was trained on. What cannot be checked here is that the live inputs match the rows the models were trained on: those rows, or the feature builder that made them, are not in this app. Until they are, every Model 1 call wears “Unvalidated”. One input is known to differ: range compression needs an hour of minutes, so before 10:30 ET it is missing, and the trees, which never saw it missing, read it as 0.</p>
    </Section>
  </div>
);
