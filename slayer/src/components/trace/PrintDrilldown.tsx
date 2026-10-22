/*
==================================================
  SLAYER TERMINAL - PRINT DRILLDOWN
  The anatomy of one options print, in a wide
  centred overlay so the tape still frames it.

  Beyond the raw fields it does the thing only we
  can: it runs the contract through the Compass
  scale, so the drilldown does not just DESCRIBE the
  print — it grades the contract and says what the
  spread and the clock will take out of it.

  Every window is steerable: the session, the range,
  the bar interval, which overlays are drawn, and
  whether spread legs count. And every label is
  spelled out.
==================================================
*/

import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Compass, Copy, Crosshair, Scale } from 'lucide-react';
import Modal from '../ui/Modal';
import SignalBadge from '../ui/SignalBadge';
import RichRead from '../ui/RichRead';
import Fact from '../ui/Fact';
import ErrorBoundary from '../ui/ErrorBoundary';
import FilterTabs from '../ui/FilterTabs';
import Chip from '../ui/Chip';
import { sentimentOf } from '../../data/tape';
import { SESSION_MIN } from '../../data/contractflow';
import { fmtUsd } from '../../data/gex';
import { isoToDate, sessionIsoBack, sessionOnOrBefore, useContractTape, type CardDay, type ContractTape } from '../../data/contractflow';
import { indexRoot, tapeSessionIso } from '../../data/traceLive';
import { printKind } from '../../data/tape';
import { isTradingDay, isoDate } from '../../core/calendar';
import type { NetMetric } from './ContractFlowChart';
import DatePicker from '../ui/DatePicker';
import { weighContract } from '../../core/contractScore';
import { gradeOfConfidence, makeSetup, sleeveForDte } from '../../data/compass';
import GradeMeter, { GRADE_INK } from '../ui/GradeMeter';
import { peekIv, peekSpot, useBookRev } from '../../data/uwBook';
import VerdictBadge from '../compass/VerdictBadge';
import { useMarketData } from '../../context/MarketDataContext';
import type { FlowPrint, PrintSentiment } from '../../types/trace';
import type { MarketSnapshot } from '../../types/market';
import type { Tone } from '../ui/tones';
import SlayerMark from '../../brand/SlayerMark';
import Wordmark from '../../brand/Wordmark';

// recharts is heavy — it only loads when a print is actually opened
const FlowPanels = lazy(() => import('./ContractFlowChart').then(m => ({ default: m.FlowPanel })));
const NetPanels = lazy(() => import('./ContractFlowChart').then(m => ({ default: m.NetPanel })));

const SENT_TONE: Record<PrintSentiment, Tone> = { BULLISH: 'bull', BEARISH: 'bear', NEUTRAL: 'neutral' };
/* The STATE comes from makeSetup — the board's engine (2026-08-30 ruling,
   see contractScore.ts) — so this strip and Compass can never disagree.
   weighContract stays for the QUALITY facts (spread + theta friction). */

const TABLE_TABS = [
  { value: 'orders', label: 'Flow orders' },
  { value: 'history', label: 'Volume & open interest' },
] as const;
type TableTab = (typeof TABLE_TABS)[number]['value'];

/* The drilldown reads whatever the feed hands it. A field that is missing must
   render as a dash — never throw and take the page down with it. */
const num = (v: number | undefined | null): string => (Number.isFinite(v as number) ? (v as number).toLocaleString() : '—');
const fixed = (v: number | undefined | null, dp = 2): string => (Number.isFinite(v as number) ? (v as number).toFixed(dp) : '—');
const usd = (v: number | undefined | null): string => (Number.isFinite(v as number) ? fmtUsd(v as number) : '—');

/** One small labelled figure inside a hero zone. */

const INTERVALS = [1, 5, 15, 30];

/* The engine answers its own question. STATES, not adjectives left to the
   reader: UNUSUAL / BUSY / ORDINARY, judged against the contract's own
   median session — a lotto name that always churns should NOT light up. */
type TapeState = 'UNUSUAL' | 'BUSY' | 'ORDINARY';
const TAPE_TONE: Record<TapeState, Tone> = { UNUSUAL: 'warn', BUSY: 'neutral', ORDINARY: 'neutral' };

function tapeVerdict(rows: CardDay[], dateIso: string): { state: TapeState; read: string; volX: number } | null {
  const i = rows.findIndex(r => r.iso === dateIso);
  if (i < 0) return null;
  const today = rows[i];
  /* its last five sessions — a month back the contract was another animal (far from the money, far from expiry) */
  const past = rows.slice(i + 1, i + 6).filter(r => r.vol > 0);
  if (past.length < 3) return null;
  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] ?? 0;
  };
  const volX = today.vol / Math.max(1, med(past.map(p => p.vol)));
  const sweptTypical = med(past.map(p => p.sweepPct));
  const sweptDelta = today.sweepPct - sweptTypical;
  const state: TapeState = volX >= 2.5 || sweptDelta >= 25 ? 'UNUSUAL' : volX >= 1.4 ? 'BUSY' : 'ORDINARY';
  const oi = today.oiChange == null ? '' : ` · open interest ${today.oiChange >= 0 ? '+' : '−'}${Math.abs(today.oiChange).toLocaleString('en-US')} on the session before`;
  const bits = `${volX.toFixed(1)}× its median volume over the ${past.length} sessions before · swept ${Math.round(today.sweepPct)}% vs ${Math.round(sweptTypical)}% typical${oi}`;
  const read =
    state === 'UNUSUAL'
      ? `${bits} — this is not how it normally trades.`
      : state === 'BUSY'
        ? `${bits} — busier than usual, same character.`
        : `${bits} — in line with its history.`;
  return { state, read, volX };
}

