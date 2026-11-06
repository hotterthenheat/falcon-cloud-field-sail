"""Build edge-d2/macro_calendar.csv: scheduled CPI / NFP (08:30) and FOMC statement (14:00) days, 2018-2025.

Source rows: EDGE-D's committed specs/calendar.csv (BLS CPI and Employment Situation release archives 2018-2025, Fed
FOMC calendars 2021-2025), plus rows added here: Jan 2018 NFP (2018-01-05) and CPI (2018-01-12) from the same BLS
archives, and the scheduled FOMC statement days 2018-2020 from federalreserve.gov/monetarypolicy/fomchistorical{Y}.htm
(read 2026-11-06). Unscheduled actions (2020-03-03 10:00 ET, 2020-03-15 Sunday) and the cancelled 2020-03-18 meeting
are NOT in the list: they were not known before the open. PPI is not used (EDGE-D's list is 2022+ only).
"""
import os
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
c = pd.read_csv(os.path.join(HERE, '..', 'edge-d', 'specs', 'calendar.csv'), dtype=str)
c = c[c.event.isin(['CPI', 'NFP', 'FOMC'])].copy()
add = [('20180105', 'NFP', '08:30', 'https://www.bls.gov/bls/news-release/empsit.htm'),
       ('20180112', 'CPI', '08:30', 'https://www.bls.gov/bls/news-release/cpi.htm')]
fed = {2018: ['0131', '0321', '0502', '0613', '0801', '0926', '1108', '1219'],
       2019: ['0130', '0320', '0501', '0619', '0731', '0918', '1030', '1211'],
       2020: ['0129', '0429', '0610', '0729', '0916', '1105', '1216']}
for y, ds in fed.items():
    for d in ds:
        add.append((f'{y}{d}', 'FOMC', '14:00', f'https://www.federalreserve.gov/monetarypolicy/fomchistorical{y}.htm'))
c = pd.concat([c, pd.DataFrame(add, columns=c.columns)]).drop_duplicates(['date', 'event']).sort_values(['date', 'event'])
c.to_csv(os.path.join(HERE, 'macro_calendar.csv'), index=False)
print(len(c), c.event.value_counts().to_dict(), c.date.min(), c.date.max())
