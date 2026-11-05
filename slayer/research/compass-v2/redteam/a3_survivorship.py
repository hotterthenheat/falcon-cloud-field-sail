"""Attack 3: which nights get a call and why, under the as-tested gate (open) and the honest universe (none)."""
import os, sys, json, numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rt

res = json.load(open('k5_honest_calls.json'))
mk = pd.read_csv('k5_honest_marks.csv')
first = mk.sort_values(['day', 'mark']).groupby('day').first().reset_index()
first['open_minus_S0'] = first.open - first.S            # the move from the 00:00 spot to the 09:30 open (unknown at the mark)
first['close_minus_open'] = first.close - first.open
first['abs_to_open'] = first.open_minus_S0.abs()
first['called_open'] = first.day.map(lambda d: res.get(d, {}).get('open') is not None)
first['called_none'] = first.day.map(lambda d: res.get(d, {}).get('none') is not None)
# how often did any mark have a band row on each side / passing each gate
agg = mk.groupby('day').agg(any_band=('n_band_C', lambda s: int(((s > 0) | (mk.loc[s.index, 'n_band_P'] > 0)).any())),
                            any_open_gate=('n_band_open_gate', lambda s: int((s > 0).any())),
                            any_spot_gate=('n_band_spot_gate', lambda s: int((s > 0).any())),
                            marks=('mark', 'size'))
first = first.merge(agg, on='day')
print('sessions with a chain:', len(first))
print('nights with ANY 0.10-0.20 delta row on either side (any mark):', int(first.any_band.sum()))
print('nights with a band row within 4 strikes of the OPEN ATM (as-tested gate):', int(first.any_open_gate.sum()), '-> calls', int(first.called_open.sum()))
print('nights with a band row within 4 strikes of the SPOT ATM (live gate):', int(first.any_spot_gate.sum()))
print('nights called by the honest rule (gate=none):', int(first.called_none.sum()))
print('\n|open - S(00:00)| in SPX points: called (gate=open) vs not called')
for lab, g in (('called', first[first.called_open]), ('not called', first[~first.called_open])):
    print(f'  {lab:11s} n={len(g):3d} median {g.abs_to_open.median():6.1f} mean {g.abs_to_open.mean():6.1f} 25-75% [{g.abs_to_open.quantile(.25):.1f}, {g.abs_to_open.quantile(.75):.1f}]')
print('\ncalled nights (gate=open): did the open move toward the strike side?')
cs = pd.DataFrame([c['open'] for c in res.values() if c['open']])
side = np.where(cs.right == 'C', 1, -1)
print('  sign(open - S_mark) == side:', int((np.sign(cs.open - cs.S) == side).sum()), 'of', len(cs), '; median signed move to open', float(((cs.open - cs.S) * side).median()))
print('  (open - S_mark) * side distribution (pts): min', float(((cs.open - cs.S) * side).min()), 'max', float(((cs.open - cs.S) * side).max()))
print('\ndo called nights end up trending? |close - open| pts: called median', first[first.called_open].close_minus_open.abs().median(), 'not called median', first[~first.called_open].close_minus_open.abs().median())
print('|open - prior close| pts (gap): called median', (first[first.called_open].open - first[first.called_open].prior_close).abs().median(), 'not called median', (first[~first.called_open].open - first[~first.called_open].prior_close).abs().median())
cn = pd.DataFrame([c['none'] for c in res.values() if c['none']])
if len(cn):
    sn = np.where(cn.right == 'C', 1, -1)
    print('\nhonest calls (gate=none): sign(open - S_mark) == side:', int((np.sign(cn.open - cn.S) == sn).sum()), 'of', len(cn), '; by mark hour:', cn.mark.str.slice(0, 2).value_counts().sort_index().to_dict())
first.to_csv('a3_survivorship.csv', index=False)
