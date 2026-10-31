"""Walk-forward out-of-sample tests of the intraday physics features against simple baselines.

  python3 scripts/evaluate.py SPY QQQ SPX NVDA AAPL

Reads data/feat_<SYM>.npz and data/brk_<SYM>.npz (scripts/build_features.py), writes results/intraday.json.
Training block: 2023-01 .. 2024-06; test: 2024-07 .. 2026-10, OLS refit on all prior data at each test quarter.
Every CI is a day-block bootstrap (2,000 resamples of whole sessions).
"""
import sys
import numpy as np
from lib import (DATA, DECISIONS, TEST_START, walk_forward_ols, delta_r2, tercile_spread, auc_boot, auc, save_json)
import os

VOL_FEATURES = ['pe', 'sampen', 'dfa', 'lyap', 'csd_ar', 'csd_var', 'ph_R', 'amihud', 'kyle', 'vr5', 'er60', 'relvol']
CONT_FEATURES = ['dfa', 'vr5', 'er60', 'pe', 'sampen', 'ph_R', 'lyap']


def load(sym):
    z = np.load(os.path.join(DATA, f'feat_{sym}.npz'), allow_pickle=True)
    A, cols, days = z['A'], list(z['cols']), z['days']
    f = {c: A[:, k] for k, c in enumerate(cols)}
    f['day'] = days[f['i'].astype(int)]
    return f


def tod(j):
    return np.stack([(j == d).astype(float) for d in DECISIONS], axis=1)


def vol_tests(f, extra_base=None):
    y = np.log(f['rv_next60'] + 1e-12)
    base = [tod(f['j']), f['lrv60'][:, None], f['lrv390'][:, None], f['lrv15'][:, None]]
    if extra_base is not None:
        base.append(extra_base[:, None])
    Xb = np.hstack(base)
    out = {}
    for name in VOL_FEATURES:
        x = f[name]
        if not np.isfinite(x).any():
            out[name] = 'UNAVAILABLE'
            continue
        m = np.isfinite(x) & np.all(np.isfinite(Xb), axis=1) & np.isfinite(y)
        pb = walk_forward_ols(Xb[m], y[m], f['day'][m])
        pa = walk_forward_ols(np.hstack([Xb[m], x[m][:, None]]), y[m], f['day'][m])
        out[name] = delta_r2(y[m], pb, pa, f['day'][m])
    return out


def cont_tests(f):
    """Momentum continuation: y = sign(past 30-min return) * next 30-min return, in bps."""
    y = np.sign(f['past30']) * f['ret_next30'] * 1e4
    train = f['day'] < TEST_START
    test = ~train
    out = {'unconditional_bps': float(np.nanmean(y[test]))}
    for name in CONT_FEATURES:
        out[name] = tercile_spread(f[name], y, f['day'], train & np.isfinite(f[name]), test)
    # phase direction vs plain multi-timeframe sign agreement, predicting the raw next-30 return
    r = f['ret_next30'] * 1e4
    out['dir_ph_RD'] = tercile_spread(f['ph_RD'], r, f['day'], train, test)
    out['dir_ph_D'] = tercile_spread(f['ph_D'], r, f['day'], train, test)
    out['dir_mtf'] = tercile_spread(f['mtf'], r, f['day'], train, test)
    out['dir_past30'] = tercile_spread(f['past30'], r, f['day'], train, test)
    # absolute move size by phase-sync R (the "interference" claim: in-phase cycles -> bigger moves)
    out['absmove_ph_R'] = tercile_spread(f['ph_R'], np.abs(r), f['day'], train, test)
    return out


def csd_tests(f):
    """Critical slowing down: does a rising AR(1) / variance warn of a large next-hour move?"""
    lab = f['big']
    Xb = np.hstack([tod(f['j']), f['lrv60'][:, None], f['lrv390'][:, None], f['lrv15'][:, None]])
    m = np.isfinite(lab) & np.isfinite(f['csd_ar']) & np.isfinite(f['csd_var']) & np.all(np.isfinite(Xb), axis=1)
    d = f['day'][m]
    pb = walk_forward_ols(Xb[m], lab[m], d)
    pa = walk_forward_ols(np.hstack([Xb[m], f['csd_ar'][m][:, None]]), lab[m], d)
    pv = walk_forward_ols(np.hstack([Xb[m], f['csd_var'][m][:, None]]), lab[m], d)
    te = np.isfinite(pb)
    L = lab[m]
    # raw (no model) scores on the test rows: AR(1) rise alone vs the plain "vol rising" ratio
    ratio = (f['lrv60'] - f['lrv390'])[m]
    return {
        'base_rate_test': float(np.mean(L[te])),
        'aug_ar1_vs_base': auc_boot(pa[te], pb[te], L[te], d[te]),
        'aug_var_vs_base': auc_boot(pv[te], pb[te], L[te], d[te]),
        'raw_ar1_vs_volratio': auc_boot(f['csd_ar'][m][te], ratio[te], L[te], d[te]),
        'raw_var_rise_auc': auc(f['csd_var'][m][te], L[te]),
    }


