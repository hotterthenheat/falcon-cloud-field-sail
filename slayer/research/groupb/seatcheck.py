"""Seat check: evaluate.py's seat simulation with the current trees (the engine's own p1/prun columns, 0.7067 / 0.50,
version 1's theta gate) against the engine's own would-calls on the same session (research/groupb/would.ts).
  GB_DATA=... python -I research/groupb/seatcheck.py 2022-06-01 [...]"""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rows as R
import evaluate as E

bad = 0
for day in sys.argv[1:]:
    eng = json.load(open(os.path.join(R.DATA, f'would-{day}.json')))
    df = R.load([day], objects=True)
    calls = E.seat_calls(df, df['p1'].values.astype(float), df['prun'].values.astype(float), 0.7067, 0.5, df['burns1'].values == 1)
    sim = [(df['id'].values[i], int(df['markMs'].values[i]), b) for i, b, _ in calls]
    want = [(c['id'], int(c['mark']), c['book']) for c in eng]
    same = sorted(sim) == sorted(want)
    bad += 0 if same else 1
    print(day, 'engine', len(want), 'simulation', len(sim), 'same' if same else 'DIFFER')
    if not same:
        print('  engine only', sorted(set(want) - set(sim))[:10])
        print('  sim only', sorted(set(sim) - set(want))[:10])
sys.exit(1 if bad else 0)