/** Plain-English summary of what this print actually was — what the print's own fields say, nothing more. */
function printRead(p: FlowPrint, sent: PrintSentiment): string {
  const who = p.side === 'ASK' ? 'paid the offer' : p.side === 'BID' ? 'hit the bid' : 'traded at the mid';
  const size = p.premium >= 1_000_000 ? 'a whale-sized' : p.premium >= 250_000 ? 'a sizeable' : 'a modest';
  const kind = printKind(p);
  const right = p.right === 'C' ? 'call' : 'put';
  const shape =
    p.trades && p.trades > 1
      ? `flow alert — ${p.trades} prints on this contract in one burst — that mostly ${who}${p.sweep ? ', with a sweep among them' : ''}`
      : `${right} print that ${who}${kind === 'SWEEP' ? ' and swept across exchanges — urgency, not patience' : kind === 'MULTI' ? ' as one leg of a multi-leg order' : ''}`;
  const oiNote =
    p.oi > 0 && p.volOverOI >= 1.5
      ? ` The day's volume is ${fixed(p.volOverOI, 1)}× the open interest, so at least some of it is new positioning.`
      : p.oi > 0
        ? ` The day's volume is ${fixed(p.volOverOI, 2)}× the open interest — it could be opening or closing.`
        : '';
  const line = `${size} ${p.trades && p.trades > 1 ? `${right} ` : ''}${shape}. By its side and its right it reads ${sent.toLowerCase()}.${oiNote}`;
  return line.charAt(0).toUpperCase() + line.slice(1);
}

interface PrintDrilldownProps {
  print: FlowPrint | null;
  snapshot: MarketSnapshot | null;
  onClose: () => void;
  isMarked: boolean;
  onToggleMark: (id: number) => void;
  onStep: (dir: -1 | 1) => void;
  hasPrev: boolean;
  hasNext: boolean;
  /** The live tape buffer — THE SEQUENCE reads the same contract's other
      prints out of it (isolated trade, or one leg of a working order?) */
  tapeRows?: FlowPrint[];
  /** Swap the drilldown to a sibling print from the sequence */
  onOpenPrint?: (p: FlowPrint) => void;
}

/** Same-contract identity on the tape: one name, one strike, one right, one expiry. */
const sameContract = (a: FlowPrint, b: FlowPrint) =>
  a.ticker === b.ticker && a.strike === b.strike && a.right === b.right && a.expiry === b.expiry;

const SEQ_SHOWN = 6;

