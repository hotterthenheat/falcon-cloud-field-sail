"""Append one research-v2-ledger.md line per registry row D1-D6 (family EDGE0DTE-S1), from results/stage1/D.parquet.

  cd slayer/research/edge0dte && python3 -m families.d_ledger      (appends; run once)
Format (as foundation/ledger.py): date | family | id | set | n | result | note. SPXW primary-parameter cells are listed
(raw effect, 95% CI, bootstrap p); replication roots are summarised by sign agreement. No FDR, no pass/fail.
"""
import datetime
import os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, '..', 'results', 'stage1', 'D.parquet')
LEDGER = os.path.join(HERE, '..', '..', '..', '..', 'research-v2-ledger.md')
HORD = {'15': 0, '30': 1, '60': 2, 'close': 3}
NAMES = {'D1': 'RV expansion (ratio > 2) -> ln V > 0', 'D2': 'RV compression (ratio < 0.5) -> ln V < 0',
         'D3': 'signed semivariance top/bottom tercile -> sign-aligned Z > 0 (top short)',
         'D4': 'IV^2/RV60 low tercile -> ln V > 0, high tercile -> ln V < 0',
         'D5': '30-min bucket ln V != 0 (each bucket two-sided)', 'D6': 'unconditional ln V < 0 at 09:45, h = close'}


def cell(r):
    return f"{r.arm} h{r.horizon}: {r.effect:+.3f} [{r.ci_lo:+.3f},{r.ci_hi:+.3f}] p{r.p_value:.4f}" + (
        f" E[V]-1 {r.ev_m1:+.2f}" if r.outcome == 'V' else '')


def main():
    df = pd.read_parquet(RES)
    day = datetime.date.today().isoformat()
    lines = []
    for rid in ('D1', 'D2', 'D3', 'D4', 'D5', 'D6'):
        d = df[(df.row_id == rid) & (df.param_kind == 'P') & df.primary_arm]
        sp = d[(d.root == 'SPXW') & d.effect.notna()]
        sp = sp.assign(_h=sp.horizon.map(HORD)).sort_values(['arm', '_h'])
        n_cells = int(len(sp))
        if rid == 'D5':
            res = (f"{n_cells} SPXW cells; CI excludes 0 in {int(sp.ci_excludes_0.sum())}; mean ln V range "
                   f"{sp.effect.min():+.2f}..{sp.effect.max():+.2f}; E[V]-1 beyond a bucket hurdle (point) in "
                   f"{int(sp.beyond_hurdle_point.sum())}, whole CI beyond in {int(sp.beyond_hurdle_ci.sum())}")
        else:
            res = '; '.join(cell(r) for r in sp.itertuples())
            res += f"; beyond hurdle (point) {int(sp.beyond_hurdle_point.sum())}/{n_cells}"
        rep = d[(d.root != 'SPXW') & d.effect.notna()]
        m = rep.merge(sp[['arm', 'horizon', 'effect']], on=['arm', 'horizon'], suffixes=('', '_spx'))
        agree = int((np.sign(m.effect) == np.sign(m.effect_spx)).sum())
        n = int(sp.n_obs.sum())
        lines.append(f"{day} | EDGE0DTE-S1 | {rid} {NAMES[rid]} | DISCOVERY | {n} obs / {int(sp.n_sessions.max()) if n_cells else 0} sess (SPXW) | "
                     f"{res} | replication SPY/QQQ/IWM same sign as SPXW in {agree}/{len(m)} cells; "
                     f"{n_cells} FDR-family cells (SPXW, P); grid G reported; edge0dte/results/stage1/D.md; raw, no FDR applied")
    with open(LEDGER, 'a') as f:
        f.write('\n'.join(lines) + '\n')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
