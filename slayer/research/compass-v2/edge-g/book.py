"""EDGE-G point-in-time history book (PREREG "The book"), one read per minute 09:46..15:00 per root-session.

  python3 book.py run [workers]        build v2data/edge-g/book/<ROOT>/<D>.npz for every DEV root-session (resumable)
  python3 book.py one SPY 2024-03-15   build one and print a summary

A read at decision second t sees: bars with start <= t - 60 (spot S_t = close of the bar starting t//60 - 1), the 0DTE
chain quote stamped (t - 60)//60 (IV solved at its mid against the close of the bar before, the price at that stamp),
the morning OI report of D, and the PRIOR session's EOD IVs. Nothing later.
Stored per read: S, atm_iv, the held flip (stickFlip), the raw flip, every crossing, net at spot (ALL, house sign) and
the FRONT net; at the marks 11:00/12:30/14:00 also the walls and the per-(strike, expiry) legs within +-4% (for N3).
"""
import datetime as dt, json, math, os, sys, time
import numpy as np
import pandas as pd
from common import EDGE, OUT, ROOTS, YEAR_MIN, assert_open, calendar, dev_sessions, has_chain, prior_session, split_of
import gex

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'edge'))
import sim  # noqa: E402  (EDGE's chain/bars/BS helpers, read only)

READ_FROM = 9 * 3600 + 46 * 60
READ_TO = 15 * 3600
MARKS = (11 * 3600, 12 * 3600 + 30 * 60, 14 * 3600)
STRIKE_BAND = 0.12
MAX_E = 31
BOOK = os.path.join(OUT, 'book')
_EXP = {}


class Pending(Exception):
    """A fetched input is not there yet (try again later; nothing written)."""


def expirations(root):
    if root not in _EXP:
        _EXP[root] = sorted(json.load(open(os.path.join(EDGE, f'exp_{root}.json'))))
    return _EXP[root]


def next_expiry(root, day):
    """The first expiry after the session (the 1-7 DTE cell), or None if > 7 calendar days out."""
    ex = expirations(root)
    i = int(np.searchsorted(ex, day, side='right'))
    if i >= len(ex):
        return None
    e = ex[i]
    return e if (dt.date.fromisoformat(e) - dt.date.fromisoformat(day)).days <= 7 else None


def nsess(a, b):
    """Sessions strictly after a up to and including b (calendar; weekdays past its end)."""
    c = calendar()
    if b <= a:
        return 0
    if b <= c[-1]:
        return int(np.searchsorted(c, b, side='right') - np.searchsorted(c, a, side='right'))
    n = int(np.searchsorted(c, c[-1], side='right') - np.searchsorted(c, a, side='right'))
    d = dt.date.fromisoformat(c[-1])
    end = dt.date.fromisoformat(b)
    while d < end:
        d += dt.timedelta(days=1)
        n += d.weekday() < 5
    return n


def session_before(day):
    c = calendar()
    i = int(np.searchsorted(c, day))
    if i < len(c) and c[i] == day:
        return c[i - 1]
    if i <= len(c) - 1:
        return c[i - 1]
    d = dt.date.fromisoformat(day) - dt.timedelta(days=1)
    while d.weekday() >= 5:
        d -= dt.timedelta(days=1)
    return d.isoformat()


