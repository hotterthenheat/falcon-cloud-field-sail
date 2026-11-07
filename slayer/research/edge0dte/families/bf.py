"""EDGE0DTE Stage-1 family BF: intraday price behaviour (B1-B8), market structure (F1-F6), price-delivery concepts
(F7-F9, REGISTRY_ADDENDUM_2) and the conditioning variables of the conditional tests X1, X2, X5, X6, X12.

One function, `day_events(sess, tmax)`, returns every directional event of the session that is KNOWN by `tmax`
(seconds after midnight ET): it reads only 1-minute bars that closed by tmax (`sess.bars_upto`), auxiliary series
sliced the same way, board snapshots stamped <= the event time (`sess.iv_atm`), and PRIOR sessions' bars. The bulk run
calls it once with tmax = the close; the leakage tests (families/test_bf_leakage.py) prove that every event with time
<= tau is identical when it is called with tmax = tau, and on a session truncated at tau.

Bars and conventions (REGISTRY section F; CALC from OBS 1-minute bars):
  5-minute bar j covers minutes [570 + 5j, 575 + 5j) and is usable at t = 60 * (575 + 5j) (when its last minute has
  closed). Only complete windows (end <= tmax) are built. o = first open, h = max high, l = min low, c = last close.
  Swing high at 5-minute bar i: h_i strictly above h_{i-2}, h_{i-1}, h_{i+1}, h_{i+2} (2 lower highs on each side);
  swing low mirrored. A swing is CONFIRMED at the close of bar i+2 (t = end of bar i+2) and is never used before.
  Swings are detected within the session (adjacent 5-minute bars of the same session).
  Every structural decision at bar k uses swings confirmed by the close of bar k-1 (the structure prevailing when bar k
  opened); a swing confirmed by bar k itself can never be broken by bar k's close, so this loses nothing.
  ATR(14, 5-min) = mean true range of the 14 five-minute bars BEFORE bar k (prior session bars included; true range of
  the first bar of a session = h - l, no overnight gap).
  Spot S = the root's 1-minute close (SPX index for SPXW, the ETF for SPY/QQQ/IWM).
  VWAP (B3): session VWAP of the ETF from 09:30, typical price (h+l+c)/3 x 1-minute ETF volume (OBS volume, CALC).
  For SPXW the SPX index has no volume: the B3 state is SPY's 5-minute close vs SPY's session VWAP (labelled
  "SPY VWAP proxy"); distances are log distances, so the SPXW board's sigma applies unchanged.

Directional event = (row, param, t, dir) with dir = +1 (predicted up) / -1 (predicted down); the registry predicts a
positive sign-aligned Z for every row here. `param` 'P' = the primary parameter; other values = grid G.
"""
import math

import numpy as np
import pandas as pd

from lib import dealer
from lib.cal import close_min, prev_sessions
from lib.config import YEAR_MIN
from lib.data import bars as load_bars, daily_closes
from lib.panel import feature

OPEN = 570

# row -> params: (name, role)
PARAMS = {
    'B1': [('P', 'OR30'), ('G', 'OR15'), ('G', 'OR60')],
    'B2': [('P', 'W30'), ('G', 'W15'), ('G', 'W60')],
    'B3a': [('P', 'N3'), ('G', 'N2'), ('G', 'N4')],
    'B3b': [('P', 'tol0.1'), ('G', 'tol0.05'), ('G', 'tol0.2')],
    'B4': [('P', 'all5'), ('G', '4of5'), ('G', '3of5')],
    'B5': [('P', 'k1.5'), ('G', 'k1.0'), ('G', 'k2.0')],
    'B6': [('P', 'z2'), ('G', 'z1.5'), ('G', 'z2.5')],
    'B7': [('P', 'gap'), ('G', 'nogap')],
    'B8': [('P', 'z2'), ('G', 'z1.5'), ('G', 'z2.5')],
    'F1': [('P', 'sw2'), ('G', 'sw3')],
    'F2': [('P', 'close'), ('G', 'wick')],
    'F3': [('P', 'close'), ('G', 'wick')],
    'F4': [('P', 'm2'), ('G', 'm1.5'), ('G', 'm3')],
    'F5': [('P', 'pdhl+swing'), ('G', 'pdhl')],
    'F6': [('P', 'n3'), ('G', 'n2'), ('G', 'n6')],
    'F7': [('P', 'body1'), ('G', 'wick1'), ('G', 'body2')],
    'F8': [('P', 'g0.25'), ('G', 'g0.1'), ('G', 'g0.5')],
    'F9': [('P', 'close'), ('G', 'wick')],
}
ROLE = {(r, p): role for r, ps in PARAMS.items() for role, p in ps}
PRIMARY = {r: [p for role, p in ps if role == 'P'][0] for r, ps in PARAMS.items()}


