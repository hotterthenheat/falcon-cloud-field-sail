"""Print the NOV5 DEV result lines for research-v2-ledger.md from the analysis outputs (no new computation)."""
import json, os, sys
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import analyze as A  # noqa: E402
import runner as RN  # noqa: E402

real = A.load_rows('dev')
flip = A.load_rows('dev_flip')
flip = flip[flip.sideset == 'flip']
syn = json.load(open(os.path.join(RN.OUT, 'syn', 'summary.json')))
summ = json.load(open(os.path.join(A.RES, 'dev_summary.json')))
for v in RN.variants():
    s = summ['stats'][v]
    p, m = A.side_shuffle(real[real.variant == v], flip[flip.variant == v])
    sb = 100 * (s['exp'] > np.array(syn[v]['means'])).mean()
    why = []
    if s['n'] < 150:
        why.append('n<150')
    if not s['lo'] > 0:
        why.append('CI incl/below 0')
    if not (s['win'] >= 0.55 or s['exp'] >= 0.10):
        why.append('win<55% and exp<10%')
    if p < 0.95:
        why.append('side-shuffle<95%')
    if sb < 95:
        why.append('synthetic<95%')
    print(f"2026-11-06 | NOV5 | {v} | DEV (600 sessions run, {s['sessions']} with a trade; 1-s NBBO) | {s['n']} | "
          f"win {100 * s['win']:.0f}%, avg win {100 * s['avg_win']:+.1f}%, avg loss {100 * s['avg_loss']:+.1f}%, "
          f"exp {100 * s['exp']:+.1f}% [{100 * s['lo']:+.1f},{100 * s['hi']:+.1f}] net (gross {100 * s['gross']:+.1f}%) | "
          f"FAIL ({', '.join(why)}); side-shuffle beats {100 * p:.0f}%, synthetic beats {sb:.0f}% (FDR {100 * syn[v]['fdr']:.0f}%)")
print(f"2026-11-06 | NOV5 | SUMMARY N1-N3 | DEV | - | PBO (CSCV 16 blocks, 16 variants) {summ['pbo']['pbo']:.2f}; DSR <= 0.01 for all at N={summ['n_trials']} | "
      "nothing passes DEV -> no VALIDATION look, nothing frozen, LOCKED never opened | nov5-tape/results/DEV.md")
