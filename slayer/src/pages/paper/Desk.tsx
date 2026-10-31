/* The paper desk of one account (/practice/paper/:accountId): one to four charts on live prices, the account card with
   its rules, the chain with the order inside a strike, and the book of positions, orders and trades. Orders fill at
   each contract's live ThetaData NBBO (data/paper/feed.ts); with the terminal away the desk says so, keeps the last
   quotes on screen with their time, and nothing fills. Options only. On a phone: the chart, then the chain (the order
   is inside a strike), then the book. */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { X } from 'lucide-react';
import type { KeyLevels } from '../../types/gex';
import type { ChartOverlays } from '../../components/gex/StrikeChart';
import { TraceGrid } from '../../components/trace/TraceBox';
import CompanyLogo from '../../components/ui/CompanyLogo';
import ContractLabel from '../../components/ui/ContractLabel';
import type { DropdownOption } from '../../components/ui/DropdownSelect';
import type { Column } from '../../components/ui/DataTable';
import DeskShell, { smallDoor, type DeskName } from '../../components/review/DeskShell';
import OptionsChain, { ChainOrder, type ChainOrderDesk } from '../../components/paper/OptionsChain';
import StrategyBuilder, { type StrategyDesk } from '../../components/paper/StrategyBuilder';
import { Pills } from '../../components/paper/OrderPanel';
import type { ChartBracket, ChartEntry, ChartMark, ChartPosition } from '../../components/review/PositionLayer';
import PnlChips from '../../components/paper/PnlChips';
import { HeldElsewhere } from '../../components/paper/HeldElsewhere';
import ThetaLine from '../../components/review/ThetaLine';
import { AsOf, EmptyBox, LoadingBox } from '../../components/ui/states';
import { feedRev, subscribeFeed } from '../../data/paper/thetaFeed';
import { dirInk, rWords, usd, usdSigned } from '../../components/review/words';
import AccountCard from '../../components/paper/AccountCard';
import TickerPicker from '../../components/paper/TickerPicker';
import { DeskMenu, LayoutDoors } from '../../components/paper/DeskDoors';
import { currentDesk, quickOf, setActivePane, setPaneName, setPaneTimeframe, setQuick, useDesks } from '../../data/paper/desks';
import PositionBar from '../../components/paper/PositionBar';
import type { TradeMark } from '../../components/gex/StrikeChart';
import { chartMenu, planOfMark, positionLines, type Hands } from './deskHands';
import { buildExposureProfile } from '../../data/exposure';
import { peekChange, snapshotOf, useBookRev } from '../../data/uwBook';
import { nameGoesUp } from '../../data/review/engine';
import { contractKey, contractWords, type ContractId, type Right } from '../../data/review/quotes';
import { companyName } from '../../data/tickers';
import type { Timeframe } from '../../data/timeframe';
import { bankedOf, comboRefusal, gapOf, openPreview, optLadderRoom, optLadderTake, optRefusal, viewOf, type ComboDraft, type FutTrade, type MarkedOpt, type OptOrder, type OptTrade } from '../../data/paper/engine';
import { putsSecured, readRules, rulesOf, sellSays } from '../../data/paper/rules';
import { LIFE, PAPER_INDEXES, feedOffline, isPaperIndex, ivOf, liveDeskChain, paperIndex, spotRead, listedNow, spotOf, spotForAskNow, spotForBidNow, stepOf } from '../../data/paper/feed';
import { futWords } from '../../data/paper/products';
import { dayBeginsAt, isVixRoot, nyMomentWords, vixSchedule } from '../../data/paper/clock';
import { nyClock } from '../../core/nyTime';
import { amendOrder, attachOpt, breakevenOrder, cancelOrder, cancelWorking, closeOpt, flattenAccount, liveMarket, placeComboOrder, placeOptOrder, readPaper, rebaseOrder, setInHand, trailOrder, usePaper } from '../../data/paper/store';

/* The chart's settings on this desk. A name's live chart has its book: the walls, the trails, the vol pane. An index's
   has no book of its own, so the overlays that read one are not offered, and no daily candle. */
const NAME_TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '1D'];
const INDEX_TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '30m', '1h'];
const NAME_OVERLAYS: (keyof ChartOverlays)[] = ['volume', 'levels', 'trails', 'session', 'cone', 'volDrift'];
const INDEX_OVERLAYS: (keyof ChartOverlays)[] = ['volume', 'session'];
/** Strikes each side of the chain's centre, the least the chain keeps under the account card, and the column's width */
const CHAIN_EACH = 20;
const CHAIN_MIN_PX = 380;
const SIDE_CHAIN_PX = 560;
/** The account card at the head of the right column: what the column keeps for it above the chain (a plan's rules make
    it taller) */
const ACCOUNT_PX = 264;
const ACCOUNT_RULES_PX = 420;
type Tab = 'open' | 'orders' | 'closed';

/* ---- the desk's own choices, kept for the reader: the name on it and the side of the chain ---- */
const DESK_KEY = 'slayer_paper_desk_v1';
interface DeskPrefs {
  name?: string;
  right?: Right;
}
const readDesk = (): DeskPrefs => {
  try {
    return (JSON.parse(localStorage.getItem(DESK_KEY) ?? 'null') as DeskPrefs | null) ?? {};
  } catch {
    return {};
  }
};
const writeDesk = (patch: DeskPrefs) => {
  try {
    localStorage.setItem(DESK_KEY, JSON.stringify({ ...readDesk(), ...patch }));
  } catch {
    /* a private window: the desk forgets on the next visit */
  }
};

