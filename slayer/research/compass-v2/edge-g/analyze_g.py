"""EDGE-G DEV statistics (PREREG "Nulls and statistics"): every variant, N1 side-shuffle, N2 filter-shuffle, PBO, DSR.

  python3 analyze_g.py        -> results/DEV.md, results/summary.json (reads results/synthetic_null.json if present)
"""
import glob, json, math, os, sys
import numpy as np
import pandas as pd
from common import OUT, V2
import sim_g as SG
sys.path.insert(0, V2)
from eval.metrics import cluster_ci_mean, deflated_sharpe, pbo_cscv, ledger_trials  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
RULES = [('R1A', lambda e: e.fam == 'R1A', 'XA_RC'), ('R1B', lambda e: e.fam == 'R1B', 'XA'),
         ('R2-CLEAR', lambda e: (e.fam == 'BASE') & (e.r2_clear == 1), 'XA'),
         ('R2-BLOCKED', lambda e: (e.fam == 'BASE') & (e.r2_blocked == 1), 'XA'),
         ('R3', lambda e: (e.fam == 'BASE') & (e.r3 == 1), 'XB'),
         ('BASE-XA', lambda e: e.fam == 'BASE', 'XA'), ('BASE-XB', lambda e: e.fam == 'BASE', 'XB')]
CELLS = ('0D30', '0D45', '1D45')
LEDGERS = ['/home/user/falcon-cloud-field-sail/research-v2-ledger.md', os.path.join(V2, '..', '..', '..', 'research-v2-ledger.md')]


def load_res(phases):
    rows = []
    for ph in phases:
        for f in glob.glob(os.path.join(OUT, 'res', ph, '*', '*.json')):
            for r in json.load(open(f)):
                r['phase'] = ph
                rows.append(r)
    return pd.DataFrame(rows)


def day_types():
    import sim
    out = {}
    for f in sorted(glob.glob(os.path.join(sim.ROOT, 'bars', 'SPX', '*.parquet'))):
        b = pd.read_parquet(f)
        for d, g in b.groupby('d'):
            g = g.sort_values('m')
            o, c = g[g.m == 570].o, g[g.m <= 959].c
            if len(o) and len(c):
                x = abs(float(c.iloc[-1]) / float(o.iloc[0]) - 1)
                out[d] = '<0.5%' if x < 0.005 else ('0.5-1.5%' if x <= 0.015 else '>1.5%')
    return out


def stats_of(t):
    if not len(t):
        return {'n': 0}
    r = t.ret_net.values
    lo, hi = cluster_ci_mean(r, t.day.values, n_boot=4000)
    glo, ghi = cluster_ci_mean(t.ret_gross.values, t.day.values, n_boot=2000)
    w, l = r[r > 0], r[r <= 0]
    return {'n': int(len(t)), 'sessions': int(t.day.nunique()), 'win': float((r > 0).mean()), 'exp': float(r.mean()),
            'lo': lo, 'hi': hi, 'exp_gross': float(t.ret_gross.mean()), 'glo': glo, 'ghi': ghi, 'median': float(np.median(r)),
            'payoff': float(w.mean() / abs(l.mean())) if len(w) and len(l) and l.mean() != 0 else float('nan'),
            'dpd': float(t.pnl_net.sum() / t.cost.sum()), 'pnl': float(t.pnl_net.sum()),
            'prem_med': float(100 * t.fill.median()), 'delta_med': float(t.delta.median()),
            'sharpe': float(r.mean() / (r.std(ddof=1) + 1e-12)) if len(r) > 1 else float('nan')}


def fmt(s):
    if not s.get('n'):
        return '0 | | | | | |'
    return (f"{s['n']} | {100 * s['win']:.0f}% | {100 * s['exp']:+.1f}% [{100 * s['lo']:+.1f}, {100 * s['hi']:+.1f}] | "
            f"{100 * s['exp_gross']:+.1f}% | {s['payoff']:.2f} | {100 * s['dpd']:+.1f}%")


def side_shuffle(real, opp, n_draw=200, seed=11):
    """N1: per trigger a coin picks the real or the opposite side's trade (both must exist)."""
    m = real.merge(opp[['id', 'ret_net']].rename(columns={'ret_net': 'opp'}), on='id')
    if len(m) < 10:
        return None
    rng = np.random.default_rng(seed)
    a, b, days = m.ret_net.values, m.opp.values, m.day.values
    means, passes = [], 0
    for k in range(n_draw):
        c = rng.random(len(a)) < 0.5
        v = np.where(c, a, b)
        means.append(v.mean())
        if k < 200:
            lo, _ = cluster_ci_mean(v, days, n_boot=500, seed=k)
            passes += lo > 0
    means = np.array(means)
    return {'n_pairs': int(len(m)), 'real_mean_paired': float(a.mean()), 'null_mean': float(means.mean()),
            'beats': float((means < a.mean()).mean()), 'null_pass_rate': passes / min(n_draw, 200)}


