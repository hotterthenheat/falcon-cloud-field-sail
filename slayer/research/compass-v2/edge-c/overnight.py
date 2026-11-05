"""K5's rule and its pre-registered siblings (specs/PREREG.md: S1 evening, S2 XSP, S3 side source) on the overnight
session, from one-minute chain NBBO (the challenger's raw cache for SPXW, EDGE-C's fetch for XSP).

  python3 overnight.py explore DEV            every variant on the minute path (fill = ask one minute after the mark)
  python3 overnight.py protocol DEV K5ref S1a  1-second protocol execution (FOUNDATION sim) of named variants
  python3 overnight.py nulls DEV K5ref         shuffled-side and synthetic zero-drift nulls of named variants

Minutes are counted from the session day's 00:00 ET (the evening before is negative: 20:15 = -225).
"""
from __future__ import annotations

import json
import math
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

OUT = os.path.join(C.DATA, 'results')
os.makedirs(OUT, exist_ok=True)
FLAT = 9 * 60 + 20          # 09:20
TP, SL = 1.50, 0.4678
STEP = 5

# ---------------------------------------------------------------- variants (PREREG)
V = {
    'K5ref': dict(root='SPXW', win=(0, 355), band=(0.10, 0.20, 0.15), cap=0.08, side='parity', gmin=0.0),
    'S1a': dict(root='SPXW', win=(-225, -5), band=(0.10, 0.20, 0.15), cap=0.08, side='parity', gmin=0.0),
    'S1b': dict(root='SPXW', win=(-120, -5), band=(0.10, 0.20, 0.15), cap=0.08, side='parity', gmin=0.0),
    'S1c': dict(root='SPXW', win=(-225, -5), band=(0.10, 0.20, 0.15), cap=0.08, side='parity', gmin=0.001),
    'S1d': dict(root='SPXW', win=(-225, -5), band=(0.10, 0.20, 0.15), cap=0.04, side='parity', gmin=0.0),
    'S2a': dict(root='XSP', win=(0, 355), band=(0.10, 0.20, 0.15), cap=0.08, side='parity', gmin=0.0),
    'S2b': dict(root='XSP', win=(0, 355), band=(0.10, 0.20, 0.15), cap=0.15, side='parity', gmin=0.0),
    'S2c': dict(root='XSP', win=(0, 355), band=(0.15, 0.30, 0.225), cap=0.08, side='parity', gmin=0.0),
    'S3a': dict(root='SPXW', win=(0, 355), band=(0.10, 0.20, 0.15), cap=0.08, side='xsp', gmin=0.0),
    'S3b': dict(root='SPXW', win=(240, 355), band=(0.10, 0.20, 0.15), cap=0.08, side='spy', gmin=0.0),
    'S3c': dict(root='SPXW', win=(0, 355), band=(0.10, 0.20, 0.15), cap=0.08, side='prevday', gmin=0.0),
}
FAMILY = {'K5ref': 'K5', 'S1a': 'S1', 'S1b': 'S1', 'S1c': 'S1', 'S1d': 'S1', 'S2a': 'S2', 'S2b': 'S2', 'S2c': 'S2',
          'S3a': 'S3', 'S3b': 'S3', 'S3c': 'S3'}


