"""Print the EDGE-D2 ledger lines (one per registered variant) from results/part1.json and results/part2.json."""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
p1 = json.load(open(os.path.join(HERE, 'results', 'part1.json')))
p2 = json.load(open(os.path.join(HERE, 'results', 'part2.json')))
D = '2026-11-06 | EDGE-D2'
for model in ('P', 'O', 'F'):
    for t in ('Y1', 'Y2', 'Y3'):
        m = p1[f'{model}|{t}']
        nb = f"shuffled-label null beats {100 * m['null_beats']:.0f}% (FDR {100 * m['null_fdr']:.1f}%)" if 'null_beats' in m else 'null not run'
        print(f"{D} | D2-P1 forecast {model} {t} | DEV OOS walk-forward | {m['n']} days ({m['pos']} pos) | AUC {m['auc']:.3f} "
              f"[{m['auc_lo']:.3f},{m['auc_hi']:.3f}], Brier skill {100 * m['bss']:+.1f}%, flagged {100 * m['flag_rate']:.0f}%, "
              f"precision {100 * m['precision']:.0f}%, recall {100 * m['recall']:.0f}% | {nb}; skill vs VIX alone see PART1.md")
for k, v in p2.items():
    if k.startswith('_'):
        continue
    s, a, pf = v['forecast'], v['all'], v['perfect']['Y1']
    if s.get('n'):
        r = (f"win {100 * s['win']:.0f}%, exp {100 * s['exp']:+.1f}% [{100 * s['lo']:+.1f},{100 * s['hi']:+.1f}] net, $/$ {100 * s['dpd']:+.1f}%; "
             f"all days {100 * a['exp']:+.1f}% (n {a['n']}); perfect-filter (hindsight) {100 * pf['exp']:+.1f}% (n {pf['n']})")
        nl = f"Null A beats {100 * s['nullA_beats']:.0f}%, Null B beats {100 * s['nullB_beats']:.0f}%, DSR {s['dsr']:.3f}"
    else:
        r, nl = 'no trades', '-'
    print(f"{D} | D2-P2 {k.replace('|', ' ')} | DEV | {s.get('n', 0)} | {r} | {'PASS' if s.get('pass_ex_pbo') and p2['_pbo'] < 0.3 else 'FAIL'}; {nl}; PBO {p2['_pbo']:.2f}")
print(f"{D} | D2 SUMMARY | - | - | - | 9 forecast + 60 filtered-rule variants; {len(p2['_passed'])} pass DEV; nothing fetched for 2025, nothing frozen, LOCKED untouched | compass-v2/edge-d2/LOG.md, results/PART1.md, results/PART2.md")
