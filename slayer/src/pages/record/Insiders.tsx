/* What insiders did with their own shares, and whether they chose to: the head's facts, the controls, the names where
   someone chose to buy, then every filing (open-market trades by default, the plumbing one control away). */

import { CoSub } from '../../components/record/CoName';
import { useEffect, useMemo, useState } from 'react';
import { keptPick, keptStrings, readKeptView, useKeepView } from './keptView';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { type ColDef, type ICellRendererParams, type IRowNode } from 'ag-grid-community';
import { Controls, HeadFact, PhoneFold, RecordGrid, RecordHead, RecordPanel, Summary, ToKnow } from '../../components/record/RecordFrame';
import DropdownSelect, { type DropdownOption } from '../../components/ui/DropdownSelect';
import DropdownMulti, { type MultiGroup } from '../../components/ui/DropdownMulti';
import CompanyLogo from '../../components/ui/CompanyLogo';
import { InsidersGuide } from '../../components/record/InsidersGuide';
import { When } from '../../components/record/when';
import { dollars3 as fmtDollars } from './money';
import { useBoardNames } from '../../data/boardNames';
import { ALL_CODES, OPEN_MARKET_CODES, TX_CODES, insidersSentence, isChosenBuy, isCorporateBuy, isCorporateTrade, personSlug, bigWord, spanWords, summariseFlow, type SalesSplit } from '../../data/insiders';
import { useInsiderBook, useInsiderCoverage, useInsidersStatus, useInsiderTrades, useKeptAt, wantInsiderWindow, type InsiderCoverage } from '../../data/liveRecord';
import { FeedFallback } from '../../components/ui/liveRead';
import { personDisplay, tickerName } from '../../data/tickers';
import { useCompanyName } from '../../data/liveFiles';
import { titleCompany } from '../../data/tickers';
import { nyIsoDaysBack } from '../../data/nyDate';

const titleCase = (raw: string) => titleCompany(raw.trim().toUpperCase());
import type { InsiderFlow, InsiderRole, InsiderTrade } from '../../types/record';
import { NAMES_TO_KNOW } from './recordSkeletons';
import { InsiderSectorFlow } from '../../components/record/ExtraFaces';
import { CardLine } from '../../components/record/PhoneCards';

type Window = 7 | 30 | 90 | 180;
type Show = 'market' | 'all';
type RolePick = 'any' | InsiderRole;
type NamesPick = 'all' | 'board';

