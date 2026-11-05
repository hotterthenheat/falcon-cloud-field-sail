"""S4 — mechanism check (PREREG): does the SPXW GTH quote lag the parity-implied spot after a move?

  python3 s4.py lag DEV SPXW [XSP]     S4a/S4d: y_h = ln(mid_{t+h}/mid_t) of the 0.15-delta option on the move's side,
                                       on x1 = the move already made and x2 = the contemporaneous move; clustered SEs
  python3 s4.py stale DEV SPXW [XSP]   S4b: unchanged-NBBO share, spread/mid by hour, re-quote rate after >= 0.10% moves
  python3 s4.py attrib                 S4c: greeks attribution of K5's DEV calls (challenger rows, DEV days only)
"""
from __future__ import annotations

import json
import math
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import overnight as O  # noqa: E402

OUT = os.path.join(C.DATA, 'results')
os.makedirs(OUT, exist_ok=True)
WINDOWS = {'evening': (-225, -10), 'after_midnight': (0, 355), 'morning': (360, 540)}
H = (5, 15, 30)
BAND, CAP = (0.10, 0.20, 0.15), 0.08


def contract_mid(N: O.Night, sel, t):
    c = N.chains[sel['exp']]
    q = c[(c.k == sel['k']) & (c.r == (1 if sel['call'] else 0)) & (c.t == t) & (c.bid > 0) & (c.ask > 0)]
    if not len(q):
        return float('nan'), float('nan'), float('nan')
    return float((q.bid.iloc[0] + q.ask.iloc[0]) / 2), float(q.ask.iloc[0]), float(q.bid.iloc[0])


def lag_rows(root, days):
    rows = []
    for d in days:
        N = O.Night(root, d)
        if not N.ok or not np.isfinite(N.pc):
            continue
        for wname, (a, b) in WINDOWS.items():
            for t in range(a, b + 1, O.STEP):
                S0, Sm = N.parity(t), N.parity(t - 5)
                if not (np.isfinite(S0) and np.isfinite(Sm)):
                    continue
                m1 = math.log(S0 / Sm)
                g = math.log(S0 / N.pc)
                for sig, val in (('move5', m1), ('overnight', g)):
                    if val == 0 or not np.isfinite(val):
                        continue
                    side = 1 if val > 0 else -1
                    sel = N.select(t, side, BAND, CAP)
                    if sel is None:
                        continue
                    mid0, ask0, bid0 = contract_mid(N, sel, t)
                    if not (mid0 > 0):
                        continue
                    lev = sel['delta'] * sel['S'] / mid0            # d ln(mid) per unit spot return (BS, first order)
                    rec = dict(session=d, root=root, window=wname, sig=sig, t=t, x1=abs(val), side=side, delta=sel['delta'],
                               spr=sel['spr'], mid0=mid0, lev=lev)
                    for h in H:
                        Sh = N.parity(t + h)
                        midh, askh, bidh = contract_mid(N, sel, t + h)
                        if np.isfinite(Sh) and midh > 0:
                            rec[f'y{h}'] = math.log(midh / mid0)
                            rec[f'ya{h}'] = math.log(askh / ask0) if ask0 > 0 and askh > 0 else np.nan
                            rec[f'yb{h}'] = math.log(bidh / ask0) if ask0 > 0 and bidh > 0 else np.nan   # what a buyer at the ask could sell for
                            rec[f'x2_{h}'] = side * math.log(Sh / S0)
                        else:
                            rec[f'y{h}'] = rec[f'ya{h}'] = rec[f'yb{h}'] = rec[f'x2_{h}'] = np.nan
                    rows.append(rec)
    return pd.DataFrame(rows)


def ols_cluster(y, X, cl):
    """OLS with an intercept and cluster-robust (by cl) standard errors. Returns coef, se."""
    X = np.column_stack([np.ones(len(y)), X])
    ok = np.isfinite(y) & np.isfinite(X).all(1)
    y, X, cl = y[ok], X[ok], np.asarray(cl)[ok]
    if len(y) < 30:
        return None
    XtX_inv = np.linalg.pinv(X.T @ X)
    beta = XtX_inv @ X.T @ y
    e = y - X @ beta
    keys, inv = np.unique(cl, return_inverse=True)
    meat = np.zeros((X.shape[1], X.shape[1]))
    for g in range(len(keys)):
        m = inv == g
        s = X[m].T @ e[m]
        meat += np.outer(s, s)
    G = len(keys)
    V = XtX_inv @ meat @ XtX_inv * (G / (G - 1))
    return beta, np.sqrt(np.diag(V)), int(len(y)), G


