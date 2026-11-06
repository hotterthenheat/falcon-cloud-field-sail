"""Point-in-time features for one (day, root), one row per decision minute T = m*60; every value from data stamped
strictly before T (same visibility rules as nov5-tape/features.py):

  bars        closed 1-minute bars with start <= T-60 (S = close of bar m-1); underlying = SPX (SPXW) or stock NBBO mid
  board       the first expiry's 1-minute stamp m-1 (NBBO in force at that stamp), IV solved at its mid against the close
              of bar m-2 (EDGE convention), trading clock to 16:00 + whole sessions to the expiry (names: 1DTE)
  iv_next     the next expiry's ATM IV (index roots), same rules
  volume      1-minute OHLC (bars with start <= T-60): premium by side; tick prints [T-15m, T) signed by the NBBO in
              force at the print (+ at/above ask, - at/below bid)
  micro       ATM 1-second NBBO over [T-5m, T): mean relative spread, mean displayed size, quote changes per minute
  UW flow     alerts for the ticker (SPXW also SPX) published in [T-15m, T): DEV-comparable subset = premium >= $100k,
              OTM, <= 7 DTE, ask premium >= 50% ("chase" flow); all alerts' premium too
  headlines   UW headlines published in [T-30m, T)

  python3 bfeatures.py 20261105 SPXW,SPY,...  -> v2data/nov5-broad/<D>/<ROOT>/features.parquet
"""
import math, os, re, sys
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'compass-v2', 'edge'))
import bload as B  # noqa: E402
import sim as esim  # noqa: E402

YEAR_MIN = 390.0 * 252


def board_iv(b, S_q, m_stamp, extra_sessions=0):
    T = (max(960 - m_stamp, 1.0) + 390.0 * extra_sessions) / YEAR_MIN
    b = b[(b.bid > 0) & (b.ask > b.bid)]
    mid = (b.bid.values + b.ask.values) / 2
    iv = esim.implied_vol(mid, S_q, b.k.values.astype(float), T, b.r.values == 1)
    dl = np.abs(esim.bs_delta(S_q, b.k.values.astype(float), T, np.where(np.isfinite(iv), iv, 0.3), b.r.values == 1))
    return b.assign(mid=mid, ivs=iv, dabs=dl, spr=(b.ask.values - b.bid.values) / mid), T


def atm_iv(bb, S):
    ks = np.unique(bb.k.values[np.isfinite(bb.ivs.values)])
    if not len(ks):
        return np.nan, np.nan
    katm = ks[np.argmin(np.abs(ks - S))]
    v = bb.ivs.values[(bb.k.values == katm) & np.isfinite(bb.ivs.values)]
    return (float(np.mean(v)) if len(v) else np.nan), float(katm)


def iv_at_delta(bb, r, target):
    x = bb[(bb.r == r) & np.isfinite(bb.ivs) & (bb.spr <= 0.5)]
    if not len(x):
        return np.nan
    i = np.argmin(np.abs(x.dabs.values - target))
    return float(x.ivs.values[i]) if abs(x.dabs.values[i] - target) <= 0.08 else np.nan


