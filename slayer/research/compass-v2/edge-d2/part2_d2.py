"""EDGE-D2 Part 2: the existing registered trend rules, kept only on forecast-positive days (PREREG "Part 2").

  python3 part2_d2.py      -> results/PART2.md, results/part2.json

Trades are read from the rules' own caches (already simulated: 1-second NBBO, ask in / bid out +2 s, $0.65/side).
No rule, contract or exit is changed; the only new thing is the day filter.
"""
import glob, json, os, sys
import numpy as np
import pandas as pd
from common_d2 import DATA, HERE, OUT, V2, split_of
from eval.metrics import cluster_ci_mean, deflated_sharpe, pbo_cscv, ledger_trials  # noqa: E402

RES = os.path.join(HERE, 'results')
LEDGER = os.path.abspath(os.path.join(V2, '..', '..', '..', 'research-v2-ledger.md'))
FILTERS = {'FP': 'P', 'FV': 'B-VIX', 'FO': 'O', 'FF': 'F'}


def edge_g():
    ev = pd.read_parquet(os.path.join(DATA, 'edge-g', 'events_DEV.parquet'))
    real = pd.read_parquet(os.path.join(DATA, 'edge-g', 'trades_real.parquet'))
    rows = []
    for ph in ('P3', 'P4'):
        for f in glob.glob(os.path.join(DATA, 'edge-g', 'res', ph, '*', '*.json')):
            rows += json.load(open(f))
    opp = pd.DataFrame(rows)
    opp = opp[(opp.sideflip == -1) & opp.fill.notna()][['id', 'cell', 'exit_rule', 'ret_net']].rename(columns={'ret_net': 'opp'})
    sys.path.insert(0, os.path.join(HERE, '..', 'edge-g'))
    from common import dev_sessions
    sessions = sorted(dev_sessions())
    out = {}
    base = set(ev[ev.fam == 'BASE'].id)
    r3 = set(ev[(ev.fam == 'BASE') & (ev.r3 == 1)].id)
    for name, ids, ex in (('R3', r3, 'XB'), ('BASE-XA', base, 'XA'), ('BASE-XB', base, 'XB')):
        for cell in ('0D30', '0D45', '1D45'):
            t = real[real.id.isin(ids) & (real.cell == cell) & (real.exit_rule == ex)].copy()
            t = t.merge(opp[(opp.cell == cell) & (opp.exit_rule == ex)][['id', 'opp']], on='id', how='left')
            out[f'G:{name}|{cell}'] = t[['id', 'day', 't', 'root', 'ret_net', 'ret_gross', 'pnl_net', 'cost', 'opp']]
    return out, sessions


def nov5():
    rows = []
    files = sorted(glob.glob(os.path.join(DATA, 'nov5-tape', 'res', 'dev', '*.json')))
    for f in files:
        rows += json.load(open(f))
    d = pd.DataFrame(rows)
    d = d[(d.rule == 'N2') & d.fill.notna()].copy()
    d['id'] = d.day + '|' + d.t.astype(str) + '|' + d.variant
    real = d[d.sideset == 'real']
    opp = d[d.sideset == 'opp'][['id', 'ret_net']].rename(columns={'ret_net': 'opp'})
    out = {}
    for v in sorted(real.variant.unique()):
        t = real[real.variant == v].merge(opp, on='id', how='left')
        t['root'] = 'SPXW'
        out[f'N:{v}'] = t[['id', 'day', 't', 'root', 'ret_net', 'ret_gross', 'pnl_net', 'cost', 'opp']]
    sessions = sorted(os.path.basename(f)[:10] for f in files)
    return out, sessions


