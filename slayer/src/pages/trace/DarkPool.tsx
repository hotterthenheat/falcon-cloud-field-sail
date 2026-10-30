/* Off-exchange crosses with the read attached: the market's tape, or one name's with its shelves, then where the dark
   money went by name. A name typed cuts the tape to it. */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { darkView, execWord, fmtCount as num, lastStockClose, nyIsoToday, olderDarkDay, olderNameDark, postureOf, quotePlace, useAccumTape, useDarkRegularDay, useLitRegularDay, useNameDark, useOlderPages, usd as fmtUsd } from '../../data/traceLive';
import { dayAdv, shortDay, spanWords } from '../../components/trace/dayWords';
import { useTraceSession } from '../../components/trace/traceSession';
import { useQParam } from '../../components/trace/addressCut';
import { FLOW_TTL_MS, FeedFallback, StaleMark } from '../../components/ui/liveRead';
import { POSTURE_WORD, type DarkTapeView } from '../../data/darkpool';
import { postureGrade } from '../../data/traceLean';
import { crossKey, watchedCross } from '../../context/WatchContext';
import CrossDrilldown, { IntentTag, noReadWord } from '../../components/trace/CrossDrilldown';
import FlowSearch, { parseContractQuery } from '../../components/trace/FlowSearch';
import WatchStar from '../../components/trace/WatchStar';
import GradeMeter from '../../components/ui/GradeMeter';
import type { DarkLeaderRow, DarkLeadersView, DarkPoolIntent, DarkPoolLevel, DarkPoolPrint, DarkPoolView, LevelRole, Posture } from '../../types/darkpool';
import type { Column } from '../../components/ui/DataTable';
import CompanyLogo from '../../components/ui/CompanyLogo';
import DropdownSelect, { type DropdownOption } from '../../components/ui/DropdownSelect';
import RichRead from '../../components/ui/RichRead';
import ColumnChooser, { useHiddenColumns } from '../../components/trace/ColumnChooser';
import { earnMarks, weightInk } from '../../components/trace/earnedInk';
import { LiveHold, useHold, KeptMark } from '../../components/trace/LiveHold';
import ReadDoor from '../../components/trace/ReadDoor';
import TermLine from '../../components/trace/TermLine';
import TraceBox, { Champion, endlessOf, Fact, PhoneRow, TraceGrid } from '../../components/trace/TraceBox';
import { nyClock } from '../../core/nyTime';
import { DarkPoolGuide } from '../../components/trace/TraceGuide';
import { DP_SHELF_H, DP_STRIP_HEAD_H, TracePageSkeleton } from './traceSkeletons';

