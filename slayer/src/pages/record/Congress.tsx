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

import { ownerWord } from '../../data/whalesMap';
import { CardLine, PhoneCards, usePhoneCards } from '../../components/record/PhoneCards';
import { CONTROLS_LINE } from '../../components/trace/TraceBox';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ColDef, type ICellRendererParams, type IRowNode, type RowClickedEvent } from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import { usePagedGrid, phonePin } from '../../components/record/pagedGrid';
import { GRID_MODULES, GRID_THEME, noRows } from '../../components/ui/houseGrid';
import DropdownSelect, { type DropdownOption } from '../../components/ui/DropdownSelect';
import DropdownMulti, { type MultiGroup } from '../../components/ui/DropdownMulti';
import GuideFocus, { GuideDoor } from '../../components/ui/GuideFocus';
import CompanyLogo from '../../components/ui/CompanyLogo';
import { CongressGuide } from '../../components/record/CongressGuide';
import { When } from '../../components/record/when';
import { AMOUNT_BRACKETS, STOCK_ACT_DEADLINE_DAYS, bracketLabel, bracketShort, congressSentence, isBondReport, isTreasuryBill, seatLabel, summariseCongress } from '../../data/congress';
import { useCongressCoverage, useCongressFeed, useCongressStatus, wantCongressWindow, type CongressCoverage } from '../../data/liveRecord';
import { nyIsoDaysBack } from '../../data/nyDate';
import { FeedFallback } from '../../components/ui/liveRead';
import { companyName, isListed, tickerName } from '../../data/tickers';
import { useCompanyName } from '../../data/liveFiles';
import { useSeen } from '../../components/record/CoName';
import type { Chamber, CongressTrade, ReportOwner } from '../../types/record';
import { REPORTS_TO_KNOW } from './recordSkeletons';
import { CongressHoldings } from '../../components/record/ExtraFaces';
import { dollars3 } from './money';

const SILVER = 'rgb(var(--silver))'; /* the silver token — deep steel on the light terminal (2026-09-12) */
type Window = 7 | 30 | 90 | 180;
type ChamberPick = 'both' | Chamber;
type OwnerPick = 'any' | ReportOwner;
type Show = 'all' | 'late' | 'purchases' | 'sales';

const WINDOW_OPTIONS: DropdownOption<Window>[] = [
  /* THIS WEEK (round 8: the shortest window was 30 days) */
  { value: 7, label: '7 days', hint: 'The last seven days — filed or traded, as the Dated-by menu says' },
  { value: 30, label: '30 days', hint: 'The last month' },
  { value: 90, label: '90 days', hint: 'The last quarter' },
  { value: 180, label: '180 days', hint: 'The last half year' },
];
type Basis = 'filed' | 'traded';
/* THE FILING DAY FOR THE SHORT WINDOWS (round 9: "This week" by trade date read "2 reports · 0 bought" while purchases
   filed that week — Cleo Fields' TSM buy, filed 10/23 — sat outside it; a report is filed up to 45 days after the trade) */
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

/* a member the roster carries no party or state for (Alan Armstrong: party, chamber and district all null on
   /congress/politicians) says so, never a blank tag (round 9) */
const seat = (t: CongressTrade) => seatLabel(t.member) || `${t.member.chamber === 'Senate' ? 'Senate' : t.member.chamber === 'House' ? 'House' : ''}${t.member.chamber ? ' · ' : ''}party n/a`;
const typeWord = (t: CongressTrade) => (t.type === 'Purchase' ? 'Purchase' : t.type === 'Exchange' ? 'Exchange' : 'Sale');
const typeInk = (t: CongressTrade) => (t.type === 'Purchase' ? 'text-bull' : t.type === 'Exchange' ? 'text-textMuted' : 'text-bear');

/* ---- cells: the house grammar inside the grid ------------------------------------ */

/* the dates, then how far back (the partner's review: never "9d ago" alone) */
const FiledCell = ({ data }: ICellRendererParams<CongressTrade>) => (data ? <When days={data.filedDaysAgo} /> : null);