def stats(t, sessions_pool):
    if not len(t):
        return {'n': 0}
    r = t.ret_net.values
    lo, hi = cluster_ci_mean(r, t.day.values, n_boot=4000)
    w, l = r[r > 0], r[r <= 0]
    sh = float(r.mean() / (r.std(ddof=1) + 1e-12)) if len(r) > 2 else float('nan')
    return {'n': int(len(t)), 'sessions': int(t.day.nunique()), 'pool': len(sessions_pool), 'win': float((r > 0).mean()),
            'avg_win': float(w.mean()) if len(w) else float('nan'), 'avg_loss': float(l.mean()) if len(l) else float('nan'),
            'exp': float(r.mean()), 'lo': lo, 'hi': hi, 'gross': float(t.ret_gross.mean()),
            'dpd': float(t.pnl_net.sum() / t.cost.sum()), 'sharpe': sh}


def side_shuffle(t, n=1000, seed=5):
    m = t[t.opp.notna()]
    if len(m) < 10:
        return None
    rng = np.random.default_rng(seed)
    a, b = m.ret_net.values, m.opp.values
    means = np.array([np.where(rng.random(len(a)) < 0.5, a, b).mean() for _ in range(n)])
    return {'pairs': int(len(m)), 'beats': float((means < a.mean()).mean())}


def by_day_mean(t, days):
    s = set(days)
    x = t[t.day.isin(s)]
    return float(x.ret_net.mean()) if len(x) else np.nan


