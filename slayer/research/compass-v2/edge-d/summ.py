"""Print a compact summary of results/<family>_<split>.json files given on the command line."""
import json
import sys


def ci(c):
    return '[%+.3f,%+.3f]' % (c[0], c[1]) if c else 'n/a'


for f in sys.argv[1:]:
    R = json.load(open(f))
    print('=====', f, R.get('n_event_days'), 'event days', R.get('n_control_days'), 'controls', 'PBO', R.get('pbo_cscv'))
    for k in ('realized_vs_implied_event', 'realized_vs_implied_control'):
        v = R.get(k)
        if isinstance(v, dict):
            print(' ', k, {a: round(b['median'], 2) for a, b in v.items()})
    for k in ('implied_pct_event_median', 'implied_pct_control_median', 'spread_frac_0825_event_median', 'share_event_days_spread_le_8pct'):
        if k in R:
            print(' ', k, R[k])
    for v, d in R.get('variants', {}).items():
        for s, r in d.items():
            if r.get('n'):
                yrs = {y: (x['n'], round(x['exp'], 3)) for y, x in r.get('by_year', {}).items()}
                print('  %s %-15s n=%3d exp=%+.3f ci=%s gross=%+.3f win=%.2f years=%s' % (
                    v, s, r['n'], r['expectancy'], ci(r['ci_expectancy']), r.get('gross_expectancy', float('nan')), r['win_rate'], yrs))
            else:
                print('  %s %-15s n=0' % (v, s))
    for k in R:
        if 'null' in k:
            print(' ', k, R[k])
