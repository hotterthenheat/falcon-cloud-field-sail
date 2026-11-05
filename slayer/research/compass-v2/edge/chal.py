"""Read-only access to the challenger's built rows (research/challenger on worktree agent-a3673bb87994bc8be).

Never writes into that cache: load_day is called with cache=False (no parquet conversion, no csv removal), and rows
are filtered to the roots/session asked for as each day is read (memory).
"""
import os, sys
import numpy as np
import pandas as pd

CHAL = '/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a3673bb87994bc8be/slayer/research/challenger'
sys.path.insert(0, CHAL)
import common as C  # noqa: E402
import books as B  # noqa: E402

TEXT = ('day', 'sleeve', 'ticker', 'contract', 'expiry', 'right', 'mark', 'session', 'whyA', 'whyR')


def load(days, roots=None, session=None):
    parts = []
    for d in days:
        x = C.load_day(d, cache=False)
        if roots:
            x = x[x['ticker'].astype(str).isin(roots)]
        if session:
            x = x[x['session'].astype(str) == session]
        x = x[[c for c in x.columns if not (c.startswith('x') and c[1:].isdigit())]]
        parts.append(x)
    df = pd.concat(parts, ignore_index=True)
    for c in TEXT:
        if c in df.columns:
            df[c] = df[c].astype(str).astype('category')
    return df


class Sessions(B.Sessions):
    """books.Sessions on filtered rows, loaded without touching the cache."""

    def __init__(self, days, roots=None, session=None):
        self.days = list(days)
        df = load(self.days, roots, session).reset_index(drop=True)
        self.df = df
        self.fill = df['fill'].values.astype(float)
        self.pnl_prun, _ = C.call_pnl(df, 'prun')
        self.pnl_ride, _ = C.call_pnl(df, 'all')
        self.pnl_tp, _ = C.call_pnl(df, 'none')
        self.engine = {d: C.engine_calls(d) for d in self.days}
        self.win = df['whyA'].astype(str).str.startswith('Take profit').values
        stop = 1 - 0.5322
        h50 = df['hit50'].values == 1
        wp = df['worstPre'].values.astype(float)
        fb = df['flatBid'].values.astype(float)
        self.win_hard = h50 & (wp > stop)
        r = np.where(self.win_hard, 0.5, np.where(wp <= stop, -0.5322, fb - 1))
        self.pnl_hard = r * self.fill * 100
