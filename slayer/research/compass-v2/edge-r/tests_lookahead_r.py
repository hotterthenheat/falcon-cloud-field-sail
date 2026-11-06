"""EDGE-R look-ahead test (PREREG): for every R0 ticket on a sample of cached sessions,
  1. the entry (ticker, book, side, strike) recomputed with every bar after the decision's last closed bar and every
     board stamped after the decision minute replaced by noise must be identical;
  2. the exit decision recomputed with every bar after the exit bar replaced by noise must be identical;
  3. the fill and exit price recomputed with every quote after the exit sale second replaced by noise must be identical.
Canaries (must be caught, i.e. change under the noise): a trigger that reads the forming bar (s//60), and an exit
priced 60 s after the sale second.   python3 tests_lookahead_r.py [n_sessions] -> results/lookahead.txt"""
import copy
import glob
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import rmodel as M  # noqa: E402
import sim_r as S  # noqa: E402

RNG = np.random.default_rng(5)
_board_real = M.board_at
CUT = {'stamp': None}


def board_noisy(root, day, exp, stamp, call):
    rows = _board_real(root, day, exp, stamp, call)
    if rows is None or CUT['stamp'] is None or stamp <= CUT['stamp']:
        return rows
    k, b, a = rows
    nb = np.abs(b * RNG.uniform(0.3, 3.0, len(b)))
    return k, nb, nb * RNG.uniform(1.0, 1.05, len(b))


class NoisyQ:
    def __init__(self, Q, cut):
        self.Q, self.cut, self.fetch = Q, cut, False

    def path(self, root, day, exp, k, right, a, b):
        p = self.Q.path(root, day, exp, k, right, a, b)
        if p is None:
            return None
        p = {x: (v.copy() if isinstance(v, np.ndarray) else v) for x, v in p.items()}
        i0 = self.cut.get(day, 10 ** 9) - p['s0'] + 1
        if i0 < len(p['bid']):
            i0 = max(i0, 0)
            n = len(p['bid']) - i0
            p['bid'][i0:] = p['bid'][i0:] * RNG.uniform(0.2, 3.0, n)
            p['ask'][i0:] = p['bid'][i0:] * 1.03 + 0.01
        return p


def noised_day(D, last_bar, tks=None):
    D2 = copy.copy(D)
    D2.c = {}
    D2.last = {}
    for tk in M.TICKERS:
        c = D.c[tk].copy()
        if last_bar is not None:
            tail = np.isfinite(c[last_bar + 1:])
            c[last_bar + 1:][tail] = c[last_bar + 1:][tail] * (1 + RNG.normal(0, 0.01, tail.sum()))
        D2.c[tk] = c
        D2.last[tk] = np.maximum.accumulate(np.where(np.isfinite(c), np.arange(1440), -1))
    D2._nc = {}
    return D2


def forming_trigger(D, s):
    """canary: the same rule but on the bar still printing (s//60)."""
    m = s // 60
    out = []
    for tk in M.TICKERS:
        c = D.c[tk]
        if m < 1440 and np.isfinite(c[m]):
            rg = M.trail_range(c, m)
            out.append(M.break_side(float(c[m]), *rg) if rg else None)
    return tuple(out)


