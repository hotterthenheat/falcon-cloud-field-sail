"""Red-team helpers: read-only access to the challenger's rows and raw cache (never writes there)."""
import os, sys, gzip, io, json
import numpy as np
import pandas as pd

CHAL = '/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a3673bb87994bc8be/slayer/research/challenger'
BLIND = '/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a537945bf25597d8c/slayer/research/compass-v2/blind'
Q1S = '/home/user/falcon-cloud-field-sail/v2data/blind/quotes1s'
sys.path.insert(0, CHAL)
import common as C  # noqa: E402
import books as B  # noqa: E402

ROWCOLS = ['day', 'sleeve', 'ticker', 'contract', 'expiry', 'right', 'strike', 'mark', 'batch', 'order', 'session', 'flatAt', 'bid', 'ask', 'mid',
           'aGate', 'bGate', 'burns', 'dist', 'span', 'dte', 'retOpen', 'fill', 'fillAt', 'whyA', 'hit50', 'min50', 'worstPre', 'flatBid', 'best',
           'c1', 'c11', 'c14', 'c22', 'c23', 'c24', 'c28', 'c33', 'c34', 'c35', 'c36', 'c4', 'atS0', 'atS1']


def locked_days():
    return [d for d in C.days_built() if B.is_holdout(d) or B.is_holdout2(d) or d >= '2026-07-01']


def spxw_overnight(day, cols=ROWCOLS):
    x = C.load_day(day, cache=False)
    x = x[(x['ticker'].astype(str) == 'SPXW') & (x['session'].astype(str) == 'overnight')]
    keep = [c for c in cols if c in x.columns]
    x = x[keep].copy()
    for c in ('day', 'ticker', 'contract', 'right', 'mark', 'session', 'whyA', 'expiry'):
        if c in x.columns:
            x[c] = x[c].astype(str)
    return x.reset_index(drop=True)


def locked_calls():
    return json.load(open(os.path.join(BLIND, 'results', 'K5-LOCKED.json')))


def locked_exec():
    return json.load(open(os.path.join(BLIND, 'results', 'K5-LOCKED-exec.json')))


def raw_chain(day, expiry=None):
    ymd = day.replace('-', '')
    exp = (expiry or day).replace('-', '')
    f = os.path.join(CHAL, 'data', 'raw', ymd, f'SPXW_{exp}.csv.gz')
    if not os.path.exists(f):
        return None
    t = gzip.open(f, 'rt').read()
    return pd.read_csv(io.StringIO(t), header=None, names=['min', 'strike', 'right', 'bid', 'ask', 'bs', 'as'])


def bars(sym, day):
    month = day[:7]
    f = os.path.join(CHAL, 'data', 'bars', sym, f'{month}.csv.gz')
    if not os.path.exists(f):
        return None
    t = gzip.open(f, 'rt').read()
    b = pd.read_csv(io.StringIO(t), header=None, names=['key', 'o', 'h', 'l', 'c', 'v'])
    return b[b['key'].str.startswith(day)].reset_index(drop=True)


def hard_ret(x):
    """The spec's hard exit from the row columns (identical to books.Sessions.pnl_hard / fill)."""
    stop = 1 - 0.5322
    h50 = x['hit50'].values == 1
    wp = x['worstPre'].values.astype(float)
    fb = x['flatBid'].values.astype(float)
    win = h50 & (wp > stop)
    r = np.where(win, 0.5, np.where(wp <= stop, -0.5322, fb - 1))
    return r, win
