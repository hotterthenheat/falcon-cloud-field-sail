"""EDGE-K data access: boards (EDGE's chain store; XSP boards fetched one minute at a time), candidate sets, 1-second
paths (reusing EDGE-T's and EDGE's caches read-only; new ones under v2data/edge-k/q1s), and the sets' real execution.
Terminal: one request in flight (this process is sequential)."""
import io, json, math, os, sys, time, urllib.request
import numpy as np
import pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'edge'))
sys.path.insert(0, os.path.join(HERE, '..', 'edge-t'))
import sim  # noqa: E402
import fetch as F  # noqa: E402
import ht  # noqa: E402

OUT = '/home/user/falcon-cloud-field-sail/v2data/edge-k'
BASE = 'http://127.0.0.1:25503/v3'
XDIR = os.path.join(OUT, 'xsp')
QDIR = os.path.join(OUT, 'q1s')
EDGE_T_Q = '/home/user/falcon-cloud-field-sail/v2data/edge-t/q1s'
EDGE_Q = '/home/user/falcon-cloud-field-sail/v2data/edge/q1s'
S2_A, S2_B = 15 * 3600 + 25 * 60, 15 * 3600 + 59 * 60
STATS = {'fetch': 0, 'fetch_s': 0.0}
NOFETCH = False


def get(url, tries=4):
    t0 = time.time()
    for a in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=240) as r:
                txt = r.read().decode()
            break
        except urllib.error.HTTPError as e:
            if e.code in (404, 472):
                txt = ''
                break
            time.sleep(3 * (a + 1))
        except Exception:
            time.sleep(5 * (a + 1))
    else:
        txt = None
    STATS['fetch'] += 1
    STATS['fetch_s'] += time.time() - t0
    return txt


def disk_free_gb():
    st = os.statvfs(OUT)
    return st.f_bavail * st.f_frsize / 1e9


def guard_disk():
    if disk_free_gb() < 1.5:
        raise SystemExit('disk free < 1.5 GB: stop fetching')


# ---------------------------------------------------------------- XSP boards


def xsp_exps():
    f = os.path.join(OUT, 'exp_XSP.json')
    if os.path.exists(f):
        return set(json.load(open(f)))
    t = get(f'{BASE}/option/list/expirations?symbol=XSP&format=csv')
    df = pd.read_csv(io.StringIO(t))
    ex = sorted(set(str(x)[:10] for x in df[df.columns[-1]]))
    json.dump(ex, open(f, 'w'))
    return set(ex)


def xsp_board(day, minute, fetch=True):
    """XSP 0DTE board of one minute stamp (same columns as EDGE's chain), or None (no same-day XSP expiry / empty)."""
    if F.is_locked(day):
        raise AssertionError('locked day')
    if day not in xsp_exps():
        return None
    f = os.path.join(XDIR, f'{day}_{minute}.parquet')
    if os.path.exists(f):
        b = pd.read_parquet(f)
        return b if len(b) else None
    if not fetch or NOFETCH:
        return None
    guard_disk()
    y = day.replace('-', '')
    hh = f'{minute // 60:02d}:{minute % 60:02d}:00'
    t = get(f'{BASE}/option/history/quote?symbol=XSP&expiration={y}&date={y}&interval=1m&strike_range=20'
            f'&start_time={hh}&end_time={hh}&format=csv')
    if t is None:
        return None
    os.makedirs(XDIR, exist_ok=True)
    if not t.strip() or not t.startswith('symbol'):
        pd.DataFrame().to_parquet(f)
        return None
    df = pd.read_csv(io.StringIO(t))
    ts = pd.to_datetime(df['timestamp'])
    out = pd.DataFrame({'m': (ts.dt.hour * 60 + ts.dt.minute).astype('int16'), 'k': df['strike'].astype('float32'),
                        'r': (df['right'].str.upper().str[0] == 'C').astype('int8'), 'bid': df['bid'].astype('float32'),
                        'ask': df['ask'].astype('float32'), 'bs': df['bid_size'].astype('int32'), 'as': df['ask_size'].astype('int32')})
    out = out[out.m == minute]
    out.to_parquet(f, compression='zstd')
    return out if len(out) else None


def xsp_boards_cached():
    if not os.path.isdir(XDIR):
        return []
    out = []
    for fn in sorted(os.listdir(XDIR)):
        day, m = fn[:10], int(fn[11:].split('.')[0])
        b = pd.read_parquet(os.path.join(XDIR, fn))
        if len(b):
            out.append((day, m, b))
    return out


# ---------------------------------------------------------------- candidates


def candidates(setname, root, day, t, call, S, board=None):
    """F(side): two-sided contracts of the board stamped (t-60)//60, IV solvable at mid, the set's entry rule on the
    board quote. S = the root's own underlying price (SPX/10 for XSP)."""
    b = board if board is not None else sim.board(root, day, t)
    if b is None or not len(b) or not np.isfinite(S):
        return []
    T = max(960 - t / 60.0, 1.0) / sim.YEAR_MIN
    b = b[(b.r.values == (1 if call else 0)) & (b.bid > 0) & (b.ask > b.bid)]
    if not len(b):
        return []
    bid, ask = b.bid.values.astype(float), b.ask.values.astype(float)
    mid = (bid + ask) / 2
    feas = np.ones(len(b), bool)
    if setname == 'S1':
        feas = ((ask - bid) <= ht.SANE_SPR * mid) & (b.bs.values >= 2) & (b['as'].values >= 2)
    else:
        feas = b['as'].values >= 1
    iv = sim.implied_vol(mid, S, b.k.values, T, np.full(len(b), call))
    ok = feas & np.isfinite(iv)
    out = []
    for i in np.flatnonzero(ok):
        K = float(b.k.values[i])
        dl = float(abs(sim.bs_delta(S, K, T, iv[i], call)))
        out.append({'root': root, 'k': K, 'call': bool(call), 'bid': float(bid[i]), 'ask': float(ask[i]), 'mid0': float(mid[i]),
                    'h0': float((ask[i] - bid[i]) / 2), 'iv': float(iv[i]), 'W': float(iv[i] ** 2 * T), 'delta': dl,
                    'bs': int(b.bs.values[i]), 'as': int(b['as'].values[i]), 'S': float(S)})
    return out


