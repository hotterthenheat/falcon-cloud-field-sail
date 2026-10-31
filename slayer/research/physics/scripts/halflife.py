"""Volatility half-life: daily realised vol mean-reverts; is the half-life model a better next-day forecast than the
plain trailing average a trader would use?

  python3 scripts/halflife.py SPY QQQ SPX NVDA AAPL

Daily RV_t = sqrt(sum of squared 5-minute log returns, 09:30-16:00); x_t = log RV_t. Forecasts of x_{t+1}:
  RW     x_t                                   (yesterday)
  MA20   mean(x_{t-19..t})                     (the baseline: a 20-day realised vol)
  AR1    a + phi x_t, half-life = ln(0.5)/ln(phi) days         (the "Volatility Half-Life" indicator)
  HAR    a + b_d x_t + b_w mean5 + b_m mean22  (Corsi 2009)
  HAR+VIX  HAR + log(VIX_t / sqrt(252))         (index names only)
Expanding-window refit at the start of every test month; test 2024-07 .. 2026-10. Loss: MSE on log RV.
CI: moving-block bootstrap of the daily loss difference, 20-day blocks.
"""
import sys
import numpy as np
from lib import load_bars, load_vix, save_json, TEST_START

BLOCK = 20


def daily_logrv(sym):
    days, O, H, L, C, V = load_bars(sym)
    out = []
    for i, d in enumerate(days):
        c = C[i][np.isfinite(C[i])]
        if len(c) < 200:
            out.append(np.nan); continue
        p = np.concatenate([[O[i, 0]], c[4::5]])
        r = np.diff(np.log(p))
        out.append(0.5 * np.log(np.sum(r ** 2)))
    return np.array(days), np.array(out)


def mbb(diff, n=2000, seed=7):
    rng = np.random.default_rng(seed)
    k = len(diff)
    nb = int(np.ceil(k / BLOCK))
    starts = rng.integers(0, k - BLOCK + 1, size=(n, nb))
    idx = (starts[:, :, None] + np.arange(BLOCK)).reshape(n, -1)[:, :k]
    bs = diff[idx].mean(1)
    lo, hi = np.percentile(bs, [2.5, 97.5])
    p = 2 * min((bs <= 0).mean(), (bs >= 0).mean())
    return float(diff.mean()), float(lo), float(hi), float(max(p, 1 / n))


def run(sym, vix):
    days, x = daily_logrv(sym)
    n = len(x)
    def lagmean(w):
        return np.array([np.nanmean(x[max(0, t - w + 1):t + 1]) for t in range(n)])
    m5, m20, m22 = lagmean(5), lagmean(20), lagmean(22)
    vx = np.array([np.log(vix[d] / 100 / np.sqrt(252)) if d in vix else np.nan for d in days])
    use_vix = sym in ('SPY', 'SPX', 'QQQ')
    y = np.r_[x[1:], np.nan]                       # x_{t+1}, aligned at t
    feats = {
        'AR1': np.stack([np.ones(n), x], 1),
        'HAR': np.stack([np.ones(n), x, m5, m22], 1),
    }
    if use_vix:
        feats['HAR+VIX'] = np.stack([np.ones(n), x, m5, m22, vx], 1)
    month = np.array([d[:7] for d in days])
    preds = {k: np.full(n, np.nan) for k in feats}
    phis = []
    for mo in sorted(set(month[days >= TEST_START])):
        t0 = np.where(month == mo)[0][0]
        for k, X in feats.items():
            tr = np.arange(22, t0 - 1)
            tr = tr[np.isfinite(y[tr]) & np.all(np.isfinite(X[tr]), 1)]
            b, *_ = np.linalg.lstsq(X[tr], y[tr], rcond=None)
            te = np.where(month == mo)[0]
            preds[k][te] = X[te] @ b
            if k == 'AR1':
                phis.append((mo, float(b[1]), float(np.log(0.5) / np.log(b[1])) if 0 < b[1] < 1 else np.nan))
    preds['RW'] = x.copy()
    preds['MA20'] = m20
    test = (days >= TEST_START) & np.isfinite(y)
    for k in preds:
        test &= np.isfinite(preds[k])
    yt = y[test]
    var = np.var(yt)
    res = {'n_test_days': int(test.sum())}
    base_loss = (yt - preds['MA20'][test]) ** 2
    for k, p in preds.items():
        loss = (yt - p[test]) ** 2
        r = {'mse': float(loss.mean()), 'r2_oos': float(1 - loss.mean() / var)}
        if k != 'MA20':
            pt, lo, hi, pv = mbb(base_loss - loss)
            r['gain_vs_MA20'] = {'d_mse': pt, 'ci': [lo, hi], 'p': pv, 'pct': float(pt / base_loss.mean() * 100)}
        res[k] = r
    if use_vix:
        lh, lv = (yt - preds['HAR'][test]) ** 2, (yt - preds['HAR+VIX'][test]) ** 2
        pt, lo, hi, pv = mbb(lh - lv)
        res['VIX_over_HAR'] = {'d_mse': pt, 'ci': [lo, hi], 'p': pv}
    # half-life of the full-sample AR(1) of daily log RV, and the rolling (monthly refit) path
    hl = [h for _, _, h in phis if np.isfinite(h)]
    res['half_life_days'] = {'first': phis[0], 'last': phis[-1], 'min': float(np.min(hl)), 'max': float(np.max(hl))}
    return res


def main(syms):
    vix = load_vix()
    out = {}
    for s in syms:
        out[s] = run(s, vix)
        r = out[s]
        print(s, 'test days', r['n_test_days'], 'half-life', r['half_life_days'])
        for k in ['RW', 'MA20', 'AR1', 'HAR', 'HAR+VIX']:
            if k in r:
                g = r[k].get('gain_vs_MA20')
                print(f"  {k:8s} R2oos={r[k]['r2_oos']:+.3f}" + (f"  vs MA20 {g['pct']:+.1f}% MSE  CI[{g['ci'][0]:+.4f},{g['ci'][1]:+.4f}] p={g['p']:.3f}" if g else ''))
        if 'VIX_over_HAR' in r:
            print('  VIX over HAR', r['VIX_over_HAR'])
    save_json('halflife.json', out)


if __name__ == '__main__':
    main(sys.argv[1:] or ['SPY'])
