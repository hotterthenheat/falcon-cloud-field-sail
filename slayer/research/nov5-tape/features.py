"""Point-in-time feature table for a study day: one row per decision minute T (seconds of the day, T = m*60), every
value computed from data stamped strictly before T:

  index      bars with start <= T-60 (S = close of the last closed bar), 1-second VIX prints < T
  board      the 1-minute chain stamp (T-60)//60 (the NBBO in force at that minute stamp), IVs solved at its mid against
             the close of the bar before the stamp (EDGE convention), trading clock to 16:00
  volume     1-minute OHLC bars of each contract with start <= T-60
  book       book_nov.py read at T (same visibility)
  UW         flow alerts / headlines with created_at < T (publication time, never print time)
  Compass    the engine's scored rows with mark time < T

  python3 features.py 20261105  -> v2data/nov5-tape/<D>/features.parquet
"""
import math, os, re, sys
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'compass-v2', 'edge'))
import load  # noqa: E402
import sim as esim  # noqa: E402

YEAR_MIN = 390.0 * 252
INDEX_FLOW = ('SPXW', 'SPX', 'SPY', 'QQQ', 'IWM', 'XSP', 'NDXP')
MACRO = re.compile(r'S&P|NASDAQ|DOW |STOCKS|U\.S\. STOCKS|FED|POWELL|IRAN|HORMUZ|TANKER|OIL|CRUDE|BRENT|TREASUR|YIELD|TARIFF|'
                   r'TRUMP|CHINA|VIX|SELLOFF|SELL-OFF|PLUNG|TUMBL|SLUMP|CRATER|CORRECTION|CRASH|RALLY|REBOUND|MOC |MOO |'
                   r'IMBALANCE|WAR|MISSILE|ATTACK|JOBLESS|CLAIMS|NVIDIA|CHIP|SEMICONDUCTOR|ARM |QUALCOMM|BITCOIN|MIDTERM', re.I)


def ema(x, n):
    a = 2 / (n + 1)
    out = np.empty(len(x))
    m = np.nan
    for i, v in enumerate(x):
        if not np.isfinite(v):
            out[i] = m
            continue
        m = v if not np.isfinite(m) else a * v + (1 - a) * m
        out[i] = m
    return out


def board_iv(b, S_q, m_stamp, extra_days=0):
    """IV, BS |delta| at the board stamp (EDGE sim's solver, trading clock)."""
    T = (max(960 - m_stamp, 1.0) + 390.0 * extra_days) / YEAR_MIN
    b = b[(b.bid > 0) & (b.ask > b.bid)]
    mid = (b.bid.values + b.ask.values) / 2
    iv = esim.implied_vol(mid, S_q, b.k.values, T, b.r.values == 1)
    dl = np.abs(esim.bs_delta(S_q, b.k.values, T, np.where(np.isfinite(iv), iv, 0.3), b.r.values == 1))
    return b.assign(mid=mid, ivs=iv, dabs=dl, spr=(b.ask.values - b.bid.values) / mid), T


def atm_of(bb, S):
    ks = np.unique(bb.k.values[np.isfinite(bb.ivs.values)])
    if not len(ks):
        return np.nan
    katm = ks[np.argmin(np.abs(ks - S))]
    v = bb.ivs.values[(bb.k.values == katm) & np.isfinite(bb.ivs.values)]
    return float(np.mean(v)) if len(v) else np.nan


def iv_at_delta(bb, r, target):
    x = bb[(bb.r == r) & np.isfinite(bb.ivs) & (bb.spr <= 0.5)]
    if not len(x):
        return np.nan
    i = np.argmin(np.abs(x.dabs.values - target))
    return float(x.ivs.values[i]) if abs(x.dabs.values[i] - target) <= 0.08 else np.nan


