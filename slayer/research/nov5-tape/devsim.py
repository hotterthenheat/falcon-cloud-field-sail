"""NOV5 execution on history (and on the study days): the contract pick, 1-second paths and the exits.

Copied from EDGE-G (compass-v2/edge-g/sim_g.py @ ee876e9: pick, path, simulate) so the NOV5 rules are filled exactly
like EDGE-G's registered tests: decision at a minute boundary t; the pick on the 1-minute board stamped (t-60)//60
(IV at mid vs the close of the bar before the stamp; |delta| nearest the target within +-0.08; spread <= 8% of mid;
ask <= 0.6 S sigma_atm sqrt(T)); entry = the ask of the first 1-second quote >= t + 2 s (bid > 0, ask > bid, ask size
>= 1, within 60 s); exits decided on 1-second quotes, stops/trails only on a sane quote (bid > 0, spread <= 25% of
mid), an exit decided at second s fills at the bid of the first 1-second quote >= s + 2; flat decision 15:50:00;
$0.65/contract/side.

Differences from sim_g: one more exit family ('XE', the option's own 1-minute EMA 9/21, registered in PREREG.md), a
NOV5 path cache (v2data/nov5-tape/q1s_dev) that also reads every other worker's cache, and the study days' paths
from v2data/nov5-tape/<D>/q1s (whole-day 1-second files) when present.
"""
import glob, io, math, os, sys, time
import datetime as dt
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'compass-v2', 'edge'))
import sim as esim  # noqa: E402
import fetch_tape as FT  # noqa: E402

DATA = '/home/user/falcon-cloud-field-sail/v2data'
QDIR = os.path.join(DATA, 'nov5-tape', 'q1s_dev')
YEAR_MIN = 390.0 * 252
FEE = 0.65
LAT = 2
FLAT_S = 15 * 3600 + 50 * 60
END_CAP = 15 * 3600 + 52 * 60
SANE = 0.25
NOFETCH = False
PSTATS = {'fetch': 0, 'fetch_s': 0.0, 'reuse': 0, 'nopath': 0}


def _ks(k):
    return f'{k:.3f}'.rstrip('0').rstrip('.')


def live_now():
    u = dt.datetime.utcnow()
    hm = (u.hour - 5) * 60 + u.minute
    return 9 * 60 + 15 <= hm <= 16 * 60 + 5


def pick_on_board(b, bars, day, t, call, target, extra_sessions=0):
    """sim_g.pick on a given 0DTE board (DataFrame m,k,r,bid,ask[,bs,as]) and closed 1-minute bars."""
    m = (t - 60) // 60
    b = b[b.m == m]
    if not len(b):
        return None, 'no board'
    xq = bars[bars.m <= m - 1]
    if not len(xq):
        return None, 'no spot'
    S = float(xq.c.iloc[-1])
    T = max((960 - m) + 390.0 * extra_sessions, 5) / YEAR_MIN
    b = b[(b.bid > 0) & (b.ask > b.bid)]
    if not len(b):
        return None, 'empty board'
    K, R = b.k.values.astype(float), b.r.values.astype(int)
    bid, ask = b.bid.values.astype(float), b.ask.values.astype(float)
    mid = (bid + ask) / 2
    iv = esim.implied_vol(mid, S, K, T, R == 1)
    katm = K[np.argmin(np.abs(K - S))]
    a = iv[(K == katm) & np.isfinite(iv)]
    if not len(a):
        return None, 'no atm iv'
    v_atm = float(np.mean(a))
    dl = np.abs(esim.bs_delta(S, K, T, np.where(np.isfinite(iv), iv, v_atm), R == 1))
    ok = ((R == (1 if call else 0)) & np.isfinite(iv) & ((ask - bid) / mid <= 0.08) &
          (ask <= 0.6 * S * v_atm * math.sqrt(T)) & (np.abs(dl - target) <= 0.08))
    if not ok.any():
        return None, 'no contract in gate'
    i = np.flatnonzero(ok)[np.argmin(np.abs(dl[ok] - target))]
    return {'exp': day, 'k': float(K[i]), 'call': bool(call), 'delta': float(dl[i]), 'iv': float(iv[i]),
            'iv_atm_exp': v_atm, 'S_q': S, 'T': T, 'bid0': float(bid[i]), 'ask0': float(ask[i]),
            'spr0': float((ask[i] - bid[i]) / mid[i])}, 'ok'


def _load_any(f):
    z = np.load(f)
    s = z['s'].astype(np.int64)
    sc = 100.0 if np.issubdtype(z['bid'].dtype, np.integer) else 1.0
    return s, z['bid'] / sc, z['ask'] / sc, z['bs'].astype(float), z['as'].astype(float)


