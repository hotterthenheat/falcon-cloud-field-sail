/* One name's earnings page: the name and its facts, today's price replayed over the last eight reports, beats and moves,
   what the options lose overnight, the calendar into the report, the busiest contracts, and the record. */

import { useLiveQuote } from '../../data/liveQuote';
import { lastSessionIso } from '../../data/nyDate';
import { personDisplay } from '../../data/tickers';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, LayoutGrid } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import AnimatedNumber from '../../components/ui/AnimatedNumber';
import CompanyLogo from '../../components/ui/CompanyLogo';
import HoverReadout from '../../components/ui/HoverReadout';
import { richText, stateOf } from '../../components/earnings/volState';
import { BULL } from '../../components/gex/paletteInk';
import { useTicker } from '../../context/MarketDataContext';
import { dollars3 as fmtDollars } from './money';
import { bracketLabel, seatLabel } from '../../data/congress';
import { useInsiderFlow, useTickerCongress } from '../../data/liveRecord';
import { When } from '../../components/record/when';
import { nyIsoDate } from '../../core/nyTime';
import { MIN_PRICED_PRINTS, reportDayLabel, reportedNow, useLiveDossier, useLiveReactions, useNextReport, useNextReportPending, useWireCheck } from '../../data/earningsFeed';
import { useStockCard } from '../../data/liveFiles';
import { FUND_TYPES } from '../../data/liveFiles';
import { type ActiveContract, type EarningsDossier } from '../../data/earnings';
import { TX_CODES, isChosenBuy } from '../../data/insiders';
import { PRICED_INK, PRICED_WORD, SlotMark, slotWord } from './Earnings';
import CompanyFile from '../../components/record/CompanyFile';
import { EarningsVol } from '../../components/vendor/LiveDesk';
import { Box as RecordBox, Door, Fact as RecordFact } from '../../components/record/ui';
import { expiryOpen } from '../../core/tradingYear';
import { peekIv, useBookRev } from '../../data/uwBook';
import { whalesGreekExpiry, whalesTermStructure, type UwGreekStrike, type UwTerm } from '../../data/whales';

const AXIS = { stroke: 'transparent', tick: { fill: 'rgb(var(--text-secondary))', fontSize: 10, fontFamily: 'inherit' } };
const GRID = { stroke: 'rgba(255,255,255,0.05)', vertical: false };
const BEAR = 'rgb(var(--bear))';
const WHITE_DIM = 'rgba(237,237,237,0.28)';

const TooltipShell = ({ children }: { children: React.ReactNode }) => <div className="border border-borderMuted bg-panel rounded-md px-2.5 py-2 shadow-xl shadow-black/60 font-mono text-t11 text-textPrimary">{children}</div>;

const Box = (p: Parameters<typeof RecordBox>[0]) => <RecordBox scope="earnings" {...p} />;
const Fact = (p: Parameters<typeof RecordFact>[0]) => <RecordFact scope="name" {...p} />;

/* ---- today's price, replayed ---------------------------------------------------- */
/* Is the priced move fair? Today's price for the move replayed over the last eight reports, in dollars: each bar the
   actual move's value minus today's cost, green above the line, red below. */
/** Beat · in line · miss over the EPS quarters (equal to the cent is in line, never a beat) */
const splitOf = (d: EarningsDossier) => {
  const r = d.quarters.map(q => q.epsResult ?? (q.epsBeat ? 'beat' : 'miss'));
  return { beat: r.filter(x => x === 'beat').length, inline: r.filter(x => x === 'inline').length, miss: r.filter(x => x === 'miss').length, n: r.length };
};
const splitText = (d: EarningsDossier) => {
  const s = splitOf(d);
  return s.n ? `${s.beat} beat · ${s.inline} in line · ${s.miss} missed, of ${s.n}` : '—';
};
/** "3 of 8 reports" — a count, never odds */
const upText = (d: EarningsDossier) => (d.up ? `${d.up.n} of ${d.up.of} reports` : '—');
/** The usual move with the count it is the average of */
const usualText = (e: EarningsDossier['event']) => {
  const n = e.histCount ?? e.pastMoves.length;
  if (e.history === false) return '—';
  if (!n) return 'no past move on file';
  return `±${e.histAvgMovePct.toFixed(1)}%${n < 8 ? ` · from ${n} ${n === 1 ? 'print' : 'prints'}` : ''}`;
};

