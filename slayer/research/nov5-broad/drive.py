"""Resumable fetch driver: python3 drive.py D ROOT,ROOT,... BAND [steps]   (one terminal request in flight per driver;
run at most two drivers). steps: comma list of base,q1s,trades (default all)."""
import os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
D, roots, band = sys.argv[1], sys.argv[2].split(','), sys.argv[3]
steps = sys.argv[4].split(',') if len(sys.argv) > 4 else ['base', 'q1s', 'trades']
for st in steps:
    for r in roots:
        subprocess.run([sys.executable, os.path.join(HERE, 'fetch_broad.py'), st, D, r, band])
print('DRIVE_DONE', D, roots, steps, flush=True)
