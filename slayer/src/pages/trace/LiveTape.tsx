/* The Live Tape: every option print, newest first, in the house box. The head reads the view's prints (or, after the
   close, the whole day first); the cut lives in the address so Link and Save work; a row opens the print's card. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import { dayLean, dayStartMs, fmtCount as num, lastRegularClose, plural, quoteNoReadWords, tapeSessionIso, tideBetween, useDayBigAlerts, useDayTopContracts, useTide, useAlertTrades, useFlowAlerts, useNameTopContracts, useOlderPages, olderAlerts, usePrintStream, usd as fmtUsd, type TapeQuery } from '../../data/traceLive';
import { leanWords } from '../../data/traceLean';
import { useTraceSession } from '../../components/trace/traceSession';
import { nyClock, nyWallTime } from '../../core/nyTime';
import { FeedFallback, TickFigure } from '../../components/ui/liveRead';
import { printKey, useWatch, watchPrint } from '../../context/WatchContext';
import WatchStar from '../../components/trace/WatchStar';
import { LiveHold, SessionMark, useHold } from '../../components/trace/LiveHold';
import { BLOCK_MIN_PREMIUM, BLOCK_MIN_SIZE, bookRowToPrint, isSpreadLeg, notCrownable, printKind, rankNotable, sentimentOf, summarizeTape, type PrintKind } from '../../data/tape';
import CompanyLogo from '../../components/ui/CompanyLogo';
import type { Column } from '../../components/ui/DataTable';
import DropdownSelect, { type DropdownOption } from '../../components/ui/DropdownSelect';
import RichRead from '../../components/ui/RichRead';
import PrintDrilldown from '../../components/trace/PrintDrilldown';
import ReadDoor from '../../components/trace/ReadDoor';
import FlowSearch, { CONTRACT_FORMATS, contractOcc, matchesContract, searchMiss, parseContractQuery } from '../../components/trace/FlowSearch';
import ContractCell, { OtmCell } from '../../components/trace/ContractCell';
import LeanCell from '../../components/trace/LeanCell';
import ColumnChooser, { useHiddenColumns } from '../../components/trace/ColumnChooser';
import { SavedCutsControl, SavedCutsList, useSavedCuts } from '../../components/trace/SavedCuts';
import { createViewStore } from '../../data/savedViews';
import TermLine from '../../components/trace/TermLine';
import TraceBox, { Champion, Fact, PhoneRow, TraceGrid } from '../../components/trace/TraceBox';
import ExpiryCalendar from '../../components/ui/ExpiryCalendar';
import { useExpiryCut } from '../../components/trace/bookExpiry';
import { isoDate } from '../../core/calendar';
import { expiryLabel } from '../../core/format';
import { LiveTapeGuide } from '../../components/trace/TraceGuide';
import type { FlowPrint, PrintSentiment, TapeSummary } from '../../types/trace';
import { crossDay, floorPackaged, FRESH_VOL_OI, notABet, notABetHint, notABetLabel, notABetWord, stockLike, STOCK_LIKE_HINT, VENDOR_TOTAL_NOTE, volOiText } from '../../data/flowBook';
import { dayAdv, shortDay, spanWords } from '../../components/trace/dayWords';
import { useIsPhone } from '../../components/ui/useMediaQuery';

/* the chooser stores the hidden set; the old key held the visible one */
const COLS_KEY = 'slayer_tape_hidden_v2';

type FlowFilter = 'ALL' | PrintKind;
const LANE_OPTIONS: DropdownOption<'prints' | 'alerts'>[] = [
  { value: 'prints', label: 'Every print', hint: 'Each trade as it hits the tape' },
  { value: 'alerts', label: 'Flow alerts', hint: 'A burst of prints on one contract, as one row' },
];
const DAY_PANEL: DropdownOption<'on' | 'off'>[] = [
  { value: 'on', label: 'Shown', hint: "The day's tide, biggest contracts and largest alerts" },
  { value: 'off', label: 'Hidden', hint: 'The tape only' },
];
/** Ordering is one axis, direction (the Lean card) another — they compose */
type TapeView = 'STREAM' | 'NOTABLE' | 'PREMIUM' | 'SIZE';

const VIEW_META: Record<TapeView, { label: string; hint: string }> = {
  STREAM: { label: 'Stream', hint: 'Newest first' },
  NOTABLE: { label: 'Notable', hint: 'Premium, aggression, size and distance, ranked' },
  PREMIUM: { label: 'Premium', hint: 'Biggest dollars first' },
  SIZE: { label: 'Size', hint: 'Most contracts first' },
};
type SentFilter = 'ALL' | PrintSentiment;
type PremKey = '0' | '100000' | '500000' | '1000000';
type RightKey = 'ALL' | 'C' | 'P';
type SideKey = 'ALL' | 'ASK' | 'BID' | 'MID';

/* only what differs from the default tape is written to the address */
const TAPE_CUTS = createViewStore('slayer_tape_cuts_v1');
interface TapeCut {
  view: TapeView;
  kind: FlowFilter;
  lean: SentFilter;
  prem: PremKey;
  expiry: string | null;
  q: string;
  right: RightKey;
  side: SideKey;
}
const TAPE_CUT_DEFAULT: TapeCut = { view: 'STREAM', kind: 'ALL', lean: 'ALL', prem: '0', expiry: null, q: '', right: 'ALL', side: 'ALL' };
const PREM_KEYS: PremKey[] = ['0', '100000', '500000', '1000000'];
const LEAN_KEYS: SentFilter[] = ['ALL', 'BULLISH', 'BEARISH', 'NEUTRAL'];
const KIND_KEYS: FlowFilter[] = ['ALL', 'SWEEP', 'BLOCK', 'MULTI', 'SINGLE', 'COMPRESSION', 'BURST'];

function cutToQuery(c: TapeCut): string {
  const p = new URLSearchParams();
  if (c.view !== TAPE_CUT_DEFAULT.view) p.set('order', c.view.toLowerCase());
  if (c.kind !== TAPE_CUT_DEFAULT.kind) p.set('kind', c.kind.toLowerCase());
  if (c.lean !== TAPE_CUT_DEFAULT.lean) p.set('lean', c.lean.toLowerCase());
  if (c.prem !== TAPE_CUT_DEFAULT.prem) p.set('prem', c.prem);
  if (c.expiry) p.set('exp', c.expiry);
  if (c.q.trim()) p.set('q', c.q.trim());
  if (c.right !== 'ALL') p.set('type', c.right === 'C' ? 'calls' : 'puts');
  if (c.side !== 'ALL') p.set('side', c.side.toLowerCase());
  return p.toString();
}

/** A URL is user input: a value the tape does not know falls back to the default */
function queryToCut(p: URLSearchParams): { cut: TapeCut; any: boolean } {
  const up = (k: string) => (p.get(k) ?? '').toUpperCase();
  const view = up('order');
  const kind = up('kind');
  const lean = up('lean');
  const prem = p.get('prem') ?? '';
  const exp = p.get('exp');
  return {
    cut: {
      view: view in VIEW_META ? (view as TapeView) : TAPE_CUT_DEFAULT.view,
      kind: (KIND_KEYS as string[]).includes(kind) ? (kind as FlowFilter) : TAPE_CUT_DEFAULT.kind,
      lean: (LEAN_KEYS as string[]).includes(lean) ? (lean as SentFilter) : TAPE_CUT_DEFAULT.lean,
      prem: (PREM_KEYS as string[]).includes(prem) ? (prem as PremKey) : TAPE_CUT_DEFAULT.prem,
      expiry: exp && /^\d{4}-\d{2}-\d{2}$/.test(exp) ? exp : null,
      q: (p.get('q') ?? '').slice(0, 40),
      right: up('type') === 'CALLS' ? 'C' : up('type') === 'PUTS' ? 'P' : 'ALL',
      side: (['ASK', 'BID', 'MID'] as string[]).includes(up('side')) ? (up('side') as SideKey) : 'ALL',
    },
    any: ['order', 'kind', 'lean', 'prem', 'exp', 'q', 'type', 'side'].some(k => p.has(k)),
  };
}

const PREM_CHIPS: { value: Exclude<PremKey, '0'>; label: string }[] = [
  { value: '100000', label: '≥$100K' },
  { value: '500000', label: '≥$500K' },
  { value: '1000000', label: '≥$1M' },
];

const ORDER_OPTIONS: DropdownOption<TapeView>[] = (Object.keys(VIEW_META) as TapeView[]).map(v => ({ value: v, label: VIEW_META[v].label, hint: VIEW_META[v].hint }));
const KIND_OPTIONS: DropdownOption<FlowFilter>[] = [
  { value: 'ALL', label: 'Every kind', hint: 'Every print' },
  { value: 'SWEEP', label: 'Sweeps', hint: "Swept across exchanges (OPRA isoi) — refills with the day's sweeps" },
  { value: 'BLOCK', label: 'Blocks', hint: `One leg, ${BLOCK_MIN_SIZE}+ contracts or $${BLOCK_MIN_PREMIUM / 1000}K+ in one print` },
  { value: 'MULTI', label: 'Multi-leg', hint: 'Legs of multi-leg orders — read the structures on Multi-Leg' },
  { value: 'SINGLE', label: 'Single prints', hint: 'One leg, under the block line — cuts the prints in hand' },
  { value: 'COMPRESSION', label: 'Compression', hint: 'OPRA cbmo / mctp packages — not bets, in no bullish or bearish total' },
  { value: 'BURST', label: 'Alert bursts', hint: 'Alerts whose largest single trade is not known to be a block' },
];
const LEAN_OPTIONS: DropdownOption<SentFilter>[] = [
  { value: 'ALL', label: 'Every print', hint: 'Bullish, bearish and no-read prints' },
  { value: 'BULLISH', label: 'Bullish', hint: 'Calls bought, puts sold' },
  { value: 'BEARISH', label: 'Bearish', hint: 'Puts bought, calls sold' },
  { value: 'NEUTRAL', label: 'No read', hint: 'Mid, spread legs, crosses, compression, after hours, stale quotes — of the prints in hand' },
];
const RIGHT_OPTIONS: DropdownOption<RightKey>[] = [
  { value: 'ALL', label: 'Both', hint: 'Calls and puts' },
  { value: 'C', label: 'Calls', hint: "Calls only — refills from the whole session" },
  { value: 'P', label: 'Puts', hint: "Puts only — refills from the whole session" },
];
const SIDE_OPTIONS: DropdownOption<SideKey>[] = [
  { value: 'ALL', label: 'Any side', hint: 'Every fill' },
  { value: 'ASK', label: 'At the ask', hint: 'Filled at or over the ask — bought' },
  { value: 'BID', label: 'On the bid', hint: 'Filled at or under the bid — sold' },
  { value: 'MID', label: 'Mid', hint: 'Filled between the bid and ask, or no quote read' },
];
const KIND_WORD: Record<PrintKind, string> = { SWEEP: 'Sweep', BLOCK: 'Block', MULTI: 'Multi-leg', SINGLE: 'Single', COMPRESSION: 'Compression', BURST: 'Burst' };

