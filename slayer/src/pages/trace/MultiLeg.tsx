/* The tape reconstructed into structures: each one named and priced from its own settled legs, its expiry risk at the
   right, and a card that says in plain words what the shape does. */

import { useCallback, useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTraceSession } from '../../components/trace/traceSession';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, CalendarDays } from 'lucide-react';
import { useTicker } from '../../context/MarketDataContext';
import { fmtCount as num, indexRoot, lastRegularClose, plural, tapeSessionIso, usd as fmtUsd, useLegsFirst, useSpreads, useSpreadTrade } from '../../data/traceLive';
import { nyWallTime } from '../../core/nyTime';
import { FeedFallback, TickFigure } from '../../components/ui/liveRead';
import { markSplitOrders, spreadLegRow, SPREAD_KINDS, type SpreadKind, type SpreadLeg, type SpreadTrade } from '../../data/flowBook';
import BookDrill from '../../components/trace/BookDrill';
import { earnMarks, weightInk } from '../../components/trace/earnedInk';
import { LiveHold, SessionMark, useHold } from '../../components/trace/LiveHold';
import ExpiryCalendar from '../../components/ui/ExpiryCalendar';
import { useExpiryCut } from '../../components/trace/bookExpiry';
import { isoDate } from '../../core/calendar';
import ColumnChooser, { useHiddenColumns } from '../../components/trace/ColumnChooser';
import FlowSearch, { searchMiss, matchesContract, normSymbol, searchedName, useSearchedName } from '../../components/trace/FlowSearch';
import ReadDoor from '../../components/trace/ReadDoor';
import type { Column } from '../../components/ui/DataTable';
import DropdownSelect, { type DropdownOption } from '../../components/ui/DropdownSelect';
import CompanyLogo from '../../components/ui/CompanyLogo';
import WatchStar from '../../components/trace/WatchStar';
import { structureKey, watchStructure } from '../../context/WatchContext';
import RichRead from '../../components/ui/RichRead';
import TraceBox, { Champion, endlessOf, Fact, PhoneRow, TraceGrid } from '../../components/trace/TraceBox';
import { SavedCutsControl, SavedCutsList, useSavedCuts } from '../../components/trace/SavedCuts';
import { isIsoDay, isQuery, oneOf, useAddressCut } from '../../components/trace/addressCut';
import { PREM_FLOOR_OPTIONS, PREM_FLOORS, type PremFloor } from '../../components/trace/premFloor';
import { createViewStore } from '../../data/savedViews';
import { StructureGuide } from '../../components/trace/TraceGuide';
import Modal from '../../components/ui/Modal';
import { expiryLabel } from '../../core/format';
import { dayAdv, spanWords } from '../../components/trace/dayWords';

/** The structures the page holds: the feed's newest */
const SPREADS_N = 200;
/** The rows a screen shows: their legs are read first */
const FIRST_SCREEN = 20;

/* `short` fits a phone's half-width card */
const SHAPE_OPTIONS: DropdownOption<SpreadKind | 'ALL'>[] = [{ value: 'ALL', label: 'Every shape', short: 'All', hint: 'Every structure on the tape' }, ...SPREAD_KINDS.map(k => ({ value: k.key, label: k.label, hint: k.read }))];
const MONEY_OPTIONS: DropdownOption<'ALL' | 'DEBIT' | 'CREDIT'>[] = [
  { value: 'ALL', label: 'Paid and collected', short: 'Both', hint: 'Debit and credit structures' },
  { value: 'DEBIT', label: 'Paid', hint: 'Structures that cost money to put on' },
  { value: 'CREDIT', label: 'Collected', hint: 'Structures that paid the trader to put on' },
];
/* the set at rest fits a 1440 box beside the pinned risk columns */
const WIDTHS: Record<string, number> = { time: 100, ticker: 84, strikes: 136, exp: 104, size: 56, net: 124, prem: 124, legs: 56, kind: 160, maxloss: 88, maxprofit: 88 };
/* who on the left, the risk at the right, both always on screen */
const PIN_LEFT = ['time', 'ticker'];
const PIN_RIGHT = ['maxloss', 'maxprofit'];
const ML_CUTS = createViewStore('slayer_multileg_cuts_v1');
const TOOLTIPS: Record<string, string> = {
  strategy: 'The shape; its dot is its kind, never a verdict',
  kind: 'The shape named from its legs; its dot is its kind, never a verdict',
  strikes: 'Every strike the structure prints, in order',
  size: "Units: the legs' contracts over their common factor (S5/B10/S5 is 5 flies)",
  net: 'Net premium per unit (over units × 100), paid or collected',
  prem: "The structure's net premium, paid or collected; the gross of every leg is on the hover",
  maxloss: 'The most it can lose at expiry, from its legs as bought and sold',
  maxprofit: 'The most it can make at expiry, from its legs as bought and sold',
  legs: 'How many legs the structure has',
};

/** Categorical strategy dots (tokens.css --cat-*): a shape is a kind, never a verdict */
const KIND_DOT: Record<SpreadKind, string> = {
  vertical: 'rgb(var(--cat-guidance))',
  condor: 'rgb(var(--cat-analyst))',
  butterfly: 'rgb(var(--cat-earnings))',
  straddle: 'rgb(var(--cat-macro))',
  strangle: 'rgb(var(--cat-ma))',
  calendar: 'rgb(var(--cat-regulatory))',
  diagonal: 'rgb(var(--cat-regulatory))',
  ratio: 'rgb(var(--cat-product))',
  synthetic: 'rgb(var(--cat-guidance))',
  riskReversal: 'rgb(var(--cat-macro))',
  custom: 'rgb(var(--text-muted))',
};

/** A compression package, said once (SidesRule) */
const COMPRESSION_HINT = "OPRA's cbmo / mctp: a floor package that nets open interest down between members. Not a bet, so never crowned or counted";
const UNVERIFIED_HINT = 'Its settled legs contradict the listed shape or its stated risk, so it is shown but never crowned';
const shapeWord = (t: SpreadTrade) => (t.shape === 'unnamed' ? KIND_META[t.kind].label : t.shape);

