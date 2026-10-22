/*
==================================================
  SLAYER TERMINAL - CONGRESS (pages/record/Congress.tsx)

  What members of Congress reported trading under
  the STOCK Act, and how long they took to say so.
  The partner's "Disclosures" (2026-09-09) in the
  house, and walked the same night as Insiders:

    THE HEAD      four facts
    THE CARDS     Window · Chamber · Owner · Show, and
                  the Filter as a card that reads the
                  names and members on the page
    THE SENTENCE
    THE REPORTS   the biggest disclosed brackets on
    TO KNOW       the cut, the latest first among
                  equals; a card keeps the grid to
                  its member
    THE GRID      in a window a screen tall that
                  scrolls inside itself, its head
                  pinned

  A row's name opens it on the Map.
==================================================
*/

import { CONTROLS_LINE } from '../../components/trace/TraceBox';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ColDef, type ICellRendererParams, type RowClickedEvent } from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import { usePagedGrid, phonePin } from '../../components/record/pagedGrid';
import { GRID_MODULES, GRID_THEME, noRows } from '../../components/ui/houseGrid';
import DropdownSelect, { type DropdownOption } from '../../components/ui/DropdownSelect';
import DropdownMulti, { type MultiGroup } from '../../components/ui/DropdownMulti';
import GuideFocus, { GuideDoor } from '../../components/ui/GuideFocus';
import CompanyLogo from '../../components/ui/CompanyLogo';
import { CongressGuide } from '../../components/record/CongressGuide';
import { When } from '../../components/record/when';
import { AMOUNT_BRACKETS, STOCK_ACT_DEADLINE_DAYS, bracketLabel, bracketShort, congressSentence, seatLabel, summariseCongress } from '../../data/congress';
import { useCongressCoverage, useCongressFeed, useCongressStatus, wantCongressWindow, type CongressCoverage } from '../../data/liveRecord';
import { nyIsoDaysBack } from '../../data/nyDate';
import { FeedFallback } from '../../components/ui/liveRead';
import { tickerName } from '../../data/tickers';
import type { Chamber, CongressTrade, ReportOwner } from '../../types/record';
import { REPORTS_TO_KNOW } from './recordSkeletons';
import { CongressHoldings } from '../../components/record/ExtraFaces';

const SILVER = 'rgb(var(--silver))'; /* the silver token — deep steel on the light terminal (2026-09-12) */
type Window = 30 | 90 | 180;
type ChamberPick = 'both' | Chamber;
type OwnerPick = 'any' | ReportOwner;
type Show = 'all' | 'late' | 'purchases' | 'sales';

const WINDOW_OPTIONS: DropdownOption<Window>[] = [
  { value: 30, label: '30 days', hint: 'Trades made in the last month' },
  { value: 90, label: '90 days', hint: 'Trades made in the last quarter' },
  { value: 180, label: '180 days', hint: 'Trades made in the last half year' },
];
const CHAMBER_OPTIONS: DropdownOption<ChamberPick>[] = [
  { value: 'both', label: 'Both', hint: 'House and Senate' },
  { value: 'House', label: 'House', hint: 'Representatives only' },
  { value: 'Senate', label: 'Senate', hint: 'Senators only' },
];
const OWNER_OPTIONS: DropdownOption<OwnerPick>[] = [
  { value: 'any', label: 'Any', hint: 'The member, their spouse, a joint account or a dependent' },
  { value: 'Self', label: 'Self', hint: "The member's own holding" },
  { value: 'Spouse', label: 'Spouse', hint: "The spouse's holding" },
  { value: 'Joint', label: 'Joint', hint: 'A joint account' },
  { value: 'Dependent', label: 'Dependent', hint: "A dependent child's holding" },
];
const SHOW_OPTIONS: DropdownOption<Show>[] = [
  { value: 'all', label: 'All reports', short: 'All', hint: 'Every report in the window' },
  { value: 'late', label: 'Late only', hint: 'Filed past the 45-day deadline' },
  { value: 'purchases', label: 'Purchases', hint: 'Purchases only', tone: 'bull' },
  { value: 'sales', label: 'Sales', hint: 'Sales only, full or partial', tone: 'bear' },
];

const seat = (t: CongressTrade) => seatLabel(t.member);
const typeWord = (t: CongressTrade) => (t.type === 'Purchase' ? 'Purchase' : t.type === 'Exchange' ? 'Exchange' : 'Sale');
const typeInk = (t: CongressTrade) => (t.type === 'Purchase' ? 'text-bull' : t.type === 'Exchange' ? 'text-textMuted' : 'text-bear');

