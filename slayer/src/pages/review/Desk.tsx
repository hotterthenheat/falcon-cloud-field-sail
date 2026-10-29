/* The options backtest desk: a replayed chart, the chain at the clock's minute, the order card, and the book — every
   price is ThetaData's recorded session (data/review/history.ts). What the desk is looking at loads as the clock
   reaches it; with the terminal away it says so and the clock waits. */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useParams } from 'react-router-dom';
import { X } from 'lucide-react';
import type { ChartOverlays, ChartTape } from '../../components/gex/StrikeChart';
import { TraceGrid } from '../../components/trace/TraceBox';
import ContractLabel from '../../components/ui/ContractLabel';
import type { DropdownOption } from '../../components/ui/DropdownSelect';
import type { Column } from '../../components/ui/DataTable';
import ChainCard, { CHAIN_MIN_PX } from '../../components/review/ChainCard';
import DeskShell, { DeskMissing, card, head, headWord, smallDoor, type DeskName } from '../../components/review/DeskShell';
import { ChainOrder } from '../../components/paper/OptionsChain';
import { BellCard, ClosingLine, type BellFacts } from '../../components/review/BellNotice';
import type { ChartBracket, ChartEntry, ChartPosition } from '../../components/review/PositionLayer';
import { dirInk, momentWords, pct, rWords, usd, usdSigned } from '../../components/review/words';
import { accountOf, bankedOf, dayStateOf, feesOf, floorOf, ladderRoom, ladderTake, nameGoesUp, namesOf, pendingSettlement, refusal, statsOf, type Account, type Order, type Trade } from '../../data/review/engine';
import PnlBadges from '../../components/review/PnlBadges';
import StopOrders, { type Tif } from '../../components/review/StopOrders';
import { chainAt, contractDay, contractKey, contractWords, dteAt, expiriesAt, longLeg, quoteAt, quoteWith, settleStyleOf, spotForAsk, spotForBid, type ContractId, type Right } from '../../data/review/quotes';
import { amendOrder, attachBracket, breakevenOrder, cancelOrder, closePosition, legsHeld, moveClock, placeOrder, rebaseOrder, renameSession, trailOrder, useMoving, useSession } from '../../data/review/store';
import { DAY_MIN, LAST_MIN, underOf, barsNeed, chainNeed, clockWords, dayBars, dayWords, ensureBars, ensureBarsRange, ensureChainDay, ensureLeg, ensureListing, ensureTrades, historyOffline, historyRev, listingNeed, nextDay, prevDay, spotAt, subscribeHistory } from '../../data/review/history';
import { companyName } from '../../data/tickers';
import ThetaLine from '../../components/review/ThetaLine';
import { EmptyBox, LoadingBox } from '../../components/ui/states';
import type { Timeframe } from '../../data/timeframe';
import type { Candle } from '../../types/market';
import type { KeyLevels } from '../../types/gex';

/* The chart's settings on this desk. The intervals a one-minute tape can make (no 15s: there are no seconds to
   fold; no weekly: the sessions kept behind the clock are too few weeks). The overlays that read BARS — the rest
   need the book, and a replayed tape has none yet, so their switches are not offered. */
const REVIEW_TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '1D'];
const REVIEW_OVERLAY_KEYS: (keyof ChartOverlays)[] = ['volume', 'session', 'cone', 'volDrift'];
/** Sessions kept behind the clock's day — what the daily candles, a 50-bar average and yesterday's levels are made from */
const CONTEXT_DAYS = 20;
type Tab = 'open' | 'orders' | 'closed';
/** Strikes each side of the ladder's centre — the chain is a window, so it can hold more than it shows */
const CHAIN_EACH = 12;
/** The last minutes of a session the desk counts down */
const CLOSING_MIN = 15;

/** The nearest strike's IV on a chain — the name's vol that minute, as its options priced it */
const atmIv = (rows: { strike: number; call: { iv: number } }[], spot: number): number => {
  let best: { strike: number; call: { iv: number } } | null = null;
  for (const r of rows) if (r.call.iv > 0 && (!best || Math.abs(r.strike - spot) < Math.abs(best.strike - spot))) best = r;
  return best?.call.iv ?? 0;
};