const KIND_META = Object.fromEntries(SPREAD_KINDS.map(k => [k.key, k])) as Record<SpreadKind, (typeof SPREAD_KINDS)[number]>;

const RISK_WHY: Record<NonNullable<SpreadTrade['riskNote']>, string> = {
  unsettled: 'No set of buys and sells adds up to its net, so no payoff is drawn',
  expiries: 'Its legs run to different expiries, so no max is drawn',
  'no-net': 'No net was printed, so which way it went is not known',
};
const riskCell = (v: number | 'uncapped' | null, tone: 'loss' | 'profit', t?: SpreadTrade) => {
  if (t && t.legsState === 'pending') return <span className="text-textMuted" title="Reading its legs">…</span>;
  if (v === null) return <span className="text-textSecondary" title={t?.riskNote ? RISK_WHY[t.riskNote] : t?.legsState === 'none' ? 'Its legs did not load' : undefined}>—</span>;
  if (t?.unverified) return <span className="text-textMuted" title={UNVERIFIED_HINT}>{v === 'uncapped' ? 'Uncapped' : fmtUsd(v)}?</span>;
  if (v === 'uncapped') return <span className={`font-bold ${tone === 'loss' ? 'text-warn' : 'text-bull'}`}>Uncapped</span>;
  return <span className={tone === 'loss' ? 'text-bear' : 'text-bull'}>{fmtUsd(v)}</span>;
};

const doorBtn = 'inline-flex items-center gap-1 font-mono text-t11 uppercase tracking-wider text-textSecondary hover:text-textPrimary border border-borderSubtle rounded px-2 py-1 hover:bg-ink/[0.04] transition-colors';

