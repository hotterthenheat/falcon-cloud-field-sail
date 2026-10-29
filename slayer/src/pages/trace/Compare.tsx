/* Two names side by side on one clock and money cut: each name's pane, then a card of facts with the first name's
   figure left of the spine and the second's right, then each name's heaviest contracts and structures. */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftRight } from 'lucide-react';
import { useTicker } from '../../context/MarketDataContext';
import { floorPackaged, notABet, notABetHint, SPREAD_KINDS, stockLike, STOCK_LIKE_HINT, type MoneynessKey, type SpreadTrade } from '../../data/flowBook';
import { fmtCount as num, lastRegularClose, nyDateOf, nyIsoToday, tapeSessionIso, useFlowPerExpiry, useLiveBook, useNameSpreads, useNameTape, usePaneFlow, usd as fmtUsd, type ExpiryFlow, type PaneFlowPoint } from '../../data/traceLive';
import { dayLean, leanWords as leanOf } from '../../data/traceLean';
import { nyClock } from '../../core/nyTime';
import { buildTraceCompare, buildTraceSide, signedUsd, type TraceSide } from '../../data/traceCompare';
import type { LivePack } from '../../data/traceLive';
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
import { LiveHold, SessionMark, useHold } from '../../components/trace/LiveHold';
import NetFlowPane, { CLOCK_OPTIONS, MONEY_OPTIONS } from '../../components/trace/NetFlowPane';
import ReadDoor from '../../components/trace/ReadDoor';
import TermLine from '../../components/trace/TermLine';
import TraceBox, { Champion, Fact } from '../../components/trace/TraceBox';
import { CompareGuide } from '../../components/trace/TraceGuide';
import { CMP_COLUMNS, CMP_LIST_HEAD_H, CMP_LIST_ROW_H, CMP_LISTED, CMP_PANE_H, CMP_ROW_H, CMP_SECTION_H } from './traceSkeletons';
import { useIsBelowXl, useIsPhone } from '../../components/ui/useMediaQuery';

/** Each name's last prints and structures the card reads */
const TAPE_N = 300;
const SPREADS_N = 80;
/* the index twins, kept here so the Trace chunk does not carry Pinpoint's Compare engine */
const TWINS: Record<string, string> = { SPY: 'QQQ', QQQ: 'SPY', IWM: 'SPY', DIA: 'SPY' };

/* the two names are remembered across route changes within a session */
let aMemory: string | null = null;
let bMemory: string | null = null;

/** A row's figure: the leader lit, the other quiet; a signed fact keeps its direction ink on both sides */
const Fig = ({ children, lit, ink }: { children: ReactNode; lit: boolean; ink?: string }) => (
  <span className={`font-mono text-t12 tnum whitespace-nowrap ${lit ? 'font-semibold' : ''} ${ink ?? (lit ? 'text-textPrimary' : 'text-textSecondary')}`}>{children}</span>
);
const Sub = ({ children }: { children: ReactNode }) => <span className="text-t105 text-textSecondary whitespace-nowrap">{children}</span>;
const dirInk = (v: number) => (v > 0 ? 'text-bull' : v < 0 ? 'text-bear' : 'text-textMuted');
/** Net puts bought lean bearish (red), sold bullish (green) */
const putDirInk = (v: number) => dirInk(-v);

/* Each figure is a capsule growing away from the spine, its length the figure's share of the row's larger figure; a
   capsule is never shorter than its figure, and a pair is scaled by its sum. */
