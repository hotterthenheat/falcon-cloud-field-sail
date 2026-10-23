/*
==================================================
  SLAYER TERMINAL - A NAME'S EARNINGS PAGE
  (pages/record/EarningsName.tsx)

  Everything on the record about one name before it
  reports (/record/earnings/:ticker), in reading
  order and in the house grammar (2026-09-09; the
  old dossier's uppercase panels and dotted-leader
  facts are gone, its charts kept):

    THE NAME       the mark, the company, when and
                   whether the date is set, the
                   facts — the options price, the
                   usual move, how it is priced, the
                   beat count
    TODAY'S PRICE, today's straddle replayed over
    REPLAYED       the last eight real prints — money,
                   not statistics — with the odds
    BEATS AND      estimate against actual, and the
    MISSES ·       stock's move after each of the
    PAST MOVES     last eight reports
    AFTER THE      what the options lose overnight
    PRINT
    THE BUSIEST    the three busiest calls and puts
    CONTRACTS      into the print, facts not picks
    ON THE RECORD  what this name's insiders did and
                   what Congress reported in it — the
                   other two pages of the Record,
                   read for one name

  Everything speaks the engines that were here
  (data/earnings.ts, data/insiders.ts,
  data/congress.ts).
==================================================
*/

import { useLiveQuote } from '../../data/liveQuote';
import { lastSessionIso } from '../../data/nyDate';
import { useMemo, useState } from 'react';
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
import { MIN_PRICED_PRINTS, reportedNow, useLiveDossier, useWireCheck } from '../../data/earningsFeed';
import { useStockCard } from '../../data/liveFiles';
import { FUND_TYPES } from '../../data/liveFiles';
import { type ActiveContract, type EarningsDossier } from '../../data/earnings';
import { TX_CODES, isChosenBuy } from '../../data/insiders';
import { PRICED_INK, PRICED_WORD, SlotMark, slotWord } from './Earnings';
import CompanyFile from '../../components/record/CompanyFile';
import { EarningsVol } from '../../components/vendor/LiveDesk';
import { statHelp } from '../../components/record/statHelp';

const AXIS = { stroke: 'transparent', tick: { fill: 'rgb(var(--text-secondary))', fontSize: 10, fontFamily: 'inherit' } };
const GRID = { stroke: 'rgba(255,255,255,0.05)', vertical: false };
const BEAR = 'rgb(var(--bear))';
const WHITE_DIM = 'rgba(237,237,237,0.28)';

const TooltipShell = ({ children }: { children: React.ReactNode }) => <div className="border border-borderMuted bg-panel rounded-md px-2.5 py-2 shadow-xl shadow-black/60 font-mono text-[11px] text-textPrimary">{children}</div>;

/** A box in the house grammar: the 15px title, the 11px line, whatever follows */
const Box = ({ title, sub, children, testId, className = '' }: { title: string; sub?: React.ReactNode; children: React.ReactNode; testId: string; className?: string }) => (
  <div className={`border border-borderSubtle rounded-md bg-panel flex flex-col ${className}`} data-earnings-box={testId}>
    <div className="px-5 pt-4 pb-3">
      <h3 className="text-[15px] font-semibold leading-tight text-textPrimary">{title}</h3>
      {sub && <p className="mt-0.5 text-[11px] text-textMuted whitespace-nowrap truncate">{sub}</p>}
    </div>
    {children}
  </div>
);

