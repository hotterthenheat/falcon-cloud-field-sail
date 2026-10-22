/*
==================================================
  SLAYER TERMINAL - HOW TO READ TRACE
  (components/trace/TraceGuide.tsx)

  The Trace pages' guides in the house pattern: a
  figure per thing, the surface drawn small in its
  own inks, one sentence under each. The figures
  are shared — a contract door, the ink registers,
  the lean bar, the three flow shares — and each
  page assembles its own from them.
==================================================
*/

import type { ReactNode } from 'react';
import { expiryLabel } from '../../core/format';
import { tapeSessionIso } from '../../data/traceLive';

const SILVER = 'rgb(var(--silver))'; /* the silver token — deep steel on the light terminal (2026-09-12) */
const SUPREME = 'rgb(var(--supreme))';
const BULL = 'rgb(var(--bull))';
const BEAR = 'rgb(var(--bear))';
const WARN = 'rgb(var(--warn))';
const MUTED = '#7c8290';
const INK = 'rgb(var(--text-primary))';
const SECOND = 'rgb(var(--text-secondary))';
const MONO = 'ui-monospace, Menlo, monospace';
const SANS = 'ui-sans-serif, system-ui, sans-serif';

export const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="px-5 py-4 border-b border-borderSubtle/60 last:border-b-0">
    <h4 className="text-[13px] font-semibold text-textPrimary">{title}</h4>
    <div className="mt-2 text-[12px] leading-relaxed text-textSecondary">{children}</div>
  </section>
);

export const Figure = ({ children, label, h = 110 }: { children: ReactNode; label: string; h?: number }) => (
  <figure data-theme="dark" className="mt-3 rounded-md border border-borderSubtle/60 bg-panel p-2">
    <svg viewBox={`0 0 420 ${h}`} width="100%" role="img" aria-label={label} data-guide-figure>
      {children}
    </svg>
  </figure>
);

const Head = ({ x, y, children, anchor = 'start' }: { x: number; y: number; children: ReactNode; anchor?: 'start' | 'middle' | 'end' }) => (
  <text x={x} y={y} textAnchor={anchor} fontSize={6} letterSpacing={0.8} fill={MUTED} fontFamily={MONO}>
    {children}
  </text>
);

/* ---- the one rule ------------------------------------------------------------------
   BOUGHT, SOLD, BULLISH, BEARISH — ONE RULE ACROSS TRACE (the re-audit, 2026-10-22: the tape counted at-the-ask as bought
   while the dark pool tagged prints over the mid "DISTRIBUTION" in red). Said once, here, and every guide carries it. */
export const SidesRule = () => (
  <Section title="Bought, sold, bullish, bearish — one rule">
    <p>
      <b className="text-textPrimary">An option print</b> at the ask was <b className="text-textPrimary">bought</b> (the buyer paid the offer); on the bid it was <b className="text-textPrimary">sold</b>. Calls bought and puts sold read <span className="text-bull">bullish</span>; puts bought and calls sold read <span className="text-bear">bearish</span>; a mid print reads neither. So a put sold on the bid is a bullish print — "Top bull SPX 7350P sold".
    </p>
    <p className="mt-2">
      <b className="text-textPrimary">Net premium</b> is premium at the ask less premium on the bid. Net calls above zero were bought on balance (bullish, green); net puts above zero were bought (bearish, red) and below zero sold (bullish, green). Every line and figure wears its meaning's ink, not its sign's.
    </p>
    <p className="mt-2">
      <b className="text-textPrimary">A dark-pool cross</b> over the mid was paid up for — buyer-initiated — and reads <span className="text-bull">accumulation</span>; under the mid it was sold down — seller-initiated — and reads <span className="text-bear">distribution</span>; at the mid it leans neither way. Only a sized cross (10,000 shares or $500K) priced at the quote carries a read.
    </p>
    <p className="mt-2">
      <b className="text-textPrimary">After the close</b> prints keep coming against thin post-market quotes: they are labelled after hours and never read bullish, bearish, accumulation or distribution. The badge by Live says which session it is.
    </p>
  </Section>
);

/* ---- the shared figures ---------------------------------------------------------- */

/** A contract cell: the strike, call or put in its ink, the expiry — silver under the pointer is the door
    (the white line under it went on 2026-09-16) */
export const ContractFigure = () => (
  <Figure label="A contract cell drawn large: 505 call 09/10 at rest, then 497 put 09/11 with its strike in silver as under the pointer, and beside them the words that say a contract turns silver under the pointer and opens its card" h={54}>
    <text x={14} y={30} fontSize={13} fontWeight={700} fill={INK} fontFamily={MONO}>
      505
    </text>
    <text x={44} y={30} fontSize={10} fill={BULL} fontFamily={MONO}>
      call
    </text>
    <text x={70} y={30} fontSize={8} fill={MUTED} fontFamily={MONO}>
      09/10/2026
    </text>
    {/* the second one under the pointer: the strike in silver, nothing else moves */}
    <text x={150} y={30} fontSize={13} fontWeight={700} fill="rgb(var(--silver))" fontFamily={MONO}>
      497
    </text>
    <text x={180} y={30} fontSize={10} fill={BEAR} fontFamily={MONO}>
      put
    </text>
    <text x={200} y={30} fontSize={8} fill={MUTED} fontFamily={MONO}>
      09/11/2026
    </text>
    <text x={290} y={27} fontSize={7} fill={SECOND} fontFamily={SANS}>
      the strike, the side in its ink, the expiry;
    </text>
    <text x={290} y={38} fontSize={7} fill={SECOND} fontFamily={SANS}>
      silver under the pointer — click to open the contract's card
    </text>
  </Figure>
);

/** The ink registers: quiet, heavy, direction, the one supreme */
export const InkFigure = () => (
  <Figure label="Five sample figures in their inks: a quiet grey 8,412; a heavy white 48,210; a green +2,940; a red −8,113; a magenta 274,641 — each with the rule beside it" h={98}>
    {[
      { y: 18, sample: '8,412', ink: SECOND, bold: false, word: "the column's usual run" },
      { y: 36, sample: '48,210', ink: INK, bold: true, word: 'heavy — the top fifth of what is on screen' },
      { y: 54, sample: '+2,940', ink: BULL, bold: false, word: 'a signed figure, once it is heavy' },
      { y: 72, sample: '−8,113', ink: BEAR, bold: false, word: 'the same, leaning the other way' },
      { y: 90, sample: '274,641', ink: SUPREME, bold: true, word: 'the single largest on screen' },
    ].map(r => (
      <g key={r.sample}>
        <text x={80} y={r.y} textAnchor="end" fontSize={9} fontWeight={r.bold ? 700 : 400} fill={r.ink} fontFamily={MONO}>
          {r.sample}
        </text>
        <text x={96} y={r.y} fontSize={7} fill={SECOND} fontFamily={SANS}>
          {r.word}
        </text>
      </g>
    ))}
  </Figure>
);