const OPT_ENDED: Record<OptTrade['how'], string> = { sold: 'Sold by you', closed: 'Bought back by you', target: 'Target hit', stopped: 'Stopped out', expired: 'Held to the bell', scaled: 'Scaled out', rule: 'Closed by the rules', page: 'Closed with the page' };
const FUT_ENDED: Record<FutTrade['how'], string> = { closed: 'Closed by you', target: 'Target hit', stopped: 'Stopped out', scaled: 'Scaled out', rule: 'Closed by the rules', page: 'Closed with the page' };

type OpenRow = { key: string; p: MarkedOpt };
type OrderRow = { key: string; o: OptOrder };
type ClosedRow = { key: string; fut: false; t: OptTrade; at: number } | { key: string; fut: true; t: FutTrade; at: number };

const FutLabel = ({ contract, long, symbol }: { contract: string; long: boolean; symbol: string }) => (
  <span className="inline-flex items-center gap-2 font-mono text-t11">
    <CompanyLogo ticker={symbol} size={14} />
    <span className="font-semibold text-textPrimary">{contract}</span>
    <span className={`font-semibold ${long ? 'text-bull' : 'text-bear'}`}>{long ? 'long' : 'short'}</span>
  </span>
);

const titleOf = (ticker: string): string => paperIndex(ticker)?.name ?? companyName(ticker);

/* The walls and flip the chart draws: today's live vendor book, else blank */
function liveLevelsOf(name: string, spot: number): KeyLevels {
  const snap = snapshotOf(name);
  try {
    if (snap) return buildExposureProfile(snap, '0DTE', 30).levels;
  } catch {
    /* a book that cannot be read draws no levels */
  }
  return { spot, callWall: NaN, putWall: NaN, flip: NaN, supreme: NaN };
}

/* The desk re-renders on a two-second beat, and whenever a live book or a contract quote lands */
const BEAT_MS = 2_000;
function useLiveBeat(): number {
  const [n, setN] = useState(0);
  const book = useBookRev();
  const marks = useSyncExternalStore(subscribeFeed, feedRev, feedRev);
  useEffect(() => {
    const id = window.setInterval(() => setN(x => x + 1), BEAT_MS);
    return () => window.clearInterval(id);
  }, []);
  return n * 1_000_000 + book * 1000 + marks;
}