const PriceReplay = ({ d, reported }: { d: EarningsDossier; reported: boolean }) => {
  const e = d.event;
  /* once the print is out, the price is the one before it */
  const priceWord = reported ? 'that price' : "today's price";
  const isPriced = e.impliedMovePct > 0 && e.price > 0;
  const cost = (e.price * e.impliedMovePct) / 100;
  /* the replay runs on the latest eight reports with a move (the event's own), not the EPS table's quarters */
  const rows = useMemo(
    () =>
      e.pastMoves.map(q => {
        const moved = (e.price * Math.abs(q.movePct)) / 100;
        return { label: q.label, movePct: q.movePct, moved, pl: moved - cost };
      }),
    [e.pastMoves, e.price, cost]
  );
  const maxAbs = useMemo(() => Math.max(...rows.map(r => Math.abs(r.pl)), 0.01), [rows]);
  const winners = rows.filter(r => r.pl > 0).length;
  const avg = rows.reduce((a, r) => a + r.pl, 0) / (rows.length || 1);
  const [hover, setHover] = useState<{ r: (typeof rows)[number]; x: number; y: number } | null>(null);
  const H = 56;
  /* a print months out has no straddle on the row: the page says it is not priced and keeps the facts that are real */
  if (!isPriced) {
    return (
      <div className="px-5 pb-4 flex flex-col gap-3" data-name-replay="unpriced">
        <p className="text-t12 text-textSecondary">
          The options do not price this print yet — the feed carries no expected move for {e.dateLabel}
          {e.confirmed ? '' : ', an estimated date'}. The replay fills in once the report is on the near calendar.
        </p>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 pt-3 border-t border-borderSubtle/60">
          <Fact label="Prints on file">{d.quarters.length}</Fact>
          <Fact label="Against the estimate">{splitText(d)}</Fact>
          <Fact label="Usual move">{usualText(e)}</Fact>
          <Fact label="Moved up after">{upText(d)}</Fact>
        </dl>
      </div>
    );
  }
  return (
    <div className="px-5 pb-4 flex flex-col gap-3" data-name-replay>
      <div className="flex items-baseline gap-2.5 flex-wrap font-mono tnum">
        <span className="text-t10 text-textMuted">{reported ? 'What the options priced before the report' : "Today's price for the move"}</span>
        <span className="text-t16 font-bold text-textPrimary">${cost.toFixed(2)}</span>
        <span className="text-t11 text-textSecondary">per share · ±{e.impliedMovePct.toFixed(2)}%</span>
        {reported && e.actualMovePct != null && (
          <span className="text-t11 text-textSecondary" data-replay-moved>
            · the stock {e.moveLive ? 'is moving' : 'moved'} <span className={e.actualMovePct >= 0 ? 'text-bull' : 'text-bear'}>{e.actualMovePct >= 0 ? '+' : '−'}{Math.abs(e.actualMovePct).toFixed(2)}%</span>
            {e.moveLive ? ' so far' : ''} — {Math.abs(e.actualMovePct) > e.impliedMovePct ? 'more than priced' : 'inside the priced move'}
          </span>
        )}
      </div>
      <div className="mx-auto w-full max-w-[640px] select-none">
        <div className="relative" style={{ height: 2 * H }} onMouseLeave={() => setHover(null)}>
          <span className="absolute inset-x-0 top-1/2 h-px bg-ink/25" />
          <span className="absolute left-0 -translate-y-full top-1/2 pb-0.5 font-mono text-t9 uppercase tracking-widest text-textMuted">covered it</span>
          <span className="absolute left-0 top-1/2 pt-0.5 font-mono text-t9 uppercase tracking-widest text-textMuted">fell short</span>
          <div className="absolute inset-y-0 left-24 right-0 flex items-stretch gap-1.5" data-touch-skip>
            {rows.map(r => (
              <button
                key={r.label}
                type="button"
                onMouseEnter={ev => setHover({ r, x: ev.clientX, y: ev.clientY })}
                onMouseMove={ev => setHover({ r, x: ev.clientX, y: ev.clientY })}
                className="relative flex-1 min-w-0 rounded hover:bg-ink/[0.04] transition-colors cursor-default"
                aria-label={`${r.label}: moved ${r.movePct >= 0 ? '+' : r.movePct < 0 ? '−' : ''}${Math.abs(r.movePct).toFixed(1)}%, ${r.pl >= 0 ? 'covered' : 'fell short of'} ${priceWord} by $${Math.abs(r.pl).toFixed(2)} per share`}
                data-replay-bar={r.label}
              >
                <span className={`absolute left-1/2 -translate-x-1/2 w-[22px] rounded-[2px] ${r.pl >= 0 ? 'bg-bull/90' : 'bg-bear/80'}`} style={r.pl >= 0 ? { bottom: '50%', height: Math.max(3, (Math.abs(r.pl) / maxAbs) * H) } : { top: '50%', height: Math.max(3, (Math.abs(r.pl) / maxAbs) * H) }} />
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-1.5 mt-1 pl-24">
          {rows.map(r => (
            <span key={r.label} className="flex-1 min-w-0 text-center font-mono text-t8 sm:text-t9 text-textMuted whitespace-nowrap">
              {r.label}
            </span>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2.5 flex-wrap font-mono tnum">
        <span className="text-t13 font-bold text-textPrimary">covered {priceWord} {winners} of {rows.length} times</span>
        <span className={`text-t11 font-semibold ${avg >= 0 ? 'text-bull' : 'text-bear'}`}>
          avg {avg >= 0 ? '+' : '−'}${Math.abs(avg).toFixed(2)} per share
        </span>
      </div>
      {/* the smaller facts under the replay */}
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 pt-3 border-t border-borderSubtle/60">
        {rows.length > 0 ? (
          <>
            <Fact label="Inside its priced move" tip="Past reports whose next-session move stayed inside the move that report's own options priced">
              {d.inside ? `${d.inside.n} of ${d.inside.of} reports` : '—'}
            </Fact>
            <Fact label="Moved up after" testId="updown">
              {upText(d)}
            </Fact>
            <Fact label="EPS estimate">
              {e.nextEpsEst != null ? (
                <span className="text-textPrimary" title="The street's mean EPS estimate for this report">${e.nextEpsEst.toFixed(2)}</span>
              ) : (
                <span className="text-textMuted" title="No street estimate on this report's row yet">not on file</span>
              )}
            </Fact>
            <Fact label="IV rank">
              {e.ivRank > 0 ? <><span className={e.ivRank >= 80 ? 'text-warn' : 'text-textPrimary'}>{e.ivRank}</span> <span className="text-textMuted">of 100</span></> : <span className="text-textMuted">—</span>}
            </Fact>
          </>
        ) : (
          <>
            <Fact label="Prints on file">{d.quarters.length}</Fact>
            <Fact label="Against the estimate">{splitText(d)}</Fact>
            <Fact label="Options price">±{e.impliedMovePct.toFixed(1)}%</Fact>
            <Fact label="Usual move">{usualText(e)}</Fact>
            <Fact label="The stock">${e.price.toFixed(2)}</Fact>
          </>
        )}
      </dl>
      {hover && (
        <HoverReadout x={hover.x} y={hover.y}>
          <div className="font-mono text-t11 font-bold text-textPrimary tnum">
            {hover.r.label} · moved {hover.r.movePct >= 0 ? '+' : ''}
            {hover.r.movePct.toFixed(1)}%
          </div>
          <div className="font-mono text-t10 text-textSecondary tnum">
            that move was worth ${hover.r.moved.toFixed(2)} · {priceWord} ${cost.toFixed(2)}
          </div>
          <div className={`font-mono text-t11 font-bold tnum ${hover.r.pl >= 0 ? 'text-bull' : 'text-bear'}`}>
            {hover.r.pl >= 0 ? '+' : '−'}${Math.abs(hover.r.pl).toFixed(2)} per share against {priceWord}
          </div>
        </HoverReadout>
      )}
    </div>
  );
};

/* ---- a busy contract ------------------------------------------------------------ */
/* facts only, the contract's own arithmetic; the volume bar ranks it against the busiest */
/* the row is a door to the Weigher with the contract picked */
const ActiveRow = ({ c, maxVol, onOpen, onWarm }: { c: ActiveContract; maxVol: number; onOpen: () => void; onWarm?: () => void }) => (
  <button
    type="button"
    onClick={onOpen}
    onMouseEnter={onWarm}
    onFocus={onWarm}
    title="Weigh this contract"
    className="group/door w-full text-left px-5 py-2.5 border-t border-borderSubtle/40 flex flex-col gap-1 hover:bg-ink/[0.03] focus-visible:bg-ink/[0.03] outline-none transition-colors"
    data-name-contract={c.id}
    data-contract-strike={c.strike}
    data-contract-right={c.right}
  >
    <div className="flex items-baseline gap-2">
      <span className="font-mono text-t12 font-bold text-textPrimary group-hover/door:text-silver group-focus-visible/door:text-silver transition-colors">{c.label}</span>
      <span className="ml-auto font-mono text-t12 font-semibold text-textPrimary tnum">
        ~<AnimatedNumber value={c.mid} format={v => `$${v.toFixed(2)}`} />
      </span>
      <span className="inline-flex items-center gap-1 pl-2 font-mono text-t9 uppercase tracking-widest text-textMuted group-hover/door:text-silver group-focus-visible/door:text-silver transition-colors" data-contract-door>
        <ArrowUpRight className="w-3 h-3" />
        Weigh it
      </span>
    </div>
    <div className="flex items-center gap-2">
      <span className="font-mono text-t9 uppercase tracking-widest text-textMuted shrink-0">vol</span>
      <span className="relative w-24 h-[4px] rounded-full bg-ink/[0.06] shrink-0">
        <span className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out ${c.right === 'CALL' ? 'bg-bull/80' : 'bg-bear/70'}`} style={{ width: `${Math.max(6, (c.volume / maxVol) * 100)}%` }} />
      </span>
      <span className="font-mono text-t11 font-semibold text-textPrimary tnum">
        <AnimatedNumber value={c.volume} format={v => Math.round(v).toLocaleString()} />
      </span>
      <span className="font-mono text-t10 text-textSecondary tnum">
        open interest {c.oi.toLocaleString()} · <AnimatedNumber value={c.volOverOi} format={v => `${v.toFixed(2)}×`} /> · IV {c.ivPct}%
      </span>
    </div>
    <span className="font-mono text-t10 text-textMuted tnum">
      {c.fromSpotPct === 0 ? 'at the money' : `${c.fromSpotPct > 0 ? '+' : c.fromSpotPct < 0 ? '−' : ''}${Math.abs(c.fromSpotPct)}% from ${c.spotWord ?? 'spot'}`} ·{' '}
      {/* already through its breakeven at today's price (the $385 put on a $373.63 TSLA) — not "breaks even −0%" */}
      {c.breakevenPct > 0 ? `breaks even ${c.right === 'CALL' ? '+' : '−'}${c.breakevenPct}% by expiry` : `past its breakeven at ${c.spotWord ?? "today's price"}`}
    </span>
  </button>
);

/* ---- the calendar into the report ---------------------------------------------------- */
/* A calendar sells the first listed expiry on or after the report and buys the next; the two ATM vols are the vendor's
   term structure, the dates its expiry book. Nothing here is a guessed vol. */

interface ListedCurve {
  status: 'loading' | 'live' | 'miss';
  /** Still-open expiries, nearest first */
  dates: string[];
  /** Annualised ATM fraction, only where the curve printed one */
  iv: Record<string, number>;
}

const isoOf = (raw: unknown): string => {
  const d = String(raw ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
};

const atmOf = (raw: unknown): number | null => {
  const v = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''));
  if (!Number.isFinite(v) || !(v > 0)) return null;
  const annual = v > 3 ? v / 100 : v;
  return annual > 0 && annual < 5 ? annual : null;
};

function useListedCurve(ticker: string): ListedCurve {
  const [curve, setCurve] = useState<ListedCurve>({ status: 'loading', dates: [], iv: {} });
  useEffect(() => {
    let dead = false;
    setCurve({ status: 'loading', dates: [], iv: {} });
    void (async () => {
      const [listed, term] = await Promise.all([
        whalesGreekExpiry(ticker).catch(() => null as UwGreekStrike[] | null),
        whalesTermStructure(ticker).catch(() => null as UwTerm[] | null),
      ]);
      if (dead) return;
      const iv: Record<string, number> = {};
      const termDates: string[] = [];
      if (Array.isArray(term)) {
        for (const row of term) {
          const d = isoOf(row.expiry ?? row.date);
          if (!d) continue;
          termDates.push(d);
          const vol = atmOf(row.volatility);
          if (vol != null) iv[d] = vol;
        }
      }
      const fromBook = Array.isArray(listed) ? listed.map(r => isoOf(r.expiry)).filter(Boolean) : [];
      /* An empty listing came back — that is the chain. The curve's dates stand in only when the listing itself did not. */
      const dates = [...new Set(listed == null ? termDates : fromBook)].filter(d => expiryOpen(d)).sort();
      setCurve({ status: listed == null && term == null ? 'miss' : 'live', dates, iv });
    })();
    return () => {
      dead = true;
    };
  }, [ticker]);
  return curve;
}

const volPct = (v: number): string => `${(v * 100).toFixed(2)}%`;

/** The calendar into the next report. Dates and vols only — no grade. */
const CalendarSpread = ({ ticker }: { ticker: string }) => {
  const next = useNextReport(ticker);
  const pending = useNextReportPending(ticker);
  const curve = useListedCurve(ticker);
  /* The book's iv is the 30-day implied vol off iv-rank, and only when that book is already live.
     Nothing on this page loads a 30-day realized vol — compass tape.rv30 is thirty minutes, not thirty days. */
  useBookRev();
  const iv30 = peekIv(ticker);
  const when = next ? slotWord({ slot: next.slot, timeKnown: next.event?.timeKnown }) : '';
  const onOrAfter = next ? curve.dates.filter(d => d >= next.iso) : [];
  const front = onOrAfter[0];
  const back = onOrAfter[1];
  const frontIv = front ? curve.iv[front] : undefined;
  const backIv = back ? curve.iv[back] : undefined;
  const bothVols = frontIv != null && backIv != null;
  const diffPts = bothVols ? (frontIv - backIv) * 100 : null;

  let dates = '';
  if (pending) dates = 'Reading the next report.';
  else if (!next) dates = 'No coming report on this name.';
  else if (curve.status === 'loading') dates = 'Reading the listed expiries.';
  else if (curve.status === 'miss') dates = 'The listed expiries did not come back, so the two dates are not named.';
  else if (!front || !back) dates = onOrAfter.length === 1
    ? `A calendar needs two listed expiries on or after that report. This name lists one, ${reportDayLabel(onOrAfter[0])}, so it is not scored.`
    : 'A calendar needs two listed expiries on or after that report. This name does not list both, so it is not scored.';
  else dates = `A calendar sells ${reportDayLabel(front)} and buys ${reportDayLabel(back)}.`;

  let richness = '';
  if (next && !pending && curve.status === 'miss') {
    richness = 'The richness is not scored because the curve is not on this page.';
  } else if (next && !pending && front && back && curve.status === 'live') {
    if (bothVols && diffPts != null) {
      richness = Math.abs(diffPts) < 0.005
        ? `The at-the-money vol is ${volPct(frontIv)} on both.`
        : `The at-the-money vol on the one sold is ${volPct(frontIv)}. On the one bought it is ${volPct(backIv)}. The one sold is ${Math.abs(diffPts).toFixed(2)} points ${diffPts > 0 ? 'higher' : 'lower'}.`;
    } else if (Object.keys(curve.iv).length === 0) {
      richness = 'The richness is not scored because the curve is not on this page.';
    } else {
      const missing = [frontIv == null ? reportDayLabel(front) : '', backIv == null ? reportDayLabel(back) : ''].filter(Boolean).join(' and ');
      richness = `The richness is not scored. The curve has no at-the-money vol for ${missing}.`;
    }
  }

  return (
    <Box title="The calendar" sub={`${ticker} · sell the first listed expiry on or after the report, buy the next one`} testId="calendar">
      <div className="px-5 pb-4 flex flex-col gap-2" data-calendar-spread={ticker}>
        {next && !pending ? (
          <p className="text-t12 text-textPrimary">
            {ticker} reports {next.dateLabel}, {when}{next.confirmed ? '' : ' · the date is estimated'}.
          </p>
        ) : null}
        <p className="text-t12 text-textSecondary">{dates}</p>
        {richness ? <p className="text-t12 text-textSecondary" data-calendar-richness>{richness}</p> : null}
        {next && !pending ? (
          <p className="text-t12 text-textMuted" data-calendar-ivrv>
            {iv30 != null ? `The 30-day implied vol is ${volPct(iv30)}. ` : ''}
            Implied against what the stock has done is not scored. {iv30 == null ? 'A 30-day implied vol and a 30-day realized vol are' : 'A 30-day realized vol is'} not loaded for this name.
          </p>
        ) : null}
      </div>
    </Box>
  );
};

/* ---- the page ------------------------------------------------------------------- */

const EarningsName = () => {
  const { ticker = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { changeTicker } = useTicker();
  const fromDesk = (location.state as { from?: string } | null)?.from === 'desk';
  const T = ticker.toUpperCase();
  const liveFile = useLiveDossier(T);
  useWireCheck(T, liveFile.dossier?.event.iso, liveFile.dossier?.event.slot);
  const dossier = liveFile.status === 'live' ? liveFile.dossier : null;
  /* the reacting session's move so far, off the live price */
  /* the name on its own page is always read, known name or not */
  useLiveReactions(useMemo(() => (dossier ? [{ ...dossier.event, known: true, reported: reportedNow(dossier.event) }] : []), [dossier]));
  /* A busiest row → the Weigher with THE contract picked, this page as the way back */
  const weigh = (c: ActiveContract) =>
    navigate('/weigher', { state: { weigh: { ticker: T, strike: c.strike, right: c.right === 'CALL' ? 'C' : 'P', expiry: c.expiry }, wayBack: location.pathname } });
  /* the record, read for this one name */
  const insiders = useInsiderFlow(T, 90);
  const congressBook = useTickerCongress(T, 180);
  const congress = useMemo(() => [...congressBook.trades].sort((a, b) => a.filedDaysAgo - b.filedDaysAgo), [congressBook]);
  /* the stock now, read before any early return (hooks keep their order) */
  const quote = useLiveQuote(T);
  /* a fund has no earnings: the page says so, not "no report on the calendar" */
  const card = useStockCard(T);
  const isFund = !!card?.issueType && FUND_TYPES.test(card.issueType);

  const back = (
    <div className="flex items-center gap-4" data-name-back>
      <Link to="/dossier/earnings" className="group inline-flex items-center gap-1.5 font-mono text-t10 uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors">
        <ArrowLeft className="w-3.5 h-3.5 transition-transform duration-200 ease-out group-hover:-translate-x-0.5" /> The calendar
      </Link>
      {fromDesk && (
        <Link to="/pulse" className="inline-flex items-center gap-1.5 font-mono text-t10 uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors">
          <LayoutGrid className="w-3.5 h-3.5" /> The desk
        </Link>
      )}
    </div>
  );

  if (liveFile.status === 'loading') {
    return (
      <>
        {back}
        <div className="border border-borderSubtle rounded-md bg-panel h-40 flex flex-col items-center justify-center gap-2" data-name-missing>
          <span className="font-mono text-t13 font-bold text-textPrimary">{T}</span>
          <span className="font-mono text-t10 uppercase tracking-widest text-textMuted">Reading the prints</span>
        </div>
      </>
    );
  }

  if (!dossier) {
    return (
      <>
        {back}
        <div className="border border-borderSubtle rounded-md bg-panel h-40 flex flex-col items-center justify-center gap-2" data-name-missing>
          <span className="font-mono text-t13 font-bold text-textPrimary">{T}</span>
          <span className="font-mono text-t10 uppercase tracking-widest text-textMuted">{isFund ? 'a fund — funds do not report earnings' : 'no report on file for this name'}</span>
        </div>
      </>
    );
  }

  const { event: e, quarters } = dossier;
  const priced = stateOf(e);
  /* no expected move on the row (a print months out) — every straddle figure says so instead of $0.00 */
  const isPriced = e.impliedMovePct > 0 && e.price > 0;
  /* the print is out once its date has passed, or today once its slot has (reportedNow) */
  /* the stock NOW — the calendar row's price is the one the options were priced against, stale once the print is out
     (TSLA read $386.55 after closing the night at $373.63) */
  /* the regular price leads, the extended print beside it, named */
  const spotNow = quote?.regularPrice && quote.regularPrice > 0 ? quote.regularPrice : e.price;
  const extNow = quote?.extPrice != null && quote.extPrice > 0 ? { px: quote.extPrice, word: quote.phase === 'pre' ? 'pre-market' : 'after hours' } : null;
  /* the board's own rule (earningsFeed.reportedNow), so the two never disagree on whether a print is out */
  const reported = reportedNow(e);
  const nQ = quarters.length || 0;
  const hasRev = quarters.some(q => q.revEstB > 0);
  const split = splitOf(dossier);
  /* the ratio of the two figures shown, once the print is out too */
  const ratioOk = (e.histCount ?? e.pastMoves.length) >= MIN_PRICED_PRINTS && e.richness > 0;
  const revBeats = quarters.filter(q => q.revBeat).length;
  const moveData = e.pastMoves.map(q => ({ label: q.label, move: q.movePct }));
  const nMoves = moveData.length;
  const epsData = quarters.map(q => ({ label: q.label, est: q.epsEst, actual: q.epsActual, beat: q.epsBeat, inline: q.epsResult === 'inline' }));
  const maxActiveVol = Math.max(...dossier.activeCalls.map(c => c.volume), ...dossier.activePuts.map(c => c.volume), 1);
  const openOnMap = () => {
    changeTicker(e.ticker);
    navigate('/pinpoint/map');
  };
  /* the session the chain's volume is from, by its date */
  const chainDay = (() => {
    const iso = lastSessionIso();
    return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  })();
  const callSub = !dossier.live
    ? 'The three busiest by volume into the print · refreshes every ten seconds · click one to weigh it'
    : dossier.activeCalls.length
      ? `The three busiest by volume on ${chainDay} · click one to weigh it`
      : dossier.contractsReady
        ? `No volume on the chain on ${chainDay}`
        : 'Reading the chain';
  const putSub = !dossier.live
    ? 'The three busiest by volume into the print · refreshes every ten seconds · click one to weigh it'
    : dossier.activePuts.length
      ? `The three busiest by volume on ${chainDay} · click one to weigh it`
      : dossier.contractsReady
        ? `No volume on the chain on ${chainDay}`
        : 'Reading the chain';

  /* newest trade first */
  const marketInsiders = insiders.trades.filter(t => TX_CODES[t.code].openMarket).sort((a, b) => (b.tradedOn ?? '').localeCompare(a.tradedOn ?? '') || a.daysAgo - b.daysAgo).slice(0, 6);

  return (
    <>
      {back}

      {/* THE NAME */}
      <div className="border border-borderSubtle rounded-md bg-panel" data-earnings-name={e.ticker}>
        <div className="px-5 pt-4 pb-4 flex items-start gap-6 flex-wrap">
          <div className="min-w-0 flex-1 flex items-center gap-3">
            <CompanyLogo ticker={e.ticker} size={34} />
            <div className="min-w-0">
              <div className="h-6 flex items-center gap-2.5">
                <h3 className="min-w-0 truncate text-t15 font-semibold leading-tight text-textPrimary">{e.name}</h3>
                <span className="font-mono text-t11 font-bold text-textSecondary">{e.ticker}</span>
              </div>
              {/* an inline-flex line spills rather than truncates, so on a phone it folds */}
              <p className="mt-0.5 text-t11 text-textMuted whitespace-nowrap truncate inline-flex items-center gap-1.5 max-xl:flex-wrap">
                {reported ? 'Reported' : 'Reports'} {e.dateLabel} <SlotMark slot={e.slot} timeKnown={e.timeKnown} className="w-3 h-3" /> {slotWord(e)}
                <span className="text-textMuted">·</span>
                {reported ? (
                  e.actualMovePct != null ? (
                    <span className="text-textMuted" data-earnings-moved>
                      {e.moveLive ? 'the stock is moving' : 'the stock moved'} <span className={e.actualMovePct >= 0 ? 'text-bull' : 'text-bear'}>{e.actualMovePct >= 0 ? '+' : '−'}{Math.abs(e.actualMovePct).toFixed(2)}%</span> {e.moveLive ? 'so far' : ''} {e.slot === 'BMO' && e.timeKnown !== false ? 'on the report day' : 'the session after'}
                    </span>
                  ) : (
                    <span className="text-textMuted">{e.reactionIso && e.reactionIso === nyIsoDate() ? 'the reacting session is today — reading its move' : e.slot === 'BMO' ? "the move is the report day's session — the feed has not posted it yet" : "the move is the next session's — it is not made yet"}</span>
                  )
                ) : (
                  <span className={e.confirmed ? 'text-textMuted' : 'text-warn'}>{e.confirmed ? 'the company has confirmed the date' : 'date estimated — the company has not set it'}</span>
                )}
                {e.daysOut === 0 && (
                  <>
                    <span className="text-textMuted">·</span>
                    <span className="text-silver">today</span>
                  </>
                )}
              </p>
              {/* the next report after the one that is out */}
              {reported && dossier.nextAfter ? (
                <p className="mt-0.5 text-t11 text-textMuted whitespace-nowrap truncate inline-flex items-center gap-1.5 max-xl:flex-wrap" data-earnings-next>
                  Next report {dossier.nextAfter.dateLabel} <SlotMark slot={dossier.nextAfter.slot} timeKnown={dossier.nextAfter.timeKnown} className="w-3 h-3" /> {slotWord(dossier.nextAfter)}
                  <span className="text-textMuted">·</span>
                  <span className={dossier.nextAfter.confirmed ? 'text-textMuted' : 'text-warn'}>{dossier.nextAfter.confirmed ? 'the company has confirmed the date' : 'date estimated — the company has not set it'}</span>
                </p>
              ) : null}
            </div>
          </div>
          <dl className="grid grid-cols-5 gap-x-6">
            <Fact label={reported ? 'Options priced' : 'Options price'} testId="price">
              {isPriced ? (
                <>
                  ±{e.impliedMovePct.toFixed(1)}% <span className="text-textMuted">· ${((e.price * e.impliedMovePct) / 100).toFixed(2)}</span>
                </>
              ) : (
                <span className="text-textMuted">not priced yet</span>
              )}
            </Fact>
            <Fact label="Usually moves" testId="usual">
              {usualText(e)}
            </Fact>
            <Fact label="Priced · options ÷ usual" testId="priced">
              {!ratioOk || !isPriced ? <span className="text-textMuted" title={reported ? 'Reported — the move is in' : `Rich or cheap needs ${MIN_PRICED_PRINTS} past moves on file`}>—</span> : (
              <span className={PRICED_INK[priced]} title={`The options' ±${e.impliedMovePct.toFixed(1)}% over the usual ±${e.histAvgMovePct.toFixed(1)}% — rich above 1.3×, cheap below 0.85×`}>
                {richText(e.richness)}× {PRICED_WORD[priced]} <span className="text-textMuted text-t10">(±{e.impliedMovePct.toFixed(1)} ÷ ±{e.histAvgMovePct.toFixed(1)})</span>
              </span>
              )}
            </Fact>
            <Fact label="Beat · in line · miss" testId="beat">
              {nQ ? <><span className="text-bull">{split.beat}</span> · {split.inline} · <span className="text-bear">{split.miss}</span> <span className="text-textMuted">of {nQ}</span>{hasRev ? <span className="text-textMuted"> · revenue {revBeats} of {nQ}</span> : null}</> : <span className="text-textMuted">—</span>}
            </Fact>
            <Fact label={`Last ${nQ || ''} with an estimate`} testId="last8">
              <span className="inline-flex gap-[3px] align-middle" title="each square one quarter with an estimate, oldest first — green beat, amber in line, red missed">
                {quarters.map(q => (
                  <span key={q.label} className={`w-2 h-2 rounded-[2px] ${q.epsResult === 'inline' ? 'bg-warn/70' : q.epsBeat ? 'bg-bull' : 'bg-bear/60'}`} />
                ))}
              </span>
            </Fact>
          </dl>
        </div>
        <div className="px-5 pb-3 flex items-center gap-2 flex-wrap" data-name-doors>
          <Door onClick={openOnMap}>
            The Map
          </Door>
          <Door onClick={() => navigate('/weigher', { state: { weigh: { ticker: e.ticker } } })}>
            Weigh it
          </Door>
          <Door onClick={() => navigate('/compass', { state: { tickerFilter: e.ticker } })}>
            Compass
          </Door>
          <Door onClick={() => navigate('/dossier/news', { state: { name: e.ticker } })}>The wire</Door>
        </div>
      </div>

      <Box title={reported ? 'The price before the report, replayed' : "Today's price, replayed"} sub={`${reported ? 'What the options charged before the print' : 'What the options charge now'}, tested against the last ${nMoves || 'few'} real ${nMoves === 1 ? 'print' : 'prints'} with a move — hover a bar`} testId="replay">
        <PriceReplay d={dossier} reported={reported} />
      </Box>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-stretch">
        <Box title="Beats and misses" sub={`EPS against the estimate · ${split.beat} beat, ${split.inline} in line, ${split.miss} missed of ${nQ}${hasRev ? ` · revenue ${revBeats} of ${nQ}` : ''}`} testId="beats">
          <div className="px-5 pb-4">
            <div className="h-[132px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={epsData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }} barGap={2}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="label" {...AXIS} />
                  <YAxis {...AXIS} width={40} tickFormatter={(v: number) => `$${v}`} />
                  <Tooltip
                    isAnimationActive={false}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    content={({ active, payload, label }) =>
                      active && payload?.length ? (
                        <TooltipShell>
                          <div className="text-textSecondary">{label}</div>
                          <div>estimate ${Number(payload[0]?.value).toFixed(2)}</div>
                          <div>actual ${Number(payload[1]?.value).toFixed(2)}</div>
                        </TooltipShell>
                      ) : null
                    }
                  />
                  <Bar dataKey="est" fill={WHITE_DIM} radius={[2, 2, 0, 0]} barSize={9} isAnimationActive={false} />
                  <Bar dataKey="actual" radius={[2, 2, 0, 0]} barSize={9} isAnimationActive={false}>
                    {epsData.map(q => (
                      <Cell key={q.label} fill={q.inline ? 'rgb(var(--warn))' : q.beat ? BULL : BEAR} fillOpacity={q.beat ? 0.9 : 0.8} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 font-mono text-t9 uppercase tracking-widest text-textMuted">
              grey the estimate · <span className="text-bull">green beat</span> · <span className="text-warn">amber in line</span> · <span className="text-bear">red missed</span>
            </p>
          </div>
        </Box>
        <Box title="Past moves" sub={`The stock's move the session after each of its last ${nMoves || 'few'} reports`} testId="moves">
          <div className="px-5 pb-4">
            <div className="h-[132px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={moveData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="label" {...AXIS} />
                  <YAxis {...AXIS} width={40} tickFormatter={(v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}%`} />
                  <Tooltip
                    isAnimationActive={false}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    content={({ active, payload, label }) =>
                      active && payload?.length ? (
                        <TooltipShell>
                          <div className="text-textSecondary">{label}</div>
                          <div>
                            {Number(payload[0]?.value) >= 0 ? '+' : ''}
                            {Number(payload[0]?.value).toFixed(1)}% next session
                          </div>
                        </TooltipShell>
                      ) : null
                    }
                  />
                  {isPriced && <ReferenceLine y={e.impliedMovePct} stroke="rgba(199,211,232,0.55)" strokeDasharray="4 3" />}
                  {isPriced && <ReferenceLine y={-e.impliedMovePct} stroke="rgba(199,211,232,0.55)" strokeDasharray="4 3" />}
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
                  <Bar dataKey="move" radius={[2, 2, 0, 0]} barSize={16} isAnimationActive={false}>
                    {moveData.map(q => (
                      <Cell key={q.label} fill={q.move >= 0 ? BULL : BEAR} fillOpacity={q.move >= 0 ? 0.9 : 0.8} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 font-mono text-t9 uppercase tracking-widest text-textMuted">
              {isPriced ? `the dashed lines are the ±${e.impliedMovePct.toFixed(1)}% priced for this print` : 'the options do not price this print yet'}
            </p>
          </div>
        </Box>
      </div>

      <Box title="After the print" sub="What the options lose overnight once the number is out" testId="after">
        <dl className="px-5 pb-4 grid grid-cols-4 gap-x-6">
          {/* the median premium a long straddle gave back by the next open on the quiet prints: the option's loss, not an IV drop */}
          <Fact label="A quiet print takes" testId="crush">
            {!dossier.live || dossier.crushKnown ? <span className="text-warn">−{dossier.ivCrushPct}%</span> : <span className="text-textMuted">—</span>}
          </Fact>
          <Fact label="Straddle kept by next open">{!dossier.live || dossier.crushKnown ? `~${Math.max(0, 100 - dossier.premiumLostPct)}%` : '—'}</Fact>
          <Fact label={reported ? 'Straddle priced' : 'Straddle today'}>{isPriced ? `$${((e.price * e.impliedMovePct) / 100).toFixed(2)}` : <span className="text-textMuted">—</span>}</Fact>
          <Fact label={quote && quote.phase !== 'regular' ? 'The stock · close' : 'The stock'}>
            {spotNow > 0 ? (
              <>
                ${spotNow.toFixed(2)}
                {extNow ? <span className="block text-t10 text-textMuted" data-name-fact="ext">{extNow.word} ${extNow.px.toFixed(2)}</span> : null}
              </>
            ) : (
              <span className="text-textMuted">—</span>
            )}
          </Fact>
        </dl>
      </Box>

      <CalendarSpread ticker={T} />

      <EarningsVol ticker={T} />

      {/* the busiest contracts: each row a door to the Weigher, this page the way back */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-stretch">
        <Box title="Busiest calls" sub={callSub} testId="calls">
          <div className="pb-2">
            {dossier.activeCalls.length === 0 ? <p className="px-5 py-3 font-mono text-t10 uppercase tracking-widest text-textMuted">{dossier.live ? (dossier.contractsReady ? `No volume on the chain on ${chainDay}` : 'Reading the chain') : 'Nothing trading'}</p> : null}
            {dossier.activeCalls.map(c => (
              <ActiveRow key={c.id} c={c} maxVol={maxActiveVol} onOpen={() => weigh(c)} />
            ))}
          </div>
        </Box>
        <Box title="Busiest puts" sub={putSub} testId="puts">
          <div className="pb-2">
            {dossier.activePuts.length === 0 ? <p className="px-5 py-3 font-mono text-t10 uppercase tracking-widest text-textMuted">{dossier.live ? (dossier.contractsReady ? `No volume on the chain on ${chainDay}` : 'Reading the chain') : 'Nothing trading'}</p> : null}
            {dossier.activePuts.map(c => (
              <ActiveRow key={c.id} c={c} maxVol={maxActiveVol} onOpen={() => weigh(c)} />
            ))}
          </div>
        </Box>
      </div>

      <CompanyFile ticker={T} />

      {/* the record's pair shares one bottom edge; rows at the top, the door at the foot */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-stretch" data-name-record>
        <Box title="What its insiders did" sub={`Open-market trades in the last 90 days · ${insiders.status === 'loading' ? 'reading…' : insiders.status === 'sim' ? 'the read did not land' : insiders.trades.length ? insiders.signal : 'nothing filed'}`} testId="insiders">
          {marketInsiders.length === 0 ? (
            <div className="px-5 pb-5 pt-1 font-mono text-t10 uppercase tracking-widest text-textMuted">{insiders.status === 'loading' ? 'Reading the filings…' : insiders.status === 'sim' ? 'This read did not land' : 'Nothing on the record in 90 days'}</div>
          ) : (
            <>
              {/* below xl: when, who, the trade and its value */}
              <div className="px-5 h-[22px] grid items-center gap-x-3 text-t9 uppercase tracking-widest text-textMuted grid-cols-[96px_minmax(0,1fr)_44px_60px_60px_64px] max-xl:grid-cols-[96px_minmax(0,1fr)_44px_64px]">
                <span>When</span>
                <span>Who</span>
                <span>Trade</span>
                <span className="text-right max-xl:hidden">Shares</span>
                <span className="text-right">Value</span>
                <span className="text-right max-xl:hidden">Chose to?</span>
              </div>
              {marketInsiders.map(t => (
                <div key={t.id} className="px-5 h-[38px] grid items-center gap-x-3 border-t border-borderSubtle/40 grid-cols-[96px_minmax(0,1fr)_44px_60px_60px_64px] max-xl:grid-cols-[96px_minmax(0,1fr)_44px_64px]" data-name-insider={t.id}>
                  <When days={t.daysAgo} size={10} />
                  <span className="min-w-0 flex flex-col leading-tight">
                    <span className="text-t11 font-semibold text-textPrimary truncate">{personDisplay(t.person)}</span>
                    <span className="text-t9 text-textMuted truncate">{t.role}</span>
                  </span>
                  <span className={`font-mono text-t10 ${t.kind === 'BUY' ? 'text-bull' : 'text-bear'}`}>{t.kind === 'BUY' ? 'Bought' : 'Sold'}</span>
                  <span className="text-right font-mono text-t10 tnum text-textPrimary max-xl:hidden">{Math.round(t.shares).toLocaleString('en-US')}</span>
                  <span className="text-right font-mono text-t10 tnum font-semibold text-textPrimary">{fmtDollars(t.value)}</span>
                  <span className={`text-right font-mono text-t8 uppercase tracking-widest max-xl:hidden ${t.plan === 'discretionary' ? (isChosenBuy(t) ? 'text-textPrimary font-bold' : 'text-textSecondary') : 'text-textMuted'}`}>
                    {t.entity && t.plan !== 'plan' ? 'corporate' : t.plan === 'discretionary' ? 'chosen' : t.plan === 'plan' ? 'planned' : 'unstated'}
                  </span>
                </div>
              ))}
              <div className="mt-auto px-5 py-2.5 border-t border-borderSubtle/40 flex items-center gap-4 font-mono text-t10 tnum" data-name-foot="insiders">
                <span className="text-textSecondary">
                  bought <span className={insiders.bought > 0 ? 'text-bull' : 'text-textMuted'}>{insiders.bought > 0 ? fmtDollars(insiders.bought) : 'nothing'}</span> · sold{' '}
                  <span className={insiders.sold > 0 ? 'text-bear' : 'text-textMuted'}>{insiders.sold > 0 ? fmtDollars(insiders.sold) : 'nothing'}</span>
                </span>
                <Link to="/dossier/insiders" className="ml-auto inline-flex items-center gap-1 text-t9 uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors">
                  <ArrowUpRight className="w-3 h-3" /> every insider
                </Link>
              </div>
            </>
          )}
        </Box>
        <Box title="What Congress reported" sub={`STOCK Act reports of trades in this stock made in the last 180 days${congressBook.complete ? '' : ' — the latest 200 reports only'}`} testId="congress">
          {congress.length === 0 ? (
            <div className="px-5 pb-5 pt-1 font-mono text-t10 uppercase tracking-widest text-textMuted">{congressBook.status === 'loading' ? 'Reading the reports' : congressBook.status === 'sim' ? 'This read did not land' : 'No trade in this stock reported in 180 days'}</div>
          ) : (
            <>
              {/* on a phone: filed, member and type */}
              <div className="px-5 h-[22px] grid items-center gap-x-3 text-t9 uppercase tracking-widest text-textMuted grid-cols-[96px_minmax(0,1fr)_76px_132px_56px] max-xl:grid-cols-[96px_minmax(0,1fr)_76px]">
                <span>Filed</span>
                <span>Member</span>
                <span>Type</span>
                <span className="max-xl:hidden">Amount disclosed</span>
                <span className="text-right max-xl:hidden">Lag</span>
              </div>
              {congress.slice(0, 6).map(t => (
                <div key={t.id} className="px-5 h-[38px] grid items-center gap-x-3 border-t border-borderSubtle/40 grid-cols-[96px_minmax(0,1fr)_76px_132px_56px] max-xl:grid-cols-[96px_minmax(0,1fr)_76px]" data-name-congress={t.id}>
                  <When days={t.filedDaysAgo} size={10} />
                  <span className="min-w-0 flex flex-col leading-tight">
                    <span className="text-t11 font-semibold text-textPrimary truncate">{t.member.name}</span>
                    <span className="text-t9 text-textMuted truncate">
                      {seatLabel(t.member)} · {t.member.chamber}
                    </span>
                  </span>
                  <span className={`font-mono text-t10 ${t.type === 'Purchase' ? 'text-bull' : t.type === 'Exchange' ? 'text-textMuted' : 'text-bear'}`}>{t.type === 'Purchase' ? 'Purchase' : t.type === 'Exchange' ? 'Exchange' : t.type === 'Sale (Partial)' ? 'Sale · partial' : 'Sale'}</span>
                  <span className="font-mono text-t10 tnum text-textPrimary truncate max-xl:hidden">{bracketLabel(t.bracket)}</span>
                  <span className={`text-right font-mono text-t10 tnum max-xl:hidden ${t.late ? 'text-bear' : 'text-textSecondary'}`}>
                    {t.lagDays}d{t.late ? ' late' : ''}
                  </span>
                </div>
              ))}
              <div className="mt-auto px-5 py-2.5 border-t border-borderSubtle/40 flex items-center font-mono text-t10" data-name-foot="congress">
                <Link to="/dossier/congress" className="ml-auto inline-flex items-center gap-1 text-t9 uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors">
                  <ArrowUpRight className="w-3 h-3" /> every report
                </Link>
              </div>
            </>
          )}
        </Box>
      </div>
    </>
  );
};

export default EarningsName;
