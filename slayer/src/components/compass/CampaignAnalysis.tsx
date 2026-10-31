/* A Compass contract's own page, as the owner had it: the contract's premium on the house chart (Terrain's) on one side,
   with the entry, the stop, the exits and the call and its exit marked on it; on the other the trade card (why it is on
   the board, what it costs, pays and what kills it, the contract in dollars and its greeks) with Track at its foot; the
   strikes' flow under both, the call's stages under its head and the contracts around it at the foot. A live call reads the live quote; a past call is read off
   its record (the quote it fired on, the fill, the exit, the contract's own bars and greeks of that session). States,
   never orders. No model score is shown: the model's name is. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowUpRight, Bookmark, Check, Info } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { type Timeframe } from '../../data/timeframe';
import SignalBadge from '../ui/SignalBadge';
import ContractLabel from '../ui/ContractLabel';
import RichRead from '../ui/RichRead';
import CompanyLogo from '../ui/CompanyLogo';
import CardTabs from '../ui/CardTabs';
import GuideFocus, { GuideDoor } from '../ui/GuideFocus';
import { Fact } from '../trace/TraceBox';
import { SetupGuide } from './SetupGuide';
import ContractTrack from './ContractTrack';
import ContractFlow from './ContractFlow';
import GreeksRow from './GreeksRow';
import ContractFacts from './ContractFacts';
import SetupDrivers, { neighborRows } from './SetupDrivers';
import { PROCESS_META, processState, stagesOf, type Stage } from './setupProcess';
import { ReturnFigure } from './LiveReturn';
import { pctWord, pnlWord, returnInk, returnTip, useCallReturn } from '../../data/compassReturn';
import { choiceRight } from '../../data/compass';
import { activeStop, contractPath, signalOf, signals, useSignals, type Signal } from '../../data/compassLedger';
import type { PathQuote } from '../../data/compassOutcome';
import { liveSetups, liveSpark, useChainAround, useContractBars, useContractLive, useGreeksAt, useSecondGreek } from '../../data/thetaBook';
import { currentPicks, leftOf, passedOver } from '../../data/compassModel';
import { entryGate, quoteContract, quoteMissing, quoteStale } from '../../data/contractQuote';
import { MODELS_VALIDATED, MODEL_WORD, OUTSIDE_TRAINED_WORD, RIDING_WORD, SPREAD_MAX, STOP_KEEP, UNVALIDATED_WORD, modelOfBand, printOf, spreadPass, weekdayDte } from '../../data/compassParams';
import { BLOCK_MIN_PREMIUM, BLOCK_MIN_SIZE } from '../../data/tape';
import { useShelfPrints } from '../../data/traceLive';
import type { FlowPrint } from '../../types/trace';
import { nameTape, optionScanOpen, printInSession, sessionYmd } from '../../data/compassSession';
import { useDeskSession } from '../../data/deskSession';
import { nyClock, nyDay } from '../../core/nyTime';
import { type ConPickRow } from './ContractPick';
import { Tip } from '../ui/Tooltip';
import { useTracker } from '../../context/TrackerContext';
import { useThetaStatus } from '../../data/thetaQuote';
import { type OptionRight, type ScannerKey, type Setup, type SleeveKey } from '../../types/compass';
import { MONTHS as MONTH_SHORT } from '../../core/calendar';

/** Dollars with a thousands separator. $5651.67 is not a price anyone can read. */
const money = (n: number, digits = 2) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

/** Theta is per share. One contract is a hundred shares. */
const dayDollars = (perShare: number) => {
  const n = Math.round(Math.abs(perShare) * 100);
  return `${perShare < 0 ? '−' : ''}$${n.toLocaleString('en-US')}`;
};

const SLEEVE_LABEL: Record<SleeveKey, string> = { odte: '0DTE', weekly: 'Weekly', swing: 'Swing', position: 'Position', leaps: 'Long-dated' };

/** The OCC symbol: the contract's own name on any order ticket. */
function occOf(setup: { ticker: string; expiryDate: string; right: string; strike: number }): string {
  const [y, m, d] = (setup.expiryDate || '').split('-');
  if (!y || !m || !d) return '';
  return `${setup.ticker}${y.slice(2)}${m}${d}${setup.right}${Math.round(setup.strike * 1000).toString().padStart(8, '0')}`;
}

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
    return { word: 'Burst buying', why: `${Math.round(recentAsk).toLocaleString('en-US')} bought the ask in 10 minutes, ${Math.round((recentAsk / all) * 100)}% of the session.` };
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
  /** Bumps with each quote — drives incremental candle updates */
  revision: number;
  /** The underlying, live */
  spot: number;
  /** The lens that graded this setup — tracking files under it */
  scanner: ScannerKey;
  sleeve: SleeveKey;
  gradedAt?: string;
  /** Open another contract on the same name: the capsule's pick, or a row of the contracts around it */
  onOpenContract?: (strike: number, right: OptionRight, sleeve?: SleeveKey) => void;
  /** A past call read off its record: no live quote; its own session's bars, greeks and exit */
  past?: Signal | null;
}

/** The board card's stat — 13px figure, a whispered label. */
const RailStat = ({ label, value, ink = 'text-textPrimary', tip }: { label: string; value: string; ink?: string; tip?: string }) => (
  <span className="flex flex-col gap-0.5 min-w-0">
    <span className="font-mono text-t9 uppercase tracking-wider text-textMuted">{label}</span>
    <Tip label={tip ?? value}>
      <span className={`font-mono text-t13 font-semibold tnum truncate ${ink}`}>{value}</span>
    </Tip>
  </span>
);

const Band = ({ children }: { children: string }) => (
  <div className="px-3.5 h-7 flex items-center border-y border-borderSubtle/60 paper-band">
    <span className="font-mono text-t9 uppercase tracking-widest text-textPrimary">{children}</span>
  </div>
);

const STAGE_INK: Record<Stage['tone'], string> = {
  done: 'text-textPrimary',
  now: 'text-textPrimary',
  next: 'text-textMuted',
  win: 'text-bull',
  loss: 'text-bear',
};

