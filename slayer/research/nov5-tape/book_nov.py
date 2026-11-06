"""Point-in-time SPXW gamma book for a NOV5 study day (2026-11-04 / 2026-11-05), built EXACTLY as EDGE-G's history book
(compass-v2/edge-g/book.py @ 2ca62d0, PREREG "The book") so that the study days and the DEV books (v2data/edge-g/book/
SPXW/*.npz, read-only) are the same quantity:

  - OI: the morning report of D (= prior close), SPXW every expiry D..D+31 days + the SPX AM monthlies (gone at 09:30 of
    their date), strikes within +-12% of the 09:30 open;
  - vols: 0DTE = IV solved at the 1-minute chain mid stamped (t-60)//60 against the close of the bar before (EDGE sim's
    implied_vol on the trading clock); other expiries = the PRIOR session's EOD IV (or its EOD smile), moved onto the
    trading clock; missing -> ATM;
  - dealer sign: dealers long calls / short puts (core/dealerSign.ts); house sign = negative of dealer gamma;
  - flip = gex.repriced_flip (port of core/gammaFlip.ts, parity-tested in EDGE-G) with flipLevel.ts stickFlip
    hysteresis; walls = core/walls.ts pickLegWalls + levelsOfRows' supreme, re-priced at S_t.
A read at decision second t sees bars with start <= t-60, the chain stamp (t-60)//60, the morning OI and the prior EOD.

  python3 book_nov.py 20261105     -> v2data/nov5-tape/<D>/book.parquet (one read a minute 09:46..15:59)
"""
import datetime as dt, math, os, sys
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'compass-v2', 'edge'))
import gex  # noqa: E402  (byte copy of edge-g/gex.py @ 2ca62d0, sha256 5546828f...)
import sim as esim  # noqa: E402  (EDGE BS helpers, read-only)
import load  # noqa: E402

YEAR_MIN = 390.0 * 252
STRIKE_BAND = 0.12
MAX_E = 31
HOLIDAYS = {'2026-11-26', '2026-12-25'}
PRIOR = {'20261105': '20261104', '20261104': '20261103'}


def sessions_between(a, b):
    """Sessions strictly after a up to and including b (weekdays minus NYSE holidays)."""
    da, db = dt.date.fromisoformat(a), dt.date.fromisoformat(b)
    n = 0
    d = da
    while d < db:
        d += dt.timedelta(days=1)
        n += d.weekday() < 5 and d.isoformat() not in HOLIDAYS
    return n


def session_before(day):
    d = dt.date.fromisoformat(day) - dt.timedelta(days=1)
    while d.weekday() >= 5 or d.isoformat() in HOLIDAYS:
        d -= dt.timedelta(days=1)
    return d.isoformat()


def iso(D):
    return f'{D[:4]}-{D[4:6]}-{D[6:]}'


