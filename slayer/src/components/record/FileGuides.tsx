/*
  How to read Institutions, Shorts and ETFs. The same door Congress,
  Insiders and Stocks already use — a figure of words, not a second
  visual language.
*/

import type { ReactNode } from 'react';

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="px-5 py-4 border-b border-borderSubtle/60 last:border-b-0">
    <h4 className="text-[13px] font-semibold text-textPrimary">{title}</h4>
    <div className="mt-2 text-[12px] leading-relaxed text-textSecondary">{children}</div>
  </section>
);

export const InstitutionsGuide = () => (
  <>
    <Section title="A line">One house, one name, what the last 13F said they held. The houses are real. The lines are a sample until the feed lands — the shape is the real one.</Section>
    <Section title="The side">A line is shares, a call, or a put. That is all the filing says. It does not name a strike or an expiry, and it is not colored like a trade. The change is versus the prior filing, not versus yesterday’s close.</Section>
    <Section title="The page">A card keeps the grid to a name. A row opens the house. The stock page is its own door.</Section>
  </>
);

export const ShortsGuide = () => (
  <>
    <Section title="The print">Short interest, days to cover, the fee, and the day’s short volume. Eight percent of the float and above is the heavy book. There is no prior report on this feed, so the page does not say whether it rose.</Section>
    <Section title="A row">A card keeps the grid to that name. A row opens the short file.</Section>
  </>
);

export const EtfsGuide = () => (
  <>
    <Section title="A fund">Assets, and whether money came in or left over the last five sessions. Green is money in. Red is money out. It is not the fund’s price.</Section>
    <Section title="What it holds">The weights under the grid are that fund’s largest lines. Rates are tenors, not companies. A card keeps the grid to that fund.</Section>
    <Section title="A row">A fund’s row opens that fund, on this same desk. A holding stays on the page. It is a weight, not a door.</Section>
  </>
);
