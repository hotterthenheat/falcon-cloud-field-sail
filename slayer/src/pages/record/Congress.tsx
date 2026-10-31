/* What members of Congress reported trading under the STOCK Act, and how long they took to say so: the head's facts,
   the controls, the reports to know, then every report. */

import { ownerWord } from '../../data/whalesMap';
import { CardLine } from '../../components/record/PhoneCards';
import { useEffect, useMemo, useState } from 'react';
import { keptPick, keptStrings, readKeptView, useKeepView } from './keptView';
import { useNavigate } from 'react-router-dom';
import { type ColDef, type ICellRendererParams, type IRowNode } from 'ag-grid-community';
import { Controls, HeadFact, PhoneFold, RecordGrid, RecordHead, RecordPanel, Summary, ToKnow } from '../../components/record/RecordFrame';
import DropdownSelect, { type DropdownOption } from '../../components/ui/DropdownSelect';
import DropdownMulti, { type MultiGroup } from '../../components/ui/DropdownMulti';
import CompanyLogo from '../../components/ui/CompanyLogo';
import { CongressGuide } from '../../components/record/CongressGuide';
import { When } from '../../components/record/when';
import { AMOUNT_BRACKETS, STOCK_ACT_DEADLINE_DAYS, bracketLabel, bracketShort, congressSentence, isBondReport, isTreasuryBill, seatLabel, summariseCongress } from '../../data/congress';
import { useCongressCoverage, useCongressFeed, useCongressStatus, useKeptAt, wantCongressWindow, type CongressCoverage } from '../../data/liveRecord';
import { nyIsoDaysBack } from '../../data/nyDate';
import { FeedFallback } from '../../components/ui/liveRead';
import { companyName, isListed, tickerName } from '../../data/tickers';
import { useCompanyName } from '../../data/liveFiles';
import { useSeen } from '../../components/record/CoName';
import type { Chamber, CongressTrade, ReportOwner } from '../../types/record';
import { REPORTS_TO_KNOW } from './recordSkeletons';
import { CongressHoldings } from '../../components/record/ExtraFaces';
import { dollars3 } from './money';

const SILVER = 'rgb(var(--silver))';
type Window = 7 | 30 | 90 | 180;
type ChamberPick = 'both' | Chamber;
type OwnerPick = 'any' | ReportOwner;
type Show = 'all' | 'late' | 'purchases' | 'sales';

