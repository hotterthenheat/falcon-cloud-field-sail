"""EDGE-R simulator: Model Risk R0/R1/R2 on one session (specs/PREREG.md @ 74ad403).

  python3 sim_r.py run K N [max_minutes]   worker K of N over the seeded DEV order (1 request in flight each; N <= 2)
  python3 sim_r.py run K N --nofetch       cache only
  python3 sim_r.py bars                    SPY/QQQ 04:00-20:00 month bars for every DEV month
Results: v2data/edge-r/res/<day>.json (trades of every variant, with the shuffle-null opposite side).
"""
import bisect
import json
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import rmodel as M  # noqa: E402
import term  # noqa: E402

VARIANTS = ('R0', 'R1', 'R2')
RES = os.path.join(M.OUT, 'res')
PREOPEN = os.environ.get('EDGE_R_PREOPEN', '0') == '1'   # set from the probe (LOG.md)


class Day:
    def __init__(self, day, Q, fetch=True):
        M.assert_open(day)
        self.day = day
        self.Q = Q
        self.c = {}
        self.src = {}
        self.last = {}
        for tk in M.TICKERS:
            c, src = M.day_closes(tk, day)
            self.c[tk], self.src[tk] = c, src
            fin = np.isfinite(c)
            li = np.where(fin, np.arange(1440), -1)
            self.last[tk] = np.maximum.accumulate(li)
        self.exp = {tk: {b: M.book_expiry(M.ROOT_OF[tk], day, b) for b in ('0', '1-7')} for tk in M.TICKERS}
        if fetch:
            for tk in M.TICKERS:
                e = self.exp[tk]['1-7']
                if e:
                    M.fetch_board(M.ROOT_OF[tk], day, e, start='09:00:00' if PREOPEN else '09:30:00')
                e0 = self.exp[tk]['0']
                if e0 and PREOPEN and tk in M.NO_OVERNIGHT:
                    M.fetch_board(M.ROOT_OF[tk], day, e0, start='09:00:00', end='09:29:00', tag='')
        cs = self.c['SPXW']
        self.spx_o = M.spx_open(day)
        self.spx_c = float(cs[959]) if np.isfinite(cs[959]) else np.nan
        self.ns = M.next_session(day)
        self._nc = {}
        inst = set()
        for tk in M.TICKERS:
            for m in np.flatnonzero(np.isfinite(self.c[tk])):
                inst.add((int(m) + 1) * 60)
        self.inst = sorted(inst)

    def next_closes(self, tk):
        if tk not in self._nc:
            if M.F.is_locked(self.ns):
                self._nc[tk] = None
            else:
                try:
                    c, _ = M.day_closes(tk, self.ns)
                    self._nc[tk] = c if np.isfinite(c).any() else None
                except Exception:
                    self._nc[tk] = None
        return self._nc[tk]

    # ------------------------------------------------------------ R1 filter
    def blocked(self, side, s):
        m = s // 60 - 1
        cs = self.c['SPXW']
        j = int(self.last['SPXW'][min(max(m, 0), 1439)]) if m >= 0 else -1
        if j < 0 or not (self.spx_o > 0):
            return False
        prior = cs[:j]
        prior = prior[np.isfinite(prior)][-30:]
        if not len(prior):
            return False
        S = cs[j]
        mv = S / self.spx_o - 1
        if side == 'C':
            return mv <= -M.DIR_MOVE and S < prior.min()
        return mv >= M.DIR_MOVE and S > prior.max()


def _bid_from(p, t, t_end):
    """bid in force at t, or the first later second with bid > 0 up to t_end; (bid, second)."""
    t = max(t, p['s0'])
    t_end = min(t_end, p['s1'])
    for u in range(int(t), int(t_end) + 1):
        b = M.q_at(p, u, 'bid')
        if b > 0:
            return b, u
    return 0.0, int(t_end)


