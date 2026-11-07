"""Fetch the 1-second windows for a plan (resumable). One request in flight per process.

  python3 -m foundation.q1s_fetch plan_base.parquet [--part i/n] [--maxprio p] [--minprio p] [--roots A,B]

For each planned (root, day, t): select from the board at t (lib.board): the 0.30-delta call and put (|delta| in
[0.15, 0.50], nearest 0.30) and the ATM strike (nearest the parity forward with both quotes valid); for signal rows
only the signalled side. Fetch the windows for the entry and the exits at +15/+30/+60 min and the close. Selections are
appended to v2data/edge0dte/selections/{root}.jsonl (status ok / nosel / nodata). Days without a board or bars yet are
deferred and retried on the next pass (the gap fetcher may still be filling them).
"""
import json
import os
import shutil
import sys
import time

import numpy as np
import pandas as pd

from lib import fills
from lib.board import Session
from lib.config import DATA, split
from lib.data import chain, bars

H = (15, 30, 60, 'close')


def sel_path(root):
    return os.path.join(DATA, 'selections', f'{root}.jsonl')


def done_keys():
    out = set()
    d = os.path.join(DATA, 'selections')
    if not os.path.isdir(d):
        return out
    for f in os.listdir(d):
        if f.endswith('.jsonl'):
            for line in open(os.path.join(d, f)):
                r = json.loads(line)
                out.add((r['root'], r['day'], int(r['t']), r.get('side', 'all')))
    return out


def select_all(sess, t, side):
    rec = {'S': sess.spot(t), 'iv_atm': sess.iv_atm(t)}
    legsets = {}
    if side in ('all', 'call'):
        c = sess.select_delta(t, True)
        if c:
            rec.update({'call_k': c['k'], 'call_delta': c['delta'], 'call_bid': c['bid'], 'call_ask': c['ask'], 'F': c['F']})
            legsets['call'] = [(c['k'], True, 1)]
    if side in ('all', 'put'):
        p = sess.select_delta(t, False)
        if p:
            rec.update({'put_k': p['k'], 'put_delta': p['delta'], 'put_bid': p['bid'], 'put_ask': p['ask'], 'F': p['F']})
            legsets['put'] = [(p['k'], False, 1)]
    if side == 'all':
        a = sess.select_atm(t)
        if a:
            rec.update({'atm_k': a['k'], 'atm_cb': a['call_bid'], 'atm_ca': a['call_ask'], 'atm_pb': a['put_bid'],
                        'atm_pa': a['put_ask'], 'F': a['F']})
            legsets['straddle'] = [(a['k'], True, 1), (a['k'], False, 1)]
    return rec, legsets


def main():
    plan = pd.read_parquet(os.path.join(DATA, sys.argv[1]))
    if 'side' not in plan.columns:
        plan['side'] = 'all'
    if '--maxprio' in sys.argv:
        plan = plan[plan.prio <= int(sys.argv[sys.argv.index('--maxprio') + 1])]
    if '--minprio' in sys.argv:
        plan = plan[plan.prio >= int(sys.argv[sys.argv.index('--minprio') + 1])]
    if '--roots' in sys.argv:
        plan = plan[plan.root.isin(sys.argv[sys.argv.index('--roots') + 1].split(','))]
    if '--part' in sys.argv:
        i, n = map(int, sys.argv[sys.argv.index('--part') + 1].split('/'))
        keys = plan[['root', 'day']].drop_duplicates().reset_index(drop=True)
        keys = keys[keys.index % n == i]
        plan = plan.merge(keys, on=['root', 'day'])
    plan = plan[plan.day.map(split).isin(['DISCOVERY', 'CALIBRATION'])]
    os.makedirs(os.path.join(DATA, 'selections'), exist_ok=True)
    t0 = time.time()
    nreq = 0
    from lib import data as _data
    for npass in range(400):
        _data.bars_month.cache_clear()
        _data._chain.cache_clear()
        done = done_keys()
        todo = plan[[(r, d, int(t), s) not in done for r, d, t, s in zip(plan.root, plan.day, plan.t, plan.side)]]
        if not len(todo):
            print('all done', flush=True)
            return
        progressed = 0
        deferred = 0
        groups = list(todo.groupby(['root', 'day'], sort=False))
        for gi, ((root, day), g) in enumerate(groups):
            if shutil.disk_usage('/').free < 1.2e9:
                print('STOP: free disk below 1.2 GB', flush=True)
                return
            if chain(root, day) is None or not len(bars(root, day)):
                gap_running = os.path.exists(os.path.join(DATA, 'fetch_gaps.pid')) and \
                    os.path.exists(f"/proc/{open(os.path.join(DATA, 'fetch_gaps.pid')).read().strip()}")
                if gap_running:
                    deferred += 1
                    continue
                recs = [{'root': root, 'day': day, 't': int(t), 'side': s, 'purpose': p, 'status': 'nodata'}
                        for t, s, p in zip(g.t, g.side, g.purpose)]
            else:
                sess = Session(root, day)
                recs, plan_w = [], []
                for t, s, p in zip(g.t, g.side, g.purpose):
                    t = int(t)
                    rec, legsets = select_all(sess, t, s)
                    exits = [fills.exit_decision(day, t, h) for h in H]
                    for legs in legsets.values():
                        plan_w.append((legs, t, exits))
                    rec.update({'root': root, 'day': day, 't': t, 'side': s, 'purpose': p,
                                'status': 'ok' if legsets else 'nosel'})
                    recs.append({k: (None if isinstance(v, float) and not np.isfinite(v) else v) for k, v in rec.items()})
                if plan_w:
                    nreq += fills.prefetch(root, day, plan_w)
            with open(sel_path(root), 'a') as f:
                for r in recs:
                    f.write(json.dumps(r) + '\n')
            progressed += len(recs)
            if gi % 20 == 0:
                print(f'pass {npass} {gi}/{len(groups)} {root} {day} req {nreq} {time.time() - t0:.0f}s '
                      f'free {shutil.disk_usage("/").free / 1e9:.2f}GB', flush=True)
        print(f'pass {npass} done: {progressed} rows, {deferred} days deferred', flush=True)
        if not progressed:
            time.sleep(300)


if __name__ == '__main__':
    main()
