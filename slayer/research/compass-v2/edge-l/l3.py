"""L3 VOL-SHOCK SPILLOVER (registered in specs/PREREG.md @ d14dc62).  DEV only unless SPLIT says otherwise.
    python3 l3.py scan | fetch | run
Inputs at decision T (bar end): SPY bars ending <= T, SPY 0DTE chain snapshots stamped T-60 and T-16 min, the
name's chain snapshots stamped T-60 and T-16 min; exits read name bars ending <= decision, fills from 1-s NBBO.
"""
import io
import json
import os
import sys
import time
import urllib.request

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
from common import OUT, EDGE, bars, chain, iv, bs_delta, split_of, LookAhead, BASE  # noqa

NAMES = ('AAPL', 'NVDA', 'MSFT')
D3 = os.path.join(OUT, 'l3')
SPLIT = os.environ.get('SPLIT', 'DEV')
LAT = 2
FEE = 0.65


def get(path):
    for a in range(4):
        try:
            with urllib.request.urlopen(BASE + path, timeout=300) as r:
                return r.read().decode()
        except urllib.error.HTTPError as e:
            if e.code in (404, 472):
                return ''
            time.sleep(3 * (a + 1))
        except Exception:
            time.sleep(5 * (a + 1))
    return None


def atm_iv(snap, tau):
    s = snap[(snap.bid > 0) & (snap.ask > 0)]
    c, p = s[s.r == 1].set_index('k'), s[s.r == 0].set_index('k')
    ks = sorted(set(c.index) & set(p.index))
    if not ks:
        return None
    cm, pm = (c.bid + c.ask) / 2, (p.bid + p.ask) / 2
    k0 = min(ks, key=lambda k: abs(cm[k] - pm[k]))
    S = float(k0 + cm[k0] - pm[k0])
    K = min(ks, key=lambda k: abs(k - S))
    a = iv(np.array([cm[K], pm[K]]), S, np.array([K, K]), tau, np.array([True, False]))
    if not np.isfinite(a).all():
        return None
    return float(a.mean()), S


