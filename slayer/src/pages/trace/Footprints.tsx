/*
==================================================
  SLAYER TERMINAL - FOOTPRINTS (Trace)
  What the flow left standing (Noah, 2026-08-30 —
  expansion page 2, from the reference's open-
  interest explorer; renamed: footprints are the
  marks the prints leave behind).

  Volume is loud and gone by the close; open
  interest is what STAYED. This page ranks the
  overnight ledger — positions built, positions
  unwound, who built them (ask or bid side), and
  whether the build has legs (streaks). Same laws
  as the Screener: screens are questions, the one
  state engine only speaks inside the contract
  card, every column open.

  THE PARTNER'S LAYOUT (Noah, 2026-10-13): the
  ticker and the contract stand still at the left
  while the rest scrolls, the page's one figure —
  ΔOI — stands at the right; the cut lives in the
  address (addressCut.ts) so Link and Save work;
  an Expiry card; the Screen card; two-line rows on
  a phone; a build with no standing interest never
  wears the fastest-build crown.
==================================================
*/

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { CalendarDays } from 'lucide-react';
import { useMarketData } from '../../context/MarketDataContext';
import { FOOTPRINT_SCREENS, runFootprintScreen, stockLike, type FootprintScreenKey } from '../../data/flowBook';
import { standing, useLiveBook, usd as fmtUsd } from '../../data/traceLive';
import { dayAdv, dayLabel, dayPos, earnWords, oiSpanWords, prevSessionIso, shortDay } from '../../components/trace/dayWords';
import type { BookContract } from '../../types/trace';
import type { Column } from '../../components/ui/DataTable';
import CompanyLogo from '../../components/ui/CompanyLogo';
import DropdownSelect, { type DropdownOption } from '../../components/ui/DropdownSelect';
import WatchStar from '../../components/trace/WatchStar';
import { contractKey, watchContract } from '../../context/WatchContext';
import RichRead from '../../components/ui/RichRead';
import BookDrill from '../../components/trace/BookDrill';
import ContractCell from '../../components/trace/ContractCell';
import ReadDoor from '../../components/trace/ReadDoor';
import { earnMarks, weightInk, type InkMarks } from '../../components/trace/earnedInk';
import FlowSearch, { normSymbol } from '../../components/trace/FlowSearch';
import { LiveHold, useHold } from '../../components/trace/LiveHold';
import ColumnChooser, { useHiddenColumns } from '../../components/trace/ColumnChooser';
import LeanCell from '../../components/trace/LeanCell';
import TraceBox, { Champion, Fact, PhoneRow, TraceGrid } from '../../components/trace/TraceBox';
import { SavedCutsControl, SavedCutsList, useSavedCuts } from '../../components/trace/SavedCuts';
import { isIsoDay, isQuery, oneOf, useAddressCut } from '../../components/trace/addressCut';
import { createViewStore } from '../../data/savedViews';
import { FootprintsGuide } from '../../components/trace/TraceGuide';
import ExpiryCalendar from '../../components/ui/ExpiryCalendar';
import { useExpiryCut } from '../../components/trace/bookExpiry';
import { isoDate } from '../../core/calendar';
import { pctSigned } from '../../core/format';

const num = (v: number) => v.toLocaleString('en-US');

/* THE CARDS (the walk, 2026-09-09): the filters popover's chips as labelled cards */
const SIDE_OPTIONS: DropdownOption<'ALL' | 'C' | 'P'>[] = [
  { value: 'ALL', label: 'Both', hint: 'Calls and puts' },
  { value: 'C', label: 'Calls', hint: 'Calls only' },
  { value: 'P', label: 'Puts', hint: 'Puts only' },
];
/* wide enough for their heads */
/** The previous session's columns — dropped when the book does not carry them */
const PREV_DAY_KEYS = new Set(['builton', 'prevvol', 'prevprem', 'spark']);
const WIDTHS: Record<string, number> = { ticker: 124, contract: 168, dte: 64, otm: 76, doi: 104, doipct: 86, builton: 104, prevavg: 88, prevprem: 92, streak: 72, spark: 96, earn: 128, lean: 96 };
const PIN_LEFT = ['ticker', 'contract'];
const PIN_RIGHT = ['doi'];
const FOOT_CUTS = createViewStore('slayer_footprints_cuts_v1');
/* A "fastest build" on a near-empty contract is a percentage of nothing ("+46,175%" on 77 contracts): the champion ranks
   only builds that stood on this much open interest */
