/* A Compass contract's own page: the live chart with the entry, the stop and the exits on it, the quote and its
   greeks, and the call's state as Compass reads it. States, never orders. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Bookmark, ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { type Timeframe } from '../../data/timeframe';
import SignalBadge from '../ui/SignalBadge';
import ContractLabel from '../ui/ContractLabel';
import RichRead from '../ui/RichRead';
import CompanyLogo from '../ui/CompanyLogo';
import GuideFocus, { GuideDoor } from '../ui/GuideFocus';
import { Fact } from '../trace/TraceBox';
import { SetupGuide } from './SetupGuide';
import ContractTrack from './ContractTrack';
import ContractFlow from './ContractFlow';
import { choiceRight } from '../../data/compass';
import { activeStop, signalOf, useSignals } from '../../data/compassLedger';
import { liveSetups, liveSpark, useContractBars, useContractLive, useSecondGreek } from '../../data/thetaBook';
import { leftOf, passedOver } from '../../data/compassModel';
import { entryGate, quoteContract, quoteMissing, quoteStale } from '../../data/contractQuote';
import { BOOK_NAME, MODELS_VALIDATED, OUTSIDE_TRAINED_WORD, SPREAD_MAX, STOP_KEEP, UNVALIDATED_WORD, spreadPass, weekdayDte } from '../../data/compassParams';
import { BLOCK_MIN_PREMIUM, BLOCK_MIN_SIZE } from '../../data/tape';
import { useShelfPrints } from '../../data/traceLive';
import type { FlowPrint } from '../../types/trace';
import { nameTape, optionScanOpen, printInSession, sessionYmd } from '../../data/compassSession';
import { useDeskSession } from '../../data/deskSession';
import { nyClock } from '../../core/nyTime';
import { type ConPickRow } from './ContractPick';
import { Tip } from '../ui/Tooltip';
import { useTracker } from '../../context/TrackerContext';
import { useThetaStatus } from '../../data/thetaQuote';
import {
  type OptionRight,
  type ScannerKey,
  type Setup,
  type SleeveKey,
} from '../../types/compass';
import { MONTHS as MONTH_SHORT } from '../../core/calendar';

/** Dollars with a thousands separator. $5651.67 is not a price anyone can read. */
const money = (n: number, digits = 2) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

const SPOT_NAME: Record<string, string> = { SPX: 'SPX', SPXW: 'SPX', XSP: 'SPX', RUT: 'RUT', RUTW: 'RUT', VIX: 'VIX' };

/** Theta is per share. One contract is a hundred shares. */
const dayDollars = (perShare: number) => {
  const n = Math.round(Math.abs(perShare) * 100);
  return `${perShare < 0 ? '−' : ''}$${n.toLocaleString('en-US')}`;
};

/** A change on this contract's own prints. Ten minutes by the print's clock, not from 09:30. */
function tapeChange(prints: FlowPrint[]): { word: string; why: string } | null {
  if (!prints.length) return null;
  let all = 0;
  let recentAsk = 0;
  let newest = 0;
  for (const p of prints) if ((p.epochMs ?? 0) > newest) newest = p.epochMs ?? 0;
  const windowMs = 10 * 60 * 1000;
  const sweeps: FlowPrint[] = [];
  let block: FlowPrint | null = null;
  for (const p of prints) {
    all += p.size;
    const recent = newest > 0 && (p.epochMs ?? 0) >= newest - windowMs;
    if (p.side === 'ASK' && recent) recentAsk += p.size;
    if (p.sweep && p.side === 'ASK' && p.legs <= 1) sweeps.push(p);
    if (p.legs <= 1 && !p.compression && !block && (p.size >= BLOCK_MIN_SIZE || p.premium >= BLOCK_MIN_PREMIUM)) block = p;
  }
  if (all >= BLOCK_MIN_SIZE && recentAsk >= all * 0.5 && recentAsk >= BLOCK_MIN_SIZE) {
    return {
      word: 'Burst buying',
      why: `${Math.round(recentAsk).toLocaleString('en-US')} bought the ask in 10 minutes, ${Math.round((recentAsk / all) * 100)}% of the session.`,
    };
  }
  if (sweeps.length >= 2) {
    const n = sweeps.reduce((s, p) => s + p.size, 0);
    return { word: 'Sweep buying', why: `${sweeps.length} ask sweeps, ${Math.round(n).toLocaleString('en-US')} contracts.` };
  }
  if (block) return { word: 'Size hit', why: `${Math.round(block.size).toLocaleString('en-US')} at $${block.fill.toFixed(2)}. One print cleared the block line.` };
  return null;
}

