/*
==================================================
  SLAYER TERMINAL - INSIDERS (pages/record/Insiders.tsx)

  What the people who run these companies did with
  their own shares — and whether they chose to. The
  partner's "Keyhole" (2026-09-09) in the house, and
  walked the same evening (Noah: "move onto the
  insiders page"):

    THE HEAD      four facts
    THE CARDS     Window · Show · Role · Names, and
                  the Filter as a card that reads the
                  names, people and roles on the page
    THE SENTENCE
    THE NAMES     where someone chose to buy with
    TO KNOW       their own money, heaviest first —
                  the read the rows alone never gave;
                  a card filters the grid to its name
    THE GRID      in a window a screen tall that
                  scrolls inside itself, its head
                  pinned — the page stays one screen

  Open-market trades by default; the plumbing one
  card away, marked for what it is. A row's name
  opens it on the Map.
==================================================
*/

import { CoSub } from '../../components/record/CoName';
import { CONTROLS_LINE } from '../../components/trace/TraceBox';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { type ColDef, type ICellRendererParams, type IRowNode, type RowClickedEvent } from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import { usePagedGrid, phonePin } from '../../components/record/pagedGrid';
import { GRID_MODULES, GRID_THEME, noRows } from '../../components/ui/houseGrid';
import DropdownSelect, { type DropdownOption } from '../../components/ui/DropdownSelect';
import DropdownMulti, { type MultiGroup } from '../../components/ui/DropdownMulti';
import GuideFocus, { GuideDoor } from '../../components/ui/GuideFocus';
import CompanyLogo from '../../components/ui/CompanyLogo';
import { InsidersGuide } from '../../components/record/InsidersGuide';
import { When } from '../../components/record/when';
import { dollars3 as fmtDollars } from './money';
import { useBoardNames } from '../../data/boardNames';
import { ALL_CODES, OPEN_MARKET_CODES, TX_CODES, insidersSentence, isChosenBuy, isCorporateBuy, personSlug, bigWord, spanWords, splitWords, type SalesSplit } from '../../data/insiders';
import { useInsiderBook, useInsiderBuyers, useInsiderCoverage, useInsidersStatus, useInsiderTrades, wantInsiderWindow, type InsiderCoverage } from '../../data/liveRecord';
import { FeedFallback } from '../../components/ui/liveRead';
import { tickerName } from '../../data/tickers';
import { useCompanyName } from '../../data/liveFiles';
import { nyIsoDaysBack } from '../../data/nyDate';

const titleCase = (raw: string) => raw.trim().split(/\s+/).map(w => (w.length <= 3 && /^[A-Z&.]+$/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase())).join(' ');
import type { InsiderFlow, InsiderRole, InsiderTrade } from '../../types/record';
import { NAMES_TO_KNOW } from './recordSkeletons';
import { InsiderSectorFlow } from '../../components/record/ExtraFaces';
import { CardLine, PhoneCards, usePhoneCards } from '../../components/record/PhoneCards';
import { statHelp } from '../../components/record/statHelp';

type Window = 7 | 30 | 90 | 180;
type Show = 'market' | 'all';
type RolePick = 'any' | InsiderRole;
type NamesPick = 'all' | 'board';

const WINDOW_OPTIONS: DropdownOption<Window>[] = [
  /* THIS WEEK (round 8: the shortest window was 30 days) */
  { value: 7, label: 'This week', short: '7 days', hint: 'Filings in the last seven days' },
  { value: 30, label: '30 days', hint: 'Filings in the last month' },
  { value: 90, label: '90 days', hint: 'The last quarter' },
  { value: 180, label: '180 days', hint: 'The last half year' },
];
const SHOW_OPTIONS: DropdownOption<Show>[] = [
  { value: 'market', label: 'Open-market trades', hint: 'Purchases and sales someone made in the market — the rows that are trades' },
  { value: 'all', label: 'Every filing', short: 'All', hint: 'With the grants, conversions, withholdings and gifts — compensation plumbing, marked for what it is' },
];
const ROLE_OPTIONS: DropdownOption<RolePick>[] = [
  { value: 'any', label: 'Any role', short: 'All', hint: 'Officers, directors and holders of a tenth' },
  { value: 'CEO', label: 'CEO', hint: 'The chief executive' },
  { value: 'CFO', label: 'CFO', hint: 'The chief financial officer' },
  { value: 'COO', label: 'COO', hint: 'The chief operating officer' },
  { value: 'Director', label: 'Director', hint: 'Board members' },
  { value: 'EVP', label: 'EVP', hint: 'Executive vice presidents' },
  { value: 'Chief Legal Officer', label: 'Chief Legal Officer', hint: 'The general counsel' },
  { value: 'Officer', label: 'Other officer', hint: 'Presidents, CTOs, controllers and every other officer title' },
  { value: '10% owner', label: '10% owner', hint: 'Holders of a tenth of the company' },
  { value: 'Other', label: 'Not stated', hint: 'The filing ticked no role and gave no title' },
];
const NAMES_OPTIONS: DropdownOption<NamesPick>[] = [
  { value: 'all', label: 'Every name', short: 'All', hint: 'Every company the terminal files' },
  { value: 'board', label: 'Your board', hint: 'The names on your Board' },
];

/** The engine's word for a name, in the page's ink */
const SIGNAL_WORD: Record<InsiderFlow['signal'], { word: string; ink: string }> = {
  accumulating: { word: 'accumulating', ink: 'text-bull' },
  distributing: { word: 'distributing', ink: 'text-bear' },
  flat: { word: 'flat', ink: 'text-textSecondary' },
  'scheduled selling': { word: 'scheduled selling', ink: 'text-textMuted' },
  quiet: { word: 'quiet', ink: 'text-textMuted' },
};

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

/* ---- cells --------------------------------------------------------------------- */

/* the date, then how far back (the partner's review: never "9d ago" alone) */
const WhenCell = ({ data }: ICellRendererParams<InsiderTrade>) => (data ? <When days={data.daysAgo} /> : null);


const NameCell = ({ data }: ICellRendererParams<InsiderTrade>) =>
  data ? (
    <span className="flex items-center gap-2 min-w-0 w-full h-full overflow-hidden">
      <CompanyLogo ticker={data.ticker} size={16} />
      <span className="flex flex-col leading-tight min-w-0">
        <span className="font-mono text-[12px] font-bold text-textPrimary">{data.ticker}</span>
        <CoSub ticker={data.ticker} fallback={data.company ? titleCase(data.company) : null} />
      </span>
    </span>
  ) : null;