/** The lean bar: how much of a contract's volume printed at the ask against the bid */
export const LeanFigure = () => (
  <Figure label="Three lean bars in one ink: ASK 74% with the bar reaching most of the way from the right, MID half, BID 66% a short reach — with the words: at the ask means buyers paid up, at the bid means sellers hit; a side is not a direction" h={70}>
    {[
      { y: 18, ask: 74, word: 'ASK 74% — three quarters of the volume paid the offer: buyers lifting' },
      { y: 40, ask: 50, word: 'MID — neither side pressing' },
      { y: 62, ask: 34, word: 'BID 66% — sellers hitting the bid' },
    ].map(r => (
      <g key={r.y}>
        <rect x={12} y={r.y - 3} width={70} height={4} rx={2} fill="#ffffff" fillOpacity={0.14} />
        <rect x={12 + 70 * (1 - r.ask / 100)} y={r.y - 3} width={70 * (r.ask / 100)} height={4} rx={2} fill={INK} fillOpacity={0.8} />
        <text x={90} y={r.y + 1} fontSize={6.5} letterSpacing={0.8} fill={r.ask > 55 || r.ask < 45 ? INK : SECOND} fontFamily={MONO}>
          {r.ask > 55 ? `ASK ${r.ask}%` : r.ask < 45 ? `BID ${100 - r.ask}%` : 'MID'}
        </text>
        <text x={140} y={r.y + 1} fontSize={7} fill={SECOND} fontFamily={SANS}>
          {r.word}
        </text>
      </g>
    ))}
  </Figure>
);

/** Sweep, floor, multi: the three shares of a contract's volume */
export const FlowSharesFigure = () => (
  <Figure label="Three columns of shares: SWEEP 64% in white as heavy, FLOOR 23%, MULTI 31% — each with what it counts" h={62}>
    <Head x={14} y={12}>SWEEP</Head>
    <Head x={150} y={12}>FLOOR</Head>
    <Head x={290} y={12}>MULTI</Head>
    <text x={14} y={30} fontSize={11} fontWeight={700} fill={INK} fontFamily={MONO}>
      64%
    </text>
    <text x={14} y={44} fontSize={6.5} fill={SECOND} fontFamily={SANS}>
      of the volume swept across exchanges —
    </text>
    <text x={14} y={53} fontSize={6.5} fill={SECOND} fontFamily={SANS}>
      urgency, taking every offer at once
    </text>
    <text x={150} y={30} fontSize={11} fill={SECOND} fontFamily={MONO}>
      23%
    </text>
    <text x={150} y={44} fontSize={6.5} fill={SECOND} fontFamily={SANS}>
      printed on the floor — worked orders,
    </text>
    <text x={150} y={53} fontSize={6.5} fill={SECOND} fontFamily={SANS}>
      usually institutional size
    </text>
    <text x={290} y={30} fontSize={11} fill={SECOND} fontFamily={MONO}>
      31%
    </text>
    <text x={290} y={44} fontSize={6.5} fill={SECOND} fontFamily={SANS}>
      part of a multi-leg structure —
    </text>
    <text x={290} y={53} fontSize={6.5} fill={SECOND} fontFamily={SANS}>
      a spread, not a naked bet
    </text>
  </Figure>
);

/** Open interest against volume: what was built today */
export const VolOverOiFigure = () => (
  <Figure label="Two contracts: one with volume 12,000 over open interest 5,400 reading 2.22 in bold, positions built today; one with 3,100 over 40,000 reading 0.08 grey, old positions" h={62}>
    {[
      { y: 22, vol: '12,000', oi: '5,400', ratio: '2.22', bold: true, word: 'volume past the interest — positions BUILT today' },
      { y: 48, vol: '3,100', oi: '40,000', ratio: '0.08', bold: false, word: 'a trickle against a large standing position' },
    ].map(r => (
      <g key={r.y}>
        <Head x={14} y={r.y - 10}>VOL</Head>
        <text x={14} y={r.y + 2} fontSize={9} fill={INK} fontFamily={MONO}>
          {r.vol}
        </text>
        <Head x={70} y={r.y - 10}>OI</Head>
        <text x={70} y={r.y + 2} fontSize={9} fill={SECOND} fontFamily={MONO}>
          {r.oi}
        </text>
        <Head x={130} y={r.y - 10}>VOL/OI</Head>
        <text x={130} y={r.y + 2} fontSize={9} fontWeight={r.bold ? 700 : 400} fill={r.bold ? INK : SECOND} fontFamily={MONO}>
          {r.ratio}
        </text>
        <text x={190} y={r.y + 2} fontSize={7} fill={SECOND} fontFamily={SANS}>
          {r.word}
        </text>
      </g>
    ))}
  </Figure>
);

/** The watch star at the left of a row */
export const WatchFigure = () => (
  <Figure label="A row's left edge with a bookmark mark, hollow at rest and filled in silver when the contract is under watch" h={40}>
    <path d="M 16 12 h 8 v 18 l -4 -3 l -4 3 Z" fill="none" stroke={MUTED} strokeWidth={1} />
    <text x={34} y={24} fontSize={7} fill={SECOND} fontFamily={SANS}>
      at rest
    </text>
    <path d="M 110 12 h 8 v 18 l -4 -3 l -4 3 Z" fill={SILVER} stroke={SILVER} strokeWidth={1} />
    <text x={128} y={24} fontSize={7} fill={SECOND} fontFamily={SANS}>
      under watch — it lands on the Tracker with what it has done since
    </text>
  </Figure>
);

/* ---- the pages ------------------------------------------------------------------ */

export const ScreenerGuide = () => (
  <div data-trace-guide="screener">
    <SidesRule />
    <Section title="A contract">
      <p>Every contract that traded today, one per row; the strike and side are the door to its card.</p>
      <ContractFigure />
    </Section>
    <Section title="The inks">
      <p>Each column measures its own crowd: the bulk quiet, the top fifth heavy, one magenta champion.</p>
      <InkFigure />
    </Section>
    <Section title="Built today">
      <p>Volume over open interest above one and a half means positions were opened today, not turned over.</p>
      <VolOverOiFigure />
    </Section>
    <Section title="Sweep, floor, multi">
      <p>How the volume printed: swept in a hurry, worked on the floor, or as a leg of a structure.</p>
      <FlowSharesFigure />
    </Section>
    <Section title="Lean">
      <p>Whether the volume paid the ask or hit the bid — buyers pressing or sellers — in one ink: a put bought at the ask is not bullish, so the lean never wears a direction.</p>
      <LeanFigure />
    </Section>
  </div>
);