def main(n=60):
    files = sorted(glob.glob(os.path.join(S.RES, '*.json')))[:n]
    Q = M.Quotes(fetch=False)
    cnt = {'entry': [0, 0], 'exit': [0, 0], 'price': [0, 0], 'canary_forming': [0, 0], 'canary_peek': [0, 0], 'canary_peek8': [0, 0]}
    M.board_at = board_noisy
    S.M.board_at = board_noisy
    for f in files:
        day = json.load(open(f))['day']
        D = S.Day(day, Q, fetch=False)
        CUT['stamp'] = None
        trades = S.simulate(D, 'R0', with_opp=False)
        taken = set()
        for t in trades:
            s = t['dec_s']
            # 1. entry with later bars and boards noised
            CUT['stamp'] = s // 60
            D2 = noised_day(D, s // 60 - 1)
            e2 = S.try_enter(D2, s, taken, 'R0')
            same = e2 is not None and (e2['tk'], e2['book'], e2['side'], e2['pick']['k']) == (t['tk'], t['book'], t['side'], t['leg_k'])
            cnt['entry'][0] += same
            cnt['entry'][1] += 1
            # canary: forming bar
            cnt['canary_forming'][0] += forming_trigger(D, s) != forming_trigger(D2, s)
            cnt['canary_forming'][1] += 1
            CUT['stamp'] = None
            taken.add((t['tk'], t['book'], t['side']))
            # 2. exit decision with bars after the exit bar noised
            if t['x_day'] == day and t['x_bar'] is not None:
                D3 = noised_day(D, t['x_bar'])
                line = t['lo'] if t['side'] == 'C' else t['hi']
                x3 = S.exit_decision(D3, t['tk'], t['bar'], line, t['side'])
                cnt['exit'][0] += (x3['bar'], x3['why']) == (t['x_bar'], t['x_why'])
                cnt['exit'][1] += 1
            # 3. prices with quotes after the sale second noised
            if t.get('leg_fill') is not None and t.get('leg_exit_day') == day and t.get('leg_why') != 'expiry':
                es = int(t['leg_exit_s'])
                D4 = copy.copy(D)
                D4.Q = NoisyQ(Q, {day: es})
                x = {'day': t['x_day'], 'bar': t['x_bar'], 's': t['x_s'], 'why': t['x_why']}
                line = t['lo'] if t['side'] == 'C' else t['hi']
                leg = S.price_leg(D4, t['tk'], t['book'], t['side'], t['leg_k'], t['exp'], s, t['bar'], line, 'R0', x)
                cnt['price'][0] += abs(leg.get('exit', -1) - t['leg_exit']) < 1e-9 and abs(leg.get('fill', -1) - t['leg_fill']) < 1e-9
                cnt['price'][1] += 1
                # canary: peek 60 s after the sale
                root = M.ROOT_OF[t['tk']]
                p_clean = Q.path(root, day, t['exp'], t['leg_k'], t['side'], es, es + 60)
                p_noisy = D4.Q.path(root, day, t['exp'], t['leg_k'], t['side'], es, es + 60)
                if p_clean is not None:
                    cnt['canary_peek'][0] += abs(M.q_at(p_clean, es + 60, 'bid') - M.q_at(p_noisy, es + 60, 'bid')) > 1e-9
                    cnt['canary_peek'][1] += 1
                # canary: peek 8 s after the sale (inside every priced window)
                p_c8 = Q.path(root, day, t['exp'], t['leg_k'], t['side'], es, es + 8)
                p_n8 = D4.Q.path(root, day, t['exp'], t['leg_k'], t['side'], es, es + 8)
                if p_c8 is not None:
                    cnt['canary_peek8'][0] += abs(M.q_at(p_c8, es + 8, 'bid') - M.q_at(p_n8, es + 8, 'bid')) > 1e-9
                    cnt['canary_peek8'][1] += 1
    lines = [f'EDGE-R look-ahead test on {len(files)} cached sessions (R0 tickets)',
             f"entry identical with later bars+boards noised: {cnt['entry'][0]}/{cnt['entry'][1]}",
             f"exit decision identical with bars after the exit bar noised: {cnt['exit'][0]}/{cnt['exit'][1]}",
             f"fill+exit price identical with quotes after the sale noised: {cnt['price'][0]}/{cnt['price'][1]}",
             f"CANARY forming-bar trigger changed by the noise (caught): {cnt['canary_forming'][0]}/{cnt['canary_forming'][1]}",
             f"CANARY exit priced 60 s after the sale changed by the noise (caught): {cnt['canary_peek'][0]}/{cnt['canary_peek'][1]} (only where a cached window reaches +60 s)",
             f"CANARY exit priced 8 s after the sale changed by the noise (caught): {cnt['canary_peek8'][0]}/{cnt['canary_peek8'][1]}"]
    open(os.path.join(HERE, 'results', 'lookahead.txt'), 'w').write('\n'.join(lines) + '\n')
    print('\n'.join(lines))


if __name__ == '__main__':
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 60)
