"""Stage B (option capture) per PREREG.md.

  python3 stage_b.py fetch VARIANT SPLIT     # contract selection inputs + 1-second option windows (1 terminal req)
  python3 stage_b.py run VARIANT SPLIT [frozen_variant_index]   # simulate 27 exits, nulls, PBO, DSR

Contract candidates: the alert contract's own implied vol (from the UW print price, published before t0) gives a
strike guess for |delta| 0.30 at the chosen expiry; the two listed strikes nearest that guess, per right, are fetched.
Delta at te is then solved from each candidate's own NBBO mid at te and the rule of PREREG applies.
Timing: te = ceil(sod0)+2. Entry fill = ask of the first option row stamped >= te. Decisions at second g use rows
stamped <= g-1; an exit decided at g fills at the bid of the first row stamped >= g+2.
"""
import datetime as dt
import json
import math
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DATA, NoData, theta_csv  # noqa: E402
import bs  # noqa: E402
from exits import GRID, simulate, ret  # noqa: E402
from stats import cluster_ci, dsr, pbo_cscv  # noqa: E402
from stage_a import load as load_stk  # noqa: E402

SEED = 20261105
CAP_B = 1200
CLOSE_CAP = 15 * 3600 + 55 * 60
L = 3700
META = f'{DATA}/theta/meta'
OPT = f'{DATA}/theta/opt'


def hms(s):
    s = int(s)
    return f'{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}'


def expirations(t):
    p = f'{META}/exp_{t}.json'
    if not os.path.exists(p):
        os.makedirs(META, exist_ok=True)
        try:
            df = theta_csv('/option/list/expirations', dict(symbol=t))
            ex = sorted(str(x)[:10] for x in df['expiration'])
        except NoData:
            ex = []
        json.dump(ex, open(p, 'w'))
    return json.load(open(p))


def strikes(t, e):
    p = f'{META}/stk_{t}_{e}.json'
    if not os.path.exists(p):
        try:
            df = theta_csv('/option/list/strikes', dict(symbol=t, expiration=e.replace('-', '')))
            ks = sorted(float(x) for x in df['strike'])
        except NoData:
            ks = []
        json.dump(ks, open(p, 'w'))
    return json.load(open(p))


def tau_years(session, sod, expiry):
    d0 = dt.date.fromisoformat(session); d1 = dt.date.fromisoformat(expiry)
    sec = (d1 - d0).days * 86400 + (16 * 3600 - sod)
    return max(sec, 3600) / (365 * 86400)


def sample(variant, split):
    e = pd.read_parquet(f'{DATA}/stageA_{variant}_{split}.parquet')
    fam = variant.split('-')[0]
    ev = pd.read_parquet(f'{DATA}/events_{fam}.parquet')
    extra = [c for c in ('alert_px', 'strike', 'expiry') if c in ev.columns and c not in e.columns]
    if extra:
        keys = ['variant', 'ticker', 'session', 'dir', 't0']
        e = e.reset_index().merge(ev[keys + extra], on=keys, how='left').set_index('idx' if 'idx' in e.reset_index().columns else 'index')
    if len(e) > CAP_B:
        e = e.sample(CAP_B, random_state=SEED)
    return e.sort_values('t0')


def opt_path(t, session, exp, k, right, idx):
    return f'{OPT}/{session}/{t}_{exp}_{k:g}_{right}_{idx}.parquet'


