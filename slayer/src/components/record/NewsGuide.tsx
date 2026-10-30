/* The News page's guide: one short section per part of the page, a small figure where a picture says it faster. */

import type { ReactNode } from 'react';
import { HEAT_INK, OPEN_INK } from './NewsMap';

const SILVER = 'rgb(var(--silver))';
const SUPREME = 'rgb(var(--supreme))';
const MUTED = '#7c8290';
const INK = 'rgb(var(--text-primary))';
const MONO = 'ui-monospace, Menlo, monospace';
const SANS = 'ui-sans-serif, system-ui, sans-serif';
const IMPACT = { high: '#D73027', medium: '#FDAE61', low: 'rgb(var(--text-muted))' };

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="px-5 py-4 border-b border-borderSubtle/60 last:border-b-0">
    <h4 className="text-t13 font-semibold text-textPrimary">{title}</h4>
    <div className="mt-2 text-t12 leading-relaxed text-textSecondary">{children}</div>
  </section>
);

const Figure = ({ children, label, h = 110 }: { children: ReactNode; label: string; h?: number }) => (
  <figure data-theme="dark" className="mt-3 rounded-md border border-borderSubtle/60 bg-panel p-2">
    <svg viewBox={`0 0 420 ${h}`} width="100%" role="img" aria-label={label} data-guide-figure>
      {children}
    </svg>
  </figure>
);

/* The square before a headline */
const SquareFigure = () => (
  <Figure label="Three headlines, each with a square before it: red for high impact, orange for medium, grey for low" h={70}>
    {[
      { y: 16, ink: IMPACT.high, head: 'NVIDIA beats; Blackwell sold out into next year', word: 'high · moves the market' },
      { y: 38, ink: IMPACT.medium, head: 'EU confirms tariffs on China-built EVs', word: 'medium · a name or a sector' },
      { y: 60, ink: IMPACT.low, head: 'UBS upgrades GE Aerospace to Buy', word: 'low · noted' },
    ].map(r => (
      <g key={r.word}>
        <rect x={12} y={r.y - 4} width={8} height={8} rx={2} fill={r.ink} />
        <text x={28} y={r.y + 3} fontSize={7.5} fill={INK} fontFamily={SANS}>
          {r.head}
        </text>
        <text x={408} y={r.y + 3} textAnchor="end" fontSize={6.5} fill={MUTED} fontFamily={MONO}>
          {r.word}
        </text>
      </g>
    ))}
  </Figure>
);

/* All news: the six tabs with their counts, the hairline under the one in hand, a followed name's chip with its bell */
const TabsFigure = () => {
  const tabs: [string, number, number][] = [
    ['ALL FINANCE · 24', 12, 1],
    ['FOLLOWING · 5', 118, 0],
    ['EARNINGS · 9', 196, 0],
    ['DATA · 4', 272, 0],
    ['ANALYST · 6', 322, 0],
    ['DEALS · 5', 384, 0],
  ];
  return (
    <Figure label="The six tabs in a line, ALL FINANCE · 24 underlined; under them a followed name's chip, NVDA with a silver bell, and the Follow a name door" h={64}>
      {tabs.map(([w, x, on]) => (
        <g key={w}>
          <text x={x} y={18} fontSize={6.5} letterSpacing={0.8} fill={on ? INK : MUTED} fontFamily={MONO}>
            {w}
          </text>
          {on === 1 && <line x1={x} x2={x + 58} y1={23} y2={23} stroke={INK} strokeWidth={1} />}
        </g>
      ))}
      <line x1={0} x2={420} y1={30} y2={30} stroke="#ffffff" strokeOpacity={0.08} />
      <text x={12} y={48} fontSize={6} letterSpacing={1} fill={MUTED} fontFamily={MONO}>
        FOLLOWING
      </text>
      <rect x={56} y={38} width={62} height={16} rx={3} fill="#ffffff" fillOpacity={0.05} stroke="#ffffff" strokeOpacity={0.14} />
      <text x={63} y={49} fontSize={7.5} fontWeight={700} fill={INK} fontFamily={MONO}>
        NVDA
      </text>
      <path d="M 98 43 a 3 3 0 0 1 6 0 v 3 l 1.5 1.5 h -9 l 1.5 -1.5 z" fill={SILVER} />
      <text x={110} y={49.5} fontSize={7} fill={MUTED} fontFamily={MONO}>
        ×
      </text>
      <rect x={126} y={38} width={70} height={16} rx={3} fill="#ffffff" fillOpacity={0.05} stroke="#ffffff" strokeOpacity={0.14} />
      <text x={133} y={49} fontSize={7} fill={INK} fontFamily={MONO}>
        + Follow a name
      </text>
      <text x={408} y={49} textAnchor="end" fontSize={6} fill={MUTED} fontFamily={MONO}>
        the bell rings in the alerts drawer
      </text>
    </Figure>
  );
};

