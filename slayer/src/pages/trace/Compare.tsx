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
import { SPREAD_KINDS, type MoneynessKey, type SpreadTrade } from '../../data/flowBook';
import { useLiveBook, useOptionTape, useSpreads } from '../../data/traceLive';
import { fmtUsd } from '../../data/gex';
import { buildTraceCompare, buildTraceSide, signedUsd, type TraceSide } from '../../data/traceCompare';
import type { SleeveKey } from '../../types/compass';
import type { BookContract } from '../../types/trace';
import CompanyLogo from '../../components/ui/CompanyLogo';
import DropdownSelect from '../../components/ui/DropdownSelect';
import RichRead from '../../components/ui/RichRead';
import ScopeChip from '../../components/ui/ScopeChip';
import BookDrill from '../../components/trace/BookDrill';
import ContractCell from '../../components/trace/ContractCell';
import LeanCell from '../../components/trace/LeanCell';
import { PointerFollowCard } from '../../components/ui/PointerCard';
import { LiveHold, useHold } from '../../components/trace/LiveHold';
import NetFlowPane, { CLOCK_OPTIONS, MONEY_OPTIONS, paneTimes } from '../../components/trace/NetFlowPane';
import ReadDoor from '../../components/trace/ReadDoor';
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
  /** The row's capsules a side — one, or a pair; a row without them prints its cell */
  bars?: (s: TraceSide) => Bar[];
}
const barInk = (v: number): BarInk => (v > 0 ? 'bull' : v < 0 ? 'bear' : 'mute');
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

  const liveBook = useLiveBook(activeTicker).rows;
  const liveSpreads = useSpreads(80).rows;
  const liveTape = useOptionTape(200).rows;
  /* The shared hold (see LiveHold): the book, the structures, the tape and the panes' tick freeze together */
  const hold = useHold(useMemo(() => ({ book: liveBook, spreads: liveSpreads, tape: liveTape, tick: marketData }), [liveBook, liveSpreads, liveTape, marketData]), activeTicker);
  const { book, spreads, tape, tick } = hold.value;

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
  const bTicker = onBook(bPick) && bPick !== aTicker ? bPick : onBook(twin) && twin !== aTicker ? twin : names.find(t => t !== aTicker) ?? aTicker;

  /* Both names read at the tape's last bar — the same instant, the leaders board's rule */
  const sampleAt = useMemo(() => paneTimes('SPY').slice(-1), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const sideA = useMemo(() => buildTraceSide(book, spreads, tape, aTicker, tenor, mny, sampleAt), [book, spreads, tape, aTicker, tenor, mny, sampleAt]);
  const sideB = useMemo(() => buildTraceSide(book, spreads, tape, bTicker, tenor, mny, sampleAt), [book, spreads, tape, bTicker, tenor, mny, sampleAt]);
  const cmp = useMemo(() => buildTraceCompare(sideA, sideB), [sideA, sideB]);
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
  const leanWords = (s: TraceSide) => (Math.abs(s.book.askPct - 50) < 6 ? 'mid' : s.book.askPct >= 50 ? 'at the ask' : 'on the bid');
  const reportWords = (s: TraceSide) => (s.earnDays == null ? 'not reporting' : s.earnDays === 0 ? 'reports today' : s.earnDays === 1 ? 'reports tomorrow' : `in ${s.earnDays} sessions`);
  /* Two bearish names have no bullish one — the leader is the less bearish */
  const leansWords = cmp.bullish.net >= 0 ? 'the more bullish' : 'the less bearish';
  const nearer = (): 'a' | 'b' | null => {
    if (a.earnDays == null && b.earnDays == null) return null;
    if (a.earnDays == null) return 'b';
    if (b.earnDays == null) return 'a';
    return a.earnDays < b.earnDays ? 'a' : b.earnDays < a.earnDays ? 'b' : null;
  };

  const sections: { title: string; rows: Row[] }[] = [
    {
      title: 'Net flow',
      rows: [
        {
          key: 'net',
          label: 'Net premium',
          note: a.net === b.net ? 'the same lean' : `${cmp.bullish.ticker} leans ${leansWords}`,
          lead: higher(s => s.net),
          bars: s => [{ v: s.net, text: signedUsd(s.net), ink: barInk(s.net) }],
          cell: (s, lit) => <Fig lit={lit} ink={dirInk(s.net)}>{signedUsd(s.net)}</Fig>,
        },
        {
          key: 'calls',
          label: 'Net calls',
          note: the(louder(s => s.netCall), 'the louder on calls'),
          lead: louder(s => s.netCall),
          bars: s => [{ v: s.netCall, text: signedUsd(s.netCall), ink: barInk(s.netCall) }],
          cell: (s, lit) => <Fig lit={lit} ink={dirInk(s.netCall)}>{signedUsd(s.netCall)}</Fig>,
        },
        {
          key: 'puts',
          label: 'Net puts',
          note: the(louder(s => s.netPut), 'the louder on puts'),
          lead: louder(s => s.netPut),
          bars: s => [{ v: s.netPut, text: signedUsd(s.netPut), ink: barInk(s.netPut) }],
          cell: (s, lit) => <Fig lit={lit} ink={dirInk(s.netPut)}>{signedUsd(s.netPut)}</Fig>,
        },
      ],
    },
    {
      title: 'Same-day money',
      rows: [
        {
          key: 'odte',
          label: 'Same-day net',
          note: a.odte.net === b.odte.net ? 'the same lean today' : `${(a.odte.net > b.odte.net ? a : b).ticker} ${Math.max(a.odte.net, b.odte.net) >= 0 ? 'the more bullish' : 'the less bearish'} today`,
          lead: higher(s => s.odte.net),
          bars: s => [{ v: s.odte.net, text: signedUsd(s.odte.net), ink: barInk(s.odte.net) }],
          cell: (s, lit) => <Fig lit={lit} ink={dirInk(s.odte.net)}>{signedUsd(s.odte.net)}</Fig>,
        },
        {
          key: 'odteSides',
          label: 'Same-day calls · puts',
          note: 'expiring today or tomorrow',
          lead: null,
          bars: s => [
            { v: s.odte.calls, text: signedUsd(s.odte.calls), ink: barInk(s.odte.calls), name: 'Same-day calls', desc: 'expiring today or tomorrow' },
            { v: s.odte.puts, text: signedUsd(s.odte.puts), ink: barInk(s.odte.puts), name: 'Same-day puts', desc: 'expiring today or tomorrow' },
          ],
          cell: s => (
            <>
              <Fig lit={false} ink={dirInk(s.odte.calls)}>{signedUsd(s.odte.calls)}</Fig>
              <Sub>·</Sub>
              <Fig lit={false} ink={dirInk(s.odte.puts)}>{signedUsd(s.odte.puts)}</Fig>
            </>
          ),
        },
        {
          key: 'odteVol',
          label: 'Same-day volume',
          note: the(higher(s => s.odte.vol), 'the busier today'),
          lead: higher(s => s.odte.vol),
          bars: s => [{ v: s.odte.vol, text: num(s.odte.vol), ink: 'silver', after: `${s.odte.count} contracts` }],
          cell: (s, lit) => (
            <>
              <Fig lit={lit}>{num(s.odte.vol)}</Fig>
              <Sub>· {s.odte.count} contracts</Sub>
            </>
          ),
        },
      ],
    },
    {
      title: 'The book',
      rows: [
        {
          key: 'count',
          label: 'Contracts traded',
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
          note: the(higher(s => s.book.premium), 'the heavier book'),
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
          cell: s => <LeanCell askPct={s.book.askPct} />,
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
          label: 'Implied vol',
          note: the(higher(s => s.book.iv), 'the richer'),
          lead: higher(s => s.book.iv),
          bars: s => [{ v: s.book.iv, text: `${s.book.iv}%`, ink: 'silver' }],
          cell: (s, lit) => <Fig lit={lit}>{s.book.iv}%</Fig>,
        },
        {
          key: 'built',
          label: 'Built today',
          note: a.book.builtToday === 0 && b.book.builtToday === 0 ? 'nothing built past its interest' : the(higher(s => s.book.builtToday), 'built the more'),
          lead: higher(s => s.book.builtToday),
          bars: s => [{ v: s.book.builtToday, text: num(s.book.builtToday), ink: 'silver', after: 'past their interest' }],
          cell: (s, lit) => (
            <>
              <Fig lit={lit}>{num(s.book.builtToday)}</Fig>
              <Sub>past their interest</Sub>
            </>
          ),
        },
      ],
    },
    {
      title: 'Footprints',
      rows: [
        {
          key: 'added',
          label: 'Interest added',
          note: the(higher(s => s.interest.added), 'added the more overnight'),
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
      title: 'Structures',
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
          label: 'Structure dollars',
          note: the(higher(s => s.structures.dollars), 'the bigger structures'),
          lead: higher(s => s.structures.dollars),
          bars: s => [{ v: s.structures.dollars, text: fmtUsd(s.structures.dollars), ink: 'silver' }],
          cell: (s, lit) => <Fig lit={lit}>{fmtUsd(s.structures.dollars)}</Fig>,
        },
      ],
    },
    {
      title: 'The tape',
      rows: [
        {
          key: 'prints',
          label: 'Prints',
          note: the(higher(s => s.tape.prints), 'the busier tape'),
          lead: higher(s => s.tape.prints),
          bars: s => [{ v: s.tape.prints, text: num(s.tape.prints), ink: 'silver' }],
          cell: (s, lit) => <Fig lit={lit}>{num(s.tape.prints)}</Fig>,
        },
        {
          key: 'tapeDollars',
          label: 'Tape dollars',
          note: the(higher(s => s.tape.dollars), 'the more money on the tape'),
          lead: higher(s => s.tape.dollars),
          bars: s => [{ v: s.tape.dollars, text: fmtUsd(s.tape.dollars), ink: 'silver' }],
          cell: (s, lit) => <Fig lit={lit}>{fmtUsd(s.tape.dollars)}</Fig>,
        },
        {
          key: 'sweeps',
          label: 'Sweeps',
          note: the(higher(s => s.tape.sweeps), 'the more sweeps'),
          lead: higher(s => s.tape.sweeps),
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
  const listed = useMemo(() => [...a.rows.slice(0, CMP_LISTED), ...b.rows.slice(0, CMP_LISTED)], [a.rows, b.rows]);
  const kindOf = (t: SpreadTrade) => SPREAD_KINDS.find(k => k.key === t.kind)?.label ?? t.kind;

  const Lists = ({ s, side }: { s: TraceSide; side: 'a' | 'b' }) => (
    <div className="min-w-0" data-compare-lists={side}>
      {/* THE HEAVIEST CONTRACTS — by dollars, a row opens the card */}
      <div className="px-5 flex items-center gap-2 border-b border-borderSubtle/60 paper-band" style={{ height: CMP_LIST_HEAD_H }}>
        <CompanyLogo ticker={s.ticker} size={14} />
        <span className="text-[12px] font-semibold text-textPrimary whitespace-nowrap">{s.ticker}'s heaviest contracts</span>
        <span className="text-[10.5px] text-textMuted whitespace-nowrap truncate">· by dollars · a row opens the card</span>
      </div>
      {s.rows.slice(0, CMP_LISTED).map(r => (
        <button
          key={r.key}
          type="button"
          onClick={() => setOpenKey(openKey === r.key ? null : r.key)}
          /* On a phone the row keeps the contract, the dollars and the lean; the days and the volume go (the phone pass, 2026-09-13) */
          className={`w-full px-5 grid grid-cols-[minmax(0,1fr)_40px_76px_84px_64px] max-sm:grid-cols-[minmax(0,1fr)_76px_64px] items-center gap-x-3 border-b border-borderSubtle/40 text-left transition-colors ${openKey === r.key ? 'bg-silver/[0.06]' : 'hover:bg-silver/[0.04]'}`}
          style={{ height: CMP_LIST_ROW_H }}
          data-compare-contract={r.key}
        >
          <span className="min-w-0 flex items-center">
            <ContractCell strike={r.strike} right={r.right} expiry={r.expiry} />
          </span>
          <span className="font-mono text-[10px] tnum text-textMuted text-right max-sm:hidden">{r.dte}d</span>
          <span className="font-mono text-[12px] tnum font-semibold text-textPrimary text-right">{fmtUsd(r.premium)}</span>
          <span className="font-mono text-[10.5px] tnum text-textSecondary text-right whitespace-nowrap max-sm:hidden">{num(r.volume)} vol</span>
          <span className="flex justify-end">
            <LeanCell askPct={r.askPct} />
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
        <span className="text-[10.5px] text-textMuted whitespace-nowrap truncate">· the tape reconstructed · heaviest first</span>
      </div>
      {s.structures.list.slice(0, CMP_LISTED).map(t => (
        <div
          key={t.id}
          /* On a phone: the kind, the strikes and the dollars; the expiry and the debit/credit go */
          className="px-5 grid grid-cols-[96px_minmax(0,1fr)_120px_96px_76px] max-sm:grid-cols-[96px_minmax(0,1fr)_76px] items-center gap-x-3 border-b border-borderSubtle/40 hover:bg-silver/[0.04] transition-colors"
          style={{ height: CMP_LIST_ROW_H }}
          data-compare-structure={t.id}
          title={SPREAD_KINDS.find(k => k.key === t.kind)?.read}
        >
          <span className="text-[11.5px] font-semibold text-textPrimary whitespace-nowrap">{kindOf(t)}</span>
          <span className="font-mono text-[12px] tnum font-semibold text-textPrimary whitespace-nowrap truncate">{t.strikesLabel}</span>
          <span className="font-mono text-[10px] tnum text-textMuted whitespace-nowrap max-sm:hidden">
            {t.expiry} · {t.dte}d
          </span>
          <span className="font-mono text-[11px] tnum text-right whitespace-nowrap max-sm:hidden">
            <span className="text-textPrimary">${Math.abs(t.net).toFixed(2)}</span> <span className={t.net >= 0 ? 'text-bull' : 'text-bear'}>{t.net >= 0 ? 'debit' : 'credit'}</span>
          </span>
          <span className="font-mono text-[12px] tnum font-semibold text-textPrimary text-right">{fmtUsd(t.premium)}</span>
        </div>
      ))}
      {s.structures.list.length === 0 && (
        <div className="px-5 flex items-center font-mono text-[10px] uppercase tracking-widest text-textMuted" style={{ height: CMP_LIST_ROW_H }}>
          No structures on this cut today
        </div>
      )}
    </div>
  );

  return (
    <TraceBox
      title="Two names, side by side"
      sub="Net flow, the same-day money, the book, the footprints, the structures and the tape — the first name against the second, on the same cut every other Trace page reads · pick either name, swap them, cut them to one clock"
      testId="compare"
      data={{ a: aTicker, b: bTicker, clock: tenor, money: mny }}
      guide={{ title: 'How to read the card', door: 'What the rows, the panes and the lists mean', body: <CompareGuide />, testId: 'compare-guide', open: guideOpen, onOpen: setGuideOpen }}
      facts={
        <>
          <Fact label={`${a.ticker} net`} testId="a-net">
            <span className={dirInk(a.net)}>{signedUsd(a.net)}</span>
          </Fact>
          <Fact label={`${b.ticker} net`} testId="b-net">
            <span className={dirInk(b.net)}>{signedUsd(b.net)}</span>
          </Fact>
          <Fact label="Same-day money" testId="same-day">
            <span className={dirInk(a.odte.net)}>{signedUsd(a.odte.net)}</span> <span className="text-textMuted">·</span> <span className={dirInk(b.odte.net)}>{signedUsd(b.odte.net)}</span>
          </Fact>
          <Champion label={`Leans ${leansWords}`} ink={cmp.bullish.net >= 0 ? 'bull' : 'bear'} onOpen={() => toNetFlow(cmp.bullish.ticker)} testId="bullish">
            {cmp.bullish.ticker} · {signedUsd(cmp.bullish.net)}
          </Champion>
          <Champion label="Heavier book" ink="supreme" onOpen={() => toNetFlow(cmp.heavier.ticker)} testId="heavier">
            {cmp.heavier.ticker} · {fmtUsd(cmp.heavier.book.premium)}
          </Champion>
          <Fact label="Busier tape" testId="busier">
            {cmp.busier.ticker} <span className="text-textMuted">·</span> {num(cmp.busier.tape.prints)} prints
          </Fact>
        </>
      }
      controls={
        <>
          <LiveHold paused={hold.paused} onToggle={hold.toggle} heldAt={hold.heldAt} />
          {/* On a phone's two-column cards line the pair takes the whole row (the phone pass, 2026-09-13) */}
          <span className="flex items-center gap-1.5 max-sm:col-span-2" data-compare-names>
            <span className="font-mono text-[9px] uppercase tracking-widest text-textMuted">A</span>
            {/* The two chips wear the same clothes (Noah, 2026-09-09): the first in the full following look
                with its silver link, the second its own name with no link at all */}
            <ScopeChip ticker={aTicker} linked={aFollows} full quote onToggleLink={() => setAPick(aFollows ? aTicker : null)} onPick={next => (aFollows ? changeTicker(next) : setAPick(next))} />
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
            <span className="font-mono text-[9px] uppercase tracking-widest text-textMuted">B</span>
            <ScopeChip ticker={bTicker} quote onPick={next => setBPick(next)} title="The second name — pick another" />
          </span>
          {/* The two cuts as labelled cards — ONE pair for both names */}
          <DropdownSelect label="Clock" value={tenor} options={CLOCK_OPTIONS} onChange={setTenor} title="How far out the contracts run — both names" testId="compare-clock" />
          <DropdownSelect label="Money" value={mny} options={MONEY_OPTIONS} onChange={setMny} title="Which strikes against the stock — both names" testId="compare-money" />
        </>
      }
      sentence={sentence}
    >
      {/* THE PANES — each name through the session, on the page's one cut */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2 border-t border-borderSubtle p-2" data-compare-panes>
        {[a, b].map((s, i) => (
          <div key={s.ticker} style={{ height: CMP_PANE_H }} className="min-w-0" data-compare-pane={i === 0 ? 'a' : 'b'}>
            <NetFlowPane book={book} seg="all" mny={mny} onSeg={() => {}} onMny={setMny} tick={tick} ticker={s.ticker} tenor={tenor} onTenor={setTenor} dteMax={Infinity} cutCards={false} />
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
                  <span className="flex flex-col items-center leading-none pt-1.5 pb-1" data-compare-fact>
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
                    <span className="min-w-0 self-stretch flex flex-col items-center justify-center leading-none paper-panel paper-edge-x">
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
        Only names on today's book can be compared — a name off it falls back to the frame's, or to the busiest.
      </p>
      <BookDrill list={listed} openKey={openKey} onOpen={setOpenKey} tick={tick} />
    </TraceBox>
  );
};

export default Compare;
