"""EDGE-G execution (PREREG "Execution"): contract pick on the board at t - 60, 1-second NBBO paths, the X-A / X-B exits.

  python3 sim_g.py run P1|P2|P3|P4 [max_minutes]    fetch + simulate a phase (resumable, one request in flight)
  python3 sim_g.py run P1 --nofetch                   simulate from cache only

Phases: P1 0DTE d0.30 + d0.45 (event side), P2 1-7 DTE d0.45, P3 0DTE opposite side (N1), P4 1-7 DTE opposite side.
Per root-session result file: v2data/edge-g/res/<phase>/<ROOT>/<D>.json (atomic). Path cache: v2data/edge-g/q1s.
"""
import datetime as dt, glob, io, json, math, os, sys, time
import numpy as np
import pandas as pd
from common import DATA, OUT, MIN_FREE_GB, YEAR_MIN, assert_open, atomic_json, disk_free_gb, get, STATS, dev_sessions
import book as B
import signals_g as G

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'edge'))
import sim  # noqa: E402

FEE = 0.65
LAT = 2
FLAT_S = 15 * 3600 + 50 * 60
END_CAP = 15 * 3600 + 52 * 60
WIN = 92 * 60
SANE = 0.25
CELLS = {'0D30': (0, 0.30), '0D45': (0, 0.45), '1D45': (1, 0.45)}
PHASES = {'P1': (('0D30', '0D45'), 1), 'P2': (('1D45',), 1), 'P3': (('0D30', '0D45'), -1), 'P4': (('1D45',), -1)}
QDIR = os.path.join(OUT, 'q1s')
RES = os.path.join(OUT, 'res')
NOFETCH = False
PSTATS = {'fetch': 0, 'fetch_s': 0.0, 'own': 0, 'reuse': 0, 'nopath': 0}


def _ks(k):
    return f'{k:.3f}'.rstrip('0').rstrip('.')


def _clock(s):
    return f'{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}'


# ---------------------------------------------------------------- boards and the pick


def board(root, day, exp, m):
    """1-minute NBBO rows of the expiry at stamp m (minute of day): DataFrame k, r, bid, ask, bs, as."""
    if exp == day:
        c = sim.chain(root, day)
        return None if c is None else c[c.m == m]
    if root != 'IWM':
        f = os.path.join(DATA, 'edge-r', 'board', root, f'{day}_{exp}.parquet')
        if not os.path.exists(f):
            return None
        b = B_cache(f)
        return b[b.m == m]
    f = os.path.join(OUT, 'board', 'IWM', f'{day}_{exp}_{m}.parquet')
    if not os.path.exists(f):
        if NOFETCH:
            return None
        y, e = day.replace('-', ''), exp.replace('-', '')
        hh = f'{m // 60:02d}:{m % 60:02d}:00'
        t = get(f'/option/history/quote?symbol=IWM&expiration={e}&date={y}&interval=1m&strike_range=14'
                f'&start_time={hh}&end_time={hh}&format=csv')
        if t is None:
            return None
        rows = pd.DataFrame(columns=['m', 'k', 'r', 'bid', 'ask', 'bs', 'as'])
        if t.strip() and t.startswith('symbol'):
            df = pd.read_csv(io.StringIO(t))
            ts = pd.to_datetime(df['timestamp'])
            rows = pd.DataFrame({'m': (ts.dt.hour * 60 + ts.dt.minute).astype('int16'), 'k': df['strike'].astype('float32'),
                                 'r': (df['right'].str.upper().str[0] == 'C').astype('int8'), 'bid': df['bid'].astype('float32'),
                                 'ask': df['ask'].astype('float32'), 'bs': df['bid_size'].astype('int32'), 'as': df['ask_size'].astype('int32')})
        os.makedirs(os.path.dirname(f), exist_ok=True)
        rows.to_parquet(f + '.tmp', index=False)
        os.replace(f + '.tmp', f)
    b = pd.read_parquet(f)
    return b[b.m == m]


_BC = {}


def B_cache(f):
    if f not in _BC:
        _BC[f] = pd.read_parquet(f)
        if len(_BC) > 8:
            _BC.pop(next(iter(_BC)))
    return _BC[f]


