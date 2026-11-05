"""K5 (frozen 2026-10-31, research/challenger/candidates.py k5_overnight_spx_hard) scored on the locked H2 ONCE.

  python3 k5_h2.py --dev          reproduce the development number (no holdout rows read)
  python3 k5_h2.py --h2           the one look; refuses if the result file exists

The candidate function is imported unchanged from the challenger. Rows are SPXW overnight only (K5 never reads
another root; the seat rules are per root, so the calls are identical). Exit: the frozen hard-stop rule on the
one-minute path (hit50 / worstPre / flatBid), as K5's development number was computed; fees reported both ways.
"""
import argparse, json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import chal
import candidates as K  # the challenger's frozen file

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'results')
FEE = 0.65 * 2  # $ per contract round trip


def calls_table(S):
    idx, ex = K.k5_overnight_spx_hard(S, np.ones(len(S.df), bool))
    rows = []
    for i in idx:
        f = S.fill[i]
        if not (f > 0) or not np.isfinite(S.pnl_hard[i]):
            continue
        r = S.pnl_hard[i] / (f * 100)
        rows.append({'day': str(S.df.at[i, 'day']), 'contract': str(S.df.at[i, 'contract']), 'mark': str(S.df.at[i, 'mark']),
                     'delta': float(S.df.at[i, 'c14']), 'fill': float(f), 'win': bool(S.win_hard[i]), 'ret': float(r),
                     'ret_fee': float((S.pnl_hard[i] - FEE) / (f * 100 + 0.65)), 'usd': float(S.pnl_hard[i])})
    return rows


def boot(rows, days, key, n=4000, seed=3):
    by = {d: [] for d in days}
    for r in rows:
        by[r['day']].append(r[key])
    arrs = [np.asarray(by[d], float) for d in sorted(by)]
    rng = np.random.default_rng(seed)
    def f(sel):
        m = sum(len(arrs[i]) for i in sel)
        return sum(arrs[i].sum() for i in sel) / m if m else np.nan
    pt = f(range(len(arrs)))
    bs = [f(rng.integers(0, len(arrs), len(arrs))) for _ in range(n)]
    return pt, *np.nanpercentile(bs, [2.5, 97.5])


def report(rows, days, label):
    out = [f'{label}: {len(days)} sessions, {len(rows)} calls']
    if not rows:
        return '\n'.join(out)
    for k, name in (('win', 'win'), ('ret', 'return/call (no fee)'), ('ret_fee', 'return/call (fee $0.65/side)')):
        pt, lo, hi = boot([{**r, 'win': float(r['win'])} for r in rows], days, k)
        out.append(f'  {name}: {100 * pt:+.1f}% [{100 * lo:+.1f}, {100 * hi:+.1f}]')
    w = [r['ret'] for r in rows if r['win']]
    l = [r['ret'] for r in rows if not r['win']]
    out.append(f'  avg win {100 * np.mean(w) if w else float("nan"):+.1f}%, avg loss {100 * np.mean(l) if l else float("nan"):+.1f}%, $/call {np.mean([r["usd"] for r in rows]):+.0f}')
    return '\n'.join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dev', action='store_true')
    ap.add_argument('--h2', action='store_true')
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    if a.dev:
        os.environ['DEV_WITH_H1'] = '1'
        days = chal.B.dev_days()
        S = chal.Sessions(days, roots=['SPXW'], session='overnight')
        rows = calls_table(S)
        print(report(rows, days, 'K5 development (all built non-H2 sessions)'))
        return
    if a.h2:
        # Anti-bias control 12: the research worker (EDGE) never runs this; only the separate blind scorer does.
        if os.environ.get('BLIND_SCORER') != '1':
            sys.exit('the locked H2 look is reserved for the blind scorer (set BLIND_SCORER=1 there, not here)')
        f = os.path.join(os.environ.get('SCORER_OUT', OUT), 'K5-H2.json')
        if os.path.exists(f):
            sys.exit(f'K5 already scored on H2 ({f}); not looking again')
        days = chal.B.holdout2_days()
        S = chal.Sessions(days, roots=['SPXW'], session='overnight')
        rows = calls_table(S)
        txt = [report(rows, days, 'K5 LOCKED H2 (one look)')]
        for blk, pre in (('H2-2022Q3', '2022'), ('H2-2025Q1', '2025')):
            dd = [d for d in days if d.startswith(pre)]
            txt.append(report([r for r in rows if r['day'].startswith(pre)], dd, blk))
        print('\n'.join(txt))
        json.dump({'days': days, 'calls': rows, 'text': txt}, open(f, 'w'), indent=1)


if __name__ == '__main__':
    main()
