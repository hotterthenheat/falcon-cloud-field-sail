"""Gravity Well: do the dealer-gamma levels reconstructed historically attract price, and does the book's net
gamma say anything about the day's realised vol beyond a plain vol forecast?

  python3 scripts/fetch.py gamma SPY      # first: OI + prior-day EOD greeks, 0-10 DTE, +-30 strikes, every day
  python3 scripts/gravity.py SPY

Reconstruction for session D, with nothing a reader at 09:30 could not have known:
  * open interest stamped 06:30 on D (the previous session's settled OI), every contract 0-10 DTE, 30 strikes each side;
  * each contract's implied vol from the previous session's end-of-day greeks (fallback: that expiry's median IV
    within 2% of the money; then the nearest expiry's);
  * gamma re-priced by Black-Scholes at D's 09:30 open, T to that expiry's 16:00 close.
  Dollar gamma per 1% move: GEX_k = sign * OI * 100 * Gamma * S^2 * 0.01, sign + for calls, - for puts (the common
  "dealers long calls, short puts" convention; the app's house sign is the same book with the opposite sign).
Levels: the well K* = strike with the largest |net GEX| within 3% of the open; call wall / put wall; the flip (net
GEX re-priced across spot crosses zero, nearest the open). Pull = |GEX|-weighted mean of (K - S)/S with weight
exp(-|K-S| / (S * sigma_day)).
"""
import gzip, json, math, os, sys
from collections import defaultdict
import numpy as np
from lib import DATA, load_bars, load_vix, save_json, TEST_START, block_boot_ratio, by_day, tercile_spread

R_RATE = 0.045
SQ2PI = math.sqrt(2 * math.pi)


def ncdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def bs_gamma(S, K, T, s):
    S, K, T, s = np.asarray(S, float), np.asarray(K, float), np.asarray(T, float), np.asarray(s, float)
    v = s * np.sqrt(T)
    d1 = (np.log(S / K) + (R_RATE + 0.5 * s * s) * T) / v
    return np.exp(-0.5 * d1 * d1) / (SQ2PI * S * v)


def read(path):
    with gzip.open(path) as f:
        return json.load(f)['response']


def book_for(sym, prev, day, spot):
    gdir = os.path.join(DATA, 'gamma', sym)
    p_oi, p_eod = os.path.join(gdir, f'oi_{day}.json.gz'), os.path.join(gdir, f'eod_{prev}.json.gz')
    if not (os.path.exists(p_oi) and os.path.exists(p_eod)):
        return None
    iv = {}
    for row in read(p_eod):
        c = row['contract']
        d = row['data'][0] if row['data'] else None
        if d and d.get('implied_vol', 0) > 0.01 and d.get('iv_error', 0) == 0:
            iv[(c['expiration'], c['strike'], c['right'])] = (d['implied_vol'], d.get('underlying_price', 0))
    by_exp = defaultdict(list)
    for (e, k, r), (v, u) in iv.items():
        if u > 0 and abs(k / u - 1) < 0.02:
            by_exp[e].append(v)
    atm = {e: float(np.median(v)) for e, v in by_exp.items() if v}
    legs = []
    dD = np.datetime64(f'{day[:4]}-{day[4:6]}-{day[6:]}')
    for row in read(p_oi):
        c = row['contract']
        if not row['data']:
            continue
        oi = row['data'][-1]['open_interest']
        e = c['expiration']
        de = np.datetime64(e)
        if oi <= 0 or de < dD:
            continue
        key = (e, c['strike'], c['right'])
        if key in iv:
            v = iv[key][0]
        elif e in atm:
            v = atm[e]
        elif atm:
            near = min(atm, key=lambda x: abs((np.datetime64(x) - de).astype(int)))
            v = atm[near]
        else:
            continue
        T = ((de - dD).astype(int) + 6.5 / 24) / 365.0      # from the 09:30 open to that expiry's 16:00 close
        legs.append((c['strike'], 1 if c['right'] == 'CALL' else -1, oi, v, T))
    if len(legs) < 50:
        return None
    L = np.array(legs, float)
    return L, (float(np.median(list(atm.values()))) if atm else np.nan), min(atm, default=None)


def gex(L, S):
    K, sg, oi, v, T = L.T
    return sg * oi * 100 * bs_gamma(S, K, T, v) * S * S * 0.01