# ------------------------------------------------------------------ bars

def _rth(b, day):
    if b is None or not len(b):
        return b
    cm = close_min(day)
    return b[(b.m.values >= OPEN) & (b.m.values < cm)]


def bars5(b1, tmax_min, close_m):
    """5-minute bars from 1-minute bars, only windows whose end minute <= min(tmax_min, close_m).
    Returns dict of arrays: j, o, h, l, c, end (minute), t (seconds), [v]."""
    if b1 is None or not len(b1):
        return None
    m = b1.m.values.astype(int)
    j = (m - OPEN) // 5
    end = OPEN + 5 * j + 5
    end = np.minimum(end, close_m)
    keep = end <= min(tmax_min, close_m)
    if not keep.any():
        return None
    m, j, end = m[keep], j[keep], end[keep]
    o, h, l, c = (b1[x].values[keep].astype(float) for x in ('o', 'h', 'l', 'c'))
    uj, first = np.unique(j, return_index=True)
    last = np.r_[first[1:], len(j)] - 1
    out = {'j': uj, 'o': o[first], 'h': np.maximum.reduceat(h, first), 'l': np.minimum.reduceat(l, first),
           'c': c[last], 'end': end[first]}
    out['t'] = out['end'] * 60
    return out


def swings(B):
    """Confirmed swings: list of (i, level, confirm_index) for highs and lows. confirm_index = i + 2."""
    H, L, J = B['h'], B['l'], B['j']
    n = len(H)
    sh, sl = [], []
    for i in range(2, n - 2):
        if J[i + 2] - J[i - 2] != 4:          # need 5 adjacent windows
            continue
        if H[i] > H[i - 1] and H[i] > H[i - 2] and H[i] > H[i + 1] and H[i] > H[i + 2]:
            sh.append((i, H[i], i + 2))
        if L[i] < L[i - 1] and L[i] < L[i - 2] and L[i] < L[i + 1] and L[i] < L[i + 2]:
            sl.append((i, L[i], i + 2))
    return sh, sl


def _known(sw, k):
    """Swings confirmed by the close of bar k (confirm index <= k)."""
    return [s for s in sw if s[2] <= k]


def _trend(sh, sl, n):
    """F1 structure from the last n confirmed swing highs and lows: +1 HH+HL (strictly rising), -1 LH+LL, else 0."""
    if len(sh) < n or len(sl) < n:
        return 0
    hs = [s[1] for s in sh[-n:]]
    ls = [s[1] for s in sl[-n:]]
    up = all(b > a for a, b in zip(hs, hs[1:])) and all(b > a for a, b in zip(ls, ls[1:]))
    dn = all(b < a for a, b in zip(hs, hs[1:])) and all(b < a for a, b in zip(ls, ls[1:]))
    return 1 if up else (-1 if dn else 0)


def _ema(x, span):
    a = 2.0 / (span + 1)
    out = np.empty(len(x))
    e = x[0]
    for i, v in enumerate(x):
        e = v if i == 0 else a * v + (1 - a) * e
        out[i] = e
    return out


