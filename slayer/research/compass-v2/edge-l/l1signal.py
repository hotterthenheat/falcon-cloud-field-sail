"""L1 signal table: per (root, session, T) the forecast F, the implied I, R = sqrt(F)/I and the contracts.

    python3 l1signal.py           -> v2data/edge-l/signals.parquet

Point in time: bars closed before T, the chain snapshot stamped T-60 s, the 09:30 gamma book; the HAR fit uses only
sessions whose target finished before the refit day (DEV: monthly expanding refits; VALIDATION: the all-DEV fit).
y_rv_rem (the realized remaining variance) is the OUTCOME: stored for fitting later days and for reporting only.
"""
import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from common import (EDGE, OUT, UND, BOOK, Clock, LookAhead, bars, book, chain, iv, bs_delta, split_of)  # noqa

TIMES = (9 * 3600 + 45 * 60, 10 * 3600 + 30 * 60)
CLOSE = 16 * 3600


def day_rv(b):
    px = np.concatenate([[b.o.iloc[0]], b.c.values])
    return float(np.sum(np.diff(np.log(px)) ** 2))


def features(root):
    B = bars(UND[root])
    sess = [d for d in json.load(open(os.path.join(EDGE, 'sessions.json'))) if d >= '2022-12-01']
    rv = {d: day_rv(B[d]) for d in sess if d in B and len(B[d]) >= 380}
    G = book(BOOK[root])
    rows = []
    for i, d in enumerate(sess):
        if split_of(d) not in ('DEV', 'VALIDATION') or d < '2023-01-01':
            continue
        if d not in B or d not in G or len(B[d]) < 380:
            continue
        prev = sess[max(0, i - 22):i]
        if len(prev) < 22 or prev[-1] not in rv:
            continue
        lag1 = rv[prev[-1]]
        w = [rv[p] for p in prev[-5:] if p in rv]
        m = [rv[p] for p in prev if p in rv]
        if len(w) < 4 or len(m) < 15:
            continue
        net, netz = G[d]
        if not np.isfinite(netz):
            continue
        ch = chain(root, d)
        if ch is None:
            continue
        b = B[d]
        for T in TIMES:
            ck = Clock(b, ch, T)
            vb = ck.bars_before()
            if len(vb) < (T - 34200) // 60:
                continue
            px = np.concatenate([[vb.o.iloc[0]], vb.c.values])
            rv_sofar = float(np.sum(np.diff(np.log(px)) ** 2))
            snap = ck.snap_before()
            info = implied(snap, T)
            if info is None:
                continue
            side = 1 if vb.c.iloc[-1] > vb.o.iloc[0] else -1 if vb.c.iloc[-1] < vb.o.iloc[0] else 0
            # outcome (target), from the full session bars -- never an input of this row's forecast
            lb = b[b.m == T // 60 - 1]
            if not len(lb):
                continue
            last = lb.c.iloc[0]
            rest = b[b.m * 60 >= T]
            y = float(np.sum(np.diff(np.log(np.concatenate([[last], rest.c.values]))) ** 2))
            rows.append(dict(root=root, day=d, T=T, split=split_of(d), lag1=np.log(lag1), lagw=np.log(np.mean(w)),
                             lagm=np.log(np.mean(m)), sofar=np.log(max(rv_sofar, 1e-10)), neg=float(net < 0),
                             netz=float(np.clip(netz, -5, 5)), side=side, spot=float(vb.c.iloc[-1]),
                             open=float(vb.o.iloc[0]), y_rv_rem=y, **info))
    return pd.DataFrame(rows)


def implied(snap, T):
    s = snap[(snap.bid > 0) & (snap.ask > 0)]
    if len(s) < 6:
        return None
    c = s[s.r == 1].set_index('k')
    p = s[s.r == 0].set_index('k')
    ks = sorted(set(c.index) & set(p.index))
    if not ks:
        return None
    cm, pm = (c.bid + c.ask) / 2, (p.bid + p.ask) / 2
    # parity spot from the strike with the smallest |C - P|
    k0 = min(ks, key=lambda k: abs(cm[k] - pm[k]))
    S = float(k0 + cm[k0] - pm[k0])
    K = min(ks, key=lambda k: abs(k - S))
    tau = (CLOSE - (T - 60)) / (365 * 86400)
    ivc, ivp = iv(np.array([cm[K]]), S, np.array([K]), tau, np.array([True]))[0], \
        iv(np.array([pm[K]]), S, np.array([K]), tau, np.array([False]))[0]
    if not (np.isfinite(ivc) and np.isfinite(ivp)):
        return None
    sig = 0.5 * (ivc + ivp)
    dC = float(bs_delta(S, K, tau, ivc, True))
    dP = float(bs_delta(S, K, tau, ivp, False))
    out = dict(S_par=S, K_atm=float(K), iv_atm=float(sig), I=float(sig * np.sqrt(tau)), tau=tau,
               c_bid=float(c.bid[K]), c_ask=float(c.ask[K]), c_as=int(c['as'][K]), dC=dC,
               p_bid=float(p.bid[K]), p_ask=float(p.ask[K]), p_as=int(p['as'][K]), dP=dP)
    # directional candidates: nearest 0.35 within 0.30-0.40, spread <= 8%, ask size >= 1
    for name, side_df, is_call in (('dc', c, True), ('dp', p, False)):
        best = None
        for k, r in side_df.iterrows():
            mid = (r.bid + r.ask) / 2
            if r.bid <= 0 or (r.ask - r.bid) > 0.08 * mid or r['as'] < 1:
                continue
            v = iv(np.array([mid]), S, np.array([k]), tau, np.array([is_call]))[0]
            if not np.isfinite(v):
                continue
            dl = abs(float(bs_delta(S, k, tau, v, is_call)))
            if 0.30 <= dl <= 0.40 and (best is None or abs(dl - 0.35) < abs(best[1] - 0.35)):
                best = (float(k), dl, float(r.ask), float(r.bid))
        out[name + '_k'] = best[0] if best else np.nan
        out[name + '_d'] = best[1] if best else np.nan
    return out


def fit_forecast(df):
    """Walk-forward HAR x gamma forecast. Adds F (forecast remaining variance) and R."""
    X_cols = ['lag1', 'lagw', 'lagm', 'sofar', 'neg', 'netz']
    df = df.sort_values(['root', 'T', 'day']).reset_index(drop=True)
    df['F'] = np.nan
    df['coef'] = None
    for (root, T), g in df.groupby(['root', 'T']):
        dev = g[g.split == 'DEV']
        months = sorted(set(g.day.str[:7]))
        for mo in months:
            idx = g.index[g.day.str[:7] == mo]
            if split_of(g.loc[idx[0], 'day']) == 'VALIDATION' or mo >= '2025-01':
                tr = dev
            else:
                tr = dev[dev.day < mo + '-01']
            if len(tr) < 60:
                continue
            X = np.column_stack([np.ones(len(tr)), tr[X_cols].values])
            yv = np.log(tr.y_rv_rem.values)
            beta, *_ = np.linalg.lstsq(X, yv, rcond=None)
            s2 = float(np.var(yv - X @ beta, ddof=X.shape[1]))
            Xn = np.column_stack([np.ones(len(idx)), df.loc[idx, X_cols].values])
            df.loc[idx, 'F'] = np.exp(Xn @ beta + s2 / 2)
            for i in idx:
                df.at[i, 'coef'] = json.dumps([round(float(x), 4) for x in beta])
    df['R'] = np.sqrt(df.F) / df.I
    df['real_over_imp'] = np.sqrt(df.y_rv_rem) / df.I
    return df


def main():
    raw = os.path.join(OUT, 'features_raw.parquet')
    if not os.path.exists(raw):
        pd.concat([features(r) for r in ('SPY', 'QQQ', 'SPXW')], ignore_index=True).to_parquet(raw)
    f = pd.read_parquet(raw)
    f = f[f.y_rv_rem > 0]
    df = fit_forecast(f)
    os.makedirs(OUT, exist_ok=True)
    df.to_parquet(os.path.join(OUT, 'signals.parquet'))
    print(df.groupby(['root', 'T', 'split']).agg(n=('R', 'size'), nF=('F', 'count'), R_med=('R', 'median'),
                                                   R_p90=('R', lambda x: x.quantile(.9))).to_string())


if __name__ == '__main__':
    main()
