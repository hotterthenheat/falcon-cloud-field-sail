"""The Phase-2 fetch chain after DEV block B, as ONE process (run it under edata/windowed.py):
morning OI reports for the 20 sessions before blocks A, B and V (the S1C P/C OI median), then the VALIDATION panel
(block V, the pre-declared 2025-07-01..09-30 window; fetching only -- no outcome is looked at before a candidate is
frozen). Every step is resumable.

    python3 -m edata.windowed -- python3 -m edata.chain [--after PID]
"""
from __future__ import annotations

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--after', type=int, default=0, help='wait until this PID has exited')
    a = ap.parse_args()
    while a.after:
        try:
            os.kill(a.after, 0)
        except OSError:
            break
        time.sleep(30)
    sys.argv = ['oi_hist', '--blocks', 'A,B,V']
    from edata import oi_hist
    oi_hist.main()
    from edata.panel import run_block
    run_block('V')


if __name__ == '__main__':
    main()