const WhoCell = ({ data }: ICellRendererParams<InsiderTrade>) =>
  data ? (
    <span className="flex flex-col leading-tight min-w-0 text-left" data-open-person={personSlug(data.person)}>
      <span className="text-[12px] font-semibold text-textPrimary truncate" title={data.owners && data.owners.length > 1 ? `One joint filing by ${data.owners.join(', ')} — counted once` : data.person}>
        {data.person}
        {data.owners && data.owners.length > 1 ? <span className="font-mono text-[9px] font-normal text-textMuted"> +{data.owners.length - 1} joint</span> : null}
      </span>
      <span className="text-[10px] text-textMuted truncate" title={data.title ? `Filed as: ${data.title}` : undefined}>{data.role === 'Officer' && data.title ? data.title : data.role === 'Other' ? 'Role not stated' : data.role}</span>
    </span>
  ) : null;

/** The trade in words: bought or sold in the market in the direction inks; the plumbing named and quiet */
const TradeCell = ({ data }: ICellRendererParams<InsiderTrade>) => {
  if (!data) return null;
  const meta = TX_CODES[data.code];
  if (meta.openMarket)
    return (
      <span className={`font-mono text-[11px] tnum ${data.kind === 'BUY' ? 'text-bull' : 'text-bear'}`} title={meta.note}>
        {data.kind === 'BUY' ? 'Bought' : 'Sold'}
      </span>
    );
  return (
    <span className="font-mono text-[10px] text-textMuted" title={meta.note}>
      {meta.label}
    </span>
  );
};

const SharesCell = ({ data }: ICellRendererParams<InsiderTrade>) => (data ? <span className="font-mono text-[11px] tnum text-textPrimary">{fmtInt(data.shares)}</span> : null);
const foreignTip = (t: InsiderTrade) =>
  t.foreignPrice ? `Filed at ${t.price.toFixed(2)} a share in the home market's currency, not dollars — the US listing trades at $${t.foreignPrice.listed.toFixed(2)}. The value (${Math.round(t.foreignPrice.filedValue).toLocaleString('en-US')} in that currency) is kept out of every dollar total` : undefined;
const PriceCell = ({ data }: ICellRendererParams<InsiderTrade>) =>
  data ? (
    data.foreignPrice ? (
      <span className="font-mono text-[11px] tnum text-warn cursor-help" title={foreignTip(data)} data-insider-foreign>
        {data.price.toFixed(2)} <span className="text-[8px] uppercase tracking-widest">not USD</span>
      </span>
    ) : (
      <span className="font-mono text-[11px] tnum text-textSecondary">${data.price.toFixed(2)}</span>
    )
  ) : null;
const ValueCell = ({ data }: ICellRendererParams<InsiderTrade>) =>
  data ? (
    data.foreignPrice ? (
      <span className="font-mono text-[10px] tnum text-textMuted cursor-help" title={foreignTip(data)}>
        not USD
      </span>
    ) : (
      <span className="font-mono text-[11px] tnum font-semibold text-textPrimary">{fmtDollars(data.value)}</span>
    )
  ) : null;
/** What the stake figure means for this row, in words — 100% on a buy is a first position, 100% on a sale an exit */
const stakeWords = (t: InsiderTrade): string => {
  if (t.stakePct < 0) return 'The filing gave no holding before or after, so the share of the stake cannot be read';
  const shares = Math.round(t.shares).toLocaleString('en-US');
  if (t.kind === 'BUY') {
    const after = Math.round(t.heldAfter).toLocaleString('en-US');
    if (t.stakePct >= 99.95) return `${shares} shares bought, and ${after} held after — these are the first shares this filer reports holding`;
    return `${shares} shares bought against ${after} held after the trade: the buy is ${t.stakePct.toFixed(1)}% of what they now hold${t.stakePct >= 49.95 ? ' (at 50% they doubled the position)' : ''}`;
  }
  if (t.stakePct >= 99.95) return `${shares} shares sold — everything this filer reported holding before the sale`;
  return `${shares} shares sold out of the holding before the sale: ${t.stakePct.toFixed(1)}% of it`;
};
/* AN INDIRECT LINE'S STAKE IS THAT LINE'S (the fourth audit, 2026-10-23): "100.0%" on a sale held by a trust is the trust's
   line alone — the filer's direct holding is another line of the filing. Said so on the cell and in its words. */
const stakeTip = (t: InsiderTrade): string => (t.indirect ? `${stakeWords(t)} — of the shares held indirectly (${t.indirect.toLowerCase()}) only; the filer's direct holding is a separate line and is not counted` : stakeWords(t));
/* newest first under a "↓" (the retail test, round 7): recency descending, ties by the filing day, then the id */
const byRecency = (a: number, b: number, na: IRowNode<InsiderTrade>, nb: IRowNode<InsiderTrade>): number =>
  b - a || String(na.data?.filedOn ?? '').localeCompare(String(nb.data?.filedOn ?? '')) || String(nb.data?.id ?? '').localeCompare(String(na.data?.id ?? ''));
const StakeCell = ({ data }: ICellRendererParams<InsiderTrade>) =>
  data ? (
    <span className="font-mono text-[11px] tnum text-textSecondary cursor-help" title={stakeTip(data)}>
      {/* ONE FORMAT (the retail test, round 7: "first purchase", "sold all they held", "<0.1%" and "12.3% of account" in one
          column read as four kinds of figure): always the share of the holding as a percent, the plain word for the ends
          and the account mark beside it, small */}
      {data.stakePct < 0 ? '—' : data.stakePct >= 99.95 ? '100%' : data.stakePct < 0.1 ? '<0.1%' : `${data.stakePct.toFixed(1)}%`}
      {data.stakePct >= 99.95 ? <span className="text-[8px] uppercase tracking-widest text-textMuted"> · {data.kind === 'BUY' ? 'first buy' : 'all sold'}</span> : null}
      {data.indirect && data.stakePct >= 0 ? <span className="text-[8px] uppercase tracking-widest text-textMuted" title="An indirect holding — a trust, a fund or a family member's account the insider reports: the percent is of that account's shares alone, not of everything the insider holds"> · of that account</span> : null}
    </span>
  ) : null;