/* every width clears its widest cell; the time takes the rank's room only in a ranked order */
const WIDTHS: Record<string, number> = { time: 96, ticker: 84, contract: 168, dte: 64, otm: 76, quote: 134, size: 148, prem: 80, dayRatio: 116, sentiment: 92, vol: 76, oi: 76, volOverOi: 64, iv: 66, tag: 80 };
const WIDTHS_RANKED: Record<string, number> = { ...WIDTHS, time: 146 };
const FLEXES: Record<string, number> = {};
const PIN_LEFT = ['time', 'ticker', 'contract'];
const PIN_RIGHT = ['prem'];

const TOOLTIPS: Record<string, string> = {
  otm: 'Out of the money by this much of the spot, calls and puts alike; negative is in the money',
  contract: 'The contract, days left, the stock at the print, and OTM %',
  quote: 'The fill, the side it crossed, and the bid and ask it crossed into',
  size: "Contracts on this print, over the day's volume and the open interest",
  prem: 'Dollars paid — size × fill × 100',
  dayRatio: "The contract's whole day by side; on the alerts lane, the alert's premium by side",
  sentiment: 'Bullish (calls bought, puts sold), bearish (puts bought, calls sold), or no read',
  volOverOi: 'Volume over the open interest the session opened on; 1.5+ means positions built today',
  iv: 'Implied volatility',
  tag: 'Sweep, block, multi-leg or single print',
};

/** One stretch of the read — a sentence piece, or a door onto a print */
type ReadSeg = string | { print: FlowPrint; label: string };

/** How long a window of prints runs: "23 seconds", "4 minutes", "2 hours 5 minutes" */
function spanLength(xs: readonly FlowPrint[]): string | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of xs) {
    const ms = r.epochMs ?? 0;
    if (!(ms > 0)) continue;
    if (ms < lo) lo = ms;
    if (ms > hi) hi = ms;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  const sec = Math.max(1, Math.round((hi - lo) / 1000));
  if (sec < 120) return `${sec} second${sec === 1 ? '' : 's'}`;
  const min = Math.round(sec / 60);
  if (min < 120) return `${min} minutes`;
  return `${Math.floor(min / 60)} hours ${min % 60} minutes`;
}

/** The view's read: the window named, which way the sided money leads, the largest print as a door, what stands apart */
function tapeRead(rows: FlowPrint[], summary: TapeSummary, noun: 'prints' | 'alerts' = 'prints'): ReadSeg[] {
  if (rows.length === 0) return [noun === 'alerts' ? 'Awaiting alerts…' : 'Awaiting prints…'];
  const zdte = rows.filter(r => r.dte === 0).length;
  const lead = summary.bullPremium >= summary.bearPremium ? 'Bullish' : 'Bearish';
  const spanW = spanWords(rows);
  const len = spanLength(rows);
  const ext = rows.filter(r => r.extended).length;
  const segs: ReadSeg[] = [`In these ${num(rows.length)} ${noun}${spanW ? ` (${spanW} ET${len ? `, ${len}` : ''})` : ''}${ext ? `, ${ext === rows.length ? 'all' : num(ext)} after hours` : ''}: `];
  segs.push(
    summary.bullPremium === 0 && summary.bearPremium === 0
      ? 'none is read bullish or bearish'
      : `${lead.toLowerCase()} premium leads by ${fmtUsd(Math.abs(summary.netPremium))} — ${fmtUsd(summary.bullPremium)} bullish against ${fmtUsd(summary.bearPremium)} bearish; calls ${fmtUsd(summary.callPremium)}, puts ${fmtUsd(summary.putPremium)}`
  );
  if (summary.largest) {
    const L = summary.largest;
    const hit = rows.find(r => r.ticker === L.ticker && r.strike === L.strike && r.right === L.right && r.premium === L.premium);
    segs.push(noun === 'alerts' ? ' · largest alert ' : ' · largest print ');
    if (hit) segs.push({ print: hit, label: `${L.ticker} ${L.strike}${L.right}` });
    else segs.push(`${L.ticker} ${L.strike}${L.right}`);
    segs.push(` at [[${fmtUsd(L.premium)}]]`);
    if (hit && stockLike(hit)) segs.push(' — deep in the money and long-dated, likely a stock replacement');
  }
  if (summary.sweeps > 2) segs.push(` · ${num(summary.sweeps)} sweeps`);
  if (summary.spreadLegs.count > 0) segs.push(` · ${num(summary.spreadLegs.count)} spread legs (${fmtUsd(summary.spreadLegs.premium)}) not read`);
  if (summary.crosses.count > 0) segs.push(` · ${num(summary.crosses.count)} crosses (${fmtUsd(summary.crosses.premium)}) not read`);
  if (summary.compression.count > 0) segs.push(` · ${num(summary.compression.count)} compression prints (${fmtUsd(summary.compression.premium)}) apart`);
  if (rows.length >= 20 && zdte / rows.length > 0.25) segs.push(` · 0DTE ${(Math.round((zdte * 1000) / rows.length + 1e-9) / 10).toFixed(1)}%`);
  segs.push('.');
  return segs;
}

/* the side is a word and a dot on the rail, never a bull/bear ink: green already means call and bullish in this row */
const SIDE_WORD: Record<FlowPrint['side'], string> = { ASK: 'ask', BID: 'bid', MID: 'mid' };
/** A fill outside its quote says so: under the bid / over the ask */
const sideWordOf = (p: FlowPrint) => (p.bid > 0 && p.ask >= p.bid && p.fill < p.bid - 0.005 ? 'under bid' : p.bid > 0 && p.ask >= p.bid && p.fill > p.ask + 0.005 ? 'over ask' : SIDE_WORD[p.side]);
const QuoteCell = ({ print }: { print: FlowPrint }) => (
  <span className="inline-flex flex-col items-end gap-[2px] leading-none align-middle">
    <span className="inline-flex items-baseline gap-1">
      <span className="font-mono text-t11 font-bold tnum text-textPrimary">${print.fill.toFixed(2)}</span>
      <span className="font-mono text-t11 font-semibold uppercase tracking-wide text-textPrimary" title={print.extended ? 'After hours — against a post-market quote' : undefined}>
        {sideWordOf(print)}
      </span>
    </span>
    <span className="inline-flex items-center gap-1">
      <span className="font-mono text-t11 tnum text-textSecondary">{print.bid.toFixed(2)}</span>
      <span className="relative w-8 h-[3px] rounded-full bg-ink/[0.07]">
        <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[6px] h-[6px] rounded-full bg-textPrimary" style={{ left: `${print.fillPos * 100}%` }} />
      </span>
      <span className="font-mono text-t11 tnum text-textSecondary">{print.ask.toFixed(2)}</span>
    </span>
  </span>
);

/** Size over the scale it is read against: the day's volume and the standing open interest */
const SizeCell = ({ print }: { print: FlowPrint }) => (
  <span className="inline-flex flex-col items-end gap-[2px] leading-none align-middle">
    <span className="font-mono text-t11 font-bold tnum text-textPrimary">{num(print.size)}</span>
    <span className="font-mono text-t11 tnum text-textSecondary whitespace-nowrap" title="The day's volume, and the open interest the session opened on">
      vol {num(print.volume)} <span aria-hidden>·</span> oi {num(print.oi)}
    </span>
  </span>
);

const SENT_TEXT: Record<PrintSentiment, string> = { BULLISH: 'text-bull', BEARISH: 'text-bear', NEUTRAL: 'text-textSecondary' };

/* a print with the rank it holds in a ranked view; wrappers are cached per (print, rank) so an unmoved row keeps its
   identity and the grid's memoised row sits the poll out */
interface TapeRow {
  p: FlowPrint;
  rank?: number;
}

type TapeGroup = 'Contract' | 'Execution' | 'Conviction' | 'Activity';
const TAPE_GROUP_ORDER: TapeGroup[] = ['Contract', 'Execution', 'Conviction', 'Activity'];

interface TapeColumn extends Column<TapeRow> {
  label: string;
  group?: TapeGroup;
}

const FADE_ROW = () => 'animate-fade-in';
/** The grid's row id: the vendor's trade id, never the rank — a re-rank moves rows, it does not remount them */
const printId = (p: FlowPrint) => p.vendorId || String(p.id);