def price_leg(D, tk, book, side, k, exp, s, idx, line, variant, x):
    """Fill + exit of one contract (real or opposite side) given the ticket's exit decision x (from bars)."""
    root = M.ROOT_OF[tk]
    end_d = M.CLOSE0_S if exp == D.day else M.CLOSE17_S
    f = max(s + M.LAT, M.OPEN_S + M.LAT)
    r = {'k': k, 'fill_s': f}
    if f >= end_d:
        r['skip'] = 'after_close'
        return r
    on_d = x['day'] == D.day
    sx = x['s']
    b_end = min(end_d, (sx + M.LAT + 10) if on_d else end_d)
    b_end = max(b_end, f + 5)
    a0 = max(s, M.OPEN_S)
    p = D.Q.path(root, D.day, exp, k, side, a0, b_end)
    if p is None:
        r['skip'] = 'no_quotes'
        return r
    ask, bid0, asz = M.q_at(p, f, 'ask'), M.q_at(p, f, 'bid'), M.q_at(p, f, 'as')
    if not (ask > 0) or asz < 1:
        r['skip'] = 'no_ask'
        return r
    r.update(fill=ask, bid0=bid0, spr0=(ask - bid0) / ((ask + bid0) / 2) if ask + bid0 > 0 else None)
    # live accounting: exit bid at the START of the exit bar (bidThen hh:mm:00)
    if on_d and x.get('bar') is not None and p['s0'] <= x['bar'] * 60 <= p['s1']:
        r['live_exit'] = M.q_at(p, x['bar'] * 60, 'bid')
    stop_s = None
    if variant == 'R2':
        t_hi = min((sx if on_d else end_d) - 1, p['s1'])
        if t_hi > f:
            lo = f + 1 - p['s0']
            hi = t_hi - p['s0'] + 1
            bb, aa, bs, az = p['bid'][lo:hi], p['ask'][lo:hi], p['bs'][lo:hi], p['as'][lo:hi]
            hit = np.flatnonzero(M.sane(bb, aa, bs, az) & (bb <= M.STOP_FRAC * ask))
            if len(hit):
                stop_s = int(f + 1 + hit[0])
    if stop_s is not None:
        px, u = _bid_from(p, stop_s + M.LAT, p['s1'])
        r.update(why='stop', exit_s=u, exit_day=D.day, exit=px, free_s=stop_s)
    elif on_d and sx + M.LAT <= end_d:
        px, u = _bid_from(p, max(sx + M.LAT, M.OPEN_S + M.LAT), p['s1'])
        r.update(why=x['why'], exit_s=u, exit_day=D.day, exit=px)
    elif exp == D.day:
        S = D.c[tk][959] if np.isfinite(D.c[tk][959]) else np.nan
        if tk == 'SPXW':
            S = D.spx_c
        intr = max(0.0, (S - k) if side == 'C' else (k - S)) if np.isfinite(S) else 0.0
        r.update(why='expiry', exit_s=end_d, exit_day=D.day, exit=float(intr), exit_why_bars=x['why'])
    else:
        ns = D.ns
        if M.F.is_locked(ns):
            px = M.q_at(p, p['s1'], 'bid')
            r.update(why='flag_locked_next', exit_s=p['s1'], exit_day=D.day, exit=px)
        else:
            t_sell = max((sx if not on_d else 0) + M.LAT, M.OPEN_S + M.LAT)
            p2 = D.Q.path(root, ns, exp, k, side, M.OPEN_S, max(t_sell + 10, M.OPEN_S + 120))
            if p2 is None:
                r.update(why='flag_no_next', exit_s=p['s1'], exit_day=D.day, exit=M.q_at(p, p['s1'], 'bid'))
            else:
                px, u = _bid_from(p2, t_sell, p2['s1'])
                r.update(why='nextday', exit_s=u, exit_day=ns, exit=px, exit_why_bars=x['why'])
    fee_out = 0.0 if (r['why'] == 'expiry' and r['exit'] <= 0) else M.FEE
    r['pnl_gross'] = (r['exit'] - ask) * 100
    r['pnl_net'] = r['pnl_gross'] - M.FEE - fee_out
    r['ret_gross'] = (r['exit'] - ask) / ask
    r['ret_net'] = r['pnl_net'] / (ask * 100)
    return r


def exit_decision(D, tk, idx, line, side):
    eb = M.exit_bar(D.c[tk], idx, line, side)
    if eb is not None:
        return {'day': D.day, 'bar': eb[0], 's': (eb[0] + 1) * 60, 'why': eb[1]}
    nc = D.next_closes(tk)
    if nc is not None:
        eb = M.exit_bar(nc, -1, line, side)
        if eb is not None:
            return {'day': D.ns, 'bar': eb[0], 's': (eb[0] + 1) * 60, 'why': eb[1]}
    return {'day': D.ns, 'bar': None, 's': 0, 'why': 'noexit'}