/** Chosen, planned or unstated — the flag the whole page turns on */
const PlanCell = ({ data }: ICellRendererParams<InsiderTrade>) => {
  if (!data) return null;
  if (!TX_CODES[data.code].openMarket) return <span className="font-mono text-[10px] text-textMuted">—</span>;
  if (data.plan === 'plan') return <span className="font-mono text-[8px] uppercase tracking-widest text-textMuted" title="Planned: the trade ran off a 10b5-1 plan — a schedule the insider fixed months earlier, so it carries no view on the day it happened">planned · 10b5-1</span>;
  if (data.plan === 'unknown') return <span className="font-mono text-[8px] uppercase tracking-widest text-textMuted" title="The filing carried no plan box either way — not counted as chosen buying in the sums above">unstated</span>;
  if (isCorporateBuy(data))
    return (
      <span className="font-mono text-[8px] uppercase tracking-widest text-textSecondary" title="Bought by a company or a fund — a strategic stake or a private placement, not an insider choosing to buy. Not counted in chosen buying">
        corporate
      </span>
    );
  const loud = isChosenBuy(data);
  return (
    <span className={`font-mono text-[8px] uppercase tracking-widest ${loud ? 'text-textPrimary font-bold' : 'text-textSecondary'}`} title={loud ? 'A purchase a person chose to make, not on a 10b5-1 plan — the loudest row here' : 'A trade the insider chose to make'}>
      chosen
    </span>
  );
};

/* THE PHONE CARD — who, what, the value and whether they chose to, on three lines (components/record/PhoneCards.tsx) */
const cellOf = <C,>(Cell: (p: ICellRendererParams<InsiderTrade>) => C, t: InsiderTrade) => Cell({ data: t } as ICellRendererParams<InsiderTrade>);
const InsiderCard = (t: InsiderTrade) => (
  <>
    <CardLine
      left={
        <>
          <span className="font-mono font-bold">{t.ticker}</span> <span className="font-semibold">{t.person}</span>
          {t.owners && t.owners.length > 1 ? <span className="font-mono text-[9px] text-textMuted"> +{t.owners.length - 1} joint</span> : null}
        </>
      }
      right={cellOf(ValueCell, t)}
    />
    <CardLine muted left={<>{t.role === 'Officer' && t.title ? t.title : t.role === 'Other' ? 'Role not stated' : t.role} · {cellOf(TradeCell, t)} · {fmtInt(t.shares)} sh @ {t.foreignPrice ? `${t.price.toFixed(2)} (not USD)` : `$${t.price.toFixed(2)}`}</>} right={cellOf(PlanCell, t)} />
    <CardLine muted left={<When days={t.daysAgo} size={10} />} right={t.clusterCount >= 2 ? <span className="text-[10px]">{t.clusterCount} filers</span> : undefined} />
  </>
);

const OthersCell = ({ data }: ICellRendererParams<InsiderTrade>) => {
  if (!data) return null;
  if (data.clusterCount < 2) return <span className="font-mono text-[10px] text-textMuted">—</span>;
  return (
    <span className="font-mono text-[11px] tnum text-textPrimary" title={`${data.clusterCount} filers did the same in this name inside 30 days`}>
      {data.clusterCount} filers
    </span>
  );
};

/* ---- the names to know --------------------------------------------------------- */

/** One name where someone chose to buy: the mark, the dollars, the filers, the engine's word. A click keeps the grid to it. */
const NameCard = ({ f, on, onToggle }: { f: InsiderFlow; on: boolean; onToggle: () => void }) => {
  const s = SIGNAL_WORD[f.signal];
  /* the feed carries no company name; a name the house list does not file is asked of its own stock card */
  const co = useCompanyName(f.ticker, true);
  const company = co && co.toUpperCase() !== f.ticker ? co : '';
  /* the distinct people who chose to buy in the window (the engine's cluster counts thirty days only) */
  const buyers = new Set(f.trades.filter(t => isChosenBuy(t)).flatMap(t => t.owners ?? [t.person])).size;
  /* THE POSTURE SAYS WHY (the retail pass, 2026-10-22: "AUGO $23M chosen buying · 1 buyer · DISTRIBUTING" read as a
     contradiction): the word weighs chosen buying against chosen selling in the same window, so the selling is shown */
  /* chosen selling on the rule chosen buying uses: what the filing marks chosen — unstated sales are neither */
  const chosenSold = f.chosenSold;
  const why = f.signal === 'distributing' ? ` · ${fmtDollars(chosenSold)} sold by choice outweighs it` : f.signal === 'accumulating' && chosenSold > 0 ? ` · against ${fmtDollars(chosenSold)} sold by choice` : f.signal === 'flat' ? ` · as much sold by choice (${fmtDollars(chosenSold)})` : '';
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      title={on ? `Showing ${f.ticker} only — click to show every name` : `Keep the grid to ${f.ticker}`}
      /* Lifted a tier from the panel (Noah, 2026-09-09: "too many grays … practically invisible"):
         the stronger border on a lighter ground, the words in the secondary and primary inks */
      className={`group text-left rounded-md border px-3 py-2.5 transition-colors ${on ? 'border-silver/60 bg-silver/[0.08]' : 'border-borderMuted bg-card hover:border-silver/40 hover:bg-silver/[0.05]'}`}
      data-insiders-name={f.ticker}
      data-on={on || undefined}
    >
      <span className="flex items-center gap-2 min-w-0">
        <CompanyLogo ticker={f.ticker} size={18} />
        <span className="font-mono text-[12px] font-bold text-textPrimary">{f.ticker}</span>
        {company ? <span className="text-[10px] text-textSecondary truncate">{company}</span> : null}
      </span>
      <span className="mt-1.5 flex items-baseline gap-2 font-mono tnum">
        <span className="text-[13px] font-bold text-bull">{fmtDollars(f.openMarketBuys)}</span>
        <span className="text-[9px] text-textSecondary">chosen buying</span>
        <span className="ml-auto text-[10px] text-textPrimary">
          {buyers} {buyers === 1 ? 'buyer' : 'buyers'}
        </span>
      </span>
      <span className={`mt-1 block font-mono text-[8px] uppercase tracking-widest truncate ${s.ink}`} title={`${s.word}${why} — chosen buying against chosen (not planned) selling in the window`}>
        {s.word}
        <span className="normal-case tracking-normal text-textMuted">{why}</span>
      </span>
    </button>
  );
};

