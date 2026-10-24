/*
==================================================
  SLAYER TERMINAL - MULTI-LEG (Trace)
  The tape reconstructed into structures (Noah,
  2026-08-30 — expansion page 7, the reference's
  page was a paywall wall; its column headers were
  the whole spec).

  Every structure explains itself in plain English
  — what the shape DOES, never what to do with it.
  Strategy dots wear the categorical palette; risk
  columns carry the ink (max loss bear, max profit
  bull, "Uncapped" loudest of all).

  THE PARTNER'S LAYOUT (Noah, 2026-10-13): the time
  and the ticker stand still at the left, the risk
  at the right, always on screen; the shape, debit
  or credit, the search and the expiry live in the
  address, so Link and Save work; an Expiry card;
  the structure's card on the house modal; theta as
  dollars a day; two-line rows on a phone.
==================================================
*/

import { useCallback, useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTraceSession } from '../../components/trace/traceSession';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, CalendarDays } from 'lucide-react';
import { useMarketData } from '../../context/MarketDataContext';
import { indexRoot, lastRegularClose, plural, tapeSessionIso, usd as fmtUsd, useLegsFirst, useSpreads, useSpreadTrade } from '../../data/traceLive';
import { nyWallTime } from '../../core/nyTime';
import { FLOW_TTL_MS, FeedFallback, StaleMark, TickFigure } from '../../components/ui/liveRead';
import { markSplitOrders, spreadLegRow, SPREAD_KINDS, type SpreadKind, type SpreadLeg, type SpreadTrade } from '../../data/flowBook';
import BookDrill from '../../components/trace/BookDrill';
import { earnMarks, weightInk } from '../../components/trace/earnedInk';
import { DOOR, DOOR_HOVER_TEXT } from '../../components/trace/door';
import { LiveHold, useHold } from '../../components/trace/LiveHold';
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
import { createViewStore } from '../../data/savedViews';
import { StructureGuide } from '../../components/trace/TraceGuide';
import Modal from '../../components/ui/Modal';
import { expiryLabel } from '../../core/format';
import { dayAdv, spanWords } from '../../components/trace/dayWords';

const num = (v: number) => v.toLocaleString('en-US');
/** The structures the page holds — the vendor's newest */
const SPREADS_N = 200;
/** The rows a screen shows — their legs are read (Size, Net, Max loss); the rest show the vendor's figures */
const FIRST_SCREEN = 20;

/* THE CARDS (the walk, 2026-09-09) */
/* a short word on the card itself, so a phone's half-width card never cuts it ("Every sha…", round 7) */
const SHAPE_OPTIONS: DropdownOption<SpreadKind | 'ALL'>[] = [{ value: 'ALL', label: 'Every shape', short: 'All', hint: 'Every structure on the tape' }, ...SPREAD_KINDS.map(k => ({ value: k.key, label: k.label, hint: k.read }))];
const MONEY_OPTIONS: DropdownOption<'ALL' | 'DEBIT' | 'CREDIT'>[] = [
  { value: 'ALL', label: 'Paid and collected', short: 'Both', hint: 'Debit and credit structures' },
  { value: 'DEBIT', label: 'Paid', hint: 'Structures that cost money to put on' },
  { value: 'CREDIT', label: 'Collected', hint: 'Structures that paid the trader to put on' },
];
/* the set at rest sums under a 1440 box (audit round 4: the Net $ column stood half under the pinned risk columns) */
/* round 7 (retail: "paid $12" — the Premium column clipped under the pinned risk at 1440): the set at rest fits the 1440
   box with room; the leg count opens folded (one click away in Columns) */
const WIDTHS: Record<string, number> = { time: 112, ticker: 88, strikes: 150, exp: 112, size: 60, net: 136, prem: 140, legs: 56, kind: 160, maxloss: 92, maxprofit: 92 };
/* the structure's who on the left; its risk at the right, always on screen (Max loss and Max profit stood off a 1280
   screen) */
const PIN_LEFT = ['time', 'ticker'];
const PIN_RIGHT = ['maxloss', 'maxprofit'];
const ML_CUTS = createViewStore('slayer_multileg_cuts_v1');
const TOOLTIPS: Record<string, string> = {
  strategy: 'The shape — its dot is its kind, never a verdict',
  kind: "The vendor's name for the shape — its dot is its kind, never a verdict",
  strikes: 'Every strike the structure prints, in order — the row opens the structure and its legs',
  size: 'Units — the legs\' contracts over their common factor: S5/B10/S5 is 5 flies',
  net: 'The net per unit — the net premium over units × 100 — paid (debit) or collected (credit)',
  prem: "The structure's net premium — paid (+) or collected (−) across every unit; the gross of every leg is on the hover",
  maxloss: 'The most it can lose at expiry — the payoff of its legs as they were bought and sold',
  maxprofit: 'The most it can make at expiry — the payoff of its legs as they were bought and sold',
  legs: 'How many legs the structure has',
};