def build(D):
    bars = load.bars(D)
    S_by_m = dict(zip(bars.m.values, bars.c.values))
    open_ = float(bars.o.iloc[0])
    lr = np.diff(np.log(bars.c.values))
    ch = load.chain(D)
    ch1 = load.chain(D, exp=None)
    exps = sorted(f[4:12] for f in os.listdir(load.ddir(D)) if f.startswith('g1m_') and f.endswith('_greeks.parquet') and f[4:12] != D)
    nxt = load.chain(D, exps[0]) if exps else None
    oh = load.ohlc(D)
    vs, vp = load.spx(D)[0], None
    vix = pd.read_parquet(os.path.join(load.ddir(D), 'idx_VIX_1s.parquet'))
    vix = vix[vix.px > 0]
    vix_s, vix_p = (vix.ms.values // 1000), vix.px.values
    v1d = load.index_1m(D, 'VIX1D'); v9d = load.index_1m(D, 'VIX9D'); v3m = load.index_1m(D, 'VIX3M')
    bk = pd.read_parquet(os.path.join(load.ddir(D), 'book.parquet')).set_index('t')
    fl = load.flow(D)
    nw = load.news(D)
    cr = load.compass_rows(D)
    oi0 = load.oi(D)
    oi0 = oi0[oi0.exp == int(D)]
    rows = []
    cum = oh.assign(prem=oh.vwap.fillna(oh.c) * oh.v * 100.0)
    for m in range(571, 961):
        T = m * 60
        mb = m - 1                      # last closed bar
        if mb not in S_by_m:
            continue
        S = float(S_by_m[mb])
        x = {'T': T, 'S': S, 'from_open': math.log(S / open_)}
        for k in (5, 15, 30, 60):
            s0 = S_by_m.get(mb - k, np.nan) if mb - k >= 570 else open_
            x[f'r{k}'] = math.log(S / s0) if np.isfinite(s0) else np.nan
        n = mb - 570                    # returns from the 09:30 bar close to bar mb close
        rr = lr[:n]
        x['rv_so_far'] = float(np.std(rr, ddof=1) * math.sqrt(YEAR_MIN)) if n >= 5 else np.nan
        x['rv30'] = float(np.std(lr[max(0, n - 30):n], ddof=1) * math.sqrt(YEAR_MIN)) if n >= 10 else np.nan
        hi = bars[bars.m <= mb].h.max(); lo = bars[bars.m <= mb].l.min()
        x['range_pos'] = (S - lo) / (hi - lo) if hi > lo else np.nan
        x['day_hi'], x['day_lo'] = hi, lo
        # board at stamp mb (= (T-60)//60)
        S_q = float(S_by_m.get(mb - 1, open_))
        b = ch[ch.m == mb]
        if len(b):
            bb, Tm = board_iv(b, S_q, mb)
            x['atm_iv'] = atm_of(bb, S_q)
            x['iv_p25'], x['iv_c25'] = iv_at_delta(bb, 0, 0.25), iv_at_delta(bb, 1, 0.25)
            x['iv_p10'], x['iv_c10'] = iv_at_delta(bb, 0, 0.10), iv_at_delta(bb, 1, 0.10)
            x['skew25'] = x['iv_p25'] - x['iv_c25']
            x['em_1h'] = S * x['atm_iv'] * math.sqrt(60 / YEAR_MIN) if np.isfinite(x['atm_iv']) else np.nan
            x['em_day'] = S * x['atm_iv'] * math.sqrt(max(960 - mb, 1) / YEAR_MIN) if np.isfinite(x['atm_iv']) else np.nan
            atm_k = bb.k.values[np.argmin(np.abs(bb.k.values - S_q))]
            st = bb[bb.k == atm_k]
            x['straddle'] = float(st.mid.sum()) if len(st) == 2 else np.nan
        if nxt is not None:
            b2 = nxt[nxt.m == mb]
            if len(b2):
                bb2, _ = board_iv(b2, S_q, mb, extra_days=1)
                x['atm_iv_1d'] = atm_of(bb2, S_q)
        x['rv_iv'] = x['rv_so_far'] / x['atm_iv'] if x.get('atm_iv') and np.isfinite(x.get('atm_iv', np.nan)) else np.nan
        # VIX family (prints < T)
        j = np.searchsorted(vix_s, T) - 1
        x['vix'] = float(vix_p[j]) if j >= 0 else np.nan
        for k in (15, 30):
            j2 = np.searchsorted(vix_s, T - 60 * k) - 1
            x[f'vix_chg{k}'] = float(vix_p[j] - vix_p[j2]) if j2 >= 0 and j >= 0 else np.nan
        x['vix1d'] = float(v1d.get(mb, np.nan)); x['vix9d'] = float(v9d.get(mb, np.nan)); x['vix3m'] = float(v3m.get(mb, np.nan))
        # book read at T
        if T in bk.index:
            r = bk.loc[T]
            for c in ('flip', 'net_all', 'net_front', 'flip_front', 'callWall', 'putWall', 'supreme', 'wall_up', 'wall_dn',
                      'front_callWall', 'front_putWall', 'front_supreme', 'front_wall_up', 'front_wall_dn'):
                x[f'bk_{c}'] = float(r[c])
        # volume/premium (bars with start <= T-60)
        w15 = cum[(cum.m >= mb - 14) & (cum.m <= mb)]
        wall = cum[cum.m <= mb]
        for nm, ww in (('15', w15), ('day', wall)):
            pv = ww[ww.r == 0].v.sum(); cv = ww[ww.r == 1].v.sum()
            x[f'vol_p{nm}'], x[f'vol_c{nm}'] = int(pv), int(cv)
            x[f'prem_p{nm}'], x[f'prem_c{nm}'] = float(ww[ww.r == 0].prem.sum()), float(ww[ww.r == 1].prem.sum())
        if len(w15):
            g = w15.groupby(['k', 'r']).v.sum().sort_values(ascending=False)
            x['top_vol15'] = ', '.join(f"{k:g}{'C' if r else 'P'} {v:,}" for (k, r), v in g.head(3).items())
        # UW flow alerts published in [T-15 min, T)
        if len(fl):
            f15 = fl[(fl.s >= T - 900) & (fl.s < T) & fl.ticker.isin(INDEX_FLOW)]
            x['uw_n15'] = len(f15)
            x['uw_prem15'] = float(f15.prem.sum())
            x['uw_put_share15'] = float(f15[f15.type == 'put'].prem.sum() / f15.prem.sum()) if f15.prem.sum() > 0 else np.nan
            ask = f15.ask_prem.sum(); bid = f15.bid_prem.sum()
            x['uw_ask_share15'] = float(ask / (ask + bid)) if ask + bid > 0 else np.nan
            # signed: +1 bullish (call ask-side, put bid-side), -1 bearish
            sgn = np.where(f15.type == 'call', 1, -1) * (f15.ask_prem - f15.bid_prem)
            x['uw_bull_prem15'] = float(sgn.sum())
            x['uw_sweeps15'] = int(f15.sweep.sum())
            fsp = f15[f15.ticker.isin(('SPXW', 'SPX'))]
            x['uw_spx_n15'] = len(fsp)
        if len(nw):
            n30 = nw[(nw.s >= T - 1800) & (nw.s < T)]
            mac = n30[n30.headline.str.contains(MACRO) & n30.major]
            x['news_macro30'] = len(mac)
            x['news_last'] = (load.clock(mac.s.iloc[-1]) + ' ' + mac.headline.iloc[-1][:90]) if len(mac) else ''
        if cr is not None and len(cr):
            c0 = cr[(cr.t < T) & (cr.e == D) & cr.p1.notna()]
            if len(c0):
                tm = c0.t.max()
                cc = c0[c0.t == tm].sort_values('p1', ascending=False)
                x['cmp_t'] = tm
                x['cmp_top'] = f"{cc.k.iloc[0]:g}{'C' if cc.r.iloc[0] else 'P'} p1 {cc.p1.iloc[0]:.2f}"
                x['cmp_p1_call'] = float(cc[cc.r == 1].p1.head(5).mean()) if (cc.r == 1).any() else np.nan
                x['cmp_p1_put'] = float(cc[cc.r == 0].p1.head(5).mean()) if (cc.r == 0).any() else np.nan
        rows.append(x)
    return pd.DataFrame(rows)


if __name__ == '__main__':
    D = sys.argv[1]
    df = build(D)
    f = os.path.join(load.ddir(D), 'features.parquet')
    df.to_parquet(f + '.tmp', index=False)
    os.replace(f + '.tmp', f)
    pd.set_option('display.width', 250); pd.set_option('display.max_columns', 40)
    print(df.iloc[::30][['T', 'S', 'r15', 'rv_so_far', 'atm_iv', 'rv_iv', 'skew25', 'vix', 'bk_net_all', 'bk_flip', 'uw_n15',
                         'uw_put_share15', 'cmp_top']].assign(T=lambda d: [load.clock(v) for v in d['T']]).to_string())
