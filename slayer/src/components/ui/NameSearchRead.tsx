/* THE NAME SEARCH'S RIGHT COLUMN (ported from the partner tree's ui/NameSearchRead.tsx, 2026-11-02).

   What a name is worth knowing in one glance, for the highlighted name alone: its last print and the day, the walls of
   its book when the book is already open in this browser, its next report, its latest headlines, its insiders'
   open-market buying and selling over 90 days, Congress's reports over 180 — and Compass's call on it, only while
   Compass has one standing today (the model by name, never a score). Every line is one short line; nothing is a grid.

   Every figure is a real read. The price is the quote store's last print (data/thetaQuote.ts where the page may ask
   the terminal, data/liveQuote.ts elsewhere) by the one session rule (core/session.ts): a print of the session trading
   now says "live"; any other — the weekend's Friday print, the after-hours trade shown overnight — says "as of" its
   time, never live. The walls are a peek at a book already open (data/book/levels.ts); nothing is asked for them. The
   report, the insiders and Congress are the name's own hooks (data/earningsFeed.ts, data/liveRecord.ts), mounted only
   once the name's card (data/nameCard.ts) has seeded their rows; the headlines are read straight off the card.

   THE COLUMN HOLDS ITS SHAPE: every slot is the size of what is coming — a slot still reading shows the skeleton in
   the shape of its lines, a slot with nothing says so in the same tile, and the content fades in where the skeleton
   stood. A section holding more than its slot shows wears a count in its head that is a door: a click unfolds the rest
   below, in place; the slot never grows on its own. */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CalendarDays, ChevronDown, Compass, Landmark, Layers, Newspaper, Users, type LucideIcon } from 'lucide-react';
import CompanyLogo from './CompanyLogo';
import { Skeleton } from './Skeleton';
import type { CardState } from '../../data/nameCard';
import { peekThetaPrice, thetaMove, useThetaPrice } from '../../data/thetaQuote';
import { peekQuote, sessionPrice, useLiveQuote } from '../../data/liveQuote';
import { thetaUseHere } from '../../data/theta';
import { closeMoveTitle, sessionWhen, signedPct } from '../../data/dayChange';
import { extTag, phaseAt, printIsCurrent, whenWords } from '../../core/session';
import { useBookRev } from '../../data/book/store';
import { scopeWalls } from '../../data/book/levels';
import { useNameLevels } from '../../data/levelsScope';
import { useNextReport, untilWords } from '../../data/earningsFeed';
import { useInsiderFlow, useTickerCongress } from '../../data/liveRecord';
import { newsFromWhales } from '../../data/whalesMap';
import { useSignals } from '../../data/compassLedger';
import { useCompassFeed } from '../../data/compassFeed';
import { RIDING_WORD, modelOfBook } from '../../data/compassParams';
import { directoryEntry, kindLabel } from '../../data/symbolDirectory';
import { nyIsoDate } from '../../core/nyTime';
import { CALL_WALL, PUT_WALL } from '../gex/paletteInk';

const NEWS_SHOWN = 2;
const NEWS_UNFOLDED = 8;
const FILINGS_UNFOLDED = 5;
const REPORTS_UNFOLDED = 6;
const fmtPrice = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtLevel = (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));
const dollars = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${Math.round(v)}`);
/** A headline's age in the shortest words: "4m" · "2h" · "3d" */
const ago = (minutes: number) => (minutes < 1 ? 'now' : minutes < 60 ? `${Math.round(minutes)}m` : minutes < 24 * 60 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / (24 * 60))}d`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const BULL = 'rgb(var(--bull))';
const BEAR = 'rgb(var(--bear))';
const moveInk = (v: number | null | undefined) => (v == null || Math.abs(v) < 0.005 ? undefined : v > 0 ? BULL : BEAR);