# ---------------------------------------------------------------- one night
class Night:
    """One session's overnight data for one root: both expiries' one-minute chains, the parity spot at every mark,
    the SPX prior close, SPY pre-market quotes, the XSP parity (for S3a)."""

    def __init__(self, root: str, session: str):
        assert not C.is_locked(session), session
        self.root, self.session = root, session
        self.exps = C.two_expiries(root, session)
        self.chains = {e: C.load_chain(root, session, e) for e in self.exps}
        self.chains = {e: c for e, c in self.chains.items() if c is not None and len(c)}
        self.ok = bool(self.chains) and self.exps[0] in self.chains
        und = 'SPX'
        self.prev, pc = C.prior_close(und, session)
        self.pc = pc / (10 if root == 'XSP' else 1)
        self.pc_prev2 = float('nan')
        if self.prev:
            _, p2 = C.prior_close(und, self.prev)
            self.pc_prev2 = p2 / (10 if root == 'XSP' else 1)
        self._boards = {}
        self._par = {}
        self._spy = None
        self._xsp = None

    def board(self, e, t):
        k = (e, t)
        if k not in self._boards:
            c = self.chains.get(e)
            self._boards[k] = c[c.t == t] if c is not None else None
        return self._boards[k]

    def parity(self, t) -> float:
        if t not in self._par:
            e = self.exps[0]
            b = self.board(e, t)
            S = C.parity_spot(b, C.years_to_expiry(e, self.session, t)) if b is not None and len(b) else float('nan')
            if not np.isfinite(S) and len(self.exps) > 1 and self.exps[1] in self.chains:
                b = self.board(self.exps[1], t)
                S = C.parity_spot(b, C.years_to_expiry(self.exps[1], self.session, t)) if b is not None and len(b) else float('nan')
            self._par[t] = S
        return self._par[t]

    def spy_mid(self, t) -> float:
        if self._spy is None:
            q = C.fetch_stock_quotes_1m('SPY', self.session) if os.path.exists(
                os.path.join(C.DATA, 'stk1m', 'SPY', f'{self.session}.parquet')) else None
            self._spy = q if q is not None else pd.DataFrame(columns=['t', 'bid', 'ask'])
            _, self.spy_pc = C.prior_close('SPY', self.session)
        q = self._spy[(self._spy.t <= t) & (self._spy.t >= t - 5)]
        return float((q.bid.iloc[-1] + q.ask.iloc[-1]) / 2) if len(q) else float('nan')

    def xsp_parity(self, t) -> float:
        if self._xsp is None:
            self._xsp = Night('XSP', self.session) if self.root != 'XSP' else self
        return self._xsp.parity(t) if self._xsp.ok else float('nan')

    def side(self, how, t) -> tuple[int, float]:
        """(+1 call / -1 put / 0 none, the signal value g)."""
        S = self.parity(t)
        if how == 'parity':
            g = math.log(S / self.pc) if np.isfinite(S) and self.pc > 0 else float('nan')
        elif how == 'xsp':
            X = self.xsp_parity(t)
            g = math.log(X / (self.pc / 10 if self.root == 'SPXW' else self.pc)) if np.isfinite(X) else float('nan')
        elif how == 'spy':
            m = self.spy_mid(t)
            g = math.log(m / self.spy_pc) if np.isfinite(m) and self.spy_pc > 0 else float('nan')
        elif how == 'prevday':
            g = math.log(self.pc / self.pc_prev2) if np.isfinite(self.pc_prev2) and self.pc_prev2 > 0 else float('nan')
        else:
            raise ValueError(how)
        if not np.isfinite(g) or g == 0:
            return 0, g
        return (1 if g > 0 else -1), g

    def select(self, t, side, band, cap):
        """K5's contract rule on the board at t: side, |delta| in band nearest the target, spread <= cap, ask size >= 1."""
        S = self.parity(t)
        if not np.isfinite(S):
            return None
        lo, hi, tgt = band
        best = None
        for e in self.exps:
            b = self.board(e, t)
            if b is None or not len(b):
                continue
            b = b[(b.r == (1 if side > 0 else 0)) & (b.bid > 0) & (b.ask > b.bid) & (b['as'] >= 1)]
            if not len(b):
                continue
            mid = (b.bid.values + b.ask.values) / 2
            spr = (b.ask.values - b.bid.values) / mid
            T = C.years_to_expiry(e, self.session, t)
            iv = C.implied_vol(mid, S, b.k.values, T, b.r.values == 1)
            dl = np.abs(C.bs_delta(S, b.k.values, T, np.where(np.isfinite(iv), iv, 0.2), b.r.values == 1))
            ok = np.isfinite(iv) & (dl >= lo) & (dl <= hi) & (spr <= cap)
            if not ok.any():
                continue
            i = np.flatnonzero(ok)[np.argmin(np.abs(dl[ok] - tgt))]
            cand = dict(exp=e, k=float(b.k.values[i]), call=side > 0, delta=float(dl[i]), iv=float(iv[i]), S=S,
                        bid=float(b.bid.values[i]), ask=float(b.ask.values[i]), spr=float(spr[i]), T=T, as_=int(b['as'].values[i]))
            if best is None or abs(cand['delta'] - tgt) < abs(best['delta'] - tgt):
                best = cand
        return best

    def path(self, exp, k, call, t_from):
        c = self.chains[exp]
        p = c[(c.k == k) & (c.r == (1 if call else 0)) & (c.t >= t_from)].sort_values('t')
        return p

    def settle_minute(self, sel, t):
        """K5's exit on the minute path: fill = the ask one minute after the mark (first quote within 5 min); TP at
        bid >= 1.50 x fill, stop at bid <= 0.4678 x fill, else the bid at the last minute <= 09:20."""
        p = self.path(sel['exp'], sel['k'], sel['call'], t + 1)
        f = p[(p.t <= t + 5) & (p.ask > 0) & (p.bid >= 0)]
        if not len(f):
            return None
        fill = float(f.ask.iloc[0])
        t_fill = int(f.t.iloc[0])
        if fill <= 0:
            return None
        q = p[(p.t > t_fill) & (p.t <= FLAT) & (p.ask > 0)]
        if not len(q):
            return None
        b = q.bid.values.astype(float)
        hit = np.flatnonzero(b >= TP * fill)
        stp = np.flatnonzero(b <= SL * fill)
        i_tp = hit[0] if len(hit) else 10 ** 9
        i_sl = stp[0] if len(stp) else 10 ** 9
        if i_tp < 10 ** 9 and i_tp <= i_sl:
            ex, why, t_ex = TP * fill, 'tp', int(q.t.values[i_tp])
        elif i_sl < 10 ** 9:
            ex, why, t_ex = float(b[i_sl]), 'sl', int(q.t.values[i_sl])
        else:
            ex, why, t_ex = float(b[-1]), 'flat', int(q.t.values[-1])
        return dict(fill=fill, t_fill=t_fill, exit=ex, why=why, t_exit=t_ex, ret=ex / fill - 1, ret_fee=C.ret_fee(fill, ex),
                    win=why == 'tp', n_quotes=int(len(q)), last_t=int(q.t.values[-1]))