const MemberCell = ({ data }: ICellRendererParams<CongressTrade>) =>
  data ? (
    <span className="flex flex-col leading-tight min-w-0 text-left" data-open-member={data.member.id}>
      <span className="text-t12 font-semibold text-textPrimary truncate">
        {data.member.name} <span className="font-mono text-t10 font-normal text-textMuted">{seat(data)}</span>
      </span>
      <span className="text-t10 text-textMuted truncate">{data.member.chamber}</span>
    </span>
  ) : null;

const SYMBOL = /^[A-Z][A-Z.]{0,5}$/;
/* an all-caps filing phrase ("US TREASURY BILLS") reads in sentence case, so it never shouts across a card */
/* short capital words that are names or legal forms stay capitals ("REOF XXX, LLC", not "Reof Xxx, Llc" — the re-audit,
   2026-10-22); the plain English short words are sentenced */
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
  /* an option on a named stock says so on the row (audit round 6: Pelosi's AAPL [OP] read as a share purchase) */
  if (named) {
    /* A LISTED STOCK GOES BY ITS LISTED NAME (the retail test, round 7: a filer's "ExxonMobil Holdings Corporation Common
       Stock (XOM)" was shown as XOM's name) — the filer's own words only when the symbol is not a listed one */
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
        <span className={`text-t12 font-bold text-textPrimary truncate ${line.sym ? 'font-mono' : ''}`}>{line.title}</span>
        {line.sub ? <span className="text-t10 text-textMuted truncate">{line.sub}</span> : null}
      </span>
    </span>
  );
};

const TypeCell = ({ data }: ICellRendererParams<CongressTrade>) =>
  data ? (
    <span className={`font-mono text-t11 tnum ${typeInk(data)}`}>
      {typeWord(data)}
      {data.type === 'Sale (Partial)' && <span className="text-textMuted"> · partial</span>}
    </span>
  ) : null;

const OwnerCell = ({ data }: ICellRendererParams<CongressTrade>) =>
  data ? <span className={`font-mono text-t8 uppercase tracking-widest ${data.owner === 'Self' ? 'text-textPrimary' : 'text-textMuted'}`}>{ownerWord(data.owner)}</span> : null;

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
      <span className="inline-flex items-center gap-2.5" title="An open-ended amount as filed — no upper bound">
        <Ladder bracket={data.bracket} />
        <span className="font-mono text-t11 tnum text-textPrimary whitespace-nowrap">Over ${data.amountOver.toLocaleString('en-US')}</span>
      </span>
    );
  return (
    <span className="inline-flex items-center gap-2.5 min-w-0" title={`${bracketLabel(data.bracket)} · rung ${AMOUNT_BRACKETS[data.bracket].column} of ${AMOUNT_BRACKETS.length}`}>
      <Ladder bracket={data.bracket} />
      {/* the short form fits the column (round 11: "$5,000,001 – $25,000,0" cut); the filed figures on hover */}
      <span className="font-mono text-t11 tnum text-textPrimary whitespace-nowrap">{bracketShort(data.bracket)}</span>
    </span>
  );
};

const TradedCell = ({ data }: ICellRendererParams<CongressTrade>) => (data ? <When days={data.tradedDaysAgo} /> : null);

const LagCell = ({ data }: ICellRendererParams<CongressTrade>) => {
  if (!data) return null;
  if (data.lagDays < 0) return <span className="font-mono text-t10 text-textMuted" title="Filed before the trade date — a filing artefact real feeds carry">before the trade</span>;
  return (
    <span className="inline-flex items-center gap-2 font-mono text-t11 tnum">
      <span className={data.late ? 'text-bear font-semibold' : data.lagDays > 30 ? 'text-textPrimary' : 'text-textSecondary'}>{data.lagDays}d</span>
      {data.late && <span className="text-t8 uppercase tracking-widest text-bear">late</span>}
    </span>
  );
};