const WINDOW_OPTIONS: DropdownOption<Window>[] = [
  /* this week */
  { value: 7, label: '7 days', hint: 'The last seven days — filed or traded, as the Dated-by menu says' },
  { value: 30, label: '30 days', hint: 'The last month' },
  { value: 90, label: '90 days', hint: 'The last quarter' },
  { value: 180, label: '180 days', hint: 'The last half year' },
];
type Basis = 'filed' | 'traded';
/* the short windows go by filing day: a report is filed up to 45 days after the trade */
const BASIS_OPTIONS: DropdownOption<Basis>[] = [
  { value: 'filed', label: 'Filed', hint: 'Reports filed in the window — what is new on the record; the trade date is shown on each row' },
  { value: 'traded', label: 'Traded', hint: 'Trades made in the window, whenever they were filed' },
];
const CHAMBER_OPTIONS: DropdownOption<ChamberPick>[] = [
  { value: 'both', label: 'Both', hint: 'House and Senate' },
  { value: 'House', label: 'House', hint: 'Representatives only' },
  { value: 'Senate', label: 'Senate', hint: 'Senators only' },
];
const OWNER_OPTIONS: DropdownOption<OwnerPick>[] = [
  { value: 'any', label: 'Any', hint: 'The member, their spouse, a joint account or a dependent' },
  { value: 'Self', label: 'Self', hint: "The member's own holding" },
  { value: 'Undisclosed', label: 'Not stated', hint: 'The filing does not say whose holding it is' },
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

/* a member the roster has no party or state for says so, never a blank tag */
const seat = (t: CongressTrade) => seatLabel(t.member) || `${t.member.chamber === 'Senate' ? 'Senate' : t.member.chamber === 'House' ? 'House' : ''}${t.member.chamber ? ' · ' : ''}party n/a`;
const typeWord = (t: CongressTrade) => (t.type === 'Purchase' ? 'Purchase' : t.type === 'Exchange' ? 'Exchange' : 'Sale');
const typeInk = (t: CongressTrade) => (t.type === 'Purchase' ? 'text-bull' : t.type === 'Exchange' ? 'text-textMuted' : 'text-bear');

/* ---- cells: the house grammar inside the grid ------------------------------------ */

/* the dates, then how far back */
const FiledCell = ({ data }: ICellRendererParams<CongressTrade>) => (data ? <When days={data.filedDaysAgo} stack /> : null);

const MemberCell = ({ data }: ICellRendererParams<CongressTrade>) =>
  data ? (
    <span className="flex flex-col leading-tight min-w-0 text-left" data-open-member={data.member.id}>
      <span className="text-t12 font-semibold text-textPrimary truncate" title={`${data.member.name} ${seat(data)}`}>
        {data.member.name} <span className="font-mono text-t10 font-normal text-textMuted">{seat(data)}</span>
      </span>
      <span className="text-t10 text-textMuted truncate">{data.member.chamber}</span>
    </span>
  ) : null;

const SYMBOL = /^[A-Z][A-Z.]{0,5}$/;
/* an all-caps filing phrase ("US TREASURY BILLS") reads in sentence case, so it never shouts across a card */
/* short capital words that are names or legal forms stay capitals; plain English short words are sentence-cased */
const PLAIN_SHORT = new Set(['THE', 'AND', 'OF', 'FOR', 'IN', 'ON', 'AT', 'TO', 'BY', 'BILL', 'BILLS', 'FUND', 'BOND', 'BONDS', 'NOTE', 'NOTES', 'CORP', 'INC', 'CO', 'TRUST', 'BANK', 'CITY', 'TOWN', 'GAS', 'OIL', 'NEW', 'YORK', 'WEST', 'EAST', 'SOUTH', 'NORTH', 'REAL', 'LAND', 'FARM', 'FARMS', 'HOME', 'LOAN', 'CASH', 'GOLD', 'WEEK', 'YEAR', 'DUE', 'SER', 'SR', 'JR', 'CL', 'CLASS', 'UNIT', 'UNITS', 'STOCK', 'SHS', 'COM']);
const readable = (s: string) =>
  s.length > 6 && s === s.toUpperCase() && /[A-Z]{3}/.test(s)
    ? s.replace(/[A-Z][A-Z'&.]*/g, w => (w.length <= 4 && !PLAIN_SHORT.has(w.replace(/[.,']/g, '')) ? w : w.charAt(0) + w.slice(1).toLowerCase())).replace(/\bInc\b\.?/g, 'Inc.').replace(/\bCorp\b\.?/g, 'Corp.')
    : s;

export const assetLine = (t: CongressTrade) => {
  const sym = t.ticker.trim().toUpperCase();
  /* "None" / "N/A" ride in the ticker field on some filings — they are not symbols */
  const named = SYMBOL.test(sym) && !/^(NONE|NA|N\/A)$/.test(sym);
  const rawDesc = t.assetDescription && t.assetDescription !== 'Stock' && t.assetDescription !== 'Undisclosed' && t.assetDescription.toUpperCase() !== sym ? t.assetDescription : '';
  const fallback = !named && sym && !/^(NONE|NA|N\/A)$/.test(sym) ? sym : '';
  const described = readable(rawDesc || fallback);
  /* an option on a named stock says so on the row */
  if (named) {
    /* a listed stock goes by its listed name; the filer's own words only when the symbol is not listed */
    const listedName = (t.assetKind === 'Stock' || t.assetKind === 'Stock Option') && isListed(sym) ? companyName(sym) : '';
    const base = (listedName && listedName !== sym ? listedName : '') || described || (t.assetKind === 'Stock' || t.assetKind === 'Stock Option' ? companyName(sym) : t.assetKind);
    return { sym, title: sym, sub: t.assetKind === 'Stock Option' ? `${base} · option` : base };
  }
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
  /* the own name for a named stock, once its info lands */
  const [seenRef, seen] = useSeen<HTMLSpanElement>();
  useCompanyName(data?.ticker && SYMBOL.test(data.ticker.trim().toUpperCase()) ? data.ticker.trim().toUpperCase() : '', false, seen);
  if (!data) return null;
  const line = assetLine(data);
  return (
    /* a full-width flex, so a long asset name ends in an ellipsis instead of being sheared mid-word at the cell edge */
    <span ref={seenRef} className="flex items-center gap-2 min-w-0 w-full h-full overflow-hidden" title={line.sub ? `${line.title} · ${line.sub}` : line.title}>
      {line.sym ? <CompanyLogo ticker={line.sym} size={16} /> : null}
      <span className="flex flex-col leading-tight min-w-0 flex-1">
        <span className={`text-t12 font-bold text-textPrimary truncate ${line.sym ? 'font-mono' : ''}`} title={line.title}>{line.title}</span>
        {line.sub ? <span className="text-t10 text-textMuted truncate" title={line.sub}>{line.sub}</span> : null}
      </span>
    </span>
  );
};

