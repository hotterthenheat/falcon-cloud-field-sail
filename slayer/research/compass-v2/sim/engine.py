"""Event-driven option backtester with realistic execution.

    from sim.engine import Engine, SimConfig, Strategy
    from sim.exits import VolBracket, TimeStop, AnyOf
    eng = Engine(session, MyStrategy(), SimConfig(latency_ms=2000))
    trades = eng.run()            # list of dicts (one per closed position), see Engine._record

Execution model (V2_PROTOCOL rule 2):
  * A strategy decides at the simulated clock `ctx.now`. Its order ARRIVES at now + latency_ms (default 2000).
  * A buy fills at the ask of the NBBO in force at arrival ("the first ask after decision + latency"; fill_rule
    'next_change' waits instead for the first quote change stamped >= arrival). A sell fills at the bid. No mid fills.
  * Size is capped at the displayed size of that quote. An entry's remainder is cancelled unless entry_chase_ms > 0
    (then it keeps lifting each NEW quote's displayed size until the deadline). An exit's remainder keeps hitting
    each new quote's bid until filled (at the last quote of the data it is forced out at the last bid, flagged).
  * Fees: fee_per_contract per contract per side (default $0.65); every trade carries gross and net P&L.
  * Exits are evaluated in event time: at every quote change of a held contract and at every driving event.
    A triggered exit is itself an order: it arrives latency_ms later and sells at the bid then in force.
  * The session flat (flat_ms, default 15:55:00) closes anything still open.

No look-ahead, by construction: a strategy only ever receives a StrategyContext. Every data accessor on it is an
as-of lookup clamped at ctx.now (and raises LookAheadError when asked about a later time); orders carry the decision
time the engine stamps, never a time the strategy supplies. tests/test_engine.py proves it with peeking strategies.
"""
from __future__ import annotations

import heapq
import itertools
import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from data.store import Contract, UND_OF

MS_H = 3_600_000
MS_M = 60_000


def clock(s: str) -> int:
    """'15:55' or '09:30:30.5' -> ms since midnight."""
    p = s.split(':')
    h, m = int(p[0]), int(p[1])
    sec = float(p[2]) if len(p) > 2 else 0.0
    return int(round(h * MS_H + m * MS_M + sec * 1000))


def fmt_ms(ms: int) -> str:
    ms = int(ms)
    return f'{ms // MS_H:02d}:{ms // MS_M % 60:02d}:{ms // 1000 % 60:02d}.{ms % 1000:03d}'


class LookAheadError(Exception):
    pass


@dataclass
class SimConfig:
    latency_ms: int = 2000
    fee_per_contract: float = 0.65
    fill_rule: str = 'in_force'          # 'in_force' | 'next_change'
    cap_to_displayed: bool = True
    entry_chase_ms: int = 0
    start_ms: int = clock('09:30')
    flat_ms: int = clock('15:55')
    end_ms: int = clock('16:00')
    max_entry_spread_frac: float | None = None   # reject at arrival if (ask-bid)/mid is wider
    greeks_delay_ms: int = 0             # a 1-minute greeks row stamped T is visible from T + this
    vectorized_exits: bool = True        # scan quote changes with numpy when every exit component has .scan()
    multiplier: int = 100


@dataclass
class Quote:
    ms: int
    bid: float
    ask: float
    bs: int
    as_: int

    @property
    def mid(self) -> float:
        return (self.bid + self.ask) / 2

    @property
    def spread(self) -> float:
        return self.ask - self.bid

    @property
    def valid(self) -> bool:
        return self.bid > 0 and self.ask > 0 and self.ask >= self.bid


@dataclass
class Event:
    ms: int
    kind: str          # 'timer' | 'trade' | 'und' | 'ext' (external stream) | 'start'
    data: object = None