def main():
    pr = pd.read_parquet(os.path.join(OUT, 'preds.parquet'))
    pr = pr[pr.target == 'Y1']
    feats = pd.read_parquet(os.path.join(OUT, 'features.parquet')).set_index('day')
    nulls = {}
    for fn in sorted(glob.glob(os.path.join(OUT, 'null', 'null_*.npz'))):
        z = np.load(fn)
        for fk, model in FILTERS.items():
            k = f'{model}|Y1|flag'
            if k in z.files:
                days = z[f'{model}|Y1|days']
                P = z[f'{model}|Y1|p']
                for j in range(z[k].shape[0]):
                    ok = np.isfinite(P[j])
                    nulls.setdefault(fk, []).append(set(days[ok & (z[k][j] == 1)]))
    g, g_sess = edge_g()
    n5, n5_sess = nov5()
    rules = {**{k: (v, g_sess) for k, v in g.items()}, **{k: (v, n5_sess) for k, v in n5.items()}}
    n_trials = ledger_trials(LEDGER)
    rng = np.random.default_rng(20261106)
    J, L = {}, []
    L += ['# EDGE-D2 Part 2: the existing trend rules on forecast-positive days only (DEV)', '',
          f'PREREG `edge-d2/PREREG.md` @ bc38f68. Rules unchanged (EDGE-G R3 / BASE-XA / BASE-XB, NOV5 N2), their own cached '
          f'trades (1-second NBBO, ask in / bid out +2 s, net of $0.65/side). Forecast Y1 (|o->c| > 1.5%), '
          f'p_hat >= 2 x training base rate, out-of-sample walk-forward. CI: session-clustered bootstrap (4,000). '
          f'Null A: 2,000 random day sets of the same size from the same pool; Null B: the flagged days of the 200 '
          f'shuffled-label walk-forwards. PERFECT = the true Y1 labels (HINDSIGHT, an upper bound, not tradeable). '
          f'DSR at the ledger trial count {n_trials}.', '',
          '| rule | filter | pool sessions (flagged) | all days: n, exp [CI] | FORECAST DAYS: n, win, avg win / loss, exp net [95% CI], gross, $ per $ | Null A beats (stratified) | Null B beats | side-shuffle beats | PERFECT (hindsight): n, exp [CI] | DSR | PASS |',
          '|---|---|---|---|---|---|---|---|---|---:|---|']
    allsess = sorted(set(g_sess) | set(n5_sess))
    M_cols, M_names = [], []
    for rk, (t_all, sess) in rules.items():
        for fk, model in FILTERS.items():
            p = pr[pr.model == model]
            pool = sorted(set(sess) & set(p.day))
            if not pool:
                continue
            flag = set(p[(p.flag == 1)].day) & set(pool)
            tp = t_all[t_all.day.isin(set(pool))]
            tf = tp[tp.day.isin(flag)]
            s_all = stats(tp, pool)
            s = stats(tf, flag)
            # Null A: random day sets of the same size
            k = len(flag)
            pool_a = np.array(pool)
            day_sum = tp.groupby('day').ret_net.sum().reindex(pool).fillna(0).values
            day_n = tp.groupby('day').size().reindex(pool).fillna(0).values
            na = np.empty(2000)
            for i in range(2000):
                ii = rng.choice(len(pool), k, replace=False)
                na[i] = day_sum[ii].sum() / max(day_n[ii].sum(), 1)
            # stratified by quarter
            qs = pd.PeriodIndex(pd.to_datetime(pool_a), freq='Q').astype(str)
            fl_arr = np.isin(pool_a, list(flag))
            groups = {q: np.flatnonzero(qs == q) for q in np.unique(qs)}
            kq = {q: int(fl_arr[ix].sum()) for q, ix in groups.items()}
            ns = np.empty(1000)
            for i in range(1000):
                ii = np.concatenate([rng.choice(ix, kq[q], replace=False) for q, ix in groups.items() if kq[q] > 0])
                ns[i] = day_sum[ii].sum() / max(day_n[ii].sum(), 1)
            nb = []
            for fs in nulls.get(fk, []):
                x = tp[tp.day.isin(fs & set(pool))]
                if len(x):
                    nb.append(x.ret_net.mean())
            nb = np.array(nb)
            ss = side_shuffle(tf)
            perf = {}
            for yk in ('Y1', 'Y2', 'Y3'):
                yd = set(feats.index[(feats[yk] == 1)]) & set(pool)
                perf[yk] = stats(tp[tp.day.isin(yd)], yd)
            dsr = deflated_sharpe(s.get('sharpe', float('nan')), s.get('n', 0), n_trials) if s.get('n', 0) > 2 else {'dsr': float('nan')}
            if s.get('n'):
                s['nullA_beats'] = float((na < s['exp']).mean())
                s['nullA_strat_beats'] = float((ns < s['exp']).mean())
                s['nullB_beats'] = float((nb < s['exp']).mean()) if len(nb) else float('nan')
                s['nullB_runs'] = int(len(nb))
            s['dsr'] = dsr.get('dsr')
            s['by_year'] = {y: {'n': int(len(x)), 'exp': float(x.ret_net.mean())} for y, x in tf.groupby(tf.day.str[:4])}
            s['all_by_year'] = {y: {'n': int(len(x)), 'exp': float(x.ret_net.mean())} for y, x in tp.groupby(tp.day.str[:4])}
            ok = bool(s.get('n', 0) >= 150 and s.get('lo', -1) > 0 and (s.get('win', 0) >= 0.55 or s.get('exp', 0) >= 0.10)
                      and s.get('nullA_beats', 0) >= 0.95 and s.get('nullB_beats', 0) >= 0.95 and (s.get('dsr') or 0) >= 0.95)
            s['pass_ex_pbo'] = ok
            key = f'{rk}|{fk}'
            J[key] = {'forecast': s, 'all': s_all, 'perfect': perf, 'side_shuffle': ss, 'flagged_sessions': k}
            per = tf.groupby('day').ret_net.mean().reindex(allsess).fillna(0.0).values
            M_cols.append(per); M_names.append(key)

            def f3(x):
                return f"{x['n']}, {100 * x['exp']:+.1f}% [{100 * x['lo']:+.1f}, {100 * x['hi']:+.1f}]" if x.get('n') else '0'
            fc = (f"{s['n']}, {100 * s['win']:.0f}%, {100 * s['avg_win']:+.0f}% / {100 * s['avg_loss']:+.0f}%, "
                  f"**{100 * s['exp']:+.1f}% [{100 * s['lo']:+.1f}, {100 * s['hi']:+.1f}]**, {100 * s['gross']:+.1f}%, {100 * s['dpd']:+.1f}%") if s.get('n') else '0'
            L.append(f"| {rk[2:]} | {fk} | {len(pool)} ({k}) | {f3(s_all)} | {fc} | "
                     + (f"{100 * s['nullA_beats']:.0f}% ({100 * s['nullA_strat_beats']:.0f}%)" if s.get('n') else '-') + ' | '
                     + (f"{100 * s['nullB_beats']:.0f}% ({s['nullB_runs']})" if s.get('n') and len(nb) else '-') + ' | '
                     + (f"{100 * ss['beats']:.0f}% ({ss['pairs']})" if ss else '-') + f" | {f3(perf['Y1'])} | {s['dsr'] if s['dsr'] is None else round(s['dsr'], 3)} | {'PASS' if ok else 'fail'} |")
    M = np.column_stack(M_cols)
    pbo = pbo_cscv(M, n_blocks=16)
    L += ['', f"PBO (CSCV, 16 blocks) over the {M.shape[1]} filtered variants x {M.shape[0]} sessions (0 on no-trade sessions): **{pbo['pbo']:.2f}**", '']
    J['_pbo'] = pbo['pbo']
    J['_n_trials'] = n_trials
    # by year
    L += ['## By year: forecast days (n: exp) vs all days of the same pool', '', '| rule | filter | ' + ' | '.join(str(y) for y in range(2020, 2025)) + ' |', '|---|---|' + '---|' * 5]
    for key, v in J.items():
        if key.startswith('_'):
            continue
        rk, fk = key.rsplit('|', 1)
        by, ab = v['forecast'].get('by_year', {}), v['forecast'].get('all_by_year', {})
        cells = []
        for y in range(2020, 2025):
            a, b = by.get(str(y)), ab.get(str(y))
            cells.append((f"{a['n']}: {100 * a['exp']:+.1f}%" if a else '0') + (f" (all {b['n']}: {100 * b['exp']:+.1f}%)" if b else ''))
        L.append(f'| {rk[2:]} | {fk} | ' + ' | '.join(cells) + ' |')
    # perfect filter by target
    L += ['', '## PERFECT DAY FILTER (HINDSIGHT; true labels, not tradeable): n, exp [CI] on the same pools', '',
          '| rule | pool (filter) | Y1 >1.5% | Y2 >1.0% | Y3 range >2x implied |', '|---|---|---|---|---|']
    for key, v in J.items():
        if key.startswith('_') or not key.endswith('|FP') and not key.endswith('|FO'):
            continue
        rk, fk = key.rsplit('|', 1)
        pf = v['perfect']
        L.append(f'| {rk[2:]} | {fk} | ' + ' | '.join(
            (f"{pf[y]['n']}, {100 * pf[y]['exp']:+.1f}% [{100 * pf[y]['lo']:+.1f}, {100 * pf[y]['hi']:+.1f}]" if pf[y].get('n') else '0') for y in ('Y1', 'Y2', 'Y3')) + ' |')
    passed = [k for k, v in J.items() if not k.startswith('_') and v['forecast'].get('pass_ex_pbo') and pbo['pbo'] < 0.3]
    L += ['', f"**Variants passing the full DEV bar (n >= 150, CI > 0, win >= 55% or exp >= +10%, Null A and B >= 95%, DSR >= 0.95, PBO < 0.3): {len(passed)}** {passed}"]
    J['_passed'] = passed
    os.makedirs(RES, exist_ok=True)
    open(os.path.join(RES, 'PART2.md'), 'w').write('\n'.join(L) + '\n')
    json.dump(J, open(os.path.join(RES, 'part2.json'), 'w'), indent=1, default=float)
    print('\n'.join(L))


if __name__ == '__main__':
    main()