/** One structure opened up: the legs, the risk box, and a line saying what the shape does */
const SpreadCard = ({ trade, onClose, onLeg }: { trade: SpreadTrade; onClose: () => void; onLeg: (legs: SpreadLeg[], i: number) => void }) => {
  const navigate = useNavigate();
  /* the card reads its own legs, settled by the same function as the row, so the two never disagree */
  const own = useSpreadTrade(trade);
  const t = own.trade ?? trade;
  const legs = t.legs;
  const settled = legs.length > 0 && legs.every(l => l.side != null);
  const theta = Number.isFinite(t.theta) ? t.theta : null;
  const maxLoss = t.maxLoss;
  const maxProfit = t.maxProfit;
  const units = t.units ?? null;

  const go = (fn: () => void) => {
    onClose();
    fn();
  };

  const fact = (label: string, value: ReactNode) => (
    <div className="flex items-baseline justify-between gap-3 py-1 border-b border-borderSubtle/50 last:border-0">
      <span className="font-mono text-t11 uppercase tracking-wider text-textMuted">{label}</span>
      <span className="font-mono text-xs tnum text-textPrimary text-right">{value}</span>
    </div>
  );

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel={`${trade.ticker} ${KIND_META[trade.kind].label}`}
      widthClass="max-w-[480px]"
      header={
        /* on a phone the name wraps under the time, never over it */
        <span className="flex items-center gap-x-2.5 gap-y-1 min-w-0 flex-wrap">
          <CompanyLogo ticker={trade.ticker} size={20} />
          <span className="font-mono text-sm font-bold text-textPrimary">{trade.ticker}</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ink/[0.06] px-2 py-0.5 font-mono text-t11 font-semibold text-textPrimary min-w-0 max-w-full">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: KIND_DOT[trade.kind] }} />
            <span className="truncate">{t.shape === 'unnamed' ? KIND_META[t.kind].label : t.shape}</span>
          </span>
          {trade.extended && <span className="font-mono text-t10 uppercase tracking-wider text-textMuted whitespace-nowrap" title="Filled after hours against thin quotes; shown, not read for direction">after hours · not read</span>}
          {trade.compression && <span className="font-mono text-t10 uppercase tracking-wider text-warn whitespace-nowrap" title={COMPRESSION_HINT}>compression · not a bet</span>}
          {t.unverified && <span className="font-mono text-t10 uppercase tracking-wider text-warn whitespace-nowrap" title={UNVERIFIED_HINT}>unverified</span>}
          {t.vendorShape && <span className="font-mono text-t10 text-textMuted whitespace-nowrap" title="Listed under another name; its legs as bought and sold say otherwise">listed as {t.vendorShape}</span>}
          {t.namedBy === 'vendor' && !t.compression && <span className="font-mono text-t10 text-textMuted whitespace-nowrap" title={t.legsState === 'pending' ? 'The listed name; its legs are still being read' : 'The listed name; its legs do not settle into buys and sells that add up to its net'}>as listed</span>}
        </span>
      }
      headerActions={
        <span className="font-mono text-t11 text-textSecondary tnum whitespace-nowrap shrink-0">
          {trade.time}
          {trade.spot > 0 ? (indexRoot(trade.ticker) ? ` · index ${Math.round(trade.spot).toLocaleString('en-US')}` : ` · spot $${trade.spot.toFixed(2)}`) : ''}
        </span>
      }
    >
      <div>
        {/* the structure in a sentence from its own legs, never the family's fixed line */}
        <div className="text-t12 text-textSecondary leading-snug mb-3" data-spread-read>
          <RichRead text={t.read ?? (own.waiting ? 'Reading the legs…' : KIND_META[trade.kind].read)} />
        </div>

        {/* each line one fill, its side settled by the structure's net; a leg opens its contract's card */}
        <div className="border border-borderSubtle rounded mb-3 overflow-hidden" data-spread-legs>
          {legs.length === 0 ? (
            <div className="px-2.5 py-3 font-mono text-t11 text-textMuted">{own.waiting ? 'Reading the legs…' : own.failed ? 'The legs did not load' : 'No legs on the record'}</div>
          ) : (
            legs.map((l, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onLeg(legs, i)}
                title="Open this leg's contract card"
                className="w-full flex items-center gap-2 px-2.5 py-1.5 border-b border-borderSubtle/60 last:border-0 font-mono text-t11 text-left hover:bg-ink/[0.04]"
              >
                {/* a leg's side in one ink: a put sold is not bearish */}
                <span className="font-bold text-textPrimary w-8">{l.side === 'BUY' ? 'Buy' : l.side === 'SELL' ? 'Sell' : 'Leg'}</span>
                <span className="text-textSecondary">{num(l.contracts ?? trade.size * l.ratio)}×</span>
                {units != null && units > 1 && <span className="text-textMuted" title="This leg's share of one unit">({l.ratio} a unit)</span>}
                <span className="font-bold text-textPrimary tnum">{l.strike}</span>
                <span className={`font-semibold ${l.right === 'C' ? 'text-bull' : 'text-bear'}`}>{l.right === 'C' ? 'call' : 'put'}</span>
                <span className="text-t11 text-textSecondary">
                  {expiryLabel(l.expiry)} · {l.dte}d
                </span>
                <span className="ml-auto tnum text-textPrimary">@ ${l.fill.toFixed(2)}</span>
              </button>
            ))
          )}
        </div>
        {legs.length > 0 && !settled && t.netKnown !== false && (
          <p className="-mt-2 mb-3 font-mono text-t11 text-textMuted">No single set of buys and sells adds up to this structure's net, so its legs carry no direction here — and no theta or payoff.</p>
        )}

        <div className="grid grid-cols-2 gap-x-6 mb-3">
          <div>
            {fact(
              'Net a unit',
              <>
                {t.net === 0 ? (t.netAbs != null && units ? <>${(t.netAbs / (units * 100)).toFixed(2)} <span className="text-t11 text-textSecondary">direction not reported</span></> : '—') : <><span className="text-t11 text-textSecondary">{t.net > 0 ? 'paid' : 'collected'}</span> ${Math.abs(t.net).toFixed(2)}</>}
              </>
            )}
            {fact('Size', units != null ? <span title={t.ratioLabel ? `${t.ratioLabel} a unit · ${plural(t.contracts ?? 0, 'contract')} in all` : undefined}>{num(units)}× {t.ratioLabel && <span className="text-t11 text-textSecondary">{t.ratioLabel}</span>}</span> : '…')}
            {fact(t.netKnown === false ? 'Net, direction not reported' : t.netPremium >= 0 ? 'Net paid' : 'Net collected', t.netKnown === false ? (t.netAbs != null ? fmtUsd(t.netAbs) : '—') : fmtUsd(Math.abs(t.netPremium)))}
            {fact('Strikes', t.strikesLabel)}
            {fact('Gross of the legs', fmtUsd(t.premium))}
            {fact('IV', t.iv > 0 ? `${t.iv.toFixed(1)}%` : '—')}
          </div>
          <div>
            {fact('Max loss', riskCell(maxLoss, 'loss', t))}
            {fact('Max profit', riskCell(maxProfit, 'profit', t))}
            {fact(
              'Theta',
              /* per position: Σ ± theta × contracts × 100 over the settled legs */
              theta == null ? (
                <span className="text-textMuted">—</span>
              ) : (
                <span className={t.thetaCapped ? 'text-warn' : 'text-textSecondary'} title={t.thetaCapped ? `Near expiry the rate runs past what the legs are worth, so this is capped at the ${t.netPremium > 0 ? 'debit paid' : 'credit collected'} (${fmtUsd(Math.abs(t.netPremium))})` : 'Dollars a day the whole position gains (+) or loses (−) to time'} data-spread-theta={t.thetaCapped ? 'capped' : 'rate'}>
                  {theta >= 0 ? '+' : '−'}${Math.abs(theta).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{t.thetaCapped ? ' — what is left decays by expiry' : ' a day'}
                </span>
              )
            )}
            {fact('Legs', String(legs.length || trade.legCount || '—'))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-3 border-t border-borderSubtle">
          <button onClick={() => go(() => navigate('/weigher', { state: { weigh: { ticker: trade.ticker } } }))} className={`${doorBtn} justify-center py-1.5`}>
            Weigh it <ArrowUpRight className="w-3 h-3" />
          </button>
          <button onClick={() => go(() => navigate('/compass', { state: { tickerFilter: trade.ticker } }))} className={`${doorBtn} justify-center py-1.5`}>
            The board <ArrowUpRight className="w-3 h-3" />
          </button>
        </div>
      </div>
    </Modal>
  );
};


/** The net per unit, in words — "$4.70 credit", "$1.25 · way not printed", "—" */
const netWords = (t: SpreadTrade) =>
  t.legsState === 'pending' && t.net === 0 && t.netKnown !== false
    ? '…'
    : t.net !== 0
      ? `${t.net > 0 ? 'paid' : 'collected'} $${Math.abs(t.net).toFixed(2)} a unit`
      : t.netAbs != null && t.units
        ? `net $${(t.netAbs / (t.units * 100)).toFixed(2)} a unit, direction not reported`
        : 'net not reported';
/** A structure's instant, for the order — its epoch, else its minute and clock */
const timeOf = (t: SpreadTrade) => t.epochMs ?? t.minute * 60_000;
const sizeWords = (t: SpreadTrade) => (t.units != null ? `${num(t.units)}×` : t.legsState === 'pending' ? '…' : '—');