const phoneRow = (r: TapeRow) => {
  const s = sentimentOf(r.p);
  return (
    <PhoneRow
      lead={<WatchStar k={printKey(r.p)} make={() => watchPrint(r.p, 'tape')} noun="print" />}
      title={
        <>
          <CompanyLogo ticker={r.p.ticker} size={15} />
          <span className="font-bold">{r.p.ticker}</span>
          <span className="font-bold tnum">{r.p.strike}</span>
          <span className={r.p.right === 'C' ? 'text-bull' : 'text-bear'}>{r.p.right === 'C' ? 'call' : 'put'}</span>
          <span className="text-t11 text-textSecondary tnum">{r.p.expiry.slice(0, 5)}</span>
        </>
      }
      aside={`${r.p.time} ET`}
      figures={[
        <span key="p" className="font-semibold text-textPrimary">
          {fmtUsd(r.p.premium)}
        </span>,
        <span key="s">
          {sideWordOf(r.p)} ${r.p.fill.toFixed(2)}
        </span>,
        <span key="z">{plural(r.p.size, 'contract')}</span>,
        <span key="l" className={SENT_TEXT[s]}>
          {r.p.compression ? 'compression' : r.p.extended ? 'after hours' : isSpreadLeg(r.p) ? 'spread leg' : s.toLowerCase()}
        </span>,
        printKind(r.p) === 'SWEEP' ? (
          <span key="k" className="text-warn">
            sweep
          </span>
        ) : null,
      ].filter(Boolean)}
    />
  );
};

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const matchesTape = (r: FlowPrint, q: string) => norm(q) === '' || matchesContract(q, r);

/** A typed New York clock, 24-hour: "1430" → 14:30, "930" → 09:30; an hour 1–8 with no a/p is the afternoon (the session
    runs 09:30–16:15); "2p" style input still works. Returns the shown text and the HH:MM to jump to. */
export function shapeClock(raw: string): { show: string; hhmm: string | null } {
  const src = raw.toLowerCase();
  const mer = src.includes('p') ? 'PM' : src.includes('a') ? 'AM' : null;
  const digits = src.replace(/\D/g, '').slice(0, 4);
  if (!digits) return { show: '', hhmm: null };
  let hourDigits: string;
  let minDigits: string;
  if (Number(digits[0]) >= 2 || digits.length === 3) {
    hourDigits = digits[0];
    minDigits = digits.slice(1, 3);
  } else {
    hourDigits = digits.slice(0, 2);
    minDigits = digits.slice(2, 4);
  }
  if (minDigits.length >= 1 && Number(minDigits[0]) > 5) minDigits = '';
  let h = Number(hourDigits);
  if (!minDigits.length) return { show: hourDigits, hhmm: null };
  if (minDigits.length < 2 || h > 23) return { show: `${hourDigits}:${minDigits}`, hhmm: null };
  if (mer === 'PM' && h < 12) h += 12;
  else if (mer === 'AM' && h === 12) h = 0;
  else if (!mer && h >= 1 && h <= 8) h += 12;
  const hhmm = `${String(h).padStart(2, '0')}:${minDigits}`;
  return { show: hhmm, hhmm };
}

/** Jump to a time: the session's marks, or any New York time typed */
const JUMP_MARKS = ['10:00', '11:30', '13:00', '15:00'];
const JumpToTime = ({ onJump, back, latestWord }: { onJump: (hhmm: string) => void; back: (() => void) | null; latestWord: string }) => {
  const [text, setText] = useState('');
  const clock = shapeClock(text);
  const go = () => {
    if (clock.hhmm) onJump(clock.hhmm);
  };
  return (
    <span className="inline-flex items-center gap-2" data-tape-jump>
      {JUMP_MARKS.map(m => (
        <button key={m} type="button" className="slayer-chip" onClick={() => onJump(m)} data-tape-jump-mark={m}>
          {m}
        </button>
      ))}
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        placeholder="14:30"
        value={text}
        onChange={e => setText(e.target.value.replace(/[^0-9:apmAPM ]/g, '').slice(0, 7))}
        onBlur={() => clock.hhmm && setText(clock.hhmm)}
        onKeyDown={e => {
          if (e.key === 'Enter') go();
        }}
        aria-label="Jump to a New York time, 24-hour"
        title="A New York time, 24-hour: 1430 or 14:30. Enter jumps there."
        className="w-[6.5rem] slayer-field text-center"
        data-tape-jump-input
      />
      <button type="button" className="slayer-chip" disabled={!clock.hhmm} onClick={go} data-tape-jump-go>
        Go
      </button>
      {back && (
        <button type="button" className="slayer-chip" onClick={back} data-tape-jump-back>
          {latestWord}
        </button>
      )}
    </span>
  );
};

const ALERT_PACK_HINT = 'Alerts that are legs of a floor package — no side, filed in the same millisecond as alerts on the root’s other contracts';
const tapeIsoToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const alertIdOf = (p: FlowPrint) => p.vendorId || String(p.id);