def board_strikes(root, day, t, board=None):
    b = board if board is not None else sim.board(root, day, t)
    return np.array(sorted(set(b.k.values.tolist()))) if b is not None and len(b) else np.array([])


# ---------------------------------------------------------------- 1-second paths


def _ks(k):
    return f'{k:.3f}'.rstrip('0').rstrip('.')


def path_s1(root, day, k, call):
    """Dense per-second arrays 09:31:00..15:51:00 (ht.path format), EDGE-T's cache first, else ours."""
    ks = _ks(k)
    fe = os.path.join(EDGE_T_Q, root, day, f'{ks}{"C" if call else "P"}.npz')
    if os.path.exists(fe) and int(np.load(fe)['start']) <= ht.H1_START:
        ht.QDIR = EDGE_T_Q
        return ht.path(root, day, k, call, ht.H1_START)
    ht.QDIR = QDIR
    f = os.path.join(QDIR, root, day, f'{ks}{"C" if call else "P"}.npz')
    if not os.path.exists(f):
        if NOFETCH:
            return 'missing'
        guard_disk()
        STATS['fetch'] += 1
    ht.NOFETCH = NOFETCH
    return ht.path(root, day, k, call, ht.H1_START)


def path_s2(root, day, k, call):
    """{s, bid, ask, bs, as} 15:25:00..15:59:00 (sim.run_trade format): EDGE's two E1 chunks if both exist, else ours."""
    ks = _ks(k)
    tag = f'{ks}{"C" if call else "P"}'
    c1 = os.path.join(EDGE_Q, root, day, f'{tag}_55500_57300.npz')
    c2 = os.path.join(EDGE_Q, root, day, f'{tag}_57301_57540.npz')
    if os.path.exists(c1) and os.path.exists(c2):
        a, b = np.load(c1), np.load(c2)
        return {x: np.concatenate([a[x], b[x]]) for x in ('s', 'bid', 'ask', 'bs', 'as')}
    f = os.path.join(QDIR, root, day, f'{tag}_S2.npz')
    if os.path.exists(f):
        z = np.load(f)
        return {x: z[x] for x in z.files}
    if NOFETCH:
        return 'missing'
    guard_disk()
    y = day.replace('-', '')
    url = (f'{BASE}/option/history/quote?symbol={root}&expiration={y}&strike={ks}&right={"call" if call else "put"}'
           f'&start_date={y}&end_date={y}&interval=1s&start_time=15:25:00&end_time=15:59:00&format=csv')
    txt = get(url)
    if txt is None:
        return None
    os.makedirs(os.path.dirname(f), exist_ok=True)
    if not txt.strip() or not txt.startswith('symbol'):
        out = {x: np.zeros(0, np.float32) for x in ('s', 'bid', 'ask', 'bs', 'as')}
    else:
        df = pd.read_csv(io.StringIO(txt))
        ts = pd.to_datetime(df['timestamp'])
        s = (ts.dt.hour * 3600 + ts.dt.minute * 60 + ts.dt.second).values.astype(np.int32)
        bid, ask = df['bid'].values.astype(np.float32), df['ask'].values.astype(np.float32)
        bs, asz = df['bid_size'].values.astype(np.int32), df['ask_size'].values.astype(np.int32)
        keep = np.ones(len(s), bool)
        keep[1:] = (bid[1:] != bid[:-1]) | (ask[1:] != ask[:-1]) | (bs[1:] != bs[:-1]) | (asz[1:] != asz[:-1])
        out = {'s': s[keep], 'bid': bid[keep], 'ask': ask[keep], 'bs': bs[keep], 'as': asz[keep]}
    np.savez_compressed(f, **out)
    return out


# ---------------------------------------------------------------- real execution


def outcome(sig, root, k, call):
    """The set's real fill and exits on 1-second NBBO. {'skip': ...} or {'fill','exit','ret','ret_fee','why',...}."""
    day, t = sig['day'], sig['t']
    if sig['set'] == 'S1':
        p = path_s1(root, day, k, call)
        if isinstance(p, str):
            return {'skip': p}
        if p is None:
            return {'skip': 'no_quotes'}
        ent, skip = ht.enter(p, t)
        if ent is None:
            return {'skip': 'insane', 'q': skip.get('q')}
        r = ht.manage(p, ent, call)
        return {k2: r[k2] for k2 in ('fill', 'exit', 'fill_s', 'exit_s', 'why', 'ret', 'ret_fee', 'mfe')}
    q = path_s2(root, day, k, call)
    if isinstance(q, str):
        return {'skip': q}
    if q is None or not len(q['s']):
        return {'skip': 'no_quotes'}
    q = {x: np.asarray(v, float) if x in ('bid', 'ask') else np.asarray(v) for x, v in q.items()}
    r = sim.run_trade(q, t, sig['t_end'], {'stop': 0.5, 'trail_arm': 1.25, 'trail': 0.75})
    if r is None:
        return {'skip': 'no_fill'}
    return {k2: r[k2] for k2 in ('fill', 'exit', 'fill_s', 'exit_s', 'why', 'ret', 'ret_fee')}
