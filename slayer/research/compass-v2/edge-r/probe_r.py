"""EDGE-R probes (PREREG 2, 7): pre-open option NBBO, SPX index bars outside 09:30-16:00, SPY extended bars.
One request at a time; prints shapes and time spans only."""
import io
import sys

import pandas as pd

sys.path.insert(0, __import__('os').path.dirname(__file__))
import term  # noqa: E402

DAYS = ('2024-04-17', '2023-10-27', '2022-03-08')


def df_of(t):
    return pd.read_csv(io.StringIO(t)) if (t and 'timestamp' in t[:300]) else None


for d in DAYS:
    y = d.replace('-', '')
    t = term.get(f'/option/history/quote?symbol=SPY&expiration={y}&date={y}&interval=1m&strike_range=2'
                 f'&start_time=08:00:00&end_time=09:31:00&format=csv')
    df = df_of(t)
    if df is None:
        print(d, 'SPY 0DTE pre-open: no data', repr((t or '')[:80]))
    else:
        ts = pd.to_datetime(df['timestamp'])
        pre = df[(ts.dt.hour * 60 + ts.dt.minute) < 570]
        val = pre[(pre.bid > 0) & (pre.ask > 0)]
        tv = pd.to_datetime(val['timestamp'])
        print(d, 'SPY 0DTE 08:00-09:31 rows', len(df), 'pre-open rows', len(pre), 'valid pre-open', len(val),
              'first valid', tv.min() if len(val) else None,
              'distinct pre-open bid/ask', val[['bid', 'ask']].drop_duplicates().shape[0] if len(val) else 0)
    t = term.get(f'/index/history/ohlc?symbol=SPX&start_date={y}&end_date={y}&interval=1m'
                 f'&start_time=00:00:00&end_time=23:59:59&format=csv')
    df = df_of(t)
    if df is None:
        print(d, 'SPX: no data')
    else:
        ts = pd.to_datetime(df['timestamp'])
        m = ts.dt.hour * 60 + ts.dt.minute
        pos = df.close > 0
        print(d, 'SPX bars', len(df), 'close>0', int(pos.sum()), 'close>0 minutes', int(m[pos].min()), '-', int(m[pos].max()),
              'outside 570-959 with close>0', int((pos & ((m < 570) | (m > 959))).sum()))
    t = term.get(f'/stock/history/ohlc?symbol=SPY&start_date={y}&end_date={y}&interval=1m'
                 f'&start_time=04:00:00&end_time=20:00:00&format=csv')
    df = df_of(t)
    if df is None:
        print(d, 'SPY ext: no data')
    else:
        ts = pd.to_datetime(df['timestamp'])
        m = ts.dt.hour * 60 + ts.dt.minute
        pos = df.close > 0
        print(d, 'SPY ext bars', len(df), 'close>0', int(pos.sum()), 'span', int(m[pos].min()), '-', int(m[pos].max()),
              'pre 570 with close>0', int((pos & (m < 570)).sum()), 'after 959', int((pos & (m > 959)).sum()))
print(term.STATS)