/* ---- cells: the house grammar inside the grid ------------------------------------ */

/* the dates, then how far back (the partner's review: never "9d ago" alone) */
const FiledCell = ({ data }: ICellRendererParams<CongressTrade>) => (data ? <When days={data.filedDaysAgo} /> : null);

const MemberCell = ({ data }: ICellRendererParams<CongressTrade>) =>
  data ? (
    <span className="flex flex-col leading-tight min-w-0 text-left" data-open-member={data.member.id}>
      <span className="text-[12px] font-semibold text-textPrimary truncate">
        {data.member.name} <span className="font-mono text-[10px] font-normal text-textMuted">{seat(data)}</span>
      </span>
      <span className="text-[10px] text-textMuted truncate">{data.member.chamber}</span>
    </span>
  ) : null;

const SYMBOL = /^[A-Z][A-Z.]{0,5}$/;
/* an all-caps filing phrase ("US TREASURY BILLS") reads in sentence case, so it never shouts across a card */
const readable = (s: string) => (s.length > 6 && s === s.toUpperCase() && /[A-Z]{3}/.test(s) ? s.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase()).replace(/\bUs\b/g, 'US') : s);

export const assetLine = (t: CongressTrade) => {
  const sym = t.ticker.trim().toUpperCase();
  /* "None" / "N/A" ride in the ticker field on some filings — they are not symbols */
  const named = SYMBOL.test(sym) && !/^(NONE|NA|N\/A)$/.test(sym);
  const rawDesc = t.assetDescription && t.assetDescription !== 'Stock' && t.assetDescription !== 'Undisclosed' && t.assetDescription.toUpperCase() !== sym ? t.assetDescription : '';
  const fallback = !named && sym && !/^(NONE|NA|N\/A)$/.test(sym) ? sym : '';
  const described = readable(rawDesc || fallback);
  if (named) return { sym, title: sym, sub: described || (t.assetKind === 'Stock' ? tickerName(sym) : t.assetKind) };
  const title = described || (t.assetKind === 'Stock' || t.assetKind === 'Other' ? 'Not named on the filing' : t.assetKind);
  const sub = described && t.assetKind !== 'Stock' && t.assetKind !== 'Other' ? t.assetKind : '';
  return { sym: '', title, sub };
};

/** One key per asset for the names-to-know cards: a named stock by its symbol, anything else by its plain name with
    the filing's own parenthetical dropped ("Treasury Bill (6-Week, Matures 12/3/2026)" → "Treasury Bill") */
