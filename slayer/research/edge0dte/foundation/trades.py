"""Executable trades from the selections (lib.fills; ask in / bid out on 1-second NBBO), DISCOVERY + CALIBRATION only.

  python3 -m foundation.trades            -> v2data/edge0dte/trades.parquet

One row per (root, day, t, purpose, structure, horizon). Structures: 'call' (0.30-delta call), 'put' (0.30-delta put),
'straddle' (ATM call + put). Signal rows (ema / orb) carry only their side. Horizons 15, 30, 60, 'close' (exit decision
min(t + h, close - 2 min)). Columns (label):
  ret, ret_gross, ret_mid, ret_fee130, ret_tick1   CALC from OBS fills (net of $0.65 fees / no fees / mid-to-mid /
                                                   $1.30 fees / +1 tick each side), fraction of premium
  premium, pnl, fees, cost_rt, zero_bid           $ per structure (1 lot); cost_rt = (half-spreads in and out + fees)
                                                   / premium
  skip                                            reason when no valid quote within 60 s (counted, never filled)
  Z, V                                            CALC outcomes at (t, h) (lib.outcomes), za = sign-aligned Z
                                                   (call +Z, put -Z, straddle |Z|)
  u_ret                                           CALC underlying log return from S(t) to S(exit decision) (bar closes)
"""
import json
import math
import os
import sys
from multiprocessing import Pool

import numpy as np
import pandas as pd

from lib import fills
from lib.board import Session
from lib.config import DATA, ROOTS, bucket, split
from lib.outcomes import zv

H = (15, 30, 60, 'close')


def load_selections():
    rows = []
    for root in ROOTS:
        f = os.path.join(DATA, 'selections', f'{root}.jsonl')
        if os.path.exists(f):
            rows += [json.loads(x) for x in open(f)]
    df = pd.DataFrame(rows)
    df = df.drop_duplicates(['root', 'day', 't', 'side', 'purpose'], keep='last')
    return df[df.day.map(split).isin(['DISCOVERY', 'CALIBRATION'])]


def legsets(r):
    out = {}
    if isinstance(r.get('call_k'), float) and np.isfinite(r['call_k']):
        out['call'] = [(float(r['call_k']), True, 1)]
    if isinstance(r.get('put_k'), float) and np.isfinite(r['put_k']):
        out['put'] = [(float(r['put_k']), False, 1)]
    if r.get('side', 'all') == 'all' and isinstance(r.get('atm_k'), float) and np.isfinite(r['atm_k']):
        out['straddle'] = [(float(r['atm_k']), True, 1), (float(r['atm_k']), False, 1)]
    return out


def day_trades(args):
    root, day, recs = args
    sess = Session(root, day)
    out = []
    for r in recs:
        t = int(r['t'])
        iv = sess.iv_atm(t)
        oc = {h: zv(sess, t, h, iv) for h in H}
        for struct, legs in legsets(r).items():
            for h in H:
                x = fills.exit_decision(day, t, h)
                s = fills.simulate(root, day, legs, t, x, fetch=False)
                row = {'root': root, 'day': day, 't': t, 'purpose': r['purpose'], 'split': split(day),
                       'bucket': bucket(t), 'struct': struct, 'h': str(h), 'x': x, 'skip': s['skip'],
                       'Z': oc[h]['Z'], 'V': oc[h]['V'], 'iv_atm': iv,
                       'k': legs[0][0], 'delta': r.get(f'{struct}_delta', np.nan)}
                z = oc[h]['Z']
                row['za'] = z if struct == 'call' else (-z if struct == 'put' else abs(z))
                s0, s1 = sess.spot(t), sess.spot(x)
                row['u_ret'] = math.log(s1 / s0) if np.isfinite(s0) and np.isfinite(s1) else np.nan
                if not s['skip'] and s.get('premium'):
                    s130 = fills.simulate(root, day, legs, t, x, fee=1.30, fetch=False)
                    st1 = fills.simulate(root, day, legs, t, x, ticks=1, fetch=False)
                    row.update({'ret': s['ret'], 'ret_gross': s['ret_gross'], 'ret_mid': s['ret_mid'],
                                'ret_fee130': s130.get('ret', np.nan), 'ret_tick1': st1.get('ret', np.nan),
                                'premium': s['premium'], 'pnl': s['pnl'], 'fees': s['fees'], 'cost_rt': s['cost_rt'],
                                'zero_bid': s['zero_bid_exits'], 'wait_in': max(l['entry_s'] - t - 2 for l in s['legs']),
                                'entry_s': s['legs'][0]['entry_s']})
                elif not s['skip']:
                    row['skip'] = 'no_premium'
                out.append(row)
    return out


def main():
    sel = load_selections()
    sel = sel[sel.status == 'ok']
    jobs = [(root, day, g.to_dict('records')) for (root, day), g in sel.groupby(['root', 'day'])]
    print(len(sel), 'selections', len(jobs), 'root-days', flush=True)
    rows = []
    with Pool(int(os.environ.get('PROCS', '3'))) as p:
        for i, r in enumerate(p.imap_unordered(day_trades, jobs, chunksize=4)):
            rows += r
            if i % 200 == 0:
                print(i, len(jobs), flush=True)
    df = pd.DataFrame(rows)
    df.to_parquet(os.path.join(DATA, 'trades.parquet'), compression='zstd')
    print(df.groupby(['root', 'purpose', 'struct', 'h']).agg(n=('t', 'size'), skips=('skip', lambda x: x.notna().sum())))


if __name__ == '__main__':
    main()
