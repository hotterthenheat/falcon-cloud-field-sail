/*
==================================================
  SLAYER TERMINAL - DARK POOL (Trace)
  Off-exchange crosses with the read attached
  (2026-09-13; Noah, with his partner's two
  screenshots: "make this page in our own type
  design pattern. his placements are off"). Two
  boxes in the house grammar, read top to bottom:

    THE DARK POOL     the frame's name — the head's
                      facts and champions, the cards
                      that cut the crosses (Read ·
                      Size · Where), the sentence;
                      THE SHELVES as a board at the
                      left (the Net Flow board's
                      grammar — a shelf picked cuts
                      the grid to it) and THE GRID of
                      crosses beside it, growing with
                      its rows
    WHERE THE DARK    the market's dark tape by
    MONEY WENT        sector and by name, heaviest
                      first — a name goes on the box
                      above

  The engine (data/darkpool.ts) is the one the
  tape's rail already reads; nothing here computes
  a number of its own. The dark-pool feed stays on
  the Live Tape's rail as well.
==================================================
*/

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMarketData } from '../../context/MarketDataContext';
import { lastStockClose, postureOf, quotePlace, useAccumTape, useDarkRegularDay, useNameDark, usd as fmtUsd } from '../../data/traceLive';
import { FLOW_TTL_MS, FeedFallback, StaleMark, TickFigure } from '../../components/ui/liveRead';
import { gradeOfPosture, POSTURE_WORD, type DarkTapeView } from '../../data/darkpool';
import { crossKey, watchedCross } from '../../context/WatchContext';
import CrossDrilldown from '../../components/trace/CrossDrilldown';
import FlowSearch from '../../components/trace/FlowSearch';
import WatchStar from '../../components/trace/WatchStar';
import GradeMeter from '../../components/ui/GradeMeter';
import type { DarkLeaderRow, DarkLeadersView, DarkPoolIntent, DarkPoolLevel, DarkPoolPrint, DarkPoolView, LevelRole, Posture } from '../../types/darkpool';
import type { Column } from '../../components/ui/DataTable';
import CompanyLogo from '../../components/ui/CompanyLogo';
import DropdownSelect, { type DropdownOption } from '../../components/ui/DropdownSelect';
import RichRead from '../../components/ui/RichRead';
import ColumnChooser, { useHiddenColumns } from '../../components/trace/ColumnChooser';
import { earnMarks, weightInk } from '../../components/trace/earnedInk';
import { LiveHold, useHold } from '../../components/trace/LiveHold';
import ReadDoor from '../../components/trace/ReadDoor';
import TraceBox, { Champion, Fact, PhoneRow, TraceGrid } from '../../components/trace/TraceBox';
import { nyClock } from '../../core/nyTime';
import { DarkPoolGuide } from '../../components/trace/TraceGuide';
import { DP_SHELF_H, DP_STRIP_HEAD_H, TracePageSkeleton } from './traceSkeletons';