const Fact = ({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) => (
  <div>
    <dt className="text-[10px] text-textMuted whitespace-nowrap cursor-help" title={statHelp(label)}>{label}</dt>
    <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary whitespace-nowrap" data-name-fact={testId}>
      {children}
    </dd>
  </div>
);

/** A door out — small, labelled */
const Door = ({ onClick, onWarm, children }: { onClick: () => void; onWarm?: () => void; children: React.ReactNode }) => (
  <button type="button" onClick={onClick} onMouseEnter={onWarm} className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-borderSubtle bg-chip hover:border-borderMuted font-mono text-[9px] uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors">
    <ArrowUpRight className="w-3 h-3" />
    {children}
  </button>
);

/* ---- today's price, replayed ---------------------------------------------------- */
/* The question a person asks is "is ±6.3% a fair price?" — answered with money: take
   today's price for the move and replay it over the last eight real prints. One bar
   per quarter, the actual move's dollar value minus today's cost. Green above the
   line covered it; red below fell short. (Noah, 2026-08-19: "so simple yet unique") */
/** Beat · in line · miss over the EPS quarters (equal to the cent is in line, never a beat) */
const splitOf = (d: EarningsDossier) => {
  const r = d.quarters.map(q => q.epsResult ?? (q.epsBeat ? 'beat' : 'miss'));
  return { beat: r.filter(x => x === 'beat').length, inline: r.filter(x => x === 'inline').length, miss: r.filter(x => x === 'miss').length, n: r.length };
};
const splitText = (d: EarningsDossier) => {
  const s = splitOf(d);
  return s.n ? `${s.beat} beat · ${s.inline} in line · ${s.miss} missed, of ${s.n}` : '—';
};
/** The usual move with the count it is the average of */
const usualText = (e: EarningsDossier['event']) => {
  const n = e.histCount ?? e.pastMoves.length;
  if (e.history === false) return '—';
  if (!n) return 'no past move on file';
  return `±${e.histAvgMovePct.toFixed(1)}%${n < 8 ? ` · from ${n} ${n === 1 ? 'print' : 'prints'}` : ''}`;
};

const PriceReplay = ({ d }: { d: EarningsDossier }) => {
  const e = d.event;
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
  /* NOT PRICED YET (the Dossier sweep, 2026-10-22): a print months out has no straddle on the vendor's row — the page
     read "$0.00 · ±0.0% · covered 0 of 8 · 0.00× cheap". It says the print is not priced instead, and keeps the facts
     that are real. */
  if (!isPriced) {
    return (
      <div className="px-5 pb-4 flex flex-col gap-3" data-name-replay="unpriced">
        <p className="text-[12px] text-textSecondary">
          The options do not price this print yet — the vendor carries no expected move for {e.dateLabel}
          {e.confirmed ? '' : ', an estimated date'}. The replay fills in once the report is on the near calendar.
        </p>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 pt-3 border-t border-borderSubtle/60">
          <Fact label="Prints on file">{d.quarters.length}</Fact>
          <Fact label="Against the estimate">{splitText(d)}</Fact>
          <Fact label="Usual move">{usualText(e)}</Fact>
          <Fact label="Up against down">{rows.length ? `${d.probUpPct}% up · ${100 - d.probUpPct}% down` : '—'}</Fact>
        </dl>
      </div>
    );
  }
  return (
    <div className="px-5 pb-4 flex flex-col gap-3" data-name-replay>
      <div className="flex items-baseline gap-2.5 flex-wrap font-mono tnum">
        <span className="text-[10px] text-textMuted">Today's price for the move</span>
        <span className="text-[16px] font-bold text-textPrimary">${cost.toFixed(2)}</span>
        <span className="text-[11px] text-textSecondary">per share · ±{e.impliedMovePct.toFixed(1)}%</span>
      </div>
      <div className="mx-auto w-full max-w-[640px] select-none">
        <div className="relative" style={{ height: 2 * H }} onMouseLeave={() => setHover(null)}>
          <span className="absolute inset-x-0 top-1/2 h-px bg-ink/25" />
          <span className="absolute left-0 -translate-y-full top-1/2 pb-0.5 font-mono text-[9px] uppercase tracking-widest text-textMuted">covered it</span>
          <span className="absolute left-0 top-1/2 pt-0.5 font-mono text-[9px] uppercase tracking-widest text-textMuted">fell short</span>
          <div className="absolute inset-y-0 left-24 right-0 flex items-stretch gap-1.5" data-touch-skip>
            {rows.map(r => (
              <button
                key={r.label}
                type="button"
                onMouseEnter={ev => setHover({ r, x: ev.clientX, y: ev.clientY })}
                onMouseMove={ev => setHover({ r, x: ev.clientX, y: ev.clientY })}
                className="relative flex-1 min-w-0 rounded hover:bg-ink/[0.04] transition-colors cursor-default"
                aria-label={`${r.label}: moved ${r.movePct >= 0 ? '+' : r.movePct < 0 ? '−' : ''}${Math.abs(r.movePct).toFixed(1)}%, ${r.pl >= 0 ? 'covered' : 'fell short of'} today's price by $${Math.abs(r.pl).toFixed(2)} per share`}
                data-replay-bar={r.label}
              >
                <span className={`absolute left-1/2 -translate-x-1/2 w-[22px] rounded-[2px] ${r.pl >= 0 ? 'bg-bull/90' : 'bg-bear/80'}`} style={r.pl >= 0 ? { bottom: '50%', height: Math.max(3, (Math.abs(r.pl) / maxAbs) * H) } : { top: '50%', height: Math.max(3, (Math.abs(r.pl) / maxAbs) * H) }} />
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-1.5 mt-1 pl-24">
          {rows.map(r => (
            <span key={r.label} className="flex-1 min-w-0 text-center font-mono text-[8px] sm:text-[9px] text-textMuted whitespace-nowrap">
              {r.label}
            </span>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2.5 flex-wrap font-mono tnum">
        <span className="text-[13px] font-bold text-textPrimary">covered today's price {winners} of {rows.length} times</span>
        <span className={`text-[11px] font-semibold ${avg >= 0 ? 'text-bull' : 'text-bear'}`}>
          avg {avg >= 0 ? '+' : '−'}${Math.abs(avg).toFixed(2)} per share
        </span>
      </div>
      {/* THE ODDS the pricing implies, and the smaller facts */}
      <dl className="grid grid-cols-5 gap-x-6 pt-3 border-t border-borderSubtle/60">
        {rows.length > 0 ? (
          <>
            <Fact label={`Closes inside ±${e.impliedMovePct.toFixed(1)}%`}>{d.probInsidePct}%</Fact>
            <Fact label="Moves beyond it">
              <span className="text-textSecondary">{d.probBeyondPct}%</span>
            </Fact>
            <Fact label="Up against down" testId="updown">
              <span className={d.probUpPct >= 56 ? 'text-bull' : d.probUpPct <= 44 ? 'text-bear' : 'text-textPrimary'}>{d.probUpPct}% up</span> <span className="text-textMuted">· {100 - d.probUpPct}% down</span>
            </Fact>
            <Fact label={d.live ? 'EPS estimate' : 'Estimates'}>
              {d.live ? (
                e.nextEpsEst != null ? (
                  <span className="text-textPrimary" title="The street's mean EPS estimate for this report, as Unusual Whales carries it">${e.nextEpsEst.toFixed(2)}</span>
                ) : (
                  <span className="text-textMuted" title="Unusual Whales carries no street estimate on this report's row yet, and this key has no forward-estimate feed — the beat history counts past reports' own estimates">not on file</span>
                )
              ) : (
                <span className={e.revisionTrend > 0.15 ? 'text-bull' : e.revisionTrend < -0.15 ? 'text-bear' : 'text-textSecondary'}>{e.revisionTrend > 0.15 ? 'rising' : e.revisionTrend < -0.15 ? 'falling' : 'flat'}</span>
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
          <div className="font-mono text-[11px] font-bold text-textPrimary tnum">
            {hover.r.label} · moved {hover.r.movePct >= 0 ? '+' : ''}
            {hover.r.movePct.toFixed(1)}%
          </div>
          <div className="font-mono text-[10px] text-textSecondary tnum">
            that move was worth ${hover.r.moved.toFixed(2)} · today's price ${cost.toFixed(2)}
          </div>
          <div className={`font-mono text-[11px] font-bold tnum ${hover.r.pl >= 0 ? 'text-bull' : 'text-bear'}`}>
            {hover.r.pl >= 0 ? '+' : '−'}${Math.abs(hover.r.pl).toFixed(2)} per share against today's price
          </div>
        </HoverReadout>
      )}
    </div>
  );
};

/* ---- a busy contract ------------------------------------------------------------ */
/* Facts only — the contract's own arithmetic, no "why" (Noah, 2026-08-19: "we simply
   provide information like bloomberg"). The volume bar ranks it against the busiest. */
/* THE ROW IS A DOOR (Noah, 2026-09-12: "should these bring the user to another
   page?") — to the Weigher with THE CONTRACT picked (name · strike · side ·
   expiry), the house's workstation for one contract; the Weigher's own Compass
   button is the next step, so the row stays one door. Silver on hover like
   every door, the destination named at the row's end before the click. */
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
      <span className="font-mono text-[12px] font-bold text-textPrimary group-hover/door:text-silver group-focus-visible/door:text-silver transition-colors">{c.label}</span>
      <span className="ml-auto font-mono text-[12px] font-semibold text-textPrimary tnum">
        ~<AnimatedNumber value={c.mid} format={v => `$${v.toFixed(2)}`} />
      </span>
      <span className="inline-flex items-center gap-1 pl-2 font-mono text-[9px] uppercase tracking-widest text-textMuted group-hover/door:text-silver group-focus-visible/door:text-silver transition-colors" data-contract-door>
        <ArrowUpRight className="w-3 h-3" />
        Weigh it
      </span>
    </div>
    <div className="flex items-center gap-2">
      <span className="font-mono text-[9px] uppercase tracking-widest text-textMuted shrink-0">vol</span>
      <span className="relative w-24 h-[4px] rounded-full bg-ink/[0.06] shrink-0">
        <span className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out ${c.right === 'CALL' ? 'bg-bull/80' : 'bg-bear/70'}`} style={{ width: `${Math.max(6, (c.volume / maxVol) * 100)}%` }} />
      </span>
      <span className="font-mono text-[11px] font-semibold text-textPrimary tnum">
        <AnimatedNumber value={c.volume} format={v => Math.round(v).toLocaleString()} />
      </span>
      <span className="font-mono text-[10px] text-textSecondary tnum">
        open interest {c.oi.toLocaleString()} · <AnimatedNumber value={c.volOverOi} format={v => `${v.toFixed(2)}×`} /> · IV {c.ivPct}%
      </span>
    </div>
    <span className="font-mono text-[10px] text-textMuted tnum">
      {c.fromSpotPct === 0 ? 'at the money' : `${c.fromSpotPct > 0 ? '+' : c.fromSpotPct < 0 ? '−' : ''}${Math.abs(c.fromSpotPct)}% from ${c.spotWord ?? 'spot'}`} ·{' '}
      {/* already through its breakeven at today's price (the $385 put on a $373.63 TSLA) — not "breaks even −0%" */}
      {c.breakevenPct > 0 ? `breaks even ${c.right === 'CALL' ? '+' : '−'}${c.breakevenPct}% by expiry` : `past its breakeven at ${c.spotWord ?? "today's price"}`}
    </span>
  </button>
);

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
  /* A busiest row → the Weigher with THE contract picked, this page as the way back */
  const weigh = (c: ActiveContract) =>
    navigate('/weigher', { state: { weigh: { ticker: T, strike: c.strike, right: c.right === 'CALL' ? 'C' : 'P', expiry: c.expiry }, wayBack: location.pathname } });
  /* ON THE RECORD — the other two pages read for this one name */
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
      <Link to="/dossier/earnings" className="group inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors">
        <ArrowLeft className="w-3.5 h-3.5 transition-transform duration-200 ease-out group-hover:-translate-x-0.5" /> The calendar
      </Link>
      {fromDesk && (
        <Link to="/pulse" className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors">
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
          <span className="font-mono text-[13px] font-bold text-textPrimary">{T}</span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-textMuted">Reading the prints</span>
        </div>
      </>
    );
  }

  if (!dossier) {
    return (
      <>
        {back}
        <div className="border border-borderSubtle rounded-md bg-panel h-40 flex flex-col items-center justify-center gap-2" data-name-missing>
          <span className="font-mono text-[13px] font-bold text-textPrimary">{T}</span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-textMuted">{isFund ? 'a fund — funds do not report earnings' : 'no report on file for this name'}</span>
        </div>
      </>
    );
  }

  const { event: e, quarters } = dossier;
  const priced = stateOf(e);
  /* no expected move on the row (a print months out) — every straddle figure says so instead of $0.00 */
  const isPriced = e.impliedMovePct > 0 && e.price > 0;
  /* THE PRINT IS OUT once its date has passed, or today once its slot has (the ship pass, 2026-10-22: TSLA still read
     "Reports Wed 10/21" at 00:40 on the 22nd, its options price quoted as if the move were still to come) */
  /* the stock NOW — the calendar row's price is the one the options were priced against, stale once the print is out
     (TSLA read $386.55 after closing the night at $373.63) */
  /* THE REGULAR PRICE (audit round 6: NVDA read $214.81 here at 04:30, the pre-market print, unlabelled, against a
     212.21 close) — the quote's regularPrice, the one every page leads with; the extended print beside it, named */
  const spotNow = quote?.regularPrice && quote.regularPrice > 0 ? quote.regularPrice : e.price;
  const extNow = quote?.extPrice != null && quote.extPrice > 0 ? { px: quote.extPrice, word: quote.phase === 'pre' ? 'pre-market' : 'after hours' } : null;
  /* the board's own rule (earningsFeed.reportedNow), so the two never disagree on whether a print is out */
  const reported = reportedNow(e);
  const nQ = quarters.length || 0;
  const hasRev = quarters.some(q => q.revEstB > 0);
  const split = splitOf(dossier);
  const epsBeats = split.beat;
  const pricedOk = !reported && (e.histCount ?? e.pastMoves.length) >= MIN_PRICED_PRINTS && e.richness > 0;
  const revBeats = quarters.filter(q => q.revBeat).length;
  const moveData = e.pastMoves.map(q => ({ label: q.label, move: q.movePct }));
  const nMoves = moveData.length;
  const epsData = quarters.map(q => ({ label: q.label, est: q.epsEst, actual: q.epsActual, beat: q.epsBeat, inline: q.epsResult === 'inline' }));
  const maxActiveVol = Math.max(...dossier.activeCalls.map(c => c.volume), ...dossier.activePuts.map(c => c.volume), 1);
  const openOnMap = () => {
    changeTicker(e.ticker);
    navigate('/pinpoint/map');
  };
  /* the session the chain's volume is from, by its date — overnight "today" was the session before (audit round 5) */
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

  /* newest trade first (the third audit, 2026-10-23: PG read 10/05, 08/20, 08/24, 08/21 — filing order) */
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
                <h3 className="min-w-0 truncate text-[15px] font-semibold leading-tight text-textPrimary">{e.name}</h3>
                <span className="font-mono text-[11px] font-bold text-textSecondary">{e.ticker}</span>
              </div>
              {/* max-xl:flex-wrap — an inline-flex line does not truncate, it spills; on a phone it folds instead (the phone pass, 2026-09-13) */}
              <p className="mt-0.5 text-[11px] text-textMuted whitespace-nowrap truncate inline-flex items-center gap-1.5 max-xl:flex-wrap">
                {reported ? 'Reported' : 'Reports'} {e.dateLabel} <SlotMark slot={e.slot} timeKnown={e.timeKnown} className="w-3 h-3" /> {slotWord(e)}
                <span className="text-textMuted">·</span>
                {reported ? (
                  e.actualMovePct != null ? (
                    <span className="text-textMuted" data-earnings-moved>
                      the stock moved <span className={e.actualMovePct >= 0 ? 'text-bull' : 'text-bear'}>{e.actualMovePct >= 0 ? '+' : '−'}{Math.abs(e.actualMovePct).toFixed(2)}%</span> {e.slot === 'BMO' ? 'on the report day' : 'the session after'}
                    </span>
                  ) : (
                    <span className="text-textMuted">{e.slot === 'BMO' ? "the move is the report day's session — the vendor has not posted it yet" : "the move is the next session's — it is not made yet"}</span>
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
              {!pricedOk || !isPriced ? <span className="text-textMuted" title={reported ? 'Reported — the move is in' : `Rich or cheap needs ${MIN_PRICED_PRINTS} past moves on file`}>—</span> : (
              <span className={PRICED_INK[priced]} title={`The options' ±${e.impliedMovePct.toFixed(1)}% over the usual ±${e.histAvgMovePct.toFixed(1)}% — rich above 1.3×, cheap below 0.85×`}>
                {richText(e.richness)}× {PRICED_WORD[priced]} <span className="text-textMuted text-[10px]">(±{e.impliedMovePct.toFixed(1)} ÷ ±{e.histAvgMovePct.toFixed(1)})</span>
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

      {/* TODAY'S PRICE, REPLAYED */}
      <Box title="Today's price, replayed" sub={`What the options charge now, tested against the last ${nMoves || 'few'} real ${nMoves === 1 ? 'print' : 'prints'} with a move — hover a bar`} testId="replay">
        <PriceReplay d={dossier} />
      </Box>

      {/* THE RECEIPTS */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-stretch">
        <Box title="Beats and misses" sub={`Earnings per share, the estimate against the actual · ${split.beat} beat, ${split.inline} in line, ${split.miss} missed of ${nQ}${hasRev ? ` · revenue ${revBeats} of ${nQ}` : ''}`} testId="beats">
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
            <p className="mt-2 font-mono text-[9px] uppercase tracking-widest text-textMuted">
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
            <p className="mt-2 font-mono text-[9px] uppercase tracking-widest text-textMuted">
              {isPriced ? `the dashed lines are the ±${e.impliedMovePct.toFixed(1)}% priced for this print` : 'the options do not price this print yet'}
            </p>
          </div>
        </Box>
      </div>

      {/* AFTER THE PRINT */}
      <Box title="After the print" sub="What the options lose overnight once the number is out — a long option has to beat the move and this" testId="after">
        <dl className="px-5 pb-4 grid grid-cols-4 gap-x-6">
          {/* the figure is the median premium a long straddle gave back by the next open on the quiet prints (earningsFeed
              crushOf) — the option's loss, not the implied vol's; it was labelled as an IV drop (the Dossier sweep, 2026-10-22) */}
          <Fact label="A quiet print takes" testId="crush">
            {!dossier.live || dossier.crushKnown ? <span className="text-warn">−{dossier.ivCrushPct}%</span> : <span className="text-textMuted">—</span>}
          </Fact>
          <Fact label="Straddle kept by next open">{!dossier.live || dossier.crushKnown ? `~${Math.max(0, 100 - dossier.premiumLostPct)}%` : '—'}</Fact>
          <Fact label={reported ? 'Straddle priced' : 'Straddle today'}>{isPriced ? `$${((e.price * e.impliedMovePct) / 100).toFixed(2)}` : <span className="text-textMuted">—</span>}</Fact>
          <Fact label={quote && quote.phase !== 'regular' ? 'The stock · close' : 'The stock'}>
            {spotNow > 0 ? (
              <>
                ${spotNow.toFixed(2)}
                {extNow ? <span className="block text-[10px] text-textMuted" data-name-fact="ext">{extNow.word} ${extNow.px.toFixed(2)}</span> : null}
              </>
            ) : (
              <span className="text-textMuted">—</span>
            )}
          </Fact>
        </dl>
      </Box>

      <EarningsVol ticker={T} />

      {/* THE BUSIEST CONTRACTS — a pair shares one bottom edge (Noah, 2026-09-09);
          every row a door to the Weigher with the contract picked, and the way
          back to this page on the shell's pill (2026-09-12) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-stretch">
        <Box title="Busiest calls" sub={callSub} testId="calls">
          <div className="pb-2">
            {dossier.activeCalls.length === 0 ? <p className="px-5 py-3 font-mono text-[10px] uppercase tracking-widest text-textMuted">{dossier.live ? (dossier.contractsReady ? `No volume on the chain on ${chainDay}` : 'Reading the chain') : 'Nothing trading'}</p> : null}
            {dossier.activeCalls.map(c => (
              <ActiveRow key={c.id} c={c} maxVol={maxActiveVol} onOpen={() => weigh(c)} />
            ))}
          </div>
        </Box>
        <Box title="Busiest puts" sub={putSub} testId="puts">
          <div className="pb-2">
            {dossier.activePuts.length === 0 ? <p className="px-5 py-3 font-mono text-[10px] uppercase tracking-widest text-textMuted">{dossier.live ? (dossier.contractsReady ? `No volume on the chain on ${chainDay}` : 'Reading the chain') : 'Nothing trading'}</p> : null}
            {dossier.activePuts.map(c => (
              <ActiveRow key={c.id} c={c} maxVol={maxActiveVol} onOpen={() => weigh(c)} />
            ))}
          </div>
        </Box>
      </div>

      <CompanyFile ticker={T} />

      {/* ON THE RECORD — the other two pages, read for this name. The pair shares
          one bottom edge: a name with two insider rows beside one Congress row
          used to leave the boxes different lengths (Noah, 2026-09-09: "do you
          think thats a design flaw to push publicly?" — it was). The rows sit at
          the top, the door at the foot, the room between reads as room. */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-stretch" data-name-record>
        <Box title="What its insiders did" sub={`Open-market trades in the last 90 days · ${insiders.status === 'loading' ? 'reading…' : insiders.status === 'sim' ? 'the read did not land' : insiders.trades.length ? insiders.signal : 'nothing filed'}`} testId="insiders">
          {marketInsiders.length === 0 ? (
            <div className="px-5 pb-5 pt-1 font-mono text-[10px] uppercase tracking-widest text-textMuted">{insiders.status === 'loading' ? 'Reading the filings…' : insiders.status === 'sim' ? 'This read did not land' : 'Nothing on the record in 90 days'}</div>
          ) : (
            <>
              {/* Below lg: when, who, the trade and its value — the shares and the plan go (the phone pass, 2026-09-13) */}
              <div className="px-5 h-[22px] grid items-center gap-x-3 text-[9px] uppercase tracking-widest text-textMuted grid-cols-[96px_minmax(0,1fr)_44px_60px_60px_64px] max-xl:grid-cols-[96px_minmax(0,1fr)_44px_64px]">
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
                    <span className="text-[11px] font-semibold text-textPrimary truncate">{t.person}</span>
                    <span className="text-[9px] text-textMuted truncate">{t.role}</span>
                  </span>
                  <span className={`font-mono text-[10px] ${t.kind === 'BUY' ? 'text-bull' : 'text-bear'}`}>{t.kind === 'BUY' ? 'Bought' : 'Sold'}</span>
                  <span className="text-right font-mono text-[10px] tnum text-textPrimary max-xl:hidden">{Math.round(t.shares).toLocaleString('en-US')}</span>
                  <span className="text-right font-mono text-[10px] tnum font-semibold text-textPrimary">{fmtDollars(t.value)}</span>
                  <span className={`text-right font-mono text-[8px] uppercase tracking-widest max-xl:hidden ${t.plan === 'discretionary' ? (isChosenBuy(t) ? 'text-textPrimary font-bold' : 'text-textSecondary') : 'text-textMuted'}`}>
                    {t.plan === 'discretionary' ? 'chosen' : t.plan === 'plan' ? 'planned' : 'unstated'}
                  </span>
                </div>
              ))}
              <div className="mt-auto px-5 py-2.5 border-t border-borderSubtle/40 flex items-center gap-4 font-mono text-[10px] tnum" data-name-foot="insiders">
                <span className="text-textSecondary">
                  bought <span className={insiders.bought > 0 ? 'text-bull' : 'text-textMuted'}>{insiders.bought > 0 ? fmtDollars(insiders.bought) : 'nothing'}</span> · sold{' '}
                  <span className={insiders.sold > 0 ? 'text-bear' : 'text-textMuted'}>{insiders.sold > 0 ? fmtDollars(insiders.sold) : 'nothing'}</span>
                </span>
                <Link to="/dossier/insiders" className="ml-auto inline-flex items-center gap-1 text-[9px] uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors">
                  <ArrowUpRight className="w-3 h-3" /> every insider
                </Link>
              </div>
            </>
          )}
        </Box>
        <Box title="What Congress reported" sub={`STOCK Act reports of trades in this stock made in the last 180 days${congressBook.complete ? '' : ' — the latest 200 reports only'}`} testId="congress">
          {congress.length === 0 ? (
            <div className="px-5 pb-5 pt-1 font-mono text-[10px] uppercase tracking-widest text-textMuted">{congressBook.status === 'loading' ? 'Reading the reports' : congressBook.status === 'sim' ? 'This read did not land' : 'No trade in this stock reported in 180 days'}</div>
          ) : (
            <>
              {/* On a phone: filed, member, type — the amount and the lag go (the phone pass, 2026-09-13) */}
              <div className="px-5 h-[22px] grid items-center gap-x-3 text-[9px] uppercase tracking-widest text-textMuted grid-cols-[96px_minmax(0,1fr)_76px_132px_56px] max-xl:grid-cols-[96px_minmax(0,1fr)_76px]">
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
                    <span className="text-[11px] font-semibold text-textPrimary truncate">{t.member.name}</span>
                    <span className="text-[9px] text-textMuted truncate">
                      {seatLabel(t.member)} · {t.member.chamber}
                    </span>
                  </span>
                  <span className={`font-mono text-[10px] ${t.type === 'Purchase' ? 'text-bull' : t.type === 'Exchange' ? 'text-textMuted' : 'text-bear'}`}>{t.type === 'Purchase' ? 'Purchase' : t.type === 'Exchange' ? 'Exchange' : t.type === 'Sale (Partial)' ? 'Sale · partial' : 'Sale'}</span>
                  <span className="font-mono text-[10px] tnum text-textPrimary truncate max-xl:hidden">{bracketLabel(t.bracket)}</span>
                  <span className={`text-right font-mono text-[10px] tnum max-xl:hidden ${t.late ? 'text-bear' : 'text-textSecondary'}`}>
                    {t.lagDays}d{t.late ? ' late' : ''}
                  </span>
                </div>
              ))}
              <div className="mt-auto px-5 py-2.5 border-t border-borderSubtle/40 flex items-center font-mono text-[10px]" data-name-foot="congress">
                <Link to="/dossier/congress" className="ml-auto inline-flex items-center gap-1 text-[9px] uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors">
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