def lag_report(df: pd.DataFrame) -> list[dict]:
    out = []
    for (root, w, sig), g in df.groupby(['root', 'window', 'sig']):
        for h in H:
            for ycol, lab in ((f'y{h}', 'mid'), (f'ya{h}', 'ask'), (f'yb{h}', 'bid_vs_ask')):
                y = g[ycol].to_numpy(float)
                X = g[['x1', f'x2_{h}']].to_numpy(float)
                r = ols_cluster(y, X, g.session.to_numpy())
                if r is None:
                    continue
                b, se, n, G = r
                # the residual not explained by the contemporaneous move at the BS leverage: y - lev * x2
                yr = y - g['lev'].to_numpy(float) * g[f'x2_{h}'].to_numpy(float)
                rr = ols_cluster(yr, g[['x1']].to_numpy(float), g.session.to_numpy())
                out.append(dict(root=root, window=w, signal=sig, h=h, y=lab, n=n, sessions=G,
                                b1=b[1], se1=se[1], t1=b[1] / se[1] if se[1] > 0 else np.nan,
                                b2=b[2], se2=se[2], ratio=b[1] / b2 if (b2 := b[2]) else np.nan,
                                resid_b1=rr[0][1] if rr else np.nan, resid_t1=(rr[0][1] / rr[1][1]) if rr and rr[1][1] > 0 else np.nan,
                                mean_x1=float(np.nanmean(g.x1)), mean_y=float(np.nanmean(y))))
    return out


