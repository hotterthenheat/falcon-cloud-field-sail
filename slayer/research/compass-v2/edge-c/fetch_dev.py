"""Fetch what the siblings need that the challenger cache lacks, for the DEV sessions it covers (locked days never):
XSP overnight 1-minute chains (both expiries, 00:00-09:30 of the session) for S2/S3a, and SPY pre-market 1-minute
NBBO 04:00-09:30 for S3b. One terminal request in flight. Usage: python3 fetch_dev.py [DEV|VAL]
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

split = sys.argv[1] if len(sys.argv) > 1 else 'DEV'
days = C.raw_days(split, 'SPXW')
if split == 'VAL' and len(sys.argv) > 2:
    days = sys.argv[2].split(',')
print(split, len(days), 'sessions', days[0], days[-1], flush=True)
t0 = time.time()
n = 0
for i, d in enumerate(days):
    assert not C.is_locked(d), d
    try:
        C.fetch_stock_quotes_1m('SPY', d)
        for e in C.two_expiries('XSP', d):
            if C.load_raw_chain('XSP', d, e) is None:
                C.fetch_chain('XSP', d, e)
                n += 1
        if split == 'VAL':
            for e in C.two_expiries('SPXW', d):
                if C.load_raw_chain('SPXW', d, e) is None:
                    C.fetch_chain('SPXW', d, e)
                    n += 1
    except Exception as ex:  # noqa: BLE001
        print('ERR', d, str(ex)[:120], flush=True)
    if i % 10 == 0:
        print(f'{i}/{len(days)} {d} requests={n} {time.time()-t0:.0f}s {C.data_mb():.0f}MB', flush=True)
print('done', n, f'{time.time()-t0:.0f}s', f'{C.data_mb():.0f}MB', flush=True)