const FASTEST_MIN_PREV_OI = 500;

/** Which side built it, in words */
const builtWords = (r: BookContract) => {
  const bid = 100 - r.prevAskPct;
  /* the live book carries no prior-session side (prevVolume 0): no side to name, never a default "on the bid" */
  if (!Number.isFinite(r.prevAskPct) || !(r.prevVolume > 0)) return null;
  return r.prevAskPct - bid >= 16 ? 'built at the ask' : bid - r.prevAskPct >= 16 ? 'built on the bid' : 'built at the mid';
};

/** A contract's overnight on a phone */
const phoneRow = (r: BookContract) => (
  <PhoneRow
    lead={<WatchStar k={contractKey(r)} make={() => watchContract(r, 'footprints')} />}
    title={
      <>
        <span className="font-bold">{r.ticker}</span>
        <span className="font-bold tnum">{r.strike}</span>
        <span className={r.right === 'C' ? 'text-bull' : 'text-bear'}>{r.right === 'C' ? 'call' : 'put'}</span>
        <span className="text-[11px] text-textSecondary tnum">{r.expiry.slice(0, 5)}</span>
      </>
    }
    aside={`${r.dte}d`}
    figures={[
      <span key="d" className={r.deltaOI > 0 ? 'font-semibold text-bull' : r.deltaOI < 0 ? 'font-semibold text-bear' : ''}>
        {r.deltaOI > 0 ? '+' : r.deltaOI < 0 ? '−' : ''}
        {num(Math.abs(r.deltaOI))} OI
      </span>,
      <span key="o">{num(r.oi)} standing</span>,
      ...(builtWords(r) ? [<span key="b">{builtWords(r)}</span>] : []),
    ]}
  />
);

const TOOLTIPS: Record<string, string> = {
  oi: 'Open interest as of the last close',
  prevoi: 'Open interest as of the close before',
  doi: 'What open interest did from the session before to this one — positions built or unwound',
  doipct: 'The change as a share of what stood before',
  builton: 'Which side did the building in the session before — at the ask, buyers; on the bid, sellers',
  prevavg: "The contract's close the session before",
  streak: 'Sessions in a row the interest has grown',
  spark: "Yesterday's volume, quarter hour by quarter hour",
  earn: "The name's next report, if it sits inside the position's runway",
};

/* The quintile machinery moved to components/trace/earnedInk.ts (2026-08-30,
   when the whole flow family got the three-register pass) and gained the
   SUPREME tier there - one magenta champion per column. */
const dirInk = (v: number, m: InkMarks): string =>
  Math.abs(v) >= m.top ? 'text-supreme font-bold' : Math.abs(v) >= m.bar ? (v > 0 ? 'text-bull dir-up' : 'text-bear dir-down') : 'text-textPrimary';

/** The prior session's 15-min volume shape — a whisper, not a second fact. */
const PrevSpark = ({ values }: { values: number[] }) =>
  values.length === 0 ? (
    <span className="text-textSecondary">—</span>
  ) : (
    <svg width={52} height={14} aria-hidden className="block">
      {values.map((v, i) => {
        const h = Math.max(1, v * 13);
        /* the primary ink, a token — a literal near-white vanished on paper */
        return <rect key={i} x={i * 2} y={14 - h} width={1.4} height={h} fill="rgb(var(--text-primary) / 0.6)" />;
      })}
    </svg>
  );

