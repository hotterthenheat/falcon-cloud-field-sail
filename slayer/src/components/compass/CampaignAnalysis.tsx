/* A Compass contract's own page: the live chart with the entry, the stop and the exits on it, the quote and its
   greeks, and the call's state as Compass reads it. States, never orders. */

import { useCallback, useMemo, useRef, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import { type Timeframe } from '../../data/timeframe';
import RichRead from '../ui/RichRead';
import CompanyLogo from '../ui/CompanyLogo';
import ContractTrack from './ContractTrack';
import { choiceRight } from '../../data/compass';
import { activeStop, signalOf, useSignals } from '../../data/compassLedger';
import { useContractBars, useContractLive, useSecondGreek, useThetaBook } from '../../data/thetaBook';
import { useOptionTape } from '../../data/tapeFeed';
import { usePinpointFeed } from '../../data/uwBook';
import { drawnLevels, levelsFor } from '../../data/levelsFor';
import { levelsForName } from '../../data/levelsScope';
import { peekChange } from '../../data/book/day';
import { leftOf } from '../../data/compassModel';
import { entryGate, quoteContract, quoteMissing, quoteStale } from '../../data/contractQuote';
import { MODEL_WORD, RIDING_WORD, SPREAD_MAX, STOP_KEEP, quoteTradable, spreadPass, weekdayDte } from '../../data/compassParams';
import { BLOCK_MIN_PREMIUM, BLOCK_MIN_SIZE } from '../../data/tape';
import type { FlowPrint } from '../../types/trace';
import { nameTape, optionScanOpen, sessionYmd } from '../../data/compassSession';
import { nyClock } from '../../core/nyTime';
import { type ConPickRow } from './ContractPick';
import { useIsPhone } from '../ui/useMediaQuery';
import { useTracker } from '../../context/TrackerContext';
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
const Fact = ({ k, v, ink = 'text-textPrimary', tight = false }: { k: string; v: string; ink?: string; tight?: boolean }) => (
  tight ? (
    <div className="min-w-0 px-2.5 py-0.5 border-b border-r border-borderSubtle/40 overflow-hidden">
      <div className="font-mono text-t11 uppercase tracking-wider text-textMuted truncate">{k}</div>
      <div className={`font-mono text-t12 tnum truncate ${ink}`}>{v}</div>
    </div>
  ) : (
  <li className="h-6 px-3.5 flex items-center gap-3 border-b border-borderSubtle/40 min-w-0 overflow-hidden">
    <span className="w-28 shrink-0 font-mono text-t12 text-textMuted truncate">{k}</span>
    <span className={`min-w-0 truncate font-mono text-t12 tnum ${ink}`}>{v}</span>
  </li>
  )
);

interface BookLevel { px: number; sz: number }

/** A live book. Four deep on each side, rebuilt off the quote that is running. */
const BookLadder = ({ bid, ask, bids, asks, compact = false }: { bid: number; ask: number; bids: BookLevel[]; asks: BookLevel[]; compact?: boolean }) => {
  const max = Math.max(1, ...bids.map(r => r.sz), ...asks.map(r => r.sz));
  const px = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const spread = ask > bid ? ask - bid : 0;
  const spreadPct = ask > 0 && spread > 0 ? (spread / ask) * 100 : 0;
  const row = (r: BookLevel, kind: 'bid' | 'ask', inside: boolean) => (
    <div key={`${kind}${r.px}`} className={`relative grid h-6 items-center px-2.5 ${kind === 'bid' ? 'grid-cols-[1fr_2.75rem]' : 'grid-cols-[2.75rem_1fr]'} ${inside ? 'bg-ink/[0.04]' : ''}`}>
      <span className={`absolute inset-y-1 ${kind === 'bid' ? 'right-1 bg-bear/15' : 'left-1 bg-bull/15'} rounded-sm`} style={{ width: `${Math.max(8, (r.sz / max) * 70)}%` }} />
      {kind === 'ask' ? <span className="relative font-mono text-t11 tnum text-textMuted">{r.sz > 0 ? r.sz.toLocaleString('en-US') : '—'}</span> : null}
      <span className={`relative font-mono text-t12 tnum ${inside ? 'text-textPrimary font-semibold' : 'text-textSecondary'} ${kind === 'bid' ? '' : 'text-right'}`}>{px(r.px)}</span>
      {kind === 'bid' ? <span className="relative text-right font-mono text-t11 tnum text-textMuted">{r.sz > 0 ? r.sz.toLocaleString('en-US') : '—'}</span> : null}
    </div>
  );
  return (
    <div className="border-b border-borderSubtle/60" data-order-book>
      {!compact && (
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3 px-3 py-2 border-b border-borderSubtle/40">
        <div>
          <div className="font-mono text-t9 uppercase tracking-wider text-textMuted">Bid</div>
          <div className="mt-0.5 font-mono text-t18 font-semibold leading-none tnum text-textPrimary">{bid > 0 ? px(bid) : '—'}</div>
        </div>
        <div className="pb-0.5 text-center">
          <div className="font-mono text-t9 uppercase tracking-wider text-textMuted">Spread</div>
          <div className="mt-0.5 font-mono text-t12 tnum text-textSecondary">{spread > 0 ? px(spread) : '—'}</div>
          <div className="font-mono text-t10 tnum text-textMuted">{spreadPct > 0 ? `${spreadPct.toFixed(1)}%` : ''}</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-t9 uppercase tracking-wider text-textMuted">Ask</div>
          <div className="mt-0.5 font-mono text-t18 font-semibold leading-none tnum text-textPrimary">{ask > 0 ? px(ask) : '—'}</div>
        </div>
      </div>
      )}
      <div className="grid grid-cols-2">
        <div>{bids.map((r, i) => row(r, 'bid', i === 0))}</div>
        <div className="border-l border-borderSubtle/60">{asks.map((r, i) => row(r, 'ask', i === 0))}</div>
      </div>
    </div>
  );
};
const HeadCell = ({ k, v, ink = 'text-textPrimary', sub, edge = true }: { k: string; v: string; ink?: string; sub?: string; edge?: boolean }) => (
  <div className={`shrink min-w-0 px-2.5 py-2 flex flex-col justify-center ${edge ? 'max-w-[5.75rem] border-l border-borderSubtle/60' : ''}`}>
    <span className="font-mono text-t9 uppercase tracking-wider text-textMuted">{k}</span>
    <span className={`font-mono text-t13 font-semibold tnum truncate ${ink}`}>{v}</span>
    {sub ? <span className="font-mono text-t10 tnum text-textMuted">{sub}</span> : null}
  </div>
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
  const { isTracked, trackSetup, untrackSetup } = useTracker();
  const record = useSignals();
  const signal = useMemo(() => signalOf(setup.id), [record, setup.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const outcome = signal?.outcome ?? null;
  const navigate = useNavigate();
  const phone = useIsPhone();
  const tracked = isTracked(setup.id);
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

  const odteBook = useThetaBook('odte');
  const weekBook = useThetaBook('weekly');
  const loadTickerCons = useCallback((): ConPickRow[] => {
    return [...odteBook.setups, ...weekBook.setups]
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
  }, [odteBook.setups, weekBook.setups, setup.ticker]);

  const breakTimeLabel = floorBreak
    ? new Date(floorBreak.time * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : '';

  const bankedLevels = useMemo(() => new Set(tpHits.map(h => h.level)), [tpHits]);
  const hitCount = bankedLevels.size;

  const [chartTf, setChartTf] = useState<Timeframe>('5m');
  const [more, setMore] = useState(false);
  const [trackNote, setTrackNote] = useState<string | null>(null);

  /* The contract's own quote, bars and prints. Nothing is filled in when a read has not landed. */
  const live = useContractLive(setup.ticker, setup.expiryDate, setup.strike, setup.right, true);
  const second = useSecondGreek(setup.ticker, setup.expiryDate, setup.strike, setup.right, true);
  const liveBars = useContractBars(setup.ticker, setup.expiryDate, setup.strike, setup.right, true, chartTf);
  const optionTape = useOptionTape(setup.ticker, true);
  const traded = liveBars ?? [];
  const bidLive = live && live.ask > 0 ? live.bid : setup.bid ?? 0;
  const askLive = live && live.ask > 0 ? live.ask : setup.ask ?? 0;
  const bids: BookLevel[] = bidLive > 0 ? [{ px: bidLive, sz: live && Number.isFinite(live.bidSize) && live.bidSize > 0 ? live.bidSize : 0 }] : [];
  const asks: BookLevel[] = askLive > 0 ? [{ px: askLive, sz: live && Number.isFinite(live.askSize) && live.askSize > 0 ? live.askSize : 0 }] : [];
  const quoteAt = live?.at || (setup.quotedAt != null && setup.quotedAt > 0 ? setup.quotedAt : 0);
  const spotPx = live && live.under > 0 ? live.under : spot > 0 ? spot : setup.spot ?? 0;
  const ivPct = live && Number.isFinite(live.iv) && live.iv > 0 ? live.iv : Number.isFinite(setup.greeks.iv) ? setup.greeks.iv : NaN;
  const q = quoteContract({
    ticker: setup.ticker,
    contract: setup.contract,
    strike: setup.strike,
    right: setup.right,
    spot: spotPx,
    bid: bidLive,
    ask: askLive,
    ivPct: Number.isFinite(ivPct) ? ivPct : 0,
    quotedAt: quoteAt,
    source: 'theta',
  });
  const gDelta = live && Number.isFinite(live.delta) ? live.delta : setup.greeks.delta;
  const sessionPrints = useMemo(() => {
    const [y, m, d] = setup.expiryDate.slice(0, 10).split('-');
    const label = m && d && y ? `${m}/${d}/${y}` : '';
    return optionTape.rows.filter(p => p.legs <= 1 && p.right === setup.right && Math.abs(p.strike - setup.strike) < 0.01 && (!p.expiry || p.expiry === label || p.expiry.slice(0, 10) === setup.expiryDate.slice(0, 10)));
  }, [optionTape.rows, setup.expiryDate, setup.right, setup.strike]);
  const barVol = traded.reduce((sum, b) => sum + (b.volume ?? 0), 0);
  const bidPx = q.bid;
  const midPx = q.mark;
  const spreadFrac = midPx > 0 ? (q.ask - q.bid) / midPx : 1;
  const ticket = setup.band === 'top' || setup.band === 'wing' || setup.band === 'lottery';
  const paidAsk = outcome?.fill?.ask ?? 0;
  const basis = paidAsk > 0 ? paidAsk : 0;
  const tape = nameTape(setup.ticker, setup.expiry === '0DTE');
  const expired = setup.expiry === '0DTE' ? tape.done : setup.sessionsLeft <= 0;
  const dayOver = tape.done;
  const missing = quoteMissing(q);
  const quoting = tape.option === 'open' || tape.option === 'overnight' || tape.option === 'pre' || tape.option === 'curb';
  const stale = quoting && quoteStale(quoteAt, Date.now(), missing);
  const spreadCap = SPREAD_MAX;
  /* a Model 3 ticket needs a valid quote; Model 1's contracts also need its trained quotes (compassParams inModel1Domain) */
  const quoteOk = !missing && !stale && (setup.band === 'lottery' ? quoteTradable(bidPx, q.ask) : spreadPass(bidPx, q.ask));
  const tapeOpen = optionScanOpen(setup.ticker, setup.expiry === '0DTE' ? 0 : 1) || (ticket && tape.option !== 'closed');
  const gate = entryGate({ sessionOpen: tapeOpen, expired, quoteOk, executionQuote: false });
  const line = basis > 0 ? basis : setup.ask > 0 ? setup.ask : 0;
  const captured = line > 0 && q.bid > 0 ? ((q.bid - line) / line) * 100 : NaN;
  const capWord = Number.isFinite(captured) ? `${captured >= 0 ? '+' : '−'}${Math.abs(captured).toFixed(1)}%` : '—';
  const dollars = line > 0 && q.bid > 0 ? (q.bid - line) * 100 : NaN;
  const dollarWord = Number.isFinite(dollars) ? `${dollars >= 0 ? '+' : '−'}$${Math.abs(dollars).toFixed(0)}` : '—';
  const shownStop = ticket && setup.band !== 'lottery' && line > 0 ? Number((line * STOP_KEEP).toFixed(2)) : 0;
  const chartQuote = line > 0 ? { ...q, entryPremium: line, stopPremium: shownStop } : q;
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
  const sessionOpenPx = 0;
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
  usePinpointFeed(null);
  /* the one gate (levelsFor drawnLevels): no wall off a stand-in book — "…" until the scope's own contracts are in */
  const drawn = drawnLevels(levelsFor(cashName, levelsForName(cashName)));
  const wall = (() => {
    const marks = [drawn.callWall, drawn.putWall].filter((n): n is number => n != null);
    if (!marks.length || !(spotPx > 0)) return null;
    const nearer = marks.reduce((a, b) => (Math.abs(a - spotPx) <= Math.abs(b - spotPx) ? a : b));
    return { price: nearer, kind: nearer === drawn.callWall ? 'call wall' : 'put wall', pts: Math.abs(nearer - spotPx) };
  })();
  const greekOk = Number.isFinite(ivPct) && ivPct > 0;
  const pts = spotPx > 0 ? (setup.right === 'C' ? spotPx - setup.strike : setup.strike - spotPx) : NaN;
  const place = !Number.isFinite(pts) ? '' : Math.abs(pts) / spotPx < 0.0015 ? 'ATM' : `${Math.abs(pts).toFixed(0)} pts ${pts > 0 ? 'ITM' : 'OTM'}`;
  const kindLabel = setup.band === 'closest' ? 'Closest' : setup.band === 'lottery' ? MODEL_WORD[3] : setup.band === 'wing' || setup.runner ? `${MODEL_WORD[1]} · ${RIDING_WORD}` : setup.band === 'top' ? MODEL_WORD[1] : '';
  const tapeOpenPx = traded && traded.length ? traded[0].open : 0;
  const todayDol = tapeOpenPx > 0 && q.bid > 0 ? (q.bid - tapeOpenPx) * 100 : NaN;
  const todayPct = tapeOpenPx > 0 && q.bid > 0 ? ((q.bid - tapeOpenPx) / tapeOpenPx) * 100 : NaN;
  const signedPct = (n: number) => (Number.isFinite(n) ? `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%` : '—');
  const signedDol = (n: number) => (Number.isFinite(n) ? `${n >= 0 ? '+' : '−'}$${Math.abs(n).toFixed(0)}` : '—');
  const inkOf = (n: number) => (!Number.isFinite(n) ? 'text-textMuted' : n >= 0 ? 'text-bull' : 'text-bear');
  const greeks = setup.greeks;
  const gDeltaN = live && Number.isFinite(live.delta) ? live.delta : greeks.delta;
  const gTheta = live && Number.isFinite(live.theta) ? live.theta : greeks.theta;
  const gVega = live && Number.isFinite(live.vega) ? live.vega : greeks.vega;
  const gRho = live && Number.isFinite(live.rho) ? live.rho : greeks.rho;
  const gWord = (n: number | undefined, digits = 2) => (n != null && Number.isFinite(n) ? n.toFixed(digits) : '—');
  const breakeven = line > 0 ? (setup.right === 'C' ? setup.strike + line : setup.strike - line) : NaN;
  const sideOf = (want: 'ASK' | 'BID') => {
    const rows = sessionPrints.filter(p => p.side === want && p.size > 0 && p.fill > 0);
    const n = rows.reduce((sum, p) => sum + p.size, 0);
    const px = n > 0 ? rows.reduce((sum, p) => sum + p.size * p.fill, 0) / n : 0;
    return { n, px, dol: px * n * 100 };
  };
  const lift = sideOf('ASK');
  const hit = sideOf('BID');
  const midRows = sessionPrints.filter(p => p.side === 'MID' && p.size > 0 && p.fill > 0);
  const midN = midRows.reduce((sum, p) => sum + p.size, 0);
  let daySide: { ask: number; bid: number; mid: number } | null = null;
  let dayVol = -1;
  for (const p of sessionPrints) {
    const s = p.daySide;
    if (!s) continue;
    const v = s.ask + s.bid + s.mid;
    if (v > dayVol) {
      dayVol = v;
      daySide = s;
    }
  }
  const barBid = daySide ? daySide.bid : hit.n;
  const barMid = daySide ? daySide.mid : midN;
  const barAsk = daySide ? daySide.ask : lift.n;
  const barAll = barBid + barMid + barAsk;
  const share = (n: number) => (barAll > 0 ? (n / barAll) * 100 : 0);
  const flow = lift.n + hit.n;
  const spreadDol = q.ask > q.bid ? (q.ask - q.bid) * 100 : 0;
  const spreadOfAsk = q.ask > 0 && q.ask > q.bid ? ((q.ask - q.bid) / q.ask) * 100 : NaN;
  const spreadOfMid = q.ask > q.bid && (q.ask + q.bid) > 0 ? ((q.ask - q.bid) / ((q.ask + q.bid) / 2)) * 100 : NaN;
  const decayDol = Number.isFinite(gTheta) ? gTheta * 100 : NaN;
  const tp1Px = line > 0 ? line * tp1Mult : 0;
  const tp1Dol = line > 0 ? (tp1Px - line) * 100 : NaN;
  const tp1Net = Number.isFinite(tp1Dol) && Number.isFinite(decayDol) ? tp1Dol + decayDol : NaN;
  const stopUnder = q.bid > 0 && shownStop > 0 ? ((q.bid - shownStop) / q.bid) * 100 : NaN;
  const tp1Over = q.bid > 0 && tp1Px > 0 ? ((tp1Px - q.bid) / q.bid) * 100 : NaN;
  const flatAt = setup.band === 'lottery' ? '15:50' : '15:55';
  const paid = line > 0 ? line * 100 : NaN;
  const worth = q.bid > 0 ? q.bid * 100 : NaN;
  const riskDol = line > 0 && shownStop > 0 ? (shownStop - line) * 100 : NaN;
  const askPct = flow > 0 ? (lift.n / flow) * 100 : NaN;
  const dayAskPct = share(barAsk);
  const printsDiffer = daySide != null && Number.isFinite(askPct) && Math.abs(dayAskPct - askPct) >= 10;
  let peak = 0;
  let trough = Infinity;
  for (const p of sessionPrints) {
    if (!(p.size > 0) || !(p.fill > 0)) continue;
    if (p.fill > peak) peak = p.fill;
    if (p.fill < trough) trough = p.fill;
  }
  const hasRange = peak > 0 && trough < Infinity;
  const otmPct = spotPx > 0 ? ((setup.right === 'C' ? setup.strike - spotPx : spotPx - setup.strike) / spotPx) * 100 : NaN;
  const stockChg = peekChange(setup.ticker);
  const prints = [...sessionPrints].filter(p => p.size > 0 && p.fill > 0).sort((a, b) => a.time.localeCompare(b.time));
  const nowClock = nyClock(Date.now());
  const sessionLog: { key: string; t: string; kind: string; word: string; ink: string; why: string }[] = [];
  const clockMin = (hhmm: string) => {
    const [h, m] = hhmm.slice(0, 5).split(':').map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0;
  };
  if (setup.seenAt) {
    sessionLog.push({
      key: 'called',
      t: nyClock(setup.seenAt),
      kind: 'Call',
      word: 'Called',
      ink: 'text-warn',
      why: line > 0 ? `Ask was ${money(line)}.` : 'The call fired.',
    });
  }
  for (const p of prints) {
    const bought = p.side === 'ASK';
    const sold = p.side === 'BID';
    sessionLog.push({
      key: `print-${p.vendorId || p.id}-${p.time}`,
      t: p.time.slice(0, 5),
      kind: 'Print',
      word: bought ? 'Bought' : sold ? 'Sold' : 'Mid',
      ink: bought ? 'text-bull' : sold ? 'text-bear' : 'text-textSecondary',
      why: `${Math.round(p.size).toLocaleString('en-US')} at ${money(p.fill)}.`,
    });
  }
  sessionLog.sort((a, b) => clockMin(a.t) - clockMin(b.t));
  if (q.bid > 0) {
    sessionLog.push({
      key: 'bid',
      t: nowClock,
      kind: 'Print',
      word: 'Bid',
      ink: 'text-textPrimary',
      why: `${money(q.bid)} bid${q.ask > 0 ? ` · ${money(q.ask)} ask` : ''}.`,
    });
  }
  sessionLog.push({
    key: 'flat',
    t: flatAt,
    kind: 'Exit',
    word: 'Flat',
    ink: 'text-textSecondary',
    why: 'Out on the bid.',
  });
  const bookOi = sessionPrints.find(p => p.oi > 0)?.oi ?? (live && Number.isFinite(live.oi) && live.oi > 0 ? live.oi : 0);
  const bookVol = Math.max(barVol, sessionPrints.reduce((m, p) => Math.max(m, p.volume || 0), 0));
  const volOi = bookVol > 0 && bookOi > 0 ? bookVol / bookOi : NaN;
  const onTrack = () => {
    if (tracked) {
      untrackSetup(setup.id);
      setTrackNote(null);
      return;
    }
    const ans = trackSetup(setup, scanner, { mark: midPx, stop: shownStop, ask: q.ask });
    if (ans.ok) {
      setTrackNote(null);
      return;
    }
    setTrackNote(ans.why === 'full' ? `The Tracker holds ${ans.open} this session.` : ans.why === 'name' ? `${ans.contract} already has ${setup.ticker}.` : 'The tape is shut.');
  };

  const left = leftOf(setup.id);
  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0 md:h-full md:overflow-hidden">
      {left && (
        <div className="border border-bear/30 bg-bear/[0.04] rounded-md px-4 py-3" data-setup-left={left.why}>
          <span className="block font-mono text-t12 font-bold uppercase tracking-wider text-bear">{left.why}</span>
          <p className="mt-1 text-t12 text-textPrimary">This contract left the board at {nyClock(signal?.outcome?.exit?.at ?? left.at, { zone: true })}{signal?.outcome?.exit ? `, at ${money(signal.outcome.exit.px)}` : ''}. It is off the list.</p>
        </div>
      )}
      <div className="shrink-0 border border-borderSubtle rounded-md bg-panel overflow-hidden flex items-stretch min-w-0" data-setup-head={setup.id} data-setup-state={verdict.word} data-quote-bid={q.bid} data-quote-ask={q.ask} data-quote-at={quotedAt}>
        <div className="min-w-0 flex-1 flex items-center gap-2.5 px-3.5 py-2">
          <CompanyLogo ticker={setup.ticker} size={22} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="min-w-0 truncate text-t13 font-semibold leading-tight text-textPrimary">{setup.ticker} <span className={setup.right === 'C' ? 'text-bull' : 'text-bear'}>{setup.contract}</span></h3>
              {kindLabel ? <span className="shrink-0 px-1.5 py-0.5 rounded border border-silver/40 font-mono text-t9 font-semibold uppercase tracking-wider text-textPrimary">{kindLabel}</span> : null}
            </div>
            <p className="flex items-baseline gap-1.5 min-w-0 text-t11 text-textMuted">
              {spotPx > 0 ? (
                <span className="shrink-0 font-mono tnum text-textSecondary">
                  {money(spotPx)}
                  {stockChg != null && Number.isFinite(stockChg) ? ` ${stockChg >= 0 ? '+' : '−'}${Math.abs(stockChg).toFixed(2)}%` : ''}
                </span>
              ) : null}
              <span className="truncate">{verdict.why}</span>
            </p>
          </div>
        </div>
        <HeadCell k="Bid" v={q.bid > 0 ? money(q.bid) : '—'} />
        <HeadCell k="Ask" v={q.ask > 0 ? money(q.ask) : '—'} />
        <HeadCell k="Up" v={dollarWord} sub={capWord} ink={!Number.isFinite(dollars) ? 'text-textMuted' : dollars >= 0 ? 'text-bull' : 'text-bear'} />
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

      <div
        className="grid gap-3 flex-1 min-h-0"
        style={phone ? undefined : { gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 0.85fr)' }}
      >
        <div className="min-w-0 min-h-0 h-full" data-theme="dark">
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
            volume={bookVol}
            emptyNote={liveBars == null ? 'Reading this contract' : ''}
            pathNote=""
          />
        </div>
        <div className="min-w-0 min-h-0 md:h-full overflow-x-hidden md:overflow-y-auto rounded-md border border-borderSubtle bg-panel flex flex-col" data-setup-card>
          <div className="shrink-0 px-3 py-2 flex items-center gap-2 border-b border-borderSubtle/60 min-w-0">
            <button type="button" onClick={onTrack} className="h-8 px-3 inline-flex items-center justify-center rounded-md border border-borderSubtle text-textPrimary font-mono text-t11 font-semibold uppercase tracking-wider shrink-0" data-setup-track={tracked ? 'on' : 'off'}>{tracked ? 'Tracking' : 'Track'}</button>
            <Link to="/compass/tracker" className="h-8 px-3 inline-flex items-center justify-center rounded-md bg-ink/[0.06] text-textPrimary font-mono text-t11 font-semibold uppercase tracking-wider shrink-0" data-setup-tracker>Tracker</Link>
            {closed ? <button type="button" onClick={() => navigate('/compass/blotter')} className="h-8 px-3 inline-flex items-center rounded-md border border-borderSubtle text-textSecondary font-mono text-t11 shrink-0" data-setup-blotter>Blotter</button> : null}
            <span className="min-w-0 truncate font-mono text-t11 text-textMuted">{trackNote || (!ticket && setup.whyText) || (checkFail && !tracked ? checkFail : '')}</span>
          </div>
          <div className="grid grid-cols-2 divide-x divide-borderSubtle/60 border-b border-borderSubtle/60 shrink-0">
            <div className="px-3 py-1.5 min-w-0">
              <span className="font-mono text-t11 uppercase tracking-wider text-textMuted">Today</span>
              <span className={`mt-0.5 block font-mono text-t16 font-semibold leading-none tnum truncate ${inkOf(todayPct)}`}>{signedPct(todayPct)}</span>
              <span className={`mt-1 block font-mono text-t11 tnum truncate ${inkOf(todayDol)}`}>{signedDol(todayDol)} <span className="text-textMuted">from the open</span></span>
            </div>
            <div className="px-3 py-1.5 min-w-0">
              <span className="font-mono text-t11 uppercase tracking-wider text-textMuted">From the call</span>
              <span className={`mt-0.5 block font-mono text-t16 font-semibold leading-none tnum truncate ${inkOf(captured)}`}>{signedPct(captured)}</span>
              <span className={`mt-1 block font-mono text-t11 tnum truncate ${inkOf(dollars)}`}>{signedDol(dollars)} <span className="text-textMuted">on the bid</span></span>
            </div>
          </div>
          <div className="grid grid-cols-3 divide-x divide-borderSubtle/60 border-b border-borderSubtle/60 shrink-0">
            <div className="px-3 py-1.5 min-w-0">
              <span className="font-mono text-t11 uppercase tracking-wider text-textMuted">Spread cost</span>
              <span className="mt-0.5 block font-mono text-t13 font-semibold leading-none tnum text-bear truncate">{spreadDol > 0 ? `−$${Math.round(spreadDol)}` : '—'}</span>
              <span className="mt-0.5 block font-mono text-t11 text-textMuted truncate">{Number.isFinite(spreadOfMid) ? `${spreadOfMid.toFixed(1)}% of the mid` : '—'}</span>
            </div>
            <div className="px-3 py-1.5 min-w-0">
              <span className="font-mono text-t11 uppercase tracking-wider text-textMuted">Est. decay</span>
              <span className={`mt-0.5 block font-mono text-t13 font-semibold leading-none tnum truncate ${inkOf(decayDol)}`}>{Number.isFinite(decayDol) ? signedDol(decayDol) : '—'}</span>
              <span className="mt-0.5 block font-mono text-t11 text-textMuted truncate">One contract, this day</span>
            </div>
            <div className="px-3 py-1.5 min-w-0">
              <span className="font-mono text-t11 uppercase tracking-wider text-textMuted">TP1 profit</span>
              <span className={`mt-0.5 block font-mono text-t13 font-semibold leading-none tnum truncate ${inkOf(tp1Dol)}`}>{Number.isFinite(tp1Dol) ? signedDol(tp1Dol) : '—'}</span>
              <span className={`mt-0.5 block font-mono text-t11 tnum truncate ${inkOf(tp1Net)}`}>{Number.isFinite(tp1Net) ? `${signedDol(tp1Net)} after decay` : '—'}</span>
            </div>
          </div>
          <p className="px-3 py-1 border-b border-borderSubtle/60 shrink-0 text-t11 leading-snug text-textSecondary truncate">
            You pay the ask. You leave on the bid. The spread is not returned.
            {Number.isFinite(stopUnder) ? ` Stop is ${stopUnder.toFixed(0)}% under the bid.` : ''}
            {Number.isFinite(tp1Over) ? ` TP1 is ${tp1Over.toFixed(0)}% above it.` : ''}
            {` Flat at ${flatAt}.`}
          </p>
          <div className="grid grid-cols-3 shrink-0 border-b border-borderSubtle/60">
            <Fact tight k="Bid" v={q.bid > 0 ? money(q.bid) : '—'} />
            <Fact tight k="Ask" v={q.ask > 0 ? money(q.ask) : '—'} />
            <Fact tight k="Entry" v={line > 0 ? money(line) : '—'} />
            <Fact tight k="Stop" v={shownStop > 0 ? money(shownStop) : '—'} ink="text-bear" />
            <Fact tight k="P&L" v={Number.isFinite(dollars) ? `${signedDol(dollars)}` : '—'} ink={inkOf(dollars)} />
            <Fact tight k="Risk" v={Number.isFinite(riskDol) ? signedDol(riskDol) : '—'} ink="text-bear" />
          </div>
          <div className="grid grid-cols-3 shrink-0 border-b border-borderSubtle/60">
            <Fact tight k="Delta" v={gWord(gDeltaN)} />
            <Fact tight k="Theta" v={gWord(gTheta)} />
            <Fact tight k="IV" v={greekOk ? `${ivPct.toFixed(1)}%` : '—'} />
            <Fact tight k="Vega" v={gWord(gVega)} />
            <Fact tight k="Gamma" v={gWord(second && Number.isFinite(second.gamma) ? second.gamma : greeks.gamma, 3)} />
            <Fact tight k="Spread" v={Number.isFinite(spreadOfMid) ? `${spreadOfMid.toFixed(1)}%` : '—'} />
          </div>
          {q.bid > 0 && q.ask >= q.bid ? (
            <BookLadder bid={q.bid} ask={q.ask} bids={bids} asks={asks} compact />
          ) : (
            <p className="h-8 px-3 flex items-center border-b border-borderSubtle/40 font-mono text-t11 text-textMuted shrink-0">No bid.</p>
          )}
          <p className="px-3 py-1.5 shrink-0 font-mono text-t11 text-textPrimary border-b border-borderSubtle/60 truncate">
            {barAll > 0
              ? `${daySide ? 'The day' : 'These prints'}: ${dayAskPct.toFixed(0)}% paid the ask.${printsDiffer ? ` These prints: ${askPct.toFixed(0)}%.` : ''}`
              : optionTape.ready ? 'No prints yet.' : 'Reading the tape.'}
            {hasRange ? ` High ${money(peak)}. Low ${money(trough)}.` : ''}
          </p>
          <button type="button" onClick={() => setMore(v => !v)} className="h-8 px-3 flex items-center border-b border-borderSubtle/60 font-mono text-t11 uppercase tracking-wider text-textMuted shrink-0" data-contract-more={more ? 'open' : 'closed'}>{more ? 'Less' : 'Prints, the session, and the rest'}</button>
          {more ? (
            <div className="min-h-0 md:flex-1 md:overflow-y-auto">
              <div className="px-3 py-1.5 border-b border-borderSubtle/60">
                <div className="flex items-baseline justify-between gap-3 font-mono text-t11 tnum min-w-0">
                  <span className="text-bull truncate">Bought {lift.n > 0 ? lift.n.toLocaleString('en-US') : '—'}{lift.n > 0 ? ` ${money(lift.px)} avg` : ''}</span>
                  <span className="text-bear text-right truncate">Sold {hit.n > 0 ? hit.n.toLocaleString('en-US') : '—'}{hit.n > 0 ? ` ${money(hit.px)} avg` : ''}</span>
                </div>
                {(bookVol > 0 || bookOi > 0 || Number.isFinite(otmPct)) ? (
                  <p className="mt-0.5 font-mono text-t11 tnum text-textMuted truncate">
                    {bookVol > 0 ? `Vol ${Math.round(bookVol).toLocaleString('en-US')}` : ''}
                    {bookOi > 0 ? `${bookVol > 0 ? ' · ' : ''}OI ${Math.round(bookOi).toLocaleString('en-US')}` : ''}
                    {Number.isFinite(volOi) ? ` · Vol/OI ${volOi.toFixed(2)}` : ''}
                    {Number.isFinite(otmPct) ? ` · ${Math.abs(otmPct).toFixed(1)}% ${otmPct >= 0 ? 'OTM' : 'ITM'}` : ''}
                  </p>
                ) : null}
              </div>
              <ul className="border-b border-borderSubtle/60">
                {prints.map((p, i) => (
                  <li key={`${p.id}-${i}`} className="h-6 px-3 flex items-center gap-3 font-mono text-t11 tnum min-w-0 overflow-hidden">
                    <span className="w-12 shrink-0 text-textMuted">{p.time}</span>
                    <span className={`w-14 shrink-0 ${p.side === 'ASK' ? 'text-bull' : p.side === 'BID' ? 'text-bear' : 'text-textMuted'}`}>{p.side === 'ASK' ? 'Bought' : p.side === 'BID' ? 'Sold' : 'Mid'}</span>
                    <span className="w-10 shrink-0 text-textPrimary">{Math.round(p.size)}</span>
                    <span className="shrink-0 text-textPrimary">{money(p.fill)}</span>
                    <span className="ml-auto text-textSecondary truncate">{money(p.fill * p.size * 100, 0)}</span>
                  </li>
                ))}
              </ul>
              <ul>
                <Fact k="Bid size" v={bids[0] && bids[0].sz > 0 ? Math.round(bids[0].sz).toLocaleString('en-US') : '—'} />
                <Fact k="Ask size" v={asks[0] && asks[0].sz > 0 ? Math.round(asks[0].sz).toLocaleString('en-US') : '—'} />
                <Fact k="Volume" v={bookVol > 0 ? Math.round(bookVol).toLocaleString('en-US') : '—'} />
                <Fact k="Open interest" v={bookOi > 0 ? Math.round(bookOi).toLocaleString('en-US') : '—'} />
                <Fact k="Rho" v={gWord(gRho)} />
                <Fact k="From spot" v={place || '—'} />
                <Fact k="From the wall" v={wall ? `${wall.pts.toFixed(0)} pts · ${wall.kind}` : drawn.wallsIn ? '—' : '…'} />
                <Fact k="Called" v={setup.seenAt ? nyClock(setup.seenAt, { zone: true }) : '—'} />
                <Fact k="Expires" v={dayStamp(setup.expiryDate)} />
                <Fact k="Breakeven" v={Number.isFinite(breakeven) ? money(breakeven) : '—'} />
                <Fact k="Premium paid" v={Number.isFinite(paid) ? money(paid, 0) : '—'} />
                <Fact k="Current value" v={Number.isFinite(worth) ? money(worth, 0) : '—'} />
              </ul>
              <div className="px-3 h-7 flex items-center border-y border-borderSubtle/60 paper-band">
                <span className="font-mono text-t11 uppercase tracking-widest text-textPrimary">The session</span>
              </div>
              <ol>
                {sessionLog.map(a => (
                  <li key={a.key} className="h-8 px-3 flex items-center gap-3 border-b border-borderSubtle/40 min-w-0 overflow-hidden">
                    <span className="w-14 shrink-0 font-mono text-t11 tnum text-textMuted">{a.t}</span>
                    <span className="w-14 shrink-0 font-mono text-t11 text-textMuted">{a.kind}</span>
                    <span className={`w-16 shrink-0 truncate font-mono text-t12 ${a.ink}`}>{a.word}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-t11 text-textSecondary">{a.why}</span>
                  </li>
                ))}
              </ol>
              <p className="px-3 h-7 flex items-center font-mono text-t11 text-textMuted">One contract. Paper. Nothing is sent.</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default CampaignAnalysis;