def build(D, root):
    ex = B.expiries(D, root)
    e0 = ex[0]
    x0 = B.sessions_to_expiry(D, e0)
    bars = B.bars(D, root)
    S_by_m = dict(zip(bars.m.values, bars.c.values))
    open_ = float(bars.o.iloc[0])
    lr = np.diff(np.log(bars.c.values))
    ch = B.chain(D, root, e0)
    ch = ch[(ch.bid > 0) & (ch.ask > ch.bid)]
    fzf = os.path.join(B.rdir(D, root), 'frozen_1m.parquet')
    if os.path.exists(fzf):
        fz = pd.read_parquet(fzf)
        if len(fz):
            key = set(zip(fz.k.astype(float), fz.r.astype(int), fz.m.astype(int)))
            ch = ch[[(float(k), int(r), int(m)) not in key for k, r, m in zip(ch.k, ch.r, ch.m)]]
    chm = {m: g for m, g in ch.groupby('m')}
    nxt = None
    if len(ex) > 1 and root in ('SPY', 'QQQ', 'IWM', 'SPXW'):
        n1 = B.chain(D, root, ex[1])
        nxt = {m: g for m, g in n1[(n1.bid > 0) & (n1.ask > n1.bid)].groupby('m')}
        x1 = B.sessions_to_expiry(D, ex[1])
    oh = B.ohlc(D, root, e0)
    oh = oh.assign(prem=oh.vwap.fillna(oh.c) * oh.v * 100.0)
    tr = B.trades(D, root, e0)
    tr_ms = tr.ms.values if tr is not None else None
    fl = B.flow(D)
    tick = {'SPXW': ('SPXW', 'SPX')}.get(root, (root,))
    fl = fl[fl.ticker.isin(tick)].copy() if len(fl) else fl
    if len(fl):
        exp_d = pd.to_datetime(fl.expiry)
        dte = (exp_d - pd.Timestamp(f'{D[:4]}-{D[4:6]}-{D[6:]}')).dt.days
        otm = np.where(fl.type == 'call', fl.strike > fl.und, fl.strike < fl.und)
        fl['chase'] = (fl.prem >= 1e5) & otm & (dte <= 7) & (fl.ask_prem >= 0.5 * fl.prem)
    nw = B.news(D)
    # ATM 1-second microstructure: per minute, the contracts nearest the money at that minute
    rows = []
    for m in range(571, 961):
        T = m * 60
        mb = m - 1
        if mb not in S_by_m:
            continue
        S = float(S_by_m[mb])
        x = {'T': T, 'S': S, 'open': open_, 'from_open': math.log(S / open_)}
        for k in (5, 15, 30, 60):
            s0 = S_by_m.get(mb - k, np.nan) if mb - k >= 570 else open_
            x[f'r{k}'] = math.log(S / s0) if np.isfinite(s0) else np.nan
        n = mb - 570
        x['rv_so_far'] = float(np.std(lr[:n], ddof=1) * math.sqrt(YEAR_MIN)) if n >= 5 else np.nan
        x['rv30'] = float(np.std(lr[max(0, n - 30):n], ddof=1) * math.sqrt(YEAR_MIN)) if n >= 10 else np.nan
        sub = bars[bars.m <= mb]
        x['day_hi'], x['day_lo'] = float(sub.h.max()), float(sub.l.min())
        x['lo30'] = float(sub[sub.m > mb - 30].l.min()); x['hi30'] = float(sub[sub.m > mb - 30].h.max())
        S_q = float(S_by_m.get(mb - 1, open_))
        b = chm.get(mb)
        if b is not None and len(b):
            bb, _ = board_iv(b, S_q, mb, x0)
            x['atm_iv'], katm = atm_iv(bb, S_q)
            x['iv_p25'], x['iv_c25'] = iv_at_delta(bb, 0, 0.25), iv_at_delta(bb, 1, 0.25)
            x['iv_p10'], x['iv_c10'] = iv_at_delta(bb, 0, 0.10), iv_at_delta(bb, 1, 0.10)
            x['skew25'] = x['iv_p25'] - x['iv_c25']
            a = bb[bb.k == katm]
            x['atm_spr'] = float(a.spr.mean()) if len(a) else np.nan
            if np.isfinite(x['atm_iv']):
                for h in (30, 60):
                    x[f'em{h}'] = S * x['atm_iv'] * math.sqrt(h / YEAR_MIN)
                x['em_day'] = S * x['atm_iv'] * math.sqrt((max(960 - mb, 1) + 390.0 * x0) / YEAR_MIN)
        if nxt is not None and mb in nxt:
            bb2, _ = board_iv(nxt[mb], S_q, mb, x1)
            x['atm_iv_next'] = atm_iv(bb2, S_q)[0]
        # option volume (1-minute bars with start <= T-60), premium per side, last 15 minutes
        w15 = oh[(oh.m >= mb - 14) & (oh.m <= mb)]
        x['prem_p15'] = float(w15[w15.r == 0].prem.sum()); x['prem_c15'] = float(w15[w15.r == 1].prem.sum())
        x['vol_p15'] = int(w15[w15.r == 0].v.sum()); x['vol_c15'] = int(w15[w15.r == 1].v.sum())
        if tr is not None:
            a0, b0 = np.searchsorted(tr_ms, (T - 900) * 1000), np.searchsorted(tr_ms, T * 1000)
            w = tr.iloc[a0:b0]
            if len(w):
                pr = w.px.values * w['size'].values * 100.0
                sg = np.where(w.px.values >= w.ask.values, 1, np.where(w.px.values <= w.bid.values, -1, 0))
                for nm, rr in (('p', 0), ('c', 1)):
                    sel = w.r.values == rr
                    x[f'netprem_{nm}15'] = float((pr[sel] * sg[sel]).sum())
                    x[f'grossprem_{nm}15'] = float(pr[sel].sum())
                    # small-lot ("crowd") signed premium: prints of <= 10 contracts
                    sm = sel & (w['size'].values <= 10)
                    x[f'netprem_small_{nm}15'] = float((pr[sm] * sg[sm]).sum())
        if len(fl):
            f15 = fl[(fl.s >= T - 900) & (fl.s < T)]
            for nm, tp in (('p', 'put'), ('c', 'call')):
                g = f15[f15.type == tp]
                x[f'uw_{nm}15'] = float(g.prem.sum())
                x[f'uw_chase_{nm}15'] = float(g[g.chase].prem.sum())
                x[f'uw_sweep_{nm}15'] = int(g.sweep.sum())
        if len(nw):
            n30 = nw[(nw.s >= T - 1800) & (nw.s < T)]
            x['news30'] = len(n30)
            x['news_last'] = (B.clock(n30.s.iloc[-1]) + ' ' + n30.headline.iloc[-1][:100]) if len(n30) else ''
        rows.append(x)
    F = pd.DataFrame(rows)
    # 1-second microstructure of the ATM contracts (both sides): mean relative spread, mean displayed size, quote changes
    us, up = B.und_1s(D, root)
    mic = []
    q_cache = {}
    for r_ in F.itertuples():
        T = int(r_.T)
        ks = np.unique(ch.k.values)
        if not len(ks):
            break
        katm = float(ks[np.argmin(np.abs(ks - r_.S))])
        vals = []
        for rr in (0, 1):
            key = (katm, rr)
            if key not in q_cache:
                q_cache[key] = B.q1s(D, root, katm, rr, e0)
            q = q_cache[key]
            if q is None:
                continue
            s = q['s'].astype(np.int64)
            a0, b0 = np.searchsorted(s, T - 300), np.searchsorted(s, T)
            if b0 - a0 < 2:
                continue
            bid, ask = q['bid'][a0:b0].astype(float), q['ask'][a0:b0].astype(float)
            ok = (bid > 0) & (ask > bid)
            if not ok.any():
                continue
            mid = (bid + ask) / 2
            chg = int(((bid[1:] != bid[:-1]) | (ask[1:] != ask[:-1])).sum())
            vals.append(((ask - bid)[ok] / mid[ok]).mean())
            vals.append((q['bs'][a0:b0][ok].mean() + q['as'][a0:b0][ok].mean()) / 2)
            vals.append(chg / 5.0)
        if len(vals) == 6:
            mic.append({'T': T, 'mic_spr': (vals[0] + vals[3]) / 2, 'mic_size': (vals[1] + vals[4]) / 2,
                        'mic_chg': (vals[2] + vals[5]) / 2})
    if mic:
        F = F.merge(pd.DataFrame(mic), on='T', how='left')
    F.insert(0, 'root', root)
    return F


if __name__ == '__main__':
    D = sys.argv[1]
    for root in sys.argv[2].split(','):
        F = build(D, root)
        f = os.path.join(B.rdir(D, root), 'features.parquet')
        os.makedirs(os.path.dirname(f), exist_ok=True)
        F.to_parquet(f + '.tmp', index=False)
        os.replace(f + '.tmp', f)
        print(root, len(F), 'rows', flush=True)
