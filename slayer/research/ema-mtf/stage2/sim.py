"""Fast bar-close simulator for Stage 2/3: the same decisions, exits and fills as engine/execution.Simulator with the
engine/signals.py exit classes (etests/test_stage2.py checks trade-by-trade equality), on per-bar numpy arrays.

A trade enters at its decision bar m0 (arrival quote per latency), then the exit rule is checked at every later
1-minute close m = m0+1 .. 15:55 (bar 384) on the clamped view (the 1-minute NBBO snapshot at m, and the chart bars
known at m's end); the flat at 15:55 closes what is left (intraday only). The sell starts at the exit decision bar's
arrival quote and walks later bars if the bid has no size; no bid to the end -> intrinsic at the underlying close.

Latency: 'L0c' (bar-end NBBO + measured 2 s drift: screening), 'L0', 'L60' (the next bar's snapshot), 'L2' (the
1-second NBBO 2 s after the bar end: edata/fills.FillBook, fetched on demand -- promotion only).
"""
from __future__ import annotations

import numpy as np

from engine.execution import FLAT_M, LAST_ENTRY_M, fee_per_contract, tick

RTH_OPEN_MS = 570 * 60_000
X1_LEVELS = (9, 15, 20, 21, 50, 100, 200)


class Cfg:
    def __init__(self, latency='L0c', slip_ticks=0, fee=None, drift_buy=0.0017, drift_sell=0.0005, max_spread=0.08):
        self.latency, self.slip_ticks, self.fee = latency, slip_ticks, fee
        self.drift_buy, self.drift_sell, self.max_spread = drift_buy, drift_sell, max_spread


class DayGrid:
    """1-minute q0 arrays [contract, m] of one session (dollars); contract rows keyed by ckey."""

    def __init__(self, q, keys):
        from stage1.events import day_grids
        self.keys = np.asarray(keys)
        self.B, self.A, self.BS, self.AS = day_grids(q, self.keys)
        self.pos = {int(k): i for i, k in enumerate(self.keys)}

    def row(self, ck):
        i = self.pos.get(int(ck))
        return None if i is None else (self.B[i], self.A[i], self.BS[i], self.AS[i])


def arrival(cfg: Cfg, g, m: int, D=None, c=None, fills=None):
    """(bid, ask, bid size, ask size) an order sent at the close of bar m meets, or None."""
    B, A, BS, AS = g
    L = cfg.latency
    if L == 'L2':
        return fills.quote_at(D, c, RTH_OPEN_MS + (m + 1) * 60_000 + 2000)
    mm = m + 1 if L == 'L60' else m
    if mm < 0 or mm > 389:
        return None
    b, a = B[mm], A[mm]
    if not (b == b and a == a):
        return None
    if L == 'L0c':
        if not (b > 0 and a >= b):
            return (b, a, BS[mm], AS[mm])
        mid = (b + a) / 2
        return (max(b - cfg.drift_sell * mid, 0.0), a + cfg.drift_buy * mid, BS[mm], AS[mm])
    return (b, a, BS[mm], AS[mm])


def _valid(q, max_spread=None):
    if q is None:
        return False
    b, a = q[0], q[1]
    if not (b > 0 and a >= b):
        return False
    if max_spread is not None and (a - b) / ((a + b) / 2) > max_spread:
        return False
    return True


# ------------------------------------------------------------------------------------------- exit rules
class Ctx:
    """What an exit may read for one (contract, session): bar-end mids, and as-of rows of the chart tables.
    t5: dict of arrays per 1-minute bar m (the trigger-TF bar known at m's end): c, ema*, kms, atr, state.
    t1: c, swing_low as-of (1-minute MID chart).  htf: c, ema9, ema21 as-of of the highest entry timeframe."""

    def __init__(self, mid, t5, t1=None, htf=None):
        self.mid, self.t5, self.t1, self.htf = mid, t5, t1, htf