def load_static(D):
    day = iso(D)
    p = iso(PRIOR[D])
    b = load.bars(D)
    open_ = float(b.o.iloc[0])
    d0 = dt.date.fromisoformat(day)
    o = load.oi(D)
    o = o.assign(e=[(dt.date(int(str(x)[:4]), int(str(x)[4:6]), int(str(x)[6:])) - d0).days for x in o.exp], am=0)
    a = pd.read_parquet(os.path.join(load.ddir(D), 'oi_spx_am.parquet'))
    a = a.assign(e=[(dt.date(int(str(x)[:4]), int(str(x)[4:6]), int(str(x)[6:])) - d0).days for x in a.exp], am=1)
    a = a[a.e > 0]
    L = pd.concat([o[['e', 'k', 'r', 'oi', 'am']], a[['e', 'k', 'r', 'oi', 'am']]], ignore_index=True)
    L = L[(L.oi > 0) & (L.e >= 0) & (L.e <= MAX_E) & (np.abs(L.k / open_ - 1) <= STRIKE_BAND)].copy()
    ns, ns_p, tcal = [], [], []
    cache = {}
    for e, am in zip(L.e.values, L.am.values):
        key = (int(e), int(am))
        if key not in cache:
            E = (d0 + dt.timedelta(days=int(e))).isoformat()
            last = session_before(E) if am else E
            days_p = (dt.date.fromisoformat(E) - dt.date.fromisoformat(p)).days
            cache[key] = (sessions_between(day, last), sessions_between(p, last), (days_p - (6.5 / 24 if am else 0.0)) / 365.0)
        x, y, z = cache[key]
        ns.append(x); ns_p.append(y); tcal.append(z)
    L['ns'], L['ns_p'], L['tcal'] = ns, ns_p, tcal
    iv = np.zeros(len(L))
    own = np.zeros(len(L), bool)
    for am in (0, 1):
        E = pd.read_parquet(os.path.join(load.ddir(D), f'eodgreeks_prior_{"SPX" if am else "SPXW"}.parquet'))
        E = E.assign(e=[(dt.date(int(str(x)[:4]), int(str(x)[4:6]), int(str(x)[6:])) - d0).days for x in E.exp])
        E = E[(E.iv > 0.01) & (E.iv < 5)]
        und = float(E.und.median()) if len(E) else open_
        sel = (L.am.values == am) & (L.e.values > 0)
        idx = np.flatnonzero(sel)
        sub = L.iloc[idx]
        for e in np.unique(sub.e.values):
            ee = E[E.e == e]
            ii = idx[sub.e.values == e]
            if not len(ee):
                continue
            m = {(float(k), int(r)): float(v) for k, r, v in zip(ee.k.values, ee.r.values, ee.iv.values)}
            ks = sorted({float(k) for k in ee.k.values})
            sm = gex.smile_of(ks, [m.get((k, 1), 0) for k in ks], [m.get((k, 0), 0) for k in ks], und)
            for j in ii:
                k, r = float(L.k.values[j]), int(L.r.values[j])
                v = m.get((k, r), 0)
                if v > 0:
                    iv[j], own[j] = v, True
                else:
                    iv[j] = float(sm(k))
    t_tr_p = L.ns_p.values * 390.0 / YEAR_MIN
    conv = np.where((t_tr_p > 0) & (L.tcal.values > 0), np.sqrt(L.tcal.values / np.maximum(t_tr_p, 1e-12)), 1.0)
    L['iv_p'] = iv * conv
    L['own_p'] = own
    ch = load.chain(D)
    return {'bars': b, 'open': open_, 'L': L.reset_index(drop=True), 'chain': ch[['m', 'k', 'r', 'bid', 'ask']]}


def board_ivs(ch, m, S_q, T):
    b = ch[(ch.m == m) & (ch.bid > 0) & (ch.ask > ch.bid)]
    if not len(b):
        return None
    mid = (b.bid.values + b.ask.values) / 2
    good = (b.ask.values - b.bid.values) / mid <= 0.40
    b, mid = b[good], mid[good]
    if not len(b):
        return None
    iv = esim.implied_vol(mid, S_q, b.k.values, T, b.r.values == 1)
    ok = np.isfinite(iv) & (iv > 0.01) & (iv < 5)
    d = {(float(k), int(r)): float(v) for k, r, v, o in zip(b.k.values, b.r.values, iv, ok) if o}
    if not d:
        return None
    ks = sorted({k for k, _ in d})
    sm = gex.smile_of(ks, [d.get((k, 1), 0) for k in ks], [d.get((k, 0), 0) for k in ks], S_q)
    katm = ks[int(np.argmin(np.abs(np.array(ks) - S_q)))]
    a = [d[(katm, r)] for r in (0, 1) if (katm, r) in d]
    return {'iv': d, 'smile': sm, 'atm': float(np.mean(a)) if a else float(sm(S_q))}


