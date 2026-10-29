/* The four desks, on the name Compass is holding. The top is the tape: what is printing. The bottom is what is
   about to. None of it is in the score. */

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ensureBook, useBookRev, usePinpointFeed } from '../../data/uwBook';
import { levelsFor } from '../../data/levelsFor';
import { levelsForName } from '../../data/levelsScope';
import { useNameTape } from '../../data/traceLive';
import { useTickerNews } from '../../data/liveRecord';
import { ensureEarnings, useEarningsFailed, useEarningsHistories, useEveryReport } from '../../data/earningsFeed';
import { passLines, sessionBars } from '../../data/compassModel';
import { useThetaPrice } from '../../data/thetaQuote';
import ContractLabel from '../ui/ContractLabel';
import { useScanClock } from '../../data/compassDoor';
import { dayKeyOf, econReleases, fdaStamp, subscribeFda, type CalEvent } from '../../data/monthCalendar';
import { nyClock, nyDay, nyIsoDate, nyWallTime } from '../../core/nyTime';
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
      <span className="text-textPrimary">{name}</span>
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

const nextRelease = (): CalEvent | null => {
  const today = nyIsoDate();
  const rows = econReleases()
    .filter(e => dayKeyOf(e.date) >= today)
    .sort((a, b) => a.date.getTime() - b.date.getTime() || (a.impact === 'high' ? -1 : 1));
  return rows.find(e => e.impact === 'high') ?? rows[0] ?? null;
};