const num = (v: number) => v.toLocaleString('en-US');
const signedPct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`;
const dirInk = (v: number) => (v > 0 ? 'text-bull' : v < 0 ? 'text-bear' : 'text-textMuted');
/* an after-hours print's place in a thin post-market quote is shown, never inked as a side (the third audit) */
const placeInk = (p: DarkPoolPrint, cents: number) => (p.extended ? 'text-textSecondary' : cents === 0 ? 'text-textMuted' : dirInk(cents));
const execInk = (p: DarkPoolPrint) => (p.extended || !p.exec || p.exec === 'MID' ? 'text-textMuted' : p.exec === 'ASK' ? 'text-bull' : 'text-bear');

/* THE CARDS — the cuts as labelled cards (the walk, 2026-09-09 — never chip rows) */
type ReadCut = 'all' | DarkPoolIntent;
const READ_OPTIONS: DropdownOption<ReadCut>[] = [
  { value: 'all', label: 'Every read', hint: 'Every cross, whatever it is doing' },
  { value: 'ACCUMULATION', label: 'Accumulation', hint: 'Size printed over the mid — paid up for, buyer-initiated', tone: 'bull' },
  { value: 'DISTRIBUTION', label: 'Distribution', hint: 'Size printed under the mid — sold down, seller-initiated', tone: 'bear' },
  { value: 'HEDGE FLOW', label: 'At the mid', hint: 'Size crossed at the mid — neither side pressed' },
  { value: 'ROTATION', label: 'No read', hint: 'Small, priced by its own terms, or after hours — shown, never read' },
];
type SizeCut = 'any' | 'sized';
const SIZE_OPTIONS: DropdownOption<SizeCut>[] = [
  { value: 'any', label: 'Any size', hint: 'Every cross' },
  { value: 'sized', label: 'Sized', hint: 'The top quarter by shares — the prints the reads are built on' },
];
/** Anywhere, on any shelf, between shelves, or at ONE shelf ("at:492.27") */
type WhereCut = 'anywhere' | 'shelf' | 'between' | `at:${string}`;
const WHERE_FIXED: DropdownOption<WhereCut>[] = [
  { value: 'anywhere', label: 'Anywhere', hint: 'Every cross, wherever it printed' },
  { value: 'shelf', label: 'On a shelf', hint: 'Crosses that landed on one of the session’s shelves' },
  { value: 'between', label: 'Between shelves', hint: 'Crosses that printed away from every shelf' },
];
const atShelf = (price: number): WhereCut => `at:${price.toFixed(2)}`;
const onShelf = (p: DarkPoolPrint, price: number) => Math.abs(p.price - price) / price < 0.001;

const ROLE_INK: Record<LevelRole, string> = { SUPPORT: 'text-bull', RESISTANCE: 'text-bear', PIVOT: 'text-textMuted' };
const ROLE_BAR: Record<LevelRole, string> = { SUPPORT: 'bg-bull/70', RESISTANCE: 'bg-bear/70', PIVOT: 'bg-ink/25' };
const ROLE_WORD: Record<LevelRole, string> = { SUPPORT: 'support', RESISTANCE: 'resistance', PIVOT: 'pivot' };
const INTENT_INK: Record<DarkPoolIntent, string> = { ACCUMULATION: 'text-bull', DISTRIBUTION: 'text-bear', 'HEDGE FLOW': 'text-warn', ROTATION: 'text-textMuted' };
const INTENT_BAR: Record<DarkPoolIntent, string> = { ACCUMULATION: 'bg-bull/80', DISTRIBUTION: 'bg-bear/80', 'HEDGE FLOW': 'bg-warn/80', ROTATION: 'bg-ink/25' };
const INTENT_WORD: Record<DarkPoolIntent, string> = { ACCUMULATION: 'accumulation', DISTRIBUTION: 'distribution', 'HEDGE FLOW': 'at the mid', ROTATION: 'no read' };
const INTENT_TAG: Record<DarkPoolIntent, string> = { ACCUMULATION: 'ACCUMULATION', DISTRIBUTION: 'DISTRIBUTION', 'HEDGE FLOW': 'AT THE MID', ROTATION: 'NO READ' };

/** The read as a tag — the word in its ink, the house's uppercase mono */
const IntentTag = ({ intent }: { intent: DarkPoolIntent }) => <span className={`font-mono text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap ${INTENT_INK[intent]}`}>{INTENT_TAG[intent]}</span>;
/** The read cell's word for a print with none */
const noReadWord = (p: DarkPoolPrint) => (p.special ? 'no read · terms' : p.extended ? 'no read · after hrs' : 'no read · small');

/** venue is a code ("L", "D") — at 108 the row ran past a laptop's box and "Says" stood half under its edge */
const WIDTHS: Record<string, number> = { mark: 40, name: 112, time: 92, price: 88, vs: 84, shares: 96, dollars: 96, exec: 64, shelf: 80, read: 116 };
const TOOLTIPS: Record<string, string> = {
  vs: 'Cents through the quote at the print. A percent only when the fill left the spread.',
  exec: 'Where the print sat in the NBBO — at or above the ask, at or below the bid',
  shelf: 'Whether the cross landed on one of the session’s shelves',
  read: 'A sized cross over the mid reads accumulation (bought up), under it distribution (sold down); small, after-hours and own-terms prints carry no read',
  conviction: 'How sure the read is',
  says: 'The read in a sentence',
};
/* The sector and the share flex — the table fills its box (Noah, 2026-09-13: his sat half-width beside empty space) */
const LEADER_WIDTHS: Record<string, number> = { ticker: 140, price: 120, dark: 120, avg: 120, shares: 140 };
const LEADER_TOOLTIPS: Record<string, string> = {
  dark: 'Off-exchange dollars in the dark prints in hand',
  share: 'Against the heaviest name in its sector',
  avg: 'Today’s dark volume against the name’s usual day — over 100% is unusual',
  shares: 'Shares printed off-exchange',
};

type LeaderRow = DarkLeaderRow & { sector: string; sectorMax: number };

/* THE WHOLE MARKET BY DEFAULT, A NAME BY THE SEARCH (2026-10-19; the partner through Noah: the page "should look
   similar to the live tape page … you can only see the dark pool for a specific ticker and not the entire market"):
   the box opens on every name's crosses in one tape, the Live Tape's own grammar; the search cuts it to a name, and
   then the shelves stand and the facts are the name's. The scope chip that followed the frame is gone with it.
   Remembered across route changes within a session. */
let queryMemory = '';

const DarkPool = () => {
  const { marketData } = useMarketData();
  const [query, setQueryState] = useState(queryMemory);
  const setQuery = (q: string) => {
    queryMemory = q;
    setQueryState(q);
  };
  const [tapeKind, setTapeKind] = useState<'dark' | 'lit'>('dark');
  /* AFTER THE CLOSE, THE DAY'S SESSION FIRST (the third audit, 2026-10-22: after the bell every cross read "NO READ ·
     AFTER HRS"): once the stock session has ended the page opens on the day's regular-session crosses, and the
     after-hours prints are a separate, labelled view. In the session there is one live tape. */
  const [closed, setClosed] = useState(() => lastStockClose());
  useEffect(() => {
    const id = window.setInterval(() => setClosed(c => {
      const n = lastStockClose();
      return n?.closeMs === c?.closeMs ? c : n;
    }), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const [dpSession, setDpSession] = useState<'regular' | 'after'>('regular');
  const regularView = !!closed && dpSession === 'regular';
  const darkLive = useAccumTape('dark', 200);
  const darkReg = useDarkRegularDay(regularView ? closed!.iso : null);
  const dark = regularView ? darkReg : darkLive;
  const lit = useAccumTape('lit', 200);
  const q = query.trim().toUpperCase();
  const named = /^[A-Z][A-Z0-9.]{0,5}$/.test(q) ? q : null;
  const nameBook = useNameDark(named, regularView ? closed!.closeMs : null);
  const [read, setRead] = useState<ReadCut>('all');
  const [size, setSize] = useState<SizeCut>('any');
  const [where, setWhere] = useState<WhereCut>('anywhere');
  const [selected, setSelected] = useState<string | null>(null);
  const sector = 'all' as string;
  const [guideOpen, setGuideOpen] = useState(false);

  const liveView = named && tapeKind !== 'lit' ? nameBook.rows.view : null;
  const nameDay = named ? nameBook.rows.day : null;
  const liveTape = useMemo<(DarkTapeView & { lit: boolean; note: string; read: number }) | null>(() => {
    const prints = named ? (tapeKind === 'lit' ? nameBook.rows.lit : []) : tapeKind === 'lit' ? lit.rows : dark.rows;
    if (named && tapeKind !== 'lit') return null;
    const views = new Map<string, DarkPoolView>();
    for (const p of prints) {
      const had = views.get(p.ticker);
      if (had) {
        had.prints.push(p);
        had.totalNotional += p.notional;
        if (!had.largest || p.notional > had.largest.notional) had.largest = p;
      } else {
        views.set(p.ticker, {
          ticker: p.ticker,
          spot: p.price,
          dpSharePct: 0,
          netPosturePct: 0,
          posture: 'BALANCED',
          postureNote: '',
          totalNotional: p.notional,
          levels: [],
          prints: [p],
          largest: p,
        });
      }
    }
    const total = prints.reduce((a, p) => a + p.notional, 0);
    /* the posture reads the SIZED, regular-session prints at the quote, by their dollars — one rule with a name's
       (traceLive postureOf): over the mid is bought up, under it sold down */
    const pos = postureOf(prints);
    const net = pos.net;
    const posture: Posture = pos.posture;
    const largest = prints.reduce<DarkPoolPrint | null>((a, p) => (!a || p.notional > a.notional ? p : a), null);
    return {
      prints,
      views,
      names: [...views.keys()],
      dpSharePct: 0,
      netPosturePct: net,
      posture,
      totalNotional: total,
      crosses: prints.length,
      strongest: null,
      largest,
      lit: tapeKind === 'lit',
      note: pos.note,
      read: pos.read,
    };
  }, [dark.rows, lit.rows, nameBook.rows.lit, tapeKind, named]);
  const hold = useHold(useMemo(() => ({ view: liveView, tape: liveTape, tick: marketData }), [liveView, liveTape, marketData]), named ?? 'market');
  const { view, tape } = hold.value;
  const name: string | null = named;
  /* THE HEAD'S OWNER — the name, or the market */
  const headNow = useMemo(
    () =>
      view
        ? { ticker: view.ticker, dpSharePct: view.dpSharePct, posture: view.posture, netPosturePct: view.netPosturePct, postureNote: view.postureNote, totalNotional: view.totalNotional, read: postureOf(view.prints).read }
        : tape
          ? {
              ticker: 'The market',
              dpSharePct: tape.dpSharePct,
              posture: tape.posture,
              netPosturePct: tape.netPosturePct,
              postureNote: `${tape.lit ? 'On the lit tape' : tape.read === 0 ? 'Nothing to read' : POSTURE_WORD[tape.posture]} across ${tape.names.length} names — ${fmtUsd(tape.totalNotional)} ${tape.lit ? 'printed on the exchanges' : 'crossed off-exchange'} in ${regularView && !tape.lit ? `the day's ${num(tape.crosses)} largest regular-session crosses` : `the last ${num(tape.crosses)} prints`}. ${tape.note}`,
              read: tape.read,
              totalNotional: tape.totalNotional,
            }
          : null,
    [view, tape]
  );
  /* THE FIELD KEEPS ITS CARET (the ship pass, 2026-10-22): a typed letter that is a ticker ("S") made the page wait on
     that name's book with no head, the whole page fell back to its skeleton, and the search field it was typed into
     unmounted — "SPY" stopped at "S". The last head stands until the new name's lands. */
  const lastHeadRef = useRef<typeof headNow>(null);
  if (headNow) lastHeadRef.current = headNow;
  const head = headNow ?? lastHeadRef.current;
  /* THE WINDOW IS NAMED (the audit, 2026-10-22: "$177.6M crossed off-exchange today on 400 prints" was a 25-second
     buffer) — every figure on the market's tape covers the prints in hand, first to last */
  const tapeWindow = useMemo(() => {
    const ps = view ? view.prints : tape ? tape.prints : [];
    const ts = ps.map(p => p.time).filter(t => t && t !== '—').sort();
    return ts.length ? `${ts[0]}–${ts[ts.length - 1]} ET` : null;
  }, [view, tape]);
  /* THE CROSS'S CARD (the Live Tape's print card, for a cross) */
  const [openCross, setOpenCross] = useState<DarkPoolPrint | null>(null);
  const openView = useMemo(() => {
    if (!openCross) return null;
    if (view && view.ticker === openCross.ticker) return view;
    return tape?.views.get(openCross.ticker) ?? null;
  }, [openCross, view, tape]);
  const shownCross = useMemo(() => (openCross ? openView?.prints.find(p => p.id === openCross.id) ?? openCross : null), [openCross, openView]);
  const leaderWindow = useMemo(() => {
    const ts = dark.rows.map(p => p.time).filter(t => t && t !== '—').sort();
    return ts.length ? `${ts[0]}–${ts[ts.length - 1]} ET` : null;
  }, [dark.rows]);
  const leaders = useMemo<DarkLeadersView>(() => {
    const byName = new Map<string, DarkLeaderRow>();
    for (const p of dark.rows) {
      const had = byName.get(p.ticker);
      if (had) {
        had.notional += p.notional;
        had.size += p.size;
        had.price = p.price;
      } else byName.set(p.ticker, { ticker: p.ticker, price: p.price, dirUp: p.vsSpotPct >= 0, notional: p.notional, pctAvgVol: 0, size: p.size });
    }
    const rows = [...byName.values()].sort((a, b) => b.notional - a.notional);
    const totalNotional = rows.reduce((a, r) => a + r.notional, 0);
    return {
      totalNotional,
      totalPrints: dark.rows.length,
      /* New York's clock, like every clock on Trace — the machine's own zone read "21:05" */
      updated: dark.at ? `${nyClock(dark.at)} ET` : '—',
      /* ONE GROUP, NOT A SECTOR (the re-audit, 2026-10-22: "Sectors 1 · The tape 100%" with an empty dropdown): the
         recent feed carries no sector, so the names stand as one list and no sector is claimed */
      sectors: rows.length
        ? [{ sector: 'Every name', color: 'rgb(var(--text-secondary))', notional: totalNotional, sharePct: 100, prints: dark.rows.length, rows }]
        : [],
    };
  }, [dark.rows, dark.at]);

  /* A shelf picked on one name means nothing on the next */
  useEffect(() => {
    setWhere('anywhere');
    setSelected(null);
  }, [name]);

  const levels = view?.levels ?? [];
  const pickedShelf = where.startsWith('at:') ? Number(where.slice(3)) : null;
  const whereOptions = useMemo<DropdownOption<WhereCut>[]>(
    () => [...WHERE_FIXED, ...levels.map(l => ({ value: atShelf(l.price), label: `$${l.price.toFixed(2)}`, hint: `${ROLE_WORD[l.role]} · ${fmtUsd(l.notional)} rested here` }))],
    [levels]
  );

  /* THE CUT — the three cards, on the crosses: the name's, or the market's (a prefix typed narrows the names) */
  const cut = useMemo(() => {
    const rows = view ? view.prints : tape ? tape.prints : [];
    return rows.filter(
      p =>
        (view || !q || p.ticker.startsWith(q)) &&
        (read === 'all' || p.intent === read) &&
        (size === 'any' || p.sized) &&
        (where === 'anywhere' || (where === 'shelf' ? p.atLevel : where === 'between' ? !p.atLevel : pickedShelf != null && onShelf(p, pickedShelf)))
    );
  }, [view, tape, q, read, size, where, pickedShelf]);

  const keyOf = useCallback((p: DarkPoolPrint) => `${p.ticker}-${p.id}`, []);
  /* the search's suggestions: the names on the tape, the heaviest dark dollars first */
  const searchRows = useMemo(() => {
    const src = tape ? [...tape.views.values()] : view ? [view] : [];
    return src.map(v => ({ ticker: v.ticker, strike: 0, right: 'C' as const, premium: v.totalNotional }));
  }, [tape, view]);
  const marks = useMemo(() => ({ size: earnMarks(cut, p => p.size), notional: earnMarks(cut, p => p.notional) }), [cut]);

  const facts = useMemo(() => {
    /* THE LABEL AND THE MATHS AGREE (the re-audit, 2026-10-22: "Sized: under · over the mid" counted only prints 0.15% or
       more from the mid — $10.5M under and $31.0M over were really in hand): every sized print at the quote, any distance,
       by where it printed — after-hours ones included and counted, since this is where they printed, not a read */
    const place = (p: DarkPoolPrint) => quotePlace(p.vsSpotPct, p.price).cents;
    const sizedAll = cut.filter(p => p.sized);
    const building = sizedAll.reduce((a, p) => a + (place(p) > 0 ? p.notional : 0), 0);
    const leaving = sizedAll.reduce((a, p) => a + (place(p) < 0 ? p.notional : 0), 0);
    const atMid = sizedAll.reduce((a, p) => a + (place(p) === 0 ? p.notional : 0), 0);
    const afterHours = sizedAll.filter(p => p.extended).length;
    const sizedCount = sizedAll.length;
    const dollars = cut.reduce((a, p) => a + p.notional, 0);
    const strongest = levels.reduce<DarkPoolLevel | null>((a, l) => (a === null || l.notional > a.notional ? l : a), null);
    const largest = cut.reduce<DarkPoolPrint | null>((a, p) => (a === null || p.notional > a.notional ? p : a), null);
    const support = levels.filter(l => l.role === 'SUPPORT').length;
    const resistance = levels.filter(l => l.role === 'RESISTANCE').length;
    return { building, leaving, atMid, afterHours, sizedCount, dollars, strongest, largest, support, resistance, pivots: levels.length - support - resistance };
  }, [cut, levels]);
  const shelfMax = useMemo(() => Math.max(1, ...levels.map(l => l.notional)), [levels]);

  /* ---- the crosses' columns ---------------------------------------------------- */
  const spotOf = useCallback((p: DarkPoolPrint) => (view && view.ticker === p.ticker ? view.spot : tape?.views.get(p.ticker)?.spot ?? p.price), [view, tape]);
  const columns = useMemo<Column<DarkPoolPrint>[]>(
    () => [
      /* THE MARK leads the row, the tape's own star: a click keeps the cross on the Tracker and never opens the card */
      {
        key: 'mark',
        header: '',
        sortValue: () => 0,
        render: p => <WatchStar k={crossKey(p)} make={() => watchedCross(p, spotOf(p), 'dark-pool')} noun="print" />,
      },
      ...(view
        ? []
        : [
            {
              key: 'name',
              header: 'Name',
              sortValue: (p: DarkPoolPrint) => p.ticker,
              render: (p: DarkPoolPrint) => (
                <span className="inline-flex items-center gap-1.5">
                  <CompanyLogo ticker={p.ticker} size={15} />
                  <span className="font-bold text-textPrimary">{p.ticker}</span>
                </span>
              ),
            } as Column<DarkPoolPrint>,
          ]),
      { key: 'time', header: 'Time', sortValue: p => p.time, render: p => <span className="text-textSecondary tnum">{p.time}</span> },
      { key: 'price', header: 'Price', align: 'right', sortValue: p => p.price, render: p => <span className="font-mono tnum font-bold text-textPrimary">${p.price.toFixed(2)}</span> },
      { key: 'vs', header: 'vs mid', align: 'right', sortValue: p => p.vsSpotPct, render: p => { const place = quotePlace(p.vsSpotPct, p.price); return <span className={`font-mono tnum ${placeInk(p, place.cents)}`}>{place.text}</span>; } },
      { key: 'shares', header: 'Shares', align: 'right', sortValue: p => p.size, render: p => <span className={`font-mono tnum ${weightInk(p.size, marks.size)}`}>{num(p.size)}</span> },
      { key: 'dollars', header: 'Dollars', align: 'right', sortValue: p => p.notional, render: p => <span className={`font-mono tnum ${weightInk(p.notional, marks.notional)}`}>{fmtUsd(p.notional)}</span> },
      { key: 'exec', header: 'Print', sortValue: p => p.exec ?? '', render: p => <span className={`font-mono text-[10px] ${execInk(p)}`} title={p.extended ? 'After hours — where it sat in a thin post-market quote, not a side' : undefined}>{p.exec ?? '—'}{p.extended ? <span className="text-textMuted"> · AH</span> : null}</span> },
      /* a shelf is a name's (its day by price) — the market's tape has none, so the column stands only on a name */
      ...(view
        ? [
            {
              key: 'shelf',
              header: 'Shelf',
              sortValue: (p: DarkPoolPrint) => (p.atLevel ? 1 : 0),
              render: (p: DarkPoolPrint) => (view.levels.length === 0 ? <span className="text-textMuted">—</span> : p.atLevel ? <span className="font-semibold text-textPrimary">On a shelf</span> : <span className="text-textMuted">Between</span>),
            } as Column<DarkPoolPrint>,
          ]
        : []),
      /* a read only where there is one: a sized print at the quote; a small print or one priced by its own terms says so */
      {
        key: 'read',
        header: 'Read',
        sortValue: p => (p.sized ? p.intent : p.special ? 'zz' : 'zzz'),
        render: p => (p.sized && !p.extended && !p.special ? <IntentTag intent={p.intent} /> : <span className="font-mono text-[10px] uppercase tracking-wider text-textMuted" title={p.read}>{noReadWord(p)}</span>),
      },
      {
        key: 'says',
        header: 'What it says',
        /* two lines, never cut mid-sentence (the retail pass: "Size printe…" at 1440) */
        render: p => (
          <span className="block text-[11px] leading-tight text-textSecondary whitespace-normal line-clamp-2" title={p.read}>
            {p.read}
          </span>
        ),
      },
    ],
    [marks, view, tape, spotOf]
  );
  const { hidden, toggle, showAll, hideAll } = useHiddenColumns('slayer_darkpool_cols');
  /* A CROSS ON A PHONE, TWO LINES (the retail pass, 2026-10-22: at 390 the grid showed only Name, Time and Price, the
     Read off the screen): the name, the price and the time; then the dollars, the shares, where it printed and its read */
  const crossPhoneRow = useCallback(
    (p: DarkPoolPrint) => {
      const place = quotePlace(p.vsSpotPct, p.price);
      return (
        <PhoneRow
          lead={<WatchStar k={crossKey(p)} make={() => watchedCross(p, spotOf(p), 'dark-pool')} noun="print" />}
          title={
            <>
              {!view && <span className="font-bold">{p.ticker}</span>}
              <span className="font-bold tnum">${p.price.toFixed(2)}</span>
            </>
          }
          aside={p.time}
          figures={[
            <span key="d" className="font-semibold text-textPrimary">
              {fmtUsd(p.notional)}
            </span>,
            <span key="s">{num(p.size)} sh</span>,
            <span key="v" className={placeInk(p, place.cents)}>
              {place.text}
            </span>,
            p.sized && !p.extended && !p.special ? <IntentTag key="r" intent={p.intent} /> : <span key="r" className="text-textMuted uppercase text-[10px]">{noReadWord(p)}</span>,
          ]}
        />
      );
    },
    [view, spotOf]
  );
  /* THE CARD'S STEPS walk the cut as the grid shows it */
  const openIdx = openCross ? cut.findIndex(p => p.ticker === openCross.ticker && p.id === openCross.id) : -1;
  const stepCross = useCallback(
    (dir: -1 | 1) => {
      const next = openIdx + dir;
      if (next >= 0 && next < cut.length) setOpenCross(cut[next]);
    },
    [openIdx, cut]
  );
  const chooserCols = useMemo(() => columns.map(c => ({ key: c.key, label: typeof c.header === 'string' ? c.header : c.key })), [columns]);

  /* ---- the market's leaders -------------------------------------------------------- */
  const leaderRows = useMemo<LeaderRow[]>(() => {
    const out: LeaderRow[] = [];
    for (const s of leaders.sectors) {
      if (sector !== 'all' && s.sector !== sector) continue;
      const max = Math.max(1, ...s.rows.map(r => r.notional));
      for (const r of s.rows) out.push({ ...r, sector: s.sector, sectorMax: max });
    }
    return out.sort((x, y) => y.notional - x.notional);
  }, [leaders, sector]);
  const leaderMarks = useMemo(() => ({ dark: earnMarks(leaderRows, r => r.notional), shares: earnMarks(leaderRows, r => r.size) }), [leaderRows]);
  const heaviest = leaderRows[0] ?? null;
  const topSector = leaders.sectors[0];
  const shownSector = sector === 'all' ? topSector : leaders.sectors.find(s => s.sector === sector) ?? topSector;
  const leaderKey = useCallback((r: LeaderRow) => r.ticker, []);
  /* A name goes on the box above — the search takes it */
  const putAbove = useCallback((t: string) => {
    setQuery(t);
    document.querySelector('[data-trace-box="dark-pool"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  const leaderColumns = useMemo<Column<LeaderRow>[]>(
    () => [
      {
        key: 'ticker',
        header: 'Ticker',
        sortValue: r => r.ticker,
        render: r => (
          <span className="inline-flex items-center gap-1.5">
            <CompanyLogo ticker={r.ticker} size={15} />
            <span className="font-bold text-textPrimary">{r.ticker}</span>
          </span>
        ),
      },
      {
        key: 'price',
        header: 'Price',
        align: 'right',
        sortValue: r => r.price,
        render: r => (
          <span className="text-textPrimary whitespace-nowrap" title="The name's last dark print">
            ${r.price.toFixed(2)}
          </span>
        ),
      },
      { key: 'dark', header: 'Dark $', align: 'right', sortValue: r => r.notional, render: r => <span className={weightInk(r.notional, leaderMarks.dark)}>{fmtUsd(r.notional)}</span> },
      {
        key: 'share',
        header: 'Vs the heaviest name',
        align: 'right',
        sortValue: r => r.notional / r.sectorMax,
        render: r => {
          const pct = Math.round((r.notional / r.sectorMax) * 100);
          return (
            <span className="flex items-center gap-2 w-full max-w-[280px] ml-auto">
              <span className="flex flex-1 h-[3px] rounded-full overflow-hidden bg-ink/[0.06]">
                <span className="h-full rounded-full bg-silver/70" style={{ width: `${pct}%` }} />
              </span>
              <span className="font-mono text-[10px] tnum text-textSecondary w-9 text-right shrink-0">{pct}%</span>
            </span>
          );
        },
      },
      { key: 'shares', header: 'Shares', align: 'right', sortValue: r => r.size, render: r => <span className={weightInk(r.size, leaderMarks.shares)}>{num(r.size)}</span> },
    ],
    [leaderMarks]
  );
  const leaderChooser = useHiddenColumns('slayer_darkpool_leader_cols');
  const leaderChooserCols = useMemo(() => leaderColumns.map(c => ({ key: c.key, label: typeof c.header === 'string' ? c.header : c.key })), [leaderColumns]);

  if (!head) return <TracePageSkeleton pathname="/trace/dark-pool" />;
  /* THE LIT LANE SPEAKS FOR ITSELF (the re-audit, 2026-10-22: it kept the dark pool's words) */
  const litLane = tapeKind === 'lit';

  /* ---- the sentences ------------------------------------------------------------ */
  const largest = facts.largest;
  const sentence: ReactNode = (
    <>
      <RichRead text={`${head.postureNote} `} />
      {largest ? (
        <>
          <RichRead text={litLane ? 'Largest lit print ' : 'Largest cross '} />
          <ReadDoor onOpen={() => setOpenCross(largest)} title="Open the cross's card">
            {view ? '' : `${largest.ticker} `}{num(largest.size)} at ${largest.price.toFixed(2)}
          </ReadDoor>
          <RichRead text={` for ${fmtUsd(largest.notional)}${largest.special ? ` — ${/^[aeiou]/i.test(largest.special) ? 'an' : 'a'} ${largest.special}, no read` : largest.extended ? ' — after hours, no read' : largest.sized ? ` — read as ${INTENT_WORD[largest.intent]}` : ' — too small to read'}.`} />
        </>
      ) : (
        <RichRead text={litLane ? 'No lit print on this cut.' : 'No cross on this cut.'} />
      )}
    </>
  );
  const lead = shownSector?.rows.slice(0, 3) ?? [];
  const leadersSentence: ReactNode = shownSector ? (
    <>
      <RichRead text={`${fmtUsd(shownSector.notional)} printed off-exchange across ${num(shownSector.prints)} crosses — `} />
      {lead.map((r, i) => (
        <span key={r.ticker}>
          <ReadDoor onOpen={() => putAbove(r.ticker)} title={`Put ${r.ticker} on the box above`}>
            {r.ticker}
          </ReadDoor>
          {i < lead.length - 2 ? ', ' : i === lead.length - 2 ? ' and ' : ''}
        </span>
      ))}
      <RichRead text={` lead it${leaderWindow ? `, ${leaderWindow}` : ''}. The vendor's recent feed carries crosses of about $100K and up, so the smaller ones are not in it.`} />
    </>
  ) : (
    <RichRead text="The dark tape has not printed yet." />
  );

  const shelfWords = `${facts.support} support · ${facts.resistance} resistance · ${facts.pivots} pivot${facts.pivots === 1 ? '' : 's'}`;

  return (
    <>
      {/* BOX 1 — THE DARK POOL: the market's tape, or one name's */}
      <TraceBox
        title={litLane ? 'The lit tape' : 'The dark pool'}
        sub={
          view
            ? `${view.ticker}'s off-exchange crosses with the read attached — who is most likely behind each print, and the liquidity shelves they left · a shelf cuts the grid to it`
            : tapeKind === 'lit'
              ? "Every name's latest lit prints — trades on the exchanges, not off them — on one tape, newest first, each set against the quote · a row opens its card · a name typed cuts the tape to it"
              : regularView
                ? `The day's largest off-exchange crosses of the regular session (${closed!.iso}, 09:30–16:00 ET) — the vendor's crosses by dollars, after-hours ones on the After hours card — with the read attached · a row opens the cross's card · a name typed cuts the tape to it`
                : `The market's latest off-exchange crosses — the vendor's recent feed, about $100K and up — on one tape, newest first${closed ? ', after hours: shown, never read' : ''} · a row opens the cross's card · a name typed cuts the tape to it`
        }
        testId="dark-pool"
        data={{ ticker: view ? view.ticker : 'market', read, size, where, crosses: cut.length }}
        guide={{ title: 'How to read the dark pool', door: 'What the shelves, the reads and the conviction mean', body: <DarkPoolGuide />, testId: 'dark-pool-guide', open: guideOpen, onOpen: setGuideOpen }}
        facts={
          <>
            {/* the market's tape carries no share of volume (only a name's book does) — no "0% of volume" beside $49M crossed */}
            {view && nameDay ? (
              <Fact label={`${view.ticker} off-exchange today`} testId="share" title="The whole day's dark shares by price (/darkpool/{t}/price-levels) over the day's whole volume (the quote); the dollars are each $1 bucket's shares at its price">
                {Number.isFinite(nameDay.sharePct) ? `${nameDay.sharePct.toFixed(0)}% ` : ''}<span className="text-textMuted">{Number.isFinite(nameDay.sharePct) ? 'of shares · ' : ''}≈{fmtUsd(nameDay.darkDollars)} · {nameDay.darkShares.toLocaleString('en-US')} sh</span>
              </Fact>
            ) : (
              <Fact label="Window" testId="window" title="Every figure in this head covers the prints in hand, first to last — not the whole day">
                {tapeWindow ?? '—'} <span className="text-textMuted">· last {num(cut.length)} prints</span>
              </Fact>
            )}
            <Fact label="Posture" testId="posture">
              {/* which side leads, then how far it leans in the four words — never the figure (data/darkpool.ts gradeOfPosture).
                  Balanced stands alone: a poor lean is no lean. The steps wear the side's ink. NOTHING READ is not
                  balanced (the third audit) — it says so. */}
              {head.read === 0 ? (
                <span className="text-textMuted" data-posture-read="none" title="No sized regular-session cross at the quote in this view — nothing to read">Nothing to read</span>
              ) : (
              <span
                className={`inline-flex items-center gap-2 ${head.posture === 'ACCUMULATING' ? 'text-bull' : head.posture === 'DISTRIBUTING' ? 'text-bear' : 'text-textSecondary'}`}
                data-posture-read={gradeOfPosture(head.netPosturePct)}
              >
                {POSTURE_WORD[head.posture]}
                <GradeMeter grade={gradeOfPosture(head.netPosturePct)} fill={head.posture === 'ACCUMULATING' ? 'bg-bull' : head.posture === 'DISTRIBUTING' ? 'bg-bear/80' : 'bg-ink/30'} className="w-12" />
                {head.posture !== 'BALANCED' && <span>{gradeOfPosture(head.netPosturePct)}</span>}
              </span>
              )}
            </Fact>
            <Fact label="On this cut" testId="cut">
              {fmtUsd(facts.dollars)} <span className="text-textMuted">· {cut.length} {litLane ? 'prints' : 'crosses'}</span>
            </Fact>
            <Fact label="Sized: over · under the mid" testId="sides" title={`Every sized print on this cut (10,000 shares or $500K, priced at the quote) by where it printed, any distance from the mid: over it (paid up — buyer-initiated) and under it (sold down — seller-initiated)${facts.atMid > 0 ? `; ${fmtUsd(facts.atMid)} crossed at the mid` : ''}${facts.afterHours ? `; ${facts.afterHours} of them after hours, against a post-market quote, so they are counted here but never read` : ''}`}>
              {facts.sizedCount === 0 ? (
                <span className="text-textMuted">no sized print</span>
              ) : (
                <>
                  <span className={facts.afterHours === facts.sizedCount ? 'text-textPrimary' : 'text-bull'}>{fmtUsd(facts.building)}</span> <span className="text-textMuted">·</span> <span className={facts.afterHours === facts.sizedCount ? 'text-textPrimary' : 'text-bear'}>{fmtUsd(facts.leaving)}</span>
                  {facts.afterHours > 0 && <span className="text-textMuted"> · {facts.afterHours === facts.sizedCount ? 'all' : facts.afterHours} after hours</span>}
                </>
              )}
            </Fact>
            {facts.strongest && (
              <Champion label="Strongest shelf" ink={facts.strongest.role === 'SUPPORT' ? 'bull' : facts.strongest.role === 'RESISTANCE' ? 'bear' : 'warn'} onOpen={() => setWhere(atShelf(facts.strongest!.price))} testId="strongest">
                ${facts.strongest.price.toFixed(2)} · {fmtUsd(facts.strongest.notional)}
              </Champion>
            )}
            {!view && tape?.strongest && (
              <Champion label="Strongest shelf" ink={tape.strongest.role === 'SUPPORT' ? 'bull' : tape.strongest.role === 'RESISTANCE' ? 'bear' : 'warn'} onOpen={() => putAbove(tape.strongest!.ticker)} testId="strongest">
                {tape.strongest.ticker} ${tape.strongest.price.toFixed(2)} · {fmtUsd(tape.strongest.notional)}
              </Champion>
            )}
            {largest && (
              <Champion label={litLane ? 'Largest lit print' : 'Largest cross'} ink="supreme" onOpen={() => setOpenCross(largest)} testId="largest">
                {view ? '' : `${largest.ticker} · `}{num(largest.size)} @ ${largest.price.toFixed(2)} · {fmtUsd(largest.notional)}
              </Champion>
            )}
          </>
        }
        controls={
          <>
            <LiveHold paused={hold.paused} onToggle={hold.toggle} heldAt={hold.heldAt} />
            {/* the closed session's crosses are read once and do not go stale */}
            {!(regularView && !named && tapeKind !== 'lit') && <StaleMark at={named ? nameBook.at : tapeKind === 'lit' ? lit.at : dark.at} ttlMs={FLOW_TTL_MS} fault={named ? nameBook.fault : tapeKind === 'lit' ? lit.fault : dark.fault} />}
            {/* THE SEARCH, the Live Tape's own: a name typed cuts the tape to it; a prefix narrows it */}
            <FlowSearch value={query} onChange={setQuery} rows={searchRows} tickersOnly countNoun="names" span />
            <DropdownSelect label="Read" value={read} options={READ_OPTIONS} onChange={setRead} title="What the cross is doing" testId="dark-pool-read" />
            <DropdownSelect label="Size" value={size} options={SIZE_OPTIONS} onChange={setSize} title="Every cross, or the sized ones" testId="dark-pool-size" />
            <DropdownSelect label="Where" value={where} options={whereOptions} onChange={setWhere} title="Where the cross printed" testId="dark-pool-where" />
            {closed && (
              <span className="inline-flex rounded-md border border-borderSubtle overflow-hidden" data-dark-session title={`The stock session of ${closed.iso} has closed: the day's regular-session crosses, or what has printed after hours since`}>
                {(['regular', 'after'] as const).map(k => (
                  <button key={k} type="button" onClick={() => setDpSession(k)} aria-pressed={dpSession === k} className={`px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${dpSession === k ? 'bg-chip text-textPrimary' : 'text-textSecondary hover:text-textPrimary'}`}>
                    {k === 'regular' ? 'Regular session' : 'After hours'}
                  </button>
                ))}
              </span>
            )}
            <span className="inline-flex rounded-md border border-borderSubtle overflow-hidden" data-dark-kind>
              {(['dark', 'lit'] as const).map(k => (
                <button key={k} type="button" onClick={() => setTapeKind(k)} aria-pressed={tapeKind === k} className={`px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${tapeKind === k ? 'bg-chip text-textPrimary' : 'text-textSecondary hover:text-textPrimary'}`}>
                  {k === 'dark' ? 'Dark' : 'Lit'}
                </button>
              ))}
            </span>
            <div className="ml-auto">
              <ColumnChooser columns={chooserCols} hidden={hidden} onToggle={toggle} onAll={showAll} onNone={() => hideAll(columns.map(c => c.key))} />
            </div>
          </>
        }
        sentence={sentence}
      >
        {/* THE SHELVES — one strip of six cells across the box, lowest price at the left the
            way a price axis reads, so nothing stands beside the grid empty (Noah, 2026-09-13:
            "completely empty sections that take up large spaces of the page"); a cell picked
            cuts the grid to its shelf */}
        {/* A NAME'S, so the strip stands when the tape is cut to one (and on every cross's card); the market's tape
            has no shelf of its own (2026-10-19) */}
        {levels.length > 0 && (
        <div className="border-t border-borderSubtle" data-dark-pool-shelves>
          <div className="px-5 flex items-center gap-2 border-b border-borderSubtle/60 font-mono text-[9px] uppercase tracking-widest" style={{ height: DP_STRIP_HEAD_H }}>
            <span className="text-textPrimary">The shelves</span>
            <span className="text-textMuted normal-case tracking-normal font-sans text-[10px]">· where the day's dark shares rested, by the vendor's price levels — a shelf holds 3% or more of the day's dark dollars within 5% of the market · {shelfWords} · lowest at the left</span>
          </div>
          {/* Two across on a phone, three rows (the phone pass, 2026-09-13): six cells in 350px ran their figures into each other, and three still did */}
          {/* six shelves across from 1024, three from 640 (the device sweep, 2026-10-18: six at 768 left each shelf 110px and
              cut its dollars and its print count) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-borderSubtle/60 max-sm:divide-y">
            {[...levels]
              .sort((x, y) => x.price - y.price)
              .map(l => {
                const picked = pickedShelf != null && Math.abs(pickedShelf - l.price) < 0.005;
                return (
                  <button
                    key={l.price}
                    type="button"
                    onClick={() => setWhere(picked ? 'anywhere' : atShelf(l.price))}
                    title={l.usage}
                    className={`min-w-0 flex flex-col justify-center gap-1 px-4 text-left transition-colors ${picked ? 'bg-silver/[0.06] shadow-[inset_0_2px_0_0_rgba(199,211,232,0.7)]' : 'hover:bg-silver/[0.04]'}`}
                    style={{ height: DP_SHELF_H }}
                    data-dark-pool-shelf={l.price}
                    data-role={l.role}
                    data-picked={picked || undefined}
                  >
                    <span className="flex items-center gap-2">
                      <span className={`font-mono text-[9px] font-semibold uppercase tracking-wider ${ROLE_INK[l.role]}`}>{l.role}</span>
                      <span className={`ml-auto min-w-0 truncate font-mono text-[11px] tnum ${l.notional >= shelfMax ? 'font-bold text-textPrimary' : 'text-textSecondary'}`}>{fmtUsd(l.notional)}</span>
                    </span>
                    <span className="flex items-baseline gap-2">
                      <span className="font-mono text-[13px] font-bold tnum text-textPrimary">${l.price.toFixed(2)}</span>
                      <span className={`font-mono text-[10px] tnum ${dirInk(l.distPct)}`}>{signedPct(l.distPct)}</span>
                      <span className="ml-auto min-w-0 truncate font-mono text-[9px] text-textMuted tnum whitespace-nowrap" title="The name's dark prints in hand that landed on this price — the day's shares by price carry no count">{l.prints} in hand</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="relative h-0.5 flex-1 rounded-full bg-ink/[0.06] overflow-hidden">
                        <span className={`absolute left-0 top-0 h-full ${ROLE_BAR[l.role]}`} style={{ width: `${Math.round((l.notional / shelfMax) * 100)}%` }} />
                      </span>
                      <span className="font-mono text-[9px] text-textMuted tnum w-7 text-right">{l.sharePct.toFixed(0)}%</span>
                    </span>
                  </button>
                );
              })}
          </div>
        </div>
        )}
        {/* THE CROSSES — the grid grows with its rows, the page scrolls; a row opens the cross's card */}
        <TraceGrid rows={cut} columns={columns} hidden={hidden} widths={WIDTHS} flexes={{ says: 2 }} tooltips={TOOLTIPS} rowKey={keyOf} onRowClick={p => setOpenCross(p)} selectedKey={selected} initialSort={{ key: 'time', dir: 'desc' }} phoneRow={crossPhoneRow} autoHeight emptyText={litLane ? 'No lit prints on this cut' : 'No crosses on this cut'} testId="dark-pool" />
        {(named ? nameBook.fault : tapeKind === 'lit' ? lit.fault : dark.fault) && cut.length === 0 ? <FeedFallback fault={named ? nameBook.fault : tapeKind === 'lit' ? lit.fault : dark.fault} /> : null}
      </TraceBox>

      {/* BOX 2 — WHERE THE DARK MONEY WENT: the market's dark tape by sector and by name */}
      <TraceBox
        title="Where the dark money went"
        sub={regularView ? `Off-exchange dollars in the day's largest regular-session crosses (${closed!.iso}), by name, the heaviest first · a name goes on the box above` : "Off-exchange dollars in the market's latest dark prints (about $100K and up), by name, the heaviest first · a name goes on the box above"}
        testId="dark-leaders"
        data={{ sector, names: leaderRows.length }}
        facts={
          <>
            <Fact label="Dark tape in hand" testId="tape" title={regularView ? "The day's largest regular-session crosses by dollars — the vendor's top crosses, not every one" : "The market's latest dark prints, collected while this page is open — not the whole day"}>
              {fmtUsd(leaders.totalNotional)} <span className="text-textMuted">· {num(leaders.totalPrints)} crosses{leaderWindow ? ` · ${leaderWindow}` : ''}</span>
            </Fact>
            <Fact label="Names" testId="names" title="The names in the market's latest dark prints — the vendor's recent feed carries no sector">
              {num(leaderRows.length)}
            </Fact>
            {heaviest && (
              <Champion label="Heaviest name" ink="supreme" onOpen={() => putAbove(heaviest.ticker)} testId="heaviest">
                {heaviest.ticker} · {fmtUsd(heaviest.notional)}
              </Champion>
            )}
          </>
        }
        controls={
          <>
            <span className="font-mono text-[9px] uppercase tracking-widest text-textMuted whitespace-nowrap" data-dark-leaders-updated>
              updated {leaders.updated}
            </span>
            <div className="ml-auto">
              <ColumnChooser columns={leaderChooserCols} hidden={leaderChooser.hidden} onToggle={leaderChooser.toggle} onAll={leaderChooser.showAll} onNone={() => leaderChooser.hideAll(leaderColumns.map(c => c.key))} />
            </div>
          </>
        }
        sentence={leadersSentence}
      >
        <TraceGrid rows={leaderRows} columns={leaderColumns} hidden={leaderChooser.hidden} widths={LEADER_WIDTHS} tooltips={LEADER_TOOLTIPS} rowKey={leaderKey} onRowClick={r => putAbove(r.ticker)} selectedKey={name} initialSort={{ key: 'dark', dir: 'desc' }} autoHeight emptyText="No dark prints in hand yet" testId="dark-leaders" />
      </TraceBox>

      {/* THE CROSS'S CARD — the Live Tape's print card, for a cross: the figures, the read, the sequence, the tape */}
      <CrossDrilldown print={shownCross} view={openView} onClose={() => setOpenCross(null)} onStep={stepCross} hasPrev={openIdx > 0} hasNext={openIdx >= 0 && openIdx < cut.length - 1} onOpen={setOpenCross} />
    </>
  );
};

export default DarkPool;
