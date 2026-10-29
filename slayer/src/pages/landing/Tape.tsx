/*
  Two rows of names drifting across the landing page. Names only: the landing reads no market data.
*/

import { useMemo } from 'react';
import CompanyLogo from '../../components/ui/CompanyLogo';
import { lookup } from '../../data/universe';

/* The names, in the order they pass. Names only: the landing reads no market data, so it shows no prices. */
const ROW_ONE = ['HOOD', 'TSLA', 'COIN', 'AAPL', 'MSFT', 'NVDA', 'PLTR', 'AMZN', 'META', 'SOFI', 'NFLX', 'UBER'];
const ROW_TWO = ['GOOGL', 'AMD', 'SHOP', 'JPM', 'SPOT', 'COST', 'ARM', 'RBLX', 'WMT', 'SNOW', 'PYPL', 'ABNB'];

interface Name {
  ticker: string;
  name: string | null;
}

const nameOf = (ticker: string): Name => ({ ticker, name: lookup(ticker)?.name ?? null });

const Item = ({ q }: { q: Name }) => (
  /* the room after each name is the name's own — both halves of the track come out the same width, so the loop has no seam */
  <span className="shrink-0 inline-flex items-center gap-3 pr-12" data-tape-name={q.ticker}>
    <CompanyLogo ticker={q.ticker} size={24} />
    <span className="font-mono text-t15 font-semibold tracking-tight text-textPrimary">{q.ticker}</span>
    {q.name && <span className="text-t13 text-textSecondary whitespace-nowrap">{q.name}</span>}
  </span>
);

const Row = ({ quotes, back = false, seconds }: { quotes: Name[]; back?: boolean; seconds: number }) => (
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
  const one = useMemo(() => ROW_ONE.map(nameOf), []);
  const two = useMemo(() => ROW_TWO.map(nameOf), []);
  return (
    <div className="tape relative" role="group" aria-label="A few of the names the terminal covers" data-landing-tape>
      <div className="flex flex-col gap-5 [mask-image:linear-gradient(90deg,transparent,black_9%,black_91%,transparent)]">
        <Row quotes={one} seconds={95} />
        <Row quotes={two} back seconds={115} />
      </div>
      <p className="mt-6 text-center font-mono text-t11 text-textMuted">Any name on the market.</p>
    </div>
  );
};

export default Tape;