const TypeCell = ({ data }: ICellRendererParams<CongressTrade>) =>
  data ? (
    <span className={`inline-flex flex-col leading-tight font-mono text-t11 tnum ${typeInk(data)}`}>
      {typeWord(data)}
      {data.type === 'Sale (Partial)' && <span className="text-t10 text-textMuted">partial</span>}
    </span>
  ) : null;

const OwnerCell = ({ data }: ICellRendererParams<CongressTrade>) =>
  data ? <span className={`inline-block whitespace-normal leading-tight font-mono text-t8 uppercase tracking-widest ${data.owner === 'Self' ? 'text-textPrimary' : 'text-textMuted'}`}>{ownerWord(data.owner)}</span> : null;

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
  if (data.bracket === null) return <span className="font-mono text-t10 text-textMuted">not disclosed</span>;
  if (data.amountOver != null)
    return (
      <span className="inline-flex flex-col items-start gap-1" title={`Over $${data.amountOver.toLocaleString('en-US')} — an open-ended amount as filed, no upper bound`}>
        <Ladder bracket={data.bracket} />
        <span className="font-mono text-t11 leading-tight tnum text-textPrimary whitespace-nowrap">{amountShort(data)}</span>
      </span>
    );
  return (
    /* the ladder over the figure: the column is the figure's width, not the two side by side */
    <span className="inline-flex flex-col items-start gap-1 min-w-0" title={`${bracketLabel(data.bracket)} · rung ${AMOUNT_BRACKETS[data.bracket].column} of ${AMOUNT_BRACKETS.length}`}>
      <Ladder bracket={data.bracket} />
      {/* the short form fits the column; the filed figures on hover */}
      <span className="font-mono text-t11 leading-tight tnum text-textPrimary whitespace-nowrap">{bracketShort(data.bracket)}</span>
    </span>
  );
};

const TradedCell = ({ data }: ICellRendererParams<CongressTrade>) => (data ? <When days={data.tradedDaysAgo} stack /> : null);

const LagCell = ({ data }: ICellRendererParams<CongressTrade>) => {
  if (!data) return null;
  if (data.lagDays < 0) return <span className="inline-block whitespace-normal leading-tight font-mono text-t10 text-textMuted" title="Filed before the trade date — a filing artefact real feeds carry">before the trade</span>;
  return (
    <span className="inline-flex flex-col leading-tight font-mono text-t11 tnum">
      <span className={data.late ? 'text-bear font-semibold' : data.lagDays > 30 ? 'text-textPrimary' : 'text-textSecondary'}>{data.lagDays}d</span>
      {data.late && <span className="text-t8 uppercase tracking-widest text-bear">late</span>}
    </span>
  );
};

/* the phone card: the member, the asset, the side and the amount, the dates under them */
const amountShort = (t: CongressTrade): string =>
  t.bracket === null ? 'not disclosed' : t.amountOver != null ? `Over $${t.amountOver >= 1e6 ? `${t.amountOver / 1e6}M` : `${Math.round(t.amountOver / 1e3)}K`}` : bracketLabel(t.bracket);
