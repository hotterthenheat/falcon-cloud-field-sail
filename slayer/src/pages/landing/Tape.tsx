/*
==================================================
  SLAYER TERMINAL - THE LANDING'S TAPE
  (pages/landing/Tape.tsx)

  Between the tour's last words ("One terminal.")
  and "In every room" (Noah, 2026-09-30: "putting a
  really cool tape of the different stocks like
  robinhood, tsla, coinbase, apple, microsoft etc
  would be cool"): two rows of names drifting in
  opposite directions across the whole page — the
  company's own mark, the ticker, the price, the
  day's move in its ink and a small line of the day.
  It says the one thing the tour does not: the
  terminal is for ANY name.

  THE NUMBERS ARE THE PREVIEW'S, and it says so
  under the rows — the same simulated market the
  terminal opens on, a day's move a name off the
  house's own generator (core/rng), the base price
  the universe's where the terminal has one. Real
  quotes arrive with the data feed.

  HOW IT MOVES: each row is its list twice on one
  track, sliding half its width and starting over
  (index.css `tape-run`), so the loop has no seam.
  It pauses under the pointer and stands still under
  reduced motion. The edges fade into the page.

  Light on purpose: no simulator, no charting
  library — the landing's first load stays what it
  was.
==================================================
*/

import { useMemo } from 'react';
import CompanyLogo from '../../components/ui/CompanyLogo';
import Sparkline from '../../components/compass/Sparkline';
import { dayKey, hGauss } from '../../core/rng';
import { lookup } from '../../data/universe';

/* The names, in the order they pass. The ones the terminal's universe carries take its price; the rest carry their own. */
const ROW_ONE: [string, number][] = [
  ['HOOD', 24.8],
  ['TSLA', 0],
  ['COIN', 212.5],
  ['AAPL', 0],
  ['MSFT', 0],
  ['NVDA', 0],
  ['PLTR', 36.9],
  ['AMZN', 0],
  ['META', 0],
  ['SOFI', 9.45],
  ['NFLX', 0],
  ['UBER', 74.2],
];
const ROW_TWO: [string, number][] = [
  ['GOOGL', 0],
  ['AMD', 0],
  ['SHOP', 81.6],
  ['JPM', 0],
  ['SPOT', 372.4],
  ['COST', 0],
  ['ARM', 142.9],
  ['RBLX', 44.3],
  ['WMT', 0],
  ['SNOW', 118.7],
  ['PYPL', 72.1],
  ['ABNB', 131.5],
];

interface Quote {
  ticker: string;
  price: number;
  changePct: number;
  line: number[];
}

const quoteOf = ([ticker, own]: [string, number], day: string): Quote => {
  const known = lookup(ticker);
  const base = known?.px ?? own;
  const beta = known?.beta ?? 1.3;
  const changePct = hGauss(`${ticker}-${day}-chg`) * 1.4 * beta;
  /* the day as a walk that ends on the day's move */
  const line: number[] = [];
  let level = 0;
  const steps = 22;
  for (let i = 0; i < steps; i++) {
    level += hGauss(`${ticker}-${day}-tape-${i}`) * 0.5;
    line.push(level);
  }
  const drift = (changePct - level) / (steps - 1);
  return { ticker, price: Number((base * (1 + changePct / 100)).toFixed(2)), changePct, line: line.map((v, i) => v + drift * i) };
};

const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}%`;

const Item = ({ q }: { q: Quote }) => {
  const up = q.changePct >= 0;
  return (
    /* the room after each name is the name's own — both halves of the track come out the same width, so the loop has no seam */
    <span className="shrink-0 inline-flex items-center gap-3 pr-12" data-tape-name={q.ticker}>
      <CompanyLogo ticker={q.ticker} size={24} />
      <span className="font-mono text-[15px] font-semibold tracking-tight text-textPrimary">{q.ticker}</span>
      <span className="font-mono text-[13px] tnum text-textSecondary">${q.price.toFixed(2)}</span>
      <span className={`font-mono text-[13px] font-semibold tnum ${up ? 'text-bull' : 'text-bear'}`}>{signed(q.changePct)}</span>
      <Sparkline data={q.line} up={up} width={46} height={18} />
    </span>
  );
};

const Row = ({ quotes, back = false, seconds }: { quotes: Quote[]; back?: boolean; seconds: number }) => (
  <div className="tape-row overflow-hidden" data-tape-row={back ? 'back' : 'on'}>
    <div className="tape-track" data-dir={back ? 'back' : undefined} style={{ animationDuration: `${seconds}s` }}>
      {quotes.map(q => (
        <Item key={q.ticker} q={q} />
      ))}
      {/* the same names again, for the loop — said once to a screen reader */}
      <span className="contents" aria-hidden="true">
        {quotes.map(q => (
          <Item key={`again-${q.ticker}`} q={q} />
        ))}
      </span>
    </div>
  </div>
);

const Tape = () => {
  const day = dayKey();
  const one = useMemo(() => ROW_ONE.map(n => quoteOf(n, day)), [day]);
  const two = useMemo(() => ROW_TWO.map(n => quoteOf(n, day)), [day]);
  return (
    <div className="tape relative" role="group" aria-label="A few of the names the terminal covers, with the preview's simulated prices" data-landing-tape>
      <div className="flex flex-col gap-5 [mask-image:linear-gradient(90deg,transparent,black_9%,black_91%,transparent)]">
        <Row quotes={one} seconds={95} />
        <Row quotes={two} back seconds={115} />
      </div>
      <p className="mt-6 text-center font-mono text-[11px] text-textMuted">Any name on the market. Preview prices are simulated.</p>
    </div>
  );
};

export default Tape;
