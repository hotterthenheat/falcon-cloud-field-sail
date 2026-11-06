"""Run a resumable terminal fetch only inside the allowed request window (EMA-2 operating limits).

    python3 -m edata.windowed -- python3 -m edata.panel --block B

The shared terminal (127.0.0.1:25503) also serves a live engine. Rules: weekdays 09:15-16:05 ET -> NO requests;
otherwise at most one in flight (the child is started with V2_THETA_SLOTS=1). This wrapper starts the child outside
the window, stops it (SIGTERM, then SIGKILL, by its own PID only) STOP_MARGIN_MIN minutes before 09:15 so no request
is still in flight at 09:15, waits until 16:06, and restarts it. Every fetcher it drives writes atomic per-session
files, so a stop loses at most the session in progress. Weekdays are all treated as live days (holidays too:
conservative). Exits when the child exits on its own (0 = done; a non-zero code from a disk/budget stop is passed on).
"""
from __future__ import annotations

import datetime as dt
import os
import signal
import subprocess
import sys
import time
from zoneinfo import ZoneInfo

ET = ZoneInfo('America/New_York')
STOP_MARGIN_MIN = 8
NO_REQ_START = dt.time(9, 15)
NO_REQ_END = dt.time(16, 6)


def now_et() -> dt.datetime:
    return dt.datetime.now(tz=ET)


def in_quiet(t: dt.datetime) -> bool:
    """True while requests are forbidden (including the stop margin before 09:15)."""
    if t.weekday() >= 5:
        return False
    start = (dt.datetime.combine(t.date(), NO_REQ_START) - dt.timedelta(minutes=STOP_MARGIN_MIN)).time()
    return start <= t.time() < NO_REQ_END


def log(*a):
    print(now_et().strftime('%Y-%m-%d %H:%M:%S ET'), '[windowed]', *a, flush=True)


def main():
    argv = sys.argv[1:]
    if argv and argv[0] == '--':
        argv = argv[1:]
    env = dict(os.environ, V2_THETA_SLOTS='1')
    while True:
        while in_quiet(now_et()):
            time.sleep(30)
        log('start', ' '.join(argv))
        p = subprocess.Popen(argv, env=env)
        log('child pid', p.pid)
        while True:
            rc = p.poll()
            if rc is not None:
                log('child exited', rc)
                sys.exit(rc)
            if in_quiet(now_et()):
                log('quiet window: stopping child', p.pid)
                p.send_signal(signal.SIGTERM)
                try:
                    p.wait(timeout=60)
                except subprocess.TimeoutExpired:
                    p.kill()
                    p.wait()
                log('child stopped; waiting for 16:06 ET')
                break
            time.sleep(10)


if __name__ == '__main__':
    main()
