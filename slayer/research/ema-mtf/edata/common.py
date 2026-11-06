"""Shared helpers for the EMA-MTF research: terminal access through the compass-v2 clients (<=2 in flight, keys
env-only), the trading calendar, the protocol splits, DTE buckets and atomic parquet writes.

Everything here refuses LOCKED sessions: `fetchable(day)` is False for any LOCKED or unassigned session and every
fetcher in this package checks it before a terminal read (V2_PROTOCOL rule 6; the EMA brief: never open or fetch LOCKED).
"""
from __future__ import annotations

import io
import json
import os
import shutil
import sys
from functools import lru_cache

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

HERE = os.path.dirname(os.path.abspath(__file__))
EMA_ROOT = os.path.dirname(HERE)
V2 = os.path.join(os.path.dirname(EMA_ROOT), 'compass-v2')
if V2 not in sys.path:
    sys.path.insert(0, V2)

from data.clients import NoData, theta_get  # noqa: E402  (compass-v2: semaphore of 2, retries)
from data.splits import split_of  # noqa: E402  (the fixed protocol splits)

EMA_DATA = os.environ.get('EMA_DATA', '/home/user/falcon-cloud-field-sail/v2data/ema')
BUDGET_BYTES = int(2.5e9)
MIN_FREE_BYTES = int(3e9)

BUCKETS = (('0', 0, 0), ('1-7', 1, 7), ('8-30', 8, 30), ('31-90', 31, 90), ('91+', 91, 10_000))
ROOT_UND = {'SPY': ('stock', 'SPY'), 'QQQ': ('stock', 'QQQ'), 'IWM': ('stock', 'IWM'),
            'SPXW': ('index', 'SPX'), 'SPX': ('index', 'SPX')}


class LockedError(Exception):
    pass


def fetchable(day: str) -> bool:
    """DEV and VALIDATION may be fetched; LOCKED and UNASSIGNED (2026-H1) never."""
    return split_of(day) in ('DEV', 'VALIDATION')


def guard(day: str):
    if not fetchable(day):
        raise LockedError(f'{day} is {split_of(day)}: not fetched')


def bucket_of(dte: int) -> str | None:
    for name, lo, hi in BUCKETS:
        if lo <= dte <= hi:
            return name
    return None


def dte(day: str, exp: str) -> int:
    return (pd.Timestamp(exp) - pd.Timestamp(day)).days


def csv(path: str, params: dict, patience_s: float = 1800, **kw) -> pd.DataFrame:
    """theta_get with patience for a busy shared terminal: a 429 ('too many requests', other workers' load) or a
    transport failure is retried with backoff (up to patience_s); 472 = NoData is an answer and is not retried."""
    import time
    t0, wait = time.time(), 5.0
    while True:
        try:
            b = theta_get(path, params, **kw)
            if not b.strip():
                raise NoData(path)
            if b.lstrip()[:6].lower() in (b'<html>', b'<!doct'):
                raise RuntimeError(f'{path}: HTML answer (terminal error page) 429?')
            return pd.read_csv(io.BytesIO(b))
        except NoData:
            raise
        except (RuntimeError, pd.errors.ParserError, ConnectionError, OSError) as e:
            # a 429, a restart of the shared terminal, or a body cut off mid-stream (truncated CSV)
            msg = str(e)
            transient = isinstance(e, (pd.errors.ParserError, ConnectionError, OSError)) or '429' in msg or 'failed after' in msg
            if not transient or time.time() - t0 > patience_s:
                raise
            time.sleep(wait)
            wait = min(wait * 1.6, 120.0)


@lru_cache(maxsize=1)
def sessions_all() -> list[str]:
    """Trading sessions (YYYYMMDD) from the terminal's QQQ stock-quote date list (2012-06 onward), cached on disk."""
    p = os.path.join(EMA_DATA, 'calendar.json')
    if os.path.exists(p):
        return json.load(open(p))
    df = csv('/stock/list/dates/quote', {'symbol': 'QQQ'})
    days = sorted(df.iloc[:, 0].astype(str).str.replace('-', '').tolist())
    os.makedirs(EMA_DATA, exist_ok=True)
    json.dump(days, open(p + '.tmp', 'w'))
    os.replace(p + '.tmp', p)
    return days


def sessions_back(day: str, n: int) -> list[str]:
    """The n sessions strictly before `day` (oldest first), stopping at the first non-fetchable one (a LOCKED gap
    ends the history: the chart a trader would have seen there cannot be rebuilt without opening LOCKED)."""
    al = sessions_all()
    i = al.index(day) if day in al else int(np.searchsorted(al, day))
    out = []
    for d in reversed(al[max(0, i - n):i]):
        if not fetchable(d):
            break
        out.append(d)
    return out[::-1]


@lru_cache(maxsize=16)
def expirations(root: str) -> list[str]:
    df = csv('/option/list/expirations', {'symbol': root})
    return sorted(df.expiration.astype(str).str.replace('-', '').tolist())


def ms_of_day(s: pd.Series) -> np.ndarray:
    v = s.astype(str).str
    return (v[11:13].astype(int) * 3_600_000 + v[14:16].astype(int) * 60_000 + v[17:19].astype(int) * 1000
            + v[20:23].str.ljust(3, '0').replace('', '0').astype(int)).astype('int32').values


def day_of(s: pd.Series) -> np.ndarray:
    return s.astype(str).str[:10].str.replace('-', '').astype('int32').values


def cents(x) -> np.ndarray:
    return np.round(np.asarray(x, dtype=float) * 100).astype('int32')


def right_code(s: pd.Series) -> np.ndarray:
    return np.where(s.astype(str).str.upper().str.startswith('C'), 1, -1).astype('int8')


def write_parquet(df: pd.DataFrame, path: str) -> int:
    """Atomic parquet/zstd write (tmp + rename), integer columns delta-encoded where sorted-ish."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tab = pa.Table.from_pandas(df, preserve_index=False)
    enc = {c: 'DELTA_BINARY_PACKED' for c in tab.column_names
           if c in ('ms', 'bid', 'ask', 'bs', 'as', 'o', 'h', 'l', 'c', 'v', 'n', 'oi', 'minute')
           and pa.types.is_integer(tab.schema.field(c).type)}
    tmp = path + '.tmp'
    pq.write_table(tab, tmp, compression='zstd', compression_level=9,
                   use_dictionary=[c for c in tab.column_names if c not in enc], column_encoding=enc or None)
    os.replace(tmp, path)
    return os.path.getsize(path)


def write_json(obj, path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(obj, open(path + '.tmp', 'w'), indent=1, default=str)
    os.replace(path + '.tmp', path)


def du(path: str = EMA_DATA) -> int:
    tot = 0
    for dp, _, fs in os.walk(path):
        for f in fs:
            try:
                tot += os.path.getsize(os.path.join(dp, f))
            except OSError:
                pass
    return tot


def check_disk():
    """Stop fetching if the EMA store passes its budget or the disk's free space drops under 3 GB."""
    free = shutil.disk_usage('/home/user').free
    used = du()
    if free < MIN_FREE_BYTES:
        raise SystemExit(f'STOP: free disk {free/1e9:.2f} GB < 3 GB')
    if used > BUDGET_BYTES:
        raise SystemExit(f'STOP: EMA store {used/1e9:.2f} GB > 2.5 GB budget')
    return free, used
