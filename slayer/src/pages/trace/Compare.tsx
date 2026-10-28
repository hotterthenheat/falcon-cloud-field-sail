/*
==================================================
  SLAYER TERMINAL - COMPARE (Trace)
  Two names, side by side (2026-09-13; Noah, with
  his partner's page: "take this information and
  recreate it with our own type design"). ONE box
  in the house grammar: the head with both nets
  and the same-day money as facts and the page's
  champions among them, the cards line — the hold,
  the two name searches with the swap between
  them, the Clock and Money cards that cut BOTH
  names the same way — the sentence, then the
  body: each name's session on a Net Flow pane,
  the fight card of rows (the first name's figure
  on the left, the fact in the middle with what
  the two say against each other under it, the
  second name's on the right — the leading figure
  lit), and under it each name's six heaviest
  contracts and its structures. Every figure comes
  off the day book, the spreads and the tape the
  other Trace pages read (data/traceCompare.ts).
==================================================
*/

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftRight } from 'lucide-react';
import { useMarketData } from '../../context/MarketDataContext';
import { floorPackaged, notABet, notABetHint, spreadLegHint, SPREAD_KINDS, stockLike, STOCK_LIKE_HINT, type MoneynessKey, type SpreadTrade } from '../../data/flowBook';
import { dayLean, lastRegularClose, nyDateOf, nyIsoToday, tapeSessionIso, useFlowPerExpiry, useLiveBook, useNameSpreads, useNameTape, usePaneFlow, usd as fmtUsd, type PaneFlowPoint } from '../../data/traceLive';
import { nyClock } from '../../core/nyTime';
import { buildTraceCompare, buildTraceSide, signedUsd, type TraceSide } from '../../data/traceCompare';
import type { SleeveKey } from '../../types/compass';
import type { BookContract } from '../../types/trace';
import CompanyLogo from '../../components/ui/CompanyLogo';
import DropdownSelect from '../../components/ui/DropdownSelect';
import RichRead from '../../components/ui/RichRead';
import ScopeChip from '../../components/ui/ScopeChip';
import { daysFromToday, isLiveDay, nextCountDay, oiInWords, sameDayWords, shortDay } from '../../components/trace/dayWords';
import BookDrill from '../../components/trace/BookDrill';
import ContractCell from '../../components/trace/ContractCell';
import LeanCell from '../../components/trace/LeanCell';
import { PointerFollowCard } from '../../components/ui/PointerCard';
import { LiveHold, useHold } from '../../components/trace/LiveHold';
import NetFlowPane, { CLOCK_OPTIONS, MONEY_OPTIONS } from '../../components/trace/NetFlowPane';

/** Each name's last prints and structures the card reads */
const TAPE_N = 300;
const SPREADS_N = 80;
import ReadDoor from '../../components/trace/ReadDoor';
import TermLine from '../../components/trace/TermLine';
import TraceBox, { Champion, Fact } from '../../components/trace/TraceBox';
import { CompareGuide } from '../../components/trace/TraceGuide';
import { CMP_COLUMNS, CMP_LIST_HEAD_H, CMP_LIST_ROW_H, CMP_LISTED, CMP_PANE_H, CMP_ROW_H, CMP_SECTION_H } from './traceSkeletons';
import { useIsBelowXl, useIsPhone } from '../../components/ui/useMediaQuery';

const num = (v: number) => v.toLocaleString('en-US');
/* The index twins, the Pinpoint Compare's own pairing (data/compare `partnerFor`) — kept
   here so the Trace chunk does not carry that page's engines for four names */
const TWINS: Record<string, string> = { SPY: 'QQQ', QQQ: 'SPY', IWM: 'SPY', DIA: 'SPY' };

/* The two names are the page's own, remembered across route changes within a session */
let aMemory: string | null = null;
let bMemory: string | null = null;

/** A row's figure: the leader lit, the other quiet; a signed fact keeps its direction ink on both sides */
const Fig = ({ children, lit, ink }: { children: ReactNode; lit: boolean; ink?: string }) => (
  <span className={`font-mono text-[12px] tnum whitespace-nowrap ${lit ? 'font-semibold' : ''} ${ink ?? (lit ? 'text-textPrimary' : 'text-textSecondary')}`}>{children}</span>
);
const Sub = ({ children }: { children: ReactNode }) => <span className="text-[10.5px] text-textSecondary whitespace-nowrap">{children}</span>;
const dirInk = (v: number) => (v > 0 ? 'text-bull' : v < 0 ? 'text-bear' : 'text-textMuted');
/** ONE COLOUR RULE: net puts BOUGHT lean bearish (red), net puts sold bullish (green) — the chart head's rule */
const putDirInk = (v: number) => dirInk(-v);

/*
  THE CARD IN THE RULER'S GRAMMAR (Noah, 2026-10-18, with Pinpoint's "two books on one ruler" beside this
  card: "that one … is much more appealing so figure a way out to have the capsule/ruler look but incorporating
  it with this specific use case"): the ruler is a spine down the middle with capsules growing away from it,
  the longer the heavier, the figure inside. This card had the spine — the fact's name with the verdict under
  it — and printed its figures as plain type. Now each figure is a CAPSULE: the first name's grows LEFT from
  the spine, the second's RIGHT; its length is the figure's share of the row's larger figure, so the leader
  reaches the wing's run and the other stands in proportion; THE FIGURE IS ALWAYS INSIDE (Noah, the same
  day, a figure printed beside a capsule too light to hold it: "is that a typo or what? that is the only
  number out of the capsule") — a capsule is never shorter than its figure, and a small figure's capsule is
  its figure's room. A signed fact wears its direction, an unsigned one the silver, the leader lit with its
  ring. A two-figure row splits into two capsules, the pair scaled by its sum so the row still reads as one;
  when the floors would overrun the wing, the capsules above their floor give the difference. Words that are
  not magnitudes stay words beyond the capsule; a row with no magnitude keeps its cell. The ruler shares one
  axis because both books stand on one distance; here every row is its own fact, so every row sets its own
  scale from its two figures.
*/
type BarInk = 'bull' | 'bear' | 'silver' | 'mute';
interface Bar {
  /** The magnitude the capsule's length follows (its sign is the ink's business) */
  v: number;
  /** The figure as printed */
  text: string;
  ink: BarInk;
  /** Words beside the capsule, on the spine's side — "6 contracts", "past their interest" */
  after?: string;
  /** What this capsule holds, for its hover card — a pair's leg ("Paid", "Collected"); the row's own name otherwise
      (Noah, 2026-10-18: "the paid and collected row should have a hover that states which is paid and which is
      collected, not just a red and green capsule with a number in it") */
  name?: string;
  /** The leg in plain words, under its figure on the card — "structures put on for a debit" */
  desc?: string;
}
/** A capsule's figure ink on the hover card, by its token */
const CARD_INK: Record<BarInk, string> = { bull: 'rgb(var(--bull))', bear: 'rgb(var(--bear))', silver: 'rgb(var(--text-primary))', mute: 'rgb(var(--text-muted))' };
/** One line of the hover card: the label muted, the figure right-aligned in its ink, a small sub after it */
const CardLine = ({ k, v, sub, ink }: { k: string; v: string; sub?: string; ink?: string }) => (
  <>
    <span className="text-textMuted whitespace-nowrap">{k}</span>
    <span className="text-right font-mono text-[11px] tnum whitespace-nowrap" style={{ color: ink ?? 'rgb(var(--text-primary))' }}>
      {v}
      {sub && <span className="text-[11px] text-textMuted"> {sub}</span>}
    </span>
  </>
);
interface Row {
  key: string;
  label: string;
  /** What the two say against each other, one clause */
  note: string;
  /** Which side leads on this fact — lit; null when the fact has no leader */
  lead: 'a' | 'b' | null;
  cell: (s: TraceSide, lit: boolean) => ReactNode;
  /** The row's longer word, on hover of its fact */
  hint?: string;
  /** The row's capsules a side — one, or a pair; a row without them prints its cell */
  bars?: (s: TraceSide) => Bar[];
}
const barInk = (v: number): BarInk => (v > 0 ? 'bull' : v < 0 ? 'bear' : 'mute');
/** Net PUT premium leans the other way: puts bought are bearish ink, puts sold bullish (Lean's `put`) */
const putInk = (v: number): BarInk => barInk(-v);
const CAP_H = 18;
/** A capsule's fill and figure ink: the direction inks for a signed fact, the silver for an unsigned one, the leader lit
    with its ring — every class written out, since Tailwind only builds what it can read */
const CAP_CLASS: Record<BarInk, { lit: string; quiet: string; fig: string }> = {
  bull: { lit: 'bg-bull/[0.28] text-bull ring-1 ring-inset ring-bull/60', quiet: 'bg-bull/[0.14] text-bull', fig: 'text-bull' },
  bear: { lit: 'bg-bear/[0.28] text-bear ring-1 ring-inset ring-bear/60', quiet: 'bg-bear/[0.14] text-bear', fig: 'text-bear' },
  silver: { lit: 'bg-silver/[0.3] text-textPrimary ring-1 ring-inset ring-silver/60', quiet: 'bg-silver/[0.14] text-textSecondary', fig: 'text-textSecondary' },
  mute: { lit: 'bg-ink/[0.08] text-textMuted', quiet: 'bg-ink/[0.08] text-textMuted', fig: 'text-textMuted' },
};
const capClass = (ink: BarInk, lit: boolean): string => (lit ? CAP_CLASS[ink].lit : CAP_CLASS[ink].quiet);
/** The room a figure needs inside its capsule — Inter's tabular figures at 11.5px, and the capsule's own ends */
const figRoom = (t: string) => Math.ceil(t.length * 6.6) + 14;
/** One side's capsules: `a`'s stand against the spine's left edge and grow leftward, `b`'s against its right edge and
    grow rightward. EVERYTHING READS LEFT TO RIGHT on both wings — a pair in the label's order ("Calls · puts"), a
    figure outside its capsule after it, its words after that — a mirrored first wing read "74% · 26%" under a label
    that says calls first, and "8 contracts 129,652" for a volume. The ruler's own symmetry is kept where it counts:
    a lone capsule touches the spine on both sides. */