def _candidates(root, day, exp, k, R):
    ks = _ks(k)
    zero = exp == day
    out = []
    D8 = day.replace('-', '')
    f = os.path.join(DATA, 'nov5-tape', D8, 'q1s', f'{ks}{R}.npz')       # study days: whole-day files
    if zero and os.path.exists(f):
        out.append((f, 0, 24 * 3600, 'nov5'))
    for f in glob.glob(os.path.join(QDIR, root, day, f'{exp}_{ks}{R}_*_*.npz')):
        a, b = os.path.basename(f)[:-4].split('_')[-2:]
        out.append((f, int(a), int(b), 'own'))
    if zero:
        for w in ('edge', 'edge-l'):
            for f in glob.glob(os.path.join(DATA, w, 'q1s', root, day, f'{ks}{R}_*_*.npz')):
                a, b = os.path.basename(f)[:-4].split('_')[-2:]
                out.append((f, int(a), int(b), w))
        f = os.path.join(DATA, 'edge-t', 'q1s', root, day, f'{ks}{R}.npz')
        if os.path.exists(f):
            try:
                out.append((f, int(np.load(f)['start']), 15 * 3600 + 51 * 60, 'edge-t'))
            except Exception:
                pass
        f = os.path.join(DATA, 'edge-k', 'q1s', root, day, f'{ks}{R}_S1.npz')
        if os.path.exists(f):
            out.append((f, 9 * 3600 + 31 * 60, 15 * 3600 + 51 * 60, 'edge-k'))
    for w in ('edge-r', 'edge-m', 'edge-g'):
        for f in glob.glob(os.path.join(DATA, w, 'q1s', root, day, f'{exp}_{ks}{R}_*_*.npz')):
            a, b = os.path.basename(f)[:-4].split('_')[-2:]
            out.append((f, int(a), int(b), w))
    return out


def path(root, day, exp, k, call, start, end):
    """Dense per-second quote in force (bid, ask, bs, as) from start to end, or None."""
    R = 'C' if call else 'P'
    use = None
    for f, a, b, w in _candidates(root, day, exp, k, R):
        if a <= start and b >= end:
            use = (f, w)
            break
    if use is None:
        if NOFETCH:
            PSTATS['nopath'] += 1
            return None
        if not FT.disk_ok():
            raise SystemExit('disk: stop fetching')
        y, e = day.replace('-', ''), exp.replace('-', '')
        t0 = time.time()
        try:
            body = FT.get('/option/history/quote', {'symbol': root, 'expiration': e, 'strike': _ks(k),
                                                    'right': 'call' if call else 'put', 'start_date': y, 'end_date': y,
                                                    'interval': '1s', 'start_time': esim._clock(start),
                                                    'end_time': esim._clock(end)}, nodata_tries=3)
            txt = body.decode()
        except FT.NoData:
            txt = ''
        PSTATS['fetch'] += 1
        PSTATS['fetch_s'] += time.time() - t0
        if not txt.strip() or not txt.startswith('symbol'):
            s = np.zeros(0, np.int32); z = {'s': s, 'bid': s, 'ask': s, 'bs': s, 'as': s}
        else:
            df = pd.read_csv(io.StringIO(txt))
            ts = pd.to_datetime(df['timestamp'])
            s = (ts.dt.hour * 3600 + ts.dt.minute * 60 + ts.dt.second).values.astype(np.int32)
            bid = np.round(df['bid'].values * 100).astype(np.int32)
            ask = np.round(df['ask'].values * 100).astype(np.int32)
            bs = df['bid_size'].values.astype(np.int32)
            asz = df['ask_size'].values.astype(np.int32)
            keep = np.ones(len(s), bool)
            keep[1:] = (bid[1:] != bid[:-1]) | (ask[1:] != ask[:-1]) | (bs[1:] != bs[:-1]) | (asz[1:] != asz[:-1])
            z = {'s': s[keep], 'bid': bid[keep], 'ask': ask[keep], 'bs': bs[keep], 'as': asz[keep]}
        f = os.path.join(QDIR, root, day, f'{exp}_{_ks(k)}{R}_{start}_{end}.npz')
        os.makedirs(os.path.dirname(f), exist_ok=True)
        np.savez_compressed(f[:-4] + '.tmp.npz', **z)
        os.replace(f[:-4] + '.tmp.npz', f)
        use = (f, 'own')
        if live_now():
            time.sleep(1.0)
    else:
        PSTATS['reuse'] += 1
    s, bid, ask, bs, asz = _load_any(use[0])
    if not len(s):
        return None
    grid = np.arange(start, end + 1)
    j = np.searchsorted(s, grid, side='right') - 1
    okj = j >= 0
    jj = np.maximum(j, 0)
    out = {'s0': start, 'src': use[1]}
    for name, arr in (('bid', bid), ('ask', ask), ('bs', bs), ('as', asz)):
        out[name] = np.where(okj, arr[jj], 0.0).astype(np.float64)
    return out


def ema_np(x, n):
    a = 2 / (n + 1)
    out = np.empty(len(x))
    m = x[0]
    for i, v in enumerate(x):
        m = v if i == 0 else a * v + (1 - a) * m
        out[i] = m
    return out


