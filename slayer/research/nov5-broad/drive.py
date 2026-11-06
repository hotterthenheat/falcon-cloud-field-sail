"""Resumable fetch driver (one terminal request in flight per driver; run at most two drivers):

  python3 drive.py D ROOT,ROOT,... BAND [steps]        steps: comma list of base,q1s,trades (default all)
  python3 drive.py jobs D:ROOTS:BAND D:ROOTS:BAND ...  several in sequence (+ 'D:IDX:0' for the index series)
"""
import os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
F = os.path.join(HERE, 'fetch_broad.py')


def one(D, roots, band, steps=('base', 'q1s', 'trades')):
    if roots == ['IDX']:
        subprocess.run([sys.executable, F, 'idx', D])
        return
    for st in steps:
        for r in roots:
            subprocess.run([sys.executable, F, st, D, r, band])
    print('DRIVE_DONE', D, roots, steps, flush=True)


if sys.argv[1] == 'jobs':
    for spec in sys.argv[2:]:
        D, roots, band = spec.split(':')
        one(D, roots.split(','), band)
else:
    one(sys.argv[1], sys.argv[2].split(','), sys.argv[3], sys.argv[4].split(',') if len(sys.argv) > 4 else ('base', 'q1s', 'trades'))
