"""NOV5-BROAD execution: contract picks, 1-second paths, single-leg and package (debit spread, straddle) simulation.

Single legs reuse nov5-tape/devsim.py verbatim (EDGE-G conventions: pick on the board stamped (t-60)//60, |delta|
nearest the target within +-0.08, spread <= 8% of mid, ask <= 0.6 S sigma sqrt(T); entry = ask of the first 1-second
quote >= t + 2 s with bid > 0, ask > bid, ask size >= 1 (within 60 s); exits on sane quotes only (bid > 0, spread <=
25% of mid); an exit decided at second s fills at the bid in force at s + 2; flat 15:50; $0.65 per contract per side).

Packages (PREREG.md, secondary expression): the package's quote = sum of the legs' sellable / buyable sides
(debit spread: bid = bid_long - ask_short, ask = ask_long - bid_short; straddle: bid = bid_C + bid_P, ask = ask_C +
ask_P), its displayed size = the smaller leg size, so a package fill is an all-legs fill at the same second; fees
$0.65 per contract per side on every leg. The same exits run on the package quote, with the package delta.
"""
import math, os, sys
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fetch_broad  # noqa: E402,F401  (sets the shared terminal client's data dir / disk floor)
sys.path.insert(0, os.path.join(HERE, '..', 'nov5-tape'))
import devsim as DS  # noqa: E402
import bload as B  # noqa: E402
import sim as esim  # noqa: E402  (EDGE solver, imported by devsim)

DS.QDIR = os.path.join(B.OUT, 'q1s_dev')
YEAR_MIN = 390.0 * 252
FEE = 0.65
_orig_candidates = DS._candidates


def _candidates(root, day, exp, k, R):
    out = _orig_candidates(root, day, exp, k, R)
    ks = DS._ks(k)
    import glob
    for f in glob.glob(os.path.join(B.DATA, 'nov5-tape', 'q1s_dev', root, day, f'{exp}_{ks}{R}_*_*.npz')):
        a, b = os.path.basename(f)[:-4].split('_')[-2:]
        out.append((f, int(a), int(b), 'nov5'))
    return out


DS._candidates = _candidates


# ---------------------------------------------------------------- picks


def pick(board, bars, day_iso, t, call, target, x=0):
    return DS.pick_on_board(board, bars, day_iso, t, call, target, extra_sessions=x)


def pick_short(board, bars, t, long_pk, x=0, max_spr=0.25):
    """The debit spread's short leg: same side, strike further OTM than the long leg, |delta| nearest half the long
    leg's |delta| (within +-0.08), bid > 0, spread <= 25% of mid, on the same board stamp."""
    m = (t - 60) // 60
    b = board[(board.m == m) & (board.bid > 0) & (board.ask > board.bid)]
    xq = bars[bars.m <= m - 1]
    if not len(b) or not len(xq):
        return None
    S = float(xq.c.iloc[-1])
    T = max((960 - m) + 390.0 * x, 5) / YEAR_MIN
    call = long_pk['call']
    b = b[(b.r == (1 if call else 0)) & ((b.k > long_pk['k']) if call else (b.k < long_pk['k']))]
    if not len(b):
        return None
    K = b.k.values.astype(float)
    bid, ask = b.bid.values.astype(float), b.ask.values.astype(float)
    mid = (bid + ask) / 2
    iv = esim.implied_vol(mid, S, K, T, np.full(len(K), call))
    dl = np.abs(esim.bs_delta(S, K, T, np.where(np.isfinite(iv), iv, long_pk['iv']), call))
    tgt = long_pk['delta'] / 2
    ok = ((ask - bid) / mid <= max_spr) & (np.abs(dl - tgt) <= 0.08)
    if not ok.any():
        return None
    i = np.flatnonzero(ok)[np.argmin(np.abs(dl[ok] - tgt))]
    return {'k': float(K[i]), 'call': call, 'delta': float(dl[i]), 'bid0': float(bid[i]), 'ask0': float(ask[i])}


