/*
==================================================
  SLAYER TERMINAL - WATCHERS (Trace)
  The tape watching itself (Noah, 2026-08-30 —
  expansion page 3, from the reference's flow-alert
  stream). Named "Flow Alerts" until 2026-09-11:
  under the alerts rule the bell is the READER'S
  alerts, so the desk's watchers took their own
  name (/trace/watchers; the old path redirects).

  The reader's bell stays the reader's: those are
  alerts YOU armed. These are the desk's own
  watchers over the day book, and the feed is what
  they caught — dripped through the session on the
  engine clock, newest first.

  REASON, NOT RULE (Noah, 2026-08-30): the column
  answers the reader's actual question — "why is
  this in front of me" — in a house phrase. Reason
  dots use the CATEGORICAL palette (a reason names
  a kind, never a verdict).

  AND THE READER'S OWN (Noah, 2026-08-30): reasons
  you write land in this same feed, on the same
  clock, quoting the same book — marked with a
  hollow ring so you always know whose watcher
  caught the row. The builder is behind "Your
  reasons"; the vocabulary is data/flowReasons.ts.

  THE PARTNER'S LAYOUT (Noah, 2026-10-13): time,
  ticker and contract stand still at the left, the
  print's money at the right; the cut lives in the
  address so Link and Save work; an Expiry card; the
  reason wraps to two lines, never cut mid-word;
  two-line rows on a phone.
==================================================
*/

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CalendarDays } from 'lucide-react';
import { useMarketData } from '../../context/MarketDataContext';
import { buildCatches, floorPackaged, FRESH_VOL_OI, notABet, spreadLegHint, stockLike, volOiText, reasonPhrase, WATCHERS, type WatcherKey, type Catch } from '../../data/flowBook';
import { dayLean, standing, useLiveBook, usd as fmtUsd } from '../../data/traceLive';
import { dayAdv, dayPos, earnWords, shyPct } from '../../components/trace/dayWords';
import { reasonSentence, useReasons } from '../../data/flowReasons';
import type { BookContract } from '../../types/trace';
import type { Column } from '../../components/ui/DataTable';
import CompanyLogo from '../../components/ui/CompanyLogo';
import DropdownSelect, { type DropdownOption } from '../../components/ui/DropdownSelect';
import WatchStar from '../../components/trace/WatchStar';
import { contractKey, watchContract } from '../../context/WatchContext';
import LeanCell from '../../components/trace/LeanCell';
import RichRead from '../../components/ui/RichRead';
import BookDrill from '../../components/trace/BookDrill';
import ContractCell from '../../components/trace/ContractCell';
import { earnMarks, weightInk } from '../../components/trace/earnedInk';
import { LiveHold, useHold } from '../../components/trace/LiveHold';
import ExpiryCalendar from '../../components/ui/ExpiryCalendar';
import { useExpiryCut } from '../../components/trace/bookExpiry';
import { isoDate } from '../../core/calendar';
import ColumnChooser, { useHiddenColumns } from '../../components/trace/ColumnChooser';
import ReasonDoor from '../../components/trace/ReasonDoor';
import ReadDoor from '../../components/trace/ReadDoor';
import FlowSearch, { normSymbol } from '../../components/trace/FlowSearch';
import TraceBox, { Champion, Fact, PhoneRow, TraceGrid } from '../../components/trace/TraceBox';
import { WatchersGuide } from '../../components/trace/TraceGuide';
import { SavedCutsControl, SavedCutsList, useSavedCuts } from '../../components/trace/SavedCuts';
import { isIsoDay, isQuery, oneOf, useAddressCut } from '../../components/trace/addressCut';
import { createViewStore } from '../../data/savedViews';
import { expiryLabel, pctSigned } from '../../core/format';

/** A day's lean with the figure it is called on (audit round 7: "bid", "ask", "even" with no share) — the one lean rule */
const leanText = (r: BookContract): string => {
  if (notABet(r)) return floorPackaged(r) ? 'floor package · no lean' : `spread legs ${Math.round(r.multiPct)}% · no lean`;
  const l = dayLean(r);
  if (l.lean === 'ASK') return `ask ${Math.round(l.askSided)}%`;
  if (l.lean === 'BID') return `bid ${Math.round(l.bidSided)}%`;
  if (l.lean === 'UNSIDED') return Number.isFinite(l.mid) ? `mid ${Math.round(l.mid)}%` : 'no side';
  return `even · ${l.askSided >= 50 ? `ask ${shyPct(l.askSided)}%` : `bid ${shyPct(l.bidSided)}%`}`;
};
const num = (v: number) => v.toLocaleString('en-US');

