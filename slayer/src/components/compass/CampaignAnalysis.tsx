/*
==================================================
  SLAYER TERMINAL - CAMPAIGN ANALYSIS (Compass)
  Full analysis for the slow scanners: the campaign
  on a live chart. TP1–TP4 underlying milestones and
  the calculated floor are drawn on the candles
  (TradingView's lightweight-charts — the house
  engine), with the premium ladder, thesis and floor
  rule alongside. States, never orders.
==================================================
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowUpRight, Bookmark, Check, Info, ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { tfMinutes, type Timeframe } from '../../data/timeframe';
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
import { activeStop, bookLine, closeOf, lockFill, notePeak, noteRung, peakBefore, remember, rungsOf, stampClose, useCompassBook, flatNow } from '../../data/compassLedger';
import { liveSetup, liveSetups, liveSpark, useContractBars, useSecondGreek } from '../../data/thetaBook';
import { leftOf, noteLeft, passedOver } from '../../data/compassModel';
import { entryGate, formatAge, quoteContract, quoteMissing, quoteStale, spreadOk, maxSpread } from '../../data/contractQuote';
import { BLOCK_MIN_PREMIUM, BLOCK_MIN_SIZE } from '../../data/tape';
import { useShelfPrints } from '../../data/traceLive';
import type { FlowPrint } from '../../types/trace';
import { useScanClock } from '../../data/compassDoor';
import { nameTape, printInSession, sessionEmpty } from '../../data/compassSession';
import { useDeskSession } from '../../data/deskSession';
import { nyClock } from '../../core/nyTime';
import ContractPick, { type ConPickRow } from './ContractPick';
import { useTracker } from '../../context/TrackerContext';
import {
  SCANNERS,
  SLEEVES,
  isScannerEligible,
  type OptionRight,
  type ScannerKey,
  type Setup,
  type SleeveKey,
} from '../../types/compass';

/** Dollars with a thousands separator. $5651.67 is not a price anyone can read. */
const money = (n: number, digits = 2) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

const SPOT_NAME: Record<string, string> = { SPX: 'SPX', SPXW: 'SPX', XSP: 'SPX', RUT: 'RUT', RUTW: 'RUT', VIX: 'VIX' };

/** Theta is per share. One contract is a hundred shares. */
const dayDollars = (perShare: number) => {
  const n = Math.round(Math.abs(perShare) * 100);
  return `${perShare < 0 ? '−' : ''}$${n.toLocaleString('en-US')}`;
};

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

function candlesOf(prints: FlowPrint[], minutes: number): { time: number; open: number; high: number; low: number; close: number }[] {
  const usable = prints.filter(p => p.fill > 0 && (p.epochMs ?? 0) > 0).sort((a, b) => (a.epochMs ?? 0) - (b.epochMs ?? 0));
  if (!usable.length) return [];
  if (minutes >= 1440) {
    let high = usable[0].fill;
    let low = usable[0].fill;
    for (const p of usable) {
      high = Math.max(high, p.fill);
      low = Math.min(low, p.fill);
    }
    const last = usable[usable.length - 1];
    return [{ time: Math.floor((usable[0].epochMs ?? 0) / 1000), open: usable[0].fill, high, low, close: last.fill }];
  }
  const step = Math.max(1, Math.round(minutes * 60));
  const buckets = new Map<number, { time: number; open: number; high: number; low: number; close: number }>();
  for (const p of usable) {
    const time = Math.floor((p.epochMs ?? 0) / 1000 / step) * step;
    const bar = buckets.get(time);
    if (!bar) buckets.set(time, { time, open: p.fill, high: p.fill, low: p.fill, close: p.fill });
    else {
      bar.high = Math.max(bar.high, p.fill);
      bar.low = Math.min(bar.low, p.fill);
      bar.close = p.fill;
    }
  }
  return [...buckets.values()];
}

/* The lens said out loud (Noah, 2026-08-30: cards "dont state wether
   something is a 0dte, weekly, discounted etc so they all look the same...
   'oh it says right here this is a weekly'"). */
const SLEEVE_LABEL: Record<SleeveKey, string> = { odte: '0DTE', weekly: 'Weekly', swing: 'Swing', position: 'Position', leaps: 'Long-dated' };

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Mon Oct 26" from the contract's real expiry session. */
function dayStamp(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  return `${DAY_SHORT[dt.getDay()]} ${MONTH_SHORT[m - 1]} ${d}`;
}