const Capsules = ({ bars, scale, side, lit, run, label, ticker, note }: { bars: Bar[]; scale: number; side: 'a' | 'b'; lit: boolean; run: number; label: string; ticker: string; note: string }) => {
  /* THE HOVER CARD (Noah, 2026-10-18, on the browser's own title tip: "the hover card is not appealing it looks like
     bare bone html"): the house's pointer card — glass beside the pointer, the capsule's name in silver with the
     ticker at the right, the figure in its ink with its words, a pair's other leg under it, the row's verdict as
     the foot. One card per hover, mounted on enter and gone on leave; it tracks the pointer by itself. */
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const shown = hover ? bars[hover.i] : null;
  const after = bars.map(b => b.after).filter(Boolean) as string[];
  /* the words beyond the capsule take their room off the run first, so the capsule never pushes them out of the wing */
  const afterRoom = after.reduce((n, t) => n + Math.ceil(t.length * 5.6) + 8, 0);
  const span = Math.max(24, run - afterRoom - (bars.length - 1) * 4);
  /* every capsule holds its figure: its floor is the figure's room; the share of the run above that is the
     magnitude's — and when the floors alone overrun the wing, the capsules above their floor give the difference */
  const floors = bars.map(b => figRoom(b.text));
  let lens = bars.map((b, i) => Math.max(floors[i], scale > 0 ? Math.round((Math.abs(b.v) / scale) * span) : 0));
  const total = lens.reduce((n, l) => n + l, 0);
  if (total > span) {
    const give = lens.map((l, i) => l - floors[i]);
    const giveTotal = give.reduce((n, g) => n + g, 0);
    if (giveTotal > 0) lens = lens.map((l, i) => l - Math.round(((total - span) * give[i]) / giveTotal));
  }
  return (
    <span className={`flex items-center gap-1 ${side === 'a' ? 'justify-end' : ''}`} data-compare-capsules={side}>
      {bars.map((b, i) => {
        /* a leg at zero wears no direction — a nought is not bearish */
        const ink: BarInk = b.v === 0 ? 'mute' : b.ink;
        /* THE WORDS SIT ON THE SPINE'S SIDE of both wings (Noah, 2026-10-18: "the right section should be on the left
           side of the capsule to make them closer to each other and read the same") — after the first name's capsule,
           before the second's, so the two sets of words face each other across the spine */
        const words = b.after && <span className="text-[10.5px] text-textSecondary whitespace-nowrap shrink-0">{b.after}</span>;
        const cap = (
          <span
            className={`inline-flex items-center justify-center rounded-full shrink-0 ${capClass(ink, lit)}`}
            style={{ width: lens[i], height: CAP_H }}
            onPointerEnter={e => setHover({ i, x: e.clientX, y: e.clientY })}
            onPointerLeave={() => setHover(h => (h?.i === i ? null : h))}
            data-cap={ink}
            data-cap-len={lens[i]}
            data-cap-lit={lit || undefined}
          >
            <span className={`font-mono text-[11.5px] tnum whitespace-nowrap ${lit ? 'font-semibold' : ''}`}>{b.text}</span>
          </span>
        );
        return (
          <Fragment key={i}>
            {side === 'b' && words}
            {cap}
            {side === 'a' && words}
          </Fragment>
        );
      })}
      {hover && shown && (
        <PointerFollowCard
          start={{ x: hover.x, y: hover.y }}
          dense
          width={232}
          testId="data-compare-cap-card"
          testValue={`${side}:${hover.i}`}
          title={shown.name ?? label}
          aside={ticker}
          foot={<span className="text-textSecondary">{note}</span>}
        >
          <CardLine k={shown.name ?? ticker} v={shown.text} sub={shown.after ?? shown.desc} ink={CARD_INK[shown.v === 0 ? 'mute' : shown.ink]} />
          {bars.length > 1 &&
            bars
              .filter((_, j) => j !== hover.i)
              .map((o, j) => <CardLine key={j} k={o.name ?? label} v={o.text} sub={o.desc} ink={CARD_INK[o.v === 0 ? 'mute' : o.ink]} />)}
        </PointerFollowCard>
      )}
    </span>
  );
};
/** A row's scale: the larger of the two sides' sums — a single is its own sum, a pair fills the run together */
const rowScale = (r: Row, a: TraceSide, b: TraceSide): number => {
  if (!r.bars) return 0;
  const sum = (s: TraceSide) => r.bars!(s).reduce((n, x) => n + Math.abs(x.v), 0);
  return Math.max(sum(a), sum(b));
};

