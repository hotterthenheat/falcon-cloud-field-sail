"""results/*.json -> markdown table (stdout) and ledger lines (results/ledger_lines.txt)."""
from __future__ import annotations

import glob
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def pct(x):
    return 'n/a' if x is None else f'{100 * x:+.1f}%'


def ci(c):
    return 'n/a' if not c else f'[{100 * c[0]:+.1f},{100 * c[1]:+.1f}]'


def row(name, r):
    if not r or r.get('n', 0) == 0:
        return f'| {name} | 0 | | | | | |'
    return (f"| {name} | {r['n']} | {pct(r['expectancy'])} {ci(r['ci_expectancy'])} | {pct(r.get('gross_expectancy'))} | "
            f"{100 * r['win_rate']:.0f}% {ci(r['ci_win_rate'])} | {r.get('payoff', float('nan')):.2f} | "
            f"{'PASS' if r.get('bar', {}).get('pass') else 'fail'} |")


def main():
    lines, ledger = [], []
    for p in sorted(glob.glob(os.path.join(HERE, 'results', '*.json'))):
        R = json.load(open(p))
        fam, split = R['family'], R['split']
        lines.append(f"\n### {fam} {split} — {R['n_event_days']} event days ({','.join(R['events'])}), {R['n_control_days']} control days; "
                     f"ledger trials {R['n_trials_ledger']}; PBO(CSCV over variants) {R.get('pbo_cscv')}")
        if 'realized_vs_implied_event' in R:
            e, c = R['realized_vs_implied_event'], R.get('realized_vs_implied_control', {})
            lines.append(f"Realized |dF| / straddle mid at T-5m — event median: " + ', '.join(f"{k} {v['median']:.2f}" for k, v in e.items())
                         + (' ; control median: ' + ', '.join(f"{k} {v['median']:.2f}" for k, v in c.items()) if c else ''))
            lines.append(f"Straddle implied (mid/F) median: event {R.get('implied_pct_event_median')}, control {R.get('implied_pct_control_median')}; "
                         f"ATM straddle spread/mid at T-5m median {R.get('spread_frac_0825_event_median')}, share <= 8%: {R.get('share_event_days_spread_le_8pct')}")
        lines.append('| variant / set | n | net exp [95% CI] | gross exp | win [CI] | payoff | bar |')
        lines.append('|---|---|---|---|---|---|---|')
        for v, d in R['variants'].items():
            for setname in ('event', 'control', 'contrast_event'):
                if setname in d:
                    lines.append(row(f'{v} {setname}', d[setname]))
                    r = d[setname]
                    if r.get('n', 0):
                        ledger.append(f"2026-11-05 | EDGE-D | {fam} {v} {setname.upper()} | {split} | {r['n']} tr / {r.get('n_sessions')} sess | "
                                      f"net {pct(r['expectancy'])} {ci(r['ci_expectancy'])} (gross {pct(r.get('gross_expectancy'))}), win {100 * r['win_rate']:.0f}% {ci(r['ci_win_rate'])}, "
                                      f"payoff {r.get('payoff', 0):.2f}, by year {{{', '.join(f'{y}: n{x['n']} {pct(x['exp'])}' for y, x in r.get('by_year', {}).items())}}} | "
                                      f"{'PASS' if r.get('bar', {}).get('pass') else 'FAIL'}")
                    else:
                        ledger.append(f"2026-11-05 | EDGE-D | {fam} {v} {setname.upper()} | {split} | 0 | no executable trades | FAIL")
        for k in [k for k in R if k.startswith('shuffled_null') or k.startswith('synthetic_null')]:
            lines.append(f"- {k}: {R[k]}")
            ledger.append(f"2026-11-05 | EDGE-D | {fam} {k} | {split}-null | {R[k].get('n_runs', '')} | mean {pct(R[k].get('mean'))}, p95 {pct(R[k].get('p95'))}, "
                          f"candidate beats {R[k].get('candidate_beats_share')}, CI-pass rate {R[k].get('ci_pass_rate', 'n/a')} | null calibration")
    out = '\n'.join(lines)
    print(out)
    open(os.path.join(HERE, 'results', 'ledger_lines.txt'), 'w').write('\n'.join(ledger) + '\n')
    open(os.path.join(HERE, 'results', 'TABLES.md'), 'w').write(out + '\n')


if __name__ == '__main__':
    main()