function isoOf(label: string): string {
  const m = label.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : label.slice(0, 10);
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Mon Oct 26" from the contract's real expiry session. */
function dayStamp(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  return `${DAY_SHORT[dt.getDay()]} ${MONTH_SHORT[m - 1]} ${d}`;
}

interface CampaignAnalysisProps {
  setup: Setup;
  /** Bumps every simulator tick — drives incremental candle updates */
  revision: number;
  /** The underlying, live — the facts strip and ladder inversions speak in it */
  spot: number;
  /** The lens that graded this setup — tracking files under it */
  scanner: ScannerKey;
  /** The tenor — it decides which exit-clock copy the floor panel speaks */
  sleeve: SleeveKey;
  /** Provenance: when this page opened — the numbers that earned the click are frozen from then */
  gradedAt?: string;
  /** Open another contract on the same name — a driver row, or the capsule's pick (which may carry a different
      tenor). The page's route does the rest; the way back lives there too. */
  onOpenContract?: (strike: number, right: OptionRight, sleeve?: SleeveKey) => void;
}

/** The campaign's story, stamped ON the tape: the entry premium on the bar it was graded, and each banked TP on the
    candle that actually crossed it. */
interface CampaignEntry {
  /** Bar time (UTC seconds) of the sweep that opened this review */
  time: number;
  /** The graded mid — frozen at open, like the provenance line */
  mid: number;
}
interface CampaignHit {
  /** TP rung, 1-based */
  level: number;
  /** Bar time (UTC seconds) of the candle that crossed the target */
  time: number;
}
interface CampaignBreak {
  /** Bar time (UTC seconds) of the candle that CLOSED through the floor */
  time: number;
  /** That bar's close */
  price: number;
  /** The floor as it stood when it broke — frozen for the post-mortem */
  floor: number;
}

/** The board card's stat — 13px figure, a whispered label. Not the Weigher's cell. */
const RailStat = ({ label, value, ink = 'text-textPrimary' }: { label: string; value: string; ink?: string }) => (
  <span className="flex flex-col gap-0.5 min-w-0">
    <span className="font-mono text-t9 uppercase tracking-wider text-textMuted">{label}</span>
    <Tip label={value}>
      <span className={`font-mono text-t13 font-semibold tnum truncate ${ink}`}>{value}</span>
    </Tip>
  </span>
);

const CampaignAnalysis = ({
  setup,
  revision,
  spot,
  scanner,
  sleeve,
  gradedAt,
  onOpenContract,
}: CampaignAnalysisProps) => {
  const { trackSetup, untrackSetup, isTracked } = useTracker();
  const record = useSignals();
  const thetaDown = useThetaStatus() === 'down';
  const signal = useMemo(() => signalOf(setup.id), [record, setup.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const outcome = signal?.outcome ?? null;
  const navigate = useNavigate();
  const tracked = isTracked(setup.id);
  const [trackNo, setTrackNo] = useState<string | null>(null);
  useEffect(() => {
    setTrackNo(null);
  }, [setup.id]);
  const desk = useDeskSession();
  const quoteSig = `${setup.id}|${spot}|${setup.bid}|${setup.ask}`;
  const stampRef = useRef({ sig: '', at: 0 });
  if (stampRef.current.sig !== quoteSig) stampRef.current = { sig: quoteSig, at: Date.now() };
  const quotedAt = stampRef.current.at;

  /* ENTRY = the bar on the tape when this review opened — and with it, THE whole campaign frozen: entry premium,
     price targets, premium ladder, floor. The engine derives targets as a percentage OF SPOT and this page
     regrades every tick, so live targets recede exactly as fast as price approaches them. */
  const entryRef = useRef<
    | (CampaignEntry & {
        id: string;
        priceTargets: number[];
        invalidationPrice: number;
        takeProfits: Setup['takeProfits'];
      })
    | null
  >(null);
  {
    if (entryRef.current?.id !== setup.id && setup.mid > 0) {
      entryRef.current = {
        id: setup.id,
        time: Math.floor(Date.now() / 1000),
        mid: setup.mid,
        priceTargets: setup.priceTargets,
        invalidationPrice: setup.invalidationPrice,
        takeProfits: setup.takeProfits,
      };
    }
  }
  const entry = entryRef.current && entryRef.current.id === setup.id ? entryRef.current : null;

  /* The campaign view of the setup: defining fields frozen at open, market reads (liveMid, score, greeks, spread)
     live. Every campaign surface on this page — chart lines, ladder, floor panel, facts, track — speaks c, never
     the regrading setup. */
  const c = useMemo<Setup>(
    () =>
      entry
        ? {
            ...setup,
            mid: entry.mid,
            priceTargets: entry.priceTargets,
            invalidationPrice: entry.invalidationPrice,
            takeProfits: entry.takeProfits,
          }
        : setup,
    [setup, entry]
  );

  /* TP hits AND the floor break are read off the TAPE, not the simulator's rolled status flags — every event must
     have a candle to point at, and the chart, the ladder and the count must all tell one story. */
  const tapeRef = useRef<{ id: string; scanned: number; hits: Map<number, number>; brk: CampaignBreak | null }>({
    id: '',
    scanned: 0,
    hits: new Map(),
    brk: null,
  });
  const { tpHits, floorBreak } = useMemo(() => {
    if (!entry) return { tpHits: [] as CampaignHit[], floorBreak: null as CampaignBreak | null };
    if (tapeRef.current.id !== setup.id) {
      tapeRef.current = { id: setup.id, scanned: entry.time, hits: new Map(), brk: null };
    }
    const st = tapeRef.current;
    return {
      tpHits: [...st.hits.entries()].map(([level, time]) => ({ level, time })).sort((a, b) => a.level - b.level),
      floorBreak: st.brk,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, c, setup.id, setup.right, setup.ticker, revision, spot]);
  const retired = floorBreak != null;

  const loadTickerCons = useCallback((): ConPickRow[] => {
    return liveSetups()
      .filter(s => s.ticker === setup.ticker && s.bid > 0 && s.ask >= s.bid)
      .map(s => ({
        key: s.id,
        strike: s.strike,
        right: s.right,
        sleeve: s.sleeve,
        title: s.contract,
        tag: s.expiry,
        sub: s.ask > 0 ? `$${s.ask.toFixed(2)}` : '—',
      }));
  }, [setup.ticker]);

  const breakTimeLabel = floorBreak
    ? new Date(floorBreak.time * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : '';

  const bankedLevels = useMemo(() => new Set(tpHits.map(h => h.level)), [tpHits]);
  const hitCount = bankedLevels.size;

  const [chartTf, setChartTf] = useState<Timeframe>('1m');

  /* Ladder inversions: each premium rung, restated as the underlying level
     that pays it — priced by THE model that minted the mid (one-pricer rule). */
  const shelf = useShelfPrints(setup.ticker);
  const mine = useMemo(
    () => shelf.filter(p => p.right === setup.right && Math.abs(p.strike - setup.strike) < 0.001 && isoOf(p.expiry) === setup.expiryDate.slice(0, 10)),
    [shelf, setup.right, setup.strike, setup.expiryDate],
  );
  const sessionPrints = useMemo(
    () => (setup.expiry === '0DTE' ? mine : mine.filter(p => printInSession(p, setup.ticker, desk))),
    [mine, setup.ticker, setup.expiry, desk],
  );
  const live = useContractLive(setup.ticker, setup.expiryDate, setup.strike, setup.right, true);
  const second = useSecondGreek(setup.ticker, setup.expiryDate, setup.strike, setup.right, true);
  const quoteAt = live?.at || setup.quotedAt || quotedAt;
  const spotPx = live && live.under > 0 ? live.under : spot;
  const ivPct = live && Number.isFinite(live.iv) ? live.iv : !live && Number.isFinite(setup.greeks.iv) ? setup.greeks.iv : NaN;
  const q = quoteContract({
    ticker: setup.ticker,
    contract: setup.contract,
    strike: setup.strike,
    right: setup.right,
    spot: spotPx,
    bid: live && live.ask >= live.bid ? live.bid : !live && setup.bid > 0 ? setup.bid : 0,
    ask: live && live.ask > 0 ? live.ask : !live && setup.ask > 0 ? setup.ask : 0,
    ivPct: Number.isFinite(ivPct) ? ivPct : 0,
    quotedAt: quoteAt,
    source: 'theta',
  });
  const gDelta = live && Number.isFinite(live.delta) ? live.delta : !live ? setup.greeks.delta : NaN;
  const gTheta = live && Number.isFinite(live.theta) ? live.theta : !live ? setup.greeks.theta : NaN;
  const gVega = live && Number.isFinite(live.vega) ? live.vega : !live ? setup.greeks.vega : NaN;
  const gRho = live && Number.isFinite(live.rho) ? live.rho : !live && Number.isFinite(setup.greeks.rho ?? NaN) ? (setup.greeks.rho as number) : NaN;
  const liveBars = useContractBars(setup.ticker, setup.expiryDate, setup.strike, setup.right, true, chartTf);
  const traded = liveBars;
  const bidPx = q.bid;
  const midPx = q.mark;
  const spreadFrac = midPx > 0 ? (q.ask - q.bid) / midPx : 1;
  const ticket = setup.band === 'top' || setup.band === 'wing' || setup.band === 'lottery';
  const paidAsk = outcome?.fill?.ask ?? 0;
  const basis = paidAsk > 0 ? paidAsk : 0;
  const tpRows = [
    { level: 1, gain: 50, price: Number((basis * 1.5).toFixed(2)) },
    { level: 2, gain: 100, price: Number((basis * 2).toFixed(2)) },
    { level: 3, gain: 200, price: Number((basis * 3).toFixed(2)) },
    { level: 4, gain: 300, price: Number((basis * 4).toFixed(2)) },
  ];
  const shownStop = ticket && setup.band !== 'lottery' && basis > 0 ? Number((basis * STOP_KEEP).toFixed(2)) : 0;
  const indexRoot = setup.ticker === 'SPXW' || setup.ticker === 'SPX' || setup.ticker === 'XSP' || setup.ticker === 'RUT' || setup.ticker === 'RUTW';
  const atmStep = setup.ticker === 'VIX' ? 0.5 : indexRoot ? 5 : setup.strike >= 200 ? 1 : 0.5;
  const higher = { vanna: second?.vanna ?? NaN, charm: second?.charm ?? NaN };
  const tape = nameTape(setup.ticker, setup.expiry === '0DTE');
  const expired = setup.expiry === '0DTE' ? tape.done : setup.sessionsLeft <= 0;
  const dayOver = tape.done;
  const missing = quoteMissing(q);
  const quoting = tape.option === 'open' || tape.option === 'overnight' || tape.option === 'pre' || tape.option === 'curb';
  const stale = quoting && quoteStale(quoteAt, Date.now(), missing);
  const spreadCap = SPREAD_MAX;
  const quoteOk = !missing && !stale && spreadPass(bidPx, q.ask);
  const tapeOpen = optionScanOpen(setup.ticker, setup.expiry === '0DTE' ? 0 : 1) || (ticket && tape.option !== 'closed');
  const gate = entryGate({ sessionOpen: tapeOpen, expired, quoteOk, executionQuote: false });
  const line = basis > 0 ? basis : setup.ask > 0 ? setup.ask : 0;
  const captured = line > 0 && q.bid > 0 ? ((q.bid - line) / line) * 100 : NaN;
  const capWord = Number.isFinite(captured) ? `${captured >= 0 ? '+' : '−'}${Math.abs(captured).toFixed(1)}%` : '—';
  const chartQuote = line > 0 ? { ...q, entryPremium: line, stopPremium: Number((line * STOP_KEEP).toFixed(2)) } : q;
  const checkFail = ticket
    ? null
    : setup.band === 'closest'
      ? (setup.whyText || 'Not a ticket.')
      : !(bidPx > 0.15) ? 'Bid is at or under 0.15' : spreadFrac > spreadCap + 1e-9 ? 'Spread is over 8%' : missing ? 'Quote missing' : stale ? 'Quote stale' : null;
  const runner = setup.band === 'wing' || setup.runner === true;
  const liveStop = basis > 0 && setup.band !== 'lottery' && setup.band !== 'closest' ? activeStop(basis, outcome?.peak ?? 0, runner) : null;
  const stopHit = !missing && liveStop != null && q.bid >= 0 && q.bid <= liveStop.stop;
  const tp1Mult = 1.5;
  const tp1Hit = ticket && !runner && setup.band !== 'lottery' && basis > 0 && q.bid >= basis * tp1Mult;
  const changed = !stopHit && !retired && !tp1Hit ? tapeChange(sessionPrints) : null;
  const sessionOpenPx = liveSpark(setup.ticker)[0] ?? 0;
  const choice = choiceRight(setup.right === 'C', tape.option === 'open' ? spotPx : 0, tape.option === 'open' ? sessionOpenPx : 0);
  const flipped = tracked && choice !== setup.right;
  const killed = stopHit || retired || tp1Hit || dayOver || flipped;
  const liveVerdict = stopHit
    ? { word: 'Stop hit', why: `Bid ${money(q.bid)} is through the ${liveStop?.name.toLowerCase() ?? 'stop'} at ${money(liveStop?.stop ?? shownStop)}. The trade is done.`, ink: 'text-bear' }
    : retired && floorBreak
      ? { word: 'Level broke', why: `${SPOT_NAME[setup.ticker] ?? setup.ticker} went through ${money(floorBreak.floor)}. The level is gone.`, ink: 'text-bear' }
      : tp1Hit
        ? { word: 'TP1', why: `Bid ${money(q.bid)} is through ${money(basis * tp1Mult)}. A non-runner sells there.`, ink: 'text-bull' }
        : changed
            ? { word: changed.word, why: changed.why, ink: 'text-textPrimary' }
            : dayOver
              ? { word: "Day's over", why: tape.doneWhy, ink: 'text-bear' }
              : flipped
                ? { word: 'Take caution', why: `The book would take the ${choice === 'P' ? 'puts' : 'calls'}. Exit here, even under +25%. This is the choice, not an order. It is not a loss.`, ink: 'text-warn' }
                : ticket && line > 0 && q.bid > 0
                  ? { word: 'Called', why: `In at ${money(line)}. Bid ${money(q.bid)}. ${capWord}. The line holds.`, ink: q.bid >= line ? 'text-bull' : 'text-textPrimary' }
                  : checkFail
                    ? { word: 'Rejected', why: checkFail, ink: 'text-bear' }
                  : tape.option !== 'closed' && tape.option !== 'open'
                    ? { word: tape.word, why: tape.liveWhy, ink: 'text-textPrimary' }
                    : !tape.option || tape.option === 'closed'
                      ? { word: tracked ? 'Open paper' : 'Still on', why: tape.quietWhy, ink: 'text-textPrimary' }
                      : tracked
                        ? { word: 'Open paper', why: 'On the book. Paper only. Nothing is sent.', ink: 'text-textPrimary' }
                        : { word: 'Candidate', why: 'Paper only. Track it to watch it. Nothing is sent.', ink: 'text-textPrimary' };
  const closed = outcome && outcome.status === 'closed' && outcome.exit && outcome.fill
    ? { result: (outcome.pnl ?? (outcome.exit.px - outcome.fill.ask)) > 0 ? 'win' as const : 'loss' as const, why: outcome.exit.why, exitPx: outcome.exit.px }
    : outcome && outcome.status === 'unavailable'
      ? { result: 'unavailable' as const, why: 'Unavailable', exitPx: 0 }
      : null;
  const verdict = setup.band === 'closest'
    ? { word: 'Closest', why: setup.whyText || 'It did not clear a book.', ink: 'text-textSecondary' }
    : closed
    ? closed.result === 'unavailable'
        ? { word: 'Unavailable', why: 'No valid quote stood a minute after the call. No price was substituted.', ink: 'text-textSecondary' }
        : closed.result === 'win'
        ? { word: 'Win', why: `${closed.why}. Left at ${money(closed.exitPx)}. On the blotter. Paper only.`, ink: 'text-bull' }
        : { word: 'Loss', why: `${closed.why}. Left at ${money(closed.exitPx)}. On the blotter. Paper only.`, ink: 'text-bear' }
    : liveVerdict;
  const badgeTone = killed || verdict.word === 'Rejected' || verdict.word === 'Loss' ? 'bear' : verdict.word === 'Win' || (verdict.word === 'Called' && q.bid >= line) ? 'bull' : 'white';

  const sessionsLeft = weekdayDte(sessionYmd(), setup.expiryDate);
  const tenorWord =
    setup.expiry === '0DTE'
      ? tape.done
        ? `${dayStamp(setup.expiryDate)} · done`
        : `${dayStamp(setup.expiryDate)} · ${tape.word}`
      : `${dayStamp(setup.expiryDate)}${Number.isFinite(sessionsLeft) ? ` · ${sessionsLeft} ${sessionsLeft === 1 ? 'session' : 'sessions'} left` : ''}`;
  const cashName = setup.ticker === 'SPXW' || setup.ticker === 'XSP' ? 'SPX' : setup.ticker === 'NDXP' ? 'NDX' : setup.ticker === 'RUTW' ? 'RUT' : setup.ticker;
  const greekOk = Number.isFinite(ivPct) && ivPct > 0;
  const pts = spotPx > 0 ? (setup.right === 'C' ? spotPx - setup.strike : setup.strike - spotPx) : NaN;
  const place = !Number.isFinite(pts) ? '' : Math.abs(pts) / spotPx < 0.0015 ? 'ATM' : `${Math.abs(pts).toFixed(0)} pts ${pts > 0 ? 'ITM' : 'OTM'}`;
  const unchecked = `${MODELS_VALIDATED ? '' : ` · ${UNVALIDATED_WORD}`}${setup.outsideTrained ? ` · ${OUTSIDE_TRAINED_WORD}` : ''}`;
  const kindLabel = setup.band === 'closest' ? 'Closest' : setup.band === 'lottery' ? BOOK_NAME.C : setup.band === 'wing' ? `${BOOK_NAME.B}${unchecked}` : setup.band === 'top' ? `${BOOK_NAME.A}${unchecked}` : '';
  const [guideOpen, setGuideOpen] = useState(false);

  const left = leftOf(setup.id);
  return (
    <div className="flex flex-col gap-4">
      {left && (
        <div className="border border-bear/30 bg-bear/[0.04] rounded-md px-4 py-3" data-setup-left={left.why}>
          <span className="block font-mono text-t12 font-bold uppercase tracking-wider text-bear">{left.why}</span>
          <p className="mt-1 text-t12 text-textPrimary">This contract left the board at {nyClock(signal?.outcome?.exit?.at ?? left.at, { zone: true })}{signal?.outcome?.exit ? `, at ${money(signal.outcome.exit.px)}` : ''}. It is off the list.</p>
        </div>
      )}
      {/* The setup's head — the name's page grammar (EarningsName): the logo, the contract in its side's ink, its
          state, the tenor and the kind, one line; the facts at the right. */}
      <div
        className="relative border border-borderSubtle rounded-md bg-panel"
        data-setup-head={setup.id}
        data-setup-state={verdict.word}
        data-graded-at={gradedAt ?? ''}
        data-quote-bid={q.bid}
        data-quote-ask={q.ask}
        data-quote-mid={q.mid}
        data-quote-mark={q.mark}
        data-quote-intrinsic={q.intrinsic}
        data-quote-extrinsic={q.extrinsic}
        data-quote-breakeven={q.breakeven}
        data-quote-stop={shownStop}
        data-quote-loss={q.lossAtStop}
        data-quote-max={q.maxPremiumLoss}
        data-quote-source={q.source}
        data-quote-at={quotedAt}
        data-entry-eligible={gate.eligible ? 'yes' : 'no'}
      >
        <GuideFocus open={guideOpen} onClose={() => setGuideOpen(false)} title="How to read a setup" testId="setup-guide" viewport>
          <SetupGuide odte={setup.expiry === '0DTE'} />
        </GuideFocus>
        <div className="px-5 pt-4 pb-4 flex items-start gap-6 flex-wrap">
          <div className="min-w-0 flex-1 flex items-center gap-3">
            <CompanyLogo ticker={setup.ticker} size={34} />
            <div className="min-w-0">
              <div className="min-h-6 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <h3 className="min-w-0 text-t15 font-semibold leading-tight text-textPrimary">{setup.ticker} <span className={setup.right === 'C' ? 'text-bull' : 'text-bear'}>{setup.contract}</span></h3>
                {kindLabel ? (
                  <span className="px-1.5 py-0.5 rounded border border-silver/40 font-mono text-t9 font-semibold uppercase tracking-wider text-textPrimary whitespace-nowrap">{kindLabel}</span>
                ) : null}
                <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What the chart, the targets and the case mean" testId="setup-guide" />
              </div>
              <p className="mt-0.5 text-t11 text-textMuted whitespace-nowrap truncate">
                {setup.right === 'C' ? 'Call' : 'Put'} · {tenorWord}
                {spotPx > 0 ? ` · ${cashName} ${money(spotPx)}` : ''}
                {place ? ` · ${place}` : ''}
              </p>
              <p className="mt-0.5 text-t11 text-textSecondary truncate">{verdict.why}</p>
              {thetaDown && (
                <p className="mt-0.5 text-t11 text-warn" data-setup-offline>
                  Live data offline — reconnecting.{quoteAt ? ` Quote as of ${nyClock(quoteAt, { seconds: true, zone: true })}.` : ''}
                </p>
              )}
              {passedOver(setup.ticker).length > 0 && (
                <Tip label={passedOver(setup.ticker).join(' · ')}>
                  <p className="mt-1 text-t11 text-textMuted truncate">
                    Passed over · {passedOver(setup.ticker).join(' · ')}
                  </p>
                </Tip>
              )}
            </div>
          </div>
          <dl className="flex flex-wrap gap-x-5 gap-y-2" data-setup-facts data-quote-at={quoteAt}>
            <Fact label="Bid" testId="bid">{q.bid > 0 ? money(q.bid) : 'No bid'}</Fact>
            <Fact label="Ask" testId="premium">{q.ask > 0 ? money(q.ask) : '—'}</Fact>
            {q.bid > 0 && q.ask >= q.bid ? (
              <Fact label="Spread" testId="liquidity">
                <span className={spreadFrac <= spreadCap ? 'text-textPrimary' : 'text-bear'}>{(spreadFrac * 100).toFixed(1)}%</span>
              </Fact>
            ) : null}
            <Fact label="Delta" testId="delta">{greekOk && Number.isFinite(gDelta) ? gDelta.toFixed(2) : '—'}</Fact>
            <Fact label="IV" testId="iv">{greekOk ? `${ivPct.toFixed(0)}%` : '—'}</Fact>
            <Fact label="The line" testId="p1">{setup.p1 == null ? '—' : setup.p1 + 1e-12 >= 0.7067 ? 'Cleared' : 'Short'}</Fact>
            <Fact label="Quote" testId="quote-time">{quoteAt ? nyClock(quoteAt, { seconds: true, zone: true }) : '—'}</Fact>
          </dl>
        </div>
      </div>

      {/* The retirement banner — the loudest thing on a dead setup's page. The
          reader is never navigated away (states, not orders): the case died,
          the post-mortem is information, they leave when they are done. */}
      {retired && floorBreak && (
        <div className="border border-bear/30 bg-bear/[0.04] rounded-md p-3 flex items-center gap-3 animate-soft-in" data-setup-retired>
          <ShieldAlert className="w-5 h-5 text-bear/90 shrink-0" />
          <div>
            <span className="block font-mono text-t12 font-bold uppercase tracking-wider text-bear">Floor broken — setup retired</span>
            <p className="text-t12 text-textPrimary leading-snug">
              <RichRead
                text={`${SPOT_NAME[setup.ticker] ?? setup.ticker} closed ${setup.right === 'C' ? 'below' : 'above'} ${money(floorBreak.floor)} at ${breakTimeLabel}. The level is gone. ${
                  hitCount > 0 ? `${hitCount} of ${c.takeProfits.length} targets hit before the break.` : 'No target was hit.'
                } What follows is the post-mortem.`}
              />
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-stretch">
        <div className="min-w-0 min-h-[560px]" data-theme="dark">
          <ContractTrack
            setup={c}
            revision={revision}
            retired={retired}
            tracked={tracked}
            spot={spotPx}
            quotedAt={quoteAt}
            loadPickRows={loadTickerCons}
            onOpenContract={onOpenContract}
            part="chart"
            timeframe={chartTf}
            onTimeframe={setChartTf}
            quote={chartQuote}
            traded={traded}
            volume={sessionPrints.reduce((sum, p) => sum + p.size, 0)}
            emptyNote={traded && traded.length === 0 ? 'No trades on this contract. A minute with no print is not a candle.' : ''}
            pathNote={traded == null ? (thetaDown ? 'Live data offline. No bars.' : 'No bars in yet.') : ''}
          />
        </div>
        <div className="min-w-0 flex flex-col gap-3">
          <div className="rounded-md border border-silver/40 bg-ink/[0.015] overflow-hidden flex flex-col shrink-0" data-setup-card>
            <div className="px-3.5 pt-3 pb-2 flex items-center gap-2 flex-wrap">
              <ContractLabel contract={setup.contract} right={setup.right} logo={setup.ticker} />
              <span className="font-mono text-t10 text-textSecondary border border-borderSubtle rounded px-1.5 py-0.5">{setup.expiry}</span>
              <span className="ml-auto">
                <SignalBadge tone={badgeTone} dot>
                  {verdict.word}
                </SignalBadge>
              </span>
            </div>
            <Tip label={verdict.why}>
              <p className="px-3.5 pb-2.5 text-t11 text-textMuted truncate">{verdict.why}</p>
            </Tip>

            <div className="px-3.5 h-7 flex items-center border-y border-borderSubtle/60 paper-band">
              <span className="font-mono text-t9 uppercase tracking-widest text-textPrimary">What it costs</span>
            </div>
            <div className="px-3.5 py-2.5 grid grid-cols-3 gap-x-3 gap-y-2.5">
              <RailStat label="Entry" value={line > 0 ? money(line) : '—'} />
              <RailStat label="Bid" value={q.bid > 0 ? money(q.bid) : '—'} />
              <RailStat label="Captured" value={capWord} ink={!Number.isFinite(captured) ? 'text-textMuted' : captured >= 0 ? 'text-bull' : 'text-bear'} />
              <RailStat label="Ask" value={q.ask > 0 ? money(q.ask) : '—'} />
              <RailStat label="Mark" value={q.mark > 0 ? money(q.mark) : '—'} />
              <RailStat label="Spread" value={q.bid > 0 && q.ask >= q.bid ? `${(spreadFrac * 100).toFixed(1)}% wide` : 'No bid'} ink={q.bid > 0 && spreadFrac <= spreadCap ? 'text-textPrimary' : 'text-textSecondary'} />
              <RailStat label="Quote" value={quoteAt ? nyClock(quoteAt, { seconds: true, zone: true }) : '—'} />
            </div>

            {setup.band === 'lottery' ? (
              <p className="px-3.5 py-3 text-t12 text-textSecondary border-t border-borderSubtle/60">No stop. A bid at 3× the ask within 120 seconds sells at 3× the ask. A bid at 2× the ask within 30 seconds sells at 2× the ask. A bid of 0 is held. Flat at 15:50 ET on the bid.</p>
            ) : setup.band === 'closest' ? (
              <div className="px-3.5 py-3 border-t border-borderSubtle/60">
                <RailStat label="Stop if you take it" value={line > 0 ? money(line * STOP_KEEP) : '—'} ink="text-bear" />
                <p className="mt-2 text-t12 text-textSecondary">Not a call. It did not clear 70.67%, or the seat was taken. The ask, the stop at 0.4678 × that ask, and the captured percent are the same numbers a call uses. You decide.</p>
              </div>
            ) : ticket ? (
              <>
                <div className="px-3.5 h-7 flex items-center border-y border-borderSubtle/60 paper-band">
                  <span className="font-mono text-t9 uppercase tracking-widest text-textPrimary">{runner ? 'The ratchet' : 'What it pays'}</span>
                </div>
                <div className="px-3.5 py-2.5 grid grid-cols-4 gap-x-3 gap-y-2.5">
                  {runner ? (
                    <>
                      <RailStat label="1.25×" value={basis > 0 ? money(basis) : '—'} />
                      <RailStat label="1.50×" value={basis > 0 ? money(basis * 1.25) : '—'} />
                      <RailStat label="2×" value={basis > 0 ? money(basis * 1.5) : '—'} />
                      <RailStat label="3×" value={basis > 0 ? money(basis * 2.25) : '—'} />
                    </>
                  ) : (
                    <RailStat label="Sell" value={basis > 0 ? `${money(tpRows[0].price)} · +50%` : '—'} ink="text-bull" />
                  )}
                </div>
                <div className="px-3.5 h-7 flex items-center border-y border-borderSubtle/60 paper-band">
                  <span className="font-mono text-t9 uppercase tracking-widest text-textPrimary">What kills it</span>
                </div>
                <div className="px-3.5 py-2.5">
                  <RailStat label="Stop" value={shownStop > 0 ? money(shownStop) : '—'} ink="text-bear" />
                  <p className="mt-2 text-t12 text-textSecondary">
                    {runner
                      ? 'Stop starts at 0.4678 × the entry ask and never moves down. It lifts to the entry at 1.25×, then 1.25× at +50%, 1.50× at +100%, 2.25× at +200%, and 0.75 × the peak after 4×. A 0.40% reversal over 5 minutes sells the bid. Flat at 15:55 ET.'
                      : 'Stop starts at 0.4678 × the entry ask and never moves down. A non-runner sells at 1.50 × the ask. A 0.40% reversal over 5 minutes sells the bid. Flat at 15:55 ET.'}
                  </p>
                </div>
              </>
            ) : (
              <p className="px-3.5 py-3 text-t12 text-textSecondary border-t border-borderSubtle/60">{setup.whyText || 'Not a ticket. No entry, no stop, no captured percent.'}</p>
            )}
            <div className="px-3.5 h-7 flex items-center gap-x-3 border-t border-borderSubtle/60 font-mono text-t10 text-textMuted overflow-x-auto whitespace-nowrap">
              <span>Delta <span className={`tnum ${greekOk && gDelta >= 0 ? 'text-bull' : 'text-bear'}`}>{greekOk && Number.isFinite(gDelta) ? gDelta.toFixed(2) : '—'}</span></span>
              <span>Theta <span className="tnum text-warn">{greekOk && Number.isFinite(gTheta) ? dayDollars(gTheta) : '—'}</span></span>
              <span>IV <span className="tnum text-textPrimary">{greekOk ? `${ivPct.toFixed(0)}%` : '—'}</span></span>
              <span>Gamma <span className="tnum text-textSecondary">{greekOk && Number.isFinite(second?.gamma ?? NaN) ? (second?.gamma as number).toFixed(4) : '—'}</span></span>
              <span>Vega <span className="tnum text-textSecondary">{greekOk && Number.isFinite(gVega) ? gVega.toFixed(3) : '—'}</span></span>
              <span>Rho <span className="tnum text-textSecondary">{greekOk && Number.isFinite(gRho) ? gRho.toFixed(3) : '—'}</span></span>
              <span>Vanna <span className="tnum text-textSecondary">{Number.isFinite(higher.vanna) ? higher.vanna.toFixed(3) : '—'}</span></span>
              <span>Charm <span className="tnum text-textSecondary">{Number.isFinite(higher.charm) ? higher.charm.toFixed(3) : '—'}</span></span>
              <span>Vomma <span className="tnum text-textSecondary">{Number.isFinite(setup.vomma ?? NaN) ? (setup.vomma as number).toFixed(3) : '—'}</span></span>
              <span>Veta <span className="tnum text-textSecondary">{Number.isFinite(setup.veta ?? NaN) ? ((setup.veta as number) / 365).toFixed(3) : '—'}</span></span>
              <span>Speed <span className="tnum text-textSecondary">{Number.isFinite(setup.speed ?? NaN) ? (setup.speed as number).toFixed(4) : '—'}</span></span>
              <span>Zomma <span className="tnum text-textSecondary">{Number.isFinite(setup.zomma ?? NaN) ? (setup.zomma as number).toFixed(4) : '—'}</span></span>
              <span>Color <span className="tnum text-textSecondary">{Number.isFinite(setup.color ?? NaN) ? ((setup.color as number) / 365).toFixed(4) : '—'}</span></span>
              <span>Ultima <span className="tnum text-textSecondary">{Number.isFinite(setup.ultima ?? NaN) ? (setup.ultima as number).toFixed(4) : '—'}</span></span>
              <span className="ml-auto">{setup.expiry === '0DTE' ? '' : tape.word}</span>
            </div>
            <div className="border-t border-borderSubtle p-2" data-setup-action={verdict.word}>
              {closed ? (
                <button
                  type="button"
                  onClick={() => navigate('/compass/blotter')}
                  className="w-full h-8 inline-flex items-center justify-center rounded-md border border-borderSubtle text-textPrimary font-mono text-t11 font-semibold uppercase tracking-wider"
                  data-setup-track="closed"
                >
                  {closed.result === 'unavailable' ? 'Unavailable · on the blotter' : closed.result === 'win' ? 'Win · on the blotter' : 'Loss · on the blotter'}
                </button>
              ) : (
                <div className="flex h-8 rounded-md overflow-hidden" data-setup-track={tracked ? 'on' : 'off'}>
                  <button
                    type="button"
                    onClick={() => {
                      if (tracked) {
                        untrackSetup(setup.id);
                        setTrackNo(null);
                        return;
                      }
                      const ans = trackSetup(setup, scanner, { mark: q.mark, stop: shownStop, ask: q.entryPremium });
                      if (!ans.ok) {
                        setTrackNo(ans.why === 'full' ? '5 open. Untrack one first.' : ans.why === 'closed' ? 'Could not save this track.' : `Already tracking ${ans.contract}.`);
                        return;
                      }
                      setTrackNo(null);
                      navigate('/compass/tracker', { state: { focus: setup.id } });
                    }}
                    className="relative foil-glide flex-1 min-w-0 inline-flex items-center justify-center gap-2 px-2 holo-bg text-onfoil hover:brightness-105 font-mono text-t11 font-semibold uppercase tracking-wider whitespace-nowrap"
                  >
                    <Bookmark className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{trackNo ?? (tracked ? (expired ? 'Kept' : 'Tracking') : expired ? 'Keep the close' : 'Track')}</span>
                  </button>
                  <Tip label="Open in Tracker">
                    <button
                      type="button"
                      disabled={!tracked}
                      onClick={() => tracked && navigate('/compass/tracker', { state: { focus: setup.id } })}
                      className={`relative foil-glide w-9 shrink-0 inline-flex items-center justify-center border-l border-black/25 holo-bg text-onfoil ${tracked ? 'hover:brightness-105' : 'opacity-40'}`}
                      aria-label="Open in Tracker"
                      data-setup-track="open"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  </Tip>
                </div>
              )}
            </div>
          </div>
          <ContractFlow ticker={setup.ticker} strike={setup.strike} right={setup.right} expiryDate={setup.expiryDate} step={atmStep} session={desk} allSessions={setup.expiry === '0DTE'} />
        </div>
      </div>
    </div>
  );
};

export default CampaignAnalysis;