export const CongressCard = (t: CongressTrade, withMember = true) => {
  const line = assetLine(t);
  return (
    <>
      <CardLine
        left={
          <>
            {withMember ? (
              <>
                <span className="font-semibold">{t.member.name}</span> <span className="font-mono text-t10 text-textMuted">{seat(t)}</span>{' '}
              </>
            ) : null}
            <span className={line.sym ? 'font-mono font-bold' : 'font-semibold'}>{line.title}</span>
          </>
        }
        right={<span className={typeInk(t)}>{typeWord(t)}</span>}
      />
      <CardLine muted left={<>{ownerWord(t.owner)} · filed <When days={t.filedDaysAgo} size={10} /></>} right={<span className="text-t11 text-textPrimary">{amountShort(t)}</span>} />
      <CardLine muted left={<>traded <When days={t.tradedDaysAgo} size={10} /></>} right={t.lagDays < 0 ? 'before the trade' : <span className={t.late ? 'text-bear' : undefined}>{t.lagDays}d lag{t.late ? ' · late' : ''}</span>} />
    </>
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
        line.sym ? (
          <span className="flex items-center gap-2 min-w-0">
            <CompanyLogo ticker={line.sym} size={18} />
            {/* the symbol never gives way — the member's name is what truncates ("AP…" read as nothing) */}
            <span className="text-t12 font-bold text-textPrimary font-mono shrink-0">{line.title}</span>
            <span className="min-w-0 text-t10 text-textSecondary truncate" title={`${t.member.name} ${seat(t)}`}>
              {t.member.name} <span className="font-mono text-textMuted">{seat(t)}</span>
            </span>
          </span>
        ) : (
          /* an unlisted asset takes the whole line, the member under it, the full name on hover */
          <span className="flex flex-col min-w-0 leading-tight">
            {/* two lines before it cuts */}
            <span className="text-t12 font-bold text-textPrimary line-clamp-2 break-words" title={line.sub ? `${line.title} · ${line.sub}` : line.title}>{line.title}</span>
            <span className="min-w-0 text-t10 text-textSecondary truncate" title={`${t.member.name} ${seat(t)}`}>
              {t.member.name} <span className="font-mono text-textMuted">{seat(t)}</span>
            </span>
          </span>
        )
      );
    })()}
    {/* the bracket as its words — the ladder lives in the grid; at six across it pushed the label off the card */}
    {/* the amount never cuts; at two across it wraps under the side */}
    <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono tnum">
      <span className={`text-t11 ${typeInk(t)}`}>{typeWord(t)}</span>
      <span className="text-t11 font-bold text-textPrimary whitespace-nowrap" title={t.amountOver != null ? `Over $${t.amountOver.toLocaleString('en-US')}, as filed` : bracketLabel(t.bracket)}>{t.amountOver != null ? `Over $${t.amountOver >= 1e6 ? `${t.amountOver / 1e6}M` : `${Math.round(t.amountOver / 1e3)}K`}` : bracketShort(t.bracket)}</span>
      {t.late && <span className="ml-auto text-t8 uppercase tracking-widest text-bear">late</span>}
    </span>
    <span className="mt-1 block font-mono text-t8 uppercase tracking-widest text-textSecondary truncate">
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
const CongressCoverageLine = ({ coverage, window, unread, notMembers }: { coverage: CongressCoverage; window: number; unread: number; notMembers: number }) => {
  const start = nyIsoDaysBack(window);
  const covered = !!coverage.since && coverage.since <= start;
  const partial = coverage.partialDays.filter(d => d >= start);
  /* "complete" only with no day read short */
  const done = covered && !coverage.reading && partial.length === 0;
  return (
    <span className="block px-5 pb-2 text-t11 leading-relaxed text-textMuted" data-congress-coverage title="Our data provider sends at most 200 reports a request, newest trade first; the page asks again from the oldest trade day it reached">
      {covered
        ? `${done ? 'Complete · ' : ''}Every report of a trade made since ${shortDay(start)}`
        : coverage.since
          ? `Reports of trades made since ${shortDay(coverage.since)}${coverage.reading ? ' — reading further back' : coverage.capped ? ` — the read stops there, short of ${window} days` : ''}`
          : 'Reading'}
      {/* every day stepped past is named: the route cannot page within a day, so filings past its first 200 are unseen */}
      {partial.length
        ? ` · ${partial.map(d => shortDay(d)).join(', ')}: the feed held more than 200 filings for ${partial.length === 1 ? 'that day' : 'each of those days'} and answers only the first 200 of a day, so later filings from ${partial.length === 1 ? 'it' : 'them'} may be missing (of those first 200, ${partial.map(d => `${coverage.partialMembers[d] ?? 0}${partial.length > 1 ? ` on ${shortDay(d)}` : ''}`).join(', ')} ${partial.length === 1 && (coverage.partialMembers[partial[0]] ?? 0) === 1 ? 'was a member of Congress' : 'were members of Congress'} — the rest executive-branch filings)`
        : ''}
      {unread ? ` · ${unread} ${unread === 1 ? 'report' : 'reports'} with an unreadable type left out` : ''}
      {notMembers ? (
        <span data-congress-not-members>{` · ${notMembers.toLocaleString('en-US')} executive-branch ${notMembers === 1 ? 'filing' : 'filings'} on the same feed (the President's and officials' OGE reports) left out — not members of Congress`}</span>
      ) : null}
    </span>
  );
};

