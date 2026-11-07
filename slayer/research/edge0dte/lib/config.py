"""EDGE0DTE constants, paths, splits and the time conventions every module uses.

Time: a decision time t is an int number of seconds after midnight ET on the session day (09:45 = 35100).
Minute m = minute of day (570 = 09:30). A 1-minute bar labelled m covers [m*60, m*60+60) and is usable at
t >= m*60 + 60. A board (1-minute option NBBO snapshot) stamped m is the NBBO in effect at m*60 exactly
(verified against tick data: the 10:00:00 snapshot equals the last tick before 10:00:00.000), so it is usable at
t >= m*60. A 1-second quote stamped s is the NBBO in effect at s.
Year fraction for options and outcomes: trading minutes / (252 * 390) ("trading-time" clock, used both to invert IV
and to scale horizons, so IV * sqrt(h_years) is the board's implied move over h).
"""
import os

DATA = os.environ.get('EDGE0DTE_DATA', '/home/user/falcon-cloud-field-sail/v2data/edge0dte')
OLD = '/home/user/falcon-cloud-field-sail/v2data/edge'          # read-only reuse
LOCKED_LOOKS = '/home/user/falcon-cloud-field-sail/v2data/locked_looks.jsonl'
BASE = 'http://127.0.0.1:25503/v3'

ROOTS = ('SPXW', 'SPY', 'QQQ', 'IWM')
UNDER = {'SPXW': 'SPX', 'SPY': 'SPY', 'QQQ': 'QQQ', 'IWM': 'IWM'}
KIND = {'SPX': 'index', 'SPY': 'stock', 'QQQ': 'stock', 'IWM': 'stock', 'VIX': 'index', 'VIX1D': 'index'}
BAND = {'SPY': 14, 'QQQ': 14, 'IWM': 14, 'SPXW': 24}           # strike_range of the cached 1-minute boards

START = '2020-02-18'
END = '2025-12-31'
YEAR_MIN = 252 * 390.0
FEE = 0.65
LAT = 2                    # seconds between decision and the first fill-eligible quote
MAX_WAIT = 60              # seconds a fill may walk forward over invalid quotes before the trade is skipped
HORIZONS = (15, 30, 60, 'close')
GRID = tuple(range(9 * 3600 + 45 * 60, 15 * 3600 + 30 * 60 + 1, 300))   # 09:45 .. 15:30 every 5 min


def split(day):
    """Chronological split of a session (PROTOCOL section 1)."""
    if day < START:
        return 'PRE'
    if day < '2024-01-01':
        return 'DISCOVERY'
    if day < '2025-01-01':
        return 'CALIBRATION'
    if day < '2026-01-01':
        return 'HOLDOUT'
    return 'LOCKED'


def bucket(t):
    """30-minute time-of-day bucket label of decision second t ('09:30' holds 09:45-09:55)."""
    m = t // 60
    b = 570 + (m - 570) // 30 * 30
    return f'{b // 60:02d}:{b % 60:02d}'


def tick(root, price):
    """Minimum price increment (SPXW: 0.05 below $3, 0.10 at/above; ETF options: 0.01)."""
    if root == 'SPXW':
        return 0.05 if price < 3 else 0.10
    return 0.01


def clock(s):
    return f'{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}'