/* The month: three cells — a date, today's number in its round, the pills in their inks, "2 more" */
const MonthFigure = () => {
  const cell = (x: number, day: string, today: boolean, pills: [string, string, string][], more?: number) => (
    <g>
      <rect x={x} y={8} width={130} height={92} fill="none" stroke="#ffffff" strokeOpacity={0.1} />
      {today && <circle cx={x + 16} cy={20} r={8} fill={INK} />}
      <text x={x + 16} y={22.5} textAnchor="middle" fontSize={7.5} fontWeight={today ? 700 : 400} fill={today ? '#0a0a0a' : INK} fontFamily={MONO}>
        {day}
      </text>
      {pills.map(([w, t, ink], i) => (
        <g key={w}>
          <rect x={x + 6} y={32 + i * 19} width={118} height={15} rx={2.5} fill={ink} fillOpacity={0.13} />
          <rect x={x + 6} y={32 + i * 19} width={1.6} height={15} fill={ink} />
          <text x={x + 12} y={42.5 + i * 19} fontSize={6.5} fontWeight={600} fill={ink} fontFamily={MONO}>
            {w}
          </text>
          <text x={x + 120} y={42.5 + i * 19} textAnchor="end" fontSize={5.5} fill={ink} fillOpacity={0.8} fontFamily={MONO}>
            {t}
          </text>
        </g>
      ))}
      {more && (
        <text x={x + 10} y={94} fontSize={6} fill={MUTED} fontFamily={MONO}>
          {more} more
        </text>
      )}
    </g>
  );
  return (
    <Figure label="Three days of the month: the 15th with Retail sales in red and TSM after the close in silver, the 16th today with FOMC in red, jobless claims in orange and 2 more, the 18th with Monthly options expiration in magenta and TSLA" h={108}>
      {cell(6, '15', false, [
        ['Retail sales m/m', '08:30', IMPACT.high],
        ['TSM', 'AMC', SILVER],
        ['WMT', 'AMC', SILVER],
      ])}
      {cell(145, '16', true, [
        ['FOMC rate decision', '14:00', IMPACT.high],
        ['Weekly jobless claims', '08:30', IMPACT.medium],
        ['Housing starts', '08:30', IMPACT.medium],
      ], 2)}
      {cell(284, '18', false, [
        ['Monthly options expiration', '16:00', SUPREME],
        ['TSLA', 'AMC', SILVER],
      ])}
    </Figure>
  );
};

export const NewsGuide = () => (
  <div data-news-guide>
    <Section title="The map">
      <p>The map sits under the story list and loads when you open it. One pin per city a story comes from, its size the count. Countries a story reaches are tinted <span style={{ color: HEAT_INK }}>copper</span>, the open story's own <span style={{ color: OPEN_INK }}>green</span>, and a pale wash marks the cash market open now. A pin takes its colour from the vendor's read — for the name, against it, or grey when that read is neutral or there is no read. Pick a story anywhere and the map flies to its city.</p>
    </Section>
    <Section title="The square">
      <p>How hard a story lands, on the wire and on the calendar.</p>
      <SquareFigure />
    </Section>
    <Section title="The flags and the numbers">
      <p><b>MAJOR</b> marks a headline Unusual Whales flags as major that is about a named listed company or the economy — a flag on a call date, a routine dividend, a "to speak at" notice or a story naming no listed company is not shown as major. <b>BOARD</b> marks one that names a stock on your Board. The default sort, What matters, puts major stories on your Board first, then the rest of your Board, then the other major ones — newest first inside each — except that a routine notice (a dividend declared, a results date, a conference slot) is not lifted for its flag. <b>At publish</b> is how the named stock had moved on the session when the story crossed: a snapshot, not today's move now. <b>Biggest move today</b>, in the head, is the regular session's change for the names the stories carry. Stories from paid legal and advice placements, adverts and token-price bot posts are left off the wire. <b>Also</b> lists the other stocks a headline names. The square says how hard a story lands: major stories and big movers land harder.</p>
    </Section>
    <Section title="All news">
      <p>Every headline, newest first, a tab per kind with its count. Follow a name and its stories gather on Following; ring its bell and the alerts drawer tells you of each one. A click opens the story beside the map.</p>
      <TabsFigure />
    </Section>
    <Section title="The month">
      <p>Every day with what is on it, all from Unusual Whales: the week's economic releases in their impact's ink (the headline ones — CPI, jobs, the Fed, GDP, PCE, retail sales, ISM — in red), the earnings of the next two weeks in silver with their slot (the same dates the Earnings page shows), FDA dates, the public schedule and the posts, and monthly options expiration in magenta. A day the feed names nothing on stays empty — nothing is filled in by rule.</p>
      <MonthFigure />
    </Section>
  </div>
);