const Compare = () => {
  const { marketData, activeTicker, changeTicker } = useMarketData();
  const navigate = useNavigate();
  const [aPick, setAPickState] = useState<string | null>(aMemory);
  const [bPick, setBPickState] = useState<string | null>(bMemory);
  const setAPick = (t: string | null) => {
    aMemory = t;
    setAPickState(t);
  };
  const setBPick = (t: string | null) => {
    bMemory = t;
    setBPickState(t);
  };
  /* ONE CUT FOR BOTH — a comparison on two cuts compares nothing */
  const [tenor, setTenor] = useState<SleeveKey | 'all'>('all');
  const [mny, setMny] = useState<MoneynessKey>('all');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  /* THE ROW'S FOCUS (Noah, 2026-09-13: "the focus statuses we have in Pulse — on click it
     blurs the rest and only focuses on that specific row"): the ladder's own contract — a
     click keeps the row, sharp and lifted in the house's kept look, and everything else
     on the card softens behind ONE blurred scrim (only its opacity animates; the blur is
     held 460ms past the let-go so it never snaps); the same row again, a click anywhere
     outside, or Escape lets go; another row moves it. */
  const [keptRow, setKeptRow] = useState<string | null>(null);
  const pinned = keptRow != null;
  /* THE WING'S RUN — how far a capsule can grow from the spine: the first wing's width, measured off the card
     and re-measured as it resizes (the columns are the grid's `1fr`s, so no number stands for them) */
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [wingW, setWingW] = useState(0);
  useEffect(() => {
    const card = cardRef.current;
    if (!card || typeof ResizeObserver === 'undefined') return;
    const read = () => {
      const w = Math.round(card.querySelector<HTMLElement>('[data-compare-a]')?.clientWidth ?? 0);
      setWingW(prev => (prev === w ? prev : w));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(card);
    return () => ro.disconnect();
  }, []);
  const [scrim, setScrim] = useState(false);
  useEffect(() => {
    if (pinned) {
      setScrim(true);
      return;
    }
    const t = window.setTimeout(() => setScrim(false), 460);
    return () => window.clearTimeout(t);
  }, [pinned]);
  useEffect(() => {
    if (!pinned) return;
    const onClick = (ev: MouseEvent) => {
      const t = ev.target as Element | null;
      if (t?.closest('[data-compare-row],[data-dropdown],[data-dropdown-card],[role="menu"],[data-guide-door],[data-popover-card],button,a,input,select,textarea')) return;
      setKeptRow(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !openKey) setKeptRow(null);
    };
    document.addEventListener('click', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [pinned, openKey]);

  const bookPack = useLiveBook(activeTicker);
  const liveBook = bookPack.rows;
  /* NOT YET / NOT AT ALL: with no book the card read "SPY leans bullish at +$0 … SPY $0" (the ship pass, 2026-10-22) */
  const bookState: 'reading' | 'down' | 'in' = liveBook.length ? 'in' : bookPack.fault ? 'down' : 'reading';
  /* The shared hold (see LiveHold): the book and the panes' tick freeze together; the two names' tapes and structures
     freeze with them below */
  const hold = useHold(useMemo(() => ({ book: liveBook, tick: marketData }), [liveBook, marketData]), activeTicker, liveBook.length > 0 || !!bookPack.fault);
  const { book, tick } = hold.value;

  /* Only names on today's book can be compared — busiest first, so the defaults are the names that matter */
  const names = useMemo(() => {
    const vol = new Map<string, number>();
    for (const r of book) vol.set(r.ticker, (vol.get(r.ticker) ?? 0) + r.volume);
    return [...vol.entries()].sort((x, y) => y[1] - x[1]).map(e => e[0]);
  }, [book]);
  const onBook = (t: string | null | undefined): t is string => !!t && names.includes(t);
  const aTicker = onBook(aPick) ? aPick : onBook(activeTicker) ? activeTicker : names[0] ?? 'SPY';
  /* Never the same name twice: the second falls to the first's twin, else the next busiest */
  const twin = TWINS[aTicker];
  const bTicker = onBook(bPick) && bPick !== aTicker ? bPick : onBook(twin) && twin !== aTicker ? twin : names.find(t => t !== aTicker) ?? (twin ?? (aTicker === 'QQQ' ? 'SPY' : 'QQQ'));


  /* EACH NAME'S OWN TAPE AND STRUCTURES (2026-10-22): the market-wide windows are the market's latest prints — after the
     close almost all index — and read "0 prints" for SPY beside a full book. Each name's own last prints instead, cut to
     the window BOTH tapes cover: a capped tape only reaches back so far, and a longer reach is not a busier tape. */
  const tapeA = useNameTape(aTicker, TAPE_N).rows;
  const tapeB = useNameTape(bTicker, TAPE_N).rows;
  const spreadsPackA = useNameSpreads(aTicker, SPREADS_N);
  const spreadsPackB = useNameSpreads(bTicker, SPREADS_N);
  const spreadsA = spreadsPackA.rows;
  const spreadsB = spreadsPackB.rows;
  const spreadsDone = spreadsPackA.complete && spreadsPackB.complete;
  const liveNames = useMemo(() => {
    /* TO THE MILLISECOND (audit round 8, major 3: the tapes were still cut by the whole second, so a print in the cut's own
       second counted for one name and not the other's earlier half) — the spreads' round-7 rule, on the tape */
    const msP = (p: { epoch?: number; epochMs?: number }) => p.epochMs ?? (p.epoch != null ? p.epoch * 1000 : Infinity);
    const reach = (r: { epoch?: number; epochMs?: number }[], cap: number) => (r.length >= cap ? Math.min(...r.map(msP)) : -Infinity);
    const sinceMsTape = Math.max(reach(tapeA, TAPE_N), reach(tapeB, TAPE_N));
    const since = Number.isFinite(sinceMsTape) ? sinceMsTape / 1000 : sinceMsTape;
    /* paged to the session's start (useNameSpreads): a name whose pages did not reach it is cut, with the other, to the
       stretch both cover */
    /* TO THE SECOND, NOT THE MINUTE (audit round 7: "since 16:09 ET" while QQQ's capped pages reached back only to 16:09:57
       and SPY counted the whole minute) — both names are cut at the exact instant the shorter reach starts */
    const msOf = (t: SpreadTrade) => t.epochMs ?? 0;
    const reachMs = (r: SpreadTrade[], done: boolean) => (!done && r.length ? Math.min(...r.map(msOf)) : -Infinity);
    const sinceMs = Math.max(reachMs(spreadsA, spreadsPackA.complete), reachMs(spreadsB, spreadsPackB.complete));
    return {
      tape: [...tapeA, ...tapeB].filter(p => (p.epochMs ?? (p.epoch ?? 0) * 1000) >= sinceMsTape),
      spreads: [...spreadsA, ...spreadsB].filter(t => msOf(t) >= sinceMs),
      since: Number.isFinite(since) ? since : null,
      spreadSinceMs: Number.isFinite(sinceMs) ? sinceMs : null,
    };
  }, [tapeA, tapeB, spreadsA, spreadsB, spreadsPackA.complete, spreadsPackB.complete]);
  /* EACH NAME READS ITS OWN BOOK (2026-10-22): the page's book is the terminal name's — its top contracts plus the
     market's — so the OTHER name stood on whatever of its rows the market page carried: SPY on side B read $509.7M across
     16 contracts where its own book held $946.3M across 80. */
  const bookA = useLiveBook(aTicker).rows;
  const bookB = useLiveBook(bTicker).rows;
  /* each name's day by expiry — the vendor's own net and volume (/stock/{t}/flow-per-expiry) */
  const fpeA = useFlowPerExpiry(aTicker).rows;
  const fpeB = useFlowPerExpiry(bTicker).rows;
  const liveSides = useMemo(() => ({ ...liveNames, bookA: bookA.length ? bookA : book, bookB: bookB.length ? bookB : book, fpeA, fpeB }), [liveNames, bookA, bookB, book, fpeA, fpeB]);
  const frozen = useRef(liveSides);
  if (!hold.paused) frozen.current = liveSides;
  const { tape, spreads, since: tapeSince } = frozen.current;
  const sideBookA = frozen.current.bookA;
  const sideBookB = frozen.current.bookB;
  /* THE NET FLOW READS THE PANES' OWN SERIES (2026-10-22): each pane draws the name's feed minutes
     (/stock/{t}/net-prem-ticks, every expiry); the card summed off the book read SPY −$17.4M beside a pane at +$9.6M.
     Uncut, the card takes the same running totals. The feed's minutes cannot be cut by clock or moneyness, so a cut
     card keeps the book's own figures and says so. */
  const paneA = usePaneFlow({ ticker: aTicker, seg: 'all', mny: 'all', zeroDte: false, enabled: true });
  const paneB = usePaneFlow({ ticker: bTicker, seg: 'all', mny: 'all', zeroDte: false, enabled: true });
  const flowA = paneA.rows;
  const flowB = paneB.rows;
  /* ONE SOURCE FOR EVERY CLOCK (audit round 4, 2026-10-22: uncut, the card took /net-prem-ticks — QQQ net −$53.6M, puts
     +$26.9M — and on Clock = Weekly /flow-per-expiry — QQQ +$51.3M, puts −$53.2M; "net puts" flipped sign between views).
     The two feed routes carry the SAME contracts by side (QQQ's call and put volume at the ask and on the bid match to
     the contract) but not the same put money: the ticks' net_put_premium was +$27.4M where the per-expiry put premium at the
     ask less on the bid summed to −$51.9M, and the day's own prints of $250K and up, by their side tags, net −$106M on
     puts — the per-expiry route agrees with the tape's sides, the ticks do not (on small names the two agree to the
     dollar). So every cut reads /stock/{t}/flow-per-expiry: every expiry summed, or the clock's expiries; the whole day.
     The ticks stay on Net Flow's pane (it needs minutes); where the two disagree the page says so. */
  const uncut = tenor === 'all';
  const ticksOf = (rows: PaneFlowPoint[]) => {
    const lastPt = rows.length ? rows[rows.length - 1] : null;
    return lastPt ? { net: lastPt.callPrem - lastPt.putPrem, calls: lastPt.callPrem, puts: lastPt.putPrem } : null;
  };
  /* ONE SOURCE FOR THE HEADLINE NET (audit round 5, the decision): uncut, the card's net, calls and puts are the vendor's
     minute ticks over the regular session — the same /stock/{t}/net-prem-ticks Net Flow's pane and Intervals read — so
     Trace agrees with itself (round 5: QQQ +$24.1M here by expiry, −$53.6M on its own pane, −$54.9M on Net Flow). Only a
     clock cut needs per-expiry money, and reads the expiry route, labelled so. */
  /* NEVER ANOTHER SOURCE'S FIGURE UNDER THE TICKS' LABEL (audit round 6: for 36s and more "SPY net +$11.8M" — the flow
     by expiry — stood under a header that said the minute ticks, which gave +$4.83M): until the ticks land the net reads
     "…", and "—" if they never answer */
  const withTicks = (side: TraceSide, rows: PaneFlowPoint[], waiting: boolean): TraceSide => {
    if (!uncut) return side;
    const t = ticksOf(rows);
    return t ? { ...side, net: t.net, netCall: t.calls, netPut: t.puts, netSource: 'ticks' } : { ...side, net: 0, netCall: 0, netPut: 0, netSource: 'ticks', netPending: waiting ? 'loading' : 'none' };
  };
  const todayIso = tapeSessionIso();
  const heldFpeA = frozen.current.fpeA;
  const heldFpeB = frozen.current.fpeB;
  const sideA = useMemo(() => withTicks(buildTraceSide(sideBookA, spreads, tape, aTicker, tenor, mny, heldFpeA, todayIso), flowA, paneA.waiting), [sideBookA, spreads, tape, aTicker, tenor, mny, heldFpeA, todayIso, flowA, paneA.waiting, uncut]); // eslint-disable-line react-hooks/exhaustive-deps
  const sideB = useMemo(() => withTicks(buildTraceSide(sideBookB, spreads, tape, bTicker, tenor, mny, heldFpeB, todayIso), flowB, paneB.waiting), [sideBookB, spreads, tape, bTicker, tenor, mny, heldFpeB, todayIso, flowB, paneB.waiting, uncut]); // eslint-disable-line react-hooks/exhaustive-deps
  /* after the close a count of after-hours prints names no busier name (the retail pass, 2026-10-22: "SPY the busier tape
     … 300 prints for $166.2K") — the tape clause and fact stand in the regular session, with their window named */
  /* each print by its own time and flag (traceCompare buildTraceSide): a busier tape is called only when BOTH names have
     regular-session prints in the stretch */
  /* AFTER THE CLOSE NO BUSIER TAPE (audit round 4: "Busier tape SPY · 300 prints since 16:14" meant nothing once the session
     had ended) — the two tapes' last stretches are not the day */
  const afterClose = !!lastRegularClose();
  const regular = !afterClose && sideA.tape.prints > 0 && sideB.tape.prints > 0;
  const afterLeftOut = sideA.tape.after + sideB.tape.after;
  /* the stretch's day named when it is not today's (audit round 6) */
  const sinceDay = tapeSince && nyDateOf(tapeSince * 1000) !== nyIsoToday() ? `${shortDay(nyDateOf(tapeSince * 1000))} ` : '';
  const tapeWords = tapeSince ? `since ${sinceDay}${nyClock(tapeSince * 1000, { zone: true })}` : 'over the same stretch';
  /* the cut in words, for a side with nothing standing on it: "no 0DTE contracts standing" (audit round 7) */
  const clockLabel = CLOCK_OPTIONS.find(o => o.value === tenor)?.label ?? tenor;
  const moneyLabel = MONEY_OPTIONS.find(o => o.value === mny)?.label ?? mny;
  const cutWords = tenor === 'all' && mny === 'all' ? 'on the book' : `on this cut (${[tenor !== 'all' ? clockLabel : '', mny !== 'all' ? moneyLabel : ''].filter(Boolean).join(' · ')})${tenor === 'odte' && !isLiveDay(todayIso) ? ` — ${shortDay(todayIso)}'s same-day contracts expired at its bell` : ''}`;
  const cmp = useMemo(() => buildTraceCompare(sideA, sideB, tapeWords, regular, sameDayWords(todayIso), cutWords), [sideA, sideB, tapeWords, regular, todayIso, cutWords]);
  const { a, b } = cmp;

  /* The first chip follows the frame until it holds a name (the Pinpoint Compare's rule);
     a swap moves the frame when it follows */
  const aFollows = aPick === null;
  const onSwap = () => {
    if (aFollows) changeTicker(bTicker);
    else setAPick(bTicker);
    setBPick(aTicker);
  };
  /* A name in the sentence or a champion is a door onto Net Flow's pane, on this clock */
  const toNetFlow = useCallback((t: string) => navigate('/trace/net-flow', { state: { ticker: t, tenor } }), [navigate, tenor]);

  /* ---- the rows ---------------------------------------------------------------- */
  const higher = (pick: (s: TraceSide) => number): 'a' | 'b' | null => (pick(a) > pick(b) ? 'a' : pick(b) > pick(a) ? 'b' : null);
  const louder = (pick: (s: TraceSide) => number) => higher(s => Math.abs(pick(s)));
  const who = (lead: 'a' | 'b' | null) => (lead === 'a' ? a : lead === 'b' ? b : null);
  /** "SPY the busier" / "the same" */
  const the = (lead: 'a' | 'b' | null, words: string, same = 'the same') => {
    const w = who(lead);
    return w ? `${w.ticker} ${words}` : same;
  };
  const ratio = (pick: (s: TraceSide) => number) => {
    const hi = Math.max(pick(a), pick(b));
    const lo = Math.min(pick(a), pick(b));
    return lo > 0 ? `${(hi / lo).toFixed(1)}×` : null;
  };
  const leanWords = (s: TraceSide) => {
    const l = dayLean({ askPct: s.book.askPct, volume: s.book.volume, sideVol: s.book.side });
    return l.lean === 'ASK' ? 'at the ask' : l.lean === 'BID' ? 'on the bid' : l.lean === 'UNSIDED' ? 'mostly mid / no side' : 'even';
  };
  /* from the report's own date against New York's today (dayWords), never "today" for a past session's */
  const reportWords = (s: TraceSide) => {
    if (s.earnDays == null) return 'not reporting';
    const iso = s.earnIso;
    const d = iso ? daysFromToday(iso) : NaN;
    if (d === 0) return 'reports today';
    if (d === 1) return 'reports tomorrow';
    return `in ${s.earnDays} trading day${s.earnDays === 1 ? '' : 's'}${iso ? ` (${shortDay(iso)})` : ''}`;
  };
  /* Two bearish names have no bullish one — the leader is the less bearish */
  const leansWords = cmp.bullish.net >= 0 ? 'the more bullish' : 'the less bearish';
  /* a net not in hand yet: "…" while the ticks load, "—" if they did not answer */
  const netHeld = !a.netPending && !b.netPending;
  const pend = (s: TraceSide) => (s.netPending === 'loading' ? '…' : '—');
  const nearer = (): 'a' | 'b' | null => {
    if (a.earnDays == null && b.earnDays == null) return null;
    if (a.earnDays == null) return 'b';
    if (b.earnDays == null) return 'a';
    return a.earnDays < b.earnDays ? 'a' : b.earnDays < a.earnDays ? 'b' : null;
  };

  const oiDayTitle = (() => {
    const da = a.interest.day;
    const db = b.interest.day;
    const pend = a.interest.pending && b.interest.pending && isLiveDay(todayIso) ? ` (today's build is counted the morning of ${nextCountDay(todayIso)})` : '';
    const lag = a.interest.lagging + b.interest.lagging;
    const lagWords = lag ? ` · ${num(lag)} contract${lag === 1 ? '' : 's'} still on the count before left out` : '';
    if (da && db && da !== db) return `${a.ticker} ${oiInWords(da)}, ${b.ticker} ${oiInWords(db)}${lagWords}`;
    return `built or unwound ${oiInWords(da ?? db)}${pend}${lagWords}`;
  })();
  /* the other feed route's put money, for the hover only */
  const otherRouteOf = (sd: TraceSide): string => {
    const t = uncut ? (sd.byExpiry ?? null) : ticksOf(sd === a ? flowA : flowB);
    if (!t) return '';
    return uncut ? `the expiry route, the whole day, reads puts ${signedUsd(t.puts)}` : `the minute ticks, 09:30 to the close, read puts ${signedUsd(t.puts)}`;
  };
  const otherRouteHint = `${uncut ? "Net puts here are the feed's minute ticks (/stock/{t}/net-prem-ticks), 09:30 to the close — the figure Net Flow's pane and Intervals show." : "Net puts here are the feed's flow by expiry (/stock/{t}/flow-per-expiry) on the clock's expiries, the whole day — the only route a clock can cut."} The other route: ${a.ticker} ${otherRouteOf(a) || '—'}; ${b.ticker} ${otherRouteOf(b) || '—'}. The two routes carry the same contracts by side, but on names heavy with spreads their put money can disagree, even in sign. Both are summed totals that include spread legs and floor packages.`;

  const sections: { title: string; rows: Row[] }[] = [
    {
      title: `${uncut ? `Net flow · every expiry, the regular session (09:30 to the close${isLiveDay(todayIso) ? '' : `, ${shortDay(todayIso)}`}) — the minute ticks, the figure Net Flow's pane and Intervals show` : `Net flow · the clock's expiries, ${isLiveDay(todayIso) ? 'the whole day' : `${shortDay(todayIso)}, the whole day`} — by expiry` }, premium at the ask less on the bid${mny !== 'all' ? ' · every strike (the money cut is not on this figure)' : ''} · a summed total: spread legs and floor packages are in it`,
      rows: [
        {
          key: 'net',
          label: 'Net premium',
          note: !netHeld ? (a.netPending === 'loading' || b.netPending === 'loading' ? 'the minute ticks are loading…' : 'the minute ticks did not answer') : a.net === b.net ? 'the same lean' : `${cmp.bullish.ticker} leans ${leansWords}`,
          lead: netHeld ? higher(s => s.net) : null,
          bars: s => [{ v: s.netPending ? 0 : s.net, text: s.netPending ? pend(s) : signedUsd(s.net), ink: barInk(s.net) }],
          cell: (s, lit) => (s.netPending ? <Sub>{pend(s)}</Sub> : <Fig lit={lit} ink={dirInk(s.net)}>{signedUsd(s.net)}</Fig>),
        },
        {
          key: 'calls',
          label: 'Net calls',
          note: netHeld ? the(louder(s => s.netCall), 'the louder on calls') : '…',
          lead: netHeld ? louder(s => s.netCall) : null,
          bars: s => [{ v: s.netPending ? 0 : s.netCall, text: s.netPending ? pend(s) : signedUsd(s.netCall), ink: barInk(s.netCall) }],
          cell: (s, lit) => (s.netPending ? <Sub>{pend(s)}</Sub> : <Fig lit={lit} ink={dirInk(s.netCall)}>{signedUsd(s.netCall)}</Fig>),
        },
        /* ONE FIGURE ON THE CARD (retail, round 7: "Net puts +$26.9M" beside "By expiry … puts −$51.9M — QQQ puts flip sign
           by route" destroyed trust): the card shows the one source its cut reads — the minute ticks uncut, the expiry route
           under a clock — and the other route's figure sits in this row's hover, with why the two can differ */
        {
          key: 'puts',
          label: 'Net puts',
          note: netHeld ? the(louder(s => s.netPut), 'the louder on puts') : '…',
          lead: netHeld ? louder(s => s.netPut) : null,
          hint: otherRouteHint,
          bars: s => [{ v: s.netPending ? 0 : s.netPut, text: s.netPending ? pend(s) : signedUsd(s.netPut), ink: putInk(s.netPut), desc: otherRouteOf(s) }],
          cell: (s, lit) => (s.netPending ? <Sub>{pend(s)}</Sub> : <Fig lit={lit} ink={putDirInk(s.netPut)}>{signedUsd(s.netPut)}</Fig>),
        },
      ],
    },
    {
      title: `Same-day money · contracts ${sameDayWords(todayIso)}, every strike — by expiry (the feed's expiry route)`,
      rows: [
        {
          key: 'odte',
          label: 'Same-day net',
          note: a.odte.net === b.odte.net ? 'the same lean' : `${(a.odte.net > b.odte.net ? a : b).ticker} ${Math.max(a.odte.net, b.odte.net) >= 0 ? 'the more bullish' : 'the less bearish'}`,
          lead: higher(s => s.odte.net),
          bars: s => [{ v: s.odte.net, text: signedUsd(s.odte.net), ink: barInk(s.odte.net) }],
          cell: (s, lit) => <Fig lit={lit} ink={dirInk(s.odte.net)}>{signedUsd(s.odte.net)}</Fig>,
        },
        {
          key: 'odteSides',
          label: 'Same-day calls · puts',
          note: `net calls · net puts, ${sameDayWords(todayIso)}`,
          lead: null,
          bars: s => [
            { v: s.odte.calls, text: signedUsd(s.odte.calls), ink: barInk(s.odte.calls), name: 'Same-day net calls', desc: `at the ask less on the bid, ${sameDayWords(todayIso)}` },
            { v: s.odte.puts, text: signedUsd(s.odte.puts), ink: putInk(s.odte.puts), name: 'Same-day net puts', desc: `bought lean bearish — ${sameDayWords(todayIso)}` },
          ],
          cell: s => (
            <>
              <Fig lit={false} ink={dirInk(s.odte.calls)}>{signedUsd(s.odte.calls)}</Fig>
              <Sub>·</Sub>
              <Fig lit={false} ink={putDirInk(s.odte.puts)}>{signedUsd(s.odte.puts)}</Fig>
            </>
          ),
        },
        {
          key: 'odteVol',
          label: 'Same-day volume',
          note: the(higher(s => s.odte.vol), 'the busier'),
          lead: higher(s => s.odte.vol),
          bars: s => [{ v: s.odte.vol, text: num(s.odte.vol), ink: 'silver', after: `${num(s.odte.trades)} prints` }],
          cell: (s, lit) => (
            <>
              <Fig lit={lit}>{num(s.odte.vol)}</Fig>
              <Sub>· {num(s.odte.trades)} prints</Sub>
            </>
          ),
        },
      ],
    },
    {
      title: `The book · each name's standing contracts with the most premium (up to 80) — floor packages, spread legs and crosses left out${a.book.apart.count || b.book.apart.count ? ` (${a.ticker} ${num(a.book.apart.count)} · ${fmtUsd(a.book.apart.premium)}, ${b.ticker} ${num(b.book.apart.count)} · ${fmtUsd(b.book.apart.premium)})` : ''}: legs of packages, not bets`,
      rows: [
        {
          key: 'count',
          label: 'Contracts on the book',
          note: the(higher(s => s.book.count), 'spread over more contracts'),
          lead: higher(s => s.book.count),
          bars: s => [{ v: s.book.count, text: num(s.book.count), ink: 'silver' }],
          cell: (s, lit) => <Fig lit={lit}>{num(s.book.count)}</Fig>,
        },
        {
          key: 'volume',
          label: 'Volume',
          note: (() => {
            const l = higher(s => s.book.volume);
            const r = ratio(s => s.book.volume);
            return l && r ? `${who(l)!.ticker} ${r} the volume` : the(l, 'the more traded');
          })(),
          lead: higher(s => s.book.volume),
          bars: s => [{ v: s.book.volume, text: num(s.book.volume), ink: 'silver' }],
          cell: (s, lit) => <Fig lit={lit}>{num(s.book.volume)}</Fig>,
        },
        {
          key: 'premium',
          label: 'Premium',
          note: the(higher(s => s.book.premium), 'the heavier premium'),
          lead: higher(s => s.book.premium),
          bars: s => [{ v: s.book.premium, text: fmtUsd(s.book.premium), ink: 'silver' }],
          cell: (s, lit) => <Fig lit={lit}>{fmtUsd(s.book.premium)}</Fig>,
        },
        {
          key: 'split',
          label: 'Calls · puts',
          note: the(higher(s => s.book.callShare), 'the more call-heavy', 'the same split'),
          lead: null,
          bars: s => [
            { v: s.book.callShare, text: `${s.book.callShare}%`, ink: 'bull', name: 'Calls', desc: 'of the volume' },
            { v: 100 - s.book.callShare, text: `${100 - s.book.callShare}%`, ink: 'bear', name: 'Puts', desc: 'of the volume' },
          ],
          cell: s => (
            <>
              <Fig lit={false} ink="text-bull">{s.book.callShare}%</Fig>
              <Sub>·</Sub>
              <Fig lit={false} ink="text-bear">{100 - s.book.callShare}%</Fig>
            </>
          ),
        },
        {
          key: 'lean',
          label: 'Lean',
          note: leanWords(a) === leanWords(b) ? `both ${leanWords(a)}` : `${a.ticker} ${leanWords(a)}, ${b.ticker} ${leanWords(b)}`,
          lead: null,
          cell: s => <LeanCell askPct={s.book.askPct} split={s.book.side} />,
        },
        {
          key: 'swept',
          label: 'Swept',
          note: the(higher(s => s.book.sweptPct), 'the more swept'),
          lead: higher(s => s.book.sweptPct),
          bars: s => [{ v: s.book.sweptPct, text: `${s.book.sweptPct}%`, ink: 'silver' }],
          cell: (s, lit) => <Fig lit={lit}>{s.book.sweptPct}%</Fig>,
        },
        {
          key: 'iv',
          /* SAID AS IT IS (audit round 8: "past today" over a 0DTE cut whose every contract expires today) */
          label: a.book.ivLater || b.book.ivLater ? `Implied vol · past ${isLiveDay(todayIso) ? 'today' : shortDay(todayIso)}` : `Implied vol · ${isLiveDay(todayIso) ? "today's" : `${shortDay(todayIso)}'s`} expiry`,
          note: the(higher(s => s.book.iv), 'the richer'),
          lead: higher(s => s.book.iv),
          bars: s => [{ v: s.book.iv, text: `${s.book.iv}%`, ink: 'silver' }],
          cell: (s, lit) => <Fig lit={lit}>{s.book.iv}%</Fig>,
        },
        {
          key: 'built',
          label: 'Vol ≥ 1.5× OI',
          note: a.book.builtToday === 0 && b.book.builtToday === 0 ? 'none at 1.5× its interest' : the(higher(s => s.book.builtToday), 'the more'),
          lead: higher(s => s.book.builtToday),
          bars: s => [{ v: s.book.builtToday, text: num(s.book.builtToday), ink: 'silver', after: 'contracts' }],
          cell: (s, lit) => (
            <>
              <Fig lit={lit}>{num(s.book.builtToday)}</Fig>
              <Sub>contracts</Sub>
            </>
          ),
        },
      ],
    },
    {
      /* WHOSE TRADING (audit round 7): the change of the newest published count — "OI after Oct 22's trading" — both names
         on the same day, or each says its own */
      title: `Footprints · open interest on those contracts, ${oiDayTitle}${a.interest.apartCount || b.interest.apartCount ? ` — the book's bets only; floor packages, spread legs and crosses left out (${a.ticker} ${num(a.interest.apartCount)}, ${b.ticker} ${num(b.interest.apartCount)})` : ''}`,
      rows: [
        {
          key: 'added',
          label: 'Interest added',
          note: the(higher(s => s.interest.added), `added the more ${oiInWords(a.interest.day ?? b.interest.day)}`),
          lead: higher(s => s.interest.added),
          bars: s => [{ v: s.interest.added, text: s.interest.added > 0 ? `+${num(s.interest.added)}` : '0', ink: s.interest.added > 0 ? 'bull' : 'mute' }],
          cell: (s, lit) => (
            <Fig lit={lit} ink={s.interest.added > 0 ? 'text-bull' : 'text-textMuted'}>
              {s.interest.added > 0 ? `+${num(s.interest.added)}` : '0'}
            </Fig>
          ),
        },
        {
          key: 'shed',
          label: 'Interest shed',
          note: the(higher(s => -s.interest.shed), 'shed the more'),
          lead: higher(s => -s.interest.shed),
          bars: s => [{ v: s.interest.shed, text: s.interest.shed < 0 ? `−${num(-s.interest.shed)}` : '0', ink: s.interest.shed < 0 ? 'bear' : 'mute' }],
          cell: (s, lit) => (
            <Fig lit={lit} ink={s.interest.shed < 0 ? 'text-bear' : 'text-textMuted'}>
              {s.interest.shed < 0 ? `−${num(-s.interest.shed)}` : '0'}
            </Fig>
          ),
        },
      ],
    },
    {
      /* THE WINDOW SAID (audit round 6: "Structures 80 · the same" was the fetch cap) */
      title: `Structures · each name's on the ${shortDay(todayIso)} session${frozen.current.spreadSinceMs != null ? `, since ${nyClock(frozen.current.spreadSinceMs, { seconds: true, zone: true})} — the stretch both names' last ${SPREADS_N * 3} cover, both cut at that second` : spreadsDone ? ', the whole session' : ''} · regular hours only, compression packages left out${mny !== 'all' ? ' · every strike (the money cut is not on this list)' : ''}`,
      rows: [
        {
          key: 'structures',
          label: 'Structures',
          note: the(higher(s => s.structures.count), 'the more structures'),
          lead: higher(s => s.structures.count),
          bars: s => [{ v: s.structures.count, text: num(s.structures.count), ink: 'silver' }],
          cell: (s, lit) => <Fig lit={lit}>{num(s.structures.count)}</Fig>,
        },
        {
          key: 'paid',
          label: 'Paid · collected',
          note: 'debits paid against credits collected',
          lead: null,
          bars: s => [
            { v: s.structures.paid, text: String(s.structures.paid), ink: 'bull', name: 'Paid', desc: 'structures put on for a debit' },
            { v: s.structures.collected, text: String(s.structures.collected), ink: 'bear', name: 'Collected', desc: 'structures put on for a credit' },
          ],
          cell: s => (
            <>
              <Fig lit={false} ink="text-bull">{s.structures.paid}</Fig>
              <Sub>·</Sub>
              <Fig lit={false} ink="text-bear">{s.structures.collected}</Fig>
            </>
          ),
        },
        {
          key: 'structDollars',
          label: 'Structure net $',
          note: the(higher(s => s.structures.dollars), 'the more net premium in structures'),
          lead: higher(s => s.structures.dollars),
          bars: s => [{ v: s.structures.dollars, text: fmtUsd(s.structures.dollars), ink: 'silver' }],
          cell: (s, lit) => <Fig lit={lit}>{fmtUsd(s.structures.dollars)}</Fig>,
        },
      ],
    },
    {
      /* both names over the same reach of their own tapes — the title says from when */
      title: `${tapeSince ? `The tape · each name's prints since ${sinceDay}${nyClock(tapeSince * 1000, { seconds: true, zone: true})} — the stretch both names' last ${TAPE_N} prints cover` : `The tape · each name's last ${TAPE_N} prints`}${afterLeftOut > 0 ? ` · regular-session prints only, ${num(afterLeftOut)} after-hours ${afterLeftOut === 1 ? 'print' : 'prints'} left out` : ''}${regular ? '' : afterClose ? ' — the session has closed, so no busier tape is called' : ' — one name has no regular-session print in the stretch, so no busier tape is called'}`,
      rows: [
        {
          key: 'prints',
          label: 'Prints',
          note: regular ? the(higher(s => s.tape.prints), 'the busier tape') : afterClose ? "not compared — the session has closed; each name's last prints are not its day" : 'not compared — no regular-session prints on both',
          lead: regular ? higher(s => s.tape.prints) : null,
          bars: s => [{ v: s.tape.prints, text: num(s.tape.prints), ink: 'silver' }],
          cell: (s, lit) => <Fig lit={lit}>{num(s.tape.prints)}</Fig>,
        },
        {
          key: 'tapeDollars',
          label: 'Tape dollars',
          note: regular ? the(higher(s => s.tape.dollars), 'the more money on the tape') : 'not compared',
          lead: regular ? higher(s => s.tape.dollars) : null,
          /* no print in the stretch is no figure, not "$0" */
          bars: s => [{ v: s.tape.dollars, text: s.tape.prints ? fmtUsd(s.tape.dollars) : '—', ink: 'silver' }],
          cell: (s, lit) => <Fig lit={lit}>{s.tape.prints ? fmtUsd(s.tape.dollars) : '—'}</Fig>,
        },
        {
          key: 'sweeps',
          label: 'Sweeps',
          note: regular ? the(higher(s => s.tape.sweeps), 'the more sweeps') : 'not compared',
          lead: regular ? higher(s => s.tape.sweeps) : null,
          bars: s => [{ v: s.tape.sweeps, text: num(s.tape.sweeps), ink: 'silver' }],
          cell: (s, lit) => <Fig lit={lit}>{num(s.tape.sweeps)}</Fig>,
        },
      ],
    },
    {
      title: 'The calendar',
      rows: [
        {
          key: 'earnings',
          label: 'Earnings',
          note: (() => {
            const l = nearer();
            if (a.earnDays == null && b.earnDays == null) return 'neither reports soon';
            if (a.earnDays == null || b.earnDays == null) return `${who(l)!.ticker} alone reports`;
            return l ? `${who(l)!.ticker} reports first` : 'the same session';
          })(),
          lead: nearer(),
          cell: (s, lit) => <Fig lit={lit}>{reportWords(s)}</Fig>,
        },
      ],
    },
  ];

  /* ---- the sentence: the names are doors ---------------------------------------- */
  const sentence = cmp.parts.map((p, i) =>
    typeof p === 'string' ? (
      <RichRead key={i} text={p} />
    ) : (
      <ReadDoor key={i} onOpen={() => toNetFlow(p.name)} title={`${p.name} on Net Flow's pane`}>
        {p.name}
      </ReadDoor>
    )
  );

  /* THE CARD'S COLUMNS ON A PHONE (the phone pass, 2026-09-13): the fact's
     250px middle left the two figures 30px each at 390 and they ran off both
     edges; a 112px middle (the label and its note truncate) gives each side
     ~110px, which the figures need. */
  const narrow = useIsBelowXl();
  /* ON A PHONE THE CARD IS TWO LINES A ROW (the device sweep, 2026-10-18: at 360 and 390 the three columns left each
     wing 68 to 83px and the capsules could not be read): the fact with its verdict on top, the two capsules under it
     either side of a hairline spine, the head's "against" gone for the same hairline */
  const phone = useIsPhone();
  const columns = phone ? 'minmax(0,1fr) 2px minmax(0,1fr)' : narrow ? 'minmax(0,1fr) 112px minmax(0,1fr)' : CMP_COLUMNS;
  const gutter = phone ? 'mx-3' : 'mx-5';

  /* ---- the lists under the rows ---------------------------------------------------- */
  /* FLOOR PACKAGES STAND APART (audit round 5: "QQQ's heaviest contracts" crowned QQQ 740P $49.0M, 99% floor-traded
     packages): the bets ranked by dollars, then the packages among the heaviest, each labelled — not a bet */
  const listOf = (rows: BookContract[]) => {
    const top = rows.slice(0, CMP_LISTED + 3);
    return [...rows.filter(r => !notABet(r)).slice(0, CMP_LISTED), ...top.filter(r => notABet(r)).slice(0, 2)];
  };
  const listed = useMemo(() => [...listOf(a.rows), ...listOf(b.rows)], [a.rows, b.rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const kindOf = (t: SpreadTrade) => SPREAD_KINDS.find(k => k.key === t.kind)?.label ?? t.kind;

  const Lists = ({ s, side }: { s: TraceSide; side: 'a' | 'b' }) => (
    <div className="min-w-0" data-compare-lists={side}>
      {/* THE HEAVIEST CONTRACTS — by dollars, a row opens the card */}
      <div className="px-5 flex items-center gap-2 border-b border-borderSubtle/60 paper-band" style={{ height: CMP_LIST_HEAD_H }}>
        <CompanyLogo ticker={s.ticker} size={14} />
        <span className="text-[12px] font-semibold text-textPrimary whitespace-nowrap">{s.ticker}'s heaviest contracts</span>
        <span className="text-[10.5px] text-textMuted break-words sm:whitespace-nowrap sm:truncate">· by dollars · packages &amp; spread legs apart · a row opens the card</span>
      </div>
      {listOf(s.rows).map(r => (
        <button
          key={r.key}
          type="button"
          onClick={() => setOpenKey(openKey === r.key ? null : r.key)}
          /* On a phone the row keeps the contract, the dollars and the lean; the days and the volume go (the phone pass, 2026-09-13) */
          className={`w-full px-5 grid grid-cols-[minmax(0,1fr)_40px_76px_84px_64px] max-sm:grid-cols-[minmax(0,1fr)_76px_64px] items-center gap-x-3 border-b border-borderSubtle/40 text-left transition-colors ${openKey === r.key ? 'bg-silver/[0.06]' : 'hover:bg-silver/[0.04]'}`}
          style={{ height: CMP_LIST_ROW_H }}
          data-compare-contract={r.key}
        >
          <span className="min-w-0 flex items-center gap-1.5">
            <ContractCell strike={r.strike} right={r.right} expiry={r.expiry} />
            {floorPackaged(r) ? (
              <span className="font-mono text-[9.5px] uppercase text-warn whitespace-nowrap" title={`${Math.round(r.floorPct)}% of its day traded on the floor and ${Math.round(r.multiPct)}% in multi-leg packages — the shape of compression, which nets open interest down: not a bet, so not ranked`}>
                floor pkg
              </span>
            ) : notABet(r) ? (
              <span className="font-mono text-[9.5px] uppercase text-warn whitespace-nowrap" title={`${notABetHint(r)} — not ranked`}>
                {r.multiPct >= 50 ? 'spread legs' : 'a cross'}
              </span>
            ) : stockLike(r) ? (
              <span className="font-mono text-[9.5px] uppercase text-warn whitespace-nowrap" title={STOCK_LIKE_HINT}>
                stock-like
              </span>
            ) : null}
          </span>
          <span className="font-mono text-[10px] tnum text-textMuted text-right max-sm:hidden">{r.dte}d</span>
          <span className="font-mono text-[12px] tnum font-semibold text-textPrimary text-right">{fmtUsd(r.premium)}</span>
          <span className="font-mono text-[10.5px] tnum text-textSecondary text-right whitespace-nowrap max-sm:hidden">{num(r.volume)} vol</span>
          <span className="flex justify-end">
            <LeanCell askPct={r.askPct} split={r.sideVol} legsPct={r.multiPct} crossPct={r.crossPct} />
          </span>
        </button>
      ))}
      {s.rows.length === 0 && (
        <div className="px-5 flex items-center font-mono text-[10px] uppercase tracking-widest text-textMuted" style={{ height: CMP_LIST_ROW_H }}>
          Nothing on this cut
        </div>
      )}
      {/* THE STRUCTURES — the tape reconstructed, heaviest first */}
      <div className="px-5 flex items-center gap-2 border-y border-borderSubtle/60 paper-band" style={{ height: CMP_LIST_HEAD_H }}>
        <CompanyLogo ticker={s.ticker} size={14} />
        <span className="text-[12px] font-semibold text-textPrimary whitespace-nowrap">{s.ticker}'s structures</span>
        <span className="text-[10.5px] text-textMuted break-words sm:whitespace-nowrap sm:truncate" title={mny !== 'all' ? "A structure's legs sit at several strikes, on both sides of the stock — the money cut is not applied to this list; the clock cut is, by the near leg" : undefined}>· the tape reconstructed · the most net premium first{mny !== 'all' ? ' · every strike — the money cut is not on this list' : ''}</span>
      </div>
      {s.structures.list.slice(0, CMP_LISTED).map(t => (
        <div
          key={t.id}
          /* On a phone: the kind, the strikes and the dollars; the expiry and the debit/credit go */
          className="px-5 grid grid-cols-[96px_minmax(0,1fr)_120px_96px_76px] max-sm:grid-cols-[96px_minmax(0,1fr)_76px] items-center gap-x-3 border-b border-borderSubtle/40 hover:bg-silver/[0.04] transition-colors"
          style={{ minHeight: CMP_LIST_ROW_H }}
          data-compare-structure={t.id}
          title={SPREAD_KINDS.find(k => k.key === t.kind)?.read}
        >
          <span className="text-[11.5px] font-semibold text-textPrimary whitespace-nowrap">{kindOf(t)}</span>
          <span className="font-mono text-[12px] tnum font-semibold text-textPrimary break-words sm:whitespace-nowrap sm:truncate">{t.strikesLabel}</span>
          <span className="font-mono text-[10px] tnum text-textMuted whitespace-nowrap max-sm:hidden" title={t.farExpiry ? `Two expiries: the near leg ${t.expiry} (${t.dte}d), the far leg ${t.farExpiry} (${t.farDte}d)` : undefined}>
            {t.farExpiry ? `${t.expiry.slice(0, 5)}–${t.farExpiry.slice(0, 5)} · ${t.dte}–${t.farDte}d` : `${t.expiry} · ${t.dte}d`}
          </span>
          <span className="font-mono text-[11px] tnum text-right whitespace-nowrap max-sm:hidden">
            {/* paid or collected is a fact, not a lean — the Multi-Leg page's neutral ink; a structure the vendor priced no net
                for says nothing rather than "$0.00 debit" */}
            {t.net === 0 ? <span className="text-textMuted">{t.legsState === 'pending' && t.netKnown !== false ? '…' : '—'}</span> : <><span className="text-textPrimary">{t.units != null && t.units > 1 ? `${t.units}× ` : ''}${Math.abs(t.net).toFixed(2)}</span> <span className="text-textSecondary">{t.net > 0 ? 'debit' : 'credit'}</span></>}
          </span>
          <span className="font-mono text-[12px] tnum font-semibold text-textPrimary text-right" title={`${fmtUsd(t.premium)} across every leg`}>{t.netKnown === false ? '—' : fmtUsd(Math.abs(t.netPremium))}</span>
        </div>
      ))}
      {s.structures.list.length === 0 && (
        <div className="px-5 flex items-center font-mono text-[10px] uppercase tracking-widest text-textMuted" style={{ height: CMP_LIST_ROW_H }}>
          No structures on this cut {isLiveDay(todayIso) ? 'today' : `on ${shortDay(todayIso)}`}
        </div>
      )}
    </div>
  );

  return (
    <TraceBox
      title="Two names, side by side"
      sub="Net flow, the same-day money, the book, the footprints, the structures and the tape — the first name against the second · pick either name, swap them, cut them to one clock"
      testId="compare"
      data={{ a: aTicker, b: bTicker, clock: tenor, money: mny }}
      guide={{ title: 'How to read the card', door: 'What the rows, the panes and the lists mean', body: <CompareGuide />, testId: 'compare-guide', open: guideOpen, onOpen: setGuideOpen }}
      facts={
        bookState !== 'in' ? (
          <>
            <Fact label={`${aTicker} net`} testId="a-net">
              <span className="text-textMuted">—</span>
            </Fact>
            <Fact label={`${bTicker} net`} testId="b-net">
              <span className="text-textMuted">—</span>
            </Fact>
          </>
        ) : (
        <>
          <Fact label={`${a.ticker} net`} testId="a-net" title={a.netSource === 'ticks' ? "Net premium over the regular session — the minute ticks, the figure Net Flow's pane and Intervals show. A summed total: spread legs and floor packages are in it" : "Net premium on the clock's expiries, the whole day — by expiry (the expiry route). A summed total: spread legs and floor packages are in it"}>
            {a.netPending ? <span className="text-textMuted">{pend(a)}</span> : <span className={dirInk(a.net)}>{signedUsd(a.net)}</span>}
          </Fact>
          <Fact label={`${b.ticker} net`} testId="b-net" title={b.netSource === 'ticks' ? "Net premium over the regular session — the minute ticks, the figure Net Flow's pane and Intervals show. A summed total: spread legs and floor packages are in it" : "Net premium on the clock's expiries, the whole day — by expiry (the expiry route). A summed total: spread legs and floor packages are in it"}>
            {b.netPending ? <span className="text-textMuted">{pend(b)}</span> : <span className={dirInk(b.net)}>{signedUsd(b.net)}</span>}
          </Fact>
          <Fact label={`${isLiveDay(todayIso) ? 'Expiring today' : `Expired ${shortDay(todayIso)}`} · net`} testId="same-day" title={`Net call premium less net put premium on each name's contracts ${sameDayWords(todayIso)} — by expiry (the expiry route), the whole day`}>
            <span className={dirInk(a.odte.net)}>{a.odte.has ? signedUsd(a.odte.net) : '—'}</span> <span className="text-textMuted">·</span> <span className={dirInk(b.odte.net)}>{b.odte.has ? signedUsd(b.odte.net) : '—'}</span>
          </Fact>
          <Champion label={`Leans ${leansWords}`} ink={cmp.bullish.net >= 0 ? 'bull' : 'bear'} onOpen={() => toNetFlow(cmp.bullish.ticker)} testId="bullish">
            {netHeld ? <>{cmp.bullish.ticker} · {signedUsd(cmp.bullish.net)}</> : <span className="text-textMuted">…</span>}
          </Champion>
          {cmp.heavier ? (
            <Champion label="Heavier premium" ink="supreme" title={`The name with more premium across its standing contracts with the most premium (up to 80), floor packages, spread legs and crosses left out (${a.ticker} ${num(a.book.apart.count)} for ${fmtUsd(a.book.apart.premium)}, ${b.ticker} ${num(b.book.apart.count)} for ${fmtUsd(b.book.apart.premium)}) — put it on Net Flow's pane`} onOpen={() => toNetFlow(cmp.heavier!.ticker)} testId="heavier">
              {cmp.heavier.ticker} · {fmtUsd(cmp.heavier.book.premium)}
            </Champion>
          ) : (
            <Fact label="Heavier premium" testId="heavier" title={`Neither name has a contract standing ${cutWords}`}>
              <span className="text-textMuted">none standing</span>
            </Fact>
          )}
          {regular && (
            <Fact label="Busier tape" testId="busier" title={tapeSince ? `Regular-session prints (each by its own time and flag) since ${nyClock(tapeSince * 1000, { seconds: true, zone: true})} — the stretch both names' last ${TAPE_N} prints cover` : `Each name's last ${TAPE_N} prints`}>
              {/* each name's own last prints over the window both cover — neither with a print is "no print", not a winner */}
              {!cmp.busier ? (
                a.tape.prints === 0 ? <span className="text-textMuted">—</span> : <span title="Both names printed the same number of regular-session prints over the same stretch">level <span className="text-textMuted">·</span> {num(a.tape.prints)} prints each{tapeSince ? ` since ${sinceDay}${nyClock(tapeSince * 1000)}` : ''}</span>
              ) : cmp.busier.tape.prints === 0 ? <span className="text-textMuted">—</span> : (() => {
                /* PLAIN WORDS (audit round 9: "300 prints since 13:10 · 120.6/s"): how many prints, over how long, and the
                   other name's count beside it */
                const other = cmp.busier === a ? b : a;
                const sec = cmp.busier.tape.lastMs && tapeSince ? (Math.max(a.tape.lastMs ?? 0, b.tape.lastMs ?? 0) - tapeSince * 1000) / 1000 : 0;
                const span = sec >= 1 ? (sec < 90 ? `the last ${Math.round(sec)} seconds` : `the last ${Math.round(sec / 60)} minutes`) : null;
                return (
                  <>
                    {cmp.busier.ticker} <span className="text-textMuted">·</span> {num(cmp.busier.tape.prints)} prints{span ? ` in ${span}` : tapeSince ? ` since ${sinceDay}${nyClock(tapeSince * 1000)}` : ''}
                    <span className="text-textMuted"> · {other.ticker} {num(other.tape.prints)}</span>
                  </>
                );
              })()}
            </Fact>
          )}
        </>
        )
      }
      controls={
        <>
          <LiveHold paused={hold.paused} onToggle={hold.toggle} heldAt={hold.heldAt} waitingFirst={hold.waitingFirst} />
          {/* (round 7: the first chip's chevron wrapped onto a line of its own at 390 — the pre-market / after-hours move, the
              chip's third figure, is left off on a phone; the hover still says it) */}
          {/* On a phone's two-column cards line the pair takes the whole row (the phone pass, 2026-09-13); a chip wider than
              the row (a name's last-session change and its pre-market move) wraps inside itself rather than run off the card */}
          <span className="flex items-center gap-1.5 max-sm:col-span-2 max-sm:flex-wrap max-sm:gap-y-2 [&_[data-scope]]:shrink-0 max-sm:[&_[data-scope]]:shrink max-sm:[&_[data-scope]]:max-w-[calc(100%-1rem)] max-sm:[&_[data-scope]]:h-auto max-sm:[&_[data-scope]]:min-h-6 max-sm:[&_[data-scope-pick]]:flex-wrap max-sm:[&_[data-scope-pick]]:py-1 max-sm:[&_[data-scope-pick]]:gap-y-1 max-sm:[&_[data-scope-ext]]:hidden" data-compare-names>
            {/* EACH LETTER STAYS WITH ITS CHIP (audit round 8, 390: "B" wrapped away from its name) */}
            <span className="inline-flex items-center gap-1.5 min-w-0 max-sm:flex-1" data-compare-pair="a">
            <span className="font-mono text-[9px] uppercase tracking-widest text-textMuted shrink-0">A</span>
            {/* The two chips wear the same clothes (Noah, 2026-09-09): the first in the full following look
                with its silver link, the second its own name with no link at all */}
            <ScopeChip ticker={aTicker} linked={aFollows} full quote closeOutside onToggleLink={() => setAPick(aFollows ? aTicker : null)} onPick={next => (aFollows ? changeTicker(next) : setAPick(next))} />
            </span>
            <button
              type="button"
              onClick={onSwap}
              title="Swap the two names"
              aria-label="Swap the two names"
              className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] transition-colors"
              data-compare-swap
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
            </button>
            <span className="inline-flex items-center gap-1.5 min-w-0 max-sm:w-full max-sm:pr-9" data-compare-pair="b">
            <span className="font-mono text-[9px] uppercase tracking-widest text-textMuted shrink-0">B</span>
            <ScopeChip ticker={bTicker} quote closeOutside onPick={next => setBPick(next)} title="The second name — pick another" />
            </span>
          </span>
          {/* The two cuts as labelled cards — ONE pair for both names */}
          <DropdownSelect label="Clock" value={tenor} options={CLOCK_OPTIONS} onChange={setTenor} title="How far out the contracts run — both names" testId="compare-clock" />
          <DropdownSelect label="Money" value={mny} options={MONEY_OPTIONS} onChange={setMny} title="Which strikes against the stock — both names" testId="compare-money" />
        </>
      }
      sentence={null}
      /* ONE PLAIN LINE (retail, round 11): each name's day in dollars and which way it leaned — the full read behind "more" */
      lead={bookState === 'reading' ? "Reading the day's book." : bookState === 'down' ? 'This read did not land — the two names fill when the feed answers.' : `${a.ticker} traded ${fmtUsd(a.book.premium)} in options, net ${a.netPending ? '…' : `${a.net >= 0 ? '+' : '−'}${fmtUsd(Math.abs(a.net))}`} into calls over puts; ${b.ticker} ${fmtUsd(b.book.premium)}, net ${b.netPending ? '…' : `${b.net >= 0 ? '+' : '−'}${fmtUsd(Math.abs(b.net))}`}.`}
      detail={bookState === 'in' ? (
          <>
            {sentence}
            <TermLine keys={['standing', 'floor', 'spreadLegs', 'volOi', 'oiDay', 'stockLike']} testId="compare" />
          </>
        ) : null}
    >
      {bookState !== 'in' ? (
        <div className="border-t border-borderSubtle h-40 flex items-center justify-center font-mono text-[11px] uppercase tracking-widest text-textMuted" data-compare-empty>
          {bookState === 'reading' ? 'Reading the day’s book' : 'This read did not land'}
        </div>
      ) : (
        <>
      {/* THE PANES — each name through the session, on the page's one cut */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2 border-t border-borderSubtle p-2" data-compare-panes>
        {[a, b].map((s, i) => (
          <div key={`${i}-${s.ticker}`} style={{ height: CMP_PANE_H }} className="min-w-0" data-compare-pane={i === 0 ? 'a' : 'b'}>
            <NetFlowPane book={book} seg="all" mny={mny} onSeg={() => {}} onMny={setMny} tick={tick} ticker={s.ticker} tenor={tenor} onTenor={setTenor} dteMax={Infinity} cutCards={false} uncutNote={tenor !== 'all' || mny !== 'all' ? `every expiry, every strike — the ${[tenor !== 'all' ? 'clock' : '', mny !== 'all' ? 'money' : ''].filter(Boolean).join(' and ')} cut does not reach the minute ticks` : undefined} />
          </div>
        ))}
      </div>

      {/* THE CARD — the first name's figure at the left, the fact in the middle with what the two say
          against each other under it, the second name's at the right; the leading figure lit */}
      <div ref={cardRef} className="border-t border-borderSubtle pt-1 pb-2 paper-inset" data-compare-card data-compare-focus={pinned ? '' : undefined} data-compare-wing={wingW}>
        <div className={`${gutter} grid items-center ${phone ? 'gap-x-2' : 'gap-x-4'}`} style={{ gridTemplateColumns: columns, height: CMP_SECTION_H }}>
          <span className="flex items-center justify-end gap-1.5" data-compare-head="a">
            <CompanyLogo ticker={a.ticker} size={14} />
            <span className="font-mono text-[11px] font-bold text-textPrimary">{a.ticker}</span>
          </span>
          {/* THE SPINE (Noah, 2026-09-19, the light sweep: "i cant make out of any borders and too much blinding white for the
              side by side comparision"): the middle column stands on the inset ground with an edge each side, all the way
              down. THE GROUNDS ARE TURNED ROUND: the two names sit on the soft inset ground and the SPINE is the panel's
              white — the one bright column is the narrow one that holds the words, not the two wide wings; the sections
              are bands of the ink's wash. ALL OF IT IS PAPER-ONLY (index.css `paper-*`): on the dark terminal not a pixel moves —
              the first cut used ordinary classes and laid faint bands and a darker ground on the dark page too. */}
          <span className={`self-stretch flex items-center justify-center paper-panel paper-edge-x font-mono text-[9px] uppercase tracking-widest text-textMuted ${phone ? 'bg-borderSubtle/60' : ''}`} data-compare-spine>
            {phone ? '' : 'against'}
          </span>
          <span className="flex items-center gap-1.5" data-compare-head="b">
            <CompanyLogo ticker={b.ticker} size={14} />
            <span className="font-mono text-[11px] font-bold text-textPrimary">{b.ticker}</span>
            {/* The ladder's why: whose row it is and how to let go */}
            <span className={`ml-auto font-mono text-[8px] uppercase tracking-widest whitespace-nowrap max-sm:hidden ${pinned ? 'text-textSecondary' : 'text-textMuted'}`} data-compare-why>
              {pinned ? 'in focus · click anywhere outside to let go' : 'click a row to keep it'}
            </span>
          </span>
        </div>
        <div className="relative">
          {/* THE FOCUS SCRIM — one layer for the blur and the dim; only its opacity animates (the ladder's own) */}
          <div
            aria-hidden
            data-compare-scrim={pinned ? '' : undefined}
            className={`pointer-events-none absolute inset-0 z-20 transition-opacity duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${pinned ? 'opacity-100' : 'opacity-0'}`}
            /* the scrim is the PANEL at 66% — black over the dark terminal as it always was, paper over paper (it was a typed black: a grey veil on white) */
            style={{ backdropFilter: `blur(${scrim ? 3 : 0}px)`, WebkitBackdropFilter: `blur(${scrim ? 3 : 0}px)`, background: 'rgb(var(--panel) / 0.66)' }}
          />
        {sections.map(sec => (
          <Fragment key={sec.title}>
            {/* The section's name in the primary ink (Noah, 2026-09-13: "this section should have white font") */}
            <div className={`${gutter} flex items-center border-t border-borderSubtle/60 paper-indent paper-band paper-bold font-mono text-[9px] uppercase tracking-widest text-textPrimary`} style={{ height: CMP_SECTION_H }} data-compare-section={sec.title}>
              {sec.title}
            </div>
            {sec.rows.map(r => (
              <div
                key={r.key}
                /* the kept row is lifted above the scrim in the house's kept look; the rest wash under the pointer */
                className={`group ${gutter} ${phone ? 'flex flex-col' : 'grid items-center gap-x-4'} rounded border-t border-borderSubtle/40 transition-colors duration-150 cursor-pointer ${
                  keptRow === r.key ? 'relative z-30 bg-silver/[0.06] shadow-[inset_2px_0_0_0_rgb(var(--silver)/0.7)]' : 'hover:bg-silver/[0.05]'
                }`}
                style={phone ? undefined : { gridTemplateColumns: columns, height: CMP_ROW_H }}
                onClick={() => setKeptRow(k => (k === r.key ? null : r.key))}
                title={keptRow === r.key ? 'Let go of this row' : 'Keep this row in focus'}
                data-compare-row={r.key}
                data-lead={r.lead ?? undefined}
                data-kept={keptRow === r.key || undefined}
              >
                {/* the fact, with the verdict under it — the middle column at a desk, the top line on a phone */}
                {phone && (
                  <span className="flex flex-col items-center leading-none pt-1.5 pb-1" data-compare-fact title={r.hint}>
                    <span className="text-[11px] text-textSecondary whitespace-nowrap">{r.label}</span>
                    <span className="mt-[3px] text-[9.5px] text-textMuted whitespace-nowrap truncate max-w-full" data-compare-note>
                      {r.note}
                    </span>
                  </span>
                )}
                <span className={phone ? 'grid items-center gap-x-2 pb-1.5' : 'contents'} style={phone ? { gridTemplateColumns: columns, height: CMP_ROW_H - 4 } : undefined}>
                  <span className="min-w-0 flex items-center justify-end gap-2 whitespace-nowrap overflow-hidden" data-compare-a>
                    {r.bars && wingW > 0 ? <Capsules bars={r.bars(a)} scale={rowScale(r, a, b)} side="a" lit={r.lead === 'a'} run={wingW - 8} label={r.label} ticker={a.ticker} note={r.note} /> : r.cell(a, r.lead === 'a')}
                  </span>
                  {phone ? (
                    <span className="self-stretch bg-borderSubtle/60 rounded-full" aria-hidden />
                  ) : (
                    <span className="min-w-0 self-stretch flex flex-col items-center justify-center leading-none paper-panel paper-edge-x" title={r.hint}>
                      <span className="text-[11px] text-textSecondary group-hover:text-textPrimary transition-colors duration-150 whitespace-nowrap">{r.label}</span>
                      <span className="mt-[3px] text-[9.5px] text-textMuted group-hover:text-textSecondary transition-colors duration-150 whitespace-nowrap truncate max-w-full" data-compare-note>
                        {r.note}
                      </span>
                    </span>
                  )}
                  <span className="min-w-0 flex items-center gap-2 whitespace-nowrap overflow-hidden" data-compare-b>
                    {r.bars && wingW > 0 ? <Capsules bars={r.bars(b)} scale={rowScale(r, a, b)} side="b" lit={r.lead === 'b'} run={wingW - 8} label={r.label} ticker={b.ticker} note={r.note} /> : r.cell(b, r.lead === 'b')}
                  </span>
                </span>
              </div>
            ))}
          </Fragment>
        ))}
        </div>
      </div>

      {/* THE LISTS — each name's heaviest contracts and its structures, side by side */}
      <div className="grid grid-cols-1 xl:grid-cols-2 border-t border-borderSubtle xl:divide-x divide-borderSubtle paper-inset" data-compare-lists-box>
        <Lists s={a} side="a" />
        <Lists s={b} side="b" />
      </div>
      <p className="px-5 flex items-center border-t border-borderSubtle text-[11px] text-textMuted" style={{ height: 40 }} data-compare-foot>
        Only names on the session's book ({shortDay(todayIso)}) can be compared — a name off it falls back to the frame's, or to the busiest.
      </p>
        </>
      )}
      <BookDrill list={listed} openKey={openKey} onOpen={setOpenKey} tick={tick} />
    </TraceBox>
  );
};

export default Compare;