/** Categorical strategy dots — a shape is a kind, never a verdict. */
/* the wire's categorical set (tokens.css --cat-*), so paper cuts them too — hex until 2026-10-13 */
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
const COMPRESSION_HINT = "OPRA's cbmo / mctp — a floor package that nets open interest down between members (a call bought against a put sold at one strike). Not a bet: shown and labelled, kept out of the largest, the paid / collected counts and the read";
const shapeWord = (t: SpreadTrade) => (t.shape === 'unnamed' ? KIND_META[t.kind].label : t.shape);

const KIND_META = Object.fromEntries(SPREAD_KINDS.map(k => [k.key, k])) as Record<SpreadKind, (typeof SPREAD_KINDS)[number]>;

const RISK_WHY: Record<NonNullable<SpreadTrade['riskNote']>, string> = {
  unsettled: 'No single set of buys and sells adds up to its net — the legs carry no direction, so no payoff is drawn',
  expiries: 'Its legs run to different expiries — the payoff at the near one depends on the far leg, so no max is drawn',
  'no-net': 'The vendor printed no net and its legs no side — which way it went is not known',
};
const riskCell = (v: number | 'uncapped' | null, tone: 'loss' | 'profit', t?: SpreadTrade) => {
  if (t && t.legsState === 'pending') return <span className="text-textMuted" title="Reading its legs">…</span>;
  if (v === null) return <span className="text-textSecondary" title={t?.riskNote ? RISK_WHY[t.riskNote] : t?.legsState === 'none' ? 'Its legs did not load' : undefined}>—</span>;
  if (v === 'uncapped') return <span className={`font-bold ${tone === 'loss' ? 'text-warn' : 'text-bull'}`}>Uncapped</span>;
  return <span className={tone === 'loss' ? 'text-bear' : 'text-bull'}>{fmtUsd(v)}</span>;
};

const doorBtn = 'inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-textSecondary hover:text-textPrimary border border-borderSubtle rounded px-2 py-1 hover:bg-ink/[0.04] transition-colors';

/** One structure opened up — the legs, the risk box, and the plain-English
    line saying what the shape does. */