/* ---- footprints ----------------------------------------------------------------- */

/** Open interest overnight: what stood, what stands, the change, who built it */
export const OiChangeFigure = () => (
  <Figure label="One contract's open interest: yesterday 576,487, today 681,730, the change +105,243 +18% in bold green, built on ASK 66% as a lean bar in one ink" h={58}>
    <Head x={14} y={12}>PREV OI</Head>
    <Head x={110} y={12}>OI</Head>
    <Head x={200} y={12}>ΔOI</Head>
    <Head x={290} y={12}>ΔOI %</Head>
    <Head x={344} y={12}>BUILT ON</Head>
    <text x={14} y={36} fontSize={10} fill={SECOND} fontFamily={MONO}>
      576,487
    </text>
    <text x={110} y={36} fontSize={10} fontWeight={700} fill={INK} fontFamily={MONO}>
      681,730
    </text>
    <text x={200} y={36} fontSize={10} fontWeight={700} fill={BULL} fontFamily={MONO}>
      +105,243
    </text>
    <text x={290} y={36} fontSize={10} fill={BULL} fontFamily={MONO}>
      +18%
    </text>
    <rect x={344} y={31} width={60} height={4} rx={2} fill="#ffffff" fillOpacity={0.14} />
    <rect x={364} y={31} width={40} height={4} rx={2} fill={INK} fillOpacity={0.8} />
    <text x={344} y={48} fontSize={6} letterSpacing={0.8} fill={INK} fontFamily={MONO}>
      ASK 66%
    </text>
  </Figure>
);

/** A streak: sessions in a row the interest grew */
export const StreakFigure = () => (
  <Figure label="Two rows of small bars: one growing seven sessions in a row reading 7d in bold, one growing a single session reading 1d in grey" h={54}>
    {[
      { y: 18, n: 7, word: 'grew seven sessions running — a build with legs' },
      { y: 42, n: 1, word: 'grew once — could be anything' },
    ].map(r => (
      <g key={r.y}>
        {Array.from({ length: 7 }, (_, i) => (
          <rect key={i} x={14 + i * 9} y={r.y - 3 - (i < r.n ? i * 0.8 : 0)} width={6} height={6 + (i < r.n ? i * 0.8 : 0)} rx={1} fill={i < r.n ? INK : '#ffffff'} fillOpacity={i < r.n ? 0.8 : 0.08} />
        ))}
        <text x={90} y={r.y + 3} fontSize={9} fontWeight={r.n >= 3 ? 700 : 400} fill={r.n >= 3 ? INK : SECOND} fontFamily={MONO}>
          {r.n}d
        </text>
        <text x={116} y={r.y + 3} fontSize={7} fill={SECOND} fontFamily={SANS}>
          {r.word}
        </text>
      </g>
    ))}
  </Figure>
);

export const FootprintsGuide = () => (
  <div data-trace-guide="footprints">
    <SidesRule />
    <Section title="What stayed">
      <p>Volume is loud and gone by the close; open interest is what stayed overnight, and this page ranks what was built and unwound.</p>
      <OiChangeFigure />
    </Section>
    <Section title="A contract">
      <p>The strike and side are the door to the contract's card.</p>
      <ContractFigure />
    </Section>
    <Section title="The inks">
      <p>Each column measures its own crowd: the bulk quiet, the top fifth heavy, one magenta champion.</p>
      <InkFigure />
    </Section>
    <Section title="A streak">
      <p>How many sessions in a row the interest has grown — three and up earns weight.</p>
      <StreakFigure />
    </Section>
  </div>
);

/* ---- watchers ---------------------------------------------------------------- */

/** A reason: the desk's dot in its kind's hue, yours as a hollow ring */
export const ReasonFigure = () => (
  <Figure label="Three reasons: a purple dot 'One print carried outsized money', a teal dot 'Kept printing at higher and higher prices', a hollow ring 'Quiet AVGO' one you wrote" h={66}>
    {[
      { y: 18, dot: '#9B8FE8', hollow: false, text: 'One print carried outsized money', who: "the desk's — the hue says which kind" },
      { y: 40, dot: '#6ECFC4', hollow: false, text: 'Kept printing at higher and higher prices', who: 'another kind, another hue' },
      { y: 62, dot: '', hollow: true, text: 'Quiet AVGO · volume ran past the interest', who: 'yours — a hollow ring, your name first' },
    ].map(r => (
      <g key={r.y}>
        {r.hollow ? <circle cx={18} cy={r.y - 2} r={3} fill="none" stroke={SECOND} strokeWidth={1} /> : <circle cx={18} cy={r.y - 2} r={3} fill={r.dot} />}
        <text x={28} y={r.y + 1} fontSize={8} fill={INK} fontFamily={SANS}>
          {r.text}
        </text>
        <text x={260} y={r.y + 1} fontSize={7} fill={SECOND} fontFamily={SANS}>
          {r.who}
        </text>
      </g>
    ))}
  </Figure>
);

/** The print that tripped the reason, its money, its side */
export const PrintFigure = () => (
  <Figure label="One alert's print: 850 @ $1.24, $105.4K, on the BID in the plain ink — the words: the print that tripped the reason, and which side it printed on" h={54}>
    <Head x={14} y={12}>THE PRINT</Head>
    <Head x={130} y={12}>PRINT $</Head>
    <Head x={210} y={12}>SIDE</Head>
    <text x={14} y={34} fontSize={10} fill={INK} fontFamily={MONO}>
      850 <tspan fontSize={8} fill={SECOND}>@ $1.24</tspan>
    </text>
    <text x={130} y={34} fontSize={10} fontWeight={700} fill={INK} fontFamily={MONO}>
      $105.4K
    </text>
    <text x={210} y={34} fontSize={8} fill={INK} fontFamily={MONO}>
      BID
    </text>
    <text x={260} y={30} fontSize={7} fill={SECOND} fontFamily={SANS}>
      the exact print that tripped the reason;
    </text>
    <text x={260} y={40} fontSize={7} fill={SECOND} fontFamily={SANS}>
      on the bid it was sold, at the ask bought
    </text>
  </Figure>
);

export const WatchersGuide = () => (
  <div data-trace-guide="watchers">
    <SidesRule />
    <Section title="A reason">
      <p>Why the contract is in front of you, in words — the desk's watchers, or one you wrote behind Your reasons.</p>
      <ReasonFigure />
    </Section>
    <Section title="The print">
      <p>The exact print that tripped the reason, its money, and which side it printed on.</p>
      <PrintFigure />
    </Section>
    <Section title="A contract">
      <p>The strike and side are the door to the contract's card, opened on that print.</p>
      <ContractFigure />
    </Section>
    <Section title="Under watch">
      <p>The mark at a row's left keeps the contract on the Tracker with what it has done since.</p>
      <WatchFigure />
    </Section>
  </div>
);