const WINDOW_OPTIONS: DropdownOption<Window>[] = [
  /* this week */
  /* one word for it everywhere */
  { value: 7, label: '7 days', hint: 'Filings in the last seven days' },
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

/* the date, then how far back */
/* the date over its distance: the column is half as wide, so the grid fits a 1280 screen without a sideways scroll */
const WhenCell = ({ data }: ICellRendererParams<InsiderTrade>) => (data ? <When days={data.daysAgo} stack /> : null);


const NameCell = ({ data }: ICellRendererParams<InsiderTrade>) =>
  data ? (
    <span className="flex items-center gap-2 min-w-0 w-full h-full overflow-hidden">
      <CompanyLogo ticker={data.ticker} size={16} />
      <span className="flex flex-col leading-tight min-w-0">
        <span className="font-mono text-t12 font-bold text-textPrimary">{data.ticker}</span>
        <CoSub ticker={data.ticker} fallback={data.company ? titleCase(data.company) : null} />
      </span>
    </span>
  ) : null;

const WhoCell = ({ data }: ICellRendererParams<InsiderTrade>) =>
  data ? (
    <span className="flex flex-col leading-tight min-w-0 text-left" data-open-person={personSlug(data.person)}>
      <span className="text-t12 font-semibold text-textPrimary truncate" title={data.owners && data.owners.length > 1 ? `One joint filing by ${data.owners.map(personDisplay).join(', ')} — counted once` : personDisplay(data.person)}>
        {personDisplay(data.person)}
        {data.owners && data.owners.length > 1 ? <span className="font-mono text-t9 font-normal text-textMuted"> +{data.owners.length - 1} joint</span> : null}
      </span>
      <span className="text-t10 text-textMuted truncate" title={data.title ? `Filed as: ${data.title}` : undefined}>{data.role === 'Officer' && data.title ? data.title : data.role === 'Other' ? 'Role not stated' : data.role}</span>
    </span>
  ) : null;

/** The trade in words: bought or sold in the market in the direction inks; the plumbing named and quiet */
const TradeCell = ({ data }: ICellRendererParams<InsiderTrade>) => {
  if (!data) return null;
  const meta = TX_CODES[data.code];
  if (meta.openMarket)
    return (
      <span className={`font-mono text-t11 tnum ${data.kind === 'BUY' ? 'text-bull' : 'text-bear'}`} title={meta.note}>
        {data.kind === 'BUY' ? 'Bought' : 'Sold'}
      </span>
    );
  return (
    <span className="inline-block whitespace-normal leading-tight font-mono text-t10 text-textMuted" title={meta.note}>
      {meta.label}
    </span>
  );
};

const SharesCell = ({ data }: ICellRendererParams<InsiderTrade>) => (data ? <span className="font-mono text-t11 tnum text-textPrimary">{fmtInt(data.shares)}</span> : null);
const foreignTip = (t: InsiderTrade) =>
  t.foreignPrice ? `Filed at ${t.price.toFixed(2)} a share in the home market's currency, not dollars — the US listing trades at $${t.foreignPrice.listed.toFixed(2)}. The value (${Math.round(t.foreignPrice.filedValue).toLocaleString('en-US')} in that currency) is kept out of every dollar total` : undefined;
const PriceCell = ({ data }: ICellRendererParams<InsiderTrade>) =>
  data ? (
    data.foreignPrice ? (
      <span className="font-mono text-t11 tnum text-warn cursor-help" title={foreignTip(data)} data-insider-foreign>
        {data.price.toFixed(2)} <span className="text-t8 uppercase tracking-widest">not USD</span>
      </span>
    ) : (
      <span className="font-mono text-t11 tnum text-textSecondary" title={data.price > 0 ? undefined : 'No price on the filing — a grant or award is not bought'}>{data.price > 0 ? `$${data.price.toFixed(2)}` : '—'}</span>
    )
  ) : null;
const ValueCell = ({ data }: ICellRendererParams<InsiderTrade>) =>
  data ? (
    data.foreignPrice ? (
      <span className="font-mono text-t10 tnum text-textMuted cursor-help" title={foreignTip(data)}>
        not USD
      </span>
    ) : (
      <span className="font-mono text-t11 tnum font-semibold text-textPrimary">{data.value > 0 ? fmtDollars(data.value) : '—'}</span>
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
/* an indirect line's stake is that line's alone (a trust's), said so on the cell */
const stakeTip = (t: InsiderTrade): string => (t.indirect ? `${stakeWords(t)} — of the shares held indirectly (${t.indirect.toLowerCase()}) only; the filer's direct holding is a separate line and is not counted` : stakeWords(t));
/* newest first: recency descending, ties by the filing day, then the id */
const byRecency = (a: number, b: number, na: IRowNode<InsiderTrade>, nb: IRowNode<InsiderTrade>): number =>
  b - a || String(na.data?.filedOn ?? '').localeCompare(String(nb.data?.filedOn ?? '')) || String(nb.data?.id ?? '').localeCompare(String(na.data?.id ?? ''));
const StakeCell = ({ data }: ICellRendererParams<InsiderTrade>) =>
  data ? (
    <span className="inline-block whitespace-normal text-right leading-tight font-mono text-t11 tnum text-textSecondary cursor-help" title={stakeTip(data)}>
      {/* one format: the share of the holding as a percent, the plain word at the ends, the account mark beside it */}
      {data.stakePct < 0 ? '—' : data.stakePct >= 99.95 ? '100%' : data.stakePct < 0.1 ? '<0.1%' : `${data.stakePct.toFixed(1)}%`}
      {data.stakePct >= 99.95 ? <span className="text-t8 uppercase tracking-widest text-textMuted"> · {data.kind === 'BUY' ? 'first buy' : 'all sold'}</span> : null}
      {data.indirect && data.stakePct >= 0 ? <span className="text-t8 uppercase tracking-widest text-textMuted" title="An indirect holding (a trust, fund or family account): the percent is of that account alone"> · of that account</span> : null}
    </span>
  ) : null;

/** Chosen, planned or unstated — the flag the whole page turns on */
const PlanCell = ({ data }: ICellRendererParams<InsiderTrade>) => {
  if (!data) return null;
  if (!TX_CODES[data.code].openMarket) return <span className="font-mono text-t10 text-textMuted">—</span>;
  if (data.plan === 'plan') return <span className="inline-block whitespace-normal leading-tight font-mono text-t8 uppercase tracking-widest text-textMuted" title="Planned: the trade ran off a 10b5-1 plan — a schedule the insider fixed months earlier, so it carries no view on the day it happened">planned · 10b5-1</span>;
  if (data.plan === 'unknown') return <span className="font-mono text-t8 uppercase tracking-widest text-textMuted" title="The filing carried no plan box either way — not counted as chosen buying in the sums above">unstated</span>;
  if (isCorporateTrade(data))
    return (
      <span className="font-mono text-t8 uppercase tracking-widest text-textSecondary" title={data.kind === 'BUY' ? 'Bought by a company or a fund — a strategic stake or a private placement, not an insider choosing to buy. Not counted in chosen buying' : 'Sold by a company or a fund — the filer is an entity, not an insider choosing to sell. Not counted in selling by choice'}>
        corporate
      </span>
    );
  const loud = isChosenBuy(data);
  return (
    <span className={`font-mono text-t8 uppercase tracking-widest ${loud ? 'text-textPrimary font-bold' : 'text-textSecondary'}`} title={loud ? 'A purchase a person chose to make, not on a 10b5-1 plan — the loudest row here' : 'A trade the insider chose to make'}>
      chosen
    </span>
  );
};

/* the phone card: who, what, the value and whether they chose to */
const cellOf = <C,>(Cell: (p: ICellRendererParams<InsiderTrade>) => C, t: InsiderTrade) => Cell({ data: t } as ICellRendererParams<InsiderTrade>);
const InsiderCard = (t: InsiderTrade) => (
  <>
    <CardLine
      left={
        <>
          <span className="font-mono font-bold">{t.ticker}</span> <span className="font-semibold">{personDisplay(t.person)}</span>
          {t.owners && t.owners.length > 1 ? <span className="font-mono text-t9 text-textMuted"> +{t.owners.length - 1} joint</span> : null}
        </>
      }
      right={cellOf(ValueCell, t)}
    />
    <CardLine muted left={<>{t.role === 'Officer' && t.title ? t.title : t.role === 'Other' ? 'Role not stated' : t.role} · {cellOf(TradeCell, t)} · {fmtInt(t.shares)} sh{t.price > 0 ? ` @ ${t.foreignPrice ? `${t.price.toFixed(2)} (not USD)` : `$${t.price.toFixed(2)}`}` : ''}</>} right={cellOf(PlanCell, t)} />
    <CardLine muted left={<When days={t.daysAgo} size={10} />} right={t.clusterCount >= 2 ? <span className="text-t10">{t.clusterCount} filers</span> : undefined} />
  </>
);

const OthersCell = ({ data }: ICellRendererParams<InsiderTrade>) => {
  if (!data) return null;
  if (data.clusterCount < 2) return <span className="font-mono text-t10 text-textMuted">—</span>;
  return (
    <span className="font-mono text-t11 tnum text-textPrimary" title={`${data.clusterCount} filers did the same in this name inside 30 days`}>
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
  /* the posture weighs chosen buying against chosen selling in the window, so the selling is shown beside it */
  /* chosen selling on the rule chosen buying uses: what the filing marks chosen — unstated sales are neither */
  const chosenSold = f.chosenSold;
  const why = f.signal === 'distributing' ? ` · ${fmtDollars(chosenSold)} sold by choice outweighs it` : f.signal === 'accumulating' && chosenSold > 0 ? ` · against ${fmtDollars(chosenSold)} sold by choice` : f.signal === 'flat' ? ` · as much sold by choice (${fmtDollars(chosenSold)})` : '';
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      title={on ? `Showing ${f.ticker} only — click to show every name` : `Keep the grid to ${f.ticker}`}
      /* the stronger border on a lighter ground, so the card reads */
      className={`group text-left rounded-md border px-3 py-2.5 transition-colors ${on ? 'border-silver/60 bg-silver/[0.08]' : 'border-borderMuted bg-card hover:border-silver/40 hover:bg-silver/[0.05]'}`}
      data-insiders-name={f.ticker}
      data-on={on || undefined}
    >
      <span className="flex items-center gap-2 min-w-0">
        <CompanyLogo ticker={f.ticker} size={18} />
        <span className="font-mono text-t12 font-bold text-textPrimary">{f.ticker}</span>
        {company ? <span className="text-t10 text-textSecondary truncate" title={company}>{company}</span> : null}
      </span>
      <span className="mt-1.5 flex items-baseline gap-2 font-mono tnum">
        <span className="text-t13 font-bold text-bull">{fmtDollars(f.openMarketBuys)}</span>
        <span className="text-t9 text-textSecondary">chosen buying</span>
        <span className="ml-auto text-t10 text-textPrimary">
          {buyers} {buyers === 1 ? 'buyer' : 'buyers'}
        </span>
      </span>
      <span className={`mt-1 block font-mono text-t8 uppercase tracking-widest truncate ${s.ink}`} title={`${s.word}${why} — chosen buying against chosen (not planned) selling in the window`}>
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

/** What each of the three reads covers for this window: complete, still reading, or stopped at the page cap short of it. */
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
    <span className="block text-t11 leading-relaxed text-textMuted" data-insiders-coverage title="The vendor sends at most 500 filings a request, newest filed first">
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
        <span title="Non-share securities, and rows whose price or size no real trade can have (a unit mix-up)">
          {' · '}
          {setAside.toLocaleString()} {setAside === 1 ? 'row' : 'rows'} set aside ({coverage.notShares} not common shares, {coverage.implausible} whose price or size no trade can have — a price ten times off the stock's own, or one trade worth over a quarter of the company)
        </span>
      ) : null}
    </span>
  );
};

/* ---- the page ------------------------------------------------------------------ */

const VIEW_KEY = 'slayer_insiders_view';

const Insiders = () => {
  const navigate = useNavigate();
  const boardNames = useBoardNames();
  /* the cut is kept for the visit (keptView.ts, as News keeps its own): back from a person's page the list is as it was left */
  const keptView = useMemo(() => readKeptView(VIEW_KEY), []);
  const [window, setWindow] = useState<Window>(() => keptPick<Window>(WINDOW_OPTIONS, keptView?.window, 90));
  const [show, setShow] = useState<Show>(() => keptPick<Show>(SHOW_OPTIONS, keptView?.show, 'market'));
  const [role, setRole] = useState<RolePick>(() => keptPick<RolePick>(ROLE_OPTIONS, keptView?.role, 'any'));
  const [names, setNames] = useState<NamesPick>(() => keptPick<NamesPick>(NAMES_OPTIONS, keptView?.names, 'all'));

  /* The feed is the live record when it answers; the cards cut it, the Filter keeps from the cut */
  const feed = useInsiderTrades(window, show === 'market' ? OPEN_MARKET_CODES : ALL_CODES);
  /* purchases are paged back until the window is covered; the line under the controls says what each part covers */
  useEffect(() => wantInsiderWindow(window), [window]);
  const coverage = useInsiderCoverage();
  /* A failed read is not a quiet quarter: the page says the read did not land, the figures go to dashes */
  const status = useInsidersStatus();
  const failed = status === 'sim';
  const waiting = status === 'loading';
  /* the totals are partial while the pages load */
  const reading = coverage.buysReading || coverage.bigSalesReading || coverage.restReading;
  /* filings page newest first, so the totals are complete back to the oldest day both reads reach */
  /* the parts still reading say how far they reach; a part done says its own */
  const readBack = [coverage.buysReading ? coverage.buysSince : null, coverage.bigSalesReading ? coverage.bigSalesSince : null].filter((d): d is string => !!d).sort().reverse()[0] ?? [coverage.buysSince, coverage.bigSalesSince].filter((d): d is string => !!d).sort().reverse()[0] ?? null;
  const readingWord = readBack ? ` · read back to ${shortDay(readBack)} of ${window} days` : ' · reading the first pages';
  const gridEmpty = failed ? 'This read did not land' : waiting ? 'Reading the filings' : 'No filing on this cut';
  const cut = useMemo(() => {
    const board = new Set(boardNames);
    return feed.filter(t => (role === 'any' || t.role === role) && (names === 'all' || board.has(t.ticker)));
  }, [feed, role, names, boardNames]);

  /* the filter reads the names, people and roles on the cut; any pick keeps its rows */
  const [picks, setPicks] = useState<string[]>(() => keptStrings(keptView?.picks));
  useKeepView(VIEW_KEY, { window, show, role, names, picks });
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
      { title: 'People', options: [...byPeople.entries()].sort(order).map(([p, c]) => ({ value: `person:${p}`, label: personDisplay(p), hint: roleOf(p) ? `${roleOf(p)!.role} · ${roleOf(p)!.ticker}` : undefined, count: c })) },
      { title: 'Roles', options: [...byRoles.entries()].sort(order).map(([r, c]) => ({ value: `role:${r}`, label: r, count: c })) },
    ];
  }, [cut, picks]);
  /* in the grid's own order (newest first), so the phone's cards read the same */
  const rows = useMemo(() => {
    const picked = new Set(picks);
    const out = picks.length === 0 ? [...cut] : cut.filter(t => picked.has(`name:${t.ticker}`) || picked.has(`person:${t.person}`) || picked.has(`role:${t.role}`));
    return out.sort((a, b) => -byRecency(a.daysAgo, b.daysAgo, { data: a } as never, { data: b } as never));
  }, [cut, picks]);
  const toggleName = (ticker: string) => setPicks(p => (p.includes(`name:${ticker}`) ? p.filter(x => x !== `name:${ticker}`) : [...p, `name:${ticker}`]));

  /* $1M+ sales are paged over the whole window, smaller ones only in the latest filings; when those stop short the
     figure is the large sales' and the smaller are stated apart */
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

  /* the names to know: chosen buying on the filtered rows, heaviest first */
  const toKnow = useMemo(() => {
    const by = new Map<string, InsiderTrade[]>();
    for (const t of rows) {
      const list = by.get(t.ticker) ?? [];
      list.push(t);
      by.set(t.ticker, list);
    }
    return [...by.entries()]
      .map(([ticker, trades]) => summariseFlow(ticker, trades, window))
      .filter(f => f.openMarketBuys > 0)
      .sort((a, b) => b.openMarketBuys - a.openMarketBuys)
      .slice(0, NAMES_TO_KNOW);
  }, [rows, window]);

  const columnDefs = useMemo<ColDef<InsiderTrade>[]>(
    () => [
      { headerName: 'When', field: 'daysAgo', width: 80, cellRenderer: WhenCell, sort: 'desc', comparator: byRecency, headerTooltip: 'The day the trade happened, and how far back that is — newest first' },
      { headerName: 'Name', field: 'ticker', flex: 1.3, minWidth: 120, cellRenderer: NameCell, headerTooltip: 'The company' },
      { headerName: 'Who', field: 'person', flex: 1.4, minWidth: 130, cellRenderer: WhoCell, headerTooltip: 'A row opens this person’s book' },
      { headerName: 'Trade', field: 'code', flex: 0.9, minWidth: 92, cellRenderer: TradeCell, headerTooltip: 'Bought or sold in the market; with Every filing on, the grants, conversions and withholdings are named for what they are' },
      { headerName: 'Shares', field: 'shares', width: 88, cellRenderer: SharesCell, type: 'rightAligned', headerTooltip: 'Shares in the transaction' },
      { headerName: 'Price', field: 'price', width: 84, cellRenderer: PriceCell, type: 'rightAligned', headerTooltip: 'The filed price per share' },
      { headerName: 'Value', field: 'value', width: 92, cellRenderer: ValueCell, type: 'rightAligned', headerTooltip: 'Shares times the filed price' },
      { headerName: 'Of holding', field: 'stakePct', width: 100, cellRenderer: StakeCell, type: 'rightAligned', headerTooltip: "The share of the insider's holding this trade was; 'of account' marks a trust or fund line, that account alone" },
      {
        headerName: 'Chose to?',
        field: 'plan',
        width: 116,
        cellRenderer: PlanCell,
        comparator: (a: InsiderTrade['plan'], b: InsiderTrade['plan']) => ['discretionary', 'unknown', 'plan'].indexOf(a) - ['discretionary', 'unknown', 'plan'].indexOf(b),
        headerTooltip: 'Chosen: the insider decided. Planned: a 10b5-1 schedule set months earlier. Unstated: no box ticked',
      },
      { headerName: 'Others', field: 'clusterCount', width: 80, cellRenderer: OthersCell, headerTooltip: 'How many distinct filers did the same in this name inside 30 days — a cluster is a stronger read than one' },
    ],
    []
  );
  const defaultColDef = useMemo<ColDef<InsiderTrade>>(() => ({ sortable: true, resizable: true, suppressMovable: true }), []);

  const kept = useKeptAt('insiders');
  const live = !failed && !waiting;
  const soFar = reading && live ? <span className="text-t9 text-textMuted" title={`Still paging back${readBack ? ` — complete from ${shortDay(readBack)}` : ''}`}> · so far</span> : null;
  return (
    <RecordPanel testId="insiders" attrs={{ 'data-window': window, 'data-show': show }}>
      <RecordHead
        title="What insiders did"
        guide={{ title: 'How to read the filings', door: 'What a row, a chosen trade and a plan mean', testId: 'insiders-guide', body: <InsidersGuide /> }}
        kept={kept}
        line={`${show === 'market' ? 'Open-market buys and sales' : 'Every filing'} · newest first · a row opens their book`}
        status={
          !failed && (
            <p className={`mt-1 font-mono text-t10 uppercase tracking-widest ${reading || waiting ? 'text-warn' : 'text-textSecondary'}`} data-insiders-progress={reading || waiting ? 'reading' : 'complete'}>
              {waiting
                ? `Reading the filings · 0 of ${window} days so far`
                : reading
                  ? `Reading · ${readBack ? Math.max(0, Math.min(window, Math.round((Date.parse(`${nyIsoDaysBack(0)}T12:00:00Z`) - Date.parse(`${readBack}T12:00:00Z`)) / 86_400_000))) : 0} of ${window} days so far · totals grow`
                  : `Complete · ${window} days read`}
            </p>
          )
        }
        facts={
          <>
            <HeadFact label="Filings" testId="insiders-count" partial={reading && live} tip="Rows on the grid now, after the window and the filters">
              <span data-insiders-count>{live ? facts.filings.toLocaleString() : '—'}</span>
              {reading && live ? <span className="text-t9 text-textMuted">{readingWord}</span> : null}
            </HeadFact>
            <HeadFact label="Chosen buying" testId="insiders-chosen" partial={reading && live} tone={facts.chosen > 0 ? 'text-bull' : 'text-textMuted'} tip="Open-market purchases a person chose to make, not on a 10b5-1 plan; company and fund buys are counted apart">
              <span data-insiders-chosen>{live ? (facts.chosen > 0 ? fmtDollars(facts.chosen) : 'none') : '—'}</span>
              {soFar}
            </HeadFact>
            <HeadFact label="Company & fund buys" testId="insiders-corporate" partial={reading && live} tip="Purchases by a company or fund: strategic stakes and placements, not an insider's choice">
              <span data-insiders-corporate>{live ? (facts.corporate > 0 ? fmtDollars(facts.corporate) : 'none') : '—'}</span>
              {soFar}
            </HeadFact>
            <HeadFact
              label={split ? `Sold · ${bigWord(split.big)}+ sales` : 'Sold in the market'}
              testId="insiders-sold"
              partial={reading && live}
              tip={split ? `Open-market sales of ${bigWord(split.big)}+ over the whole window. Smaller sales (${facts.smallCount.toLocaleString()} for ${fmtDollars(facts.smallSold)}) are read for ${spanWords(split.from, split.to)} only and kept out` : 'Dollars of shares insiders sold in the open market, planned or not'}
            >
              <span data-insiders-sold>{live ? (facts.sold > 0 ? fmtDollars(facts.sold) : 'none') : '—'}</span>
              {soFar}
            </HeadFact>
            <HeadFact label="Sales on a plan" testId="insiders-planned" partial={reading && live} tip="The share of those sales that ran off a 10b5-1 plan set months earlier — they say little about today">
              <span data-insiders-planned>{facts.plannedPct == null ? '—' : `${facts.plannedPct}%`}</span>
              {soFar}
            </HeadFact>
          </>
        }
      />
      <PhoneFold label="Filters, summary and the names to know" testId="insiders">
        <Controls testId="insiders">
          <DropdownSelect label="Window" value={window} options={WINDOW_OPTIONS} onChange={setWindow} title="How far back the filings run" testId="insiders-window" />
          <DropdownSelect label="Show" value={show} options={SHOW_OPTIONS} onChange={setShow} title="Trades only, or every filing" testId="insiders-show" />
          <DropdownSelect label="Role" value={role} options={ROLE_OPTIONS} onChange={setRole} title="Whose filings" testId="insiders-role" />
          <DropdownSelect label="Names" value={names} options={NAMES_OPTIONS} onChange={setNames} title="Which companies" testId="insiders-names" />
          <DropdownMulti label="Filter" values={picks} groups={filterGroups} onChange={setPicks} title="The names, people and roles on the page right now — tick any number; only those stay" testId="insiders-filter" />
        </Controls>
        {failed ? (
          <FeedFallback />
        ) : (
          <Summary
            testId="insiders"
            more={
              !waiting && (
                <>
                  <CoverageLine coverage={coverage} window={window} />
                  <span className="block mt-1" data-insiders-words>
                    <span className="text-textSecondary">Planned · 10b5-1</span> — on a schedule fixed months earlier, so it says little about the day. <span className="text-textSecondary">Of that account</span> — a trust, fund or family account the insider reports; the percent is of that account alone.
                  </span>
                </>
              )
            }
          >
            {waiting ? 'Reading the filings.' : `${reading ? 'So far: ' : ''}${insidersSentence(rows, window, split)}`}
          </Summary>
        )}
        <ToKnow title="The names to know" sub={`chosen buys over the last ${window} days, heaviest first · a click keeps the grid to it`} testId="insiders" count={NAMES_TO_KNOW} empty={toKnow.length === 0 ? (failed ? 'This read did not land' : waiting ? 'Reading the filings' : 'No insider chose to buy in this window') : null}>
          {toKnow.map(f => (
            <NameCard key={f.ticker} f={f} on={picks.includes(`name:${f.ticker}`)} onToggle={() => toggleName(f.ticker)} />
          ))}
        </ToKnow>
      </PhoneFold>
      <RecordGrid<InsiderTrade>
        testId="insiders"
        rows={rows}
        rowKey={t => t.id}
        card={InsiderCard}
        onOpen={t => navigate(`/dossier/insiders/${personSlug(t.person)}`)}
        empty={gridEmpty}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
      />
      <InsiderSectorFlow trades={rows} windowDays={window} state={failed ? 'failed' : waiting || reading ? 'reading' : 'read'} />
    </RecordPanel>
  );
};