export const assetKey = (t: CongressTrade) => {
  const line = assetLine(t);
  if (line.sym) return line.sym;
  const plain = line.title.replace(/\s*\(.*$/, '').replace(/\s*\[.*$/, '').trim() || line.title;
  return /^(us |u\.s\. )?treasury bills?$/i.test(plain) ? 'Treasury Bill' : plain;
};

export const AssetCell = ({ data }: ICellRendererParams<CongressTrade>) => {
  if (!data) return null;
  const line = assetLine(data);
  return (
    /* a full-width flex, so a long asset name ends in an ellipsis instead of being sheared mid-word at the cell edge */
    <span className="flex items-center gap-2 min-w-0 w-full h-full overflow-hidden" title={line.sub ? `${line.title} · ${line.sub}` : line.title}>
      {line.sym ? <CompanyLogo ticker={line.sym} size={16} /> : null}
      <span className="flex flex-col leading-tight min-w-0 flex-1">
        <span className={`text-[12px] font-bold text-textPrimary truncate ${line.sym ? 'font-mono' : ''}`}>{line.title}</span>
        {line.sub ? <span className="text-[10px] text-textMuted truncate">{line.sub}</span> : null}
      </span>
    </span>
  );
};

const TypeCell = ({ data }: ICellRendererParams<CongressTrade>) =>
  data ? (
    <span className={`font-mono text-[11px] tnum ${typeInk(data)}`}>
      {typeWord(data)}
      {data.type === 'Sale (Partial)' && <span className="text-textMuted"> · partial</span>}
    </span>
  ) : null;

const OwnerCell = ({ data }: ICellRendererParams<CongressTrade>) =>
  data ? <span className={`font-mono text-[8px] uppercase tracking-widest ${data.owner === 'Self' ? 'text-textPrimary' : 'text-textMuted'}`}>{data.owner}</span> : null;

/** The ten rungs as a ladder, the disclosed one lit — never a midpoint */
const Ladder = ({ bracket }: { bracket: number }) => (
  <span className="inline-flex items-center gap-[2px]" aria-hidden>
    {AMOUNT_BRACKETS.map((b, i) => (
      <span key={b.column} className="block w-[5px] h-[8px] rounded-[1px]" style={{ background: i <= bracket ? SILVER : 'rgb(var(--ink) / 0.08)', opacity: i === bracket ? 1 : i < bracket ? 0.55 : 1 }} />
    ))}
  </span>
);
const AmountCell = ({ data }: ICellRendererParams<CongressTrade>) => {
  if (!data) return null;
  if (data.bracket === null) return <span className="font-mono text-[10px] text-textMuted">not disclosed</span>;
  return (
    <span className="inline-flex items-center gap-2.5" title={`Rung ${AMOUNT_BRACKETS[data.bracket].column} of ${AMOUNT_BRACKETS.length}`}>
      <Ladder bracket={data.bracket} />
      <span className="font-mono text-[11px] tnum text-textPrimary whitespace-nowrap">{bracketLabel(data.bracket)}</span>
    </span>
  );
};

const TradedCell = ({ data }: ICellRendererParams<CongressTrade>) => (data ? <When days={data.tradedDaysAgo} /> : null);

const LagCell = ({ data }: ICellRendererParams<CongressTrade>) => {
  if (!data) return null;
  if (data.lagDays < 0) return <span className="font-mono text-[10px] text-textMuted" title="Filed before the trade date — a filing artefact real feeds carry">before the trade</span>;
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[11px] tnum">
      <span className={data.late ? 'text-bear font-semibold' : data.lagDays > 30 ? 'text-textPrimary' : 'text-textSecondary'}>{data.lagDays}d</span>
      {data.late && <span className="text-[8px] uppercase tracking-widest text-bear">late</span>}
    </span>
  );
};

/* ---- the reports to know ------------------------------------------------------- */

/** One big report: the stock, the member, the bracket, the chamber. A click keeps the grid to the member. */
const ReportCard = ({ t, on, onToggle }: { t: CongressTrade; on: boolean; onToggle: () => void }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-pressed={on}
    title={on ? `Showing ${t.member.name} only — click to show every member` : `Keep the grid to ${t.member.name}`}
    className={`group text-left rounded-md border px-3 py-2.5 transition-colors ${on ? 'border-silver/60 bg-silver/[0.08]' : 'border-borderMuted bg-card hover:border-silver/40 hover:bg-silver/[0.05]'}`}
    data-congress-report={t.id}
    data-on={on || undefined}
  >
    {(() => {
      const line = assetLine(t);
      return (
        <span className="flex items-center gap-2 min-w-0">
          {line.sym ? <CompanyLogo ticker={line.sym} size={18} /> : null}
          {/* the symbol never gives way — the member's name is what truncates ("AP…" read as nothing) */}
          <span className={`text-[12px] font-bold text-textPrimary truncate ${line.sym ? 'font-mono shrink-0' : ''}`}>{line.title}</span>
          <span className="min-w-0 text-[10px] text-textSecondary truncate">
            {t.member.name} <span className="font-mono text-textMuted">{seat(t)}</span>
          </span>
        </span>
      );
    })()}
    {/* the bracket as its words — the ladder lives in the grid; at six across it pushed the label off the card */}
    <span className="mt-1.5 flex items-center gap-2 font-mono tnum">
      <span className={`text-[11px] ${typeInk(t)}`}>{typeWord(t)}</span>
      <span className="text-[11px] font-bold text-textPrimary truncate" title={bracketLabel(t.bracket)}>{bracketShort(t.bracket)}</span>
      {t.late && <span className="ml-auto text-[8px] uppercase tracking-widest text-bear">late</span>}
    </span>
    <span className="mt-1 block font-mono text-[8px] uppercase tracking-widest text-textSecondary truncate">
      <span className="text-textMuted">{t.member.chamber}</span>
    </span>
  </button>
);

/* ---- what the window covers ------------------------------------------------------- */

const shortDay = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

/** One honest line: the trade days the reports cover, whether the read is still going back, and the days it could not finish */
const CongressCoverageLine = ({ coverage, window, unread }: { coverage: CongressCoverage; window: number; unread: number }) => {
  const start = nyIsoDaysBack(window);
  const covered = !!coverage.since && coverage.since <= start;
  const partial = coverage.partialDays.filter(d => d >= start);
  return (
    <p className="px-5 pb-2 text-[11px] leading-relaxed text-textMuted" data-congress-coverage title="Unusual Whales sends at most 200 reports a request, newest trade first; the page asks again from the oldest trade day it reached">
      {covered
        ? `Every report of a trade made since ${shortDay(start)}`
        : coverage.since
          ? `Reports of trades made since ${shortDay(coverage.since)}${coverage.reading ? ' — reading further back' : coverage.capped ? ` — the read stops there, short of ${window} days` : ''}`
          : 'Reading'}
      {partial.length ? ` · ${partial.length} ${partial.length === 1 ? 'day' : 'days'} with more than 200 reports (${partial.map(shortDay).join(', ')}) may be incomplete` : ''}
      {unread ? ` · ${unread} ${unread === 1 ? 'report' : 'reports'} with an unreadable type left out` : ''}
    </p>
  );
};

/* ---- the page ------------------------------------------------------------------ */

const Congress = () => {
  const navigate = useNavigate();
  const [window, setWindow] = useState<Window>(90);
  const [chamber, setChamber] = useState<ChamberPick>('both');
  const [owner, setOwner] = useState<OwnerPick>('any');
  const [show, setShow] = useState<Show>('all');
  const [guideOpen, setGuideOpen] = useState(false);

  /* The feed is the live record when it answers; the reports are paged back by trade day until the window is covered */
  const feed = useCongressFeed(window);
  useEffect(() => wantCongressWindow(window), [window]);
  const coverage = useCongressCoverage();
  /* a failed read is not a quiet quarter — the figures go to dashes and the page says the read did not land */
  const status = useCongressStatus();
  const failed = status === 'sim';
  const waiting = status === 'loading';
  const quiet = failed || waiting;
  const gridEmpty = failed ? 'This read did not land' : waiting ? 'Reading the reports' : 'No report on this cut';
  const cut = useMemo(
    () =>
      feed.trades.filter(t => {
        if (chamber !== 'both' && t.member.chamber !== chamber) return false;
        if (owner !== 'any' && t.owner !== owner) return false;
        if (show === 'late' && !t.late) return false;
        if (show === 'purchases' && t.type !== 'Purchase') return false;
        if (show === 'sales' && (t.type === 'Purchase' || t.type === 'Exchange')) return false;
        return true;
      }),
    [feed, chamber, owner, show]
  );

  /* THE FILTER reads the names and members on the cut; any pick matching keeps the row */
  const [picks, setPicks] = useState<string[]>([]);
  const filterGroups = useMemo<MultiGroup[]>(() => {
    const count = (key: (t: CongressTrade) => string | null) => {
      const m = new Map<string, number>();
      cut.forEach(t => {
        const k = key(t);
        if (k) m.set(k, (m.get(k) ?? 0) + 1);
      });
      return m;
    };
    const byNames = count(t => t.ticker);
    const byMembers = count(t => t.member.name);
    picks.forEach(p => {
      const [kind, ...rest] = p.split(':');
      const key = rest.join(':');
      if (kind === 'name' && !byNames.has(key)) byNames.set(key, 0);
      if (kind === 'member' && !byMembers.has(key)) byMembers.set(key, 0);
    });
    const order = (a: [string, number], b: [string, number]) => b[1] - a[1] || a[0].localeCompare(b[0]);
    const seatOf = (name: string) => {
      const t = cut.find(x => x.member.name === name);
      return t ? `${seat(t)} · ${t.member.chamber}` : undefined;
    };
    return [
      { title: 'Names', options: [...byNames.entries()].sort(order).map(([n, c]) => ({ value: `name:${n}`, label: n, hint: tickerName(n), count: c })) },
      { title: 'Members', options: [...byMembers.entries()].sort(order).map(([m, c]) => ({ value: `member:${m}`, label: m, hint: seatOf(m), count: c })) },
    ];
  }, [cut, picks]);
  const paged = usePagedGrid<CongressTrade>();
  const rows = useMemo(() => {
    if (picks.length === 0) return cut;
    const picked = new Set(picks);
    return cut.filter(t => picked.has(`name:${t.ticker}`) || picked.has(`member:${t.member.name}`));
  }, [cut, picks]);
  const toggleMember = (name: string) => setPicks(p => (p.includes(`member:${name}`) ? p.filter(x => x !== `member:${name}`) : [...p, `member:${name}`]));
  const stats = useMemo(() => summariseCongress(rows, window), [rows, window]);

  /* THE REPORTS TO KNOW: the biggest disclosed brackets on the cut, the latest first among equals */
  const toKnow = useMemo(
    () =>
      [...cut]
        .sort((a, b) => (b.bracket ?? -1) - (a.bracket ?? -1) || a.filedDaysAgo - b.filedDaysAgo)
        .slice(0, REPORTS_TO_KNOW),
    [cut]
  );

  const columnDefs = useMemo<ColDef<CongressTrade>[]>(
    () => [
      { headerName: 'Filed', field: 'filedDaysAgo', width: 146, cellRenderer: FiledCell, sort: 'asc', headerTooltip: 'The day the report was filed, and how far back that is — newest first' },
      { headerName: 'Member', field: 'member', cellDataType: false, flex: 1.7, minWidth: 220, cellRenderer: MemberCell, comparator: (a: CongressTrade['member'], b: CongressTrade['member']) => a.name.localeCompare(b.name), headerTooltip: 'A row opens this member’s book' },
      { headerName: 'Asset', field: 'ticker', flex: 1.3, minWidth: 170, cellRenderer: AssetCell, headerTooltip: 'The stock the report names' },
      { headerName: 'Type', field: 'type', flex: 0.8, minWidth: 110, cellRenderer: TypeCell, headerTooltip: 'Purchase, sale (full or partial), or an exchange' },
      { headerName: 'Owner', field: 'owner', flex: 0.7, minWidth: 96, cellRenderer: OwnerCell, headerTooltip: "Whose holding the report covers — the member's own, their spouse's, a joint account or a dependent's" },
      {
        headerName: 'Amount disclosed',
        field: 'bracket',
        flex: 1.6,
        minWidth: 220,
        cellRenderer: AmountCell,
        comparator: (a: number | null, b: number | null) => (a ?? -1) - (b ?? -1),
        headerTooltip: 'The bracket the member disclosed, as a rung on the ten-rung ladder — never a midpoint; some scanned filings carry none',
      },
      { headerName: 'Traded', field: 'tradedDaysAgo', width: 146, cellRenderer: TradedCell, headerTooltip: 'The day the trade itself happened, and how far back that is' },
      { headerName: 'Lag', field: 'lagDays', width: 100, cellRenderer: LagCell, headerTooltip: `Days from the trade to the filing — past ${STOCK_ACT_DEADLINE_DAYS} it is late` },
    ],
    []
  );
  const defaultColDef = useMemo<ColDef<CongressTrade>>(() => ({ sortable: true, resizable: true, suppressMovable: true }), []);
  const open = (e: RowClickedEvent<CongressTrade>) => {
    if (!e.data) return;
    navigate(`/dossier/congress/${e.data.member.id}`);
  };

  return (
    <div className="relative border border-borderSubtle rounded-md overflow-hidden bg-panel flex flex-col" data-congress data-window={window}>
      <GuideFocus open={guideOpen} onClose={() => setGuideOpen(false)} title="How to read the reports" testId="congress-guide" viewport>
        <CongressGuide />
      </GuideFocus>
      {/* THE HEAD */}
      <div className="px-5 pt-4 pb-3 flex items-start gap-6 flex-wrap">
        <div className="min-w-[min(18rem,100%)] flex-1">
          <div className="h-6 flex items-center gap-3">
            <h3 className="text-[15px] font-semibold leading-tight text-textPrimary whitespace-nowrap">What Congress reported</h3>
            <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What a row, a bracket, an owner and the lag mean" testId="congress-guide" />
          </div>
          <p className="mt-0.5 text-[11px] text-textMuted whitespace-nowrap truncate">Every report of a trade made in the window, newest filing first · a row opens that member’s book</p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <dt className="text-[10px] text-textMuted cursor-help" title="STOCK Act reports on the grid right now, after the cards">Reports</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary whitespace-nowrap" data-congress-count>
              {quiet ? '—' : <>{stats.trades.length} <span className="text-textMuted">· {stats.purchases} bought · {stats.sales} sold</span></>}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] text-textMuted cursor-help" title="The middle number of days between a trade and its report — half filed faster, half slower">Median lag</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary whitespace-nowrap" data-congress-lag>
              {quiet || stats.trades.length === 0 ? '—' : `${stats.medianLag}d`}
            </dd>
          </div>
          <div>
            {/* a trade made under 45 days ago cannot be late yet — on the 30-day window the count is structurally nil, and says so */}
            <dt className="text-[10px] text-textMuted cursor-help" title={window <= STOCK_ACT_DEADLINE_DAYS ? `Reports filed more than ${STOCK_ACT_DEADLINE_DAYS} days after the trade. Every trade in the last ${window} days is younger than that, so none of them can be late yet — pick 90 or 180 days` : `Reports filed more than ${STOCK_ACT_DEADLINE_DAYS} days after the trade, the STOCK Act's limit — among trades made in the last ${window} days`}>Past the deadline</dt>
            <dd className={`mt-0.5 font-mono text-[12px] tnum whitespace-nowrap ${stats.lateFilings ? 'text-bear' : 'text-textPrimary'}`} data-congress-late>
              {quiet ? '—' : window <= STOCK_ACT_DEADLINE_DAYS ? <span className="text-textMuted">none can be yet</span> : stats.lateFilings}
            </dd>
          </div>
        </dl>
      </div>
      {/* THE ONE LINE OF CONTROLS */}
      <div className={`px-5 pb-2 ${CONTROLS_LINE}`} data-congress-controls>
        <DropdownSelect label="Window" value={window} options={WINDOW_OPTIONS} onChange={setWindow} title="How far back the reports run" testId="congress-window" />
        <DropdownSelect label="Chamber" value={chamber} options={CHAMBER_OPTIONS} onChange={setChamber} title="Which chamber" testId="congress-chamber" />
        <DropdownSelect label="Owner" value={owner} options={OWNER_OPTIONS} onChange={setOwner} title="Whose holding" testId="congress-owner" />
        <DropdownSelect label="Show" value={show} options={SHOW_OPTIONS} onChange={setShow} title="Which reports" testId="congress-show" />
        <DropdownMulti label="Filter" values={picks} groups={filterGroups} onChange={setPicks} title="The names and members on the page right now — tick any number; only those stay" testId="congress-filter" />
      </div>
      {!failed && !waiting && <CongressCoverageLine coverage={coverage} window={window} unread={feed.unreadTypes ?? 0} />}
      {failed ? (
        <FeedFallback />
      ) : (
        <p className="px-5 pb-3 text-[12px] leading-relaxed text-textSecondary" data-congress-sentence>
          {waiting ? 'Reading the reports.' : stats.trades.length === 0 && show === 'late' ? `No late report among trades made in the last ${window} days${window <= STOCK_ACT_DEADLINE_DAYS ? ` — none of them is ${STOCK_ACT_DEADLINE_DAYS} days old yet` : ''}.` : congressSentence(stats)}
        </p>
      )}
      {/* THE REPORTS TO KNOW */}
      <div className="px-5 pb-3 border-t border-borderSubtle/60" data-congress-to-know>
        {/* on a phone the head stacks: the label over its words (the device sweep, 2026-10-19: on one line they ran into each other) */}
        <div className="h-[26px] flex items-center gap-3 text-[10px] font-semibold uppercase tracking-widest text-textPrimary max-sm:h-auto max-sm:flex-col max-sm:items-start max-sm:gap-0.5 max-sm:py-1.5">
          <span>The reports to know</span>
          <span className="normal-case tracking-normal font-normal text-[10px] text-textSecondary">the biggest disclosed amounts on this cut, the latest first among equals · click one to keep the grid to that member</span>
        </div>
        {toKnow.length === 0 ? (
          <div className="h-[70px] flex items-center font-mono text-[10px] uppercase tracking-widest text-textMuted">{failed ? 'This read did not land' : waiting ? 'Reading the reports' : 'No report on this cut'}</div>
        ) : (
          <div
            /* every report across from 1280; six on a small laptop, four on a tablet, two on a phone (the device sweep,
               2026-10-19: six across at 390 left a card 50px wide with its words cut) */
            className="grid gap-2 grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-[repeat(var(--reports),minmax(0,1fr))]"
            style={{ '--reports': REPORTS_TO_KNOW } as CSSProperties}
          >
            {toKnow.map(t => (
              <ReportCard key={t.id} t={t} on={picks.includes(`member:${t.member.name}`)} onToggle={() => toggleMember(t.member.name)} />
            ))}
          </div>
        )}
      </div>
      {/* THE GRID — grown to its rows, the page scrolls (2026-09-11, the Compass board's rule) */}
      <div className="slayer-board border-t border-borderSubtle" data-congress-grid>
        <AgGridProvider modules={GRID_MODULES}>
          <AgGridReact<CongressTrade>
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
        {paged.bar(rows.length, 'congress-grid')}
      </div>
      <CongressHoldings />
    </div>
  );
};

export default Congress;
