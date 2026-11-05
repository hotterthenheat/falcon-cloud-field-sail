"""Append the L1 DEV result lines to the global ledger (run once)."""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
r = json.load(open(os.path.join(HERE, 'results', 'L1_DEV.json')))
desc = {'V1': 'S0945 k1.10 XA', 'V2': 'S0945 k1.25 XA', 'V3': 'S0945 k1.40 XA', 'V4': 'S0945 k1.25 XB',
        'V5': 'S1030 k1.25 XA', 'V6': 'D0945 k1.25 XA', 'V7': 'D1030 k1.25 XA', 'V8': 'D1030 k1.25 XB'}
L = []
for v, d in r['variants'].items():
    n = d['nulls']
    lo, hi = d['ci_expectancy']
    verdict = 'FAIL (negative)' if d['expectancy'] <= 0 else 'FAIL (n<100, CI spans 0)'
    L.append(f"2026-11-05 | EDGE-L | L1 {v} {desc[v]} | DEV (1-s NBBO, +2 s, ask in/bid out) | {d['n']} | win "
             f"{d['win_rate']*100:.0f}%, net {d['expectancy']*100:+.1f}% [{lo*100:+.1f},{hi*100:+.1f}] (no fee "
             f"{d['ret_no_fee']*100:+.1f}%), payoff {d['payoff']:.2f}, realized/implied traded {d['roi_traded']:.3f} | "
             f"{verdict}; key null (R<k days) beats {n['key_R_lt_k']['beats']*100:.0f}%, shuffled beats "
             f"{n['shuffled_any_R']['beats']*100:.0f}%, synthetic no-edge mean {n['synthetic_no_edge']['null_mean']*100:+.1f}%; "
             f"null FDR key {n['key_R_lt_k']['fdr']*100:.1f}% / shuf {n['shuffled_any_R']['fdr']*100:.1f}% / syn "
             f"{n['synthetic_no_edge']['fdr']*100:.1f}%")
L.append(f"2026-11-05 | EDGE-L | L1 summary | DEV | 8 variants | realized/implied all DEV sessions 0.908 (09:45) / 0.905 "
         f"(10:30); by R bucket 0.85-0.89 (R<0.9) rising to 0.98 (R>=1.25): R ranks the VRP but never finds sessions where "
         f"realized > implied; short-gamma days 0.911 vs long 0.905 (0DTE implied already prices the regime); PBO "
         f"{r['pbo']['pbo']:.2f}, DSR <= 0.01 (N={r['ledger_trials']}); only V1 has >=100 trades and it is negative -> "
         f"L1 FAILS DEV, no VALIDATION look, nothing frozen | edge-l/results/L1_DEV.json")
L.append("2026-11-05 | EDGE-L | DISCLOSURE | VALIDATION | - | the minute-path sweep (nulls input) also computed the 2025 "
         "VALIDATION rows of the 6 unconditional structures (all sessions, any R; means -13%..+2%) before L1 failed DEV; "
         "no trigger-conditioned VAL number was computed; no decision used it | edge-l/run_l1.py minute")
with open('/home/user/falcon-cloud-field-sail/research-v2-ledger.md', 'a') as f:
    f.write('\n'.join(L) + '\n')
print('\n'.join(L))
