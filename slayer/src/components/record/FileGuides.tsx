/*
  How to read Institutions, Shorts and ETFs. The same door Congress,
  Insiders and Stocks already use — a figure of words, not a second
  visual language.
*/

import type { ReactNode } from 'react';

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="px-5 py-4 border-b border-borderSubtle/60 last:border-b-0">
    <h4 className="text-t13 font-semibold text-textPrimary">{title}</h4>
    <div className="mt-2 text-t12 leading-relaxed text-textSecondary">{children}</div>
  </section>
);

export const InstitutionsGuide = () => (
  <>
    <Section title="A line">One house (a fund manager), one stock, what the house’s latest 13F filing said it held. A 13F is the quarterly holdings report every manager over $100M files with the SEC, up to 45 days after the quarter ends — so a line is a few weeks to a few months old, never today’s position. Every line is from Unusual Whales’ copy of those filings.</Section>
    <Section title="The side">A line is shares, a call, or a put. That is all the filing says. It does not name a strike or an expiry, and it is not colored like a trade. The change is versus the house’s prior filing, not versus yesterday’s close.</Section>
    <Section title="The page">A card keeps the grid to a name. A row opens the house. The stock page is its own door.</Section>
  </>
);

export const ShortsGuide = () => (
  <>
    <Section title="The numbers">
      <b>Short interest</b> is the share of the float — the stock free to trade — that has been sold short and not bought back. It settles twice a month (mid-month and month-end) and is published about ten days later, so the page always prints its as-of date, and marks it stale when a newer settlement should already be out. <b>Days to cover</b> is how many days of normal volume the shorts would need to buy every share back. The <b>fee</b> is what a short seller pays a year to borrow the shares, and <b>available</b> is how many shares are left to borrow (the feed caps it at 10M). <b>Short volume</b> is the share of a session’s volume reported as short sales — market makers’ hedges count too, so about half is ordinary. <b>Fails to deliver</b> are shares that were sold but not delivered on time.
    </Section>
    <Section title="Squeeze setup">
      A short squeeze is when shorts are forced to buy back fast and push the price up. The page reads the setup with fixed rules, and shows the facts that drove the word:
      <ul className="mt-1.5 list-disc pl-4">
        <li>Short interest ≥ 40% of the float: 3 points · ≥ 30%: 2 · ≥ 20%: 1</li>
        <li>Days to cover ≥ 10: 2 points · ≥ 5: 1</li>
        <li>Borrow fee ≥ 50% a year: 2 points · ≥ 10%: 1</li>
        <li>Under 500K shares left to borrow: 1</li>
        <li>Shares short up 20% or more since the prior report: 1</li>
        <li>On a name’s own file: short volume ≥ 50% of the last session’s full volume (not FINRA’s off-exchange share, which runs about half on any name): 1 · a fail-to-deliver day of ≥ 0.1% of the float in the last 30 days: 1</li>
      </ul>
      <p className="mt-1.5"><b>Strong</b> needs several facts at once: 6 points or more from at least three different facts, with 20% or more of the float short and a tight borrow (a fee of 10% or more, or under 500K shares left). It is rare on purpose — the screen is already the 200 heaviest shorts by share of the float, so a high short interest alone says little here. <b>Building</b> is 4 points or more from at least two facts. <b>Weak</b> is the rest. It is a setup, not a forecast: it says the shorts would be squeezed if buyers came, not that buyers will come.</p>
    </Section>
    <Section title="A row">A card keeps the grid to that name. A row opens the short file, with the session’s short volume by market and the fails to deliver.</Section>
  </>
);

export const EtfsGuide = () => (
  <>
    <Section title="A fund">Assets, and whether money came in or left over the last five sessions. Green is money in. Red is money out. It is not the fund’s price.</Section>
    <Section title="What it holds">The weights are the fund’s own holdings file — the share of the fund’s money in each line — with the date the file was taken. Rates are tenors, not companies. A card keeps the grid to that fund.</Section>
    <Section title="A row">A fund’s row opens that fund, on this same desk. A holding stays on the page. It is a weight, not a door.</Section>
  </>
);
