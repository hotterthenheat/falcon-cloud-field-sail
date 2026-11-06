"""EDGE-D2 terminal fetch: SPX / VIX / VIX9D daily EOD for DEV ranges only (LOCKED ranges are never requested).

  python3 fetch_d2.py eod          -> v2data/edge-d2/eod/{SYM}_{a}_{b}.json (raw rows, resumable, atomic)
  python3 fetch_d2.py eod_val      -> 2025 VALIDATION ranges (ONLY after a variant passes DEV; refused otherwise)

One request in flight; refuses to run 09:15-16:05 ET on weekdays (the live Compass engine owns the terminal then).
Computes nothing: no feature, target or outcome.
"""
import datetime as dt, os, sys, time, urllib.request, urllib.error
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
from data.splits import split_of  # noqa: E402

OUT = '/home/user/falcon-cloud-field-sail/v2data/edge-d2'
BASE = 'http://127.0.0.1:25503/v3'
SYMS = ('SPX', 'VIX', 'VIX9D')
# DEV calendar ranges with every LOCKED range cut out (H1 2022-06, H2 2022-07..09, H1 2024-08)
DEV_SPANS = [('20170901', '20220531'), ('20221001', '20240731'), ('20240901', '20241231')]


def chunks(spans):
    """Each span cut at calendar quarters (the terminal is slow on multi-year EOD reads)."""
    out = []
    for a, b in spans:
        d = dt.date(int(a[:4]), int(a[4:6]), int(a[6:]))
        e = dt.date(int(b[:4]), int(b[4:6]), int(b[6:]))
        while d <= e:
            q_end = dt.date(d.year, 3 * ((d.month - 1) // 3) + 3, 1) + dt.timedelta(days=31)
            q_end = q_end.replace(day=1) - dt.timedelta(days=1)
            z = min(q_end, e)
            out.append((d.strftime('%Y%m%d'), z.strftime('%Y%m%d')))
            d = z + dt.timedelta(days=1)
    return out


DEV_RANGES = chunks(DEV_SPANS)
VAL_RANGES = chunks([('20250401', '20251231')])  # 2025 minus H2 (2025-01-02..03-31)


def window_ok():
    now = dt.datetime.now(ZoneInfo('America/New_York'))
    if now.weekday() >= 5:
        return True
    hm = now.hour * 60 + now.minute
    return not (9 * 60 + 15 <= hm < 16 * 60 + 5)


def check_ranges(ranges, split):
    for a, b in ranges:
        d = dt.date(int(a[:4]), int(a[4:6]), int(a[6:]))
        e = dt.date(int(b[:4]), int(b[4:6]), int(b[6:]))
        while d <= e:
            s = split_of(d.strftime('%Y%m%d'))
            if d.weekday() < 5 and s != split:
                raise SystemExit(f'range {a}-{b} touches {d} ({s}): refused')
            d += dt.timedelta(days=1)


def get(path, tries=5):
    for k in range(tries):
        while not window_ok():
            print('inside 09:15-16:05 ET: waiting', flush=True)
            time.sleep(300)
        try:
            with urllib.request.urlopen(BASE + path, timeout=90) as r:
                return r.read().decode()
        except urllib.error.HTTPError as e:
            if e.code in (404, 472):
                return ''
            time.sleep(10 * (k + 1))
        except Exception:
            time.sleep(30 * (k + 1))
    return None


def run(ranges, split):
    check_ranges(ranges, split)
    os.makedirs(os.path.join(OUT, 'eod'), exist_ok=True)
    for sym in SYMS:
        for a, b in ranges:
            f = os.path.join(OUT, 'eod', f'{sym}_{a}_{b}.json')
            if os.path.exists(f):
                continue
            txt = get(f'/index/history/eod?symbol={sym}&start_date={a}&end_date={b}&format=json')
            if txt is None:
                print('failed', sym, a, b, flush=True)
                continue
            with open(f + '.tmp', 'w') as fh:
                fh.write(txt)
            os.replace(f + '.tmp', f)
            print('ok', sym, a, b, len(txt), flush=True)
            time.sleep(1)


if __name__ == '__main__':
    if sys.argv[1] == 'eod':
        run(DEV_RANGES, 'DEV')
    elif sys.argv[1] == 'eod_val':
        if not os.path.exists(os.path.join(HERE, 'results', 'DEV_PASS')):
            raise SystemExit('no DEV pass recorded: VALIDATION refused')
        run(VAL_RANGES, 'VALIDATION')