def exit_rule(name: str, ctx: Ctx, m0: int, entry_px: float, entry_mid: float, unit: int = 0, **kw):
    """Returns (reason, exit decision bar) or (None, None) if nothing fires by 15:55."""
    mid, t5 = ctx.mid, ctx.t5
    k0 = t5['kms'][m0]
    if name == 'X3':
        c, e9, k = t5['c'], t5['ema9'], t5['kms']
        for m in range(m0 + 1, FLAT_M + 1):
            if e9[m] == e9[m] and c[m] < e9[m] and k[m] > k0:
                return 'x3_below9', m
        return None, None
    if name == 'X4':
        e9, e20, k = t5['ema9'], t5['ema20'], t5['kms']
        for m in range(m0 + 1, FLAT_M + 1):
            if k[m] > k0 and e9[m] < e20[m]:
                return 'x4_cross', m
        return None, None
    if name in ('X1', 'X2'):
        lv = [t5[f'ema{n}'][m0] for n in X1_LEVELS]
        lv = [x for x in lv if x == x and k0 >= 0]
        if name == 'X1':
            up, dn = [x for x in lv if x > entry_mid], [x for x in lv if x < entry_mid]
            tp = min(up) if up else entry_mid * 1.5
            sl = max(dn) if dn else entry_mid * 0.7
            for m in range(m0 + 1, FLAT_M + 1):
                x = mid[m]
                if x != x:
                    continue
                if x >= tp:
                    return 'x1_target', m
                if x <= sl:
                    return 'x1_stop', m
            return None, None
        lvs = sorted(set(lv))
        up, dn = [x for x in lvs if x > entry_mid], [x for x in lvs if x < entry_mid]
        levels = (up + [entry_mid * (1.5 + 0.25 * i) for i in range(3)])[:3]
        sl = max(dn) if dn else entry_mid * 0.7
        first_hit = False
        for m in range(m0 + 1, FLAT_M + 1):
            x = mid[m]
            if x != x:
                continue
            if x >= levels[0]:
                first_hit = True
            if x >= levels[unit]:
                return f'x2_target{unit + 1}', m
            stop = entry_mid if first_hit else sl
            if x <= stop:
                return 'x2_stop', m
        return None, None
    if name == 'X5':
        a = t5['atr'][m0]
        sl = entry_mid - 1.5 * (a if a == a else 0.1 * entry_mid)
        t1 = ctx.t1
        sw0 = t1['swing_low'][m0]
        level = None
        for m in range(m0 + 1, FLAT_M + 1):
            if t1['ok'][m]:
                sw = t1['swing_low'][m]
                if sw == sw and not (sw0 == sw0 and sw == sw0):
                    level = sw
                if level is not None and t1['c'][m] < level:
                    return 'x5_structure', m
                x = mid[m]
                if x == x and x <= sl:
                    return 'x5_stop', m
        return None, None
    if name == 'X6':
        h = ctx.htf
        for m in range(m0 + 1, FLAT_M + 1):
            if not h['ok'][m]:
                continue
            if not (h['c'][m] > h['ema9'][m] > h['ema21'][m]):
                return 'x6_htf_loss', m
        return None, None
    if name == 'X7':
        a = t5['atr'][m0]
        a = a if a == a else 0.1 * entry_mid
        sl, tp = entry_mid - 1.5 * a, entry_mid + 3.0 * a
        for m in range(m0 + 1, FLAT_M + 1):
            x = mid[m]
            if x != x:
                continue
            if x >= tp:
                return 'x7_tp', m
            if x <= sl:
                return 'x7_sl', m
        return None, None
    if name == 'X8':
        for m in range(m0 + 1, FLAT_M + 1):
            x = mid[m]
            if x != x:
                continue
            if x >= entry_px * 1.4:
                return 'x8_tp', m
            if x <= entry_px * 0.8:
                return 'x8_sl', m
        return None, None
    if name == 'X9':
        peak = entry_mid
        atr = t5['atr']
        for m in range(m0 + 1, FLAT_M + 1):
            x = mid[m]
            if x != x:
                continue
            peak = max(peak, x)
            a = atr[m]
            a = a if a == a else 0.1 * entry_mid
            if x <= peak - 2.0 * a:
                return 'x9_trail', m
        return None, None
    if name == 'X10':
        a = t5['atr'][m0]
        a = a if a == a else 0.1 * entry_mid
        sl, arm = entry_mid - 1.5 * a, entry_mid + 1.0 * a
        armed = False
        h = ctx.htf
        c, e9, k = t5['c'], t5['ema9'], t5['kms']
        for m in range(m0 + 1, FLAT_M + 1):
            if h is not None and h['ok'][m] and not (h['c'][m] > h['ema9'][m] > h['ema21'][m]):
                return 'x10_htf_loss', m
            x = mid[m]
            if x == x and x >= arm:
                armed = True
            if armed:
                if k[m] > k0 and c[m] < e9[m]:
                    return 'x10_below9', m
                continue
            if x == x and x <= sl:
                return 'x10_stop', m
        return None, None
    if name.startswith('XT'):
        h = int(name[2:])
        return ('time', m0 + h) if m0 + h <= FLAT_M else (None, None)
    raise KeyError(name)