/** A structure on a phone: the strikes on the figures line, so they never run into the time */
const phoneRow = (t: SpreadTrade) => (
  <PhoneRow
    lead={<span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: KIND_DOT[t.kind] }} />}
    title={
      <>
        <CompanyLogo ticker={t.ticker} size={15} />
        <span className="font-bold">{t.ticker}</span>
        <span className="truncate">{shapeWord(t)}</span>
        {t.compression && <span className="text-t10 uppercase text-warn shrink-0" title={COMPRESSION_HINT}>compression</span>}
      </>
    }
    aside={t.extended ? `${t.time} · AH` : t.time}
    figures={[
      <span key="k" className="font-bold tnum text-textPrimary">
        {t.strikesLabel}
      </span>,
      <span key="p" className="font-semibold text-textPrimary">
        {t.netKnown === false ? (t.netAbs != null ? `net ${fmtUsd(t.netAbs)}, direction not reported` : `${fmtUsd(t.premium)} gross, net not reported`) : `${t.netPremium > 0 ? 'paid' : 'collected'} ${fmtUsd(Math.abs(t.netPremium))}`}
      </span>,
      <span key="n">
        {sizeWords(t)} · {netWords(t)}
      </span>,
      <span key="l">max loss {t.legsState === 'pending' ? '…' : t.maxLoss === 'uncapped' ? 'uncapped' : t.maxLoss == null ? '—' : fmtUsd(t.maxLoss)}</span>,
    ]}
  />
);