def fetch_contract(t, session, exp, k, right, te, idx):
    p = opt_path(t, session, exp, k, right, idx)
    if os.path.exists(p):
        return p
    os.makedirs(os.path.dirname(p), exist_ok=True)
    try:
        df = theta_csv('/option/history/quote', dict(symbol=t, expiration=exp.replace('-', ''), strike=f'{k:g}',
                                                     right=right, date=session.replace('-', ''), interval='1s',
                                                     start_time=hms(te - 3), end_time=hms(min(16 * 3600, te + L))))
        ts = pd.to_datetime(df['timestamp'])
        o = pd.DataFrame({'sod': (ts.dt.hour * 3600 + ts.dt.minute * 60 + ts.dt.second).astype('int32'),
                          'bid': df['bid'].astype('float32'), 'ask': df['ask'].astype('float32'),
                          'asz': df['ask_size'].astype('int32')})
    except NoData:
        o = pd.DataFrame({'sod': np.array([], 'int32'), 'bid': np.array([], 'float32'),
                          'ask': np.array([], 'float32'), 'asz': np.array([], 'int32')})
    o.to_parquet(p, compression='zstd')
    return p


def candidates(r, side_dir, S, exp, ks):
    tau = tau_years(r.session, r.sod0, exp)
    iv = float('nan')
    if 'alert_px' in r._fields and np.isfinite(getattr(r, 'alert_px', np.nan)):
        call = r.dir == 1
        tau_a = tau_years(r.session, r.sod0, str(r.expiry)[:10])
        iv = bs.implied_vol(float(r.alert_px), float(r.underlying_price), float(r.strike), tau_a, call)
    if not np.isfinite(iv) or iv <= 0.05:
        iv = 0.5
    d1 = -0.5244 if side_dir == 1 else 0.5244
    kstar = S * math.exp(-d1 * iv * math.sqrt(tau) + (bs.R + 0.5 * iv * iv) * tau)
    ks = np.array(ks)
    order = np.argsort(np.abs(ks - kstar))
    return [float(x) for x in ks[order[:2]]]


def choose_exp(t, session):
    d0 = dt.date.fromisoformat(session)
    for e in expirations(t):
        dd = (dt.date.fromisoformat(e) - d0).days
        if 1 <= dd <= 9:
            return e
    return None


def do_fetch(variant, split):
    e = sample(variant, split)
    print('events', len(e), flush=True)
    for i, r in enumerate(e.itertuples()):
        w = load_stk(r.ticker, r.session)
        te = math.ceil(r.sod0) + 2
        if w is None:
            continue
        j = np.searchsorted(w[0], te)
        if j >= len(w[0]):
            continue
        S = float(w[1][j])
        exp = choose_exp(r.ticker, r.session)
        if exp is None:
            continue
        ks = strikes(r.ticker, exp)
        if not ks:
            continue
        for side in (1, -1):
            right = 'call' if side == 1 else 'put'
            for k in candidates(r, side, S, exp, ks):
                try:
                    fetch_contract(r.ticker, r.session, exp, k, right, te, r.Index)
                except Exception as ex:  # noqa
                    print('ERR', r.ticker, r.session, k, right, str(ex)[:100], flush=True)
        if i % 50 == 0:
            print(i, r.ticker, r.session, flush=True)
    print('done', flush=True)


# ---------------- simulation ----------------

def asof_grid(sod, val, grid, lag):
    """value of the last row stamped <= grid - lag (decision use)."""
    j = np.searchsorted(sod, grid - lag, 'right') - 1
    out = np.where(j >= 0, val[np.maximum(j, 0)], np.nan)
    return out


def first_at_or_after(sod, val, grid):
    j = np.searchsorted(sod, grid, 'left')
    j2 = np.minimum(j, len(sod) - 1)
    out = np.where(j < len(sod), val[j2], val[-1] if len(sod) else np.nan)
    return out