def load_static(root, day):
    """OI legs of D (+ SPX AM root for SPXW), their static clock parts and prior-close vols."""
    assert_open(day)
    bars = sim.day_bars(root, day)
    if len(bars) < 300:
        return None
    open_ = float(bars.o.iloc[0])
    parts = []
    oi = pd.read_parquet(os.path.join(EDGE, 'oi', root, f'{day}.parquet'))
    oi['am'] = 0
    parts.append(oi)
    if root == 'SPXW':
        f = os.path.join(OUT, 'oi_spx', f'{day}.parquet')
        if not os.path.exists(f):
            raise Pending(f)
        a = pd.read_parquet(f)
        a = a[a.e > 0].copy()  # the AM monthly dated D settled at 09:30 (settle.ts amGone)
        a['am'] = 1
        parts.append(a)
    L = pd.concat(parts, ignore_index=True)
    L = L[(L.oi > 0) & (L.e <= MAX_E) & (np.abs(L.k / open_ - 1) <= STRIKE_BAND)].copy()
    d0 = dt.date.fromisoformat(day)
    p = prior_session(day)
    ns, ns_p, tcal = [], [], []
    cache = {}
    for e, am in zip(L.e.values, L.am.values):
        key = (int(e), int(am))
        if key not in cache:
            E = (d0 + dt.timedelta(days=int(e))).isoformat()
            last = session_before(E) if am else E
            n_d = nsess(day, last)
            n_p = nsess(p, last)
            days_p = (dt.date.fromisoformat(E) - dt.date.fromisoformat(p)).days
            tc = (days_p - (6.5 / 24 if am else 0.0)) / 365.0
            cache[key] = (n_d, n_p, tc)
        a, b, c = cache[key]
        ns.append(a); ns_p.append(b); tcal.append(c)
    L['ns'] = ns
    L['ns_p'] = ns_p
    L['tcal'] = tcal
    # prior-close vols (trading clock) for e > 0
    iv = np.zeros(len(L))
    own = np.zeros(len(L), bool)
    for am in (0, 1):
        sym = 'SPX' if am else root
        f = os.path.join(OUT, 'eod', sym, f'{day}.parquet')
        sel = (L.am.values == am) & (L.e.values > 0)
        if not sel.any():
            continue
        if not os.path.exists(f):
            raise Pending(f)
        E = pd.read_parquet(f)
        E = E[(E.iv > 0.01) & (E.iv < 5)]
        und = float(E.und.median()) if len(E) else open_
        idx = np.flatnonzero(sel)
        sub = L.iloc[idx]
        for e in np.unique(sub.e.values):
            ee = E[E.e == e]
            ii = idx[sub.e.values == e]
            if not len(ee):
                continue
            m = {(float(k), int(r)): float(v) for k, r, v in zip(ee.k.values, ee.r.values, ee.iv.values)}
            ks = sorted({float(k) for k in ee.k.values})
            civ = [m.get((k, 1), 0) for k in ks]
            piv = [m.get((k, 0), 0) for k in ks]
            sm = gex.smile_of(ks, civ, piv, und)
            for j in ii:
                k, r = float(L.k.values[j]), int(L.r.values[j])
                v = m.get((k, r), 0)
                if v > 0:
                    iv[j], own[j] = v, True
                else:
                    iv[j] = float(sm(k))
    # calendar vol -> trading clock at the prior close: sigma_cal * sqrt(T_cal / T_tr)
    t_tr_p = L.ns_p.values * 390.0 / YEAR_MIN
    conv = np.where((t_tr_p > 0) & (L.tcal.values > 0), np.sqrt(L.tcal.values / np.maximum(t_tr_p, 1e-12)), 1.0)
    L['iv_p'] = iv * conv
    L['own_p'] = own
    return {'bars': bars, 'open': open_, 'L': L.reset_index(drop=True)}


def board_ivs(root, day, m, S_q, T):
    """0DTE IVs at the chain stamp m (minute of day): dict (k, r) -> iv, the smile, ATM iv."""
    c = sim.chain(root, day)
    if c is None:
        return None
    b = c[(c.m == m) & (c.bid > 0) & (c.ask > c.bid)]
    if not len(b):
        return None
    mid = (b.bid.values + b.ask.values) / 2
    good = (b.ask.values - b.bid.values) / mid <= 0.40
    b, mid = b[good], mid[good]
    if not len(b):
        return None
    iv = sim.implied_vol(mid, S_q, b.k.values, T, b.r.values == 1)
    ok = np.isfinite(iv) & (iv > 0.01) & (iv < 5)
    d = {(float(k), int(r)): float(v) for k, r, v, o in zip(b.k.values, b.r.values, iv, ok) if o}
    if not d:
        return None
    ks = sorted({k for k, _ in d})
    sm = gex.smile_of(ks, [d.get((k, 1), 0) for k in ks], [d.get((k, 0), 0) for k in ks], S_q)
    katm = ks[int(np.argmin(np.abs(np.array(ks) - S_q)))]
    a = [d[(katm, r)] for r in (0, 1) if (katm, r) in d]
    return {'iv': d, 'smile': sm, 'atm': float(np.mean(a)) if a else float(sm(S_q))}