/** the read's progress, up front: how many of the window's days the reports reach, and "complete" once they do */
export const CongressProgress = ({ coverage, window, waiting }: { coverage: CongressCoverage; window: number; waiting: boolean }) => {
  const start = nyIsoDaysBack(window);
  const covered = !!coverage.since && coverage.since <= start;
  const shortDays = coverage.partialDays.filter(d => d >= start).length;
  const reach = coverage.since ? Math.max(0, Math.min(window, Math.round((Date.parse(`${nyIsoDaysBack(0)}T12:00:00Z`) - Date.parse(`${coverage.since}T12:00:00Z`)) / 86_400_000))) : 0;
  const text = waiting || (!coverage.since && coverage.reading)
    ? `Reading the reports · 0 of ${window} days so far`
    : covered
      ? coverage.reading
        ? `All ${window} days read · finishing`
        : shortDays > 0
          ? `All ${window} days read · ${shortDays} busy ${shortDays === 1 ? 'day' : 'days'} only to 200 filings`
          : `Complete · all ${window} days read`
      : coverage.reading
        ? `Reading · ${reach} of ${window} days so far — the counts grow as older reports land`
        : `Partial · ${reach} of ${window} days — the read stopped there`;
  const tone = covered && !coverage.reading ? 'text-textSecondary' : 'text-warn';
  return (
    <p className={`mt-1 font-mono text-t10 uppercase tracking-widest ${tone}`} data-congress-progress={covered && !coverage.reading ? 'complete' : coverage.reading || waiting ? 'reading' : 'partial'}>
      {text}
    </p>
  );
};

/** The Treasury-bill switch: on by default, and it says how many reports it is hiding */
export const BillsSwitch = ({ hide, onToggle, hidden, testId, reading = false }: { hide: boolean; onToggle: () => void; hidden: number; testId: string; reading?: boolean }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-pressed={hide}
    data-testid={testId}
    title={hide ? `${hidden.toLocaleString('en-US')} Treasury-bill ${hidden === 1 ? 'report is' : 'reports are'} hidden — parked cash, not an equity trade. Click to show them` : 'Treasury bills are shown. Click to hide them'}
    className={`h-7 px-2.5 rounded border font-mono text-t10 uppercase tracking-widest whitespace-nowrap transition-colors ${hide ? 'border-silver/50 bg-silver/[0.08] text-textPrimary' : 'border-borderMuted text-textSecondary hover:border-silver/40'}`}
  >
    {hide ? `T-bills hidden · ${reading ? '…' : hidden.toLocaleString('en-US')}` : 'T-bills shown'}
  </button>
);

/* ---- the page ------------------------------------------------------------------ */

const VIEW_KEY = 'slayer_congress_view';

