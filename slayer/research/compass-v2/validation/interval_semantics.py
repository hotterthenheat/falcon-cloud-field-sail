"""Scratch: what does an interval quote row stamped T hold — the NBBO in force at T (last tick <= T), or a quote
from inside [T, T+interval) (look-ahead)? Compare the terminal's 1s and 100ms rows to the tick tape (argv[1])."""
import io
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from data.clients import theta_get  # noqa: E402

tick = pd.read_csv(sys.argv[1])
tt = pd.to_datetime(tick.timestamp)
tms = ((tt - tt.dt.normalize()).dt.total_seconds() * 1000).round().astype('int64').values
for iv, step in (('1s', 1000), ('100ms', 100)):
    b = theta_get('/option/history/quote', {'symbol': 'SPXW', 'expiration': '20240805', 'strike': '5200', 'right': 'call',
                                            'date': '20240805', 'interval': iv, 'start_time': '10:00:00', 'end_time': '11:00:00'})
    iv_df = pd.read_csv(io.BytesIO(b))
    it = pd.to_datetime(iv_df.timestamp)
    ims = ((it - it.dt.normalize()).dt.total_seconds() * 1000).round().astype('int64').values
    res = {}
    for name, ref in (('in_force_at_T', ims), ('in_force_at_T+step-1', ims + step - 1), ('in_force_at_T-1', ims - 1)):
        idx = np.searchsorted(tms, ref, side='right') - 1
        ok = (tick.bid.values[idx] == iv_df.bid.values) & (tick.ask.values[idx] == iv_df.ask.values) & \
             (tick.bid_size.values[idx] == iv_df.bid_size.values) & (tick.ask_size.values[idx] == iv_df.ask_size.values)
        res[name] = ok.mean()
    print(iv, len(iv_df), {k: round(v, 4) for k, v in res.items()})