def run_variant(name: str, days: list[str], nights: dict | None = None) -> list[dict]:
    """One trade a session: the first mark in the window with a side and an eligible contract; both sides settled
    (the opposite side on the same mark for the shuffled null)."""
    v = V[name]
    nights = nights if nights is not None else {}
    out = []
    for d in days:
        key = (v['root'], d)
        if key not in nights:
            nights[key] = Night(v['root'], d)
        N = nights[key]
        if not N.ok or not np.isfinite(N.pc):
            continue
        for t in range(v['win'][0], v['win'][1] + 1, STEP):
            side, g = N.side(v['side'], t)
            if side == 0 or abs(g) < v['gmin']:
                continue
            sel = N.select(t, side, v['band'], v['cap'])
            if sel is None:
                continue
            res = N.settle_minute(sel, t)
            if res is None:
                continue
            opp_sel = N.select(t, -side, v['band'], v['cap'])
            opp = N.settle_minute(opp_sel, t) if opp_sel else None
            rec = dict(variant=name, session=d, root=v['root'], t=t, mark=f'{(t % 1440) // 60:02d}:{t % 60:02d}', g=g,
                       **{k: sel[k] for k in ('exp', 'k', 'call', 'delta', 'iv', 'S', 'bid', 'ask', 'spr', 'as_')}, **res)
            if opp:
                rec.update({f'opp_{k}': opp[k] for k in ('fill', 'exit', 'why', 'ret', 'ret_fee', 'win')})
                rec.update(opp_k=opp_sel['k'], opp_delta=opp_sel['delta'], opp_exp=opp_sel['exp'])
            out.append(rec)
            break
    return out


