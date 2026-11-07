/* The four desks, on the name Compass is holding. The top is the tape: what is printing. The bottom is what is
   about to. None of it is in the score. */

import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useBookRev, usePinpointFeed } from '../../data/uwBook';
import { drawnLevels, levelsFor } from '../../data/levelsFor';
import { levelsForName } from '../../data/levelsScope';
import { useNameTape } from '../../data/traceLive';
import { useTickerNews } from '../../data/liveRecord';
import { useEarningsHistories, useEveryReport } from '../../data/earningsFeed';
import { passLines, sessionBars } from '../../data/compassModel';
import { useThetaPrice } from '../../data/thetaQuote';
import ContractLabel from '../ui/ContractLabel';
import { nyClock } from '../../core/nyTime';
import { companyName } from '../../data/tickers';
import PageGlyph, { type GlyphName } from '../ui/PageGlyph';

const cashOf = (ticker: string): string => {
  const t = ticker.toUpperCase();
  if (t === 'SPXW' || t === 'XSP') return 'SPX';
  if (t === 'RUTW') return 'RUT';
  if (t === 'NDXP') return 'NDX';
  return t;
};

const px = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const gex = (n: number): string => {
  const sign = n < 0 ? '−' : '+';
  const a = Math.abs(n);
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  return `${sign}$${Math.round(a).toLocaleString('en-US')}`;
};

const prem = (n: number): string => {
  const a = Math.abs(n);
  if (a >= 1e6) return `$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(a / 1e3).toFixed(0)}K`;
  return `$${Math.round(a).toLocaleString('en-US')}`;
};

const Desk = ({ to, glyph, name, note, className = '', children }: { to: string; glyph: GlyphName; name: string; note: string; className?: string; children: ReactNode }) => (
  <Link to={to} className={`px-3.5 py-3 hover:bg-ink/[0.03] min-w-0 ${className}`} data-desk={glyph}>
    <p className="flex items-center gap-1.5 min-w-0 font-mono text-t9 uppercase tracking-widest text-textMuted">
      <PageGlyph name={glyph} size={14} />
      <span className="text-textPrimary truncate">{name}</span>
      <span className="truncate">{note}</span>
    </p>
    {children}
  </Link>
);

type Range = { day: string; high: number; low: number; close: number; at: number };