/* THE PHONE CARD — the member, the asset, the side and the amount, the dates under them (components/record/PhoneCards.tsx) */
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
          /* an unlisted asset ("Reof Xxx, Llc", "Bank of No…" cut on the card — the re-audit, 2026-10-22) takes the whole
             line, the member under it, the full name on hover */
          <span className="flex flex-col min-w-0 leading-tight">
            {/* two lines before it cuts (round 11: "Not Fade Away LLC Co…") */}
            <span className="text-t12 font-bold text-textPrimary line-clamp-2 break-words" title={line.sub ? `${line.title} · ${line.sub}` : line.title}>{line.title}</span>
            <span className="min-w-0 text-t10 text-textSecondary truncate" title={`${t.member.name} ${seat(t)}`}>
              {t.member.name} <span className="font-mono text-textMuted">{seat(t)}</span>
            </span>
          </span>
        )
      );
    })()}
    {/* the bracket as its words — the ladder lives in the grid; at six across it pushed the label off the card */}
    {/* the amount never cuts (audit round 5, phone: "Purchase $500K – $…") — at two across it wraps under the side */}
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
  /* "complete" only with no day read short (audit round 6) */
  const done = covered && !coverage.reading && partial.length === 0;
  return (
    <p className="px-5 pb-2 text-t11 leading-relaxed text-textMuted" data-congress-coverage title="Unusual Whales sends at most 200 reports a request, newest trade first; the page asks again from the oldest trade day it reached">
      {covered
        ? `${done ? 'Complete · ' : ''}Every report of a trade made since ${shortDay(start)}`
        : coverage.since
          ? `Reports of trades made since ${shortDay(coverage.since)}${coverage.reading ? ' — reading further back' : coverage.capped ? ` — the read stops there, short of ${window} days` : ''}`
          : 'Reading'}
      {/* every day stepped past is named (audit round 6): the route cannot page within a day, so its filings after the
          first 200 are unseen, members' among them or not */}
      {/* said plainly (round 8: "1 day with more than 200 filings (Jul 29, 0 of the first 200 members')…" read as noise) */}
      {partial.length
        ? ` · ${partial.map(d => shortDay(d)).join(', ')}: the feed held more than 200 filings for ${partial.length === 1 ? 'that day' : 'each of those days'} and answers only the first 200 of a day, so later filings from ${partial.length === 1 ? 'it' : 'them'} may be missing (of those first 200, ${partial.map(d => `${coverage.partialMembers[d] ?? 0}${partial.length > 1 ? ` on ${shortDay(d)}` : ''}`).join(', ')} ${partial.length === 1 && (coverage.partialMembers[partial[0]] ?? 0) === 1 ? 'was a member of Congress' : 'were members of Congress'} — the rest executive-branch filings)`
        : ''}
      {unread ? ` · ${unread} ${unread === 1 ? 'report' : 'reports'} with an unreadable type left out` : ''}
      {notMembers ? (
        <span data-congress-not-members>{` · ${notMembers.toLocaleString('en-US')} executive-branch ${notMembers === 1 ? 'filing' : 'filings'} on the same feed (the President's and officials' OGE reports) left out — not members of Congress`}</span>
      ) : null}
    </p>
  );
};

/** THE READ'S PROGRESS, UP FRONT (audit round 5: "since Aug 29 — reading further back" sat in a footnote): how many of
    the window's days the reports reach while the read pages back, and a plain "complete" once it has */
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