const Footprints = () => {
  const { marketData, activeTicker } = useMarketData();
  /* THE CUT IS THE ADDRESS */
  const addr = useAddressCut({
    screen: { def: 'builds', valid: oneOf(FOOTPRINT_SCREENS.map(x => x.key)) },
    side: { def: 'ALL', valid: oneOf(['ALL', 'C', 'P']) },
    q: { def: '', valid: isQuery },
    exp: { def: '', valid: isIsoDay },
  });
  const screenAsked = addr.cut.screen as FootprintScreenKey;
  const setScreen = (v: FootprintScreenKey) => addr.set({ screen: v });
  const side = addr.cut.side as 'ALL' | 'C' | 'P';
  const setSide = (v: 'ALL' | 'C' | 'P') => addr.set({ side: v });
  const query = addr.cut.q;
  const setQuery = (v: string) => addr.set({ q: v });
  const cuts = useSavedCuts();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  /* THE MARKET'S BOOK ONLY (audit round 5: the "market" book silently took in the shell's active ticker — the market's top
     200 plus SPY's top 80 — so changing the ticker elsewhere moved the market's figures, and SPY 767P stood as the
     biggest build though it is not among the market's 200). A name is read with the search. */
  const liveBook = useLiveBook(null).rows;
  // The shared hold (see LiveHold): book and tick freeze together while paused.
  const hold = useHold(useMemo(() => ({ book: liveBook, tick: marketData }), [liveBook, marketData]), activeTicker);
  const { book: heldBook, tick } = hold.value;
  /* THE EXPIRY CUT: the dates on the book, as a calendar */
  const { expiry, setExpiry, expiries, cut: cutExpiry, chosen } = useExpiryCut(heldBook, r => r.expiry, { value: addr.cut.exp || null, onChange: iso => addr.set({ exp: iso ?? '' }) });
  /* WHAT STILL STANDS (the re-audit, 2026-10-22: 64 of 146 builds were Oct 22 contracts, read after the bell as standing
     interest) — a contract that expired at the bell is left out, and the sentence says how many */
  const stand = useMemo(() => standing(cutExpiry(heldBook)), [heldBook, cutExpiry]);
  const book = stand.rows;
  /* THE SCREENS THE FEED CAN ANSWER (the ship pass, 2026-10-22): bought/sold to open and carryover read the PREVIOUS
     session's side and volume, which the live book does not carry — "Sold to open" passed every build (a side of 0 is
     ≤ 42%) and the other two never matched. Without that data they are not offered, and a link that asks for one
     lands on the biggest builds. */
  const hasPrevSide = useMemo(() => heldBook.some(r => r.prevVolume > 0), [heldBook]);
  const PREV_ONLY: FootprintScreenKey[] = ['bought', 'sold', 'carryover'];
  const screen: FootprintScreenKey = !hasPrevSide && PREV_ONLY.includes(screenAsked) ? 'builds' : screenAsked;
  const keyOf = useCallback((r: { key: string }) => r.key, []);
  const openRow = useCallback((r: { key: string }) => setOpenKey(r.key), []);

  const rows = useMemo(() => {
    const cut = runFootprintScreen(book, screen);
    const sided = side === 'ALL' ? cut : cut.filter(r => r.right === side);
    const nq = normSymbol(query);
    return nq === '' ? sided : sided.filter(r => normSymbol(`${r.ticker}${r.strike}${r.right}`).includes(nq));
  }, [book, screen, side, query]);
  const shown = rows;

  /* THE SENTENCE FOLLOWS THE FILTER (retail, 2026-10-23: filtered to NVDA it still said "Biggest build: SPY 767P") — the
     side and the search cut the sentence's contracts; the screen is the grid's */
  const filtered = useMemo(() => {
    const sided = side === 'ALL' ? book : book.filter(r => r.right === side);
    const nq = normSymbol(query);
    return nq === '' ? sided : sided.filter(r => normSymbol(`${r.ticker}${r.strike}${r.right}`).includes(nq));
  }, [book, side, query]);
  const cutWord = useMemo(() => {
    const bits = [query ? `matching "${query}"` : '', side === 'C' ? 'calls only' : side === 'P' ? 'puts only' : ''].filter(Boolean);
    return bits.length ? bits.join(', ') : '';
  }, [query, side]);
  const loudestBuild = useMemo(() => [...filtered.filter(r => r.deltaOI > 0)].sort((a, b) => b.deltaOI - a.deltaOI)[0] ?? null, [filtered]);

  /* ReactNode: "The loudest:" is a door into the same card its table row
     opens — even when the current screen has it filtered out. */
  const read = useMemo<ReactNode>(() => {
    const builds = filtered.filter(r => r.deltaOI > 0);
    const unwinds = filtered.filter(r => r.deltaOI < 0);
    const added = builds.reduce((a, r) => a + r.deltaOI, 0);
    const removed = unwinds.reduce((a, r) => a + r.deltaOI, 0);
    if (builds.length === 0 && unwinds.length === 0) return <RichRead text={`No open interest changed ${oiSpanWords()} on ${cutWord ? `the contracts ${cutWord}` : 'the book'}.`} />;
    /* The Screener's grammar (Noah, 2026-08-30): what open interest did, in
       plain words — no "standing interest", no "builds and unwinds" puzzle. */
    /* WHAT IT COVERS (the audit, 2026-10-22: "Open interest grew by 297,774 overnight" summed only the book's contracts) */
    const base = `Across the ${num(filtered.length)} standing contract${filtered.length === 1 ? '' : 's'} ${cutWord ? `${cutWord} ` : ''}on the market's book (the vendor's 200 contracts with ${dayPos()} heaviest premium${stand.expired ? `; ${num(stand.expired)} that expired at ${dayPos()} bell left out` : ''}), open interest rose ${num(added)} ${oiSpanWords()} on ${builds.length} of them and fell ${num(Math.abs(removed))} on ${unwinds.length}.`;
    if (!loudestBuild) return <RichRead text={base} />;
    return (
      <>
        <RichRead text={`${base} Biggest build: `} />
        <ReadDoor onOpen={() => setOpenKey(loudestBuild.key)}>
          {loudestBuild.ticker} {loudestBuild.strike}
          {loudestBuild.right}
        </ReadDoor>
        <RichRead text={` [[+${num(loudestBuild.deltaOI)}]]${loudestBuild.prevVolume > 0 ? `, built ${loudestBuild.prevAskPct >= 50 ? 'at the ask' : 'on the bid'}` : ''}${stockLike(loudestBuild) ? ` — ${Math.abs(loudestBuild.otmPct).toFixed(0)}% in the money with ${loudestBuild.dte} days to run: likely a stock replacement or a roll, not a directional bet` : ''}.`} />
      </>
    );
  }, [filtered, cutWord, loudestBuild, stand.expired]);

  const activeScreen = FOOTPRINT_SCREENS.find(s => s.key === screen) ?? FOOTPRINT_SCREENS[0];
  const screenOptions = useMemo<DropdownOption<FootprintScreenKey>[]>(() => FOOTPRINT_SCREENS.filter(s => hasPrevSide || !['bought', 'sold', 'carryover'].includes(s.key)).map(s => ({ value: s.key, label: s.label, hint: s.hint })), [hasPrevSide]);

  /*
    INK IS EARNED, COLUMN BY COLUMN (Noah, 2026-08-30: "shoudnt the green be
    reserved for cons that are above a certain amount of positive change
    because right now they all read the same color no matter how small or big
    ... matter of fact shoudnt the entire page be like that? look at prev vol.
    they are all white making nothing stand out").

    Each column sets its OWN bar at the 80th percentile of what is actually on
    screen, and only the cells that clear it get any emphasis. ΔOI and ΔOI %
    are SIGNED, so they earn direction ink. Counts and dollars have no
    direction, so they earn WEIGHT — intensity is bold white, never a hue that
    would imply a verdict the number is not making.
  */
  const marks = useMemo(
    () => ({
      oi: earnMarks(shown, r => r.oi),
      prevOI: earnMarks(shown, r => r.prevOI),
      doi: earnMarks(shown, r => r.deltaOI),
      doiPct: earnMarks(shown, r => r.deltaOIPct),
      prevVol: earnMarks(shown, r => r.prevVolume),
      vol: earnMarks(shown, r => r.volume),
      prevAvg: earnMarks(shown, r => r.prevAvgFill),
      prevPrem: earnMarks(shown, r => r.prevPremium),
    }),
    [shown]
  );

  /* the live screener sends no previous session's volume, premium, side or tape — those columns read 0, "BID 100%" and
     a flat line on every row; they stand only when the book carries them */
  const prevKnown = useMemo(() => shown.some(r => r.prevVolume > 0 || r.prevPremium > 0), [shown]);
  const columns = useMemo<Column<BookContract>[]>(
    () => (
      [
      {
        key: 'ticker',
        header: 'Ticker',
        sortValue: r => r.ticker,
        // The star leads the row, the tape's own placement (see WatchStar).
        render: r => (
          <span className="inline-flex items-center gap-1.5">
            <WatchStar k={contractKey(r)} make={() => watchContract(r, 'footprints')} />
            <CompanyLogo ticker={r.ticker} size={15} />
            <span className="font-bold text-textPrimary">{r.ticker}</span>
          </span>
        ),
      },
      {
        key: 'contract',
        header: 'Contract',
        align: 'right',
        sortValue: r => r.strike,
        render: r => <ContractCell strike={r.strike} right={r.right} expiry={r.expiry} />,
      },
      {
        key: 'dte',
        header: 'DTE',
        align: 'right',
        sortValue: r => r.dte,
        render: r => <span className="text-textPrimary">{r.dte}d</span>,
      },
      {
        key: 'otm',
        header: 'OTM %',
        align: 'right',
        sortValue: r => r.otmPct,
        render: r => (Number.isFinite(r.otmPct) ? <span className="text-textPrimary">{pctSigned(r.otmPct, 1)}</span> : <span className="text-textMuted" title="The index level comes in whole points — too coarse for this distance on a small index (XSP, VIX)">—</span>),
      },
      {
        key: 'oi',
        header: 'OI',
        align: 'right',
        sortValue: r => r.oi,
        render: r => <span className={weightInk(r.oi, marks.oi)}>{num(r.oi)}</span>,
      },
      {
        key: 'prevoi',
        header: 'Prev OI',
        align: 'right',
        sortValue: r => r.prevOI,
        render: r => <span className={weightInk(r.prevOI, marks.prevOI)}>{num(r.prevOI)}</span>,
      },
      {
        key: 'doi',
        header: 'ΔOI',
        align: 'right',
        sortValue: r => r.deltaOI,
        /* THIS page's lead fact, so it earns the strongest treatment there
           is — direction ink AND weight — but only above the bar. Below it the
           number still reads; it just stops shouting alongside a build forty
           times its size. */
        render: r => {
          if (r.deltaOI === 0) return <span className="text-textSecondary">—</span>;
          const a = Math.abs(r.deltaOI);
          const ink = a >= marks.doi.top ? 'text-supreme font-bold' : a >= marks.doi.bar ? `font-bold ${r.deltaOI > 0 ? 'text-bull dir-up' : 'text-bear dir-down'}` : 'text-textPrimary';
          return (
            <span className={ink}>
              {r.deltaOI > 0 ? '+' : '−'}
              {num(Math.abs(r.deltaOI))}
            </span>
          );
        },
      },
      {
        key: 'doipct',
        header: 'ΔOI %',
        align: 'right',
        sortValue: r => r.deltaOIPct,
        // Ranked against the PERCENTAGES, not the contract counts — colour
        // only, so the absolute column stays the louder of the pair.
        render: r => {
          if (r.deltaOI === 0) return <span className="text-textSecondary">—</span>;
          return (
            <span className={dirInk(r.deltaOI > 0 ? Math.abs(r.deltaOIPct) : -Math.abs(r.deltaOIPct), marks.doiPct)}>
              {r.deltaOIPct > 0 ? '+' : '−'}
              {num(Math.abs(Math.round(r.deltaOIPct)))}%
            </span>
          );
        },
      },
      {
        key: 'builton',
        header: 'Built on',
        align: 'right',
        sortValue: r => r.prevAskPct,
        // Which side did the building — the tape's own bid/ask cell.
        render: r => <LeanCell askPct={r.prevAskPct} />,
      },
      {
        key: 'prevvol',
        header: 'Prev vol',
        align: 'right',
        sortValue: r => r.prevVolume,
        render: r => <span className={weightInk(r.prevVolume, marks.prevVol)}>{num(r.prevVolume)}</span>,
      },
      {
        key: 'vol',
        /* the session's own day named (audit round 6: "Vol today" at 04:15 on Oct 23 was Oct 22's) */
        header: `Vol ${dayLabel()}`,
        align: 'right',
        sortValue: r => r.volume,
        render: r => <span className={weightInk(r.volume, marks.vol)}>{num(r.volume)}</span>,
      },
      {
        key: 'prevavg',
        /* chain_prev_close is the close of the session BEFORE the book's (audit round 6: ORCL 140C "Prev close $29.58" was
           Oct 21's, beside an Oct 22 close of 26.95) — named by its date */
        header: `${shortDay(prevSessionIso())} close`,
        align: 'right',
        sortValue: r => r.prevAvgFill,
        render: r => <span className={weightInk(r.prevAvgFill, marks.prevAvg)}>${r.prevAvgFill.toFixed(2)}</span>,
      },
      {
        key: 'prevprem',
        header: 'Prev $',
        align: 'right',
        sortValue: r => r.prevPremium,
        render: r => <span className={weightInk(r.prevPremium, marks.prevPrem)}>{fmtUsd(r.prevPremium)}</span>,
      },
      {
        key: 'streak',
        header: 'Streak',
        align: 'right',
        sortValue: r => r.oiStreak,
        // A build with legs — three sessions and up earns weight, not a hue.
        render: r => (r.oiStreak === 0 ? <span className="text-textSecondary">—</span> : <span className={r.oiStreak >= 3 ? 'font-bold text-textPrimary' : 'text-textPrimary'}>{r.oiStreak}d</span>),
      },
      {
        key: 'spark',
        header: 'Prev day',
        align: 'right',
        render: r => <PrevSpark values={r.prevSpark} />,
      },
      {
        key: 'earn',
        header: 'Earnings',
        align: 'right',
        sortValue: r => r.earnDays ?? 999,
        // A report inside the position's runway is a risk event — warn ink.
        render: r => { const e = earnWords(r); return e ? <span className={r.earnDays! <= 5 ? 'text-warn' : 'text-textPrimary'} title={e.title}>{e.text}</span> : <span className="text-textSecondary">—</span>; },
      },
      ] as Column<BookContract>[]
    ).filter(c => prevKnown || !PREV_DAY_KEYS.has(c.key)),
    [marks, prevKnown]
  );

  /* THE TAPE'S HEAD, THIS PAGE'S RULES (Noah, 2026-08-30): the composition
     strip — facts left, champions as pills right — and the column chooser.
     The bull/bear pills only show when they are not the magenta one. */
  const champs = useMemo(() => {
    const builds = shown.filter(r => r.deltaOI > 0);
    const unwinds = shown.filter(r => r.deltaOI < 0);
    const build = builds.reduce<BookContract | null>((a, r) => (a === null || r.deltaOI > a.deltaOI ? r : a), null);
    const unwind = unwinds.reduce<BookContract | null>((a, r) => (a === null || r.deltaOI < a.deltaOI ? r : a), null);
    const fastest = builds.filter(r => r.prevOI >= FASTEST_MIN_PREV_OI).reduce<BookContract | null>((a, r) => (a === null || r.deltaOIPct > a.deltaOIPct ? r : a), null);
    return { build, unwind, fastest };
  }, [shown]);
  const facts = useMemo(() => {
    let added = 0;
    let shed = 0;
    let builds = 0;
    let unwinds = 0;
    for (const r of book) {
      if (r.deltaOI > 0) {
        added += r.deltaOI;
        builds++;
      } else if (r.deltaOI < 0) {
        shed -= r.deltaOI;
        unwinds++;
      }
    }
    return { added, shed, builds, unwinds };
  }, [book]);
  /* a deep-in-the-money, long-dated build trades like the stock — flagged, not read as a bet (retail, 2026-10-23) */
  const pill = (r: BookContract, v: string) => `${r.ticker} ${r.strike}${r.right} · ${v}${stockLike(r) ? ' · stock-like' : ''}`;
  const { hidden, toggle, showAll, hideAll } = useHiddenColumns('slayer_footprints_cols');
  const chooserCols = useMemo(() => columns.map(c => ({ key: c.key, label: typeof c.header === 'string' ? c.header : c.key })), [columns]);

  return (
    <>
      <TraceBox
        title="What the flow left standing"
        sub={`${activeScreen.label} — ${activeScreen.hint} · open interest is what stayed ${oiSpanWords()} · the market's book, every name — search for one · a row opens the contract's card`}
        testId="footprints"
        data={{ screen, rows: rows.length, expiry: expiry ?? 'all' }}
        guide={{ title: 'How to read the footprints', door: 'What open interest, a build and a streak mean', body: <FootprintsGuide />, testId: 'footprints-guide', open: guideOpen, onOpen: setGuideOpen }}
        facts={
          <>
            <Fact label={`OI ${oiSpanWords()} · on the book`} testId="overnight" title={`Open interest added and shed ${oiSpanWords()}, summed over the ${num(book.length)} standing contracts on the market's book — the vendor's 200 contracts with the most premium ${dayAdv()}, every name; the terminal's ticker is not added — not the whole market`}>
              <span className="text-bull">+{num(facts.added)}</span> <span className="text-textSecondary">added ·</span> <span className="text-bear">−{num(facts.shed)}</span> <span className="text-textSecondary">shed</span>
            </Fact>
            <Fact label="Contracts" testId="contracts">
              {facts.builds} <span className="text-textSecondary">built · {facts.unwinds} unwound</span>
            </Fact>
            {champs.build && champs.build !== champs.fastest && (
              <Champion label="Biggest build" ink="bull" onOpen={() => setOpenKey(champs.build!.key)} testId="build">
                {pill(champs.build, `+${num(champs.build.deltaOI)}`)}
              </Champion>
            )}
            {champs.unwind && (
              <Champion label="Biggest unwind" ink="bear" onOpen={() => setOpenKey(champs.unwind!.key)} testId="unwind">
                {pill(champs.unwind, `−${num(Math.abs(champs.unwind.deltaOI))}`)}
              </Champion>
            )}
            {champs.fastest && (
              <Champion label="Fastest build" ink="supreme" onOpen={() => setOpenKey(champs.fastest!.key)} testId="fastest">
                {pill(champs.fastest, `+${num(Math.round(champs.fastest.deltaOIPct))}%`)}
              </Champion>
            )}
          </>
        }
        controls={
          <>
            <LiveHold paused={hold.paused} onToggle={hold.toggle} heldAt={hold.heldAt} />
            <FlowSearch value={query} onChange={setQuery} rows={book} countNoun="contracts" span />
            <DropdownSelect label="Screen" value={screen} options={screenOptions} onChange={setScreen} title="Which side of the overnight ledger" testId="footprints-cut" />
            <DropdownSelect label="Side" value={side} options={SIDE_OPTIONS} onChange={setSide} title="Calls, puts or both" testId="footprints-side" />
            <ExpiryCalendar value={chosen ? isoDate(chosen.date) : ''} expiries={expiries} onChange={e => setExpiry(isoDate(e.date))} onClear={() => setExpiry(null)} label="Expiry" icon={CalendarDays} steppers={false} title="Only contracts on one expiry — or every expiry" testId="footprints-expiry" />
            <SavedCutsControl store={FOOT_CUTS} query={addr.query} onOpen={addr.open} noun="cut" testId="footprints" onSay={cuts.say} open={cuts.open} onToggleOpen={cuts.toggle} />
            <div className="ml-auto">
              <ColumnChooser columns={chooserCols} hidden={hidden} onToggle={toggle} onAll={showAll} onNone={() => hideAll(columns.map(c => c.key))} />
            </div>
          </>
        }
        sentence={
          <>
            <SavedCutsList store={FOOT_CUTS} query="" onOpen={addr.open} noun="cut" testId="footprints" onSay={cuts.say} open={cuts.open} />
            {cuts.said && (
              <p role="status" className="mb-2 font-mono text-[11px] text-textSecondary">
                {cuts.said}
              </p>
            )}
            {read}
          </>
        }
      >
        <TraceGrid rows={rows} columns={columns} hidden={hidden} widths={WIDTHS} tooltips={TOOLTIPS} rowKey={keyOf} onRowClick={openRow} selectedKey={openKey} pinLeft={PIN_LEFT} pinRight={PIN_RIGHT} phoneRow={phoneRow} autoHeight emptyText="Nothing on this cut — no contract's open interest moved enough to show under these cards" testId="footprints" />
      </TraceBox>

      <BookDrill list={loudestBuild && !shown.some(r => r.key === loudestBuild.key) ? [loudestBuild, ...shown] : shown} openKey={openKey} onOpen={setOpenKey} tick={tick} />
    </>
  );
};

export default Footprints;