/* the slots' floors, measured on the loaded column: a slot reading, a slot with nothing and a slot full stand the same height */
const TILE_H = {
  price: 'h-[48px]',
  book: 'min-h-[60px]',
  report: 'min-h-[75px]',
  wire: 'min-h-[84px]',
  insiders: 'min-h-[59px]',
  congress: 'min-h-[35px]',
  compass: 'min-h-[35px]',
} as const;

/** A group's head: the icon in the section's ink, the word, a mark at the right */
const Head = ({ icon: Icon, ink, children, right }: { icon: LucideIcon; ink: string; children: ReactNode; right?: ReactNode }) => (
  <div className="flex items-center gap-1.5 h-5 mb-1">
    <Icon className="w-[13px] h-[13px] shrink-0" style={{ color: ink }} strokeWidth={1.75} aria-hidden />
    <span className="text-t11 font-semibold text-textMuted truncate">{children}</span>
    {right != null && <span className="ml-auto shrink-0 inline-flex items-center gap-1">{right}</span>}
  </div>
);
/** The nested tile; `floor` = the height of its loaded content */
const Tile = ({ children, className = '', floor }: { children: ReactNode; className?: string; floor?: string }) => (
  <div className={`rounded-[10px] border border-ink/[0.06] bg-ink/[0.03] px-3 py-2 ${floor ?? ''} ${className}`}>{children}</div>
);
/** A slot with nothing to show — the word in the middle of the tile's floor, the tile keeps its height */
const Empty = ({ floor, children, kind }: { floor: string; children: ReactNode; kind?: string }) => (
  <Tile floor={floor} className="flex items-center">
    <p className="text-t11 text-textMuted" data-name-read-empty={kind}>{children}</p>
  </Tile>
);
/** A muted label over a brighter value */
const Pair = ({ label, value, ink, sub }: { label: ReactNode; value: ReactNode; ink?: string; sub?: ReactNode }) => (
  <div className="min-w-0 leading-tight">
    <div className="text-t105 text-textMuted truncate">{label}</div>
    <div className="font-mono text-t13 tnum text-textPrimary truncate" style={ink ? { color: ink } : undefined}>
      {value}
    </div>
    {sub != null && <div className="font-mono text-t10 tnum text-textMuted truncate">{sub}</div>}
  </div>
);
/** A tinted pill: the countdown, a count */
const Pill = ({ children, title, className = 'bg-ink/[0.08] text-textPrimary' }: { children: ReactNode; title?: string; className?: string }) => (
  <span className={`inline-flex items-center h-5 px-1.5 rounded-md font-mono text-t105 font-semibold tnum whitespace-nowrap ${className}`} title={title}>
    {children}
  </span>
);
/** THE EXPAND DOOR: the count as a pill that opens — the chevron turns, the rest unfolds under the slot */
const Door = ({ open, onToggle, children, id }: { open: boolean; onToggle: () => void; children: ReactNode; id: string }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-expanded={open}
    className={`inline-flex items-center gap-0.5 h-5 pl-1.5 pr-1 rounded-md font-mono text-t105 font-semibold tnum whitespace-nowrap transition-colors ${open ? 'bg-ink/[0.14] text-textPrimary' : 'bg-ink/[0.08] text-textPrimary hover:bg-ink/[0.12]'}`}
    title={open ? 'Fold' : 'Show them all'}
    data-name-read-door={id}
  >
    {children}
    <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
  </button>
);

