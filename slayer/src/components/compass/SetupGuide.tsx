/*
  How to read a setup's page, one short paragraph per part.
*/

import type { ReactNode } from 'react';

const SILVER = 'rgb(var(--silver))'; /* the silver token — deep steel on the light terminal */
const BULL = 'rgb(var(--bull))';
const BEAR = 'rgb(var(--bear))';
const WARN = 'rgb(var(--warn))';
const MUTED = '#7c8290';
const SECOND = 'rgb(var(--text-secondary))';
const INK = 'rgb(var(--text-primary))';
const MONO = 'ui-monospace, Menlo, monospace';

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

/* The chart: candles, three target lines, the amber entry line, the floor */
const ChartFigure = () => {
  const candles = [52, 50, 54, 57, 55, 60, 63, 61, 66, 64, 69, 72, 70, 74, 71, 76];
  return (
    <Figure label="Candles with full lines for TP1, TP2, TP3, an amber entry line, and a red stop" h={104}>
      {candles.map((c, i) => {
        const x = 14 + i * 22;
        const o = c - 3 + ((i * 7) % 5);
        const up = c >= o;
        const top = 90 - Math.max(c, o);
        const hgt = Math.max(2, Math.abs(c - o));
        return (
          <g key={i}>
            <line x1={x + 4} x2={x + 4} y1={90 - Math.max(c, o) - 3} y2={90 - Math.min(c, o) + 3} stroke={up ? BULL : BEAR} strokeWidth={1} />
            <rect x={x} y={top} width={8} height={hgt} fill={up ? BULL : BEAR} fillOpacity={0.85} />
          </g>
        );
      })}
      <line x1={8} x2={412} y1={18} y2={18} stroke={BULL} strokeOpacity={0.7} strokeWidth={1} />
      <text x={408} y={16} textAnchor="end" fontSize={6.5} fontWeight={700} fill={BULL} fontFamily={MONO}>
        TP3  1.68
      </text>
      <line x1={8} x2={412} y1={30} y2={30} stroke={BULL} strokeOpacity={0.8} strokeWidth={1} />
      <text x={408} y={28} textAnchor="end" fontSize={6.5} fontWeight={700} fill={BULL} fontFamily={MONO}>
        TP2  1.31
      </text>
      <line x1={8} x2={412} y1={42} y2={42} stroke={BULL} strokeWidth={1} />
      <text x={408} y={40} textAnchor="end" fontSize={6.5} fontWeight={700} fill={BULL} fontFamily={MONO}>
        TP1  1.02
      </text>
      <line x1={8} x2={412} y1={68} y2={68} stroke={WARN} strokeWidth={1.25} />
      <text x={408} y={66} textAnchor="end" fontSize={6.5} fontWeight={700} fill={WARN} fontFamily={MONO}>
        ENTRY  0.75
      </text>
      <line x1={8} x2={412} y1={96} y2={96} stroke={BEAR} strokeOpacity={0.75} strokeWidth={1} />
      <text x={408} y={94} textAnchor="end" fontSize={6.5} fontWeight={700} fill={BEAR} fontFamily={MONO}>
        STOP  0.48
      </text>
    </Figure>
  );
};

/* The take profits: far one on top, then the stop. The entry stays on the chart. */
const TargetsFigure = () => (
  <Figure label="Take profits named on the ladder, the far one on top, then the stop. No second entry." h={86}>
    <g fontFamily={MONO}>
      {[
        { y: 14, name: 'Take 3', px: '$1.68', sub: '+124% from the premium', ink: INK },
        { y: 34, name: 'Take 2', px: '$1.31', sub: '+75% from the premium', ink: INK },
        { y: 54, name: 'Take 1', px: '$1.02', sub: '+36% from the premium · working', ink: BULL },
      ].map(r => (
        <g key={r.name}>
          <line x1={12} x2={12} y1={r.y - 8} y2={r.y + 6} stroke={BULL} strokeWidth={1} />
          <text x={20} y={r.y} fontSize={8} fontWeight={700} fill={r.ink}>{r.name}</text>
          <text x={408} y={r.y} textAnchor="end" fontSize={8.5} fontWeight={700} fill={INK}>{r.px}</text>
          <text x={20} y={r.y + 9} fontSize={6.5} fill={SECOND}>{r.sub}</text>
        </g>
      ))}
      <line x1={12} x2={12} y1={70} y2={82} stroke={BEAR} strokeWidth={1} />
      <text x={20} y={78} fontSize={8} fontWeight={700} fill={BEAR}>Stop</text>
      <text x={408} y={78} textAnchor="end" fontSize={8.5} fontWeight={700} fill={BEAR}>$0.48</text>
    </g>
  </Figure>
);