# ------------------------------------------------------------------------------------------- one trade
def simulate(root, D, c, m0, g, ctx: Ctx, exit_name, cfg: Cfg, und_last: float, fills=None, unit=0) -> dict:
    """g: DayGrid.row(contract) arrays; c = (exp, strike, right). Returns a Simulator-compatible record."""
    rec = {'root': root, 'exp': c[0], 'strike': c[1], 'right': c[2], 'session': str(D), 'decision_m': int(m0)}
    if m0 > LAST_ENTRY_M or m0 < -1:
        return {**rec, 'status': 'rejected', 'why': 'entry window'}
    q = arrival(cfg, g, m0, D, c, fills)
    if not _valid(q, cfg.max_spread) or q[3] <= 0:
        return {**rec, 'status': 'rejected', 'why': 'no quote' if q is None else 'invalid quote' if not _valid(q) else
                'no size' if q[3] <= 0 else 'spread'}
    bid0, ask0, _, as0 = q
    px_in = ask0 + cfg.slip_ticks * tick(root, ask0)
    mid_in = (bid0 + ask0) / 2
    fee = fee_per_contract(root) if cfg.fee is None else cfg.fee
    reason, xm = exit_rule(exit_name, ctx, m0, px_in, mid_in, unit=unit)
    if reason is None:
        reason, xm = ('expiry_flat' if int(c[0]) == int(D) else 'flat'), FLAT_M
    B = g[0]
    marks = B[m0 + 1:xm + 1]
    marks = marks[(marks == marks) & (marks > 0)]
    peak = marks.max() if len(marks) else np.nan
    trough = marks.min() if len(marks) else np.nan
    proceeds, mids_out, last, walked, forced = None, None, None, 0, False
    for m in range(xm, FLAT_M + 6):
        qx = arrival(cfg, g, m, D, c, fills)
        if qx is None or not (qx[0] > 0 and qx[1] >= qx[0]):
            walked += 1
            continue
        if mids_out is None:
            mids_out = (qx[0] + qx[1]) / 2
        if qx[2] <= 0:
            walked += 1
            continue
        proceeds = max(qx[0] - cfg.slip_ticks * tick(root, qx[0]), 0.0)
        last = m
        break
    if proceeds is None:
        k = c[1] / 1000
        proceeds = max(0.0, (und_last - k) if c[2] == 1 else (k - und_last)) if und_last == und_last else 0.0
        forced, last = True, FLAT_M
    gross = (proceeds - px_in) * 100
    fees = 2 * fee
    rec.update({'status': 'filled', 'entry_bid': bid0, 'entry_ask': ask0, 'entry_ask_size': as0, 'entry_px': px_in,
                'entry_mid': mid_in, 'entry_spread_frac': (ask0 - bid0) / mid_in, 'exit_reason': reason,
                'exit_decision_m': int(xm), 'exit_m': int(last), 'exit_px': proceeds,
                'exit_mid': mids_out if mids_out is not None else np.nan, 'exit_walk_bars': walked, 'forced_intrinsic': forced,
                'bars_held': int(xm - m0), 'hold_min': int(last - m0), 'pnl_gross': gross, 'fees': fees, 'pnl_net': gross - fees,
                'ret_gross': (proceeds - px_in) / px_in, 'ret_net': (gross - fees) / (px_in * 100 + fee),
                'ret_mid': (mids_out / mid_in - 1) if mids_out is not None and mid_in > 0 else np.nan,
                'mfe_bid': peak / px_in - 1 if peak == peak else np.nan, 'mae_bid': trough / px_in - 1 if trough == trough else np.nan})
    return rec


def simulate_x2(root, D, c, m0, g, ctx, cfg, und_last, fills=None) -> dict:
    """Exit 2: three 1-contract units at successive frozen EMA levels, averaged into one trade record."""
    subs = [simulate(root, D, c, m0, g, ctx, 'X2', cfg, und_last, fills, unit=j) for j in range(3)]
    if subs[0]['status'] != 'filled':
        return subs[0]
    r = dict(subs[0])
    for k in ('pnl_gross', 'fees', 'pnl_net', 'ret_gross', 'ret_net', 'ret_mid', 'exit_px', 'hold_min', 'bars_held'):
        r[k] = float(np.nanmean([s[k] for s in subs]))
    r['exit_reason'] = '+'.join(s['exit_reason'] for s in subs)
    r['exit_decision_m'] = max(s['exit_decision_m'] for s in subs)
    r['exit_m'] = max(s['exit_m'] for s in subs)
    r['forced_intrinsic'] = any(s['forced_intrinsic'] for s in subs)
    return r