/* ── the skeletons: each in the shape of the lines its slot will hold ── */
const Bar = ({ w, h = 11, className = '' }: { w: number | string; h?: number; className?: string }) => <Skeleton line className={className} style={{ width: w, height: h }} />;
const PairBones = ({ sub = false }: { sub?: boolean }) => (
  <div className="flex flex-col gap-[3px] py-[2px]">
    <Bar w={44} h={9} />
    <Bar w={56} h={12} />
    {sub && <Bar w={36} h={8} />}
  </div>
);
const PriceBones = () => (
  <div className={`${TILE_H.price} leading-tight`} data-name-read-bones="price">
    <div className="flex items-end justify-between gap-3 h-7">
      <Bar w={96} h={20} className="mb-[3px]" />
      <Skeleton className="w-20 h-5 rounded-md mb-[3px]" />
    </div>
    <div className="h-[14px] mt-0.5 flex items-center">
      <Bar w={150} h={10} />
    </div>
  </div>
);
const ReportBones = () => (
  <Tile floor={TILE_H.report}>
    <div data-name-read-bones="report">
      <div className="flex items-center gap-1.5 h-5">
        <Bar w={60} h={13} />
        <Bar w={92} h={11} />
      </div>
      <div className="grid grid-cols-2 gap-x-3 mt-2">
        <PairBones />
        <PairBones />
      </div>
    </div>
  </Tile>
);
const WireBones = () => (
  <Tile floor={TILE_H.wire} className="flex flex-col gap-2">
    <div data-name-read-bones="wire" className="contents">
      {[0, 1].map(i => (
        <div key={i} className="flex items-start gap-2">
          <Skeleton className="mt-[5px] w-1.5 h-1.5 rounded-full shrink-0" />
          <div className="min-w-0 flex-1 flex flex-col gap-[5px] py-[2px]">
            <Bar w={i ? '82%' : '94%'} h={10} />
            <Bar w={i ? 96 : 120} h={9} />
          </div>
        </div>
      ))}
    </div>
  </Tile>
);
const InsidersBones = () => (
  <Tile floor={TILE_H.insiders}>
    <div data-name-read-bones="insiders">
      <div className="grid grid-cols-2 gap-x-3">
        <PairBones />
        <PairBones />
      </div>
      <Skeleton className="mt-2 h-1 w-full rounded-full" />
    </div>
  </Tile>
);
const CongressBones = () => (
  <Tile floor={TILE_H.congress} className="flex items-center">
    <div className="flex items-center gap-2 w-full" data-name-read-bones="congress">
      <Bar w={40} h={11} />
      <Bar w="48%" h={11} />
      <Bar w={40} h={9} className="ml-auto" />
    </div>
  </Tile>
);

/* ── THE PRICE: the quote store's last print, named by its session — what it holds at once, its read at the settle ── */
interface PriceRead {
  price: number;
  at: number;
  /** the day's change by the one convention, and its day when it is not today's */
  pct: number | null;
  pctDay: string | null;
  /** the move outside the regular session, with its tag */
  ext: number | null;
  extWord: string | null;
  /** a fresh read of a print made in the session trading now */
  current: boolean;
  title: string;
}
function usePriceRead(symbol: string, asked: boolean): PriceRead | null {
  const theta = thetaUseHere() !== 'none';
  const t = useThetaPrice(asked && theta ? symbol : null).held;
  const q0 = useLiveQuote(asked && !theta ? symbol : null);
  if (theta) {
    const held = t ?? peekThetaPrice(symbol);
    if (!held || !(held.value.price > 0)) return null;
    const p = held.value;
    const mv = thetaMove(p);
    const current = held.live && printIsCurrent(p.at) && phaseAt(Date.now()) !== 'overnight';
    return { price: p.price, at: p.at, pct: mv?.pct ?? null, pctDay: sessionWhen(mv?.regDate), ext: mv?.ext ?? null, extWord: mv?.extWord ?? null, current, title: mv ? closeMoveTitle(mv) : 'The last print' };
  }
  const q = q0 ?? peekQuote(symbol);
  const price = sessionPrice(q);
  if (!q || price == null) return null;
  const current = printIsCurrent(q.tapeAt) && phaseAt(Date.now()) !== 'overnight';
  const pre = q.phase === 'pre';
  return {
    price,
    at: q.tapeAt,
    pct: pre ? q.lastSessionPct : Number.isFinite(q.changePct) ? q.changePct : null,
    pctDay: pre || q.phase !== 'regular' ? sessionWhen(q.regDate) : null,
    ext: q.extPct,
    extWord: q.phase === 'pre' ? 'pre-market' : q.phase === 'regular' ? null : 'after hours',
    current,
    title: 'The last print, the regular session’s change and the move outside it',
  };
}