/* ---- what the window really covers ------------------------------------------------- */

const shortDay = (iso: string | null): string => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};

/** One honest line: what each of the three reads covers FOR THIS WINDOW — complete, still reading, or stopped at the
    page cap short of it (the data audit, 2026-10-22: it said "reading further back" after the reading had stopped, and
    kept saying it after the window was cut back to 30 days) */
const CoverageLine = ({ coverage, window }: { coverage: InsiderCoverage; window: number }) => {
  const since = nyIsoDaysBack(window);
  /* complete from the day after the oldest filing read — so the window is covered when that day is on or before its first */
  const covers = (from: string | null, ranOut: boolean) => ranOut || (!!from && from <= nyIsoDaysBack(window - 1));
  const restShort = coverage.restSince != null && coverage.restSince > since;
  const big = `$${(coverage.bigSale / 1e6).toFixed(0)}M`;
  const paged = (from: string | null, ranOut: boolean, reading: boolean, capped: boolean, what: string) =>
    covers(from, ranOut)
      ? `every ${what} filed in the last ${window} days`
      : !from
        ? 'reading'
        : reading
          ? `every ${what} filed since ${shortDay(from)} (reading further back)`
          : capped
            ? `every ${what} filed since ${shortDay(from)} — the read stops there, short of ${window} days`
            : `every ${what} filed since ${shortDay(from)}`;
  const setAside = coverage.notShares + coverage.implausible;
  return (
    <p className="px-5 pb-2 text-[11px] leading-relaxed text-textMuted" data-insiders-coverage title="Unusual Whales sends at most 500 filings a request, newest filed first">
      <span className="text-textSecondary">Purchases:</span> {paged(coverage.buysSince, coverage.buysRanOut, coverage.buysReading, coverage.buysCapped, 'open-market buy')}
      {' · '}
      <span className="text-textSecondary">Sales:</span> {paged(coverage.bigSalesSince, coverage.bigSalesRanOut, coverage.bigSalesReading, coverage.bigSalesCapped, `open-market sale of ${big} or more`)}
      {' · '}
      <span className="text-textSecondary">Smaller sales and other filings:</span>{' '}
      {coverage.restCount === 0
        ? 'reading'
        : restShort
          ? `the latest ${coverage.restCount.toLocaleString()} filed, ${shortDay(coverage.restSince)} – ${shortDay(coverage.restNewest)}`
          : `every one filed in the last ${window} days`}
      {setAside > 0 ? (
        <span title="Swaps, preferreds and other non-share securities on an open-market row, and rows whose filed price is ten times the stock's own or whose value is over a quarter of the company — a unit mix-up, not a trade">
          {' · '}
          {setAside.toLocaleString()} {setAside === 1 ? 'row' : 'rows'} set aside ({coverage.notShares} not common shares, {coverage.implausible} whose price or size no trade can have — a price ten times off the stock's own, or one trade worth over a quarter of the company)
        </span>
      ) : null}
    </p>
  );
};

/* ---- the page ------------------------------------------------------------------ */

const Insiders = () => {
  const navigate = useNavigate();
  const phone = usePhoneCards();
  const boardNames = useBoardNames();
  const [window, setWindow] = useState<Window>(90);
  const [show, setShow] = useState<Show>('market');
  const [role, setRole] = useState<RolePick>('any');
  const [names, setNames] = useState<NamesPick>('all');
  const [guideOpen, setGuideOpen] = useState(false);

  /* The feed is the live record when it answers; the cards cut it, the Filter keeps from the cut */
  const feed = useInsiderTrades(window, show === 'market' ? OPEN_MARKET_CODES : ALL_CODES);
  /* purchases are paged back until the window is covered; the line under the controls says what each part covers */
  useEffect(() => wantInsiderWindow(window), [window]);
  const coverage = useInsiderCoverage();
  /* A failed read is not a quiet quarter: the page says the read did not land, the figures go to dashes */
  const status = useInsidersStatus();
  const failed = status === 'sim';
  const waiting = status === 'loading';
  /* THE TOTALS ARE PARTIAL WHILE THE PAGES LOAD (the retail pass, 2026-10-22: Filings read 4685, then 4900) */
  const reading = coverage.buysReading || coverage.bigSalesReading || coverage.restReading;
  /* PROGRESS, SAID AS HOW FAR BACK (the retail test, 2026-10-23: "reading…" sat for 30s with nothing to say how far it
     had come): the filings are paged newest first, so the totals are complete back to the oldest day both reads reach */
  const readBack = [coverage.buysReading ? coverage.buysSince : null, coverage.bigSalesReading ? coverage.bigSalesSince : null].filter((d): d is string => !!d).sort().reverse()[0] ?? null;
  const readingWord = readBack ? ` · read back to ${shortDay(readBack)} of ${window} days` : ' · reading the first pages';
  const gridEmpty = failed ? 'This read did not land' : waiting ? 'Reading the filings' : 'No filing on this cut';
  const cut = useMemo(() => {
    const board = new Set(boardNames);
    return feed.filter(t => (role === 'any' || t.role === role) && (names === 'all' || board.has(t.ticker)));
  }, [feed, role, names, boardNames]);

  /* THE FILTER reads the names, people and roles on the cut (Noah: "it should read
     whats on the current page … so user can select what to add"); any pick matching keeps the row */
  const [picks, setPicks] = useState<string[]>([]);
  const filterGroups = useMemo<MultiGroup[]>(() => {
    const count = (key: (t: InsiderTrade) => string) => {
      const m = new Map<string, number>();
      cut.forEach(t => m.set(key(t), (m.get(key(t)) ?? 0) + 1));
      return m;
    };
    const byNames = count(t => t.ticker);
    const byPeople = count(t => t.person);
    const byRoles = count(t => t.role);
    picks.forEach(p => {
      const [kind, ...rest] = p.split(':');
      const key = rest.join(':');
      if (kind === 'name' && !byNames.has(key)) byNames.set(key, 0);
      if (kind === 'person' && !byPeople.has(key)) byPeople.set(key, 0);
      if (kind === 'role' && !byRoles.has(key)) byRoles.set(key, 0);
    });
    const order = (a: [string, number], b: [string, number]) => b[1] - a[1] || a[0].localeCompare(b[0]);
    const roleOf = (person: string) => cut.find(t => t.person === person);
    return [
      { title: 'Names', options: [...byNames.entries()].sort(order).map(([n, c]) => ({ value: `name:${n}`, label: n, hint: tickerName(n), count: c })) },
      { title: 'People', options: [...byPeople.entries()].sort(order).map(([p, c]) => ({ value: `person:${p}`, label: p, hint: roleOf(p) ? `${roleOf(p)!.role} · ${roleOf(p)!.ticker}` : undefined, count: c })) },
      { title: 'Roles', options: [...byRoles.entries()].sort(order).map(([r, c]) => ({ value: `role:${r}`, label: r, count: c })) },
    ];
  }, [cut, picks]);
  const paged = usePagedGrid<InsiderTrade>();
  const rows = useMemo(() => {
    if (picks.length === 0) return cut;
    const picked = new Set(picks);
    return cut.filter(t => picked.has(`name:${t.ticker}`) || picked.has(`person:${t.person}`) || picked.has(`role:${t.role}`));
  }, [cut, picks]);
  const toggleName = (ticker: string) => setPicks(p => (p.includes(`name:${ticker}`) ? p.filter(x => x !== `name:${ticker}`) : [...p, `name:${ticker}`]));

  /* THE SALES' COVERAGE, ONE PER FIGURE (the fourth audit, 2026-10-23): $1M+ sales are paged over the whole window, the
     smaller ones only in the latest filings read — when those stop short of the window the figure is the large sales'
     alone and the smaller ones are stated apart, with their days */
  const split = useMemo<SalesSplit | null>(() => {
    const since = nyIsoDaysBack(window - 1);
    if (!coverage.restSince || !coverage.restNewest || coverage.restSince <= since) return null;
    return { big: coverage.bigSale, from: coverage.restSince, to: coverage.restNewest };
  }, [coverage.restSince, coverage.restNewest, coverage.bigSale, window]);
  const facts = useMemo(() => {
    const market = rows.filter(t => TX_CODES[t.code].openMarket);
    const chosen = market.filter(t => isChosenBuy(t)).reduce((s, t) => s + t.value, 0);
    const corporate = market.filter(t => isCorporateBuy(t)).reduce((s, t) => s + t.value, 0);
    const allSales = market.filter(t => t.kind === 'SELL');
    const sales = split ? allSales.filter(t => t.value >= split.big) : allSales;
    const small = split ? allSales.filter(t => t.value < split.big) : [];
    const sold = sales.reduce((s, t) => s + t.value, 0);
    const planned = sales.filter(t => t.plan === 'plan').length;
    return { filings: rows.length, chosen, corporate, sold, sales: sales.length, smallSold: small.reduce((s, t) => s + t.value, 0), smallCount: small.length, plannedPct: sales.length ? Math.round((planned / sales.length) * 100) : null };
  }, [rows, split]);

  /* THE NAMES TO KNOW: chosen buying in the window, heaviest first, on the Names card's cut */
  const buyers = useInsiderBuyers(window);
  const toKnow = useMemo(() => {
    const board = new Set(boardNames);
    return buyers.filter(f => names === 'all' || board.has(f.ticker)).slice(0, NAMES_TO_KNOW);
  }, [buyers, names, boardNames]);

  const columnDefs = useMemo<ColDef<InsiderTrade>[]>(
    () => [
      { headerName: 'When', field: 'daysAgo', width: 146, cellRenderer: WhenCell, sort: 'desc', comparator: byRecency, headerTooltip: 'The day the trade happened, and how far back that is — newest first' },
      { headerName: 'Name', field: 'ticker', flex: 1.3, minWidth: 150, cellRenderer: NameCell, headerTooltip: 'The company' },
      { headerName: 'Who', field: 'person', flex: 1.4, minWidth: 160, cellRenderer: WhoCell, headerTooltip: 'A row opens this person’s book' },
      { headerName: 'Trade', field: 'code', flex: 0.9, minWidth: 120, cellRenderer: TradeCell, headerTooltip: 'Bought or sold in the market; with Every filing on, the grants, conversions and withholdings are named for what they are' },
      { headerName: 'Shares', field: 'shares', width: 100, cellRenderer: SharesCell, type: 'rightAligned', headerTooltip: 'Shares in the transaction' },
      { headerName: 'Price', field: 'price', width: 96, cellRenderer: PriceCell, type: 'rightAligned', headerTooltip: 'The filed price per share' },
      { headerName: 'Value', field: 'value', width: 104, cellRenderer: ValueCell, type: 'rightAligned', headerTooltip: 'Shares times the filed price' },
      { headerName: 'Of holding', field: 'stakePct', width: 176, cellRenderer: StakeCell, type: 'rightAligned', headerTooltip: "The share of the insider's holding this trade was, as a percent — 100% · first buy when they held none before, 100% · all sold when nothing was left; · of account marks an indirect line (a trust, a fund), which counts that account alone" },
      {
        headerName: 'Chose to?',
        field: 'plan',
        width: 104,
        cellRenderer: PlanCell,
        comparator: (a: InsiderTrade['plan'], b: InsiderTrade['plan']) => ['discretionary', 'unknown', 'plan'].indexOf(a) - ['discretionary', 'unknown', 'plan'].indexOf(b),
        headerTooltip: 'Chosen: the insider decided to trade. Planned: it ran off a 10b5-1 schedule adopted months earlier. Unstated: the filing carried no box either way',
      },
      { headerName: 'Others', field: 'clusterCount', width: 84, cellRenderer: OthersCell, headerTooltip: 'How many distinct filers did the same in this name inside 30 days — a cluster is a stronger read than one' },
    ],
    []
  );
  const defaultColDef = useMemo<ColDef<InsiderTrade>>(() => ({ sortable: true, resizable: true, suppressMovable: true }), []);
  const open = (e: RowClickedEvent<InsiderTrade>) => {
    if (!e.data) return;
    navigate(`/dossier/insiders/${personSlug(e.data.person)}`);
  };

  return (
    <div className="relative border border-borderSubtle rounded-md overflow-hidden bg-panel flex flex-col" data-insiders data-window={window} data-show={show}>
      <GuideFocus open={guideOpen} onClose={() => setGuideOpen(false)} title="How to read the filings" testId="insiders-guide" viewport>
        <InsidersGuide />
      </GuideFocus>
      {/* THE HEAD */}
      <div className="px-5 pt-4 pb-3 flex items-start gap-6 flex-wrap">
        <div className="min-w-[min(18rem,100%)] flex-1">
          <div className="h-6 flex items-center gap-3">
            <h3 className="text-[15px] font-semibold leading-tight text-textPrimary whitespace-nowrap">What insiders did</h3>
            <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What a row, a chosen trade and a plan mean" testId="insiders-guide" />
          </div>
          <p className="mt-0.5 text-[11px] text-textMuted whitespace-nowrap truncate">
            {show === 'market' ? 'Open-market purchases and sales only' : 'Every filing, the plumbing named for what it is'} · newest first · a row opens their book
          </p>
          {/* THE READ'S PROGRESS, UP FRONT (audit round 5: "read back to Aug 22 of 90 days · partial" was a quiet footnote) */}
          {!failed && (
            <p className={`mt-1 font-mono text-[10px] uppercase tracking-widest ${reading || waiting ? 'text-warn' : 'text-textSecondary'}`} data-insiders-progress={reading || waiting ? 'reading' : 'complete'}>
              {waiting
                ? `Reading the filings · 0 of ${window} days so far`
                : reading
                  ? `Reading · ${readBack ? Math.max(0, Math.min(window, Math.round((Date.parse(`${nyIsoDaysBack(0)}T12:00:00Z`) - Date.parse(`${readBack}T12:00:00Z`)) / 86_400_000))) : 0} of ${window} days so far — the totals beside are provisional and grow as older filings land`
                  : `Complete · the read is done for ${window} days (what each part covers is under the controls)`}
            </p>
          )}
        </div>
        {/* PROVISIONAL, SAID AND SHOWN (round 8: the totals moved under "READING · 71 OF 90 DAYS" with nothing on them to
            say so) — while the read pages back the figures are greyed, each marked "so far" */}
        <dl className={`flex flex-wrap gap-x-6 gap-y-2 transition-opacity ${reading && !failed && !waiting ? 'opacity-60' : ''}`} data-insiders-provisional={reading && !failed && !waiting ? 'yes' : undefined} title={reading && !failed && !waiting ? 'Provisional — the filings are still being read back; these totals grow until the window is complete' : undefined}>
          <div>
            <dt className="text-[10px] text-textMuted cursor-help" title="Rows on the grid right now, after the window and the cards above">Filings</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary whitespace-nowrap" data-insiders-count>
              {failed || waiting ? '—' : facts.filings.toLocaleString()}
              {reading && !failed && !waiting ? <span className="text-[9px] text-textMuted" title="The filings are still being paged back, newest first; the totals grow until the window is read">{readingWord}</span> : null}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] text-textMuted cursor-help" title="Purchases (code P — on the open market or in a private placement) that a person chose to make, not on a 10b5-1 plan. Purchases by companies and funds — strategic stakes — are counted apart under Company & fund buys">Chosen buying</dt>
            <dd className={`mt-0.5 font-mono text-[12px] tnum whitespace-nowrap ${facts.chosen > 0 ? 'text-bull' : 'text-textMuted'}`} data-insiders-chosen>
              {failed || waiting ? '—' : facts.chosen > 0 ? fmtDollars(facts.chosen) : 'none'}
              {reading && !failed && !waiting ? <span className="text-[9px] text-textMuted" title={`Still paging back${readBack ? ` — complete from ${shortDay(readBack)}` : ''}`}> · so far</span> : null}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] text-textMuted cursor-help" title="Code-P purchases by a company or a fund (Volkswagen buying Rivian, a bank buying into a broker): strategic stakes and private placements, not an insider choosing to buy">Company &amp; fund buys</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary whitespace-nowrap" data-insiders-corporate>
              {failed || waiting ? '—' : facts.corporate > 0 ? fmtDollars(facts.corporate) : 'none'}
              {reading && !failed && !waiting ? <span className="text-[9px] text-textMuted" title={`Still paging back${readBack ? ` — complete from ${shortDay(readBack)}` : ''}`}> · so far</span> : null}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] text-textMuted cursor-help" title={split ? `Dollars of shares insiders sold in the open market — planned or not. ${splitWords(split, window)}: the figure is the ${bigWord(split.big)}+ sales of the whole window; the smaller ones (${facts.smallCount.toLocaleString()} for ${fmtDollars(facts.smallSold)}) cover only those days and are kept out of it` : 'Dollars of shares insiders sold in the open market — planned or not'}>
              {split ? `Sold · sales of ${bigWord(split.big)}+` : 'Sold in the market'}
            </dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary whitespace-nowrap" data-insiders-sold>
              {failed || waiting ? '—' : facts.sold > 0 ? fmtDollars(facts.sold) : 'none'}
              {split && !failed && !waiting ? <span className="text-[9px] text-textMuted"> · {window} days{facts.smallCount ? ` · + ${fmtDollars(facts.smallSold)} smaller, ${spanWords(split.from, split.to)}` : ''}</span> : null}
              {reading && !failed && !waiting ? <span className="text-[9px] text-textMuted" title={`Still paging back${readBack ? ` — complete from ${shortDay(readBack)}` : ''}`}> · so far</span> : null}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] text-textMuted cursor-help" title={`The share of those sales${split ? ` (the ${bigWord(split.big)}+ ones)` : ''} that ran off a 10b5-1 plan: a schedule set months earlier, so it says little about today`}>Sales on a plan</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary whitespace-nowrap" data-insiders-planned>
              {facts.plannedPct == null ? '—' : `${facts.plannedPct}%`}
              {reading && !failed && !waiting ? <span className="text-[9px] text-textMuted" title={`Still paging back${readBack ? ` — complete from ${shortDay(readBack)}` : ''}`}> · so far</span> : null}
            </dd>
          </div>
        </dl>
      </div>
      {/* THE ONE LINE OF CONTROLS */}
      <div className={`px-5 pb-2 ${CONTROLS_LINE}`} data-insiders-controls>
        <DropdownSelect label="Window" value={window} options={WINDOW_OPTIONS} onChange={setWindow} title="How far back the filings run" testId="insiders-window" />
        <DropdownSelect label="Show" value={show} options={SHOW_OPTIONS} onChange={setShow} title="Trades only, or every filing" testId="insiders-show" />
        <DropdownSelect label="Role" value={role} options={ROLE_OPTIONS} onChange={setRole} title="Whose filings" testId="insiders-role" />
        <DropdownSelect label="Names" value={names} options={NAMES_OPTIONS} onChange={setNames} title="Which companies" testId="insiders-names" />
        <DropdownMulti label="Filter" values={picks} groups={filterGroups} onChange={setPicks} title="The names, people and roles on the page right now — tick any number; only those stay" testId="insiders-filter" />
      </div>
      {!failed && !waiting && <CoverageLine coverage={coverage} window={window} />}
      {failed ? (
        <FeedFallback />
      ) : (
        <p className="px-5 pb-3 text-[12px] leading-relaxed text-textSecondary" data-insiders-sentence>
          {waiting ? 'Reading the filings.' : `${reading ? 'So far: ' : ''}${insidersSentence(rows, window, split)}`}
        </p>
      )}
      {!failed && (
        <p className="px-5 pb-3 -mt-1 text-[11px] leading-relaxed text-textMuted" data-insiders-words>
          <span className="text-textSecondary">Planned · 10b5-1</span> — sold or bought on a schedule the insider fixed months earlier, so it says little about the day. <span className="text-textSecondary">Of that account</span> — the trade was in a trust, a fund or a family member's account the insider reports; the percent is of that account alone.
        </p>
      )}
      {/* THE NAMES TO KNOW */}
      <div className="px-5 pb-3 border-t border-borderSubtle/60" data-insiders-to-know>
        {/* on a phone the head stacks: the label over its words (the device sweep, 2026-10-19: on one line they ran into each other) */}
        <div className="h-[26px] flex items-center gap-3 text-[10px] font-semibold uppercase tracking-widest text-textPrimary max-sm:h-auto max-sm:flex-col max-sm:items-start max-sm:gap-0.5 max-sm:py-1.5">
          <span>The names to know</span>
          <span className="normal-case tracking-normal font-normal text-[10px] text-textSecondary">where a person chose to buy (not on a plan, not a company or fund) in the last {window} days, heaviest first · click a name to keep the grid to it</span>
        </div>
        {toKnow.length === 0 ? (
          <div className="h-[70px] flex items-center font-mono text-[10px] uppercase tracking-widest text-textMuted">{failed ? 'This read did not land' : waiting ? 'Reading the filings' : 'No insider chose to buy in this window'}</div>
        ) : (
          <div
            /* every name across from 1280; six on a small laptop, four on a tablet, two on a phone (the device sweep,
               2026-10-18: the cards' figures cut at 360 and 768) */
            className="grid gap-2 grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-[repeat(var(--names),minmax(0,1fr))]" style={{ '--names': NAMES_TO_KNOW } as CSSProperties}>
            {toKnow.map(f => (
              <NameCard key={f.ticker} f={f} on={picks.includes(`name:${f.ticker}`)} onToggle={() => toggleName(f.ticker)} />
            ))}
          </div>
        )}
      </div>
      {/* THE GRID — grown to its rows, the page scrolls (2026-09-11, the Compass board's rule) */}
      <div className="slayer-board border-t border-borderSubtle" data-insiders-grid>
        {phone ? (
          <PhoneCards rows={rows} rowKey={t => t.id} card={InsiderCard} onOpen={t => navigate(`/dossier/insiders/${personSlug(t.person)}`)} empty={gridEmpty} testId="insiders" resetKey={rows} />
        ) : (
        <>
        <AgGridProvider modules={GRID_MODULES}>
          <AgGridReact<InsiderTrade>
            {...phonePin}
            {...paged.props}
            theme={GRID_THEME}
            domLayout="autoHeight"
            rowData={rows}
            overlayNoRowsTemplate={noRows(gridEmpty)}
            /* the overlay is read once, so a new state is a new grid */
            key={gridEmpty}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            getRowId={p => p.data.id}
            onRowClicked={open}
            rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
            suppressCellFocus
            animateRows
            tooltipShowDelay={350}
            tooltipHideDelay={8000}
          />
        </AgGridProvider>
        {paged.bar(rows.length, 'insiders-grid')}
        </>
        )}
      </div>
      <InsiderSectorFlow trades={rows} windowDays={window} state={failed ? 'failed' : waiting || reading ? 'reading' : 'read'} />
    </div>
  );
};

