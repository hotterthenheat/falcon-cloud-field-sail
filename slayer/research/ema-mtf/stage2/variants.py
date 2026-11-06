"""Stage-2-C variants (PREREG section 5.1) and their execution on a Stage2Data, plus the two Stage-2 nulls.

Centre: entry B (E9/E21 cross) on the 5m MID chart, no MTF filter, exit 3, |delta| 0.40, intraday, every root and
bucket pooled. Variants change one factor: the entry (A, C, D, E, F, G, H), the MTF model (A-F) or the exit
(1, 2, 4-10). 23 in all.

Choice of the contract (STRATEGY_SPEC section 7): at a decision the trigger is evaluated on every tradable contract's
own chart; among the contracts of a (bucket, right) that trigger, the one nearest |delta| 0.40 (ties: cheaper ask);
if a call and a put both trigger in the same bucket, the one nearer 0.40 (ties: the call) -- one open position per
(variant, root, bucket), signals while a position is open are skipped (a new entry needs a decision after the open
position's exit decision bar).
"""
from __future__ import annotations

import hashlib

import numpy as np
import pandas as pd

from stage2.sim import Cfg, Ctx, DayGrid, simulate, simulate_x2
from stage1.events import ckey

CENTRE = {'entry': 'B', 'mtf': None, 'exit': 'X3'}


def stage2c() -> list[dict]:
    v = [dict(CENTRE, id='S2C-centre')]
    for e in ('A', 'C', 'D', 'E', 'F', 'G', 'H'):
        v.append(dict(CENTRE, entry=e, id=f'S2C-entry{e}'))
    for m in ('A', 'B', 'C', 'D', 'E', 'F'):
        v.append(dict(CENTRE, mtf=m, id=f'S2C-mtf{m}', entry='H' if m == 'F' else 'B'))
    for x in (1, 2, 4, 5, 6, 7, 8, 9, 10):
        v.append(dict(CENTRE, exit=f'X{x}', id=f'S2C-exit{x}'))
    assert len(v) == 23
    return v


MTF_SETS = {'A': (5, 15), 'B': (5, 15), 'C': (5, 15, 60), 'D': (1, 5, 15, 30, 60), 'E': (1, 5, 15, 30, 60), 'F': (5, 15)}
W = {1: 1, 5: 2, 15: 3, 30: 4, 60: 5}