# ---------------------------------------------------------------- statistics
def summarize(tr: pd.DataFrame, days: list[str], label: str) -> dict:
    out = {'label': label, 'sessions': len(days), 'n': int(len(tr))}
    if not len(tr):
        return out
    ses = tr.session.astype(str).to_numpy()
    for col, name in (('ret', 'gross'), ('ret_fee', 'net')):
        m, lo, hi = C.cluster_ci(tr[col].to_numpy(float), ses)
        out[name] = {'exp': m, 'lo': lo, 'hi': hi}
    w, wlo, whi = C.cluster_ci(tr.win.astype(float).to_numpy(), ses)
    out['win'] = {'rate': w, 'lo': wlo, 'hi': whi}
    out['why'] = tr.why.value_counts().to_dict()
    out['median_net'] = float(tr.ret_fee.median())
    r = tr.ret_fee.to_numpy(float)
    out['sharpe_trade'] = float(r.mean() / r.std(ddof=1)) if len(r) > 2 and r.std() > 0 else float('nan')
    out['by_year'] = {y: {'n': int(len(g)), 'net': float(g.ret_fee.mean()), 'win': float(g.win.mean())} for y, g in tr.groupby(tr.session.str[:4])}
    out['median_spread'] = float(tr.spr.median())
    out['median_fill'] = float(tr.fill.median())
    return out


def fmt(s: dict) -> str:
    if not s.get('n'):
        return f"| {s['label']} | {s['sessions']} | 0 | | | | | |"
    yr = ' '.join(f"{y}:{100*x['net']:+.0f}%/{x['n']}" for y, x in s['by_year'].items())
    return (f"| {s['label']} | {s['sessions']} | {s['n']} | {100*s['win']['rate']:.0f}% [{100*s['win']['lo']:.0f}, {100*s['win']['hi']:.0f}] | "
            f"{C.fmt_ci(s['net']['exp'], s['net']['lo'], s['net']['hi'])} | {100*s['gross']['exp']:+.1f}% | "
            f"{s['why']} | spr {100*s['median_spread']:.1f}% fill ${s['median_fill']:.2f} | {yr} |")


HEAD = ('| variant | sessions | n | win (TP) [95%] | expectancy net of fee [95%] | gross | exits | quotes | by year |\n'
        '|---|---:|---:|---:|---:|---:|---|---|---|')


def shuffled_null(tr: pd.DataFrame, days, draws=200, seed=0):
    """Same sessions and marks, the side a fair coin: the real or the opposite side's settled trade. Returns the null
    expectancies (net) and the share of draws whose clustered CI excludes 0 on the positive side."""
    t = tr[tr.opp_ret_fee.notna()] if 'opp_ret_fee' in tr else tr.iloc[:0]
    if len(t) < 5:
        return {'n': int(len(t)), 'draws': 0}
    rng = np.random.default_rng(seed)
    a, b = t.ret_fee.to_numpy(float), t.opp_ret_fee.to_numpy(float)
    ses = t.session.astype(str).to_numpy()
    exps, passes = [], 0
    for i in range(draws):
        pick = rng.random(len(t)) < 0.5
        r = np.where(pick, a, b)
        m, lo, hi = C.cluster_ci(r, ses, n_boot=600, seed=i)
        exps.append(m)
        passes += lo > 0
    exps = np.array(exps)
    real = float(a.mean())
    return {'n': int(len(t)), 'draws': draws, 'null_mean': float(exps.mean()), 'null_p95': float(np.percentile(exps, 95)),
            'fdr': passes / draws, 'real_pct': float((exps < real).mean()), 'opp_mean': float(b.mean()),
            'opp_win': float(t.opp_win.mean())}