def levels(L, S, atm_iv):
    g = gex(L, S)
    strikes = np.unique(L[:, 0])
    net = np.array([g[L[:, 0] == k].sum() for k in strikes])
    calls = np.array([g[(L[:, 0] == k) & (L[:, 1] > 0)].sum() for k in strikes])
    puts = np.array([-g[(L[:, 0] == k) & (L[:, 1] < 0)].sum() for k in strikes])
    oi = np.array([L[L[:, 0] == k, 2].sum() for k in strikes])
    near = np.abs(strikes / S - 1) < 0.03
    if near.sum() < 5:
        return None
    sk, nt = strikes[near], net[near]
    well = sk[np.argmax(np.abs(nt))]
    oi_max = sk[np.argmax(oi[near])]
    above, below = near & (strikes > S), near & (strikes < S)
    cw = strikes[above][np.argmax(calls[above])] if above.any() else np.nan
    pw = strikes[below][np.argmax(puts[below])] if below.any() else np.nan
    grid = S * (1 + np.linspace(-0.04, 0.04, 81))
    prof = np.array([gex(L, s).sum() for s in grid])
    cross = [grid[i] - prof[i] * (grid[i + 1] - grid[i]) / (prof[i + 1] - prof[i])
             for i in range(len(grid) - 1) if prof[i] == 0 or prof[i] * prof[i + 1] < 0]
    flip = min(cross, key=lambda x: abs(x - S)) if cross else np.nan
    sd = (atm_iv if np.isfinite(atm_iv) else 0.15) / math.sqrt(252)
    w = np.abs(net) * np.exp(-np.abs(strikes / S - 1) / sd)
    pull = float((w * (strikes / S - 1)).sum() / w.sum()) if w.sum() > 0 else np.nan
    return dict(net=float(g.sum()), well=float(well), oi_max=float(oi_max), cw=float(cw), pw=float(pw),
                flip=float(flip), pull=pull, sd=sd)


def main(sym):
    days, O, H, L_, C, V = load_bars(sym)
    vix = load_vix()
    rows = []
    for i in range(1, len(days)):
        d, p = days[i].replace('-', ''), days[i - 1].replace('-', '')
        S = O[i, 0]
        b = book_for(sym, p, d, S)
        if b is None:
            continue
        legs, atm_iv, _ = b
        lv = levels(legs, S, atm_iv)
        if lv is None:
            continue
        c = C[i][np.isfinite(C[i])]
        px = np.concatenate([[S], c[4::5]])
        rv = 0.5 * np.log(np.sum(np.diff(np.log(px)) ** 2))
        cprev = C[i - 1][np.isfinite(C[i - 1])]
        pxp = np.concatenate([[O[i - 1, 0]], cprev[4::5]])
        rvp = 0.5 * np.log(np.sum(np.diff(np.log(pxp)) ** 2))
        c1000 = C[i, 29]
        rows.append(dict(day=days[i], S=S, close=c[-1], c1000=c1000, c1100=C[i, 89] if np.isfinite(C[i, 89]) else np.nan,
                         rv=rv, rvp=rvp, vix=vix.get(days[i - 1], np.nan), atm_iv=atm_iv, **lv))
        if len(rows) % 100 == 0:
            print(len(rows), days[i], flush=True)
    save_json(f'gravity_rows_{sym}.json', rows)
    analyse(sym, rows)