def stale(root, days):
    rows = []
    for d in days:
        N = O.Night(root, d)
        if not N.ok:
            continue
        c = N.chains[N.exps[0]].sort_values(['k', 'r', 't'])
        c = c[(c.bid > 0) & (c.ask > c.bid)]
        same = (c.k.values[1:] == c.k.values[:-1]) & (c.r.values[1:] == c.r.values[:-1]) & (c.t.values[1:] == c.t.values[:-1] + 1)
        unch = (c.bid.values[1:] == c.bid.values[:-1]) & (c.ask.values[1:] == c.ask.values[:-1]) & same
        hour = ((c.t.values[1:] % 1440) // 60)
        spr = ((c.ask.values[1:] - c.bid.values[1:]) / ((c.ask.values[1:] + c.bid.values[1:]) / 2))
        for hr in np.unique(hour[same]):
            m = same & (hour == hr)
            rows.append(dict(session=d, root=root, hour=int(hr), minutes=int(m.sum()), unchanged=float(unch[m].mean()),
                             spread=float(np.median(spr[m]))))
        # re-quote after a >= 0.10% parity move over 5 minutes: did the 0.15-delta contract's NBBO change inside those 5 min?
        for wname, (a, b) in WINDOWS.items():
            for t in range(a + 5, b + 1, O.STEP):
                S0, Sm = N.parity(t), N.parity(t - 5)
                if not (np.isfinite(S0) and np.isfinite(Sm)):
                    continue
                m1 = math.log(S0 / Sm)
                if abs(m1) < 0.001:
                    continue
                side = 1 if m1 > 0 else -1
                sel = N.select(t - 5, side, BAND, CAP)
                if sel is None:
                    continue
                q = N.chains[sel['exp']]
                q = q[(q.k == sel['k']) & (q.r == (1 if sel['call'] else 0)) & (q.t >= t - 5) & (q.t <= t + 15)].sort_values('t')
                if len(q) < 3:
                    continue
                b0, a0 = float(q.bid.iloc[0]), float(q.ask.iloc[0])
                ch = (q.bid.values != b0) | (q.ask.values != a0)
                tq = q.t.values
                first = tq[np.argmax(ch)] - (t - 5) if ch.any() else np.nan
                rows.append(dict(session=d, root=root, window=wname, t=t, move=m1, requote_min=first,
                                 requoted_5=bool(((tq <= t) & ch).any()), requoted_15=bool(ch.any()), kind='requote'))
    return pd.DataFrame(rows)


def attrib():
    """K5's calls on the DEV days of the challenger rows (never a locked day), with the rows' greeks attribution."""
    chal = '/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a3673bb87994bc8be/slayer/research/challenger'
    sys.path.insert(0, chal)
    import common as CC  # noqa: E402  (the challenger's)
    import books as B  # noqa: E402
    import candidates as K  # noqa: E402
    days = [d for d in CC.days_built() if C.split_of(d) == 'DEV']
    parts = []
    for d in days:
        x = CC.load_day(d, cache=False)
        x = x[(x['ticker'].astype(str) == 'SPXW') & (x['session'].astype(str) == 'overnight')]
        x = x[[c for c in x.columns if not (c.startswith('x') and c[1:].isdigit())]]
        parts.append(x)
    df = pd.concat(parts, ignore_index=True)
    for c in ('day', 'sleeve', 'ticker', 'contract', 'expiry', 'right', 'mark', 'session', 'whyA', 'whyR'):
        if c in df.columns:
            df[c] = df[c].astype(str).astype('category')

    class S(B.Sessions):
        def __init__(self):
            self.days = days
            self.df = df.reset_index(drop=True)
            self.fill = self.df['fill'].values.astype(float)
            self.pnl_prun, _ = CC.call_pnl(self.df, 'prun')
            self.pnl_ride, _ = CC.call_pnl(self.df, 'all')
            self.pnl_tp, _ = CC.call_pnl(self.df, 'none')
            self.engine = {}
            self.win = self.df['whyA'].astype(str).str.startswith('Take profit').values
            stop = 1 - 0.5322
            h50 = self.df['hit50'].values == 1
            wp = self.df['worstPre'].values.astype(float)
            fb = self.df['flatBid'].values.astype(float)
            self.win_hard = h50 & (wp > stop)
            r = np.where(self.win_hard, 0.5, np.where(wp <= stop, -0.5322, fb - 1))
            self.pnl_hard = r * self.fill * 100
    s = S()
    idx, _ = K.k5_overnight_spx_hard(s, np.ones(len(s.df), bool))
    cols = ['day', 'contract', 'mark', 'c14', 'fill', 'hit50', 'worstPre', 'flatBid', 'atS0', 'atS1', 'atIv0', 'atIv1', 'atMin',
            'atDelta', 'atGamma', 'atVega', 'atTheta', 'atResid', 'bid', 'ask']
    t = s.df.loc[idx, cols].copy()
    t['win'] = s.win_hard[idx]
    t['ret'] = s.pnl_hard[idx] / (s.fill[idx] * 100)
    t['mid_change'] = t[['atDelta', 'atGamma', 'atVega', 'atTheta', 'atResid']].sum(1)
    t['spot_move'] = t.atS1 / t.atS0 - 1
    t['iv_change'] = t.atIv1 - t.atIv0
    rep = {'days': len(days), 'n_calls': int(len(t)), 'win_rate': float(t.win.mean()), 'ret_mean': float(t.ret.mean())}
    for lab, m in (('wins', t.win), ('losses', ~t.win)):
        u = t[m & t.atDelta.notna()]
        if not len(u):
            continue
        tot = u.mid_change
        rep[lab] = {'n': int(len(u)), 'mid_change_mean': float(tot.mean()),
                    'share_delta': float((u.atDelta / tot).median()), 'share_gamma': float((u.atGamma / tot).median()),
                    'share_vega': float((u.atVega / tot).median()), 'share_theta': float((u.atTheta / tot).median()),
                    'share_resid': float((u.atResid / tot).median()),
                    'mean_delta': float(u.atDelta.mean()), 'mean_gamma': float(u.atGamma.mean()), 'mean_vega': float(u.atVega.mean()),
                    'mean_theta': float(u.atTheta.mean()), 'mean_resid': float(u.atResid.mean()),
                    'spot_move_median_pct': float(100 * u.spot_move.median()), 'iv_change_median': float(u.iv_change.median()),
                    'minutes_median': float(u.atMin.median())}
    t.to_csv(os.path.join(OUT, 's4c_k5_dev_attrib.csv'), index=False)
    return rep


def main():
    mode = sys.argv[1]
    if mode == 'attrib':
        rep = attrib()
        print(json.dumps(rep, indent=1, default=float))
        json.dump(rep, open(os.path.join(OUT, 's4c_attrib.json'), 'w'), indent=1, default=float)
        return
    split = sys.argv[2]
    roots = sys.argv[3:] or ['SPXW']
    days = C.raw_days(split, 'SPXW')
    for d in days:
        assert not C.is_locked(d)
    for root in roots:
        if mode == 'lag':
            f = os.path.join(OUT, f's4a_rows_{root}_{split}.parquet')
            df = pd.read_parquet(f) if os.path.exists(f) else lag_rows(root, days)
            df.to_parquet(f)
            rep = pd.DataFrame(lag_report(df))
            rep.to_csv(os.path.join(OUT, f's4a_lag_{root}_{split}.csv'), index=False)
            pd.set_option('display.width', 250)
            print(root, split, 'rows', len(df))
            print(rep[rep.y != 'bid_vs_ask'].to_string(index=False, float_format=lambda x: f'{x:.4g}'))
        elif mode == 'stale':
            df = stale(root, days)
            df.to_parquet(os.path.join(OUT, f's4b_rows_{root}_{split}.parquet'))
            hz = df[df.kind != 'requote'] if 'kind' in df else df
            by_hour = hz.groupby('hour').agg(minutes=('minutes', 'sum'), unchanged=('unchanged', 'mean'), spread=('spread', 'median'))
            print(root, split, '\n', by_hour.to_string(float_format=lambda x: f'{x:.3f}'))
            if 'kind' in df:
                rq = df[df.kind == 'requote']
                print(rq.groupby('window').agg(n=('t', 'size'), requoted_5=('requoted_5', 'mean'), requoted_15=('requoted_15', 'mean'),
                                               requote_min_median=('requote_min', 'median')).to_string(float_format=lambda x: f'{x:.3f}'))
                by_hour.to_csv(os.path.join(OUT, f's4b_hours_{root}_{split}.csv'))


if __name__ == '__main__':
    main()