export const InsiderFile = () => {
  const { person = '' } = useParams();
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
      { headerName: 'When', field: 'daysAgo', width: 80, cellRenderer: WhenCell, sort: 'desc', comparator: byRecency, headerTooltip: 'The day of the trade, and how long ago' },
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
              <span className="font-mono text-t12 font-bold text-textPrimary">{data.ticker}</span>
              <CoSub ticker={data.ticker} fallback={data.company ? titleCase(data.company) : null} />
            </span>
          ) : null,
      },
      { headerName: 'Trade', field: 'code', flex: 1, minWidth: 140, cellRenderer: TradeCell, headerTooltip: 'What the filing says happened — bought or sold in the market, or a grant, exercise, tax withholding or gift' },
      { headerName: 'Shares', field: 'shares', width: 100, cellRenderer: SharesCell, type: 'rightAligned', headerTooltip: 'Shares in the transaction' },
      { headerName: 'Price', field: 'price', width: 96, cellRenderer: PriceCell, type: 'rightAligned', headerTooltip: 'The price per share on the filing' },
      { headerName: 'Value', field: 'value', width: 110, cellRenderer: ValueCell, type: 'rightAligned', headerTooltip: 'Shares times the filed price' },
      { headerName: 'Chose to?', field: 'plan', width: 148, cellRenderer: PlanCell, headerTooltip: 'Chosen: the insider decided to trade. Planned: it ran off a 10b5-1 schedule set months earlier. Unstated: the filing ticked neither box' },
    ],
    [],
  );
  if (book === undefined) {
    return (
      <>
        <Link to="/dossier/insiders" className="group inline-flex items-center gap-1.5 font-mono text-t10 uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors" data-name-back>
          <ArrowLeft className="w-3.5 h-3.5 transition-transform duration-200 ease-out group-hover:-translate-x-0.5" /> Insiders
        </Link>
        <div className="border border-borderSubtle rounded-md bg-panel px-5 py-4 text-t12 text-textSecondary">Reading the filings.</div>
      </>
    );
  }
  if (!book) {
    return (
      <>
        <Link to="/dossier/insiders" className="group inline-flex items-center gap-1.5 font-mono text-t10 uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors" data-name-back>
          <ArrowLeft className="w-3.5 h-3.5 transition-transform duration-200 ease-out group-hover:-translate-x-0.5" /> Insiders
        </Link>
        <div className="border border-borderSubtle rounded-md bg-panel px-5 py-4 text-t12 text-textSecondary">That person is not on this book.</div>
      </>
    );
  }
  return (
    <>
      <Link to="/dossier/insiders" className="group inline-flex items-center gap-1.5 font-mono text-t10 uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors" data-name-back>
        <ArrowLeft className="w-3.5 h-3.5 transition-transform duration-200 ease-out group-hover:-translate-x-0.5" /> Insiders
      </Link>
      <RecordPanel testId="insider-file" attrs={{ 'data-insider-file': book.person }}>
        <RecordHead
          title={personDisplay(book.person)}
          kept={book.keptAt}
          line={`${book.role} · ${book.ticker} · ${book.windowDays > 0 ? `${book.by === 'cik' ? 'every filing under their SEC id' : 'every filing under this name'} in the last year${book.capped ? ' — the latest 500' : ''}` : 'their filings in the market feed — their own file did not answer'}`}
          status={book.by === 'name' && book.filers > 1 ? <p className="mt-0.5 text-t10 text-warn">{book.filers} SEC filers share this name; the rows may be more than one person.</p> : null}
          facts={
            <>
              <HeadFact label="Filings" tip="Rows on the grid now">{rows.length}</HeadFact>
              <HeadFact label="Bought">{bought > 0 ? fmtDollars(bought) : rows.some(t => t.foreignPrice && TX_CODES[t.code].openMarket && t.kind === 'BUY') ? 'not in USD' : 'none'}</HeadFact>
              <HeadFact label="Sold">{sold > 0 ? fmtDollars(sold) : rows.some(t => t.foreignPrice && TX_CODES[t.code].openMarket && t.kind === 'SELL') ? 'not in USD' : 'none'}</HeadFact>
              <HeadFact label="On a plan">{planned}</HeadFact>
            </>
          }
        />
        <Controls testId="insider">
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
        </Controls>
        <Summary testId="insider">
          {(() => {
            const names = [...new Set(book.trades.map(t => t.ticker))];
            const off = book.trades.length - book.trades.filter(t => TX_CODES[t.code].openMarket).length;
            const foreign = book.trades.filter(t => t.foreignPrice).length;
            return `${personDisplay(book.person)} filed ${book.trades.length} ${book.trades.length === 1 ? 'row' : 'rows'}${book.windowDays > 0 ? ' in the last year' : ''}, at ${names.length === 1 ? names[0] : `${names.length} companies (${names.slice(0, 4).join(', ')}${names.length > 4 ? '…' : ''})`}. ${off === 0 ? (book.trades.length === 1 ? 'It was an open-market trade.' : 'Every one was an open-market trade.') : `${off} of them never reached the market — grants, awards or shares withheld for tax.`}${foreign ? ` ${foreign} ${foreign === 1 ? 'row is' : 'rows are'} priced in the home market's currency — marked "not USD" and kept out of the dollar totals.` : ''}`;
          })()}
        </Summary>
        <RecordGrid<InsiderTrade> testId="insider-trades" rows={rows} rowKey={t => t.id} card={InsiderCard} empty="No filing on this book" columnDefs={cols} gridProps={{ animateRows: false, rowSelection: undefined }} />
      </RecordPanel>
    </>
  );
};

export default Insiders;