def read_legs(st, root, day, t):
    """The book's legs at decision second t (house sign, priced at S_t), plus S_t, atm iv, the per-leg arrays."""
    bars = st['bars']
    mb = t // 60 - 1            # the last closed bar (start <= t - 60)
    x = bars[bars.m <= mb]
    if not len(x) or int(x.m.iloc[-1]) < mb - 5:
        return None
    S = float(x.c.iloc[-1])
    xq = bars[bars.m <= mb - 1]
    S_q = float(xq.c.iloc[-1]) if len(xq) else float(x.o.iloc[-1])
    m = mb                      # chain stamp (t - 60)//60 in minutes of the day
    T0 = max(960 - m, 5) / YEAR_MIN
    bi = board_ivs(root, day, m, S_q, T0)
    if bi is None:
        return None
    L = st['L']
    e = L.e.values
    T = np.maximum((960 - m) + 390.0 * L.ns.values, 5) / YEAR_MIN
    iv = L.iv_p.values.copy()
    own = L.own_p.values.copy()
    z = (e == 0) & (L.am.values == 0)
    K = L.k.values.astype(float)
    R = L.r.values.astype(int)
    wing = np.zeros(len(L))
    if z.any():
        zi = np.flatnonzero(z)
        oiv = np.array([bi['iv'].get((float(K[j]), int(R[j])), 0.0) for j in zi])
        wing[zi] = bi['smile'](K[zi])
        iv[zi] = np.where(oiv > 0, oiv, wing[zi])
        own[zi] = oiv > 0
    iv = np.where(iv > 0, iv, bi['atm'])
    side = np.where(R == 1, -1.0, 1.0)  # house sign per contract (calls -1, puts +1)
    oi = L.oi.values.astype(float)
    g0 = side * oi * gex.dollar_gamma_per_contract(S, K, T, iv)
    if z.any():  # legsOfDate: same-day ITM runaway own vols scaled to the smile
        itm = np.where(R == 1, K < S, K > S)
        g2, iv2, own2 = gex.runaway_scale(g0[z], np.where(own[z], iv[z], 0.0), wing[z], S, K[z], T[z], itm[z])
        g0[z], iv[z], own[z] = g2, np.where(own[z], iv2, iv[z]), own[z] & own2
    legs = gex.make_legs(strike=K, g0=g0, iv=iv, t=T, s0=np.full(len(K), S), oi=oi, side=side, own=own)
    return {'S': S, 'atm': bi['atm'], 'legs': legs, 'front': z, 'e': e}


def walls_at(legs, S, front=None):
    """Per-strike dealer gamma (dealer sign = -house) re-priced at S: call/put walls, supreme, largest |net| above/below."""
    K = legs['strike']
    dealer = -legs['g0']
    ks = np.unique(K)
    c = np.zeros(len(ks)); p = np.zeros(len(ks))
    ix = np.searchsorted(ks, K)
    callleg = legs['side'] < 0
    np.add.at(c, ix[callleg], dealer[callleg])
    np.add.at(p, ix[~callleg], dealer[~callleg])
    w = gex.pick_leg_walls(ks, c, p)
    net = c + p
    sup = float(ks[int(np.argmax(np.abs(net)))]) if len(ks) else None
    inr = np.abs(ks / S - 1) <= 0.10
    up = inr & (ks > S)
    dn = inr & (ks < S)
    wu = float(ks[up][int(np.argmax(np.abs(net[up])))]) if up.any() else None
    wd = float(ks[dn][int(np.argmax(np.abs(net[dn])))]) if dn.any() else None
    return {'callWall': None if w['callWall'] is None else float(w['callWall']),
            'putWall': None if w['putWall'] is None else float(w['putWall']), 'supreme': sup, 'wall_up': wu, 'wall_dn': wd}