/* ---- windows -------------------------------------------------------------------- */

/** The session as one instrument (2026-10-13, the partner's strip): 09:30 to 16:00 New York, a bar a quarter hour,
    taller where more traded — the busiest in magenta, the one open on a silver column, the live one under "now" */
export const DayStripFigure = () => {
  const n = 26;
  const x0 = 14;
  const span = 392;
  const slot = span / n;
  const top = 14;
  const base = 52;
  const heights = [0.3, 0.55, 0.9, 0.7, 0.45, 0.5, 0.35, 0.6, 0.4, 0.3, 0.5, 0.65, 0.8, 0.45, 0.35, 0.55, 0.4, 0.3, 0.5, 1, 0.75, 0.6, 0.5, 0.7, 0.85, 0.6];
  return (
    <Figure label="The session's quarter hours as bars at their place between 09:30 and 16:00, taller where more traded: one magenta as the busiest, one on a silver column with its readout 12:30–12:45 ET · 48,210 contracts, the newest breathing under the word now" h={76}>
      <rect x={x0} y={top} width={span} height={base - top} fill="#ffffff" fillOpacity={0.045} />
      <line x1={x0} y1={top} x2={x0} y2={base} stroke="#ffffff" strokeOpacity={0.16} />
      <line x1={x0 + span} y1={top} x2={x0 + span} y2={base} stroke="#ffffff" strokeOpacity={0.16} />
      <line x1={x0} y1={base} x2={x0 + span} y2={base} stroke="#ffffff" strokeOpacity={0.16} />
      <rect x={x0 + 12 * slot} y={top} width={slot} height={base - top} fill={SILVER} fillOpacity={0.1} />
      {heights.map((v, i) => {
        const h = (6 + 94 * v) / 100 * (base - top - 2);
        const busiest = i === 19;
        const open = i === 12;
        const live = i === n - 1;
        const fill = busiest ? SUPREME : live ? 'rgb(var(--select))' : open ? SILVER : SECOND;
        const op = busiest || live || open ? 0.95 : v >= 0.75 ? 0.8 : 0.25;
        return <rect key={i} x={x0 + i * slot} y={base - h} width={slot - 1} height={h} fill={fill} fillOpacity={op} />;
      })}
      <line x1={x0 + span} y1={top} x2={x0 + span} y2={base} stroke="rgb(var(--select))" strokeOpacity={0.8} />
      <text x={x0 + span - 3} y={top + 8} textAnchor="end" fontSize={6.5} fill={SILVER} fontFamily={MONO}>
        12:30–12:45 ET · 48,210 contracts
      </text>
      {[
        { m: 0, t: '09:30', edge: true, a: 'start' as const },
        { m: 90, t: '11:00', a: 'middle' as const },
        { m: 210, t: '13:00', a: 'middle' as const },
        { m: 330, t: '15:00', a: 'middle' as const },
      ].map(k => (
        <text key={k.t} x={x0 + (k.m / 390) * span} y={base + 9} textAnchor={k.a} fontSize={6.5} fill={k.edge ? SECOND : MUTED} fontFamily={MONO}>
          {k.t}
        </text>
      ))}
      <text x={x0 + span} y={base + 9} textAnchor="end" fontSize={6.5} fontWeight={600} fill="rgb(var(--select))" fontFamily={MONO}>
        now
      </text>
      <text x={x0} y={base + 20} fontSize={6.5} fill={MUTED} fontFamily={SANS}>
        the session, 09:30 to 16:00 New York, a bar per quarter hour, taller where more traded — hover one to read it, click to open it; ← and → walk them
      </text>
    </Figure>
  );
};

/** The share of a contract's day that landed in one window */
export const ShareFigure = () => (
  <Figure label="Two contracts' share-of-day bars: one at 61% in magenta reading burst, one at 3% in grey reading a trickle" h={54}>
    {[
      { y: 18, pct: 61, word: 'a BURST — most of its whole day landed right here', ink: SUPREME },
      { y: 42, pct: 3, word: 'a trickle of a busy name', ink: SECOND },
    ].map(r => (
      <g key={r.y}>
        <rect x={14} y={r.y - 3} width={90} height={5} rx={2} fill="#ffffff" fillOpacity={0.08} />
        <rect x={14} y={r.y - 3} width={90 * (r.pct / 100)} height={5} rx={2} fill={r.ink} />
        <text x={112} y={r.y + 2} fontSize={9} fontWeight={r.pct >= 50 ? 700 : 400} fill={r.ink} fontFamily={MONO}>
          {r.pct}%
        </text>
        <text x={144} y={r.y + 2} fontSize={7} fill={SECOND} fontFamily={SANS}>
          {r.word}
        </text>
      </g>
    ))}
  </Figure>
);

export const WindowsGuide = () => (
  <div data-trace-guide="windows">
    <SidesRule />
    <Section title="A quarter hour">
      <p>One name's options session, 09:30 to 16:00 New York, cut into quarter hours, a bar each, taller where more traded — the busiest in magenta, the one you have open on a silver column, the newest breathing while it fills. Every figure is the vendor's minute ticks for the name, every expiry, summed over the fifteen minutes. ← and → walk the quarter hours.</p>
      <DayStripFigure />
    </Section>
    <Section title="Share of the day">
      <p>How much of the name's session so far traded in this one quarter hour.</p>
      <ShareFigure />
    </Section>
    <Section title="Calls, puts and the lean">
      <p>Calls and puts traded, each split by how many printed at the ask and on the bid; net calls and net puts are premium at the ask less premium on the bid. The lean is net calls less net puts — net puts bought lean bearish.</p>
    </Section>
  </div>
);

/* ---- multi-leg ------------------------------------------------------------------ */

/** A structure: the shape's dot, the strikes, the legs */
export const StructureFigure = () => (
  <Figure label="Three structures: a blue dot Vertical 72 / 73 ×2, a purple dot Iron condor 30.5 / 31 / 32 / 32.5 ×4, a teal dot Straddle 252.5 ×2" h={70}>
    {[
      { y: 18, dot: '#7EA6F0', kind: 'Vertical', strikes: '72 / 73', legs: '×2', word: 'two strikes, one side — a bounded bet' },
      { y: 40, dot: '#9B8FE8', kind: 'Iron condor', strikes: '30.5 / 31 / 32 / 32.5', legs: '×4', word: 'four strikes — paid to stay in a range' },
      { y: 62, dot: '#6ECFC4', kind: 'Straddle', strikes: '252.5', legs: '×2', word: 'one strike, both sides — a bet on size, not direction' },
    ].map(r => (
      <g key={r.kind}>
        <circle cx={18} cy={r.y - 2} r={3} fill={r.dot} />
        <text x={28} y={r.y + 1} fontSize={8} fill={INK} fontFamily={SANS}>
          {r.kind}
        </text>
        <text x={90} y={r.y + 1} fontSize={8} fontWeight={700} fill={INK} fontFamily={MONO}>
          {r.strikes}
        </text>
        <text x={212} y={r.y + 1} fontSize={8} fill={SECOND} fontFamily={MONO}>
          {r.legs}
        </text>
        <text x={236} y={r.y + 1} fontSize={7} fill={SECOND} fontFamily={SANS}>
          {r.word}
        </text>
      </g>
    ))}
  </Figure>
);