def trigger_mask(cand: pd.DataFrame, v: dict) -> np.ndarray:
    e = v['entry']
    if e in ('A', 'B', 'C', 'D', 'E', 'H'):
        t = cand[f's{e}'].to_numpy(bool)
    elif e == 'F':
        t = cand.sB.to_numpy(bool) & cand.vwap_ok.to_numpy(bool) & cand.ema21_ok.to_numpy(bool)
    elif e == 'BL3':
        t = cand.ucross.to_numpy() == cand.right.to_numpy()          # underlying-only 5m cross, side of the cross
    elif e == 'G':
        t = cand.sB.to_numpy(bool) & cand.gex_neg.to_numpy(bool) & cand.nowall.to_numpy(bool)
    else:
        raise KeyError(e)
    m = v.get('mtf')
    if m is None:
        return t
    tfs = MTF_SETS[m]
    st = {tf: cand[f'st{tf}'].to_numpy(float) for tf in tfs}
    if m == 'A':
        age = cand.b15_age.to_numpy(float)
        return t & np.isfinite(age) & (age >= 0) & (age <= 2)
    if m == 'B':
        return t & (st[max(tfs)] == 1)
    if m == 'C':
        return t & np.all([st[tf] == 1 for tf in tfs], axis=0)
    if m == 'D':
        ok = np.all([np.isfinite(st[tf]) for tf in tfs], axis=0)
        score = sum(W[tf] * np.nan_to_num(st[tf]) for tf in tfs) / sum(W[tf] for tf in tfs)
        return t & ok & (score >= 0.6)
    if m == 'E':
        return t & (np.sum([st[tf] == 1 for tf in tfs], axis=0) >= len(tfs) // 2 + 1)
    if m == 'F':
        htf = [tf for tf in tfs if tf != 5]
        return t & np.all([st[tf] <= 0 for tf in htf], axis=0) & cand.e5up15.to_numpy(bool)
    raise KeyError(m)


def pick_entries(cand: pd.DataFrame, mask: np.ndarray, target=0.40) -> pd.DataFrame:
    """One contract per (session, m, bucket): nearest |delta| target among the triggering contracts, call on ties."""
    x = cand[mask]
    if not len(x):
        return x
    dist = (np.abs(x.delta) - target).abs() if target != 0.40 else x.dist
    x = x.assign(_d=dist.to_numpy(), _put=(x.right.to_numpy() < 0).astype(int))
    x = x.sort_values(['session', 'm', 'bucket', '_d', '_put', 'ask'], kind='stable')
    return x.drop_duplicates(['session', 'm', 'bucket'], keep='first').drop(columns=['_d', '_put'])


class Runner:
    """Simulates trades on one Stage2Data, caching day grids and per-(contract, session) exit contexts."""

    def __init__(self, data, cfg: Cfg | None = None, fills=None):
        self.d = data
        self.cfg = cfg or Cfg()
        self.fills = fills
        self._grid = {}
        self._ctx = {}
        self._t1 = {}
        self._cols = {}
        d = data
        self.t5 = d.t5
        self.t5k = ckey(d.t5.exp, d.t5.strike, d.t5.right)
        self._t5_rows = _rows_by_key(self.t5k)
        t1 = d.th[1]
        self.t1k = ckey(t1.exp, t1.strike, t1.right)
        self._t1_rows = _rows_by_key(self.t1k)

    def grid(self, D):
        if D not in self._grid:
            if len(self._grid) > 3:
                self._grid.clear()
            self._grid[D] = DayGrid(self.d.src.q0(D), self.d.keys)
        return self._grid[D]

    def _col(self, tab, c):
        key = (id(tab), c)
        if key not in self._cols:
            self._cols[key] = tab[c].to_numpy(np.int64) if c == '_key' else tab[c].to_numpy(float)
        return self._cols[key]

    def _asof_arrays(self, tab, rows, D, cols):
        if (id(tab), '_key') not in self._cols:
            self._cols[(id(tab), '_key')] = tab.session.to_numpy(np.int64) * 100_000_000 + tab.known_ms.to_numpy(np.int64)
        keys = self._cols[(id(tab), '_key')][rows]
        q = int(D) * 100_000_000 + (570 + np.arange(390, dtype=np.int64) + 1) * 60_000
        i = np.searchsorted(keys, q, side='right') - 1
        ok = i >= 0
        ii = rows[np.clip(i, 0, None)]
        out = {c: np.where(ok, self._col(tab, c)[ii], np.nan) for c in cols}
        out['kms'] = np.where(ok, keys[np.clip(i, 0, None)], -1)
        out['ok'] = ok
        return out

    def ctx(self, ck, D, need_t1=False):
        key = (int(ck), str(D))
        cx = self._ctx.get(key)
        if cx is None:
            if len(self._ctx) > 5000:
                self._ctx.clear()
            g = self.grid(str(D)).row(ck)
            B, A = g[0], g[1]
            mid = np.where((B > 0) & (A >= B), (B + A) / 2, np.nan)
            rows = self._t5_rows.get(int(ck), np.zeros(0, np.int64))
            cols = ['c', 'ema5', 'ema9', 'ema15', 'ema20', 'ema21', 'ema50', 'ema100', 'ema200', 'atr', 'state']
            t5 = self._asof_arrays(self.t5, rows, D, cols)
            t5 = {k: v.tolist() for k, v in t5.items()}
            cx = Ctx(mid.tolist(), t5, None, {'c': t5['c'], 'ema9': t5['ema9'], 'ema21': t5['ema21'], 'ok': t5['ok']})
            self._ctx[key] = cx
        if need_t1 and cx.t1 is None:
            cx.t1 = self._t1_ctx(ck, D)
        return cx

    def _t1_ctx(self, ck, D):
        from engine.underlying import structure
        sw = self._t1.get(int(ck))
        rows = self._t1_rows.get(int(ck), np.zeros(0, np.int64))
        t1 = self.d.th[1]
        if sw is None:
            c = t1.c.to_numpy(float)[rows]
            s = structure(pd.DataFrame({'h': c, 'l': c, 'c': c}))
            sw = s.swing_low.to_numpy()
            if len(self._t1) > 3000:
                self._t1.clear()
            self._t1[int(ck)] = sw
        keys = t1.session.to_numpy(np.int64)[rows] * 100_000_000 + t1.known_ms.to_numpy(np.int64)[rows]
        q = int(D) * 100_000_000 + (570 + np.arange(390, dtype=np.int64) + 1) * 60_000
        i = np.searchsorted(keys, q, side='right') - 1
        ok = i >= 0
        j = np.clip(i, 0, None)
        return {'c': np.where(ok, t1.c.to_numpy(float)[rows][j] if len(rows) else np.nan, np.nan).tolist(),
                'swing_low': np.where(ok, sw[j] if len(rows) else np.nan, np.nan).tolist(), 'ok': ok.tolist()}

    def trade(self, row, exit_name, cfg=None) -> dict:
        cfg = cfg or self.cfg
        D = str(int(row['session']))
        c = (int(row['exp']), int(row['strike']), int(row['right']))
        ck = int(ckey(c[0], c[1], c[2]))
        g = self.grid(D).row(ck)
        cx = self.ctx(ck, D, need_t1=(exit_name == 'X5'))
        ul = self.d.und_last.get(int(D), np.nan)
        if exit_name == 'X2':
            return simulate_x2(self.d.root, D, c, int(row['m']), g, cx, cfg, ul, self.fills)
        return simulate(self.d.root, D, c, int(row['m']), g, cx, exit_name, cfg, ul, self.fills)

    def run_entries(self, ent: pd.DataFrame, exit_name, tag, concurrency=True, cfg=None) -> list:
        recs = []
        for (D, b), grp in ent.groupby(['session', 'bucket'], sort=True):
            busy = -1
            for r in grp.sort_values('m').to_dict('records'):
                if concurrency and r['m'] <= busy:
                    continue
                rec = self.trade(r, exit_name, cfg)
                rec.update({'variant': tag, 'bucket': b, 'block': self.d.block, 'delta': float(r['delta']),
                            'dte': (pd.Timestamp(str(int(r['exp']))) - pd.Timestamp(str(int(D)))).days})
                recs.append(rec)
                if rec['status'] == 'filled':
                    busy = rec['exit_decision_m']
        return recs


def _rows_by_key(k: np.ndarray) -> dict:
    if not len(k):
        return {}
    brk = np.r_[0, np.flatnonzero(k[1:] != k[:-1]) + 1, len(k)]
    return {int(k[a]): np.arange(a, b) for a, b in zip(brk[:-1], brk[1:])}


def run_variant(R: Runner, v: dict, cfg=None, target=0.40) -> pd.DataFrame:
    ent = pick_entries(R.d.cand, trigger_mask(R.d.cand, v), target=target)
    return pd.DataFrame(R.run_entries(ent, v['exit'], v['id'], cfg=cfg))


# ------------------------------------------------------------------------------------------------ nulls
def _seed(*a) -> int:
    return int(hashlib.sha256('|'.join(map(str, a)).encode()).hexdigest()[:12], 16)


def _groups(R: Runner):
    """Cached once per Runner: for each (session, bucket) the decision closes and, per (m, right), the contract nearest
    |delta| 0.40 (stable sort by dist then ask, as a per-draw filter would give); for each (session, m, bucket, right)
    the candidates' |delta|, ask and rows in their original order."""
    if getattr(R, '_g', None) is None:
        c = R.d.cand
        cols = ['session', 'exp', 'strike', 'right', 'm', 'delta']
        recs = c[cols].to_dict('records')
        sb, best, smb = {}, {}, {}
        S, M, Bk, Rt = c.session.to_numpy(), c.m.to_numpy(), c.bucket.to_numpy(), c.right.to_numpy()
        dist, ask, ad = c.dist.to_numpy(), c.ask.to_numpy(), np.abs(c.delta.to_numpy())
        for i in range(len(c)):
            k = (int(S[i]), Bk[i])
            sb.setdefault(k, set()).add(int(M[i]))
            smb.setdefault((int(S[i]), int(M[i]), Bk[i], int(Rt[i])), []).append(i)
        for k, idx in smb.items():
            idx = np.array(idx)
            j = idx[np.lexsort((ask[idx], dist[idx]))[0]]
            best[k] = recs[j]
        R._g = {'sb': {k: np.array(sorted(v)) for k, v in sb.items()}, 'best': best,
                'smb': {k: (ad[np.array(v)], ask[np.array(v)], [recs[i] for i in v]) for k, v in smb.items()}}
    return R._g


def null_time(R: Runner, trades: pd.DataFrame, exit_name, seed: int, tag='null_time') -> pd.DataFrame:
    """BL2-style shuffled-time null: per (session, bucket), the variant's number of filled entries drawn at random
    decision closes (random order, the one-position rule applied, drawing until the count is met), random side, the
    tradable contract nearest |delta| 0.40; the variant's exit."""
    f = trades[trades.status == 'filled'] if len(trades) else trades
    if not len(f):
        return pd.DataFrame()
    G = _groups(R)
    need = f.groupby(['session', 'bucket']).size()
    recs = []
    for (D, b), n in need.items():
        ms = G['sb'].get((int(D), b))
        if ms is None:
            continue
        rng = np.random.default_rng(_seed(seed, R.d.root, D, b, tag))
        order = rng.permutation(ms)
        sides = rng.choice([1, -1], len(order))
        taken = []
        for m, side in zip(order, sides):
            if len(taken) >= n:
                break
            if any(a <= m <= z for a, z in taken):
                continue
            r = G['best'].get((int(D), int(m), b, int(side)))
            if r is None:
                continue
            rec = R.trade(r, exit_name)
            if rec['status'] != 'filled':
                continue
            rec.update({'variant': tag, 'bucket': b, 'block': R.d.block})
            recs.append(rec)
            taken.append((int(m), int(rec['exit_decision_m'])))
    return pd.DataFrame(recs)


def null_side(R: Runner, trades: pd.DataFrame, exit_name, seed: int, tag='null_side') -> pd.DataFrame:
    """Shuffled-side null: the variant's entry times and buckets, a coin-flip right, the tradable contract of that
    right nearest the variant contract's |delta|; the variant's exit."""
    f = trades[trades.status == 'filled'] if len(trades) else trades
    if not len(f):
        return pd.DataFrame()
    G = _groups(R)
    recs = []
    for t in f[['session', 'decision_m', 'bucket', 'delta']].to_dict('records'):
        rng = np.random.default_rng(_seed(seed, R.d.root, t['session'], t['decision_m'], t['bucket'], tag))
        side = 1 if rng.random() < 0.5 else -1
        x = G['smb'].get((int(t['session']), int(t['decision_m']), t['bucket'], side))
        if x is None:
            continue
        ad, ask, rows = x
        j = np.lexsort((ask, np.abs(ad - abs(t['delta']))))[0]
        rec = R.trade(rows[j], exit_name)
        rec.update({'variant': tag, 'bucket': t['bucket'], 'block': R.d.block})
        recs.append(rec)
    return pd.DataFrame(recs)


def null_summaries(R: Runner, trades: pd.DataFrame, exit_name, seeds, kinds=('time', 'side')) -> pd.DataFrame:
    """Every null run of a variant at once, session by session (each session's quote grid is built once): the same
    draws as null_time / null_side for each seed (their RNGs are seeded per (seed, root, session, bucket[, m])), summed
    per (kind, seed): n filled, sum of net returns, sum of net $."""
    f = trades[trades.status == 'filled'] if len(trades) else trades
    acc = {(k, s): [0, 0.0, 0.0] for k in kinds for s in seeds}
    if not len(f):
        return pd.DataFrame([{'kind': k, 'seed': s, 'n': 0, 'sum_ret': 0.0, 'sum_pnl': 0.0} for k, s in acc])
    for D, fd in f.groupby('session', sort=True):
        for seed in seeds:
            for kind in kinds:
                x = (null_time if kind == 'time' else null_side)(R, fd, exit_name, seed)
                if len(x):
                    x = x[x.status == 'filled']
                    a = acc[(kind, seed)]
                    a[0] += len(x)
                    a[1] += float(x.ret_net.sum())
                    a[2] += float(x.pnl_net.sum())
    return pd.DataFrame([{'kind': k, 'seed': s, 'n': v[0], 'sum_ret': v[1], 'sum_pnl': v[2]} for (k, s), v in acc.items()])