def pick(r, side, S, exp, ks, cap):
    """returns dict for the chosen contract of this side, or None."""
    right = 'call' if side == 1 else 'put'
    te = math.ceil(r.sod0) + 2
    tau = tau_years(r.session, te, exp)
    best = None
    for k in candidates(r, side, S, exp, ks):
        p = opt_path(r.ticker, r.session, exp, k, right, r.Index)
        if not os.path.exists(p):
            continue
        o = pd.read_parquet(p)
        o = o[(o['bid'] >= 0) & (o['ask'] > 0)]
        if len(o) < 60:
            continue
        sod = o['sod'].to_numpy()
        j = np.searchsorted(sod, te)
        if j >= len(sod) or sod[j] - te > 5:
            continue
        b, a, asz = float(o['bid'].iloc[j]), float(o['ask'].iloc[j]), int(o['asz'].iloc[j])
        if not (a > b > 0):
            continue
        mid = 0.5 * (a + b)
        iv = bs.implied_vol(mid, S, k, tau, side == 1)
        if not np.isfinite(iv):
            continue
        dl = abs(bs.delta(S, k, tau, iv, side == 1))
        ok = 0.20 <= dl <= 0.40 and (a - b) / mid <= 0.08 and a >= 0.20 and asz >= 1 and a <= cap
        if ok and (best is None or abs(dl - 0.30) < abs(best['delta'] - 0.30)):
            best = dict(k=k, right=right, delta=dl, A=a, iv=iv, tau=tau, spread=a - b, o=o)
    return best


def build_trades(variant, split):
    e = sample(variant, split)
    trades = []
    for r in e.itertuples():
        w = load_stk(r.ticker, r.session)
        if w is None:
            continue
        te = math.ceil(r.sod0) + 2
        usod, umid = w
        j = np.searchsorted(usod, te)
        if j >= len(usod):
            continue
        S = float(umid[j])
        exp = choose_exp(r.ticker, r.session)
        if exp is None:
            continue
        ks = strikes(r.ticker, exp)
        cap = 2 * S * r.sig1 * math.sqrt(23400)
        sides = {}
        for side in (1, -1):
            sides[side] = pick(r, side, S, exp, ks, cap)
        if sides[1] is None or sides[-1] is None:
            continue
        grid = te + np.arange(0, L + 1)
        u = asof_grid(usod, umid, grid, 1)
        u[0] = S
        s30 = r.sig1 * math.sqrt(1800)
        n_max = int(CLOSE_CAP - te)
        rec = dict(session=r.session, ticker=r.ticker, dir=int(r.dir), te=te, S=S, s30=s30, sig1=r.sig1, exp=exp)
        for side in (1, -1):
            c = sides[side]
            osod = c['o']['sod'].to_numpy(); ob_ = c['o']['bid'].to_numpy(float)
            ob = asof_grid(osod, ob_, grid, 1)
            fb = first_at_or_after(osod, ob_, grid)
            ex = simulate(u, ob, fb, c['A'], side, s30, n_max)
            tag = 'sig' if side == r.dir else 'opp'
            rec[f'{tag}_A'] = c['A']; rec[f'{tag}_delta'] = c['delta']; rec[f'{tag}_iv'] = c['iv']
            rec[f'{tag}_k'] = c['k']; rec[f'{tag}_tau'] = c['tau']; rec[f'{tag}_spread'] = c['spread']
            rec[f'{tag}_exit'] = ex
        trades.append(rec)
    return pd.DataFrame(trades)


def returns_matrix(tr, tag, fee=True):
    A = tr[f'{tag}_A'].to_numpy()[:, None]
    X = np.stack(tr[f'{tag}_exit'].to_numpy())
    return ret(X, A, fee)


def synthetic(tr, rng):
    """zero-drift replicate: driftless walk at sigma_1s, option = BS at entry IV, entry dollar spread held."""
    out = np.empty((len(tr), len(GRID)))
    for i, r in enumerate(tr.itertuples()):
        n = L + 1
        steps = rng.normal(0, r.sig1, n - 1)
        u = r.S * np.exp(np.concatenate([[0], np.cumsum(steps)]))
        call = r.dir == 1
        tau = r.sig_tau - np.arange(n) / (365 * 86400)
        k = r.sig_k
        mid0 = float(bs.price(r.S, k, r.sig_tau, r.sig_iv, call))
        half = r.sig_spread / 2
        midp = bs.price(u, k, tau, r.sig_iv, call)
        bid = np.maximum(midp - half, 0.0)
        A = mid0 + half
        ob = np.concatenate([[bid[0]], bid[:-1]])
        fb = bid
        ex = simulate(u, ob, fb, A, r.dir, r.s30, int(CLOSE_CAP - r.te))
        out[i] = ret(ex, A, True)
    return out