/*
  THE SEQUENCE — the open print among its siblings from the LIVE tape buffer
  (Noah, 2026-08-19: "see whether it's an isolated trade or part of a larger
  sequence"). Deliberately reads the buffer the user was just watching, NOT
  the window history below (that is the contract's whole session; this is
  "what else crossed the tape I saw"), and deliberately unfiltered — evidence
  must not vanish because a tape filter is on. The verdict speaks first;
  rows are doors that swap the drilldown to that print.
*/
const SequenceStrip = ({
  print,
  siblings,
  onOpenPrint,
}: {
  print: FlowPrint;
  siblings: FlowPrint[];
  onOpenPrint?: (p: FlowPrint) => void;
}) => {
  const n = siblings.length;
  const read = useMemo(() => {
    if (n <= 1) return 'Isolated — the only row on this contract in the list you were watching.';
    const total = siblings.reduce((a, p) => a + p.premium, 0);
    const by = (side: FlowPrint['side']) => siblings.filter(p => p.side === side);
    const lots = (xs: FlowPrint[]) => xs.reduce((a, p) => a + p.size, 0).toLocaleString('en-US');
    const ask = by('ASK');
    const bid = by('BID');
    const mid = by('MID');
    const oldest = siblings[n - 1].time;
    const newest = siblings[0].time;
    const parts = [
      `Part of a sequence — ${n} prints on this contract in the tape you were watching`,
      `${fmtUsd(total)} total`,
      `${ask.length} paid the offer (${lots(ask)} contracts) / ${bid.length} hit the bid (${lots(bid)})${mid.length ? ` / ${mid.length} mid (${lots(mid)})` : ''}`,
      `${oldest} → ${newest}`,
    ];
    return `${parts.join(' · ')}.`;
  }, [siblings, n]);

  const shown = siblings.slice(0, SEQ_SHOWN);

  return (
    <div className="border border-borderSubtle bg-inset rounded-md overflow-hidden">
      <div className="px-3 py-2 border-b border-borderSubtle/60 flex items-baseline gap-2 flex-wrap">
        <span className="font-mono text-[11px] uppercase tracking-widest text-textSecondary">The sequence</span>
        <span className="font-mono text-[11px] text-textMuted">same contract in the tape's buffer — not the whole session</span>
      </div>
      <p className="px-3 pt-2 text-[11px] text-textSecondary leading-snug tnum">
        <RichRead text={read} />
      </p>
      {n > 1 && (
        <div className="px-1.5 py-1.5 flex flex-col">
          {shown.map(p => {
            const self = p.id === print.id;
            const word = p.side === 'ASK' ? 'paid offer' : p.side === 'BID' ? 'hit bid' : 'mid';
            /* the side in one ink (2026-10-13): the word says it, no direction hue */
            const ink = p.side === 'MID' ? 'text-textMuted' : 'text-textPrimary';
            const row = (
              <>
                <span className="w-[86px] shrink-0 font-mono text-[11px] tnum text-textMuted">{p.time}</span>
                <span className={`w-[74px] shrink-0 font-mono text-[11px] font-semibold uppercase tracking-wider ${ink}`}>{word}</span>
                <span className="font-mono text-[11px] tnum text-textSecondary">
                  {p.size.toLocaleString()} × ${p.fill.toFixed(2)}
                </span>
                <span className="font-mono text-[11px] font-bold tnum text-textPrimary">{fmtUsd(p.premium)}</span>
                {p.sweep && <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-warn">Sweep</span>}
                {self && (
                  <span className="ml-auto font-mono text-[11px] font-semibold uppercase tracking-wider text-silver">Viewing</span>
                )}
              </>
            );
            return self || !onOpenPrint ? (
              <div
                key={p.id}
                className={`flex items-baseline gap-2.5 px-1.5 py-1 rounded ${
                  self ? 'bg-silver/[0.05] shadow-[inset_2px_0_0_0_rgb(var(--silver)/0.7)]' : ''
                }`}
              >
                {row}
              </div>
            ) : (
              <button
                key={p.id}
                onClick={() => onOpenPrint(p)}
                title="Open this print"
                className="flex items-baseline gap-2.5 px-1.5 py-1 rounded text-left hover:bg-ink/[0.04] transition-colors"
              >
                {row}
              </button>
            );
          })}
          {n > SEQ_SHOWN && (
            <span className="px-1.5 py-1 font-mono text-[11px] text-textMuted tnum">…and {n - SEQ_SHOWN} more on the tape</span>
          )}
        </div>
      )}
    </div>
  );
};

const PrintDrilldown = ({ print, snapshot, onClose, isMarked, onToggleMark, onStep, hasPrev, hasNext, tapeRows, onOpenPrint }: PrintDrilldownProps) => {
  const navigate = useNavigate();
  const { changeTicker } = useMarketData();

  // Buffer order is newest-first; a filter keeps it, so index 0 = latest leg.
  const siblings = useMemo(
    () => (print && tapeRows ? tapeRows.filter(p => sameContract(p, print)) : []),
    [print, tapeRows]
  );

  /* THE SESSION THE CARD SHOWS — a New York trading day, the tape's own at open */
  const tapeIso = tapeSessionIso();
  const [dateIso, setDateIso] = useState<string>(tapeIso);
  const [intervalMin, setIntervalMin] = useState(1);
  const [showAvg, setShowAvg] = useState(true);
  const [showIv, setShowIv] = useState(false);
  const [showCalls, setShowCalls] = useState(true);
  const [showPuts, setShowPuts] = useState(true);
  const [metric, setMetric] = useState<NetMetric>('netPremium');
  const [tableTab, setTableTab] = useState<TableTab>('history');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const sent = print ? sentimentOf(print) : 'NEUTRAL';
  const sideLabel = print?.side === 'ASK' ? 'BOUGHT' : print?.side === 'BID' ? 'SOLD' : 'MID';
  /* THE SIDE IN ONE INK (2026-10-13, the partner's rule at Noah's word): "SOLD" wore bear red beside a green "BULLISH"
     on a put sold — the side is not the direction; the sentiment line under it carries the direction */
  const sideTone = print?.side === 'MID' ? 'text-textMuted' : 'text-textPrimary';

  /* THE CONTRACT'S OWN TAPE (the audit, 2026-10-22): its prints, its minutes and its history off the vendor's
     per-contract routes, and the underlying's net premium minute by minute — data/contractflow.ts */
  const load = useContractTape(print?.occ, print?.ticker, dateIso);
  const cf: ContractTape | null = load.tape;

  /* The print's minute since the bell — the marker through both strips, only on the print's own session */
  const printMin = useMemo(() => {
    if (!print || dateIso !== tapeIso || !/^\d{2}:\d{2}/.test(print.time)) return null;
    const m = Number(print.time.slice(0, 2)) * 60 + Number(print.time.slice(3, 5)) - (9 * 60 + 30);
    return m >= 0 && m <= SESSION_MIN ? m : null;
  }, [print, dateIso, tapeIso]);

  // Is this session unusual FOR THIS CONTRACT? Judged against its own history.
  const verdict = useMemo(() => (cf ? tapeVerdict(cf.history, dateIso) : null), [cf, dateIso]);
  /* the day's side split, off the contract's own history row for the session */
  const dayLean = cf?.day ? (() => {
    const d = cf.day;
    const t = d.askVol + d.bidVol + d.midVol + d.neutralVol;
    if (!(t > 0)) return null;
    const pc = (v: number) => Math.round((v / t) * 100);
    return { text: `ask ${pc(d.askVol)}% · bid ${pc(d.bidVol)}% · mid ${pc(d.midVol + d.neutralVol)}%`, lead: d.askVol > d.bidVol ? 'ask' : d.bidVol > d.askVol ? 'bid' : 'even' };
  })() : null;
  const nextIso = useMemo(() => {
    const d = isoToDate(dateIso);
    for (let i = 0; i < 10; i++) {
      d.setDate(d.getDate() + 1);
      if (isTradingDay(d)) break;
    }
    const iso = isoDate(d);
    return iso > tapeIso ? null : iso;
  }, [dateIso, tapeIso]);

  const copySummary = () => {
    if (!print) return;
    const txt = `${print.ticker} ${print.strike}${print.right} ${print.expiry} (${print.dte}d) — ${sideLabel} ${usd(print.premium)} · ${num(
      print.size
    )} @ $${fixed(print.fill)}${print.sweep ? ' · sweep' : ''} · tape ${sent.toLowerCase()} · vol ${num(print.volume)} / OI ${num(
      print.oi
    )} (${fixed(print.volOverOI)}x)`;
    navigator.clipboard
      ?.writeText(txt)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  // The Compass grade for this exact contract. The scale reads the ACTIVE
  // ticker's chain, so a print on another name can't be graded until the
  // terminal is looking at it — we say so rather than grading the wrong book.
  const sameTicker = !!print && !!snapshot && print.ticker === snapshot.ticker;
  const weighed = useMemo(() => {
    if (!print || !snapshot || !sameTicker) return null;
    try {
      return weighContract(snapshot, print.right, print.strike, print.dte);
    } catch {
      return null;
    }
  }, [print, snapshot, sameTicker]);

  // The state, from the board's own engine — same gate as the quality weigh.
  const bookRev = useBookRev();
  const graded = useMemo(() => {
    if (!print || !sameTicker) return null;
    const spot = peekSpot(print.ticker);
    const iv = peekIv(print.ticker);
    if (spot == null || iv == null) return null;
    try {
      return makeSetup(print.ticker, spot, print.strike, print.right, 'top-setups', iv, sleeveForDte(print.dte), print.dte);
    } catch {
      return null;
    }
  }, [print, sameTicker, bookRev]);

  const friction = weighed ? weighed.contract.spreadPct + weighed.contract.thetaPerDayPct : 0;

  const jump = (fn: () => void) => {
    onClose();
    fn();
  };

  const linkBtn =
    'inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded border border-borderSubtle bg-ink/[0.02] font-mono text-[11px] uppercase tracking-wider text-textSecondary hover:text-textPrimary hover:border-borderMuted transition-colors';

  const dateLabel = isoToDate(dateIso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <Modal
      open={!!print}
      onClose={onClose}
      // Near-full width: two time-series panels plus a wide table need the room,
      // and the tape still frames it on both sides.
      widthClass="max-w-[1680px]"
      ariaLabel={print ? `${print.ticker} ${print.strike}${print.right} print detail` : 'print detail'}
      // The session drives every series in the modal, so it sits dead centre
      // rather than tucked in with the window controls.
      headerCenter={
        /* The whole session box wears the holo foil — navigation hardware,
           dark ink on the bright material (Noah: "the entire box"). The label
           carries today-vs-past, so the material stays constant. */
        <div className="group relative flex items-center gap-0.5 rounded holo-bg text-[#0a0a0a] px-1 py-0.5">
            {/* ONE hover for the WHOLE box (Noah, 2026-08-23: "the entire
                button and not just the inner section") — a full-box wash on
                group hover instead of per-segment tints */}
            <span
              className="absolute inset-0 rounded bg-black/0 group-hover:bg-black/[0.12] transition-colors pointer-events-none"
              aria-hidden
            />
            <button
              onClick={() => setDateIso(d => sessionIsoBack(d, 1))}
              title="Previous session"
              className="p-0.5 rounded transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setCalendarOpen(o => !o)}
              title="Pick a session"
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[11px] font-semibold tnum transition-colors"
            >
              <CalendarDays className="w-3 h-3" />
              {dateIso === tapeIso ? 'Today' : dateLabel}
            </button>
            <button
              onClick={() => nextIso && setDateIso(nextIso)}
              disabled={!nextIso}
              title="Next session"
              className="p-0.5 rounded disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>

          {calendarOpen && (
            <DatePicker
              selected={isoToDate(dateIso)}
              onPick={offset => {
                const day = new Date();
                day.setDate(day.getDate() - offset);
                setDateIso(sessionOnOrBefore(day));
              }}
              onClose={() => setCalendarOpen(false)}
            />
          )}
        </div>
      }
      headerActions={
        <div className="flex items-center gap-0.5 shrink-0">
          {print && (
            <button
              onClick={() => onToggleMark(print.id)}
              aria-pressed={isMarked}
              title={isMarked ? 'Tracking this print' : 'Track this print'}
              className={`p-1 rounded transition-colors ${isMarked ? 'text-select' : 'text-textMuted hover:text-textPrimary hover:bg-ink/[0.05]'}`}
            >
              <Bookmark className="w-3.5 h-3.5" fill={isMarked ? 'currentColor' : 'none'} />
            </button>
          )}
          <button
            onClick={copySummary}
            title="Copy a one-line summary of this print"
            className={`p-1 rounded transition-colors ${copied ? 'text-select' : 'text-textMuted hover:text-textPrimary hover:bg-ink/[0.05]'}`}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <span className="w-px h-3.5 bg-borderSubtle mx-0.5" />
          <button
            onClick={() => onStep(-1)}
            disabled={!hasPrev}
            title="Previous print (↑)"
            className="p-1 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.05] disabled:opacity-25 transition-colors"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <button
            onClick={() => onStep(1)}
            disabled={!hasNext}
            title="Next print (↓)"
            className="p-1 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.05] disabled:opacity-25 transition-colors"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      }
      header={
        print && (
          <div className="flex items-center gap-3 flex-wrap">
            {/* THE MASTHEAD (Noah, 2026-09-28: "the slayer terminal … logo placed on the top right or left of the page so
                when users take screenshots and post on twitter thats what shows") — the house's wordmark, first thing on
                the card, the sidenav's own */}
            <span className="inline-flex items-center gap-2 pr-3 border-r border-borderSubtle shrink-0" role="img" aria-label="Slayer Terminal" data-print-masthead>
              <SlayerMark size={18} bare label="" />
              <Wordmark height={11} label="" />
            </span>
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[13px] font-semibold ${
                print.right === 'C' ? 'border-bull/30 bg-bull/10 text-bull' : 'border-bear/30 bg-bear/10 text-bear'
              }`}
            >
              {print.ticker} {print.strike}
              {print.right}
            </span>
            <span className="font-mono text-[11px] text-textSecondary tnum">
              {print.expiry} · {print.dte}d
            </span>
            {/* White: a leg count is a fact, not a status — the tape's own rule (2026-08-30). */}
            {print.legs > 1 && (
              <span className="font-mono text-[11px] text-textPrimary" title={print.trades ? 'The alert held multi-leg prints' : "The print's OPRA condition marks it a leg of a multi-leg order — how many legs it had is not on the print"}>
                multi-leg
              </span>
            )}
            <SignalBadge tone={SENT_TONE[sent]}>{sent}</SignalBadge>
            <span className="font-mono text-[11px] text-textSecondary tnum">{print.time}</span>
            <span className={`font-mono text-[11px] uppercase ${print.sweep ? 'text-warn font-semibold' : 'text-textMuted'}`}>
              {print.trades && print.trades > 1 ? `Alert · ${print.trades} prints` : { SWEEP: 'Sweep', MULTI: 'Multi-leg', BLOCK: 'Block', SINGLE: 'Single print' }[printKind(print)]}
            </span>
            {print.spot > 0 && (
              <span className="font-mono text-[11px] text-textMuted tnum">
                {print.ticker} {indexRoot(print.ticker) ? `≈${Math.round(print.spot).toLocaleString('en-US')}` : `$${fixed(print.spot)}`}
              </span>
            )}
          </div>
        )
      }
    >
      {print && (
        <>
          {/* THE HEAD OF THE CARD (2026-09-28, Noah: the three cards "look very AI generated and doesnt fit our design
              pattern"): one quiet block in the house's grammar — the money on one line with the fill's rule, the read as
              one sentence, the evidence as dot-leader rows with the Compass scale folded in; hairlines, no boxes */}
          <div className="flex flex-col border border-borderSubtle rounded-md bg-inset overflow-hidden" data-print-head>
            {/* THE MONEY — the premium, the side, where between bid and ask it filled, the fill */}
            <div className="flex items-center gap-x-5 gap-y-2 flex-wrap px-4 py-3" data-print-money>
              <span className="flex items-baseline gap-2.5">
                <span className={`font-mono text-[22px] font-bold tnum leading-none ${print.premium >= 1_000_000 ? 'text-supreme' : 'text-textPrimary'}`}>{usd(print.premium)}</span>
                <span className={`font-mono text-[13px] font-bold ${sideTone}`}>{sideLabel}</span>
                {print.sweep && <span className="font-mono text-[11px] uppercase font-semibold text-warn">Sweep</span>}
              </span>
              {/* the clearest aggressor tell — where between bid and ask it printed */}
              <span className="flex items-center gap-2 w-[220px] max-w-full" title="Where between the bid and the ask it filled — who was in a hurry">
                <span className="font-mono text-[11px] tnum text-textMuted">{fixed(print.bid)}</span>
                <span className="relative flex-1 h-[3px] rounded-full bg-ink/[0.08]">
                  <span
                    className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[8px] h-[8px] rounded-full ${print.side === 'MID' ? 'bg-ink/60' : 'bg-textPrimary'}`}
                    style={{ left: `${print.fillPos * 100}%` }}
                  />
                </span>
                <span className="font-mono text-[11px] tnum text-textMuted">{fixed(print.ask)}</span>
              </span>
              <span className="font-mono text-[11px] text-textSecondary tnum whitespace-nowrap">
                <RichRead text={`filled $${fixed(print.fill)} × ${num(print.size)} · ${print.time}`} />
              </span>
            </div>
            {/* THE READ — one sentence, the terminal talks first */}
            <p className="px-4 py-2.5 border-t border-borderSubtle/60 text-[12px] leading-relaxed text-textSecondary" data-print-read>
              <RichRead text={printRead(print, sent)} />
            </p>
            {/* THE EVIDENCE — the house's dot-leader rows; the Compass scale folded in, in words (no figure of ours in public) */}
            <div className="px-4 pt-2.5 pb-3 border-t border-borderSubtle/60 grid gap-x-8 gap-y-1.5 md:grid-cols-2 xl:grid-cols-3" data-print-facts>
              <Fact label={print.trades && print.trades > 1 ? 'This alert, mostly' : 'This print'} value={print.side === 'ASK' ? 'paid the offer' : print.side === 'BID' ? 'hit the bid' : 'mid / no side'} valueCls={print.side === 'MID' ? 'text-textMuted' : 'text-textPrimary'} />
              {/* the contract's whole session by side — the same history row the table reads, mid shown on its own */}
              <Fact label={dateIso === tapeIso ? "Today's volume by side" : 'Session volume by side'} value={dayLean ? dayLean.text : load.waiting ? '…' : '—'} valueCls={dayLean ? 'text-textPrimary' : 'text-textMuted'} />
              <Fact label="Strike vs spot" value={print.spot > 0 && Number.isFinite(print.otmPct) ? `${print.otmPct >= 0 ? '+' : ''}${fixed(print.otmPct, 1)}%` : '—'} />
              <Fact label="Volume" value={num(print.volume)} />
              <Fact label="Open interest" value={num(print.oi)} />
              <Fact label="Vol ÷ OI" value={`${fixed(print.volOverOI)}x`} valueCls={print.volOverOI >= 5 ? 'text-warn' : 'text-textPrimary'} />
              {graded && weighed ? (
                <>
                  <Fact
                    label="On the Compass scale"
                    value={
                      <span className="inline-flex items-center gap-2">
                        <VerdictBadge verdict={graded.verdict} dot />
                        <span className="font-mono text-[11px] font-normal text-textMuted uppercase tracking-wider">{graded.sleeve === 'odte' ? 'same-day' : graded.sleeve}</span>
                      </span>
                    }
                  />
                  <Fact
                    label="The case"
                    value={
                      <span className="inline-flex items-center gap-2.5">
                        <span data-print-case={gradeOfConfidence(graded.confidence)}>{gradeOfConfidence(graded.confidence)}</span>
                        <span className="inline-block w-[72px]">
                          <GradeMeter grade={gradeOfConfidence(graded.confidence)} />
                        </span>
                      </span>
                    }
                    valueCls={GRADE_INK[gradeOfConfidence(graded.confidence)]}
                  />
                  <Fact label="Spread + a day of theta" value={`${fixed(friction, 1)}%`} valueCls={friction > 16 ? 'text-bear' : friction > 8 ? 'text-warn' : 'text-bull'} />
                </>
              ) : (
                <div className="md:col-span-2 xl:col-span-3 pt-1">
                  <button onClick={() => changeTicker(print.ticker)} className="font-mono text-[11px] text-textSecondary hover:text-textPrimary transition-colors text-left">
                    The scale reads the live chain — switch the terminal to <span className="text-select font-semibold">{print.ticker}</span> to grade this contract.
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* THE SEQUENCE — siblings from the live buffer, before the window
              history: "am I looking at a one-off or a series?" is the first
              question after "what is it?" */}
          {tapeRows && <SequenceStrip print={print} siblings={siblings} onOpenPrint={onOpenPrint} />}

          {/* THE TAPE — the shape that is ours, not theirs: both instruments
              stacked full-width on ONE clock, crosshairs synced, and a lime
              line through both at the exact minute of the print you clicked.
              The question this answers that two side-by-side dashboards
              can't: where does THIS print sit in the day? */}
          <ErrorBoundary label="The flow panels" resetKey={`${print.id}-${intervalMin}-${dateIso}`}>
            <Suspense
              fallback={
                <div className="h-[520px] rounded-md border border-borderSubtle bg-inset flex items-center justify-center font-mono text-[11px] text-textMuted uppercase tracking-widest">
                  Loading flow…
                </div>
              }
            >
              <div className="border border-borderSubtle bg-inset rounded-md overflow-hidden" data-print-tape>
                <div className="px-3 py-2 border-b border-borderSubtle/60 flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[11px] uppercase tracking-widest text-textSecondary">The tape</span>
                  <span className="font-mono text-[11px] text-textMuted">the contract and {print.ticker} on one clock · {dateIso === tapeIso ? 'today' : dateLabel}, 09:30–16:00 ET</span>
                  <span className="ml-auto flex items-center gap-0.5">
                    {INTERVALS.map(m => (
                      <Chip key={m} active={m === intervalMin} onClick={() => setIntervalMin(m)} title={`${m}-minute bars`}>
                        {m}m
                      </Chip>
                    ))}
                  </span>
                </div>
                {!print.occ ? (
                  <div className="h-[160px] flex items-center justify-center font-mono text-[11px] uppercase tracking-widest text-textMuted">This row carries no contract symbol to read</div>
                ) : !cf ? (
                  <div className="h-[420px] flex items-center justify-center font-mono text-[11px] uppercase tracking-widest text-textMuted" data-print-tape-state={load.failed ? 'down' : 'reading'}>
                    {load.failed ? 'This read did not land — the tape fills when the feed answers' : "Reading the contract's session…"}
                  </div>
                ) : (
                  <>
                    <div className="px-3 pt-2.5 pb-1">
                      <FlowPanels tape={cf} intervalMin={intervalMin} showAvg={showAvg} onShowAvg={setShowAvg} showIv={showIv} onShowIv={setShowIv} printMin={printMin} syncId="print-tape" />
                    </div>
                    <div className="mx-3 my-1.5 h-px bg-borderSubtle/60" />
                    <div className="px-3 pt-1 pb-2.5">
                      <NetPanels
                        tape={cf}
                        ticker={print.ticker}
                        intervalMin={intervalMin}
                        metric={metric}
                        onMetric={setMetric}
                        showCalls={showCalls}
                        onShowCalls={setShowCalls}
                        showPuts={showPuts}
                        onShowPuts={setShowPuts}
                        printMin={printMin}
                        syncId="print-tape"
                      />
                    </div>
                  </>
                )}
              </div>
            </Suspense>
          </ErrorBoundary>

          {/* This session against the contract's own history — the engine
              answers the question instead of leaving 13 columns to ask it */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3 flex-wrap">
              <FilterTabs ariaLabel="Table view" options={TABLE_TABS} value={tableTab} onChange={setTableTab} />
              {/* The note travels WITH the table (Noah, 2026-08-30: "the
                  transition needs to be smooth between them with the
                  information as well"). Keyed on the tab so it re-enters on the
                  house curve instead of being swapped out from under the
                  reader — the pill already glides, and this used to snap
                  while it did. */}
              <span key={tableTab} className="animate-soft-in min-w-0">
                {tableTab === 'orders' ? (
                  <span className="font-mono text-[11px] uppercase tracking-wider text-textMuted" data-orders-note>
                    {cf ? (cf.prints.length ? `${cf.printsCapped ? 'the newest ' : ''}${cf.prints.length.toLocaleString('en-US')} prints · ${cf.prints[cf.prints.length - 1].time}–${cf.prints[0].time} ET${cf.printsCapped && cf.day ? ` of ${cf.day.trades.toLocaleString('en-US')} in the session` : ''}` : 'no prints this session') : '…'}
                  </span>
                ) : verdict ? (
                  <span className="flex items-center gap-2 flex-wrap min-w-0">
                    <SignalBadge tone={TAPE_TONE[verdict.state]} dot={verdict.state === 'UNUSUAL'}>
                      {verdict.state}
                    </SignalBadge>
                    {/* Numbers in sentences wear the house code — RichRead, not flat gray */}
                    <span className="font-mono text-[11px] text-textSecondary tnum truncate">
                      <RichRead text={verdict.read} />
                    </span>
                  </span>
                ) : null}
              </span>
            </div>
            <ErrorBoundary label="The table" resetKey={`${print.id}-${tableTab}-${dateIso}`}>
              {/* Both views are capped scrollers of the SAME height, so the
                  swap is a cross-fade in a slot that never moves. Animating a
                  changing height here would have been the wrong answer: it
                  costs a layout animation on every re-render, and this card
                  already has enough moving parts. */}
              <div key={tableTab} className="animate-soft-in">
                {cf && (tableTab === 'orders' ? <OrdersTable tape={cf} /> : <HistoryTable rows={cf.history} dateIso={dateIso} unusual={!!verdict && verdict.volX >= 2.5} />)}
              </div>
            </ErrorBoundary>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-[11px] uppercase tracking-widest text-textSecondary mr-1">Open in</span>
            <button onClick={() => jump(() => { changeTicker(print.ticker); navigate('/pinpoint'); })} className={linkBtn}>
              <Crosshair className="w-3.5 h-3.5" /> Dealer map
            </button>
            <button
              onClick={() =>
                jump(() =>
                  navigate('/compass', { state: { monitor: { ticker: print.ticker, strike: print.strike, right: print.right, scanner: 'top-setups' } } })
                )
              }
              className={linkBtn}
            >
              <Compass className="w-3.5 h-3.5" /> Monitor strike
            </button>
            <button onClick={() => jump(() => navigate('/weigher', { state: { weigh: { ticker: print.ticker } } }))} className={linkBtn}>
              <Scale className="w-3.5 h-3.5" /> Weigh it
            </button>
            <button
              onClick={() => onToggleMark(print.id)}
              aria-pressed={isMarked}
              className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded border font-mono text-[11px] uppercase tracking-wider transition-colors ${
                isMarked
                  ? 'border-select/40 bg-select/[0.08] text-select'
                  : 'border-borderSubtle bg-ink/[0.02] text-textSecondary hover:text-textPrimary hover:border-borderMuted'
              }`}
            >
              <Bookmark className="w-3.5 h-3.5" fill={isMarked ? 'currentColor' : 'none'} />
              {isMarked ? 'Tracking' : 'Track print'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
};

const th = 'px-2 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-widest text-textMuted border-b border-borderSubtle';
const td = 'px-2 py-1.5 font-mono text-[11px] tnum';

/** The contract's real prints for the session, newest first — the largest of them is marked */
const OrdersTable = ({ tape }: { tape: ContractTape }) => {
  const largest = tape.prints.reduce<string | null>((a, p) => (a === null || p.premium > (tape.prints.find(x => x.id === a)?.premium ?? 0) ? p.id : a), null);
  if (!tape.prints.length) return <div className="border border-borderSubtle rounded-md px-3 py-6 font-mono text-[11px] text-textMuted uppercase tracking-widest text-center">No prints on this contract this session</div>;
  return (
    <div className="border border-borderSubtle rounded-md overflow-hidden max-h-[240px] overflow-y-auto">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10">
          <tr className="bg-inset">
            <th className={`${th} text-left`}>Time</th>
            <th className={`${th} text-right`}>Price</th>
            <th className={`${th} text-right`}>Size</th>
            <th className={`${th} text-left`}>Side</th>
            <th className={`${th} text-right`}>Bid × ask</th>
            <th className={`${th} text-right`}>Premium</th>
            <th className={`${th} text-right`}>Implied vol</th>
            <th className={`${th} text-left`}>Kind</th>
          </tr>
        </thead>
        <tbody>
          {tape.prints.slice(0, 200).map(o => (
            <tr key={o.id} className="border-b border-borderSubtle/30 last:border-0 hover:bg-ink/[0.02]">
              <td className={`${td} text-textPrimary`}>{o.time}</td>
              <td className={`${td} text-right text-textPrimary`}>${o.price.toFixed(2)}</td>
              <td className={`${td} text-right text-textPrimary`}>{o.size.toLocaleString('en-US')}</td>
              <td className={`${td} ${o.side === 'MID' ? 'text-textMuted' : 'text-textPrimary'}`}>{o.side === 'ASK' ? 'Paid offer' : o.side === 'BID' ? 'Hit bid' : 'Mid'}</td>
              <td className={`${td} text-right text-textSecondary`}>{o.bid > 0 || o.ask > 0 ? `${o.bid.toFixed(2)} × ${o.ask.toFixed(2)}` : '—'}</td>
              <td className={`${td} text-right ${o.id === largest ? 'text-supreme font-semibold' : 'text-textPrimary'}`} title={o.id === largest ? 'The largest print in this list' : undefined}>
                {fmtUsd(o.premium)}
              </td>
              <td className={`${td} text-right text-textPrimary`}>{o.iv > 0 ? `${o.iv.toFixed(1)}%` : '—'}</td>
              <td className={`${td} text-textSecondary`}>
                {o.sweep && <span className="text-warn font-semibold mr-1.5">Sweep</span>}
                {o.multi ? 'Multi-leg' : 'Single leg'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/** Is this session actually unusual for this contract, or is this just how it trades? The vendor's day-by-day
    history; the session on the card wears the selection edge. */
const HistoryTable = ({ rows, dateIso, unusual }: { rows: CardDay[]; dateIso: string; unusual: boolean }) => {
  const premSum = rows.reduce((a, r) => a + r.premium, 0) || 1;
  if (!rows.length) return <div className="border border-borderSubtle rounded-md px-3 py-6 font-mono text-[11px] text-textMuted uppercase tracking-widest text-center">No history for this contract</div>;
  return (
    <div className="border border-borderSubtle rounded-md overflow-hidden max-h-[240px] overflow-y-auto">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10">
          <tr className="bg-inset">
            <th className={`${th} text-left`}>Date</th>
            <th className={`${th} text-right`}>Volume</th>
            <th className={`${th} text-right`} title="Open interest standing that session">Open int.</th>
            <th className={`${th} text-right`} title="Against the session before">OI change</th>
            <th className={`${th} text-right`}>Close</th>
            <th className={`${th} text-right`}>Avg</th>
            <th className={`${th} text-left`} title="The session's volume on the bid, at the mid or no side, and at the ask">Bid · mid · ask</th>
            <th className={`${th} text-right`}>Implied vol</th>
            <th className={`${th} text-right`}>Swept</th>
            <th className={`${th} text-right`}>Multi-leg</th>
            <th className={`${th} text-right`}>Premium</th>
            <th className={`${th} text-right`} title={`Share of the premium across the ${rows.length} sessions listed`}>Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(d => {
            const here = d.iso === dateIso;
            const t = d.askVol + d.bidVol + d.midVol + d.neutralVol;
            const pc = (v: number) => (t > 0 ? (v / t) * 100 : 0);
            return (
              <tr key={d.iso} className={`border-b border-borderSubtle/30 last:border-0 hover:bg-ink/[0.02] ${here ? 'shadow-[inset_2px_0_0_0_rgb(var(--silver)/0.7)]' : ''}`}>
                <td className={`${td} text-textPrimary whitespace-nowrap`}>
                  {d.date}
                  {here && <span className="ml-1.5 text-silver">this session</span>}
                </td>
                <td className={`${td} text-right ${here && unusual ? 'text-warn font-semibold' : 'text-textPrimary'}`}>{num(d.vol)}</td>
                <td className={`${td} text-right text-textPrimary`}>{num(d.oi)}</td>
                <td className={`${td} text-right ${d.oiChange == null ? 'text-textMuted' : d.oiChange >= 0 ? 'text-bull dir-up' : 'text-bear dir-down'}`}>
                  {d.oiChange == null ? '—' : `${d.oiChange >= 0 ? '+' : '−'}${Math.abs(d.oiChange).toLocaleString('en-US')}`}
                </td>
                <td className={`${td} text-right text-textPrimary`}>{d.close > 0 ? `$${fixed(d.close)}` : '—'}</td>
                <td className={`${td} text-right text-textPrimary`}>{d.avg > 0 ? `$${fixed(d.avg)}` : '—'}</td>
                <td className="px-2 py-1.5">
                  <span
                    className="flex h-[3px] w-24 rounded-full overflow-hidden bg-ink/[0.14]"
                    title={`${Math.round(pc(d.bidVol))}% on the bid · ${Math.round(pc(d.midVol + d.neutralVol))}% mid or no side · ${Math.round(pc(d.askVol))}% at the ask`}
                  >
                    <span className="h-full bg-bear/80" style={{ width: `${pc(d.bidVol)}%` }} />
                    <span className="h-full bg-ink/30" style={{ width: `${pc(d.midVol + d.neutralVol)}%` }} />
                    <span className="h-full bg-bull/80" style={{ width: `${pc(d.askVol)}%` }} />
                  </span>
                </td>
                <td className={`${td} text-right text-textPrimary`}>{d.iv > 0 ? `${fixed(d.iv, 1)}%` : '—'}</td>
                <td className={`${td} text-right ${d.sweepPct >= 50 ? 'text-warn' : 'text-textPrimary'}`}>{Math.round(d.sweepPct)}%</td>
                <td className={`${td} text-right text-textPrimary`}>{Math.round(d.multiPct)}%</td>
                <td className={`${td} text-right text-textPrimary`}>{usd(d.premium)}</td>
                <td className={`${td} text-right text-textPrimary`}>{fixed((d.premium / premSum) * 100, 1)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default PrintDrilldown;