/** Defined risk: the most it can lose in red, the most it can make in green, uncapped loudest */
export const RiskFigure = () => (
  <Figure label="Three risk pairs: max loss $3.1K red against max profit $35.7K green; max loss $120.4K red against Uncapped in bold green; max loss Uncapped in bold amber against $36.9K green" h={62}>
    <Head x={14} y={12}>MAX LOSS</Head>
    <Head x={110} y={12}>MAX PROFIT</Head>
    {[
      { y: 28, loss: '$3.1K', lossInk: BEAR, lossBold: false, profit: '$35.7K', profitInk: BULL, profitBold: false, word: 'a debit vertical — both ends known' },
      { y: 44, loss: '$120.4K', lossInk: BEAR, lossBold: false, profit: 'Uncapped', profitInk: BULL, profitBold: true, word: 'a straddle bought — the upside has no ceiling' },
      { y: 60, loss: 'Uncapped', lossInk: 'rgb(var(--warn))', lossBold: true, profit: '$36.9K', profitInk: BULL, profitBold: false, word: 'a ratio — the loss has no floor, the loudest word here' },
    ].map(r => (
      <g key={r.y}>
        <text x={14} y={r.y} fontSize={8.5} fontWeight={r.lossBold ? 700 : 400} fill={r.lossInk} fontFamily={MONO}>
          {r.loss}
        </text>
        <text x={110} y={r.y} fontSize={8.5} fontWeight={r.profitBold ? 700 : 400} fill={r.profitInk} fontFamily={MONO}>
          {r.profit}
        </text>
        <text x={190} y={r.y} fontSize={7} fill={SECOND} fontFamily={SANS}>
          {r.word}
        </text>
      </g>
    ))}
  </Figure>
);

export const StructureGuide = () => (
  <div data-trace-guide="multi-leg">
    <SidesRule />
    <Section title="A structure">
      <p>The tape reconstructed into spreads — the shape, its strikes and how many legs; a row opens the structure with each leg. Size is in units: the legs' contracts over their common factor, so a fly of 5 / 10 / 5 contracts is 5 flies. The net is per unit — the net premium over units × 100 — paid (debit) or collected (credit).</p>
      <StructureFigure />
    </Section>
    <Section title="Defined risk">
      <p>The most the structure can lose and make at expiry — the payoff of its own legs, as they were bought and sold, on the row and the card alike — and where a side has no limit. A structure whose legs cannot be settled by its net, or that runs to two expiries, shows none.</p>
      <RiskFigure />
    </Section>
    <Section title="The inks">
      <p>Each column measures its own crowd: the bulk quiet, the top fifth heavy, one magenta champion.</p>
      <InkFigure />
    </Section>
  </div>
);

/* ---- net flow and 0dte ---------------------------------------------------------- */

/** A row of the board: rank, the name, its net in its ink, the C and P under it */
export const BoardRowFigure = () => (
  <Figure label="Two board rows: 01 GOOGL +$57.9M in magenta with a green bar and net bullish under it; 15 META −$923.1K in red with a short red bar and net bearish under it" h={70}>
    {[
      { y: 16, n: '01', t: 'GOOGL', net: '+$57.9M', ink: SUPREME, bar: 1, bull: true, c: '$52.2M', p: '−$5.6M' },
      { y: 46, n: '15', t: 'META', net: '−$923.1K', ink: BEAR, bar: 0.05, bull: false, c: '$1.1M', p: '$2.0M' },
    ].map(r => (
      <g key={r.t}>
        <text x={14} y={r.y} fontSize={6.5} fill={MUTED} fontFamily={MONO}>
          {r.n}
        </text>
        <text x={34} y={r.y} fontSize={8.5} fontWeight={700} fill={INK} fontFamily={MONO}>
          {r.t}
        </text>
        <text x={190} y={r.y} textAnchor="end" fontSize={8.5} fontWeight={r.ink === SUPREME ? 700 : 400} fill={r.ink} fontFamily={MONO}>
          {r.net}
        </text>
        <rect x={34} y={r.y + 6} width={100} height={2} rx={1} fill="#ffffff" fillOpacity={0.06} />
        <rect x={34} y={r.y + 6} width={100 * r.bar} height={2} rx={1} fill={r.bull ? BULL : BEAR} fillOpacity={0.6} />
        <text x={140} y={r.y + 9} fontSize={6.5} fill={MUTED} fontFamily={MONO}>
          {r.bull ? 'net bullish' : 'net bearish'}
        </text>
        <text x={230} y={r.y + 4} fontSize={7} fill={SECOND} fontFamily={SANS}>
          {r.ink === SUPREME ? 'the largest lean on the board — magenta' : 'a quiet lean, the bulk of the board'}
        </text>
      </g>
    ))}
  </Figure>
);

/** The pane's lines: the spot in white, net calls in green, net puts in red, the volume floor */
export const PaneLinesFigure = () => (
  <Figure label="A small chart: a white spot line drifting down, a green net-calls line rising, a red net-puts line flat, small volume bars along the floor with one in magenta" h={96}>
    <polyline points="14,30 60,26 100,34 150,40 200,44 250,52 300,50 350,60 400,58" fill="none" stroke={INK} strokeWidth={1.2} />
    <polyline points="14,64 60,60 100,58 150,52 200,48 250,42 300,40 350,34 400,32" fill="none" stroke={BULL} strokeWidth={1.4} />
    <polyline points="14,70 60,70 100,69 150,70 200,71 250,70 300,72 350,71 400,72" fill="none" stroke={BEAR} strokeWidth={1.2} />
    {Array.from({ length: 40 }, (_, i) => (
      <rect key={i} x={14 + i * 9.7} y={90 - (3 + ((i * 7) % 9))} width={3} height={3 + ((i * 7) % 9)} fill={i === 11 ? SUPREME : SECOND} fillOpacity={i === 11 ? 0.9 : 0.35} />
    ))}
    <text x={404} y={58} fontSize={6.5} fill={INK} fontFamily={MONO}>
      spot
    </text>
    <text x={404} y={32} fontSize={6.5} fill={BULL} fontFamily={MONO}>
      calls
    </text>
    <text x={404} y={74} fontSize={6.5} fill={BEAR} fontFamily={MONO}>
      puts
    </text>
    <text x={14} y={14} fontSize={7} fill={SECOND} fontFamily={SANS}>
      the name's own candles as the white line; net call and put premium as the green and red; the floor is volume, its largest bar magenta
    </text>
  </Figure>
);