const PaperDesk = () => {
  const { accountId } = useParams<{ accountId: string }>();
  const navigate = useNavigate();
  const { accounts, holding, elsewhere } = usePaper();
  const account = accounts.find(a => a.id === accountId) ?? null;
  /* the account on this desk is the one the journal opens on next */
  useEffect(() => {
    if (account) setInHand(account.id);
  }, [account?.id, holding]); // eslint-disable-line react-hooks/exhaustive-deps
  /* the desk moves with the feed: a render a tick (the live chart's revision, the book's marks, the chain's quotes) */
  const revision = useLiveBeat();
  const [tab, setTab] = useState<Tab>('open');
  const [full, setFull] = useState(false);
  const saved = useMemo(readDesk, []);
  const desks = useDesks();
  const desk = currentDesk(desks);
  const [right, setRightRaw] = useState<Right>(saved.right ?? 'C');
  const [expiry, setExpiry] = useState<string | null>(null);
  const [picked, setPicked] = useState<ContractId | null>(null);
  const [drillOpen, setDrillOpen] = useState(true);
  /** The side column's second card: the chain (an order inside a strike) or the strategy builder */
  const [panel, setPanel] = useState<'chain' | 'build'>('chain');
  const centreRef = useRef<{ key: string; at: number } | null>(null);
  /** A drawn long or short, being placed: whose, and at what size */
  const [markOrder, setMarkOrder] = useState<{ name: string; mark: TradeMark; qty: number } | null>(null);

  /* a plan that trades only some names: a pane on another name shows the plan's first */
  const allowed = account ? (rulesOf(account)?.underlyings ?? null) : null;
  const shownName = (n: string) => (allowed && !allowed.includes(n.toUpperCase()) ? allowed[0] : n);
  const panes = desk.panes.map(p => {
    const n = shownName(p.name);
    /* an index's candles are a minute each: no daily candle */
    return { name: n, timeframe: isPaperIndex(n) && p.timeframe === '1D' ? ('1h' as Timeframe) : p.timeframe };
  });
  const active = Math.min(desk.active, panes.length - 1);
  const name = panes[active].name;
  const setName = (n: string, contract: ContractId | null = null) => {
    if (n !== name) {
      setPaneName(active, n);
      setExpiry(null);
    }
    setPicked(contract);
    if (contract) {
      setRightRaw(contract.right);
      setExpiry(contract.expiry);
      setDrillOpen(true);
    }
  };
  const setRight = (r: Right) => {
    setRightRaw(r);
    writeDesk({ right: r });
  };

  if (!account) {
    return (
      <div className="flex flex-col gap-2.5" data-paper-desk-missing={accountId}>
        {!holding && elsewhere && <HeldElsewhere />}
        <EmptyBox
          title="No such paper account on this browser"
          reason="It may have been deleted, or it was opened on another device — paper accounts are kept in the browser they were made in."
          action={
            <Link to="/practice/paper" className="inline-flex items-center gap-1.5 h-8 px-4 rounded-full text-t12 font-semibold" style={{ background: 'rgb(var(--silver-fill))', color: '#0a0a0a' }} data-paper-back>
              Your accounts
            </Link>
          }
        />
      </div>
    );
  }

  /* The market as it stands, and the account against it */
  const m = liveMarket();
  const v = viewOf(account, m);
  const rules = readRules(account, v, m);
  const lock = !holding ? 'Open in another tab — use them here to trade (the banner above)' : null;

  /* ---- THE NAME: its chain ---- */
  const spot = spotOf(name);
  const expiries = listedNow(name, m.now);
  const exp = expiry && expiries.some(e => e.iso === expiry) ? expiry : ((expiries.find(e => e.dte >= 5) ?? expiries[0])?.iso ?? null);
  const vix = isVixRoot(name);
  const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const expiryOptions: DropdownOption<string>[] = expiries.map(e => ({
    value: e.iso,
    label: `${e.label} · ${e.dte}d`,
    hint: vix ? `Last trades ${shortDate(vixSchedule(e.iso).lastTrade)} at the close · settles on ${shortDate(vixSchedule(e.iso).settleDay)}’s opening print` : e.dte === 0 ? 'Expires at today’s close ET' : `${e.kind === 'monthly' ? 'The monthly' : e.kind === 'daily' ? 'A daily' : 'A weekly'}`,
  }));
  /* the chain is laddered off a price that stays put, and only re-centred once the name has run most of the ladder away */
  const ck = `${name}|${exp}`;
  if (exp) {
    const step = stepOf(name, exp);
    /* a centre is only ever a real price: one taken before the name's price was in (NaN, 0) is taken again once it is */
    if (!centreRef.current || centreRef.current.key !== ck || !(centreRef.current.at > 0) || Math.abs(spot - centreRef.current.at) > step * (CHAIN_EACH - 4)) centreRef.current = { key: ck, at: spot };
  }
  /* The chain as the weigher draws it, on the Live Chart's own quotes (feed.ts liveDeskChain) */
  const chain = exp ? liveDeskChain(name, exp, m.now, CHAIN_EACH, centreRef.current?.at) : null;
  /* the strike whose dropdown is open: the picked contract's, while it is on the chain's side and expiry */
  const openStrike = drillOpen && picked && picked.ticker === name && picked.expiry === exp && picked.right === right ? picked.strike : null;
  const pickStrike = (strike: number, clicks = 1) => {
    if (!exp) return;
    /* one press opens a strike's dropdown and a second on it folds it; a double press only ever opens */
    if (openStrike === strike && clicks === 1) return setDrillOpen(false);
    setPicked({ ticker: name, strike, right, expiry: exp });
    setDrillOpen(true);
  };

  /* What the desk's hands do off a chart (pages/paper/deskHands.tsx): the menu, the bar, a drawn long or short */
  const hands: Hands = {
    account,
    m,
    v,
    q: quickOf(desks),
    lock,
    picked,
    /* the chain's expiry on the name it shows; on another pane's name, the one the chain would open on */
    expiryOf: n => (n === name && exp ? exp : ((listedNow(n, m.now).find(e => e.dte >= 5) ?? listedNow(n, m.now)[0])?.iso ?? null)),
    strikeNear: (n, px) => Math.round(px / stepOf(n, n === name ? exp : null)) * stepOf(n, n === name ? exp : null),
    spotOf,
  };

  /* What is drawn over a chart — a name's positions, its ways out, this page load's fills: once a name, for every
     pane that shows it */
  const built = new Map<string, DeskName>();
  const deskNameOf = (name: string): DeskName => {
    const hit = built.get(name);
    if (hit) return hit;
    const spot = spotOf(name);
    const ivNow = ivOf(name, m.now);
    /* a short says so on its chip; the ladder rides longs only (a short's way out is a buy back) */
    const positions: ChartPosition[] = v.opt.filter(p => p.contract.ticker === name).map(p => ({ key: p.key, contract: p.contract, qty: p.qty, spotIn: p.spotIn, pnl: p.pnl, r: p.r, avg: p.avg, bid: p.quote.bid, dead: p.quote.dead, room: optLadderRoom(account, m, p.contract), take: optLadderTake(account, m, p.contract), ...(p.dir < 0 ? { label: `${contractWords(p.contract).replace(`${name} `, '')} short`, tone: 'bear' as const } : {}) }));
    const brackets: ChartBracket[] = [];
    for (const o of account.opt.orders) {
      if (o.status !== 'working' || o.side !== 'sell' || o.price == null || o.kind === 'market' || o.contract.ticker !== name) continue;
      const pos = v.opt.find(p => p.key === contractKey(o.contract));
      if (!pos) continue;
      /* What it waits on: the contract's price (its line is where the name would have to stand NOW) or the name's
         (the line holds) */
      const onName = o.on === 'name';
      const level = onName ? o.price : spotForBidNow(o.contract, m.now, o.price);
      const sellsAt = onName ? m.optQuoteAt(o.contract, o.price).bid : o.price;
      const here = pos.quote.spot;
      /* further off than the name's expected day (its live at-the-money IV, one sigma) is off the scale; unknown until it lands */
      const reach = ivNow > 0 ? here * (ivNow / Math.sqrt(252)) : Infinity;
      brackets.push({ orderId: o.id, kind: o.kind === 'stop' ? 'stop' : 'target', on: onName ? 'name' : 'contract', contract: o.contract, qty: o.qty, price: o.price, level, money: (sellsAt - pos.avg) * 100 * o.qty, edge: nameGoesUp(o.kind, o.contract.right) ? 'up' : 'down', far: level == null || Math.abs(level - here) > reach, trail: o.kind === 'stop' ? (o.trail ?? null) : undefined, trailNow: o.kind === 'stop' ? Math.max(0.01, onName ? Math.abs(here - o.price) : pos.quote.bid - o.price) : undefined, breakeven: !!o.breakeven, canBreakeven: !!o.oco && account.opt.orders.some(x => x.status === 'working' && x.oco === o.oco && x.kind === 'limit') });
    }
    /* The resting buys, said as such on the chart ("1 · Buy limit · ✕", PositionLayer): where the name would have to
       stand for the contract's ask to come down to it */
    const entries: ChartEntry[] = [];
    const reach = ivNow > 0 ? spot * (ivNow / Math.sqrt(252)) : Infinity;
    for (const o of account.opt.orders) {
      if (o.status !== 'working' || o.side !== 'buy' || o.price == null || o.kind === 'market' || o.contract.ticker !== name) continue;
      const level = spotForAskNow(o.contract, m.now, o.price);
      const c = o.contract;
      entries.push({ orderId: o.id, side: 'buy', kind: o.kind === 'stop' ? 'stop' : 'limit', qty: o.qty, price: o.price, level, label: contractWords(c).replace(`${name} `, ''), edge: (o.kind === 'stop') === (c.right === 'C') ? 'up' : 'down', far: level == null || Math.abs(level - spot) > reach, priceAt: at => Math.max(0.01, Math.round(m.optQuoteAt(c, at).ask * 100) / 100) });
    }
    /* THE LADDER: where a position has more than one level of a kind, each says which it is — the nearest first */
    {
      const groups = new Map<string, ChartBracket[]>();
      for (const b of brackets) groups.set(`${contractKey(b.contract)}|${b.kind}`, [...(groups.get(`${contractKey(b.contract)}|${b.kind}`) ?? []), b]);
      for (const g of groups.values()) if (g.length > 1) [...g].sort((x, y) => Math.abs(x.money) / x.qty - Math.abs(y.money) / y.qty).forEach((b, i) => (b.nth = i + 1));
    }
    /* the fills of THIS page load, as arrows where the chart stood (an earlier load's market is not this one) */
    const marks: ChartMark[] = account.opt.fills.filter(f => f.contract.ticker === name && f.life === LIFE).map(f => ({ time: f.bar, side: f.side, quiet: f.how === 'expired' || f.how === 'rule' || f.how === 'page', text: `${f.how === 'expired' ? 'Expired' : f.side === 'buy' ? (f.opens === false ? 'Bought back' : 'Bought') : f.opens ? 'Sold short' : 'Sold'} ${f.qty} · ${contractWords(f.contract).replace(`${name} `, '')}` }));
    const made: DeskName = {
      symbol: name,
      title: titleOf(name),
      label: name,
      priceWords: !(spot > 0) ? '—' : spot.toFixed(2),
      dayPct: peekChange(name) ?? 0,
      held: positions.length,
      levels: liveLevelsOf(name, spot),
      layer: {
        fills: [],
        marks,
        positions,
        brackets,
        entries,
        marketShut: !holding || account.status !== 'open',
        onClosePosition: c => closeOpt(account.id, c, v.opt.find(p => p.key === contractKey(c))?.qty ?? 0),
        onAmend: (oid, px) => amendOrder(account.id, oid, px),
        onRebase: (oid, to) => rebaseOrder(account.id, oid, to),
        onCancelOrder: oid => cancelOrder(account.id, oid),
        onAttach: (c, kind, px, onWhat) => attachOpt(account.id, c, kind, px, onWhat),
        onTrail: (oid, on, by) => trailOrder(account.id, oid, on, by),
        onBreakeven: (oid, on) => breakevenOrder(account.id, oid, on),
        bidAtSpot: (c, at) => m.optQuoteAt(c, at).bid,
        menu: chartMenu(hands, name),
      },
      onTradeMark: mark => setMarkOrder({ name, mark, qty: quickOf(desks) }),
      /* what the name has banked this trading day (since 17:00 ET), and what is open on it — in plain words */
      corner: <PnlChips name={name} banked={bankedOf(account, name) - bankedOf(account, name, dayBeginsAt(account.day))} open={positions.length ? positions.reduce((x, p) => x + p.pnl, 0) : null} />,
    };
    built.set(name, made);
    return made;
  };
  const deskName = deskNameOf(name);

  /* The cards at the right */
  /* held: the contract itself, or the bought leg of a spread; sold: the other leg of one (open, or on the ticket) */
  const legOf = (p: ContractId) => p.ticker === name && p.expiry === exp && p.right === right;
  const accountCard = (
    <AccountCard
      account={account}
      accounts={accounts}
      view={v}
      rules={rules}
      onPick={id => navigate(`/practice/paper/${id}`)}
      onFlatten={holding ? () => flattenAccount(account.id) : null}
      onCancelAll={holding ? () => cancelWorking(account.id) : null}
    />
  );
  const version = `${account.touchedAt}|${account.opt.fills.length}|${revision}|${holding}|${account.status}`;
  /* The order inside a strike's dropdown (components/paper/OptionsChain): what it asks of the desk */
  const chainDesk: ChainOrderDesk = {
    refuse: d => optRefusalLive(account.id, d),
    locked: lock ?? (account.status !== 'open' ? 'This account is closed' : null),
    /* at the name's price now: the contract's live NBBO, what a press fills at; anywhere else, the what-if */
    quoteWith: (c, at) => (Math.abs(at - spotOf(c.ticker)) < 1e-9 ? m.optQuote(c) : m.optQuoteAt(c, at)),
    spotForBid: (c, bid) => spotForBidNow(c, m.now, bid),
    fee: account.sandbox ? 0 : account.fee,
    free: v.free,
    equity: v.equity,
    version,
    q: quickOf(desks),
    onQ: setQuick,
    heldAt: strike => {
      const p = v.opt.find(x => legOf(x.contract) && x.contract.strike === strike);
      return p ? { contract: p.contract, dir: p.dir, qty: p.qty, avg: p.avg, pnl: p.pnl, decayDay: Math.abs(p.quote.theta) * 100 * p.qty } : null;
    },
    strikes: chain?.rows.map(r => r.strike) ?? [],
    onPlace: d => {
      const held = v.opt.find(p => p.key === contractKey(d.contract));
      const opens = !held || (d.side === 'buy') === (held.dir > 0);
      placeOptOrder(account.id, d);
      setTab(d.kind === 'market' ? (opens ? 'open' : 'closed') : 'orders');
    },
    sell: {
      securedOnly: putsSecured(account),
      preview: d => (d.contract.ticker === name ? openPreview(account, m, [{ contract: d.contract, side: d.side, qty: d.qty, secured: d.secured }]) : null),
    },
    onClose: (c, q) => {
      closeOpt(account.id, c, q);
      setTab('closed');
    },
  };
  const heldStrikes = new Set(v.opt.filter(p => legOf(p.contract)).map(p => p.contract.strike));
  const planRules = rulesOf(account);
  const strategyDesk: StrategyDesk = {
    ticker: name,
    expiry: exp,
    expiryOptions,
    onExpiry: setExpiry,
    strikes: chain?.rows.map(r => r.strike) ?? [],
    spot,
    quote: c => m.optQuote(c),
    q: quickOf(desks),
    onQ: setQuick,
    fee: account.sandbox ? 0 : account.fee,
    locked: chainDesk.locked,
    canSell: !planRules || planRules.allowSell !== 'none',
    sellWords: planRules ? sellSays(planRules) : '',
    securedOnly: putsSecured(account),
    refuse: d => optRefusalLive(account.id, d),
    refuseCombo: d => comboRefusalLive(account.id, d),
    preview: legs => openPreview(account, m, legs),
    onPlace: d => {
      placeOptOrder(account.id, d);
      setTab(d.kind === 'market' ? 'open' : 'orders');
    },
    onPlaceCombo: d => {
      placeComboOrder(account.id, d);
      setTab(d.kind === 'market' ? 'open' : 'orders');
    },
    version,
  };
  const panelSwitch = (
    <div className="flex items-center gap-2 shrink-0" data-paper-side-panel={panel}>
      <Pills label="The chain, or a strategy built from it" value={panel} onChange={setPanel} options={[{ value: 'chain', label: 'Chain' }, { value: 'build', label: 'Strategies' }]} />
      <span className="text-t10 text-textMuted truncate">{panel === 'chain' ? 'an order inside a strike' : 'spreads, condors, cash-secured puts'}</span>
    </div>
  );
  const sideCard = (
    <>
      {accountCard}
      {panelSwitch}
      {vix && exp && (
        <p className="text-t11 leading-snug text-warn" data-paper-vix-note>
          VIX options stop trading Tuesday: the {shortDate(exp)} expiry last trades at {shortDate(vixSchedule(exp).lastTrade)}’s close and settles on {shortDate(vixSchedule(exp).settleDay)}’s VIX opening print.
        </p>
      )}
      {panel === 'build' ? <StrategyBuilder desk={strategyDesk} /> : <OptionsChain
        ticker={name}
        chain={chain}
        right={right}
        onRight={setRight}
        expiry={exp}
        expiryOptions={expiryOptions}
        onExpiry={setExpiry}
        sel={openStrike}
        onSelect={pickStrike}
        held={heldStrikes}
        full={full}
        /* keyed by whether the strike is held: a buy that fills turns the dropdown to the position with a fresh price box */
        empty={
          feedOffline() ? (
            <EmptyBox title="Live data offline — reconnecting" reason="The chain fills with each contract’s live quotes once the feed answers." />
          ) : expiries.length ? (
            <LoadingBox shape="table" rows={12} label="Loading the chain" />
          ) : (
            <LoadingBox shape="table" rows={12} label="Loading the listed expiries" />
          )
        }
        order={c => (exp && chain ? <ChainOrder key={`${name}|${exp}|${c.strike}|${c.right}|${heldStrikes.has(c.strike) ? `held${v.opt.find(p => legOf(p.contract) && p.contract.strike === c.strike)?.dir}` : 'new'}`} c={c} ticker={name} expiry={exp} spot={chain.spot} desk={chainDesk} /> : null)}
      />}
    </>
  );

  /* ---- THE BOOK: positions, orders, trades (the futures closed before options-only stay in the trades) ---- */
  const openRows: OpenRow[] = v.opt.map(p => ({ key: p.key, p }));
  const working = account.opt.orders.filter(o => o.status === 'working').length;
  const orderRows: OrderRow[] = account.opt.orders
    .map(o => ({ key: o.id, o }))
    .sort((x, y) => (x.o.status === 'working' ? 0 : 1) - (y.o.status === 'working' ? 0 : 1) || y.o.placed.at - x.o.placed.at)
    .slice(0, 60);
  const closedRows: ClosedRow[] = [...v.optTrades.map(t => ({ key: t.id, fut: false as const, t, at: t.closed.at })), ...v.futTrades.map(t => ({ key: t.id, fut: true as const, t, at: t.closed.at }))].sort((x, y) => y.at - x.at);
  /* what a short holds of margin: on the first position of its line (a condor's two spreads are one line) */
  const marginCell = (p: MarkedOpt) => {
    const l = p.margin;
    if (!l) return <span className="text-textMuted">{p.dir > 0 ? 'paid' : '—'}</span>;
    if (l.keys[0] !== p.key) return <span className="text-textMuted" title={l.words}>{l.pair ? `${l.pair}, ` : ''}with the {contractWords(v.opt.find(x => x.key === l.keys[0])?.contract ?? p.contract).replace(`${p.contract.ticker} `, '')}</span>;
    return (
      <span className="text-textPrimary" title={l.words} data-margin-line={l.pair ?? l.kind}>
        {l.pair ? <span className="text-t10 text-textMuted">{l.pair} </span> : null}
        {usd(l.held, 0)}
        {l.kind === 'naked' ? <span className="text-t10 text-warn"> est.</span> : null}
      </span>
    );
  };
  const openCols: Column<OpenRow>[] = [
    {
      key: 'contract',
      header: 'Contract',
      render: r => (
        <span className="inline-flex items-center gap-1.5 min-w-0">
          <ContractLabel contract={contractWords(r.p.contract)} right={r.p.contract.right} logo={r.p.contract.ticker} size="sm" />
          {r.p.dir < 0 && <span className="font-mono text-t9 font-bold uppercase tracking-wider text-bear" data-position-short>{r.p.comboName ? r.p.comboName : r.p.contract.short != null ? 'credit spread' : r.p.secured ? 'short · cash-secured' : r.p.margin?.pair ? `short · ${r.p.margin.pair}` : 'short'}</span>}
        </span>
      ),
    },
    { key: 'qty', header: 'Held', align: 'right', render: r => <span className={r.p.dir < 0 ? 'text-bear font-semibold' : 'text-textPrimary'} title={r.p.dir < 0 ? `Short ${r.p.qty}: sold to open` : undefined}>{r.p.dir < 0 ? `−${r.p.qty}` : r.p.qty}</span> },
    { key: 'pnl', header: 'Up or down', align: 'right', render: r => <span className={`font-semibold ${dirInk(r.p.pnl)}`}>{usdSigned(r.p.pnl)} <span className="text-t10 font-normal opacity-80">{rWords(r.p.r)}</span></span> },
    { key: 'margin', header: 'Margin', align: 'right', render: r => marginCell(r.p) },
    { key: 'avg', header: 'In at', align: 'right', render: r => <span className="text-textSecondary" title={r.p.dir < 0 ? 'What it was sold at' : 'What was paid'}>{r.p.dir < 0 ? 'sold ' : ''}{r.p.avg.toFixed(2)}</span> },
    { key: 'now', header: 'Bid · ask', align: 'right', render: r => <span className="text-textPrimary">{`${r.p.quote.bid.toFixed(2)} · ${r.p.quote.ask.toFixed(2)}`}</span> },
    { key: 'carry', header: 'Decay a session', align: 'right', render: r => <span className={r.p.dir < 0 ? 'text-bull' : 'text-textSecondary'} title={r.p.dir < 0 ? 'What its decay pays over one trading session, all else equal — a short gains it' : 'What the contract loses over one trading session, all else equal'}>{r.p.dir < 0 ? '+' : ''}{usd(Math.abs(r.p.quote.theta) * 100 * r.p.qty)}</span> },
    {
      key: 'close',
      header: '',
      align: 'right',
      render: r => (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            closeOpt(account.id, r.p.contract, r.p.qty);
          }}
          disabled={!!lock || r.p.quote.dead}
          title={lock ?? (r.p.quote.dead ? (r.p.dir < 0 ? 'No offer to buy it back from right now' : 'No bid to sell into right now') : r.p.dir < 0 ? 'Buy all of it back at the ask, now' : 'Sell all of it at the bid, now')}
          className={smallDoor}
          data-position-close={r.key}
        >
          {r.p.dir < 0 ? 'Buy back' : 'Close'}
        </button>
      ),
    },
  ];
  const orderWords = (o: OptOrder): string => {
    const how = o.kind === 'market' ? 'market' : o.on === 'name' ? `${o.kind === 'limit' ? 'when' : 'if'} ${o.contract.ticker} ${o.kind === 'limit' ? 'reaches' : nameGoesUp(o.kind, o.contract.right) ? 'rises to' : 'falls to'} ${o.price?.toFixed(2)}` : o.kind === 'limit' ? `limit ${o.price?.toFixed(2)}` : `stop ${o.price?.toFixed(2)}`;
    const verb = o.side === 'buy' ? (o.opens === false ? 'Buy back' : 'Buy') : o.opens ? 'Sell to open' : 'Sell';
    if (o.combo) return `${o.comboName ?? 'Order of several'} · ${verb} ${o.qty}${o.kind === 'market' ? ' · market' : ` · the set at a net ${(o.net ?? 0) >= 0 ? 'credit' : 'debit'} of ${Math.abs(o.net ?? 0).toFixed(2)} or better`}`;
    return `${verb} ${o.qty}${o.secured ? ' cash-secured' : ''} · ${how}${o.oco ? ' · rides the buy' : ''}${o.trail != null ? ` · trails by ${o.trail.toFixed(2)}` : ''}${o.breakeven ? ' · to what you paid after the first target' : ''}${o.moved ? ' · moved to what you paid' : ''}`;
  };
  const orderCols: Column<OrderRow>[] = [
    { key: 'contract', header: 'Contract', render: r => <ContractLabel contract={contractWords(r.o.contract)} right={r.o.contract.right} logo={r.o.contract.ticker} size="sm" /> },
    { key: 'what', header: 'Order', render: r => <span className="text-textPrimary">{orderWords(r.o)}</span> },
    { key: 'placed', header: 'Placed', render: r => <span className="text-textSecondary">{nyMomentWords(r.o.placed.at)}</span> },
    {
      key: 'status',
      header: 'Stands',
      render: r =>
        r.o.status === 'working' ? (
          <span className="text-silver font-semibold">
            {r.o.filled ? (
              <span className="text-textPrimary" title="A fill takes at most the size the quote shows — the rest waits for the next one" data-order-partial={`${r.o.filled}/${r.o.filled + r.o.qty}`}>
                {r.o.filled} of {r.o.filled + r.o.qty} filled · {r.o.qty} left ·{' '}
              </span>
            ) : null}
            Working · {r.o.tif === 'day' ? 'today only' : 'until cancelled'}
            {gapOf(r.o, m.now) != null ? <span className="font-normal text-textMuted"> · the minutes it missed are being checked</span> : null}
            {r.o.unjudged ? (
              <span className="font-normal text-warn" title={r.o.unjudged.why}>
                {' '}
                · {nyClock(r.o.unjudged.from)}–{nyClock(r.o.unjudged.to, { zone: true })} not judged: {r.o.unjudged.why}
              </span>
            ) : null}
          </span>
        ) : r.o.status === 'filled' ? (
          <span className="text-textPrimary">
            {r.o.filled ? `Filled ${r.o.qty} in pieces, the last at` : 'Filled at'} {r.o.fillPrice?.toFixed(2)}
          </span>
        ) : (
          <span className="text-textMuted" title={r.o.why}>
            {r.o.filled ? <span className="text-textSecondary">{r.o.filled} filled, {r.o.qty} not · </span> : null}
            {r.o.status === 'refused' ? 'Refused' : 'Cancelled'} — {r.o.why}
          </span>
        ),
    },
    {
      key: 'cancel',
      header: '',
      align: 'right',
      render: r =>
        r.o.status === 'working' ? (
          <button type="button" onClick={e => { e.stopPropagation(); cancelOrder(account.id, r.o.id); }} disabled={!!lock} title={lock ?? 'Cancel this order'} aria-label="Cancel this order" className="inline-flex items-center justify-center w-6 h-6 rounded text-textMuted hover:text-bear hover:bg-ink/[0.06] disabled:opacity-30 transition-colors align-middle tap-40" data-order-cancel={r.o.id}>
            <X className="w-3 h-3" />
          </button>
        ) : null,
    },
  ];
  const closedCols: Column<ClosedRow>[] = [
    { key: 'contract', header: 'Contract', render: r => (r.fut ? <FutLabel contract={r.t.contract} long={r.t.long} symbol={r.t.symbol} /> : <ContractLabel contract={contractWords(r.t.contract)} right={r.t.contract.right} logo={r.t.contract.ticker} size="sm" />) },
    { key: 'qty', header: 'Size', align: 'right', render: r => (!r.fut && r.t.short ? <span className="text-bear font-semibold" title={`Sold to open${r.t.comboName ? ` (${r.t.comboName.toLowerCase()})` : ''}, bought back`}>−{r.t.qty}</span> : <span className="text-textPrimary">{r.t.qty}</span>) },
    { key: 'in', header: 'In', render: r => <span className="text-textSecondary">{nyMomentWords(r.t.opened.at)} · {r.fut ? futWords(r.t.symbol, r.t.avgIn) : `${r.t.short ? 'sold ' : ''}${r.t.avgIn.toFixed(2)}`}</span> },
    { key: 'out', header: 'Out', render: r => <span className="text-textSecondary">{nyMomentWords(r.t.closed.at)} · {r.fut ? futWords(r.t.symbol, r.t.avgOut) : `${r.t.short ? 'bought ' : ''}${r.t.avgOut.toFixed(2)}`}</span> },
    { key: 'how', header: 'Ended', render: r => <span className="text-textSecondary" title={r.t.note}>{r.fut ? FUT_ENDED[r.t.how] : OPT_ENDED[r.t.how]}</span> },
    { key: 'pnl', header: 'Made or lost', align: 'right', render: r => <span className={`font-semibold ${dirInk(r.t.pnl)}`}>{usdSigned(r.t.pnl)} <span className="text-t10 font-normal opacity-80">{r.t.r != null ? rWords(r.t.r) : 'no stop · no R'}</span></span> },
  ];

  const nameRead = spotRead(name);
  const picker = (
    <span className="inline-flex items-center gap-2 font-mono text-t12 tnum min-w-0" data-paper-picker={name}>
      <TickerPicker value={name} onChange={n => setName(n)} allowed={allowed} indexPrice={s => spotOf(s)} indexes={allowed ? PAPER_INDEXES.filter(x => allowed.includes(x.symbol)) : PAPER_INDEXES} />
      <span className="text-textPrimary">{deskName.priceWords}</span>
      <span className={`text-t11 font-semibold ${deskName.dayPct >= 0 ? 'text-bull' : 'text-bear'}`}>
        {deskName.dayPct >= 0 ? '▲ +' : '▼ '}
        {deskName.dayPct.toFixed(2)}%
      </span>
      {nameRead?.kept && <AsOf at={nameRead.takenAt} />}
    </span>
  );
  const floorRule = rules.find(r => r.id === 'drawdown');

  return (
    <div className="flex flex-col gap-2.5" data-paper-desk={account.id}>
      {!holding && elsewhere && <HeldElsewhere />}
      <ThetaLine since={feedOffline()} at={nameRead?.takenAt} what="Live data offline — reconnecting · nothing fills until it answers" />
      <DeskShell
        session={{ id: account.id, name: account.name }}
        kind="paper"
        /* no strip over the chart: the account is the right column's first card */
        strip={false}
        picker={picker}
        foot="Live quotes (NBBO) — practice, not advice. A sale fills at the bid, a buy at the ask, only on a two-sided quote read in the last few seconds, in the options session (09:30–16:00 ET); positions carry from one visit to the next. Margin on a naked short is a Reg T estimate; a broker’s own can differ."
        revision={revision}
        account={{ equity: v.equity, openPnl: v.openPnl, third: floorRule ? { label: 'above the floor', value: floorRule.room.replace(' above the floor', '') } : { label: 'free', value: usd(v.free, 0) } }}
        names={[deskName]}
        grid={{
          layout: desk.layout,
          panes: panes.map((p, i) => ({ key: `${desk.id}:${i}`, name: deskNameOf(p.name), timeframe: p.timeframe, foot: <PositionBar lines={positionLines(hands, p.name)} /> })),
          active,
          onActive: setActivePane,
          onTimeframe: setPaneTimeframe,
          crosshair: desk.sync.crosshair,
        }}
        doors={({ compact }) => (
          <>
            <LayoutDoors compact={compact} />
            <DeskMenu compact={compact} />
          </>
        )}
        notice={() => (markOrder ? <MarkCard plan={planOfMark(hands, markOrder.name, markOrder.mark, markOrder.qty)} qty={markOrder.qty} onQty={qty => setMarkOrder({ ...markOrder, qty })} onCancel={() => setMarkOrder(null)} /> : null)}
        active={name}
        onSwitch={() => undefined}
        switchLabel="The name on the desk"
        logos
        heldAs="count"
        prefsKey="slayer_paper_chart"
        paneIds={['paper:main', 'paper:second']}
        timeframes={isPaperIndex(name) ? INDEX_TIMEFRAMES : NAME_TIMEFRAMES}
        overlayKeys={isPaperIndex(name) ? INDEX_OVERLAYS : NAME_OVERLAYS}
        full={full}
        onFull={setFull}
        /* the full screen fills the screen, edge to edge */
        fullBleed
        side={sideCard}
        sideMinPx={(rules.length ? ACCOUNT_RULES_PX : ACCOUNT_PX) + 10 + 42 + CHAIN_MIN_PX}
        sideWidth={SIDE_CHAIN_PX}
        panelWord="chain"
        panelTitle="The account and the chain — its orders are inside a strike’s dropdown"
        tab={tab}
        onTab={setTab}
        counts={{ open: openRows.length, working, closed: closedRows.length }}
        book={
          tab === 'open' ? (
            <TraceGrid key="open" rows={openRows} columns={openCols} rowKey={r => r.key} onRowClick={r => setName(r.p.contract.ticker, r.p.contract)} autoHeight animate={false} widths={{ qty: 56, avg: 84, close: 88, now: 108, margin: 96, carry: 96 }} emptyText={account.status === 'open' ? 'Nothing open — buy or sell from a strike in the chain, build a strategy, or trade off the chart' : 'This account is over — nothing more trades on it'} testId="paper-open" />
          ) : tab === 'orders' ? (
            <TraceGrid key="orders" rows={orderRows} columns={orderCols} rowKey={r => r.key} onRowClick={r => setName(r.o.contract.ticker, r.o.contract)} autoHeight animate={false} widths={{ cancel: 56 }} flexes={{ status: 2, what: 1.4 }} emptyText="No orders yet" testId="paper-orders" />
          ) : (
            <TraceGrid key="closed" rows={closedRows} columns={closedCols} rowKey={r => r.key} autoHeight animate={false} widths={{ qty: 70 }} flexes={{ in: 1.4, out: 1.4 }} emptyText="No closed trades yet" testId="paper-closed" />
          )
        }
      />
    </div>
  );
};

