"""Per-root option volume on a day (terminal EOD report summed over every expiry): picks the 5 most active single
names among Compass's roots. Usage: python3 roots_volume.py 20261105"""
import io, sys, urllib.request
import pandas as pd

D = sys.argv[1] if len(sys.argv) > 1 else '20261105'
NAMES = ['TSLA', 'NVDA', 'META', 'AVGO', 'AAPL', 'AMZN', 'MSFT', 'GOOGL', 'MSTR', 'SMCI', 'GME']
ETFS = ['SPY', 'QQQ', 'IWM', 'SPXW']
rows = []
for s in NAMES + ETFS:
    url = (f'http://127.0.0.1:25503/v3/option/history/eod?symbol={s}&expiration=*&start_date={D}&end_date={D}'
           f'&format=csv')
    d = pd.read_csv(io.BytesIO(urllib.request.urlopen(url, timeout=600).read()))
    v = d.groupby('expiration').volume.sum().sort_values(ascending=False)
    rows.append({'root': s, 'contracts': len(d), 'volume': int(d.volume.sum()),
                 'top_exp': ', '.join(f'{e} {int(x):,}' for e, x in v.head(3).items()), 'single': s in NAMES})
r = pd.DataFrame(rows).sort_values('volume', ascending=False)
sys.path.insert(0, __import__('os').path.dirname(__file__))
from mdt import md  # noqa: E402
print(md(r))