const SpreadCard = ({ trade, onClose, onLeg }: { trade: SpreadTrade; onClose: () => void; onLeg: (legs: SpreadLeg[], i: number) => void }) => {
  const navigate = useNavigate();
  /* THE STRUCTURE'S OWN LEGS, always (the audit, 2026-10-22): they merged only while the structure was among the newest
     rows, and the card fell back to placeholders — "Buy ×1 93 put — · 0d @ $0.00" */
  const own = useSpreadTrade(trade);
  /* THE CARD AND THE ROW ARE ONE STRUCTURE (the re-audit, 2026-10-22: an SPX "iron condor" read $5.8K max profit on the
     card and $780 on its row): both are settleSpread's — its legs, its units, its expiry payoff */
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

  const fact = (label: string, value: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-3 py-1 border-b border-borderSubtle/50 last:border-0">
      <span className="font-mono text-[11px] uppercase tracking-wider text-textMuted">{label}</span>
      <span className="font-mono text-xs tnum text-textPrimary text-right">{value}</span>
    </div>
  );

  /* THE HOUSE MODAL, not a hand-rolled one (ui/Modal). This card had its own
     scrim, its own Escape listener and its own close button — and therefore
     none of what the house's modal had learned: no scroll lock, no focus
     trap, no portal. A second grammar for the same gesture is how a design
     system dies, one card at a time. */
  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel={`${trade.ticker} ${KIND_META[trade.kind].label}`}
      widthClass="max-w-[480px]"
      /* THE HEAD CARRIES WEIGHT AT BOTH ENDS (Noah, 2026-08-30: "clean up
         this box a bit"): who it is on the left — logo, ticker, the
         structure as a pill — and when/where on the right, beside the
         close. The old line ran four registers together and trailed off
         after the name. */
      header={
        /* ON A PHONE THE NAME WRAPS UNDER, never over the time (audit round 4: the shape name overlapped "16:59:23") */
        <span className="flex items-center gap-x-2.5 gap-y-1 min-w-0 flex-wrap">
          <CompanyLogo ticker={trade.ticker} size={20} />
          <span className="font-mono text-sm font-bold text-textPrimary">{trade.ticker}</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ink/[0.06] px-2 py-0.5 font-mono text-[11px] font-semibold text-textPrimary min-w-0 max-w-full">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: KIND_DOT[trade.kind] }} />
            <span className="truncate">{t.shape === 'unnamed' ? KIND_META[t.kind].label : t.shape}</span>
          </span>
          {trade.extended && <span className="font-mono text-[10px] uppercase tracking-wider text-textMuted whitespace-nowrap" title="Filled after hours against thin post-market quotes — the shape is shown, not read for direction">after hours · not read</span>}
          {trade.compression && <span className="font-mono text-[10px] uppercase tracking-wider text-warn whitespace-nowrap" title={COMPRESSION_HINT}>compression · not a bet</span>}
          {t.vendorShape && <span className="font-mono text-[10px] text-textMuted whitespace-nowrap" title="The vendor's own label — the legs as they were bought and sold say otherwise">vendor: {t.vendorShape}</span>}
          {t.namedBy === 'vendor' && !t.compression && <span className="font-mono text-[10px] text-textMuted whitespace-nowrap" title={t.legsState === 'pending' ? "The vendor's name — the legs are still being read" : "The vendor's name — its legs could not be settled into buys and sells that add up to its net, so the app has not named it from them"}>vendor's name</span>}
        </span>
      }
      headerActions={
        <span className="font-mono text-[11px] text-textSecondary tnum whitespace-nowrap shrink-0">
          {trade.time}
          {trade.spot > 0 ? (indexRoot(trade.ticker) ? ` · index ${Math.round(trade.spot).toLocaleString('en-US')}` : ` · spot $${trade.spot.toFixed(2)}`) : ''}
        </span>
      }
    >
      <div>
        {/* the structure in a sentence, from ITS legs — never the family's fixed line */}
        <div className="text-[12px] text-textSecondary leading-snug mb-3" data-spread-read>
          <RichRead text={t.read ?? (own.waiting ? 'Reading the legs…' : KIND_META[trade.kind].read)} />
        </div>

        {/* The legs — each line one fill, its direction settled by the structure's own net premium; a leg is the door to
            its contract's card */}
        <div className="border border-borderSubtle rounded mb-3 overflow-hidden" data-spread-legs>
          {legs.length === 0 ? (
            <div className="px-2.5 py-3 font-mono text-[11px] text-textMuted">{own.waiting ? 'Reading the legs…' : own.failed ? 'The legs did not load' : 'No legs on the record'}</div>
          ) : (
            legs.map((l, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onLeg(legs, i)}
                title="Open this leg's contract card"
                className="w-full flex items-center gap-2 px-2.5 py-1.5 border-b border-borderSubtle/60 last:border-0 font-mono text-[11px] text-left hover:bg-ink/[0.04]"
              >
                {/* a leg's side in one ink (2026-10-13): a put sold is not bearish */}
                <span className="font-bold text-textPrimary w-8">{l.side === 'BUY' ? 'Buy' : l.side === 'SELL' ? 'Sell' : 'Leg'}</span>
                <span className="text-textSecondary">{num(l.contracts ?? trade.size * l.ratio)}×</span>
                {units != null && units > 1 && <span className="text-textMuted" title="This leg's share of one unit">({l.ratio} a unit)</span>}
                <span className="font-bold text-textPrimary tnum">{l.strike}</span>
                <span className={`font-semibold ${l.right === 'C' ? 'text-bull' : 'text-bear'}`}>{l.right === 'C' ? 'call' : 'put'}</span>
                <span className="text-[11px] text-textSecondary">
                  {expiryLabel(l.expiry)} · {l.dte}d
                </span>
                <span className="ml-auto tnum text-textPrimary">@ ${l.fill.toFixed(2)}</span>
              </button>
            ))
          )}
        </div>
        {legs.length > 0 && !settled && t.netKnown !== false && (
          <p className="-mt-2 mb-3 font-mono text-[11px] text-textMuted">No single set of buys and sells adds up to this structure's net, so its legs carry no direction here — and no theta or payoff.</p>
        )}

        <div className="grid grid-cols-2 gap-x-6 mb-3">
          <div>
            {fact(
              'Net a unit',
              <>
                {t.net === 0 ? (t.netAbs != null && units ? <>${(t.netAbs / (units * 100)).toFixed(2)} <span className="text-[11px] text-textSecondary">direction not reported</span></> : '—') : <><span className="text-[11px] text-textSecondary">{t.net > 0 ? 'paid' : 'collected'}</span> ${Math.abs(t.net).toFixed(2)}</>}
              </>
            )}
            {fact('Size', units != null ? <span title={t.ratioLabel ? `${t.ratioLabel} a unit · ${plural(t.contracts ?? 0, 'contract')} in all` : undefined}>{num(units)}× {t.ratioLabel && <span className="text-[11px] text-textSecondary">{t.ratioLabel}</span>}</span> : '…')}
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
              /* per POSITION: Σ ± theta × contracts × 100 over the settled legs — dollars a day to time */
              theta == null ? (
                <span className="text-textMuted">—</span>
              ) : (
                <span className={t.thetaCapped ? 'text-warn' : 'text-textSecondary'} title={t.thetaCapped ? `The vendor's theta is a rate, and this close to expiry it runs past what the legs are worth — a day cannot take more than that, so this is the cap: each leg's day at most its own fill, the position's at most the ${t.netPremium > 0 ? 'debit paid' : 'credit collected'} (${fmtUsd(Math.abs(t.netPremium))})` : "Dollars a day the whole position gains (+) or loses (−) to time: each leg's theta × its contracts × 100, bought plus, sold minus"} data-spread-theta={t.thetaCapped ? 'capped' : 'rate'}>
                  {theta >= 0 ? '+' : '−'}${Math.abs(theta).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{t.thetaCapped ? ' — what is left decays by expiry' : ' a day'}
                </span>
              )
            )}
            {fact('Legs', String(legs.length || trade.legCount || '—'))}
          </div>
        </div>

        {/* THE DOORS, HALF AND HALF: two equal doors spanning the card under a
            rule. The old pair hugged the left edge beneath a symmetric facts
            grid and left the whole right half of the bottom empty (Noah:
            "heavier on the left side than the right"). */}
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

