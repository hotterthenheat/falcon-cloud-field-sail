/*
==================================================
  SLAYER TERMINAL - LIVE TAPE (pages/trace/LiveTape.tsx)

  Streaming rich options prints in the house
  grammar — the page every other Trace table was
  cut to match, now cut to match THEM.
==================================================

  ONE TABLE, ONE HEAD (Noah, 2026-09-03, holding the Screener beside the
  tape: "live tape is nowhere near the same height as the rest of the
  subpages of trace so it looks offputting. also the formatting of the
  rows is not the same") — and since the walk (2026-09-09) the tape is
  the same house box as every Trace page: the head with the view's
  facts and its three whales as champions; one line of cards; the tape
  read as the sentence; the AG Grid in its window.

  THE PARTNER'S LAYOUT (Noah, 2026-10-13: "add his link and save buttons
  to our tape also im noticing his layouting is different on the tape so
  make it his aswell"): the contract cell carries the days left, the spot
  and the distance under the contract; "Fill & market" is the fill with
  its side as a word over the bid and the ask it crossed into; "Size, vol
  & OI" is the size over the day's volume and the standing interest; the
  kinds are sweeps, blocks, multi-leg and single prints; the time, the
  ticker and the contract stand still at the left while the rest scroll
  and the premium stands at the right; an Expiry card cuts the tape to
  one date; Link copies the address of this exact cut and Save keeps it
  by name (the cut lives in the URL, components/trace/SavedCuts.tsx); on a
  phone a print is two lines. The side rail (top names, the dark pool's
  crosses) is gone with it — the dark pool has its own page.

  KEPT OURS: THE HOLD. The tape's Live/Pause stays (Noah, 2026-10-13:
  "keep our pause button in live tape") — book and tick freeze together
  while paused, and "as of 14:03 ET" says when.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import { useMarketData } from '../../context/MarketDataContext';
import { dayLean, indexRoot, lastRegularClose, plural, tapeSessionIso, tideBetween, useDayBigAlerts, useDayTopContracts, useTide, useAlertTrades, useFlowAlerts, useNameTopContracts, usePrintStream, usd as fmtUsd, TAPE_CAP, type TapeQuery } from '../../data/traceLive';
import { useTraceSession } from '../../components/trace/traceSession';
import { nyClock } from '../../core/nyTime';
import { FLOW_TTL_MS, FeedFallback, StaleMark, TickFigure } from '../../components/ui/liveRead';
import { printKey, useWatch, watchPrint } from '../../context/WatchContext';
import WatchStar from '../../components/trace/WatchStar';
import { LiveHold, useHold } from '../../components/trace/LiveHold';
import { BLOCK_MIN_PREMIUM, BLOCK_MIN_SIZE, isSpreadLeg, printKind, rankNotable, sentimentOf, summarizeTape, type PrintKind } from '../../data/tape';
import CompanyLogo from '../../components/ui/CompanyLogo';
import type { Column } from '../../components/ui/DataTable';
import DropdownSelect, { type DropdownOption } from '../../components/ui/DropdownSelect';
import RichRead from '../../components/ui/RichRead';
import PrintDrilldown from '../../components/trace/PrintDrilldown';
import ReadDoor from '../../components/trace/ReadDoor';
import FlowSearch from '../../components/trace/FlowSearch';
import ContractCell from '../../components/trace/ContractCell';
import LeanCell from '../../components/trace/LeanCell';
import ColumnChooser, { useHiddenColumns } from '../../components/trace/ColumnChooser';
import { SavedCutsControl, SavedCutsList, useSavedCuts } from '../../components/trace/SavedCuts';
import { createViewStore } from '../../data/savedViews';
import TraceBox, { Champion, Fact, PhoneRow, TraceGrid } from '../../components/trace/TraceBox';
import ExpiryCalendar from '../../components/ui/ExpiryCalendar';
import { useExpiryCut } from '../../components/trace/bookExpiry';
import { isoDate } from '../../core/calendar';
import { expiryLabel, pctSigned } from '../../core/format';
import { LiveTapeGuide } from '../../components/trace/TraceGuide';
import type { FlowPrint, PrintSentiment, TapeSummary } from '../../types/trace';
import { floorPackaged, FRESH_VOL_OI, stockLike, STOCK_LIKE_HINT, VENDOR_TOTAL_NOTE, volOiText } from '../../data/flowBook';
import { shyPct } from '../../components/trace/dayWords';
import { dayAdv, shortDay, spanWords } from '../../components/trace/dayWords';

const MAX_ROWS = 120;
/* The shared chooser stores the HIDDEN set (see ColumnChooser); the old
   key held the visible one, so this is a new key rather than a misread. */
const COLS_KEY = 'slayer_tape_hidden_v2';

type FlowFilter = 'ALL' | PrintKind;
/** The tape's ordering lens (Noah, 2026-08-19: "quickly switch between newest
    prints, largest premium, largest size, bullish flow, and bearish flow").
    Ordering is this axis; bullish/bearish is the DIRECTION axis (the
    sentiment filter), so the two compose — largest bullish premium is
    Premium + Bullish, not a fifth preset. */
type TapeView = 'STREAM' | 'NOTABLE' | 'PREMIUM' | 'SIZE';

const VIEW_META: Record<TapeView, { label: string; hint: string }> = {
  STREAM: { label: 'Stream', hint: "The clock's order, newest first" },
  NOTABLE: { label: 'Notable', hint: 'Conviction-ranked — the prints that matter most first' },
  PREMIUM: { label: 'Premium', hint: 'Biggest dollars first' },
  SIZE: { label: 'Size', hint: 'Most contracts first' },
};
type SentFilter = 'ALL' | PrintSentiment;
type PremKey = '0' | '100000' | '500000' | '1000000';

/* THE CUT IS THE ADDRESS (data/savedViews, the partner's tape): the tape —
   the surface a trader most wants to hand someone, because what is on it
   right now is the whole point — had no way to send or save a thing. Only
   what DIFFERS from the default tape is written, so an untouched tape has a
   clean URL and a shared one carries exactly the decisions that were made. */
const TAPE_CUTS = createViewStore('slayer_tape_cuts_v1');
interface TapeCut {
  view: TapeView;
  kind: FlowFilter;
  lean: SentFilter;
  prem: PremKey;
  expiry: string | null;
  q: string;
}
const TAPE_CUT_DEFAULT: TapeCut = { view: 'STREAM', kind: 'ALL', lean: 'ALL', prem: '0', expiry: null, q: '' };
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
  return p.toString();
}

/** A URL is user input, so every field is validated rather than trusted — a
    value the tape does not know falls back to the default rather than
    filtering the whole tape away and leaving a reader staring at nothing. */
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
    },
    any: ['order', 'kind', 'lean', 'prem', 'exp', 'q'].some(k => p.has(k)),
  };
}

const PREM_CHIPS: { value: Exclude<PremKey, '0'>; label: string }[] = [
  { value: '100000', label: '≥$100K' },
  { value: '500000', label: '≥$500K' },
  { value: '1000000', label: '≥$1M' },
];

/* The cuts as cards on the controls line (the walk, 2026-09-09) */
const ORDER_OPTIONS: DropdownOption<TapeView>[] = (Object.keys(VIEW_META) as TapeView[]).map(v => ({ value: v, label: VIEW_META[v].label, hint: VIEW_META[v].hint }));
/* THE KINDS SAY WHAT THEY COUNT: a block is size in one print, a print with legs is its own kind, and the rest are
   single prints — every non-sweep was a "block" before */
const KIND_OPTIONS: DropdownOption<FlowFilter>[] = [
  { value: 'ALL', label: 'Every kind', hint: 'Every print' },
  { value: 'SWEEP', label: 'Sweeps', hint: "Orders swept across exchanges (OPRA isoi) — asked of the vendor, so the tape refills with the day's sweeps" },
  { value: 'BLOCK', label: 'Blocks', hint: `One leg, ${BLOCK_MIN_SIZE} contracts and up in one print — asked of the vendor; one-leg prints of $${BLOCK_MIN_PREMIUM / 1000}K under ${BLOCK_MIN_SIZE} contracts count only when they are already on the tape` },
  { value: 'MULTI', label: 'Multi-leg', hint: 'A leg of a multi-leg order — asked of the vendor; read the structure on Multi-Leg' },
  { value: 'SINGLE', label: 'Single prints', hint: 'One leg, under the block line — cuts the prints in hand' },
  { value: 'COMPRESSION', label: 'Compression', hint: "OPRA cbmo / mctp packages — asked of the vendor (arbitrage-tagged prints count when on the tape); they net open interest down between members, not a bet, kept out of every bullish/bearish total" },
  { value: 'BURST', label: 'Alert bursts', hint: 'Alerts lane: a flow alert of several prints whose largest single trade is not known to clear the block line — cuts the alerts in hand' },
];
/* "Every print", not "Both ways": the mid prints are in it too, and they have a card of their own */
const LEAN_OPTIONS: DropdownOption<SentFilter>[] = [
  { value: 'ALL', label: 'Every print', hint: 'Bullish, bearish and mid prints' },
  { value: 'BULLISH', label: 'Bullish', hint: 'Calls bought, puts sold' },
  { value: 'BEARISH', label: 'Bearish', hint: 'Puts bought, calls sold' },
  { value: 'NEUTRAL', label: 'No read', hint: 'Mid prints, legs of spreads, after-hours prints and compression — none is read bullish or bearish' },
];
const KIND_WORD: Record<PrintKind, string> = { SWEEP: 'Sweep', BLOCK: 'Block', MULTI: 'Multi-leg', SINGLE: 'Single', COMPRESSION: 'Compression · not a bet', BURST: 'Burst' };