export const NetFlowGuide = () => (
  <div data-trace-guide="net-flow">
    <SidesRule />
    <Section title="The board">
      <p>Every name ranked by net premium — net calls less net puts, calls bought and puts sold against the reverse. Each row says its share of the board's whole lean and which way it leans; a click puts the name on the pane, and so does the search. Only a name on today's book goes on the pane: a name the book has not traded leaves the pane where it was.</p>
      <BoardRowFigure />
    </Section>
    <Section title="The pane">
      <p>The picked name through the session, minute by minute from the vendor's tape: its own one-minute closes as the white line, its running net call and put premium across every expiry, the contracts each minute on the floor. The pane's two figures are where those lines end, so they add up to the name's lean on the board. Net puts bought lean bearish and wear red; sold, they lean bullish and wear green.</p>
      <PaneLinesFigure />
    </Section>
    <Section title="The inks">
      <p>The bulk of the board quiet, the loud fifth in its direction, the single largest lean in magenta.</p>
      <InkFigure />
    </Section>
  </div>
);

/** Four panes, each with its own cut */
export const DeskFigure = () => (
  <Figure label="Four small panes in a two-by-two grid, each labelled: Everything, SPY, QQQ, Stocks only" h={96}>
    {[
      { x: 14, y: 12, l: 'Everything' },
      { x: 214, y: 12, l: 'SPY' },
      { x: 14, y: 54, l: 'QQQ' },
      { x: 214, y: 54, l: 'Stocks only' },
    ].map(p => (
      <g key={p.l}>
        <rect x={p.x} y={p.y} width={192} height={36} rx={3} fill="#0f0f0f" stroke="#2a2a2a" strokeWidth={0.6} />
        <text x={p.x + 6} y={p.y + 11} fontSize={6.5} fill={INK} fontFamily={MONO}>
          {p.l}
        </text>
        <polyline points={`${p.x + 6},${p.y + 30} ${p.x + 50},${p.y + 26} ${p.x + 100},${p.y + 22} ${p.x + 150},${p.y + 18} ${p.x + 186},${p.y + 16}`} fill="none" stroke={BULL} strokeWidth={1} />
        <polyline points={`${p.x + 6},${p.y + 20} ${p.x + 50},${p.y + 23} ${p.x + 100},${p.y + 26} ${p.x + 150},${p.y + 28} ${p.x + 186},${p.y + 30}`} fill="none" stroke={INK} strokeWidth={0.8} />
      </g>
    ))}
  </Figure>
);

export const OdteGuide = () => (
  <div data-trace-guide="odte">
    <SidesRule />
    <Section title="The desk">
      <p>One to four panes of the same-day book, each with its own cut of the book or one name, its own money and clock; a pane's arrow opens it full screen.</p>
      <DeskFigure />
    </Section>
    <Section title="A pane">
      <p>The spot, the net calls and puts, and the volume on the floor, through the session.</p>
      <PaneLinesFigure />
    </Section>
    <Section title="The inks">
      <p>The floor's bars measure their own crowd: the bulk quiet, the largest in magenta.</p>
      <InkFigure />
    </Section>
  </div>
);

/* ---- live tape ----------------------------------------------------------------- */

/** One row of the tape: when, the name, the contract, size at the fill, the dollars, the tag */
/* the example contract expires on the tape's own session — the guide never shows a date long gone (the audit, 2026-10-22) */
const exampleExpiry = () => expiryLabel(tapeSessionIso());
export const TapeRowFigure = () => (
  <Figure label={`One tape row: 14:52:07 · NVDA · 215C ${exampleExpiry()} · 850 @ $1.24 · $105.4K in bold · SWEEP in amber`} h={54}>
    <Head x={14} y={12}>TIME</Head>
    <Head x={74} y={12}>TICKER</Head>
    <Head x={126} y={12}>CONTRACT</Head>
    <Head x={222} y={12}>SIZE · FILL</Head>
    <Head x={306} y={12}>PREM</Head>
    <Head x={372} y={12}>TAG</Head>
    <text x={14} y={34} fontSize={9} fill={SECOND} fontFamily={MONO}>
      14:52:07
    </text>
    <text x={74} y={34} fontSize={9} fontWeight={700} fill={INK} fontFamily={MONO}>
      NVDA
    </text>
    <text x={126} y={34} fontSize={9} fill={INK} fontFamily={MONO}>
      215<tspan fill={BULL}>C</tspan> <tspan fill={SECOND} fontSize={8}>{exampleExpiry()}</tspan>
    </text>
    <text x={222} y={34} fontSize={9} fill={INK} fontFamily={MONO}>
      850 <tspan fill={SECOND} fontSize={8}>@ $1.24</tspan>
    </text>
    <text x={306} y={34} fontSize={9} fontWeight={700} fill={INK} fontFamily={MONO}>
      $105.4K
    </text>
    <text x={372} y={34} fontSize={8} fontWeight={600} fill={WARN} fontFamily={MONO}>
      SWEEP
    </text>
  </Figure>
);

/** Where the fill landed between the bid and the ask */
export const FillFigure = () => (
  <Figure label="Two fills in the spread, both dots in the plain ink: one near the ask, bought; one near the bid, sold — the dot's place is the tell, not a colour" h={64}>
    {[
      { y: 22, pos: 0.92, ink: INK, word: 'filled 1.27, near the ask — bought, someone wanted it now' },
      { y: 48, pos: 0.08, ink: INK, word: 'filled 1.21, near the bid — sold, someone took what was there' },
    ].map(r => (
      <g key={r.y}>
        {/* the bid at the left, the ask at the right — two different prices, each named (the retail pass: the sample read as
            one price twice) */}
        <text x={8} y={r.y + 3} fontSize={6.5} fill={MUTED} fontFamily={MONO}>
          bid 1.20
        </text>
        <rect x={44} y={r.y - 1.5} width={76} height={3} rx={1.5} fill="#ffffff" fillOpacity={0.08} />
        <circle cx={44 + 76 * r.pos} cy={r.y} r={3.5} fill={r.ink} />
        <text x={124} y={r.y + 3} fontSize={6.5} fill={MUTED} fontFamily={MONO}>
          ask 1.28
        </text>
        <text x={170} y={r.y + 3} fontSize={7} fill={SECOND} fontFamily={SANS}>
          {r.word}
        </text>
      </g>
    ))}
  </Figure>
);