const MultiLeg = () => {
  const { activeTicker } = useTicker();
  /* the cut is the address, so Link and Save carry it */
  const addr = useAddressCut({
    shape: { def: 'ALL', valid: oneOf(['ALL', ...SPREAD_KINDS.map(k => k.key)]) },
    paid: { def: 'ALL', valid: oneOf(['ALL', 'DEBIT', 'CREDIT']) },
    q: { def: '', valid: isQuery },
    exp: { def: '', valid: isIsoDay },
    prem: { def: '0', valid: oneOf(PREM_FLOORS) },
  });
  const kind = addr.cut.shape as SpreadKind | 'ALL';
  const prem = addr.cut.prem as PremFloor;
  const setKind = (v: SpreadKind | 'ALL') => addr.set({ shape: v });
  const money = addr.cut.paid as 'ALL' | 'DEBIT' | 'CREDIT';
  const setMoney = (v: 'ALL' | 'DEBIT' | 'CREDIT') => addr.set({ paid: v });
  const query = addr.cut.q;
  const setQuery = (v: string) => addr.set({ q: v });
  /* the field answers first; the grid's cut follows as a lower-priority render */
  const cutQuery = useDeferredValue(query);
  const cuts = useSavedCuts();
  const [drill, setDrill] = useState<SpreadTrade | null>(null);
  /* one leg's card, held as (structure, leg key) so ↑/↓ steps through that structure's own legs */
  const [legTrade, setLegTrade] = useState<SpreadTrade | null>(null);
  const [legKey, setLegKey] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  /* Regular keeps the regular session's structures (after the close, walked back from 16:15); Extended the rest, marked */
  const session = useTraceSession();
  const [closed, setClosed] = useState(() => lastRegularClose());
  useEffect(() => {
    const id = window.setInterval(() => setClosed(c => {
      const n = lastRegularClose();
      return n?.closeMs === c?.closeMs ? c : n;
    }), 30_000);
    return () => window.clearInterval(id);
  }, []);
  /* older structures page in as the reader scrolls, back to the session's start */
  const sinceMs = useMemo(() => {
    const iso = closed?.iso ?? tapeSessionIso();
    const [y, m, d] = iso.split('-').map(Number);
    return session === 'regular' ? nyWallTime(y, m, d, 9, 30) : nyWallTime(y, m, d, 4, 0);
  }, [closed?.iso, session]);
  /* a searched name reads its own structures, paged back */
  const askedName = useSearchedName(query);
  const pack = useSpreads(SPREADS_N, { untilMs: session === 'regular' && closed ? closed.closeMs : null, session, sinceMs, ticker: askedName });
  /* not yet and not at all are not "no structures" */
  const tapeState: 'reading' | 'down' | 'in' = searchedName(query) !== askedName ? 'reading' : pack.rows.length ? 'in' : pack.fault ? 'down' : pack.waiting ? 'reading' : 'in';
  const liveTrades = pack.rows;
  const hold = useHold(liveTrades, activeTicker, tapeState !== 'reading');
  const heldTrades = hold.value;
  /* a structure sits on its near leg's expiry */
  const { expiry, setExpiry, expiries, cut: cutExpiry, chosen } = useExpiryCut(heldTrades, t => t.expiry, { value: addr.cut.exp || null, onChange: iso => addr.set({ exp: iso ?? '' }) });
  /* a piece of a split order is marked (flowBook markSplitOrders) — shown and explained, never crowned */
  const trades = useMemo(() => markSplitOrders(cutExpiry(heldTrades)), [heldTrades, cutExpiry]);
  /* the key carries whether the legs are in: the grid redraws a row only when its key or sort value moves */
  const keyOf = useCallback((t: SpreadTrade) => `${t.id}:${t.legsState ?? ''}`, []);
  /* the window the structures cover, its day named when not today's */
  const windowSpan = useMemo(() => spanWords(heldTrades) ?? '—', [heldTrades]);
  const openRow = useCallback((t: SpreadTrade) => setDrill(t), []);

  const rows = useMemo(() => {
    const nq = normSymbol(cutQuery);
    return trades
      .filter(
        t =>
          (kind === 'ALL' || t.kind === kind) &&
          (money === 'ALL' || (t.netKnown !== false && (money === 'DEBIT' ? t.netPremium > 0 : t.netPremium < 0))) &&
          /* the floor reads the net paid or collected, the legs' gross when the vendor left the net out */
          (prem === '0' || (t.netKnown !== false ? Math.abs(t.netPremium) : t.premium) >= Number(prem)) &&
          /* a structure matches on its ticker or any of its legs' contracts */
          (nq === '' || normSymbol(t.ticker).includes(nq) || t.legs.some(l => matchesContract(cutQuery, { ticker: t.ticker, strike: l.strike, right: l.right, expiry: l.expiry })))
      )
      /* newest first by the instant; ties keep a stable order by id */
      .sort((a, b) => timeOf(b) - timeOf(a) || a.id.localeCompare(b.id));
  }, [trades, kind, money, cutQuery, prem]);
  /* legs are read for the first screenful of the cut, then for the rows on screen as the reader scrolls */
  const [onScreen, setOnScreen] = useState<string[] | null>(null);
  const onVisible = useCallback((vis: SpreadTrade[]) => setOnScreen(prev => {
    const ids = vis.map(t => t.id);
    return prev && prev.join(',') === ids.join(',') ? prev : ids;
  }), []);
  useLegsFirst(useMemo(() => onScreen ?? rows.slice(0, FIRST_SCREEN).map(t => t.id), [rows, onScreen]));
  const shown = rows;
  const legRows = useMemo(() => (legTrade ? legTrade.legs.map((_, i) => spreadLegRow(legTrade, i)) : []), [legTrade]);

  /* one suggestion row per structure, on its first leg, so tallies count structures */
  const searchRows = useMemo(() => trades.map(t => ({ ticker: t.ticker, strike: t.legs[0]?.strike ?? 0, right: t.legs[0]?.right ?? ('C' as const), premium: t.premium })), [trades]);

  const marks = useMemo(
    () => ({
      size: earnMarks(shown, t => t.units ?? 0),
      prem: earnMarks(shown, t => Math.abs(t.netPremium)),
    }),
    [shown]
  );

  const activeKind = kind === 'ALL' ? null : KIND_META[kind];
  const leadLine = useMemo(() => {
    if (tapeState === 'reading') return askedName ? `Reading ${askedName}'s multi-leg trades…` : 'Reading the multi-leg trades…';
    if (tapeState === 'down') return 'The multi-leg feed did not answer — it fills when it does.';
    if (rows.length === 0) return askedName ? `No multi-leg trades for ${askedName} on this cut.` : 'No multi-leg trades on this cut.';
    const bets = rows.filter(t => !t.compression);
    const paid = bets.filter(t => t.netKnown !== false && t.netPremium > 0).length;
    const collected = bets.filter(t => t.netKnown !== false && t.netPremium < 0).length;
    const net = bets.reduce((a, t) => a + (t.netKnown !== false ? t.netPremium : 0), 0);
    return `${askedName ? `${askedName}: ` : ''}${num(rows.length)} multi-leg trades (${windowSpan} ET) — ${num(paid)} paid for, ${num(collected)} sold for a credit; on balance ${fmtUsd(Math.abs(net))} ${net >= 0 ? 'paid' : 'collected'}.`;
  }, [tapeState, rows, askedName, windowSpan]);
  /* the total first, the split second, one supporting fact; the largest is a door into its card */
  const read = useMemo<ReactNode>(() => {
    if (tapeState === 'reading') return <RichRead text="Reading the tape's structures." />;
    if (tapeState === 'down') return <RichRead text="This read did not land — the structures fill when the feed answers." />;
    if (trades.length === 0) return <RichRead text="No multi-leg trades on the tape in this window." />;
    /* the sentence follows the cut */
    const cutBits = [activeKind ? `${activeKind.label.toLowerCase()}s` : '', money === 'DEBIT' ? 'paid' : money === 'CREDIT' ? 'collected' : '', cutQuery ? `matching "${cutQuery}"` : '', expiry ? `on the ${expiryLabel(expiry)} expiry` : ''].filter(Boolean);
    const cutOn = cutBits.length > 0;
    const pool = rows;
    if (cutOn && pool.length === 0) return <RichRead text={`None of the ${num(trades.length)} multi-leg trades in hand (${windowSpan} ET) is on this cut (${cutBits.join(', ')}).`} />;
    const byKind = new Map<SpreadKind, number>();
    const names = new Set<string>();
    let prem = 0;
    let signed = 0;
    let paid = 0;
    let collected = 0;
    /* compression is counted apart: out of the money, the counts and the biggest */
    const packs = pool.filter(t => t.compression);
    const packMoney = packs.reduce((a, t) => a + Math.abs(t.netPremium), 0);
    const bets = pool.filter(t => !t.compression);
    if (bets.length === 0) return <RichRead text={`The ${num(pool.length)} multi-leg trades ${cutOn ? `on this cut (${cutBits.join(', ')}) ` : ''}in hand (${windowSpan} ET) are all compression packages — ${fmtUsd(packMoney)} in their nets, not bets.`} />;
    for (const t of bets) {
      byKind.set(t.kind, (byKind.get(t.kind) ?? 0) + 1);
      names.add(t.ticker);
      prem += Math.abs(t.netPremium);
      if (t.netKnown !== false) signed += t.netPremium;
      /* a structure with no net printed is neither paid nor collected */
      if (t.netKnown !== false && t.netPremium > 0) paid++;
      else if (t.netKnown !== false && t.netPremium < 0) collected++;
    }
    const unpriced = bets.length - paid - collected;
    const loud = [...byKind.entries()].sort((a, b) => b[1] - a[1])[0];
    /* the biggest by its net, among those whose legs are read and agree with the vendor */
    const big = [...bets].filter(t => t.legsState === 'in' && !t.splitOf && !t.unverified).sort((a, b) => Math.abs(b.netPremium) - Math.abs(a.netPremium))[0];
    if (!big) return <RichRead text={`In the ${num(trades.length)} multi-leg trades in hand (${windowSpan} ET): ${fmtUsd(prem)} changed hands in their nets — reading their legs before naming the biggest…`} />;
    return (
      <>
        <RichRead text={`In the ${session === 'regular' ? (closed ? `regular session's last ${num(trades.length)} multi-leg trades, walked back from the 16:15 close` : `newest ${num(trades.length)} regular-session multi-leg trades`) : `newest ${num(trades.length)} multi-leg trades outside the regular session, each marked after hours`} (${windowSpan} ET)${cutOn ? `, the ${num(pool.length)} on this cut (${cutBits.join(', ')})` : ''}: ${fmtUsd(prem)} changed hands in their nets (each structure's net, its sign dropped) — ${signed >= 0 ? 'paid' : 'collected'} on balance ${fmtUsd(Math.abs(signed))} — on ${num(names.size)} names — ${num(loud[1])} ${KIND_META[loud[0]].label.toLowerCase()}s, ${num(paid)} paid, ${num(collected)} collected${unpriced ? `, ${num(unpriced)} with no net printed` : ''}${packs.length ? ` — ${plural(packs.length, 'compression package')} (${fmtUsd(packMoney)} net, OPRA cbmo / mctp) set apart, not a bet` : ''}. Biggest${bets.filter(t => t.legsState === 'in').length < bets.length ? ` among the ${num(bets.filter(t => t.legsState === 'in').length)} of ${num(bets.length)} whose legs are read` : ''}: `} />
        {/* the door and its comma never part across a line */}
        <span className="whitespace-nowrap">
          <ReadDoor onOpen={() => setDrill(big)}>
            {big.ticker} {big.shape === 'unnamed' ? KIND_META[big.kind].label.toLowerCase() : big.shape}
            {big.extended ? ' (after hours, not read)' : ''}
          </ReadDoor>
          ,
        </span>
        <RichRead text={` ${big.units != null ? `${plural(big.units, 'unit').replace(' ', '\u00a0')} ` : ''}for [[${fmtUsd(Math.abs(big.netPremium))}]] net${big.netPremium > 0 ? ' paid' : big.netPremium < 0 ? ' collected' : ''} (${fmtUsd(big.premium)} across every leg).`} />
      </>
    );
  }, [trades, rows, tapeState, windowSpan, session, closed, activeKind, money, cutQuery, expiry]);


  const columns = useMemo<Column<SpreadTrade>[]>(
    () => [
      {
        key: 'time',
        header: 'Time ET',
        sortValue: t => timeOf(t),
        render: t => (
          <span className="inline-flex items-center gap-1.5">
            <WatchStar k={structureKey(t)} make={() => watchStructure(t, 'multi-leg')} noun="structure" />
            <span className="text-t11 text-textPrimary">{t.time}</span>
            {t.extended && <span className="text-t10 uppercase text-textMuted" title="Filled outside the regular session (before 09:30, or after 16:00 ET for stocks, 16:15 for index options)">AH</span>}
            {t.repeats ? <span className="text-t10 text-textMuted" title={`Sent ${t.repeats + 1} times under other ids with the same legs, size, money and second; shown once`}>×{t.repeats + 1}</span> : null}
          </span>
        ),
      },
      {
        key: 'ticker',
        header: 'Ticker',
        sortValue: t => t.ticker,
        render: t => (
          <span className="inline-flex items-center gap-1.5">
            <CompanyLogo ticker={t.ticker} size={15} />
            <span className="font-bold text-textPrimary">{t.ticker}</span>
          </span>
        ),
      },
      {
        key: 'kind',
        header: 'Strategy',
        sortValue: t => t.kind,
        render: t => (
          <span className="inline-flex max-w-full items-center gap-1.5 text-t11 text-textPrimary whitespace-nowrap overflow-hidden" title={`${shapeWord(t)}${t.legsState === 'pending' ? ' (listed name, reading its legs)' : ''}: ${t.read ?? KIND_META[t.kind].read}`}>
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: KIND_DOT[t.kind] }} />
            <span className={`truncate ${t.legsState === 'pending' ? 'text-textSecondary' : ''}`}>{shapeWord(t)}</span>
            {t.namedBy === 'vendor' && !t.compression && t.legsState !== 'pending' && (
              <span className="text-t10 text-textMuted shrink-0" title={t.legsState === 'none' ? 'The listed name; its legs did not load' : 'The listed name; its legs do not settle into buys and sells that add up to its net'} data-feed-name>
                as listed
              </span>
            )}
            {t.splitOf && (
              <span className="text-t10 text-textMuted shrink-0" title={`Same second, strikes and name as a ${t.splitOf}; its own legs make ${t.shape}. Likely one order in pieces, never crowned`} data-split-order>
                piece of a {t.splitOf}
              </span>
            )}
            {t.unverified && !t.compression && (
              <span className="text-t10 uppercase text-warn shrink-0" title={UNVERIFIED_HINT} data-unverified>
                unverified
              </span>
            )}
            {t.compression ? (
              <span className="text-t10 uppercase text-warn" title={COMPRESSION_HINT}>
                compression · not a bet
              </span>
            ) : t.extended ? (
              <span className="text-t10 uppercase text-textMuted" title="Filled after hours against thin quotes; shown, not read for direction">
                not read
              </span>
            ) : null}
          </span>
        ),
      },
      {
        key: 'strikes',
        header: 'Strikes',
        sortValue: t => Number(t.strikesLabel.split(' / ')[0]) || 0,
        render: t => <span className="font-mono tnum font-bold text-textPrimary whitespace-nowrap">{t.strikesLabel}</span>,
      },
      {
        key: 'exp',
        header: 'Exp',
        /* left-aligned: the date is the fixed-width fact, the "· 102d" tail is not */
        sortValue: t => t.dte,
        render: t => (
          <span className="text-textPrimary text-t11 whitespace-nowrap" title={t.farExpiry ? `Two expiries: the near leg ${expiryLabel(t.expiry)} (${t.dte}d), the far leg ${expiryLabel(t.farExpiry)} (${t.farDte}d)` : undefined}>
            {t.farExpiry ? (
              <>
                {expiryLabel(t.expiry)}
                <span className="text-textSecondary">→{expiryLabel(t.farExpiry)}</span>
              </>
            ) : (
              <>
                {expiryLabel(t.expiry)} <span className="text-textSecondary">· {t.dte}d</span>
              </>
            )}
          </span>
        ),
      },
      {
        key: 'size',
        header: 'Size',
        align: 'right',
        sortValue: t => t.units ?? 0,
        render: t => (
          <span className={weightInk(t.units ?? 0, marks.size)} title={t.ratioLabel ? `${t.ratioLabel} a unit · ${plural(t.contracts ?? 0, 'contract')} in all` : undefined}>
            {sizeWords(t)}
          </span>
        ),
      },
      {
        key: 'net',
        header: 'Net $',
        align: 'right',
        sortValue: t => t.net,
        render: t => (
          <span className="text-textPrimary whitespace-nowrap">
            {/* per unit from the net premium: the vendor's net_price is wrong on ratio'd shapes */}
            {t.net !== 0 ? (
              <>
                <span className="text-t11 text-textSecondary">{t.net > 0 ? 'paid' : 'collected'}</span> ${Math.abs(t.net).toFixed(2)}
              </>
            ) : t.netAbs != null && t.netAbs > 0 && t.units ? (
              <span title="No net printed and the legs cannot settle the way: the net's size, paid if bought, collected if sold">
                ${(t.netAbs / (t.units * 100)).toFixed(2)} <span className="text-t11 text-textMuted">either way</span>
              </span>
            ) : t.legsState === 'pending' && t.netKnown !== false ? (
              <span className="text-textMuted">…</span>
            ) : (
              <span className="text-textMuted">—</span>
            )}
          </span>
        ),
      },
      {
        key: 'prem',
        header: 'Premium',
        align: 'right',
        sortValue: t => Math.abs(t.netPremium),
        render: t => (
          <span className={weightInk(Math.abs(t.netPremium), marks.prem)} title={`${fmtUsd(t.premium)} across every leg`}>
            {t.netKnown === false ? (
              t.netAbs != null && t.netAbs > 0 ? <span className="text-textSecondary" title="Paid if bought, collected if sold; the direction is not reported">net {fmtUsd(t.netAbs)}</span> : <span className="text-textMuted" title="No net was printed and the legs carry no settled direction">not reported</span>
            ) : t.netPremium === 0 ? (
              <span className="text-textMuted">—</span>
            ) : (
              <TickFigure value={t.netPremium}>
                <span className="text-t11 text-textSecondary">{t.netPremium > 0 ? 'paid ' : 'collected '}</span>
                {fmtUsd(Math.abs(t.netPremium))}
              </TickFigure>
            )}
          </span>
        ),
      },
      {
        key: 'maxloss',
        header: 'Max loss',
        align: 'right',
        sortValue: t => (t.maxLoss === 'uncapped' ? Number.MAX_SAFE_INTEGER : (t.maxLoss ?? -1)),
        render: t => riskCell(t.maxLoss, 'loss', t),
      },
      {
        key: 'maxprofit',
        header: 'Max profit',
        align: 'right',
        sortValue: t => (t.maxProfit === 'uncapped' ? Number.MAX_SAFE_INTEGER : (t.maxProfit ?? -1)),
        render: t => riskCell(t.maxProfit, 'profit', t),
      },
      {
        key: 'iv',
        header: 'IV',
        align: 'right',
        sortValue: t => t.iv,
        render: t => <span className="text-textPrimary">{t.iv.toFixed(0)}%</span>,
      },
      {
        key: 'stock',
        header: 'Stock',
        align: 'right',
        sortValue: t => t.spot,
        render: t => (t.spot > 0 ? <span className="text-textPrimary">{indexRoot(t.ticker) ? Math.round(t.spot).toLocaleString('en-US') : `$${t.spot.toFixed(2)}`}</span> : <span className="text-textMuted">—</span>),
      },
      {
        key: 'legs',
        header: 'Legs',
        align: 'right',
        sortValue: t => t.legCount ?? 0,
        render: t => <span className="text-textPrimary">{t.legCount ?? '—'}</span>,
      },
    ],
    []
  );

  /* a champion stands on its own read legs: never compression, a split piece, or an unverified structure */
  const champs = useMemo(() => {
    const by = (pick: (t: SpreadTrade) => boolean) => shown.filter(t => !t.compression && !t.splitOf && !t.unverified && t.legsState === 'in' && pick(t)).reduce<SpreadTrade | null>((a, t) => (a === null || Math.abs(t.netPremium) > Math.abs(a.netPremium) ? t : a), null);
    /* said on the pill: picked among the N of M whose legs are in */
    const bets = shown.filter(t => !t.compression);
    return { paid: by(t => t.netKnown !== false && t.netPremium > 0), collected: by(t => t.netKnown !== false && t.netPremium < 0), all: by(() => true), read: bets.filter(t => t.legsState === 'in').length, of: bets.length };
  }, [shown]);
  const amongWords = champs.read < champs.of ? ` · ${num(champs.read)} of ${num(champs.of)} read` : '';
  const amongTitle = `Largest net among structures whose legs are read${champs.read < champs.of ? `, ${num(champs.read)} of ${num(champs.of)} so far` : ''}. Compression and unverified ones are never crowned`;
  const facts = useMemo(() => {
    let paid = 0;
    let collected = 0;
    const byKind = new Map<SpreadKind, number>();
    for (const t of trades) {
      if (t.compression) continue;
      if (t.netKnown !== false && t.netPremium > 0) paid++;
      else if (t.netKnown !== false && t.netPremium < 0) collected++;
      byKind.set(t.kind, (byKind.get(t.kind) ?? 0) + 1);
    }
    const loud = [...byKind.entries()].sort((a, b) => b[1] - a[1])[0];
    return { paid, collected, loudKind: loud ? KIND_META[loud[0]].label : '', loudCount: loud ? loud[1] : 0 };
  }, [trades]);
  const pill = (t: SpreadTrade) => `${t.ticker} ${t.shape === 'unnamed' ? KIND_META[t.kind].label.toLowerCase() : t.shape}${t.extended ? ' (AH, not read)' : ''} · ${fmtUsd(Math.abs(t.netPremium))} net`;
  /* the IV, the stock and the leg count open folded, one click away in Columns */
  const { hidden, toggle, showAll, hideAll } = useHiddenColumns('slayer_multileg_cols_v3', ['iv', 'stock', 'legs']);
  const chooserCols = useMemo(() => columns.map(c => ({ key: c.key, label: typeof c.header === 'string' ? c.header : c.key })), [columns]);

  return (
    <>
      <TraceBox
        title="The tape as structures"
        sub={`${activeKind ? `${activeKind.label}: ${activeKind.read}` : session === 'regular' ? "The regular session's structures, newest first" : 'Structures outside the regular session, newest first'} · a row opens the structure and its legs`}
        testId="multi-leg"
        data={{ kind, rows: rows.length, expiry: expiry ?? 'all' }}
        foldOnPhone
        guide={{ title: 'How to read the structures', door: 'What a shape, its strikes and its risk mean', body: <StructureGuide />, testId: 'multi-leg-guide', open: guideOpen, onOpen: setGuideOpen }}
        facts={
          <>
            <Fact label="Structures" testId="structures" title={`The multi-leg trades loaded: the newest ${SPREADS_N}, older pages as you scroll, repeats folded. Not the whole day`}>
              {tapeState !== 'in' ? <span className="text-textMuted">—</span> : <>{num(trades.length)} <span className="text-textSecondary">· {windowSpan} ET</span></>}
              {tapeState === 'in' && facts.loudKind && (
                <span className="text-textSecondary">
                  {' '}
                  · {facts.loudCount} {facts.loudKind.toLowerCase()}
                </span>
              )}
            </Fact>
            <Fact label="Paid · collected" testId="money" title="Structures paid to put on · collected. Compression packages are not counted">
              {tapeState !== 'in' ? <span className="text-textMuted">—</span> : <>{facts.paid} <span className="text-textSecondary">·</span> {facts.collected}</>}
            </Fact>
            {champs.paid && champs.paid !== champs.all && (
              <Champion label={`Largest paid${amongWords}`} title={amongTitle} ink="plain" onOpen={() => setDrill(champs.paid!)} testId="paid">
                {pill(champs.paid)}
              </Champion>
            )}
            {champs.collected && champs.collected !== champs.all && (
              <Champion label={`Largest collected${amongWords}`} title={amongTitle} ink="plain" onOpen={() => setDrill(champs.collected!)} testId="collected">
                {pill(champs.collected)}
              </Champion>
            )}
            {champs.all && (
              <Champion label={`Largest${amongWords}`} title={amongTitle} ink="supreme" onOpen={() => setDrill(champs.all!)} testId="largest">
                {pill(champs.all)}
              </Champion>
            )}
          </>
        }
        controls={
          <>
            <LiveHold paused={hold.paused} onToggle={hold.toggle} heldAt={hold.heldAt} waitingFirst={hold.waitingFirst} />
            <SessionMark at={pack.at} fault={pack.fault} paused={hold.paused} ttlMs={45_000} kept={pack.kept} />
            <FlowSearch value={query} onChange={setQuery} rows={searchRows} countNoun="structures" span />
            <DropdownSelect label="Screen" value={kind} options={SHAPE_OPTIONS} onChange={setKind} title="Which structures" testId="multi-leg-shape" />
            {/* not "Money": that means moneyness on every other page */}
            <DropdownSelect label="Debit · credit" value={money} options={MONEY_OPTIONS} onChange={setMoney} title="Paid to put on, or collected" testId="multi-leg-money" />
            <DropdownSelect label="Premium" value={prem} options={PREM_FLOOR_OPTIONS} onChange={v => addr.set({ prem: v })} title="The least net paid or collected" testId="multi-leg-premium" />
            <ExpiryCalendar value={chosen ? isoDate(chosen.date) : ''} expiries={expiries} onChange={e => setExpiry(isoDate(e.date))} onClear={() => setExpiry(null)} label="Expiry" icon={CalendarDays} steppers={false} title="Only structures whose near leg sits on one expiry" testId="multi-leg-expiry" />
            <SavedCutsControl store={ML_CUTS} query={addr.query} onOpen={addr.open} noun="cut" testId="multi-leg" onSay={cuts.say} open={cuts.open} onToggleOpen={cuts.toggle} />
            <div className="ml-auto">
              <ColumnChooser columns={chooserCols} hidden={hidden} onToggle={toggle} onAll={showAll} onNone={() => hideAll(columns.map(c => c.key))} />
            </div>
          </>
        }
        sentence={
          <>
            <SavedCutsList store={ML_CUTS} query="" onOpen={addr.open} noun="cut" testId="multi-leg" onSay={cuts.say} open={cuts.open} />
            {cuts.said && (
              <p role="status" className="mb-2 font-mono text-t11 text-textSecondary">
                {cuts.said}
              </p>
            )}
          </>
        }
        lead={leadLine}
        detail={read}
      >
        <TraceGrid rows={shown} columns={columns} hidden={hidden} widths={WIDTHS} tooltips={TOOLTIPS} rowKey={keyOf} onRowClick={openRow} selectedKey={drill ? (() => { const hit = shown.find(t => t.id === drill.id); return hit ? keyOf(hit) : null; })() : null} initialSort={{ key: 'time', dir: 'desc' }} pinLeft={PIN_LEFT} pinRight={PIN_RIGHT} phoneRow={phoneRow} autoHeight onVisible={onVisible} endless={endlessOf(pack.older, 'structures', `the ${session === 'regular' ? 'session' : 'day'}'s start reached`, hold.paused)} key={tapeState} emptyText={cutQuery.trim() && trades.length > 0 ? searchMiss(cutQuery, 'structure') : tapeState === 'reading' ? 'Reading the tape' : tapeState === 'down' ? 'This read did not land' : `No structures on this cut ${dayAdv()}`} testId="multi-leg" />
        {/* the sentence and the grid already say a failed read; this mark is for a stale read under an empty cut */}
        {pack.fault && tapeState === 'in' && shown.length === 0 ? <FeedFallback fault={pack.fault} /> : null}
      </TraceBox>

      {drill && (
        <SpreadCard
          trade={drill}
          onClose={() => setDrill(null)}
          onLeg={(legs, i) => {
            setLegTrade({ ...drill, legs });
            setLegKey(`${drill.id}-l${i}`);
          }}
        />
      )}

      {/* the same contract card the rest of Trace opens, over the legs of the structure it came from */}
      <BookDrill
        list={legRows}
        openKey={legKey}
        onOpen={k => {
          setLegKey(k);
          if (k === null) setLegTrade(null);
        }}
      />
    </>
  );
};

export default MultiLeg;