@dataclass
class Position:
    id: int
    legs: list           # [(Contract, ratio)]
    qty: int             # packages requested
    exit: object
    tag: str
    meta: dict
    decision_ms: int
    filled: int = 0
    entry_cost: float = 0.0     # $ per share, summed over fills (package price x qty)
    entry_fill_ms: int | None = None
    entry_quotes: list = field(default_factory=list)
    open: bool = False
    closing: bool = False
    exit_reason: str | None = None
    exit_decision_ms: int | None = None
    sold: int = 0
    exit_proceeds: float = 0.0
    exit_fill_ms: int | None = None
    forced: bool = False
    peak: float = -1.0
    trough: float = 1e18
    peak_ms: int | None = None
    trough_ms: int | None = None
    value: float = 0.0          # package bid value (per package, $ per share) as of the last update
    state: dict = field(default_factory=dict)   # scratch space for exit policies

    @property
    def entry_px(self) -> float:
        return self.entry_cost / self.filled if self.filled else float('nan')

    @property
    def remaining(self) -> int:
        return self.filled - self.sold


class Strategy:
    """Subclass and override. Class attributes choose what drives on_event."""
    timer_ms: int | None = 1000          # a 'timer' event every N ms from start_ms (None = no timer)
    trade_roots: tuple = ()              # deliver every option print of these roots as 'trade' events
    und_syms: tuple = ()                 # deliver every underlying update of these symbols as 'und' events
    start_at: str | None = None          # first timer at this clock (default: config.start_ms)
    wake_ms: tuple = ()                  # extra 'wake' events at these clock ms (cheap alternative to a timer)

    def on_start(self, ctx):
        pass

    def on_event(self, ctx, ev: Event):
        pass

    def on_fill(self, ctx, pos: Position, kind: str):
        """kind: 'entry' | 'exit' (called when a position is fully opened / closed)."""

    def on_end(self, ctx):
        pass