type BarInk = 'bull' | 'bear' | 'silver' | 'mute';
interface Bar {
  /** The magnitude the capsule's length follows */
  v: number;
  text: string;
  ink: BarInk;
  /** Words beside the capsule, on the spine's side */
  after?: string;
  /** What this capsule holds, for its hover card (a pair's leg) */
  name?: string;
  /** The leg in plain words, under its figure on the card */
  desc?: string;
}
const CARD_INK: Record<BarInk, string> = { bull: 'rgb(var(--bull))', bear: 'rgb(var(--bear))', silver: 'rgb(var(--text-primary))', mute: 'rgb(var(--text-muted))' };
const CardLine = ({ k, v, sub, ink }: { k: string; v: string; sub?: string; ink?: string }) => (
  <>
    <span className="text-textMuted whitespace-nowrap">{k}</span>
    <span className="text-right font-mono text-t11 tnum whitespace-nowrap" style={{ color: ink ?? 'rgb(var(--text-primary))' }}>
      {v}
      {sub && <span className="text-t11 text-textMuted"> {sub}</span>}
    </span>
  </>
);
interface Row {
  key: string;
  label: string;
  /** What the two say against each other, one clause */
  note: string;
  /** The side that leads on this fact, lit; null when none does */
  lead: 'a' | 'b' | null;
  cell: (s: TraceSide, lit: boolean) => ReactNode;
  hint?: string;
  bars?: (s: TraceSide) => Bar[];
}
const barInk = (v: number): BarInk => (v > 0 ? 'bull' : v < 0 ? 'bear' : 'mute');
const putInk = (v: number): BarInk => barInk(-v);
const CAP_H = 18;
/* every class written out, since Tailwind only builds what it can read */
const CAP_CLASS: Record<BarInk, { lit: string; quiet: string; fig: string }> = {
  bull: { lit: 'bg-bull/[0.28] text-bull ring-1 ring-inset ring-bull/60', quiet: 'bg-bull/[0.14] text-bull', fig: 'text-bull' },
  bear: { lit: 'bg-bear/[0.28] text-bear ring-1 ring-inset ring-bear/60', quiet: 'bg-bear/[0.14] text-bear', fig: 'text-bear' },
  silver: { lit: 'bg-silver/[0.3] text-textPrimary ring-1 ring-inset ring-silver/60', quiet: 'bg-silver/[0.14] text-textSecondary', fig: 'text-textSecondary' },
  mute: { lit: 'bg-ink/[0.08] text-textMuted', quiet: 'bg-ink/[0.08] text-textMuted', fig: 'text-textMuted' },
};
const capClass = (ink: BarInk, lit: boolean): string => (lit ? CAP_CLASS[ink].lit : CAP_CLASS[ink].quiet);
/** The room a figure needs inside its capsule: tabular figures at 11.5px plus the capsule's ends */
const figRoom = (t: string) => Math.ceil(t.length * 6.6) + 14;
/** One side's capsules: `a`'s grow leftward from the spine, `b`'s rightward; both read left to right */
const Capsules = ({ bars, scale, side, lit, run, label, ticker, note }: { bars: Bar[]; scale: number; side: 'a' | 'b'; lit: boolean; run: number; label: string; ticker: string; note: string }) => {
  /* one pointer card per hover: the capsule's figure, a pair's other leg, the row's verdict as the foot */
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
        /* the words sit on the spine's side of both wings, so the two sets face each other */
        const words = b.after && <span className="text-t105 text-textSecondary whitespace-nowrap shrink-0">{b.after}</span>;
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
            <span className={`font-mono text-t115 tnum whitespace-nowrap ${lit ? 'font-semibold' : ''}`}>{b.text}</span>
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
/** A row's scale: the larger of the two sides' sums */
const rowScale = (r: Row, a: TraceSide, b: TraceSide): number => {
  if (!r.bars) return 0;
  const sum = (s: TraceSide) => r.bars!(s).reduce((n, x) => n + Math.abs(x.v), 0);
  return Math.max(sum(a), sum(b));
};

const ticksOf = (rows: PaneFlowPoint[]) => {
  const last = rows.length ? rows[rows.length - 1] : null;
  return last ? { net: last.callPrem - last.putPrem, calls: last.callPrem, puts: last.putPrem } : null;
};
/** The expiry route's state for the net: '…' while it loads, '—' when it failed */
const pendingOf = (fpe: LivePack<ExpiryFlow[]>): TraceSide['netPending'] => (fpe.rows.length ? undefined : fpe.waiting ? 'loading' : fpe.fault ? 'none' : undefined);

/* floor packages stand apart: the bets ranked by dollars, then up to two packages among the heaviest, each labelled */
const listOf = (rows: BookContract[]) => {
  const top = rows.slice(0, CMP_LISTED + 3);
  return [...rows.filter(r => !notABet(r)).slice(0, CMP_LISTED), ...top.filter(r => notABet(r)).slice(0, 2)];
};
const kindOf = (t: SpreadTrade) => SPREAD_KINDS.find(k => k.key === t.kind)?.label ?? t.kind;

const NameLists = ({ s, side, openKey, onOpen, mny, todayIso }: { s: TraceSide; side: 'a' | 'b'; openKey: string | null; onOpen: (k: string | null) => void; mny: MoneynessKey; todayIso: string }) => (
  <div className="min-w-0" data-compare-lists={side}>
    <div className="px-5 flex items-center gap-2 border-b border-borderSubtle/60 paper-band" style={{ height: CMP_LIST_HEAD_H }}>
      <CompanyLogo ticker={s.ticker} size={14} />
      <span className="text-t12 font-semibold text-textPrimary whitespace-nowrap">{s.ticker}'s heaviest contracts</span>
      <span className="text-t105 text-textMuted break-words sm:whitespace-nowrap sm:truncate">· by dollars · a row opens the card</span>
    </div>
    {listOf(s.rows).map(r => (
      <button
        key={r.key}
        type="button"
        onClick={() => onOpen(openKey === r.key ? null : r.key)}
        className={`w-full px-5 grid grid-cols-[minmax(0,1fr)_40px_76px_84px_64px] max-sm:grid-cols-[minmax(0,1fr)_76px_64px] items-center gap-x-3 border-b border-borderSubtle/40 text-left transition-colors ${openKey === r.key ? 'bg-silver/[0.06]' : 'hover:bg-silver/[0.04]'}`}
        style={{ height: CMP_LIST_ROW_H }}
        data-compare-contract={r.key}
      >
        <span className="min-w-0 flex items-center gap-1.5">
          <ContractCell strike={r.strike} right={r.right} expiry={r.expiry} />
          {floorPackaged(r) ? (
            <span className="font-mono text-t95 uppercase text-warn whitespace-nowrap" title={`${Math.round(r.floorPct)}% on the floor, ${Math.round(r.multiPct)}% in packages: compression, not a bet`}>
              floor pkg
            </span>
          ) : notABet(r) ? (
            <span className="font-mono text-t95 uppercase text-warn whitespace-nowrap" title={`${notABetHint(r)}; not ranked`}>
              {r.multiPct >= 50 ? 'spread legs' : 'a cross'}
            </span>
          ) : stockLike(r) ? (
            <span className="font-mono text-t95 uppercase text-warn whitespace-nowrap" title={STOCK_LIKE_HINT}>
              stock-like
            </span>
          ) : null}
        </span>
        <span className="font-mono text-t10 tnum text-textMuted text-right max-sm:hidden">{r.dte}d</span>
        <span className="font-mono text-t12 tnum font-semibold text-textPrimary text-right">{fmtUsd(r.premium)}</span>
        <span className="font-mono text-t105 tnum text-textSecondary text-right whitespace-nowrap max-sm:hidden">{num(r.volume)} vol</span>
        <span className="flex justify-end">
          <LeanCell askPct={r.askPct} split={r.sideVol} legsPct={r.multiPct} crossPct={r.crossPct} />
        </span>
      </button>
    ))}
    {s.rows.length === 0 && (
      <div className="px-5 flex items-center font-mono text-t10 uppercase tracking-widest text-textMuted" style={{ height: CMP_LIST_ROW_H }}>
        Nothing on this cut
      </div>
    )}
    <div className="px-5 flex items-center gap-2 border-y border-borderSubtle/60 paper-band" style={{ height: CMP_LIST_HEAD_H }}>
      <CompanyLogo ticker={s.ticker} size={14} />
      <span className="text-t12 font-semibold text-textPrimary whitespace-nowrap">{s.ticker}'s structures</span>
      <span className="text-t105 text-textMuted break-words sm:whitespace-nowrap sm:truncate" title={mny !== 'all' ? "A structure's legs span strikes, so the money cut is not applied here; the clock cut is, by the near leg" : undefined}>
        · most net premium first{mny !== 'all' ? ' · every strike' : ''}
      </span>
    </div>
    {s.structures.list.slice(0, CMP_LISTED).map(t => (
      <div
        key={t.id}
        className="px-5 grid grid-cols-[96px_minmax(0,1fr)_120px_96px_76px] max-sm:grid-cols-[96px_minmax(0,1fr)_76px] items-center gap-x-3 border-b border-borderSubtle/40 hover:bg-silver/[0.04] transition-colors"
        style={{ minHeight: CMP_LIST_ROW_H }}
        data-compare-structure={t.id}
        title={SPREAD_KINDS.find(k => k.key === t.kind)?.read}
      >
        <span className="text-t115 font-semibold text-textPrimary whitespace-nowrap">{kindOf(t)}</span>
        <span className="font-mono text-t12 tnum font-semibold text-textPrimary break-words sm:whitespace-nowrap sm:truncate">{t.strikesLabel}</span>
        <span className="font-mono text-t10 tnum text-textMuted whitespace-nowrap max-sm:hidden" title={t.farExpiry ? `Near leg ${t.expiry} (${t.dte}d), far leg ${t.farExpiry} (${t.farDte}d)` : undefined}>
          {t.farExpiry ? `${t.expiry.slice(0, 5)}–${t.farExpiry.slice(0, 5)} · ${t.dte}–${t.farDte}d` : `${t.expiry} · ${t.dte}d`}
        </span>
        <span className="font-mono text-t11 tnum text-right whitespace-nowrap max-sm:hidden">
          {/* paid or collected is a fact, not a lean; a structure with no priced net says nothing */}
          {t.net === 0 ? (
            <span className="text-textMuted">{t.legsState === 'pending' && t.netKnown !== false ? '…' : '—'}</span>
          ) : (
            <>
              <span className="text-textPrimary">
                {t.units != null && t.units > 1 ? `${t.units}× ` : ''}${Math.abs(t.net).toFixed(2)}
              </span>{' '}
              <span className="text-textSecondary">{t.net > 0 ? 'debit' : 'credit'}</span>
            </>
          )}
        </span>
        <span className="font-mono text-t12 tnum font-semibold text-textPrimary text-right" title={`${fmtUsd(t.premium)} across every leg`}>
          {t.netKnown === false ? '—' : fmtUsd(Math.abs(t.netPremium))}
        </span>
      </div>
    ))}
    {s.structures.list.length === 0 && (
      <div className="px-5 flex items-center font-mono text-t10 uppercase tracking-widest text-textMuted" style={{ height: CMP_LIST_ROW_H }}>
        No structures on this cut {isLiveDay(todayIso) ? 'today' : `on ${shortDay(todayIso)}`}
      </div>
    )}
  </div>
);

const Compare = () => {
  const { activeTicker, changeTicker } = useTicker();
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
  /* one cut for both: a comparison on two cuts compares nothing */
  const [tenor, setTenor] = useState<SleeveKey | 'all'>('all');
  const [mny, setMny] = useState<MoneynessKey>('all');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  /* a clicked row stays sharp while the rest of the card softens behind one scrim; the blur is held 460ms past the
     let-go so it never snaps */
  const [keptRow, setKeptRow] = useState<string | null>(null);
  const pinned = keptRow != null;
  /* how far a capsule can grow: the first wing's width, re-measured as the card resizes */
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

  /* every useLiveBook shares the one market read; each name adds only its own top contracts */
  const bookPack = useLiveBook(activeTicker);
  const liveBook = bookPack.rows;
  const bookState: 'reading' | 'down' | 'in' = liveBook.length ? 'in' : bookPack.fault ? 'down' : 'reading';
  const hold = useHold(liveBook, activeTicker, liveBook.length > 0 || !!bookPack.fault);
  const book = hold.value;

  /* the names on the session's book, busiest first: the default picks */
  const names = useMemo(() => {
    const vol = new Map<string, number>();
    for (const r of book) vol.set(r.ticker, (vol.get(r.ticker) ?? 0) + r.volume);
    return [...vol.entries()].sort((x, y) => y[1] - x[1]).map(e => e[0]);
  }, [book]);
  const onBook = (t: string | null | undefined): t is string => !!t && names.includes(t);
  /* a picked name is compared whether or not it is on the market's book (each name reads its own book); unpicked, the
     terminal's name when it trades, else the busiest */
  const picked = (t: string | null | undefined): t is string => !!t && /^[A-Z][A-Z0-9.]{0,9}$/.test(t);
  const aTicker = picked(aPick) ? aPick : onBook(activeTicker) ? activeTicker : names[0] ?? 'SPY';
  /* never the same name twice: the second falls to the first's twin, else the next busiest */
  const twin = TWINS[aTicker];
  const bTicker = picked(bPick) && bPick !== aTicker ? bPick : onBook(twin) && twin !== aTicker ? twin : names.find(t => t !== aTicker) ?? (twin ?? (aTicker === 'QQQ' ? 'SPY' : 'QQQ'));

  /* each name's own last prints and structures, cut to the stretch both cover: a longer reach is not a busier tape */
  const tapeA = useNameTape(aTicker, TAPE_N).rows;
  const tapeB = useNameTape(bTicker, TAPE_N).rows;
  const spreadsPackA = useNameSpreads(aTicker, SPREADS_N);
  const spreadsPackB = useNameSpreads(bTicker, SPREADS_N);
  const spreadsA = spreadsPackA.rows;
  const spreadsB = spreadsPackB.rows;
  const spreadsDone = spreadsPackA.complete && spreadsPackB.complete;
  const liveNames = useMemo(() => {
    /* both cut at the same millisecond, so a print in the cut's own second counts for both or neither */
    const msP = (p: { epoch?: number; epochMs?: number }) => p.epochMs ?? (p.epoch != null ? p.epoch * 1000 : Infinity);
    const reach = (r: { epoch?: number; epochMs?: number }[], cap: number) => (r.length >= cap ? Math.min(...r.map(msP)) : -Infinity);
    const sinceMsTape = Math.max(reach(tapeA, TAPE_N), reach(tapeB, TAPE_N));
    const since = Number.isFinite(sinceMsTape) ? sinceMsTape / 1000 : sinceMsTape;
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
  /* each name reads its own book: the market's rows alone undercount the second name */
  const bookA = useLiveBook(aTicker).rows;
  const bookB = useLiveBook(bTicker).rows;
  const fpePackA = useFlowPerExpiry(aTicker);
  const fpePackB = useFlowPerExpiry(bTicker);
  /* the minute ticks, the panes' own series: a labelled secondary line on the card */
  const flowA = usePaneFlow({ ticker: aTicker, seg: 'all', mny: 'all', zeroDte: false, enabled: true }).rows;
  const flowB = usePaneFlow({ ticker: bTicker, seg: 'all', mny: 'all', zeroDte: false, enabled: true }).rows;
  const liveSides = useMemo(
    () => ({ ...liveNames, bookA: bookA.length ? bookA : book, bookB: bookB.length ? bookB : book, fpeA: fpePackA, fpeB: fpePackB, flowA, flowB }),
    [liveNames, bookA, bookB, book, fpePackA, fpePackB, flowA, flowB]
  );
  const frozen = useRef(liveSides);
  if (!hold.paused) frozen.current = liveSides;
  const held = frozen.current;
  const { tape, spreads, since: tapeSince } = held;
  const todayIso = tapeSessionIso();
  const sideA = useMemo<TraceSide>(
    () => ({ ...buildTraceSide(held.bookA, spreads, tape, aTicker, tenor, mny, held.fpeA.rows, todayIso), netPending: pendingOf(held.fpeA), ticks: ticksOf(held.flowA) }),
    [held, spreads, tape, aTicker, tenor, mny, todayIso]
  );
  const sideB = useMemo<TraceSide>(
    () => ({ ...buildTraceSide(held.bookB, spreads, tape, bTicker, tenor, mny, held.fpeB.rows, todayIso), netPending: pendingOf(held.fpeB), ticks: ticksOf(held.flowB) }),
    [held, spreads, tape, bTicker, tenor, mny, todayIso]
  );
  /* after the close the two tapes' last stretches are not the day, so no busier tape is called */
  const afterClose = !!lastRegularClose();
  const regular = !afterClose && sideA.tape.prints > 0 && sideB.tape.prints > 0;
  const afterLeftOut = sideA.tape.after + sideB.tape.after;
  const sinceDay = tapeSince && nyDateOf(tapeSince * 1000) !== nyIsoToday() ? `${shortDay(nyDateOf(tapeSince * 1000))} ` : '';
  const tapeWords = tapeSince ? `since ${sinceDay}${nyClock(tapeSince * 1000, { zone: true })}` : 'over the same stretch';
  const clockLabel = CLOCK_OPTIONS.find(o => o.value === tenor)?.label ?? tenor;
  const moneyLabel = MONEY_OPTIONS.find(o => o.value === mny)?.label ?? mny;
  const cutWords = tenor === 'all' && mny === 'all' ? 'on the book' : `on this cut (${[tenor !== 'all' ? clockLabel : '', mny !== 'all' ? moneyLabel : ''].filter(Boolean).join(' · ')})`;
  const cmp = useMemo(() => buildTraceCompare(sideA, sideB, tapeWords, regular, sameDayWords(todayIso), cutWords), [sideA, sideB, tapeWords, regular, todayIso, cutWords]);
  const { a, b } = cmp;

  /* the first chip follows the frame until it holds a name; a swap moves the frame when it follows */
  const aFollows = aPick === null;
  const onSwap = () => {
    if (aFollows) changeTicker(bTicker);
    else setAPick(bTicker);
    setBPick(aTicker);
  };
  const toNetFlow = useCallback((t: string) => navigate('/trace/net-flow', { state: { ticker: t } }), [navigate]);

  /* ---- the rows ---- */
  const higher = (pick: (s: TraceSide) => number): 'a' | 'b' | null => (pick(a) > pick(b) ? 'a' : pick(b) > pick(a) ? 'b' : null);
  const louder = (pick: (s: TraceSide) => number) => higher(s => Math.abs(pick(s)));
  const who = (lead: 'a' | 'b' | null) => (lead === 'a' ? a : lead === 'b' ? b : null);
  const the = (lead: 'a' | 'b' | null, words: string, same = 'the same') => {
    const w = who(lead);
    return w ? `${w.ticker} ${words}` : same;
  };
  const ratio = (pick: (s: TraceSide) => number) => {
    const hi = Math.max(pick(a), pick(b));
    const lo = Math.min(pick(a), pick(b));
    return lo > 0 ? `${(hi / lo).toFixed(1)}×` : null;
  };
  const leanWords = (s: TraceSide) => leanOf(dayLean({ askPct: s.book.askPct, volume: s.book.volume, sideVol: s.book.side }));
  /* from the report's own date against New York's today, never "today" for a past session's */
  const reportWords = (s: TraceSide) => {
    if (s.earnDays == null) return 'not reporting';
    const iso = s.earnIso;
    const d = iso ? daysFromToday(iso) : NaN;
    if (d === 0) return 'reports today';
    if (d === 1) return 'reports tomorrow';
    return `in ${s.earnDays} trading day${s.earnDays === 1 ? '' : 's'}${iso ? ` (${shortDay(iso)})` : ''}`;
  };
  /* two bearish names have no bullish one: the leader is the less bearish */
  const leansWords = cmp.bullish.net >= 0 ? 'the more bullish' : 'the less bearish';
  const netHeld = !a.netPending && !b.netPending;
  const pend = (s: TraceSide) => (s.netPending === 'loading' ? '…' : '—');
  const ticksHeld = !!a.ticks && !!b.ticks;
  const nearer = (): 'a' | 'b' | null => {
    if (a.earnDays == null && b.earnDays == null) return null;
    if (a.earnDays == null) return 'b';
    if (b.earnDays == null) return 'a';
    return a.earnDays < b.earnDays ? 'a' : b.earnDays < a.earnDays ? 'b' : null;
  };
  const dayWords = isLiveDay(todayIso) ? 'the whole day' : `${shortDay(todayIso)}, the whole day`;
  const clockWords = tenor === 'all' ? 'every expiry' : `${clockLabel} expiries`;

  const oiDayTitle = (() => {
    const da = a.interest.day;
    const db = b.interest.day;
    const pending = a.interest.pending && b.interest.pending && isLiveDay(todayIso) ? ` (today's counted ${nextCountDay(todayIso)})` : '';
    const lag = a.interest.lagging + b.interest.lagging;
    const lagWords = lag ? ` · ${num(lag)} on an older count left out` : '';
    if (da && db && da !== db) return `${a.ticker} ${oiInWords(da)}, ${b.ticker} ${oiInWords(db)}${lagWords}`;
    return `${oiInWords(da ?? db)}${pending}${lagWords}`;
  })();

  const sections: { title: string; rows: Row[] }[] = [
    {
      title: `Net flow · by expiry, ${clockWords}, ${dayWords}${mny !== 'all' ? ' · every strike' : ''}`,
      rows: [
        {
          key: 'net',
          label: 'Net premium',
          note: !netHeld ? (a.netPending === 'loading' || b.netPending === 'loading' ? 'loading…' : 'did not load') : a.net === b.net ? 'the same lean' : `${cmp.bullish.ticker} ${leansWords}`,
          lead: netHeld ? higher(s => s.net) : null,
          hint: `Call premium at the ask less on the bid, less the same for puts, on ${clockWords}. Spread legs and floor packages are in it`,
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
        {
          key: 'puts',
          label: 'Net puts',
          note: netHeld ? the(louder(s => s.netPut), 'the louder on puts') : '…',
          lead: netHeld ? louder(s => s.netPut) : null,
          bars: s => [{ v: s.netPending ? 0 : s.netPut, text: s.netPending ? pend(s) : signedUsd(s.netPut), ink: putInk(s.netPut) }],
          cell: (s, lit) => (s.netPending ? <Sub>{pend(s)}</Sub> : <Fig lit={lit} ink={putDirInk(s.netPut)}>{signedUsd(s.netPut)}</Fig>),
        },
        {
          key: 'ticks',
          label: 'Net · minute ticks',
          note: ticksHeld ? 'the panes’ line, every expiry' : '…',
          lead: null,
          hint: 'The same net off the minute ticks, every expiry, regular session: the panes’ series. On spread-heavy names the two routes can differ',
          bars: s => [{ v: s.ticks ? s.ticks.net : 0, text: s.ticks ? signedUsd(s.ticks.net) : '…', ink: s.ticks ? barInk(s.ticks.net) : 'mute', name: 'Minute ticks', desc: s.ticks ? `calls ${signedUsd(s.ticks.calls)}, puts ${signedUsd(s.ticks.puts)}` : undefined }],
          cell: s => (s.ticks ? <Fig lit={false} ink={dirInk(s.ticks.net)}>{signedUsd(s.ticks.net)}</Fig> : <Sub>…</Sub>),
        },
      ],
    },
    {
      title: `Same-day money · contracts ${sameDayWords(todayIso)}, by expiry`,
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
          note: 'net calls · net puts',
          lead: null,
          bars: s => [
            { v: s.odte.calls, text: signedUsd(s.odte.calls), ink: barInk(s.odte.calls), name: 'Same-day net calls', desc: 'at the ask less on the bid' },
            { v: s.odte.puts, text: signedUsd(s.odte.puts), ink: putInk(s.odte.puts), name: 'Same-day net puts', desc: 'bought leans bearish' },
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
      title: `The book · top 80 contracts by premium, packages and legs left out${a.book.apart.count || b.book.apart.count ? ` (${a.ticker} ${num(a.book.apart.count)}, ${b.ticker} ${num(b.book.apart.count)})` : ''}`,
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
          hint: "Each side's share of the book's premium",
          bars: s => [
            { v: s.book.callShare, text: `${s.book.callShare}%`, ink: 'bull', name: 'Calls', desc: 'of the premium' },
            { v: 100 - s.book.callShare, text: `${100 - s.book.callShare}%`, ink: 'bear', name: 'Puts', desc: 'of the premium' },
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
          note: `${a.ticker} ${leanWords(a)}, ${b.ticker} ${leanWords(b)}`,
          lead: null,
          hint: "Ask share of the book's summed sided volume",
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
      title: `Footprints · open interest ${oiDayTitle}, the book's bets only`,
      rows: [
        {
          key: 'added',
          label: 'Interest added',
          note: the(higher(s => s.interest.added), 'added the more'),
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
      title: `Structures · ${shortDay(todayIso)}${held.spreadSinceMs != null ? `, since ${nyClock(held.spreadSinceMs, { seconds: true, zone: true })}` : spreadsDone ? ', the whole session' : ''} · regular hours, compression left out`,
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
            { v: s.structures.paid, text: String(s.structures.paid), ink: 'bull', name: 'Paid', desc: 'put on for a debit' },
            { v: s.structures.collected, text: String(s.structures.collected), ink: 'bear', name: 'Collected', desc: 'put on for a credit' },
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
          note: the(higher(s => s.structures.dollars), 'the more net premium'),
          lead: higher(s => s.structures.dollars),
          bars: s => [{ v: s.structures.dollars, text: fmtUsd(s.structures.dollars), ink: 'silver' }],
          cell: (s, lit) => <Fig lit={lit}>{fmtUsd(s.structures.dollars)}</Fig>,
        },
      ],
    },
    {
      title: `The tape · ${tapeSince ? `since ${sinceDay}${nyClock(tapeSince * 1000, { seconds: true, zone: true })}` : `each name's last ${TAPE_N} prints`}${afterLeftOut > 0 ? ` · ${num(afterLeftOut)} after-hours left out` : ''}${regular ? '' : afterClose ? ' · closed, not compared' : ' · not compared'}`,
      rows: [
        {
          key: 'prints',
          label: 'Prints',
          note: regular ? the(higher(s => s.tape.prints), 'the busier tape') : afterClose ? 'not compared after the close' : 'not compared',
          lead: regular ? higher(s => s.tape.prints) : null,
          bars: s => [{ v: s.tape.prints, text: num(s.tape.prints), ink: 'silver' }],
          cell: (s, lit) => <Fig lit={lit}>{num(s.tape.prints)}</Fig>,
        },
        {
          key: 'tapeDollars',
          label: 'Tape dollars',
          note: regular ? the(higher(s => s.tape.dollars), 'the more money on the tape') : 'not compared',
          lead: regular ? higher(s => s.tape.dollars) : null,
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

  const sentence = cmp.parts.map((p, i) =>
    typeof p === 'string' ? (
      <RichRead key={i} text={p} />
    ) : (
      <ReadDoor key={i} onOpen={() => toNetFlow(p.name)} title={`${p.name} on Net Flow's pane`}>
        {p.name}
      </ReadDoor>
    )
  );

  /* a 112px spine below xl; on a phone each row is two lines, the fact over the two capsules */
  const narrow = useIsBelowXl();
  const phone = useIsPhone();
  const columns = phone ? 'minmax(0,1fr) 2px minmax(0,1fr)' : narrow ? 'minmax(0,1fr) 112px minmax(0,1fr)' : CMP_COLUMNS;
  const gutter = phone ? 'mx-3' : 'mx-5';
  const listed = useMemo(() => [...listOf(a.rows), ...listOf(b.rows)], [a.rows, b.rows]);
  const panes = (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-2 border-t border-borderSubtle p-2" data-compare-panes>
      {[a, b].map((s, i) => (
        <div key={`${i}-${s.ticker}`} style={{ height: CMP_PANE_H }} className="min-w-0" data-compare-pane={i === 0 ? 'a' : 'b'}>
          <NetFlowPane
            seg="all"
            mny={mny}
            onSeg={() => {}}
            onMny={setMny}
            ticker={s.ticker}
            dteMax={Infinity}
            cutCards={false}
            uncutNote={tenor !== 'all' || mny !== 'all' ? `every expiry and strike: the ${[tenor !== 'all' ? 'clock' : '', mny !== 'all' ? 'money' : ''].filter(Boolean).join(' and ')} cut does not reach the minute ticks` : undefined}
          />
        </div>
      ))}
    </div>
  );
  const netTitle = `Net by expiry on ${clockWords}, ${dayWords}. Spread legs and floor packages are in it`;

  return (
    <TraceBox
      title="Two names, side by side"
      sub="Net flow, same-day money, the book, footprints, structures and the tape on one cut"
      testId="compare"
      data={{ a: aTicker, b: bTicker, clock: tenor, money: mny }}
      foldOnPhone
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
            <Fact label={`${a.ticker} net`} testId="a-net" title={netTitle}>
              {a.netPending ? <span className="text-textMuted">{pend(a)}</span> : <span className={dirInk(a.net)}>{signedUsd(a.net)}</span>}
            </Fact>
            <Fact label={`${b.ticker} net`} testId="b-net" title={netTitle}>
              {b.netPending ? <span className="text-textMuted">{pend(b)}</span> : <span className={dirInk(b.net)}>{signedUsd(b.net)}</span>}
            </Fact>
            <Fact label={isLiveDay(todayIso) ? 'Expiring today · net' : `Expired ${shortDay(todayIso)} · net`} testId="same-day" title={`Net premium on each name's contracts ${sameDayWords(todayIso)}, by expiry`}>
              <span className={dirInk(a.odte.net)}>{a.odte.has ? signedUsd(a.odte.net) : '—'}</span> <span className="text-textMuted">·</span> <span className={dirInk(b.odte.net)}>{b.odte.has ? signedUsd(b.odte.net) : '—'}</span>
            </Fact>
            <Champion label={`Leans ${leansWords}`} ink={cmp.bullish.net >= 0 ? 'bull' : 'bear'} onOpen={() => toNetFlow(cmp.bullish.ticker)} title="Put it on Net Flow's pane" testId="bullish">
              {netHeld ? (
                <>
                  {cmp.bullish.ticker} · {signedUsd(cmp.bullish.net)}
                </>
              ) : (
                <span className="text-textMuted">…</span>
              )}
            </Champion>
            {cmp.heavier ? (
              <Champion label="Heavier premium" ink="supreme" title="More premium on its top 80 contracts, packages and legs left out. Put it on Net Flow's pane" onOpen={() => toNetFlow(cmp.heavier!.ticker)} testId="heavier">
                {cmp.heavier.ticker} · {fmtUsd(cmp.heavier.book.premium)}
              </Champion>
            ) : (
              <Fact label="Heavier premium" testId="heavier" title={`Neither name has a contract ${cutWords}`}>
                <span className="text-textMuted">none standing</span>
              </Fact>
            )}
            {regular && (
              <Fact label="Busier tape" testId="busier" title={tapeSince ? `Regular-session prints since ${nyClock(tapeSince * 1000, { seconds: true, zone: true })}, the stretch both tapes cover` : `Each name's last ${TAPE_N} prints`}>
                {!cmp.busier ? (
                  a.tape.prints === 0 ? (
                    <span className="text-textMuted">—</span>
                  ) : (
                    <span>
                      level <span className="text-textMuted">·</span> {num(a.tape.prints)} prints each
                    </span>
                  )
                ) : cmp.busier.tape.prints === 0 ? (
                  <span className="text-textMuted">—</span>
                ) : (
                  (() => {
                    const other = cmp.busier === a ? b : a;
                    const sec = cmp.busier.tape.lastMs && tapeSince ? (Math.max(a.tape.lastMs ?? 0, b.tape.lastMs ?? 0) - tapeSince * 1000) / 1000 : 0;
                    const span = sec >= 1 ? (sec < 90 ? `the last ${Math.round(sec)} seconds` : `the last ${Math.round(sec / 60)} minutes`) : null;
                    return (
                      <>
                        {cmp.busier.ticker} <span className="text-textMuted">·</span> {num(cmp.busier.tape.prints)} prints{span ? ` in ${span}` : ''}
                        <span className="text-textMuted"> · {other.ticker} {num(other.tape.prints)}</span>
                      </>
                    );
                  })()
                )}
              </Fact>
            )}
          </>
        )
      }
      controls={
        <>
          <LiveHold paused={hold.paused} onToggle={hold.toggle} heldAt={hold.heldAt} waitingFirst={hold.waitingFirst} />
          <SessionMark at={bookPack.at} fault={bookPack.fault} paused={hold.paused} kept={bookPack.kept} />
          {/* on a phone the pair takes the whole row and a wide chip wraps inside itself; the extended-hours move hides */}
          <span className="flex items-center gap-1.5 max-sm:col-span-2 max-sm:flex-wrap max-sm:gap-y-2 [&_[data-scope]]:shrink-0 max-sm:[&_[data-scope]]:shrink max-sm:[&_[data-scope]]:max-w-[calc(100%-1rem)] max-sm:[&_[data-scope]]:h-auto max-sm:[&_[data-scope]]:min-h-6 max-sm:[&_[data-scope-pick]]:flex-wrap max-sm:[&_[data-scope-pick]]:py-1 max-sm:[&_[data-scope-pick]]:gap-y-1 max-sm:[&_[data-scope-ext]]:hidden" data-compare-names>
            <span className="inline-flex items-center gap-1.5 min-w-0 max-sm:flex-1" data-compare-pair="a">
              <span className="font-mono text-t9 uppercase tracking-widest text-textMuted shrink-0">A</span>
              <ScopeChip ticker={aTicker} linked={aFollows} full quote closeOutside arrive={false} onToggleLink={() => setAPick(aFollows ? aTicker : null)} onPick={next => (aFollows ? changeTicker(next) : setAPick(next))} />
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
              <span className="font-mono text-t9 uppercase tracking-widest text-textMuted shrink-0">B</span>
              <ScopeChip ticker={bTicker} quote closeOutside arrive={false} onPick={next => setBPick(next)} title="The second name: pick another" />
            </span>
          </span>
          <DropdownSelect label="Clock" value={tenor} options={CLOCK_OPTIONS} onChange={setTenor} title="How far out the contracts run, both names" testId="compare-clock" />
          <DropdownSelect label="Money" value={mny} options={MONEY_OPTIONS} onChange={setMny} title="Which strikes against the stock, both names" testId="compare-money" />
        </>
      }
      sentence={null}
      lead={
        bookState === 'reading'
          ? "Reading the day's book."
          : bookState === 'down'
            ? 'This read did not land — the two names fill when the feed answers.'
            : `${a.ticker} traded ${fmtUsd(a.book.premium)} in options, net ${a.netPending ? '…' : signedUsd(a.net)} into calls over puts; ${b.ticker} ${fmtUsd(b.book.premium)}, net ${b.netPending ? '…' : signedUsd(b.net)}.`
      }
      detail={
        bookState === 'in' ? (
          <>
            {sentence}
            <TermLine keys={['standing', 'floor', 'spreadLegs', 'volOi', 'oiDay', 'stockLike']} testId="compare" />
          </>
        ) : null
      }
    >
      {bookState !== 'in' ? (
        <div className="border-t border-borderSubtle h-40 flex items-center justify-center font-mono text-t11 uppercase tracking-widest text-textMuted" data-compare-empty>
          {bookState === 'reading' ? 'Reading the day’s book' : 'This read did not land'}
        </div>
      ) : (
        <>
          {!phone && panes}

          <div ref={cardRef} className="border-t border-borderSubtle pt-1 pb-2 paper-inset" data-compare-card data-compare-focus={pinned ? '' : undefined} data-compare-wing={wingW}>
            <div className={`${gutter} grid items-center ${phone ? 'gap-x-2' : 'gap-x-4'}`} style={{ gridTemplateColumns: columns, height: CMP_SECTION_H }}>
              <span className="flex items-center justify-end gap-1.5" data-compare-head="a">
                <CompanyLogo ticker={a.ticker} size={14} />
                <span className="font-mono text-t11 font-bold text-textPrimary">{a.ticker}</span>
              </span>
              {/* the spine is the one bright column on paper; paper-* classes leave the dark theme untouched */}
              <span className={`self-stretch flex items-center justify-center paper-panel paper-edge-x font-mono text-t9 uppercase tracking-widest text-textMuted ${phone ? 'bg-borderSubtle/60' : ''}`} data-compare-spine>
                {phone ? '' : 'against'}
              </span>
              <span className="flex items-center gap-1.5" data-compare-head="b">
                <CompanyLogo ticker={b.ticker} size={14} />
                <span className="font-mono text-t11 font-bold text-textPrimary">{b.ticker}</span>
                <span className={`ml-auto font-mono text-t8 uppercase tracking-widest whitespace-nowrap max-sm:hidden ${pinned ? 'text-textSecondary' : 'text-textMuted'}`} data-compare-why>
                  {pinned ? 'in focus · click outside to let go' : 'click a row to keep it'}
                </span>
              </span>
            </div>
            <div className="relative">
              {/* one layer for the blur and the dim; only its opacity animates */}
              <div
                aria-hidden
                data-compare-scrim={pinned ? '' : undefined}
                className={`pointer-events-none absolute inset-0 z-20 transition-opacity duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${pinned ? 'opacity-100' : 'opacity-0'}`}
                style={{ backdropFilter: `blur(${scrim ? 3 : 0}px)`, WebkitBackdropFilter: `blur(${scrim ? 3 : 0}px)`, background: 'rgb(var(--panel) / 0.66)' }}
              />
              {sections.map(sec => (
                <Fragment key={sec.title}>
                  <div className={`${gutter} flex items-center border-t border-borderSubtle/60 paper-indent paper-band paper-bold font-mono text-t9 uppercase tracking-widest text-textPrimary truncate`} style={{ height: CMP_SECTION_H }} data-compare-section={sec.title}>
                    {sec.title}
                  </div>
                  {sec.rows.map(r => (
                    <div
                      key={r.key}
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
                      {phone && (
                        <span className="flex flex-col items-center leading-none pt-1.5 pb-1" data-compare-fact title={r.hint}>
                          <span className="text-t11 text-textSecondary whitespace-nowrap">{r.label}</span>
                          <span className="mt-[3px] text-t95 text-textMuted whitespace-nowrap truncate max-w-full" data-compare-note>
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
                            <span className="text-t11 text-textSecondary group-hover:text-textPrimary transition-colors duration-150 whitespace-nowrap">{r.label}</span>
                            <span className="mt-[3px] text-t95 text-textMuted group-hover:text-textSecondary transition-colors duration-150 whitespace-nowrap truncate max-w-full" data-compare-note>
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

          {/* on a phone the card comes first, so a row stands above the fold; the panes follow it */}
          {phone && panes}
          <div className="grid grid-cols-1 xl:grid-cols-2 border-t border-borderSubtle xl:divide-x divide-borderSubtle paper-inset" data-compare-lists-box>
            <NameLists s={a} side="a" openKey={openKey} onOpen={setOpenKey} mny={mny} todayIso={todayIso} />
            <NameLists s={b} side="b" openKey={openKey} onOpen={setOpenKey} mny={mny} todayIso={todayIso} />
          </div>
        </>
      )}
      <BookDrill list={listed} openKey={openKey} onOpen={setOpenKey} />
    </TraceBox>
  );
};

export default Compare;