def synthetic_null(tr: pd.DataFrame, nights: dict, reps=200, seed=0):
    """Zero-drift synthetic nights: from each real trade's mark, the parity spot follows a driftless log-normal walk at
    the real night's realised 5-minute vol (from that night's parity series over the window mark..09:15), the chosen
    contract is priced by BS at its entry IV with its real spread fraction, the fill is the synthetic ask one minute
    on, and the same bracket / 09:20 flat runs on the synthetic minute bids."""
    rng = np.random.default_rng(seed)
    rows = []
    for r in tr.itertuples():
        N = nights[(r.root, r.session)]
        ts = list(range(int(r.t), 9 * 60 + 16, STEP))
        par = np.array([N.parity(t) for t in ts], float)
        par = par[np.isfinite(par)]
        if len(par) < 6:
            continue
        lr = np.diff(np.log(par))
        s5 = float(np.sqrt(np.mean(lr * lr)))
        if not (s5 > 0):
            continue
        rows.append(dict(S=r.S, k=r.k, call=bool(r.call), iv=r.iv, spr=r.spr, t=int(r.t), exp=r.exp, session=r.session, s5=s5))
    if len(rows) < 5:
        return {'n': len(rows), 'reps': 0}
    ses = np.array([x['session'] for x in rows])
    exps, wins, passes = [], [], 0
    s1 = np.array([x['s5'] / math.sqrt(STEP) for x in rows])
    for rep in range(reps):
        rets = np.empty(len(rows))
        w = np.empty(len(rows))
        for i, x in enumerate(rows):
            n = FLAT - x['t']
            z = rng.normal(-0.5 * s1[i] ** 2, s1[i], n)
            S = x['S'] * np.exp(np.cumsum(z))
            tt = x['t'] + 1 + np.arange(n)
            T = np.array([C.years_to_expiry(x['exp'], x['session'], t) for t in tt])
            mid = np.maximum(C.bs_price(S, x['k'], T, x['iv'], x['call']), 0.0)
            ask = mid * (1 + x['spr'] / 2)
            bid = mid * (1 - x['spr'] / 2)
            fill = float(ask[0])
            if fill < 0.05:
                rets[i], w[i] = np.nan, 0
                continue
            b = bid[1:]
            hit = np.flatnonzero(b >= TP * fill)
            stp = np.flatnonzero(b <= SL * fill)
            i_tp = hit[0] if len(hit) else 10 ** 9
            i_sl = stp[0] if len(stp) else 10 ** 9
            if i_tp < 10 ** 9 and i_tp <= i_sl:
                ex, win = TP * fill, 1
            elif i_sl < 10 ** 9:
                ex, win = float(b[i_sl]), 0
            else:
                ex, win = float(b[-1]), 0
            rets[i], w[i] = C.ret_fee(fill, ex), win
        ok = np.isfinite(rets)
        m, lo, hi = C.cluster_ci(rets[ok], ses[ok], n_boot=600, seed=rep)
        exps.append(m)
        wins.append(float(w[ok].mean()))
        passes += lo > 0
    exps = np.array(exps)
    real = float(tr.ret_fee.mean())
    return {'n': len(rows), 'reps': reps, 'null_mean': float(exps.mean()), 'null_p95': float(np.percentile(exps, 95)),
            'null_win': float(np.mean(wins)), 'fdr': passes / reps, 'real_pct': float((exps < real).mean())}


