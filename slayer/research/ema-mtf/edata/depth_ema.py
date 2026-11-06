"""History depth for what compass-v2/data/DEPTH.md did not cover (IWM, the SPX AM root, 1-minute OHLC, index OHLC,
same-day-expiry availability by year, UW for IWM). One request at a time; every probe is a tiny window.

    python3 -m edata.depth_ema > reports/depth_ema.md
"""
from __future__ import annotations

import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from edata.common import NoData, csv, expirations, sessions_all, split_of  # noqa: E402


def probe(path, params):
    try:
        df = csv(path, params, timeout=180, patience_s=600)
        n = len(df)
        if 'count' in df:
            return f'yes ({n} rows, {int((df["count"] > 0).sum())} non-empty)'
        if 'bid' in df:
            return f'yes ({n} rows, {int((df.bid > 0).sum())} with bid)'
        if 'implied_vol' in df:
            return f'yes ({n} rows, {int((df.implied_vol > 0).sum())} with IV)'
        return f'yes ({n} rows)'
    except NoData:
        return 'no data'
    except Exception as e:  # noqa: BLE001
        return 'ERR ' + str(e)[:90].replace('|', '/')


def first_exp(root, d):
    e = [x for x in expirations(root) if x >= d]
    return e[0] if e else None


def main():
    rows = []
    win = {'start_time': '10:00:00', 'end_time': '10:01:00'}
    for root, days in {'IWM': ['20120604', '20140102', '20160104', '20180102', '20200102', '20220103'],
                       'SPX': ['20160115', '20180116', '20200115', '20220118'],
                       'SPY': ['20120604', '20160104', '20200102'], 'SPXW': ['20160106', '20200106'],
                       'QQQ': ['20120604', '20200102']}.items():
        for d in days:
            e = first_exp(root, d)
            base = {'symbol': root, 'expiration': e, 'strike': '*', 'right': 'both', 'date': d}
            rows.append((root, d, 'option 1m OHLC (ohlc)', probe('/option/history/ohlc', {**base, 'interval': '1m', **win})))
            if root in ('IWM', 'SPX'):
                rows.append((root, d, 'option 1m NBBO (quote)', probe('/option/history/quote', {**base, 'interval': '1m', **win})))
                rows.append((root, d, 'option trades', probe('/option/history/trade', {**base, **win})))
                rows.append((root, d, 'option greeks 1m (first_order)', probe('/option/history/greeks/first_order', {**base, 'interval': '1m', **win})))
                rows.append((root, d, 'option OI', probe('/option/history/open_interest', {'symbol': root, 'expiration': e, 'date': d})))
    for d in ('20120604', '20160104', '20180102', '20200102'):
        rows.append(('IWM', d, 'stock 1m OHLC', probe('/stock/history/ohlc', {'symbol': 'IWM', 'date': d, 'interval': '1m', **win})))
    for d in ('20170103', '20200102'):
        rows.append(('SPX', d, 'index 1m OHLC', probe('/index/history/ohlc', {'symbol': 'SPX', 'start_date': d, 'end_date': d, 'interval': '1m'})))
    print('# EMA-MTF history-depth probes (terminal, tiny windows)\n')
    print('| root | date | data | answers |\n|---|---|---|---|')
    for r in rows:
        print(f'| {r[0]} | {r[1]} | {r[2]} | {r[3]} |')
    # same-day expirations by year (from the expiration lists and the session calendar; no data requests)
    al = sessions_all()
    print('\n## Share of sessions with a same-day expiration (0DTE exists), by year\n')
    print('| root | ' + ' | '.join(str(y) for y in range(2016, 2027)) + ' |')
    print('|---|' + '---|' * 11)
    for root in ('SPY', 'QQQ', 'IWM', 'SPXW', 'SPX'):
        ex = set(expirations(root))
        cells = []
        for y in range(2016, 2027):
            ss = [d for d in al if d.startswith(str(y))]
            cells.append(f'{100 * sum(d in ex for d in ss) / max(len(ss), 1):.0f}%')
        print(f'| {root} | ' + ' | '.join(cells) + ' |')
    print('\n(SPX AM monthlies "expire" on the third Friday but stop trading the session before; they never trade on their date.)')
    # UW floor for IWM
    try:
        from data.clients import uw_get
        for iso in ('2023-12-05', '2023-12-07'):
            try:
                r = uw_get('/api/option-trades/flow-alerts', {'ticker_symbol': 'IWM', 'limit': 5, 'newer_than': f'{iso}T00:00:00Z',
                                                              'older_than': f'{iso}T23:59:59Z'})
                n = len(r.get('data', r) if isinstance(r, dict) else r)
                print(f'\nUW flow alerts IWM {iso}: {n} rows')
            except Exception as e:  # noqa: BLE001
                print(f'\nUW flow alerts IWM {iso}: refused ({str(e)[:80]})')
    except Exception as e:  # noqa: BLE001
        print('UW not probed:', str(e)[:80])


if __name__ == '__main__':
    main()