def breakout_tests(sym):
    z = np.load(os.path.join(DATA, f'brk_{sym}.npz'), allow_pickle=True)
    A, cols, days = z['A'], list(z['cols']), z['days']
    if len(A) == 0:
        return 'no events'
    e = {c: A[:, k] for k, c in enumerate(cols)}
    day = days[e['i'].astype(int)]
    train, test = day < TEST_START, day >= TEST_START
    out = {'events_train': int(train.sum()), 'events_test': int(test.sum())}
    y = e['fwd_sig']
    # is there any continuation at all? (mean signed move in 1-min sigmas, and in bps)
    from lib import by_day, block_boot_ratio
    num, _ = by_day(np.where(test, y, 0), day)
    den, _ = by_day(test.astype(float), day)
    keep = den > 0
    out['mean_cont_sigma'] = block_boot_ratio(num[keep], den[keep])
    num, _ = by_day(np.where(test, e['fwd_bps'], 0), day)
    out['mean_cont_bps'] = block_boot_ratio(num[keep], den[keep])
    num, _ = by_day(np.where(test, e['failed'], 0), day)
    out['fail_rate'] = block_boot_ratio(num[keep], den[keep])
    for name in ['esc', 'z5', 'z1', 'relvol', 'pen']:
        if not np.isfinite(e[name]).any():
            out[name] = 'UNAVAILABLE'
            continue
        out[name] = {'cont': tercile_spread(e[name], y, day, train & np.isfinite(e[name]), test),
                     'fail': tercile_spread(e[name], e['failed'], day, train & np.isfinite(e[name]), test),
                     'absmove': tercile_spread(e[name], np.abs(y), day, train & np.isfinite(e[name]), test)}
    # incremental: does escape velocity add to the breakout-bar size?
    m = np.isfinite(e['esc']) & np.isfinite(e['z1'])
    if m.sum() > 300:
        one = np.ones(m.sum())[:, None]
        pb = walk_forward_ols(np.hstack([one, e['z1'][m][:, None]]), y[m], day[m])
        pa = walk_forward_ols(np.hstack([one, e['z1'][m][:, None], e['esc'][m][:, None]]), y[m], day[m])
        out['esc_dr2_over_z1'] = delta_r2(y[m], pb, pa, day[m])
    return out


def spillover(target, source):
    """Gravitational Wave Scanner = volatility spillover: does the source's last-15-min vol shock predict the
    target's next-hour vol beyond the target's own history?"""
    ft, fs = load(target), load(source)
    key_s = {(d, int(j)): k for k, (d, j) in enumerate(zip(fs['day'], fs['j']))}
    idx = np.array([key_s.get((d, int(j)), -1) for d, j in zip(ft['day'], ft['j'])])
    ok = idx >= 0
    y = np.log(ft['rv_next60'] + 1e-12)[ok]
    Xb = np.hstack([tod(ft['j'][ok]), ft['lrv60'][ok][:, None], ft['lrv390'][ok][:, None], ft['lrv15'][ok][:, None]])
    shock = (fs['lrv15'] - fs['lrv390'])[idx[ok]]
    lvl = fs['lrv60'][idx[ok]]
    d = ft['day'][ok]
    m = np.isfinite(y) & np.all(np.isfinite(Xb), axis=1) & np.isfinite(shock)
    pb = walk_forward_ols(Xb[m], y[m], d[m])
    pa = walk_forward_ols(np.hstack([Xb[m], shock[m][:, None], lvl[m][:, None]]), y[m], d[m])
    return delta_r2(y[m], pb, pa, d[m])


def main(syms):
    res = {}
    for s in syms:
        f = load(s)
        print('==', s, len(f['i']), 'rows', flush=True)
        r = {'vol': vol_tests(f), 'cont': cont_tests(f), 'csd': csd_tests(f), 'breakout': breakout_tests(s)}
        if np.isfinite(f['relvol']).any():
            r['vol_with_relvol_base'] = {k: v for k, v in vol_tests(f, f['relvol']).items() if k in ('amihud', 'kyle')}
        res[s] = r
        for k, v in r['vol'].items():
            if isinstance(v, dict):
                print(f"  vol {k:8s} dR2={v['d_r2']*100:+.2f}pp [{v['ci'][0]*100:+.2f},{v['ci'][1]*100:+.2f}] base={v['r2_base']:.3f}")
        for k in CONT_FEATURES + ['dir_ph_RD', 'dir_mtf', 'dir_past30', 'absmove_ph_R']:
            v = r['cont'][k]
            print(f"  cont {k:12s} top-bot={v['spread']:+.2f}bps [{v['ci'][0]:+.2f},{v['ci'][1]:+.2f}]")
        print('  csd', {k: (v if not isinstance(v, dict) else (round(v['auc_a'], 3), round(v['auc_b'], 3), [round(c, 3) for c in v['ci']])) for k, v in r['csd'].items()})
        b = r['breakout']
        if isinstance(b, dict):
            print('  brk', b['events_test'], 'mean cont sig', [round(x, 3) for x in b['mean_cont_sigma']], 'fail', [round(x, 3) for x in b['fail_rate']])
            for k in ['esc', 'z5', 'z1', 'relvol', 'pen']:
                if isinstance(b[k], dict):
                    print(f"     {k:6s} cont spread {b[k]['cont']['spread']:+.3f} {[round(c, 3) for c in b[k]['cont']['ci']]}  fail spread {b[k]['fail']['spread']:+.3f}  |move| spread {b[k]['absmove']['spread']:+.3f} {[round(c, 3) for c in b[k]['absmove']['ci']]}")
    spill = {}
    pairs = [(t, s) for t in syms for s in syms if t != s and s in ('SPY', 'NVDA', 'QQQ') and t != 'SPX' and s != 'SPX']
    for t, s in pairs:
        if t == 'QQQ' and s == 'SPY' or t == 'SPY' and s == 'QQQ':
            pass
        spill[f'{s}->{t}'] = spillover(t, s)
        v = spill[f'{s}->{t}']
        print(f"  spill {s}->{t} dR2={v['d_r2']*100:+.2f}pp [{v['ci'][0]*100:+.2f},{v['ci'][1]*100:+.2f}]")
    res['spillover'] = spill
    save_json('intraday.json', res)


if __name__ == '__main__':
    main(sys.argv[1:] or ['SPY'])