/** Which side was hit, and how hard — the bar's reach from the centre (no longer on the tape) */
export const ConvictionFigure = () => (
  <Figure label="Two conviction cells in one ink: a BUY chip over a bar reaching far right of centre; a SELL chip over a short bar left of centre — the reach and the side say it, never a colour" h={70}>
    {[
      { y: 16, side: 'BUY', ink: INK, score: 0.8, word: 'offers lifted, hard — a long bar to the right' },
      { y: 46, side: 'SELL', ink: INK, score: -0.3, word: 'bids hit, gently — a short bar to the left' },
    ].map(r => (
      <g key={r.side}>
        <rect x={14} y={r.y - 8} width={30} height={13} rx={2} fill="#ffffff" fillOpacity={0.05} stroke="#ffffff" strokeOpacity={0.18} strokeWidth={0.6} />
        <text x={29} y={r.y + 1.5} textAnchor="middle" fontSize={7} fontWeight={600} fill={r.ink} fontFamily={MONO}>
          {r.side}
        </text>
        <rect x={14} y={r.y + 10} width={64} height={3} rx={1.5} fill="#ffffff" fillOpacity={0.08} />
        <rect x={45.6} y={r.y + 9} width={0.8} height={5} fill="#ffffff" fillOpacity={0.25} />
        {r.score >= 0 ? (
          <rect x={46} y={r.y + 10} width={32 * r.score} height={3} rx={1.5} fill={r.ink} />
        ) : (
          <rect x={46 + 32 * r.score} y={r.y + 10} width={-32 * r.score} height={3} rx={1.5} fill={r.ink} />
        )}
        <text x={100} y={r.y + 6} fontSize={7} fill={SECOND} fontFamily={SANS}>
          {r.word}
        </text>
      </g>
    ))}
  </Figure>
);

export const LiveTapeGuide = () => (
  <div data-trace-guide="live-tape">
    <SidesRule />
    <Section title="A print">
      <p>One contract traded once — when, the name, the contract with its days left and where the stock stood, how many at what price, the dollars, and its kind. A block is one leg of 100 contracts or $250K and up; a print with legs is multi-leg; the rest are single prints. P/C is put premium over call premium.</p>
      <TapeRowFigure />
    </Section>
    <Section title="Fill &amp; market">
      <p>What was paid and which side it crossed — the fill with its side as a word, and under it the bid and the ask it crossed into, the dot where between them the price landed. The dot's place is the tell; it wears no colour, because the side is not the direction.</p>
      <FillFigure />
    </Section>
    <Section title="Side, lean and window">
      <p>A print's side is the vendor's own tag — at the ask, on the bid, or mid — the same on the tape, the card and every count; a tag the quote at the print contradicts gives way to the quote, and a fill through the quote says "under bid" or "over ask". The day lean is the contract's whole day so far: its contracts at the ask, on the bid, and at the mid or with no side — a lean is called only when at least half the day traded on a side. The head and the sentence count the prints in hand — the newest unbroken stretch of the tape, up to 2,000 — and the Window fact says from when to when; with one name typed, its biggest contracts of the whole day stand beside them.</p>
    </Section>
    <Section title="The inks">
      <p>Premium quiet below $250K, bold above, the largest print on the tape in magenta.</p>
      <InkFigure />
    </Section>
  </div>
);

/* ---- tracker ------------------------------------------------------------------- */

/** What a mark has done since: the fill then and now, the change in its ink */
export const SinceFigure = () => (
  <Figure label="Two marked contracts: NVDA 120C marked at $3.29 now $4.10 reading +24.6% in green; SPY 494P marked at $4.73 now $3.90 reading −17.5% in red" h={66}>
    <Head x={14} y={12}>MARKED AT</Head>
    <Head x={110} y={12}>NOW</Head>
    <Head x={190} y={12}>SINCE</Head>
    {[
      { y: 30, then: '$3.29', now: '$4.10', chg: '+24.6%', ink: BULL, word: 'the fill has climbed since the mark' },
      { y: 52, then: '$4.73', now: '$3.90', chg: '−17.5%', ink: BEAR, word: 'the fill has slipped' },
    ].map(r => (
      <g key={r.y}>
        <text x={14} y={r.y} fontSize={9} fill={SECOND} fontFamily={MONO}>
          {r.then}
        </text>
        <text x={110} y={r.y} fontSize={9} fill={INK} fontFamily={MONO}>
          {r.now}
        </text>
        <text x={190} y={r.y} fontSize={9} fontWeight={700} fill={r.ink} fontFamily={MONO}>
          {r.chg}
        </text>
        <text x={260} y={r.y} fontSize={7} fill={SECOND} fontFamily={SANS}>
          {r.word}
        </text>
      </g>
    ))}
  </Figure>
);

/** Two names on one row of the card: the first's figure lit at the left, the fact and its note in the middle, the second's quiet at the right */
export const CardRowFigure = () => (
  <Figure label="One row of the card: SPY's premium $122.9M quiet on the left, the fact Premium over the note QQQ the heavier book in the middle, QQQ's $175.4M lit on the right" h={64}>
    <text x={150} y={30} textAnchor="end" fontSize={9} fill={SECOND} fontFamily={MONO}>
      $122.9M
    </text>
    <text x={210} y={26} textAnchor="middle" fontSize={7.5} fill={SECOND} fontFamily={SANS}>
      Premium
    </text>
    <text x={210} y={36} textAnchor="middle" fontSize={6.5} fill={MUTED} fontFamily={SANS}>
      QQQ the heavier book
    </text>
    <text x={270} y={30} fontSize={9} fontWeight={700} fill={INK} fontFamily={MONO}>
      $175.4M
    </text>
    <text x={14} y={48} fontSize={7} fill={SECOND} fontFamily={SANS}>
      the first name at the left, the second at the right; the figure that leads is lit, the other stays quiet
    </text>
    <text x={14} y={58} fontSize={7} fill={SECOND} fontFamily={SANS}>
      the middle names the fact, and under it says what the two say against each other
    </text>
  </Figure>
);

export const CompareGuide = () => (
  <div data-trace-guide="compare">
    <SidesRule />
    <Section title="The two names">
      <p>Pick any two names on today's book — the two searches offer exactly those, and the arrow between them swaps the sides. The Clock and Money cards cut both names the same way, so every row compares like with like.</p>
    </Section>
    <Section title="The card">
      <p>Each row is one fact printed for both names, the way a fight card is laid out: the first name's figure on the left, the fact in the middle with what the two say against each other under it, the second name's figure on the right. The figure that leads is lit; the other stays quiet. A signed figure keeps its direction ink on both sides.</p>
      <CardRowFigure />
    </Section>
    <Section title="The panes">
      <p>Each name through the session on its own pane: its spot in white, net calls in green, net puts in red, the volume on the floor — both on the page's one cut.</p>
      <PaneLinesFigure />
    </Section>
    <Section title="The lists">
      <p>Under the card, each name's six heaviest contracts by dollars — a contract turns silver under the pointer and opens its card, the bar at the row's end says which side did the buying — and its structures, the tape reconstructed, heaviest first.</p>
      <ContractFigure />
      <LeanFigure />
    </Section>
  </div>
);