def read_legs(st, t):
    bars = st['bars']
    mb = t // 60 - 1
    x = bars[bars.m <= mb]
    if not len(x) or int(x.m.iloc[-1]) < mb - 5:
        return None
    S = float(x.c.iloc[-1])
    xq = bars[bars.m <= mb - 1]
    S_q = float(xq.c.iloc[-1]) if len(xq) else float(x.o.iloc[-1])
    m = mb
    T0 = max(960 - m, 5) / YEAR_MIN
    bi = board_ivs(st['chain'], m, S_q, T0)
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
    side = np.where(R == 1, -1.0, 1.0)
    oi = L.oi.values.astype(float)
    g0 = side * oi * gex.dollar_gamma_per_contract(S, K, T, iv)
    if z.any():
        itm = np.where(R == 1, K < S, K > S)
        g2, iv2, own2 = gex.runaway_scale(g0[z], np.where(own[z], iv[z], 0.0), wing[z], S, K[z], T[z], itm[z])
        g0[z], iv[z], own[z] = g2, np.where(own[z], iv2, iv[z]), own[z] & own2
    legs = gex.make_legs(strike=K, g0=g0, iv=iv, t=T, s0=np.full(len(K), S), oi=oi, side=side, own=own)
    return {'S': S, 'atm': bi['atm'], 'legs': legs, 'front': z, 'e': e}


def walls_at(legs, S, mask=None):
    """Per-strike dealer gamma re-priced at S (edge-g walls_at): call/put walls, supreme, largest |net| above/below."""
    if mask is not None:
        legs = gex.subset(legs, mask)
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
    sup = float(ks[int(np.argmax(np.abs(net)))]) if len(ks) else np.nan
    inr = np.abs(ks / S - 1) <= 0.10
    up, dn = inr & (ks > S), inr & (ks < S)
    wu = float(ks[up][int(np.argmax(np.abs(net[up])))]) if up.any() else np.nan
    wd = float(ks[dn][int(np.argmax(np.abs(net[dn])))]) if dn.any() else np.nan
    return {'callWall': float(w['callWall']) if w['callWall'] is not None else np.nan,
            'putWall': float(w['putWall']) if w['putWall'] is not None else np.nan, 'supreme': sup,
            'wall_up': wu, 'wall_dn': wd}


def build(D, t_from=9 * 3600 + 46 * 60, t_to=15 * 3600 + 59 * 60):
    st = load_static(D)
    stick = gex.StickFlip()
    stick_f = gex.StickFlip()
    rows = []
    for t in range(t_from, t_to + 1, 60):
        rd = read_legs(st, t)
        if rd is None:
            continue
        legs = rd['legs']
        fr = gex.repriced_flip(legs, rd['S'], fast=True)
        held = stick.read(fr, rd['S'], t * 1000)
        fl = gex.subset(legs, rd['front'])
        ff = gex.repriced_flip(fl, rd['S'], fast=True)
        held_f = stick_f.read(ff, rd['S'], t * 1000)
        w = walls_at(legs, rd['S'])
        wf = walls_at(legs, rd['S'], rd['front'])
        rows.append({'t': t, 'S': rd['S'], 'atm': rd['atm'], 'flip_raw': fr['flip'] if fr['flip'] is not None else np.nan,
                     'flip': held if held is not None else np.nan, 'net_all': fr['netAtSpot'],
                     'net_front': float(np.sum(legs['g0'][rd['front']])), 'ncross': len(fr['crossings']),
                     'flip_front': held_f if held_f is not None else np.nan,
                     **w, **{f'front_{k}': v for k, v in wf.items()}})
    return pd.DataFrame(rows)


if __name__ == '__main__':
    D = sys.argv[1]
    df = build(D)
    f = os.path.join(load.ddir(D), 'book.parquet')
    df.to_parquet(f + '.tmp', index=False)
    os.replace(f + '.tmp', f)
    pd.set_option('display.width', 250)
    print(df.iloc[::15][['t', 'S', 'atm', 'flip', 'flip_raw', 'net_all', 'net_front', 'flip_front', 'callWall', 'putWall',
                          'supreme', 'wall_up', 'wall_dn']].assign(t=lambda x: [load.clock(v) for v in x.t]).to_string())