/** Fixed widths where a header or a cell would otherwise clip; the kind takes the rest.
    Every width here clears its widest cell: a column narrower than its cell paints a clipped ellipsis. */
const WIDTHS: Record<string, number> = { time: 150, ticker: 96, contract: 196, dte: 64, otm: 76, quote: 136, size: 152, prem: 92, dayRatio: 100, sentiment: 96, vol: 76, oi: 76, volOverOi: 80, iv: 64 };
const FLEXES: Record<string, number> = { tag: 1 };
/* The row's who and what stand still; the money stands at the right */
const PIN_LEFT = ['time', 'ticker', 'contract'];
const PIN_RIGHT = ['prem'];

/** What the short headers mean, on hover (the dotted explainers of the old table) */
const TOOLTIPS: Record<string, string> = {
  otm: 'How far the strike sits from the spot, as a share of the spot',
  contract: 'The contract, the days it has left, and where the market was when the print crossed',
  quote: 'What was paid, which side of the market it crossed, and the bid and ask it crossed into',
  size: "Contracts on this print, over the day's volume and the open interest that stood at the session's open",
  prem: 'Dollars paid — size × fill × 100',
  dayRatio: "This contract's whole day so far: its contracts at the ask, on the bid, and at the mid or with no side — a lean only when at least half the day traded on a side. On the alerts lane: the alert's own premium by side",
  sentiment: "Bullish (calls bought, puts sold), bearish (puts bought, calls sold) or neutral (mid) — by the side the vendor tags and the right",
  volOverOi: "The session's volume against open interest — at 1.5 and above, positions were built in the session; \"new\" when there was no open interest",
  iv: 'Implied volatility of the contract',
  tag: 'The kind of print — a sweep, a block, a multi-leg print (with its structure), or a single print',
};

/* One formatter, reused: `toLocaleString` builds a new one per call, and a
   tape of 120 rows × several figures each spent 12ms of its open in it. */
const NUM = new Intl.NumberFormat('en-US');
const num = (v: number) => NUM.format(v);

/** One stretch of the read — a plain sentence piece, or a contract door. */
type ReadSeg = string | { print: FlowPrint; label: string };

/** The terminal's read of the tape — same voice as market notes. The largest
    print travels as a DOOR segment: the sentence names a contract, so it
    opens that contract's card (Noah, 2026-08-30).
    THE SENTENCE AGREES WITH ITS OWN NUMBERS: it said "aggressive call buying leads" while the puts carried three times
    the calls' money — the lead is bullish premium (calls bought and puts sold) against bearish (puts bought and calls
    sold), and the sentence now says exactly that, with both sides' dollars. */
/** How long a window of prints runs, in words: "23 seconds", "4 minutes", "2 hours 5 minutes" */
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

function tapeRead(rows: FlowPrint[], summary: TapeSummary, noun: 'prints' | 'alerts' = 'prints', secondary = false): ReadSeg[] {
  if (rows.length === 0) return [noun === 'alerts' ? 'Awaiting alerts…' : 'Awaiting prints…'];
  const zdte = rows.filter(r => r.dte === 0).length;
  const lead = summary.bullPremium >= summary.bearPremium ? 'Bullish' : 'Bearish';
  /* a cut with no side on it (the mid lean) leads nowhere: never "Bullish premium leads by $0 — $0 against $0" */
  /* THE WINDOW IS NAMED: these are the prints in hand, not the day */
  const spanW = spanWords(rows);
  const span = spanW ? `${spanW} ET` : '';
  const ext = rows.filter(r => r.extended).length;
  /* SECONDARY, AND SAID SO (retail, round 7: "Window · last 2,000 prints · Oct 22 16:14:36–16:14:59 ET … bullish premium
     leads by $67.7K" read as the day): outside the session the window comes after the whole day, labelled as only those
     seconds */
  const len = spanLength(rows);
  const segs: ReadSeg[] = [
    secondary
      ? `Only the last ${rows.length.toLocaleString('en-US')} ${noun}${span ? ` (${span}${len ? `, ${len}` : ''})` : ''} — not the day${ext ? `; ${ext === rows.length ? 'all' : ext.toLocaleString('en-US')} after hours` : ''}: `
      : `In these ${rows.length.toLocaleString('en-US')} ${noun}${span ? ` (${span}${len ? `, ${len}` : ''})` : ''}${ext ? `, ${ext === rows.length ? 'all' : ext.toLocaleString('en-US')} after hours` : ''}: `,
  ];
  segs.push(
    summary.bullPremium === 0 && summary.bearPremium === 0
      ? ext === rows.length
        ? 'none is read bullish or bearish — after the close a print is set against a thin post-market quote'
        : rows.every(r => r.compression || isSpreadLeg(r) || r.extended)
          ? `none is read bullish or bearish — every ${noun === 'alerts' ? 'alert' : 'print'} here is a compression package${ext ? ', a leg of a spread or after hours' : ' or a leg of a spread'}`
          : `no premium has a side — every ${noun === 'alerts' ? 'alert' : 'print'} traded at the mid, or carries no read${ext ? ' (after hours)' : ''}`
      : `${lead.toLowerCase()} premium leads by ${fmtUsd(Math.abs(summary.netPremium))} — ${fmtUsd(summary.bullPremium)} bullish (calls bought, puts sold) against ${fmtUsd(summary.bearPremium)} bearish (puts bought, calls sold); calls ${fmtUsd(summary.callPremium)} and puts ${fmtUsd(summary.putPremium)} in all`
  );
  if (summary.largest) {
    const L = summary.largest;
    const hit = rows.find(r => r.ticker === L.ticker && r.strike === L.strike && r.right === L.right && r.premium === L.premium);
    segs.push(noun === 'alerts' ? ' · largest alert ' : ' · largest print in this window ');
    if (hit) segs.push({ print: hit, label: `${L.ticker} ${L.strike}${L.right}` });
    else segs.push(`${L.ticker} ${L.strike}${L.right}`);
    segs.push(` at [[${fmtUsd(L.premium)}]]`);
    /* a deep-in-the-money, long-dated contract trades like the stock — said, not crowned as a bet (retail, 2026-10-23) */
    if (hit && stockLike(hit)) segs.push(` — ${Math.abs(hit.otmPct).toFixed(0)}% in the money with ${hit.dte} days to run: likely a stock replacement or a roll, not a directional bet`);
  }
  if (summary.sweeps > 2) segs.push(` · ${summary.sweeps} sweeps`);
  /* spread legs stand apart — each is half of a structure, read on Multi-Leg (data/tape isSpreadLeg) */
  if (summary.spreadLegs.count > 0) segs.push(` · ${summary.spreadLegs.count.toLocaleString('en-US')} ${summary.spreadLegs.count === 1 ? 'print is a leg' : 'prints are legs'} of multi-leg orders (${fmtUsd(summary.spreadLegs.premium)}) — each is half of a structure, so none is in the bullish or bearish money or the largest; Multi-Leg reads which way the structure went`);
  /* compression stands apart — named, never read (traceLive printCondition) */
  if (summary.compression.count > 0) segs.push(` · ${summary.compression.count.toLocaleString('en-US')} compression ${summary.compression.count === 1 ? 'print' : 'prints'} (${fmtUsd(summary.compression.premium)}) — packages that net open interest down, not bets, so they are in none of these totals`);
  if (rows.length >= 20 && zdte / rows.length > 0.25) segs.push(` · 0DTE is ${(Math.round((zdte * 1000) / rows.length + 1e-9) / 10).toFixed(1)}% of the ${noun}`);
  segs.push('.');
  return segs;
}

// ---- the tape's own cells -----------------------------------------------------
/* THE SIDE CALL TRAVELS WITH ITS EVIDENCE. "BUY" is a CONCLUSION — it means
   the print crossed at the offer — and the tape used to state it in one
   column, show the fill price in a second, and draw the bid-ask rail in a
   third, leaving the reader to carry a number three columns to check the
   claim. They are one fact and they belong in one cell: the fill on top with
   the side as a WORD beside it, and the market it crossed into underneath.
   A print at 2.30 into a 2.10 × 2.30 market argues for itself.

   NO BULL/BEAR INK ON THE SIDE. In this row, green already means CALL two
   columns left and BULLISH two columns right; a third green meaning "lifted
   the offer" is the reading that makes a bought put look bullish at a
   glance. The dot's POSITION on the rail and the word carry the side; the
   colour stays where it is information. */