/* the refusals, asked against the account as the store holds it now (the ticket asks on every change) */
function optRefusalLive(id: string, d: Parameters<typeof optRefusal>[2]): string | null {
  const a = readPaper().accounts.find(x => x.id === id);
  return a ? optRefusal(a, liveMarket(), d) : 'No account';
}
function comboRefusalLive(id: string, d: ComboDraft): string | null {
  const a = readPaper().accounts.find(x => x.id === id);
  return a ? comboRefusal(a, liveMarket(), d) : 'No account';
}

/** A drawn long or short, being placed: what order it is, what it risks, at what size — placed, or put away */
const MarkCard = ({ plan, qty, onQty, onCancel }: { plan: ReturnType<typeof planOfMark>; qty: number; onQty: (n: number) => void; onCancel: () => void }) => (
  /* under the drawing's own bar (StrikeChart's mark bar sits at the chart's top while the mark is selected) */
  <div className="mt-11 pointer-events-auto w-[min(560px,calc(100%-24px))] rounded-lg border border-borderMuted bg-panel/95 backdrop-blur-md p-3 shadow-[0_14px_40px_rgba(0,0,0,0.45)] animate-soft-in" data-theme="dark" data-paper-mark-card>
    <p className="text-t12 leading-snug text-textPrimary">{plan.words}</p>
    {plan.money && <p className="mt-1 font-mono text-t10 tnum text-textMuted">{plan.money}</p>}
    {plan.refused && <p className="mt-1 text-t11 text-warn">{plan.refused}</p>}
    <div className="mt-2.5 flex items-center gap-2">
      <label className="inline-flex items-center gap-1.5 font-mono text-t10 text-textMuted">
        Contracts
        <input value={qty} onChange={e => onQty(Math.max(1, Math.min(999, Number(e.target.value.replace(/[^0-9]/g, '')) || 1)))} inputMode="numeric" className="h-7 w-14 px-2 rounded-md border border-borderSubtle bg-panel font-mono text-t12 tnum text-textPrimary outline-none focus:border-silver/60" data-paper-mark-qty />
      </label>
      <button
        type="button"
        disabled={!!plan.refused}
        onClick={() => {
          plan.place(qty);
          onCancel();
        }}
        className="ml-auto h-8 px-4 rounded-full text-t12 font-semibold disabled:opacity-35 transition-opacity hover:opacity-90"
        style={{ background: 'rgb(var(--silver-fill))', color: '#0a0a0a' }}
        data-paper-mark-place
      >
        Place it
      </button>
      <button type="button" onClick={onCancel} className="h-8 px-3 rounded-md border border-borderSubtle font-mono text-t10 text-textSecondary hover:text-textPrimary transition-colors">
        Not now
      </button>
    </div>
  </div>
);

export default PaperDesk;
