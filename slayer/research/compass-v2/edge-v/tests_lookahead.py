"""Look-ahead checks for V1/V1P (PREREG): triggers recomputed with every bar after the trigger bar removed must be
identical; a canary VWAP that includes the NEXT bar must be caught by the same check; the M1/1-s engine asserts that
an underlying bar has closed before it is read; selection reads only the board stamped <= t - 60.

  python3 tests_lookahead.py DEV
"""
import sys
import numpy as np
import v1


def canary_vwap(b):
    """WRONG on purpose: VWAP at bar m includes bar m+1 (look-ahead by one bar)."""
    b = v1.add_vwap(b)
    b['vwap'] = np.append(b.vwap.values[1:], b.vwap.values[-1])
    return b


def check(which, max_n=10 ** 9):
    n = bad = can_n = can_caught = 0
    for root in ('SPY', 'QQQ'):
        for d in v1.days_for(root, which):
            raw = v1.vbars(root, d)
            if len(raw) < 300:
                continue
            full = v1.add_vwap(raw)
            cfull = canary_vwap(raw)
            for side in v1.SIDES:
                for x in v1.XS:
                    tr = v1.trigger(full, side, x)
                    if tr:
                        n += 1
                        cut = v1.add_vwap(raw[raw.m <= tr['m']])
                        t2 = v1.trigger_nolen(cut, side, x)
                        if {k: t2[k] for k in tr if k in t2} != {k: tr[k] for k in tr if k in t2} if t2 else True:
                            bad += 1
                    ct = v1.trigger(cfull, side, x)
                    if ct:
                        can_n += 1
                        cc = canary_vwap(raw[raw.m <= ct['m']])
                        c2 = v1.trigger_nolen(cc, side, x)
                        can_caught += c2 != ct
            if n >= max_n:
                break
    return {'triggers': n, 'mismatch': bad, 'canary_triggers': can_n, 'canary_caught': can_caught}


if __name__ == '__main__':
    r = check(sys.argv[1] if len(sys.argv) > 1 else 'DEV')
    print(r)
    assert r['mismatch'] == 0, 'look-ahead in trigger'
    assert r['canary_caught'] > 0, 'canary not caught: test is blind'
    print('OK: triggers use only closed bars; canary caught on', r['canary_caught'], 'of', r['canary_triggers'])