const Desk = () => {
  const { id } = useParams();
  const session = useSession(id);
  const moving = useMoving(id);
  /* the recorded days, as they land */
  const hrev = useSyncExternalStore(subscribeHistory, historyRev, historyRev);
  const offline = historyOffline();
  /* while the terminal is away, what the desk needs is asked for again every 15 s (and never while the tab is hidden) */
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!offline) return;
    const t = window.setInterval(() => document.visibilityState === 'visible' && setRetry(n => n + 1), 15_000);
    return () => window.clearInterval(t);
  }, [offline]);
  /** The closing line and the bell's card, put away — for that day only */
  const [closingSeen, setClosingSeen] = useState('');
  const [bellSeen, setBellSeen] = useState('');
  const [right, setRight] = useState<Right>('C');
  const [expiry, setExpiry] = useState<string | null>(null);
  const [picked, setPicked] = useState<ContractId | null>(null);
  const [tab, setTab] = useState<Tab>('open');
  /** The picked strike's drop-down: open on a pick, folded by a second press on the same row */
  const [drillOpen, setDrillOpen] = useState(true);
  /** The desk's one size — the Order card's (the paper desk's grammar) */
  const [q, setQ] = useState(1);
  /** How long an order that waits is good for — every limit and stop placed from this desk */
  const [tif, setTif] = useState<Tif>('gtc');
  /** The takeover is up — the shell's, held here because the chain's window reads it */
  const [full, setFull] = useState(false);
  const cursor = session?.cursor ?? null;
  /* The name on the desk: one of the session's (two at most); the other keeps running on the same clock */
  const names = useMemo(() => (session ? namesOf(session) : ['SPY']), [session?.ticker, session?.tickers]); // eslint-disable-line react-hooks/exhaustive-deps
  const [activeName, setActiveName] = useState('');
  const ticker = names.includes(activeName) ? activeName : names[0];
  /** To a name — with a contract in hand when the door was a row of the book */
  const switchTo = (to: string, contract: ContractId | null = null) => {
    if (to === ticker && !contract) return; // already on the desk: the contract in hand stays in hand
    if (to !== ticker) {
      setActiveName(to);
      setExpiry(null);
    }
    setPicked(contract);
    if (contract) {
      setRight(contract.right);
      setExpiry(contract.expiry);
      setDrillOpen(true);
    }
  };
  const account = useMemo<Account | null>(() => (session ? accountOf(session) : null), [session, hrev]); // eslint-disable-line react-hooks/exhaustive-deps

  /* THE DAY'S LOADS: each name's bars (and the sessions behind it, in one ask), the contracts quoted that day, and every
     contract the book holds or waits on */
  useEffect(() => {
    if (!cursor) return;
    let from = cursor.day;
    for (let i = 0; i < CONTEXT_DAYS; i++) from = prevDay(from);
    for (const n of names) {
      void ensureBars(n, cursor.day);
      void ensureListing(n, cursor.day);
      void ensureBarsRange(n, from, prevDay(cursor.day));
    }
  }, [names, cursor?.day, retry]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!session) return;
    for (const l of legsHeld(session)) if (l.expiry >= session.cursor.day) void ensureLeg(l, session.cursor.day);
  }, [session?.orders, session?.fills, cursor?.day, retry]); // eslint-disable-line react-hooks/exhaustive-deps

  /* the expiries listed today; the one in hand gives way to the next once it has passed */
  const expiries = useMemo(() => (cursor ? expiriesAt(ticker, cursor.day) : []), [ticker, cursor?.day, hrev]); // eslint-disable-line react-hooks/exhaustive-deps
  const exp = expiry && expiries.some(e => e.iso === expiry) ? expiry : (expiries.find(e => e.dte >= 5) ?? expiries[0])?.iso ?? null;
  const expiryOptions = useMemo<DropdownOption<string>[]>(() => expiries.map(e => ({ value: e.iso, label: `${e.label} · ${e.dte}d`, hint: e.dte === 0 ? 'Expires at today’s bell' : `${e.kind === 'monthly' ? 'The monthly' : e.kind === 'daily' ? 'A daily' : 'A weekly'} · ${dayWords(e.iso, true)}` })), [expiries]);
  useEffect(() => {
    if (cursor && exp) void ensureChainDay(ticker, exp, cursor.day);
  }, [ticker, exp, cursor?.day, retry]); // eslint-disable-line react-hooks/exhaustive-deps
  /* laddered off the day's open (it stays put); only a name that has run most of the ladder away re-centres it */
  const chain = useMemo(() => {
    if (!cursor || !exp) return null;
    const open = dayBars(ticker, cursor.day)[0]?.open;
    const now = spotAt(ticker, cursor.day, cursor.minute);
    const centre = open != null && now > 0 && Math.abs(now - open) / now <= 0.01 ? open : undefined;
    return chainAt(ticker, cursor.day, cursor.minute, exp, CHAIN_EACH, centre);
  }, [ticker, cursor?.day, cursor?.minute, exp, hrev]); // eslint-disable-line react-hooks/exhaustive-deps
  /* the name's vol this minute, as its at-the-money option priced it */
  const ivNow = chain ? atmIv(chain.rows, chain.spot) : 0;
  /* The tape each chart draws: the sessions behind the clock's day, whole, then today up to the clock — never a
     bar past it. By name: one chart on the page, two side by side in the takeover. */
  const contextBy = useMemo<Record<string, Candle[]>>(() => {
    if (!cursor) return {};
    const days: string[] = [];
    for (let d = prevDay(cursor.day); d && days.length < CONTEXT_DAYS; d = prevDay(d)) days.push(d);
    days.reverse();
    return Object.fromEntries(names.map(n => [n, days.flatMap(d => dayBars(n, d))]));
  }, [names, cursor?.day, hrev]); // eslint-disable-line react-hooks/exhaustive-deps
  const noteOf = (n: string): string | null => {
    if (!cursor) return null;
    const need = barsNeed(n, cursor.day);
    return need === 'none' ? `ThetaData has no bars for ${n} on ${dayWords(cursor.day)}` : need === 'offline' ? 'ThetaData offline — reconnecting' : null;
  };
  const tapeBy = useMemo<Record<string, ChartTape>>(() => (cursor ? Object.fromEntries(names.map(n => [n, { bars: [...(contextBy[n] ?? []), ...dayBars(n, cursor.day).slice(0, cursor.minute + 1)], iv: n === ticker ? ivNow : 0, key: `review:${n}`, clock: 'ny' as const, note: noteOf(n) }])) : {}), [contextBy, names, cursor?.day, cursor?.minute, hrev, ivNow]); // eslint-disable-line react-hooks/exhaustive-deps
  const fillsBy = useMemo(() => Object.fromEntries(names.map(n => [n, session ? session.fills.filter(f => f.contract.ticker === n) : []])), [session?.fills, names]); // eslint-disable-line react-hooks/exhaustive-deps
  /* the contract in hand: its legs' day, and its prints for the drop-down */
  useEffect(() => {
    if (!cursor || !picked) return;
    void ensureLeg(longLeg(picked), cursor.day);
    if (picked.short != null) void ensureLeg({ ...longLeg(picked), strike: picked.short }, cursor.day);
    if (drillOpen) void ensureTrades(longLeg(picked), cursor.day);
  }, [picked, drillOpen, cursor?.day, retry]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickedQuote = useMemo(() => (cursor && picked ? quoteAt(picked, cursor.day, cursor.minute) : null), [picked, cursor?.day, cursor?.minute, hrev]); // eslint-disable-line react-hooks/exhaustive-deps
  /* a strike's drop-down is that strike's — the bought leg of a spread, not the pair */
  const pickedDay = useMemo(() => (cursor && picked && drillOpen ? contractDay(longLeg(picked), cursor.day, cursor.minute) : null), [picked, drillOpen, cursor?.day, cursor?.minute, hrev]); // eslint-disable-line react-hooks/exhaustive-deps
  /* The position on the chart: where it was entered, and — for what rides it — where the name would have to stand,
     at this minute, for the contract to bid the order's price */
  const positionsBy = useMemo<Record<string, ChartPosition[]>>(() => Object.fromEntries(names.map(n => [n, account ? account.positions.filter(p => p.contract.ticker === n).map(p => ({ key: p.key, contract: p.contract, qty: p.qty, spotIn: p.spotIn, pnl: p.pnl, r: p.r, avg: p.avg, bid: p.quote.bid, dead: p.quote.dead, room: session ? ladderRoom(session, p.contract) : undefined, take: session ? ladderTake(session, p.contract) : undefined })) : []])), [account, names]); // eslint-disable-line react-hooks/exhaustive-deps
  const bracketsBy = useMemo<Record<string, ChartBracket[]>>(() => {
    const out: Record<string, ChartBracket[]> = Object.fromEntries(names.map(n => [n, [] as ChartBracket[]]));
    if (!session || !account) return out;
    const { day, minute } = session.cursor;
    for (const o of session.orders) {
      if (o.status !== 'working' || o.side !== 'sell' || o.price == null || o.kind === 'market') continue;
      const list = out[o.contract.ticker];
      const pos = account.positions.find(p => p.key === contractKey(o.contract));
      if (!list || !pos) continue;
      /* What it waits on. The contract's price: its dollars hold, and its line is wherever the name would have to
         stand THIS minute. The name's price: its line holds, and its dollars are what the contract would bid there
         THIS minute. */
      const onName = o.on === 'name';
      const level = onName ? o.price : spotForBid(o.contract, day, minute, o.price);
      const sellsAt = onName ? quoteWith(o.contract, day, minute, o.price).bid : o.price;
      /* further off than the name's expected day (its vol that day, one sigma): no room on the scale for it */
      const here = pos.quote.spot;
      const reach = ivNow > 0 ? here * (ivNow / Math.sqrt(252)) : Infinity;
      list.push({ orderId: o.id, kind: o.kind === 'stop' ? 'stop' : 'target', on: onName ? 'name' : 'contract', contract: o.contract, qty: o.qty, price: o.price, level, money: (sellsAt - pos.avg) * 100 * o.qty, edge: nameGoesUp(o.kind, o.contract.right) ? 'up' : 'down', far: level == null || Math.abs(level - here) > reach, trail: o.kind === 'stop' ? (o.trail ?? null) : undefined, trailNow: o.kind === 'stop' ? Math.max(0.01, onName ? Math.abs(here - o.price) : pos.quote.bid - o.price) : undefined, breakeven: !!o.breakeven, canBreakeven: !!o.oco && session.orders.some(x => x.status === 'working' && x.oco === o.oco && x.kind === 'limit') });
    }
    const KEY = (b: ChartBracket) => contractKey(b.contract);
    /* THE LADDER: where a position has more than one level of a kind, each says which it is — the nearest first */
    for (const list of Object.values(out)) {
      const groups = new Map<string, ChartBracket[]>();
      for (const b of list) groups.set(`${KEY(b)}|${b.kind}`, [...(groups.get(`${KEY(b)}|${b.kind}`) ?? []), b]);
      /* by how far each stands, a contract — a far level of one contract is not nearer than a near level of two */
      for (const g of groups.values()) if (g.length > 1) [...g].sort((x, y) => Math.abs(x.money) / x.qty - Math.abs(y.money) / y.qty).forEach((b, i) => (b.nth = i + 1));
    }
    return out;
  }, [session, account, names, ivNow]);

  /* The resting orders that are not ways out — a buy waiting at a price, said as such on the chart ("1 · Buy limit
     · 480C @ 1.20", PositionLayer): where the name would have to stand, this minute, for the contract's ask to
     come down to it */
  const entriesBy = useMemo<Record<string, ChartEntry[]>>(() => {
    const out: Record<string, ChartEntry[]> = Object.fromEntries(names.map(n => [n, [] as ChartEntry[]]));
    if (!session) return out;
    const { day, minute } = session.cursor;
    for (const o of session.orders) {
      if (o.status !== 'working' || o.side !== 'buy' || o.price == null || o.kind === 'market') continue;
      const list = out[o.contract.ticker];
      if (!list) continue;
      const c = o.contract;
      const here = spotAt(c.ticker, day, minute);
      const level = spotForAsk(c, day, minute, o.price);
      const reach = ivNow > 0 ? here * (ivNow / Math.sqrt(252)) : Infinity;
      list.push({ orderId: o.id, side: 'buy', kind: o.kind === 'stop' ? 'stop' : 'limit', qty: o.qty, price: o.price, level, label: contractWords(c).replace(`${c.ticker} `, ''), edge: (o.kind === 'stop') === (c.right === 'C') ? 'up' : 'down', far: level == null || Math.abs(level - here) > reach, priceAt: at => Math.max(0.01, Math.round(quoteWith(c, day, minute, at).ask * 100) / 100) });
    }
    return out;
  }, [session, names, ivNow, hrev]);

  /* ---- the blotter's columns ---- */
  const openCols = useMemo<Column<Account['positions'][number]>[]>(
    () => [
      { key: 'contract', header: 'Contract', render: p => <ContractLabel contract={contractWords(p.contract)} right={p.contract.right} logo={p.contract.ticker} size="sm" /> },
      { key: 'qty', header: 'Held', align: 'right', render: p => <span className="text-textPrimary">{p.qty}</span> },
      { key: 'exp', header: 'Expires', render: p => (session && p.contract.expiry < session.cursor.day ? <span className="text-warn" title={`Expired ${dayWords(p.contract.expiry)} — it settles on ${underOf(p.contract.ticker)}’s close that day, which ThetaData has not answered yet`}>settling…</span> : <span className="text-textSecondary">{dayWords(p.contract.expiry)} · {session ? dteAt(session.cursor.day, p.contract.expiry) : 0}d</span>) },
      { key: 'avg', header: 'Paid', align: 'right', render: p => <span className="text-textSecondary">{p.avg.toFixed(2)}</span> },
      { key: 'mark', header: 'Bid · ask', align: 'right', render: p => (p.quote.dead ? <span className="text-textMuted" title={Number.isFinite(p.mark) ? `No two-sided quote this minute — marked at ${p.mark.toFixed(2)}, the mid it last had${p.staleFrom != null ? ` (${clockWords(p.staleFrom)} ET)` : ''}` : 'No two-sided quote yet today — not marked'}>{Number.isFinite(p.mark) ? `mid ${p.mark.toFixed(2)}${p.staleFrom != null ? ` · ${clockWords(p.staleFrom)}` : ''}` : '— · —'}</span> : <span className="text-textPrimary">{`${p.quote.bid.toFixed(2)} · ${p.quote.ask.toFixed(2)}`}</span>) },
      { key: 'theta', header: 'Decay a day', align: 'right', render: p => <span className="text-textSecondary">{p.quote.iv > 0 ? usd(Math.abs(p.quote.theta) * 100 * p.qty) : '—'}</span> },
      { key: 'pnl', header: 'Up or down', align: 'right', render: p => (Number.isFinite(p.pnl) ? <span className={`font-semibold ${dirInk(p.pnl)}`}>{usdSigned(p.pnl)} <span className="text-t10 font-normal opacity-80">{rWords(p.r)}</span></span> : <span className="text-textMuted" title="No quote stood this minute">—</span>) },
      {
        key: 'close',
        header: '',
        align: 'right',
        render: p => (
          <button type="button" onClick={() => id && closePosition(id, p.contract, p.qty)} disabled={p.quote.dead || (session?.cursor.minute ?? 0) >= LAST_MIN} title={(session?.cursor.minute ?? 0) >= LAST_MIN ? 'The market is shut — open the next day' : p.quote.dead ? 'No bid to sell into right now' : 'Sell all of it at the bid, now'} className={smallDoor} data-position-close={p.key}>
            Close
          </button>
        ),
      },
    ],
    [id, session]
  );
  const orderCols = useMemo<Column<Order>[]>(
    () => [
      { key: 'contract', header: 'Contract', render: o => <ContractLabel contract={contractWords(o.contract)} right={o.contract.right} logo={o.contract.ticker} size="sm" /> },
      { key: 'what', header: 'Order', render: o => <span className="text-textPrimary">{o.side === 'buy' ? 'Buy' : 'Sell'} {o.qty} · {o.kind === 'market' ? 'market' : o.side === 'buy' && o.kind === 'stop' ? `stop ${o.price?.toFixed(2)} · at the ask` : o.on === 'name' ? `${o.kind === 'limit' ? 'when' : 'if'} ${o.contract.ticker} ${o.kind === 'limit' ? 'reaches' : nameGoesUp(o.kind, o.contract.right) ? 'rises to' : 'falls to'} ${o.price?.toFixed(2)}` : o.kind === 'limit' ? `limit ${o.price?.toFixed(2)}` : `stop ${o.price?.toFixed(2)}`}{o.oco ? <span className="text-textMuted"> · rides the buy</span> : null}{o.trail != null ? <span className="text-textMuted"> · trails by {o.trail.toFixed(2)}</span> : null}{o.breakeven ? <span className="text-textMuted"> · to what you paid after the first target</span> : null}{o.moved ? <span className="text-textMuted"> · moved to what you paid</span> : null}</span> },
      { key: 'placed', header: 'Placed', render: o => <span className="text-textSecondary">{momentWords(o.placed)}</span> },
      {
        key: 'status',
        header: 'Stands',
        render: o =>
          o.status === 'working' ? <span className="text-silver font-semibold">Working · {o.tif === 'day' ? 'today only' : 'until cancelled'}</span> : o.status === 'filled' ? <span className="text-textPrimary">Filled at {o.fillPrice?.toFixed(2)}</span> : <span className="text-textMuted">{o.status === 'refused' ? 'Refused' : 'Cancelled'} — {o.why}</span>,
      },
      {
        key: 'cancel',
        header: '',
        align: 'right',
        render: o =>
          o.status === 'working' ? (
            <button type="button" onClick={() => id && cancelOrder(id, o.id)} title="Cancel this order" aria-label="Cancel this order" className="inline-flex items-center justify-center w-6 h-6 rounded text-textMuted hover:text-bear hover:bg-ink/[0.06] transition-colors" data-order-cancel={o.id}>
              <X className="w-3 h-3" />
            </button>
          ) : null,
      },
    ],
    [id]
  );
  const closedCols = useMemo<Column<Trade>[]>(
    () => [
      { key: 'contract', header: 'Contract', render: t => <ContractLabel contract={contractWords(t.contract)} right={t.contract.right} logo={t.contract.ticker} size="sm" /> },
      { key: 'qty', header: 'Size', align: 'right', render: t => <span className="text-textPrimary">{t.qty}</span> },
      { key: 'in', header: 'In', render: t => <span className="text-textSecondary">{momentWords(t.opened)} · {t.avgIn.toFixed(2)}</span> },
      { key: 'out', header: 'Out', render: t => <span className="text-textSecondary">{momentWords(t.closed)} · {t.avgOut.toFixed(2)}</span> },
      { key: 'how', header: 'Ended', render: t => <span className="text-textSecondary">{t.how === 'scaled' ? 'Scaled out' : t.how === 'sold' ? 'Sold by you' : t.how === 'target' ? 'Target hit' : t.how === 'stopped' ? 'Stopped out' : t.settle === 'cash' ? 'Cash-settled' : t.avgOut > 0 ? 'Exercised at the close' : 'Expired worthless'}</span> },
      { key: 'pnl', header: 'Made or lost', align: 'right', render: t => <span className={`font-semibold ${dirInk(t.pnl)}`}>{usdSigned(t.pnl)} <span className="text-t10 font-normal opacity-80">{rWords(t.r)}</span></span> },
    ],
    []
  );

  if (!session || !cursor || !account) return <DeskMissing />;

  const spotOf = (n: string) => spotAt(n, cursor.day, cursor.minute);
  const spot = spotOf(ticker);
  const stats = statsOf(account.trades);
  const floor = floorOf(session);
  const tomorrow = nextDay(cursor.day);
  const working = session.orders.filter(o => o.status === 'working');
  const orders = [...working, ...session.orders.filter(o => o.status !== 'working').reverse()].slice(0, 40);
  /* The reader's own rules, and where each stands */
  const rules = session.rules;
  const dayState = rules?.dailyLossPct ? dayStateOf(session) : null;
  const rulesLine =
    rules && (rules.maxOpen || rules.maxRiskPct || rules.dailyLossPct) ? (
      <span className="inline-flex items-center gap-x-2 gap-y-0.5 flex-wrap" data-review-rules>
        {rules.maxOpen ? (
          <span className={account.positions.length >= rules.maxOpen ? 'text-warn' : 'text-textPrimary'} title="Positions open at once — a buy that would open another is refused">
            {account.positions.length} of {rules.maxOpen} open
          </span>
        ) : null}
        {rules.maxRiskPct ? (
          <span className="text-textPrimary" title="The most one trade may cost, as a share of what the account is worth">
            {rules.maxRiskPct * 100}% a trade · {usd(account.equity * rules.maxRiskPct, 0)}
          </span>
        ) : null}
        {rules.dailyLossPct && dayState ? (
          <span className={dayState.stopped ? 'text-warn font-semibold' : 'text-textPrimary'} title="Measured from what the account was worth at the open — no new positions once it is reached, until the next open" data-review-day-stop={dayState.stopped ? 'reached' : 'standing'}>
            {dayState.stopped ? `the day is over · ${(dayState.pct * 100).toFixed(1)}%` : `day ${dayState.pct >= 0 ? '+' : ''}${(dayState.pct * 100).toFixed(1)}% · stops at −${rules.dailyLossPct * 100}%`}
          </span>
        ) : null}
      </span>
    ) : null;
  /* THE BELL: the last fifteen minutes are counted down, and 16:00 is said (components/review/BellNotice) */
  const atBell = cursor.minute >= LAST_MIN;
  const minutesLeft = LAST_MIN - cursor.minute;
  const expiringToday = account.positions.filter(p => p.contract.expiry === cursor.day).map(p => contractWords(p.contract));
  const rungNow = (m?: { day: string; minute: number }) => !!m && m.day === cursor.day && m.minute >= LAST_MIN;
  const bellFacts: BellFacts | null = atBell
    ? {
        dayWords: dayWords(cursor.day, true).split(',').slice(0, 2).join(','),
        dayOrders: session.orders.filter(o => o.status === 'cancelled' && o.why === 'the day ended' && rungNow(o.done)).length,
        settled: session.fills.filter(f => f.how === 'expired' && rungNow(f.at)).map(f => ({ contract: contractWords(f.contract), price: f.price, how: f.price <= 0 ? 'expired worthless' : (f.settle ?? settleStyleOf(f.contract.ticker)) === 'cash' ? `cash-settled on ${underOf(f.contract.ticker)}’s close, ${f.spot.toFixed(2)}` : `exercised at ${f.contract.ticker}’s close, ${f.spot.toFixed(2)}`, pnl: account.trades.find(t => t.how === 'expired' && rungNow(t.closed) && contractKey(t.contract) === contractKey(f.contract))?.pnl ?? null })),
        carried: account.positions.length,
        unsettled: pendingSettlement(session).length,
        working: working.length,
      }
    : null;
  const bidAtSpot = (c: ContractId, at: number) => quoteWith(c, cursor.day, cursor.minute, at).bid;
  const pickRow = (c: ContractId) => {
    const same = picked != null && contractKey(longLeg(picked)) === contractKey(c);
    setDrillOpen(same ? !drillOpen : true);
    setPicked(c);
  };
  /* the chart keeps the walls on screen when it has them; a replayed tape has no book, so only where the name stands */
  const levelsOf = (n: string): KeyLevels => ({ spot: spotOf(n), callWall: NaN, putWall: NaN, flip: NaN, supreme: NaN });
  /* The names, as the shell reads them: each with its tape, and what is drawn over it */
  const deskNames: DeskName[] = names.map(n => {
    const px = spotOf(n);
    const open = dayBars(n, cursor.day)[0]?.open ?? NaN;
    return {
      symbol: n,
      title: companyName(n),
      label: n,
      priceWords: px > 0 ? px.toFixed(2) : '—',
      dayPct: px > 0 && open > 0 ? ((px - open) / open) * 100 : 0,
      held: account.positions.filter(q => q.contract.ticker === n).length,
      tape: tapeBy[n],
      levels: levelsOf(n),
      layer: {
        fills: fillsBy[n] ?? [],
        positions: positionsBy[n] ?? [],
        brackets: bracketsBy[n] ?? [],
        entries: entriesBy[n] ?? [],
        marketShut: atBell,
        onClosePosition: (c, q) => closePosition(session.id, c, q),
        onAmend: (oid, px2) => amendOrder(session.id, oid, px2),
        onRebase: (oid, to) => rebaseOrder(session.id, oid, to),
        onCancelOrder: oid => cancelOrder(session.id, oid),
        onAttach: (c, kind, px2, onWhat) => attachBracket(session.id, c, kind, px2, onWhat),
        onTrail: (oid, on, by) => trailOrder(session.id, oid, on, by),
        onBreakeven: (oid, on) => breakevenOrder(session.id, oid, on),
        bidAtSpot,
      },
      /* RP&L · UP&L: what the name has banked on the clock's day, and what is open on it */
      corner: (
        <PnlBadges
          name={n}
          realized={bankedOf(session, n) - bankedOf(session, n, cursor.day)}
          unrealized={account.positions.filter(q => q.contract.ticker === n).reduce((x, q) => x + (Number.isFinite(q.pnl) ? q.pnl : 0), 0)}
          dayWord={`on ${dayWords(cursor.day)}, the clock’s day`}
        />
      ),
    };
  });

  /* The chain, as it stood — a strike opens onto its stats and its greeks (components/review/ChainCard) */
  /* held: the contract itself, or the bought leg of a spread; sold: the other leg of one (open, or on the ticket) */
  const legOf = (p: ContractId) => p.ticker === ticker && p.expiry === exp && p.right === right;
  const listNeed = listingNeed(ticker, cursor.day);
  const chainState = exp ? chainNeed(ticker, exp, cursor.day) : listNeed;
  const chainEmpty =
    listNeed === 'offline' || chainState === 'offline' ? (
      <EmptyBox title="ThetaData offline — reconnecting" reason="The recorded quotes for this day load when the terminal answers." />
    ) : listNeed === 'none' ? (
      <EmptyBox title="No contracts recorded" reason={`ThetaData has no option quotes for ${ticker} on ${dayWords(cursor.day)}.`} />
    ) : chainState === 'none' ? (
      <EmptyBox title="No quotes recorded" reason={`Nothing was quoted near the money on the ${exp ? dayWords(exp) : ''} expiry that day.`} />
    ) : (
      <LoadingBox shape="table" rows={10} label="Loading the recorded chain" />
    );
  const chainCard = (
    <ChainCard
      ticker={ticker}
      title={companyName(ticker)}
      spot={chain?.spot ?? spot}
      showName={names.length > 1}
      stamp={`NBBO as it stood · ${clockWords(cursor.minute)} ET`}
      right={right}
      onRight={setRight}
      expiry={exp}
      expiryOptions={expiryOptions}
      onExpiry={setExpiry}
      expiryTitle="The expiries listed on this day"
      /* a day the vendor recorded nothing near the money on: the empty box says so, not a ladder of dashes */
      rows={chainState === 'none' || chainState === 'offline' ? [] : (chain?.rows ?? [])}
      picked={picked}
      drillOpen={drillOpen}
      onPick={pickRow}
      drill={pickedDay}
      held={k => account.positions.some(p => legOf(p.contract) && p.contract.strike === k)}
      sold={k => account.positions.some(p => legOf(p.contract) && p.contract.short === k) || (picked != null && legOf(picked) && picked.short === k)}
      full={full}
      centreKey={`${exp}|${right}|${cursor.day}|${session.id}|${chain?.rows.length ? 1 : 0}`}
      empty={chainEmpty}
    />
  );

  /* ---- THE TICKET ---- */
  const ticketCard = (
    <div className={`${card} min-w-0 shrink-0`} data-review-ticket-card>
      <div className={head}>
        <span className={headWord}>Order</span>
        {picked && (
          <button type="button" onClick={() => setPicked(null)} className="ml-auto font-mono text-t10 text-textMuted hover:text-textPrimary transition-colors">
            Clear
          </button>
        )}
      </div>
      {/* The order is the paper desk's: the same size row, the two buttons, the limit box, the spread, the
          brackets — fed the replayed minute's quotes and this session's refusals */}
      {picked && pickedQuote ? (
        <div className="px-4 pb-3" data-review-ticket={contractWords(picked)}>
          <ChainOrder
            /* a fill makes it a new order: what was just bought is now something to sell */
            key={`${contractKey(longLeg(picked))}|${session.fills.length}`}
            c={{ strike: picked.strike, right: picked.right }}
            ticker={picked.ticker}
            expiry={picked.expiry}
            spot={pickedQuote.spot}
            word={false}
            desk={{
              refuse: d => refusal(session, d),
              locked: null,
              /* at the name's price this minute: the recorded NBBO, what a press fills at; anywhere else, the what-if */
              quoteWith: (c, at) => (Math.abs(at - spotAt(c.ticker, cursor.day, cursor.minute)) < 1e-9 ? quoteAt(c, cursor.day, cursor.minute) : quoteWith(c, cursor.day, cursor.minute, at)),
              spotForBid: (c, bid) => spotForBid(c, cursor.day, cursor.minute, bid),
              fee: session.fee,
              free: account.cash,
              equity: account.equity,
              version: `${cursor.day}|${cursor.minute}|${session.fills.length}|${session.orders.length}`,
              q,
              onQ: setQ,
              heldAt: strike => {
                const p = account.positions.find(x => x.contract.ticker === picked.ticker && x.contract.expiry === picked.expiry && x.contract.right === picked.right && x.contract.strike === strike);
                return p ? { contract: p.contract, qty: p.qty, avg: p.avg, pnl: Number.isFinite(p.pnl) ? p.pnl : 0, decayDay: Math.abs(quoteAt(p.contract, cursor.day, cursor.minute).theta) * 100 * p.qty } : null;
              },
              strikes: picked.ticker === ticker && picked.expiry === exp ? (chain?.rows.map(r => r.strike) ?? []) : [],
              onShort: k => setPicked(k ? { ...longLeg(picked), short: k } : longLeg(picked)),
              onPlace: d => {
                placeOrder(session.id, d.kind === 'market' ? d : { ...d, tif });
                setTab(d.kind === 'market' ? (d.side === 'buy' ? 'open' : 'closed') : 'orders');
              },
              onClose: (c, n) => {
                closePosition(session.id, c, n);
                setTab('closed');
              },
            }}
          />
        </div>
      ) : null}
      {picked && pickedQuote ? (
        <StopOrders
          contract={account.positions.find(p => contractKey(longLeg(p.contract)) === contractKey(longLeg(picked)))?.contract ?? picked}
          held={account.positions.find(p => contractKey(longLeg(p.contract)) === contractKey(longLeg(picked)))?.qty ?? 0}
          qty={q}
          quote={pickedQuote}
          tif={tif}
          onTif={setTif}
          refuse={d => refusal(session, d)}
          onPlace={d => {
            placeOrder(session.id, d);
            setTab('orders');
          }}
        />
      ) : (
        <div className="h-full min-h-[180px] flex items-center justify-center px-6 text-center font-mono text-t10 uppercase tracking-widest text-textMuted" data-review-ticket="empty">
          Pick a contract in the chain — its order opens here
        </div>
      )}
    </div>
  );

  return (
    <DeskShell
      session={session}
      onRename={name => renameSession(session.id, name)}
      subline={`${names.map(companyName).join(' and ')} · ThetaData’s recorded NBBO: buys at the ask, sells at the bid, checked at each minute’s end · ${session.fee ? `${usd(session.fee)} a contract each way` : 'no fee'}`}
      facts={[
        { label: 'Worth now', testId: 'equity', node: Number.isFinite(account.equity) ? usd(account.equity) : '—' },
        { label: 'Cash', testId: 'cash', node: usd(account.cash) },
        { label: 'Open, up or down', testId: 'open-pnl', node: Number.isFinite(account.openPnl) ? <span className={dirInk(account.openPnl)}>{usdSigned(account.openPnl)}</span> : '—' },
        { label: 'Banked, made or lost', testId: 'realized', node: <span className={dirInk(account.realized)} title={`Closed trades ${usdSigned(stats.net)}, and the pieces sold of what is still open — after ${usd(feesOf(session))} of fees. With the open figure it is the account’s whole move.`}>{usdSigned(account.realized)}</span> },
        ...(rulesLine ? [{ label: 'Your rules', testId: 'rules', node: <span className="text-t12 font-medium">{rulesLine}</span> }] : []),
        {
          label: 'Closed trades',
          testId: 'trades',
          node: (
            <>
              {stats.n} {stats.n > 0 && <span className="text-textMuted">· {pct(stats.winRate)} won</span>}
            </>
          ),
        },
      ]}
      account={{ equity: account.equity, openPnl: account.openPnl, third: { label: 'cash', value: usd(account.cash) } }}
      names={deskNames}
      active={ticker}
      onSwitch={n => switchTo(n)}
      switchLabel="The name on the desk"
      logos
      prefsKey="slayer_review_chart"
      paneIds={['review:main', 'review:second']}
      timeframes={REVIEW_TIMEFRAMES}
      overlayKeys={REVIEW_OVERLAY_KEYS}
      clock={{
        day: cursor.day,
        minute: cursor.minute,
        lastMin: LAST_MIN,
        dayMin: DAY_MIN,
        floorDay: floor.day,
        tomorrow,
        words: `${dayWords(cursor.day)} · ${clockWords(cursor.minute)}`,
        wordsAt: clockWords,
        move: to => moveClock(session.id, to),
      }}
      goToTitle="Jump the clock to the open of a later day — every day between is run"
      nextDayTitle="Ring today’s bell and open the next session"
      /* THE BELL — the last fifteen minutes as a line, 16:00 as a card; both can be put away for the day */
      notice={({ seek }) =>
        moving ? (
          /* a move waiting on its recorded days, or one the terminal could not load: said on a card over the tape */
          <div className="pointer-events-auto mt-11 rounded-md border border-borderMuted bg-panel/95 backdrop-blur-md px-3 py-2 animate-soft-in" data-theme="dark" role="status" data-review-moving={moving.failed ? 'failed' : 'loading'}>
            {moving.failed ? <ThetaLine since={offline || Date.now()} what={moving.failed} /> : <span className="font-mono text-t10 uppercase tracking-widest text-textSecondary">{moving.words} · to {dayWords(moving.to.day)} {clockWords(moving.to.minute)} ET</span>}
          </div>
        ) : bellFacts ? (
          bellSeen !== cursor.day ? (
            <BellCard facts={bellFacts} onNextDay={tomorrow ? () => seek(0, tomorrow) : null} onDismiss={() => setBellSeen(cursor.day)} />
          ) : null
        ) : minutesLeft <= CLOSING_MIN && closingSeen !== cursor.day ? (
          <ClosingLine minutesLeft={minutesLeft} expiring={expiringToday} onDismiss={() => setClosingSeen(cursor.day)} />
        ) : null
      }
      full={full}
      onFull={setFull}
      side={
        <>
          {chainCard}
          {ticketCard}
        </>
      }
      sideMinPx={CHAIN_MIN_PX}
      panelWord="chain"
      panelTitle="The chain and the order"
      tab={tab}
      onTab={setTab}
      counts={{ open: account.positions.length, working: working.length, closed: account.trades.length }}
      book={
        tab === 'open' ? (
          <TraceGrid key="open" rows={account.positions} columns={openCols} rowKey={p => p.key} onRowClick={p => switchTo(p.contract.ticker, p.contract)} selectedKey={picked ? contractKey(picked) : null} autoHeight animate={false} widths={{ qty: 70, avg: 80, close: 84, mark: 130, theta: 120 }} emptyText="Nothing open — pick a contract in the chain" testId="review-open" />
        ) : tab === 'orders' ? (
          <TraceGrid key="orders" rows={orders} columns={orderCols} rowKey={o => o.id} onRowClick={o => switchTo(o.contract.ticker, o.contract.expiry >= cursor.day ? o.contract : null)} autoHeight animate={false} widths={{ cancel: 56 }} flexes={{ status: 2, what: 1.4 }} emptyText="No orders yet" testId="review-orders" />
        ) : (
          <TraceGrid key="closed" rows={[...account.trades].reverse()} columns={closedCols} rowKey={t => t.id} autoHeight animate={false} widths={{ qty: 60, how: 150, pnl: 150 }} flexes={{ contract: 1, in: 1.8, out: 1.8 }} emptyText="No closed trades yet" testId="review-closed" />
        )
      }
    />
  );
};

export default Desk;