/* the price is the quote store's own read — the terminal's, one name at a time, the settled one — so it is asked at the
   settle; a read with nothing to say after this long says so */
const PRICE_WAIT_MS = 12_000;
const PriceBlock = ({ symbol }: { symbol: string }) => {
  const r = usePriceRead(symbol, true);
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    setWaited(false);
    const id = window.setTimeout(() => setWaited(true), PRICE_WAIT_MS);
    return () => window.clearTimeout(id);
  }, [symbol]);
  if (!r) {
    /* nothing held yet: the skeleton while the read is on its way, then the honest word */
    return waited ? (
      <div className={`${TILE_H.price} flex items-center`} data-name-read-price="none">
        <span className="font-mono text-t11 text-textMuted">no print on hand yet</span>
      </div>
    ) : (
      <PriceBones />
    );
  }
  return (
    <div className={`${TILE_H.price} leading-tight animate-fade-in`} key={`price-${symbol}`} title={r.title}>
      <div className="flex items-end justify-between gap-3 h-7">
        <div className={`font-mono text-t20 tnum ${r.current ? 'text-textPrimary' : 'text-textSecondary'}`} data-name-read-price={r.price}>
          {fmtPrice(r.price)}
        </div>
        <span className="mb-[3px]">
          {r.current ? (
            <Pill className="bg-bull/15 text-bull" title="A print of the session trading now">live</Pill>
          ) : (
            <Pill className="bg-ink/[0.06] text-textSecondary" title="The last real print — no newer one is on the feed for this session">
              <span data-name-read-asof>as of {whenWords(r.at)}</span>
            </Pill>
          )}
        </span>
      </div>
      <div className="h-[14px] mt-0.5 font-mono text-t11 tnum whitespace-nowrap truncate" data-name-read-move>
        {r.pct != null && (
          <>
            <span style={{ color: moveInk(r.pct) }}>{signedPct(r.pct)}</span>
            <span className="text-textMuted"> {r.pctDay ? r.pctDay : 'today'}</span>
          </>
        )}
        {r.ext != null && Number.isFinite(r.ext) && (
          <span className="text-textMuted">
            {r.pct != null ? ' · ' : ''}
            {extTag(r.extWord)} <span style={{ color: moveInk(r.ext) }}>{signedPct(r.ext)}</span>
          </span>
        )}
      </div>
    </div>
  );
};

/* ── THE BOOK: the walls of a book already open in this browser — a peek, never an ask ── */
const Walls = ({ symbol, spot }: { symbol: string; spot: number | null }) => {
  useBookRev();
  const scope = useNameLevels(symbol);
  const w = scopeWalls(symbol, scope);
  const marks = w
    ? [
        { word: 'Call wall', at: w.callWall, ink: CALL_WALL },
        { word: 'Put wall', at: w.putWall, ink: PUT_WALL },
      ].filter((m): m is { word: string; at: number; ink: string } => m.at != null && Number.isFinite(m.at) && m.at > 0)
    : [];
  if (!marks.length) return <Empty floor={TILE_H.book} kind="book">{w ? 'no walls on the book' : 'the walls read once the name is on a chart'}</Empty>;
  return (
    <Tile floor={TILE_H.book} className="animate-fade-in">
      <div className="grid grid-cols-2 gap-x-3" data-name-read-marks>
        {marks.map(m => (
          <Pair key={m.word} label={`${m.word} · ${scope === 'ALL' ? 'all dates' : 'today'}`} value={fmtLevel(m.at)} ink={m.ink} sub={spot && spot > 0 ? signedPct(((m.at - spot) / spot) * 100) : undefined} />
        ))}
      </div>
    </Tile>
  );
};