def try_enter(D, s, taken, variant):
    m = s // 60 - 1
    if m < 0:
        return None
    for tk in M.TICKERS:
        idx = int(D.last[tk][min(m, 1439)])
        if idx < 0:
            continue
        c = D.c[tk]
        px = float(c[idx])
        rg = M.trail_range(c, idx)
        if rg is None:
            continue
        side = M.break_side(px, rg[0], rg[1])
        if side is None:
            continue
        if variant == 'R2' and tk in M.NO_OVERNIGHT and s < M.OPEN_S + 60:
            continue
        if variant == 'R1' and D.blocked(side, s):
            continue
        books = []
        if D.exp[tk]['0'] and (tk, '0', side) not in taken:
            books.append('0')
        if D.exp[tk]['1-7'] and (tk, '1-7', side) not in taken:
            books.append('1-7')
        if not books:
            continue
        for book in books:
            exp = D.exp[tk][book]
            dte = M.weekday_dte(D.day, exp)
            rows = M.board_at(M.ROOT_OF[tk], D.day, exp, s // 60, side == 'C')
            pick = M.rank_book(rows, px, idx, dte, side == 'C')
            if pick:
                return {'tk': tk, 'book': book, 'side': side, 'exp': exp, 'dte': dte, 'idx': idx, 'px': px,
                        'hi': rg[0], 'lo': rg[1], 'pick': pick}
    return None


def simulate(D, variant, with_opp=True):
    taken = set()
    out = []
    inst = D.inst
    if not inst:
        return out
    s = inst[0]
    while True:
        t = try_enter(D, s, taken, variant)
        if t is not None:
            tk, side, idx = t['tk'], t['side'], t['idx']
            taken.add((tk, t['book'], side))
            line = t['lo'] if side == 'C' else t['hi']
            x = exit_decision(D, tk, idx, line, side)
            leg = price_leg(D, tk, t['book'], side, t['pick']['k'], t['exp'], s, idx, line, variant, x)
            rec = {'day': D.day, 'variant': variant, 'tk': tk, 'book': t['book'], 'side': side, 'exp': t['exp'],
                   'dte': t['dte'], 'bar': idx, 'dec_s': s, 'spot': t['px'], 'hi': t['hi'], 'lo': t['lo'],
                   'board_bid': t['pick']['bid'], 'board_ask': t['pick']['ask'], 'iv': t['pick']['iv'],
                   'x_day': x['day'], 'x_bar': x['bar'], 'x_s': x['s'], 'x_why': x['why'],
                   'src': D.src[tk], **{f'leg_{k}': v for k, v in leg.items()}}
            if with_opp:
                oside = 'P' if side == 'C' else 'C'
                rows = M.board_at(M.ROOT_OF[tk], D.day, t['exp'], s // 60, oside == 'C')
                op = M.rank_book(rows, t['px'], idx, t['dte'], oside == 'C')
                if op:
                    ol = price_leg(D, tk, t['book'], oside, op['k'], t['exp'], s, idx, line, variant, x)
                    rec.update({f'opp_{k}': v for k, v in ol.items()})
            out.append(rec)
            if x['day'] != D.day or x['why'] == 'noexit':
                break
            # the seat frees at the exit (or stop) decision; the same pass may open the next ticket there
            s = max(int(leg.get('free_s', x['s'])), s + 1)
            if s > inst[-1]:
                break
            continue
        j = bisect.bisect_right(inst, s)
        if j >= len(inst):
            break
        s = inst[j]
    return out


def run_day(day, Q):
    D = Day(day, Q, fetch=Q.fetch)
    res = {'day': day, 'spx_o': D.spx_o, 'spx_c': D.spx_c, 'src': D.src, 'exp': D.exp, 'trades': []}
    for v in VARIANTS:
        res['trades'] += simulate(D, v)
    return res


def _clean(x):
    if isinstance(x, dict):
        return {k: _clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_clean(v) for v in x]
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (np.floating, float)):
        return float(x) if np.isfinite(x) else None
    return x


def run(k, n, max_minutes=1e9, fetch=True):
    os.makedirs(RES, exist_ok=True)
    Q = M.Quotes(fetch=fetch)
    t0 = time.time()
    days = M.dev_days()[k::n]
    done = 0
    for day in days:
        f = os.path.join(RES, f'{day}.json')
        if os.path.exists(f):
            continue
        if time.time() - t0 > max_minutes * 60:
            print('time cut', flush=True)
            break
        try:
            res = run_day(day, Q)
        except term.Refused as e:
            print('refused:', e, flush=True)
            break
        json.dump(_clean(res), open(f, 'w'))
        done += 1
        if done % 5 == 0:
            print(time.strftime('%H:%M:%S'), f'w{k} days {done} req {term.STATS["req"]} ({term.STATS["sec"]:.0f}s) '
                  f'hits {Q.hits} miss {Q.miss} free {term.disk_free_gb():.2f} GB', flush=True)
    print('done', done, term.STATS, Q.hits, flush=True)


def bars_all():
    months = sorted({d[:7] for d in M.dev_days()} | {M.next_session(d)[:7] for d in M.dev_days()})
    for sym in ('SPY', 'QQQ'):
        for mo in months:
            print(sym, mo, M.fetch_month_bars(sym, mo), flush=True)


if __name__ == '__main__':
    if sys.argv[1] == 'run':
        k, n = int(sys.argv[2]), int(sys.argv[3])
        mm = float(sys.argv[4]) if len(sys.argv) > 4 and not sys.argv[4].startswith('--') else 1e9
        run(k, n, mm, fetch='--nofetch' not in sys.argv)
    elif sys.argv[1] == 'bars':
        bars_all()