/* THE CARDS (the walk, 2026-09-09) */
const SIDE_OPTIONS: DropdownOption<'ALL' | 'C' | 'P'>[] = [
  { value: 'ALL', label: 'Both', hint: 'Calls and puts' },
  { value: 'C', label: 'Calls', hint: 'Calls only' },
  { value: 'P', label: 'Puts', hint: 'Puts only' },
];
/** the print reads "18,479 @ $1.12" — 118 cut it to "@ $..."; the reason wraps to two lines, so it gives the room */
const WIDTHS: Record<string, number> = { time: 92, ticker: 96, contract: 168, dte: 64, reason: 212, clip: 132, clipprem: 100, sideCol: 92, otm: 76, earn: 128 };
const FLEXES: Record<string, number> = { reason: 3 };
const PIN_LEFT = ['time', 'ticker', 'contract'];
const PIN_RIGHT = ['clipprem'];
const WATCHER_CUTS = createViewStore('slayer_watchers_cuts_v1');
const TOOLTIPS: Record<string, string> = {
  reason: "Why the contract is in front of you — the desk's watchers, or one you wrote (the hollow ring)",
  time: "When the contract last printed in the session, New York",
  clip: "The contract's last fill in the session",
  clipprem: "The contract's premium in the session — every print, not one",
  sideCol: "Where its day's volume leaned — at the ask or on the bid (55% or more of the sided volume, with at least half the day on a side), even, or mostly mid / no side",
  voloi: 'Volume over open interest — at 1.5 and above the positions were built in the session; "new" when there was no open interest to divide by',
};

/** Categorical reason dots — same idea as sector dots: a hue names the kind. The house's categorical tokens, cut deep on
    paper. */
const RULE_DOT: Record<WatcherKey, string> = {
  'big-money': 'rgb(var(--cat-analyst))',
  'into-earnings': 'rgb(var(--cat-earnings))',
  climbing: 'rgb(var(--cat-macro))',
  falling: 'rgb(var(--cat-ma))',
  'fresh-size': 'rgb(var(--cat-guidance))',
  hammering: 'rgb(var(--cat-regulatory))',
};

const RULE_META = Object.fromEntries(WATCHERS.map(r => [r.key, r])) as Record<WatcherKey, (typeof WATCHERS)[number]>;

/** A catch on a phone */
const phoneRow = (a: Catch) => (
  <PhoneRow
    lead={<WatchStar k={contractKey(a.row)} make={() => watchContract(a.row, 'watchers')} />}
    title={
      <>
        <span className="font-bold">{a.row.ticker}</span>
        <span className="font-bold tnum">{a.row.strike}</span>
        <span className={a.row.right === 'C' ? 'text-bull' : 'text-bear'}>{a.row.right === 'C' ? 'call' : 'put'}</span>
        <span className="text-[11px] text-textSecondary tnum">{a.row.expiry.slice(0, 5)}</span>
      </>
    }
    aside={a.time}
    figures={[
      <span key="p" className="font-semibold text-textPrimary">
        {fmtUsd(a.premium)} {dayAdv()}
      </span>,
      <span key="s">last ${a.last.toFixed(2)} at {a.time}</span>,
      <span key="z">{num(a.row.volume)} vol · {leanText(a.row)}</span>,
    ]}
  />
);