/** The name's regular session from the terminal: high, low and last close, read once a minute while shown. */
function useSessionRange(ticker: string): Range | null {
  const [range, setRange] = useState<Range | null>(null);
  useEffect(() => {
    if (!ticker) return;
    let dead = false;
    setRange(null);
    const pull = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      const got = await sessionBars(ticker);
      if (dead || !got || !got.bars.length) return;
      let high = 0;
      let low = Infinity;
      for (const b of got.bars) {
        if (b.h > high) high = b.h;
        if (b.l < low) low = b.l;
      }
      const last = got.bars[got.bars.length - 1];
      setRange({ day: got.day, high, low, close: last.c, at: last.t });
    };
    void pull();
    const id = window.setInterval(() => void pull(), 60_000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [ticker]);
  return range;
}

const NameDesks = ({ ticker, sleeve }: { ticker: string; sleeve: 'odte' | 'weekly' }) => {
  const cash = cashOf(ticker);
  const option = ticker.toUpperCase();
  const sameDay = sleeve === 'odte';
  usePinpointFeed(cash);
  const rev = useBookRev();
  const tape = useNameTape(option, 40);
  const news = useTickerNews(cash);
  useEarningsHistories(cash ? [cash] : []);
  const report = useEveryReport().find(e => e.ticker === cash) ?? null;
  const name = companyName(cash);

  const levels = levelsFor(cash, levelsForName(cash));
  /* the one gate: no wall off a stand-in book, no flip until it is final — "…" while they are read */
  const drawn = drawnLevels(levels);
  const lvWord = (v: number | null, inYet: boolean) => (!inYet ? '…' : v != null ? px(v) : '—');
  const range = useSessionRange(cash);
  const price = useThetaPrice(cash);
  const offline = price.status === 'down';
  const lastPx = price.held ? price.held.value.price : range ? range.close : 0;
  const lastAt = price.held ? price.held.value.at : range ? range.at : 0;
  const prints = tape.rows;
  let ask = 0;
  let bid = 0;
  for (const p of prints) {
    if (p.side === 'ASK') ask += p.premium;
    else if (p.side === 'BID') bid += p.premium;
  }
  const lean = ask + bid < 1 ? '' : ask > bid * 1.15 ? 'Call lean' : bid > ask * 1.15 ? 'Put lean' : 'Even';
  const heads = news.events.slice(0, 2);
  const passed = passLines(sameDay ? 'odte' : 'weekly').filter(row => row.ticker === option);

  return (
    <section className="border border-borderSubtle rounded-md bg-panel overflow-hidden min-w-0 max-w-full" data-name-desks={option} data-book-rev={rev}>
      <div className="px-3.5 h-8 flex items-center gap-2 border-b border-borderSubtle/60 paper-band min-w-0">
        <PageGlyph name="compass" size={14} />
        <span className="font-mono text-t11 font-semibold text-textPrimary">{option}</span>
        {name.toUpperCase() !== cash && <span className="min-w-0 truncate text-t11 text-textSecondary" title={name}>{name}</span>}
        <span className="font-mono text-t9 uppercase tracking-wider text-textMuted border border-borderSubtle rounded px-1.5 py-0.5">{sameDay ? '0DTE' : '1–7 DTE'}</span>
      </div>
      <div data-name-split>
        <div className="min-w-0 border-b border-borderSubtle/60" data-desk-prints>
          <div className="px-3 h-7 flex items-center gap-2 min-w-0 border-b border-borderSubtle/60">
            <span className="shrink-0 font-mono text-t9 uppercase tracking-widest text-textPrimary">Printing now</span>
            <span className="min-w-0 truncate font-mono text-t10 tnum text-textMuted">{prints.length ? `${lean || 'Even'} · ask ${prem(ask)} · bid ${prem(bid)}` : ''}</span>
          </div>
          <div className="max-h-[140px] overflow-y-auto">
            {tape.waiting && !prints.length ? (
              <p className="px-3 py-2 text-t12 text-textSecondary">The tape is loading.</p>
            ) : prints.length ? (
              prints.slice(0, 8).map(p => (
                <div key={p.vendorId || p.id} className="grid grid-cols-[3.25rem_minmax(4.75rem,1.2fr)_3.75rem_minmax(4rem,0.8fr)] gap-x-2 items-center px-3 h-7 border-b border-borderSubtle/40 last:border-b-0">
                  <span className="font-mono text-t11 tnum text-textSecondary">{p.time.slice(0, 5)}</span>
                  <span className={`min-w-0 truncate font-mono text-t11 tnum ${p.right === 'C' ? 'text-bull' : 'text-bear'}`}>{p.strike % 1 === 0 ? p.strike.toFixed(0) : p.strike.toFixed(2)}{p.right}</span>
                  <span className={`font-mono text-t11 ${p.side === 'ASK' ? 'text-bull' : p.side === 'BID' ? 'text-bear' : 'text-textMuted'}`}>{p.side === 'ASK' ? 'Bought' : p.side === 'BID' ? 'Sold' : 'Mid'}</span>
                  <span className="min-w-0 truncate font-mono text-t11 tnum text-textPrimary text-right">{Math.round(p.size).toLocaleString('en-US')}</span>
                </div>
              ))
            ) : (
              <p className="px-3 py-2 text-t12 text-textSecondary">{tape.fault ? 'The tape did not answer.' : 'No print on this name.'}</p>
            )}
          </div>
        </div>
        <div className="min-w-0" data-name-desks-row>
          <Desk to="/pinpoint/map" glyph="pinpoint" name="Pinpoint" note={cash} className="border-b border-borderSubtle/60">
            {levels ? (
              <p className="mt-1 font-mono text-t12 text-textPrimary tnum truncate">{levels.regime === 'LONG' ? 'Dealers long' : levels.regime === 'SHORT' ? 'Dealers short' : 'No sign'} {gex(levels.netGex)}</p>
            ) : (
              <p className="mt-1 text-t12 text-textSecondary">The book is not in yet.</p>
            )}
            {levels && (
              <p className="mt-0.5 font-mono text-t11 text-textSecondary tnum truncate">Call {lvWord(drawn.callWall, drawn.wallsIn)} · Put {lvWord(drawn.putWall, drawn.wallsIn)} · Flip {lvWord(drawn.flip, drawn.flipIn)}</p>
            )}
          </Desk>
          <Desk to="/terrain" glyph="terrain" name="Terrain" note={cash} className="border-b border-borderSubtle/60">
            {lastPx > 0 ? (
              <p className="mt-1 font-mono text-t12 text-textPrimary tnum truncate">Last {px(lastPx)}{lastAt > 0 ? ` · ${nyClock(lastAt, { zone: true })}` : ''}</p>
            ) : (
              <p className="mt-1 text-t12 text-textSecondary">{offline ? 'Offline. Reconnecting.' : 'No print in hand yet.'}</p>
            )}
            <p className={`mt-0.5 font-mono text-t11 tnum truncate ${offline && lastPx > 0 ? 'text-warn' : 'text-textSecondary'}`}>
              {offline && lastPx > 0 ? 'Kept. Live data is offline.' : range ? `${px(range.low)} – ${px(range.high)}` : '—'}
            </p>
          </Desk>
          <div className="px-3.5 py-2.5 min-w-0 overflow-hidden max-h-[168px] flex flex-col" data-desk="passed">
            <p className="flex items-center gap-1.5 font-mono text-t9 uppercase tracking-widest text-textMuted">
              <span className="text-textPrimary">Passed</span>
              <span>{passed.length ? passed.length.toLocaleString('en-US') : '0'}</span>
            </p>
            {passed.length ? (
              <ul className="mt-1 flex-1 min-h-0 overflow-y-auto">
                {passed.map(row => {
                  const right = row.contract.endsWith('P') ? 'P' : 'C';
                  return (
                    <li key={`${row.sleeve}|${row.contract}`} className="flex items-center gap-2 min-w-0 h-7" title={row.why}>
                      <ContractLabel contract={row.contract} right={right} logo={row.ticker} size="sm" className="min-w-0" />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-1 text-t12 text-textSecondary">None on this name.</p>
            )}
          </div>
        </div>
      </div>
      {(report && report.daysOut >= 0 && report.daysOut <= (sameDay ? 0 : 7)) || heads.length ? (
        <Link to="/dossier" className="flex items-center gap-2 px-3.5 h-8 border-t border-borderSubtle/60 min-w-0 hover:bg-ink/[0.03]" data-desk="dossier">
          <PageGlyph name="dossier" size={14} />
          <span className="shrink-0 font-mono text-t9 uppercase tracking-widest text-textPrimary">Dossier</span>
          <span className="min-w-0 truncate text-t12 text-textSecondary">
            {report && report.daysOut >= 0 && report.daysOut <= (sameDay ? 0 : 7)
              ? `Reports ${report.daysOut === 0 ? 'today' : `in ${report.daysOut} session${report.daysOut === 1 ? '' : 's'}`}`
              : heads[0]?.item.headline}
          </span>
        </Link>
      ) : null}
    </section>
  );
};

export default NameDesks;