/* ── COMPASS: its call on the name, only while one stands today — the model by name, never a score ── */
const CompassCall = ({ symbol }: { symbol: string }) => {
  const feed = useCompassFeed();
  const rows = useSignals();
  const today = nyIsoDate();
  const call = feed.day === today && (feed.status === 'live' || feed.status === 'kept') ? rows.find(r => r.ticker === symbol && r.day === today && !r.would && !r.outcome?.exit) ?? null : null;
  if (!call) return null;
  return (
    <section data-name-read-compass={call.contract}>
      <Head icon={Compass} ink="rgb(var(--silver))">Compass · standing today</Head>
      <Tile floor={TILE_H.compass} className="flex items-center gap-2 animate-fade-in">
        <span className="font-mono text-t12 font-semibold tnum text-textPrimary truncate">
          {fmtLevel(call.strike)}
          <span style={{ color: call.right === 'C' ? CALL_WALL : PUT_WALL }}>{call.right}</span> <span className="text-textMuted font-normal">{call.expiry.slice(5)}</span>
        </span>
        <span className="ml-auto shrink-0 inline-flex items-center gap-1">
          <Pill>{modelOfBook(call.book)}</Pill>
          {call.runner && <Pill>{RIDING_WORD}</Pill>}
        </span>
      </Tile>
    </section>
  );
};

/* ── the slow tables: each slot's hook mounts only once the card has seeded its rows ── */
type Fold = 'wire' | 'filings' | 'reports' | null;