const Watchers = () => {
  const { marketData, activeTicker } = useMarketData();
  const myReasons = useReasons();
  /* THE CUT IS THE ADDRESS: the reason, the side, the search and the expiry can be sent and saved */
  const addr = useAddressCut({
    reason: { def: 'ALL', valid: (v: string) => v.length > 0 && v.length < 64 },
    side: { def: 'ALL', valid: oneOf(['ALL', 'C', 'P']) },
    q: { def: '', valid: isQuery },
    exp: { def: '', valid: isIsoDay },
  });
  const rule = addr.cut.reason;
  const setRule = (v: string) => addr.set({ reason: v });
  const side = addr.cut.side as 'ALL' | 'C' | 'P';
  const setSide = (v: 'ALL' | 'C' | 'P') => addr.set({ side: v });
  const query = addr.cut.q;
  const setQuery = (v: string) => addr.set({ q: v });
  const cuts = useSavedCuts();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  /* THE MARKET'S BOOK ONLY (audit round 5: the shell's active ticker was silently added — the market's top 200 plus its
     top 80 — so changing the ticker elsewhere changed the "market" figures). A name is read with the search. */
  const bookPack = useLiveBook(null);
  const liveBook = bookPack.rows;
  /* NOT YET IS NOT NOTHING (audit round 8, major 5: "Contracts caught 0 … Nothing flagged today" while the book loaded) */
  const reading = bookPack.waiting && liveBook.length === 0;
  // The shared hold (see LiveHold): book and tick freeze together while paused.
  const hold = useHold(useMemo(() => ({ book: liveBook, tick: marketData }), [liveBook, marketData]), activeTicker, !reading);
  const { book: heldBook, tick } = hold.value;
  /* THE EXPIRY CUT: the watchers run over the cut book */
  const { expiry, setExpiry, expiries, cut: cutExpiry, chosen } = useExpiryCut(heldBook, r => r.expiry, { value: addr.cut.exp || null, onChange: iso => addr.set({ exp: iso ?? '' }) });
  /* THE CONTRACTS THAT STILL STAND (the re-audit, 2026-10-22: contracts that expired at today's bell were caught as if
     they stood) — the expired ones are left out, and the sentence says how many */
  const stand = useMemo(() => standing(cutExpiry(heldBook)), [heldBook, cutExpiry]);
  const book = stand.rows;
  const keyOf = useCallback((a: { id: string }) => a.id, []);
  const openRow = useCallback((a: { row: { key: string } }) => setOpenKey(a.row.key), []);
  const catches = useMemo(() => buildCatches(book, myReasons), [book, myReasons]);
  const bookSize = book.length;

  /* One lookup for both shelves — the column, the chips and the header hint
     all resolve a reason's words through this, so a row and its filter chip
     can never describe the same reason differently. */
  const reasonOf = useMemo(() => {
    const mine = new Map(myReasons.map(r => [r.id, r]));
    return (key: string): { label: string; phrase: string; mine: boolean } | null => {
      const house = RULE_META[key as WatcherKey];
      if (house) return { label: house.label, phrase: house.reason, mine: false };
      const own = mine.get(key);
      return own ? { label: own.name, phrase: reasonSentence(own), mine: true } : null;
    };
  }, [myReasons]);

  /* Delete the reason you were filtered to and the filter would go on hiding
     everything for a reason that no longer exists — an empty table with no
     way to read why. Fall back to the whole feed. */
  useEffect(() => {
    if (rule !== 'ALL' && !reasonOf(rule)) setRule('ALL');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rule, reasonOf]);

  const rows = useMemo(() => {
    const nq = normSymbol(query);
    return catches.filter(a => (rule === 'ALL' || a.rules.includes(rule)) && (side === 'ALL' || a.row.right === side) && (nq === '' || normSymbol(`${a.row.ticker}${a.row.strike}${a.row.right}`).includes(nq)));
  }, [catches, rule, side, query]);
  const shown = rows;

  /* One row per contract for the search's tallies — a loud contract is caught
     twice, and counting it twice would double its money in the suggestions. */
  const searchRows = useMemo(() => {
    const seen = new Map<string, BookContract>();
    for (const a of catches) if (!seen.has(a.row.key)) seen.set(a.row.key, a.row);
    return [...seen.values()];
  }, [catches]);

  /* Three registers per column (Noah, 2026-08-30) - and the Print $ champion
     in magenta is this feed's own LARGEST PRINT, the tape chart's grammar. */
  const marks = useMemo(
    () => ({
      prem: earnMarks(shown, a => a.premium),
      vol: earnMarks(shown, a => a.row.volume),
      oi: earnMarks(shown, a => a.row.oi),
    }),
    [shown]
  );

  /* The read's "Latest:" door must open even when a filter has hidden that
     row — the drill list quietly carries it up front then. */
  const drillList = useMemo(() => {
    const base = shown.map(a => a.row);
    const latest = catches[0];
    return latest && !base.some(r => r.key === latest.row.key) ? [latest.row, ...base] : base;
  }, [shown, catches]);

  /* ReactNode, not a string: the newest contract is a DOOR, opening the same card (Noah, 2026-08-30). */
  const read = useMemo<ReactNode>(() => {
    if (reading) return <RichRead text="Reading the market's book…" />;
    if (bookPack.fault && heldBook.length === 0) return <RichRead text="The book did not answer — the watchers run when it does." />;
    if (catches.length === 0) return <RichRead text={`Nothing flagged ${dayAdv()} — the desk is watching.`} />;
    const byRule = new Map<string, number>();
    for (const a of catches) for (const r of a.rules) byRule.set(r, (byRule.get(r) ?? 0) + 1);
    const loud = [...byRule.entries()].sort((a, b) => b[1] - a[1])[0];
    const loudName = reasonOf(loud[0])?.label ?? 'A reason';
    const mineCount = catches.reduce((n, a) => n + (a.mine ? 1 : 0), 0);
    const latest = catches[0];
    // Yours gets its own clause when you have any — the feed is mixed, so the
    // sentence says how much of it is the desk and how much is you.
    const yours = mineCount === 0 ? '' : mineCount === 1 ? ' One came from a reason you wrote.' : ` ${mineCount} came from reasons you wrote.`;
    /* The Screener's grammar (Noah, 2026-08-30): plain count, the leading
       reason in its own words, one newest print — never "the desk has
       flagged", never a quoted label, never "at … at …". */
    const phrase = reasonOf(loud[0])?.phrase ?? loudName;
    const why = phrase.charAt(0).toLowerCase() + phrase.slice(1);
    const names = new Set(catches.map(a => a.row.ticker)).size;
    return (
      <>
        <RichRead text={`${catches.length} ${catches.length === 1 ? 'contract' : 'contracts'} caught on ${names} names among the ${num(bookSize)} standing contracts on the market's book (the vendor's 200 with ${dayPos()} heaviest premium${stand.expired ? `; ${num(stand.expired)} that expired at ${dayPos()} bell left out` : ''}) — [[${loud[1]}]] because ${why}.${yours} Most recent print: `} />
        <ReadDoor onOpen={() => setOpenKey(latest.row.key)}>
          {latest.row.ticker} {latest.row.strike}
          {latest.row.right}
        </ReadDoor>
        <RichRead text={`, last at $${latest.last.toFixed(2)} (${latest.time} ET), ${fmtUsd(latest.premium)} ${dayAdv()}.`} />
      </>
    );
  }, [catches, reasonOf, bookSize, stand.expired, reading, bookPack.fault, heldBook.length]);

  const activeRule = rule === 'ALL' ? null : reasonOf(rule);
  /* The Reason card: every reason, the desk's then yours */
  const reasonOptions = useMemo<DropdownOption<string>[]>(
    () => [
      { value: 'ALL', label: 'Every reason', short: 'All', hint: "The desk's watchers and yours" },
      ...WATCHERS.map(r => ({ value: r.key, label: r.label, hint: r.hint })),
      ...myReasons.map(r => ({ value: r.id, label: r.name, hint: reasonSentence(r) })),
    ],
    [myReasons]
  );

  const columns = useMemo<Column<Catch>[]>(
    () => [
      {
        key: 'time',
        header: 'Time',
        sortValue: a => a.minute,
        // The star leads the row, the tape's own placement (see WatchStar).
        render: a => (
          <span className="inline-flex items-center gap-1.5">
            <WatchStar k={contractKey(a.row)} make={() => watchContract(a.row, 'watchers')} />
            <span className="text-[11px] text-textPrimary">{a.time}</span>
          </span>
        ),
      },
      {
        key: 'ticker',
        header: 'Ticker',
        sortValue: a => a.row.ticker,
        render: a => (
          <span className="inline-flex items-center gap-1.5">
            <CompanyLogo ticker={a.row.ticker} size={15} />
            <span className="font-bold text-textPrimary">{a.row.ticker}</span>
          </span>
        ),
      },
      {
        key: 'contract',
        header: 'Contract',
        align: 'right',
        sortValue: a => a.row.strike,
        render: a => <ContractCell strike={a.row.strike} right={a.row.right} expiry={a.row.expiry} />,
      },
      {
        key: 'dte',
        header: 'DTE',
        align: 'right',
        sortValue: a => a.row.dte,
        render: a => <span className="text-textPrimary">{a.row.dte}d</span>,
      },
      {
        key: 'reason',
        header: 'Reason',
        sortValue: a => a.rule,
        /* The why, spoken — not the machinery's name for it. A house reason
           wears its categorical hue; one of yours wears a hollow ring and
           leads with the handle you gave it. Shape says whose, hue says which. */
        render: a => {
          /* EVERY REASON TOGETHER, each in the contract's own figure — one row a contract */
          const said = a.rules
            .map(k => {
              const meta = reasonOf(k);
              if (!meta) return null;
              return { k, mine: meta.mine, label: meta.label, text: meta.mine ? `${meta.label}: ${meta.phrase}` : reasonPhrase(k as WatcherKey, a.row) };
            })
            .filter((x): x is { k: string; mine: boolean; label: string; text: string } => !!x);
          if (!said.length) return <span className="text-textSecondary">—</span>;
          return (
            /* TWO LINES, NEVER CUT MID-WORD */
            <span className="inline-flex items-center gap-1.5 text-[11px] leading-tight text-textPrimary whitespace-normal" title={said.map(x => x.text).join(' · ')}>
              <span className="inline-flex gap-0.5 shrink-0">
                {said.map(x => (x.mine ? <span key={x.k} className="w-1.5 h-1.5 rounded-full border border-textSecondary" /> : <span key={x.k} className="w-1.5 h-1.5 rounded-full" style={{ background: RULE_DOT[x.k as WatcherKey] }} />))}
              </span>
              <span className="line-clamp-2">{said.map(x => x.text).join(' · ')}</span>
            </span>
          );
        },
      },
      {
        key: 'clip',
        header: 'Last fill',
        align: 'right',
        sortValue: a => a.last,
        render: a => (
          <span className="text-textPrimary" title="The contract's last fill, and its New York time">
            ${a.last.toFixed(2)} <span className="text-[11px] text-textSecondary">{a.time}</span>
          </span>
        ),
      },
      {
        key: 'clipprem',
        header: 'Day $',
        align: 'right',
        sortValue: a => a.premium,
        render: a => <span className={weightInk(a.premium, marks.prem)}>{fmtUsd(a.premium)}</span>,
      },
      {
        key: 'sideCol',
        header: 'Day lean',
        align: 'right',
        sortValue: a => a.row.askPct,
        // The tape's rule: the side in one ink
        /* THE LEAN PRINTS ITS FIGURE (audit round 7: "bid", "ask", "even" with no share) — the house lean cell, the one rule */
        render: a => (a.row.sideVol ? <LeanCell askPct={a.row.askPct} split={a.row.sideVol} legsPct={a.row.multiPct} /> : <span className={`text-[11px] ${a.side === 'EVEN' || a.side === 'MID' || a.side === 'LEGS' ? 'text-textMuted' : 'text-textPrimary'}`}>{leanText(a.row)}</span>),
      },
      {
        key: 'vol',
        header: 'Vol',
        align: 'right',
        sortValue: a => a.row.volume,
        render: a => <span className={weightInk(a.row.volume, marks.vol)}>{num(a.row.volume)}</span>,
      },
      {
        key: 'oi',
        header: 'OI',
        align: 'right',
        sortValue: a => a.row.oi,
        render: a => <span className={weightInk(a.row.oi, marks.oi)}>{num(a.row.oi)}</span>,
      },
      {
        key: 'voloi',
        header: 'Vol/OI',
        align: 'right',
        sortValue: a => a.row.volOverOI,
        render: a => <span className={a.row.oi > 0 && a.row.volOverOI >= FRESH_VOL_OI ? 'font-bold text-textPrimary' : 'text-textPrimary'} title={a.row.volOverOI > 0 || !(a.row.volume > 0) ? undefined : 'No open interest before the session — a new contract, nothing to divide by'}>{volOiText(a.row)}</span>,
      },
      {
        key: 'otm',
        header: 'OTM %',
        align: 'right',
        sortValue: a => a.row.otmPct,
        render: a => (Number.isFinite(a.row.otmPct) ? <span className="text-textPrimary">{pctSigned(a.row.otmPct, 1)}</span> : <span className="text-textMuted" title="The index level comes in whole points — too coarse for this distance on a small index (XSP, VIX)">—</span>),
      },
      {
        key: 'earn',
        header: 'Earnings',
        align: 'right',
        sortValue: a => a.row.earnDays ?? 999,
        render: a => { const e = earnWords(a.row); return e ? <span className={a.row.earnDays! <= 5 ? 'text-warn' : 'text-textPrimary'} title={e.title}>{e.text}</span> : <span className="text-textSecondary">—</span>; },
      },
    ],
    // The Reason cell reads the shelf through reasonOf, the magnitude cells
    // read the marks — frozen deps here rot both.
    [reasonOf, marks]
  );

  /* THE TAPE'S HEAD, THIS PAGE'S RULES (Noah, 2026-08-30): the composition
     strip — facts left, champions as pills right — and the column chooser.
     The side champions wear the plain ink: a side is not a direction. */
  const champs = useMemo(() => {
    /* a day that was mostly floor-traded multi-leg packages (compression's shape) is not crowned "most money" — it is
       named on its own (flowBook floorPackaged) */
    /* …nor is a day of spread legs (audit round 8: "Most money · bid-leaning CCJ 65P" was 39,000 of 39,000 contracts in
       multi-leg orders) — set apart with the packages, never given a lean */
    const by = (pick: (a: Catch) => boolean) => shown.filter(a => !notABet(a.row) && pick(a)).reduce<Catch | null>((a, x) => (a === null || x.premium > a.premium ? x : a), null);
    const packaged = shown.filter(a => notABet(a.row)).reduce<Catch | null>((a, x) => (a === null || x.premium > a.premium ? x : a), null);
    return { ask: by(a => a.side === 'ASK'), bid: by(a => a.side === 'BID'), all: by(() => true), packaged };
  }, [shown]);
  const facts = useMemo(() => {
    const byRule = new Map<string, number>();
    let mine = 0;
    for (const a of catches) {
      for (const r of a.rules) byRule.set(r, (byRule.get(r) ?? 0) + 1);
      if (a.mine) mine++;
    }
    const loud = [...byRule.entries()].sort((a, b) => b[1] - a[1])[0];
    return { total: catches.length, loudName: loud ? (reasonOf(loud[0])?.label ?? '') : '', loudCount: loud ? loud[1] : 0, mine };
  }, [catches, reasonOf]);
  /* the expiry rides in the pill — two SPX 7000 calls on different dates are two contracts */
  const pill = (a: Catch) => `${a.row.ticker} ${a.row.strike}${a.row.right} ${expiryLabel(a.row.expiry)} · ${fmtUsd(a.premium)} ${dayAdv()}${stockLike(a.row) ? ' · stock-like' : ''}`;

  const { hidden, toggle, showAll, hideAll } = useHiddenColumns('slayer_flowalerts_cols');
  const chooserCols = useMemo(() => columns.map(c => ({ key: c.key, label: typeof c.header === 'string' ? c.header : c.key })), [columns]);
  const selectedId = openKey ? (shown.find(a => a.row.key === openKey)?.id ?? null) : null;

  return (
    <>
      <TraceBox
        title="The desk watching the tape"
        sub={`${activeRule ? `${activeRule.label} — ${activeRule.phrase}` : "Every contract on the book a reason flags — the desk's and yours"} · newest last print first · a row opens the contract's card`}
        testId="watchers"
        data={{ rule, rows: rows.length, expiry: expiry ?? 'all' }}
        guide={{ title: 'How to read the watchers', door: 'What a reason, the print and the side mean', body: <WatchersGuide />, testId: 'watchers-guide', open: guideOpen, onOpen: setGuideOpen }}
        facts={
          <>
            {/* the most frequent reason, named, its count after — never a reason read as a noun */}
            <Fact label="Contracts caught" testId="caught" title={`Contracts on the market's book (the ${num(bookSize)} standing ones among the vendor's 200 with the most premium ${dayAdv()}, every name — the terminal's ticker is not added) that meet a reason — each counted once, whatever number of reasons it meets`}>
              {reading ? <span className="text-textMuted">—</span> : num(facts.total)}
              {!reading && facts.loudName && (
                <span className="text-textSecondary">
                  {' '}
                  · most often {facts.loudName} ({facts.loudCount})
                </span>
              )}
            </Fact>
            <Fact label="From your reasons" testId="mine">
              {reading ? <span className="text-textMuted">—</span> : <span className={facts.mine > 0 ? 'text-textPrimary' : 'text-textSecondary'}>{facts.mine}</span>}
            </Fact>
            {champs.ask && champs.ask !== champs.all && (
              <Champion label="Most money · ask-leaning" ink="plain" onOpen={() => setOpenKey(champs.ask!.row.key)} testId="top-ask">
                {pill(champs.ask)}
              </Champion>
            )}
            {champs.bid && champs.bid !== champs.all && (
              <Champion label="Most money · bid-leaning" ink="plain" onOpen={() => setOpenKey(champs.bid!.row.key)} testId="top-bid">
                {pill(champs.bid)}
              </Champion>
            )}
            {champs.all && (
              <Champion label={`Most money ${dayAdv()}`} ink="supreme" title="The biggest single bet by premium — among contracts whose day was not mostly floor-traded packages or spread legs (half or more in multi-leg orders)" onOpen={() => setOpenKey(champs.all!.row.key)} testId="largest">
                {pill(champs.all)}
              </Champion>
            )}
            {champs.packaged && (!champs.all || champs.packaged.premium > champs.all.premium) && (
              <Champion label={floorPackaged(champs.packaged.row) ? 'Floor packages · not a bet' : 'Spread legs · not a bet'} ink="plain" title={floorPackaged(champs.packaged.row) ? `More premium, but ${Math.round(champs.packaged.row.floorPct)}% of its day traded on the floor and ${Math.round(champs.packaged.row.multiPct)}% in multi-leg packages — the shape of compression (OPRA cbmo), which nets open interest down, not a directional bet` : `More premium, but ${spreadLegHint(champs.packaged.row)}`} onOpen={() => setOpenKey(champs.packaged!.row.key)} testId="packaged">
                {pill(champs.packaged)}
              </Champion>
            )}
          </>
        }
        controls={
          <>
            <LiveHold paused={hold.paused} onToggle={hold.toggle} heldAt={hold.heldAt} waitingFirst={hold.waitingFirst} />
            <FlowSearch value={query} onChange={setQuery} rows={searchRows} countNoun="contracts" span />
            <DropdownSelect label="Reason" value={rule} options={reasonOptions} onChange={setRule} title="Which watcher's catches" testId="watchers-reason" />
            <DropdownSelect label="Side" value={side} options={SIDE_OPTIONS} onChange={setSide} title="Calls, puts or both" testId="watchers-side" />
            <ExpiryCalendar value={chosen ? isoDate(chosen.date) : ''} expiries={expiries} onChange={e => setExpiry(isoDate(e.date))} onClear={() => setExpiry(null)} label="Expiry" icon={CalendarDays} steppers={false} title="Only contracts on one expiry — or every expiry" testId="watchers-expiry" />
            <ReasonDoor book={book} />
            <SavedCutsControl store={WATCHER_CUTS} query={addr.query} onOpen={addr.open} noun="cut" testId="watchers" onSay={cuts.say} open={cuts.open} onToggleOpen={cuts.toggle} />
            <div className="ml-auto">
              <ColumnChooser columns={chooserCols} hidden={hidden} onToggle={toggle} onAll={showAll} onNone={() => hideAll(columns.map(c => c.key))} />
            </div>
          </>
        }
        sentence={
          <>
            <SavedCutsList store={WATCHER_CUTS} query="" onOpen={addr.open} noun="cut" testId="watchers" onSay={cuts.say} open={cuts.open} />
            {cuts.said && (
              <p role="status" className="mb-2 font-mono text-[11px] text-textSecondary">
                {cuts.said}
              </p>
            )}
            {read}
          </>
        }
      >
        <TraceGrid rows={shown} columns={columns} hidden={hidden} widths={WIDTHS} flexes={FLEXES} tooltips={TOOLTIPS} rowKey={keyOf} onRowClick={openRow} selectedKey={selectedId} pinLeft={PIN_LEFT} pinRight={PIN_RIGHT} phoneRow={phoneRow} autoHeight emptyText={reading ? 'Reading the book…' : bookPack.fault && heldBook.length === 0 ? 'This read did not land — the watchers run when the book answers' : 'Nothing on the book meets a reason yet — the desk is watching'} testId="watchers" />
      </TraceBox>

      <BookDrill list={drillList} openKey={openKey} onOpen={setOpenKey} tick={tick} />
    </>
  );
};

export default Watchers;