export const InsiderFile = () => {
  const { person = '' } = useParams();
  const phone = usePhoneCards();
  const book = useInsiderBook(decodeURIComponent(person));
  const [show, setShow] = useState<'all' | 'market'>('all');
  const rows = useMemo(() => {
    if (!book) return [];
    return show === 'market' ? book.trades.filter(t => TX_CODES[t.code].openMarket) : book.trades;
  }, [book, show]);
  const bought = rows.filter(t => TX_CODES[t.code].openMarket && t.kind === 'BUY').reduce((s, t) => s + t.value, 0);
  const sold = rows.filter(t => TX_CODES[t.code].openMarket && t.kind === 'SELL').reduce((s, t) => s + t.value, 0);
  const planned = rows.filter(t => t.plan === 'plan').length;
  const cols = useMemo<ColDef<InsiderTrade>[]>(
    () => [
      { headerName: 'When', field: 'daysAgo', width: 146, cellRenderer: WhenCell, sort: 'desc', comparator: byRecency, headerTooltip: 'The day of the trade, and how long ago' },
      {
        headerName: 'Name',
        headerTooltip: 'The company',
        field: 'ticker',
        flex: 1.3,
        minWidth: 160,
        cellRenderer: ({ data }: ICellRendererParams<InsiderTrade>) =>
          data ? (
            <span className="inline-flex items-center gap-2 min-w-0">
              <CompanyLogo ticker={data.ticker} size={16} />
              <span className="font-mono text-[12px] font-bold text-textPrimary">{data.ticker}</span>
              <CoSub ticker={data.ticker} fallback={data.company ? titleCase(data.company) : null} />
            </span>
          ) : null,
      },
      { headerName: 'Trade', field: 'code', flex: 1, minWidth: 140, cellRenderer: TradeCell, headerTooltip: 'What the filing says happened — bought or sold in the market, or a grant, exercise, tax withholding or gift' },
      { headerName: 'Shares', field: 'shares', width: 100, cellRenderer: SharesCell, type: 'rightAligned', headerTooltip: 'Shares in the transaction' },
      { headerName: 'Price', field: 'price', width: 96, cellRenderer: PriceCell, type: 'rightAligned', headerTooltip: 'The price per share on the filing' },
      { headerName: 'Value', field: 'value', width: 110, cellRenderer: ValueCell, type: 'rightAligned', headerTooltip: 'Shares times the filed price' },
      { headerName: 'Chose to?', field: 'plan', width: 104, cellRenderer: PlanCell, headerTooltip: 'Chosen: the insider decided to trade. Planned: it ran off a 10b5-1 schedule set months earlier. Unstated: the filing ticked neither box' },
    ],
    [],
  );
  if (book === undefined) {
    return (
      <>
        <Link to="/dossier/insiders" className="group inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors" data-name-back>
          <ArrowLeft className="w-3.5 h-3.5 transition-transform duration-200 ease-out group-hover:-translate-x-0.5" /> Insiders
        </Link>
        <div className="border border-borderSubtle rounded-md bg-panel px-5 py-4 text-[12px] text-textSecondary">Reading the filings.</div>
      </>
    );
  }
  if (!book) {
    return (
      <>
        <Link to="/dossier/insiders" className="group inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors" data-name-back>
          <ArrowLeft className="w-3.5 h-3.5 transition-transform duration-200 ease-out group-hover:-translate-x-0.5" /> Insiders
        </Link>
        <div className="border border-borderSubtle rounded-md bg-panel px-5 py-4 text-[12px] text-textSecondary">That person is not on this book.</div>
      </>
    );
  }
  return (
    <>
      <Link to="/dossier/insiders" className="group inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors" data-name-back>
        <ArrowLeft className="w-3.5 h-3.5 transition-transform duration-200 ease-out group-hover:-translate-x-0.5" /> Insiders
      </Link>
      <div className="relative border border-borderSubtle rounded-md overflow-hidden bg-panel flex flex-col" data-insider-file={book.person}>
        <div className="px-5 pt-4 pb-3 flex items-start gap-6 flex-wrap">
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold leading-tight text-textPrimary">{book.person}</h3>
            <p className="mt-0.5 text-[11px] text-textMuted whitespace-nowrap truncate">
              {book.role} · {book.ticker} ·{' '}
              {book.windowDays > 0
                ? `${book.by === 'cik' ? 'every filing under their SEC id' : 'every filing under this name'} with a trade in the last year, the grants included${book.capped ? ' — the latest 500 only' : ''}`
                : 'their filings in the market feed this page read — their own file did not answer'}
            </p>
            {book.by === 'name' && book.filers > 1 ? (
              <p className="mt-0.5 text-[10px] text-warn">{book.filers} SEC filers share this name; the rows may be more than one person.</p>
            ) : null}
          </div>
          <dl className="flex flex-wrap gap-x-6 gap-y-2">
            <div>
              <dt className="text-[10px] text-textMuted cursor-help" title="Rows on the grid right now, after the window and the cards above">Filings</dt>
              <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary">{rows.length}</dd>
            </div>
            <div>
              <dt className="text-[10px] text-textMuted cursor-help" title={statHelp("Bought")}>Bought</dt>
              <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary">{bought > 0 ? fmtDollars(bought) : rows.some(t => t.foreignPrice && TX_CODES[t.code].openMarket && t.kind === 'BUY') ? 'not in USD' : 'none'}</dd>
            </div>
            <div>
              <dt className="text-[10px] text-textMuted cursor-help" title={statHelp("Sold")}>Sold</dt>
              <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary">{sold > 0 ? fmtDollars(sold) : rows.some(t => t.foreignPrice && TX_CODES[t.code].openMarket && t.kind === 'SELL') ? 'not in USD' : 'none'}</dd>
            </div>
            <div>
              <dt className="text-[10px] text-textMuted cursor-help" title={statHelp("On a plan")}>On a plan</dt>
              <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary">{planned}</dd>
            </div>
          </dl>
        </div>
        <div className={`px-5 pb-2 ${CONTROLS_LINE}`}>
          <DropdownSelect
            label="Show"
            value={show}
            options={[
              { value: 'all', label: 'Every filing', short: 'All', hint: 'Trades, grants, conversions and tax' },
              { value: 'market', label: 'Trades only', hint: 'Bought or sold in the market' },
            ]}
            onChange={setShow}
            title="Trades only, or every filing"
            testId="insider-show"
          />
        </div>
        <p className="px-5 pb-3 text-[12px] leading-relaxed text-textSecondary" data-insider-sentence>
          {(() => {
            const names = [...new Set(book.trades.map(t => t.ticker))];
            return `${book.person} filed ${book.trades.length} ${book.trades.length === 1 ? 'row' : 'rows'}${book.windowDays > 0 ? ' in the last year' : ''}, at ${names.length === 1 ? names[0] : `${names.length} companies (${names.slice(0, 4).join(', ')}${names.length > 4 ? '…' : ''})`}.`;
          })()}{' '}
          {(() => {
            /* "0 of them never reached the market" read as a double negative — say how many were grants, awards or
               withholdings only when there were some */
            const off = book.trades.length - book.trades.filter(t => TX_CODES[t.code].openMarket).length;
            return off === 0 ? (book.trades.length === 1 ? 'It was an open-market trade.' : 'Every one was an open-market trade.') : `${off} of them never reached the market — grants, awards or shares withheld for tax.`;
          })()}
          {(() => {
            const foreign = book.trades.filter(t => t.foreignPrice).length;
            return foreign ? ` ${foreign} ${foreign === 1 ? 'row is' : 'rows are'} priced in the home market's currency, not dollars — flagged "not USD" and kept out of the dollar totals.` : '';
          })()}
        </p>
        <div className="slayer-board border-t border-borderSubtle" data-insider-trades>
          {phone ? (
            <PhoneCards rows={rows} rowKey={t => t.id} card={InsiderCard} empty="No filing on this book" testId="insider-trades" resetKey={show} />
          ) : (
          <AgGridProvider modules={GRID_MODULES}>
            <AgGridReact<InsiderTrade>
              {...phonePin}
              theme={GRID_THEME}
              domLayout="autoHeight"
              rowData={rows}
              overlayNoRowsTemplate={noRows('No filing on this book')}
              columnDefs={cols}
              defaultColDef={{ sortable: true, resizable: true, suppressMovable: true }}
              getRowId={p => p.data.id}
              suppressCellFocus
              animateRows={false}
            />
          </AgGridProvider>
          )}
        </div>
      </div>
    </>
  );
};

export default Insiders;