def pick_atm_pair(board, bars, t, x=0):
    """R3's straddle: the strike nearest S (close of the bar before the stamp) quoted on both sides at the stamp."""
    m = (t - 60) // 60
    b = board[(board.m == m) & (board.bid > 0) & (board.ask > board.bid)]
    xq = bars[bars.m <= m - 1]
    if not len(b) or not len(xq):
        return None
    S = float(xq.c.iloc[-1])
    both = b.groupby('k').r.nunique()
    ks = both[both == 2].index.values.astype(float)
    if not len(ks):
        return None
    k = float(ks[np.argmin(np.abs(ks - S))])
    T = max((960 - m) + 390.0 * x, 5) / YEAR_MIN
    out = {}
    for r in (1, 0):
        a = b[(b.k == k) & (b.r == r)].iloc[0]
        mid = (a.bid + a.ask) / 2
        iv = float(esim.implied_vol(np.array([mid]), S, np.array([k]), T, np.array([r == 1]))[0])
        out['C' if r else 'P'] = {'k': k, 'call': r == 1, 'iv': iv, 'bid0': float(a.bid), 'ask0': float(a.ask),
                                  'delta': float(abs(esim.bs_delta(S, k, T, iv if np.isfinite(iv) else 0.2, r == 1)))}
    return out


# ---------------------------------------------------------------- paths


def study_path(D, root, exp, k, call, start, end):
    """Whole-day 1-second files of a study / out-of-sample day (stale seconds blanked), else None."""
    q = B.q1s(D, root, k, 1 if call else 0, exp)
    if q is None:
        return None
    s = q['s'].astype(np.int64)
    grid = np.arange(start, end + 1)
    j = np.searchsorted(s, grid, side='right') - 1
    okj = j >= 0
    jj = np.maximum(j, 0)
    out = {'s0': start, 'src': 'day1s'}
    for name in ('bid', 'ask', 'bs', 'as'):
        out[name] = np.where(okj, q[name][jj], 0.0).astype(np.float64)
    f = os.path.join(B.rdir(D, root), 'stale.npz')
    if os.path.exists(f):
        z = np.load(f)
        key = f'{k:g}{"C" if call else "P"}'
        if key in z.files:
            st = z[key].astype(np.int64)
            st = st[(st >= start) & (st <= end)] - start
            out['bid'][st] = 0.0          # stale: never a fill, never a sane exit quote
            out['ask'][st] = 0.0
    return out


def get_path(root, day_iso, exp_iso, k, call, start, end, study_D=None):
    if study_D is not None:
        p = study_path(study_D, root, exp_iso.replace('-', ''), k, call, start, end)
        if p is not None:
            return p
    return DS.path(root, day_iso, exp_iso, k, call, start, end)


def combine(paths, signs):
    """Package quote from legs: signs +1 long, -1 short."""
    n = min(len(p['bid']) for p in paths)
    bid = np.zeros(n); ask = np.zeros(n); bs = np.full(n, np.inf); as_ = np.full(n, np.inf); ok = np.ones(n, bool)
    for p, sg in zip(paths, signs):
        pb, pa = p['bid'][:n], p['ask'][:n]
        # a leg is quoted when its ask is > 0 and not below its bid (a 0 bid = worthless, still a valid quote)
        ok &= (pa > 0) & (pa >= pb)
        if sg > 0:
            bid += pb; ask += pa; bs = np.minimum(bs, np.where(pb > 0, p['bs'][:n], np.inf)); as_ = np.minimum(as_, p['as'][:n])
        else:
            bid -= pa; ask -= pb; bs = np.minimum(bs, p['as'][:n]); as_ = np.minimum(as_, np.where(pb > 0, p['bs'][:n], 0))
    bid = np.where(ok, np.maximum(bid, 0.0), 0.0)   # selling value floored at 0 (abandon the package)
    ask = np.where(ok, ask, 0.0)
    return {'s0': paths[0]['s0'], 'src': '+'.join(p['src'] for p in paths), 'bid': bid, 'ask': ask,
            'bs': np.where(np.isfinite(bs), bs, 0), 'as': np.where(np.isfinite(as_), as_, 0)}


def refee(r, legs):
    """devsim books one leg's fees; a package pays $0.65 per side on every leg."""
    if 'fill' not in r:
        return r
    extra = (legs - 1) * FEE
    pnl = r['pnl_net'] - 2 * extra
    cost = r['cost'] + extra
    return {**r, 'pnl_net': pnl, 'cost': cost, 'ret_net': pnl / cost}


# ---------------------------------------------------------------- the straddle exit (R3, PREREG XP)


