"""FOUNDATION task 1: fill data gaps (resumable; one request in flight by default).

  cd slayer/research/edge0dte && python3 -m foundation.fetch_gaps [bars|chain|all] [--inflight N]

Order: 1-minute bars (SPX, SPY/QQQ/IWM with volume, VIX, VIX1D) 2019-12..2025-12; then the 0DTE board and same-day OI
for every expiry session missing from both caches, 2020-2024 first, then 2025 (fetched for later use only; no outcome
is computed on it here). Stops if free disk space drops below 1.2 GB.
"""
import os
import shutil
import sys
import time
from concurrent.futures import ThreadPoolExecutor

from lib import cal
from lib.config import DATA, OLD, ROOTS
from lib.theta import fetch_bars, fetch_chain, fetch_oi

MIN_FREE = 1.2e9


def months(a='2019-12', b='2025-12'):
    y, m = map(int, a.split('-'))
    out = []
    while f'{y}-{m:02d}' <= b:
        out.append(f'{y}-{m:02d}')
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return out


def have(kind, root, day):
    return any(os.path.exists(os.path.join(b, kind, root, f'{day}.parquet')) for b in (DATA, OLD))


def jobs(what):
    js = []
    if what in ('bars', 'all'):
        for mo in months():
            for sym in ('SPX', 'SPY', 'QQQ', 'IWM', 'VIX'):
                js.append((fetch_bars, sym, mo))
            if mo >= '2023-01':
                js.append((fetch_bars, 'VIX1D', mo))
    if what in ('chain', 'all'):
        for late in (False, True):
            for root in ROOTS:
                for d in cal.expiry_sessions(root):
                    if (d >= '2025-01-01') != late:
                        continue
                    if not have('chain', root, d):
                        js.append((fetch_chain, root, d))
                    if not have('oi', root, d):
                        js.append((fetch_oi, root, d))
    return js


def main():
    what = sys.argv[1] if len(sys.argv) > 1 else 'all'
    inflight = int(sys.argv[sys.argv.index('--inflight') + 1]) if '--inflight' in sys.argv else 1
    js = jobs(what)
    print(f'{what}: {len(js)} jobs, inflight {inflight}', flush=True)
    t0, done = time.time(), {}
    with ThreadPoolExecutor(inflight) as ex:
        futs = []
        for i, j in enumerate(js):
            futs.append(ex.submit(j[0], *j[1:]))
            if len(futs) >= 8 * inflight:
                for f in futs:
                    r = f.result()
                    done[r] = done.get(r, 0) + 1
                futs = []
                free = shutil.disk_usage('/').free
                print(f'{i + 1}/{len(js)} {done} {time.time() - t0:.0f}s free {free / 1e9:.2f}GB last {j[0].__name__} {j[1]} {j[2]}', flush=True)
                if free < MIN_FREE:
                    print('STOP: free disk below 1.2 GB', flush=True)
                    return
        for f in futs:
            r = f.result()
            done[r] = done.get(r, 0) + 1
    print('done', done, f'{time.time() - t0:.0f}s', flush=True)


if __name__ == '__main__':
    main()