const signedPct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`;
const dirInk = (v: number) => (v > 0 ? 'text-bull' : v < 0 ? 'text-bear' : 'text-textMuted');
/* an after-hours print's place in a thin quote is shown, never inked as a side */
const placeInk = (p: DarkPoolPrint, cents: number) => (p.extended ? 'text-textSecondary' : cents === 0 ? 'text-textMuted' : dirInk(cents));
/* the place wears the read's ink: over the mid (at the ask included) bought up, under it sold down, at the mid plain */
const execInk = (p: DarkPoolPrint) => {
  const w = execWord(p);
  /* inside the spread the place is the read's own words — inked only where the print carries a read (sized, at the quote) */
  if ((w === 'OVER MID' || w === 'UNDER MID') && !(p.sized && !p.special)) return 'text-textMuted';
  return p.extended || !w || w === 'MID' ? 'text-textMuted' : w === 'ASK' || w === 'OVER MID' ? 'text-bull' : 'text-bear';
};

type ReadCut = 'all' | DarkPoolIntent;
const READ_OPTIONS: DropdownOption<ReadCut>[] = [
  { value: 'all', label: 'Every read', hint: 'Every cross, whatever it is doing' },
  { value: 'ACCUMULATION', label: 'Accumulation', hint: 'Size printed over the mid — paid up for, buyer-initiated', tone: 'bull' },
  { value: 'DISTRIBUTION', label: 'Distribution', hint: 'Size printed under the mid — sold down, seller-initiated', tone: 'bear' },
  { value: 'HEDGE FLOW', label: 'At the mid', hint: 'Size crossed at the mid — neither side pressed' },
  { value: 'ROTATION', label: 'No read', hint: 'Small, priced by its own terms or in an auction, or after hours — shown, never read' },
];
type SizeCut = 'any' | 'sized';
const SIZE_OPTIONS: DropdownOption<SizeCut>[] = [
  { value: 'any', label: 'Any size', hint: 'Every cross' },
  { value: 'sized', label: 'Sized', hint: '$250K and up, priced at the quote: the prints the reads are built on' },
];
/** Anywhere, on any shelf, between shelves, or at one shelf ("at:492.27") */
type WhereCut = 'anywhere' | 'shelf' | 'between' | `at:${string}`;
const WHERE_FIXED: DropdownOption<WhereCut>[] = [
  { value: 'anywhere', label: 'Anywhere', hint: 'Every cross, wherever it printed' },
  { value: 'shelf', label: 'On a shelf', hint: 'Crosses that landed on one of the session’s shelves' },
  { value: 'between', label: 'Between shelves', hint: 'Crosses that printed away from every shelf' },
];
const atShelf = (price: number): WhereCut => `at:${price.toFixed(2)}`;
const onShelf = (p: DarkPoolPrint, price: number) => Math.abs(p.price - price) / price < 0.001;
const TERMS_OPTIONS: DropdownOption<'quote' | 'own'>[] = [
  { value: 'quote', label: 'At the quote', hint: 'Priced against the bid and ask: the crosses the page reads and totals' },
  { value: 'own', label: 'Own terms', hint: 'Contingent, average-price and auction prints, kept out of the totals' },
];
const KIND_OPTIONS: DropdownOption<'dark' | 'lit'>[] = [
  { value: 'dark', label: 'Dark pool', hint: 'Off-exchange crosses' },
  { value: 'lit', label: 'Lit tape', hint: 'Prints on the exchanges' },
];

const ROLE_INK: Record<LevelRole, string> = { SUPPORT: 'text-bull', RESISTANCE: 'text-bear', PIVOT: 'text-textMuted' };
const ROLE_BAR: Record<LevelRole, string> = { SUPPORT: 'bg-bull/70', RESISTANCE: 'bg-bear/70', PIVOT: 'bg-ink/25' };
const ROLE_WORD: Record<LevelRole, string> = { SUPPORT: 'support', RESISTANCE: 'resistance', PIVOT: 'pivot' };
const INTENT_WORD: Record<DarkPoolIntent, string> = { ACCUMULATION: 'accumulation', DISTRIBUTION: 'distribution', 'HEDGE FLOW': 'at the mid', ROTATION: 'no read' };

/* "What it says" holds a sentence, so it gets a width of its own */
const WIDTHS: Record<string, number> = { mark: 40, name: 104, time: 84, price: 84, vs: 76, shares: 92, dollars: 84, exec: 92, shelf: 80, read: 132, says: 288 };
const TOOLTIPS: Record<string, string> = {
  vs: 'Cents through the quote at the print. A percent only when the fill left the spread.',
  exec: 'Where the print sat in the quote: at the ask or bid, or inside the spread over, under or at the mid (within ¼¢)',
  shelf: 'Whether the cross landed on one of the session’s shelves',
  read: 'A sized cross over the mid reads accumulation, under it distribution; small, after-hours and own-terms prints carry no read',
  conviction: 'How sure the read is',
  says: 'The read in a sentence',
};
/* the share column flexes so the table fills its box */
/* the read is words: it takes the room the figures leave and gives way first */
const SAYS = ['says'];
const SAYS_FLEX: Record<string, number> = { says: 2 };
const LEADER_WIDTHS: Record<string, number> = { ticker: 140, price: 120, dark: 120, avg: 120, shares: 140, share: 168 };
const LEADER_TOOLTIPS: Record<string, string> = {
  dark: 'Off-exchange dollars in the dark prints in hand',
  share: 'Against the heaviest name in its sector',
  shares: 'Shares printed off-exchange',
};

type LeaderRow = DarkLeaderRow & { sector: string; sectorMax: number };

/* the market's tape by default, a name by the search; remembered across route changes within a session */
const queryMemory = { q: '' };

const darkIdOf = (p: DarkPoolPrint) => `${p.ticker}-${p.id}`;
const NO_PRINTS: DarkPoolPrint[] = [];

/* A leader's name in the leaders sentence, on a touch screen: at least 32 wide, the name to the right so a comma
   after it stays tight (see the sentence) */
const LEADER_DOOR = '[@media(pointer:coarse)]:inline-block [@media(pointer:coarse)]:min-w-[32px] [@media(pointer:coarse)]:text-right';

const DarkPool = () => {
  /* the search is in the address (?q=), so a link carries it */
  const [query, setQuery] = useQParam(queryMemory);
  const [tapeKind, setTapeKind] = useState<'dark' | 'lit'>('dark');
  /* after the stock close the page opens on the day's regular-session crosses; after-hours prints are their own view */
  const [closed, setClosed] = useState(() => lastStockClose());
  useEffect(() => {
    const id = window.setInterval(() => setClosed(c => {
      const n = lastStockClose();
      return n?.closeMs === c?.closeMs ? c : n;
    }), 30_000);
    return () => window.clearInterval(id);
  }, []);
  /* the shell's Session card: Regular is the closed day's session, Extended the prints since */
  const traceSession = useTraceSession();
  const dpSession: 'regular' | 'after' = traceSession === 'extended' ? 'after' : 'regular';
  const regularView = !!closed && dpSession === 'regular';
  /* the market's live feeds are read only while they are the view */
  const qLive = query.trim().toUpperCase();
  const namedLive = /^[A-Z][A-Z0-9.]{0,5}$/.test(qLive);
  const darkLive = useAccumTape('dark', 200, !regularView && !namedLive && tapeKind === 'dark');
  const darkReg0 = useDarkRegularDay(regularView ? closed!.iso : null);
  /* the day's next-largest crosses page in on scroll; a name pages back through its day; the live feed has no cursor */
  const q0 = query.trim().toUpperCase();
  const named0 = /^[A-Z][A-Z0-9.]{0,5}$/.test(q0) ? q0 : null;
  const regOlder = useOlderPages(`dreg:${closed?.iso ?? ''}`, darkReg0.rows, darkIdOf, inHand => olderDarkDay(closed!.iso, inHand), regularView && !named0 && tapeKind === 'dark');
  const darkReg = useMemo(() => ({ ...darkReg0, rows: regOlder.rows }), [darkReg0, regOlder.rows]);
  const dark = regularView ? darkReg : darkLive;
  const litLive = useAccumTape('lit', 200, !regularView && !namedLive && tapeKind === 'lit');
  /* own-terms prints (contingent, average-price) stand apart, in no total and no leader */
  const [terms, setTerms] = useState<'quote' | 'own'>('quote');
  const q = query.trim().toUpperCase();
  const named = /^[A-Z][A-Z0-9.]{0,5}$/.test(q) ? q : null;
  /* the lit feed cannot page back, so the closed day's lit view walks back the six names heaviest in the dark */
  const litNames = useMemo(() => {
    const by = new Map<string, number>();
    for (const p of darkReg.rows) if (!p.special) by.set(p.ticker, (by.get(p.ticker) ?? 0) + p.notional);
    return [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(e => e[0]);
  }, [darkReg.rows]);
  const litReg = useLitRegularDay(regularView && tapeKind === 'lit' && !named ? closed! : null, litNames);
  const lit = regularView ? litReg : litLive;
  const nameBook = useNameDark(named, regularView ? closed!.closeMs : null);
  const [read, setRead] = useState<ReadCut>('all');
  const [size, setSize] = useState<SizeCut>('any');
  const [where, setWhere] = useState<WhereCut>('anywhere');
  const [guideOpen, setGuideOpen] = useState(false);

  const nameDayIso = regularView ? closed!.iso : nyIsoToday();
  const nameOlder = useOlderPages(`dname:${named ?? ''}:${nameDayIso}`, nameBook.rows.view?.prints ?? NO_PRINTS, darkIdOf, inHand => olderNameDark(named!, inHand, nameDayIso), !!named && tapeKind !== 'lit');
  const nameView0 = named && tapeKind !== 'lit' ? nameBook.rows.view : null;
  const nameView = useMemo(() => (nameView0 && nameOlder.rows.length > nameView0.prints.length ? { ...nameView0, prints: nameOlder.rows } : nameView0), [nameView0, nameOlder.rows]);
  const liveView = useMemo(() => {
    if (!nameView) return null;
    const ps = nameView.prints.filter(p => (terms === 'own' ? !!p.special : !p.special));
    return { ...darkView(nameView.ticker, ps, nameView.levels, nameView.spot, nameView.dpSharePct), ownTerms: nameView.prints.length - nameView.prints.filter(p => !p.special).length };
  }, [nameView, terms]);
  const nameDay = named ? nameBook.rows.day : null;
  const liveTape = useMemo<(DarkTapeView & { lit: boolean; note: string; read: number; ownTerms: number }) | null>(() => {
    const all = named ? (tapeKind === 'lit' ? nameBook.rows.lit : []) : tapeKind === 'lit' ? lit.rows : dark.rows;
    const prints = all.filter(p => (terms === 'own' ? !!p.special : !p.special));
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
          /* a stand-in (the card reads the stock's own last trade); never an own-terms print's price */
          spot: p.special ? 0 : p.price,
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
    /* each name's posture is its own prints' */
    for (const v of views.values()) {
      const pv = postureOf(v.prints);
      v.posture = pv.posture;
      v.netPosturePct = pv.net;
      v.postureNote = pv.note;
    }
    const total = prints.reduce((a, p) => a + p.notional, 0);
    /* one posture rule (postureOf): sized regular-session prints at the quote, by their dollars */
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
      ownTerms: all.filter(p => p.special).length,
    };
  }, [dark.rows, lit.rows, nameBook.rows.lit, tapeKind, named, terms]);
  /* not yet is not nothing: until the head's source answers every figure reads "—" */
  const srcReading = named
    ? nameBook.waiting && !nameBook.rows.view && nameBook.rows.lit.length === 0
    : tapeKind === 'lit'
      ? lit.waiting && lit.rows.length === 0
      : dark.waiting && dark.rows.length === 0;
  const hold = useHold(useMemo(() => ({ view: liveView, tape: liveTape }), [liveView, liveTape]), named ?? 'market', !srcReading);
  /* the closed day's view is its largest crosses: this is the smallest that made the cut */
  const regFloor = useMemo(() => (darkReg.rows.length ? Math.min(...darkReg.rows.map(p => p.notional)) : 0), [darkReg.rows]);
  const dayLargest = regularView && !named && tapeKind !== 'lit';
  const { view, tape } = hold.value;
  const name: string | null = named;
  /* the head's owner: the name, or the market */
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
              postureNote: `${tape.lit ? 'On the lit tape' : tape.read === 0 ? 'Nothing to read' : POSTURE_WORD[tape.posture]} across ${num(tape.names.length)} names — ${fmtUsd(tape.totalNotional)} ${tape.lit ? 'printed on the exchanges' : 'crossed off-exchange'} in ${terms === 'own' ? `${num(tape.crosses)} own-terms and auction prints, never read` : regularView && !tape.lit ? `${num(tape.crosses)} of the day's largest regular-session crosses (${fmtUsd(regFloor)} and up)` : regularView && tape.lit ? `lit prints of $500K and up for the ${num(litNames.length)} names heaviest in the dark` : `the last ${num(tape.crosses)} prints`}${terms === 'quote' && tape.ownTerms ? `; ${num(tape.ownTerms)} own-terms prints set apart` : ''}. ${tape.note}`,
              read: tape.read,
              totalNotional: tape.totalNotional,
            }
          : named && nameBook.rows.unknown
            ? /* no such ticker: the page stands and says so */
              { ticker: named, dpSharePct: 0, posture: 'BALANCED' as const, netPosturePct: 0, postureNote: `No ticker “${named}” — check the symbol.`, read: 0, totalNotional: 0 }
            : null,
    [view, tape, named, nameBook.rows.unknown]
  );
  /* the last head stands until the new name's lands, so the page never drops to its skeleton under the typing field */
  const lastHeadRef = useRef<typeof headNow>(null);
  if (headNow) lastHeadRef.current = headNow;
  const head = headNow ?? lastHeadRef.current;
  /* every figure covers the prints in hand, first to last, so the window is named (its day when not today's) */
  const tapeWindow = useMemo(() => {
    const ps = view ? view.prints : tape ? tape.prints : [];
    const w = spanWords(ps);
    return w ? `${w} ET` : null;
  }, [view, tape]);
  /* the cross's card */
  const [openCross, setOpenCross] = useState<DarkPoolPrint | null>(null);
  const openView = useMemo(() => {
    if (!openCross) return null;
    if (view && view.ticker === openCross.ticker) return view;
    return tape?.views.get(openCross.ticker) ?? null;
  }, [openCross, view, tape]);
  const shownCross = useMemo(() => (openCross ? openView?.prints.find(p => p.id === openCross.id) ?? openCross : null), [openCross, openView]);
  const leaderWindow = useMemo(() => {
    const w = spanWords(dark.rows.filter(p => !p.special));
    return w ? `${w} ET` : null;
  }, [dark.rows]);
  const leaders = useMemo<DarkLeadersView>(() => {
    const byName = new Map<string, DarkLeaderRow>();
    /* own-terms prints are in no leader */
    const atQuote = dark.rows.filter(p => !p.special);
    /* the price is the newest cross by its own instant, not the last row seen */
    const newestAt = new Map<string, number>();
    const atOf = (p: DarkPoolPrint) => p.epochMs ?? 0;
    for (const p of atQuote) {
      const had = byName.get(p.ticker);
      if (had) {
        had.notional += p.notional;
        had.size += p.size;
        if (atOf(p) > (newestAt.get(p.ticker) ?? -Infinity)) {
          had.price = p.price;
          had.dirUp = p.vsSpotPct >= 0;
          newestAt.set(p.ticker, atOf(p));
        }
      } else {
        byName.set(p.ticker, { ticker: p.ticker, price: p.price, dirUp: p.vsSpotPct >= 0, notional: p.notional, pctAvgVol: 0, size: p.size });
        newestAt.set(p.ticker, atOf(p));
      }
    }
    const rows = [...byName.values()].sort((a, b) => b.notional - a.notional);
    const totalNotional = rows.reduce((a, r) => a + r.notional, 0);
    return {
      totalNotional,
      totalPrints: atQuote.length,
      updated: dark.at ? `${nyClock(dark.at, { zone: true })}` : '—',
      /* the recent feed carries no sector, so the names stand as one list */
      sectors: rows.length
        ? [{ sector: 'Every name', color: 'rgb(var(--text-secondary))', notional: totalNotional, sharePct: 100, prints: atQuote.length, rows }]
        : [],
    };
  }, [dark.rows, dark.at]);

  /* a shelf picked on one name means nothing on the next */
  useEffect(() => {
    setWhere('anywhere');
  }, [name]);

  const levels = view?.levels ?? [];
  const pickedShelf = where.startsWith('at:') ? Number(where.slice(3)) : null;
  const whereOptions = useMemo<DropdownOption<WhereCut>[]>(
    () => [...WHERE_FIXED, ...levels.map(l => ({ value: atShelf(l.price), label: `$${l.price.toFixed(2)}`, hint: `${ROLE_WORD[l.role]} · ${fmtUsd(l.notional)} rested here` }))],
    [levels]
  );

  /* the cards' cut on the crosses; a typed prefix narrows the market's names */
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
    /* every sized print, any distance from the mid, by where it printed; after-hours ones counted, never read */
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
  const spotOf = useCallback((p: DarkPoolPrint) => {
    const sp = view && view.ticker === p.ticker ? view.spot : tape?.views.get(p.ticker)?.spot ?? 0;
    return sp > 0 ? sp : p.price;
  }, [view, tape]);
  const columns = useMemo<Column<DarkPoolPrint>[]>(
    () => [
      /* the star keeps the cross on the Tracker and never opens the card */
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
      { key: 'time', header: 'Time ET', sortValue: p => p.time, render: p => <span className="text-textSecondary tnum">{p.time}</span> },
      { key: 'price', header: 'Price', align: 'right', sortValue: p => p.price, render: p => <span className="font-mono tnum font-bold text-textPrimary">${p.price.toFixed(2)}</span> },
      { key: 'vs', header: 'vs mid', align: 'right', sortValue: p => p.vsSpotPct, render: p => { const place = quotePlace(p.vsSpotPct, p.price); return <span className={`font-mono tnum ${placeInk(p, place.cents)}`}>{place.text}</span>; } },
      { key: 'shares', header: 'Shares', align: 'right', sortValue: p => p.size, render: p => <span className={`font-mono tnum ${weightInk(p.size, marks.size)}`}>{num(p.size)}</span> },
      { key: 'dollars', header: 'Dollars', align: 'right', sortValue: p => p.notional, render: p => <span className={`font-mono tnum ${weightInk(p.notional, marks.notional)}`}>{fmtUsd(p.notional)}</span> },
      { key: 'exec', header: 'Print', sortValue: p => p.exec ?? '', render: p => <span className={`font-mono text-t11 ${execInk(p)}`} title={p.extended ? 'After hours: where it sat in a thin quote, not a side' : undefined}>{execWord(p) ?? '—'}{p.extended ? <span className="text-textMuted"> · AH</span> : null}</span> },
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
        render: p => (p.sized && !p.extended && !p.special ? <IntentTag intent={p.intent} /> : <span className="font-mono text-t11 uppercase tracking-wider text-textMuted" title={p.read}>{noReadWord(p)}</span>),
      },
      {
        key: 'says',
        header: 'What it says',
        /* two lines, never cut mid-word, centred in the row like every other cell; the whole read is the hover */
        render: p => (
          <span className="inline-flex items-center align-middle max-w-full" title={p.read}>
            <span className="text-t11 leading-tight text-textSecondary whitespace-normal line-clamp-2">{p.read}</span>
          </span>
        ),
      },
    ],
    [marks, view, tape, spotOf]
  );
  const { hidden, toggle, showAll, hideAll } = useHiddenColumns('slayer_darkpool_cols');
  /* on a phone: the name, price and time; then the dollars, shares, place and read */
  const crossPhoneRow = useCallback(
    (p: DarkPoolPrint) => {
      const place = quotePlace(p.vsSpotPct, p.price);
      return (
        <PhoneRow
          lead={<WatchStar k={crossKey(p)} make={() => watchedCross(p, spotOf(p), 'dark-pool')} noun="print" />}
          title={
            <>
              <CompanyLogo ticker={p.ticker} size={15} />
              {!view && <span className="font-bold">{p.ticker}</span>}
              <span className="font-bold tnum">${p.price.toFixed(2)}</span>
            </>
          }
          aside={`${p.time} ET`}
          figures={[
            <span key="d" className="font-semibold text-textPrimary">
              {fmtUsd(p.notional)}
            </span>,
            <span key="s">{num(p.size)} sh</span>,
            <span key="v" className={placeInk(p, place.cents)}>
              {place.text}
            </span>,
            p.sized && !p.extended && !p.special ? <IntentTag key="r" intent={p.intent} /> : <span key="r" className="text-textMuted uppercase text-t11">{noReadWord(p)}</span>,
          ]}
        />
      );
    },
    [view, spotOf]
  );
  /* the card's steps walk the cut as the grid shows it */
  const openIdx = openCross ? cut.findIndex(p => p.ticker === openCross.ticker && p.id === openCross.id) : -1;
  const stepCross = useCallback(
    (dir: -1 | 1) => {
      const next = openIdx + dir;
      if (next >= 0 && next < cut.length) setOpenCross(cut[next]);
    },
    [openIdx, cut]
  );
  /* the star column has no header and is not a column you turn off */
  const chooserCols = useMemo(() => columns.flatMap(c => (typeof c.header === 'string' && c.header.trim() ? [{ key: c.key, label: c.header }] : [])), [columns]);
  const gridHidden = useMemo(() => {
    if (!hidden.has('mark')) return hidden;
    const next = new Set(hidden);
    next.delete('mark');
    return next;
  }, [hidden]);

  const leaderRows = useMemo<LeaderRow[]>(() => {
    const out: LeaderRow[] = [];
    for (const s of leaders.sectors) {
      const max = Math.max(1, ...s.rows.map(r => r.notional));
      for (const r of s.rows) out.push({ ...r, sector: s.sector, sectorMax: max });
    }
    return out.sort((x, y) => y.notional - x.notional);
  }, [leaders]);
  const leaderMarks = useMemo(() => ({ dark: earnMarks(leaderRows, r => r.notional), shares: earnMarks(leaderRows, r => r.size) }), [leaderRows]);
  const heaviest = leaderRows[0] ?? null;
  const shownSector = leaders.sectors[0];
  const leaderKey = useCallback((r: LeaderRow) => r.ticker, []);
  /* a name goes on the box above: the search takes it */
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
              <span className="font-mono text-t11 tnum text-textSecondary w-9 text-right shrink-0">{pct}%</span>
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
  /* On a phone a leader is a card like the tape's rows: the name and its last print, the dark dollars at the right,
     the shares and its share of the heaviest name under them, so the box never scrolls sideways */
  const leaderPhoneRow = useCallback(
    (r: LeaderRow) => {
      const pct = Math.round((r.notional / r.sectorMax) * 100);
      return (
        <PhoneRow
          title={
            <>
              <CompanyLogo ticker={r.ticker} size={15} />
              <span className="font-bold">{r.ticker}</span>
              <span className="tnum text-textSecondary" title="The name's last dark print">${r.price.toFixed(2)}</span>
            </>
          }
          aside={<span className={weightInk(r.notional, leaderMarks.dark)}>{fmtUsd(r.notional)}</span>}
          figures={[
            <span key="s" className={weightInk(r.size, leaderMarks.shares)}>{num(r.size)} sh</span>,
            <span key="v" className="inline-flex items-center gap-1.5" title="Its dark dollars against the heaviest name's">
              <span className="inline-flex w-12 h-[3px] rounded-full overflow-hidden bg-ink/[0.06]">
                <span className="h-full rounded-full bg-silver/70" style={{ width: `${pct}%` }} />
              </span>
              {pct}% of the heaviest
            </span>,
          ]}
        />
      );
    },
    [leaderMarks]
  );

  if (!head) return <TracePageSkeleton pathname="/trace/dark-pool" />;
  const litLane = tapeKind === 'lit';

  const largest = facts.largest;
  const sentence: ReactNode = (
    <>
      <RichRead text={srcReading ? `Reading ${named ? `${named}'s crosses` : tapeKind === 'lit' ? 'the lit tape' : "the market's crosses"}… ` : `${head.postureNote} `} />
      {srcReading ? null : largest ? (
        <>
          <RichRead text={litLane ? 'Largest lit print ' : 'Largest cross '} />
          <ReadDoor onOpen={() => setOpenCross(largest)} title="Open the cross's card">
            {view ? '' : `${largest.ticker} `}{num(largest.size)} at ${largest.price.toFixed(2)}
          </ReadDoor>
          <RichRead text={` for ${fmtUsd(largest.notional)}${largest.special ? ` — ${/^[aeiou]/i.test(largest.special) ? 'an' : 'a'} ${largest.special}, no read` : largest.extended ? ' — after hours, no read' : largest.sized ? ` — on its own it reads ${INTENT_WORD[largest.intent]}${(() => {
            /* one cross's read is its own; the posture weighs every sized cross, so say which is which when they differ */
            const own = largest.intent === 'ACCUMULATION' ? 'ACCUMULATING' : largest.intent === 'DISTRIBUTION' ? 'DISTRIBUTING' : 'BALANCED';
            return own !== head.posture ? `; the posture weighs every sized cross by its dollars and reads ${POSTURE_WORD[head.posture].toLowerCase()}` : '';
          })()}` : ' — too small to read'}.`} />
        </>
      ) : (
        <RichRead text={litLane ? 'No lit print on this cut.' : 'No cross on this cut.'} />
      )}
    </>
  );
  const darkLead = srcReading
    ? `Reading ${named ? `${named}'s crosses` : tapeKind === 'lit' ? 'the lit tape' : "the market's crosses"}…`
    : named && nameBook.rows.unknown
      ? `No ticker “${named}”.`
      : !head || !(head.totalNotional > 0)
        ? litLane ? 'No lit prints on this cut.' : `No crosses${named ? ` for ${named}` : ''} on this cut.`
        : `${named ?? 'The market'}: ${fmtUsd(head.totalNotional)} ${litLane ? 'printed on the exchanges' : 'crossed off-exchange'}${tapeWindow ? ` (${tapeWindow})` : ''}${litLane || head.read === 0 ? '' : ` — reads ${POSTURE_WORD[head.posture].toLowerCase()}`}${largest ? `; largest ${fmtUsd(largest.notional)}${view ? '' : ` in ${largest.ticker}`}` : ''}.`;
  const lead = shownSector?.rows.slice(0, 3) ?? [];
  const leadersSentence: ReactNode = shownSector ? (
    <>
      <RichRead text={`${fmtUsd(shownSector.notional)} printed off-exchange across ${num(shownSector.prints)} crosses — `} />
      {/* ON A TOUCH SCREEN the three names stand 44 apart, centre to centre, so each one's finger box is its own and not
          its neighbour's: each at least 32 wide, a little more room after a comma (the last-targets pass, 2026-10-30) */}
      {lead.map((r, i) => (
        <span key={r.ticker}>
          <ReadDoor onOpen={() => putAbove(r.ticker)} title={`Put ${r.ticker} on the box above`} className={LEADER_DOOR}>
            {r.ticker}
          </ReadDoor>
          {i < lead.length - 2 ? <span className="[@media(pointer:coarse)]:mr-2">, </span> : i === lead.length - 2 ? ' and ' : ''}
        </span>
      ))}
      <RichRead text={regularView ? ` lead it, among the day's largest regular-session crosses (${fmtUsd(regFloor)} and up).` : ` lead it${leaderWindow ? `, ${leaderWindow}` : ''}. The recent feed carries crosses of about $100K and up.`} />
    </>
  ) : (
    <RichRead text="The dark tape has not printed yet." />
  );

  const shelfWords = `${facts.support} support · ${facts.resistance} resistance · ${facts.pivots} pivot${facts.pivots === 1 ? '' : 's'}`;

  return (
    <>
      <TraceBox
        title={litLane ? 'The lit tape' : 'The dark pool'}
        sub={
          view
            ? `${view.ticker}'s off-exchange crosses with the read attached, and the shelves they left · a shelf cuts the grid to it`
            : tapeKind === 'lit' && regularView
              ? `Lit prints of $500K and up, ${shortDay(closed!.iso)} 09:30–16:00 ET, for the ${num(litNames.length)} names heaviest in the dark · a row opens its card`
              : tapeKind === 'lit'
              ? 'The latest prints on the exchanges, newest first · a row opens its card · type a name to cut the tape'
              : regularView
                ? `The day's largest off-exchange crosses, ${shortDay(closed!.iso)} 09:30–16:00 ET, ${fmtUsd(regFloor)} and up · a row opens its card`
                : `The latest off-exchange crosses, about $100K and up, newest first${closed ? ', after hours: shown, never read' : ''} · a row opens its card`
        }
        testId="dark-pool"
        data={{ ticker: view ? view.ticker : 'market', read, size, where, crosses: cut.length }}
        foldOnPhone
        guide={{ title: 'How to read the dark pool', door: 'What the shelves, the reads and the conviction mean', body: <DarkPoolGuide />, testId: 'dark-pool-guide', open: guideOpen, onOpen: setGuideOpen }}
        facts={
          <>
            {/* only a name's day carries a share of volume */}
            {view && nameDay ? (
              <Fact label={`Off-exchange ${dayAdv()}`} testId="share" title="The day's dark shares at prices the lit tape also traded, over the day's volume. Own-terms buckets are counted apart">
                {Number.isFinite(nameDay.sharePct) ? `${nameDay.sharePct.toFixed(0)}% ` : ''}<span className="text-textMuted">{Number.isFinite(nameDay.sharePct) ? 'of shares · ' : ''}≈{fmtUsd(nameDay.darkDollars)} · {nameDay.darkShares.toLocaleString('en-US')} sh</span>
                {nameDay.offShares > 0 && <span className="text-textMuted" title="Dark shares at prices the lit tape never traded: own-terms prints, set apart from every other figure"> · ≈{fmtUsd(nameDay.offDollars)} own terms apart</span>}
              </Fact>
            ) : (
              <Fact
                label={dayLargest ? "The day's largest" : regularView && tapeKind === 'lit' && !named ? 'Before the close' : 'Window'}
                testId="window"
                title={
                  dayLargest
                    ? `The day's largest regular-session crosses, ${fmtUsd(regFloor)} and up, not every cross; times ${tapeWindow ?? '—'}`
                    : regularView && tapeKind === 'lit' && !named
                      ? `Regular-session lit prints of $500K and up: ${litNames.join(', ')}`
                      : 'Every figure here covers the prints in hand, first to last, not the whole day'
                }
              >
                {dayLargest ? (
                  <>
                    {num(cut.length)} crosses <span className="text-textMuted">· {fmtUsd(regFloor)} and up · 09:30–16:00</span>
                  </>
                ) : (
                  <>
                    {cut.length === 0 && (srcReading || darkReg.waiting) ? <span className="text-textMuted">Reading…</span> : <>{tapeWindow ?? '—'} <span className="text-textMuted">· {regularView && tapeKind === 'lit' && !named ? `${num(litNames.length)} names` : `last ${num(cut.length)} prints`}</span></>}
                  </>
                )}
              </Fact>
            )}
            <Fact label="Posture" testId="posture">
              {/* the side, then how far it leans in the four words; Balanced stands alone; nothing read is not balanced */}
              {srcReading ? (
                <span className="text-textMuted" data-posture-read="reading">Reading…</span>
              ) : head.read === 0 ? (
                <span className="text-textMuted" data-posture-read="none" title="No sized regular-session cross at the quote in this view">Nothing to read</span>
              ) : (
              <span
                className={`inline-flex items-center gap-2 ${head.posture === 'ACCUMULATING' ? 'text-bull' : head.posture === 'DISTRIBUTING' ? 'text-bear' : 'text-textSecondary'}`}
                data-posture-read={postureGrade(head.netPosturePct)}
              >
                {POSTURE_WORD[head.posture]}
                <GradeMeter grade={postureGrade(head.netPosturePct)} fill={head.posture === 'ACCUMULATING' ? 'bg-bull' : head.posture === 'DISTRIBUTING' ? 'bg-bear/80' : 'bg-ink/30'} className="w-12" />
                {head.posture !== 'BALANCED' && <span>{postureGrade(head.netPosturePct)}</span>}
              </span>
              )}
            </Fact>
            <Fact label="On this cut" testId="cut">
              {srcReading ? <span className="text-textMuted">—</span> : <>{fmtUsd(facts.dollars)} <span className="text-textMuted">· {num(cut.length)} {litLane ? 'prints' : 'crosses'}</span></>}
            </Fact>
            <Fact label="Sized: over · under mid" testId="sides" title={`Sized prints ($250K and up) over the mid (paid up) and under it (sold down)${facts.atMid > 0 ? `; ${fmtUsd(facts.atMid)} at the mid` : ''}${facts.afterHours ? `; ${facts.afterHours} after hours, counted but never read` : ''}`}>
              {srcReading ? (
                <span className="text-textMuted">—</span>
              ) : facts.sizedCount === 0 ? (
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
            {largest && (
              <Champion label={litLane ? 'Largest lit print' : 'Largest cross'} ink="supreme" onOpen={() => setOpenCross(largest)} testId="largest">
                {view ? '' : `${largest.ticker} · `}{num(largest.size)} @ ${largest.price.toFixed(2)} · {fmtUsd(largest.notional)}
              </Champion>
            )}
          </>
        }
        controls={
          <>
            <LiveHold paused={hold.paused} onToggle={hold.toggle} heldAt={hold.heldAt} waitingFirst={hold.waitingFirst} />
            {/* a closed session's prints are read once: closed, not stale; a fault still says so */}
            {regularView && !(named ? nameBook.fault : tapeKind === 'lit' ? lit.fault : dark.fault) ? (
              <span className="inline-flex items-center gap-1 font-mono text-t11 uppercase tracking-widest text-textMuted" title={`The ${closed ? shortDay(closed.iso) : ''} session has closed; its prints no longer change`} data-stale="closed">
                <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-textMuted" />
                Closed{closed ? ` · ${shortDay(closed.iso)}` : ''}
              </span>
            ) : (
              <span className={hold.paused ? 'invisible' : undefined} aria-hidden={hold.paused || undefined}>
                {(named ? nameBook : tapeKind === 'lit' ? lit : dark).kept && (named ? nameBook : tapeKind === 'lit' ? lit : dark).at != null ? (
                  <KeptMark at={(named ? nameBook : tapeKind === 'lit' ? lit : dark).at!} fault={named ? nameBook.fault : tapeKind === 'lit' ? lit.fault : dark.fault} />
                ) : (
                  <StaleMark at={named ? nameBook.at : tapeKind === 'lit' ? lit.at : dark.at} ttlMs={FLOW_TTL_MS} fault={named ? nameBook.fault : tapeKind === 'lit' ? lit.fault : dark.fault} />
                )}
              </span>
            )}
            <FlowSearch value={query} onChange={setQuery} rows={searchRows} tickersOnly countNoun="names" span />
            <DropdownSelect label="Read" value={read} options={READ_OPTIONS} onChange={setRead} title="What the cross is doing" testId="dark-pool-read" />
            <DropdownSelect label="Size" value={size} options={SIZE_OPTIONS} onChange={setSize} title="Every cross, or the sized ones" testId="dark-pool-size" />
            <DropdownSelect label="Where" value={where} options={whereOptions} onChange={setWhere} title="Where the cross printed" testId="dark-pool-where" />
            <DropdownSelect label="Price" value={terms} options={TERMS_OPTIONS} onChange={setTerms} title="Priced at the quote, or the own-terms and auction prints kept apart" testId="dark-pool-terms" />
            <DropdownSelect label="Tape" value={tapeKind} options={KIND_OPTIONS} onChange={setTapeKind} title="Off-exchange crosses, or prints on the exchanges" testId="dark-pool-kind" />
            <div className="ml-auto">
              <ColumnChooser columns={chooserCols} hidden={hidden} onToggle={toggle} onAll={showAll} onNone={() => hideAll(chooserCols.map(c => c.key))} />
            </div>
          </>
        }
        sentence={null}
        lead={darkLead}
        detail={
          <>
            {sentence}
            <TermLine keys={['ownTerms']} testId="dark-pool" />
          </>
        }
      >
        {/* a name's shelves, lowest price at the left; a cell picked cuts the grid to its shelf */}
        {levels.length > 0 && (
        <div className="border-t border-borderSubtle" data-dark-pool-shelves>
          <div className="px-5 flex items-center gap-2 border-b border-borderSubtle/60 font-mono text-t11 uppercase tracking-widest" style={{ height: DP_STRIP_HEAD_H }}>
            <span className="text-textPrimary">The shelves</span>
            <span className="text-textMuted normal-case tracking-normal font-sans text-t11" title="A shelf holds 3% or more of the day's dark dollars within 5% of the market">· where the day's dark shares rested · {shelfWords}</span>
          </div>
          {/* two across on a phone, three from 640, six from 1024: narrower cells cut their figures */}
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
                      <span className={`font-mono text-t11 font-semibold uppercase tracking-wider ${ROLE_INK[l.role]}`}>{l.role}</span>
                      <span className={`ml-auto min-w-0 truncate font-mono text-t11 tnum ${l.notional >= shelfMax ? 'font-bold text-textPrimary' : 'text-textSecondary'}`}>{fmtUsd(l.notional)}</span>
                    </span>
                    <span className="flex items-baseline gap-2">
                      <span className="font-mono text-t13 font-bold tnum text-textPrimary">${l.price.toFixed(2)}</span>
                      <span className={`font-mono text-t11 tnum ${dirInk(l.distPct)}`}>{signedPct(l.distPct)}</span>
                      <span className="ml-auto min-w-0 truncate font-mono text-t11 text-textMuted tnum whitespace-nowrap" title="The name's dark prints in hand at this price; the day's shares by price carry no count">{l.prints} in hand</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="relative h-0.5 flex-1 rounded-full bg-ink/[0.06] overflow-hidden">
                        <span className={`absolute left-0 top-0 h-full ${ROLE_BAR[l.role]}`} style={{ width: `${Math.round((l.notional / shelfMax) * 100)}%` }} />
                      </span>
                      <span className="font-mono text-t11 text-textMuted tnum w-8 text-right">{l.sharePct.toFixed(0)}%</span>
                    </span>
                  </button>
                );
              })}
          </div>
        </div>
        )}
        <TraceGrid rows={cut} columns={columns} hidden={gridHidden} widths={WIDTHS} flexes={SAYS_FLEX} prose={SAYS} tooltips={TOOLTIPS} rowKey={keyOf} onRowClick={p => setOpenCross(p)} selectedKey={openCross ? keyOf(openCross) : null} initialSort={{ key: 'time', dir: 'desc' }} phoneRow={crossPhoneRow} autoHeight emptyText={srcReading ? 'Reading the tape…' : named && nameBook.rows.unknown ? `No ticker “${named}” — check the symbol` : !named && parseContractQuery(query) ? 'Dark-pool crosses are stock prints: search a ticker (NVDA), not a contract' : named ? `No ${litLane ? 'lit prints' : 'crosses'} for ${named} ${dayAdv(nameDayIso)}${terms === 'own' ? ' on own terms' : ''}` : litLane ? 'No lit prints on this cut' : 'No crosses on this cut'} endless={named && tapeKind !== 'lit' ? endlessOf(nameOlder, `${named} crosses`, `the start of ${named}'s day reached`, hold.paused) : regularView && tapeKind === 'dark' ? endlessOf(regOlder, 'crosses', "the day's crosses reached", hold.paused, 'Smaller crosses ↓') : { onNear: () => {}, state: 'end', note: `${num(cut.length)} ${tapeKind === 'lit' ? 'lit prints' : 'crosses'} in hand; the live feed grows as prints arrive. Type a name to page back through its day` }} testId="dark-pool" />
        {(named ? nameBook.fault : tapeKind === 'lit' ? lit.fault : dark.fault) && cut.length === 0 ? <FeedFallback fault={named ? nameBook.fault : tapeKind === 'lit' ? lit.fault : dark.fault} /> : null}
      </TraceBox>

      <TraceBox
        title="Where the dark money went"
        sub={regularView ? "Off-exchange dollars in the day's largest crosses, by name · a name goes on the box above" : "Off-exchange dollars in the latest dark prints, by name · a name goes on the box above"}
        testId="dark-leaders"
        data={{ names: leaderRows.length }}
        facts={
          <>
            <Fact label={regularView ? "The day's largest crosses" : 'Dark tape in hand'} testId="tape" title={regularView ? `The day's largest regular-session crosses at the quote (${fmtUsd(regFloor)} and up), not every one` : 'The latest dark prints at the quote, collected while this page is open, not the whole day'}>
              {srcReading && !leaders.totalPrints ? <span className="text-textMuted">—</span> : <>{fmtUsd(leaders.totalNotional)} <span className="text-textMuted">· {num(leaders.totalPrints)} crosses{leaderWindow ? ` · ${leaderWindow}` : ''}</span></>}
            </Fact>
            <Fact label="Names" testId="names" title="The names in the latest dark prints">
              {srcReading && !leaderRows.length ? <span className="text-textMuted">—</span> : num(leaderRows.length)}
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
            <span className="font-mono text-t11 uppercase tracking-widest text-textMuted whitespace-nowrap" data-dark-leaders-updated>
              updated {leaders.updated}
            </span>
            <div className="ml-auto">
              <ColumnChooser keepOnPhone columns={leaderChooserCols} hidden={leaderChooser.hidden} onToggle={leaderChooser.toggle} onAll={leaderChooser.showAll} onNone={() => leaderChooser.hideAll(leaderColumns.map(c => c.key))} />
            </div>
          </>
        }
        sentence={leadersSentence}
      >
        <TraceGrid rows={leaderRows} columns={leaderColumns} hidden={leaderChooser.hidden} widths={LEADER_WIDTHS} tooltips={LEADER_TOOLTIPS} rowKey={leaderKey} onRowClick={r => putAbove(r.ticker)} selectedKey={name} initialSort={{ key: 'dark', dir: 'desc' }} phoneRow={leaderPhoneRow} autoHeight emptyText={srcReading ? 'Reading the tape…' : 'No dark prints in hand yet'} testId="dark-leaders" />
      </TraceBox>

      <CrossDrilldown print={shownCross} view={openView} onClose={() => setOpenCross(null)} onStep={stepCross} hasPrev={openIdx > 0} hasNext={openIdx >= 0 && openIdx < cut.length - 1} onOpen={setOpenCross} />
    </>
  );
};

export default DarkPool;