/** The call's stages in a row: called, filled, each rung the stop climbed, and the exit (or holding). */
const StageStrip = ({ stages }: { stages: Stage[] }) => (
  <ol className="flex items-stretch gap-0 overflow-x-auto border border-borderSubtle rounded-md bg-panel" data-setup-stages={stages.length}>
    {stages.map((s, i) => (
      <li key={s.key} className={`min-w-[120px] flex-1 px-3.5 py-2.5 ${i ? 'border-l border-borderSubtle/70' : ''}`} data-setup-stage={s.key}>
        <span className="flex items-center gap-1.5">
          <span className={`inline-flex w-3.5 h-3.5 items-center justify-center rounded-full border ${s.tone === 'now' ? 'border-textPrimary' : s.tone === 'win' ? 'border-bull bg-bull/15' : s.tone === 'loss' ? 'border-bear bg-bear/15' : 'border-borderMuted bg-ink/[0.06]'}`}>
            {s.tone === 'now' ? <span className="w-1.5 h-1.5 rounded-full bg-textPrimary animate-pulse" /> : <Check className={`w-2.5 h-2.5 ${STAGE_INK[s.tone]}`} />}
          </span>
          <span className={`font-mono text-t10 uppercase tracking-wider font-semibold whitespace-nowrap ${STAGE_INK[s.tone]}`}>{s.word}</span>
          {s.at ? <span className="ml-auto pl-2 font-mono text-t10 tnum text-textMuted whitespace-nowrap">{nyClock(s.at)}</span> : null}
        </span>
        <span className="mt-1 block font-mono text-t11 tnum text-textSecondary truncate">{s.detail}</span>
      </li>
    ))}
  </ol>
);

/** What the model that made the call did, in words — never its score. */
function modelSentence(setup: Setup, riding: boolean, calledAt: number): string {
  const when = calledAt ? ` at the ${nyClock(setup.mark ?? calledAt)} ET mark` : '';
  if (setup.band === 'lottery') return `${MODEL_WORD[3]}, the late sweep, called it${when}. It is a rule, not a score: from 15:20 ET it takes the cheap same-day contracts whose quote passes, holds them without a stop, and sells at 3× inside 120 seconds or 2× inside 30 seconds of the fill, or flat at 15:50 ET.`;
  if (setup.band === 'closest') return setup.whyText || 'Not a call. It is the closest contract the scan held: it did not clear the line, or the seat was taken.';
  const far = setup.band === 'wing';
  const rides = riding
    ? ` ${MODEL_WORD[2]} cleared on it too, so ${MODEL_WORD[2]} rides it: no sell at 1.50×, the stop ratchets up behind it instead.`
    : far
      ? ' It is far from the money, so its exit rides the ratchet.'
      : ` ${MODEL_WORD[2]} did not clear, so it sells at 1.50 × the fill.`;
  return `${MODEL_WORD[1]} cleared its line on this contract${when}, with a bid over $0.15 and a spread at or under 8%.${rides}`;
}