const ReportSlot = ({ symbol }: { symbol: string }) => {
  const next = useNextReport(symbol);
  if (!next) return <Empty floor={TILE_H.report} kind="report">no report on the calendar</Empty>;
  const e = next.event;
  const implied = e && e.impliedMovePct > 0 ? e.impliedMovePct : null;
  const usual = e && e.histAvgMovePct > 0 ? e.histAvgMovePct : null;
  /* the straddle's implied move against the usual one — rich in the warn ink, cheap in the bull's */
  const priced = implied != null && usual != null ? (implied > usual * 1.15 ? 'rgb(var(--warn))' : implied < usual * 0.85 ? BULL : undefined) : undefined;
  return (
    <Tile floor={TILE_H.report} className="animate-fade-in">
      <div className="flex items-center gap-1.5 h-5 text-t13 text-textPrimary" data-name-read-earnings={next.iso}>
        <span className="font-mono font-semibold tnum shrink-0">{next.dateLabel}</span>
        <span className="text-textSecondary truncate min-w-0">· {next.slot === 'BMO' ? 'before the open' : 'after the close'}</span>
        {!next.confirmed && (
          <span className="ml-auto shrink-0 text-t10 text-textMuted whitespace-nowrap" title="An analyst's estimate, not the company's date">
            estimated
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-3 mt-2">
        <Pair label="Implied move" value={implied != null ? `±${implied.toFixed(1)}%` : '—'} ink={priced} />
        <Pair label="Usual move" value={usual != null ? `±${usual.toFixed(1)}%` : '—'} />
      </div>
    </Tile>
  );
};
const ReportCount = ({ symbol }: { symbol: string }) => {
  const next = useNextReport(symbol);
  return next ? <Pill title={next.confirmed ? 'The company set the date' : 'The date is an estimate'}>{untilWords(next.daysOut)}</Pill> : null;
};

const InsidersSlot = ({ symbol, fold, onFold }: { symbol: string; fold: Fold; onFold: (f: Fold) => void }) => {
  const flow = useInsiderFlow(symbol, 90);
  const filings = useMemo(() => [...flow.trades].filter(t => t.value > 0).sort((a, b) => a.daysAgo - b.daysAgo), [flow]);
  const head = (right?: ReactNode) => (
    <Head icon={Users} ink={CALL_WALL} right={right}>
      Insiders · 90 days
    </Head>
  );
  if (flow.status === 'loading') return <>{head()}<InsidersBones /></>;
  if (flow.status !== 'live') return <>{head()}<Empty floor={TILE_H.insiders} kind="insiders">the filings did not answer</Empty></>;
  const { bought, sold } = flow;
  const right = filings.length ? (
    <>
      {flow.buyerCluster > 1 && <Pill>{flow.buyerCluster} buyers</Pill>}
      <Door id="filings" open={fold === 'filings'} onToggle={() => onFold(fold === 'filings' ? null : 'filings')}>
        {plural(filings.length, 'filing', 'filings')}
      </Door>
    </>
  ) : undefined;
  if (bought === 0 && sold === 0) return <>{head(right)}<Empty floor={TILE_H.insiders} kind="insiders">no open-market filings</Empty></>;
  const share = bought / (bought + sold);
  return (
    <>
      {head(right)}
      <Tile floor={TILE_H.insiders} className="animate-fade-in">
        <div className="grid grid-cols-2 gap-x-3" data-name-read-insiders>
          <Pair label="Bought" value={bought > 0 ? dollars(bought) : '—'} ink={bought > 0 ? BULL : undefined} />
          <Pair label="Sold" value={sold > 0 ? dollars(sold) : '—'} ink={sold > 0 ? BEAR : undefined} />
        </div>
        <div className="mt-2 flex h-1 rounded-full overflow-hidden bg-ink/[0.06]" aria-hidden>
          <span className="h-full" style={{ width: `${Math.round(share * 100)}%`, background: BULL }} />
          <span className="h-full flex-1" style={{ background: BEAR }} />
        </div>
        {fold === 'filings' && filings.length > 0 && (
          <ul className="mt-2 pt-2 border-t border-ink/[0.06] flex flex-col gap-1.5 animate-fade-in" data-name-read-unfolded="filings">
            {filings.slice(0, FILINGS_UNFOLDED).map(t => {
              const buy = t.kind === 'BUY';
              return (
                <li key={t.id} className="flex items-baseline gap-2 text-t11" title={`${t.person} — ${t.role}`}>
                  <span className="font-semibold shrink-0" style={{ color: buy ? BULL : BEAR }}>{buy ? 'bought' : 'sold'}</span>
                  <span className="min-w-0 truncate text-textPrimary">{t.person}</span>
                  <span className="ml-auto shrink-0 font-mono text-t105 tnum text-textPrimary">{dollars(t.value)}</span>
                  <span className="shrink-0 font-mono text-t10 tnum text-textMuted">{t.daysAgo}d</span>
                </li>
              );
            })}
          </ul>
        )}
      </Tile>
    </>
  );
};

const CongressSlot = ({ symbol, fold, onFold }: { symbol: string; fold: Fold; onFold: (f: Fold) => void }) => {
  const c = useTickerCongress(symbol, 180);
  const rows = useMemo(() => [...c.trades].sort((a, b) => a.tradedDaysAgo - b.tradedDaysAgo), [c]);
  const right =
    rows.length > 1 ? (
      <Door id="reports" open={fold === 'reports'} onToggle={() => onFold(fold === 'reports' ? null : 'reports')}>
        {plural(rows.length, 'report', 'reports')}
      </Door>
    ) : rows.length ? (
      <Pill>{plural(rows.length, 'report', 'reports')}</Pill>
    ) : undefined;
  const head = (
    <div className="mt-1.5">
      <Head icon={Landmark} ink={PUT_WALL} right={right}>
        Congress · 180 days
      </Head>
    </div>
  );
  if (c.status === 'loading') return <>{head}<CongressBones /></>;
  if (c.status !== 'live') return <>{head}<Empty floor={TILE_H.congress} kind="congress">the reports did not answer</Empty></>;
  if (!rows.length) return <>{head}<Empty floor={TILE_H.congress} kind="congress">no reports</Empty></>;
  return (
    <>
      {head}
      <Tile floor={TILE_H.congress} className="animate-fade-in">
        <ul className="flex flex-col gap-1.5" data-name-read-congress={rows.length}>
          {(fold === 'reports' ? rows.slice(0, REPORTS_UNFOLDED) : rows.slice(0, 1)).map(r => {
            const buy = r.type === 'Purchase';
            return (
              <li key={r.id} className="flex items-baseline gap-2 text-t11" title={`${r.member.name} — ${r.type}, ${r.tradedDaysAgo} days ago`}>
                <span className="font-semibold shrink-0" style={{ color: buy ? BULL : BEAR }}>{buy ? 'purchase' : r.type === 'Exchange' ? 'exchange' : 'sale'}</span>
                <span className="min-w-0 truncate text-textPrimary">{r.member.name}</span>
                <span className="ml-auto shrink-0 font-mono text-t10 tnum text-textMuted">{r.tradedDaysAgo}d ago</span>
              </li>
            );
          })}
        </ul>
      </Tile>
    </>
  );
};

interface Props {
  symbol: string;
  name: string;
  /** The longer rest has come: the card is asked */
  asked: boolean;
  card: CardState | null;
  /** The line under the column: what Enter does here */
  enterWords: string;
}

/** THE READ, one name: price · the book · the report · the wire · whose hands · Compass when it has a call */
const NameSearchRead = ({ symbol, name, asked, card, enterWords }: Props) => {
  /* the doors fold shut when the name changes */
  const [fold, setFold] = useState<Fold>(null);
  useEffect(() => setFold(null), [symbol]);

  const entry = directoryEntry(symbol);
  const index = entry?.kind === 'index';
  /* a fund files no earnings and has no insiders of its own */
  const fund = entry?.kind === 'etf';
  const tag = entry ? [entry.kind !== 'stock' ? kindLabel(entry.kind) : '', !entry.options && entry.kind !== 'index' ? 'no listed options' : ''].filter(Boolean).join(' · ') : '';

  const cardIn = !!card && card.status !== 'loading';
  const tableOk = (t: 'earnings' | 'insiders' | 'congress' | 'news') => cardIn && card!.tables[t] === 'ready';
  const headlines = useMemo(() => {
    if (!card?.news) return [];
    try {
      /* the stories ABOUT the name: the vendor's ticker filter also hands headlines that only say its letters ("spy agency") */
      return newsFromWhales(card.news)
        .filter(n => n.atMs > 0 && (n.ticker === symbol || !!n.tickers?.includes(symbol)))
        .sort((a, b) => b.atMs - a.atMs);
    } catch {
      return [];
    }
  }, [card?.news, symbol]);
  const shownNews = fold === 'wire' ? headlines.slice(0, NEWS_UNFOLDED) : headlines.slice(0, NEWS_SHOWN);
  const held = thetaUseHere() !== 'none' ? peekThetaPrice(symbol)?.value.price ?? null : peekQuote(symbol)?.regularPrice ?? null;
  const missed = <>not read just now — rest on the name again shortly</>;

  return (
    <div className="flex flex-col gap-1.5" data-name-read={symbol} data-name-read-card={card?.status ?? 'waiting'} data-name-read-asked={asked || undefined}>
      <div className="flex items-center gap-2.5">
        <CompanyLogo ticker={symbol} size={28} />
        <div className="min-w-0 leading-tight flex-1">
          <div className="font-mono text-t14 font-bold text-textPrimary">{symbol}</div>
          <div className="text-t11 text-textSecondary truncate">{name && name.toUpperCase() !== symbol ? name : ' '}</div>
        </div>
        {tag && <span className="shrink-0 self-start mt-0.5 font-mono text-t9 uppercase tracking-wider text-textMuted" data-name-read-tag>{tag}</span>}
      </div>

      <PriceBlock symbol={symbol} />

      <section data-name-read-book>
        <Head icon={Layers} ink={CALL_WALL}>The book</Head>
        <Walls symbol={symbol} spot={held} />
      </section>

      <section data-name-read-earnings-slot>
        <Head icon={CalendarDays} ink="rgb(var(--moon))" right={tableOk('earnings') && !index && !fund ? <ReportCount symbol={symbol} /> : undefined}>
          Earnings · next report
        </Head>
        {index || fund ? (
          <Empty floor={TILE_H.report} kind="report">{index ? 'an index reports no earnings' : 'a fund reports no earnings'}</Empty>
        ) : !cardIn ? (
          <ReportBones />
        ) : tableOk('earnings') ? (
          <ReportSlot symbol={symbol} />
        ) : (
          <Empty floor={TILE_H.report} kind="report">{missed}</Empty>
        )}
      </section>

      <section data-name-read-news={headlines.length}>
        <Head
          icon={Newspaper}
          ink="rgb(var(--glacier))"
          right={
            headlines.length > NEWS_SHOWN ? (
              <Door id="wire" open={fold === 'wire'} onToggle={() => setFold(fold === 'wire' ? null : 'wire')}>
                {plural(headlines.length, 'story', 'stories')}
              </Door>
            ) : headlines.length ? (
              <Pill>{plural(headlines.length, 'story', 'stories')}</Pill>
            ) : undefined
          }
        >
          News · the wire
        </Head>
        {!cardIn ? (
          <WireBones />
        ) : !tableOk('news') ? (
          <Empty floor={TILE_H.wire} kind="wire">{missed}</Empty>
        ) : headlines.length ? (
          <Tile floor={TILE_H.wire} className="flex flex-col gap-2 animate-fade-in">
            {shownNews.map(h => {
              const s = h.sentiment;
              const lean = s != null && s > 0.12 ? BULL : s != null && s < -0.12 ? BEAR : 'rgb(var(--text-muted))';
              return (
                <div key={h.id} className="flex items-start gap-2" title={h.headline} data-name-read-story>
                  <span className="mt-[5px] w-1.5 h-1.5 rounded-full shrink-0" style={{ background: lean }} aria-hidden />
                  <div className="min-w-0 flex-1 leading-snug">
                    <div className="text-t11 text-textPrimary truncate">{h.headline}</div>
                    <div className="text-t10 text-textMuted truncate">
                      {h.source} <span className="font-mono tnum">· {ago(h.minutesAgo)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </Tile>
        ) : (
          <Empty floor={TILE_H.wire} kind="wire">quiet on the wire</Empty>
        )}
      </section>

      <section data-name-read-hands>
        {index || fund ? (
          <>
            <Head icon={Users} ink={CALL_WALL}>Insiders · 90 days</Head>
            <Empty floor={TILE_H.insiders} kind="insiders">{index ? 'an index has no insiders' : 'a fund has no insiders of its own'}</Empty>
          </>
        ) : !cardIn ? (
          <>
            <Head icon={Users} ink={CALL_WALL}>Insiders · 90 days</Head>
            <InsidersBones />
          </>
        ) : tableOk('insiders') ? (
          <InsidersSlot symbol={symbol} fold={fold} onFold={setFold} />
        ) : (
          <>
            <Head icon={Users} ink={CALL_WALL}>Insiders · 90 days</Head>
            <Empty floor={TILE_H.insiders} kind="insiders">{missed}</Empty>
          </>
        )}
        {!cardIn ? (
          <>
            <div className="mt-1.5">
              <Head icon={Landmark} ink={PUT_WALL}>Congress · 180 days</Head>
            </div>
            <CongressBones />
          </>
        ) : tableOk('congress') ? (
          <CongressSlot symbol={symbol} fold={fold} onFold={setFold} />
        ) : (
          <>
            <div className="mt-1.5">
              <Head icon={Landmark} ink={PUT_WALL}>Congress · 180 days</Head>
            </div>
            <Empty floor={TILE_H.congress} kind="congress">{missed}</Empty>
          </>
        )}
      </section>

      <CompassCall symbol={symbol} />

      <p className="mt-auto pt-1 font-mono text-t9 text-textMuted leading-relaxed">{enterWords}</p>
    </div>
  );
};

export default NameSearchRead;