const Congress = () => {
  const navigate = useNavigate();
  const phone = usePhoneCards();
  const [window, setWindowRaw] = useState<Window>(90);
  const [basis, setBasis] = useState<Basis>('traded');
  /* a short window opens on the filing day, a long one on the trade day; the menu changes it either way */
  const setWindow = (w: Window) => {
    setWindowRaw(w);
    setBasis(w <= 30 ? 'filed' : 'traded');
  };
  const [chamber, setChamber] = useState<ChamberPick>('both');
  const [owner, setOwner] = useState<OwnerPick>('any');
  const [show, setShow] = useState<Show>('all');
  /* TREASURY BILLS HIDDEN BY DEFAULT (audit round 5): parked cash in 4- to 52-week bills filled the book and every
     member's page, burying the equity trades — one switch shows them, and the head says how many it hid */
  const [hideBills, setHideBills] = useState(true);
  const [phoneMore, setPhoneMore] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

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
  /* PARTIAL TOTALS SAY SO (round 11: "Reports 197 · Median lag 17d · Past the deadline 0" at 1.5s, settling at 723 / 23d
     / 4) — while the read pages back the figures are greyed and marked "so far", as on Insiders */
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
  /* the stock-focused figures leave the bond reports out; the bonds are said apart (round 8) */
  const equityStats = useMemo(() => summariseCongress(rows.filter(t => !isBondReport(t)), window), [rows, window]);
  const bondStats = useMemo(() => summariseCongress(rows.filter(isBondReport), window), [rows, window]);

  /* THE REPORTS TO KNOW: the biggest disclosed brackets on the cut, the latest first among equals */
  const toKnow = useMemo(
    () =>
      cut
        .filter(t => !isBondReport(t))
        .sort((a, b) => (b.bracket ?? -1) - (a.bracket ?? -1) || a.filedDaysAgo - b.filedDaysAgo)
        .slice(0, REPORTS_TO_KNOW),
    [cut]
  );

  const columnDefs = useMemo<ColDef<CongressTrade>[]>(
    () => [
      /* THE ARROW SAYS NEWEST FIRST (the retail test, round 7: "Filed ↑" on a newest-first grid, and rows of one filing day
         in feed order as pages landed): the column sorts by recency, descending — newest filing first, and within a day
         the newest trade first */
      {
        headerName: 'Filed',
        field: 'filedDaysAgo',
        width: 146,
        cellRenderer: FiledCell,
        sort: 'desc',
        comparator: (a: number, b: number, na: IRowNode<CongressTrade>, nb: IRowNode<CongressTrade>) => b - a || (nb.data?.tradedDaysAgo ?? 0) - (na.data?.tradedDaysAgo ?? 0) || String(nb.data?.id ?? '').localeCompare(String(na.data?.id ?? '')),
        headerTooltip: 'The day the report was filed, and how far back that is — newest first',
      },
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
            <h3 className="text-t15 font-semibold leading-tight text-textPrimary whitespace-nowrap">What Congress reported</h3>
            <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What a row, a bracket, an owner and the lag mean" testId="congress-guide" />
          </div>
          {/* on a phone the line wraps rather than cutting off mid-word (the retail test, round 7) */}
          <p className="mt-0.5 text-t11 text-textMuted sm:whitespace-nowrap sm:truncate">{basis === 'filed' ? `Every report filed in the last ${window} days, whenever the trade was made (its date on each row)` : 'Every report of a trade made in the window'}, newest filing first · a row opens that member’s book</p>
          {!failed && <CongressProgress coverage={coverage} window={basis === 'filed' ? Math.max(window, 90) : window} waiting={waiting} />}
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <dt className="text-t10 text-textMuted cursor-help" title="STOCK Act reports on the grid right now, after the cards — bought, sold (full or partial) and exchanged add up to the whole">Reports</dt>
            <dd className={`mt-0.5 font-mono text-t12 tnum whitespace-nowrap ${partial ? 'opacity-60' : ''} text-textPrimary`} data-congress-count data-partial={partial ? '' : undefined}>
              {quiet ? '—' : (
                <>
                  {stats.trades.length.toLocaleString('en-US')}{' '}
                  <span className="text-textMuted">
                    · {stats.purchases.toLocaleString('en-US')} bought · {stats.sales.toLocaleString('en-US')} sold
                    {stats.trades.length - stats.purchases - stats.sales > 0 ? ` · ${(stats.trades.length - stats.purchases - stats.sales).toLocaleString('en-US')} exchanged` : ''}
                  </span>
                  {soFar}
                </>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-t10 text-textMuted cursor-help" title="The middle number of days between a trade and its report — half filed faster, half slower">Median lag</dt>
            <dd className={`mt-0.5 font-mono text-t12 tnum text-textPrimary whitespace-nowrap ${partial ? 'opacity-60' : ''}`} data-congress-lag>
              {quiet || stats.trades.length === 0 ? '—' : <>{stats.medianLag}d{soFar}</>}
            </dd>
          </div>
          <div>
            {/* a trade made under 45 days ago cannot be late yet — on the 30-day window the count is structurally nil, and says so */}
            <dt className="text-t10 text-textMuted cursor-help" title={window <= STOCK_ACT_DEADLINE_DAYS && basis === 'traded' ? `Reports filed more than ${STOCK_ACT_DEADLINE_DAYS} days after the trade. Every trade in the last ${window} days is younger than that, so none of them can be late yet — pick 90 or 180 days` : `Reports filed more than ${STOCK_ACT_DEADLINE_DAYS} days after the trade, the STOCK Act's limit — among ${basis === 'filed' ? 'reports filed' : 'trades made'} in the last ${window} days`}>Past the deadline</dt>
            <dd className={`mt-0.5 font-mono text-t12 tnum whitespace-nowrap ${equityStats.lateFilings ? 'text-bear' : 'text-textPrimary'} ${partial ? 'opacity-60' : ''}`} data-congress-late>
              {quiet ? '—' : window <= STOCK_ACT_DEADLINE_DAYS && basis === 'traded' ? <span className="text-textMuted">none can be yet</span> : (
                /* ONE BASIS WITH THE SENTENCE (audit round 10: "Past the deadline 7" counted the bonds, the line under it said
                   "4 missed the 45-day deadline" of the stocks) — the stocks' count, the bonds' said beside it */
                <>
                  {equityStats.lateFilings.toLocaleString('en-US')}
                  {bondStats.lateFilings > 0 ? <span className="text-textMuted"> · +{bondStats.lateFilings.toLocaleString('en-US')} {bondStats.lateFilings === 1 ? 'bond' : 'bonds'}</span> : null}
                  {soFar}
                </>
              )}
            </dd>
          </div>
        </dl>
      </div>
      {/* ON A PHONE THE CONTROLS AND THE PROSE FOLD BEHIND ONE ROW (round 11: ~1,500px of menus, sentences and cards stood
          before the first trade) */}
      {phone && (
        <button
          type="button"
          onClick={() => setPhoneMore(v => !v)}
          aria-expanded={phoneMore}
          className="mx-5 mb-3 h-8 px-3 rounded border border-borderMuted font-mono text-t10 uppercase tracking-widest text-textSecondary flex items-center justify-between"
          data-congress-phone-more={phoneMore ? 'open' : 'closed'}
        >
          <span>{phoneMore ? 'Hide' : 'Show'} the filters, the summary and the reports to know</span>
          <span aria-hidden>{phoneMore ? '−' : '+'}</span>
        </button>
      )}
      {(!phone || phoneMore) && (
      <>
      {/* THE ONE LINE OF CONTROLS */}
      <div className={`px-5 pb-2 ${CONTROLS_LINE}`} data-congress-controls>
        <DropdownSelect label="Window" value={window} options={WINDOW_OPTIONS} onChange={setWindow} title="How far back the reports run" testId="congress-window" />
        <DropdownSelect label="Dated by" value={basis} options={BASIS_OPTIONS} onChange={setBasis} title="Count a report by the day it was filed, or the day of the trade" testId="congress-basis" />
        <DropdownSelect label="Chamber" value={chamber} options={CHAMBER_OPTIONS} onChange={setChamber} title="Which chamber" testId="congress-chamber" />
        <DropdownSelect label="Owner" value={owner} options={OWNER_OPTIONS} onChange={setOwner} title="Whose holding" testId="congress-owner" />
        <DropdownSelect label="Show" value={show} options={SHOW_OPTIONS} onChange={setShow} title="Which reports" testId="congress-show" />
        <DropdownMulti label="Filter" values={picks} groups={filterGroups} onChange={setPicks} title="The names and members on the page right now — tick any number; only those stay" testId="congress-filter" />
        <BillsSwitch hide={hideBills} onToggle={() => setHideBills(v => !v)} hidden={billsHidden} testId="congress-bills" reading={waiting} />
      </div>
      {!failed && !waiting &&  <CongressCoverageLine coverage={coverage} window={basis === 'filed' ? Math.max(window, 90) : window} unread={feed.unreadTypes ?? 0} notMembers={feed.notMembers ?? 0} />}
      {failed ? (
        <FeedFallback />
      ) : (
        <p className="px-5 pb-3 text-t12 leading-relaxed text-textSecondary" data-congress-sentence>
          {waiting ? 'Reading the reports.' : stats.trades.length === 0 && show === 'late' ? `No late report among ${basis === 'filed' ? 'reports filed' : 'trades made'} in the last ${window} days${window <= STOCK_ACT_DEADLINE_DAYS && basis === 'traded' ? ` — none of them is ${STOCK_ACT_DEADLINE_DAYS} days old yet` : ''}.` : `${bondStats.trades.length ? `Stocks, options and funds: ${congressSentence(equityStats).replace(/^No report on this cut/, 'none on this cut')} Bonds apart — ${bondStats.trades.length.toLocaleString('en-US')} ${bondStats.trades.length === 1 ? 'report' : 'reports'} of notes, munis and corporate bonds covering ${bondStats.totalHigh === null ? `at least ${dollars3(bondStats.totalLow)}` : `${dollars3(bondStats.totalLow)}–${dollars3(bondStats.totalHigh)}`}, on the grid but not in that total${bondStats.lateFilings ? `, ${bondStats.lateFilings.toLocaleString('en-US')} of them filed past the deadline` : ''}.` : congressSentence(stats)}${billsHidden ? ` ${billsHidden.toLocaleString('en-US')} Treasury-bill ${billsHidden === 1 ? 'report is' : 'reports are'} hidden from every count here.` : ''}`}
        </p>
      )}
      {/* THE REPORTS TO KNOW */}
      <div className="px-5 pb-3 border-t border-borderSubtle/60" data-congress-to-know>
        {/* on a phone the head stacks: the label over its words (the device sweep, 2026-10-19: on one line they ran into each other) */}
        <div className="h-[26px] flex items-center gap-3 text-t10 font-semibold uppercase tracking-widest text-textPrimary max-sm:h-auto max-sm:flex-col max-sm:items-start max-sm:gap-0.5 max-sm:py-1.5">
          <span>The reports to know</span>
          <span className="normal-case tracking-normal font-normal text-t10 text-textSecondary">the biggest disclosed stock, option and fund trades on this cut, the latest first among equals — bonds are left to the grid · click one to keep the grid to that member</span>
        </div>
        {toKnow.length === 0 ? (
          <div className="h-[70px] flex items-center font-mono text-t10 uppercase tracking-widest text-textMuted">{failed ? 'This read did not land' : waiting ? 'Reading the reports' : 'No report on this cut'}</div>
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
      </>
      )}
      {/* THE GRID — grown to its rows, the page scrolls (2026-09-11, the Compass board's rule) */}
      <div className="slayer-board border-t border-borderSubtle" data-congress-grid>
        {phone ? (
          <PhoneCards rows={rows} rowKey={t => t.id} card={t => CongressCard(t)} onOpen={t => navigate(`/dossier/congress/${t.member.id}`)} empty={gridEmpty} testId="congress" resetKey={rows} />
        ) : (
        <>
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
        </>
        )}
      </div>
      <CongressHoldings since={coverage.since} />
    </div>
  );
};

export default Congress;