def simulate_xp(p, t, legs):
    s0, n = p['s0'], len(p['bid'])
    idx = lambda sec: min(max(sec - s0, 0), n - 1)  # noqa: E731
    lo, hi = idx(t + DS.LAT), idx(t + DS.LAT + 60)
    okq = (p['bid'][lo:hi + 1] > 0) & (p['ask'][lo:hi + 1] > p['bid'][lo:hi + 1]) & (p['as'][lo:hi + 1] >= 1)
    if not okq.any():
        return {'skip': 'no entry quote'}
    ie = lo + int(np.argmax(okq))
    fill = float(p['ask'][ie])
    bid, ask = p['bid'], p['ask']
    mid = (bid + ask) / 2
    sane = (bid > 0) & (ask > bid) & ((ask - bid) <= DS.SANE * np.where(mid > 0, mid, np.inf))
    dsec, kind = DS.FLAT_S, 'flat'
    peak, armed = fill, False
    for i in range(ie + 1, idx(DS.FLAT_S) + 1):
        if not sane[i]:
            continue
        b = bid[i]
        if b <= 0.6 * fill:
            dsec, kind = s0 + i, 'stop'
            break
        peak = max(peak, b)
        if b >= 1.5 * fill:
            armed = True
        if armed and b <= 0.75 * peak:
            dsec, kind = s0 + i, 'trail'
            break
    xi = idx(dsec + DS.LAT)
    px = float(bid[xi])
    pnl = 100 * (px - fill) - 2 * FEE * legs
    cost = 100 * fill + FEE * legs
    sb = bid[ie:xi + 1]
    return {'fill': fill, 'entry_s': int(s0 + ie), 'exit': px, 'exit_s': int(s0 + xi), 'reason': kind,
            'ret_gross': px / fill - 1, 'ret_net': pnl / cost, 'pnl_net': pnl, 'cost': cost,
            'hold_s': int(xi - ie), 'mfe': float(sb.max() / fill - 1), 'mae': float(sb.min() / fill - 1), 'src': p['src']}


# ---------------------------------------------------------------- XR (PREREG): mechanism-reversal exit


def simulate_xr(p, t, pk, S, atm, t_rev):
    """Exit at the first of: the mechanism-reversal decision second t_rev (computed by the runner from closed bars and
    boards only), the EDGE-G X-A vol stop (bid <= fill - clamp(1.0 |delta| S IV_atm sqrt(30 min), 0.20 fill, 0.50 fill)
    on a sane quote), the 90-minute time stop, the 15:50 flat. Fills: devsim conventions. (nov5-tape's devsim 'XA_W'
    path also adds the option-EMA cross exit; XR does not.)"""
    s0, n = p['s0'], len(p['bid'])
    idx = lambda sec: min(max(sec - s0, 0), n - 1)  # noqa: E731
    lo, hi = idx(t + DS.LAT), idx(t + DS.LAT + 60)
    seg = slice(lo, hi + 1)
    okq = (p['bid'][seg] > 0) & (p['ask'][seg] > p['bid'][seg]) & (p['as'][seg] >= 1)
    if not okq.any():
        return {'skip': 'no entry quote'}
    ie = lo + int(np.argmax(okq))
    fill = float(p['ask'][ie])
    xs = s0 + ie
    bid, ask = p['bid'], p['ask']
    mid = (bid + ask) / 2
    sane = (bid > 0) & (ask > bid) & ((ask - bid) <= DS.SANE * np.where(mid > 0, mid, np.inf))
    Dd = min(max(1.0 * pk['delta'] * S * atm * math.sqrt(30 / YEAR_MIN), 0.20 * fill), 0.50 * fill)
    cands = [(t + 5400, 'time'), (DS.FLAT_S, 'flat')]
    if t_rev is not None:
        cands.append((int(t_rev), 'reversal'))
    st = np.flatnonzero(sane[ie + 1:] & (bid[ie + 1:] <= fill - Dd + 1e-9))
    if len(st):
        cands.append((s0 + ie + 1 + int(st[0]), 'stop'))
    cands = sorted(c for c in cands if c[0] > xs)
    dsec, kind = cands[0]
    xi = idx(dsec + DS.LAT)
    px = float(bid[xi])
    sb = bid[ie:xi + 1]
    pnl = 100 * (px - fill) - 2 * FEE
    return {'fill': fill, 'entry_s': int(xs), 'exit': px, 'exit_s': int(s0 + xi), 'reason': kind,
            'ret_gross': px / fill - 1, 'ret_net': pnl / (100 * fill + FEE), 'pnl_net': pnl, 'cost': 100 * fill + FEE,
            'hold_s': int(xi - ie), 'mfe': float(sb.max() / fill - 1) if len(sb) else 0.0,
            'mae': float(sb.min() / fill - 1) if len(sb) else 0.0, 'D': Dd, 'src': p['src']}