def build(root, day, write=True):
    f = os.path.join(BOOK, root, f'{day}.npz')
    if write and os.path.exists(f):
        return 'have'
    st = load_static(root, day)
    if st is None:
        if write:
            os.makedirs(os.path.dirname(f), exist_ok=True)
            np.savez_compressed(f + '.tmp.npz', ok=np.int8(0))
            os.replace(f + '.tmp.npz', f)
        return 'skip'
    stick = gex.StickFlip()
    rec = {k: [] for k in ('t', 'S', 'atm', 'flip_raw', 'flip', 'net_all', 'net_front', 'ncross')}
    cross_flat = []
    marks = {}
    for t in range(READ_FROM, READ_TO + 1, 60):
        rd = read_legs(st, root, day, t)
        if rd is None:
            continue
        legs = rd['legs']
        fr = gex.repriced_flip(legs, rd['S'], fast=True)
        held = stick.read(fr, rd['S'], t * 1000)
        rec['t'].append(t); rec['S'].append(rd['S']); rec['atm'].append(rd['atm'])
        rec['flip_raw'].append(np.nan if fr['flip'] is None else fr['flip'])
        rec['flip'].append(np.nan if held is None else held)
        rec['net_all'].append(fr['netAtSpot'])
        rec['net_front'].append(float(np.sum(legs['g0'][rd['front']])))
        rec['ncross'].append(len(fr['crossings']))
        cross_flat += list(fr['crossings'])
        if t in MARKS:
            w = walls_at(legs, rd['S'])
            # per-(strike, expiry) legs within +-4% for the N3 re-pricing: dealer net OI, mean iv, T
            sel = np.abs(legs['strike'] / rd['S'] - 1) <= 0.04
            key = legs['strike'][sel] * 1000 + rd['e'][sel]
            uk, inv = np.unique(key, return_inverse=True)
            noi = np.zeros(len(uk)); ivs = np.zeros(len(uk)); cnt = np.zeros(len(uk)); tt = np.zeros(len(uk)); kk = np.zeros(len(uk))
            np.add.at(noi, inv, -legs['side'][sel] * legs['oi'][sel])
            np.add.at(ivs, inv, legs['iv'][sel]); np.add.at(cnt, inv, 1)
            tt[inv] = legs['t'][sel]; kk[inv] = legs['strike'][sel]
            marks[t] = {**w, 'k': kk.astype(np.float32), 'noi': noi.astype(np.float32),
                        'iv': (ivs / np.maximum(cnt, 1)).astype(np.float32), 'T': tt.astype(np.float32)}
    out = {'ok': np.int8(1), 'open': np.float64(st['open'])}
    for k, v in rec.items():
        out[k] = np.array(v, np.float64 if k not in ('t', 'ncross') else np.int32)
    out['cross'] = np.array(cross_flat, np.float64)
    for t, mk in marks.items():
        for k, v in mk.items():
            out[f'm{t}_{k}'] = np.array(np.nan if v is None else v) if not isinstance(v, np.ndarray) else v
    if write:
        os.makedirs(os.path.dirname(f), exist_ok=True)
        np.savez_compressed(f + '.tmp.npz', **out)
        os.replace(f + '.tmp.npz', f)
        return 'ok'
    return out


def _worker(args):
    root, day = args
    try:
        return root, day, build(root, day)
    except Pending:
        return root, day, 'pending'
    except Exception as e:  # noqa: BLE001
        return root, day, f'error {e!r}'[:200]


def main():
    if sys.argv[1] == 'dumplegs':  # parity (A): history books for the TS comparison
        scr = '/tmp/claude-0/-home-user/f71fb141-33a0-5344-9573-1a2ad4706812/scratchpad'
        for root, day, hhmm in [a.split(':') for a in sys.argv[2:]]:
            st = load_static(root, day)
            t = int(hhmm[:2]) * 3600 + int(hhmm[2:]) * 60
            rd = read_legs(st, root, day, t)
            np.savez(os.path.join(scr, f'edgeg_hist_book_{root}_{day}_{hhmm}.npz'), spot=rd['S'], **rd['legs'])
        return
    if sys.argv[1] == 'one':
        t0 = time.time()
        out = build(sys.argv[2], sys.argv[3], write=False)
        print(f'{time.time() - t0:.1f}s', {k: (v.shape if hasattr(v, 'shape') else v) for k, v in out.items()} if isinstance(out, dict) else out)
        if isinstance(out, dict):
            for i in range(0, len(out['t']), 30):
                print(out['t'][i] // 60, round(out['S'][i], 2), round(out['flip'][i], 2), round(out['flip_raw'][i], 2), f"{out['net_all'][i]:.3g}", f"{out['net_front'][i]:.3g}", out['ncross'][i], round(out['atm'][i], 3))
        return
    from multiprocessing import Pool
    nw = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    alljobs = [(r, d) for d in dev_sessions() for r in ROOTS if has_chain(r, d)]
    rng = np.random.default_rng(20261106)
    alljobs = [alljobs[i] for i in rng.permutation(len(alljobs))]
    while True:
        jobs = [j for j in alljobs if not os.path.exists(os.path.join(BOOK, j[0], f'{j[1]}.npz'))]
        if not jobs:
            break
        n_pending = _pass(jobs, nw)
        if n_pending == 0:
            break
        time.sleep(120)
    print('all done', flush=True)


def _pass(jobs, nw):
    from multiprocessing import Pool
    done = 0
    t0 = time.time()
    res = {}
    with Pool(nw) as pool:
        for root, day, r in pool.imap_unordered(_worker, jobs):
            done += 1
            kk = r if not r.startswith('error') else 'error'
            res[kk] = res.get(kk, 0) + 1
            if r.startswith('error'):
                print('ERR', root, day, r, flush=True)
            if done % 50 == 0:
                print(time.strftime('%H:%M:%S'), done, len(jobs), res, f'{time.time() - t0:.0f}s', flush=True)
    print('pass done', res, flush=True)
    return res.get('pending', 0)


if __name__ == '__main__':
    main()