const LiveTape = () => {
  const phone = useIsPhone();
  const [lane, setLane] = useState<'prints' | 'alerts'>('prints');
  const [openAlert, setOpenAlert] = useState<FlowPrint | null>(null);
  const alertTrades = useAlertTrades(lane === 'alerts' && openAlert?.alertId ? openAlert.alertId : null);
  const [frozen, setFrozen] = useState<FlowPrint[] | null>(null);
  /* the tape holds its own rows (frozen below); the hold carries only the paused state */
  const hold = useHold(null);
  const paused = hold.paused;
  const [away, setAway] = useState(false);
  const [flowFilter, setFlowFilter] = useState<FlowFilter>('ALL');
  const [sentFilter, setSentFilter] = useState<SentFilter>('ALL');
  const [minPremKey, setMinPremKey] = useState<PremKey>('0');
  const [rightKey, setRightKey] = useState<RightKey>('ALL');
  const [sideKey, setSideKey] = useState<SideKey>('ALL');
  /* the expiry is asked of the vendor too, so the tape refills with that expiry's prints from the whole session */
  const [expiryPick, setExpiryPick] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [view, setView] = useState<TapeView>('STREAM');
  const [openPrint, setOpenPrint] = useState<FlowPrint | null>(null);

  const tickerQ = searchQuery.trim().toUpperCase();
  const tickerOnly = /^[A-Z][A-Z0-9.]{0,5}$/.test(tickerQ) ? tickerQ : '';
  /* a typed contract goes to the vendor as its own symbol; a strike with a side or date as the strike and expiry filters;
     a name alone as the name. Asked once the typing settles. */
  const streamWant = useMemo(() => {
    const c = parseContractQuery(searchQuery);
    const name = tickerOnly || c?.ticker || '';
    if (!name) return '';
    const fromIso = lastRegularClose()?.iso ?? tapeSessionIso();
    const occ = contractOcc(searchQuery, fromIso);
    if (occ) return JSON.stringify({ t: name, c: occ.occ });
    const strike = c && c.strike != null && (c.right || c.month != null) ? c.strike : undefined;
    let expiry: string | undefined;
    if (c && c.month != null && c.day != null) {
      let y = c.year ?? Number(fromIso.slice(0, 4));
      const iso = (yy: number) => `${yy}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`;
      if (c.year == null && iso(y) < fromIso) y += 1;
      expiry = iso(y);
    }
    return JSON.stringify({ t: name, k: strike, r: c?.right && (strike != null || expiry) ? c.right : undefined, e: expiry });
  }, [searchQuery, tickerOnly]);
  const [streamTicker, setStreamTicker] = useState(streamWant);
  useEffect(() => {
    if (streamWant === streamTicker) return;
    const t = window.setTimeout(() => setStreamTicker(streamWant), streamWant ? 350 : 0);
    return () => window.clearTimeout(t);
  }, [streamWant, streamTicker]);
  const asked = useMemo<{ t?: string; c?: string; k?: number; r?: 'C' | 'P'; e?: string }>(() => (streamTicker ? JSON.parse(streamTicker) : {}), [streamTicker]);
  const tapeQuery = useMemo<TapeQuery>(
    () => ({
      ticker: asked.t || undefined,
      contract: asked.c,
      strike: asked.k,
      expiry: asked.e ?? expiryPick ?? undefined,
      right: asked.r ?? (rightKey === 'ALL' ? null : rightKey),
      /* the lean is cut on the page: the vendor's mid_side tag misses most no-read prints (legs, crosses, after hours);
         a fill's side refills from the vendor's ask/bid tags and is checked against the quote here */
      side: sideKey === 'ASK' || sideKey === 'BID' ? sideKey : null,
      multi: flowFilter === 'MULTI' ? true : undefined,
      /* a kind the vendor's codes can say refills the tape from the whole day; single prints and bursts cut the rows in hand */
      codes: flowFilter === 'SWEEP' ? ['isoi'] : flowFilter === 'COMPRESSION' ? ['cbmo', 'mctp'] : undefined,
      single: flowFilter === 'BLOCK' ? true : undefined,
      minSize: flowFilter === 'BLOCK' ? BLOCK_MIN_SIZE : undefined,
      minPremium: Number(minPremKey) || undefined,
    }),
    [asked, flowFilter, minPremKey, rightKey, sideKey, expiryPick]
  );
  /* paused, the stream keeps the question it had; a card changed meanwhile goes out on resume */
  const heldQuery = useRef(tapeQuery);
  if (!paused) heldQuery.current = tapeQuery;
  /* on Regular, once the session has ended the tape walks back from its 16:15 close; Extended is the live feed */
  const deskSession = useTraceSession();
  const [closedAt, setClosedAt] = useState(() => lastRegularClose());
  useEffect(() => {
    const id = window.setInterval(
      () =>
        setClosedAt(c => {
          const n = lastRegularClose();
          return n?.closeMs === c?.closeMs ? c : n;
        }),
      30_000
    );
    return () => window.clearInterval(id);
  }, []);
  const regularOnly = deskSession === 'regular';
  const anchor = regularOnly && closedAt ? closedAt : null;
  const keepRegular = useCallback((p: FlowPrint) => !p.extended, []);
  const keepExtended = useCallback((p: FlowPrint) => !!p.extended, []);
  /* the session's first instant: older pages stop there */
  const startMs = useMemo(() => {
    const iso = anchor?.iso ?? tapeSessionIso();
    const [y, m, d] = iso.split('-').map(Number);
    return regularOnly ? nyWallTime(y, m, d, 9, 30) : nyWallTime(y, m, d, 4, 0);
  }, [anchor?.iso, regularOnly]);
  /* a page of the market's tape is ~20 seconds, so a time is jumped to, not scrolled to */
  const [jumpAt, setJumpAt] = useState<number | null>(null);
  const [topSignal, setTopSignal] = useState(0);
  const dayOfTape = anchor?.iso ?? tapeSessionIso();
  useEffect(() => setJumpAt(null), [dayOfTape, regularOnly]);
  const jumpTo = useCallback(
    (hhmm: string) => {
      const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return;
      const [y, mo, d] = dayOfTape.split('-').map(Number);
      let at = nyWallTime(y, mo, d, Number(m[1]), Number(m[2]));
      /* a time at or past now is the live end: the newest page, no cursor */
      if (!anchor && at >= Date.now() - 60_000) {
        setJumpAt(null);
        setTopSignal(n => n + 1);
        return;
      }
      if (anchor && at > anchor.closeMs) at = anchor.closeMs;
      if (at <= startMs) at = startMs + 60_000;
      setJumpAt(at);
      setTopSignal(n => n + 1);
    },
    [dayOfTape, anchor?.closeMs, startMs]
  );
  const stream = usePrintStream(paused ? heldQuery.current : tapeQuery, paused || away || lane !== 'prints', { untilMs: jumpAt ?? anchor?.closeMs ?? null, keep: regularOnly ? keepRegular : keepExtended, startMs });
  const alerts = useFlowAlerts(40, { untilMs: anchor?.closeMs ?? null, session: regularOnly ? 'regular' : 'extended', enabled: lane === 'alerts' });
  const tapeDown = (lane === 'alerts' ? alerts : stream).fault != null;
  const tapeReading = lane === 'alerts' ? alerts.waiting && alerts.rows.length === 0 : stream.waiting || streamWant !== streamTicker;
  const headReading = tapeReading && !frozen;
  /* alerts in the order their Time column says: by the first fill, newest first */
  const alertsOlder = useOlderPages(`alerts:${anchor?.closeMs ?? 'live'}:${regularOnly}`, alerts.rows, alertIdOf, (inHand: FlowPrint[]) => olderAlerts(inHand, startMs, regularOnly ? 'regular' : 'extended'), lane === 'alerts' && !paused);
  const alertRows = useMemo(() => [...alertsOlder.rows].sort((a, b) => (b.epochMs ?? 0) - (a.epochMs ?? 0)), [alertsOlder.rows]);
  const liveRows = lane === 'alerts' ? alertRows : stream.rows;
  const rows = frozen ?? liveRows;
  useEffect(() => {
    /* paused before the first prints: hold at them once they land, never at an empty tape */
    if (paused) setFrozen(f => (f && f.length ? f : liveRows.length ? liveRows : null));
    else setFrozen(null);
  }, [paused, liveRows]);
  const { isWatched, toggle: toggleWatch } = useWatch();

  const summary = useMemo(() => summarizeTape(rows), [rows]);

  /* scrolled into the rows, new prints wait in the pill; back at the top they join */
  useEffect(() => {
    if (away || paused || lane !== 'prints') return;
    if (stream.pending) stream.flush();
  }, [away, paused, lane, stream]);
  const sessionWord = regularOnly ? `${anchor ? `the ${shortDay(anchor.iso)} ` : 'the '}session's start (09:30 ET)` : "the day's start (04:00 ET)";
  const endless = useMemo(() => {
    if (lane === 'alerts') {
      const n = alertsOlder.loaded;
      return {
        onNear: alertsOlder.loadOlder,
        state: paused ? ('idle' as const) : alertsOlder.state,
        note: alertsOlder.state === 'end' ? `${num(n)} alerts · ${sessionWord} reached` : alertsOlder.state === 'cap' ? `${num(n)} alerts · the most held at once` : `${num(n)} alerts · newest first`,
      };
    }
    const n = stream.rows.length;
    const state = paused ? ('idle' as const) : stream.loadingOlder ? ('loading' as const) : stream.hasOlder ? ('more' as const) : ('end' as const);
    const span = spanWords(stream.rows);
    const held = `${num(n)} print${n === 1 ? '' : 's'}${span ? `, ${span} ET` : ''}`;
    const from = jumpAt != null ? `jumped to ${nyClock(jumpAt, { zone: true })} · ` : '';
    return {
      onNear: stream.loadOlder,
      state,
      loaded: n,
      note: state === 'end' ? `${from}${held} · ${sessionWord} reached` : stream.trimmed ? `${from}${held} · newest let go to keep the page light` : `${from}${held}${paused ? ' · paused' : ''}`,
      extra: <JumpToTime onJump={jumpTo} back={jumpAt != null || stream.trimmed ? () => (jumpAt != null ? setJumpAt(null) : stream.reset()) : null} latestWord={anchor ? 'The close' : 'Latest'} />,
    };
  }, [lane, alertsOlder, stream, paused, sessionWord, jumpAt, jumpTo, anchor]);

  const { expiry, setExpiry, expiries: tapeExpiries, cut: cutExpiry, chosen: chosenExpiry } = useExpiryCut(rows, r => r.expiry, { value: expiryPick, onChange: setExpiryPick });

  /* the cut in the address: a link someone was sent wins over what this reader last had open (replace, never push) */
  const [params, setParams] = useSearchParams();
  const cuts = useSavedCuts();
  const cut: TapeCut = { view, kind: flowFilter, lean: sentFilter, prem: minPremKey, expiry, q: searchQuery, right: rightKey, side: sideKey };
  const cutQuery = cutToQuery(cut);
  const applyCut = useCallback(
    (c: TapeCut) => {
      setView(c.view);
      setFlowFilter(c.kind);
      setSentFilter(c.lean);
      setMinPremKey(c.prem);
      setSearchQuery(c.q);
      setExpiry(c.expiry);
      setRightKey(c.right);
      setSideKey(c.side);
    },
    [setExpiry]
  );
  /* both effects run in one pass: on the pass that reads a link the state has not caught up, so the writer sits that pass
     out rather than erase the link it was just handed */
  const appliedRef = useRef<string | null>(null);
  const settledRef = useRef(false);
  useEffect(() => {
    const incoming = params.toString();
    if (appliedRef.current === incoming) {
      settledRef.current = true;
      return;
    }
    appliedRef.current = incoming;
    const { cut: c, any } = queryToCut(params);
    if (any) applyCut(c);
    settledRef.current = !any;
  }, [params, applyCut]);
  useEffect(() => {
    if (!settledRef.current) {
      settledRef.current = true;
      return;
    }
    if (cutQuery === appliedRef.current) return;
    appliedRef.current = cutQuery;
    setParams(new URLSearchParams(cutQuery), { replace: true });
  }, [cutQuery, setParams]);

  /* each floor counts what it keeps, or says it refills from the vendor */
  const premOptions = useMemo<DropdownOption<PremKey>[]>(() => {
    const base = cutExpiry(rows).filter(r => (flowFilter === 'ALL' || printKind(r) === flowFilter) && (sentFilter === 'ALL' || sentimentOf(r) === sentFilter) && (rightKey === 'ALL' || r.right === rightKey) && (sideKey === 'ALL' || r.side === sideKey) && matchesTape(r, searchQuery));
    return [
      { value: '0', label: 'Any', hint: `No floor · ${num(base.length)} prints` },
      ...PREM_CHIPS.map(c => ({ value: c.value, label: c.label, hint: `Prints of ${c.label.replace('≥', '')}+, newest first from ${anchor ? 'the close' : 'now'}` })),
    ];
  }, [rows, flowFilter, sentFilter, searchQuery, cutExpiry, anchor, rightKey, sideKey]);

  const filtered = useMemo(() => {
    const minPrem = Number(minPremKey);
    return cutExpiry(rows).filter(r => (flowFilter === 'ALL' || printKind(r) === flowFilter) && (sentFilter === 'ALL' || sentimentOf(r) === sentFilter) && (rightKey === 'ALL' || r.right === rightKey) && (sideKey === 'ALL' || r.side === sideKey) && r.premium >= minPrem && matchesTape(r, searchQuery));
  }, [rows, flowFilter, sentFilter, minPremKey, searchQuery, cutExpiry, rightKey, sideKey]);

  const displayRows = useMemo(() => {
    switch (view) {
      case 'NOTABLE':
        return rankNotable(filtered);
      case 'PREMIUM':
        return [...filtered].sort((a, b) => b.premium - a.premium);
      case 'SIZE':
        return [...filtered].sort((a, b) => b.size - a.size);
      default:
        return filtered;
    }
  }, [view, filtered]);

  const wrapRef = useRef(new Map<number, TapeRow>());
  const tableRows = useMemo<TapeRow[]>(() => {
    const prev = wrapRef.current;
    const next = new Map<number, TapeRow>();
    const out = displayRows.map((p, i) => {
      const rank = view === 'STREAM' ? undefined : i + 1;
      const was = prev.get(p.id);
      const w = was && was.p === p && was.rank === rank ? was : { p, rank };
      next.set(p.id, w);
      return w;
    });
    wrapRef.current = next;
    return out;
  }, [displayRows, view]);

  const markedCount = useMemo(() => rows.reduce((n, r) => n + (isWatched(printKey(r)) ? 1 : 0), 0), [rows, isWatched]);

  /* the head reads the active cut, and renames itself to it */
  const scopeActive = searchQuery.trim() !== '' || flowFilter !== 'ALL' || sentFilter !== 'ALL' || minPremKey !== '0' || expiry !== null || rightKey !== 'ALL' || sideKey !== 'ALL';
  const beamRows = scopeActive ? filtered : rows;
  const beamSummary = useMemo(() => (scopeActive ? summarizeTape(filtered) : summary), [scopeActive, filtered, summary]);

  const whales = useMemo(() => {
    let all: FlowPrint | null = null;
    let bull: FlowPrint | null = null;
    let bear: FlowPrint | null = null;
    for (const p of beamRows) {
      if (notCrownable(p)) continue;
      if (!all || p.premium > all.premium) all = p;
      const s = sentimentOf(p);
      if (s === 'BULLISH' && (!bull || p.premium > bull.premium)) bull = p;
      if (s === 'BEARISH' && (!bear || p.premium > bear.premium)) bear = p;
    }
    return { all, bull, bear };
  }, [beamRows]);
  /* the one magenta figure: the largest print the head names */
  const champId = whales.all?.id ?? -1;

  const zdteShare = useMemo(() => (beamRows.length === 0 ? 0 : beamRows.filter(r => r.dte === 0).length / beamRows.length), [beamRows]);

  const [dayPick, setDayPick] = useState<boolean | null>(null);
  /* the whole-day panel: open at a desk, folded on a phone so the first print sits above the fold */
  const showDay = lane === 'prints' && (dayPick ?? !phone);
  /* after the close the head leads with the day, not the last prints' seconds */
  const dayFirst = lane === 'prints' && !!anchor && regularOnly && !scopeActive;
  const dayIso = anchor?.iso ?? tapeSessionIso();
  const dayOpenMs = useMemo(() => dayStartMs(dayIso), [dayIso]);
  const dayWanted = showDay || dayFirst;
  const dayTide = useTide('market', '', dayWanted);
  /* twenty, so three bets remain after the packages are set apart */
  const dayTop = useDayTopContracts(20, dayWanted);
  const dayAlerts = useDayBigAlerts(dayOpenMs, anchor?.closeMs ?? null, regularOnly ? 'regular' : 'extended', 5_000_000, 200, dayWanted);
  const dayAlertsSplit = useMemo(() => {
    const packedDay = new Set(dayTop.rows.filter(c => floorPackaged(c) || crossDay(c)).map(c => `${c.ticker}|${c.strike}|${c.right}|${c.expiry}`));
    const isPack = (a: FlowPrint) => !!a.floorPackage || packedDay.has(`${a.ticker}|${a.strike}|${a.right}|${a.expiry}`);
    const marked = dayAlerts.rows.map(a => (isPack(a) && !a.floorPackage ? { ...a, floorPackage: true } : a));
    return { bets: marked.filter(a => !a.floorPackage), packs: marked.filter(a => a.floorPackage) };
  }, [dayAlerts.rows, dayTop.rows]);
  const dayNet = useMemo(() => tideBetween(dayTide.rows, regularOnly ? 570 : 975, regularOnly ? 975 : 1440), [dayTide.rows, regularOnly]);
  const dayBets = useMemo(() => dayTop.rows.filter(c => !notABet(c)), [dayTop.rows]);
  const read = useMemo<ReadSeg[]>(() => {
    const dayLead: ReadSeg[] =
      lane === 'prints' && dayNet && regularOnly && !scopeActive
        ? [`${anchor ? `The ${shortDay(anchor.iso)} session (09:30–16:15 ET)` : `Today so far (09:30–${nyClock(dayNet.last * 1000, { zone: true })})`}: the market's net premium [[${dayNet.net >= 0 ? '+' : '−'}${fmtUsd(Math.abs(dayNet.net))}]] — net calls ${dayNet.calls >= 0 ? '+' : '−'}${fmtUsd(Math.abs(dayNet.calls))} less net puts ${dayNet.puts >= 0 ? '+' : '−'}${fmtUsd(Math.abs(dayNet.puts))}, from the market tide. `]
        : [];
    const lead: ReadSeg[] = lane === 'prints' && anchor ? [`The tape below is the session's last stretch, walked back from the 16:15 ET close${anchor.iso !== tapeIsoToday() ? ` of ${shortDay(anchor.iso)}` : ''}. `] : [];
    return dayLead.concat(
      lead,
      beamRows.length === 0 ? [tapeDown ? 'The tape did not answer.' : rows.length === 0 ? (lane === 'alerts' ? 'Reading the alerts…' : tickerOnly ? `Reading ${tickerOnly}'s prints…` : 'Reading the tape…') : `No ${lane === 'alerts' ? 'alerts' : 'prints'} in this view.`] : tapeRead(beamRows, beamSummary, lane === 'alerts' ? 'alerts' : 'prints')
    );
  }, [beamRows, beamSummary, tapeDown, rows, lane, anchor, dayNet, regularOnly, scopeActive, tickerOnly]);
  const windowSpan = useMemo(() => spanWords(rows), [rows]);
  const cutSpan = useMemo(() => (scopeActive ? spanWords(beamRows) : null), [scopeActive, beamRows]);

  /* the card knows the print's id; the store wants the print — the rows ref keeps this callback stable */
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const toggleMark = useCallback(
    (id: number) => {
      const p = rowsRef.current.find(r => r.id === id);
      if (p) toggleWatch(watchPrint(p, 'tape'));
    },
    [toggleWatch]
  );
  const keyOf = useCallback((r: TapeRow) => printId(r.p), []);
  const openRow = useCallback((r: TapeRow) => setOpenPrint(r.p), []);

  /* stepping walks the rows the reader is looking at; a print that aged out stays open, just not steerable */
  const openIdx = openPrint ? displayRows.findIndex(r => r.id === openPrint.id) : -1;
  const stepPrint = (dir: -1 | 1) => {
    if (openIdx < 0) return;
    const next = openIdx + dir;
    if (next >= 0 && next < displayRows.length) setOpenPrint(displayRows[next]);
  };
  useEffect(() => {
    if (openPrint === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      stepPrint(e.key === 'ArrowUp' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPrint, openIdx, displayRows]);

  const columns = useMemo<TapeColumn[]>(
    () => [
      {
        key: 'time',
        label: 'Time',
        header: 'Time ET',
        /* the rank rides in the cell's value, so a re-ranked row redraws its "#n" without being remounted */
        sortValue: r => (r.rank !== undefined ? -r.rank : r.p.epochMs ?? (r.p.epoch ?? 0) * 1000),
        render: r => (
          <span className="inline-flex items-center gap-1.5">
            <WatchStar k={printKey(r.p)} make={() => watchPrint(r.p, 'tape')} noun="print" />
            {r.rank !== undefined && <span className="min-w-[30px] shrink-0 text-t11 font-bold tnum text-textPrimary">#{r.rank}</span>}
            <span className="text-t11 tnum text-textPrimary whitespace-nowrap">{r.p.time}</span>
          </span>
        ),
      },
      {
        key: 'ticker',
        label: 'Ticker',
        group: 'Contract',
        header: 'Ticker',
        sortValue: r => r.p.ticker,
        render: r => (
          <span className="inline-flex items-center gap-1.5">
            <CompanyLogo ticker={r.p.ticker} size={15} />
            <span className="font-bold text-textPrimary">{r.p.ticker}</span>
          </span>
        ),
      },
      {
        key: 'contract',
        label: 'Contract',
        group: 'Contract',
        header: 'Contract · OTM %',
        align: 'right',
        sortValue: r => r.p.strike,
        render: r => <ContractCell ticker={r.p.ticker} strike={r.p.strike} right={r.p.right} expiry={r.p.expiry} dte={r.p.dte} spot={r.p.spot} otmPct={r.p.otmPct} />,
      },
      { key: 'dte', label: 'DTE', group: 'Contract', header: 'DTE', align: 'right', sortValue: r => r.p.dte, render: r => <span className="text-textPrimary">{r.p.dte}d</span> },
      { key: 'otm', label: 'OTM %', group: 'Contract', header: 'OTM %', align: 'right', sortValue: r => (r.p.spot > 0 && Number.isFinite(r.p.otmPct) ? r.p.otmPct : Number.NEGATIVE_INFINITY), render: r => <OtmCell otmPct={r.p.otmPct} ticker={r.p.ticker} spot={r.p.spot} /> },
      { key: 'quote', label: 'Fill & market', group: 'Execution', header: 'Fill & market', align: 'right', sortValue: r => r.p.fillPos, render: r => <QuoteCell print={r.p} /> },
      { key: 'size', label: 'Size, vol & OI', group: 'Execution', header: 'Size, vol & OI', align: 'right', sortValue: r => r.p.size, render: r => <SizeCell print={r.p} /> },
      {
        key: 'prem',
        label: 'Prem',
        group: 'Execution',
        header: 'Prem',
        align: 'right',
        sortValue: r => r.p.premium,
        render: r => (
          <span className={`font-mono tnum ${r.p.id === champId ? 'text-supreme font-bold' : r.p.premium >= 250_000 ? 'font-bold text-textPrimary' : 'text-textPrimary'}`}>
            <TickFigure value={r.p.premium}>{fmtUsd(r.p.premium)}</TickFigure>
          </span>
        ),
      },
      {
        key: 'dayRatio',
        label: lane === 'alerts' ? 'Alert side' : 'Day lean',
        group: 'Conviction',
        header: lane === 'alerts' ? 'Alert side' : 'Day lean',
        align: 'right',
        sortValue: r => (Number.isFinite(r.p.ratioBidPct) ? 100 - r.p.ratioBidPct : -1),
        render: r =>
          lane === 'prints' ? (
            <LeanCell askPct={100 - r.p.ratioBidPct} split={r.p.daySide} />
          ) : (
            <LeanCell askPct={100 - r.p.ratioBidPct} split={r.p.alertSides ? { ask: r.p.alertSides.ask, bid: r.p.alertSides.bid, mid: r.p.alertSides.other } : undefined} unit="premium" />
          ),
      },
      {
        key: 'sentiment',
        label: 'Sentiment',
        group: 'Conviction',
        header: 'Sentiment',
        align: 'right',
        sortValue: r => sentimentOf(r.p),
        render: r => {
          const s = sentimentOf(r.p);
          if (r.p.compression) return <span className="text-t11 font-semibold text-textSecondary" title="A compression package — nets open interest down, not a bet">compression</span>;
          if (r.p.extended) return <span className="text-t11 font-semibold text-textSecondary" title="After hours — against a post-market quote, no read">after hrs</span>;
          if (isSpreadLeg(r.p)) return <span className="text-t11 font-semibold text-textSecondary" title="One leg of a multi-leg order — Multi-Leg reads the structure">spread leg</span>;
          if (r.p.cross) return <span className="text-t11 font-semibold text-textSecondary" title="A pre-arranged cross — no side taken">cross</span>;
          if (r.p.quoteNoRead)
            return (
              <span className="inline-block text-t11 leading-tight font-semibold text-textSecondary whitespace-normal" title={r.p.quoteNoRead === 'crossed' ? `Quote crossed (bid ${r.p.bid.toFixed(2)} ≥ ask ${r.p.ask.toFixed(2)}) — no side` : 'One side of the quote was over five minutes old — no side'}>
                {quoteNoReadWords(r.p.quoteNoRead)}
              </span>
            );
          return <span className={`text-t11 font-semibold ${SENT_TEXT[s]}`}>{s}</span>;
        },
      },
      { key: 'vol', label: 'Vol', group: 'Activity', header: 'Vol', align: 'right', sortValue: r => r.p.volume, render: r => <span className="text-textPrimary">{num(r.p.volume)}</span> },
      { key: 'oi', label: 'OI', group: 'Activity', header: 'OI', align: 'right', sortValue: r => r.p.oi, render: r => <span className="text-textPrimary">{num(r.p.oi)}</span> },
      {
        key: 'volOverOi',
        label: 'Vol/OI',
        group: 'Activity',
        header: 'Vol/OI',
        align: 'right',
        sortValue: r => r.p.volOverOI,
        render: r => <span className={`font-mono tnum ${r.p.volOverOI >= FRESH_VOL_OI ? 'font-bold text-textPrimary' : 'text-textPrimary'}`} title={r.p.oi > 0 ? undefined : 'No open interest before the session — a new contract'}>{volOiText(r.p)}</span>,
      },
      { key: 'iv', label: 'IV', group: 'Activity', header: 'IV', align: 'right', sortValue: r => r.p.iv, render: r => <span className="font-mono tnum text-textPrimary">{r.p.iv.toFixed(0)}%</span> },
      {
        key: 'tag',
        label: 'Kind',
        group: 'Activity',
        header: 'Kind',
        sortValue: r => printKind(r.p),
        render: r => {
          const k = printKind(r.p);
          return (
            <span className="text-t11 text-textSecondary" title={k === 'COMPRESSION' ? 'A compression package — not a bet' : r.p.trades ? `A flow alert of ${r.p.trades} prints${k === 'BURST' ? '; its largest trade is not known to be a block' : ''}` : k === 'MULTI' ? 'A leg of a multi-leg order' : undefined}>
              {k === 'SWEEP' ? <span className="text-warn font-semibold">Sweep</span> : KIND_WORD[k]}
              {r.p.trades && r.p.trades > 1 ? <span className="text-textMuted"> · {r.p.trades} prints</span> : null}
            </span>
          );
        },
      },
    ],
    [champId, lane]
  );

  /* the compound cells carry the DTE, the distance, the volume and the OI: those four open folded */
  const { hidden, toggle, showAll, hideAll } = useHiddenColumns(COLS_KEY, ['dte', 'otm', 'vol', 'oi']);
  const chooserCols = useMemo(() => columns.filter(c => c.key !== 'time').map(c => ({ key: c.key, label: c.label, group: c.group })), [columns]);
  const [guideOpen, setGuideOpen] = useState(false);

  /* a pill says the side as a word ("sold"), or why there is none */
  const pill = (p: FlowPrint) => (
    <>
      {p.ticker} {p.strike}
      {p.right} {p.compression ? 'compression' : p.extended ? 'after hours' : isSpreadLeg(p) ? 'spread leg' : p.cross ? 'cross' : p.side === 'ASK' ? 'bought' : p.side === 'BID' ? 'sold' : 'mid'} · {fmtUsd(p.premium)}
      {stockLike(p) && <span title={STOCK_LIKE_HINT}> · stock-like</span>}
    </>
  );

  /* with one name typed: its contracts by the day's premium, the screener's whole day */
  const topDay = useNameTopContracts(tickerOnly || null, 20);
  const nameDay = useMemo(() => {
    const packs = topDay.rows.filter(c => notABet(c));
    const biggest = topDay.rows.filter(c => !notABet(c)).reduce<(typeof topDay.rows)[number] | null>((a, c) => (a === null || c.premium > a.premium ? c : a), null);
    const sided = topDay.rows
      .filter(c => !notABet(c) && !stockLike(c))
      .map(c => ({ c, lean: dayLean(c) }))
      .filter(x => x.lean.lean === 'ASK' || x.lean.lean === 'BID')
      .sort((a, b) => b.c.premium - a.c.premium);
    return { sided, packs, biggest };
  }, [topDay.rows]);

  const readNode = read.map((seg, i) =>
    typeof seg === 'string' ? (
      <RichRead key={i} text={seg} />
    ) : (
      <ReadDoor key={i} onOpen={() => setOpenPrint(seg.print)}>
        {seg.label}
      </ReadDoor>
    )
  );
  const openCut = (q: string) => setParams(new URLSearchParams(q), { replace: true });
  const leadLine = useMemo(() => {
    const noun = lane === 'alerts' ? 'alerts' : 'prints';
    if (tapeDown && beamRows.length === 0) return 'The tape did not answer — it fills when the feed does.';
    if (headReading && !dayFirst) return lane === 'alerts' ? 'Reading the alerts…' : searchQuery.trim() ? `Reading the prints for ${searchQuery.trim()}…` : 'Reading the tape…';
    const day = lane === 'prints' && dayNet && !scopeActive && regularOnly ? `The market leaned ${dayNet.net >= 0 ? 'bullish' : 'bearish'} ${anchor ? dayAdv(anchor.iso) : 'so far today'}: ${fmtUsd(Math.abs(dayNet.net))} more net into ${dayNet.net >= 0 ? 'calls' : 'puts'}.` : '';
    if (dayFirst) return day || `The ${shortDay(anchor!.iso)} session has closed.`;
    if (beamRows.length === 0) return searchQuery.trim() ? `No ${noun} for ${searchQuery.trim()} ${dayAdv(dayIso)}.` : `${day} No ${noun} in this view.`.trim();
    const who = searchQuery.trim() ? `${searchQuery.trim()}: ` : '';
    if (beamSummary.bullPremium === 0 && beamSummary.bearPremium === 0) return `${day} ${who}${num(beamRows.length)} ${noun}, none with a clear side.`.trim();
    const bull = beamSummary.bullPremium >= beamSummary.bearPremium;
    return `${day} ${who}${num(beamRows.length)} ${noun}: ${fmtUsd(bull ? beamSummary.bullPremium : beamSummary.bearPremium)} ${bull ? 'bullish' : 'bearish'} vs ${fmtUsd(bull ? beamSummary.bearPremium : beamSummary.bullPremium)}.`.trim();
  }, [lane, tapeDown, beamRows, headReading, searchQuery, dayNet, scopeActive, regularOnly, anchor, beamSummary, dayIso, dayFirst]);

  const windowFacts = (
    <>
      <Fact label={anchor && lane === 'prints' ? 'Last prints' : 'Window'} testId="window" title="The first and last print in this view, New York — the head covers only these">
        {headReading ? <span className="text-textMuted">—</span> : windowSpan ? `${windowSpan} ET` : '—'}
        {cutSpan && cutSpan !== windowSpan && <span className="text-textSecondary"> · cut {cutSpan}</span>}
        {lane === 'prints' && jumpAt != null && <span className="text-textSecondary"> · from {nyClock(jumpAt, { zone: true })}</span>}
      </Fact>
      <Fact label={lane === 'alerts' ? 'Flow alerts' : 'Prints'} testId="prints" title={lane === 'alerts' ? 'Each alert is a burst of prints on one contract' : 'The newest stretch; older pages load as you scroll'}>
        {headReading ? (
          <span className="text-textMuted">—</span>
        ) : searchQuery.trim() && filtered.length === 0 && rows.length > 0 ? (
          <span className="text-textSecondary" data-tape-search-none>
            none for {searchQuery.trim()}
          </span>
        ) : (
          <>
            {num(filtered.length)} <span className="text-textSecondary">of {num(rows.length)} · {markedCount} tracked</span>
          </>
        )}
      </Fact>
      <Fact label="Premium" testId="premium" title={`Call and put premium in this view${beamSummary.compression.count ? '; compression left out' : ''}`}>
        {headReading ? (
          <span className="text-textMuted">—</span>
        ) : (
          <>
            <span className="text-bull">{beamSummary.callCount}C</span> {fmtUsd(beamSummary.callPremium)} <span className="text-textSecondary">/</span> <span className="text-bear">{beamSummary.putCount}P</span> {fmtUsd(beamSummary.putPremium)}
          </>
        )}
      </Fact>
      <Fact label="Sweeps · blocks · multi" testId="kinds" title={`Blocks: one leg, ${BLOCK_MIN_SIZE}+ contracts or $${BLOCK_MIN_PREMIUM / 1000}K+; ${beamSummary.other} single prints besides`}>
        {headReading ? <span className="text-textMuted">—</span> : <>{num(beamSummary.sweeps)} <span className="text-textSecondary">·</span> {num(beamSummary.blocks)} <span className="text-textSecondary">·</span> {num(beamSummary.multi)}</>}
      </Fact>
      <Fact label="P/C premium" testId="pc" title="Put premium over call premium, this view only">
        {!headReading && beamSummary.callPremium > 0 ? beamSummary.pcRatio.toFixed(2) : '—'}
      </Fact>
      {beamSummary.compression.count > 0 && (
        <Fact label="Compression" testId="compression" title="OPRA cbmo / mctp packages — not bets, in no other figure">
          {num(beamSummary.compression.count)} <span className="text-textSecondary">· {fmtUsd(beamSummary.compression.premium)}</span>
        </Fact>
      )}
      {beamSummary.spreadLegs.count > 0 && (
        <Fact label="Spread legs" testId="spread-legs" title="Legs of multi-leg orders — in the call/put money, never a side's total or a crown">
          {num(beamSummary.spreadLegs.count)} <span className="text-textSecondary">· {fmtUsd(beamSummary.spreadLegs.premium)}</span>
        </Fact>
      )}
      <Fact label="0DTE share" testId="odte" title="Prints on contracts expiring the day they printed">
        {headReading ? <span className="text-textMuted">—</span> : <span className="text-textPrimary">{(Math.round(zdteShare * 1000 + 1e-9) / 10).toFixed(1)}%</span>}
      </Fact>
    </>
  );
  const dayTopBet = dayBets[0] ?? null;
  const dayAlertTop = dayAlertsSplit.bets[0] ?? null;
  const dayFacts = (
    <>
      <Fact label="Market net" testId="day-net" title={`The market tide's net, 09:30–16:15 ET ${dayAdv(dayIso)}. ${VENDOR_TOTAL_NOTE}`}>
        {dayNet ? <span className={dayNet.net >= 0 ? 'text-bull' : 'text-bear'}>{dayNet.net >= 0 ? '+' : '−'}{fmtUsd(Math.abs(dayNet.net))}</span> : <span className="text-textMuted">{dayTide.waiting ? '…' : '—'}</span>}
        {dayNet && <span className="text-textSecondary"> · {shortDay(dayIso)}</span>}
      </Fact>
      <Fact label="Net calls · puts" testId="day-sides" title="Net call and net put premium; puts bought lean bearish">
        {dayNet ? (
          <>
            <span className={dayNet.calls >= 0 ? 'text-bull' : 'text-bear'}>{dayNet.calls >= 0 ? '+' : '−'}{fmtUsd(Math.abs(dayNet.calls))}</span> <span className="text-textSecondary">·</span> <span className={dayNet.puts >= 0 ? 'text-bear' : 'text-bull'}>{dayNet.puts >= 0 ? '+' : '−'}{fmtUsd(Math.abs(dayNet.puts))}</span>
          </>
        ) : (
          <span className="text-textMuted">—</span>
        )}
      </Fact>
      {dayTopBet && (
        <Champion label="Most premium" ink="supreme" title={`The day's heaviest single bet, ${leanWords(dayLean(dayTopBet))}`} onOpen={() => setOpenPrint({ ...bookRowToPrint(dayTopBet), occ: dayTopBet.optionSymbol })} testId="day-top">
          {dayTopBet.ticker} {dayTopBet.strike}
          {dayTopBet.right} · {fmtUsd(dayTopBet.premium)}
        </Champion>
      )}
      {dayAlertTop && (
        <Champion label="Largest alert" ink="plain" title="The day's largest flow alert of $5M+" onOpen={() => setOpenPrint(dayAlertTop)} testId="day-alert">
          {pill(dayAlertTop)}
        </Champion>
      )}
      <Fact label="Last prints" testId="window" title="The stretch the tape below holds, walked back from the close">
        {headReading ? <span className="text-textMuted">—</span> : windowSpan ? `${windowSpan} ET` : '—'}
      </Fact>
    </>
  );

  return (
    <>
      <TraceBox
        title="The tape"
        sub={anchor && view === 'STREAM' ? 'Last session, newest first' : `${VIEW_META[view].label} — ${VIEW_META[view].hint}`}
        testId="live-tape"
        foldOnPhone
        data={{ view, prints: filtered.length, expiry: expiry ?? 'all' }}
        guide={{ title: 'How to read the tape', door: 'What a print, its fill and its side mean', body: <LiveTapeGuide />, testId: 'live-tape-guide', open: guideOpen, onOpen: setGuideOpen }}
        facts={
          dayFirst ? (
            dayFacts
          ) : (
            <>
              {windowFacts}
              {tickerOnly && topDay.rows.length > 0 && (
                <Fact label={`${tickerOnly} · day leaders`} testId="name-day" wrap title={`${tickerOnly}'s heaviest contracts with a clear side ${dayAdv(dayIso)}, from the screener — the whole day, not these prints`}>
                  {nameDay.sided.length === 0 ? (
                    <span className="text-textSecondary">no clear side on the heaviest contracts</span>
                  ) : (
                    nameDay.sided.slice(0, 2).map((x, i) => (
                      <span key={x.c.key}>
                        {i > 0 && <span className="text-textSecondary"> · </span>}
                        {x.c.strike}
                        {x.c.right} {expiryLabel(x.c.expiry)} {fmtUsd(x.c.premium)} <span className="text-textPrimary">leans {x.lean.lean === 'ASK' ? 'bought' : 'sold'}</span> <span className="text-textSecondary">{leanWords(x.lean)}</span>
                      </span>
                    ))
                  )}
                  {nameDay.biggest && nameDay.sided.length > 0 && nameDay.biggest.key !== nameDay.sided[0].c.key && (
                    <span className="text-textSecondary" title="The biggest by premium, its side not clear" data-name-day-biggest>
                      {' '}
                      · biggest {nameDay.biggest.strike}
                      {nameDay.biggest.right} {fmtUsd(nameDay.biggest.premium)} ({leanWords(dayLean(nameDay.biggest))})
                    </span>
                  )}
                  {nameDay.packs.length > 0 && <span className="text-textMuted" title={nameDay.packs.map(c => `${c.strike}${c.right} ${fmtUsd(c.premium)} — ${notABetWord(c)}`).join('\n')}> · {num(nameDay.packs.length)} not bets</span>}
                </Fact>
              )}
              {whales.bull && whales.bull !== whales.all && (
                <Champion label={lane === 'alerts' ? 'Top bull alert' : 'Top bull'} ink="bull" title="The biggest bullish print in view: a call bought or a put sold" onOpen={() => setOpenPrint(whales.bull)} testId="bull">
                  {pill(whales.bull)}
                </Champion>
              )}
              {whales.bear && whales.bear !== whales.all && (
                <Champion label={lane === 'alerts' ? 'Top bear alert' : 'Top bear'} ink="bear" title="The biggest bearish print in view: a put bought or a call sold" onOpen={() => setOpenPrint(whales.bear)} testId="bear">
                  {pill(whales.bear)}
                </Champion>
              )}
              {whales.all && (
                <Champion label={lane === 'alerts' ? 'Largest alert' : 'Largest'} ink="supreme" title={`The most premium in view${whales.all === whales.bull ? ' — also the top bull' : whales.all === whales.bear ? ' — also the top bear' : ''}`} onOpen={() => setOpenPrint(whales.all)} testId="largest">
                  {pill(whales.all)}
                </Champion>
              )}
            </>
          )
        }
        controls={
          <>
            <LiveHold paused={paused} onToggle={hold.toggle} heldAt={hold.heldAt} waitingFirst={paused && !frozen} />
            {/* a closed session's stretch is complete, not stale */}
            {(!(lane === 'prints' && anchor) || stream.kept) && <SessionMark at={(lane === 'alerts' ? alerts : stream).at} fault={(lane === 'alerts' ? alerts : stream).fault} paused={paused} kept={(lane === 'alerts' ? alerts : stream).kept} />}
            <span data-tape-lane>
              <DropdownSelect label="Tape" value={lane} options={LANE_OPTIONS} onChange={setLane} title="Every trade, or flow alerts" testId="tape-lane" />
            </span>
            <span className={lane === 'prints' ? undefined : 'invisible pointer-events-none'} aria-hidden={lane === 'prints' ? undefined : true} data-tape-day-toggle>
              <DropdownSelect label="Whole day" value={showDay ? 'on' : 'off'} options={DAY_PANEL} onChange={v => lane === 'prints' && setDayPick(v === 'on')} title="The whole-day panel — not a filter" testId="tape-day" />
            </span>
            <FlowSearch value={searchQuery} onChange={setSearchQuery} rows={rows} span />
            <DropdownSelect label="Order" value={view} options={ORDER_OPTIONS} onChange={setView} title="How the prints are ordered" testId="tape-order" />
            <DropdownSelect label="Kind" value={flowFilter} options={KIND_OPTIONS} onChange={setFlowFilter} title="Sweeps, blocks, multi-leg or single prints" testId="tape-kind" />
            <DropdownSelect label="Lean" value={sentFilter} options={LEAN_OPTIONS} onChange={setSentFilter} title="Bullish, bearish or no-read prints" testId="tape-lean" />
            <DropdownSelect label="Type" value={rightKey} options={RIGHT_OPTIONS} onChange={setRightKey} title="Calls, puts or both" testId="tape-type" />
            <DropdownSelect label="Side" value={sideKey} options={SIDE_OPTIONS} onChange={setSideKey} title="Where the fill sat against its quote" testId="tape-side" />
            <DropdownSelect label="Premium" value={minPremKey} options={premOptions} onChange={setMinPremKey} title="The smallest print shown" testId="tape-premium" />
            <ExpiryCalendar value={chosenExpiry ? isoDate(chosenExpiry.date) : ''} expiries={tapeExpiries} onChange={e => setExpiry(isoDate(e.date))} onClear={() => setExpiry(null)} label="Expiry" icon={CalendarDays} steppers={false} title="One expiry, or every expiry" testId="tape-expiry" />
            <SavedCutsControl store={TAPE_CUTS} query={cutQuery} onOpen={openCut} noun="cut" testId="tape" onSay={cuts.say} open={cuts.open} onToggleOpen={cuts.toggle} />
            <span className="ml-auto flex items-center gap-2">
              <ColumnChooser columns={chooserCols} hidden={hidden} onToggle={toggle} onAll={showAll} onNone={() => hideAll(chooserCols.map(c => c.key))} groupOrder={TAPE_GROUP_ORDER} />
            </span>
          </>
        }
        sentence={
          <>
            <SavedCutsList store={TAPE_CUTS} query="" onOpen={openCut} noun="cut" testId="tape" onSay={cuts.say} open={cuts.open} />
            {cuts.said && (
              <p role="status" className="mb-2 font-mono text-t11 text-textSecondary" data-tape-said>
                {cuts.said}
              </p>
            )}
          </>
        }
        lead={leadLine}
        detail={
          <>
            {dayFirst && <dl className="mb-2 flex flex-wrap gap-x-6 gap-y-2">{windowFacts}</dl>}
            {readNode}
            <TermLine keys={['spreadLegs', 'floor', 'stockLike', 'volOi']} testId="live-tape" />
          </>
        }
      >
        <div data-tape-body>
          {showDay && (
            <div className="px-5 py-3 border-t border-borderSubtle flex flex-col gap-2" data-tape-day>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="font-mono text-t11 uppercase tracking-widest text-textPrimary">The whole day</span>
                <span className="text-t11 text-textMuted">
                  {dayAdv(dayIso) === 'today' ? 'Today' : shortDay(dayIso)} · {regularOnly ? (anchor ? '09:30–16:15 ET' : 'from 09:30 ET') : 'outside the regular session'} · the tide, the screener and the alerts, not the prints below
                </span>
              </div>
              <div className="grid gap-x-8 gap-y-2 md:grid-cols-3 text-t11">
                <div className="min-w-0" data-tape-day-tide>
                  <div className="text-textMuted" title={`The market tide. ${VENDOR_TOTAL_NOTE}`}>
                    Market net premium
                  </div>
                  {dayNet ? (
                    <div className="font-mono tnum text-textPrimary">
                      <span className={dayNet.net >= 0 ? 'text-bull' : 'text-bear'}>
                        {dayNet.net >= 0 ? '+' : ''}
                        {fmtUsd(dayNet.net)}
                      </span>
                      <span className="text-textSecondary"> = net calls </span>
                      <span className={dayNet.calls >= 0 ? 'text-bull' : 'text-bear'}>
                        {dayNet.calls >= 0 ? '+' : ''}
                        {fmtUsd(dayNet.calls)}
                      </span>
                      <span className="text-textSecondary"> less net puts </span>
                      <span className={dayNet.puts >= 0 ? 'text-bear' : 'text-bull'}>
                        {dayNet.puts >= 0 ? '+' : ''}
                        {fmtUsd(dayNet.puts)}
                      </span>
                      <span className="text-textSecondary">
                        {' '}
                        · {nyClock(dayNet.first * 1000)}–{nyClock(dayNet.last * 1000, { zone: true })}
                      </span>
                    </div>
                  ) : (
                    <div className="font-mono text-textMuted">{dayTide.waiting ? '…' : '—'}</div>
                  )}
                </div>
                <div className="min-w-0" data-tape-day-top>
                  <div className="text-textMuted" title="The screener's heaviest contracts by the day's premium, each with its lean; packages and spread legs apart">
                    Most premium {dayAdv(dayIso)}
                  </div>
                  {dayTop.rows.length ? (
                    <>
                      {dayBets.slice(0, 3).map(c => (
                        <div key={c.key} className="font-mono tnum text-textPrimary break-words sm:truncate">
                          {c.ticker} {c.strike}
                          {c.right} {expiryLabel(c.expiry)} · {fmtUsd(c.premium)} <span className="text-textSecondary">{leanWords(dayLean(c))}</span>
                          {stockLike(c) && (
                            <span className="text-warn" title={STOCK_LIKE_HINT}>
                              {' '}
                              · stock-like
                            </span>
                          )}
                        </div>
                      ))}
                      {(() => {
                        const packs = dayTop.rows.filter(c => notABet(c)).slice(0, 3);
                        return packs.length ? (
                          <div className="font-mono tnum text-textSecondary break-words" title={packs.map(c => `${c.ticker} ${c.strike}${c.right} — ${notABetHint(c)}`).join('\n')} data-tape-day-packages>
                            <span className="text-warn">{notABetLabel(packs)} · not a bet:</span> {packs.map(c => `${c.ticker} ${c.strike}${c.right} ${expiryLabel(c.expiry)} ${fmtUsd(c.premium)}`).join(' · ')}
                          </div>
                        ) : null;
                      })()}
                    </>
                  ) : (
                    <div className="font-mono text-textMuted">{dayTop.waiting ? '…' : '—'}</div>
                  )}
                </div>
                <div className="min-w-0" data-tape-day-alerts>
                  <div className="text-textMuted" title="Flow alerts of $5M+ in the session, largest first; an alert's side is the one lean rule over its premium">
                    Largest flow alerts · $5M+
                  </div>
                  {dayAlertsSplit.bets.length || dayAlertsSplit.packs.length ? (
                    <>
                      {dayAlertsSplit.bets.slice(0, 3).map(a => (
                        <button key={a.id} type="button" onClick={() => setOpenPrint(a)} className="block w-full py-1 text-left font-mono tnum text-textPrimary break-words sm:truncate hover:text-silver" data-tape-day-alert>
                          {a.ticker} {a.strike}
                          {a.right} {expiryLabel(a.expiry)} · {fmtUsd(a.premium)} <span className="text-textSecondary">{a.side === 'ASK' ? 'at the ask' : a.side === 'BID' ? 'on the bid' : 'no side'} · {a.time}</span>
                        </button>
                      ))}
                      {dayAlertsSplit.packs.length > 0 && (
                        <button type="button" onClick={() => setOpenPrint(dayAlertsSplit.packs[0])} className="block w-full py-1 text-left font-mono tnum text-textSecondary break-words sm:truncate hover:text-silver" title={ALERT_PACK_HINT} data-tape-day-alert-pack>
                          <span className="text-warn">floor package · not a bet</span> · {num(dayAlertsSplit.packs.length)} alert{dayAlertsSplit.packs.length === 1 ? '' : 's'}, {fmtUsd(dayAlertsSplit.packs.reduce((a, p) => a + p.premium, 0))}
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="font-mono text-textMuted">{dayAlerts.waiting ? '…' : 'none'}</div>
                  )}
                </div>
              </div>
            </div>
          )}
          {lane === 'alerts' && openAlert && (
            <div className="px-5 py-2 border-b border-borderSubtle flex items-center gap-3" data-alert-trades>
              <span className="font-mono text-t11 text-textSecondary">
                Trades inside {openAlert.ticker} {openAlert.strike}
                {openAlert.right}
              </span>
              <button type="button" className="font-mono text-t11 uppercase tracking-wider text-textMuted" onClick={() => setOpenAlert(null)}>
                Close
              </button>
              {alertTrades.fault && alertTrades.rows.length === 0 ? <FeedFallback fault={alertTrades.fault} /> : <span className="font-mono text-t11 tabular-nums text-textPrimary">{alertTrades.waiting ? '…' : `${num(alertTrades.rows.length)} prints`}</span>}
            </div>
          )}
          {lane === 'alerts' && openAlert && alertTrades.rows.length > 0 && (
            <ul className="px-5 py-1 border-b border-borderSubtle" data-alert-trade-list>
              {alertTrades.rows.slice(0, 8).map(p => (
                <li key={printId(p)} className="flex items-center gap-3 py-0.5 font-mono text-t11 text-textSecondary">
                  <span className="text-textPrimary">{p.time}</span>
                  <span>
                    {p.ticker} {p.strike}
                    {p.right}
                  </span>
                  <span className="ml-auto tabular-nums text-textPrimary">
                    <TickFigure value={p.premium}>{fmtUsd(p.premium)}</TickFigure>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {lane === 'prints' && stream.pending > 0 && away && (
            <div className="sticky top-0 z-20 flex justify-center py-1.5 bg-panel/80" data-new-prints>
              <button
                type="button"
                onClick={() => {
                  stream.flush();
                  setTopSignal(n => n + 1);
                  setAway(false);
                }}
                className="rounded-full border border-borderSubtle bg-chip px-3 py-1 font-mono text-t11 text-textPrimary"
              >
                {stream.pending} new print{stream.pending === 1 ? '' : 's'} ↑
              </button>
            </div>
          )}
          <TraceGrid
            rows={tableRows}
            columns={columns}
            hidden={hidden}
            widths={view === 'STREAM' ? WIDTHS : WIDTHS_RANKED}
            flexes={FLEXES}
            tooltips={TOOLTIPS}
            rowKey={keyOf}
            onRowClick={r => {
              openRow(r);
              if (lane === 'alerts') setOpenAlert(r.p);
            }}
            selectedKey={openPrint ? printId(openPrint) : null}
            pinLeft={PIN_LEFT}
            pinRight={PIN_RIGHT}
            phoneRow={phoneRow}
            rowClass={FADE_ROW}
            animate={false}
            autoHeight
            endless={endless}
            onDeep={setAway}
            topSignal={topSignal}
            emptyText={
              tapeReading && !frozen
                ? tickerOnly
                  ? `Reading ${tickerOnly}'s prints…`
                  : lane === 'alerts'
                    ? 'Reading the alerts…'
                    : 'Reading the tape…'
                : rows.length === 0
                  ? tapeDown
                    ? 'This read did not land — the tape fills when the feed answers'
                    : searchQuery.trim()
                      ? `No ${lane === 'alerts' ? 'alerts' : 'prints'} for “${searchQuery.trim()}” ${dayAdv(dayIso)} — try a ticker or a contract (${CONTRACT_FORMATS})`
                      : `No ${lane === 'alerts' ? 'alerts' : 'prints'} in this view ${dayAdv(dayIso)}`
                  : searchQuery.trim()
                    ? searchMiss(searchQuery, lane === 'alerts' ? 'alert loaded' : 'print loaded')
                    : 'No prints on this cut — loosen a card'
            }
            testId="live-tape"
          />
        </div>
      </TraceBox>

      <PrintDrilldown
        print={openPrint}
        onClose={() => setOpenPrint(null)}
        isMarked={openPrint ? isWatched(printKey(openPrint)) : false}
        onToggleMark={toggleMark}
        onStep={stepPrint}
        hasPrev={openIdx > 0}
        hasNext={openIdx >= 0 && openIdx < displayRows.length - 1}
        tapeRows={rows}
        tapeNoun={lane === 'alerts' ? 'alerts' : 'prints'}
        onOpenPrint={setOpenPrint}
      />
    </>
  );
};

export default LiveTape;
