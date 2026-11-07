"""FOUNDATION task 1: verify, per (root, session), that a same-day expiry was listed AND traded (REGISTRY_ADDENDUM_1
section 1: defined by the record, never by a pattern). U1 only (SPXW, SPY, QQQ, IWM).

  cd slayer/research/edge0dte && python3 -m foundation.expiry_check [ROOT ...]
  -> v2data/edge0dte/expiry_check/{ROOT}.jsonl (resumable, one line per NYSE session 2020-02-18 .. 2025-12-31)

For EVERY NYSE session D (exchange calendar), listed or not, one ThetaData request: the option EOD report of the series
expiring D, on D (`/option/history/eod?symbol=R&expiration=D&start_date=D&end_date=D`). Recorded (OBS):
  listed     D is in ThetaData's expiration list for R (lib.cal.expiries)
  n          contracts in the EOD report (0 = no series expiring D exists in the record)
  traded     contracts with volume > 0 on D;  volume, count = total contracts and prints on D
  status     ok / nodata (empty report) / fail (request failed; retried on the next run)
A session is a 0DTE session for R iff listed and count > 0. Sessions listed but not traded, and sessions with prints
for an expiry that is not in the list, are anomalies and are reported in results/COVERAGE.md.
Order: listed sessions <= 2024, unlisted sessions, then 2025. One request in flight.
"""
import io
import json
import os
import sys
import time

import pandas as pd

from lib import cal
from lib.config import DATA, ROOTS
from lib.theta import get

OUT = os.path.join(DATA, 'expiry_check')


def path(root):
    return os.path.join(OUT, f'{root}.jsonl')


def load(root):
    f = path(root)
    if not os.path.exists(f):
        return {}
    out = {}
    for line in open(f):
        r = json.loads(line)
        out[r['day']] = r
    return out


def check(root, day):
    y = day.replace('-', '')
    t = get(f'/option/history/eod?symbol={root}&expiration={y}&start_date={y}&end_date={y}&format=csv', tries=3)
    rec = {'root': root, 'day': day, 'listed': day in cal.expiries(root)}
    if t is None:
        rec['status'] = 'fail'
        return rec
    if not t.strip():
        rec.update({'status': 'nodata', 'n': 0, 'traded': 0, 'volume': 0, 'count': 0})
        return rec
    df = pd.read_csv(io.StringIO(t))
    df = df[pd.to_datetime(df['expiration']).dt.strftime('%Y-%m-%d') == day]
    rec.update({'status': 'ok', 'n': int(len(df)), 'traded': int((df.volume > 0).sum()), 'volume': int(df.volume.sum()),
                'count': int(df['count'].sum())})
    return rec


def main():
    roots = [a for a in sys.argv[1:] if not a.startswith('--')] or list(ROOTS)
    os.makedirs(OUT, exist_ok=True)
    jobs = []
    for phase in range(3):
        for root in roots:
            ex = cal.expiries(root)
            for d in cal.sessions():
                if phase == 0 and d in ex and d < '2025-01-01':
                    jobs.append((root, d))
                elif phase == 1 and d not in ex and d < '2025-01-01':
                    jobs.append((root, d))
                elif phase == 2 and d >= '2025-01-01':
                    jobs.append((root, d))
    done = {r: {d for d, x in load(r).items() if x['status'] != 'fail'} for r in roots}
    jobs = [j for j in jobs if j[1] not in done[j[0]]]
    print(len(jobs), 'requests to make', flush=True)
    t0 = time.time()
    for i, (root, d) in enumerate(jobs):
        rec = check(root, d)
        with open(path(root), 'a') as f:
            f.write(json.dumps(rec) + '\n')
        if i % 50 == 0:
            print(f'{i}/{len(jobs)} {root} {d} {rec["status"]} n={rec.get("n")} count={rec.get("count")} '
                  f'{time.time() - t0:.0f}s', flush=True)
    print('done', flush=True)


if __name__ == '__main__':
    main()