def scan():
    B = bars('SPY')
    sess = json.load(open(os.path.join(EDGE, 'sessions.json')))
    out = []
    for d in sess:
        if split_of(d) != SPLIT or d < '2023-01-01' or d not in B:
            continue
        ch = chain('SPY', d)
        b = B[d]
        if ch is None or len(b) < 380:
            continue
        m = b.m.values
        c = b.c.values
        r2 = np.diff(np.log(np.concatenate([[b.o.values[0]], c]))) ** 2
        for j in range(len(m)):
            T = int(m[j]) * 60 + 60
            if T < 36000 or T > 54000 or j < 15:
                continue
            assert m[j] * 60 + 60 <= T and (j + 1 >= len(m) or m[j + 1] * 60 + 60 > T)
            if m[j] - m[j - 15] != 15:
                continue
            ratio = r2[j - 14:j + 1].mean() / r2[:j + 1].mean()
            if ratio < 2:
                continue
            tau1 = (57600 - (T - 60)) / (365 * 86400)
            tau0 = (57600 - (T - 960)) / (365 * 86400)
            s1, s0 = ch[ch.m == T // 60 - 1], ch[ch.m == T // 60 - 16]
            assert (s1.m * 60 < T).all() and (s0.m * 60 < T).all()
            a1, a0 = atm_iv(s1, tau1), atm_iv(s0, tau0)
            if not a1 or not a0 or a1[0] - a0[0] <= 0:
                continue
            out.append(dict(day=d, T=T, ratio=float(ratio), div_spy=a1[0] - a0[0],
                            side=1 if c[j] > c[j - 15] else -1))
    df = pd.DataFrame(out)
    os.makedirs(D3, exist_ok=True)
    df.to_parquet(os.path.join(D3, f'spy_cand_{SPLIT}.parquet'))
    print(len(df), 'candidate minutes on', df.day.nunique(), 'sessions')


def expirations(sym):
    f = os.path.join(D3, f'exp_{sym}.json')
    if os.path.exists(f):
        return json.load(open(f))
    t = get(f'/option/list/expirations?symbol={sym}&format=csv')
    ex = sorted(set(pd.read_csv(io.StringIO(t)).expiration.astype(str)))
    json.dump(ex, open(f, 'w'))
    return ex


def name_chain(sym, d, exp, t0, t1):
    f = os.path.join(D3, 'chain', sym, f'{d}.parquet')
    if os.path.exists(f):
        c = pd.read_parquet(f)
        return c if len(c) else None
    y, e = d.replace('-', ''), exp.replace('-', '')
    clk = lambda s: f'{s // 3600:02d}:{s % 3600 // 60:02d}:00'
    t = get(f'/option/history/quote?symbol={sym}&expiration={e}&date={y}&interval=1m&strike_range=12'
            f'&start_time={clk(t0)}&end_time={clk(t1)}&format=csv')
    os.makedirs(os.path.dirname(f), exist_ok=True)
    if not t or not t.startswith('symbol'):
        pd.DataFrame().to_parquet(f)
        return None
    df = pd.read_csv(io.StringIO(t))
    ts = pd.to_datetime(df['timestamp'])
    c = pd.DataFrame({'m': (ts.dt.hour * 60 + ts.dt.minute).astype(np.int64), 'k': df.strike.astype(float),
                      'r': (df.right.str[0] == 'C').astype(int), 'bid': df.bid.astype(float), 'ask': df.ask.astype(float),
                      'as': df.ask_size.astype(int)})
    c.to_parquet(f, compression='zstd')
    return c


def name_bars(sym, d):
    mo = d[:7]
    f = os.path.join(D3, 'bars', sym, f'{mo}.parquet')
    if not os.path.exists(f):
        y, mth = int(mo[:4]), int(mo[5:])
        end = pd.Timestamp(y, mth, 1) + pd.offsets.MonthEnd(0)
        t = get(f'/stock/history/ohlc?symbol={sym}&start_date={y}{mth:02d}01&end_date={end:%Y%m%d}&interval=1m&format=csv')
        df = pd.read_csv(io.StringIO(t))
        ts = pd.to_datetime(df.timestamp)
        o = pd.DataFrame({'d': ts.dt.strftime('%Y-%m-%d'), 'm': (ts.dt.hour * 60 + ts.dt.minute).astype(np.int64),
                          'c': df.close.astype(float)})
        o = o[(o.m >= 570) & (o.m <= 959) & (o.c > 0)]
        os.makedirs(os.path.dirname(f), exist_ok=True)
        o.to_parquet(f, compression='zstd')
    b = pd.read_parquet(f)
    return b[b.d == d].sort_values('m')


def q1(sym, d, exp, k, call, t0, t1):
    ks = f'{k:.3f}'.rstrip('0').rstrip('.')
    f = os.path.join(D3, 'q1s', sym, d, f'{exp}_{ks}{"C" if call else "P"}_{t0}.npz')
    if os.path.exists(f):
        z = np.load(f)
        return {x: z[x] for x in z.files}
    y, e = d.replace('-', ''), exp.replace('-', '')
    clk = lambda s: f'{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}'
    t = get(f'/option/history/quote?symbol={sym}&expiration={e}&strike={ks}&right={"call" if call else "put"}'
            f'&start_date={y}&end_date={y}&interval=1s&start_time={clk(t0)}&end_time={clk(t1)}&format=csv')
    os.makedirs(os.path.dirname(f), exist_ok=True)
    if not t or not t.startswith('symbol'):
        out = {x: np.zeros(0) for x in ('s', 'bid', 'ask', 'as')}
    else:
        df = pd.read_csv(io.StringIO(t))
        ts = pd.to_datetime(df.timestamp)
        out = {'s': (ts.dt.hour * 3600 + ts.dt.minute * 60 + ts.dt.second).values.astype(np.int64),
               'bid': df.bid.values.astype(float), 'ask': df.ask.values.astype(float), 'as': df.ask_size.values.astype(int)}
    np.savez_compressed(f, **out)
    return out


def pick(snap, S, tau, call):
    best = None
    for _, r in snap[snap.r == int(call)].iterrows():
        mid = (r.bid + r.ask) / 2
        if r.bid <= 0 or r.ask - r.bid > 0.08 * mid or r['as'] < 1:
            continue
        v = iv(np.array([mid]), S, np.array([r.k]), tau, np.array([call]))[0]
        if not np.isfinite(v):
            continue
        dl = abs(float(bs_delta(S, r.k, tau, v, call)))
        if 0.30 <= dl <= 0.40 and (best is None or abs(dl - 0.35) < abs(best[1] - 0.35)):
            best = (float(r.k), dl, v)
    return best


def triggers():
    cand = pd.read_parquet(os.path.join(D3, f'spy_cand_{SPLIT}.parquet'))
    out = []
    for sym in NAMES:
        ex = expirations(sym)
        for d, g in cand.groupby('day'):
            dd = pd.Timestamp(d)
            exps = [e for e in ex if 1 <= (pd.Timestamp(e) - dd).days <= 7]
            if not exps:
                continue
            exp = exps[0]
            ch = name_chain(sym, d, exp, int(g['T'].min()) - 960, int(g['T'].max()) - 60)
            if ch is None:
                continue
            last, n = -10 ** 9, 0
            for _, r in g.sort_values('T').iterrows():
                T = int(r['T'])
                if T - last < 3600 or n >= 2:
                    continue
                tex = (pd.Timestamp(exp) - dd).days * 86400 + 57600
                s1, s0 = ch[ch.m == T // 60 - 1], ch[ch.m == T // 60 - 16]
                if (s1.m * 60 >= T).any() or (s0.m * 60 >= T).any():
                    raise LookAhead('name snapshot')
                a1 = atm_iv(s1, (tex - (T - 60)) / (365 * 86400))
                a0 = atm_iv(s0, (tex - (T - 960)) / (365 * 86400))
                if not a1 or not a0 or not (a1[0] - a0[0] < 0.5 * r.div_spy):
                    continue
                tau = (tex - (T - 60)) / (365 * 86400)
                own = pick(s1, a1[1], tau, r.side > 0)
                opp = pick(s1, a1[1], tau, r.side < 0)
                if not own:
                    continue
                last, n = T, n + 1
                out.append(dict(sym=sym, day=d, T=T, exp=exp, side=int(r.side), k=own[0], d=own[1], iv=own[2],
                                k_opp=opp[0] if opp else np.nan, iv_opp=opp[2] if opp else np.nan, S=a1[1],
                                div_name=a1[0] - a0[0], div_spy=r.div_spy, ratio=r.ratio, tau=tau))
    df = pd.DataFrame(out)
    df.to_parquet(os.path.join(D3, f'trig_{SPLIT}.parquet'))
    print(len(df), df.groupby('sym').size().to_dict())
    return df


def fetch():
    tr = triggers()
    for i, r in tr.iterrows():
        if os.statvfs('/home/user').f_bavail * os.statvfs('/home/user').f_frsize < 2e9:
            print('disk low')
            break
        q1(r.sym, r.day, r.exp, r.k, r.side > 0, r['T'], r['T'] + 3720)
        if np.isfinite(r.k_opp) and os.environ.get('OPP', '0') == '1':
            q1(r.sym, r.day, r.exp, r.k_opp, r.side < 0, r['T'], r['T'] + 3720)
        name_bars(r.sym, r.day)
    print('fetched')


def trade(q, T, bm, bc, side, rule, sd60=None):
    s, bid, ask, asz = q['s'], q['bid'], q['ask'], q['as']
    ok = np.where((s >= T + LAT) & (bid > 0) & (ask > 0) & (asz >= 1))[0]
    if not len(ok) or s[ok[0]] > T + 300:
        return None
    fill = float(ask[ok[0]])
    d = T + 3600
    reason = 'time'
    if rule == 'M2':
        j0 = np.searchsorted(bm, T // 60 - 1)
        if j0 >= len(bm) or bm[j0] != T // 60 - 1:
            return None
        S0 = bc[j0]
        for j in range(j0 + 1, len(bm)):
            de = int(bm[j]) * 60 + 60
            if de >= T + 3600:
                break
            mv = side * np.log(bc[j] / S0)
            if mv >= sd60:
                d, reason = de, 'tp'
                break
            if mv <= -0.75 * sd60:
                d, reason = de, 'sl'
                break
    i = np.where((s >= d + LAT) & (bid > 0))[0]
    px = float(bid[i[0]]) if len(i) else float(bid[bid > 0][-1]) if (bid > 0).any() else 0.0
    return dict(fill=fill, exit=px, ret_gross=(px - fill) / fill, ret_net=(px * 100 - fill * 100 - 2 * FEE) / (fill * 100 + FEE),
                reason=reason)


def run():
    tr = pd.read_parquet(os.path.join(D3, f'trig_{SPLIT}.parquet'))
    rows = []
    for _, r in tr.iterrows():
        T = int(r['T'])
        b = name_bars(r.sym, r.day)
        bm, bc = b.m.values, b.c.values
        past = b[b.m * 60 + 60 <= T].c.values[-61:]
        if len(past) < 30:
            continue
        sd60 = float(np.sqrt(np.mean(np.diff(np.log(past)) ** 2) * 60))
        for rule in ('M1', 'M2'):
            q = q1(r.sym, r.day, r.exp, r.k, r.side > 0, T, T + 3720)
            res = trade(q, T, bm, bc, r.side, rule, sd60)
            opp = None
            if np.isfinite(r.k_opp) and os.path.exists(os.path.join(D3, 'q1s', r.sym, r.day, f"{r.exp}_{f'{r.k_opp:.3f}'.rstrip('0').rstrip('.')}{'P' if r.side > 0 else 'C'}_{T}.npz")):
                qo = q1(r.sym, r.day, r.exp, r.k_opp, r.side < 0, T, T + 3720)
                opp = trade(qo, T, bm, bc, -r.side, rule, sd60)
            if res:
                rows.append(dict(variant=rule, sym=r.sym, day=r.day, T=T, sd60=sd60, iv=r.iv, k=r.k, S=r.S, side=r.side,
                                 tau=r.tau, opp_net=opp['ret_net'] if opp else np.nan, **res))
    df = pd.DataFrame(rows)
    df.to_parquet(os.path.join(D3, f'trades_{SPLIT}.parquet'))
    print(df.groupby('variant').agg(n=('ret_net', 'size'), net=('ret_net', 'mean'), gross=('ret_gross', 'mean'),
                                    win=('ret_net', lambda x: (x > 0).mean()), opp=('opp_net', 'mean')).to_string())


if __name__ == '__main__':
    {'scan': scan, 'fetch': fetch, 'run': run}[sys.argv[1]]()
