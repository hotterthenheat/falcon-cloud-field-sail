"""Executable fill simulator (PROTOCOL section 3). HOLDOUT-guarded.

Rules
* Decision second x (entry t, or exit decision). The fill quote is the 1-second NBBO in effect at x + LAT (2 s); if it
  is invalid the simulator walks forward second by second (over the change-only store) up to MAX_WAIT (60 s) after
  x + LAT; no valid quote by then -> the trade is SKIPPED and counted (reason recorded).
* Buy legs pay the ask, sell legs receive the bid. No mid fills.
* Valid to BUY: bid > 0, ask > bid, ask size > 0 (zero, locked, crossed or missing-second "stale" quotes skipped).
  Valid to SELL (closing a long): ask > 0, ask >= bid, bid >= 0, row present. A zero bid is a valid quote of zero
  value (an option offered with no bid); it closes the leg at 0 with no exit fee (it is left to expire).
  Valid to SELL to open (short legs, iron fly): bid > 0, ask > bid, bid size > 0. Buy to close a short: ask > 0, ask >= bid.
* Fees $0.65 per contract per side per leg (zero-bid exits pay none). Sensitivities: fee=1.30, ticks=+1 (pay one more
  tick on every buy and receive one less on every sell, floored at 0; tick per config.tick).
* Exit decision for a time stop = min(t + h, close - 120 s) (quotes stop at the close; 'close' means 15:58:00, or
  12:58:00 on early-close days).
* Return convention: ret = net P&L / premium, premium = |entry debit| * 100 per structure (the sum of the entry
  asks for long structures; for a credit structure, the max risk, see simulate()).

Data: 1-second NBBO windows from lib.theta (change-only, as-of semantics). simulate() never reads a quote stamped
before the decision second + LAT for its fill, and the entry decision itself uses nothing from these windows.
"""
import numpy as np

from . import guard
from .cal import close_min
from .config import FEE, LAT, MAX_WAIT, tick
from .theta import q1s, fetch_q1s_windows

ENTRY_SPAN = 3720          # one window [t, t + 62 min] serves the entry and exits at +15/+30/+60
EXIT_SPAN = 64


def exit_decision(day, t, h):
    """Exit decision second of a time stop at horizon h (minutes or 'close')."""
    last = close_min(day) * 60 - 120
    if h == 'close':
        return last
    return min(t + 60 * int(h), last)


def windows(day, legs, t, exits):
    """1-second windows needed for an entry at t and the given exit decision seconds. legs: [(k, call, qty)]."""
    out = []
    for k, call, _ in legs:
        out.append((k, call, t, t + ENTRY_SPAN))
        for x in exits:
            if x + LAT + MAX_WAIT > t + ENTRY_SPAN:
                out.append((k, call, x, x + EXIT_SPAN))
    return out


def prefetch(root, day, plan):
    """plan: list of (legs, t, exits). One request per missing window; returns request count."""
    w = []
    for legs, t, exits in plan:
        w += windows(day, legs, t, exits)
    seen, uniq = set(), []
    for x in w:
        key = (round(x[0], 3), x[1], x[2], x[3])
        if key not in seen:
            seen.add(key)
            uniq.append(x)
    return fetch_q1s_windows(root, day, uniq)


def _valid(b, a, bs, as_, mode):
    if b < 0 or a < 0:                       # sentinel: missing second
        return False
    if mode == 'buy_open':
        return b > 0 and a > b and as_ > 0
    if mode == 'sell_close':
        return a > 0 and a >= b and b >= 0
    if mode == 'sell_open':
        return b > 0 and a > b and bs > 0
    if mode == 'buy_close':
        return a > 0 and a >= b
    raise ValueError(mode)


