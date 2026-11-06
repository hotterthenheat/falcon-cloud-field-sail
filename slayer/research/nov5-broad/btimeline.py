"""STEP 3: each root's turns (zigzag, hindsight-located) and the strictly-before snapshots of the candidate signs.

Turns: zigzag on the root's 1-second underlying, reversal threshold 0.75% (index roots) / 1.5% (names). For each turn
the snapshot is read at the turn minute and 10 / 30 minutes before (features.parquet rows, all strictly before the
minute). Columns (sign families):
  IV     atm_iv now, its 30-min max / the 60-90-min-ago median (spike ratio), now / 30-min max (release)
  flow   UW chase premium (>= $100k, OTM, <= 7 DTE, ask >= 50%) puts / calls, last 15 min ($M); tick-signed net premium
  micro  ATM displayed size (1-second NBBO, last 5 min) / its session median so far; ATM relative spread
  news   last headline in the 30 minutes before (publication time)

  python3 btimeline.py 20261105 SPXW,SPY,...  -> results/TIMELINE_<D>.md
"""
import os, sys
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'nov5-tape'))
import bload as B  # noqa: E402
from timeline import zigzag  # noqa: E402
from mdt import md  # noqa: E402


def snap(F, T):
    x = F[F['T'] <= T]
    if not len(x):
        return None
    r = x.iloc[-1]
    i = len(x) - 1
    iv = x.atm_iv.values
    pk30 = np.nanmax(iv[max(0, i - 29):i + 1]) if i >= 0 else np.nan
    ref = iv[max(0, i - 89):max(0, i - 59)]
    ref = np.nanmedian(ref) if len(ref) and np.isfinite(ref).any() else np.nan
    ms = x.mic_size.values if 'mic_size' in x else np.full(len(x), np.nan)
    med = np.nanmedian(ms[:i + 1]) if np.isfinite(ms[:i + 1]).any() else np.nan
    return {'T': B.clock(T)[:5], 'S': round(float(r.S), 2), 'from_open': f'{100 * r.from_open:+.2f}%',
            'iv': round(float(r.atm_iv), 3), 'spike pk30/ref': round(pk30 / ref, 2) if ref and np.isfinite(ref) else np.nan,
            'iv/pk30': round(float(r.atm_iv) / pk30, 2) if pk30 else np.nan,
            'chase P/C $M': f"{r.get('uw_chase_p15', np.nan) / 1e6:.1f}/{r.get('uw_chase_c15', np.nan) / 1e6:.1f}",
            'net prem P/C $M': f"{r.get('netprem_p15', np.nan) / 1e6:+.1f}/{r.get('netprem_c15', np.nan) / 1e6:+.1f}",
            'size/med': round(float(r.mic_size) / med, 2) if 'mic_size' in r and med and np.isfinite(r.mic_size) else np.nan,
            'spr': round(float(r.get('mic_spr', np.nan)), 4),
            'news': str(r.get('news_last', ''))[:70]}


def run(D, root):
    F = pd.read_parquet(os.path.join(B.rdir(D, root), 'features.parquet'))
    s, p = B.und_1s(D, root)
    thr = 0.0075 if root in B.ETF else 0.015
    turns = zigzag(s, p, thr)
    rows = []
    for kind, t, px in turns:
        for lag in (30, 10, 0):
            T = (t // 60) * 60 - lag * 60
            if T < B.RTH0 + 60:
                continue
            z = snap(F, T)
            if z is None:
                continue
            rows.append({'root': root, 'turn': f'{kind} {B.clock(t)[:5]} {px:.2f}', 'when': f'-{lag}m' if lag else 'at', **z})
    return turns, pd.DataFrame(rows)


if __name__ == '__main__':
    D = sys.argv[1]
    L = [f'# Turns of {D} on every root, and what was visible strictly before each\n', __doc__.split('\n\n')[0], '']
    allturns = []
    for root in sys.argv[2].split(','):
        turns, df = run(D, root)
        allturns.append({'root': root, 'turns': ', '.join(f'{k} {B.clock(t)[:5]} {px:.2f}' for k, t, px in turns)})
        L.append(f'\n## {root}\n')
        L.append(md(df.drop(columns=['root'])))
    L.insert(3, '## Turn schedule (zigzag)\n\n' + md(pd.DataFrame(allturns)) + '\n')
    txt = '\n'.join(L) + '\n'
    open(os.path.join(HERE, 'results', f'TIMELINE_{D}.md'), 'w').write(txt)
    print(txt[:3000])