# ---------------------------------------------------------------- protocol execution (FOUNDATION sim on 1-s NBBO)
def protocol(tr: pd.DataFrame) -> pd.DataFrame:
    sys.path.insert(0, C.FOUNDATION)
    from data.store import Contract
    from sim.engine import Engine, SimConfig, Strategy, clock
    from sim.exits import FixedBracket
    from sim.memsession import MemSession

    class OneCall(Strategy):
        timer_ms = None

        def __init__(self, c, mark_ms):
            self.c, self.wake_ms = c, (mark_ms,)

        def on_event(self, ctx, ev):
            if ev.kind == 'wake' and ev.ms == self.wake_ms[0] and not ctx.pending_or_open:
                ctx.buy(self.c, qty=1, exit=FixedBracket(tp=TP, sl=SL), tag='sib')

    DAY = 24 * 3600 * 1000
    rows = []
    for r in tr.itertuples():
        evening = r.t < 0
        parts = []
        if evening:
            parts.append(C.fetch_1s(r.root, r.session, r.exp, r.k, bool(r.call), start='20:15:00', end='00:00:00'))
            parts[-1] = parts[-1].assign(ms=parts[-1].ms - DAY) if len(parts[-1]) and parts[-1].ms.min() >= 0 else parts[-1]
        parts.append(C.fetch_1s(r.root, r.session, r.exp, r.k, bool(r.call), start='00:00:00', end='09:30:00'))
        q = pd.concat(parts, ignore_index=True).sort_values('ms')
        if len(q):
            v = q[['bid', 'ask', 'bs', 'as']].to_numpy()
            q = q[np.r_[True, (v[1:] != v[:-1]).any(1)]]
        con = Contract(r.root, int(r.exp.replace('-', '')), int(round(r.k * 1000)), 1 if r.call else -1)
        if not len(q):
            rows.append(dict(session=r.session, variant=r.variant, t=r.t, exec_reason='no_1s_quotes'))
            continue
        ses = MemSession(r.session.replace('-', ''), {con: {k: q[k].to_numpy() for k in ('ms', 'bid', 'ask', 'bs', 'as')}})
        mark_ms = int(r.t) * 60000
        cfg = SimConfig(latency_ms=2000, fee_per_contract=C.FEE, fill_rule='in_force', cap_to_displayed=True,
                        start_ms=min(mark_ms, 0) - 60000, flat_ms=clock('09:20'), end_ms=clock('09:30'))
        eng = Engine(ses, OneCall(con, mark_ms), cfg)
        log = eng.run()
        rec = dict(session=r.session, variant=r.variant, t=r.t, minute_fill=r.fill, minute_ret=r.ret, minute_why=r.why)
        if log:
            x = log[0]
            rec.update(exec_fill=x['entry_px'], exec_exit=x['exit_px'], exec_reason=x['reason'], exec_ret=x['ret_gross'],
                       exec_ret_net=x['ret_net'], exec_size=x['entry_ask_size'], exec_forced=x['forced'], exec_win=x['reason'] == 'tp')
        else:
            rec.update(exec_reason='rejected:' + ';'.join(z['why'] for z in eng.rejects))
        rows.append(rec)
    return pd.DataFrame(rows)


def exec_summary(ex: pd.DataFrame, days, label):
    e = ex[ex.exec_ret.notna()] if 'exec_ret' in ex else ex.iloc[:0]
    out = {'label': label, 'n_calls': int(len(ex)), 'n_filled': int(len(e)), 'sessions': len(days)}
    if not len(e):
        out['rejects'] = ex.exec_reason.value_counts().to_dict() if len(ex) else {}
        return out
    ses = e.session.astype(str).to_numpy()
    for col, name in (('exec_ret', 'gross'), ('exec_ret_net', 'net')):
        m, lo, hi = C.cluster_ci(e[col].to_numpy(float), ses)
        out[name] = {'exp': m, 'lo': lo, 'hi': hi}
    w, wlo, whi = C.cluster_ci(e.exec_win.astype(float).to_numpy(), ses)
    out['win'] = {'rate': w, 'lo': wlo, 'hi': whi}
    out['reasons'] = e.exec_reason.value_counts().to_dict()
    out['rejects'] = ex[ex.exec_ret.isna()].exec_reason.value_counts().to_dict()
    out['median_size'] = float(e.exec_size.median())
    return out


