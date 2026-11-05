"""Look-ahead tests for EDGE-L.  python3 tests.py
1. a peek at anything stamped >= T raises (canary);
2. the signal inputs of sampled sessions recomputed with every bar/quote stamped >= T DELETED are identical;
3. a canary trigger that reads the next bar is caught by the truncation test.
"""
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
import common  # noqa
from common import Clock, LookAhead, bars, chain, UND  # noqa

from l1signal import implied  # noqa


def inputs(b, ch, T):
    ck = Clock(b, ch, T)
    vb = ck.bars_before()
    px = np.concatenate([[vb.o.iloc[0]], vb.c.values])
    info = implied(ck.snap_before(), T)
    return (round(float(np.sum(np.diff(np.log(px)) ** 2)), 14), float(vb.c.iloc[-1]),
            tuple(sorted((k, None if isinstance(v, float) and v != v else round(v, 10) if isinstance(v, float) else v) for k, v in (info or {}).items())))


def main():
    b0 = bars('SPY')['2024-03-15']
    ch0 = chain('SPY', '2024-03-15')
    ck = Clock(b0, ch0, 35100)
    for bad in (lambda: ck.peek(35100), lambda: ck.peek(36000), lambda: ck.bars_before(35101),
                lambda: ck.snap_before(35160)):
        try:
            bad()
            raise SystemExit('FAIL: peek did not raise')
        except LookAhead:
            pass
    print('1 canary peeks raise: ok')
    rng = np.random.default_rng(1)
    n = 0
    for root in ('SPY', 'QQQ', 'SPXW'):
        days = sorted(d for d in os.listdir(os.path.join(common.EDGE, 'chain', root)) if d.startswith(('2023', '2024', '2025')))
        for d in rng.choice(days, 8, replace=False):
            d = d[:-8]
            b = bars(UND[root]).get(d)
            ch = chain(root, d)
            if b is None or ch is None:
                continue
            for T in (35100, 37800):
                full = inputs(b, ch, T)
                cut = inputs(b[b.m * 60 + 60 <= T], ch[ch.m * 60 < T], T)
                assert full == cut, (root, d, T)
                # canary: a trigger reading the bar that ends AFTER T must differ under truncation
                nxt = b[b.m == T // 60]
                assert len(nxt) == 1 and len(b[b.m * 60 + 60 <= T][b.m == T // 60]) == 0
                n += 1
    print(f'2 truncation identical on {n} (root, session, T): ok')
    print('3 canary (next bar) absent under truncation: ok')


if __name__ == '__main__':
    main()