const SIDE_WORD: Record<FlowPrint['side'], string> = { ASK: 'ask', BID: 'bid', MID: 'mid' };
/** A day's lean in words, with the share it is decided on even when it falls short of a call ("even · ask 52%") */
const leanWords = (l: ReturnType<typeof dayLean>) =>
  l.lean === 'ASK' ? `ask ${Math.round(l.askSided)}%` : l.lean === 'BID' ? `bid ${Math.round(l.bidSided)}%` : l.lean === 'UNSIDED' ? 'mostly mid / no side' : `even · ${l.askSided >= 50 ? `ask ${shyPct(l.askSided)}%` : `bid ${shyPct(l.bidSided)}%`}`;
/** Why a floor package is set apart, in its own figures */
const FLOOR_HINT = (c: { floorPct: number; multiPct: number }) => `${Math.round(c.floorPct)}% of its day traded on the floor and ${Math.round(c.multiPct)}% in multi-leg packages — the shape of compression, which nets open interest down, not a directional bet`;
/* A FILL OUTSIDE ITS QUOTE SAYS SO (the retail pass, 2026-10-22: an NVDA fill of $7.86 read "BID" over a bid of 7.90 —
   right, it sold through the bid, but the word alone looked wrong): under the bid / over the ask */
const sideWordOf = (p: FlowPrint) =>
  /* a locked quote (bid = ask) still has an ask to fill over (audit round 5: 7.39 into 7.38 × 7.38 read "ASK") */
  p.bid > 0 && p.ask >= p.bid && p.fill < p.bid - 0.005 ? 'under bid' : p.bid > 0 && p.ask >= p.bid && p.fill > p.ask + 0.005 ? 'over ask' : SIDE_WORD[p.side];
const QuoteCell = ({ print }: { print: FlowPrint }) => (
  <span className="inline-flex flex-col items-end gap-[2px] leading-none align-middle">
    <span className="inline-flex items-baseline gap-1">
      <span className="font-mono text-[11px] font-bold tnum text-textPrimary">${print.fill.toFixed(2)}</span>
      <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-textPrimary" title={print.extended ? 'After hours — set against a post-market quote' : undefined}>{sideWordOf(print)}</span>
    </span>
    <span className="inline-flex items-center gap-1">
      <span className="font-mono text-[11px] tnum text-textSecondary">{print.bid.toFixed(2)}</span>
      <span className="relative w-10 h-[3px] rounded-full bg-ink/[0.07]">
        <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[6px] h-[6px] rounded-full bg-textPrimary" style={{ left: `${print.fillPos * 100}%` }} />
      </span>
      <span className="font-mono text-[11px] tnum text-textSecondary">{print.ask.toFixed(2)}</span>
    </span>
  </span>
);

/* SIZE, AND WHAT THE SIZE MEANS. A thousand contracts is enormous against an
   open interest of eight hundred and unremarkable against forty thousand —
   the number alone cannot be read, which is why the three travel together on
   every serious tape. Size leads; the day's volume and the standing open
   interest sit under it as the scale it is read against. */
const SizeCell = ({ print }: { print: FlowPrint }) => (
  <span className="inline-flex flex-col items-end gap-[2px] leading-none align-middle">
    <span className="font-mono text-[11px] font-bold tnum text-textPrimary">{num(print.size)}</span>
    <span className="font-mono text-[11px] tnum text-textSecondary whitespace-nowrap" title="Open interest that stood at the session's open — counted after the session before traded">
      vol {num(print.volume)} <span aria-hidden>·</span> oi {num(print.oi)}
    </span>
  </span>
);

const SENT_TEXT: Record<PrintSentiment, string> = {
  BULLISH: 'text-bull',
  BEARISH: 'text-bear',
  NEUTRAL: 'text-textSecondary', // raised from muted (retail, 2026-10-23: closed-session rows read greyed out)
};

// ---- the row model --------------------------------------------------------------
/* A print in the table, with the rank it holds in a ranked view. Wrappers
   are CACHED per (print, rank): a row whose facts did not move keeps its
   identity, so the grid's memoised row sits the tick out — the tape's
   smoothness under a print a second (Noah, 2026-08-18: "buffering and
   resizing itself"). The bookmark is not in here: the star reads the watch
   store itself, so a bookmark flipping redraws one star, not one row. */
interface TapeRow {
  p: FlowPrint;
  rank?: number;
}

type TapeGroup = 'Contract' | 'Execution' | 'Conviction' | 'Activity';
const TAPE_GROUP_ORDER: TapeGroup[] = ['Contract', 'Execution', 'Conviction', 'Activity'];

/** A DataTable column that also knows its plain label and its chooser group. */
interface TapeColumn extends Column<TapeRow> {
  label: string;
  group?: TapeGroup;
}

/** Every row fades in on arrival — the same class the old private rows wore. */
const FADE_ROW = () => 'animate-fade-in';