def pick(root, day, t, call, dte_bucket, target, bars):
    """The registered pick: board at stamp (t-60)//60, IV at mid vs the price at that stamp, |delta| nearest target
    within +-0.08, spread <= 8% of mid, ask <= 0.6 S sigma_atm sqrt(T). Returns dict or None (with a reason)."""
    m = (t - 60) // 60
    exp = day if dte_bucket == 0 else B.next_expiry(root, day)
    if exp is None:
        return None, 'no 1-7 expiry'
    b = board(root, day, exp, m)
    if b is None or not len(b):
        return None, 'no board'
    xq = bars[bars.m <= m - 1]
    if not len(xq):
        return None, 'no spot'
    S = float(xq.c.iloc[-1])
    T = max((960 - m) + 390.0 * B.nsess(day, exp), 5) / YEAR_MIN
    b = b[(b.bid > 0) & (b.ask > b.bid)]
    if not len(b):
        return None, 'empty board'
    K, R = b.k.values.astype(float), b.r.values.astype(int)
    bid, ask = b.bid.values.astype(float), b.ask.values.astype(float)
    mid = (bid + ask) / 2
    iv = sim.implied_vol(mid, S, K, T, R == 1)
    katm = K[np.argmin(np.abs(K - S))]
    a = iv[(K == katm) & np.isfinite(iv)]
    if not len(a):
        return None, 'no atm iv'
    v_atm = float(np.mean(a))
    dl = np.abs(sim.bs_delta(S, K, T, np.where(np.isfinite(iv), iv, v_atm), R == 1))
    ok = ((R == (1 if call else 0)) & np.isfinite(iv) & ((ask - bid) / mid <= 0.08) &
          (ask <= 0.6 * S * v_atm * math.sqrt(T)) & (np.abs(dl - target) <= 0.08))
    if not ok.any():
        return None, 'no contract in gate'
    i = np.flatnonzero(ok)[np.argmin(np.abs(dl[ok] - target))]
    return {'exp': exp, 'k': float(K[i]), 'call': bool(call), 'delta': float(dl[i]), 'iv': float(iv[i]),
            'iv_atm_exp': v_atm, 'S_q': S, 'T': T, 'bid0': float(bid[i]), 'ask0': float(ask[i]),
            'spr0': float((ask[i] - bid[i]) / mid[i])}, 'ok'


# ---------------------------------------------------------------- 1-second paths (own cache + other workers')


def _load_any(f):
    z = np.load(f)
    s = z['s'].astype(np.int64)
    sc = 100.0 if np.issubdtype(z['bid'].dtype, np.integer) else 1.0
    return s, z['bid'] / sc, z['ask'] / sc, z['bs'].astype(float), z['as'].astype(float)


def _candidates(root, day, exp, k, R):
    ks = _ks(k)
    zero = exp == day
    out = []
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
    for w in ('edge-r', 'edge-m'):
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
        if disk_free_gb() < MIN_FREE_GB:
            raise SystemExit('disk free < 3 GB: stop fetching')
        y, e = day.replace('-', ''), exp.replace('-', '')
        t0 = time.time()
        txt = get(f'/option/history/quote?symbol={root}&expiration={e}&strike={_ks(k)}&right={"call" if call else "put"}'
                  f'&start_date={y}&end_date={y}&interval=1s&start_time={_clock(start)}&end_time={_clock(end)}&format=csv')
        PSTATS['fetch'] += 1
        PSTATS['fetch_s'] += time.time() - t0
        if txt is None:
            return None
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
        if hasattr(sys, '_edgeg_live') and sys._edgeg_live():
            time.sleep(1.0)
    else:
        PSTATS['reuse' if use[1] != 'own' else 'own'] += 1
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


# ---------------------------------------------------------------- exits