def analyse(sym, rows):
    import numpy as np
    day = np.array([r['day'] for r in rows])
    g = {k: np.array([r[k] for r in rows], float) for k in rows[0] if k != 'day'}
    S = g['S']
    test = day >= TEST_START
    out = {'days': int(len(day)), 'test_days': int(test.sum())}

    def pin(level, label, when='close', mask=None):
        """mean over days of |price_end - level| - |price_end - mirror| (in % of spot); negative = attraction.
        The mirror strike sits the same distance from the open on the other side. The test period's mean drift is
        taken out of the end price first, so an up-trending sample does not make strikes above spot look attractive."""
        end = g[when]
        mv = np.isfinite(end) & test
        drift = np.nanmean((end[mv] / S[mv]) - 1)
        end = end - drift * S
        mirror = 2 * S - level
        m = np.isfinite(level) & np.isfinite(end) & (np.abs(level / S - 1) > 1e-4) & test
        if mask is not None:
            m &= mask
        dd = (np.abs(end - level) - np.abs(end - mirror)) / S * 100
        pt, lo, hi, p = block_boot_ratio(dd[m], np.ones(m.sum()))
        frac = float(np.mean(np.abs(end - level)[m] < np.abs(end - mirror)[m]))
        return dict(n=int(m.sum()), mean_pct=pt, ci=[lo, hi], p=p, closer_share=frac,
                    open_dist_pct=float(np.mean(np.abs(level - S)[m] / S[m] * 100)))

    near = np.abs(g['well'] / S - 1) < 0.5 * g['sd']
    out['pin_well_close'] = pin(g['well'], 'well')
    out['pin_well_close_near'] = pin(g['well'], 'well', mask=near)
    out['pin_well_1100'] = pin(g['well'], 'well', when='c1100')
    out['pin_oi_max_close'] = pin(g['oi_max'], 'oi')
    rnd = np.round(S / 5) * 5
    rnd = np.where(np.abs(rnd - S) < 0.25, rnd + 5 * np.sign(S - rnd + 1e-9), rnd)
    out['pin_round5_close'] = pin(rnd, 'round')
    out['pin_flip_close'] = pin(g['flip'], 'flip')
    pos = g['net'] > 0
    out['pin_well_close_longgamma'] = pin(g['well'], 'well', mask=pos)
    out['pin_well_close_shortgamma'] = pin(g['well'], 'well', mask=~pos)
    # net gamma and the day's realised vol: incremental over yesterday's RV and VIX
    y = g['rv']
    lv = np.log(g['vix'] / 100 / np.sqrt(252))
    # scale the book by its own trailing 60-day median |net| (known before the open)
    scale = np.array([np.median(np.abs(g['net'][max(0, k - 60):k])) if k >= 20 else np.nan for k in range(len(day))])
    netz = g['net'] / scale
    flipd = (S - g['flip']) / S / g['sd']
    feats = {'net_sign': np.sign(g['net']), 'net_scaled': np.clip(netz, -5, 5), 'flip_dist': np.clip(np.nan_to_num(flipd, nan=0), -5, 5)}
    month = np.array([d[:7] for d in day])
    # baseline = a daily HAR (yesterday, last 5 sessions, last 22 sessions) plus the VIX close: all known before 09:30
    m5 = np.array([np.mean(y[max(0, k - 5):k]) if k >= 5 else np.nan for k in range(len(y))])
    m22 = np.array([np.mean(y[max(0, k - 22):k]) if k >= 22 else np.nan for k in range(len(y))])
    Xb = np.stack([np.ones(len(y)), g['rvp'], m5, m22, lv], 1)
    res = {}
    def wf(X):
        pr = np.full(len(y), np.nan)
        for mo in sorted(set(month[test])):
            tr = (month < mo) & np.all(np.isfinite(X), 1) & np.isfinite(y)
            te = (month == mo) & np.all(np.isfinite(X), 1)
            if tr.sum() < 60:
                continue
            b, *_ = np.linalg.lstsq(X[tr], y[tr], rcond=None)
            pr[te] = X[te] @ b
        return pr
    pb = wf(Xb)
    for k, f in feats.items():
        pa = wf(np.hstack([Xb, f[:, None]]))
        m = np.isfinite(pa) & np.isfinite(pb) & np.isfinite(y)
        var = np.var(y[m])
        lb, la = (y[m] - pb[m]) ** 2, (y[m] - pa[m]) ** 2
        from halflife import mbb
        pt, lo, hi, p = mbb(lb - la)
        res[k] = dict(n=int(m.sum()), r2_base=float(1 - lb.mean() / var), r2_aug=float(1 - la.mean() / var),
                      d_r2=float(pt / var), ci=[float(lo / var), float(hi / var)], p=p)
    out['rv_given_book'] = res
    # long- vs short-gamma days: realised vol relative to the baseline forecast
    resid = y - pb
    mt = np.isfinite(resid) & test
    out['rv_resid_long_minus_short'] = float(np.nanmean(resid[mt & pos]) - np.nanmean(resid[mt & ~pos]))
    out['share_long_gamma_days'] = float(np.mean(pos[test]))
    # pull direction vs the open->close return
    r_oc = (g['close'] / S - 1) * 1e4
    train = ~test
    out['pull_dir_open_close'] = tercile_spread(g['pull'], r_oc, day, train, test)
    r_10 = (g['close'] / g['c1000'] - 1) * 1e4
    out['pull_dir_1000_close'] = tercile_spread(g['pull'], r_10, day, train, test)
    save_json(f'gravity_{sym}.json', out)
    for k, v in out.items():
        print(k, v)


if __name__ == '__main__':
    s = sys.argv[1] if len(sys.argv) > 1 else 'SPY'
    if len(sys.argv) > 2 and sys.argv[2] == 'analyse':
        with open(os.path.join(os.path.dirname(__file__), '..', 'results', f'gravity_rows_{s}.json')) as f:
            analyse(s, json.load(f))
    else:
        main(s)