/** A print on a phone, two lines: the contract, then its money, its side and its size */
const phoneRow = (r: TapeRow) => {
  const s = sentimentOf(r.p);
  return (
    <PhoneRow
      lead={<WatchStar k={printKey(r.p)} make={() => watchPrint(r.p, 'tape')} noun="print" />}
      title={
        <>
          <span className="font-bold">{r.p.ticker}</span>
          <span className="font-bold tnum">{r.p.strike}</span>
          <span className={r.p.right === 'C' ? 'text-bull' : 'text-bear'}>{r.p.right === 'C' ? 'call' : 'put'}</span>
          <span className="text-[11px] text-textSecondary tnum">{r.p.expiry.slice(0, 5)}</span>
        </>
      }
      aside={r.p.time}
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

// ---- search (ticker OR contract) -------------------------------------------------
/** One matcher for the field and the row filter: strip everything but letters
    and digits so "SPY 505C", "spy505c" and "505C" all hit SPY 505C. */
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const matchesTape = (r: FlowPrint, nq: string) => nq === '' || norm(`${r.ticker}${r.strike}${r.right}`).includes(nq);

// ---- the page ---------------------------------------------------------------------
const ALERT_PACK_HINT = "Flow alerts that are legs of a floor package, not bets: no side, filed in the same millisecond as alerts on the root's other contracts, or on a contract whose day was mostly floor-traded multi-leg packages (half or more on the floor and in packages). Set apart, never ranked, never called a block";
const tapeIsoToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

const LiveTape = () => {
  const { marketData } = useMarketData();
  const [lane, setLane] = useState<'prints' | 'alerts'>('prints');
  const [openAlert, setOpenAlert] = useState<FlowPrint | null>(null);
  const alertTrades = useAlertTrades(lane === 'alerts' && openAlert?.alertId ? openAlert.alertId : null);
  const [frozen, setFrozen] = useState<FlowPrint[] | null>(null);
  const hold = useHold(marketData);
  const paused = hold.paused;
  const [away, setAway] = useState(false);
  const [flowFilter, setFlowFilter] = useState<FlowFilter>('ALL');
  const [sentFilter, setSentFilter] = useState<SentFilter>('ALL');
  const [minPremKey, setMinPremKey] = useState<PremKey>('0');
  const [searchQuery, setSearchQuery] = useState('');
  const [view, setView] = useState<TapeView>('STREAM');
  const [openPrint, setOpenPrint] = useState<FlowPrint | null>(null);

  const tickerQ = searchQuery.trim().toUpperCase();
  const tickerOnly = /^[A-Z][A-Z0-9.]{0,5}$/.test(tickerQ) ? tickerQ : '';
  const tapeQuery = useMemo<TapeQuery>(
    () => ({
      ticker: tickerOnly || undefined,
      side: sentFilter === 'BULLISH' || sentFilter === 'BEARISH' ? null : sentFilter === 'NEUTRAL' ? 'MID' : null,
      multi: flowFilter === 'MULTI' ? true : undefined,
      /* THE KIND GOES TO THE VENDOR where its codes can say it (audit round 4: Compression read "No prints in this view"
         while the vendor's ≥$1M tape held 599) — the tape is then refilled from the whole day, walked back from now or the
         close; single prints and alert bursts cut the prints in hand, and their cards say so */
      codes: flowFilter === 'SWEEP' ? ['isoi'] : flowFilter === 'COMPRESSION' ? ['cbmo', 'mctp'] : undefined,
      single: flowFilter === 'BLOCK' ? true : undefined,
      minSize: flowFilter === 'BLOCK' ? BLOCK_MIN_SIZE : undefined,
      minPremium: Number(minPremKey) || undefined,
    }),
    [tickerOnly, sentFilter, flowFilter, minPremKey]
  );
  /* THE HOLD HOLDS THE QUESTION TOO (the audit, 2026-10-22): a card changed while paused re-asked the vendor under the
     frozen rows. Paused, the stream keeps the query it had; the cards cut the held prints on the page, and the new
     question goes out when the tape resumes. */
  const heldQuery = useRef(tapeQuery);
  if (!paused) heldQuery.current = tapeQuery;
  /* THE SESSION CARD IS OBEYED (the third audit, 2026-10-22: after the close the tape held only after-hours prints under
     "Session · Regular", and the day's own session could not be reached): on Regular the tape keeps regular-session
     prints only, and once the session has ended it walks back from its 16:15 close — the last regular stretch — and
     says so. After hours (or any other session card) is the live feed as it prints. */
  const deskSession = useTraceSession();
  const [closedAt, setClosedAt] = useState(() => lastRegularClose());
  useEffect(() => {
    const id = window.setInterval(() => setClosedAt(c => {
      const n = lastRegularClose();
      return n?.closeMs === c?.closeMs ? c : n;
    }), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const regularOnly = deskSession === 'regular';
  const anchor = regularOnly && closedAt ? closedAt : null;
  const keepRegular = useCallback((p: FlowPrint) => !p.extended, []);
  /* EXTENDED HOURS IS ONLY THE EXTENDED PRINTS: between 16:00 and 16:15 the feed still carries the index and ETF options'
     regular-session prints, which are not after hours */
  const keepExtended = useCallback((p: FlowPrint) => !!p.extended, []);
  const stream = usePrintStream(paused ? heldQuery.current : tapeQuery, paused || away || lane !== 'prints', { untilMs: anchor?.closeMs ?? null, keep: regularOnly ? keepRegular : keepExtended });
  /* THE ALERTS LANE READS THE SESSION TOO (audit round 4: it opened on after-hours alerts under Regular) */
  const alerts = useFlowAlerts(40, { untilMs: anchor?.closeMs ?? null, session: regularOnly ? 'regular' : 'extended' });
  const tapeDown = (lane === 'alerts' ? alerts : stream).fault != null;
  /* THE ALERTS IN THE ORDER THEIR TIME COLUMN SAYS (the third audit: "newest first" was the vendor's created_at while the
     Time column shows each alert's first fill, start_time) — by the fill's millisecond, newest first */
  const alertRows = useMemo(() => [...alerts.rows].sort((a, b) => (b.epochMs ?? 0) - (a.epochMs ?? 0)), [alerts.rows]);
  const liveRows = lane === 'alerts' ? alertRows : stream.rows;
  const rows = frozen ?? liveRows;
  useEffect(() => {
    if (paused) setFrozen(f => f ?? liveRows);
    else setFrozen(null);
  }, [paused, liveRows]);
  /* The bookmarks live in the Trace watch store now (2026-09-03) — they
     survive the page, and the Tracker reads them. */
  const { isWatched, toggle: toggleWatch } = useWatch();

  const summary = useMemo(() => summarizeTape(rows), [rows]);

  /* Scrolled down: new prints wait in the pill instead of jumping the rows. */
  useEffect(() => {
    const onScroll = () => setAway(window.scrollY > 280);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    if (away || paused || lane !== 'prints') return;
    if (stream.pending) stream.flush();
  }, [away, paused, lane, stream]);
  useEffect(() => {
    if (lane !== 'prints' || paused) return;
    const onScroll = () => {
      if (!stream.hasOlder || stream.loadingOlder) return;
      const node = document.documentElement;
      if (node.scrollHeight - window.scrollY - window.innerHeight < 480) stream.loadOlder();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [lane, paused, stream]);

  /* THE EXPIRY CUT — the dates the prints in the buffer actually carry, as
     a calendar; every expiry where the page opens (see bookExpiry). */
  const { expiry, setExpiry, expiries: tapeExpiries, cut: cutExpiry, chosen: chosenExpiry } = useExpiryCut(rows, r => r.expiry);

  /* ---- the cut in the address ---------------------------------------------
     THE URL WINS, always: a link someone was SENT is a more specific
     instruction than whatever that reader last had open. The tape writes its
     cut back on every change (replace, never push — a filter is not a page,
     and six of them would bury the back button). */
  const [params, setParams] = useSearchParams();
  const cuts = useSavedCuts();
  const cut: TapeCut = { view, kind: flowFilter, lean: sentFilter, prem: minPremKey, expiry, q: searchQuery };
  const cutQuery = cutToQuery(cut);
  const applyCut = useCallback(
    (c: TapeCut) => {
      setView(c.view);
      setFlowFilter(c.kind);
      setSentFilter(c.lean);
      setMinPremKey(c.prem);
      setSearchQuery(c.q);
      setExpiry(c.expiry);
    },
    [setExpiry]
  );
  /* Read in on arrival and whenever the address changes under us (a saved cut
     opened, the back button). Written out from the state, so the two can
     never drift: whichever moved last, the other follows.

     THE HANDSHAKE IS THE WHOLE TRICK, and getting it wrong is silent. React
     runs both effects in the same pass, and on the pass that READS a link the
     state has not caught up yet — so the writer looks at a still-default cut,
     decides the address is wrong, and erases the link it was just handed. The
     reader therefore hands the writer a beat: applied, but not yet settled,
     so sit this one out. */
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

  /* THE FLOOR SAYS WHAT IT LEAVES: ≥$500K and ≥$1M often left nothing, with no way to know before picking — each floor
     carries the count of prints on the tape it keeps, under the other cards */
  const premOptions = useMemo<DropdownOption<PremKey>[]>(() => {
    const nq = norm(searchQuery);
    const base = cutExpiry(rows).filter(r => (flowFilter === 'ALL' || printKind(r) === flowFilter) && (sentFilter === 'ALL' || sentimentOf(r) === sentFilter) && matchesTape(r, nq));
    return [
      { value: '0', label: 'Any', hint: `No floor · ${base.length} prints` },
      ...PREM_CHIPS.map(c => {
        /* the floor goes to the vendor (min_premium) and refills the tape from its whole day — a count of the prints on
           screen now said "No print this size" and then the pick filled the grid (the ship pass, 2026-10-22) */
        return { value: c.value, label: c.label, hint: `The vendor's prints of ${c.label.replace('≥', '')} and up — the newest ${TAPE_CAP.toLocaleString('en-US')} of them, walked back from ${anchor ? `the ${nyClock(anchor.closeMs)} ET close` : 'now'}, not the whole day` };
      }),
    ];
  }, [rows, flowFilter, sentFilter, searchQuery, cutExpiry, anchor]);

  const filtered = useMemo(() => {
    const minPrem = Number(minPremKey);
    const nq = norm(searchQuery);
    return cutExpiry(rows).filter(
      r => (flowFilter === 'ALL' || printKind(r) === flowFilter) && (sentFilter === 'ALL' || sentimentOf(r) === sentFilter) && r.premium >= minPrem && matchesTape(r, nq)
    );
  }, [rows, flowFilter, sentFilter, minPremKey, searchQuery, cutExpiry]);

  // The strip and the tape read FOLLOW THE ACTIVE VIEW (Noah, 2026-08-18): an
  // NVDA-filtered table under a market-wide verdict and an SPY whale silently
  // answered two different questions. The strip renames itself to its scope so
  // it can never be misread; clearing filters restores the session's truth.
  // What the table actually shows: the filtered view, in the view's order.
  // Ranked views re-sort per tick, but big prints hold their ranks — only the
  // tail churns, and keyed reorders are DOM moves, not re-renders.
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

  /* The wrapper cache (see TapeRow). Rebuilt from the previous map each
     pass so it never outgrows the rows on screen. */
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

  /* How many of the prints on the tape right now are bookmarked. */
  const markedCount = useMemo(() => rows.reduce((n, r) => n + (isWatched(printKey(r)) ? 1 : 0), 0), [rows, isWatched]);

  /* The read still speaks the active SCOPE (the beam is gone — Noah + partner,
     2026-08-23 — but the scoped rows/summary survive it). */
  const scopeActive = searchQuery.trim() !== '' || flowFilter !== 'ALL' || sentFilter !== 'ALL' || minPremKey !== '0' || expiry !== null;
  const beamRows = scopeActive ? filtered : rows;
  const beamSummary = useMemo(() => (scopeActive ? summarizeTape(filtered) : summary), [scopeActive, filtered, summary]);

  /* The whale doors (Noah kept these when the beam went, 2026-08-23):
     largest bullish, largest bearish, and the overall largest — which only
     earns its own pill when it traded mid and is neither of those two. */
  const whales = useMemo(() => {
    let all: FlowPrint | null = null;
    let bull: FlowPrint | null = null;
    let bear: FlowPrint | null = null;
    for (const p of beamRows) {
      /* a compression package is never the largest bet, the top bull or the top bear */
      if (p.compression || p.floorPackage || isSpreadLeg(p)) continue;
      if (!all || p.premium > all.premium) all = p;
      const s = sentimentOf(p);
      if (s === 'BULLISH' && (!bull || p.premium > bull.premium)) bull = p;
      if (s === 'BEARISH' && (!bear || p.premium > bear.premium)) bear = p;
    }
    return { all, bull, bear };
  }, [beamRows]);
  /* The one magenta number in the table — the Screener's champion rule, on
     the print the strip already calls the largest. Changes only when a new
     largest lands, so the columns (and every memoised row) hold still. */
  const champId = whales.all?.id ?? -1;

  // 0DTE share of the active view — same-day contracts as a slice of the flow
  const zdteShare = useMemo(() => {
    if (beamRows.length === 0) return 0;
    return beamRows.filter(r => r.dte === 0).length / beamRows.length;
  }, [beamRows]);

  const [dayPick, setDayPick] = useState<boolean | null>(null);
  /* open by default in and out of the session — as visible as the rolling window (retail, round 7) */
  const showDay = lane === 'prints' && (dayPick ?? true);
  const dayIso = anchor?.iso ?? tapeSessionIso();
  const dayOpenMs = useMemo(() => {
    const [y, m, d] = dayIso.split('-').map(Number);
    return Date.UTC(y, m - 1, d, 8, 0); // 04:00 New York (EDT) or 03:00 (EST) — the alerts' day starts before either
  }, [dayIso]);
  const dayTide = useTide('market', '', showDay);
  /* twenty, so the three shown are bets after the floor packages are set apart (audit round 5) */
  const dayTop = useDayTopContracts(20, showDay);
  const dayAlerts = useDayBigAlerts(dayOpenMs, anchor?.closeMs ?? null, regularOnly ? 'regular' : 'extended', 5_000_000, 200, showDay);
  /* FLOOR PACKAGES SET APART (audit round 6): the alert legs of one no-side floor package, or a contract whose day was
     mostly floor-traded packages, never lead the day's largest alerts */
  const dayAlertsSplit = useMemo(() => {
    const packedDay = new Set(dayTop.rows.filter(c => floorPackaged(c)).map(c => `${c.ticker}|${c.strike}|${c.right}|${c.expiry}`));
    const isPack = (a: FlowPrint) => !!a.floorPackage || packedDay.has(`${a.ticker}|${a.strike}|${a.right}|${a.expiry}`);
    const marked = dayAlerts.rows.map(a => (isPack(a) && !a.floorPackage ? { ...a, floorPackage: true } : a));
    return { bets: marked.filter(a => !a.floorPackage), packs: marked.filter(a => a.floorPackage) };
  }, [dayAlerts.rows, dayTop.rows]);
  const dayNet = useMemo(() => tideBetween(dayTide.rows, regularOnly ? 570 : 975, regularOnly ? 975 : 1440), [dayTide.rows, regularOnly]);
  /* ONE SNAPSHOT FOR THE HEAD AND THE SENTENCE (the audit, 2026-10-22): the sentence was throttled to 8s, so it named
     an RKLB print as the largest under a head that named a META one. Both now read the same rows on every render. */
  const read = useMemo<ReadSeg[]>(
    () => {
      /* OUTSIDE THE SESSION THE DAY LEADS (retail, round 7): the whole day's market net first, then the window, labelled as
         only its seconds */
      const dayLead: ReadSeg[] =
        lane === 'prints' && anchor && dayNet
          ? [
              `The whole ${shortDay(anchor.iso)} session (${regularOnly ? '09:30–16:15 ET' : 'after the close'}): the market's net premium [[${dayNet.net >= 0 ? '+' : '−'}${fmtUsd(Math.abs(dayNet.net))}]] — net calls ${dayNet.calls >= 0 ? '+' : '−'}${fmtUsd(Math.abs(dayNet.calls))} less net puts ${dayNet.puts >= 0 ? '+' : '−'}${fmtUsd(Math.abs(dayNet.puts))} (the vendor's market tide, spread legs and floor packages in it; the whole-day panel below has the contracts and alerts). `,
            ]
          : [];
      const lead: ReadSeg[] = lane === 'prints' && anchor ? [`The regular session has closed — on the Regular session card the tape is its last stretch, walked back from the 16:15 ET close${anchor.iso !== tapeIsoToday() ? ` of ${shortDay(anchor.iso)}` : ''} (the prints after it are under Extended hours on the Session card). `] : [];
      return dayLead.concat(lead, beamRows.length === 0 ? [tapeDown ? 'The tape did not answer — nothing to read yet.' : rows.length === 0 ? (lane === 'alerts' ? 'Awaiting the first alerts…' : 'Awaiting the first prints…') : `No ${lane === 'alerts' ? 'alerts' : 'prints'} in this view.`] : tapeRead(beamRows, beamSummary, lane === 'alerts' ? 'alerts' : 'prints', lane === 'prints' && !!anchor));
    },
    [beamRows, beamSummary, tapeDown, rows.length, lane, anchor, dayNet, regularOnly]
  );
  /* THE WINDOW IS THE LABEL'S PRINTS (audit round 5: "Window · last 2,000 prints" under a filter showed the filtered
     subset's span) — the span of every print in hand; a cut's own span rides beside it */
  /* the window's day named when it is not today's (audit round 6) */
  const spanOf = (xs: FlowPrint[]) => spanWords(xs);
  const windowSpan = useMemo(() => spanOf(rows), [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const cutSpan = useMemo(() => (scopeActive ? spanOf(beamRows) : null), [scopeActive, beamRows]); // eslint-disable-line react-hooks/exhaustive-deps

  /* The card's bookmark, by tape id — the card only knows the id, the store
     wants the print; the rows ref keeps this callback stable. */
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const toggleMark = useCallback(
    (id: number) => {
      const p = rowsRef.current.find(r => r.id === id);
      if (p) toggleWatch(watchPrint(p, 'tape'));
    },
    [toggleWatch]
  );
  /* A RANK IS PART OF THE ROW'S IDENTITY (audit round 7: Order = Premium showed #16 twice and no #19) — the grid redraws a
     cell only when its value moves, and the Time cell's value is the print's own, so a print that moved from #16 to #17
     kept drawing "#16". In a ranked view the row's key carries its rank. */
  const keyOf = useCallback((r: TapeRow) => (r.rank !== undefined ? `${r.p.id}#${r.rank}` : String(r.p.id)), []);
  const openRow = useCallback((r: TapeRow) => setOpenPrint(r.p), []);

  // Drilldown navigation — stepping moves through the FILTERED view, so ↑/↓
  // walks exactly the rows the user is looking at. Once the open print has aged
  // out of the buffer it is no longer steerable, but it stays open and readable.
  const openIdx = openPrint ? displayRows.findIndex(r => r.id === openPrint.id) : -1;
  const stepPrint = (dir: -1 | 1) => {
    if (openIdx < 0) return;
    const next = openIdx + dir;
    if (next >= 0 && next < displayRows.length) setOpenPrint(displayRows[next]);
  };

  // ↑/↓ step through prints while the drilldown is open
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

  /* THE COLUMNS, in the siblings' registers. Distance and interest are facts
     in neutral ink; signed changes wear direction ink; premium has three
     registers — quiet, bold from $250K, and the one magenta champion. Stable
     across ticks: nothing in here reads a value that moves with the clock
     except the champion's id. */
  const columns = useMemo<TapeColumn[]>(
    () => [
      {
        key: 'time',
        label: 'Time',
        header: 'Time',
        /* by the print's instant — the id is a hash, not a time */
        sortValue: r => r.p.epochMs ?? (r.p.epoch ?? 0) * 1000,
        render: r => (
          <span className="inline-flex items-center gap-1.5">
            <WatchStar k={printKey(r.p)} make={() => watchPrint(r.p, 'tape')} noun="print" />
            {r.rank !== undefined && <span className="min-w-[30px] shrink-0 text-[11px] font-bold tnum text-textPrimary">#{r.rank}</span>}
            <span className="text-[11px] tnum text-textPrimary whitespace-nowrap">{r.p.time}</span>
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
            {/* no monogram tile beside the bold symbol — for a name without a mark it printed the ticker twice */}
            <span className="font-bold text-textPrimary">{r.p.ticker}</span>
          </span>
        ),
      },
      {
        key: 'contract',
        label: 'Contract',
        group: 'Contract',
        header: 'Contract',
        align: 'right',
        sortValue: r => r.p.strike,
        render: r => <ContractCell ticker={r.p.ticker} strike={r.p.strike} right={r.p.right} expiry={r.p.expiry} dte={r.p.dte} spot={r.p.spot} otmPct={r.p.otmPct} />,
      },
      /* DTE, OTM % and Spot are IN the contract cell now; the two keep their own
         columns because a reader sorts by them. */
      {
        key: 'dte',
        label: 'DTE',
        group: 'Contract',
        header: 'DTE',
        align: 'right',
        sortValue: r => r.p.dte,
        render: r => <span className="text-textPrimary">{r.p.dte}d</span>,
      },
      {
        key: 'otm',
        label: 'OTM %',
        group: 'Contract',
        header: 'OTM %',
        align: 'right',
        sortValue: r => (r.p.spot > 0 ? r.p.otmPct : Number.NEGATIVE_INFINITY),
        render: r => (r.p.spot > 0 && Number.isFinite(r.p.otmPct) ? <span className="text-textPrimary">{indexRoot(r.p.ticker) ? '≈' : ''}{pctSigned(r.p.otmPct, 1)}</span> : <span className="text-textMuted" title={r.p.spot > 0 ? 'A whole-point index level is too coarse for this distance (XSP, VIX)' : 'The print carries no underlying price and no index level is in hand'}>—</span>),
      },
      {
        key: 'quote',
        label: 'Fill & market',
        group: 'Execution',
        header: 'Fill & market',
        align: 'right',
        sortValue: r => r.p.fillPos,
        render: r => <QuoteCell print={r.p} />,
      },
      {
        key: 'size',
        label: 'Size, vol & OI',
        group: 'Execution',
        header: 'Size, vol & OI',
        align: 'right',
        sortValue: r => r.p.size,
        render: r => <SizeCell print={r.p} />,
      },
      {
        key: 'prem',
        label: 'Prem',
        group: 'Execution',
        header: 'Prem',
        align: 'right',
        sortValue: r => r.p.premium,
        render: r => <span className={`font-mono tnum ${r.p.id === champId ? 'text-supreme font-bold' : r.p.premium >= 250_000 ? 'font-bold text-textPrimary' : 'text-textPrimary'}`}><TickFigure value={r.p.premium}>{fmtUsd(r.p.premium)}</TickFigure></span>,
      },
      {
        key: 'dayRatio',
        /* "Day lean" — the same cell is the Lean on every other page; on the alerts lane it is the ALERT's own premium by
           side, and says so */
        label: lane === 'alerts' ? 'Alert side' : 'Day lean',
        group: 'Conviction',
        header: lane === 'alerts' ? 'Alert side' : 'Day lean',
        align: 'right',
        sortValue: r => (Number.isFinite(r.p.ratioBidPct) ? 100 - r.p.ratioBidPct : -1),
        // The Screener's Lean cell IS the tape's old ratio cell, shared.
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
          /* after the close a print is set against a thin post-market quote — labelled, never read */
          if (r.p.compression) return <span className="text-[11px] font-semibold uppercase text-textSecondary" title="A compression package (OPRA cbmo / mctp, or the vendor's arbitrage tag) — it nets open interest down between members, so it is not a bet and is in no bullish or bearish total">compression</span>;
          if (r.p.extended) return <span className="text-[11px] font-semibold uppercase text-textSecondary" title="Printed after hours — set against a post-market quote, so it carries no read">after hrs</span>;
          if (isSpreadLeg(r.p)) return <span className="text-[11px] font-semibold uppercase text-textSecondary" title="One leg of a multi-leg order (its OPRA condition says so) — half of a structure, not a bet of its own; Multi-Leg reads which way the structure went">spread leg</span>;
          return <span className={`text-[11px] font-semibold ${SENT_TEXT[s]}`}>{s}</span>;
        },
      },
      /* Volume and open interest ride in the Size cell; the columns survive
         for sorting. */
      {
        key: 'vol',
        label: 'Vol',
        group: 'Activity',
        header: 'Vol',
        align: 'right',
        sortValue: r => r.p.volume,
        render: r => <span className="text-textPrimary">{num(r.p.volume)}</span>,
      },
      {
        key: 'oi',
        label: 'OI',
        group: 'Activity',
        header: 'OI',
        align: 'right',
        sortValue: r => r.p.oi,
        render: r => <span className="text-textPrimary">{num(r.p.oi)}</span>,
      },
      {
        key: 'volOverOi',
        label: 'Vol/OI',
        group: 'Activity',
        header: 'Vol/OI',
        align: 'right',
        sortValue: r => r.p.volOverOI,
        // ≥1.5 = positions built TODAY — weight carries it, never a hue.
        render: r => <span className={`font-mono tnum ${r.p.oi > 0 && r.p.volOverOI >= FRESH_VOL_OI ? 'font-bold text-textPrimary' : 'text-textPrimary'}`} title={r.p.oi > 0 ? undefined : 'No open interest before the session — a new contract, nothing to divide by'}>{volOiText(r.p)}</span>,
      },
      {
        key: 'iv',
        label: 'IV',
        group: 'Activity',
        header: 'IV',
        align: 'right',
        sortValue: r => r.p.iv,
        render: r => <span className="font-mono tnum text-textPrimary">{r.p.iv.toFixed(0)}%</span>,
      },
      {
        key: 'tag',
        label: 'Kind',
        group: 'Activity',
        header: 'Kind',
        sortValue: r => printKind(r.p),
        render: r => {
          const k = printKind(r.p);
          return (
            <span className="text-[11px] text-textSecondary" title={k === 'COMPRESSION' ? 'A compression package — OPRA cbmo / mctp or the vendor’s arbitrage tag: not a bet' : r.p.trades ? `A flow alert: ${r.p.trades} prints on this contract${k === 'BURST' ? ' — its largest single trade is not known to clear the block line, so it is not called a block' : ''}` : k === 'MULTI' ? "The print's OPRA condition marks it one leg of a multi-leg order" : undefined}>
              {k === 'SWEEP' ? <span className="text-warn font-semibold">Sweep</span> : KIND_WORD[k]}
              {r.p.trades && r.p.trades > 1 ? <span className="text-textMuted"> · {r.p.trades} prints</span> : null}
            </span>
          );
        },
      },
    ],
    [champId, lane]
  );

  /* The chooser offers every column but the time rail, which is always on. */
  /* THE COMPOUND CELLS CARRY THEM (audit round 7: at 1600 the OI column stood one character wide under the pinned Prem):
     the DTE and the distance are in the contract cell, the day's volume and the open interest in the size cell — those
     four columns open folded, one click away in Columns */
  const { hidden, toggle, showAll, hideAll } = useHiddenColumns(COLS_KEY, ['dte', 'otm', 'vol', 'oi']);
  const chooserCols = useMemo(() => columns.filter(c => c.key !== 'time').map(c => ({ key: c.key, label: c.label, group: c.group })), [columns]);
  const [guideOpen, setGuideOpen] = useState(false);

  /* THE PILL SAYS THE SIDE (the retail pass, 2026-10-22: "Top bull SPX 7350P" — a put as the top bull, unexplained): a
     put sold on the bid is bullish, so the pill says "sold" and the label's hover says the rule */
  /* A PRINT WITH NO READ SAYS WHY, NOT A SIDE (audit round 4: "Largest in window SPX 7700C sold" on an after-hours print) */
  const pill = (p: FlowPrint) => (
    <>
      {p.ticker} {p.strike}
      {p.right} {p.compression ? 'compression' : p.extended ? 'after hours' : isSpreadLeg(p) ? 'spread leg' : p.side === 'ASK' ? 'bought' : p.side === 'BID' ? 'sold' : 'mid'} · {fmtUsd(p.premium)}
      {stockLike(p) && <span title={STOCK_LIKE_HINT}> · stock-like</span>}
    </>
  );
  /* THE WHOLE DAY, MARKET-WIDE (audit round 4: after the close the head described 23 seconds — "Window 16:14:36–16:14:59
     ET"): the day's own figures off day-level routes — the market tide's net call and put premium over the session, the
     screener's contracts by the day's premium with their sides, and the day's largest flow alerts. Open by default once the
     session has closed; a toggle any time. The buffer's facts above stay labelled as the last prints. */

  /* THE NAME'S WHOLE DAY (the retail pass: "biggest NVDA bets today" — the tape cut to a name covers its window only):
     with one name typed, its contracts by the day's premium, from the vendor's screener */
  const topDay = useNameTopContracts(tickerOnly || null, 20);
  /* BOUGHT OR SOLD, ANSWERED (retail, round 7: "400P … floor package · 215C … even · bid 51%" had no answer; the audit: a
     floor package ranked first with a lean printed for it): only contracts with a clear side rank, by their sided premium —
     the day's premium × (ask − bid) over the day's contracts; floor packages stand apart with no lean */
  const nameDay = useMemo(() => {
    const packs = topDay.rows.filter(c => floorPackaged(c));
    const sided = topDay.rows
      .filter(c => !floorPackaged(c) && !stockLike(c))
      .map(c => ({ c, lean: dayLean(c) }))
      .filter(x => x.lean.lean === 'ASK' || x.lean.lean === 'BID')
      .map(x => {
        const sv = x.c.sideVol;
        const total = sv ? sv.ask + sv.bid + sv.mid : 0;
        return { ...x, sided: sv && total > 0 ? (x.c.premium * Math.abs(sv.ask - sv.bid)) / total : x.c.premium * Math.abs(x.lean.askSided - x.lean.bidSided) / 100 };
      })
      .sort((a, b) => b.sided - a.sided);
    return { sided, packs };
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

  return (
    <>
      <TraceBox
        title="The tape"
        sub={`${VIEW_META[view].label} — ${VIEW_META[view].hint} · a row opens the print's card, the bookmark at its left tracks it`}
        testId="live-tape"
        foldOnPhone
        data={{ view, prints: filtered.length, expiry: expiry ?? 'all' }}
        guide={{ title: 'How to read the tape', door: 'What a print, its fill and its conviction mean', body: <LiveTapeGuide />, testId: 'live-tape-guide', open: guideOpen, onOpen: setGuideOpen }}
        facts={
          <>
            <Fact label={lane === 'alerts' ? 'Alerts' : 'Prints'} testId="prints" title={lane === 'alerts' ? "The vendor's newest flow alerts — each one an aggregate of a contract's prints in one burst" : 'The prints in hand — the newest stretch of the tape, unbroken, up to 2,000 — not the whole day'}>
              {filtered.length}{' '}
              <span className="text-textSecondary">
                of {rows.length}{lane === 'alerts' ? ' alerts' : ''}
                {lane === 'prints' && stream.hasOlder ? ' · older still coming' : ''}
                {lane === 'prints' && !stream.hasOlder && rows.length >= TAPE_CAP ? ' · at the max' : ''}
                {' · '}
                {markedCount} tracked
              </span>
            </Fact>
            <Fact label={lane === 'prints' ? `Window · last ${rows.length.toLocaleString('en-US')} prints${spanLength(rows) ? ` · ${spanLength(rows)}` : ''}${anchor ? ' · not the day' : ''}` : 'Window'} testId="window" title={`The first and last print in this view, New York — every figure in this head and the sentence covers these prints only${lane === 'prints' && anchor ? `. The Session card says Regular and the session has closed, so the tape is the last regular-session stretch, walked back from the ${anchor.iso} close; pick Extended hours on the Session card for what prints after it` : lane === 'prints' && regularOnly ? '. Regular-session prints only (the Session card)' : ''}`}>
              {windowSpan ? `${windowSpan} ET` : '—'}
              {cutSpan && cutSpan !== windowSpan && <span className="text-textSecondary" title="The span of the prints this cut keeps"> · this cut {cutSpan}</span>}
              {lane === 'prints' && anchor && <span className="text-textSecondary"> · regular session, to the {anchor.iso !== tapeIsoToday() ? `${shortDay(anchor.iso)} close` : 'close'}</span>}
            </Fact>
            <Fact label="Premium" testId="premium" title={`Call and put premium in this view${beamSummary.compression.count ? `, compression packages left out (${fmtUsd(beamSummary.compression.premium)})` : ''}`}>
              <span className="text-bull">{beamSummary.callCount}C</span> {fmtUsd(beamSummary.callPremium)} <span className="text-textSecondary">/</span> <span className="text-bear">{beamSummary.putCount}P</span> {fmtUsd(beamSummary.putPremium)}
            </Fact>
            <Fact label="Sweeps · blocks · multi-leg" testId="kinds" title={`Sweeps, blocks (one leg, ${BLOCK_MIN_SIZE} contracts or $${BLOCK_MIN_PREMIUM / 1000}K and up) and multi-leg prints in this view; ${beamSummary.other} single prints besides`}>
              {beamSummary.sweeps} <span className="text-textSecondary">·</span> {beamSummary.blocks} <span className="text-textSecondary">·</span> {beamSummary.multi}
            </Fact>
            <Fact label="P/C premium" testId="pc" title="Put premium divided by call premium in this view">
              {beamSummary.callPremium > 0 ? beamSummary.pcRatio.toFixed(2) : '—'}
            </Fact>
            {beamSummary.compression.count > 0 && (
              <Fact label="Compression · not a bet" testId="compression" title="OPRA cbmo / mctp packages and arbitrage-tagged prints in this view — they net open interest down between members; shown, never read, and in no other figure here">
                {beamSummary.compression.count} <span className="text-textSecondary">· {fmtUsd(beamSummary.compression.premium)}</span>
              </Fact>
            )}
            {beamSummary.spreadLegs.count > 0 && (
              <Fact label="Spread legs · no read" testId="spread-legs" title="Prints whose OPRA condition marks them one leg of a multi-leg order — half of a structure, not a bet of their own. Counted here and in the call/put premium; in no bullish or bearish total, never the top bull, top bear or largest. Multi-Leg reads which way each structure went">
                {beamSummary.spreadLegs.count} <span className="text-textSecondary">· {fmtUsd(beamSummary.spreadLegs.premium)}</span>
              </Fact>
            )}
            <Fact label="0DTE" testId="odte" title={`Share of this view's ${lane === 'alerts' ? 'alerts' : 'prints'} on contracts expiring the day they printed (0 days to expiry), each counted from its own trade date`}>
              <span className="text-textPrimary">{(Math.round(zdteShare * 1000 + 1e-9) / 10).toFixed(1)}%</span> <span className="text-textSecondary">of {lane === 'alerts' ? 'alerts' : 'prints'} · {beamRows.filter(r => r.dte === 0).length.toLocaleString('en-US')} of {beamRows.length.toLocaleString('en-US')}</span>
            </Fact>
            {tickerOnly && topDay.rows.length > 0 && (
              <Fact label={`${tickerOnly} · bought or sold ${dayAdv(dayIso)} · whole day`} testId="name-day" title={`${tickerOnly}'s contracts with a clear side ${dayAdv(dayIso)}, the whole day — the vendor's screener, not the window of prints above. Ranked by their sided premium (the day's premium × the share of its contracts that leaned to the ask over the bid); a contract whose day was even (no side holding 55% of the sided contracts), mostly at the mid, mostly floor-traded multi-leg packages, or deep in the money and long-dated (stock-like) has no directional read and is not ranked${nameDay.packs.length ? `. Set apart: ${nameDay.packs.map(c => `${c.strike}${c.right} ${expiryLabel(c.expiry)} ${fmtUsd(c.premium)} floor package`).join(', ')}` : ''}`}>
                {nameDay.sided.length === 0 ? (
                  <span className="text-textSecondary">no clear side — {tickerOnly}'s heaviest contracts traded even, at the mid or in floor packages</span>
                ) : (
                  nameDay.sided.slice(0, 2).map((x, i) => (
                    <span key={x.c.key}>
                      {i > 0 && <span className="text-textSecondary"> · </span>}
                      {x.c.strike}
                      {x.c.right} {expiryLabel(x.c.expiry)} <span className="text-textPrimary">{x.lean.lean === 'ASK' ? 'bought' : 'sold'}</span> {fmtUsd(x.sided)} <span className="text-textSecondary">{leanWords(x.lean)}</span>
                    </span>
                  ))
                )}
                {nameDay.packs.length > 0 && <span className="text-textMuted" title={nameDay.packs.map(c => `${c.strike}${c.right} ${expiryLabel(c.expiry)} ${fmtUsd(c.premium)} — ${FLOOR_HINT(c)}`).join('\n')}> · {nameDay.packs.length} floor package{nameDay.packs.length === 1 ? '' : 's'} apart</span>}
              </Fact>
            )}
            {whales.bull && whales.bull !== whales.all && (
              <Champion label="Top bull" ink="bull" title="The biggest bullish print in this window — a call bought at the ask or a put sold on the bid" onOpen={() => setOpenPrint(whales.bull)} testId="bull">
                {pill(whales.bull)}
              </Champion>
            )}
            {whales.bear && whales.bear !== whales.all && (
              <Champion label="Top bear" ink="bear" title="The biggest bearish print in this window — a put bought at the ask or a call sold on the bid" onOpen={() => setOpenPrint(whales.bear)} testId="bear">
                {pill(whales.bear)}
              </Champion>
            )}
            {whales.all && (
              <Champion label={`${lane === 'alerts' ? 'Largest alert' : 'Largest in window'}${whales.all === whales.bull ? ' · also top bull' : whales.all === whales.bear ? ' · also top bear' : ''}`} ink="supreme" title={`The biggest premium among the rows in hand — the Window fact says from when to when${whales.all === whales.bull ? '. It is also the biggest bullish print (a call bought at the ask or a put sold on the bid)' : whales.all === whales.bear ? '. It is also the biggest bearish print (a put bought at the ask or a call sold on the bid)' : ''}`} onOpen={() => setOpenPrint(whales.all)} testId="largest">
                {pill(whales.all)}
              </Champion>
            )}
          </>
        }
        controls={
          <>
            <LiveHold paused={paused} onToggle={hold.toggle} heldAt={hold.heldAt} />
            {/* a closed session's stretch is complete, not stale — it is not polled because nothing newer belongs to it */}
            {!(lane === 'prints' && anchor) && <StaleMark at={(lane === 'alerts' ? alerts : stream).at} ttlMs={FLOW_TTL_MS} fault={(lane === 'alerts' ? alerts : stream).fault} />}
            <span className="inline-flex rounded-md border border-borderSubtle overflow-hidden" data-tape-lane>
              {(['prints', 'alerts'] as const).map(k => (
                <button key={k} type="button" onClick={() => setLane(k)} aria-pressed={lane === k} className={`px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${lane === k ? 'bg-chip text-textPrimary' : 'text-textSecondary hover:text-textPrimary'}`}>
                  {k === 'prints' ? 'Prints' : 'Alerts'}
                </button>
              ))}
            </span>
            {lane === 'prints' && (
              <button type="button" onClick={() => setDayPick(!showDay)} aria-pressed={showDay} title="The whole day's figures — the market tide, the contracts with the most premium and the largest flow alerts — above the prints" className={`px-2 py-1 rounded-md border border-borderSubtle font-mono text-[10px] uppercase tracking-wider ${showDay ? 'bg-chip text-textPrimary' : 'text-textSecondary hover:text-textPrimary'}`} data-tape-day-toggle>
                Whole day
              </button>
            )}
            <FlowSearch value={searchQuery} onChange={setSearchQuery} rows={rows} span />
            <DropdownSelect label="Order" value={view} options={ORDER_OPTIONS} onChange={setView} title="How the prints are ordered" testId="tape-order" />
            <DropdownSelect label="Kind" value={flowFilter} options={KIND_OPTIONS} onChange={setFlowFilter} title="Sweeps, blocks, multi-leg or single prints" testId="tape-kind" />
            <DropdownSelect label="Lean" value={sentFilter} options={LEAN_OPTIONS} onChange={setSentFilter} title="Bullish, bearish or mid prints — or every print" testId="tape-lean" />
            <DropdownSelect label="Premium" value={minPremKey} options={premOptions} onChange={setMinPremKey} title="The smallest print shown" testId="tape-premium" />
            {/* The expiry cut — only the dates the prints on the tape carry */}
            <ExpiryCalendar
              value={chosenExpiry ? isoDate(chosenExpiry.date) : ''}
              expiries={tapeExpiries}
              onChange={e => setExpiry(isoDate(e.date))}
              onClear={() => setExpiry(null)}
              label="Expiry"
              icon={CalendarDays}
              steppers={false}
              title="Only prints on one expiry — or every expiry"
              testId="tape-expiry"
            />
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
              <p role="status" className="mb-2 font-mono text-[11px] text-textSecondary" data-tape-said>
                {cuts.said}
              </p>
            )}
            {readNode}
          </>
        }
      >
        {/* The grid takes the whole window — the rail and its door are gone with the partner's layout (2026-10-13). */}
        <div data-tape-body>
          {showDay && (
            <div className="px-5 py-3 border-t border-borderSubtle flex flex-col gap-2" data-tape-day>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="font-mono text-[10px] uppercase tracking-widest text-textPrimary">The whole day</span>
                <span className="text-[11px] text-textMuted">
                  {dayAdv(dayIso) === 'today' ? 'Today' : shortDay(dayIso)} · {regularOnly ? (anchor ? '09:30–16:15 ET, the regular session' : 'the regular session so far, from 09:30 ET') : 'outside the regular session'} — day-level figures from the vendor's market tide, its screener and its flow alerts, not the {rows.length.toLocaleString('en-US')} prints below
                </span>
              </div>
              <div className="grid gap-x-8 gap-y-2 md:grid-cols-3 text-[11px]">
                <div className="min-w-0" data-tape-day-tide>
                  <div className="text-textMuted" title={`The vendor's market tide. ${VENDOR_TOTAL_NOTE}`}>Market net premium · every name</div>
                  {dayNet ? (
                    <div className="font-mono tnum text-textPrimary">
                      <span className={dayNet.net >= 0 ? 'text-bull' : 'text-bear'}>{dayNet.net >= 0 ? '+' : ''}{fmtUsd(dayNet.net)}</span>
                      <span className="text-textSecondary"> = net calls </span>
                      <span className={dayNet.calls >= 0 ? 'text-bull' : 'text-bear'}>{dayNet.calls >= 0 ? '+' : ''}{fmtUsd(dayNet.calls)}</span>
                      <span className="text-textSecondary"> less net puts </span>
                      <span className={dayNet.puts >= 0 ? 'text-bear' : 'text-bull'}>{dayNet.puts >= 0 ? '+' : ''}{fmtUsd(dayNet.puts)}</span>
                      <span className="text-textSecondary"> · {nyClock(dayNet.first * 1000)}–{nyClock(dayNet.last * 1000)} ET</span>
                    </div>
                  ) : (
                    <div className="font-mono text-textMuted">{dayTide.waiting ? '…' : '—'}</div>
                  )}
                </div>
                <div className="min-w-0" data-tape-day-top>
                  <div className="text-textMuted" title={`The screener's contracts with the most premium ${dayAdv(dayIso)}, the whole day, each with its day's lean (the one lean rule). A contract whose day was mostly floor-traded multi-leg packages — the shape of compression — is set apart below, labelled, not ranked as a bet`}>Most premium {dayAdv(dayIso)} · per contract · floor packages apart</div>
                  {dayTop.rows.length ? (
                    <>
                      {dayTop.rows.filter(c => !floorPackaged(c)).slice(0, 3).map(c => {
                        const l = dayLean(c);
                        return (
                          <div key={c.key} className="font-mono tnum text-textPrimary truncate">
                            {c.ticker} {c.strike}
                            {c.right} {expiryLabel(c.expiry)} · {fmtUsd(c.premium)} <span className="text-textSecondary">{leanWords(l)}</span>
                            {stockLike(c) && <span className="text-warn" title={STOCK_LIKE_HINT}> · stock-like</span>}
                          </div>
                        );
                      })}
                      {(() => {
                        const packs = dayTop.rows.filter(c => floorPackaged(c)).slice(0, 3);
                        return packs.length ? (
                          <div className="font-mono tnum text-textSecondary truncate" title={packs.map(c => `${c.ticker} ${c.strike}${c.right} ${expiryLabel(c.expiry)} ${fmtUsd(c.premium)} — ${FLOOR_HINT(c)}`).join('\n')} data-tape-day-packages>
                            <span className="text-warn">Floor packages · not a bet:</span> {packs.map(c => `${c.ticker} ${c.strike}${c.right} ${expiryLabel(c.expiry)} ${fmtUsd(c.premium)}`).join(' · ')}
                          </div>
                        ) : null;
                      })()}
                    </>
                  ) : (
                    <div className="font-mono text-textMuted">{dayTop.waiting ? '…' : '—'}</div>
                  )}
                </div>
                <div className="min-w-0" data-tape-day-alerts>
                  <div className="text-textMuted" title="The vendor's flow alerts of $5M and up filed in the session, largest first — each an aggregate of a contract's prints in one burst; its side is the side that carried 60% of its whole premium">Largest flow alerts {dayAdv(dayIso)} · $5M and up</div>
                  {dayAlertsSplit.bets.length || dayAlertsSplit.packs.length ? (
                    <>
                      {dayAlertsSplit.bets.slice(0, 3).map(a => (
                        <button key={a.id} type="button" onClick={() => setOpenPrint(a)} className="block w-full text-left font-mono tnum text-textPrimary truncate hover:text-silver" data-tape-day-alert>
                          {a.ticker} {a.strike}
                          {a.right} · {fmtUsd(a.premium)} <span className="text-textSecondary">{a.side === 'ASK' ? 'at the ask' : a.side === 'BID' ? 'on the bid' : 'no side'} · {a.time}</span>
                        </button>
                      ))}
                      {dayAlertsSplit.packs.length > 0 && (
                        <button type="button" onClick={() => setOpenPrint(dayAlertsSplit.packs[0])} className="block w-full text-left font-mono tnum text-textSecondary truncate hover:text-silver" title={ALERT_PACK_HINT} data-tape-day-alert-pack>
                          <span className="text-warn">floor package · not a bet</span> · {dayAlertsSplit.packs.length} alert{dayAlertsSplit.packs.length === 1 ? '' : 's'}, {fmtUsd(dayAlertsSplit.packs.reduce((a, p) => a + p.premium, 0))} · {dayAlertsSplit.packs.slice(0, 3).map(p => `${p.ticker} ${p.strike}${p.right}`).join(', ')}
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
              <span className="font-mono text-[11px] text-textSecondary">Trades inside {openAlert.ticker} {openAlert.strike}{openAlert.right}</span>
              <button type="button" className="font-mono text-[10px] uppercase tracking-wider text-textMuted" onClick={() => setOpenAlert(null)}>Close</button>
              {alertTrades.fault && alertTrades.rows.length === 0 ? (
                <FeedFallback fault={alertTrades.fault} />
              ) : (
                <span className="font-mono text-[11px] tabular-nums text-textPrimary">{alertTrades.waiting ? '…' : `${alertTrades.rows.length} prints`}</span>
              )}
            </div>
          )}
          {lane === 'alerts' && openAlert && alertTrades.rows.length > 0 && (
            <ul className="px-5 py-1 border-b border-borderSubtle" data-alert-trade-list>
              {alertTrades.rows.slice(0, 8).map(p => (
                <li key={p.id} className="flex items-center gap-3 py-0.5 font-mono text-[11px] text-textSecondary">
                  <span className="text-textPrimary">{p.time}</span>
                  <span>{p.ticker} {p.strike}{p.right}</span>
                  <span className="ml-auto tabular-nums text-textPrimary"><TickFigure value={p.premium}>{fmtUsd(p.premium)}</TickFigure></span>
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
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="rounded-full border border-borderSubtle bg-chip px-3 py-1 font-mono text-[11px] text-textPrimary"
              >
                {stream.pending} new print{stream.pending === 1 ? '' : 's'} ↑
              </button>
            </div>
          )}
          <TraceGrid
            rows={tableRows}
            columns={columns}
            hidden={hidden}
            widths={WIDTHS}
            flexes={FLEXES}
            tooltips={TOOLTIPS}
            rowKey={keyOf}
            onRowClick={r => {
              openRow(r);
              if (lane === 'alerts') setOpenAlert(r.p);
            }}
            selectedKey={openPrint ? (() => { const hit = tableRows.find(r => r.p.id === openPrint.id); return hit ? keyOf(hit) : String(openPrint.id); })() : null}
            pinLeft={PIN_LEFT}
            pinRight={PIN_RIGHT}
            phoneRow={phoneRow}
            rowClass={FADE_ROW}
            animate={false}
            autoHeight
            emptyText={rows.length === 0 ? (tapeDown ? 'This read did not land — the tape will fill when the feed answers' : 'Awaiting first prints…') : 'No prints on this cut — loosen a card: the order, the kind, the lean, the floor or the expiry'}
            testId="live-tape"
          />
        </div>
      </TraceBox>

      {/* Print drilldown — a centred card over the tape, so the rows you are
          comparing against stay visible behind it */}
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
