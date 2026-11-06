"""Append EDGE-G's per-variant DEV result lines to the worktree ledger (run once, from results/summary.json)."""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
LEDGER = os.path.join(HERE, '..', '..', '..', '..', 'research-v2-ledger.md')
s = json.load(open(os.path.join(HERE, 'results', 'summary.json')))
V, pbo = s['variants'], s['pbo']['pbo']
names = {'R1A': 'R1a FLIP-CROSS', 'R1B': 'R1b FLIP-AHEAD', 'R2-CLEAR': 'R2-CLEAR', 'R2-BLOCKED': 'R2-BLOCKED (contrast)',
         'R3': 'R3 RV>IV', 'BASE-XA': 'BASE-XA (reference)', 'BASE-XB': 'BASE-XB (reference)'}
lines = []
for k in names:
    for c in ('0D30', '0D45', '1D45'):
        v = V[f'{k}|{c}']
        n1, n2, n3 = v['n1'], v['n2'], v['n3']
        nulls = (f"N1 beats {100 * n1['beats']:.0f}%" + (f", N2 beats {100 * n2['beats']:.0f}%" if n2 else '')
                 + f", N3 beats {100 * n3['beats']:.0f}% (FDR {100 * n3['fdr']:.0f}%)")
        lines.append(f"2026-11-06 | EDGE-G | {names[k]} {c} | DEV (547 sessions, 1-s NBBO, +2 s) | {v['n']} | win {100 * v['win']:.0f}%, "
                     f"exp {100 * v['exp']:+.1f}% [{100 * v['lo']:+.1f},{100 * v['hi']:+.1f}] net (gross {100 * v['exp_gross']:+.1f}%), "
                     f"payoff {v['payoff']:.2f}, $/$ {100 * v['dpd']:+.1f}% | FAIL; {nulls}; DSR 0.000")
d = {c: V[f'R2diff|{c}'] for c in ('0D30', '0D45', '1D45')}
lines.append(f"2026-11-06 | EDGE-G | SUMMARY: PBO over the 21 variants {pbo:.2f}; R2 CLEAR-BLOCKED per-session diff "
             + ', '.join(f"{c} {100 * x['diff']:+.1f}% [{100 * x['lo']:+.1f},{100 * x['hi']:+.1f}]" for c, x in d.items())
             + " (right sign, CLEAR itself negative); nothing passes DEV, nothing fetched for 2025, nothing frozen, LOCKED untouched | - | - | - | edge-g/LOG.md, edge-g/results/DEV.md")
txt = open(LEDGER).read()
if 'EDGE-G | SUMMARY' not in txt:
    with open(LEDGER, 'a') as f:
        f.write('\n'.join(lines) + '\n')
print('\n'.join(lines[-4:]))