def simulate(p, t, fam, ev, pk, bars, z_book, side):
    """One trade on path p. Returns a result dict (or a skip)."""
    s0 = p['s0']
    n = len(p['bid'])
    idx = lambda sec: min(max(sec - s0, 0), n - 1)  # noqa: E731
    # entry: first second >= t + 2 within 60 s with bid > 0, ask > bid, ask size >= 1
    lo, hi = idx(t + LAT), idx(t + LAT + 60)
    seg = slice(lo, hi + 1)
    okq = (p['bid'][seg] > 0) & (p['ask'][seg] > p['bid'][seg]) & (p['as'][seg] >= 1)
    if not okq.any():
        return {'skip': 'no entry quote'}
    ie = lo + int(np.argmax(okq))
    fill = float(p['ask'][ie])
    xs = s0 + ie
    delta, S, atm = pk['delta'], ev['S'], ev['atm']
    bid, ask = p['bid'], p['ask']
    mid = (bid + ask) / 2
    sane = (bid > 0) & (ask > bid) & ((ask - bid) <= SANE * np.where(mid > 0, mid, np.inf))
    cands = []  # (decision_second, kind, fill_price or None)
    flat = FLAT_S
    if fam in ('XA', 'XA_RC'):
        hold = 3600
        D = min(max(1.0 * delta * S * atm * math.sqrt(30 / YEAR_MIN), 0.20 * fill), 0.50 * fill)
        # resting TP from fill + 2 s
        a = idx(xs + LAT)
        L = 1.5 * fill
        hit = np.flatnonzero(bid[a:] >= L - 1e-9)
        if len(hit):
            cands.append((s0 + a + int(hit[0]), 'tp', L))
        st = np.flatnonzero(sane[ie + 1:] & (bid[ie + 1:] <= fill - D + 1e-9))
        if len(st):
            cands.append((s0 + ie + 1 + int(st[0]), 'stop', None))
        if fam == 'XA_RC':
            b_ = ev['b']
            tt, FF = z_book['t'], z_book['flip']
            last_f = None
            for tm in range((t // 60 + 1) * 60, min(t + hold, flat) + 1, 60):
                k = np.flatnonzero(tt == tm)
                F = FF[k[0]] if len(k) else (last_f if tm > tt.max() else np.nan)
                if len(k) and np.isfinite(FF[k[0]]):
                    last_f = FF[k[0]]
                if F is None or not np.isfinite(F):
                    continue
                Sx = G.spot_before(bars, tm)
                if np.isfinite(Sx) and side * (Sx - F) <= -b_:
                    cands.append((tm, 'recross', None))
                    break
    else:  # XB vol trail
        hold = 5400
        rv = ev.get('rv', np.nan)
        D = min(max(1.5 * delta * S * rv * math.sqrt(15 / YEAR_MIN), 0.15 * fill), 0.50 * fill)
        sb = np.where(sane[ie + 1:], bid[ie + 1:], -np.inf)
        peak = np.maximum(fill, np.maximum.accumulate(sb)) if len(sb) else np.zeros(0)
        tr = np.flatnonzero(sane[ie + 1:] & (bid[ie + 1:] <= peak - D + 1e-9))
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
            'mae': float(sb.min() / fill - 1) if len(sb) else 0.0, 'spr_fill': float((ask[ie] - bid[ie]) / ((ask[ie] + bid[ie]) / 2)),
            'D': D, 'src': p['src']}


EXITS = {'R1A': ('XA_RC',), 'R1B': ('XA',), 'BASE': ('XA', 'XB')}


def run_session(phase, root, day, events):
    f = os.path.join(RES, phase, root, f'{day}.json')
    if os.path.exists(f):
        return 'have'
    assert_open(day)
    cells, sgn = PHASES[phase]
    bars = sim.day_bars(root, day)
    z = G.load_book(root, day)
    out = []
    for ev in events:
        side = int(ev['side']) * sgn
        t = int(ev['t'])
        end = min(t + WIN, END_CAP)
        for cell in cells:
            dte, target = CELLS[cell]
            pk, why = pick(root, day, t, side > 0, dte, target, bars)
            base_row = {'id': ev['id'], 'cell': cell, 'sideflip': sgn}
            if pk is None:
                out.append({**base_row, 'skip': why})
                continue
            p = path(root, day, pk['exp'], pk['k'], pk['call'], t, end)
            if p is None:
                out.append({**base_row, 'skip': 'no path', **pk})
                continue
            for ex in EXITS[ev['fam']]:
                evx = dict(ev)
                r = simulate(p, t, ex, evx, pk, bars, z, side)
                out.append({**base_row, 'exit_rule': ex, **pk, **r})
    atomic_json(out, f)
    return 'ok'


def main():
    global NOFETCH
    phase = sys.argv[2]
    NOFETCH = '--nofetch' in sys.argv
    lim = [a for a in sys.argv[3:] if a.replace('.', '').isdigit()]
    tmax = float(lim[0]) * 60 if lim else 1e12

    def live():  # 09:15-16:05 ET (EST in November: UTC-5)
        u = dt.datetime.utcnow()
        hm = (u.hour - 5) * 60 + u.minute
        return 9 * 60 + 15 <= hm <= 16 * 60 + 5
    sys._edgeg_live = live
    ev = pd.read_parquet(os.path.join(OUT, 'events_DEV.parquet'))
    ev = ev.replace({np.inf: 1e9})
    days = sorted(ev.day.unique())
    rng = np.random.default_rng(20261106)
    order = [days[i] for i in rng.permutation(len(days))]
    t0 = time.time()
    n = 0
    for d in order:
        for root in ('SPXW', 'SPY', 'QQQ', 'IWM'):
            e = ev[(ev.day == d) & (ev.root == root)]
            if not len(e):
                continue
            run_session(phase, root, d, e.to_dict('records'))
        n += 1
        if n % 10 == 0:
            print(time.strftime('%H:%M:%S'), phase, 'days', n, len(order), PSTATS, STATS, f'{disk_free_gb():.2f} GB', flush=True)
        if time.time() - t0 > tmax:
            print('time cut', n, flush=True)
            break
    print('done', phase, n, PSTATS, STATS, flush=True)


if __name__ == '__main__':
    main()