def simulate(p, t, fam, pk, S, atm, rv=np.nan, t_target=None):
    """One long trade on path p decided at t. fam: 'XA' (resting 1.5x TP, vol stop, 60-min time stop), 'XB' (vol trail,
    90-min time stop) - both EDGE-G's registered exits verbatim - or 'XE' (PREREG.md: the option's own 1-minute mid
    EMA9 closes below EMA21 after entry; vol stop as XA; 90-min time stop), or 'XA_W' (PREREG.md XW: sell at the bar
    close where SPX reaches the target wall, t_target; vol stop as XA; 90-min time stop)."""
    s0 = p['s0']
    n = len(p['bid'])
    idx = lambda sec: min(max(sec - s0, 0), n - 1)  # noqa: E731
    lo, hi = idx(t + LAT), idx(t + LAT + 60)
    seg = slice(lo, hi + 1)
    okq = (p['bid'][seg] > 0) & (p['ask'][seg] > p['bid'][seg]) & (p['as'][seg] >= 1)
    if not okq.any():
        return {'skip': 'no entry quote'}
    ie = lo + int(np.argmax(okq))
    fill = float(p['ask'][ie])
    xs = s0 + ie
    delta = pk['delta']
    bid, ask = p['bid'], p['ask']
    mid = (bid + ask) / 2
    sane = (bid > 0) & (ask > bid) & ((ask - bid) <= SANE * np.where(mid > 0, mid, np.inf))
    cands = []
    flat = FLAT_S
    if fam in ('XA', 'XE', 'XA_W'):
        hold = 3600 if fam == 'XA' else 5400
        if fam == 'XA_W' and t_target is not None:
            cands.append((int(t_target), 'target', None))
        Dd = min(max(1.0 * delta * S * atm * math.sqrt(30 / YEAR_MIN), 0.20 * fill), 0.50 * fill)
        st = np.flatnonzero(sane[ie + 1:] & (bid[ie + 1:] <= fill - Dd + 1e-9))
        if len(st):
            cands.append((s0 + ie + 1 + int(st[0]), 'stop', None))
        if fam == 'XA':
            a = idx(xs + LAT)
            L = 1.5 * fill
            hit = np.flatnonzero(bid[a:] >= L - 1e-9)
            if len(hit):
                cands.append((s0 + a + int(hit[0]), 'tp', L))
        else:
            # 1-minute mids at each minute close (the quote in force at the second before the minute boundary)
            m0 = (xs // 60 + 1) * 60
            mins = np.arange(m0, min(t + hold, flat) + 1, 60)
            mm = np.array([mid[idx(x - 1)] if sane[idx(x - 1)] else np.nan for x in mins])
            # warm-up: the option's mids over the 30 minutes before the decision (data before t only)
            pre = np.arange(max((t // 60 - 30) * 60, s0 + 60), t + 1, 60)
            pm = np.array([mid[idx(x - 1)] if sane[idx(x - 1)] else np.nan for x in pre]) if len(pre) else np.zeros(0)
            seq = np.concatenate([pm, mm])
            seq = pd.Series(seq).ffill().bfill().values
            if len(seq) and np.isfinite(seq).all():
                e9, e21 = ema_np(seq, 9), ema_np(seq, 21)
                k0 = len(pm)
                up = False
                for j in range(k0, len(seq)):  # first cross DOWN (EMA9 < EMA21 after being >=) at a minute close after the fill
                    if e9[j] >= e21[j]:
                        up = True
                    elif up:
                        cands.append((int(mins[j - k0]), 'ema', None))
                        break
    else:  # XB vol trail
        hold = 5400
        Dd = min(max(1.5 * delta * S * rv * math.sqrt(15 / YEAR_MIN), 0.15 * fill), 0.50 * fill)
        sb = np.where(sane[ie + 1:], bid[ie + 1:], -np.inf)
        peak = np.maximum(fill, np.maximum.accumulate(sb)) if len(sb) else np.zeros(0)
        tr = np.flatnonzero(sane[ie + 1:] & (bid[ie + 1:] <= peak - Dd + 1e-9))
        if len(tr):
            cands.append((s0 + ie + 1 + int(tr[0]), 'trail', None))
    cands.append((t + hold, 'time', None))
    cands.append((flat, 'flat', None))
    cands = [c for c in cands if c[0] > xs]
    cands.sort(key=lambda c: (c[0], c[1] != 'tp'))
    dsec, kind, px = cands[0]
    if px is None:
        xi = idx(dsec + LAT)
        px = float(bid[xi])
        xsec = s0 + xi
    else:
        xsec = dsec
    seg2 = slice(ie, idx(xsec) + 1)
    sb = bid[seg2]
    gross = px / fill - 1
    pnl = 100 * (px - fill) - 2 * FEE
    return {'fill': fill, 'entry_s': int(xs), 'exit': px, 'exit_s': int(xsec), 'reason': kind,
            'ret_gross': gross, 'ret_net': pnl / (100 * fill + FEE), 'pnl_net': pnl, 'cost': 100 * fill + FEE,
            'hold_s': int(xsec - xs), 'mfe': float(sb.max() / fill - 1) if len(sb) else 0.0,
            'mae': float(sb.min() / fill - 1) if len(sb) else 0.0, 'D': Dd, 'src': p['src']}