def filter_shuffle(sub, base, n_draw=1000, seed=13):
    """N2: random subsets of BASE trades (same cell, same per-mark counts) of the variant's size."""
    if not len(sub) or len(base) <= len(sub):
        return None
    rng = np.random.default_rng(seed)
    cnt = sub.groupby('t').size().to_dict()
    pools = {t: base[base.t == t].ret_net.values for t in cnt}
    means = np.empty(n_draw)
    for k in range(n_draw):
        means[k] = np.concatenate([rng.choice(pools[t], c, replace=False) if len(pools[t]) >= c else pools[t] for t, c in cnt.items()]).mean()
    return {'null_mean': float(means.mean()), 'beats': float((means < sub.ret_net.mean()).mean()),
            'p95': float(np.percentile(means, 95))}


def main():
    ev = pd.read_parquet(os.path.join(OUT, 'events_DEV.parquet'))
    res = load_res(['P1', 'P2', 'P3', 'P4'])
    dtypes = day_types()
    ev['year'] = ev.day.str[:4]
    ev['daytype'] = ev.day.map(dtypes)
    ev['right'] = np.where(ev.side > 0, 'call', 'put')
    trd = res[res.get('fill').notna()] if 'fill' in res else res.iloc[:0]
    skip = res[res.get('fill').isna()] if 'fill' in res else res
    real = trd[trd.sideflip == 1].merge(ev, on='id', suffixes=('', '_ev'))
    opp = trd[trd.sideflip == -1].merge(ev, on='id', suffixes=('', '_ev'))
    real.to_parquet(os.path.join(OUT, 'trades_real.parquet'), index=False)
    try:
        syn = json.load(open(os.path.join(HERE, 'results', 'synthetic_null.json')))
    except Exception:
        syn = {}
    n_trials = max(ledger_trials(p) for p in LEDGERS if os.path.exists(p))
    L = ['# EDGE-G DEV results (R1 flip / R2 wall room / R3 realised > implied)', '',
         f'Pre-registration specs/PREREG.md @ 760ba8d. Net of $0.65/side; ask in / bid out on 1-second NBBO, +2 s; '
         f'session-clustered 95% CI (4,000 boots). Ledger trial count for DSR: {n_trials}.', '']
    # coverage
    L += ['## Coverage', '', '| phase | trades | skipped (reason: count) |', '|---|---:|---|']
    for ph in ('P1', 'P2', 'P3', 'P4'):
        sk = skip[skip.phase == ph]
        L.append(f"| {ph} | {int(((trd.phase == ph)).sum()) if len(trd) else 0} | "
                 + ', '.join(f'{k}: {v}' for k, v in sk['skip'].value_counts().items()) + ' |')
    L += ['', f"Triggers: R1A {int((ev.fam == 'R1A').sum())}, R1B {int((ev.fam == 'R1B').sum())}, BASE {int((ev.fam == 'BASE').sum())} "
          f"(R2-CLEAR {int(ev.r2_clear.sum())}, R2-BLOCKED {int(ev.r2_blocked.sum())}, R3 {int(ev.r3.sum())}); "
          f"{ev.day.nunique()} sessions.", '']
    summ = {}
    L += ['## Every variant', '', '| variant | cell | n | win | expectancy net [95% CI] | gross | payoff | $ per $ | N1 side-shuffle beats (pass rate) | N2 filter beats | N3 synthetic beats (FDR) | DSR |',
          '|---|---|---:|---:|---|---:|---:|---:|---|---|---|---:|']
    M_cols, M_names = [], []
    days_all = sorted(ev.day.unique())
    for name, sel, ex in RULES:
        ids = set(ev[sel(ev)].id)
        for cell in CELLS:
            t = real[(real.id.isin(ids)) & (real.cell == cell) & (real.exit_rule == ex)]
            o = opp[(opp.id.isin(ids)) & (opp.cell == cell) & (opp.exit_rule == ex)]
            s = stats_of(t)
            n1 = side_shuffle(t, o) if len(o) else None
            n2 = None
            if name in ('R2-CLEAR', 'R2-BLOCKED', 'R3'):
                bt = real[(real.id.isin(set(ev[ev.fam == 'BASE'].id))) & (real.cell == cell) & (real.exit_rule == ex)]
                n2 = filter_shuffle(t, bt)
            n3 = syn.get(f'{name}|{cell}')
            dsr = deflated_sharpe(s.get('sharpe', float('nan')), s.get('n', 0), n_trials) if s.get('n', 0) > 2 else {'dsr': float('nan')}
            key = f'{name}|{cell}'
            summ[key] = {**s, 'n1': n1, 'n2': n2, 'n3': n3, 'dsr': dsr.get('dsr')}
            L.append(f"| {name} | {cell} | {fmt(s)} | " + (f"{100 * n1['beats']:.0f}% ({100 * n1['null_pass_rate']:.0f}%)" if n1 else 'not run')
                     + ' | ' + (f"{100 * n2['beats']:.0f}%" if n2 else '-') + ' | '
                     + (f"{100 * n3['beats']:.0f}% ({100 * n3['fdr']:.0f}%)" if n3 else 'not run') + f" | {dsr.get('dsr', float('nan')):.3f} |")
            per = t.groupby('day').ret_net.mean().reindex(days_all).fillna(0.0).values if len(t) else np.zeros(len(days_all))
            M_cols.append(per); M_names.append(key)
    M = np.column_stack(M_cols)
    pbo = pbo_cscv(M, n_blocks=16)
    L += ['', f"PBO (CSCV, 16 blocks, {M.shape[1]} variants x {M.shape[0]} sessions, zero on no-trade sessions): **{pbo['pbo']:.2f}**", '']
    # R2 paired contrast: per-session difference CLEAR - BLOCKED
    L += ['## R2 contrast: CLEAR minus BLOCKED (per-session means, sessions with both)', '', '| cell | sessions | diff [95% CI] |', '|---|---:|---|']
    for cell in CELLS:
        c = real[(real.id.isin(set(ev[(ev.fam == 'BASE') & (ev.r2_clear == 1)].id))) & (real.cell == cell) & (real.exit_rule == 'XA')].groupby('day').ret_net.mean()
        b = real[(real.id.isin(set(ev[(ev.fam == 'BASE') & (ev.r2_blocked == 1)].id))) & (real.cell == cell) & (real.exit_rule == 'XA')].groupby('day').ret_net.mean()
        j = pd.concat([c.rename('c'), b.rename('b')], axis=1).dropna()
        if len(j) > 5:
            d = (j.c - j.b).values
            lo, hi = cluster_ci_mean(d, j.index.values, n_boot=4000)
            L.append(f'| {cell} | {len(j)} | {100 * d.mean():+.1f}% [{100 * lo:+.1f}, {100 * hi:+.1f}] |')
            summ[f'R2diff|{cell}'] = {'n': len(j), 'diff': float(d.mean()), 'lo': lo, 'hi': hi}
    # breakdowns
    for title, col in (('by year', 'year'), ('call vs put', 'right'), ('by day type (|SPX o->c|)', 'daytype'), ('by root', 'root')):
        L += ['', f'## {title}', '', '| variant | cell | ' + ' | '.join(sorted(ev[col].dropna().unique())) + ' |',
              '|---|---|' + '---|' * ev[col].dropna().nunique()]
        vals = sorted(ev[col].dropna().unique())
        for name, sel, ex in RULES:
            ids = set(ev[sel(ev)].id)
            for cell in CELLS:
                t = real[(real.id.isin(ids)) & (real.cell == cell) & (real.exit_rule == ex)]
                cells = []
                for v in vals:
                    x = t[t[col] == v]
                    cells.append(f'{len(x)}: {100 * x.ret_net.mean():+.1f}%' if len(x) else '-')
                L.append(f'| {name} | {cell} | ' + ' | '.join(cells) + ' |')
    # R1a by front sign
    L += ['', '## R1A by the FRONT (0DTE) book at entry', '', '| cell | front dealer-short | front dealer-long |', '|---|---|---|']
    for cell in CELLS:
        t = real[(real.fam == 'R1A') & (real.cell == cell)]
        a, b = t[t.front_short == 1], t[t.front_short == 0]
        L.append(f'| {cell} | {len(a)}: {100 * a.ret_net.mean():+.1f}% | {len(b)}: {100 * b.ret_net.mean():+.1f}% |' if len(t) else f'| {cell} | - | - |')
    # exit reasons and execution artefacts
    L += ['', '## Exit reasons (share of trades)', '', '| variant | cell | reasons |', '|---|---|---|']
    for name, sel, ex in RULES:
        ids = set(ev[sel(ev)].id)
        for cell in CELLS:
            t = real[(real.id.isin(ids)) & (real.cell == cell) & (real.exit_rule == ex)]
            if len(t):
                L.append(f'| {name} | {cell} | ' + ', '.join(f'{k} {100 * v:.0f}%' for k, v in t.reason.value_counts(normalize=True).items()) + ' |')
    if len(real):
        x = real.drop_duplicates(['id', 'cell'])
        L += ['', '## Execution', '', '| cell | trades | median premium $ | median |delta| | median spread at fill | median spread on board | path source |', '|---|---:|---:|---:|---:|---:|---|']
        for cell in CELLS:
            y = x[x.cell == cell]
            if len(y):
                L.append(f'| {cell} | {len(y)} | {100 * y.fill.median():.0f} | {y.delta.median():.2f} | {100 * y.spr_fill.median():.1f}% | {100 * y.spr0.median():.1f}% | '
                         + ', '.join(f'{k} {v}' for k, v in y.src.value_counts().items()) + ' |')
    open(os.path.join(HERE, 'results', 'DEV.md'), 'w').write('\n'.join(L) + '\n')
    json.dump({'pbo': pbo, 'n_trials': n_trials, 'variants': summ}, open(os.path.join(HERE, 'results', 'summary.json'), 'w'), indent=1, default=float)
    print('\n'.join(L[:60]))


if __name__ == '__main__':
    main()