def evaluate(M, sess, B=2000, seed=0):
    means = M.mean(0)
    j = int(np.argmax(means))
    mu, lo, hi = cluster_ci(M[:, j], sess, B=B, seed=seed)
    return j, mu, lo, hi


def do_run(variant, split, frozen=None, n_perm=300, n_syn=60):
    tr = build_trades(variant, split)
    tr.to_pickle(f'{DATA}/stageB_{variant}_{split}.pkl')
    sess = tr['session'].to_numpy()
    Ms = returns_matrix(tr, 'sig'); Mo = returns_matrix(tr, 'opp')
    Ms_nf = returns_matrix(tr, 'sig', fee=False)
    res = dict(n=len(tr), sessions=int(tr['session'].nunique()),
               med_delta=float(tr['sig_delta'].median()), med_spread_pct=float((tr['sig_spread'] / tr['sig_A']).median()))
    if frozen is None:
        j, mu, lo, hi = evaluate(Ms, sess)
    else:
        j = int(frozen); mu, lo, hi = cluster_ci(Ms[:, j], sess, B=2000, seed=0)
    res.update(variant_idx=j, exit=GRID[j], mean=mu, ci=[lo, hi], mean_nofee=float(Ms_nf[:, j].mean()),
               win=float((Ms[:, j] > 0).mean()), median=float(np.median(Ms[:, j])),
               all_exits_mean=[float(x) for x in Ms.mean(0)], opp_side_same_exit=float(Mo[:, j].mean()))
    # shuffled-side null (selection-aware when not frozen)
    rng = np.random.default_rng(11)
    nb = []; npass = 0
    for i in range(n_perm):
        flip = rng.random(len(tr)) < 0.5
        Mn = np.where(flip[:, None], Mo, Ms)
        if frozen is None:
            jn = int(np.argmax(Mn.mean(0)))
        else:
            jn = j
        nb.append(Mn[:, jn].mean())
        if i < 100:
            m_, l_, _ = cluster_ci(Mn[:, jn], sess, B=400, seed=i)
            npass += (m_ > 0) & (l_ > 0)
    nb = np.array(nb)
    res['shuffle_beats'] = float((nb < mu).mean()); res['shuffle_null_ci_pass'] = npass / 100
    # synthetic zero-drift null
    sp = 0; sm = []
    for i in range(n_syn):
        Mz = synthetic(tr, np.random.default_rng(500 + i))
        jz = int(np.argmax(Mz.mean(0))) if frozen is None else j
        m_, l_, _ = cluster_ci(Mz[:, jz], sess, B=400, seed=i)
        sm.append(m_); sp += (m_ > 0) & (l_ > 0)
    res['synthetic_null_ci_pass'] = sp / n_syn; res['synthetic_beats'] = float((np.array(sm) < mu).mean())
    res['synthetic_mean_of_best'] = float(np.mean(sm))
    if frozen is None and len(tr) > 40:
        res['pbo'] = pbo_cscv(Ms, sess, 16)
    res['dsr_trials_global_est'] = None
    passed = bool(mu > 0 and lo > 0 and res['shuffle_beats'] >= 0.95)
    res['pass'] = passed
    json.dump(res, open(f'{DATA}/stageB_{variant}_{split}.json', 'w'), indent=1, default=float)
    print(json.dumps({k: v for k, v in res.items() if k != 'all_exits_mean'}, default=float, indent=1))
    print('all exits mean:', np.round(Ms.mean(0), 4).tolist())
    return res


if __name__ == '__main__':
    cmd, v, s = sys.argv[1:4]
    if cmd == 'fetch':
        do_fetch(v, s)
    else:
        do_run(v, s, sys.argv[4] if len(sys.argv) > 4 else None)