def fmt_exec(s):
    if not s.get('n_filled'):
        return f"| {s['label']} | {s['n_calls']} | 0 | | | | {s.get('rejects')} |"
    return (f"| {s['label']} | {s['n_calls']} | {s['n_filled']} | {100*s['win']['rate']:.0f}% [{100*s['win']['lo']:.0f}, {100*s['win']['hi']:.0f}] | "
            f"{C.fmt_ci(s['net']['exp'], s['net']['lo'], s['net']['hi'])} | {100*s['gross']['exp']:+.1f}% | {s['reasons']} size {s['median_size']:.0f} rej {s['rejects']} |")


HEAD_EXEC = ('| variant (1-s protocol) | calls | filled | win (TP) [95%] | expectancy net [95%] | gross | exits / displayed size / rejects |\n'
             '|---|---:|---:|---:|---:|---:|---|')


# ---------------------------------------------------------------- main
def main():
    mode, split = sys.argv[1], sys.argv[2]
    names = sys.argv[3:] or list(V)
    days_spxw = C.raw_days(split, 'SPXW') if split != 'VAL' or not os.environ.get('EDGEC_VAL_DAYS') else \
        open(os.environ['EDGEC_VAL_DAYS']).read().split()
    days = sorted(days_spxw)
    for d in days:
        assert not C.is_locked(d), d
    nights = {}
    if mode == 'explore':
        lines = [HEAD]
        for name in names:
            f = os.path.join(OUT, f'{name}_{split}.parquet')
            if os.path.exists(f):
                tr = pd.read_parquet(f)
            else:
                tr = pd.DataFrame(run_variant(name, days, nights))
                tr.to_parquet(f)
            s = summarize(tr, days, f'{name} {split}')
            lines.append(fmt(s))
            print(lines[-1], flush=True)
            json.dump(s, open(os.path.join(OUT, f'{name}_{split}_summary.json'), 'w'), indent=1, default=float)
        open(os.path.join(OUT, f'explore_{split}.md'), 'a').write('\n'.join(lines) + '\n')
    elif mode == 'nulls':
        for name in names:
            tr = pd.read_parquet(os.path.join(OUT, f'{name}_{split}.parquet'))
            if not len(tr):
                print(name, 'no trades')
                continue
            for d in tr.session.unique():
                nights.setdefault((V[name]['root'], d), Night(V[name]['root'], d))
            sh = shuffled_null(tr, days)
            sy = synthetic_null(tr, nights)
            res = {'variant': name, 'split': split, 'real_net': float(tr.ret_fee.mean()), 'real_win': float(tr.win.mean()), 'shuffled': sh, 'synthetic': sy}
            print(json.dumps(res, default=float), flush=True)
            json.dump(res, open(os.path.join(OUT, f'{name}_{split}_nulls.json'), 'w'), indent=1, default=float)
    elif mode == 'protocol':
        lines = [HEAD_EXEC]
        for name in names:
            tr = pd.read_parquet(os.path.join(OUT, f'{name}_{split}.parquet'))
            f = os.path.join(OUT, f'{name}_{split}_exec.parquet')
            ex = pd.read_parquet(f) if os.path.exists(f) else protocol(tr)
            ex.to_parquet(f)
            s = exec_summary(ex, days, f'{name} {split}')
            lines.append(fmt_exec(s))
            print(lines[-1], flush=True)
            json.dump(s, open(os.path.join(OUT, f'{name}_{split}_exec_summary.json'), 'w'), indent=1, default=float)
        open(os.path.join(OUT, f'protocol_{split}.md'), 'a').write('\n'.join(lines) + '\n')


if __name__ == '__main__':
    main()