/* The contracts around it: two rows, the setup's own in silver */
const AroundFigure = () => (
  <Figure label="Five strikes: a short bead, the contract, premium, delta, distance. This strike's bead is silver and longer." h={78}>
    <g fontFamily={MONO} fontSize={6.5} fill={MUTED} letterSpacing={0.6}>
      <text x={48} y={12}>CONTRACT</text>
      <text x={200} y={12} textAnchor="end">PREMIUM</text>
      <text x={270} y={12} textAnchor="end">DELTA</text>
      <text x={350} y={12} textAnchor="end">FROM SPOT</text>
    </g>
    <line x1={0} x2={420} y1={17} y2={17} stroke="#ffffff" strokeOpacity={0.08} />
    {[
      { y: 32, w: 10, ink: 'rgb(214,237,248)', name: 'NVDA 120C', prem: '1.15', d: '0.31', dist: '−1.2%', here: false },
      { y: 50, w: 22, ink: SILVER, name: 'NVDA 125C', prem: '0.84', d: '0.24', dist: '0.0%', here: true },
      { y: 68, w: 8, ink: 'rgb(214,237,248)', name: 'NVDA 130C', prem: '0.51', d: '0.16', dist: '+1.2%', here: false },
    ].map(r => (
      <g key={r.name}>
        {r.here && <rect x={0} y={r.y - 10} width={420} height={16} fill={SILVER} fillOpacity={0.05} />}
        <rect x={12} y={r.y - 2} width={r.w} height={r.here ? 3 : 2} fill={r.ink} />
        <text x={48} y={r.y} fontSize={8.5} fontWeight={r.here ? 700 : 500} fill={INK} fontFamily={MONO}>{r.name}</text>
        <text x={200} y={r.y} textAnchor="end" fontSize={8} fill={INK} fontFamily={MONO}>{r.prem}</text>
        <text x={270} y={r.y} textAnchor="end" fontSize={8} fill={SECOND} fontFamily={MONO}>{r.d}</text>
        <text x={350} y={r.y} textAnchor="end" fontSize={8} fill={SECOND} fontFamily={MONO}>{r.dist}</text>
      </g>
    ))}
  </Figure>
);

export const SetupGuide = ({ odte = true }: { odte?: boolean }) => (
  <div data-setup-guide>
    {odte ? (
      <>
        <Section title="The chart">
          <p>The contract's own prints. No prints, no candles. TP1, TP2 and TP3 are +50%, +100% and +200% from the ask. The stop is the line at −53.22% from the ask. The ask is the line across the chart.</p>
          <ChartFigure />
        </Section>
        <Section title="The targets">
          <p>Each take profit is the premium the contract can reach, and the percent from the ask you paid. TP1 is +50%, TP2 is +100%, TP3 is +200%. A hit says HIT on the line. The stop is the bid at −53.22% from that ask. The entry is the amber line on the chart, not a second price in this list.</p>
          <TargetsFigure />
        </Section>
      </>
    ) : (
      <Section title="The chart">
        <p>1–7 DTE. The same chart. The ask, the stop, and TP1 through TP3 belong to this contract.</p>
      </Section>
    )}
    <Section title="The two sides">
      <p>The contract's premium chart is on one side: the house chart, with its intervals, styles, indicators and drawing tools, the call and its exit marked on the candles. On the other: the trade card, with Track at its foot. Its first tab is why the call is on the board and which model made it — Model 1, Model 2 when it rides the call, or Model 3, the late sweep; never a score. The trade tab is what it costs, what it pays and what kills it. The contract tab is its greeks and the contract in dollars.</p>
    </Section>
    <Section title="The stages">
      <p>Under the head: called, filled, each rung the stop climbed (to the entry at 1.25×, then behind each target on a call Model 2 rides), and out — or holding. Each is stamped with its New York minute, read off the contract's recorded quotes.</p>
    </Section>
    <Section title="The strikes beside it">
      <p>This strike, four each side, and the other side of those strikes. The prints are that contract's trades. At the foot, the contracts around it on the same expiration with their live quote and whether it passes the books' checks; a row there opens that contract.</p>
      <AroundFigure />
    </Section>
  </div>
);

