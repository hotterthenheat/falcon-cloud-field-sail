"""Morning open-interest reports for the 20 sessions before each block's first eval session (the S1C P/C OI ratio
needs a 20-session median; the panel stores OI for eval sessions only). Resumable, one request in flight.

    python3 -m edata.oi_hist --blocks A,B,V
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from edata.common import check_disk, sessions_back  # noqa: E402
from edata.panel import BLOCKS, ROOTS, get_oi, oi_path  # noqa: E402

N = 20


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--blocks', default='A,B')
    a = ap.parse_args()
    for b in a.blocks.split(','):
        first = BLOCKS[b][0]
        from edata.common import sessions_all
        ev0 = min(d for d in sessions_all() if d >= first)
        days = sessions_back(ev0, N)
        for root in ROOTS:
            for D in days:
                if os.path.exists(oi_path(root, D)):
                    continue
                check_disk()
                df = get_oi(root, D)
                print(b, root, D, len(df), flush=True)


if __name__ == '__main__':
    main()