def _frame_closes(day_bars, f):
    """[(end_seconds_key, close)] for frame f minutes over a list of (day, rth bars, close_m, tmax_min) sessions;
    only complete windows (end <= min(tmax_min, close_m)). end key = (session_index, end_min)."""
    keys, cl = [], []
    for si, (day, b, cm, tm) in enumerate(day_bars):
        if b is None or not len(b):
            continue
        m = b.m.values.astype(int)
        w = (m - OPEN) // f
        end = np.minimum(OPEN + f * w + f, cm)
        ok = end <= min(tm, cm)
        if not ok.any():
            continue
        w, end, c = w[ok], end[ok], b.c.values[ok].astype(float)
        uw, first = np.unique(w, return_index=True)
        last = np.r_[first[1:], len(w)] - 1
        for e, cc in zip(end[first], c[last]):
            keys.append((si, int(e)))
            cl.append(cc)
    return keys, np.array(cl, float)


# ------------------------------------------------------------------ helpers on the session

def _iv(sess, t):
    v = sess.iv_atm(t)
    return v if np.isfinite(v) and v > 0 else np.nan


def _sig(iv, minutes):
    return iv * math.sqrt(minutes / YEAR_MIN)


def _prev_day_bars(root, day, n=1):
    out = []
    for d in prev_sessions(day, n):
        b = _rth(load_bars(root, d), d)
        if b is not None and len(b):
            out.append((d, b))
    return out