function QuoteAge({ at, missing }: { at: number; missing: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const stale = quoteStale(at, now, missing);
  return (
    <span data-quote-age={Math.max(0, now - at)} data-stale={stale ? 'yes' : 'no'}>
      {missing ? 'missing' : formatAge(Math.max(0, now - at))}
      {stale ? ' · stale' : ''}
    </span>
  );
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
  /** Open another contract on the same name — a driver row, or the capsule's
      pick (which may carry a different tenor). The page's route does the rest
      (pages/compass/SetupPage.tsx, 2026-09-11); the way back lives there too. */
  onOpenContract?: (strike: number, right: OptionRight, sleeve?: SleeveKey) => void;
}

/** The driver list sweeps on the scan tier — structure must not vibrate with every tick. */
const DRIVERS_SCAN_MS = 10_000;

/** The campaign's story, stamped ON the tape (Noah's sketch, 2026-08-09):
    the entry premium on the bar it was graded, and each banked TP on the
    candle that actually crossed it. */
export interface CampaignEntry {
  /** Bar time (UTC seconds) of the sweep that opened this review */
  time: number;
  /** The graded mid — frozen at open, like the provenance line */
  mid: number;
}
export interface CampaignHit {
  /** TP rung, 1-based */
  level: number;
  /** Bar time (UTC seconds) of the candle that crossed the target */
  time: number;
}
export interface CampaignBreak {
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
    <span className="font-mono text-[9px] uppercase tracking-wider text-textMuted">{label}</span>
    <span className={`font-mono text-[13px] font-semibold tnum truncate ${ink}`} title={value}>{value}</span>
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
  const { trackSetup, untrackSetup, isTracked, trackedSetups } = useTracker();
  const book = useCompassBook();
  const navigate = useNavigate();
  const tracked = isTracked(setup.id);
  const [trackNo, setTrackNo] = useState<string | null>(null);
  useEffect(() => {
    setTrackNo(null);
  }, [setup.id]);
  const clock = useScanClock();
  const desk = useDeskSession();
  const quoteSig = `${setup.id}|${spot}|${setup.bid}|${setup.ask}`;
  const stampRef = useRef({ sig: '', at: 0 });
  if (stampRef.current.sig !== quoteSig) stampRef.current = { sig: quoteSig, at: Date.now() };
  const quotedAt = stampRef.current.at;

  /* ENTRY = the bar on the tape when this review opened — and with it, THE
     WHOLE CAMPAIGN FROZEN: entry premium, price targets, premium ladder,
     floor. The engine derives targets as a percentage OF SPOT and this page
     regrades every tick, so live targets recede exactly as fast as price
     approaches them (Noah caught it: "same side magnets" — measured: spot
     +0.29 toward TP1 while TP1 fled +0.41). A campaign whose milestones move
     is unhittable by construction. Frozen at open, the same anchor as the
     provenance line: the numbers that earned the click must not silently
     become other numbers. */
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

  /* The campaign view of the setup: defining fields frozen at open, market
     reads (liveMid, score, greeks, spread) live. Every campaign surface on
     this page — chart lines, ladder, floor panel, facts, track — speaks c,
     never the regrading setup. */
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

  /* TP hits AND the floor break are read off the TAPE, not the simulator's
     rolled status flags — every event must have a candle to point at, and
     the chart, the ladder and the count must all tell one story. Judged
     against the FROZEN campaign levels (c), latched with a scan watermark
     for cheap incremental sweeps — and once the floor breaks, nothing banks
     after it: the campaign died first. */
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
    if (!st.brk && c.invalidationPrice > 0 && spot > 0) {
      const under = nameTape(setup.ticker, false).under;
      if (under === 'pre' || under === 'open' || under === 'after') {
        const through = setup.right === 'C' ? spot < c.invalidationPrice : spot > c.invalidationPrice;
        if (through) st.brk = { time: Math.floor(Date.now() / 1000), price: spot, floor: c.invalidationPrice };
      }
    }
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
  /* Retired: no rung is "working" anymore — the ladder freezes. */
  const workingLevel = retired
    ? null
    : (c.takeProfits.map((_, i) => i + 1).find(l => !bankedLevels.has(l)) ?? null);
  const ladderStatus = (i: number): 'HIT' | 'IN PROGRESS' | 'PENDING' =>
    bankedLevels.has(i + 1) ? 'HIT' : i + 1 === workingLevel ? 'IN PROGRESS' : 'PENDING';
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
    () => mine.filter(p => printInSession(p, setup.ticker, desk)),
    [mine, setup.ticker, desk],
  );
  const lastPrint = mine[0];
  const fromTheta = setup.whyChips.includes('LIVE') || liveSetup(setup.id) != null;
  const second = useSecondGreek(setup.ticker, setup.expiryDate, setup.strike, setup.right, fromTheta);
  const simQuote = quoteContract({
    ticker: setup.ticker,
    contract: setup.contract,
    strike: setup.strike,
    right: setup.right,
    spot,
    bid: setup.bid,
    ask: setup.ask > 0 ? setup.ask : setup.mid,
    ivPct: setup.greeks.iv,
    quotedAt,
    source: 'theta',
  });
  const q = fromTheta || !lastPrint || !(lastPrint.fill > 0)
    ? simQuote
    : quoteContract({
        ticker: setup.ticker,
        contract: setup.contract,
        strike: setup.strike,
        right: setup.right,
        spot,
        bid: lastPrint.bid > 0 && lastPrint.ask >= lastPrint.bid && lastPrint.ask <= lastPrint.fill * 4 && lastPrint.bid >= lastPrint.fill * 0.15 ? lastPrint.bid : lastPrint.fill,
        ask: lastPrint.bid > 0 && lastPrint.ask >= lastPrint.bid && lastPrint.ask <= lastPrint.fill * 4 && lastPrint.bid >= lastPrint.fill * 0.15 ? lastPrint.ask : lastPrint.fill,
        ivPct: lastPrint.iv > 0 ? lastPrint.iv : setup.greeks.iv,
        quotedAt: lastPrint.epochMs || quotedAt,
        source: 'tape',
      });
  const liveBars = useContractBars(setup.ticker, setup.expiryDate, setup.strike, setup.right, fromTheta, chartTf);
  const traded = useMemo(() => {
    if (fromTheta) return liveBars && liveBars.length ? liveBars : null;
    const printed = candlesOf(sessionPrints, tfMinutes(chartTf));
    return printed.length ? printed : null;
  }, [sessionPrints, chartTf, fromTheta, liveBars]);
  const pathFromStock = false;
  const askPx = q.entryPremium;
  const bidPx = q.bid;
  const midPx = q.mark;
  const spreadFrac = midPx > 0 ? (q.ask - q.bid) / midPx : 1;
  const scalp = setup.band === 'scalp';
  const wing = setup.band === 'wing';
  const tpRows = wing
    ? [{ level: 1, gain: 200, price: Number((askPx * 3).toFixed(2)) }]
    : scalp
    ? [
        { level: 1, gain: 10, price: Number((askPx * 1.1).toFixed(2)) },
        { level: 2, gain: 20, price: Number((askPx * 1.2).toFixed(2)) },
        { level: 3, gain: 30, price: Number((askPx * 1.3).toFixed(2)) },
      ]
    : [
        { level: 1, gain: 50, price: Number((askPx * 1.5).toFixed(2)) },
        { level: 2, gain: 100, price: Number((askPx * 2).toFixed(2)) },
        { level: 3, gain: 200, price: Number((askPx * 3).toFixed(2)) },
      ];
  const shownStop = wing ? Number((askPx * 0.5).toFixed(2)) : scalp ? Number((askPx * 0.85).toFixed(2)) : q.stopPremium;
  const indexRoot = setup.ticker === 'SPXW' || setup.ticker === 'SPX' || setup.ticker === 'XSP' || setup.ticker === 'RUT' || setup.ticker === 'RUTW';
  const atmStep = setup.ticker === 'VIX' ? 0.5 : indexRoot ? 5 : setup.strike >= 200 ? 1 : 0.5;
  const atm = Math.round(spot / atmStep) * atmStep;
  const strikeOff = Math.abs(Math.round((setup.strike - atm) / atmStep));
  const higher = useMemo(() => {
    if (second && Number.isFinite(second.vanna)) return { vanna: second.vanna, charm: second.charm };
    if (Number.isFinite(setup.vanna ?? NaN)) return { vanna: setup.vanna as number, charm: Number.isFinite(setup.charm ?? NaN) ? (setup.charm as number) / 252 : NaN };
    return { vanna: NaN, charm: NaN };
  }, [setup.vanna, setup.charm, second]);
  const tape = nameTape(setup.ticker, setup.expiry === '0DTE');
  const expired = setup.expiry === '0DTE' ? tape.done : setup.sessionsLeft <= 0;
  const dayOver = tape.done;
  const missing = quoteMissing(q);
  const stale = tape.option === 'open' && quoteStale(quotedAt, Date.now(), missing);
  const strikeCap = setup.expiry === '0DTE' ? 16 : 4;
  const spreadCap = maxSpread(midPx);
  const quoteOk = !missing && !stale && spreadOk(bidPx, q.ask);
  const gate = entryGate({ sessionOpen: clock.open, expired, quoteOk, executionQuote: false });
  const checkFail = !(bidPx > 0.15) ? 'Bid is at or under 0.15' : spreadFrac > spreadCap ? `Spread is over ${Math.round(spreadCap * 100)}%` : strikeOff > strikeCap ? `Strike is outside ±${strikeCap}` : missing ? 'Quote missing' : stale ? 'Quote stale' : null;
  const trackedRow = trackedSetups.find(t => t.id === setup.id);
  const fill = tracked && trackedRow ? lockFill(setup.id, trackedRow.trackedAt, quotedAt ? { bid: q.bid, ask: q.ask, at: quotedAt } : null, Date.now(), setup.ticker) : null;
  const paidNow = fill?.status === 'filled' ? fill.ask : 0;
  const priorPeak = tracked ? peakBefore(setup.id) : 0;
  const peakNow = tracked ? notePeak(setup.id, q.bid) : 0;
  if (tracked && paidNow > 0) noteRung(setup.id, wing || scalp ? 'Stop' : activeStop(paidNow, peakNow, setup.runner === true).name);
  const liveStop = paidNow > 0
    ? wing
      ? { stop: Number((paidNow * 0.5).toFixed(2)), name: 'Stop' }
      : scalp
        ? { stop: Number((paidNow * 0.85).toFixed(2)), name: 'Stop' }
        : activeStop(paidNow, priorPeak > 0 ? priorPeak : 0, setup.runner === true)
    : null;
  const stopHit = q.bid > 0 && liveStop != null && q.bid <= liveStop.stop;
  const runner = setup.runner === true;
  const tp1Mult = wing ? 3 : scalp ? 1.2 : 1.5;
  const tp1Hit = wing ? q.bid > 0 && q.bid >= askPx * 3 : !runner && q.bid > 0 && q.bid >= askPx * tp1Mult;
  const changed = !stopHit && !retired && !tp1Hit ? tapeChange(sessionPrints) : null;
  const sessionOpenPx = liveSpark(setup.ticker)[0] ?? 0;
  const choice = choiceRight(setup.right === 'C', tape.option === 'open' ? spot : 0, tape.option === 'open' ? sessionOpenPx : 0);
  const flipped = tracked && choice !== setup.right;
  const killed = stopHit || retired || tp1Hit || dayOver || flipped;
  const liveVerdict = stopHit
    ? { word: 'Stop hit', why: `Bid ${money(q.bid)} is through the ${liveStop?.name.toLowerCase() ?? 'stop'} at ${money(liveStop?.stop ?? shownStop)}. The trade is done.`, ink: 'text-bear' }
    : retired && floorBreak
      ? { word: 'Level broke', why: `${SPOT_NAME[setup.ticker] ?? setup.ticker} went through ${money(floorBreak.floor)}. The level is gone.`, ink: 'text-bear' }
      : tp1Hit
        ? { word: wing ? '3×' : 'TP1', why: `Bid ${money(q.bid)} is through ${money(askPx * tp1Mult)}. ${wing ? 'A wing sells at 3×.' : scalp ? 'A scalp sells there.' : 'A non-runner sells there.'}`, ink: 'text-bull' }
        : changed
            ? { word: changed.word, why: changed.why, ink: 'text-textPrimary' }
            : dayOver
              ? { word: "Day's over", why: tape.doneWhy, ink: 'text-bear' }
              : flipped
                ? { word: 'Take caution', why: `The book would take the ${choice === 'P' ? 'puts' : 'calls'}. Exit here, even under +25%. This is the choice, not an order. It is not a loss.`, ink: 'text-warn' }
                : checkFail
                  ? { word: 'Rejected', why: checkFail, ink: 'text-bear' }
                  : tape.option !== 'closed' && tape.option !== 'open'
                    ? { word: tape.word, why: tape.liveWhy, ink: 'text-textPrimary' }
                    : !tape.option || tape.option === 'closed'
                      ? { word: tracked ? 'Open paper' : 'Still on', why: tape.quietWhy, ink: 'text-textPrimary' }
                      : tracked
                        ? { word: 'Open paper', why: 'On the book. Paper only. Nothing is sent.', ink: 'text-textPrimary' }
                        : { word: 'Candidate', why: 'Paper only. Track it to watch it. Nothing is sent.', ink: 'text-textPrimary' };
  const booked = book.find(l => l.id === setup.id) ?? null;
  const verdict = booked
    ? booked.result === 'caution'
      ? { word: 'Take caution', why: `The book would take the ${booked.right === 'C' ? 'puts' : 'calls'}. Exit here, even under +25%. This is the choice, not an order. It is not a loss.`, ink: 'text-warn' }
      : booked.result === 'unavailable'
        ? { word: 'Unavailable', why: 'The quote one minute later was missing or invalid. No price was substituted.', ink: 'text-textSecondary' }
        : booked.result === 'win'
        ? { word: 'Win', why: `${booked.why}. Left at ${money(booked.exitPx)}. On the blotter. Paper only.`, ink: 'text-bull' }
        : { word: 'Loss', why: `${booked.why}. Left at ${money(booked.exitPx)}. On the blotter. Paper only.`, ink: 'text-bear' }
    : liveVerdict;
  const badgeTone = killed || verdict.word === 'Rejected' || verdict.word === 'Loss' ? 'bear' : verdict.word === 'Win' ? 'bull' : 'white';

  useEffect(() => {
    if (!tracked) return;
    const row = trackedSetups.find(t => t.id === setup.id);
    if (!row || bookLine(setup.id)) {
      if (bookLine(setup.id)) untrackSetup(setup.id);
      return;
    }
    const fill = lockFill(setup.id, row.trackedAt, quotedAt ? { bid: q.bid, ask: q.ask, at: quotedAt } : null, Date.now(), setup.ticker);
    if (fill.status === 'wait') return;
    if (fill.status === 'unavailable') {
      remember(stampClose({
        id: setup.id,
        ticker: setup.ticker,
        contract: setup.contract,
        right: setup.right,
        strike: setup.strike,
        paid: 0,
        exitPx: 0,
        why: 'Unavailable',
        result: 'unavailable',
        held: null,
        signalBid: row.signalBid,
        signalAsk: row.signalAsk,
        signalMid: row.signalMid,
      }));
      noteLeft(setup, 'Unavailable');
      untrackSetup(setup.id);
      return;
    }
    const paid = fill.ask;
    const call = closeOf({
      paid,
      bid: q.bid,
      peak: priorPeak,
      heldMin: Math.max(0, Math.round((Date.now() - row.trackedAt) / 60000)),
      runner: setup.runner === true,
      scalp: setup.band === 'scalp',
      wing: setup.band === 'wing',
      side: setup.right,
      choice,
      dayOver: setup.expiry === '0DTE' && dayOver,
      flat: setup.expiry === '0DTE' && flatNow(),
      levelBroke: !!(retired && floorBreak),
      rejected: !!checkFail,
    });
    if (!call) return;
    remember(stampClose({
      id: setup.id,
      ticker: setup.ticker,
      contract: setup.contract,
      right: setup.right,
      strike: setup.strike,
      paid,
      exitPx: call.exitPx,
      why: call.why,
      result: call.result,
      held: Math.max(0, Math.round((Date.now() - row.trackedAt) / 60000)),
      signalBid: row.signalBid,
      signalAsk: row.signalAsk,
      signalMid: row.signalMid,
      fillBid: fill.bid,
      fillAsk: fill.ask,
      fillMid: fill.mid,
    }));
    noteLeft(setup, call.why);
    untrackSetup(setup.id);
  }, [tracked, trackedSetups, setup.id, setup.ticker, setup.contract, setup.right, setup.strike, setup.expiry, q.bid, q.ask, quotedAt, q.entryPremium, dayOver, checkFail, choice, retired, floorBreak, untrackSetup]);

  const tenorWord =
    setup.expiry === '0DTE'
      ? tape.done
        ? `${dayStamp(setup.expiryDate)} · done`
        : tape.word
      : `${dayStamp(setup.expiryDate)} · ${Math.max(1, Math.round(setup.sessionsLeft))} ${Math.round(setup.sessionsLeft) === 1 ? 'session' : 'sessions'} left`;
  const kindLabel = SCANNERS.find(s => s.key === scanner)?.label ?? scanner;
  const [guideOpen, setGuideOpen] = useState(false);

  const left = leftOf(setup.id);
  return (
    <div className="flex flex-col gap-4">
      {left && (
        <div className="border border-bear/30 bg-bear/[0.04] rounded-md px-4 py-3" data-setup-left={left.why}>
          <span className="block font-mono text-[12px] font-bold uppercase tracking-wider text-bear">{left.why}</span>
          <p className="mt-1 text-[12px] text-textPrimary">This contract left the board at {nyClock(left.at, { seconds: true, zone: true })}. It is off the list.</p>
        </div>
      )}
      {/* THE SETUP'S HEAD — the name's page grammar (EarningsName): the logo, the
          contract in its side's ink, its state, the tenor and the kind, one line;
          the facts at the right. */}
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
              <div className="h-6 flex items-center gap-2.5">
                <h3 className={`min-w-0 truncate text-[15px] font-semibold leading-tight text-textPrimary`}>{setup.ticker} <span className={setup.right === 'C' ? 'text-bull' : 'text-bear'}>{setup.contract}</span></h3>
                <SignalBadge tone={badgeTone} dot>
                  {verdict.word}
                </SignalBadge>
                <span className="px-1.5 py-0.5 rounded border border-borderSubtle bg-ink/[0.05] font-mono text-[9px] font-semibold uppercase tracking-wider text-textPrimary whitespace-nowrap">{SLEEVE_LABEL[sleeve] ?? sleeve}</span>
                <span className="font-mono text-[9px] tracking-wider text-textMuted whitespace-nowrap">{kindLabel}</span>
                <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What the chart, the targets and the case mean" testId="setup-guide" />
              </div>
              <p className="mt-0.5 text-[11px] text-textMuted whitespace-nowrap truncate">
                {setup.right === 'C' ? 'Call' : 'Put'} · strike {money(setup.strike)} · {tenorWord}
                {setup.spot && setup.spot > 0 ? (Math.abs((setup.right === 'C' ? setup.spot - setup.strike : setup.strike - setup.spot)) / setup.spot < 0.0015 ? ' · ATM' : ` · ${Math.abs((setup.right === 'C' ? setup.spot - setup.strike : setup.strike - setup.spot)).toFixed(0)} pts ${(setup.right === 'C' ? setup.spot - setup.strike : setup.strike - setup.spot) > 0 ? 'ITM' : 'OTM'}`) : ''}
                {occOf(setup) ? ` · ${occOf(setup)}` : ''}
              </p>
              {passedOver(setup.ticker).length > 0 && (
                <p className="mt-1 text-[11px] text-textMuted truncate" title={passedOver(setup.ticker).join(' · ')}>
                  Passed over · {passedOver(setup.ticker).join(' · ')}
                </p>
              )}
              {rungsOf(setup.id).length > 0 && (
                <p className="mt-1 font-mono text-[10px] text-textMuted truncate">
                  {rungsOf(setup.id).map(rung => `${rung.name} ${nyClock(rung.at)}`).join(' · ')}
                </p>
              )}
            </div>
          </div>
          <dl className="flex flex-wrap gap-x-5 gap-y-2" data-setup-facts data-quote-at={quotedAt}>
            <Fact label="Bid" testId="bid">{money(q.bid)}</Fact>
            <Fact label="Ask" testId="premium">{money(q.ask)}</Fact>
            <Fact label="Spread" testId="liquidity">
              <span className={spreadFrac <= spreadCap ? 'text-textPrimary' : 'text-bear'}>{(spreadFrac * 100).toFixed(1)}%</span>
            </Fact>
            <Fact label="Delta" testId="delta">{setup.greeks.delta.toFixed(2)}</Fact>
            <Fact label="IV" testId="iv">{`${q.ivPct.toFixed(0)}%`}</Fact>
            <Fact label="Quote" testId="quote-age" title={quotedAt ? nyClock(quotedAt, { seconds: true, zone: true }) : ''}>
              <QuoteAge at={quotedAt} missing={missing} />
            </Fact>
            <Fact label="Quote time" testId="quote-time">{quotedAt ? nyClock(quotedAt, { seconds: true, zone: true }) : '—'}</Fact>
            <Fact label="P(TP1)" testId="p1">{setup.p1 != null ? `${(setup.p1 * 100).toFixed(1)}%` : '—'}</Fact>
            <Fact label="P(run)" testId="prun">{setup.prun != null ? `${(setup.prun * 100).toFixed(0)}%` : '—'}</Fact>
            <Fact
              label="Hold"
              testId="hold"
              title={setup.modelAgree ? 'Both models picked this contract. It is listed once. The runner hold is the better of the two, because +50% is already likely and the rest is extra.' : setup.better === 'runner' ? 'The runner model wanted this contract, and its chance of +50% was within two points of the best. One line.' : 'The entry model had the higher chance of paying +50%. One line. Out there.'}
            >
              {setup.p1 == null ? '—' : setup.runner ? 'Runner' : 'Out at +50%'}
            </Fact>
            <Fact label="Called" testId="listed" title="The scan that picked this contract. It does not move until the next scan.">{setup.seenAt ? nyClock(setup.seenAt, { seconds: true, zone: true }) : '—'}</Fact>
            <Fact label="Session" testId="session">{tape.word}</Fact>
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
            <span className="block font-mono text-[12px] font-bold uppercase tracking-wider text-bear">Floor broken — setup retired</span>
            <p className="text-[12px] text-textPrimary leading-snug">
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
            spot={spot}
            quotedAt={quotedAt}
            loadPickRows={loadTickerCons}
            onOpenContract={onOpenContract}
            part="chart"
            timeframe={chartTf}
            onTimeframe={setChartTf}
            quote={q}
            traded={traded}
            volume={sessionPrints.reduce((sum, p) => sum + p.size, 0)}
            emptyNote={traded && traded.length === 0 ? sessionEmpty(setup.ticker, desk) : ''}
            pathNote={fromTheta && (!traded || traded.length === 0) ? 'No print this session. Bid and ask are the live quote.' : pathFromStock ? 'No print on this contract. Candles are the premium off the stock.' : ''}
          />
        </div>
        <div className="min-w-0 flex flex-col gap-3">
          <div className="rounded-md border border-silver/40 bg-ink/[0.015] overflow-hidden flex flex-col shrink-0" data-setup-card>
            <div className="px-3.5 pt-3 pb-2 flex items-center gap-2 flex-wrap">
              <ContractLabel contract={setup.contract} right={setup.right} logo={setup.ticker} />
              <span className="font-mono text-[10px] text-textSecondary border border-borderSubtle rounded px-1.5 py-0.5">{setup.expiry}</span>
              <span className="ml-auto">
                <SignalBadge tone={badgeTone} dot>
                  {verdict.word}
                </SignalBadge>
              </span>
            </div>
            <p className="px-3.5 pb-2.5 text-[11px] text-textMuted truncate" title={verdict.why}>{verdict.why}</p>

            <div className="px-3.5 h-7 flex items-center border-y border-borderSubtle/60 paper-band">
              <span className="font-mono text-[9px] uppercase tracking-widest text-textPrimary">What it costs</span>
            </div>
            <div className="px-3.5 py-2.5 grid grid-cols-3 gap-x-3 gap-y-2.5">
              <RailStat label="Ask" value={money(q.entryPremium)} />
              <RailStat label="Bid" value={money(q.bid)} />
              <RailStat label="Mark" value={money(q.mark)} />
              <RailStat label="Spread" value={`${(spreadFrac * 100).toFixed(1)}% wide`} ink={spreadFrac <= spreadCap ? 'text-textPrimary' : 'text-bear'} />
              <RailStat label="Intrinsic" value={money(q.intrinsic)} />
              <RailStat label="Extrinsic" value={money(q.extrinsic)} />
            </div>

            <div className="px-3.5 h-7 flex items-center border-y border-borderSubtle/60 paper-band">
              <span className="font-mono text-[9px] uppercase tracking-widest text-textPrimary">What it pays</span>
            </div>
            <div className="px-3.5 py-2.5 grid grid-cols-4 gap-x-3 gap-y-2.5">
              <RailStat label="TP1" value={`${money(tpRows[0].price)} · +50%`} ink="text-bull" />
              <RailStat label="TP2" value={`${money(tpRows[1].price)} · +100%`} ink="text-bull" />
              <RailStat label="TP3" value={`${money(tpRows[2].price)} · +200%`} ink="text-bull" />
              <RailStat label="Breakeven" value={money(q.breakeven)} ink="text-warn" />
            </div>

            <div className="px-3.5 h-7 flex items-center border-y border-borderSubtle/60 paper-band">
              <span className="font-mono text-[9px] uppercase tracking-widest text-textPrimary">What kills it</span>
            </div>
            <div className="px-3.5 py-2.5 grid grid-cols-2 gap-x-3 gap-y-2.5">
              <RailStat label="Stop" value={liveStop ? `${liveStop.name} ${money(liveStop.stop)}` : paidNow > 0 ? `Bid ≤ ${money(shownStop)}` : 'After the next ask'} ink="text-bear" />
              <RailStat label="Level" value={setup.invalidationPrice > 0 ? money(setup.invalidationPrice) : '—'} ink="text-bear" />
            </div>
            <div className="px-3.5 h-7 flex items-center gap-x-3 border-t border-borderSubtle/60 font-mono text-[10px] text-textMuted overflow-x-auto whitespace-nowrap">
              <span>Delta <span className={`tnum ${setup.greeks.delta >= 0 ? 'text-bull' : 'text-bear'}`}>{Number.isFinite(setup.greeks.delta) ? setup.greeks.delta.toFixed(2) : '—'}</span></span>
              <span>Theta <span className="tnum text-warn">{Number.isFinite(setup.greeks.theta) ? dayDollars(setup.greeks.theta) : '—'}</span></span>
              <span>IV <span className="tnum text-textPrimary">{q.ivPct.toFixed(0)}%</span></span>
              <span>Gamma <span className="tnum text-textSecondary">{Number.isFinite(second?.gamma ?? setup.greeks.gamma) ? (second?.gamma ?? setup.greeks.gamma).toFixed(4) : '—'}</span></span>
              <span>Vega <span className="tnum text-textSecondary">{Number.isFinite(setup.greeks.vega) ? setup.greeks.vega.toFixed(3) : '—'}</span></span>
              <span>Rho <span className="tnum text-textSecondary">{Number.isFinite(setup.greeks.rho ?? NaN) ? (setup.greeks.rho as number).toFixed(3) : '—'}</span></span>
              <span>Vanna <span className="tnum text-textSecondary">{Number.isFinite(higher.vanna) ? higher.vanna.toFixed(3) : '—'}</span></span>
              <span>Charm <span className="tnum text-textSecondary">{Number.isFinite(higher.charm) ? higher.charm.toFixed(3) : '—'}</span></span>
              <span>Vomma <span className="tnum text-textSecondary">{Number.isFinite(setup.vomma ?? NaN) ? (setup.vomma as number).toFixed(3) : '—'}</span></span>
              <span>Veta <span className="tnum text-textSecondary">{Number.isFinite(setup.veta ?? NaN) ? ((setup.veta as number) / 365).toFixed(3) : '—'}</span></span>
              <span>Speed <span className="tnum text-textSecondary">{Number.isFinite(setup.speed ?? NaN) ? (setup.speed as number).toFixed(4) : '—'}</span></span>
              <span>Zomma <span className="tnum text-textSecondary">{Number.isFinite(setup.zomma ?? NaN) ? (setup.zomma as number).toFixed(4) : '—'}</span></span>
              <span>Color <span className="tnum text-textSecondary">{Number.isFinite(setup.color ?? NaN) ? ((setup.color as number) / 365).toFixed(4) : '—'}</span></span>
              <span>Ultima <span className="tnum text-textSecondary">{Number.isFinite(setup.ultima ?? NaN) ? (setup.ultima as number).toFixed(4) : '—'}</span></span>
              <span className="ml-auto">{tape.word}</span>
            </div>
            <div className="border-t border-borderSubtle p-2" data-setup-action={verdict.word}>
              {checkFail && !tracked && clock.open && !expired ? (
                <button
                  type="button"
                  disabled
                  className="w-full h-8 inline-flex items-center justify-center rounded-md border border-borderSubtle text-textMuted font-mono text-[11px] font-semibold uppercase tracking-wider cursor-not-allowed"
                  data-setup-track="blocked"
                >
                  {checkFail}
                </button>
              ) : booked ? (
                <button
                  type="button"
                  onClick={() => navigate('/compass/blotter')}
                  className="w-full h-8 inline-flex items-center justify-center rounded-md border border-borderSubtle text-textPrimary font-mono text-[11px] font-semibold uppercase tracking-wider"
                  data-setup-track="closed"
                >
                  {booked.result === 'caution' ? 'Take caution' : booked.result === 'win' ? 'Win · on the blotter' : 'Loss · on the blotter'}
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
                      setTrackNo(ans.ok ? null : ans.why === 'full' ? '5 open. Untrack one first.' : ans.why === 'closed' ? 'Scan is closed. 0DTE entries run 09:30 to 15:00 ET.' : `Already tracking ${ans.contract}.`);
                    }}
                    className="flex-1 min-w-0 inline-flex items-center justify-center gap-2 px-2 holo-bg text-[#0a0a0a] hover:brightness-105 font-mono text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap"
                  >
                    <Bookmark className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{trackNo ?? (tracked ? (expired ? 'Kept' : 'Tracking') : expired ? 'Keep the close' : 'Track')}</span>
                  </button>
                  <button
                    type="button"
                    disabled={!tracked}
                    onClick={() => tracked && navigate('/compass/tracker', { state: { focus: setup.id } })}
                    className={`w-9 shrink-0 inline-flex items-center justify-center border-l border-black/25 holo-bg text-[#0a0a0a] ${tracked ? 'hover:brightness-105' : 'opacity-40'}`}
                    title="Open in Tracker"
                    aria-label="Open in Tracker"
                    data-setup-track="open"
                  >
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
          <ContractFlow ticker={setup.ticker} strike={setup.strike} right={setup.right} expiryDate={setup.expiryDate} step={atmStep} session={desk} />
        </div>
      </div>
    </div>
  );
};

export default CampaignAnalysis;