const CampaignAnalysis = ({ setup, revision, spot, scanner, sleeve, gradedAt, onOpenContract, past = null }: CampaignAnalysisProps) => {
  const { trackSetup, untrackSetup, isTracked } = useTracker();
  const record = useSignals();
  const thetaDown = useThetaStatus() === 'down';
  const signal = useMemo(() => past ?? signalOf(setup.id), [record, setup.id, past]); // eslint-disable-line react-hooks/exhaustive-deps
  const outcome = signal?.outcome ?? null;
  const isPast = past != null;
  /* the call's return from its fill: the one live quote per contract the board, the Tracker and the Blotter read too
     (an open call on its record page reads it as well), its capture at the exit once closed */
  const ret = useCallReturn(signal);
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

  const loadTickerCons = useCallback((): ConPickRow[] => {
    return liveSetups()
      .filter(s => s.ticker === setup.ticker && s.bid > 0 && s.ask >= s.bid)
      .map(s => ({ key: s.id, strike: s.strike, right: s.right, sleeve: s.sleeve, title: s.contract, tag: s.expiry, sub: s.ask > 0 ? `$${s.ask.toFixed(2)}` : '—' }));
  }, [setup.ticker]);

  const [chartTf, setChartTf] = useState<Timeframe>('1m');
  const [cardTab, setCardTab] = useState<'why' | 'trade' | 'contract'>('why');

  const shelf = useShelfPrints(setup.ticker);
  const mine = useMemo(
    () => shelf.filter(p => p.right === setup.right && Math.abs(p.strike - setup.strike) < 0.001 && isoOf(p.expiry) === setup.expiryDate.slice(0, 10)),
    [shelf, setup.right, setup.strike, setup.expiryDate],
  );
  const sessionPrints = useMemo(
    () => (isPast ? [] : setup.expiry === '0DTE' ? mine : mine.filter(p => printInSession(p, setup.ticker, desk))),
    [mine, setup.ticker, setup.expiry, desk, isPast],
  );

  /* THE QUOTE: live, or the record's for a past call (its exit quote, else its last read); never a mix */
  const live = useContractLive(setup.ticker, setup.expiryDate, setup.strike, setup.right, !isPast);
  const second = useSecondGreek(setup.ticker, setup.expiryDate, setup.strike, setup.right, !isPast);
  const atCall = useGreeksAt(setup.ticker, setup.expiryDate, setup.strike, setup.right, signal?.firedAt ?? 0, isPast && !!signal);
  const recLast = isPast ? outcome?.last ?? null : null;
  const quoteAt = isPast ? recLast?.t ?? signal?.quoteAt ?? 0 : live?.at || setup.quotedAt || quotedAt;
  const spotPx = isPast ? (atCall && atCall.under > 0 ? atCall.under : signal?.spot ?? 0) : live && live.under > 0 ? live.under : spot;
  const ivPct = isPast ? atCall?.iv ?? NaN : live && Number.isFinite(live.iv) ? live.iv : !live && Number.isFinite(setup.greeks.iv) ? setup.greeks.iv : NaN;
  const recBid = recLast ? recLast.bid : signal?.bid ?? 0;
  const recAsk = recLast ? recLast.ask : signal?.ask ?? 0;
  const q = quoteContract({
    ticker: setup.ticker,
    contract: setup.contract,
    strike: setup.strike,
    right: setup.right,
    spot: spotPx,
    bid: isPast ? recBid : live && live.ask >= live.bid ? live.bid : !live && setup.bid > 0 ? setup.bid : 0,
    ask: isPast ? recAsk : live && live.ask > 0 ? live.ask : !live && setup.ask > 0 ? setup.ask : 0,
    ivPct: Number.isFinite(ivPct) ? ivPct : 0,
    quotedAt: quoteAt,
    source: 'theta',
  });
  const gDelta = isPast ? atCall?.delta ?? NaN : live && Number.isFinite(live.delta) ? live.delta : !live ? setup.greeks.delta : NaN;
  const gTheta = isPast ? atCall?.theta ?? NaN : live && Number.isFinite(live.theta) ? live.theta : !live ? setup.greeks.theta : NaN;
  const gVega = isPast ? atCall?.vega ?? NaN : live && Number.isFinite(live.vega) ? live.vega : !live ? setup.greeks.vega : NaN;
  const gRho = isPast ? atCall?.rho ?? NaN : live && Number.isFinite(live.rho) ? live.rho : !live && Number.isFinite(setup.greeks.rho ?? NaN) ? (setup.greeks.rho as number) : NaN;
  const gGamma = second?.gamma ?? NaN;
  const traded = useContractBars(setup.ticker, setup.expiryDate, setup.strike, setup.right, true, chartTf, isPast && signal ? signal.day : '');
  const bidPx = q.bid;
  const midPx = q.mark;
  const spreadFrac = midPx > 0 ? (q.ask - q.bid) / midPx : 1;
  const ticket = setup.band === 'top' || setup.band === 'wing' || setup.band === 'lottery';
  const paidAsk = outcome?.fill?.ask ?? 0;
  const basis = paidAsk > 0 ? paidAsk : 0;
  const shownStop = ticket && setup.band !== 'lottery' && basis > 0 ? Number((basis * STOP_KEEP).toFixed(2)) : 0;
  const indexRoot = setup.ticker === 'SPXW' || setup.ticker === 'SPX' || setup.ticker === 'XSP' || setup.ticker === 'RUT' || setup.ticker === 'RUTW' || setup.ticker === 'NDXP';
  const atmStep = setup.ticker === 'VIX' ? 0.5 : indexRoot ? 5 : setup.strike >= 200 ? 1 : 0.5;
  const higher = { vanna: second?.vanna ?? NaN, charm: second?.charm ?? NaN };
  const tape = nameTape(setup.ticker, setup.expiry === '0DTE');
  const expired = isPast || (setup.expiry === '0DTE' ? tape.done : setup.sessionsLeft <= 0);
  const dayOver = isPast || tape.done;
  const missing = quoteMissing(q);
  const quoting = !isPast && (tape.option === 'open' || tape.option === 'overnight' || tape.option === 'pre' || tape.option === 'curb');
  const stale = quoting && quoteStale(quoteAt, Date.now(), missing);
  const spreadCap = SPREAD_MAX;
  const quoteOk = !missing && !stale && spreadPass(bidPx, q.ask);
  const tapeOpen = !isPast && (optionScanOpen(setup.ticker, setup.expiry === '0DTE' ? 0 : 1) || (ticket && tape.option !== 'closed'));
  const gate = entryGate({ sessionOpen: tapeOpen, expired, quoteOk, executionQuote: false });
  /* THE BASE every number on the chart measures from: the fill once it filled, the call's ask before (said on the line) */
  const line = basis > 0 ? basis : signal && signal.ask > 0 ? signal.ask : setup.ask > 0 ? setup.ask : 0;
  const lineWord = basis > 0 ? 'FILL' : signal && signal.ask > 0 ? 'ASK AT CALL' : 'ASK';
  const captured = line > 0 && q.bid > 0 ? ((q.bid - line) / line) * 100 : NaN;
  const capWord = Number.isFinite(captured) ? `${captured >= 0 ? '+' : '−'}${Math.abs(captured).toFixed(1)}%` : '—';
  const checkFail = ticket
    ? null
    : setup.band === 'closest'
      ? setup.whyText || 'Not a ticket.'
      : !(bidPx > 0.15) ? 'Bid is at or under 0.15' : spreadFrac > spreadCap + 1e-9 ? 'Spread is over 8%' : missing ? 'Quote missing' : stale ? 'Quote stale' : null;
  const riding = setup.band === 'top' && (setup.runner === true || signal?.runner === true);
  const runner = setup.band === 'wing' || riding;
  const liveStop = basis > 0 && setup.band !== 'lottery' && setup.band !== 'closest' ? activeStop(basis, outcome?.peak ?? 0, runner) : null;
  const stopHit = !isPast && !missing && liveStop != null && q.bid >= 0 && q.bid <= liveStop.stop;
  /* the chart's stop is the one standing (the ratchet's rung once it climbed), else 0.4678 × the base; the late sweep
     has none, so none is drawn */
  const chartStop = setup.band === 'lottery' || !(line > 0) ? 0 : liveStop ? liveStop.stop : Number((line * STOP_KEEP).toFixed(2));
  const chartQuote = line > 0 ? { ...q, entryPremium: line, stopPremium: chartStop } : q;
  const tp1Mult = 1.5;
  const tp1Hit = !isPast && ticket && !runner && setup.band !== 'lottery' && basis > 0 && q.bid >= basis * tp1Mult;
  const changed = !stopHit && !tp1Hit ? tapeChange(sessionPrints) : null;
  const sessionOpenPx = liveSpark(setup.ticker)[0] ?? 0;
  const choice = choiceRight(setup.right === 'C', tape.option === 'open' ? spotPx : 0, tape.option === 'open' ? sessionOpenPx : 0);
  const flipped = !isPast && tracked && choice !== setup.right;
  const killed = stopHit || tp1Hit || dayOver || flipped;
  const liveVerdict = stopHit
    ? { word: 'Stop hit', why: `Bid ${money(q.bid)} is through the ${liveStop?.name.toLowerCase() ?? 'stop'} at ${money(liveStop?.stop ?? shownStop)}. The trade is done.` }
    : tp1Hit
      ? { word: 'TP1', why: `Bid ${money(q.bid)} is through ${money(basis * tp1Mult)}. It sells there: ${MODEL_WORD[2]} is not riding it.` }
      : changed
        ? { word: changed.word, why: changed.why }
        : dayOver && !isPast
          ? { word: "Day's over", why: tape.doneWhy }
          : flipped
            ? { word: 'Take caution', why: `The book would take the ${choice === 'P' ? 'puts' : 'calls'}. Exit here, even under +25%. This is the choice, not an order. It is not a loss.` }
            : ticket && line > 0 && q.bid > 0 && !isPast
              ? { word: 'Called', why: `In at ${money(line)}. Bid ${money(q.bid)}. ${capWord}. The line holds.` }
              : checkFail
                ? { word: 'Rejected', why: checkFail }
                : tape.option !== 'closed' && tape.option !== 'open'
                  ? { word: tape.word, why: tape.liveWhy }
                  : !tape.option || tape.option === 'closed'
                    ? { word: tracked ? 'Open paper' : 'Still on', why: tape.quietWhy }
                    : tracked
                      ? { word: 'Open paper', why: 'On the book. Paper only. Nothing is sent.' }
                      : { word: 'Candidate', why: 'Paper only. Track it to watch it. Nothing is sent.' };
  const closed = outcome && outcome.status === 'closed' && outcome.exit && outcome.fill
    ? { result: (outcome.pnl ?? (outcome.exit.px - outcome.fill.ask) * 100) > 0 ? ('win' as const) : ('loss' as const), why: outcome.exit.why, exitPx: outcome.exit.px }
    : outcome && outcome.status === 'unavailable'
      ? { result: 'unavailable' as const, why: 'Unavailable', exitPx: 0 }
      : null;
  const verdict = setup.band === 'closest'
    ? { word: 'Closest', why: setup.whyText || 'It did not clear a book.' }
    : closed
      ? closed.result === 'unavailable'
        ? { word: 'Unavailable', why: 'No valid quote stood a minute after the call. No price was substituted.' }
        : closed.result === 'win'
          ? { word: 'Win', why: `${closed.why}. Left at ${money(closed.exitPx)}. On the blotter. Paper only.` }
          : { word: 'Loss', why: `${closed.why}. Left at ${money(closed.exitPx)}. On the blotter. Paper only.` }
      : isPast
        ? { word: 'On the record', why: outcome?.fill ? `Filled ${money(outcome.fill.ask)}. Its last read is on the blotter.` : 'Waiting for its fill.' }
        : liveVerdict;
  const badgeTone = verdict.word === 'Win' ? 'bull' : verdict.word === 'Loss' || verdict.word === 'Rejected' ? 'bear' : isPast ? 'white' : killed ? 'bear' : verdict.word === 'Called' && q.bid >= line ? 'bull' : 'white';

  /* the call's stages, replayed on the contract's recorded minute quotes after it */
  const [path, setPath] = useState<{ key: string; quotes: PathQuote[] }>({ key: '', quotes: [] });
  const pathKey = signal ? `${signal.key}|${outcome?.status ?? ''}` : '';
  useEffect(() => {
    if (!signal || !outcome?.fill || signal.book === 'C') return;
    let dead = false;
    const read = () =>
      contractPath(signal, outcome.fill?.at ?? null).then(quotes => {
        if (!dead && quotes) setPath({ key: pathKey, quotes });
      });
    void read();
    const id = outcome.status === 'open' && !isPast ? window.setInterval(read, 60_000) : 0;
    return () => {
      dead = true;
      if (id) window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathKey]);
  const stages = useMemo(() => (signal ? stagesOf(signal, path.key === pathKey ? path.quotes : [], runner) : []), [signal, path, pathKey, runner]);

  /* the contracts around it: the live book on the same expiration */
  const chain = useChainAround(setup.ticker, setup.expiryDate, 4, !isPast && ticket);
  const around = useMemo(() => (chain && spotPx > 0 ? neighborRows(setup.ticker, chain, spotPx, { strike: setup.strike, right: setup.right }) : []), [chain, spotPx, setup.ticker, setup.strike, setup.right]);

  /* where it sits: the calls on the board now, or that session's calls for a past one */
  const place = useMemo(() => {
    if (isPast && signal) {
      const day = signals().filter(s => s.day === signal.day).sort((a, b) => a.firedAt - b.firedAt);
      const i = day.findIndex(s => s.key === signal.key);
      return i >= 0 ? `call ${i + 1} of ${day.length} that session` : '';
    }
    const board = currentPicks().filter(s => s.band === 'top' || s.band === 'wing' || s.band === 'lottery');
    const i = board.findIndex(s => s.id === setup.id);
    return i >= 0 ? `#${i + 1} of ${board.length} calls on the board` : 'not on the board now';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPast, signal, setup.id, record]);

  const sessionsLeft = weekdayDte(sessionYmd(), setup.expiryDate);
  const tenorWord = isPast
    ? `${dayStamp(setup.expiryDate)} · expired`
    : setup.expiry === '0DTE'
      ? tape.done
        ? `${dayStamp(setup.expiryDate)} · done`
        : `${dayStamp(setup.expiryDate)} · ${tape.word}`
      : `${dayStamp(setup.expiryDate)}${Number.isFinite(sessionsLeft) ? ` · ${sessionsLeft} ${sessionsLeft === 1 ? 'session' : 'sessions'} left` : ''}`;
  const cashName = printOf(setup.ticker);
  const greekOk = Number.isFinite(ivPct) && ivPct > 0;
  const pts = spotPx > 0 ? (setup.right === 'C' ? spotPx - setup.strike : setup.strike - spotPx) : NaN;
  const moneyness = !Number.isFinite(pts) ? '' : Math.abs(pts) / spotPx < 0.0015 ? 'ATM' : `${Math.abs(pts).toFixed(0)} pts ${pts > 0 ? 'ITM' : 'OTM'}`;
  const model = modelOfBand(setup.band);
  const unchecked = setup.band === 'top' || setup.band === 'wing' ? `${MODELS_VALIDATED ? '' : UNVALIDATED_WORD}${setup.outsideTrained || signal?.outsideTrained ? `${MODELS_VALIDATED ? '' : ' · '}${OUTSIDE_TRAINED_WORD}` : ''}` : '';
  const calledAt = signal?.firedAt ?? setup.seenAt ?? 0;
  const proc = processState(gDelta, !!closed || isPast);
  const procMeta = PROCESS_META[proc];
  const holdWord = setup.band === 'lottery' ? '3× or 2×, or 15:50' : setup.band === 'closest' ? 'Not a call' : riding ? `${MODEL_WORD[2]} rides` : setup.band === 'wing' ? 'Rides the ratchet' : 'Out at 1.50×';
  const callSpread = signal && signal.ask > 0 && signal.bid >= 0 ? ((signal.ask - signal.bid) / ((signal.ask + signal.bid) / 2)) * 100 : NaN;
  const intrinsic = spotPx > 0 ? (setup.right === 'C' ? Math.max(spotPx - setup.strike, 0) : Math.max(setup.strike - spotPx, 0)) : NaN;
  const breakeven = line > 0 ? (setup.right === 'C' ? setup.strike + line : setup.strike - line) : NaN;
  const [guideOpen, setGuideOpen] = useState(false);
  /* Track sits at the page's foot: the Tracker opens at its top, where the kept contract is, not at the foot the page
     was scrolled to (the scroller held the old position through the route change) */
  const toTracker = () => {
    navigate('/compass/tracker', { state: { focus: setup.id } });
    requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector<HTMLElement>('main')?.scrollTo({ top: 0 })));
  };

  const left = leftOf(setup.id);
  return (
    <div className="flex flex-col gap-4">
      {left && !isPast && (
        <div className="border border-bear/30 bg-bear/[0.04] rounded-md px-4 py-3" data-setup-left={left.why}>
          <span className="block font-mono text-t12 font-bold uppercase tracking-wider text-bear">{left.why}</span>
          <p className="mt-1 text-t12 text-textPrimary">This contract left the board at {nyClock(signal?.outcome?.exit?.at ?? left.at, { zone: true })}{signal?.outcome?.exit ? `, at ${money(signal.outcome.exit.px)}` : ''}. It is off the list.</p>
        </div>
      )}
      {isPast && signal && (
        <div className="border border-borderSubtle rounded-md bg-panel px-4 py-2.5 font-mono text-t10 uppercase tracking-wider text-textSecondary" data-setup-past={signal.key}>
          {signal.would ? 'Not a call: what a late mark would have called' : 'A past call'} · {nyDay(signal.firedAt, { weekday: true })} · read off its record: the quote it fired on, its fill and its exit, and the contract&apos;s own minutes that session
        </div>
      )}
      {/* THE SETUP'S HEAD — the logo, the contract in its side's ink, its state, the model that called it, the tenor;
          the facts at the right */}
      <div
        className="relative border border-borderSubtle rounded-md bg-panel"
        data-setup-head={setup.id}
        data-setup-state={verdict.word}
        data-setup-model={model}
        data-setup-riding={riding ? 'yes' : 'no'}
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
        data-quote-source={isPast ? 'record' : q.source}
        data-quote-at={quotedAt}
        data-entry-eligible={gate.eligible ? 'yes' : 'no'}
      >
        <GuideFocus open={guideOpen} onClose={() => setGuideOpen(false)} title="How to read a setup" testId="setup-guide" viewport>
          <SetupGuide odte={setup.expiry === '0DTE'} />
        </GuideFocus>
        <div className="px-5 pt-4 pb-4 flex items-start gap-6 flex-wrap">
          <div className="min-w-[min(100%,440px)] flex-1 flex items-center gap-3">
            <CompanyLogo ticker={setup.ticker} size={34} />
            <div className="min-w-0">
              <div className="min-h-6 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <h3 className="min-w-0 text-t15 font-semibold leading-tight text-textPrimary">
                  {setup.ticker} <span className={setup.right === 'C' ? 'text-bull' : 'text-bear'}>{setup.contract}</span>
                </h3>
                <SignalBadge tone={badgeTone} dot>
                  {verdict.word}
                </SignalBadge>
                {model ? (
                  <span className="px-1.5 py-0.5 rounded border border-silver/50 font-mono text-t10 font-bold uppercase tracking-wider text-textPrimary whitespace-nowrap" data-model-chip>
                    {model}
                  </span>
                ) : null}
                {riding ? (
                  <span className="px-1.5 py-0.5 rounded holo-bg font-mono text-t10 font-bold uppercase tracking-wider text-onfoil whitespace-nowrap" data-riding-chip>
                    {RIDING_WORD}
                  </span>
                ) : null}
                <span className="px-1.5 py-0.5 rounded border border-borderSubtle bg-ink/[0.05] font-mono text-t9 font-semibold uppercase tracking-wider text-textPrimary whitespace-nowrap">{SLEEVE_LABEL[sleeve] ?? sleeve}</span>
                {unchecked ? <span className="font-mono text-t9 tracking-wider text-textMuted whitespace-nowrap">{unchecked}</span> : null}
                <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What the chart, the stages and the card mean" testId="setup-guide" />
              </div>
              <p className="mt-0.5 text-t11 text-textMuted truncate">
                {setup.right === 'C' ? 'Call' : 'Put'} · strike {money(setup.strike)} · {tenorWord}
                {spotPx > 0 ? ` · ${cashName} ${money(spotPx)}` : ''}
                {moneyness ? ` · ${moneyness}` : ''}
                {occOf(setup) ? ` · ${occOf(setup)}` : ''}
              </p>
              <p className="mt-0.5 text-t11 text-textSecondary truncate">{verdict.why}</p>
              {thetaDown && !isPast && (
                <p className="mt-0.5 text-t11 text-warn" data-setup-offline>
                  Live data offline — reconnecting.{quoteAt ? ` Quote as of ${nyClock(quoteAt, { seconds: true, zone: true })}.` : ''}
                </p>
              )}
              {!isPast && passedOver(setup.ticker).length > 0 && (
                <Tip label={passedOver(setup.ticker).join(' · ')}>
                  <p className="mt-1 text-t11 text-textMuted truncate">Passed over · {passedOver(setup.ticker).join(' · ')}</p>
                </Tip>
              )}
            </div>
          </div>
          <dl className="flex flex-wrap gap-x-5 gap-y-2" data-setup-facts data-quote-at={quoteAt}>
            {signal && ticket ? (
              <Fact label={ret.state === 'captured' ? 'At the exit' : 'Return from the fill'} testId="return">
                <ReturnFigure r={ret} id={signal.key} size="lg" />
              </Fact>
            ) : null}
            <Fact label={isPast ? 'Last bid' : 'Bid'} testId="bid">{q.bid > 0 ? money(q.bid) : 'No bid'}</Fact>
            <Fact label={isPast ? 'Last ask' : 'Ask'} testId="premium">{q.ask > 0 ? money(q.ask) : '—'}</Fact>
            {q.bid > 0 && q.ask >= q.bid ? (
              <Fact label="Spread" testId="liquidity">
                <span className={spreadFrac <= spreadCap ? 'text-textPrimary' : 'text-bear'}>{(spreadFrac * 100).toFixed(1)}%</span>
              </Fact>
            ) : null}
            <Fact label={isPast ? 'Delta at call' : 'Delta'} testId="delta">{Number.isFinite(gDelta) ? gDelta.toFixed(2) : '—'}</Fact>
            <Fact label={isPast ? 'IV at call' : 'IV'} testId="iv">{greekOk ? `${ivPct.toFixed(0)}%` : '—'}</Fact>
            <Fact label="Hold" testId="hold">{holdWord}</Fact>
            <Fact label="Called" testId="listed">{calledAt ? nyClock(calledAt, { zone: true }) : '—'}</Fact>
            <Fact label="Quote" testId="quote-time">{quoteAt ? nyClock(quoteAt, { seconds: true, zone: true }) : '—'}</Fact>
          </dl>
        </div>
      </div>

      {/* THE STAGES — called, filled, the stop's rungs, out (or holding) */}
      {stages.length > 0 && <StageStrip stages={stages} />}

      {/* THE CHART AND THE CARD — the contract's premium on the house chart, the trade card beside it; the chart is as
          tall as the card, so the two end together. The strikes' flow runs under both. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-3 items-stretch" data-setup-row>
        <div className="min-w-0 h-[460px] sm:h-[520px] lg:h-auto lg:min-h-[560px]" data-setup-side="option">
          <ContractTrack
            setup={setup}
            revision={revision}
            tracked={tracked}
            spot={spotPx}
            quotedAt={quoteAt}
            loadPickRows={isPast ? undefined : loadTickerCons}
            onOpenContract={isPast ? undefined : onOpenContract}
            timeframe={chartTf}
            onTimeframe={setChartTf}
            quote={chartQuote}
            traded={traded}
            volume={sessionPrints.reduce((sum, p) => sum + p.size, 0)}
            emptyNote={traded && traded.length === 0 ? 'No trades on this contract. A minute with no print is not a candle.' : ''}
            pathNote={traded == null ? (thetaDown ? 'Live data offline. No bars.' : 'Reading the bars.') : ''}
            multiples={setup.band === 'lottery' ? [2, 3] : undefined}
            entryWord={lineWord}
            calledAt={calledAt}
            exit={outcome?.exit ? { at: outcome.exit.at, result: closed?.result === 'win' ? 'win' : closed?.result === 'loss' ? 'loss' : 'flat' } : null}
            live={!isPast}
          />
        </div>
        {/* THE OTHER SIDE: the trade card, Track at its foot */}
        <div className="min-w-0 flex flex-col" data-setup-side="rest">
          <div className="rounded-md border border-silver/40 bg-ink/[0.015] overflow-hidden flex flex-col flex-1" data-setup-card data-card-tab={cardTab}>
            <div className="px-3.5 pt-3 pb-2 flex items-center gap-2 flex-wrap">
              <ContractLabel contract={setup.contract} right={setup.right} logo={setup.ticker} />
              <span className="font-mono text-t10 text-textSecondary border border-borderSubtle rounded px-1.5 py-0.5">{setup.expiry}</span>
              <SignalBadge tone={procMeta.tone} dot pulse={procMeta.pulse}>
                {proc}
              </SignalBadge>
              <span className="ml-auto">
                <SignalBadge tone={badgeTone} dot>
                  {verdict.word}
                </SignalBadge>
              </span>
            </div>
            <div className="px-3.5 pb-2.5">
              <CardTabs
                ariaLabel="The trade card"
                options={[
                  { value: 'why', label: 'Why we chose this' },
                  { value: 'trade', label: 'The trade' },
                  { value: 'contract', label: 'Contract' },
                ]}
                value={cardTab}
                onChange={setCardTab}
              />
            </div>

            {cardTab === 'why' && (
              <div className="border-t border-borderSubtle/60 p-3 flex flex-col gap-3" data-setup-why>
                <div className="flex items-center gap-2 flex-wrap">
                  {model ? <span className="font-mono text-t11 font-bold uppercase tracking-wider text-textPrimary">{model}</span> : <span className="font-mono text-t11 uppercase tracking-wider text-textSecondary">Not a call</span>}
                  {riding ? <span className="font-mono text-t10 font-bold uppercase tracking-wider px-1.5 py-0.5 rounded holo-bg text-onfoil">{RIDING_WORD}</span> : null}
                  <span className="ml-auto font-mono text-t9 uppercase tracking-wider text-textSecondary whitespace-nowrap">{place}</span>
                </div>
                <div className="flex items-start gap-2 border border-borderSubtle bg-inset rounded-md px-3 py-2.5">
                  <Info className="w-3.5 h-3.5 text-textSecondary shrink-0 mt-0.5" />
                  <div className="flex flex-col gap-1.5 min-w-0">
                    <span className="font-mono text-t9 uppercase tracking-widest text-textMuted">Why it is on the board</span>
                    <p className="text-t11 text-textPrimary leading-relaxed">
                      <RichRead text={modelSentence(setup, riding, calledAt)} />
                    </p>
                  </div>
                </div>
                <div className="border border-borderSubtle rounded-md overflow-hidden">
                  <div className="px-3 py-1.5 border-b border-borderSubtle bg-inset">
                    <span className="font-mono text-t9 uppercase tracking-widest text-textMuted">The numbers behind it</span>
                  </div>
                  <table className="w-full">
                    <tbody className="divide-y divide-borderSubtle">
                      {[
                        { k: 'The model', v: model ? `${model}${setup.band === 'lottery' ? ' — the late sweep, by rule' : ' — cleared its line'}` : 'None — not a call', ink: 'text-textPrimary' },
                        ...(setup.band === 'top' ? [{ k: MODEL_WORD[2], v: riding ? 'Cleared — it rides the call' : 'Did not clear — sells at 1.50×', ink: riding ? 'text-bull' : 'text-textPrimary' }] : []),
                        { k: 'The side', v: setup.right === 'C' ? 'a call, bullish — it pays as the underlying rises' : 'a put, bearish — it pays as the underlying falls', ink: setup.right === 'C' ? 'text-bull' : 'text-bear' },
                        { k: 'The clock', v: `${SLEEVE_LABEL[sleeve] ?? sleeve} · ${tenorWord}${calledAt ? ` · called ${nyClock(calledAt, { zone: true })}` : ''}`, ink: 'text-textPrimary' },
                        { k: 'At the call', v: signal ? `${signal.bid.toFixed(2)} × ${signal.ask.toFixed(2)}${Number.isFinite(callSpread) ? ` · ${callSpread.toFixed(1)}% wide` : ''}${signal.spot ? ` · ${cashName} ${money(signal.spot)}` : ''}` : setup.ask > 0 ? `${setup.bid.toFixed(2)} × ${setup.ask.toFixed(2)}` : '—', ink: 'text-textPrimary' },
                        { k: 'The greeks', v: greekOk ? `delta ${Number.isFinite(gDelta) ? gDelta.toFixed(2) : '—'} · IV ${ivPct.toFixed(1)}% · theta ${Number.isFinite(gTheta) ? dayDollars(gTheta) : '—'}/day${isPast ? ' · at the call' : ''}` : '—', ink: 'text-textPrimary' },
                        { k: 'The board', v: place || '—', ink: 'text-textPrimary' },
                      ].map(row => (
                        <tr key={row.k} data-why-row={row.k}>
                          <td className="px-3 py-1.5 align-top font-mono text-t9 uppercase tracking-wider text-textSecondary whitespace-nowrap w-28">{row.k}</td>
                          <td className={`px-3 py-1.5 text-t11 leading-snug ${row.ink}`}>{row.v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="border border-borderSubtle bg-inset rounded-md px-3 py-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <AlertTriangle className="w-3 h-3 text-warn" />
                    <span className="font-mono text-t9 uppercase tracking-widest text-textMuted">What ends it</span>
                  </div>
                  <p className="text-t11 text-textPrimary leading-snug">
                    {setup.band === 'lottery'
                      ? 'No stop. A bid at 3× the fill inside 120 seconds sells there, 2× inside 30 seconds sells there; otherwise it is flat at 15:50 ET on the bid.'
                      : setup.band === 'closest'
                        ? 'Nothing: it is not a call. A call on it would stop at 0.4678 × its ask.'
                        : <>A bid at or under <span className="font-mono font-semibold tnum text-warn">{liveStop ? money(liveStop.stop) : line > 0 ? money(line * STOP_KEEP) : '—'}</span>{liveStop ? ` (${liveStop.name === 'Stop' ? 'the stop' : liveStop.name.toLowerCase()})` : ' (0.4678 × the fill)'}; a 0.40% reversal of the underlying over 5 minutes; or the flat at 15:55 ET. {riding || setup.band === 'wing' ? 'The stop only climbs: to the entry at 1.25×, then behind each rung.' : 'It sells at 1.50 × the fill.'}</>}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/compass', { state: { tickerFilter: setup.ticker } })}
                  className="self-start inline-flex items-center gap-1.5 font-mono text-t10 uppercase tracking-wider text-textSecondary hover:text-textPrimary transition-colors"
                  data-why-board
                >
                  <ArrowUpRight className="w-3 h-3" /> See <CompanyLogo ticker={setup.ticker} size={12} /> {setup.ticker} on the board
                </button>
              </div>
            )}

            {cardTab === 'trade' && (
              <div data-setup-trade>
                <Band>What it costs</Band>
                <div className="px-3.5 py-2.5 grid grid-cols-3 gap-x-3 gap-y-2.5">
                  <RailStat label={basis > 0 ? 'Filled' : 'Entry'} value={line > 0 ? money(line) : '—'} />
                  <RailStat label={isPast ? (closed ? 'Exit' : 'Last bid') : 'Bid'} value={isPast && closed && closed.exitPx > 0 ? money(closed.exitPx) : q.bid > 0 ? money(q.bid) : '—'} />
                  {signal ? (
                    <RailStat
                      label={ret.state === 'captured' ? 'Captured' : ret.state === 'asof' ? `Return · ${nyClock(ret.at)}` : 'Return'}
                      value={ret.pct != null ? pctWord(ret.pct) : ret.state === 'unavailable' ? 'No fill' : ret.state === 'noquote' ? 'No quote' : 'Waiting for fill'}
                      ink={ret.pct == null ? 'text-textMuted' : ret.state === 'asof' ? 'text-textSecondary' : returnInk(ret.pct)}
                      tip={returnTip(ret)}
                    />
                  ) : (
                    <RailStat label="Captured" value={capWord} ink={!Number.isFinite(captured) ? 'text-textMuted' : captured >= 0 ? 'text-bull' : 'text-bear'} />
                  )}
                  <RailStat label="Ask" value={q.ask > 0 ? money(q.ask) : '—'} />
                  <RailStat label="Mark" value={q.mark > 0 ? money(q.mark) : '—'} />
                  <RailStat label="Spread" value={q.bid > 0 && q.ask >= q.bid ? `${(spreadFrac * 100).toFixed(1)}% wide` : 'No bid'} ink={q.bid > 0 && spreadFrac <= spreadCap ? 'text-textPrimary' : 'text-textSecondary'} />
                  <RailStat label="Intrinsic" value={Number.isFinite(intrinsic) ? money(intrinsic) : '—'} />
                  <RailStat label="Extrinsic" value={Number.isFinite(intrinsic) && q.mark > 0 ? money(Math.max(0, q.mark - intrinsic)) : '—'} />
                  <RailStat label={isPast ? 'P&L' : 'Quote'} value={isPast ? (ret.pnl != null ? pnlWord(ret.pnl) : '—') : quoteAt ? nyClock(quoteAt, { seconds: true, zone: true }) : '—'} ink={isPast && ret.pnl != null ? (ret.state === 'asof' ? 'text-textSecondary' : returnInk(ret.pnl)) : 'text-textPrimary'} tip={isPast && ret.pnl != null ? returnTip(ret) : undefined} />
                </div>

                {setup.band === 'lottery' ? (
                  <>
                    <Band>What it pays</Band>
                    <div className="px-3.5 py-2.5 grid grid-cols-3 gap-x-3 gap-y-2.5">
                      <RailStat label="2× inside 30s" value={basis > 0 ? money(basis * 2) : '—'} ink="text-bull" />
                      <RailStat label="3× inside 120s" value={basis > 0 ? money(basis * 3) : '—'} ink="text-bull" />
                      <RailStat label="Breakeven" value={Number.isFinite(breakeven) ? money(breakeven) : '—'} ink="text-warn" />
                    </div>
                    <p className="px-3.5 pb-3 text-t12 text-textSecondary">No stop. A bid of 0 is held. Flat at 15:50 ET on the bid.</p>
                  </>
                ) : setup.band === 'closest' ? (
                  <div className="px-3.5 py-3 border-t border-borderSubtle/60">
                    <RailStat label="Stop if you take it" value={line > 0 ? money(line * STOP_KEEP) : '—'} ink="text-bear" />
                    <p className="mt-2 text-t12 text-textSecondary">Not a call. It did not clear the line, or the seat was taken. The ask, the stop at 0.4678 × that ask, and the captured percent are the same numbers a call uses. You decide.</p>
                  </div>
                ) : ticket ? (
                  <>
                    <Band>{runner ? 'The ratchet' : 'What it pays'}</Band>
                    <div className="px-3.5 py-2.5 grid grid-cols-4 gap-x-3 gap-y-2.5">
                      {runner ? (
                        <>
                          <RailStat label="At 1.25×" value={basis > 0 ? `stop ${money(basis)}` : '—'} />
                          <RailStat label="At 1.50×" value={basis > 0 ? `stop ${money(basis * 1.25)}` : '—'} />
                          <RailStat label="At 2×" value={basis > 0 ? `stop ${money(basis * 1.5)}` : '—'} />
                          <RailStat label="At 3×" value={basis > 0 ? `stop ${money(basis * 2.25)}` : '—'} />
                        </>
                      ) : (
                        <RailStat label="Sell" value={basis > 0 ? `${money(basis * 1.5)} · +50%` : '—'} ink="text-bull" />
                      )}
                    </div>
                    <div className="px-3.5 pb-2.5">
                      <RailStat label="Breakeven at expiry" value={Number.isFinite(breakeven) ? `${cashName === setup.ticker ? setup.ticker : cashName} ${money(breakeven)}` : '—'} ink="text-warn" />
                    </div>
                    <Band>What kills it</Band>
                    <div className="px-3.5 py-2.5">
                      <RailStat label={liveStop && liveStop.name !== 'Stop' ? `Stop · ${liveStop.name}` : 'Stop'} value={liveStop ? money(liveStop.stop) : shownStop > 0 ? money(shownStop) : 'After the fill'} ink="text-bear" />
                      <p className="mt-2 text-t12 text-textSecondary">
                        {runner
                          ? 'Stop starts at 0.4678 × the entry ask and never moves down. It lifts to the entry at 1.25×, then 1.25× at +50%, 1.50× at +100%, 2.25× at +200%, and 0.75 × the peak after 4×. A 0.40% reversal over 5 minutes sells the bid. Flat at 15:55 ET.'
                          : 'Stop starts at 0.4678 × the entry ask and never moves down. It sells at 1.50 × the ask. A 0.40% reversal over 5 minutes sells the bid. Flat at 15:55 ET.'}
                      </p>
                    </div>
                  </>
                ) : (
                  <p className="px-3.5 py-3 text-t12 text-textSecondary border-t border-borderSubtle/60">{setup.whyText || 'Not a ticket. No entry, no stop, no captured percent.'}</p>
                )}
              </div>
            )}

            {cardTab === 'contract' && (
              <div className="border-t border-borderSubtle/60 p-3 flex flex-col gap-4" data-setup-contract>
                <div>
                  <div className="font-mono text-t9 uppercase tracking-widest text-textMuted mb-1.5">Greeks{isPast ? ' · at the call' : ''}</div>
                  <GreeksRow delta={gDelta} gamma={gGamma} theta={gTheta} iv={ivPct} flash={!isPast} />
                </div>
                <div>
                  <div className="font-mono text-t9 uppercase tracking-widest text-textMuted mb-1.5">In dollars</div>
                  <ContractFacts ticker={cashName} right={setup.right} strike={setup.strike} entry={line} bid={q.bid} ask={q.ask} spot={spotPx} delta={gDelta} theta={gTheta} />
                </div>
              </div>
            )}

            <div className="mt-auto px-3.5 h-7 shrink-0 flex items-center gap-x-3 border-t border-borderSubtle/60 font-mono text-t10 text-textMuted overflow-x-auto whitespace-nowrap" data-greeks-line>
              <span>Delta <span className={`tnum ${gDelta >= 0 ? 'text-bull' : 'text-bear'}`}>{Number.isFinite(gDelta) ? gDelta.toFixed(2) : '—'}</span></span>
              <span>Theta <span className="tnum text-warn">{Number.isFinite(gTheta) ? dayDollars(gTheta) : '—'}</span></span>
              <span>IV <span className="tnum text-textPrimary">{greekOk ? `${ivPct.toFixed(0)}%` : '—'}</span></span>
              <span>Gamma <span className="tnum text-textSecondary">{Number.isFinite(gGamma) ? gGamma.toFixed(4) : '—'}</span></span>
              <span>Vega <span className="tnum text-textSecondary">{Number.isFinite(gVega) ? gVega.toFixed(3) : '—'}</span></span>
              <span>Rho <span className="tnum text-textSecondary">{Number.isFinite(gRho) ? gRho.toFixed(3) : '—'}</span></span>
              <span>Vanna <span className="tnum text-textSecondary">{Number.isFinite(higher.vanna) ? higher.vanna.toFixed(3) : '—'}</span></span>
              <span>Charm <span className="tnum text-textSecondary">{Number.isFinite(higher.charm) ? higher.charm.toFixed(3) : '—'}</span></span>
              <span>Vomma <span className="tnum text-textSecondary">{!isPast && Number.isFinite(setup.vomma ?? NaN) ? (setup.vomma as number).toFixed(3) : '—'}</span></span>
              <span>Veta <span className="tnum text-textSecondary">{!isPast && Number.isFinite(setup.veta ?? NaN) ? ((setup.veta as number) / 365).toFixed(3) : '—'}</span></span>
              <span>Speed <span className="tnum text-textSecondary">{!isPast && Number.isFinite(setup.speed ?? NaN) ? (setup.speed as number).toFixed(4) : '—'}</span></span>
              <span>Zomma <span className="tnum text-textSecondary">{!isPast && Number.isFinite(setup.zomma ?? NaN) ? (setup.zomma as number).toFixed(4) : '—'}</span></span>
              <span>Color <span className="tnum text-textSecondary">{!isPast && Number.isFinite(setup.color ?? NaN) ? ((setup.color as number) / 365).toFixed(4) : '—'}</span></span>
              <span>Ultima <span className="tnum text-textSecondary">{!isPast && Number.isFinite(setup.ultima ?? NaN) ? (setup.ultima as number).toFixed(4) : '—'}</span></span>
              <span className="ml-auto">{isPast ? 'At the call' : setup.expiry === '0DTE' ? '' : tape.word}</span>
            </div>
            <div className="border-t border-borderSubtle p-2 flex items-stretch gap-2" data-setup-action={verdict.word}>
              {/* Track on every contract, a past call's too ("Keep the close"): a bookmark, not a ticket */}
              <div className="flex-1 min-w-0 flex h-8 rounded-md overflow-hidden" data-setup-track={tracked ? 'on' : 'off'}>
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
                    toTracker();
                  }}
                  className="relative foil-glide flex-1 min-w-0 inline-flex items-center justify-center gap-2 px-2 holo-bg text-onfoil hover:brightness-105 font-mono text-t11 font-semibold uppercase tracking-wider whitespace-nowrap"
                  data-setup-track-word={tracked ? (expired ? 'kept' : 'tracking') : expired ? 'keep' : 'track'}
                >
                  <Bookmark className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{trackNo ?? (tracked ? (expired ? 'Kept' : 'Tracking') : expired ? 'Keep the close' : 'Track')}</span>
                </button>
                <Tip label="Open in Tracker">
                  <button
                    type="button"
                    disabled={!tracked}
                    onClick={() => tracked && toTracker()}
                    className={`relative foil-glide w-9 shrink-0 inline-flex items-center justify-center border-l border-black/25 holo-bg text-onfoil ${tracked ? 'hover:brightness-105' : 'opacity-40'}`}
                    aria-label="Open in Tracker"
                    data-setup-track="open"
                  >
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                </Tip>
              </div>
              {/* a call that has left, or a past one, keeps its line on the blotter beside it */}
              {(closed || isPast) && (
                <button
                  type="button"
                  onClick={() => navigate('/compass/blotter')}
                  className={`shrink-0 h-8 px-3 inline-flex items-center justify-center gap-1.5 rounded-md border border-borderSubtle hover:border-borderMuted font-mono text-t10 font-semibold uppercase tracking-wider whitespace-nowrap transition-colors ${closed?.result === 'win' ? 'text-bull' : closed?.result === 'loss' ? 'text-bear' : 'text-textPrimary'}`}
                  data-setup-blotter={closed?.result ?? 'record'}
                >
                  {closed?.result === 'unavailable' ? 'Unavailable' : closed?.result === 'win' ? 'Win' : closed?.result === 'loss' ? 'Loss' : 'On the record'}
                  <span className="text-textSecondary">· Blotter</span>
                  <ArrowUpRight className="w-3 h-3 text-textSecondary" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* THE STRIKES' FLOW — under the chart and the card: the session's prints on the strikes round this one */}
      {!isPast && <ContractFlow ticker={setup.ticker} strike={setup.strike} right={setup.right} expiryDate={setup.expiryDate} step={atmStep} session={desk} allSessions={setup.expiry === '0DTE'} />}

      {/* THE CONTRACTS AROUND IT — the live book on the same expiration; a row opens that contract */}
      {!isPast && around.length > 0 && (
        <SetupDrivers
          ticker={setup.ticker}
          rows={around}
          onOpen={onOpenContract ? (strike, right) => onOpenContract(strike, right, setup.sleeve) : undefined}
          sub={`on ${setup.ticker} · ${dayStamp(setup.expiryDate)} · four strikes either side of the money · the quote's own checks, not the model · a row opens that contract`}
        />
      )}
    </div>
  );
};

export default CampaignAnalysis;