def fill(q, x, mode):
    """First valid quote at or after x + LAT within MAX_WAIT. Returns (price_side_quote dict) or None."""
    if q is None or not len(q['s']):
        return None
    s = q['s']
    start = x + LAT
    i = np.searchsorted(s, start, 'right') - 1     # as-of row at start
    if i < 0:
        i = 0
        if s[0] > start + MAX_WAIT:
            return None
    while i < len(s):
        sec = max(int(s[i]), start)
        if sec > start + MAX_WAIT:
            return None
        b, a, bs, as_ = float(q['bid'][i]), float(q['ask'][i]), int(q['bs'][i]), int(q['as'][i])
        if s[i] <= start + MAX_WAIT and _valid(b, a, bs, as_, mode):
            return {'s': sec, 'bid': b, 'ask': a, 'wait': sec - start}
        i += 1
    return None


def _get(root, day, k, call, a, b, fetch):
    return q1s(root, day, k, call, a, b, fetch=fetch)


def simulate(root, day, legs, t, x_exit, fee=FEE, ticks=0, fetch=True):
    """One structure. legs: [(k, call, qty)] with qty > 0 long (buy to open) or < 0 short (sell to open).
    Entry decision t, exit decision x_exit (seconds). Returns dict; 'skip' holds the reason when skipped."""
    guard.check(day)
    out = {'skip': None, 'legs': []}
    debit = 0.0          # $ per structure paid at entry (negative = credit)
    proceeds = 0.0       # $ received at exit (negative = paid to close)
    fees = 0.0
    zero_bid = 0
    for k, call, qty in legs:
        qe = _get(root, day, k, call, t, t + LAT + MAX_WAIT, fetch)
        qx = _get(root, day, k, call, x_exit, x_exit + LAT + MAX_WAIT, fetch)
        if qe is None or qx is None:
            out['skip'] = 'no_data'
            return out
        long = qty > 0
        fe = fill(qe, t, 'buy_open' if long else 'sell_open')
        if fe is None:
            out['skip'] = 'entry_quote'
            return out
        fx = fill(qx, x_exit, 'sell_close' if long else 'buy_close')
        if fx is None:
            out['skip'] = 'exit_quote'
            return out
        n = abs(qty)
        tk_e = tick(root, fe['ask'] if long else fe['bid'])
        tk_x = tick(root, fx['bid'] if long else fx['ask'])
        if long:
            pe = fe['ask'] + ticks * tk_e
            px = max(fx['bid'] - ticks * tk_x, 0.0)
            debit += pe * 100 * n
            proceeds += px * 100 * n
            fees += fee * n + (fee * n if px > 0 else 0.0)
            zero_bid += px <= 0
        else:
            pe = max(fe['bid'] - ticks * tk_e, 0.0)
            px = fx['ask'] + ticks * tk_x
            debit -= pe * 100 * n
            proceeds -= px * 100 * n
            fees += 2 * fee * n
        out['legs'].append({'k': k, 'call': call, 'qty': qty, 'entry': pe, 'entry_s': fe['s'], 'exit': px,
                            'exit_s': fx['s'], 'entry_bid': fe['bid'], 'entry_ask': fe['ask'],
                            'exit_bid': fx['bid'], 'exit_ask': fx['ask']})
    gross = proceeds - debit
    premium = debit if debit > 0 else None
    out.update({'debit': debit, 'proceeds': proceeds, 'fees': fees, 'pnl_gross': gross, 'pnl': gross - fees,
                'premium': premium, 'zero_bid_exits': zero_bid})
    # mid-to-mid (no spread, no fee) value change of the same structure at the same fill seconds: CALC reference only
    mid_in = sum(l['qty'] * 100 * (l['entry_bid'] + l['entry_ask']) / 2 for l in out['legs'])
    mid_out = sum(l['qty'] * 100 * (l['exit_bid'] + l['exit_ask']) / 2 for l in out['legs'])
    out['ret_mid'] = (mid_out - mid_in) / abs(mid_in) if mid_in else np.nan
    if premium:
        out['ret_gross'] = gross / premium
        out['ret'] = (gross - fees) / premium
        # round-trip cost: the half-spread paid at entry and exit relative to the mids, + fees, as % of premium
        spread_cost = sum(abs(l['qty']) * 100 * ((l['entry_ask'] - l['entry_bid']) / 2 + (l['exit_ask'] - l['exit_bid']) / 2)
                          for l in out['legs'])
        out['cost_rt'] = (spread_cost + fees) / premium
    return out