def _vwap_source(sess, tmax):
    """1-minute bars carrying volume for B3: SPY for SPXW (proxy), the ETF itself otherwise; closed by tmax."""
    if sess.root == 'SPXW':
        a = sess.aux('SPY')
        if a is None or not len(a):
            return None
        a = a[a.m.values + 1 <= tmax // 60]
    else:
        a = sess.bars_upto(tmax)
    a = _rth(a, sess.day)
    if a is None or not len(a) or 'v' not in a.columns:
        return None
    return a


def _spot_at(c1, t):
    """close of the 1-minute bar that closed at t (dict minute -> close)."""
    return c1.get(t // 60 - 1, np.nan)


# ------------------------------------------------------------------ events

def day_events(sess, tmax=None, _leak_swings=False):
    """All BF events known by tmax. Returns a list of dicts (row, param, t, dir, plus extras)."""
    day, root = sess.day, sess.root
    cm = close_min(day)
    tmax = cm * 60 if tmax is None else int(tmax)
    tmin = tmax // 60
    b1 = _rth(sess.bars_upto(tmax), day)
    ev = []
    if b1 is None or not len(b1):
        return ev
    c1 = dict(zip(b1.m.values.astype(int), b1.c.values.astype(float)))
    B = bars5(b1, tmin, cm)
    prev = _prev_day_bars(root, day, 1)
    pd_bars = prev[-1][1] if prev else None

    def add(row, param, t, d, **kw):
        if d == 0 or not np.isfinite(d):
            return
        x = {'row': row, 'param': param, 't': int(t), 'dir': int(np.sign(d))}
        x.update(kw)
        ev.append(x)

    # ---------------- B1 / B2: opening range
    for n_or, pname in ((30, 'OR30'), (15, 'OR15'), (60, 'OR60')):
        orb = b1[(b1.m.values >= OPEN) & (b1.m.values < OPEN + n_or)]
        if B is None or len(orb) < 0.9 * n_or or (OPEN + n_or) > tmin:
            continue
        hi, lo = float(orb.h.max()), float(orb.l.min())
        post = np.flatnonzero(B['end'] > OPEN + n_or)       # 5-min bars after the OR
        # B1: first 5-min close beyond the OR
        for k in post:
            c = B['c'][k]
            if c > hi or c < lo:
                add('B1', pname, B['t'][k], 1 if c > hi else -1, orh=hi, orl=lo)
                break
        # B2 (OR30 only): every fresh break, then a 5-min close back inside within W minutes
        if n_or == 30:
            for k_i, k in enumerate(post):
                c = B['c'][k]
                if not (c > hi or c < lo):
                    continue
                prev_inside = k_i == 0 or (lo <= B['c'][post[k_i - 1]] <= hi)
                if not prev_inside:
                    continue
                d = 1 if c > hi else -1
                for W, wname in ((30, 'W30'), (15, 'W15'), (60, 'W60')):
                    for k2 in post[k_i + 1:]:
                        if B['t'][k2] > B['t'][k] + 60 * W:
                            break
                        c2 = B['c'][k2]
                        if lo <= c2 <= hi:
                            add('B2', wname, B['t'][k2], -d, break_t=int(B['t'][k]))
                            break
                        if (c2 > hi and d < 0) or (c2 < lo and d > 0):   # crossed to the other side: not a return
                            break

    # ---------------- B3: VWAP (ETF volume; SPY proxy for SPXW)
    vs = _vwap_source(sess, tmax)
    if vs is not None and B is not None:
        tp = (vs.h.values + vs.l.values + vs.c.values) / 3.0
        v = vs.v.values.astype(float)
        cv = np.cumsum(tp * v)
        cw = np.cumsum(v)
        vw_by_min = dict(zip(vs.m.values.astype(int), np.where(cw > 0, cv / np.where(cw > 0, cw, 1), np.nan)))
        V5 = bars5(vs, tmin, cm)
        if V5 is not None:
            vw = np.array([vw_by_min.get(e - 1, np.nan) for e in V5['end']])
            side = np.sign(V5['c'] - vw)
            # B3a acceptance: run of N closes on one side started by a cross
            for N, pname in ((3, 'N3'), (2, 'N2'), (4, 'N4')):
                run, rs = 0, 0
                for k in range(len(side)):
                    s = side[k]
                    if not np.isfinite(s) or s == 0:
                        run, rs = 0, 0
                        continue
                    if k > 0 and s == rs and V5['j'][k] - V5['j'][k - 1] == 1:
                        run += 1
                    else:
                        crossed = k > 0 and np.isfinite(side[k - 1]) and side[k - 1] == -s and V5['j'][k] - V5['j'][k - 1] == 1
                        run, rs = (1 if crossed else -10 ** 6), s
                    if run == N:
                        add('B3a', pname, V5['t'][k], s, src='SPY' if root == 'SPXW' else root)
            # B3b rejection: approach from one side, low/high within tol*sigma_30 of VWAP, close back beyond the band
            for k in range(1, len(side)):
                if V5['j'][k] - V5['j'][k - 1] != 1 or not np.isfinite(vw[k]) or not np.isfinite(vw[k - 1]):
                    continue
                t = int(V5['t'][k])
                iv = _iv(sess, t)
                if not np.isfinite(iv):
                    continue
                s30 = _sig(iv, 30)
                for tol, pname in ((0.1, 'tol0.1'), (0.05, 'tol0.05'), (0.2, 'tol0.2')):
                    up, dn = vw[k] * math.exp(tol * s30), vw[k] * math.exp(-tol * s30)
                    if V5['c'][k - 1] > vw[k - 1] and V5['l'][k] <= up and V5['c'][k] > up:
                        add('B3b', pname, t, 1, src='SPY' if root == 'SPXW' else root)
                    elif V5['c'][k - 1] < vw[k - 1] and V5['h'][k] >= dn and V5['c'][k] < dn:
                        add('B3b', pname, t, -1, src='SPY' if root == 'SPXW' else root)

    # ---------------- grid-state rows: B4, B5, B6, B8, F1 at every 5-minute boundary <= tmax
    times = [int(x) for x in (B['t'] if B is not None else [])]
    o930 = float(b1.o.values[0]) if b1.m.values[0] == OPEN else np.nan
    # B4 EMA alignment (1, 5, 15, 30, 60-minute frames, EMAs warmed up on the 10 prior sessions)
    hist = _prev_day_bars(root, day, 10)
    sess_list = [(d, b, close_min(d), close_min(d)) for d, b in hist] + [(day, b1, cm, tmin)]
    frames = {}
    for f in (1, 5, 15, 30, 60):
        keys, cl = _frame_closes(sess_list, f)
        if len(cl) < 30:
            frames = None
            break
        e9, e21 = _ema(cl, 9), _ema(cl, 21)
        today = len(sess_list) - 1
        idx = [i for i, kk in enumerate(keys) if kk[0] == today]
        frames[f] = (np.array([keys[i][1] for i in idx]), cl[idx], e9[idx], e21[idx])
    for t in times:
        if frames:
            nb = nbear = 0
            okf = True
            for f, (ends, cl, e9, e21) in frames.items():
                i = np.searchsorted(ends, t // 60, 'right') - 1
                if i < 0:
                    okf = False
                    break
                if cl[i] > e9[i] > e21[i]:
                    nb += 1
                elif cl[i] < e9[i] < e21[i]:
                    nbear += 1
            if okf:
                for need, pname in ((5, 'all5'), (4, '4of5'), (3, '3of5')):
                    if nb >= need and nbear == 0:
                        add('B4', pname, t, 1, nbull=nb, nbear=nbear)
                    elif nbear >= need and nb == 0:
                        add('B4', pname, t, -1, nbull=nb, nbear=nbear)
        S = _spot_at(c1, t)
        iv = _iv(sess, t)
        if not (np.isfinite(S) and np.isfinite(iv)):
            continue
        # B5 exhaustion
        el = t / 60.0 - OPEN
        S15 = _spot_at(c1, t - 900)
        if np.isfinite(o930) and el > 0 and np.isfinite(S15):
            mv = math.log(S / o930)
            r15 = math.log(S / S15)
            for k_, pname in ((1.5, 'k1.5'), (1.0, 'k1.0'), (2.0, 'k2.0')):
                if abs(mv) > k_ * _sig(iv, el) and r15 * mv < 0:
                    add('B5', pname, t, -np.sign(mv), move_z=mv / _sig(iv, el))
        # B6 acceleration
        S5 = _spot_at(c1, t - 300)
        if np.isfinite(S5) and np.isfinite(S15):
            r5, r15 = math.log(S / S5), math.log(S / S15)
            z5 = r5 / _sig(iv, 5)
            if np.sign(r5) == np.sign(r15) and r5 != 0 and abs(r5) / 5 > abs(r15) / 15:
                for th, pname in ((2.0, 'z2'), (1.5, 'z1.5'), (2.5, 'z2.5')):
                    if abs(z5) > th:
                        add('B6', pname, t, np.sign(r5), z5=z5)
        # B8 one-hour shock (continuous value kept for the IC)
        S60 = _spot_at(c1, t - 3600)
        if np.isfinite(S60):
            z60 = math.log(S / S60) / _sig(iv, 60)
            add('B8c', 'cont', t, 1, z60=z60)        # carrier row for the IC (dir unused)
            for th, pname in ((2.0, 'z2'), (1.5, 'z1.5'), (2.5, 'z2.5')):
                if abs(z60) > th:
                    add('B8', pname, t, -np.sign(z60), z60=z60)

    # ---------------- B7 intraday momentum at close - 30 min (first 30 min + overnight gap)
    t7 = cm * 60 - 1800
    if t7 <= tmax:
        S10 = _spot_at(c1, 36000)
        pc = float(pd_bars.c.values[-1]) if pd_bars is not None and len(pd_bars) else np.nan
        if np.isfinite(S10):
            if np.isfinite(pc):
                r = math.log(S10 / pc)
                add('B7', 'gap', t7, np.sign(r), r=r)
            if np.isfinite(o930):
                r = math.log(S10 / o930)
                add('B7', 'nogap', t7, np.sign(r), r=r)

    if B is None or len(B['c']) < 2:
        return ev

    # ---------------- F rows on 5-minute bars
    sh_all, sl_all = swings(B)
    if _leak_swings:                         # canary for the tests: a swing "known" when it forms (look-ahead)
        sh_all = [(i, x, i) for i, x, _ in sh_all]
        sl_all = [(i, x, i) for i, x, _ in sl_all]
    n5 = len(B['c'])
    H, L, C, O, T, J = B['h'], B['l'], B['c'], B['o'], B['t'], B['j']
    pdh = float(pd_bars.h.max()) if pd_bars is not None and len(pd_bars) else np.nan
    pdl = float(pd_bars.l.min()) if pd_bars is not None and len(pd_bars) else np.nan

    # ATR(14) from prior-session + today's 5-minute bars (true range; first bar of a session = h - l)
    trs = []
    if pd_bars is not None:
        P5 = bars5(pd_bars, close_min(prev[-1][0]), close_min(prev[-1][0]))
        if P5 is not None:
            for k in range(len(P5['c'])):
                trs.append(P5['h'][k] - P5['l'][k] if k == 0 else
                           max(P5['h'][k], P5['c'][k - 1]) - min(P5['l'][k], P5['c'][k - 1]))
    n_prev_tr = len(trs)
    for k in range(n5):
        trs.append(H[k] - L[k] if k == 0 else max(H[k], C[k - 1]) - min(L[k], C[k - 1]))
    trs = np.array(trs)

    def atr_before(k):
        i = n_prev_tr + k
        return float(trs[i - 14:i].mean()) if i >= 14 else np.nan

    # F1 state at every 5-minute close (swings confirmed by that close)
    for k in range(n5):
        sh, sl = _known(sh_all, k), _known(sl_all, k)
        for nsw, pname in ((2, 'sw2'), (3, 'sw3')):
            tr = _trend(sh, sl, nsw)
            if tr:
                add('F1', pname, T[k], tr)

    # F2 / F3 / F7 / F5 sweeps / F6 / F4
    crossed_c, crossed_w = set(), set()        # swing ids whose first close / first wick beyond has happened
    obs = []                                    # order blocks (F7)
    hi_run = H[0]
    lo_run = L[0]
    cand_hi = None                              # F6: (level, extreme, counts per n)
    cand_lo = None
    for k in range(1, n5):
        adj = J[k] - J[k - 1] == 1
        sh, sl = _known(sh_all, k - 1), _known(sl_all, k - 1)
        tr = _trend(sh, sl, 2)
        last_h = sh[-1] if sh else None
        last_l = sl[-1] if sl else None
        # first close / wick beyond the last confirmed swing high / low (since its confirmation)
        brk = {}
        for sw, sgn in ((last_h, 1), (last_l, -1)):
            if sw is None:
                continue
            sid = ('h' if sgn > 0 else 'l', sw[0])
            lev = sw[1]
            for kind, store, val in (('close', crossed_c, C[k]), ('wick', crossed_w, H[k] if sgn > 0 else L[k])):
                if sid in store:
                    continue
                beyond = val > lev if sgn > 0 else val < lev
                if beyond:
                    store.add(sid)
                    brk[(kind, sgn)] = lev
        for kind in ('close', 'wick'):
            for sgn in (1, -1):
                if (kind, sgn) in brk and tr != 0:
                    add('F2' if sgn == tr else 'F3', kind, T[k], sgn, level=brk[(kind, sgn)], trend=tr)
        # F4 displacement
        atr = atr_before(k)
        rng = H[k] - L[k]
        disp = 0
        if np.isfinite(atr) and atr > 0 and rng > 0:
            pos = (C[k] - L[k]) / rng
            dsgn = 1 if pos >= 0.8 else (-1 if pos <= 0.2 else 0)
            for mlt, pname in ((2.0, 'm2'), (1.5, 'm1.5'), (3.0, 'm3')):
                if dsgn and rng > mlt * atr:
                    add('F4', pname, T[k], dsgn, rng_atr=rng / atr)
                    if pname == 'm2':
                        disp = dsgn
        # F7 order block: a displacement (F4 P) whose close is the first close beyond the last confirmed swing in its
        # direction (the F2 break); the block = the last opposite-colour 5-min bar before it
        if disp and ('close', disp) in brk:
            for kb in range(k - 1, -1, -1):
                if (disp > 0 and C[kb] < O[kb]) or (disp < 0 and C[kb] > O[kb]):
                    obs.append({'dir': disp, 'k': k, 'body': (min(O[kb], C[kb]), max(O[kb], C[kb])),
                                'wick': (L[kb], H[kb]), 't0': int(T[k])})
                    break
        # F5 liquidity sweep: wick beyond a level, 5-min close back inside, approached from inside
        if adj:
            hits = {'pdhl+swing': [0, []], 'pdhl': [0, []]}
            for lev, typ in ((pdh, 'pd'), (last_h[1] if last_h else np.nan, 'sw')):
                if np.isfinite(lev) and C[k - 1] < lev < H[k] and C[k] < lev:
                    for p in ('pdhl+swing',) + (('pdhl',) if typ == 'pd' else ()):
                        hits[p][0] |= 1
                        hits[p][1].append(lev)
            for lev, typ in ((pdl, 'pd'), (last_l[1] if last_l else np.nan, 'sw')):
                if np.isfinite(lev) and C[k - 1] > lev > L[k] and C[k] > lev:
                    for p in ('pdhl+swing',) + (('pdhl',) if typ == 'pd' else ()):
                        hits[p][0] |= 2
                        hits[p][1].append(lev)
            for p, (msk, levs) in hits.items():
                if msk == 1:
                    add('F5', p, T[k], -1, levels=levs)
                elif msk == 2:
                    add('F5', p, T[k], 1, levels=levs)
        # F6 failed auction
        if H[k] > hi_run:
            cand_hi = {'level': hi_run, 'x': H[k], 'cnt': 0, 'done': set()}
        elif cand_hi is not None:
            cand_hi['cnt'] = cand_hi['cnt'] + 1 if C[k] < cand_hi['level'] else 0
            for n_, pname in ((3, 'n3'), (2, 'n2'), (6, 'n6')):
                if cand_hi['cnt'] == n_ and pname not in cand_hi['done']:
                    cand_hi['done'].add(pname)
                    add('F6', pname, T[k], -1, level=cand_hi['level'], extreme=cand_hi['x'])
        if L[k] < lo_run:
            cand_lo = {'level': lo_run, 'x': L[k], 'cnt': 0, 'done': set()}
        elif cand_lo is not None:
            cand_lo['cnt'] = cand_lo['cnt'] + 1 if C[k] > cand_lo['level'] else 0
            for n_, pname in ((3, 'n3'), (2, 'n2'), (6, 'n6')):
                if cand_lo['cnt'] == n_ and pname not in cand_lo['done']:
                    cand_lo['done'].add(pname)
                    add('F6', pname, T[k], 1, level=cand_lo['level'], extreme=cand_lo['x'])
        hi_run = max(hi_run, H[k])
        lo_run = min(lo_run, L[k])

    # F7 retests on 1-minute bars after the displacement bar closed
    m1 = b1.m.values.astype(int)
    l1, h1 = b1.l.values.astype(float), b1.h.values.astype(float)
    for ob in obs:
        after = np.flatnonzero(m1 * 60 >= ob['t0'])
        for zone_name, zone, pnames in (('body', ob['body'], ('body1', 'body2')), ('wick', ob['wick'], ('wick1',))):
            lo_z, hi_z = zone
            n_ret, outside = 0, True
            for i in after:
                inside = (l1[i] <= hi_z) if ob['dir'] > 0 else (h1[i] >= lo_z)
                if inside and outside:
                    n_ret += 1
                    te = (m1[i] + 1) * 60
                    if n_ret == 1:
                        add('F7', pnames[0], te, ob['dir'], ob_t=ob['t0'])
                        if zone_name == 'body':
                            add('F7', 'body2', te, ob['dir'], ob_t=ob['t0'], retest=1)
                    elif n_ret == 2 and zone_name == 'body':
                        add('F7', 'body2', te, ob['dir'], ob_t=ob['t0'], retest=2)
                    outside = False
                    if n_ret >= (2 if zone_name == 'body' else 1):
                        break
                elif not inside:
                    outside = True

    # F8 fair value gaps (gap known at the close of bar 3), F9 inverse FVG
    for k in range(2, n5):
        if J[k] - J[k - 2] != 2:
            continue
        t3 = int(T[k])
        iv = _iv(sess, t3)
        if not np.isfinite(iv):
            continue
        s15 = _sig(iv, 15)
        for d, bot, top in ((1, H[k - 2], L[k]), (-1, H[k], L[k - 2])):
            if not top > bot:
                continue
            size = math.log(top / bot) / s15
            after = np.flatnonzero(m1 * 60 >= t3)
            for th, pname in ((0.25, 'g0.25'), (0.1, 'g0.1'), (0.5, 'g0.5')):
                if size < th:
                    continue
                for i in after:
                    if (d > 0 and l1[i] <= top) or (d < 0 and h1[i] >= bot):
                        add('F8', pname, (m1[i] + 1) * 60, d, gap_t=t3, gap_sz=size)
                        break
            if size >= 0.25:
                for kind, pname in (('close', 'close'), ('wick', 'wick')):
                    for k2 in range(k + 1, n5):
                        if d > 0:
                            hit = (C[k2] < bot) if kind == 'close' else (L[k2] < bot)
                        else:
                            hit = (C[k2] > top) if kind == 'close' else (H[k2] > top)
                        if hit:
                            add('F9', pname, T[k2], -d, gap_t=t3)
                            break
    return [e for e in ev if e['t'] <= tmax]


# ------------------------------------------------------------------ conditioning variables (X rows)

def vix_terciles(day, n=252, min_n=40):
    """Point-in-time VIX tercile cut points: 1/3 and 2/3 quantiles of the daily VIX closes of up to the n sessions
    before `day` (OBS VIX, CALC quantiles). None when fewer than min_n prior closes exist."""
    dc = daily_closes('VIX')
    x = dc[dc.index < day].tail(n)
    if len(x) < min_n:
        return None
    return float(x.quantile(1 / 3)), float(x.quantile(2 / 3))


def vix_at(sess, t):
    a = sess.aux('VIX')
    if a is None or not len(a):
        return np.nan
    x = a[a.m.values == t // 60 - 1]
    return float(x.c.iloc[0]) if len(x) else np.nan


def x_conditions(sess, t):
    """MODEL GEX sign / walls (lib.dealer.exposures, same-day OI, REGISTRY convention) and the VIX tercile at t."""
    e = dealer.exposures(sess, t)
    v = vix_at(sess, t)
    cuts = vix_terciles(sess.day)
    terc = np.nan
    if cuts is not None and np.isfinite(v):
        terc = 0.0 if v <= cuts[0] else (2.0 if v > cuts[1] else 1.0)
    return {'gex': e['gex_total'], 'call_wall': e['call_wall'], 'put_wall': e['put_wall'], 'vix': v, 'vix_terc': terc}


# ------------------------------------------------------------------ registered features (leakage-tested)

def _at(sess, t, row):
    out = {p: 0.0 for _, p in PARAMS[row]}
    cache = sess.__dict__.setdefault('_bf_cache', {})      # per-session object: full and truncated never share it
    if t not in cache:
        cache[t] = day_events(sess, t)
    for e in cache[t]:
        if e['row'] == row and e['t'] == t:
            out[e['param']] += e['dir']
    return out


def _reg(row):
    @feature(f'bf_{row}', 'CALC')
    def f(sess, t):
        return _at(sess, t, row)
    f.__name__ = f'bf_{row}'
    return f


for _r in PARAMS:
    _reg(_r)


@feature('bf_xcond', 'MODEL')
def bf_xcond(sess, t):
    return x_conditions(sess, t)