const Congress = () => {
  const navigate = useNavigate();
  /* the cut is kept for the visit (keptView.ts, as News keeps its own): back from a member's page the list is as it was left */
  const keptView = useMemo(() => readKeptView(VIEW_KEY), []);
  const [window, setWindowRaw] = useState<Window>(() => keptPick<Window>(WINDOW_OPTIONS, keptView?.window, 90));
  const [basis, setBasis] = useState<Basis>(() => keptPick<Basis>(BASIS_OPTIONS, keptView?.basis, 'traded'));
  /* a short window opens on the filing day, a long one on the trade day; the menu changes it either way */
  const setWindow = (w: Window) => {
    setWindowRaw(w);
    setBasis(w <= 30 ? 'filed' : 'traded');
  };
  const [chamber, setChamber] = useState<ChamberPick>(() => keptPick<ChamberPick>(CHAMBER_OPTIONS, keptView?.chamber, 'both'));
  const [owner, setOwner] = useState<OwnerPick>(() => keptPick<OwnerPick>(OWNER_OPTIONS, keptView?.owner, 'any'));
  const [show, setShow] = useState<Show>(() => keptPick<Show>(SHOW_OPTIONS, keptView?.show, 'all'));
  /* Treasury bills are hidden by default (parked cash, not equity trades); one switch shows them and the head counts them */
  const [hideBills, setHideBills] = useState(() => keptView?.hideBills !== false);

  /* The feed is the live record when it answers; the reports are paged back by trade day until the window is covered */
  const feed = useCongressFeed(window, basis);
  /* by filing day the reports are read back 90 days of trades at least, so a report filed this week on an older trade is in */
  useEffect(() => wantCongressWindow(basis === 'filed' ? Math.max(window, 90) : window), [window, basis]);
  const coverage = useCongressCoverage();
  /* a failed read is not a quiet quarter — the figures go to dashes and the page says the read did not land */
  const status = useCongressStatus();
  const failed = status === 'sim';
  const waiting = status === 'loading';
  const quiet = failed || waiting;
  /* while the read pages back the figures are greyed and marked "so far" */
  const partial = !quiet && coverage.reading;
  const soFar = partial ? <span className="text-t9 text-textMuted" title="Still paging back — the figures grow as older reports land"> · so far</span> : null;
  const gridEmpty = failed ? 'This read did not land' : waiting ? 'Reading the reports' : 'No report on this cut';
  const billsHidden = useMemo(() => (hideBills ? feed.trades.filter(isTreasuryBill).length : 0), [feed, hideBills]);
  const cut = useMemo(
    () =>
      feed.trades.filter(t => {
        if (hideBills && isTreasuryBill(t)) return false;
        if (chamber !== 'both' && t.member.chamber !== chamber) return false;
        if (owner !== 'any' && t.owner !== owner) return false;
        if (show === 'late' && !t.late) return false;
        if (show === 'purchases' && t.type !== 'Purchase') return false;
        if (show === 'sales' && (t.type === 'Purchase' || t.type === 'Exchange')) return false;
        return true;
      }),
    [feed, chamber, owner, show, hideBills]
  );

  /* the filter reads the names and members on the cut; any pick keeps its rows */
  const [picks, setPicks] = useState<string[]>(() => keptStrings(keptView?.picks));
  useKeepView(VIEW_KEY, { window, basis, chamber, owner, show, hideBills, picks });
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
  /* in the grid's own order (newest filing, then newest trade), so the phone's cards read the same */
  const rows = useMemo(() => {
    const picked = new Set(picks);
    const out = picks.length === 0 ? [...cut] : cut.filter(t => picked.has(`name:${t.ticker}`) || picked.has(`member:${t.member.name}`));
    return out.sort((a, b) => a.filedDaysAgo - b.filedDaysAgo || a.tradedDaysAgo - b.tradedDaysAgo || String(b.id).localeCompare(String(a.id)));
  }, [cut, picks]);
  const toggleMember = (name: string) => setPicks(p => (p.includes(`member:${name}`) ? p.filter(x => x !== `member:${name}`) : [...p, `member:${name}`]));
  const stats = useMemo(() => summariseCongress(rows, window), [rows, window]);
  /* the stock-focused figures leave the bond reports out; the bonds are said apart */
  const equityStats = useMemo(() => summariseCongress(rows.filter(t => !isBondReport(t)), window), [rows, window]);
  const bondStats = useMemo(() => summariseCongress(rows.filter(isBondReport), window), [rows, window]);

  /* the reports to know: the biggest disclosed brackets on the cut, the latest first among equals */
  const toKnow = useMemo(
    () =>
      rows
        .filter(t => !isBondReport(t))
        .sort((a, b) => (b.bracket ?? -1) - (a.bracket ?? -1) || a.filedDaysAgo - b.filedDaysAgo)
        .slice(0, REPORTS_TO_KNOW),
    [rows]
  );

  const columnDefs = useMemo<ColDef<CongressTrade>[]>(
    () => [
      /* newest filing first, and within a day the newest trade first */
      {
        headerName: 'Filed',
        field: 'filedDaysAgo',
        width: 80,
        cellRenderer: FiledCell,
        sort: 'desc',
        comparator: (a: number, b: number, na: IRowNode<CongressTrade>, nb: IRowNode<CongressTrade>) => b - a || (nb.data?.tradedDaysAgo ?? 0) - (na.data?.tradedDaysAgo ?? 0) || String(nb.data?.id ?? '').localeCompare(String(na.data?.id ?? '')),
        headerTooltip: 'The day the report was filed, and how far back that is — newest first',
      },
      { headerName: 'Member', field: 'member', cellDataType: false, flex: 1.7, minWidth: 120, cellRenderer: MemberCell, comparator: (a: CongressTrade['member'], b: CongressTrade['member']) => a.name.localeCompare(b.name), headerTooltip: 'A row opens this member’s book' },
      { headerName: 'Asset', field: 'ticker', flex: 1.3, minWidth: 108, cellRenderer: AssetCell, headerTooltip: 'The stock the report names' },
      { headerName: 'Type', field: 'type', flex: 0.6, minWidth: 84, cellRenderer: TypeCell, headerTooltip: 'Purchase, sale (full or partial), or an exchange' },
      { headerName: 'Owner', field: 'owner', flex: 0.9, minWidth: 100, cellRenderer: OwnerCell, headerTooltip: "Whose holding the report covers — the member's own, their spouse's, a joint account or a dependent's" },
      {
        headerName: 'Amount',
        field: 'bracket',
        flex: 1.6,
        minWidth: 96,
        cellRenderer: AmountCell,
        comparator: (a: number | null, b: number | null) => (a ?? -1) - (b ?? -1),
        headerTooltip: 'The bracket the member disclosed, as a rung on the ten-rung ladder — never a midpoint; some scanned filings carry none',
      },
      { headerName: 'Traded', field: 'tradedDaysAgo', width: 80, cellRenderer: TradedCell, headerTooltip: 'The day the trade itself happened, and how far back that is' },
      { headerName: 'Lag', field: 'lagDays', width: 66, cellRenderer: LagCell, headerTooltip: `Days from the trade to the filing — past ${STOCK_ACT_DEADLINE_DAYS} it is late` },
    ],
    []
  );
  const defaultColDef = useMemo<ColDef<CongressTrade>>(() => ({ sortable: true, resizable: true, suppressMovable: true }), []);

  const kept = useKeptAt('congress');
  const window90 = basis === 'filed' ? Math.max(window, 90) : window;
  const summary = waiting
    ? 'Reading the reports.'
    : stats.trades.length === 0 && show === 'late'
      ? `No late report among ${basis === 'filed' ? 'reports filed' : 'trades made'} in the last ${window} days${window <= STOCK_ACT_DEADLINE_DAYS && basis === 'traded' ? ` — none of them is ${STOCK_ACT_DEADLINE_DAYS} days old yet` : ''}.`
      : `${bondStats.trades.length ? `Stocks, options and funds: ${congressSentence(equityStats).replace(/^No report on this cut/, 'none on this cut')} Bonds apart — ${bondStats.trades.length.toLocaleString('en-US')} ${bondStats.trades.length === 1 ? 'report' : 'reports'} of notes, munis and corporate bonds covering ${bondStats.totalHigh === null ? `at least ${dollars3(bondStats.totalLow)}` : `${dollars3(bondStats.totalLow)}–${dollars3(bondStats.totalHigh)}`}, on the grid but not in that total${bondStats.lateFilings ? `, ${bondStats.lateFilings.toLocaleString('en-US')} of them filed past the deadline` : ''}.` : congressSentence(stats)}${billsHidden ? ` ${billsHidden.toLocaleString('en-US')} Treasury-bill ${billsHidden === 1 ? 'report is' : 'reports are'} hidden from every count here.` : ''}`;

  return (
    <RecordPanel testId="congress" attrs={{ 'data-window': window }}>
      <RecordHead
        title="What Congress reported"
        guide={{ title: 'How to read the reports', door: 'What a row, a bracket, an owner and the lag mean', testId: 'congress-guide', body: <CongressGuide /> }}
        kept={kept}
        line={`${basis === 'filed' ? `Filed in the last ${window} days` : `Traded in the last ${window} days`} · newest filing first · a row opens that member's book`}
        status={!failed && <CongressProgress coverage={coverage} window={window90} waiting={waiting} />}
        facts={
          <>
            <HeadFact label="Reports" testId="congress-count" partial={partial} tip="STOCK Act reports on the grid now: bought, sold and exchanged add up to the whole">
              <span data-congress-count>
                {quiet ? '—' : (
                  <>
                    {stats.trades.length.toLocaleString('en-US')} <span className="text-textMuted">· {stats.purchases.toLocaleString('en-US')} bought · {stats.sales.toLocaleString('en-US')} sold</span>
                    {soFar}
                  </>
                )}
              </span>
            </HeadFact>
            <HeadFact label="Median lag" testId="congress-lag" partial={partial} tip="The middle number of days between a trade and its report">
              <span data-congress-lag>{quiet || stats.trades.length === 0 ? '—' : <>{stats.medianLag}d{soFar}</>}</span>
            </HeadFact>
            <HeadFact label="Past the deadline" testId="congress-late" partial={partial} tone={equityStats.lateFilings ? 'text-bear' : undefined} tip={`Reports filed more than ${STOCK_ACT_DEADLINE_DAYS} days after the trade, the STOCK Act's limit`}>
              <span data-congress-late>
                {quiet ? '—' : window <= STOCK_ACT_DEADLINE_DAYS && basis === 'traded' ? <span className="text-textMuted">none can be yet</span> : (
                  <>
                    {equityStats.lateFilings.toLocaleString('en-US')}
                    {bondStats.lateFilings > 0 ? <span className="text-textMuted"> · +{bondStats.lateFilings.toLocaleString('en-US')} {bondStats.lateFilings === 1 ? 'bond' : 'bonds'}</span> : null}
                    {soFar}
                  </>
                )}
              </span>
            </HeadFact>
          </>
        }
      />
      <PhoneFold label="Filters, summary and the reports to know" testId="congress">
        <Controls testId="congress">
          <DropdownSelect label="Window" value={window} options={WINDOW_OPTIONS} onChange={setWindow} title="How far back the reports run" testId="congress-window" />
          <DropdownSelect label="Dated by" value={basis} options={BASIS_OPTIONS} onChange={setBasis} title="Count a report by the day it was filed, or the day of the trade" testId="congress-basis" />
          <DropdownSelect label="Chamber" value={chamber} options={CHAMBER_OPTIONS} onChange={setChamber} title="Which chamber" testId="congress-chamber" />
          <DropdownSelect label="Owner" value={owner} options={OWNER_OPTIONS} onChange={setOwner} title="Whose holding" testId="congress-owner" />
          <DropdownSelect label="Show" value={show} options={SHOW_OPTIONS} onChange={setShow} title="Which reports" testId="congress-show" />
          <DropdownMulti label="Filter" values={picks} groups={filterGroups} onChange={setPicks} title="The names and members on the page right now — tick any number; only those stay" testId="congress-filter" />
          <BillsSwitch hide={hideBills} onToggle={() => setHideBills(v => !v)} hidden={billsHidden} testId="congress-bills" reading={waiting} />
        </Controls>
        {failed ? (
          <FeedFallback />
        ) : (
          <Summary testId="congress" more={!waiting && <CongressCoverageLine coverage={coverage} window={window90} unread={feed.unreadTypes ?? 0} notMembers={feed.notMembers ?? 0} />}>
            {summary}
          </Summary>
        )}
        <ToKnow title="The reports to know" sub="the biggest disclosed trades on this cut · a click keeps the grid to that member" testId="congress" count={REPORTS_TO_KNOW} empty={toKnow.length === 0 ? (failed ? 'This read did not land' : waiting ? 'Reading the reports' : 'No report on this cut') : null}>
          {toKnow.map(t => (
            <ReportCard key={t.id} t={t} on={picks.includes(`member:${t.member.name}`)} onToggle={() => toggleMember(t.member.name)} />
          ))}
        </ToKnow>
      </PhoneFold>
      <RecordGrid<CongressTrade>
        testId="congress"
        rows={rows}
        rowKey={t => t.id}
        card={t => CongressCard(t)}
        onOpen={t => navigate(`/dossier/congress/${t.member.id}`)}
        empty={gridEmpty}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
      />
      <CongressHoldings since={coverage.since} />
    </RecordPanel>
  );
};

export default Congress;
