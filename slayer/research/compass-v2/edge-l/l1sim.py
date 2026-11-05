"""L1 trade simulator (long legs only). Quote paths: 1-second NBBO (primary) or the 1-minute chain (nulls / sweep).

Entry: each leg at the ask of the first quote stamped >= T + 2 s with bid > 0, ask > 0, ask size >= 1 (all legs or
no trade). Exit decisions at closed 1-minute underlying bars (decision second d = bar end); every leg sells at the
bid of the first quote stamped >= d + 2 s. Rules read only bars ending <= d and quotes stamped < d (asserted).
"""
import numpy as np

LAT = 2
FLAT = 15 * 3600 + 50 * 60
FEE = 0.65
VARIANTS = {
    'V1': dict(kind='S', T=35100, k=1.10, exit='XA'),
    'V2': dict(kind='S', T=35100, k=1.25, exit='XA'),
    'V3': dict(kind='S', T=35100, k=1.40, exit='XA'),
    'V4': dict(kind='S', T=35100, k=1.25, exit='XB'),
    'V5': dict(kind='S', T=37800, k=1.25, exit='XA'),
    'V6': dict(kind='D', T=35100, k=1.25, exit='XA'),
    'V7': dict(kind='D', T=37800, k=1.25, exit='XA'),
    'V8': dict(kind='D', T=37800, k=1.25, exit='XB'),
}


def first_at(q, t, need_ask=False):
    s = q['s']
    i = np.searchsorted(s, t, side='left')
    while i < len(s):
        if q['bid'][i] > 0 and (not need_ask or (q['ask'][i] > 0 and q['as'][i] >= 1)):
            return i
        i += 1
    return None


def last_before(q, t):
    i = np.searchsorted(q['s'], t, side='left') - 1
    while i >= 0 and q['bid'][i] <= 0:
        i -= 1
    if i >= 0:
        assert q['s'][i] < t
    return i if i >= 0 else None


def simulate(legs, quotes, bars_m, bars_c, T, F, kind, exit_rule, side=0, K=None):
    """legs: list of (k, call); quotes: list of quote dicts; bars_m/bars_c: minute index and close of the underlying
    for the whole session (only bars ending <= d are read at decision d). Returns a dict or None."""
    fills = []
    for q in quotes:
        i = first_at(q, T + LAT, need_ask=True)
        if i is None or q['s'][i] > T + 600:
            return None
        fills.append(float(q['ask'][i]))
    cost = sum(fills)
    sdF = np.sqrt(F)
    m0 = T // 60 - 1                                    # last closed bar at T
    j0 = np.searchsorted(bars_m, m0)
    if j0 >= len(bars_m) or bars_m[j0] != m0:
        return None
    S0 = bars_c[j0]
    lr = np.diff(np.log(bars_c[j0:]))
    cum = np.concatenate([[0.0], np.cumsum(lr ** 2)])   # realized var since T at bar index j0 + n
    reason, d = 'flat', FLAT
    armed = False
    for n in range(1, len(bars_c) - j0):
        de = int(bars_m[j0 + n]) * 60 + 60              # bar end = decision second
        if de > FLAT:
            break
        assert de >= T + 60
        S = bars_c[j0 + n]
        mv = np.log(S / S0)
        if exit_rule == 'XA':
            if cum[n] >= F:
                reason, d = 'catchup', de
                break
            if kind == 'D' and side * mv <= -0.75 * sdF:
                reason, d = 'stop', de
                break
        elif exit_rule == 'XB' and kind == 'S':
            if abs(np.log(S / K)) >= sdF or cum[n] >= F:
                reason, d = 'target', de
                break
            if de == 13 * 3600 + 30 * 60:
                val = 0.0
                for q in quotes:
                    i = last_before(q, de)
                    val += float(q['bid'][i]) if i is not None else 0.0
                if val < cost:
                    reason, d = 'time', de
                    break
        elif exit_rule == 'XB' and kind == 'D':
            if side * mv >= sdF:
                reason, d = 'target', de
                break
            if side * mv >= 0.5 * sdF:
                armed = True
            if side * mv <= (0.0 if armed else -0.6 * sdF):
                reason, d = 'stop', de
                break
    proceeds = 0.0
    for q in quotes:
        i = first_at(q, d + LAT)
        if i is None:                                    # no live bid after the decision: last bid seen, else 0
            i = last_before(q, 10 ** 9)
            proceeds += float(q['bid'][i]) if i is not None else 0.0
        else:
            proceeds += float(q['bid'][i])
    nl = len(quotes)
    gross = (proceeds - cost) / cost
    net = (proceeds * 100 - cost * 100 - 2 * FEE * nl) / (cost * 100 + FEE * nl)
    return dict(cost=cost, proceeds=proceeds, ret_gross=gross, ret_net=net, reason=reason, exit_s=d,
                rv_since=float(cum[-1]))


def minute_quotes(chain, k, call):
    g = chain[(chain.k == k) & (chain.r == (1 if call else 0))].sort_values('m')
    return {'s': (g.m.values.astype(np.int64) * 60), 'bid': g.bid.values, 'ask': g.ask.values, 'as': g['as'].values}
