"""Bar-close execution simulator (specs/STRATEGY_SPEC.md section 6): long premium only, decisions at 1-minute bar
closes, fills at the NBBO in force after the latency, never at the mid.

  decision     at the end E of a 1-minute bar (09:31 .. 15:55); the strategy sees only data known at E
  arrival      E + latency.  'L2' (protocol default): the NBBO in force at E+2 s from the contract-day's 1-second
               quotes (edata/fills.py, fetched on demand; Simulator(fills=...));  'L0': the 1-minute snapshot at E
               (optimistic: no latency);  'L60': the snapshot at E+60 s (the next bar end, pessimistic).
               Measured on the 100 ms store (edata/latency_cal.py): L2 costs on average +0.17% of mid on the buy and
               +0.05% on the sell versus L0; screening runs report L0 and L60 as bounds, candidates are re-run at L2.
  buy          the ask in force at arrival (+ slip_ticks ticks), quantity capped at the displayed ask size; the
               remainder is cancelled (a partial fill is recorded); no fill if the quote is one-sided, crossed,
               wider than max_spread_frac of mid, or the size is 0
  sell         the bid in force at arrival (- slip_ticks ticks), capped at the displayed bid size; the remainder
               sells at later bars' arrival bids (walks); a zero/one-sided bid waits for the next bar
  fees         fee_per_contract(root) per contract per side
  flat         every position still open at the 15:55 bar close is sold (decision 15:55:00, arrival 15:55:02) unless
               the spec allows overnight holds; an expiring contract is always sold by 15:55 of its expiration day.
               If no bid exists through the last stored bar, the position is marked at intrinsic value of the
               underlying close (cash settlement for SPXW; exercise value for ETF options) and flagged.
  mid ref      every trade also carries the mid-to-mid return at the same instants (optimistic reference only)
The exit policy is called at every later 1-minute bar close with a clamped view (only data known at that close).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

RTH_OPEN_MS = (9 * 60 + 30) * 60_000
FLAT_M = 384            # bar 15:54-15:55 ends at 15:55:00
LAST_ENTRY_M = 379      # no entry after the 15:50 bar close


def fee_per_contract(root: str) -> float:
    # broker $0.65; SPX/SPXW also carry the Cboe index-option fee (assumed $0.50/contract; sensitivity in reports)
    return 1.15 if root in ('SPXW', 'SPX') else 0.65


def tick(root: str, px: float) -> float:
    if root in ('SPXW', 'SPX'):
        return 0.05 if px < 3 else 0.10
    return 0.01


@dataclass
class ExecConfig:
    latency: str = 'L2'            # 'L2' (exact, needs fills) | 'L0c' (screening) | 'L0' | 'L60'
    drift_buy: float = 0.0017      # L0c: mean ask move in the 2 s after a bar end, share of mid (edata/latency_cal.py)
    drift_sell: float = 0.0005     # L0c: mean bid move against a seller
    slip_ticks: int = 0
    max_spread_frac: float = 0.08
    qty: int = 1
    overnight: bool = False
    fee_scale: float = 1.0
    multiplier: int = 100


@dataclass
class Trade:
    root: str
    exp: int
    strike: int
    right: int
    session: int
    decision_m: int
    tag: str = ''
    meta: dict = field(default_factory=dict)


class QuoteBook:
    """Per (root, session) access to the 1-minute decision grid (q0: the NBBO at each bar end) of contracts, keyed by m."""

    def __init__(self, panel):
        self.p = panel
        self._c: dict = {}

    def _day(self, D: str, which: str) -> dict:
        key = (D, which)
        if key not in self._c:
            df = self.p.q0(D)
            out = {}
            if len(df):
                cols = [df[c].to_numpy() for c in ('exp', 'strike', 'right', 'm', 'bid', 'ask', 'bs', 'as')]
                for e, k, r, m, b, a, bs, as_ in zip(*cols):
                    out.setdefault((int(e), int(k), int(r)), {})[int(m)] = (b / 100, a / 100, int(bs), int(as_))
            if len(self._c) > 3:
                self._c.clear()
            self._c[key] = out
        return self._c[key]

    def grid(self, D: str, which: str, exp: int, strike: int, right: int) -> dict:
        return self._day(D, which).get((exp, strike, right), {})

    def quote(self, D, which, c, m):
        return self.grid(D, which, c[0], c[1], c[2]).get(int(m))


def _valid(q, max_spread=None):
    if q is None:
        return False
    b, a = q[0], q[1]
    if not (b > 0 and a >= b):
        return False
    if max_spread is not None and (a - b) / ((a + b) / 2) > max_spread:
        return False
    return True


class Simulator:
    def __init__(self, panel, cfg: ExecConfig | None = None, sessions: list[str] | None = None, fills=None, book=None):
        """fills: an object with quote_at(D, (exp, strike, right), ms) -> (bid, ask, bid size, ask size) in dollars,
        the NBBO in force at ms (edata/fills.FillBook: 1-second quotes). Required for latency 'L2'."""
        self.p = panel
        self.root = panel.root
        self.cfg = cfg or ExecConfig()
        self.book = book or QuoteBook(panel)
        self.sessions = sessions or panel.days()
        self.fills = fills
        if self.cfg.latency == 'L2' and fills is None:
            raise ValueError("latency 'L2' needs a 1-second fill source (edata/fills.FillBook); use 'L0'/'L60' bounds otherwise")

    def arrival(self, D: str, c, m: int):
        """The quote an order sent at the close of bar m meets, per the latency setting."""
        L = self.cfg.latency
        if L == 'L2':
            return self.fills.quote_at(D, c, RTH_OPEN_MS + (m + 1) * 60_000 + 2000)
        if L == 'L0c':
            # the bar-end NBBO moved by the measured mean 2-second drift (PREREG amendment A1)
            q = self.book.quote(D, 'q0', c, m)
            if q is None or not (q[0] > 0 and q[1] >= q[0]):
                return q
            mid = (q[0] + q[1]) / 2
            return (max(q[0] - self.cfg.drift_sell * mid, 0.0), q[1] + self.cfg.drift_buy * mid, q[2], q[3])
        if L == 'L0':
            return self.book.quote(D, 'q0', c, m)
        if L == 'L60':
            return self.book.quote(D, 'q0', c, m + 1)
        raise ValueError(L)

    def mark(self, D, c, m):
        return self.book.quote(D, 'q0', c, m)

    def run(self, t: Trade, exit_policy, und_close=None) -> dict:
        """Enter at t's decision bar, then call exit_policy.check(view) at every later bar close until it returns a
        reason (or flat/expiry/data end). exit_policy gets a dict view: session, m, now_ms, bid/ask/mid at the close,
        entry fields, and the bars elapsed. und_close(D) -> underlying close for intrinsic marking."""
        cfg = self.cfg
        c = (t.exp, t.strike, t.right)
        D = str(t.session)
        rec = {'root': t.root, 'exp': t.exp, 'strike': t.strike, 'right': t.right, 'session': D, 'decision_m': t.decision_m,
               'tag': t.tag, **{f'meta_{k}': v for k, v in t.meta.items()}}
        if t.decision_m > LAST_ENTRY_M or t.decision_m < -1:
            return {**rec, 'status': 'rejected', 'why': 'entry window'}
        q = self.arrival(D, c, t.decision_m)
        if not _valid(q, cfg.max_spread_frac) or q[3] <= 0:
            why = 'no quote' if q is None else 'invalid quote' if not _valid(q) else 'no size' if q[3] <= 0 else 'spread'
            return {**rec, 'status': 'rejected', 'why': why, 'entry_bid': q[0] if q else np.nan, 'entry_ask': q[1] if q else np.nan}
        bid0, ask0, bs0, as0 = q
        qty = min(cfg.qty, as0)
        px_in = ask0 + cfg.slip_ticks * tick(t.root, ask0)
        mid_in = (bid0 + ask0) / 2
        fee = fee_per_contract(t.root) * cfg.fee_scale
        rec.update({'status': 'filled', 'qty_req': cfg.qty, 'qty': qty, 'partial_entry': qty < cfg.qty, 'entry_bid': bid0,
                    'entry_ask': ask0, 'entry_ask_size': as0, 'entry_px': px_in, 'entry_mid': mid_in,
                    'entry_spread_frac': (ask0 - bid0) / mid_in})
        # walk forward bar by bar
        days = [d for d in self.sessions if d >= D]
        if not cfg.overnight or t.exp == int(D):
            days = days[:1]
        days = [d for d in days if int(d) <= t.exp]
        exit_policy.start({'entry_px': px_in, 'entry_mid': mid_in, 'session': int(D), 'm': t.decision_m, 'trade': t})
        peak, trough, peak_m, trough_m = -np.inf, np.inf, None, None
        reason, xD, xm = None, None, None
        nbar = 0
        for d in days:
            m_from = t.decision_m + 1 if d == D else 0
            for m in range(max(m_from, 0), FLAT_M + 1):
                mk = self.mark(d, c, m)
                if mk is not None and mk[0] > 0:
                    if mk[0] > peak:
                        peak, peak_m = mk[0], (d, m)
                    if mk[0] < trough:
                        trough, trough_m = mk[0], (d, m)
                nbar += 1
                view = {'session': int(d), 'm': m, 'now_ms': RTH_OPEN_MS + (m + 1) * 60_000, 'bid': mk[0] if mk else np.nan,
                        'ask': mk[1] if mk else np.nan, 'mid': (mk[0] + mk[1]) / 2 if _valid(mk) else np.nan, 'bars': nbar,
                        'entry_px': px_in, 'entry_mid': mid_in}
                r = exit_policy.check(view)
                if r:
                    reason, xD, xm = r, d, m
                    break
                if m == FLAT_M and (d == days[-1] or not cfg.overnight):
                    reason, xD, xm = ('expiry_flat' if int(d) == t.exp else 'flat'), d, m
                    break
            if reason:
                break
        if reason is None:
            reason, xD, xm = 'data_end', days[-1], FLAT_M
        # sell: arrival bid, walking later bars for any remainder
        left, proceeds, last_fill, walked = qty, 0.0, None, 0
        mids_out = None
        dd = [d for d in days if d >= xD]
        for d in dd:
            for m in range(xm if d == xD else 0, FLAT_M + 6):
                qx = self.arrival(d, c, m)
                if qx is None or not (qx[0] > 0 and qx[1] >= qx[0]):
                    walked += 1
                    continue
                if mids_out is None:
                    mids_out = (qx[0] + qx[1]) / 2
                n = min(left, max(qx[2], 0))
                if n <= 0:
                    walked += 1
                    continue
                px = max(qx[0] - cfg.slip_ticks * tick(t.root, qx[0]), 0.0)
                proceeds += n * px
                left -= n
                last_fill = (d, m)
                if left == 0:
                    break
                walked += 1
            if left == 0:
                break
        forced_intrinsic = False
        if left > 0:
            # no bid until the data ends: intrinsic at the underlying close of the last session (flagged)
            S = und_close(dd[-1]) if und_close else np.nan
            k = t.strike / 1000
            intr = max(0.0, (S - k) if t.right == 1 else (k - S)) if S == S else 0.0
            proceeds += left * intr
            forced_intrinsic = True
            last_fill = (dd[-1], FLAT_M)
        px_out = proceeds / qty
        mult = cfg.multiplier
        gross = (px_out - px_in) * qty * mult
        fees = 2 * fee * qty
        rec.update({'exit_reason': reason, 'exit_decision_session': xD, 'exit_decision_m': xm, 'exit_session': last_fill[0],
                    'exit_m': last_fill[1], 'exit_px': px_out, 'exit_mid': mids_out if mids_out is not None else np.nan,
                    'exit_walk_bars': walked, 'forced_intrinsic': forced_intrinsic, 'bars_held': nbar,
                    'pnl_gross': gross, 'fees': fees, 'pnl_net': gross - fees,
                    # net return on the cash spent (premium + entry fee), as compass-v2 sim/engine.py
                    'ret_gross': (px_out - px_in) / px_in, 'ret_net': (gross - fees) / (px_in * qty * mult + fees / 2),
                    'ret_mid': ((mids_out / mid_in - 1) if mids_out is not None and mid_in > 0 else np.nan),
                    'mfe_bid': (peak / px_in - 1) if np.isfinite(peak) else np.nan,
                    'mae_bid': (trough / px_in - 1) if np.isfinite(trough) else np.nan})
        return rec


class HoldUntil:
    """Exit policy: sell at a fixed (session, m) decision -- used by the buy-and-hold baseline and tests."""

    def __init__(self, session: int, m: int):
        self.s, self.m = int(session), int(m)

    def start(self, info):
        pass

    def check(self, v):
        return 'hold_end' if (v['session'], v['m']) >= (self.s, self.m) else None


def trades_frame(recs) -> pd.DataFrame:
    df = pd.DataFrame(recs)
    if len(df) and 'status' in df:
        return df
    return df