class _Grid:
    """Per-second as-of series of an underlying: grid[i] = price in force at start_ms + i*1000."""

    def __init__(self, ms, px, start_ms, end_ms):
        self.start = start_ms
        t = start_ms + 1000 * np.arange((end_ms - start_ms) // 1000 + 1)
        idx = np.searchsorted(ms, t, side='right') - 1
        g = np.where(idx >= 0, px[np.clip(idx, 0, None)], np.nan)
        self.px = pd.Series(g).bfill().to_numpy() if np.isnan(g[0]) else g
        # leading NaNs are back-filled only for seconds before the first print (the open), which is at most a
        # second or two; any later NaN cannot occur (as-of carries forward).

    def upto(self, now_ms, window_s):
        i = int((now_ms - self.start) // 1000)
        if i < 0:
            return self.px[:0]
        return self.px[max(0, i - window_s): i + 1]


class StrategyContext:
    """The only object a strategy sees. Every read is as of `now`."""

    def __init__(self, engine: 'Engine'):
        self.__e = engine

    # ---- clock & session
    @property
    def now(self) -> int:
        return self.__e.now

    @property
    def day(self) -> str:
        return self.__e.session.day

    @property
    def config(self) -> SimConfig:
        return self.__e.cfg

    def expirations(self, root) -> list[int]:
        return self.__e.session.expirations(root)

    # ---- quotes
    def quote(self, c: Contract) -> Quote | None:
        return self.__e.quote_asof(c, self.__e.now)

    def quote_at(self, c: Contract, t_ms: int) -> Quote | None:
        if t_ms > self.__e.now:
            raise LookAheadError(f'quote_at({c}, {fmt_ms(t_ms)}) asked at {fmt_ms(self.__e.now)}')
        return self.__e.quote_asof(c, t_ms)

    def quote_history(self, c: Contract, since_ms: int) -> dict:
        q = self.__e.session.quotes(c)
        a = np.searchsorted(q['ms'], since_ms, side='left')
        b = np.searchsorted(q['ms'], self.__e.now, side='right')
        return {k: v[a:b].copy() for k, v in q.items()}

    def contracts(self, root: str, exp_index: int | None = None) -> list[Contract]:
        """The stored universe (contracts whose |delta| was in the store's band at SOME minute of the session).
        Selection must use greeks/quotes as of now (ctx.chain), never membership in this list alone."""
        return self.__e.session.contracts(root, exp_index)

    # ---- greeks (1-minute rows, visible from their stamp + greeks_delay_ms)
    def chain(self, root: str, exp_index: int = 0) -> pd.DataFrame:
        """Latest greeks minute as of now for one expiration: columns contract, delta, iv, und, gms (row stamp)."""
        return self.__e.chain_asof(root, exp_index, self.__e.now)

    def delta(self, c: Contract) -> float:
        ch = self.__e.chain_asof(c.root, None, self.__e.now, exp=c.exp)
        row = ch[ch.contract == c]
        return float(row.delta.iloc[0]) if len(row) else float('nan')

    def pick(self, root: str, exp_index: int, right: int, target_delta: float, band=(0.15, 0.50),
             max_spread_frac: float | None = 0.08, min_size: int = 1) -> Contract | None:
        """The live contract nearest |target_delta| inside band, with a valid quote now, spread <= max_spread_frac of
        mid and displayed ask size >= min_size (V2_PROTOCOL rule 4)."""
        ch = self.chain(root, exp_index)
        if ch.empty:
            return None
        ch = ch[(ch.right == right) & (ch.delta.abs() >= band[0]) & (ch.delta.abs() <= band[1])]
        best, bd = None, 9.0
        for c, d in zip(ch.contract, ch.delta):
            q = self.quote(c)
            if q is None or not q.valid or q.as_ < min_size:
                continue
            if max_spread_frac is not None and q.spread > max_spread_frac * q.mid:
                continue
            if abs(abs(d) - target_delta) < bd:
                best, bd = c, abs(abs(d) - target_delta)
        return best

    # ---- underlying
    def und(self, sym: str) -> float:
        return self.__e.und_asof(sym, self.__e.now)

    def und_series(self, sym: str, window_s: int) -> np.ndarray:
        """Per-second as-of prices over the last window_s seconds (inclusive of now's second)."""
        return self.__e.grid(sym).upto(self.__e.now, window_s).copy()

    def realized_vol(self, sym: str, window_s: int = 900) -> float:
        """Per-second log-return stdev over the last window_s seconds (0 if too short). Annualize x sqrt(23400*252)."""
        p = self.__e.grid(sym).upto(self.__e.now, window_s)
        if len(p) < 30:
            return float('nan')
        r = np.diff(np.log(p))
        return float(np.sqrt(np.mean(r * r)))

    # ---- external events already delivered
    def ext_history(self, kind: str) -> list:
        return [e for e in self.__e.ext_seen if e.kind == kind]

    # ---- orders & positions
    def buy(self, legs, qty: int = 1, exit=None, tag: str = '', meta: dict | None = None) -> int | None:
        """legs: a Contract, or [(Contract, ratio), ...] for a package (e.g. a straddle). Returns a position id."""
        if isinstance(legs, Contract):
            legs = [(legs, 1)]
        return self.__e.submit_entry(list(legs), int(qty), exit, tag, meta or {})

    def close(self, pos_id: int, reason: str = 'strategy') -> None:
        self.__e.submit_exit(self.__e.positions[pos_id], reason)

    @property
    def open_positions(self) -> list[Position]:
        return [p for p in self.__e.positions.values() if p.open and not p.closing]

    @property
    def pending_or_open(self) -> int:
        return sum(1 for p in self.__e.positions.values() if p.exit_fill_ms is None and (p.open or p.filled == 0))

    @property
    def closed_trades(self) -> list[dict]:
        return list(self.__e.log)


class Engine:
    def __init__(self, session, strategy: Strategy, cfg: SimConfig | None = None, ext_events: list | None = None):
        """session: data.store.Session or anything with the same reader methods (sim/synthetic.py).
        ext_events: [(ms_available, kind, payload)] e.g. UW alerts stamped when they were PUBLISHED."""
        self.session = session
        self.strat = strategy
        self.cfg = cfg or SimConfig()
        self.ext = sorted(ext_events or [], key=lambda x: x[0])
        self.now = self.cfg.start_ms
        self.positions: dict[int, Position] = {}
        self.log: list[dict] = []
        self.rejects: list[dict] = []
        self.ext_seen: list[Event] = []
        self._ids = itertools.count(1)
        self._seq = itertools.count()
        self._heap: list = []
        # per-session caches shared by every Engine run on the same session object (pure functions of the data)
        if not hasattr(session, '_v2_cache'):
            session._v2_cache = {'grids': {}, 'gk': {}}
        self._grids = session._v2_cache['grids'] if self.cfg.start_ms == SimConfig.start_ms and \
            self.cfg.end_ms == SimConfig.end_ms else {}
        self._gk = session._v2_cache['gk']
        self.ctx = StrategyContext(self)

    # ------------------------------------------------------------------ data (as-of)
    def quote_asof(self, c: Contract, t: int) -> Quote | None:
        assert t <= self.now, 'engine asked for a quote after now'   # regression guard: never leak
        try:
            q = self.session.quotes(c)
        except KeyError:
            return None
        i = int(np.searchsorted(q['ms'], t, side='right')) - 1
        if i < 0:
            return None
        return Quote(int(q['ms'][i]), q['bid'][i] / 100, q['ask'][i] / 100, int(q['bs'][i]), int(q['as'][i]))

    def _next_change(self, c: Contract, after: int) -> int | None:
        q = self.session.quotes(c)
        i = int(np.searchsorted(q['ms'], after, side='right'))
        return int(q['ms'][i]) if i < len(q['ms']) else None

    def _greeks_index(self, root):
        if root not in self._gk:
            g = self.session.greeks(root)
            if g is None or len(g) == 0:
                self._gk[root] = None
            else:
                g = g.sort_values(['ms', 'exp', 'strike', 'right'], kind='stable').reset_index(drop=True)
                g['contract'] = [Contract(root, int(e), int(k), int(r)) for e, k, r in zip(g.exp, g.strike, g.right)]
                mins = g.ms.to_numpy()
                self._gk[root] = (g, mins)
        return self._gk[root]

    def chain_asof(self, root, exp_index, t, exp=None) -> pd.DataFrame:
        gi = self._greeks_index(root)
        if gi is None:
            return pd.DataFrame(columns=['contract', 'exp', 'strike', 'right', 'delta', 'iv', 'und', 'gms'])
        g, mins = gi
        vis = t - self.cfg.greeks_delay_ms
        b = int(np.searchsorted(mins, vis, side='right'))
        if b == 0:
            return g.iloc[:0].assign(gms=[])
        m = mins[b - 1]
        a = int(np.searchsorted(mins, m, side='left'))
        rows = g.iloc[a:b]
        if exp is None:
            exps = self.session.expirations(root)
            if exp_index is None or exp_index >= len(exps):
                return rows.iloc[:0].assign(gms=[])
            exp = exps[exp_index]
        rows = rows[rows.exp == exp]
        return rows.assign(gms=m)

    def grid(self, sym):
        sym = UND_OF.get(sym, sym)
        if sym not in self._grids:
            u = self.session.underlying(sym)
            self._grids[sym] = _Grid(u['ms'], u['px'], self.cfg.start_ms, self.cfg.end_ms)
        return self._grids[sym]

    def und_asof(self, sym, t) -> float:
        assert t <= self.now
        u = self.session.underlying(UND_OF.get(sym, sym))
        i = int(np.searchsorted(u['ms'], t, side='right')) - 1
        return float(u['px'][i]) if i >= 0 else float('nan')

    # ------------------------------------------------------------------ orders
    def _push(self, t, kind, ref):
        heapq.heappush(self._heap, (int(t), next(self._seq), kind, ref))

    def submit_entry(self, legs, qty, exit_policy, tag, meta):
        pid = next(self._ids)
        p = Position(pid, legs, qty, exit_policy, tag, meta, decision_ms=self.now)
        self.positions[pid] = p
        arrive = self.now + self.cfg.latency_ms
        if self.cfg.fill_rule == 'next_change':
            ts = [self._next_change(c, arrive - 1) for c, _ in legs]
            arrive = max(t for t in ts if t is not None) if any(t is not None for t in ts) else None
        if arrive is None or arrive > self.cfg.flat_ms:
            self._reject(p, 'no quote before flat')
            return pid
        self._push(arrive, 'entry', (pid, arrive + self.cfg.entry_chase_ms))
        return pid

    def submit_exit(self, p: Position, reason: str):
        if p.closing or not p.open:
            return
        p.closing, p.exit_reason, p.exit_decision_ms = True, reason, self.now
        arrive = self.now + self.cfg.latency_ms
        if self.cfg.fill_rule == 'next_change':
            ts = [self._next_change(c, arrive - 1) for c, _ in p.legs]
            ts = [t for t in ts if t is not None]
            arrive = max(ts) if ts else arrive
        self._push(arrive, 'exit', p.id)

    def _reject(self, p, why):
        self.rejects.append({'id': p.id, 'tag': p.tag, 'legs': ' + '.join(f'{r}x {c}' for c, r in p.legs),
                             'decision_ms': p.decision_ms, 'why': why, 'meta': p.meta})
        p.exit_fill_ms = -1

    def _try_entry(self, pid, deadline, t):
        p = self.positions[pid]
        qs = [self.quote_asof(c, t) for c, _ in p.legs]
        if any(q is None or not q.valid for q in qs):
            if p.filled == 0:
                self._reject(p, 'no valid quote at arrival')
            return self._entry_done(p)
        if self.cfg.max_entry_spread_frac is not None and p.filled == 0:
            if any(q.spread > self.cfg.max_entry_spread_frac * q.mid for q in qs):
                self._reject(p, 'spread too wide at arrival')
                return
        want = p.qty - p.filled
        can = want
        if self.cfg.cap_to_displayed:
            can = min([want] + [q.as_ // r for q, (c, r) in zip(qs, p.legs)])
        if can > 0:
            px = sum(q.ask * r for q, (c, r) in zip(qs, p.legs))
            p.entry_cost += px * can
            p.filled += can
            p.entry_fill_ms = t
            p.entry_quotes.append([(q.ms, q.bid, q.ask, q.bs, q.as_) for q in qs])
        if p.filled < p.qty and deadline > t:
            nxt = [self._next_change(c, t) for c, _ in p.legs]
            nxt = [x for x in nxt if x is not None]
            if nxt and min(nxt) <= deadline:
                self._push(min(nxt), 'entry', (pid, deadline))
                return
        if p.filled == 0:
            self._reject(p, 'no displayed size at arrival')
            return
        self._entry_done(p)

    def _entry_done(self, p):
        if p.filled == 0 or p.open:
            return
        p.open = True
        p.value = self._value(p, p.entry_fill_ms)
        p.peak = p.trough = p.value
        p.peak_ms = p.trough_ms = p.entry_fill_ms
        if p.exit is not None and hasattr(p.exit, 'on_entry'):
            p.exit.on_entry(p, self.ctx)
        self.strat.on_fill(self.ctx, p, 'entry')
        self._schedule_watch(p, p.entry_fill_ms)

    def _value(self, p, t) -> float:
        v = 0.0
        for c, r in p.legs:
            q = self.quote_asof(c, t)
            v += (q.bid if q is not None else 0.0) * r
        return v

    def _schedule_watch(self, p, after):
        nxt = [self._next_change(c, after) for c, _ in p.legs]
        nxt = [x for x in nxt if x is not None and x <= self.cfg.end_ms]
        if nxt:
            self._push(min(nxt), 'watch', p.id)

    def _try_exit(self, pid, t, final=False):
        p = self.positions[pid]
        qs = [self.quote_asof(c, t) for c, _ in p.legs]
        want = p.remaining
        can = want
        if self.cfg.cap_to_displayed and not final:
            can = min([want] + [(q.bs // r if q is not None else 0) for q, (c, r) in zip(qs, p.legs)])
        if can > 0:
            px = sum((q.bid if q is not None else 0.0) * r for q, (c, r) in zip(qs, p.legs))
            p.exit_proceeds += px * can
            p.sold += can
            p.exit_fill_ms = t
        if p.remaining > 0:
            nxt = [self._next_change(c, t) for c, _ in p.legs]
            nxt = [x for x in nxt if x is not None]
            if nxt:
                self._push(min(nxt), 'exit', pid)
            else:      # no more data: out at the last bid regardless of size
                p.forced = True
                self._try_exit(pid, t, final=True)
            return
        p.open = False
        self._record(p)
        self.strat.on_fill(self.ctx, p, 'exit')

    def _watch(self, pid, t, bound=None):
        p = self.positions[pid]
        if not p.open:
            return
        pol = p.exit
        if self.cfg.vectorized_exits and bound is not None and (p.closing or pol is None or _scannable(pol)):
            return self._watch_vec(p, t, bound)
        v = self._value(p, t)
        p.value = v
        if v > p.peak:
            p.peak, p.peak_ms = v, t
        if v < p.trough:
            p.trough, p.trough_ms = v, t
        if not p.closing and p.exit is not None:
            why = p.exit.check(p, self.ctx)
            if why:
                self.submit_exit(p, why)
        self._schedule_watch(p, t)

    def _value_path(self, p, t0, t1):
        """Change times of the package's legs in [t0, t1] and the package bid value after each."""
        if len(p.legs) == 1:
            c, r = p.legs[0]
            q = self.session.quotes(c)
            a = int(np.searchsorted(q['ms'], t0, side='left'))
            b = int(np.searchsorted(q['ms'], t1, side='right'))
            return q['ms'][a:b].astype(np.int64), q['bid'][a:b] * (r / 100.0)
        parts = []
        for c, _ in p.legs:
            q = self.session.quotes(c)
            a = int(np.searchsorted(q['ms'], t0, side='left'))
            b = int(np.searchsorted(q['ms'], t1, side='right'))
            parts.append(q['ms'][a:b])
        ms = np.unique(np.concatenate(parts)).astype(np.int64)
        val = np.zeros(len(ms))
        for c, r in p.legs:
            q = self.session.quotes(c)
            i = np.searchsorted(q['ms'], ms, side='right') - 1
            val += np.where(i >= 0, q['bid'][np.clip(i, 0, None)], 0) * (r / 100.0)
        return ms, val

    def _watch_vec(self, p, t, bound):
        """Every quote change of the position in [t, lim] at once (lim = the next other event, the driving event the
        loop is advancing to, or the time a policy's levels must be refreshed through ctx). Identical decisions to
        the change-by-change path (tests/test_engine.py checks it)."""
        lim = bound
        if self._heap:
            lim = min(lim, self._heap[0][0])
        self.now = max(self.now, t)
        active = not p.closing and p.exit is not None
        if active:
            if hasattr(p.exit, 'refresh'):
                p.exit.refresh(p, self.ctx)
            lim = min(lim, p.exit.valid_until(p))
        lim = max(lim, t)
        ms, val = self._value_path(p, t, lim)
        if len(ms) == 0:
            return self._schedule_watch(p, t)
        k, why = (p.exit.scan(p, ms, val) if active else (None, None))
        n = len(ms) if k is None else k + 1
        seg_ms, seg_v = ms[:n], val[:n]
        j = int(np.argmax(seg_v))
        if seg_v[j] > p.peak:
            p.peak, p.peak_ms = float(seg_v[j]), int(seg_ms[j])
        j = int(np.argmin(seg_v))
        if seg_v[j] < p.trough:
            p.trough, p.trough_ms = float(seg_v[j]), int(seg_ms[j])
        p.value = float(seg_v[-1])
        last = int(seg_ms[-1])
        self.now = max(self.now, last)
        if k is not None:
            self.submit_exit(p, why)
        self._schedule_watch(p, last)

    def _record(self, p: Position):
        c = self.cfg
        n_legs = sum(r for _, r in p.legs)
        entry, exitp = p.entry_px, p.exit_proceeds / p.sold
        gross = (exitp - entry) * p.filled * c.multiplier
        fees = c.fee_per_contract * n_legs * p.filled * 2
        cost = entry * p.filled * c.multiplier
        self.log.append({
            'id': p.id, 'session': self.session.day, 'tag': p.tag,
            'legs': ' + '.join(f'{r}x {cc}' if r != 1 else str(cc) for cc, r in p.legs),
            'qty_req': p.qty, 'qty': p.filled,
            'decision_ms': p.decision_ms, 'entry_ms': p.entry_fill_ms, 'entry_px': entry,
            'entry_bid': sum(q[1] for q in p.entry_quotes[0]), 'entry_ask': sum(q[2] for q in p.entry_quotes[0]),
            'entry_ask_size': min(q[4] for q in p.entry_quotes[0]),
            'exit_decision_ms': p.exit_decision_ms, 'exit_ms': p.exit_fill_ms, 'exit_px': exitp,
            'reason': p.exit_reason, 'forced': p.forced,
            'hold_s': (p.exit_fill_ms - p.entry_fill_ms) / 1000,
            'mfe': p.peak / entry - 1 if entry > 0 else float('nan'), 'mfe_ms': p.peak_ms,
            'mae': p.trough / entry - 1 if entry > 0 else float('nan'), 'mae_ms': p.trough_ms,
            'pnl_gross': gross, 'fees': fees, 'pnl_net': gross - fees,
            'ret_gross': exitp / entry - 1 if entry > 0 else float('nan'),
            'ret_net': (gross - fees) / (cost + fees / 2) if cost > 0 else float('nan'),
            'meta': p.meta,
        })

    # ------------------------------------------------------------------ the loop
    def _driving_events(self):
        cfg, s = self.cfg, self.strat
        ms_parts, kinds, refs = [], [], []
        if s.timer_ms:
            t0 = clock(s.start_at) if s.start_at else cfg.start_ms
            t = np.arange(t0, cfg.flat_ms + 1, s.timer_ms, dtype=np.int64)
            ms_parts.append(t); kinds.append(np.full(len(t), 0)); refs.append(np.arange(len(t)))
        if s.wake_ms:
            w = np.array(sorted(s.wake_ms), dtype=np.int64)
            ms_parts.append(w); kinds.append(np.full(len(w), 1)); refs.append(np.arange(len(w)))
        self._trade_frames = {}
        for k, root in enumerate(s.trade_roots):
            tr = self.session.trades(root)
            if tr is None or len(tr) == 0:
                continue
            tr = tr.sort_values('ms', kind='stable').reset_index(drop=True)
            self._trade_frames[root] = tr
            m = tr.ms.to_numpy().astype(np.int64)
            ms_parts.append(m); kinds.append(np.full(len(m), 10 + k)); refs.append(np.arange(len(m)))
        self._und_frames = {}
        for k, sym in enumerate(s.und_syms):
            u = self.session.underlying(sym)
            self._und_frames[sym] = u
            m = u['ms'].astype(np.int64)
            ms_parts.append(m); kinds.append(np.full(len(m), 100 + k)); refs.append(np.arange(len(m)))
        if self.ext:
            m = np.array([e[0] for e in self.ext], dtype=np.int64)
            ms_parts.append(m); kinds.append(np.full(len(m), 1000)); refs.append(np.arange(len(m)))
        if not ms_parts:
            return np.zeros(0, np.int64), np.zeros(0, int), np.zeros(0, int)
        ms = np.concatenate(ms_parts); kd = np.concatenate(kinds); rf = np.concatenate(refs)
        o = np.lexsort((rf, kd, ms))
        ms, kd, rf = ms[o], kd[o], rf[o]
        keep = (ms >= cfg.start_ms) & (ms <= cfg.flat_ms)
        return ms[keep], kd[keep], rf[keep]

    def _make_event(self, t, kd, rf) -> Event:
        if kd == 0:
            return Event(t, 'timer')
        if kd == 1:
            return Event(t, 'wake')
        if 10 <= kd < 100:
            root = self.strat.trade_roots[kd - 10]
            r = self._trade_frames[root].iloc[rf]
            c = Contract(root, int(r.exp), int(r.strike), int(r.right))
            return Event(t, 'trade', {'contract': c, 'px': r.px / 100, 'size': int(r['size']), 'bid': r.bid / 100,
                                      'ask': r.ask / 100, 'cond': int(r.cond), 'exch': int(r.exch)})
        if 100 <= kd < 1000:
            sym = self.strat.und_syms[kd - 100]
            u = self._und_frames[sym]
            return Event(t, 'und', {'sym': sym, 'px': float(u['px'][rf])})
        e = self.ext[rf]
        return Event(t, e[1], e[2])

    def _advance(self, t):
        """Process every internal event stamped <= t, in time order."""
        while self._heap and self._heap[0][0] <= t:
            ts, _, kind, ref = heapq.heappop(self._heap)
            self.now = max(self.now, ts)
            if kind == 'entry':
                pid, deadline = ref
                p = self.positions[pid]
                if p.exit_fill_ms is None and not p.open:
                    self._try_entry(pid, deadline, ts)
            elif kind == 'exit':
                self._try_exit(ref, ts)
            elif kind == 'watch':
                self._watch(ref, ts, t)
            elif kind == 'flat':
                for p in list(self.positions.values()):
                    if p.open and not p.closing:
                        self.submit_exit(p, 'flat')

    def _check_all_exits(self):
        for p in list(self.positions.values()):
            if p.open and not p.closing and p.exit is not None:
                why = p.exit.check(p, self.ctx)
                if why:
                    self.submit_exit(p, why)

    def run(self) -> list[dict]:
        ms, kd, rf = self._driving_events()
        self._push(self.cfg.flat_ms, 'flat', None)
        self.now = self.cfg.start_ms
        self.strat.on_start(self.ctx)
        for t, k, r in zip(ms.tolist(), kd.tolist(), rf.tolist()):
            self._advance(t)
            self.now = t
            ev = self._make_event(t, k, r)
            if ev.kind not in ('timer', 'wake', 'trade', 'und'):
                self.ext_seen.append(ev)
            self.strat.on_event(self.ctx, ev)
            self._check_all_exits()
        self._advance(self.cfg.flat_ms)
        self.now = max(self.now, self.cfg.flat_ms)
        self._advance(10 ** 9)          # drain: pending exits fill on the quotes after the flat
        self.strat.on_end(self.ctx)
        for p in self.positions.values():
            if p.filled == 0 and p.exit_fill_ms is None:
                self._reject(p, 'never filled')
        return self.log


def _scannable(pol) -> bool:
    return hasattr(pol, 'scan') and hasattr(pol, 'valid_until') and (
        not hasattr(pol, 'ps') or all(_scannable(x) for x in pol.ps))


def run_sessions(sessions, make_strategy, cfg: SimConfig | None = None, ext_for=None) -> pd.DataFrame:
    """Run a fresh strategy (make_strategy(session)) on each session; one DataFrame of trades."""
    rows = []
    for s in sessions:
        eng = Engine(s, make_strategy(s), cfg, ext_for(s) if ext_for else None)
        rows += eng.run()
    return pd.DataFrame(rows)
