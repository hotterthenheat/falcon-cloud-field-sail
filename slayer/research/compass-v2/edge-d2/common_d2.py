"""EDGE-D2 shared: paths, split guard, the daily SPX / VIX / VIX9D table from the fetched EOD files."""
import glob, json, os, sys
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
V2 = os.path.abspath(os.path.join(HERE, '..'))
sys.path.insert(0, V2)
from data.splits import split_of  # noqa: E402

DATA = '/home/user/falcon-cloud-field-sail/v2data'
OUT = os.path.join(DATA, 'edge-d2')
EDGE = os.path.join(DATA, 'edge')
YEAR_MIN = 390.0 * 252


def assert_dev(day):
    s = split_of(day)
    if s != 'DEV':
        raise AssertionError(f'{day} is {s}: refused')


def eod(sym, split='DEV'):
    rows = []
    for f in sorted(glob.glob(os.path.join(OUT, 'eod', f'{sym}_*.json'))):
        txt = open(f).read()
        if not txt.strip():
            continue
        for r in json.loads(txt)['response']:
            rows.append(r)
    d = pd.DataFrame(rows)
    d['day'] = d.created.str[:10]
    d['lt_day'] = d.last_trade.str[:10]
    d = d.drop_duplicates('day').sort_values('day')
    d = d[d.day.map(split_of) == split]
    return d[['day', 'lt_day', 'last_trade', 'open', 'high', 'low', 'close']].reset_index(drop=True)


def daily():
    """One row per SPX session (holiday rows dropped: no SPX print that day), VIX / VIX9D closes joined."""
    s = eod('SPX')
    # a session is a weekday with an SPX print stamped that day and a real range
    s = s[(s.lt_day == s.day) & (s.high > s.low) & (s.close > 0) & (s.open > 0)].copy()
    v = eod('VIX').rename(columns={'close': 'vix'})[['day', 'vix']]
    v9 = eod('VIX9D').rename(columns={'close': 'vix9d'})[['day', 'vix9d']]
    d = s.merge(v, on='day', how='left').merge(v9, on='day', how='left')
    d.loc[d.vix <= 0, 'vix'] = np.nan
    d.loc[d.vix9d <= 0, 'vix9d'] = np.nan
    return d.reset_index(drop=True)