/** A shelf on the board: the role in its ink, the price, the distance, the dollars, the bar and the count */
export const ShelfFigure = () => (
  <Figure label="Two shelf rows: RESISTANCE $492.27 +0.29% $177.6M with a red bar and 34% · 9 prints · held 4× under it; SUPPORT $488.40 −0.50% $96.1M with a green bar" h={78}>
    {[
      { y: 18, role: 'RESISTANCE', ink: BEAR, price: '$492.27', dist: '+0.29%', dInk: BULL, usd: '$177.6M', bar: 1, under: '34% · 9 prints · held 4×', note: 'dollars rested above the market — a seller waits there' },
      { y: 52, role: 'SUPPORT', ink: BULL, price: '$488.40', dist: '−0.50%', dInk: BEAR, usd: '$96.1M', bar: 0.54, under: '18% · 12 prints · held 2×', note: 'dollars rested below it — a buyer has leaned on it' },
    ].map(r => (
      <g key={r.role}>
        <text x={14} y={r.y} fontSize={6.5} fontWeight={700} letterSpacing={0.6} fill={r.ink} fontFamily={MONO}>
          {r.role}
        </text>
        <text x={72} y={r.y} fontSize={8.5} fontWeight={700} fill={INK} fontFamily={MONO}>
          {r.price}
        </text>
        <text x={112} y={r.y} fontSize={7} fill={r.dInk} fontFamily={MONO}>
          {r.dist}
        </text>
        <text x={200} y={r.y} textAnchor="end" fontSize={8} fontWeight={r.bar === 1 ? 700 : 400} fill={r.bar === 1 ? INK : SECOND} fontFamily={MONO}>
          {r.usd}
        </text>
        <rect x={14} y={r.y + 6} width={90} height={2} rx={1} fill="#ffffff" fillOpacity={0.06} />
        <rect x={14} y={r.y + 6} width={90 * r.bar} height={2} rx={1} fill={r.ink} fillOpacity={0.7} />
        <text x={110} y={r.y + 9} fontSize={6.5} fill={MUTED} fontFamily={MONO}>
          {r.under}
        </text>
        <text x={230} y={r.y + 3} fontSize={7} fill={SECOND} fontFamily={SANS}>
          {r.note}
        </text>
      </g>
    ))}
  </Figure>
);

/** The four reads, each in its ink, with the conviction the grid draws: a word over four steps, never a figure (2026-09-19) */
export const ReadFigure = () => (
  <Figure label="Four reads in a row: ACCUMULATION green (over the mid), DISTRIBUTION red (under the mid), AT THE MID amber, NO READ grey" h={76}>
    {[
      { x: 14, w: 'ACCUMULATION', ink: BULL, note: 'size over the mid — bought up' },
      { x: 118, w: 'DISTRIBUTION', ink: BEAR, note: 'size under the mid — sold down' },
      { x: 222, w: 'AT THE MID', ink: WARN, note: 'size at the mid — neither side' },
      { x: 326, w: 'NO READ', ink: MUTED, note: 'small, own terms, after hours — no read' },
    ].map(r => (
      <g key={r.w}>
        <text x={r.x} y={16} fontSize={6.5} fontWeight={700} letterSpacing={0.6} fill={r.ink} fontFamily={MONO}>
          {r.w}
        </text>
        {/* two short lines: on one, each note ran into its neighbour's column */}
        {r.note.split(' — ').map((line, i) => (
          <text key={line} x={r.x} y={46 + i * 8} fontSize={5.6} fill={SECOND} fontFamily={SANS}>
            {line}
          </text>
        ))}
      </g>
    ))}
    <text x={14} y={70} fontSize={6.5} fill={MUTED} fontFamily={SANS}>
      a read is a sized print's place against the quote — nothing more
    </text>
  </Figure>
);

export const DarkPoolGuide = () => (
  <div data-trace-guide="dark-pool">
    <SidesRule />
    <Section title="The shelves">
      <p>A shelf is a price where off-exchange dollars rested today. Below the market it reads support, above it resistance, at it a pivot; "held" counts the times price turned there. Shelves are read per name: with a name in the search, the strip above the grid lists its shelves, lowest price at the left — a click cuts the grid to the crosses that printed on that shelf, and the Where card does the same.</p>
      <ShelfFigure />
    </Section>
    <Section title="The reads">
      <p>Only a sized cross — 10,000 shares or $500K — carries a read: accumulation when it printed over the mid (paid up for, buyer-initiated), distribution when under it (sold down, seller-initiated), at the mid when it crossed there. A small cross carries none, nor does an after-hours one, nor a print priced by its own terms (average-price, contingent, derivative-priced): each is shown, never read. The head's "Sized: over · under the mid" adds up every sized cross by where it printed, any distance from the mid.</p>
      <ReadFigure />
    </Section>
    <Section title="The posture and the cut">
      <p>The posture weighs the dollars of the sized, regular-session crosses over the mid against those under it. It names the side that leads, accumulating or distributing, and how far it leans in a word: strong, good or caution. When neither side leads it reads Balanced: a poor lean is no lean. The Read, Size and Where cards cut the grid; the head's "On this cut" and "Building · leaving" follow the cut, the off-exchange share is the name's whole day; the posture reads the sized crosses in hand.</p>
      <InkFigure />
    </Section>
    <Section title="Where the dark money went">
      <p>The second box is the market's latest dark prints — the vendor's recent feed, about $100K and up — collected while the page is open, by name, the heaviest first; its window is printed beside its total. The Lit lane is the same grammar for prints on the exchanges. A name typed above reads that name's whole day instead: its off-exchange share of the day's shares and its dark dollars, from the vendor's day by price. A row, or a name in the sentence, puts that name on the box above.</p>
    </Section>
  </div>
);

export const TrackerGuide = () => (
  <div data-trace-guide="tracker">
    <SidesRule />
    <Section title="A mark">
      <p>The mark at the left of any Trace row keeps the contract, print or structure here.</p>
      <WatchFigure />
    </Section>
    <Section title="Since">
      <p>What it has done since you marked it — the fill, the volume, the open interest and the lean, then against now.</p>
      <SinceFigure />
    </Section>
    <Section title="A contract">
      <p>The strike and side are the door to the contract's card, opened on the print you marked.</p>
      <ContractFigure />
    </Section>
  </div>
);

export default ScreenerGuide;