const NameDesks = ({ ticker, sleeve }: { ticker: string; sleeve: 'odte' | 'weekly' }) => {
  const cash = cashOf(ticker);
  const option = ticker.toUpperCase();
  const sameDay = sleeve === 'odte';
  usePinpointFeed(cash);
  const rev = useBookRev();
  const tape = useNameTape(option, 40);
  const news = useTickerNews(cash);
  useEffect(() => {
    ensureBook(cash);
    ensureEarnings();
  }, [cash]);
  useSyncExternalStore(subscribeFda, fdaStamp, () => 0);
  useEarningsHistories([cash]);
  const report = useEveryReport().find(e => e.ticker === cash) ?? null;
  const calendarDown = useEarningsFailed();
  const clock = useScanClock();
  const macro = nextRelease();
  const name = companyName(cash);

  const levels = levelsFor(cash, levelsForName(cash));
  const range = useSessionRange(cash);
  const price = useThetaPrice(cash);
  const offline = price.status === 'down';
  const lastPx = price.held ? price.held.value.price : range ? range.close : 0;
  const lastAt = price.held ? price.held.value.at : range ? range.at : 0;
  const rangeDay = range ? nyDay(nyWallTime(Number(range.day.slice(0, 4)), Number(range.day.slice(4, 6)), Number(range.day.slice(6, 8)), 12), { weekday: true }) : '';
  const prints = tape.rows;
  let ask = 0;
  let bid = 0;
  let sweeps = 0;
  for (const p of prints) {
    if (p.side === 'ASK') ask += p.premium;
    else if (p.side === 'BID') bid += p.premium;
    if (p.sweep) sweeps += 1;
  }
  const lean = ask + bid < 1 ? '' : ask > bid * 1.15 ? 'Call lean' : bid > ask * 1.15 ? 'Put lean' : 'Even';
  const heads = news.events.slice(0, 2);
  const passed = passLines(sameDay ? 'odte' : 'weekly').filter(row => row.ticker === option);

  return (
    <section className="border border-borderSubtle rounded-md bg-panel overflow-hidden h-full flex flex-col" data-name-desks={option} data-book-rev={rev}>
      <div className="px-3.5 h-8 flex items-center gap-2 border-b border-borderSubtle/60 paper-band min-w-0">
        <PageGlyph name="compass" size={14} />
        <span className="font-mono text-t11 font-semibold text-textPrimary">{option}</span>
        {name.toUpperCase() !== cash && <span className="min-w-0 truncate text-t11 text-textSecondary">{name}</span>}
        <span className="font-mono text-t9 uppercase tracking-wider text-textMuted border border-borderSubtle rounded px-1.5 py-0.5">{sameDay ? '0DTE' : '1–7 DTE'}</span>
        <span className="ml-auto shrink-0 font-mono text-t9 uppercase tracking-wider text-textMuted">Not in the score</span>
      </div>

      <div className="px-3.5 h-7 flex items-center border-b border-borderSubtle/60">
        <span className="font-mono text-t9 uppercase tracking-widest text-textPrimary">{sameDay ? 'Printing now' : 'This week'}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 border-b border-borderSubtle/60">
        <Desk to="/pinpoint/map" glyph="pinpoint" name="Pinpoint" note={cash} className="border-b sm:border-r border-borderSubtle/60">
          {levels ? (
            <p className="mt-1 font-mono text-t12 text-textPrimary tnum">
              {levels.regime === 'LONG' ? 'Dealers long' : levels.regime === 'SHORT' ? 'Dealers short' : 'No sign'} {gex(levels.netGex)}
            </p>
          ) : (
            <p className="mt-1 text-t12 text-textSecondary">The book is not in yet.</p>
          )}
          {levels && (
            <p className="mt-1 font-mono text-t11 text-textSecondary tnum">
              Call {levels.callWall != null ? px(levels.callWall) : '—'} · Put {levels.putWall != null ? px(levels.putWall) : '—'} · Flip {levels.flip != null ? px(levels.flip) : '—'}
            </p>
          )}
        </Desk>
        <Desk to="/terrain" glyph="terrain" name="Terrain" note={cash} className="border-b border-borderSubtle/60">
          {lastPx > 0 ? (
            <p className="mt-1 font-mono text-t12 text-textPrimary tnum">
              Last {px(lastPx)}
              {lastAt > 0 && <span className="text-textMuted"> · {nyClock(lastAt, { zone: true })}</span>}
            </p>
          ) : (
            <p className="mt-1 text-t12 text-textSecondary">{offline ? 'ThetaData offline — reconnecting.' : 'No print in hand yet.'}</p>
          )}
          {range && (
            <p className="mt-1 font-mono text-t11 text-textSecondary tnum">
              {range.day === nyIsoDate().replace(/-/g, '') ? 'Regular session' : rangeDay} · {px(range.low)} – {px(range.high)}
            </p>
          )}
          {offline && lastPx > 0 && <p className="mt-1 font-mono text-t11 text-warn">ThetaData offline — reconnecting. As kept.</p>}
        </Desk>
        <Desk to="/trace/live-tape" glyph="trace" name="Trace" note="The name" className="border-b sm:border-b-0 sm:border-r border-borderSubtle/60">
          {tape.waiting && !prints.length ? (
            <p className="mt-1 text-t12 text-textSecondary">The tape is loading.</p>
          ) : prints.length ? (
            <>
              <p className="mt-1 font-mono text-t12 text-textPrimary tnum">{lean || 'Prints in'}</p>
              <p className="mt-1 font-mono text-t11 text-textSecondary tnum">
                Ask {prem(ask)} · Bid {prem(bid)} · {sweeps.toLocaleString('en-US')} sweeps
              </p>
            </>
          ) : (
            <p className="mt-1 text-t12 text-textSecondary">{tape.fault ? 'The tape did not answer.' : 'No print on this name.'}</p>
          )}
        </Desk>
        <div className="px-3.5 py-3 min-w-0 overflow-hidden flex flex-col" data-desk="passed">
          <p className="flex items-center gap-1.5 font-mono text-t9 uppercase tracking-widest text-textMuted">
            <span className="text-textPrimary">Passed</span>
            <span>{passed.length ? passed.length.toLocaleString('en-US') : 'this name'}</span>
          </p>
          {passed.length ? (
            <ul className="mt-1 flex flex-col gap-2 min-h-0 overflow-y-auto">
              {passed.map(row => {
                const right = row.contract.endsWith('P') ? 'P' : 'C';
                return (
                  <li key={`${row.sleeve}|${row.contract}`} className="min-w-0">
                    <span className="flex items-center gap-2 min-w-0">
                      <ContractLabel contract={row.contract} right={right} logo={row.ticker} size="sm" className="shrink-0" />
                      {row.p1 > 0 && <span className="shrink-0 font-mono text-t11 tnum text-textPrimary">{(row.p1 * 100).toFixed(1)}%</span>}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-t10 text-textMuted">{row.why}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-1 text-t12 text-textSecondary">Nothing on this name missed 70.67%.</p>
          )}
        </div>
      </div>

      <div className="px-3.5 h-7 flex items-center border-b border-borderSubtle/60">
        <span className="font-mono text-t9 uppercase tracking-widest text-textPrimary">{sameDay ? 'Before the flat' : 'What can move it'}</span>
      </div>
      <Link to="/dossier" className="block flex-1 px-3.5 py-3 hover:bg-ink/[0.03]" data-desk="dossier">
        <p className="flex items-center gap-1.5 font-mono text-t9 uppercase tracking-widest text-textMuted">
          <PageGlyph name="dossier" size={14} />
          <span className="text-textPrimary">Dossier</span>
          <span>{cash}</span>
        </p>
        {calendarDown ? (
          <p className="mt-1 text-t12 text-textSecondary">The calendar did not answer.</p>
        ) : report && report.daysOut >= 0 && report.daysOut <= (sameDay ? 0 : 7) ? (
          <p className="mt-1 font-mono text-t12 text-textPrimary tnum">
            Reports {report.daysOut === 0 ? 'today' : `in ${report.daysOut} session${report.daysOut === 1 ? '' : 's'}`} · {report.dateLabel} · {report.slot}
            {report.confirmed ? '' : ' · date estimated'}
          </p>
        ) : !sameDay ? (
          <p className="mt-1 text-t12 text-textSecondary">No report inside the week.</p>
        ) : null}
        {!sameDay && report && report.impliedMovePct > 0 && (
          <p className="mt-1 font-mono text-t11 text-textSecondary tnum">
            Priced ±{report.impliedMovePct.toFixed(1)}%
            {report.history && (report.histCount ?? 0) > 0 && report.histAvgMovePct > 0 ? ` · usual ±${report.histAvgMovePct.toFixed(1)}% over ${report.histCount} prints` : ''}
          </p>
        )}
        {!sameDay && report && report.history && ((report.beatCount ?? 0) + (report.missCount ?? 0) + (report.inlineCount ?? 0)) > 0 && (
          <p className="mt-1 font-mono text-t11 text-textSecondary tnum">
            Beat {report.beatCount ?? 0} of {(report.beatCount ?? 0) + (report.missCount ?? 0) + (report.inlineCount ?? 0)}
            {report.nextEpsEst != null && Number.isFinite(report.nextEpsEst) ? ` · street $${report.nextEpsEst.toFixed(2)}` : ''}
            {report.ivRank > 0 ? ` · IV rank ${report.ivRank}` : ''}
          </p>
        )}
        {macro && (Date.parse(dayKeyOf(macro.date)) - Date.parse(nyIsoDate())) / 86_400_000 <= (sameDay ? 0 : 7) ? (
          <p className="mt-1 font-mono text-t11 text-textSecondary tnum">
            {macro.title} · {dayKeyOf(macro.date) === nyIsoDate() ? 'today' : dayKeyOf(macro.date)} {macro.time} ET
            {macro.forecast ? ` · est ${macro.forecast}` : ''}
            {macro.previous ? ` · prior ${macro.previous}` : ''}
          </p>
        ) : null}
        {clock.phase === 'closed' ? <p className="mt-1 font-mono text-t11 text-textSecondary">{clock.line}</p> : null}
        {news.status === 'sim' ? (
          <p className="mt-2 text-t12 text-textSecondary">The wire did not answer.</p>
        ) : news.status === 'loading' && !heads.length ? (
          <p className="mt-2 text-t12 text-textSecondary">Headlines are loading.</p>
        ) : heads.length ? (
          <ul className="mt-2 flex flex-col gap-1">
            {heads.map(ev => (
              <li key={ev.id} className="text-t12 text-textPrimary line-clamp-2">{ev.item.headline}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-t12 text-textSecondary">Nothing pressing on this name.</p>
        )}
      </Link>
    </section>
  );
};

export default NameDesks;