/** A structure on a phone — the strikes on the figures line, so they never run into the time (the retail pass,
    2026-10-22: "7690 / 7720 / 7750 16:59:23") */
const phoneRow = (t: SpreadTrade) => (
  <PhoneRow
    lead={<span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: KIND_DOT[t.kind] }} />}
    title={
      <>
        <CompanyLogo ticker={t.ticker} size={15} />
        <span className="font-bold">{t.ticker}</span>
        <span className="truncate">{shapeWord(t)}</span>
        {t.compression && <span className="text-[10px] uppercase text-warn shrink-0" title={COMPRESSION_HINT}>compression</span>}
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
  const { marketData, activeTicker } = useMarketData();
  /* THE CUT IS THE ADDRESS */
  const addr = useAddressCut({
    shape: { def: 'ALL', valid: oneOf(['ALL', ...SPREAD_KINDS.map(k => k.key)]) },
    paid: { def: 'ALL', valid: oneOf(['ALL', 'DEBIT', 'CREDIT']) },
    q: { def: '', valid: isQuery },
    exp: { def: '', valid: isIsoDay },
  });
  const kind = addr.cut.shape as SpreadKind | 'ALL';
  const setKind = (v: SpreadKind | 'ALL') => addr.set({ shape: v });
  const money = addr.cut.paid as 'ALL' | 'DEBIT' | 'CREDIT';
  const setMoney = (v: 'ALL' | 'DEBIT' | 'CREDIT') => addr.set({ paid: v });
  const query = addr.cut.q;
  const setQuery = (v: string) => addr.set({ q: v });
  /* the field answers first; the grid's cut follows as a lower-priority render (the book, OptionsScreener, 2026-09-20) */
  const cutQuery = useDeferredValue(query);
  const cuts = useSavedCuts();
  const [drill, setDrill] = useState<SpreadTrade | null>(null);
  /* The tape card for ONE leg. Held as (structure, leg key) so ↑/↓ inside the
     card steps between that structure's own legs and nothing else. */
  const [legTrade, setLegTrade] = useState<SpreadTrade | null>(null);
  const [legKey, setLegKey] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  /* THE SESSION CARD (audit round 4: under Regular after the close the page held only 16:28–16:59 structures, unmarked):
     Regular keeps the regular session's structures — after the close, walked back from the 16:15 close; Extended hours
     the ones outside it, each marked */
  const session = useTraceSession();
  const [closed, setClosed] = useState(() => lastRegularClose());
  useEffect(() => {
    const id = window.setInterval(() => setClosed(c => {
      const n = lastRegularClose();
      return n?.closeMs === c?.closeMs ? c : n;
    }), 30_000);
    return () => window.clearInterval(id);
  }, []);
  /* ENDLESS (the owner, 2026-10-23): older structures page in as the reader scrolls, back to the session's start */
  const sinceMs = useMemo(() => {
    const iso = closed?.iso ?? tapeSessionIso();
    const [y, m, d] = iso.split('-').map(Number);
    return session === 'regular' ? nyWallTime(y, m, d, 9, 30) : nyWallTime(y, m, d, 4, 0);
  }, [closed?.iso, session]);
  /* A NAME SEARCHED IS ASKED FOR (audit round 11, major 5): that name's own structures (ticker_symbol), paged back */
  const askedName = useSearchedName(query);
  const pack = useSpreads(SPREADS_N, { untilMs: session === 'regular' && closed ? closed.closeMs : null, session, sinceMs, ticker: askedName });
  /* NOT YET / NOT AT ALL is not "no structures": before the tape lands, and when it fails, the page had read "No
     multi-leg trades on the tape yet today" over 0 · 0 (the ship pass, 2026-10-22) */
  const tapeState: 'reading' | 'down' | 'in' = searchedName(query) !== askedName ? 'reading' : pack.rows.length ? 'in' : pack.fault ? 'down' : pack.waiting ? 'reading' : 'in';
  const liveTrades = pack.rows;
  // The shared hold (see LiveHold): structures and tick freeze together while paused.
  const hold = useHold(useMemo(() => ({ trades: liveTrades, tick: marketData }), [liveTrades, marketData]), activeTicker, tapeState !== 'reading');
  const { trades: heldTrades, tick } = hold.value;
  /* THE EXPIRY CUT: a structure sits on its near leg's expiry */
  const { expiry, setExpiry, expiries, cut: cutExpiry, chosen } = useExpiryCut(heldTrades, t => t.expiry, { value: addr.cut.exp || null, onChange: iso => addr.set({ exp: iso ?? '' }) });
  /* a piece of a split order is marked (flowBook markSplitOrders) — shown and explained, never crowned */
  const trades = useMemo(() => markSplitOrders(cutExpiry(heldTrades)), [heldTrades, cutExpiry]);
  /* the row's identity carries whether its legs are in: the grid redraws a row only when its key or its sort value moves,
     and a structure that settles keeps its id — so a settled row is a new row, never a stale "…" */
  const keyOf = useCallback((t: SpreadTrade) => `${t.id}:${t.legsState ?? ''}`, []);
  /* the window the structures cover — the first and last in hand */
  const windowSpan = useMemo(() => {
    /* the day named when it is not today's (audit round 6) */
    return spanWords(heldTrades) ?? '—';
  }, [heldTrades]);
  const openRow = useCallback((t: SpreadTrade) => setDrill(t), []);

  const rows = useMemo(() => {
    const nq = normSymbol(cutQuery);
    return trades
      .filter(
        t =>
          (kind === 'ALL' || t.kind === kind) &&
          (money === 'ALL' || (t.netKnown !== false && (money === 'DEBIT' ? t.netPremium > 0 : t.netPremium < 0))) &&
          // A structure matches on its ticker or ANY of its legs' contracts.
          (nq === '' || normSymbol(t.ticker).includes(nq) || t.legs.some(l => matchesContract(cutQuery, { ticker: t.ticker, strike: l.strike, right: l.right, expiry: l.expiry })))
      )
      /* NEWEST FIRST, BY THE INSTANT (retail, round 7: 16:14:48 then 16:14:59 under "newest first" — the vendor's order is
         not strictly by time); ties keep a stable order by id */
      .sort((a, b) => timeOf(b) - timeOf(a) || a.id.localeCompare(b.id));
  }, [trades, kind, money, cutQuery]);
  /* THE FIRST SCREENFUL'S LEGS, AND ONLY THOSE (audit round 10, major 4): the first rows of the cut in its order, read or
     not — a settled row is skipped by the reader, and the rows below never let themselves in as the top ones settle */
  /* …and once the reader scrolls, the rows on screen in the grid's own order (TraceGrid onVisible) */
  const [onScreen, setOnScreen] = useState<string[] | null>(null);
  const onVisible = useCallback((vis: SpreadTrade[]) => setOnScreen(prev => {
    const ids = vis.map(t => t.id);
    return prev && prev.join(',') === ids.join(',') ? prev : ids;
  }), []);
  useLegsFirst(useMemo(() => onScreen ?? rows.slice(0, FIRST_SCREEN).map(t => t.id), [rows, onScreen]));
  /* every row — the grid draws only what is on screen */
  const shown = rows;
  const legRows = useMemo(() => (legTrade ? legTrade.legs.map((_, i) => spreadLegRow(legTrade, i)) : []), [legTrade]);

  /* The search's suggestion rows: one per structure, anchored on its first
     leg — every leg still matches when typed, but tallies count structures. */
  const searchRows = useMemo(() => trades.map(t => ({ ticker: t.ticker, strike: t.legs[0]?.strike ?? 0, right: t.legs[0]?.right ?? ('C' as const), premium: t.premium })), [trades]);

  // Three registers per column — components/trace/earnedInk.ts.
  const marks = useMemo(
    () => ({
      size: earnMarks(shown, t => t.units ?? 0),
      prem: earnMarks(shown, t => Math.abs(t.netPremium)),
    }),
    [shown]
  );

  const activeKind = kind === 'ALL' ? null : KIND_META[kind];
  /* ReactNode: the largest structure is a door into its own card, whether
     or not the current cut shows it. */
  /* THE SCREENER'S GRAMMAR (Noah, 2026-08-30: "i dont like confusing
     sentences in our website" — holding up "$2.9B across 456 contracts on 22
     names — calls 57% of it, puts 43%" as the model): the total first, the
     split second, one supporting fact. No desk-speak ("structures"), no
     colon-headed puzzles ("The largest: a 1,486× …"). */
  const read = useMemo<ReactNode>(() => {
    if (tapeState === 'reading') return <RichRead text="Reading the tape's structures." />;
    if (tapeState === 'down') return <RichRead text="This read did not land — the structures fill when the feed answers." />;
    if (trades.length === 0) return <RichRead text="No multi-leg trades on the tape in this window." />;
    /* THE SENTENCE FOLLOWS THE FILTER (audit round 7: under Screen = Vertical the head read "Largest QQQ bull put spread
       $24.5K" while the sentence still said "Biggest: SPX short strangle … $91.3K" with the whole tape's counts) */
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
    /* COMPRESSION IS SET APART (audit round 5): counted and labelled, out of the money, the counts and the biggest */
    const packs = pool.filter(t => t.compression);
    const packMoney = packs.reduce((a, t) => a + Math.abs(t.netPremium), 0);
    const bets = pool.filter(t => !t.compression);
    if (bets.length === 0) return <RichRead text={`The ${num(pool.length)} multi-leg trades ${cutOn ? `on this cut (${cutBits.join(', ')}) ` : ''}in hand (${windowSpan} ET) are all compression packages — ${fmtUsd(packMoney)} in their nets, not bets.`} />;
    for (const t of bets) {
      byKind.set(t.kind, (byKind.get(t.kind) ?? 0) + 1);
      names.add(t.ticker);
      prem += Math.abs(t.netPremium);
      if (t.netKnown !== false) signed += t.netPremium;
      /* a structure whose net the vendor left out is neither — it was counted as paid */
      if (t.netKnown !== false && t.netPremium > 0) paid++;
      else if (t.netKnown !== false && t.netPremium < 0) collected++;
    }
    const unpriced = bets.length - paid - collected;
    const loud = [...byKind.entries()].sort((a, b) => b[1] - a[1])[0];
    /* THE BIGGEST BY ITS NET (the audit, 2026-10-22: "$1.3M collected" was the gross of every leg; the net was ~$830K) */
    /* the biggest whose legs are read — never one the vendor alone has named (audit round 8) */
    const big = [...bets].filter(t => t.legsState === 'in' && !t.splitOf).sort((a, b) => Math.abs(b.netPremium) - Math.abs(a.netPremium))[0];
    if (!big) return <RichRead text={`In the ${num(trades.length)} multi-leg trades in hand (${windowSpan} ET): ${fmtUsd(prem)} changed hands in their nets — reading their legs before naming the biggest…`} />;
    return (
      <>
        <RichRead text={`In the ${session === 'regular' ? (closed ? `regular session's last ${num(trades.length)} multi-leg trades, walked back from the 16:15 close` : `newest ${num(trades.length)} regular-session multi-leg trades`) : `newest ${num(trades.length)} multi-leg trades outside the regular session, each marked after hours`} (${windowSpan} ET)${cutOn ? `, the ${num(pool.length)} on this cut (${cutBits.join(', ')})` : ''}: ${fmtUsd(prem)} changed hands in their nets (each structure's net, its sign dropped) — ${signed >= 0 ? 'paid' : 'collected'} on balance ${fmtUsd(Math.abs(signed))} — on ${num(names.size)} names — ${num(loud[1])} ${KIND_META[loud[0]].label.toLowerCase()}s, ${num(paid)} paid, ${num(collected)} collected${unpriced ? `, ${num(unpriced)} with no net printed` : ''}${packs.length ? ` — ${plural(packs.length, 'compression package')} (${fmtUsd(packMoney)} net, OPRA cbmo / mctp) set apart, not a bet` : ''}. Biggest${bets.filter(t => t.legsState === 'in').length < bets.length ? ` among the ${num(bets.filter(t => t.legsState === 'in').length)} of ${num(bets.length)} whose legs are read` : ''}: `} />
        {/* the door and its comma never part across a line (phone, round 7: an orphan ", 17 units") */}
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
        header: 'Time',
        sortValue: t => timeOf(t),
        // The star leads the row, the tape's own placement (see WatchStar).
        render: t => (
          <span className="inline-flex items-center gap-1.5">
            <WatchStar k={structureKey(t)} make={() => watchStructure(t, 'multi-leg')} noun="structure" />
            <span className="text-[11px] text-textPrimary">{t.time}</span>
            {t.extended && <span className="text-[10px] uppercase text-textMuted" title="After hours — filled outside the regular session: after the close (16:15 for index and ETF options, 16:00 for a stock's) or before the open">AH</span>}
            {t.repeats ? <span className="text-[10px] text-textMuted" title={`The vendor sent this structure ${t.repeats + 1} times under other ids — the same legs, size, money and second — shown once`}>×{t.repeats + 1}</span> : null}
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
          <span className="inline-flex max-w-full items-center gap-1.5 text-[11px] text-textPrimary whitespace-nowrap overflow-hidden" title={`${shapeWord(t)}${t.legsState === 'pending' ? " (the vendor's name — reading its legs)" : ''} — ${t.read ?? KIND_META[t.kind].read}`}>
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: KIND_DOT[t.kind] }} />
            <span className={`truncate ${t.legsState === 'pending' ? 'text-textSecondary' : ''}`}>{shapeWord(t)}</span>
            {t.namedBy === 'vendor' && !t.compression && t.legsState !== 'pending' && (
              <span className="text-[10px] text-textMuted shrink-0" title={t.legsState === 'none' ? "The vendor's name — its legs did not load, so the app could not name the shape from them" : "The vendor's name — its legs could not be settled into buys and sells that add up to its net, so the app has not named it from them"} data-vendor-name>
                vendor's name
              </span>
            )}
            {t.splitOf && (
              <span className="text-[10px] text-textMuted shrink-0" title={`Printed in the same second, on the same strikes and expiry, under the same name (${t.vendorShape ?? t.shapeOfVendor}) as a ${t.splitOf} whose legs do make that shape — this one's own legs make ${t.shape}. Most likely one order the vendor split into pieces: shown as its legs read, never crowned the largest`} data-split-order>
                piece of a {t.splitOf}
              </span>
            )}
            {t.compression ? (
              <span className="text-[10px] uppercase text-warn" title={COMPRESSION_HINT}>
                compression · not a bet
              </span>
            ) : t.extended ? (
              <span className="text-[10px] uppercase text-textMuted" title="Filled after hours against thin post-market quotes — the shape is shown, not read for direction">
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
        /* LEFT, not right (Noah, 2026-08-30: "expirations should be aligned
           beggining first"). The date is the fact you read and it is always the
           same width; the "· 102d" tail is not. Flushing the right edge lined
           up the tails and left the DATES ragged — the wrong thing anchored. */
        sortValue: t => t.dte,
        render: t => (
          <span className="text-textPrimary text-[11px] whitespace-nowrap" title={t.farExpiry ? `Two expiries: the near leg ${expiryLabel(t.expiry)} (${t.dte}d), the far leg ${expiryLabel(t.farExpiry)} (${t.farDte}d)` : undefined}>
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
            {/* per UNIT, from the net premium — the vendor's net_price is wrong on ratio'd shapes; a net the vendor left
                out is no figure, not "$0.00 debit" (its size, either way, when the shape's legs can say it) */}
            {t.net !== 0 ? (
              <>
                <span className="text-[11px] text-textSecondary">{t.net > 0 ? 'paid' : 'collected'}</span> ${Math.abs(t.net).toFixed(2)}
              </>
            ) : t.netAbs != null && t.netAbs > 0 && t.units ? (
              <span title="The vendor printed no net and the legs cannot settle which way it went — this is the net's size, paid if bought, collected if sold">
                ${(t.netAbs / (t.units * 100)).toFixed(2)} <span className="text-[11px] text-textMuted">either way</span>
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
              t.netAbs != null && t.netAbs > 0 ? <span className="text-textSecondary" title="Paid if it was bought, collected if it was sold — the direction is not reported">net {fmtUsd(t.netAbs)}</span> : <span className="text-textMuted" title="The vendor printed no net and the legs carry no settled direction">not reported</span>
            ) : t.netPremium === 0 ? (
              <span className="text-textMuted">—</span>
            ) : (
              <TickFigure value={t.netPremium}>
                <span className="text-[11px] text-textSecondary">{t.netPremium > 0 ? 'paid ' : 'collected '}</span>
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

  /* THE TAPE'S HEAD, THIS PAGE'S RULES (Noah, 2026-08-30): the composition
     strip — facts left, champions as pills right — and the column chooser.
     The bull/bear pills only show when they are not the magenta one. */
  const champs = useMemo(() => {
    /* no compression package is a champion (audit round 5: "Largest · SPX bullish risk reversal · $271.0K" was a cbmo) */
    /* …and no structure whose legs are not read (audit round 8: the "Largest" changed as the legs came in, and named
       shapes the vendor got wrong) — a champion stands on its own legs */
    const by = (pick: (t: SpreadTrade) => boolean) => shown.filter(t => !t.compression && !t.splitOf && t.legsState === 'in' && pick(t)).reduce<SpreadTrade | null>((a, t) => (a === null || Math.abs(t.netPremium) > Math.abs(a.netPremium) ? t : a), null);
    /* WHICH ONES THE CROWN WAS PICKED FROM (audit round 10, minor 2: "Largest paid · QQQ call diagonal $449" beside an
       ORCL row paid $23.3K whose legs were not read yet) — said on the pill: among the N of M structures whose legs are in */
    const bets = shown.filter(t => !t.compression);
    return { paid: by(t => t.netKnown !== false && t.netPremium > 0), collected: by(t => t.netKnown !== false && t.netPremium < 0), all: by(() => true), read: bets.filter(t => t.legsState === 'in').length, of: bets.length };
  }, [shown]);
  const amongWords = champs.read < champs.of ? ` · among ${num(champs.read)} of ${num(champs.of)} read` : '';
  const amongTitle = `The largest by net among the structures whose legs are read${champs.read < champs.of ? ` — ${num(champs.read)} of the ${num(champs.of)} on this cut so far; the legs of the rest are read as they come on screen (the first screenful) or rank among the largest nets, so a bigger one may not be named yet` : ' — every structure on this cut'}; compression packages are never crowned`;
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
  /* the IV and the stock open folded — one click away in Columns (sixteen columns did not fit at 1440) */
  const { hidden, toggle, showAll, hideAll } = useHiddenColumns('slayer_multileg_cols_v3', ['iv', 'stock', 'legs']);
  const chooserCols = useMemo(() => columns.map(c => ({ key: c.key, label: typeof c.header === 'string' ? c.header : c.key })), [columns]);

  return (
    <>
      <TraceBox
        title="The tape as structures"
        sub={`${activeKind ? `${activeKind.label} — ${activeKind.read}` : session === 'regular' ? `The regular session's structures${closed ? ', its last ones walked back from the 16:15 close' : ''}, newest first` : 'The structures outside the regular session, newest first — each marked after hours'} · repeats the vendor sends under other ids are shown once · a row opens the structure with each leg`}
        testId="multi-leg"
        data={{ kind, rows: rows.length, expiry: expiry ?? 'all' }}
        guide={{ title: 'How to read the structures', door: 'What a shape, its strikes and its risk mean', body: <StructureGuide />, testId: 'multi-leg-guide', open: guideOpen, onOpen: setGuideOpen }}
        facts={
          <>
            <Fact label="Structures" testId="structures" title={`The multi-leg trades loaded — the vendor's newest ${SPREADS_N} and older pages as you scroll${session === 'regular' ? (closed ? ' before the 16:15 close, regular-session ones only' : ', regular-session ones only') : ', the ones outside the regular session'}, repeats folded — not the whole day`}>
              {tapeState !== 'in' ? <span className="text-textMuted">—</span> : <>{num(trades.length)} <span className="text-textSecondary">· {windowSpan} ET</span></>}
              {tapeState === 'in' && facts.loudKind && (
                <span className="text-textSecondary">
                  {' '}
                  · {facts.loudCount} {facts.loudKind.toLowerCase()}
                </span>
              )}
            </Fact>
            <Fact label="Paid · collected" testId="money" title="Structures paid to put on · collected — compression packages (OPRA cbmo / mctp) are not counted: they are not bets">
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
            {/* paused is held, not stale; the feed is read every 15s (traceLive SPREADS_POLL_MS) */}
            {!hold.paused && <StaleMark at={pack.at} ttlMs={45_000} fault={pack.fault} />}
            <FlowSearch value={query} onChange={setQuery} rows={searchRows} countNoun="structures" span />
            <DropdownSelect label="Screen" value={kind} options={SHAPE_OPTIONS} onChange={setKind} title="Which structures" testId="multi-leg-shape" />
            {/* "Debit · credit", not "Money" — Money meant moneyness on every other page */}
            <DropdownSelect label="Debit · credit" value={money} options={MONEY_OPTIONS} onChange={setMoney} title="Paid to put on, or collected" testId="multi-leg-money" />
            <ExpiryCalendar value={chosen ? isoDate(chosen.date) : ''} expiries={expiries} onChange={e => setExpiry(isoDate(e.date))} onClear={() => setExpiry(null)} label="Expiry" icon={CalendarDays} steppers={false} title="Only structures whose near leg sits on one expiry — or every expiry" testId="multi-leg-expiry" />
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
              <p role="status" className="mb-2 font-mono text-[11px] text-textSecondary">
                {cuts.said}
              </p>
            )}
            {read}
          </>
        }
      >
        <TraceGrid rows={shown} columns={columns} hidden={hidden} widths={WIDTHS} tooltips={TOOLTIPS} rowKey={keyOf} onRowClick={openRow} selectedKey={drill ? (() => { const hit = shown.find(t => t.id === drill.id); return hit ? keyOf(hit) : null; })() : null} initialSort={{ key: 'time', dir: 'desc' }} pinLeft={PIN_LEFT} pinRight={PIN_RIGHT} phoneRow={phoneRow} autoHeight onVisible={onVisible} endless={endlessOf(pack.older, 'structures', `the ${session === 'regular' ? 'session' : 'day'}'s start reached`, hold.paused)} key={tapeState} emptyText={cutQuery.trim() && trades.length > 0 ? searchMiss(cutQuery, 'structure') : tapeState === 'reading' ? 'Reading the tape' : tapeState === 'down' ? 'This read did not land' : `No structures on this cut — nothing printed as a spread, a fly or a condor under these cards ${dayAdv()}`} testId="multi-leg" />
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

      {/* The same contract card the rest of Trace opens — the legs of whichever
          structure the reader reached in through. */}
      <BookDrill
        list={legRows}
        openKey={legKey}
        onOpen={k => {
          setLegKey(k);
          if (k === null) setLegTrade(null);
        }}
        tick={tick}
      />
    </>
  );
};

export default MultiLeg;
